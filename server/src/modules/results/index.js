// M2 — Results calculation, consistency check and publishing (FR-14).
// Tally votes from ballot_choices, determine winners based on seat count (max_selections),
// detect ties, perform cryptographic consistency check (ballots == receipts == voters marked voted).

import { query, withTransaction, toCamel } from '../../core/db.js';
import { conflict, notFound } from '../../core/errors.js';
import { getCurrent } from '../election/index.js';
import audit from '../audit/index.js';

/**
 * Perform consistency check:
 * ballots count === receipts count === voters marked has_voted
 */
export async function getConsistencyCounts(electionId, client = null) {
  const q = client ? client.query.bind(client) : query;

  const [ballotsRes, receiptsRes, votersRes] = await Promise.all([
    q('SELECT count(*)::int AS count FROM ballots WHERE election_id = $1', [electionId]),
    q('SELECT count(*)::int AS count FROM receipts WHERE election_id = $1', [electionId]),
    q('SELECT count(*)::int AS count FROM voters WHERE has_voted = true'),
  ]);

  const totalBallots = ballotsRes.rows[0]?.count ?? 0;
  const totalReceipts = receiptsRes.rows[0]?.count ?? 0;
  const votersMarkedVoted = votersRes.rows[0]?.count ?? 0;

  return {
    totalBallots,
    totalReceipts,
    votersMarkedVoted,
    isConsistent: totalBallots === totalReceipts && totalReceipts === votersMarkedVoted,
  };
}

/**
 * Calculate election results from ballot_choices (Phase 1).
 * Can only be run after ends_at.
 */
export async function calculateResults(req, electionId = null) {
  return await withTransaction(async (client) => {
    let current;
    if (electionId) {
      const { rows } = await client.query('SELECT * FROM elections WHERE id = $1', [electionId]);
      if (rows.length === 0) throw notFound('ELECTION_NOT_FOUND', 'Election not found.');
      current = toCamel(rows[0]);
    } else {
      current = await getCurrent(client);
    }

    if (!current) throw notFound('NO_ELECTION', 'No election found to calculate results.');

    const now = new Date();
    if (now < new Date(current.endsAt)) {
      throw conflict(
        'VOTING_STILL_OPEN',
        'Results calculation can only be performed after the voting period has ended.'
      );
    }

    // 1. Get all positions for this election
    const { rows: positions } = await client.query(
      'SELECT id, name_en, name_bn, display_order, max_selections FROM positions WHERE election_id = $1 ORDER BY display_order ASC',
      [current.id]
    );

    // 2. Clear any existing results for this election
    await client.query('DELETE FROM results WHERE election_id = $1', [current.id]);

    const calculatedResults = [];

    // 3. For each position, count votes for all approved candidates
    for (const pos of positions) {
      const seatCount = pos.max_selections || 1;

      // Get candidates for position
      const { rows: candRows } = await client.query(
        `SELECT c.id, c.voter_id, v.name AS candidate_name, pan.name AS panel_name,
                COALESCE(vote_counts.votes, 0)::int AS votes
         FROM candidates c
         JOIN voters v ON c.voter_id = v.id
         LEFT JOIN panels pan ON c.panel_id = pan.id
         LEFT JOIN (
           SELECT candidate_id, count(*)::int AS votes
           FROM ballot_choices
           WHERE position_id = $1
           GROUP BY candidate_id
         ) vote_counts ON c.id = vote_counts.candidate_id
         WHERE c.position_id = $1 AND c.status = 'approved'
         ORDER BY votes DESC, c.id ASC`,
        [pos.id]
      );

      if (candRows.length === 0) continue;

      // Determine winners and ties
      // If cutoff index (seatCount - 1) exists:
      let cutoffVotes = null;
      let hasTieAtCutoff = false;

      if (candRows.length > seatCount) {
        const candidateAtCutoff = candRows[seatCount - 1];
        const nextCandidate = candRows[seatCount];
        if (candidateAtCutoff.votes === nextCandidate.votes && candidateAtCutoff.votes > 0) {
          cutoffVotes = candidateAtCutoff.votes;
          hasTieAtCutoff = true;
        }
      }

      for (let idx = 0; idx < candRows.length; idx++) {
        const cand = candRows[idx];
        let isWinner = false;
        let tieFlag = false;

        if (cand.votes === 0) {
          isWinner = false;
          tieFlag = false;
        } else if (hasTieAtCutoff && cand.votes === cutoffVotes) {
          isWinner = false; // tie needs resolution
          tieFlag = true;
        } else if (idx < seatCount) {
          isWinner = true;
          tieFlag = false;
        }

        await client.query(
          `INSERT INTO results (election_id, position_id, candidate_id, votes, is_winner, tie_flag)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [current.id, pos.id, cand.id, cand.votes, isWinner, tieFlag]
        );

        calculatedResults.push({
          positionId: pos.id,
          positionNameEn: pos.name_en,
          positionNameBn: pos.name_bn,
          candidateId: cand.id,
          candidateName: cand.candidate_name,
          panelName: cand.panel_name,
          votes: cand.votes,
          isWinner,
          tieFlag,
        });
      }
    }

    const consistency = await getConsistencyCounts(current.id, client);

    await audit.record(req, 'CALCULATE_RESULTS', `election:${current.id}`, client);

    return {
      electionId: current.id,
      calculatedResultsCount: calculatedResults.length,
      consistency,
    };
  });
}

/**
 * Fetch formatted results with candidate and position info.
 */
export async function getResultsData(electionId = null) {
  let current;
  if (electionId) {
    const { rows } = await query('SELECT * FROM elections WHERE id = $1', [electionId]);
    if (rows.length === 0) return null;
    current = toCamel(rows[0]);
  } else {
    current = await getCurrent();
  }

  if (!current) return null;

  const { rows } = await query(
    `SELECT r.election_id, r.position_id, r.candidate_id, r.votes, r.is_winner, r.tie_flag,
            p.name_en AS position_name_en, p.name_bn AS position_name_bn, p.display_order, p.max_selections,
            v.name AS candidate_name, v.hall AS candidate_hall,
            pan.name AS panel_name,
            c.photo_file_id
     FROM results r
     JOIN positions p ON r.position_id = p.id
     JOIN candidates c ON r.candidate_id = c.id
     JOIN voters v ON c.voter_id = v.id
     LEFT JOIN panels pan ON c.panel_id = pan.id
     WHERE r.election_id = $1
     ORDER BY p.display_order ASC, r.votes DESC, v.name ASC`,
    [current.id]
  );

  const consistency = await getConsistencyCounts(current.id);

  // Group by position
  const positionsMap = new Map();
  for (const row of rows) {
    if (!positionsMap.has(row.position_id)) {
      positionsMap.set(row.position_id, {
        positionId: row.position_id,
        nameEn: row.position_name_en,
        nameBn: row.position_name_bn,
        displayOrder: row.display_order,
        maxSelections: row.max_selections,
        candidates: [],
      });
    }

    positionsMap.get(row.position_id).candidates.push({
      candidateId: row.candidate_id,
      name: row.candidate_name,
      hall: row.candidate_hall,
      panelName: row.panel_name || 'Independent',
      photoFileId: row.photo_file_id,
      votes: row.votes,
      isWinner: row.is_winner,
      tieFlag: row.tie_flag,
    });
  }

  return {
    election: current,
    positions: Array.from(positionsMap.values()),
    consistency,
  };
}
