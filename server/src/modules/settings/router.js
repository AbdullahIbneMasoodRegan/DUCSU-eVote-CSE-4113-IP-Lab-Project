// M1 — /api/admin/settings (NFR-09). EC changes OTP, session, rate-limit and
// reminder values without a code change. Observers may read them.
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { status as electionStatus } from '../election/index.js';
import settings from './index.js';

const router = Router();

router.get('/admin/settings', requireRole('ec', 'observer'), async (req, res) => {
  const status = await electionStatus();
  res.json({ data: { settings: await settings.getAll(), locked: status === 'open' } });
});

router.put(
  '/admin/settings',
  requireRole('ec'),
  validate({
    body: z.object({
      values: z
        .record(z.string().max(64), z.number().int().nullable())
        .refine((v) => Object.keys(v).length > 0, 'Send at least one setting'),
    }),
  }),
  async (req, res) => {
    const updated = await settings.set(req, req.body.values);
    res.json({ data: { settings: updated, locked: false } });
  },
);

export default router;
