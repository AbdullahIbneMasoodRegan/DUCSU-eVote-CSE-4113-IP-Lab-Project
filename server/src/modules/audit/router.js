// M2 — Audit log router (FR-16).
// Accessible to EC and Observer roles.
import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { getLogs } from './index.js';

const router = Router();

router.get(
  '/audit',
  requireRole('ec', 'observer'),
  validate({
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).optional().default(50),
      offset: z.coerce.number().int().min(0).optional().default(0),
      action: z.string().optional(),
    }),
  }),
  async (req, res) => {
    const data = await getLogs(req.query);
    res.json({ data });
  }
);

export default router;
