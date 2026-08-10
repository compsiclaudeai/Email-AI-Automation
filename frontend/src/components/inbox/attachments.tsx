'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FileType,
  ImageIcon,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import { fileSize } from '@/lib/format';
import type { Attachment } from '@/lib/types';

/**
 * The attachment experience.
 *
 * Every URL here points at the authenticated backend route, addressed by the
 * attachment's index in the message. Nothing is fetched from the mail provider
 * by the browser and no provider id is ever exposed.
 */

const IMAGE = /^image\/(jpeg|png|gif|webp|bmp|tiff?)$/i;
const PDF = /^application\/pdf$/i;

function urlFor(emailId: string, index: number, download = false) {
  return `/api/emails/${emailId}/attachments/${index}${download ? '?download=1' : ''}`;
}

function iconFor(mimeType: string) {
  if (IMAGE.test(mimeType)) return ImageIcon;
  if (PDF.test(mimeType)) return FileType;
  if (/spreadsheet|excel|csv/i.test(mimeType)) return FileSpreadsheet;
  if (/zip|compressed|tar|rar|7z/i.test(mimeType)) return FileArchive;
  return FileText;
}

function labelFor(mimeType: string, filename: string) {
  const ext = filename.includes('.') ? filename.split('.').pop()?.toUpperCase() : undefined;
  if (ext && ext.length <= 5) return ext;
  return mimeType.split('/')[1]?.slice(0, 5).toUpperCase() ?? 'FILE';
}

/* ------------------------------- the grid ------------------------------- */

export function AttachmentGrid({
  emailId,
  attachments,
}: {
  emailId: string;
  attachments: Attachment[];
}) {
  const [viewer, setViewer] = useState<number | null>(null);

  if (!attachments.length) return null;

  // Only previewable types take part in the lightbox's next/previous.
  const previewable = attachments
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => IMAGE.test(a.mimeType) || PDF.test(a.mimeType))
    .map(({ i }) => i);

  return (
    <section className="mt-3" aria-label={`${attachments.length} attachment${attachments.length === 1 ? '' : 's'}`}>
      <p className="text-[11.5px] font-medium text-ink-3 mb-2">
        {attachments.length} attachment{attachments.length === 1 ? '' : 's'}
      </p>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2.5 list-none p-0 m-0">
        {attachments.map((a, i) => (
          <li key={`${a.filename}-${i}`}>
            <AttachmentCard
              emailId={emailId}
              attachment={a}
              index={i}
              onOpen={() => setViewer(i)}
            />
          </li>
        ))}
      </ul>

      {viewer !== null && (
        <AttachmentViewer
          emailId={emailId}
          attachments={attachments}
          index={viewer}
          order={previewable.length ? previewable : [viewer]}
          onIndex={setViewer}
          onClose={() => setViewer(null)}
        />
      )}
    </section>
  );
}

/* ------------------------------- one card ------------------------------- */

function AttachmentCard({
  emailId,
  attachment,
  index,
  onOpen,
}: {
  emailId: string;
  attachment: Attachment;
  index: number;
  onOpen: () => void;
}) {
  const isImage = IMAGE.test(attachment.mimeType);
  const isPdf = PDF.test(attachment.mimeType);
  const canPreview = isImage || isPdf;
  const Icon = iconFor(attachment.mimeType);
  const [thumbFailed, setThumbFailed] = useState(false);

  const unreadable =
    attachment.extractStatus && !['ok', 'skipped'].includes(attachment.extractStatus);

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface-2 transition hover:border-line-strong hover:shadow-e2">
      <button
        type="button"
        onClick={canPreview ? onOpen : undefined}
        disabled={!canPreview}
        aria-label={
          canPreview ? `Preview ${attachment.filename}` : `${attachment.filename}, no preview available`
        }
        className="relative grid h-[104px] w-full place-items-center overflow-hidden bg-surface-3
                   disabled:cursor-default enabled:cursor-zoom-in"
      >
        {isImage && !thumbFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={urlFor(emailId, index)}
            alt={attachment.filename}
            loading="lazy"
            decoding="async"
            onError={() => setThumbFailed(true)}
            className="h-full w-full object-cover transition group-hover:scale-[1.03]"
          />
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-ink-3">
            <Icon size={26} strokeWidth={1.6} />
            <span className="text-[10.5px] font-semibold tracking-wide">
              {thumbFailed ? 'PREVIEW UNAVAILABLE' : labelFor(attachment.mimeType, attachment.filename)}
            </span>
          </span>
        )}
      </button>

      <div className="flex items-center gap-2 px-3 py-2.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-medium" title={attachment.filename}>
            {attachment.filename}
          </p>
          <p className="text-[11px] text-ink-3">
            {fileSize(attachment.size)}
            {unreadable && ' · text not readable'}
          </p>
        </div>
        <a
          href={urlFor(emailId, index, true)}
          download={attachment.filename}
          aria-label={`Download ${attachment.filename}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-ink-3 transition
                     hover:bg-surface-3 hover:text-ink"
        >
          <Download size={14} />
        </a>
      </div>
    </div>
  );
}

/* ------------------------------- the viewer ----------------------------- */

function AttachmentViewer({
  emailId,
  attachments,
  index,
  order,
  onIndex,
  onClose,
}: {
  emailId: string;
  attachments: Attachment[];
  index: number;
  order: number[];
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const attachment = attachments[index];
  const isImage = IMAGE.test(attachment.mimeType);
  const isPdf = PDF.test(attachment.mimeType);

  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  const position = order.indexOf(index);
  const go = useCallback(
    (delta: number) => {
      if (order.length < 2) return;
      const next = order[(position + delta + order.length) % order.length];
      onIndex(next);
      setZoom(1);
      setLoading(true);
      setFailed(false);
    },
    [order, position, onIndex],
  );

  useEffect(() => {
    restoreTo.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
      if (isImage && (e.key === '+' || e.key === '=')) setZoom((z) => Math.min(5, z + 0.25));
      if (isImage && e.key === '-') setZoom((z) => Math.max(0.25, z - 0.25));
      if (isImage && e.key === '0') setZoom(1);
    };

    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      restoreTo.current?.focus?.();
    };
  }, [onClose, go, isImage]);

  return (
    <div className="fixed inset-0 z-[300] flex flex-col bg-black/80 backdrop-blur-sm">
      <header className="flex items-center gap-3 px-4 py-3 text-white max-sm:px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold">{attachment.filename}</p>
          <p className="text-[11.5px] text-white/60">
            {fileSize(attachment.size)}
            {order.length > 1 && ` · ${position + 1} of ${order.length}`}
          </p>
        </div>

        {isImage && (
          <div className="flex items-center gap-1 max-sm:hidden">
            <ViewerButton label="Zoom out" onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}>
              <Minus size={16} />
            </ViewerButton>
            <span className="w-12 text-center text-[11.5px] tabular-nums text-white/70">
              {Math.round(zoom * 100)}%
            </span>
            <ViewerButton label="Zoom in" onClick={() => setZoom((z) => Math.min(5, z + 0.25))}>
              <Plus size={16} />
            </ViewerButton>
            <ViewerButton label="Reset zoom" onClick={() => setZoom(1)}>
              <RotateCcw size={15} />
            </ViewerButton>
          </div>
        )}

        <a
          href={urlFor(emailId, index)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open in a new tab"
          className="grid h-8 w-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <ExternalLink size={16} />
        </a>
        <a
          href={urlFor(emailId, index, true)}
          download={attachment.filename}
          aria-label={`Download ${attachment.filename}`}
          className="grid h-8 w-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white"
        >
          <Download size={16} />
        </a>
        <ViewerButton label="Close preview" onClick={onClose}>
          <X size={18} />
        </ViewerButton>
      </header>

      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={`Preview of ${attachment.filename}`}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4 outline-none max-sm:p-2"
      >
        {order.length > 1 && (
          <>
            <ViewerArrow side="left" onClick={() => go(-1)} />
            <ViewerArrow side="right" onClick={() => go(1)} />
          </>
        )}

        {loading && !failed && (
          <span className="absolute grid place-items-center text-white/70">
            <Loader2 size={26} className="animate-spin" />
          </span>
        )}

        {failed ? (
          <FallbackPanel emailId={emailId} index={index} filename={attachment.filename} />
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={urlFor(emailId, index)}
            alt={attachment.filename}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
            style={{ transform: `scale(${zoom})` }}
            className="max-h-full max-w-full origin-center object-contain transition-transform duration-150"
          />
        ) : isPdf ? (
          // <object> rather than <iframe>: it renders in browsers with a built-in
          // PDF viewer and falls through to its own children in the ones that do
          // not, which is exactly the fallback the spec asks for.
          <object
            data={urlFor(emailId, index)}
            type="application/pdf"
            onLoad={() => setLoading(false)}
            className="h-full w-full rounded-lg bg-white"
            aria-label={`PDF preview of ${attachment.filename}`}
          >
            <FallbackPanel emailId={emailId} index={index} filename={attachment.filename} />
          </object>
        ) : (
          <FallbackPanel emailId={emailId} index={index} filename={attachment.filename} />
        )}
      </div>

      {isImage && (
        <p className="pb-3 text-center text-[11px] text-white/50 max-sm:hidden">
          + / − to zoom · 0 to reset · ← → to move between files · Esc to close
        </p>
      )}
    </div>
  );
}

function FallbackPanel({
  emailId,
  index,
  filename,
}: {
  emailId: string;
  index: number;
  filename: string;
}) {
  return (
    <div className="max-w-[380px] rounded-2xl bg-surface p-6 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-surface-3 text-ink-3">
        <FileText size={20} />
      </span>
      <p className="mt-3 text-[14px] font-semibold">This file cannot be shown here</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-2">
        Your browser has no viewer for this type, or the mail server would not return it. You can
        still open or download the original.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <a
          className="btn btn-sm"
          href={urlFor(emailId, index)}
          target="_blank"
          rel="noopener noreferrer"
        >
          <ExternalLink size={14} /> Open in a new tab
        </a>
        <a className="btn btn-sm btn-primary" href={urlFor(emailId, index, true)} download={filename}>
          <Download size={14} /> Download
        </a>
      </div>
    </div>
  );
}

function ViewerButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-lg text-white/80 transition hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}

function ViewerArrow({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Previous attachment' : 'Next attachment'}
      className={`absolute top-1/2 z-[1] grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full
                  bg-black/40 text-white transition hover:bg-black/70 ${
                    side === 'left' ? 'left-3' : 'right-3'
                  }`}
    >
      {side === 'left' ? <ChevronLeft size={20} /> : <ChevronRight size={20} />}
    </button>
  );
}
