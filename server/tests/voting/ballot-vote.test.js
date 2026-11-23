// M4 — ballot API and cast-vote transaction (FR-08, FR-10, FR-11, FR-19).
import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import { query } from '../../src/core/db.js';
import { agent, api, resetDb } from '../helpers.js';
import { RECEIPT_PATTERN } from '../../src/modules/voting/receipt.js';
import { castVote, counts, jpeg, setupVoting, voterAgent } from './helpers.js';

const NOTHING = { ballots: 0, choices: 0, receipts: 0, photos: 0, voted: 0 };

describe('GET /api/ballot (FR-08)', () => {
  beforeEach(resetDb);

  it('returns every post in order with approved candidates only, and no private data', async () => {
    const { vp, em, gs, c } = await setupVoting();
    const { ag } = await voterAgent();

    const res = await ag.get('/api/ballot').expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const { positions, election } = res.body.data;
    expect(election.title).toBe('Test Election');
    expect(positions.map((p) => p.id)).toEqual([vp, em, gs]);
    expect(positions.map((p) => p.maxSelections)).toEqual([1, 2, 1]);
    expect(positions[0].candidates.map((x) => x.id)).toEqual([c.vpA, c.vpB]); // pending one hidden
    expect(positions[1].candidates).toHaveLength(3);
    expect(positions[2].candidates).toEqual([]);

    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/regNo|reg_no|email|@test\.ducsu/);
  });

  it('requires a login', async () => {
    await setupVoting();
    await api().get('/api/ballot').expect(401);
  });

  it('is closed before the start and after the end', async () => {
    await setupVoting({ phase: 'upcoming' });
    const { ag } = await voterAgent();
    const early = await ag.get('/api/ballot').expect(409);
    expect(early.body.error.code).toBe('VOTING_NOT_OPEN');

    await resetDb();
    await setupVoting({ phase: 'closed' });
    const { ag: late } = await voterAgent();
    const res = await late.get('/api/ballot').expect(409);
    expect(res.body.error.code).toBe('VOTING_CLOSED');
  });

  it('refuses an ineligible voter', async () => {
    await setupVoting();
    const { ag } = await voterAgent({ eligible: false });
    const res = await ag.get('/api/ballot').expect(403);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE');
  });

  it('refuses a voter who has already voted', async () => {
    const { vp, c } = await setupVoting();
    const { ag } = await voterAgent();
    await (await castVote(ag, [{ positionId: vp, candidateIds: [c.vpA] }])).expect(201);
    const res = await ag.get('/api/ballot').expect(409);
    expect(res.body.error.code).toBe('ALREADY_VOTED');
  });

  it('works for a candidate, who is also a voter', async () => {
    const { c } = await setupVoting();
    const { rows } = await query('SELECT voter_id FROM candidates WHERE id = $1', [c.vpA]);
    const ag = agent();
    const { loginVoter } = await import('../helpers.js');
    const { rows: v } = await query('SELECT * FROM voters WHERE id = $1', [rows[0].voter_id]);
    await loginVoter(ag, v[0]);
    await ag.get('/api/ballot').expect(200);
  });
});

describe('POST /api/vote (FR-10, FR-11, FR-19)', () => {
  beforeEach(resetDb);

  it('stores one ballot, its choices, one photo and one receipt, and marks the voter', async () => {
    const { vp, em, gs, c } = await setupVoting();
    const { ag, voter } = await voterAgent();

    const res = await (
      await castVote(ag, [
        { positionId: vp, candidateIds: [c.vpB] },
        { positionId: em, candidateIds: [c.emA, c.emC] },
        { positionId: gs, candidateIds: [] }, // left blank
      ])
    ).expect(201);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.receiptCode).toMatch(RECEIPT_PATTERN);
    expect(await counts()).toEqual({ ballots: 1, choices: 3, receipts: 1, photos: 1, voted: 1 });

    const { rows } = await query(
      'SELECT position_id, candidate_id FROM ballot_choices ORDER BY position_id, candidate_id',
    );
    expect(rows).toEqual([
      { position_id: vp, candidate_id: c.vpB },
      { position_id: em, candidate_id: c.emA },
      { position_id: em, candidate_id: c.emC },
    ]);
    const { rows: v } = await query('SELECT has_voted FROM voters WHERE id = $1', [voter.id]);
    expect(v[0].has_voted).toBe(true);
    const { rows: r } = await query('SELECT code FROM receipts');
    expect(r[0].code).toBe(res.body.data.receiptCode);
  });

  it('accepts a completely blank ballot (every post skipped)', async () => {
    await setupVoting();
    const { ag } = await voterAgent();
    await (await castVote(ag, [])).expect(201);
    expect(await counts()).toEqual({ ballots: 1, choices: 0, receipts: 1, photos: 1, voted: 1 });
  });

  it('rejects a second attempt with ALREADY_VOTED and stores nothing more', async () => {
    const { vp, c } = await setupVoting();
    const { ag } = await voterAgent();
    await (await castVote(ag, [{ positionId: vp, candidateIds: [c.vpA] }])).expect(201);
    const again = await (await castVote(ag, [{ positionId: vp, candidateIds: [c.vpB] }])).expect(409);
    expect(again.body.error.code).toBe('ALREADY_VOTED');
    expect(await counts()).toEqual({ ballots: 1, choices: 1, receipts: 1, photos: 1, voted: 1 });
  });

  it('enforces the maximum selections on the server', async () => {
    const { em, c } = await setupVoting();
    const { ag } = await voterAgent();
    const res = await (
      await castVote(ag, [{ positionId: em, candidateIds: [c.emA, c.emB, c.emC] }])
    ).expect(400);
    expect(res.body.error.code).toBe('TOO_MANY_SELECTIONS');
    expect(await counts()).toEqual(NOTHING);
  });

  it.each([
    ['a duplicate candidate', (s) => [{ positionId: s.em, candidateIds: [s.c.emA, s.c.emA] }]],
    ['a candidate from another post', (s) => [{ positionId: s.vp, candidateIds: [s.c.emA] }]],
    ['a pending (unapproved) candidate', (s) => [{ positionId: s.vp, candidateIds: [s.c.vpPending] }]],
    ['an unknown candidate', (s) => [{ positionId: s.vp, candidateIds: [999999] }]],
    ['an unknown post', (s) => [{ positionId: 999999, candidateIds: [s.c.vpA] }]],
    [
      'the same post twice',
      (s) => [
        { positionId: s.vp, candidateIds: [s.c.vpA] },
        { positionId: s.vp, candidateIds: [s.c.vpB] },
      ],
    ],
  ])('rejects %s and stores nothing', async (_name, build) => {
    const setup = await setupVoting();
    const { ag, voter } = await voterAgent();
    const res = await (await castVote(ag, build(setup))).expect(400);
    expect(res.body.error.code).toBe('INVALID_CHOICES');
    expect(await counts()).toEqual(NOTHING);
    const { rows } = await query('SELECT has_voted FROM voters WHERE id = $1', [voter.id]);
    expect(rows[0].has_voted).toBe(false);
  });

  it('rejects malformed choices', async () => {
    await setupVoting();
    const { ag } = await voterAgent();
    const bad = await ag
      .post('/api/vote')
      .field('choices', '{not json')
      .attach('photo', await jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
    const missing = await ag
      .post('/api/vote')
      .attach('photo', await jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');
    expect(await counts()).toEqual(NOTHING);
  });

  it('requires a photo (FR-19)', async () => {
    await setupVoting();
    const { ag } = await voterAgent();
    const res = await (await castVote(ag, [], { photo: null })).expect(400);
    expect(res.body.error.code).toBe('PHOTO_REQUIRED');
    expect(await counts()).toEqual(NOTHING);
  });

  it('rejects a file that is not an image', async () => {
    await setupVoting();
    const { ag } = await voterAgent();
    const res = await (
      await castVote(ag, [], { photo: Buffer.from('definitely not a picture') })
    ).expect(400);
    expect(res.body.error.code).toBe('INVALID_PHOTO');
    expect(await counts()).toEqual(NOTHING);
  });

  it('rejects a photo over 2 MB', async () => {
    await setupVoting();
    const { ag } = await voterAgent();
    const res = await (await castVote(ag, [], { photo: Buffer.alloc(2 * 1024 * 1024 + 10, 1) })).expect(413);
    expect(res.body.error.code).toBe('PHOTO_TOO_LARGE');
    expect(await counts()).toEqual(NOTHING);
  });

  it('stores the photo as a clean JPEG with all metadata stripped', async () => {
    await setupVoting();
    const { ag, voter } = await voterAgent();
    const original = await jpeg({ exif: true, w: 1600, h: 1200 });
    expect((await sharp(original).metadata()).exif).toBeDefined(); // sanity: input had EXIF
    await (await castVote(ag, [], { photo: original })).expect(201);

    const { rows } = await query('SELECT mime, data FROM voter_photos WHERE voter_id = $1', [voter.id]);
    expect(rows[0].mime).toBe('image/jpeg');
    const meta = await sharp(rows[0].data).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.exif).toBeUndefined();
    expect(Math.max(meta.width, meta.height)).toBeLessThanOrEqual(640);
    expect(rows[0].data.includes(Buffer.from('SECRET-CAMERA-OWNER'))).toBe(false);
  });

  it('turns a PNG upload into a JPEG', async () => {
    await setupVoting();
    const { ag, voter } = await voterAgent();
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#a33' } }).png().toBuffer();
    await (await castVote(ag, [], { photo: png, contentType: 'image/png' })).expect(201);
    const { rows } = await query('SELECT mime, data FROM voter_photos WHERE voter_id = $1', [voter.id]);
    expect(rows[0].mime).toBe('image/jpeg');
    expect((await sharp(rows[0].data).metadata()).format).toBe('jpeg');
  });

  it('refuses before the start, after the end, and for ineligible voters', async () => {
    await setupVoting({ phase: 'upcoming' });
    const { ag } = await voterAgent();
    expect((await (await castVote(ag, [])).expect(409)).body.error.code).toBe('VOTING_NOT_OPEN');

    await resetDb();
    await setupVoting({ phase: 'closed' });
    const { ag: late } = await voterAgent();
    expect((await (await castVote(late, [])).expect(409)).body.error.code).toBe('VOTING_CLOSED');

    await resetDb();
    await setupVoting();
    const { ag: blocked } = await voterAgent({ eligible: false });
    expect((await (await castVote(blocked, [])).expect(403)).body.error.code).toBe('NOT_ELIGIBLE');
    expect(await counts()).toEqual(NOTHING);
  });

  it('requires a login', async () => {
    await setupVoting();
    await api()
      .post('/api/vote')
      .field('choices', '[]')
      .attach('photo', await jpeg(), { filename: 'p.jpg', contentType: 'image/jpeg' })
      .expect(401);
  });

  it('rolls EVERYTHING back if any step fails, and lets the voter retry', async () => {
    const { vp, c } = await setupVoting();
    const { ag, voter } = await voterAgent();

    // Make the final step (receipt insert) blow up inside the transaction.
    await query(`
      CREATE FUNCTION fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated failure'; END $$;
      CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts
        FOR EACH ROW EXECUTE FUNCTION fail_receipt();`);
    try {
      const failed = await (await castVote(ag, [{ positionId: vp, candidateIds: [c.vpA] }])).expect(500);
      expect(failed.body.error.code).toBe('INTERNAL_ERROR');
      expect(failed.body.error.message).toMatch(/try again/i);
      expect(JSON.stringify(failed.body)).not.toMatch(/simulated/);
    } finally {
      await query('DROP TRIGGER fail_receipt ON receipts; DROP FUNCTION fail_receipt();');
    }

    // Nothing leaked out of the failed attempt: no ballot, choice, photo, receipt, or voted flag.
    expect(await counts()).toEqual(NOTHING);
    const { rows } = await query('SELECT has_voted FROM voters WHERE id = $1', [voter.id]);
    expect(rows[0].has_voted).toBe(false);

    // The voter can simply try again.
    await (await castVote(ag, [{ positionId: vp, candidateIds: [c.vpA] }])).expect(201);
    expect(await counts()).toEqual({ ballots: 1, choices: 1, receipts: 1, photos: 1, voted: 1 });
  });
});
