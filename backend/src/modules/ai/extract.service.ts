import { env } from '../../config/env';
import { logger } from '../../utils/logger';

export type ExtractStatus = 'ok' | 'empty' | 'too_large' | 'unsupported' | 'failed' | 'skipped';

export interface ExtractResult {
  text: string;
  status: ExtractStatus;
  detail?: string;
}

const PDF = /^application\/pdf$/i;
const IMAGE = /^image\/(png|jpe?g|webp|bmp|tiff?)$/i;
const TEXT = /^text\/(plain|csv)$|^application\/(json|xml)$/i;

/**
 * Turns an attachment into text the model can read.
 *
 * Everything here is best-effort: a failure returns a status the caller can
 * surface, never an exception, because one unreadable invoice must not stop
 * the reply from being drafted.
 */
export async function extractText(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<ExtractResult> {
  if (buffer.length > env.attachments.maxBytes) {
    return {
      text: '',
      status: 'too_large',
      detail: `${Math.round(buffer.length / 1024 / 1024)} MB exceeds the ${Math.round(env.attachments.maxBytes / 1024 / 1024)} MB limit`,
    };
  }

  try {
    if (TEXT.test(mimeType)) {
      return finish(buffer.toString('utf8'));
    }
    if (PDF.test(mimeType) || /\.pdf$/i.test(filename)) {
      return await fromPdf(buffer);
    }
    if (IMAGE.test(mimeType)) {
      return await fromImage(buffer, filename);
    }
    return { text: '', status: 'unsupported', detail: mimeType };
  } catch (e) {
    const detail = e instanceof Error ? e.message : 'Unknown error';
    logger.warn(`Attachment extraction failed for ${filename}: ${detail}`);
    return { text: '', status: 'failed', detail };
  }
}

/* -------------------------------- PDF ---------------------------------- */

async function fromPdf(buffer: Buffer): Promise<ExtractResult> {
  // Imported lazily so a missing optional dependency degrades to a status
  // rather than crashing the sync at startup.
  const { extractText: pdfText, getDocumentProxy } = await import('unpdf');

  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await pdfText(pdf, { mergePages: true });
  const merged = (Array.isArray(text) ? text.join('\n') : text).trim();

  if (!merged) {
    // A PDF with no text layer is a scan. OCR would need the pages rastered
    // first, which is a heavier dependency than this is worth today.
    return {
      text: '',
      status: 'empty',
      detail: `${totalPages} page(s), no text layer — likely a scan`,
    };
  }
  return finish(merged);
}

/* ------------------------------- images -------------------------------- */

type OcrWorker = { recognize: (b: Buffer) => Promise<{ data: { text: string } }> };
let ocrWorker: OcrWorker | null = null;
let ocrStarting: Promise<OcrWorker> | null = null;
let ocrFailed = false;

/**
 * Boots the OCR worker exactly once.
 *
 * tesseract.js downloads its language data from a CDN on first use and reports
 * a failure through the worker's error channel, which escapes a plain await and
 * takes the process down with it. errorHandler catches it, and the timeout
 * covers a network that hangs instead of refusing outright.
 */
async function startOcr(): Promise<OcrWorker> {
  const { createWorker } = await import('tesseract.js');

  return new Promise<OcrWorker>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('OCR worker did not start within 60s')),
      60_000,
    );

    createWorker(env.attachments.ocrLang, undefined, {
      // Point this at a folder holding eng.traineddata to run fully offline.
      langPath: env.attachments.ocrPath,
      errorHandler: (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    })
      .then((w) => {
        clearTimeout(timer);
        resolve(w as unknown as OcrWorker);
      })
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

async function fromImage(buffer: Buffer, filename: string): Promise<ExtractResult> {
  if (!env.attachments.ocr) {
    return { text: '', status: 'skipped', detail: 'OCR is off (ATTACHMENT_OCR=false)' };
  }
  if (ocrFailed) {
    return { text: '', status: 'skipped', detail: 'OCR unavailable on this host' };
  }

  try {
    if (!ocrWorker) {
      if (!ocrStarting) {
        logger.info('Starting OCR worker — the first run downloads language data');
        ocrStarting = startOcr();
      }
      ocrWorker = await ocrStarting;
    }

    const { data } = await ocrWorker.recognize(buffer);
    const text = data.text.trim();
    return text
      ? finish(text)
      : { text: '', status: 'empty', detail: 'No readable text in the image' };
  } catch (e) {
    // Language data lives behind a CDN. On a blocked or offline network this
    // fails once and then stays off, rather than retrying on every message.
    ocrFailed = true;
    ocrStarting = null;
    const detail = e instanceof Error ? e.message : 'OCR failed';
    logger.warn(
      `OCR disabled for this run (${filename}): ${detail}. ` +
        'Set ATTACHMENT_OCR_PATH to a local traineddata folder to run offline.',
    );
    return { text: '', status: 'failed', detail };
  }
}

/* ------------------------------- helpers -------------------------------- */

function finish(raw: string): ExtractResult {
  const text = raw.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim();
  if (!text) return { text: '', status: 'empty' };
  const capped = text.slice(0, env.attachments.maxChars);
  return { text: capped, status: 'ok' };
}
