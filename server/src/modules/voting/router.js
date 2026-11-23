// M4 — Voting engine (FR-08..FR-12, FR-19).
//
//   Voter / candidate (candidates are voters)
//     GET  /api/ballot                 positions + approved candidates (only while open, not yet voted)
//     POST /api/vote                   multipart: `choices` (JSON) + `photo` (JPEG) -> { receiptCode }
//   Public (after voting closes)
//     GET  /api/receipts?q=            every receipt code, sorted alphabetically
//     GET  /api/receipts/:code         does this receipt exist?
//   Election Commission only
//     GET  /api/admin/photos/:voterId  a voter's verification photo (dispute viewer, audited)
//
// SECRECY: the request logger never logs /api/vote or /api/receipts bodies or
// parameters; nothing here is audited per vote (the audit log is for
// administrative actions only), except the EC viewing a photo.
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { notFound } from '../../core/errors.js';
import { audit } from '../audit/index.js';
import { parseVoteForm, reencodePhoto } from './photo.js';
import { RECEIPT_PATTERN } from './receipt.js';
import {
  castVote,
  getBallot,
  getVoterPhoto,
  listReceipts,
  receiptExists,
} from './service.js';

const router = Router();

const id = z.coerce.number().int().positive();
const noStore = (res) => res.set('Cache-Control', 'no-store');

// ------------------------------------------------------------------ ballot

router.get('/ballot', requireRole('voter'), async (req, res) => {
  const data = await getBallot(req.user.id);
  noStore(res).json({ data });
});

// ------------------------------------------------------------------ vote

const choicesField = z
  .string({ required_error: 'choices is required' })
  .max(60_000)
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'choices must be valid JSON' });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(
        z.object({
          positionId: z.number().int().positive(),
          candidateIds: z.array(z.number().int().positive()).max(50),
        }),
      )
      .max(200),
  );

router.post(
  '/vote',
  requireRole('voter'),
  parseVoteForm,
  validate({ body: z.object({ choices: choicesField }) }),
  async (req, res) => {
    const photo = await reencodePhoto(req.file?.buffer);
    const receiptCode = await castVote({
      voterId: req.user.id,
      choices: req.body.choices,
      photo,
    });
    noStore(res).status(201).json({ data: { receiptCode } });
  },
);

// ------------------------------------------------------------------ receipts (public)

router.get(
  '/receipts',
  validate({ query: z.object({ q: z.string().trim().max(20).optional() }) }),
  async (req, res) => {
    const codes = await listReceipts({ q: req.query.q });
    noStore(res).json({ data: { count: codes.length, codes } });
  },
);

router.get(
  '/receipts/:code',
  validate({ params: z.object({ code: z.string().trim().toUpperCase().regex(RECEIPT_PATTERN) }) }),
  async (req, res) => {
    const found = await receiptExists(req.params.code);
    noStore(res).json({ data: { found } });
  },
);

// ------------------------------------------------------------------ dispute photo viewer (EC only)

router.get(
  '/admin/photos/:voterId',
  requireRole('ec'),
  validate({ params: z.object({ voterId: id }) }),
  async (req, res) => {
    const photo = await getVoterPhoto(req.params.voterId);
    if (!photo) throw notFound('PHOTO_NOT_FOUND', 'No photo is stored for this voter.');
    // Every view is audited (secrecy rule 9), including the voter it concerned.
    await audit.record(req, 'PHOTO_VIEWED', String(req.params.voterId));
    res
      .set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      .type(photo.mime)
      .send(photo.data);
  },
);

export default router;
