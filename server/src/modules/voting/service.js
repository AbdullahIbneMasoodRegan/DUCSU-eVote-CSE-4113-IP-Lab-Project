// M4 — voting engine (FR-08..FR-12, FR-19). Raw parameterised SQL only.
//
// SECRECY (work plan § 9): nothing written here may link a voter to a ballot.
//   * ballots / ballot_choices / receipts get no voter id, no timestamp, no serial.
//   * has_voted is a boolean on voters; there is no voted_at.
//   * ballots are only ever read ORDER BY id (random UUID), receipts ORDER BY code.
//   * never log choices, photos or receipt codes.
import { query, withTransaction } from '../../core/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { getCurrent } from '../election/index.js';
import { generateReceiptCode } from './receipt.js';

const runner = (client) => (client ? client.query.bind(client) : query);

/** The current election, or 404 when the EC has not created one yet. */
async function requireElection(client = null) {
  const election = await getCurrent(client);
  if (!election) throw notFound('NO_ELECTION', 'No election has been set up yet.');
  return election;
}

/** Throws unless voting is open right now (the clock decides, never the UI). */
function assertVotingOpen(election) {
  if (election.status === 'open') return;
  if (election.status === 'closed' || election.status === 'published') {
    throw conflict('VOTING_CLOSED', 'Voting has closed.');
  }
  throw conflict('VOTING_NOT_OPEN', 'Voting has not opened yet.');
}

function assertMayVote(voter) {
  if (!voter) throw forbidden('NOT_ELIGIBLE', 'You are not on the voter list.');
  if (!voter.eligible) throw forbidden('NOT_ELIGIBLE', 'You are not eligible to vote in this election.');
  if (voter.has_voted) throw conflict('ALREADY_VOTED', 'You have already voted. A ballot can be cast only once.');
}

// ------------------------------------------------------------------ ballot (FR-08)

/**
 * Positions in display order with their approved candidates. Only for an eligible
 * voter who has not voted, while voting is open.
 */
export async function getBallot(voterId) {
  const election = await requireElection();
  assertVotingOpen(election);
  const { rows: v } = await query('SELECT eligible, has_voted FROM voters WHERE id = $1', [voterId]);
  assertMayVote(v[0]);

  const { rows } = await query(
    `SELECT p.id AS position_id, p.name_en, p.name_bn, p.display_order, p.max_selections,
            c.id AS candidate_id, c.photo_file_id,
            vt.name, vt.hall, vt.department,
            pan.id AS panel_id, pan.name AS panel_name
       FROM positions p
       LEFT JOIN candidates c ON c.position_id = p.id AND c.status = 'approved'
       LEFT JOIN voters vt ON vt.id = c.voter_id
       LEFT JOIN panels pan ON pan.id = c.panel_id
      WHERE p.election_id = $1
      ORDER BY p.display_order, p.id, vt.name, c.id`,
    [election.id],
  );

  const positions = new Map();
  for (const r of rows) {
    if (!positions.has(r.position_id)) {
      positions.set(r.position_id, {
        id: r.position_id,
        nameEn: r.name_en,
        nameBn: r.name_bn,
        displayOrder: r.display_order,
        maxSelections: r.max_selections,
        candidates: [],
      });
    }
    if (r.candidate_id) {
      positions.get(r.position_id).candidates.push({
        id: r.candidate_id,
        name: r.name,
        hall: r.hall,
        department: r.department,
        photoUrl: r.photo_file_id ? `/api/candidates/${r.candidate_id}/photo` : null,
        panel: r.panel_id ? { id: r.panel_id, name: r.panel_name } : null,
      });
    }
  }

  return {
    election: { id: election.id, title: election.title, startsAt: election.startsAt, endsAt: election.endsAt },
    positions: [...positions.values()],
  };
}

// ------------------------------------------------------------------ cast vote (FR-10, FR-11)

/**
 * Check the selections against the real positions and approved candidates:
 * limits are enforced here, never trusted from the browser (NFR-05).
 * Returns the flat list of { positionId, candidateId } to store.
 * A position the voter skipped is simply absent ("left blank").
 */
async function validateChoices(client, electionId, choices) {
  const { rows: positions } = await client.query(
    'SELECT id, max_selections FROM positions WHERE election_id = $1',
    [electionId],
  );
  const { rows: candidates } = await client.query(
    `SELECT c.id, c.position_id
       FROM candidates c JOIN positions p ON p.id = c.position_id
      WHERE p.election_id = $1 AND c.status = 'approved'`,
    [electionId],
  );
  const maxByPosition = new Map(positions.map((p) => [p.id, p.max_selections]));
  const positionOf = new Map(candidates.map((c) => [c.id, c.position_id]));

  const seenPositions = new Set();
  const flat = [];
  for (const { positionId, candidateIds } of choices) {
    if (!maxByPosition.has(positionId)) {
      throw badRequest('INVALID_CHOICES', 'A selected post is not part of this election.', { positionId });
    }
    if (seenPositions.has(positionId)) {
      throw badRequest('INVALID_CHOICES', 'A post appears more than once.', { positionId });
    }
    seenPositions.add(positionId);

    const unique = new Set(candidateIds);
    if (unique.size !== candidateIds.length) {
      throw badRequest('INVALID_CHOICES', 'The same candidate was selected twice.', { positionId });
    }
    if (unique.size > maxByPosition.get(positionId)) {
      throw badRequest('TOO_MANY_SELECTIONS', 'You selected more candidates than this post allows.', {
        positionId,
        max: maxByPosition.get(positionId),
      });
    }
    for (const candidateId of unique) {
      if (positionOf.get(candidateId) !== positionId) {
        throw badRequest('INVALID_CHOICES', 'A selected candidate does not stand for that post.', {
          positionId,
        });
      }
      flat.push({ positionId, candidateId });
    }
  }
  return flat;
}

/** Insert a fresh receipt, retrying on the (astronomically unlikely) code collision. */
async function insertReceipt(client, electionId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateReceiptCode();
    const { rowCount } = await client.query(
      'INSERT INTO receipts (code, election_id) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING',
      [code, electionId],
    );
    if (rowCount === 1) return code;
  }
  throw new Error('could not generate a unique receipt code');
}

/**
 * The cast-vote transaction. Everything happens in ONE transaction; any error
 * rolls back all of it (no ballot without a receipt, no photo without a ballot).
 *
 *   1. lock the voter row (SELECT ... FOR UPDATE) so concurrent requests queue up
 *   2. eligible? not voted? election open?
 *   3. validate the choices against positions, maximums and approved candidates
 *   4. insert the ballot (random UUID) and its choices
 *   5. insert the verification photo
 *   6. voters.has_voted = true
 *   7. insert the receipt
 *
 * @param {{ voterId: number, choices: Array<{positionId:number, candidateIds:number[]}>,
 *           photo: { mime: string, data: Buffer } }} input
 * @returns {Promise<string>} the receipt code
 */
export async function castVote({ voterId, choices, photo }) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, eligible, has_voted FROM voters WHERE id = $1 FOR UPDATE',
      [voterId],
    );
    assertMayVote(rows[0]);

    const election = await requireElection(client);
    assertVotingOpen(election);

    const flat = await validateChoices(client, election.id, choices);

    const { rows: ballot } = await client.query(
      'INSERT INTO ballots (election_id) VALUES ($1) RETURNING id',
      [election.id],
    );
    if (flat.length > 0) {
      await client.query(
        `INSERT INTO ballot_choices (ballot_id, position_id, candidate_id)
         SELECT $1, t.position_id, t.candidate_id
           FROM unnest($2::int[], $3::int[]) AS t(position_id, candidate_id)`,
        [ballot[0].id, flat.map((c) => c.positionId), flat.map((c) => c.candidateId)],
      );
    }

    await client.query('INSERT INTO voter_photos (voter_id, mime, data) VALUES ($1, $2, $3)', [
      voterId,
      photo.mime,
      photo.data,
    ]);
    await client.query('UPDATE voters SET has_voted = true WHERE id = $1', [voterId]);

    return insertReceipt(client, election.id);
  });
}

// ------------------------------------------------------------------ receipts (FR-12)

/** Receipts become public only once voting has closed (clock-checked here). */
async function requireClosedElection() {
  const election = await requireElection();
  if (election.status === 'closed' || election.status === 'published') return election;
  throw conflict('VOTING_NOT_CLOSED', 'Receipts are published after voting closes.');
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

/** Every receipt code, sorted alphabetically (never in insertion order). */
export async function listReceipts({ q = '' } = {}) {
  const election = await requireClosedElection();
  const term = q.trim().toUpperCase();
  const { rows } = term
    ? await query(
        `SELECT code FROM receipts WHERE election_id = $1 AND code LIKE $2 ESCAPE '\\' ORDER BY code`,
        [election.id, `%${escapeLike(term)}%`],
      )
    : await query('SELECT code FROM receipts WHERE election_id = $1 ORDER BY code', [election.id]);
  return rows.map((r) => r.code);
}

/** Does this exact receipt code exist? */
export async function receiptExists(code) {
  const election = await requireClosedElection();
  const { rowCount } = await query('SELECT 1 FROM receipts WHERE election_id = $1 AND code = $2', [
    election.id,
    code,
  ]);
  return rowCount === 1;
}

// ------------------------------------------------------------------ voter photos (FR-19)

/** The stored (already re-encoded) photo of one voter, or null. */
export async function getVoterPhoto(voterId, client = null) {
  const { rows } = await runner(client)('SELECT mime, data FROM voter_photos WHERE voter_id = $1', [
    voterId,
  ]);
  return rows[0] ?? null;
}

/**
 * Delete every voter photo once the dispute period has ended (FR-19).
 * Photos are not tied to an election (no extra columns, secrecy rule 1), so
 * "the dispute period" is that of the current election.
 * @returns {Promise<number>} how many photos were deleted
 */
export async function purgeExpiredPhotos(now = new Date()) {
  const election = await getCurrent();
  if (!election?.disputePeriodEndsAt || new Date(election.disputePeriodEndsAt) > now) return 0;
  const { rowCount } = await query('DELETE FROM voter_photos');
  return rowCount;
}
