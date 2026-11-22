// M2 — Election helper & service (FR-03, FR-04, FR-06).
// Handles election timing, edit locking, positions, voters import/management, and nomination review.

import { query, toCamel } from '../../core/db.js';
import { conflict } from '../../core/errors.js';

/**
 * Returns the current (active or latest) election.
 */
export async function getCurrent(client = null) {
  const q = client ? client.query.bind(client) : query;
  const { rows } = await q(
    `SELECT * FROM elections
     ORDER BY starts_at DESC
     LIMIT 1`
  );
  if (rows.length === 0) return null;
  const el = toCamel(rows[0]);
  el.status = computeStatus(el);
  return el;
}

/**
 * Computes status dynamically from server clock.
 * Status values: 'draft' | 'nomination' | 'open' | 'closed' | 'published'
 */
export function computeStatus(election) {
  if (!election) return 'draft';
  if (election.resultsPublishedAt) return 'published';

  const now = new Date();
  const startsAt = new Date(election.startsAt);
  const endsAt = new Date(election.endsAt);

  if (now < startsAt) {
    return 'nomination';
  } else if (now >= startsAt && now < endsAt) {
    return 'open';
  } else {
    return 'closed';
  }
}

/**
 * Convenience helper matching frozen signature: election.status()
 */
export async function status(client = null) {
  const current = await getCurrent(client);
  return computeStatus(current);
}

/**
 * Asserts that the election is still editable.
 * Throws conflict if starts_at has passed.
 */
export async function assertEditable(providedElection = null, client = null) {
  const election = providedElection ?? (await getCurrent(client));
  if (!election) return; // No election created yet, editable

  const now = new Date();
  const startsAt = new Date(election.startsAt);
  if (now >= startsAt) {
    throw conflict(
      'ELECTION_LOCKED',
      'The election has already started or concluded. Modifications to positions, voters, and candidates are locked.'
    );
  }
}

export const election = {
  getCurrent,
  status,
  computeStatus,
  assertEditable,
};

export default election;
