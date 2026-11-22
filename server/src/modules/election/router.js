// M2 — Election Commission router (FR-03, FR-04, FR-06).
// Routes for election configuration, position management, voter list import/search, and nomination review.

import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { query, withTransaction, toCamel, rowsToCamel } from '../../core/db.js';
import { badRequest, notFound } from '../../core/errors.js';
import audit from '../audit/index.js';
import { getCurrent, assertEditable, computeStatus } from './index.js';

const router = Router();

// =====================================================================
// Public & Current Election Status
// =====================================================================

/**
 * GET /api/elections/current — public status banner data (FR-03)
 */
router.get('/elections/current', async (req, res) => {
  const current = await getCurrent();
  res.json({
    data: current
      ? {
          ...current,
          serverTime: new Date().toISOString(),
        }
      : null,
  });
});

/**
 * GET /api/admin/elections/current — EC / Observer view of current election
 */
router.get('/admin/elections/current', requireRole('ec', 'observer'), async (req, res) => {
  const current = await getCurrent();
  res.json({
    data: current
      ? {
          ...current,
          serverTime: new Date().toISOString(),
        }
      : null,
  });
});

/**
 * POST /api/admin/elections — Create or update election (FR-03)
 */
router.post(
  '/admin/elections',
  requireRole('ec'),
  validate({
    body: z.object({
      id: z.number().int().optional(),
      title: z.string().min(1, 'Title is required'),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime(),
      disputePeriodEndsAt: z.string().datetime().optional(),
    }),
  }),
  async (req, res) => {
    const { id, title, startsAt, endsAt, disputePeriodEndsAt } = req.body;

    if (new Date(endsAt) <= new Date(startsAt)) {
      throw badRequest('INVALID_DATES', 'Election end time must be after start time.');
    }

    const defaultDisputeEnd = disputePeriodEndsAt || new Date(new Date(endsAt).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const existing = await getCurrent();
    if (existing && (!id || existing.id === id)) {
      await assertEditable(existing);

      const { rows } = await query(
        `UPDATE elections
         SET title = $1, starts_at = $2, ends_at = $3, dispute_period_ends_at = $4
         WHERE id = $5
         RETURNING *`,
        [title, startsAt, endsAt, defaultDisputeEnd, existing.id]
      );

      await audit.record(req, 'UPDATE_ELECTION', `election:${existing.id}`);
      const updated = toCamel(rows[0]);
      updated.status = computeStatus(updated);
      return res.json({ data: updated });
    }

    const { rows } = await query(
      `INSERT INTO elections (title, starts_at, ends_at, dispute_period_ends_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [title, startsAt, endsAt, defaultDisputeEnd]
    );

    const created = toCamel(rows[0]);
    created.status = computeStatus(created);
    await audit.record(req, 'CREATE_ELECTION', `election:${created.id}`);
    res.status(201).json({ data: created });
  }
);

// =====================================================================
// Positions Management (FR-03)
// =====================================================================

/**
 * GET /api/admin/positions — List positions for current election
 */
router.get('/admin/positions', requireRole('ec', 'observer'), async (req, res) => {
  const current = await getCurrent();
  if (!current) {
    return res.json({ data: [] });
  }

  const { rows } = await query(
    `SELECT p.*,
            (SELECT count(*) FROM candidates c WHERE c.position_id = p.id AND c.status = 'approved')::int AS approved_candidates_count,
            (SELECT count(*) FROM candidates c WHERE c.position_id = p.id AND c.status = 'pending')::int AS pending_candidates_count
     FROM positions p
     WHERE p.election_id = $1
     ORDER BY p.display_order ASC`,
    [current.id]
  );

  res.json({ data: rowsToCamel(rows) });
});

/**
 * POST /api/admin/positions — Create new position
 */
router.post(
  '/admin/positions',
  requireRole('ec'),
  validate({
    body: z.object({
      nameEn: z.string().min(1),
      nameBn: z.string().min(1),
      displayOrder: z.number().int().min(1),
      maxSelections: z.number().int().min(1).default(1),
    }),
  }),
  async (req, res) => {
    const current = await getCurrent();
    if (!current) throw notFound('NO_ELECTION', 'No election has been created yet.');
    await assertEditable(current);

    const { nameEn, nameBn, displayOrder, maxSelections } = req.body;

    const { rows } = await query(
      `INSERT INTO positions (election_id, name_en, name_bn, display_order, max_selections)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [current.id, nameEn, nameBn, displayOrder, maxSelections]
    );

    await audit.record(req, 'CREATE_POSITION', `position:${rows[0].id}`);
    res.status(201).json({ data: toCamel(rows[0]) });
  }
);

/**
 * PUT /api/admin/positions/:id — Update position
 */
router.put(
  '/admin/positions/:id',
  requireRole('ec'),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({
      nameEn: z.string().min(1),
      nameBn: z.string().min(1),
      displayOrder: z.number().int().min(1),
      maxSelections: z.number().int().min(1),
    }),
  }),
  async (req, res) => {
    const current = await getCurrent();
    await assertEditable(current);

    const { id } = req.params;
    const { nameEn, nameBn, displayOrder, maxSelections } = req.body;

    const { rows } = await query(
      `UPDATE positions
       SET name_en = $1, name_bn = $2, display_order = $3, max_selections = $4
       WHERE id = $5
       RETURNING *`,
      [nameEn, nameBn, displayOrder, maxSelections, id]
    );

    if (rows.length === 0) throw notFound('POSITION_NOT_FOUND', 'Position not found.');

    await audit.record(req, 'UPDATE_POSITION', `position:${id}`);
    res.json({ data: toCamel(rows[0]) });
  }
);

/**
 * DELETE /api/admin/positions/:id — Delete position
 */
router.delete(
  '/admin/positions/:id',
  requireRole('ec'),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
  }),
  async (req, res) => {
    const current = await getCurrent();
    await assertEditable(current);

    const { id } = req.params;
    const { rows } = await query('DELETE FROM positions WHERE id = $1 RETURNING id', [id]);
    if (rows.length === 0) throw notFound('POSITION_NOT_FOUND', 'Position not found.');

    await audit.record(req, 'DELETE_POSITION', `position:${id}`);
    res.json({ data: { success: true } });
  }
);

// =====================================================================
// Voter Management & CSV Import (FR-04)
// =====================================================================

/**
 * GET /api/admin/voters — List and search voters
 */
router.get(
  '/admin/voters',
  requireRole('ec', 'observer'),
  validate({
    query: z.object({
      search: z.string().optional(),
      hall: z.string().optional(),
      department: z.string().optional(),
      eligible: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
      hasVoted: z
        .enum(['true', 'false'])
        .transform((v) => v === 'true')
        .optional(),
      limit: z.coerce.number().int().min(1).max(200).optional().default(50),
      offset: z.coerce.number().int().min(0).optional().default(0),
    }),
  }),
  async (req, res) => {
    const { search, hall, department, eligible, hasVoted, limit, offset } = req.query;

    let sql = 'SELECT id, reg_no, name, email, hall, department, eligible, has_voted, otp_cooldown_until FROM voters';
    const where = [];
    const params = [];

    if (search) {
      params.push(`%${search.trim()}%`);
      where.push(`(reg_no ILIKE $${params.length} OR name ILIKE $${params.length} OR email ILIKE $${params.length})`);
    }

    if (hall) {
      params.push(hall);
      where.push(`hall = $${params.length}`);
    }

    if (department) {
      params.push(department);
      where.push(`department = $${params.length}`);
    }

    if (eligible !== undefined) {
      params.push(eligible);
      where.push(`eligible = $${params.length}`);
    }

    if (hasVoted !== undefined) {
      params.push(hasVoted);
      where.push(`has_voted = $${params.length}`);
    }

    const whereClause = where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '';

    // Count
    const { rows: countRows } = await query(`SELECT count(*)::int AS count FROM voters${whereClause}`, params);
    const total = countRows[0]?.count ?? 0;

    // Results
    const paginationParams = [...params];
    paginationParams.push(limit);
    const limitIdx = paginationParams.length;
    paginationParams.push(offset);
    const offsetIdx = paginationParams.length;

    const { rows } = await query(
      `${sql}${whereClause} ORDER BY id ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      paginationParams
    );

    res.json({
      data: {
        voters: rowsToCamel(rows),
        total,
        limit,
        offset,
      },
    });
  }
);

/**
 * Helper to parse CSV text into voter objects
 */
function parseCsvVoters(csvText) {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length <= 1) return [];

  // Determine headers
  const headerLine = lines[0].toLowerCase();
  const delimiter = headerLine.includes('\t') ? '\t' : ',';
  const headers = headerLine.split(delimiter).map((h) => h.replace(/^["']|["']$/g, '').trim());

  const regIdx = headers.findIndex((h) => h === 'reg_no' || h === 'regno' || h === 'registration_number' || h === 'reg no');
  const nameIdx = headers.findIndex((h) => h === 'name' || h === 'student_name');
  const emailIdx = headers.findIndex((h) => h === 'email' || h === 'email_address');
  const hallIdx = headers.findIndex((h) => h === 'hall' || h === 'residential_hall');
  const deptIdx = headers.findIndex((h) => h === 'department' || h === 'dept');

  const parsed = [];
  for (let i = 1; i < lines.length; i++) {
    const rawCols = lines[i].split(delimiter).map((c) => c.replace(/^["']|["']$/g, '').trim());
    if (rawCols.length < 3) continue;

    parsed.push({
      rowNumber: i + 1,
      regNo: rawCols[regIdx !== -1 ? regIdx : 0] ?? '',
      name: rawCols[nameIdx !== -1 ? nameIdx : 1] ?? '',
      email: rawCols[emailIdx !== -1 ? emailIdx : 2] ?? '',
      hall: rawCols[hallIdx !== -1 ? hallIdx : 3] ?? '',
      department: rawCols[deptIdx !== -1 ? deptIdx : 4] ?? '',
    });
  }

  return parsed;
}

/**
 * POST /api/admin/voters/import — CSV upload & row-by-row validation report (FR-04)
 */
router.post(
  '/admin/voters/import',
  requireRole('ec'),
  validate({
    body: z.object({
      csv: z.string().optional(),
      voters: z
        .array(
          z.object({
            regNo: z.string().min(1),
            name: z.string().min(1),
            email: z.string().email(),
            hall: z.string().min(1),
            department: z.string().min(1),
          })
        )
        .optional(),
    }),
  }),
  async (req, res) => {
    const current = await getCurrent();
    await assertEditable(current);

    let rawVoters = [];
    if (req.body.csv) {
      rawVoters = parseCsvVoters(req.body.csv);
    } else if (req.body.voters) {
      rawVoters = req.body.voters.map((v, i) => ({ ...v, rowNumber: i + 1 }));
    } else {
      throw badRequest('MISSING_INPUT', 'Either "csv" string or "voters" array must be provided.');
    }

    if (rawVoters.length === 0) {
      throw badRequest('EMPTY_LIST', 'No voter records found in input.');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const seenRegNos = new Set();
    const validRows = [];
    const errors = [];

    // Check duplicate in input & valid email
    for (const row of rawVoters) {
      const reg = row.regNo?.trim();
      const em = row.email?.trim().toLowerCase();

      if (!reg) {
        errors.push({ row: row.rowNumber, regNo: reg, reason: 'Missing registration number' });
        continue;
      }
      if (!row.name?.trim()) {
        errors.push({ row: row.rowNumber, regNo: reg, reason: 'Missing voter name' });
        continue;
      }
      if (!em || !emailRegex.test(em)) {
        errors.push({ row: row.rowNumber, regNo: reg, reason: `Invalid email address: ${em}` });
        continue;
      }
      if (seenRegNos.has(reg)) {
        errors.push({ row: row.rowNumber, regNo: reg, reason: `Duplicate registration number in import file: ${reg}` });
        continue;
      }
      seenRegNos.add(reg);

      validRows.push({
        rowNumber: row.rowNumber,
        regNo: reg,
        name: row.name.trim(),
        email: em,
        hall: row.hall?.trim() || 'General',
        department: row.department?.trim() || 'General',
      });
    }

    // Insert valid rows inside transaction
    let importedCount = 0;
    await withTransaction(async (client) => {
      for (const v of validRows) {
        const { rowCount } = await client.query(
          `INSERT INTO voters (reg_no, name, email, hall, department, eligible, has_voted)
           VALUES ($1, $2, $3, $4, $5, true, false)
           ON CONFLICT (reg_no) DO UPDATE
              SET name = EXCLUDED.name,
                  email = EXCLUDED.email,
                  hall = EXCLUDED.hall,
                  department = EXCLUDED.department`,
          [v.regNo, v.name, v.email, v.hall, v.department]
        );
        if (rowCount > 0) importedCount++;
      }
    });

    await audit.record(req, 'IMPORT_VOTERS', `imported:${importedCount},errors:${errors.length}`);

    res.json({
      data: {
        totalProcessed: rawVoters.length,
        importedCount,
        errorCount: errors.length,
        errors,
      },
    });
  }
);

/**
 * PATCH /api/admin/voters/:id/eligibility — Toggle eligible/ineligible (FR-04)
 */
router.patch(
  '/admin/voters/:id/eligibility',
  requireRole('ec'),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({ eligible: z.boolean() }),
  }),
  async (req, res) => {
    const current = await getCurrent();
    await assertEditable(current);

    const { id } = req.params;
    const { eligible } = req.body;

    const { rows } = await query(
      `UPDATE voters
       SET eligible = $1
       WHERE id = $2
       RETURNING id, reg_no, name, email, hall, department, eligible, has_voted`,
      [eligible, id]
    );

    if (rows.length === 0) throw notFound('VOTER_NOT_FOUND', 'Voter not found.');

    await audit.record(req, 'UPDATE_VOTER_ELIGIBILITY', `voter:${id}:${eligible ? 'eligible' : 'ineligible'}`);
    res.json({ data: toCamel(rows[0]) });
  }
);

// =====================================================================
// Nomination Review (FR-06)
// =====================================================================

/**
 * GET /api/admin/nominations — List candidate nominations for review
 */
router.get(
  '/admin/nominations',
  requireRole('ec', 'observer'),
  validate({
    query: z.object({
      status: z.enum(['all', 'pending', 'approved', 'rejected']).optional().default('all'),
      positionId: z.coerce.number().int().optional(),
    }),
  }),
  async (req, res) => {
    const { status: filterStatus, positionId } = req.query;

    let sql = `
      SELECT c.id, c.voter_id, c.position_id, c.panel_id, c.photo_file_id,
             c.bio, c.manifesto, c.status, c.rejection_reason, c.created_at,
             v.name AS candidate_name, v.reg_no AS candidate_reg_no, v.email AS candidate_email,
             v.hall AS candidate_hall, v.department AS candidate_department,
             p.name_en AS position_name_en, p.name_bn AS position_name_bn, p.display_order,
             pan.name AS panel_name, pan.slogan AS panel_slogan
      FROM candidates c
      JOIN voters v ON c.voter_id = v.id
      JOIN positions p ON c.position_id = p.id
      LEFT JOIN panels pan ON c.panel_id = pan.id
    `;

    const where = [];
    const params = [];

    if (filterStatus && filterStatus !== 'all') {
      params.push(filterStatus);
      where.push(`c.status = $${params.length}`);
    }

    if (positionId) {
      params.push(positionId);
      where.push(`c.position_id = $${params.length}`);
    }

    if (where.length > 0) {
      sql += ` WHERE ${where.join(' AND ')}`;
    }

    sql += ' ORDER BY p.display_order ASC, c.created_at ASC';

    const { rows } = await query(sql, params);
    res.json({ data: rowsToCamel(rows) });
  }
);

/**
 * PATCH /api/admin/nominations/:id — Approve or reject nomination (FR-06)
 */
router.patch(
  '/admin/nominations/:id',
  requireRole('ec'),
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    body: z.object({
      status: z.enum(['approved', 'rejected']),
      rejectionReason: z.string().optional(),
    }),
  }),
  async (req, res) => {
    const current = await getCurrent();
    await assertEditable(current);

    const { id } = req.params;
    const { status: newStatus, rejectionReason } = req.body;

    if (newStatus === 'rejected' && (!rejectionReason || !rejectionReason.trim())) {
      throw badRequest('REJECTION_REASON_REQUIRED', 'A reason is required when rejecting a nomination.');
    }

    const { rows } = await query(
      `UPDATE candidates
       SET status = $1, rejection_reason = $2
       WHERE id = $3
       RETURNING *`,
      [newStatus, newStatus === 'rejected' ? rejectionReason.trim() : null, id]
    );

    if (rows.length === 0) throw notFound('NOMINATION_NOT_FOUND', 'Candidate nomination not found.');

    await audit.record(req, `NOMINATION_${newStatus.toUpperCase()}`, `candidate:${id}`);
    res.json({ data: toCamel(rows[0]) });
  }
);

export default router;
