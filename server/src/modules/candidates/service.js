// M3 — shared queries and rules for nominations, candidates and panels
// (FR-05, FR-06, FR-07). Raw parameterised SQL only.
import { query, toCamel, rowsToCamel } from '../../core/db.js';
import { conflict, notFound, forbidden } from '../../core/errors.js';
import { getCurrent } from '../election/index.js';

export const BIO_MAX = 1000;
export const MANIFESTO_MAX = 5000;

/** The current election, or 404 if the EC has not created one yet. */
export async function requireElection(client = null) {
  const election = await getCurrent(client);
  if (!election) throw notFound('NO_ELECTION', 'No election has been set up yet.');
  return election;
}

const runner = (client) => (client ? client.query.bind(client) : query);

export const photoUrl = (row) => (row.photoFileId ? `/api/candidates/${row.id}/photo` : null);
export const logoUrl = (row) => (row.logoFileId ? `/api/panels/${row.id}/logo` : null);

/** Public shape of a position. */
export function positionView(row) {
  return {
    id: row.positionId ?? row.id,
    nameEn: row.positionNameEn ?? row.nameEn,
    nameBn: row.positionNameBn ?? row.nameBn,
    displayOrder: row.displayOrder,
    maxSelections: row.maxSelections,
  };
}

const CANDIDATE_SELECT = `
  SELECT c.id, c.voter_id, c.position_id, c.panel_id, c.photo_file_id, c.bio, c.manifesto,
         c.status, c.rejection_reason,
         v.name, v.hall, v.department,
         p.name_en AS position_name_en, p.name_bn AS position_name_bn,
         p.display_order, p.max_selections,
         pan.name AS panel_name, pan.slogan AS panel_slogan, pan.logo_file_id AS panel_logo_file_id
  FROM candidates c
  JOIN voters v ON v.id = c.voter_id
  JOIN positions p ON p.id = c.position_id
  LEFT JOIN panels pan ON pan.id = c.panel_id`;

/** Candidate row -> API object. Never includes reg_no or email. */
export function candidateView(row, { full = false, private: priv = false } = {}) {
  const out = {
    id: row.id,
    name: row.name,
    hall: row.hall,
    department: row.department,
    photoUrl: photoUrl(row),
    position: positionView(row),
    panel: row.panelId
      ? {
          id: row.panelId,
          name: row.panelName,
          slogan: row.panelSlogan,
          logoUrl: row.panelLogoFileId ? `/api/panels/${row.panelId}/logo` : null,
        }
      : null,
    bio: row.bio,
  };
  if (full) out.manifesto = row.manifesto;
  if (priv) {
    out.status = row.status;
    out.rejectionReason = row.rejectionReason;
  }
  return out;
}

export async function findCandidateById(id, client = null) {
  const { rows } = await runner(client)(`${CANDIDATE_SELECT} WHERE c.id = $1`, [id]);
  return rows[0] ? toCamel(rows[0]) : null;
}

export async function findCandidateByVoter(voterId, client = null) {
  const { rows } = await runner(client)(`${CANDIDATE_SELECT} WHERE c.voter_id = $1`, [voterId]);
  return rows[0] ? toCamel(rows[0]) : null;
}

/** Approved candidates of one election, in position display order. */
export async function listApproved(electionId, { positionId } = {}) {
  const params = [electionId];
  let extra = '';
  if (positionId) {
    params.push(positionId);
    extra = ` AND c.position_id = $${params.length}`;
  }
  const { rows } = await query(
    `${CANDIDATE_SELECT}
     WHERE p.election_id = $1 AND c.status = 'approved'${extra}
     ORDER BY p.display_order, v.name, c.id`,
    params,
  );
  return rowsToCamel(rows);
}

/** The voter must be allowed to stand: eligible voters only. */
export async function assertEligibleVoter(voterId, client = null) {
  const { rows } = await runner(client)('SELECT eligible FROM voters WHERE id = $1', [voterId]);
  if (!rows[0]) throw notFound('VOTER_NOT_FOUND', 'Voter not found.');
  if (!rows[0].eligible) {
    throw forbidden('NOT_ELIGIBLE', 'Only eligible voters can stand as candidates.');
  }
}

/** Panel must exist and belong to this election. */
export async function findPanel(panelId, electionId, client = null) {
  const { rows } = await runner(client)(
    `SELECT * FROM panels WHERE id = $1 AND election_id = $2`,
    [panelId, electionId],
  );
  if (!rows[0]) throw notFound('PANEL_NOT_FOUND', 'Panel not found.');
  return toCamel(rows[0]);
}

/**
 * A panel fields at most `max_selections` candidates per position
 * (one for every DUCSU post). `excludeCandidateId` ignores the caller's own row.
 */
export async function assertPanelHasRoom(panelId, positionId, excludeCandidateId = null, client = null) {
  const q = runner(client);
  const { rows: pos } = await q('SELECT max_selections FROM positions WHERE id = $1', [positionId]);
  if (!pos[0]) throw notFound('POSITION_NOT_FOUND', 'Position not found.');
  const { rows } = await q(
    `SELECT count(*)::int AS n FROM candidates
     WHERE panel_id = $1 AND position_id = $2 AND ($3::int IS NULL OR id <> $3)`,
    [panelId, positionId, excludeCandidateId],
  );
  if (rows[0].n >= pos[0].max_selections) {
    throw conflict(
      'PANEL_POSITION_TAKEN',
      'This panel already has a candidate for that position.',
    );
  }
}

/** A rejected nomination goes back to "pending" when the candidate fixes it. */
export async function reopenIfRejected(candidate, client = null) {
  if (candidate.status === 'rejected') {
    await runner(client)(
      `UPDATE candidates SET status = 'pending', rejection_reason = NULL WHERE id = $1`,
      [candidate.id],
    );
  }
}

export function assertNominationEditable(candidate) {
  if (candidate.status === 'approved') {
    throw conflict(
      'NOMINATION_APPROVED',
      'An approved nomination can no longer be changed. Contact the Election Commission.',
    );
  }
}
