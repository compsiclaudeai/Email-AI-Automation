import { Client } from '@microsoft/microsoft-graph-client';
import type { FetchedMessage, MailProvider, SendReplyInput } from './provider.types';
import { stripHtml } from './gmail.provider';
import { logger } from '../utils/logger';

interface GraphMessage {
  id: string;
  conversationId: string;
  internetMessageId?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime: string;
  isRead: boolean;
  hasAttachments: boolean;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  body?: { contentType?: string; content?: string };
  internetMessageHeaders?: { name: string; value: string }[];
}

/** Well-known folders Graph accepts by name; anything else needs an id lookup. */
const WELL_KNOWN = new Set([
  'inbox', 'archive', 'drafts', 'sentitems', 'deleteditems', 'junkemail',
  'outbox', 'clutter', 'conflicts', 'conversationhistory', 'localfailures',
  'msgfolderroot', 'recoverableitemsdeletions', 'scheduled', 'searchfolders',
  'serverfailures', 'syncissues',
]);

/** Microsoft Graph implementation of MailProvider (Outlook / Microsoft 365). */
export class GraphProvider implements MailProvider {
  readonly name = 'graph' as const;
  private client: Client;
  /** Resolved display-name -> folder id, cached for the life of the instance. */
  private folderIds = new Map<string, string>();

  constructor(accessToken: string) {
    this.client = Client.init({ authProvider: (done) => done(null, accessToken) });
  }

  /**
   * Turns a folder the user typed ("Client Tickets") into something Graph will
   * accept. Graph addresses custom folders by id, not by display name, so
   * passing the name straight into the URL 404s — which used to surface as an
   * empty inbox with no explanation.
   */
  private async resolveFolder(folder: string): Promise<string> {
    const key = folder.trim();
    if (!key) return 'inbox';
    if (WELL_KNOWN.has(key.toLowerCase().replace(/\s+/g, ''))) {
      return key.toLowerCase().replace(/\s+/g, '');
    }
    const cached = this.folderIds.get(key.toLowerCase());
    if (cached) return cached;

    // Search top-level folders, then one level of children — enough for the
    // "rule routes client mail into its own folder" setup this supports.
    const seen: { id: string; displayName: string }[] = [];
    const top = (await this.client
      .api('/me/mailFolders')
      .top(100)
      .select('id,displayName,childFolderCount')
      .get()) as { value: { id: string; displayName: string; childFolderCount: number }[] };

    seen.push(...(top.value ?? []));
    for (const parent of top.value ?? []) {
      if (!parent.childFolderCount) continue;
      try {
        const kids = (await this.client
          .api(`/me/mailFolders/${parent.id}/childFolders`)
          .top(100)
          .select('id,displayName')
          .get()) as { value: { id: string; displayName: string }[] };
        seen.push(...(kids.value ?? []));
      } catch {
        /* a folder we cannot enumerate is not fatal */
      }
    }

    for (const f of seen) this.folderIds.set(f.displayName.toLowerCase(), f.id);

    const hit = this.folderIds.get(key.toLowerCase());
    if (!hit) {
      throw new Error(
        `Mail folder "${folder}" was not found in this mailbox. ` +
          `Available: ${seen.map((f) => f.displayName).slice(0, 20).join(', ')}`,
      );
    }
    return hit;
  }

  /** Folder list for the settings picker. */
  async listFolders(): Promise<string[]> {
    const top = (await this.client
      .api('/me/mailFolders')
      .top(100)
      .select('id,displayName')
      .get()) as { value: { displayName: string }[] };
    return (top.value ?? []).map((f) => f.displayName);
  }

  async listRecentMessages(opts: { since?: Date; limit?: number; folder?: string } = {}) {
    const { since, limit = 25, folder } = opts;

    const target = folder ? await this.resolveFolder(folder) : 'inbox';
    const base = `/me/mailFolders/${target}/messages`;

    let request = this.client
      .api(base)
      .top(Math.min(limit, 100))
      .orderby('receivedDateTime desc')
      .select(
        'id,conversationId,internetMessageId,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,from,toRecipients,body,internetMessageHeaders',
      );

    if (since) request = request.filter(`receivedDateTime ge ${since.toISOString()}`);

    const res = (await request.get()) as { value: GraphMessage[] };
    const messages: FetchedMessage[] = [];

    for (const m of res.value ?? []) {
      const headers: Record<string, string> = {};
      for (const h of m.internetMessageHeaders ?? []) {
        headers[h.name.toLowerCase()] = h.value;
      }

      messages.push({
        externalId: m.id,
        threadId: m.conversationId || m.id,
        fromName: m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? 'Unknown sender',
        fromEmail: (m.from?.emailAddress?.address ?? '').toLowerCase(),
        toEmail: m.toRecipients?.[0]?.emailAddress?.address ?? '',
        subject: m.subject || '(no subject)',
        snippet: m.bodyPreview ?? '',
        body: this.plainBody(m),
        receivedAt: new Date(m.receivedDateTime),
        unread: !m.isRead,
        attachments: m.hasAttachments ? await this.attachments(m.id) : [],
        headers,
      });
    }
    return messages;
  }

  async sendReply(input: SendReplyInput) {
    // createReply keeps the conversation intact, then PATCH the body and send.
    const draft = (await this.client
      .api(`/me/messages/${input.inReplyTo}/createReply`)
      .post({})) as { id: string };

    await this.client.api(`/me/messages/${draft.id}`).patch({
      body: { contentType: 'Text', content: input.body },
    });
    await this.client.api(`/me/messages/${draft.id}/send`).post({});

    // The draft id stops resolving once the message moves to Sent Items, so it
    // is only useful as a correlation id. Recorded as such rather than as
    // something later code can fetch.
    return { externalId: `graph-draft:${draft.id}` };
  }

  async downloadAttachment(messageExternalId: string, attachmentId: string): Promise<Buffer> {
    const res = (await this.client
      .api(`/me/messages/${messageExternalId}/attachments/${attachmentId}`)
      .get()) as { contentBytes?: string };
    if (!res.contentBytes) throw new Error('Attachment has no content');
    return Buffer.from(res.contentBytes, 'base64');
  }

  async markAsRead(externalId: string) {
    await this.client.api(`/me/messages/${externalId}`).patch({ isRead: true });
  }

  private plainBody(m: GraphMessage): string {
    const content = m.body?.content ?? m.bodyPreview ?? '';
    if (m.body?.contentType?.toLowerCase() === 'html') return stripHtml(content);
    return content;
  }

  private async attachments(messageId: string): Promise<FetchedMessage['attachments']> {
    try {
      const res = (await this.client
        .api(`/me/messages/${messageId}/attachments`)
        .select('id,name,contentType,size')
        .get()) as { value: { id: string; name: string; contentType: string; size: number }[] };
      return (res.value ?? []).map((a) => ({
        filename: a.name,
        mimeType: a.contentType,
        size: a.size,
        externalId: a.id,
      }));
    } catch (e) {
      logger.warn(`Graph: could not list attachments for ${messageId}`);
      return [];
    }
  }
}
