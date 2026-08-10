import { ImapFlow } from 'imapflow';
import nodemailer, { type Transporter } from 'nodemailer';

/** The slice of imapflow's ENVELOPE we use. */
interface MessageEnvelope {
  date?: Date;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string;
  from?: { name?: string; address?: string }[];
  to?: { name?: string; address?: string }[];
}

/** The slice of imapflow's BODYSTRUCTURE we walk. */
interface BodyNode {
  part?: string;
  type?: string;
  size?: number;
  disposition?: string;
  parameters?: { name?: string; charset?: string };
  dispositionParameters?: { filename?: string };
  childNodes?: BodyNode[];
}
import type { FetchedMessage, MailProvider, SendReplyInput } from './provider.types';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/** Headers the loop guard needs. Fetched as a set so the payload stays small. */
const LOOP_HEADERS = [
  'auto-submitted',
  'precedence',
  'list-id',
  'list-unsubscribe',
  'return-path',
  'x-autoreply',
  'x-autorespond',
  'x-auto-response-suppress',
  'references',
];

export interface ImapCredentials {
  host: string;
  port: number;
  secure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  user: string;
  password: string;
  /** Mailbox to read. Defaults to INBOX. */
  folder?: string;
  /** Mailbox to file sent replies into. Empty string skips the append. */
  sentFolder?: string;
  fromName?: string;
}

/**
 * IMAP + SMTP implementation of MailProvider, for mailboxes that are not on
 * Gmail or Microsoft 365 — cPanel, SiteGround, Zoho, self-hosted and so on.
 *
 * externalId is `${uidValidity}.${uid}`. UIDs are only unique within a folder
 * and are reset whenever uidValidity changes, so pinning both keeps stored
 * emails from pointing at the wrong message after a server-side rebuild.
 */
export class ImapProvider implements MailProvider {
  readonly name = 'imap' as const;

  constructor(private creds: ImapCredentials) {}

  /* --------------------------- connections ---------------------------- */

  private client(): ImapFlow {
    return new ImapFlow({
      host: this.creds.host,
      port: this.creds.port,
      secure: this.creds.secure,
      auth: { user: this.creds.user, pass: this.creds.password },
      logger: false,
      // Certificate checking is ON by default. Shared hosts sometimes serve a
      // certificate for the server hostname rather than the mail domain, so it
      // can be turned off with IMAP_TLS_REJECT_UNAUTHORIZED=false — but not
      // silently, because this connection carries a mailbox password.
      tls: { rejectUnauthorized: env.imap.rejectUnauthorized },
    });
  }

  private transport(): Transporter {
    return nodemailer.createTransport({
      host: this.creds.smtpHost,
      port: this.creds.smtpPort,
      secure: this.creds.smtpSecure,
      auth: { user: this.creds.user, pass: this.creds.password },
      tls: { rejectUnauthorized: env.imap.rejectUnauthorized },
    });
  }

  /** Opens the mailbox, hands the client to fn, then always logs out. */
  private async withMailbox<T>(
    folder: string,
    fn: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const client = this.client();
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      return await fn(client);
    } finally {
      lock.release();
      await client.logout().catch(() => undefined);
    }
  }

  /* ----------------------------- reading ------------------------------ */

  async listRecentMessages(
    opts: { since?: Date; limit?: number; folder?: string } = {},
  ): Promise<FetchedMessage[]> {
    const { since, limit = 25 } = opts;
    const folder = opts.folder || this.creds.folder || 'INBOX';

    return this.withMailbox(folder, async (client) => {
      const uidValidity = String(
        client.mailbox && typeof client.mailbox === 'object'
          ? (client.mailbox as { uidValidity?: bigint | number }).uidValidity ?? 0
          : 0,
      );

      // IMAP SINCE has day granularity, so results are trimmed by exact
      // timestamp below rather than trusted as-is.
      const uids = await client.search(since ? { since } : { all: true }, { uid: true });
      if (!uids || uids.length === 0) return [];

      const recent = uids.slice(-limit);

      // Structure and envelope only. Downloading full sources here would pull
      // every PDF and image down the wire, which is slow enough on large mail
      // to time the connection out — and those are exactly the messages that
      // matter most.
      const heads: {
        uid: number;
        flags: Set<string>;
        envelope: MessageEnvelope;
        structure: BodyNode | undefined;
        headers: Record<string, string>;
      }[] = [];

      for await (const msg of client.fetch(
        recent,
        {
          uid: true,
          flags: true,
          envelope: true,
          bodyStructure: true,
          headers: LOOP_HEADERS,
        },
        { uid: true },
      )) {
        heads.push({
          uid: msg.uid,
          flags: msg.flags ?? new Set<string>(),
          envelope: (msg.envelope ?? {}) as MessageEnvelope,
          structure: msg.bodyStructure as BodyNode | undefined,
          headers: parseHeaders(msg.headers as Buffer | undefined),
        });
      }

      const messages: FetchedMessage[] = [];

      for (const head of heads) {
        const receivedAt = head.envelope.date ?? new Date();
        if (since && receivedAt < since) continue;

        const from = head.envelope.from?.[0];
        const to = head.envelope.to?.[0];

        // Body failures must never drop the message — an email that shows up
        // with an empty body is recoverable, one that silently vanishes is not.
        let body = '';
        try {
          body = await this.textBody(client, head.uid, head.structure);
        } catch {
          body = '';
        }

        messages.push({
          externalId: `${uidValidity}.${head.uid}`,
          threadId: this.threadIdFrom(head.envelope, head.headers),
          fromName: from?.name || from?.address || 'Unknown sender',
          fromEmail: (from?.address ?? '').toLowerCase(),
          toEmail: to?.address ?? this.creds.user,
          subject: head.envelope.subject || '(no subject)',
          snippet: body.slice(0, 240),
          body,
          receivedAt,
          unread: !head.flags.has('\\Seen'),
          attachments: this.attachmentsOf(head.structure),
          headers: head.headers,
        });
      }

      return messages.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    });
  }

  /**
   * Downloads just the text part. download() handles base64 and
   * quoted-printable decoding, so only readable text crosses the wire.
   */
  private async textBody(
    client: ImapFlow,
    uid: number,
    structure: BodyNode | undefined,
  ): Promise<string> {
    const part = this.findTextPart(structure);
    const { content } = await client.download(String(uid), part.id, { uid: true });
    if (!content) return '';

    const chunks: Buffer[] = [];
    for await (const chunk of content) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8');

    return part.html ? this.stripHtml(raw) : raw.trim();
  }

  /** Prefers text/plain, falls back to text/html, then to the whole body. */
  private findTextPart(node: BodyNode | undefined): { id: string; html: boolean } {
    if (!node) return { id: '1', html: false };

    const walk = (n: BodyNode, want: string): BodyNode | null => {
      const type = (n.type ?? '').toLowerCase();
      const disposition = (n.disposition ?? '').toLowerCase();
      if (type === want && disposition !== 'attachment') return n;
      for (const child of n.childNodes ?? []) {
        const hit = walk(child, want);
        if (hit) return hit;
      }
      return null;
    };

    const plain = walk(node, 'text/plain');
    if (plain) return { id: plain.part || '1', html: false };

    const html = walk(node, 'text/html');
    if (html) return { id: html.part || '1', html: true };

    // Single-part message: the whole body is the text.
    return { id: node.part || '1', html: (node.type ?? '').toLowerCase() === 'text/html' };
  }

  /** Attachment metadata straight from the structure — no bytes downloaded. */
  private attachmentsOf(node: BodyNode | undefined): FetchedMessage['attachments'] {
    if (!node) return [];
    const out: FetchedMessage['attachments'] = [];

    const walk = (n: BodyNode) => {
      const disposition = (n.disposition ?? '').toLowerCase();
      const filename =
        n.dispositionParameters?.filename ?? n.parameters?.name ?? undefined;

      // Inline images are signature logos far more often than real content,
      // so only count them when they carry a filename of their own.
      const isAttachment = disposition === 'attachment' || (Boolean(filename) && !n.childNodes);

      if (isAttachment && filename) {
        out.push({
          filename,
          mimeType: n.type ?? 'application/octet-stream',
          size: n.size ?? 0,
          externalId: n.part,
        });
      }
      for (const child of n.childNodes ?? []) walk(child);
    };

    walk(node);
    return out;
  }

  /* ----------------------------- sending ------------------------------ */

  async sendReply(input: SendReplyInput): Promise<{ externalId: string }> {
    const folder = this.creds.folder || 'INBOX';
    const uid = this.uidOf(input.inReplyTo);

    // Pull the original headers so the reply threads correctly in the
    // recipient's client instead of arriving as a fresh conversation.
    let messageId: string | undefined;
    let references: string[] = [];

    if (uid) {
      try {
        await this.withMailbox(folder, async (client) => {
          const original = await client.fetchOne(
            String(uid),
            { envelope: true, headers: ['references'] },
            { uid: true },
          );
          if (original && original.envelope) {
            messageId = original.envelope.messageId;
            const prior = parseHeaders(original.headers as Buffer | undefined)['references'];
            // The chain must accumulate, not be replaced, or long threads split.
            references = [...(prior ? prior.trim().split(/\s+/) : []), ...(messageId ? [messageId] : [])];
          }
        });
      } catch {
        /* threading headers are a nicety — never block the send over them */
      }
    }

    // Normalised by the caller (see replySubject in ai/safety).
    const subject = input.subject.trim() || 'Re:';

    const info = await this.transport().sendMail({
      from: this.creds.fromName
        ? { name: this.creds.fromName, address: this.creds.user }
        : this.creds.user,
      to: input.to,
      subject,
      text: input.body,
      inReplyTo: messageId,
      references: references.length ? references : undefined,
    });

    await this.appendToSent(info.message as unknown as Buffer | undefined, {
      to: input.to,
      subject,
      body: input.body,
      messageId: info.messageId,
      inReplyTo: messageId,
    });

    return { externalId: info.messageId ?? `smtp-${Date.now()}` };
  }

  /** attachmentId is the IMAP body part number, e.g. "2" or "1.2". */
  async downloadAttachment(messageExternalId: string, attachmentId: string): Promise<Buffer> {
    const uid = this.uidOf(messageExternalId);
    if (!uid) throw new Error('Unrecognised message id');
    const folder = this.creds.folder || 'INBOX';

    return this.withMailbox(folder, async (client) => {
      const { content } = await client.download(String(uid), attachmentId, { uid: true });
      if (!content) throw new Error('Attachment part not found');
      const chunks: Buffer[] = [];
      for await (const chunk of content) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    });
  }

  async markAsRead(externalId: string): Promise<void> {
    const uid = this.uidOf(externalId);
    if (!uid) return;
    const folder = this.creds.folder || 'INBOX';
    await this.withMailbox(folder, async (client) => {
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
    });
  }

  /* --------------------------- diagnostics ---------------------------- */

  /** Verifies both legs of the connection. Used by the connect route. */
  async verify(): Promise<{ folders: string[] }> {
    const client = this.client();
    await client.connect();
    let folders: string[] = [];
    try {
      const list = await client.list();
      folders = list.map((f) => f.path);
    } finally {
      await client.logout().catch(() => undefined);
    }
    await this.transport().verify();
    return { folders };
  }

  /* ----------------------------- helpers ------------------------------ */

  private uidOf(externalId: string): number | null {
    const uid = Number(externalId.includes('.') ? externalId.split('.').pop() : externalId);
    return Number.isFinite(uid) && uid > 0 ? uid : null;
  }

  /**
   * Roots the thread at the first entry of References, which is the original
   * message of the conversation. Falling back to In-Reply-To alone (as this
   * did) put each reply in a thread of its own once a conversation went past
   * two messages, because In-Reply-To points at the *previous* message.
   */
  private threadIdFrom(envelope: MessageEnvelope, headers: Record<string, string> = {}): string {
    const references = (headers['references'] ?? envelope.references ?? '').trim();
    if (references) {
      const first = references.split(/\s+/)[0];
      if (first) return first;
    }
    if (envelope.inReplyTo) return envelope.inReplyTo.trim().split(/\s+/)[0];
    if (envelope.messageId) return envelope.messageId;
    return `thread-${(envelope.subject ?? 'unknown').slice(0, 120)}`;
  }

  /**
   * Copies the outgoing reply into the Sent folder so it shows up in Outlook
   * and webmail. Servers name this folder differently, hence the candidates.
   */
  private async appendToSent(
    _raw: Buffer | undefined,
    mail: { to: string; subject: string; body: string; messageId?: string; inReplyTo?: string },
  ): Promise<void> {
    const configured = this.creds.sentFolder;
    if (configured === '') return;

    const candidates = configured
      ? [configured]
      : ['INBOX.Sent', 'Sent', 'Sent Items', 'INBOX.Sent Items'];

    const raw = [
      `From: ${this.creds.user}`,
      `To: ${mail.to}`,
      `Subject: ${mail.subject}`,
      `Date: ${new Date().toUTCString()}`,
      mail.messageId ? `Message-ID: ${mail.messageId}` : '',
      mail.inReplyTo ? `In-Reply-To: ${mail.inReplyTo}` : '',
      'Content-Type: text/plain; charset=utf-8',
      '',
      mail.body,
    ]
      .filter(Boolean)
      .join('\r\n');

    const client = this.client();
    try {
      await client.connect();
      for (const path of candidates) {
        try {
          await client.append(path, Buffer.from(raw, 'utf8'), ['\\Seen']);
          break;
        } catch {
          /* try the next naming convention */
        }
      }
    } catch {
      /* the message is already delivered; filing it is best-effort */
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\/(p|div|br|tr|li|h[1-6])>/gi, '\n')
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
}

/** Parses a raw header block into a lower-cased map. */
function parseHeaders(raw: Buffer | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  const text = raw.toString('utf8').replace(/\r\n[ \t]+/g, ' ');
  for (const line of text.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key && value) out[key] = value;
  }
  return out;
}
