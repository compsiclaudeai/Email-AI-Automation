import { Types } from 'mongoose';
import { Email } from '../../models/email.model';
import { User } from '../../models/user.model';
import { providerFor } from '../../providers';
import { badRequest, forbidden, notFound } from '../../utils/http';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';

/**
 * Serving attachment bytes.
 *
 * Attachments were metadata-only before this: the sync downloaded each file
 * once to extract its text, then threw the bytes away. Nothing could preview or
 * download anything, so the UI showed a filename and a size and did nothing
 * when clicked.
 *
 * Everything here is written on the assumption that the file is hostile and the
 * requester may not be who they say they are.
 */

export interface FetchedAttachmentFile {
  buffer: Buffer;
  filename: string;
  /** The type we are willing to serve, which is not always the declared one. */
  mimeType: string;
  /** False when the type is not safe to render inline in a browser. */
  inlineSafe: boolean;
  declaredMimeType: string;
  sniffedMimeType: string | null;
}

/**
 * Types a browser may render in place. Anything outside this list is served as
 * a download, because rendering it inline on our own origin is what turns an
 * uploaded file into stored XSS.
 */
const INLINE_SAFE = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'application/pdf',
  'text/plain',
]);

/** Magic-byte signatures, so a declared type can be checked rather than trusted. */
const SIGNATURES: { mime: string; test: (b: Buffer) => boolean }[] = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: 'image/png',
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  { mime: 'image/gif', test: (b) => b.subarray(0, 6).toString('ascii').startsWith('GIF8') },
  {
    mime: 'image/webp',
    test: (b) =>
      b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  { mime: 'image/bmp', test: (b) => b.subarray(0, 2).toString('ascii') === 'BM' },
  {
    mime: 'image/tiff',
    test: (b) =>
      b.subarray(0, 4).equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) ||
      b.subarray(0, 4).equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a])),
  },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  {
    mime: 'application/zip',
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07),
  },
];

function sniff(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  for (const s of SIGNATURES) {
    try {
      if (s.test(buffer)) return s.mime;
    } catch {
      /* a short buffer is simply not a match */
    }
  }
  return null;
}

/**
 * HTML disguised as an image is the classic stored-XSS payload. Even though the
 * type is decided by the signature check below, a file whose bytes start like
 * markup is never served inline.
 */
function looksLikeMarkup(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<?xml') || head.startsWith('<svg');
}

/* ------------------------------ tiny cache ------------------------------ */

interface CacheEntry {
  file: FetchedAttachmentFile;
  bytes: number;
  expires: number;
}

/**
 * Bounded, short-lived cache keyed by user + email + index.
 *
 * A thumbnail, a lightbox open and a download are three requests for the same
 * bytes within seconds. Without this, each one is a fresh round trip to Gmail,
 * Graph or a new IMAP connection — slow, and it burns provider quota.
 *
 * Keyed by user id as well as email id so a cache hit can never cross accounts.
 */
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_BYTES = 64 * 1024 * 1024;
let cacheBytes = 0;

function cacheGet(key: string): FetchedAttachmentFile | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    cacheBytes -= hit.bytes;
    return null;
  }
  // Refresh insertion order so the least recently used entry is evicted first.
  cache.delete(key);
  cache.set(key, hit);
  return hit.file;
}

function cacheSet(key: string, file: FetchedAttachmentFile): void {
  const bytes = file.buffer.length;
  if (bytes > CACHE_MAX_BYTES / 4) return; // one huge file must not evict everything

  cache.set(key, { file, bytes, expires: Date.now() + CACHE_TTL_MS });
  cacheBytes += bytes;

  while (cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next();
    if (oldest.done) break;
    const entry = cache.get(oldest.value);
    cache.delete(oldest.value);
    cacheBytes -= entry?.bytes ?? 0;
  }
}

/** Drops every cached attachment for one account, on disconnect. */
export function clearAttachmentCache(userId: string): void {
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${userId}:`)) {
      cacheBytes -= cache.get(key)?.bytes ?? 0;
      cache.delete(key);
    }
  }
}

/* ------------------------------ the fetch ------------------------------- */

/**
 * Returns the bytes of one attachment.
 *
 * Addressed by its index in the stored array rather than by the provider's own
 * id. The index is validated against the record the caller is proven to own, so
 * there is no id a caller can supply that reaches another account's file.
 */
export async function getAttachment(
  userId: string,
  emailId: string,
  index: number,
): Promise<FetchedAttachmentFile> {
  if (!Types.ObjectId.isValid(emailId)) throw badRequest('That is not a valid email id');
  if (!Number.isInteger(index) || index < 0 || index > 200) {
    throw badRequest('That is not a valid attachment');
  }

  const uid = new Types.ObjectId(userId);

  // Ownership is enforced by the query itself: an email belonging to someone
  // else simply does not exist as far as this caller is concerned.
  const email = await Email.findOne({ _id: new Types.ObjectId(emailId), userId: uid })
    .select('externalId attachments')
    .lean();
  if (!email) throw notFound('Email not found');

  const meta = email.attachments?.[index];
  if (!meta) throw notFound('Attachment not found');
  if (!meta.externalId) {
    throw badRequest('This attachment was not stored with a reference the provider can resolve');
  }
  if (meta.size > env.attachments.maxBytes) {
    throw forbidden(
      `That file is ${Math.round(meta.size / 1024 / 1024)} MB, over the ${Math.round(
        env.attachments.maxBytes / 1024 / 1024,
      )} MB limit`,
    );
  }

  const key = `${userId}:${emailId}:${index}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const user = await User.findById(uid).select('_id').lean();
  if (!user) throw notFound('User not found');

  const provider = await providerFor(userId);
  let buffer: Buffer;
  try {
    buffer = await provider.downloadAttachment(email.externalId, meta.externalId);
  } catch (e) {
    logger.warn(
      `Attachment fetch failed for email ${emailId} index ${index}: ${
        e instanceof Error ? e.message : 'unknown'
      }`,
    );
    throw notFound('The mail server would not return that attachment. It may have been deleted.');
  }

  if (!buffer?.length) throw notFound('That attachment is empty');
  // The provider reported a size before; the real payload is checked again
  // because that number is metadata and metadata can be wrong.
  if (buffer.length > env.attachments.maxBytes) {
    throw forbidden('That file is larger than the configured limit');
  }

  const declared = (meta.mimeType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const sniffed = sniff(buffer);

  // The type served is the one the bytes actually are. A file declaring
  // image/png while containing markup is served as a download, never inline.
  let mimeType = sniffed ?? declared;
  let inlineSafe = INLINE_SAFE.has(mimeType);

  if (sniffed && sniffed !== declared && INLINE_SAFE.has(declared)) {
    logger.warn(
      `Attachment ${index} on ${emailId} declares ${declared} but its bytes are ${sniffed}`,
    );
  }
  if (looksLikeMarkup(buffer)) {
    mimeType = 'application/octet-stream';
    inlineSafe = false;
  }
  if (!sniffed && declared === 'text/plain') {
    // No signature exists for plain text; allow it, but only as text.
    mimeType = 'text/plain';
    inlineSafe = true;
  }

  const file: FetchedAttachmentFile = {
    buffer,
    filename: safeFilename(meta.filename),
    mimeType,
    inlineSafe,
    declaredMimeType: declared,
    sniffedMimeType: sniffed,
  };

  cacheSet(key, file);
  return file;
}

/**
 * A filename safe to put in a Content-Disposition header.
 *
 * Strips path separators (so nothing can be interpreted as a traversal),
 * quotes and control characters including CR/LF, which would otherwise let a
 * filename inject a response header.
 */
export function safeFilename(name: string): string {
  const cleaned = (name || 'attachment')
    .replace(/[\\/]/g, '_')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F"]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
  return cleaned || 'attachment';
}

/** RFC 5987 encoding, so a non-ASCII filename survives the download. */
export function contentDisposition(filename: string, download: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
