// M3 — Candidates, nominations and panels (FR-05, FR-06 read side, FR-07).
//
//   Voter / candidate (own nomination)
//     GET    /api/nominations/me           POST   /api/nominations
//     PATCH  /api/nominations/me           DELETE /api/nominations/me
//     PUT    /api/nominations/me/photo
//   Public (approved candidates only)
//     GET    /api/candidates               GET /api/candidates/:id
//     GET    /api/candidates/:id/photo
//   Panels
//     GET    /api/panels                   GET /api/panels/:id        GET /api/panels/:id/logo
//     POST   /api/panels                   PATCH/DELETE /api/panels/:id   PUT /api/panels/:id/logo
//     POST   /api/panels/:id/join          DELETE /api/panels/membership/me
//     DELETE /api/panels/:id/members/:candidateId
//
// Every mutating route calls election.assertEditable() (FR-04): nothing changes after voting opens.
// Voter actions are not audited (the audit log is for administrative actions only, secrecy rule 8).
import { Router } from 'express';
import { z } from 'zod';
import { requireRole, optionalAuth } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { query, withTransaction, toCamel, rowsToCamel } from '../../core/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { assertEditable } from '../election/index.js';
import { rawImage, reencodeImage } from './images.js';
import {
  BIO_MAX,
  MANIFESTO_MAX,
  assertEligibleVoter,
  assertNominationEditable,
  assertPanelHasRoom,
  candidateView,
  findCandidateById,
  findCandidateByVoter,
  findPanel,
  listApproved,
  logoUrl,
  positionView,
  reopenIfRejected,
  requireElection,
} from './service.js';

const router = Router();

const id = z.coerce.number().int().positive();
const text = (max) => z.string().trim().min(1).max(max);
const optionalText = (max) => z.string().trim().max(max);

/** Postgres unique-violation helper. */
const isUnique = (err) => err?.code === '23505';

// ------------------------------------------------------------------ nominations

/** My nomination (or null), the election status, and whether I can still change things. */
router.get('/nominations/me', requireRole('voter'), async (req, res) => {
  const election = await requireElection();
  const mine = await findCandidateByVoter(req.user.id);
  let ownedPanel = null;
  const { rows } = await query(
    'SELECT id, name FROM panels WHERE created_by = $1 AND election_id = $2',
    [req.user.id, election.id],
  );
  if (rows[0]) ownedPanel = toCamel(rows[0]);
  res.json({
    data: {
      electionStatus: election.status,
      editable: election.status === 'nomination' || election.status === 'draft',
      nomination: mine ? candidateView(mine, { full: true, private: true }) : null,
      ownedPanel,
    },
  });
});

const nominationBody = z.object({
  positionId: id,
  panelId: id.nullable().optional(),
  bio: text(BIO_MAX),
  manifesto: text(MANIFESTO_MAX),
});

router.post(
  '/nominations',
  requireRole('voter'),
  validate({ body: nominationBody }),
  async (req, res) => {
    const election = await requireElection();
    await assertEditable(election);
    await assertEligibleVoter(req.user.id);
    const { positionId, panelId = null, bio, manifesto } = req.body;

    const created = await withTransaction(async (client) => {
      const { rows: pos } = await client.query(
        'SELECT id FROM positions WHERE id = $1 AND election_id = $2',
        [positionId, election.id],
      );
      if (!pos[0]) throw notFound('POSITION_NOT_FOUND', 'Position not found.');
      if (panelId) {
        await findPanel(panelId, election.id, client);
        await assertPanelHasRoom(panelId, positionId, null, client);
      }
      try {
        const { rows } = await client.query(
          `INSERT INTO candidates (voter_id, position_id, panel_id, bio, manifesto)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [req.user.id, positionId, panelId, bio, manifesto],
        );
        return rows[0].id;
      } catch (err) {
        if (isUnique(err)) {
          throw conflict('ALREADY_NOMINATED', 'You have already submitted a nomination.');
        }
        throw err;
      }
    });

    const row = await findCandidateById(created);
    res.status(201).json({ data: candidateView(row, { full: true, private: true }) });
  },
);

router.patch(
  '/nominations/me',
  requireRole('voter'),
  validate({
    body: z
      .object({
        positionId: id,
        panelId: id.nullable(),
        bio: text(BIO_MAX),
        manifesto: text(MANIFESTO_MAX),
      })
      .partial()
      .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to change.' }),
  }),
  async (req, res) => {
    const election = await requireElection();
    await assertEditable(election);

    await withTransaction(async (client) => {
      const mine = await findCandidateByVoter(req.user.id, client);
      if (!mine) throw notFound('NOT_NOMINATED', 'You have not submitted a nomination.');
      assertNominationEditable(mine);

      const next = {
        positionId: req.body.positionId ?? mine.positionId,
        panelId: 'panelId' in req.body ? req.body.panelId : mine.panelId,
        bio: req.body.bio ?? mine.bio,
        manifesto: req.body.manifesto ?? mine.manifesto,
      };
      if (req.body.positionId) {
        const { rows } = await client.query(
          'SELECT id FROM positions WHERE id = $1 AND election_id = $2',
          [next.positionId, election.id],
        );
        if (!rows[0]) throw notFound('POSITION_NOT_FOUND', 'Position not found.');
      }
      if (next.panelId) {
        await findPanel(next.panelId, election.id, client);
        await assertPanelHasRoom(next.panelId, next.positionId, mine.id, client);
      }
      // A panel creator cannot drop out of their own panel by editing; they must disband it.
      if (mine.panelId && next.panelId !== mine.panelId) {
        const { rows } = await client.query(
          'SELECT 1 FROM panels WHERE id = $1 AND created_by = $2',
          [mine.panelId, req.user.id],
        );
        if (rows[0]) {
          throw conflict(
            'CREATOR_CANNOT_LEAVE',
            'You created this panel. Disband it before leaving or switching.',
          );
        }
      }
      await client.query(
        `UPDATE candidates SET position_id = $2, panel_id = $3, bio = $4, manifesto = $5
         WHERE id = $1`,
        [mine.id, next.positionId, next.panelId, next.bio, next.manifesto],
      );
      await reopenIfRejected(mine, client);
    });

    const row = await findCandidateByVoter(req.user.id);
    res.json({ data: candidateView(row, { full: true, private: true }) });
  },
);

router.delete('/nominations/me', requireRole('voter'), async (req, res) => {
  const election = await requireElection();
  await assertEditable(election);
  await withTransaction(async (client) => {
    const mine = await findCandidateByVoter(req.user.id, client);
    if (!mine) throw notFound('NOT_NOMINATED', 'You have not submitted a nomination.');
    assertNominationEditable(mine);
    const { rows } = await client.query(
      'SELECT 1 FROM panels WHERE id = $1 AND created_by = $2',
      [mine.panelId, req.user.id],
    );
    if (rows[0]) {
      throw conflict(
        'CREATOR_CANNOT_LEAVE',
        'You created this panel. Disband it before withdrawing your nomination.',
      );
    }
    await client.query('DELETE FROM candidates WHERE id = $1', [mine.id]);
    if (mine.photoFileId) await client.query('DELETE FROM files WHERE id = $1', [mine.photoFileId]);
  });
  res.json({ data: { withdrawn: true } });
});

router.put('/nominations/me/photo', requireRole('voter'), rawImage, async (req, res) => {
  const election = await requireElection();
  await assertEditable(election);
  const image = await reencodeImage(req.body, { maxSide: 800 });

  await withTransaction(async (client) => {
    const mine = await findCandidateByVoter(req.user.id, client);
    if (!mine) throw notFound('NOT_NOMINATED', 'Submit your nomination before adding a photo.');
    assertNominationEditable(mine);
    const { rows } = await client.query(
      'INSERT INTO files (mime, data) VALUES ($1, $2) RETURNING id',
      [image.mime, image.data],
    );
    await client.query('UPDATE candidates SET photo_file_id = $2 WHERE id = $1', [
      mine.id,
      rows[0].id,
    ]);
    if (mine.photoFileId) await client.query('DELETE FROM files WHERE id = $1', [mine.photoFileId]);
    await reopenIfRejected(mine, client);
  });
  const row = await findCandidateByVoter(req.user.id);
  res.json({ data: candidateView(row, { full: true, private: true }) });
});

// ------------------------------------------------------------------ public candidates

router.get(
  '/candidates',
  validate({ query: z.object({ positionId: id.optional(), panelId: id.optional() }) }),
  async (req, res) => {
    const election = await requireElection();
    const { rows: positions } = await query(
      `SELECT id, name_en, name_bn, display_order, max_selections
       FROM positions WHERE election_id = $1 ORDER BY display_order`,
      [election.id],
    );
    let approved = await listApproved(election.id, { positionId: req.query.positionId });
    if (req.query.panelId) approved = approved.filter((c) => c.panelId === req.query.panelId);

    const byPosition = new Map();
    for (const c of approved) {
      if (!byPosition.has(c.positionId)) byPosition.set(c.positionId, []);
      byPosition.get(c.positionId).push(candidateView(c));
    }
    const data = rowsToCamel(positions)
      .filter((p) => !req.query.positionId || p.id === req.query.positionId)
      .map((p) => ({ position: positionView(p), candidates: byPosition.get(p.id) ?? [] }));
    res.json({ data });
  },
);

/** May this viewer see a candidate who is not approved yet? Owner and EC/Observer only. */
function canSeeUnapproved(user, candidate) {
  if (!user) return false;
  if (user.role === 'ec' || user.role === 'observer') return true;
  return user.type === 'voter' && user.id === candidate.voterId;
}

router.get(
  '/candidates/:id',
  optionalAuth,
  validate({ params: z.object({ id }) }),
  async (req, res) => {
    const c = await findCandidateById(req.params.id);
    const visible = c && (c.status === 'approved' || canSeeUnapproved(req.user, c));
    if (!visible) throw notFound('CANDIDATE_NOT_FOUND', 'Candidate not found.');
    res.json({ data: candidateView(c, { full: true, private: canSeeUnapproved(req.user, c) }) });
  },
);

async function sendFile(res, fileId, cacheable) {
  const { rows } = await query('SELECT mime, data FROM files WHERE id = $1', [fileId]);
  if (!rows[0]) throw notFound('FILE_NOT_FOUND', 'Image not found.');
  res.set('Content-Type', rows[0].mime);
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Cache-Control', cacheable ? 'public, max-age=300' : 'private, no-store');
  res.send(rows[0].data);
}

router.get(
  '/candidates/:id/photo',
  optionalAuth,
  validate({ params: z.object({ id }) }),
  async (req, res) => {
    const c = await findCandidateById(req.params.id);
    const approved = c?.status === 'approved';
    if (!c || !c.photoFileId || !(approved || canSeeUnapproved(req.user, c))) {
      throw notFound('FILE_NOT_FOUND', 'Image not found.');
    }
    await sendFile(res, c.photoFileId, approved);
  },
);

// ------------------------------------------------------------------ panels

const PANEL_SELECT = `
  SELECT pan.id, pan.name, pan.slogan, pan.manifesto, pan.logo_file_id, pan.created_by,
         (SELECT count(*)::int FROM candidates c WHERE c.panel_id = pan.id AND c.status = 'approved')
           AS approved_members,
         (SELECT count(*)::int FROM candidates c WHERE c.panel_id = pan.id) AS total_members
  FROM panels pan`;

function panelView(row, { owner = false } = {}) {
  const out = {
    id: row.id,
    name: row.name,
    slogan: row.slogan,
    manifesto: row.manifesto,
    logoUrl: logoUrl({ id: row.id, logoFileId: row.logoFileId }),
    memberCount: row.approvedMembers,
  };
  if (owner) {
    out.totalMembers = row.totalMembers;
    out.isCreator = true;
  }
  return out;
}

router.get('/panels', async (req, res) => {
  const election = await requireElection();
  const { rows } = await query(`${PANEL_SELECT} WHERE pan.election_id = $1 ORDER BY pan.name`, [
    election.id,
  ]);
  res.json({ data: rowsToCamel(rows).map((r) => panelView(r)) });
});

router.get(
  '/panels/:id',
  optionalAuth,
  validate({ params: z.object({ id }) }),
  async (req, res) => {
    const election = await requireElection();
    const { rows } = await query(`${PANEL_SELECT} WHERE pan.id = $1 AND pan.election_id = $2`, [
      req.params.id,
      election.id,
    ]);
    if (!rows[0]) throw notFound('PANEL_NOT_FOUND', 'Panel not found.');
    const panel = toCamel(rows[0]);
    const owner = req.user?.type === 'voter' && req.user.id === panel.createdBy;
    const staff = req.user?.role === 'ec' || req.user?.role === 'observer';
    const seeAll = owner || staff;

    // The public sees approved members; the creator and the EC also see pending/rejected ones.
    const members = await query(
      `SELECT c.id, c.status, c.photo_file_id, c.bio, v.name, v.hall, v.department,
              p.id AS position_id, p.name_en AS position_name_en, p.name_bn AS position_name_bn,
              p.display_order, p.max_selections
       FROM candidates c
       JOIN voters v ON v.id = c.voter_id
       JOIN positions p ON p.id = c.position_id
       WHERE c.panel_id = $1 ${seeAll ? '' : "AND c.status = 'approved'"}
       ORDER BY p.display_order, v.name`,
      [panel.id],
    );
    res.json({
      data: {
        ...panelView(panel, { owner }),
        members: rowsToCamel(members.rows).map((m) => ({
          id: m.id,
          name: m.name,
          hall: m.hall,
          department: m.department,
          photoUrl: m.photoFileId ? `/api/candidates/${m.id}/photo` : null,
          position: positionView(m),
          ...(seeAll ? { status: m.status } : {}),
        })),
      },
    });
  },
);

router.get(
  '/panels/:id/logo',
  validate({ params: z.object({ id }) }),
  async (req, res) => {
    const { rows } = await query('SELECT logo_file_id FROM panels WHERE id = $1', [req.params.id]);
    if (!rows[0]?.logo_file_id) throw notFound('FILE_NOT_FOUND', 'Image not found.');
    await sendFile(res, rows[0].logo_file_id, true);
  },
);

const panelBody = z.object({
  name: text(80),
  slogan: optionalText(160).optional(),
  manifesto: optionalText(MANIFESTO_MAX).optional(),
});

/** Creating a panel needs a nomination: the creator becomes the panel's first member. */
router.post(
  '/panels',
  requireRole('voter'),
  validate({ body: panelBody }),
  async (req, res) => {
    const election = await requireElection();
    await assertEditable(election);
    const { name, slogan = null, manifesto = null } = req.body;

    const panelId = await withTransaction(async (client) => {
      const mine = await findCandidateByVoter(req.user.id, client);
      if (!mine) {
        throw conflict('NOMINATION_REQUIRED', 'Submit your own nomination before creating a panel.');
      }
      assertNominationEditable(mine);
      const { rows: owned } = await client.query(
        'SELECT 1 FROM panels WHERE created_by = $1 AND election_id = $2',
        [req.user.id, election.id],
      );
      if (owned[0]) throw conflict('ALREADY_PANEL_CREATOR', 'You have already created a panel.');
      if (mine.panelId) {
        throw conflict('ALREADY_IN_PANEL', 'Leave your current panel before creating a new one.');
      }
      let created;
      try {
        ({ rows: created } = await client.query(
          `INSERT INTO panels (election_id, name, slogan, manifesto, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [election.id, name, slogan || null, manifesto || null, req.user.id],
        ));
      } catch (err) {
        if (isUnique(err)) throw conflict('PANEL_NAME_TAKEN', 'A panel with this name already exists.');
        throw err;
      }
      await client.query('UPDATE candidates SET panel_id = $2 WHERE id = $1', [
        mine.id,
        created[0].id,
      ]);
      await reopenIfRejected(mine, client);
      return created[0].id;
    });

    const { rows } = await query(`${PANEL_SELECT} WHERE pan.id = $1`, [panelId]);
    res.status(201).json({ data: panelView(toCamel(rows[0]), { owner: true }) });
  },
);

/** Load a panel and make sure the caller created it. */
async function requireCreator(req, client = null) {
  const election = await requireElection(client);
  const panel = await findPanel(req.params.id, election.id, client);
  if (panel.createdBy !== req.user.id) {
    throw forbidden('NOT_PANEL_CREATOR', 'Only the panel creator can do this.');
  }
  return panel;
}

router.patch(
  '/panels/:id',
  requireRole('voter'),
  validate({
    params: z.object({ id }),
    body: panelBody.partial().refine((b) => Object.keys(b).length > 0, {
      message: 'Nothing to change.',
    }),
  }),
  async (req, res) => {
    const panel = await requireCreator(req);
    await assertEditable();
    const next = {
      name: req.body.name ?? panel.name,
      slogan: 'slogan' in req.body ? req.body.slogan || null : panel.slogan,
      manifesto: 'manifesto' in req.body ? req.body.manifesto || null : panel.manifesto,
    };
    try {
      await query('UPDATE panels SET name = $2, slogan = $3, manifesto = $4 WHERE id = $1', [
        panel.id,
        next.name,
        next.slogan,
        next.manifesto,
      ]);
    } catch (err) {
      if (isUnique(err)) throw conflict('PANEL_NAME_TAKEN', 'A panel with this name already exists.');
      throw err;
    }
    const { rows } = await query(`${PANEL_SELECT} WHERE pan.id = $1`, [panel.id]);
    res.json({ data: panelView(toCamel(rows[0]), { owner: true }) });
  },
);

router.put(
  '/panels/:id/logo',
  requireRole('voter'),
  validate({ params: z.object({ id }) }),
  rawImage,
  async (req, res) => {
    const panel = await requireCreator(req);
    await assertEditable();
    const image = await reencodeImage(req.body, { maxSide: 512 });
    await withTransaction(async (client) => {
      const { rows } = await client.query(
        'INSERT INTO files (mime, data) VALUES ($1, $2) RETURNING id',
        [image.mime, image.data],
      );
      await client.query('UPDATE panels SET logo_file_id = $2 WHERE id = $1', [panel.id, rows[0].id]);
      if (panel.logoFileId) await client.query('DELETE FROM files WHERE id = $1', [panel.logoFileId]);
    });
    const { rows } = await query(`${PANEL_SELECT} WHERE pan.id = $1`, [panel.id]);
    res.json({ data: panelView(toCamel(rows[0]), { owner: true }) });
  },
);

/** Disband: members become independents (panel_id is set to NULL by the foreign key). */
router.delete(
  '/panels/:id',
  requireRole('voter'),
  validate({ params: z.object({ id }) }),
  async (req, res) => {
    const panel = await requireCreator(req);
    await assertEditable();
    await withTransaction(async (client) => {
      await client.query('DELETE FROM panels WHERE id = $1', [panel.id]);
      if (panel.logoFileId) await client.query('DELETE FROM files WHERE id = $1', [panel.logoFileId]);
    });
    res.json({ data: { disbanded: true } });
  },
);

router.post(
  '/panels/:id/join',
  requireRole('voter'),
  validate({ params: z.object({ id }) }),
  async (req, res) => {
    const election = await requireElection();
    await assertEditable(election);
    await withTransaction(async (client) => {
      const mine = await findCandidateByVoter(req.user.id, client);
      if (!mine) throw conflict('NOMINATION_REQUIRED', 'Submit your nomination before joining a panel.');
      assertNominationEditable(mine);
      const panel = await findPanel(req.params.id, election.id, client);
      if (mine.panelId === panel.id) throw conflict('ALREADY_IN_PANEL', 'You are already in this panel.');
      if (mine.panelId) {
        const { rows } = await client.query(
          'SELECT 1 FROM panels WHERE id = $1 AND created_by = $2',
          [mine.panelId, req.user.id],
        );
        if (rows[0]) {
          throw conflict(
            'CREATOR_CANNOT_LEAVE',
            'You created your panel. Disband it before joining another.',
          );
        }
      }
      await assertPanelHasRoom(panel.id, mine.positionId, mine.id, client);
      await client.query('UPDATE candidates SET panel_id = $2 WHERE id = $1', [mine.id, panel.id]);
      await reopenIfRejected(mine, client);
    });
    const row = await findCandidateByVoter(req.user.id);
    res.json({ data: candidateView(row, { full: true, private: true }) });
  },
);

/** Stand as an independent: leave my current panel. */
router.delete('/panels/membership/me', requireRole('voter'), async (req, res) => {
  const election = await requireElection();
  await assertEditable(election);
  await withTransaction(async (client) => {
    const mine = await findCandidateByVoter(req.user.id, client);
    if (!mine) throw notFound('NOT_NOMINATED', 'You have not submitted a nomination.');
    assertNominationEditable(mine);
    if (!mine.panelId) throw badRequest('NOT_IN_PANEL', 'You are already standing as an independent.');
    const { rows } = await client.query('SELECT 1 FROM panels WHERE id = $1 AND created_by = $2', [
      mine.panelId,
      req.user.id,
    ]);
    if (rows[0]) {
      throw conflict('CREATOR_CANNOT_LEAVE', 'You created this panel. Disband it instead.');
    }
    await client.query('UPDATE candidates SET panel_id = NULL WHERE id = $1', [mine.id]);
  });
  const row = await findCandidateByVoter(req.user.id);
  res.json({ data: candidateView(row, { full: true, private: true }) });
});

/** The creator removes a member (never themselves). */
router.delete(
  '/panels/:id/members/:candidateId',
  requireRole('voter'),
  validate({ params: z.object({ id, candidateId: id }) }),
  async (req, res) => {
    const panel = await requireCreator(req);
    await assertEditable();
    const member = await findCandidateById(req.params.candidateId);
    if (!member || member.panelId !== panel.id) {
      throw notFound('MEMBER_NOT_FOUND', 'That candidate is not in your panel.');
    }
    if (member.voterId === req.user.id) {
      throw conflict('CREATOR_CANNOT_LEAVE', 'You cannot remove yourself. Disband the panel instead.');
    }
    await query('UPDATE candidates SET panel_id = NULL WHERE id = $1', [member.id]);
    res.json({ data: { removed: true } });
  },
);

export default router;
