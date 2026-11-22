// M2 — Results router (FR-14).
// POST /api/results/calculate (EC only)
// POST /api/results/publish (EC only)
// GET /api/results (Public if published, or EC/Observer)

import { Router } from 'express';
import { z } from 'zod';
import { requireRole, optionalAuth } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { query, toCamel } from '../../core/db.js';
import { forbidden, notFound } from '../../core/errors.js';
import { calculateResults, getResultsData } from './index.js';
import { getCurrent } from '../election/index.js';
import audit from '../audit/index.js';

const router = Router();

/**
 * POST /api/results/calculate — Calculate vote tallies, winners and ties (FR-14)
 */
router.post(
  '/results/calculate',
  requireRole('ec'),
  validate({
    body: z
      .object({
        electionId: z.number().int().optional(),
      })
      .optional()
      .default({}),
  }),
  async (req, res) => {
    const result = await calculateResults(req, req.body?.electionId);
    res.json({ data: result });
  }
);

/**
 * POST /api/results/publish — Publish calculated results to public view (FR-14)
 */
router.post(
  '/results/publish',
  requireRole('ec'),
  validate({
    body: z
      .object({
        electionId: z.number().int().optional(),
      })
      .optional()
      .default({}),
  }),
  async (req, res) => {
    const electionId = req.body?.electionId;
    const current = electionId
      ? toCamel((await query('SELECT * FROM elections WHERE id = $1', [electionId])).rows[0])
      : await getCurrent();

    if (!current) throw notFound('NO_ELECTION', 'No election found to publish results.');

    const publishedAt = new Date().toISOString();
    await query('UPDATE elections SET results_published_at = $1 WHERE id = $2', [publishedAt, current.id]);

    await audit.record(req, 'PUBLISH_RESULTS', `election:${current.id}`);

    res.json({
      data: {
        electionId: current.id,
        published: true,
        resultsPublishedAt: publishedAt,
      },
    });
  }
);

/**
 * GET /api/results — Retrieve election results (FR-14)
 * Public when published; accessible to EC/Observer at any time.
 */
router.get(
  '/results',
  optionalAuth, // sets req.user for logged-in EC/Observer; anonymous users still allowed
  validate({
    query: z.object({
      electionId: z.coerce.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const electionId = req.query?.electionId;
    const data = await getResultsData(electionId);

    if (!data) {
      return res.json({ data: null });
    }

    // Role check: if not published, only EC or Observer can view
    const isStaff = req.user?.role === 'ec' || req.user?.role === 'observer';
    if (!data.election.resultsPublishedAt && !isStaff) {
      throw forbidden('RESULTS_NOT_PUBLISHED', 'Election results have not been published yet.');
    }

    res.json({ data });
  }
);

export default router;
