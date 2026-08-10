import { google, type gmail_v1 } from 'googleapis';
import type { FetchedMessage, MailProvider, SendReplyInput } from './provider.types';
import { logger } from '../utils/logger';

/**
 * Decodes RFC 2047 encoded-words in an incoming header.
 *
 * Gmail returns headers exactly as they arrived, so any subject or display name
 * that is not plain ASCII shows up as `=?UTF-8?B?...?=`. That string was being
 * stored verbatim, shown in the inbox, and fed to the model as the subject.
 */
export function decodeMimeWords(value: string): string {
  if (!value.includes('=?')) return value;
  return value
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)(\s+)(?==\?)/g, '$1')
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (whole, charset: string, encoding: string, text: string) => {
      try {
        const enc = encoding.toUpperCase();
        const bytes =
          enc === 'B'
            ? Buffer.from(text, 'base64')
            : Buffer.from(text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
                String.fromCharCode(parseInt(hex, 16)),
              ), 'binary');
        const label = charset.split('*')[0].toLowerCase();
        const nodeCharset = label === 'utf-8' || label === 'utf8' ? 'utf8' : 'latin1';
        return bytes.toString(nodeCharset as BufferEncoding);
      } catch {
        return whole;
      }
    });
}

/** RFC 2047 encoding, so a non-ASCII subject is not mangled or dropped. */
function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, ' ').trim();
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

/** Gmail API implementation of MailProvider. */
export class GmailProvider implements MailProvider {
  readonly name = 'gmail' as const;
  private gmail: gmail_v1.Gmail;

  constructor(accessToken: string) {
    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    this.gmail = google.gmail({ version: 'v1', auth });
  }

  async listRecentMessages(opts: { since?: Date; limit?: number; folder?: string } = {}) {
    const { since, limit = 25, folder } = opts;
    const q = [
      'in:inbox',
      '-category:promotions',
      since ? `after:${Math.floor(since.getTime() / 1000)}` : '',
      folder ? `label:${folder.replace(/["\s]/g, '-')}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    // Paginate: a single list call caps out and quietly loses mail on a busy
    // mailbox that received more than one page since the last sync.
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const list = await this.gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: Math.min(100, limit - ids.length),
        pageToken,
      });
      for (const m of list.data.messages ?? []) if (m.id) ids.push(m.id);
      pageToken = list.data.nextPageToken ?? undefined;
    } while (pageToken && ids.length < limit);

    const messages: FetchedMessage[] = [];
    for (const id of ids.slice(0, limit)) {
      try {
        const full = await this.gmail.users.messages.get({ userId: 'me', id, format: 'full' });
        messages.push(this.toFetched(full.data));
      } catch (e) {
        logger.warn(`Gmail: could not read message ${id}`, e instanceof Error ? e.message : e);
      }
    }
    return messages;
  }

  async sendReply(input: SendReplyInput) {
    // In-Reply-To and References must carry the RFC 822 Message-ID header, not
    // Gmail's internal message id. Using the internal id (as this did) meant
    // every reply arrived in the recipient's client as a brand new
    // conversation, which is exactly the bug customers notice first.
    const original = await this.headersOf(input.inReplyTo);
    const messageId = original['message-id'];
    const priorRefs = original['references'];
    const references = [priorRefs, messageId].filter(Boolean).join(' ').trim();

    // The caller has already normalised this (see replySubject in ai/safety).
    const replySubject = input.subject.trim() || 'Re:';

    const headers = [
      `To: ${input.to.replace(/[\r\n]/g, '')}`,
      `Subject: ${encodeHeader(replySubject)}`,
      messageId ? `In-Reply-To: ${messageId}` : '',
      references ? `References: ${references}` : '',
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      'MIME-Version: 1.0',
    ].filter(Boolean);

    const raw = Buffer.from(
      [...headers, '', Buffer.from(input.body, 'utf8').toString('base64')].join('\r\n'),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await this.gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: input.threadId || undefined },
    });
    if (!res.data.id) throw new Error('Gmail accepted the send but returned no message id');
    return { externalId: res.data.id };
  }

  async downloadAttachment(messageExternalId: string, attachmentId: string): Promise<Buffer> {
    const res = await this.gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: messageExternalId,
      id: attachmentId,
    });
    const data = res.data.data;
    if (!data) throw new Error('Attachment has no content');
    // Gmail returns base64url, which Buffer decodes natively.
    return Buffer.from(data, 'base64url');
  }

  async markAsRead(externalId: string) {
    await this.gmail.users.messages.modify({
      userId: 'me',
      id: externalId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    });
  }

  /* --------------------------- mapping helpers --------------------------- */

  /** Reads just the headers of one message, for threading. */
  private async headersOf(id: string): Promise<Record<string, string>> {
    try {
      const res = await this.gmail.users.messages.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['Message-ID', 'References', 'Subject'],
      });
      const out: Record<string, string> = {};
      for (const h of res.data.payload?.headers ?? []) {
        if (h.name && h.value) out[h.name.toLowerCase()] = h.value;
      }
      return out;
    } catch (e) {
      // Threading is a nicety; never block a send over it.
      logger.warn(`Gmail: could not read headers of ${id} for threading`);
      return {};
    }
  }

  private toFetched(m: gmail_v1.Schema$Message): FetchedMessage {
    const headers = m.payload?.headers ?? [];
    const h = (n: string) =>
      headers.find((x) => x.name?.toLowerCase() === n.toLowerCase())?.value ?? '';

    const from = decodeMimeWords(h('From'));
    const match = /^(.*?)\s*<(.+?)>$/.exec(from);
    const fromName = (match?.[1] ?? from).replace(/^"|"$/g, '').trim();
    const fromEmail = (match?.[2] ?? from).trim().toLowerCase();

    // Passed through so the loop guard can see autoresponder markers.
    const raw: Record<string, string> = {};
    for (const name of [
      'auto-submitted',
      'precedence',
      'list-id',
      'list-unsubscribe',
      'return-path',
      'x-autoreply',
      'x-autorespond',
      'x-auto-response-suppress',
    ]) {
      const value = h(name);
      if (value) raw[name] = value;
    }

    return {
      externalId: m.id ?? '',
      threadId: m.threadId ?? '',
      fromName: fromName || fromEmail,
      fromEmail,
      toEmail: h('To'),
      subject: decodeMimeWords(h('Subject')) || '(no subject)',
      snippet: m.snippet ?? '',
      body: this.extractBody(m.payload),
      receivedAt: new Date(Number(m.internalDate ?? Date.now())),
      unread: m.labelIds?.includes('UNREAD') ?? false,
      attachments: this.extractAttachments(m.payload),
      headers: raw,
    };
  }

  /**
   * Walks the MIME tree and prefers text/plain over text/html.
   *
   * The plain-text pass runs to completion before any HTML is considered,
   * rather than depending on which part happens to come first in the tree.
   */
  private extractBody(part?: gmail_v1.Schema$MessagePart): string {
    if (!part) return '';

    const find = (node: gmail_v1.Schema$MessagePart, want: string): string => {
      const disposition = node.headers
        ?.find((x) => x.name?.toLowerCase() === 'content-disposition')
        ?.value?.toLowerCase();
      if (node.mimeType === want && node.body?.data && !disposition?.startsWith('attachment')) {
        return Buffer.from(node.body.data, 'base64').toString('utf8');
      }
      for (const child of node.parts ?? []) {
        const hit = find(child, want);
        if (hit) return hit;
      }
      return '';
    };

    const plain = find(part, 'text/plain');
    if (plain.trim()) return plain;

    const html = find(part, 'text/html');
    return html ? stripHtml(html) : '';
  }

  private extractAttachments(part?: gmail_v1.Schema$MessagePart): FetchedMessage['attachments'] {
    const out: FetchedMessage['attachments'] = [];
    const walk = (p?: gmail_v1.Schema$MessagePart) => {
      if (!p) return;
      if (p.filename && p.body?.attachmentId) {
        out.push({
          filename: p.filename,
          mimeType: p.mimeType ?? 'application/octet-stream',
          size: p.body.size ?? 0,
          externalId: p.body.attachmentId,
        });
      }
      p.parts?.forEach(walk);
    };
    walk(part);
    return out;
  }
}

/** Shared HTML-to-text reduction. Deliberately conservative. */
export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/(p|div|br|tr|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
