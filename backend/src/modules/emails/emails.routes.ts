import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.middleware';
import { asyncHandler, badRequest } from '../../utils/http';
import * as emails from './emails.service';
import { contentDisposition, getAttachment } from './attachments.service';

export const emailsRouter = Router();
emailsRouter.use(requireAuth);

const listQuery = z.object({
  status: z.enum(['all', 'unread', 'pending', 'replied', 'failed', 'ignored']).optional(),
  category: z
    .enum(['invoice', 'support', 'hr', 'sales', 'marketing', 'spam', 'other'])
    .optional(),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

emailsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) throw badRequest('Invalid query', parsed.error.flatten());
    res.json(await emails.list(req.userId!, parsed.data));
  }),
);

emailsRouter.get(
  '/counts',
  asyncHandler(async (req, res) => {
    res.json(await emails.counts(req.userId!));
  }),
);

/**
 * Rewrites drafts left behind by an AI outage. Declared with the other literal
 * routes so it is never parsed as an email id.
 */
emailsRouter.post(
  '/regenerate-stubs',
  asyncHandler(async (req, res) => {
    res.json(await emails.regenerateStubDrafts(req.userId!));
  }),
);

emailsRouter.post(
  '/retry-failed',
  asyncHandler(async (req, res) => {
    res.json(await emails.retryFailed(req.userId!));
  }),
);

// Declared after the literal routes so "/counts" is never read as an id.
emailsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await emails.getOne(req.userId!, req.params.id));
  }),
);

emailsRouter.post(
  '/:id/open',
  asyncHandler(async (req, res) => {
    res.json(await emails.markOpened(req.userId!, req.params.id));
  }),
);

const draftBody = z.object({ body: z.string().min(1, 'Draft cannot be empty').max(20_000) });

emailsRouter.patch(
  '/:id/draft',
  asyncHandler(async (req, res) => {
    const parsed = draftBody.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid draft', parsed.error.flatten());
    res.json(await emails.saveDraft(req.userId!, req.params.id, parsed.data.body));
  }),
);

emailsRouter.post(
  '/:id/regenerate',
  asyncHandler(async (req, res) => {
    res.json(await emails.regenerate(req.userId!, req.params.id));
  }),
);

const approveBody = z.object({ body: z.string().min(1).max(20_000).optional() });

emailsRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => {
    const parsed = approveBody.safeParse(req.body ?? {});
    if (!parsed.success) throw badRequest('Invalid reply body', parsed.error.flatten());
    res.json(
      // Always 'user' here: this route is only ever reached by someone
      // clicking approve. The automation calls the service directly.
      await emails.approveAndSend(req.userId!, req.params.id, {
        overrideBody: parsed.data.body,
        actor: 'user',
      }),
    );
  }),
);

/**
 * Attachment bytes.
 *
 * Addressed by index into the stored array, never by a provider id supplied by
 * the caller. Ownership is enforced inside the service by the query itself.
 *
 * `?download=1` forces a save dialog; without it the file is served inline
 * when — and only when — its actual bytes are a type a browser can safely
 * render. Everything else is downgraded to a download.
 */
emailsRouter.get(
  '/:id/attachments/:index',
  asyncHandler(async (req, res) => {
    const index = Number(req.params.index);
    const file = await getAttachment(req.userId!, req.params.id, index);

    const wantsDownload = req.query.download === '1' || req.query.download === 'true';
    const inline = file.inlineSafe && !wantsDownload;

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(file.buffer.length));
    res.setHeader('Content-Disposition', contentDisposition(file.filename, !inline));
    // Never let a browser second-guess the type we decided on.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Neutralises anything active inside the file even if it is rendered.
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    // Private: this is one user's mail, and it must never land in a shared cache.
    res.setHeader('Cache-Control', 'private, max-age=300, no-transform');

    res.end(file.buffer);
  }),
);

emailsRouter.post(
  '/:id/reject',
  asyncHandler(async (req, res) => {
    res.json(await emails.reject(req.userId!, req.params.id));
  }),
);
