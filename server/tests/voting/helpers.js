// M4 — shared helpers for the voting tests.
import sharp from 'sharp';
import { query } from '../../src/core/db.js';
import { agent, createVoter, loginVoter } from '../helpers.js';

const WINDOWS = {
  open: ["now() - interval '1 hour'", "now() + interval '1 day'"],
  upcoming: ["now() + interval '1 day'", "now() + interval '2 days'"],
  closed: ["now() - interval '2 days'", "now() - interval '1 day'"],
};

/**
 * A tiny election: VP (max 1), Executive (max 2), GS (max 1, no candidates).
 * VP has two approved candidates and one pending one; Executive has three approved.
 */
export async function setupVoting({ phase = 'open' } = {}) {
  const [from, to] = WINDOWS[phase];
  const { rows: e } = await query(
    `INSERT INTO elections (title, starts_at, ends_at, dispute_period_ends_at)
     VALUES ('Test Election', ${from}, ${to}, now() + interval '30 days') RETURNING id`,
  );
  const electionId = e[0].id;
  const mkPosition = async (name, order, max) =>
    (
      await query(
        `INSERT INTO positions (election_id, name_en, name_bn, display_order, max_selections)
         VALUES ($1, $2, $2, $3, $4) RETURNING id`,
        [electionId, name, order, max],
      )
    ).rows[0].id;
  const vp = await mkPosition('VP', 1, 1);
  const em = await mkPosition('Executive', 2, 2);
  const gs = await mkPosition('GS', 3, 1);

  const mkCandidate = async (positionId, name, status = 'approved') => {
    const voter = await createVoter({ name });
    const { rows } = await query(
      'INSERT INTO candidates (voter_id, position_id, status) VALUES ($1, $2, $3) RETURNING id',
      [voter.id, positionId, status],
    );
    return rows[0].id;
  };
  const c = {
    vpA: await mkCandidate(vp, 'Amina VP'),
    vpB: await mkCandidate(vp, 'Bashir VP'),
    vpPending: await mkCandidate(vp, 'Pending VP', 'pending'),
    emA: await mkCandidate(em, 'Alam EM'),
    emB: await mkCandidate(em, 'Babu EM'),
    emC: await mkCandidate(em, 'Chitra EM'),
  };
  return { electionId, vp, em, gs, c };
}

/**
 * A logged-in voter. Ineligible voters cannot log in at all (M1), so for
 * { eligible: false } we log in first and then strike the voter off the list.
 */
export async function voterAgent({ eligible = true, ...overrides } = {}) {
  const voter = await createVoter(overrides);
  const ag = agent();
  const res = await loginVoter(ag, voter);
  if (res.status !== 200) throw new Error(`login failed: ${res.status}`);
  if (!eligible) await query('UPDATE voters SET eligible = false WHERE id = $1', [voter.id]);
  return { voter, ag };
}

/** A small JPEG; pass `exif` to embed metadata that must be stripped. */
export const jpeg = ({ exif = false, w = 120, h = 90 } = {}) => {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: '#357' } });
  if (exif) img = img.withMetadata({ exif: { IFD0: { Copyright: 'SECRET-CAMERA-OWNER' } } });
  return img.jpeg().toBuffer();
};

/**
 * Prepare a multipart POST /api/vote. Returns a plain object (NOT a thenable, so `await`
 * does not fire the request early):  (await castVote(ag, choices)).expect(201)  or  .send()
 * Pass photo = null to omit the file.
 */
export async function castVote(ag, choices, { photo, contentType = 'image/jpeg' } = {}) {
  const file = photo === undefined ? await jpeg() : photo;
  const build = () => {
    const req = ag.post('/api/vote').field('choices', JSON.stringify(choices));
    if (file) req.attach('photo', file, { filename: 'verify.jpg', contentType });
    return req;
  };
  return { expect: (status) => build().expect(status), send: () => build() };
}

export async function counts() {
  const one = async (sql) => Number((await query(sql)).rows[0].n);
  return {
    ballots: await one('SELECT count(*) AS n FROM ballots'),
    choices: await one('SELECT count(*) AS n FROM ballot_choices'),
    receipts: await one('SELECT count(*) AS n FROM receipts'),
    photos: await one('SELECT count(*) AS n FROM voter_photos'),
    voted: await one('SELECT count(*) AS n FROM voters WHERE has_voted'),
  };
}
