// M1 — /api/admin/notifications (FR-17): campaign progress and template previews for the EC.
import { Router } from 'express';
import { z } from 'zod';
import config from '../../core/config.js';
import { requireRole } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { badRequest } from '../../core/errors.js';
import { status } from './campaigns.js';
import { render, SAMPLE_DATA } from './templates.js';

const router = Router();

router.get('/admin/notifications', requireRole('ec', 'observer'), async (req, res) => {
  const data = await status();
  if (!data) throw badRequest('NO_ELECTION', 'There is no election yet.');
  res.json({ data });
});

router.get(
  '/admin/notifications/preview',
  requireRole('ec'),
  validate({
    query: z.object({
      template: z.enum(['otp', 'votingOpen', 'reminder', 'resultsPublished']),
      lang: z.enum(['en', 'bn', 'both']).default('both'),
    }),
  }),
  async (req, res) => {
    const { template, lang } = req.query;
    const data = { ...SAMPLE_DATA[template], url: config.appUrl };
    res.json({ data: { template, lang, ...render(template, data, lang) } });
  },
);

export default router;
