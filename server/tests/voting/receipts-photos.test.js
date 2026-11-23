// M4 — public receipt list (FR-12), EC dispute photo viewer and photo auto-deletion (FR-19).
import { describe, it, expect, beforeEach } from 'vitest';
import sharp from 'sharp';
import { query } from '../../src/core/db.js';
import { agent, api, createAdmin, resetDb } from '../helpers.js';
import { runPhotoPurge } from '../../src/modules/voting/jobs.js';
import { castVote, setupVoting, voterAgent } from './helpers.js';

const closeVoting = () =>
  query(`UPDATE elections SET starts_at = now() - interval '3 days', ends_at = now() - interval '1 day'`);

async function adminAgent(role = 'ec') {
  const admin = await createAdmin({ email: `${role}@x.test`, role, name: role });
  const ag = agent();
  await ag.post('/api/auth/admin/login').send({ email: admin.email, password: admin.password }).expect(200);
  return ag;
}

async function voteAs(setup, { photo } = {}) {
  const { ag, voter } = await voterAgent();
  const res = await (
    await castVote(ag, [{ positionId: setup.vp, candidateIds: [setup.c.vpA] }], { photo })
  ).expect(201);
  return { voter, code: res.body.data.receiptCode };
}

describe('public receipt list (FR-12)', () => {
  beforeEach(resetDb);

  it('is not public while voting is open', async () => {
    const setup = await setupVoting();
    await voteAs(setup);
    const res = await api().get('/api/receipts').expect(409);
    expect(res.body.error.code).toBe('VOTING_NOT_CLOSED');
    await api().get('/api/receipts/DU-AAAA-BBBB').expect(409);
  });

  it('lists every code alphabetically, without a login, once voting has closed', async () => {
    const setup = await setupVoting();
    const codes = [];
    for (let i = 0; i < 6; i += 1) codes.push((await voteAs(setup)).code);
    await closeVoting();

    const res = await api().get('/api/receipts').expect(200);
    expect(res.body.data.count).toBe(6);
    expect(res.body.data.codes).toEqual([...codes].sort());
    // Nothing but codes: no ids, no voters, no choices.
    expect(Object.keys(res.body.data).sort()).toEqual(['codes', 'count']);
  });

  it('searches by part of a code, ignoring case, and treats % and _ literally', async () => {
    const setup = await setupVoting();
    const { code } = await voteAs(setup);
    await voteAs(setup);
    await closeVoting();

    const part = code.slice(4, 8).toLowerCase();
    const hit = await api().get('/api/receipts').query({ q: part }).expect(200);
    expect(hit.body.data.codes).toContain(code);

    const wildcard = await api().get('/api/receipts').query({ q: '%' }).expect(200);
    expect(wildcard.body.data.count).toBe(0);
    const none = await api().get('/api/receipts').query({ q: 'ZZZZZZZZ' }).expect(200);
    expect(none.body.data.codes).toEqual([]);
  });

  it('confirms a single receipt and rejects malformed codes', async () => {
    const setup = await setupVoting();
    const { code } = await voteAs(setup);
    await closeVoting();

    expect((await api().get(`/api/receipts/${code}`).expect(200)).body.data.found).toBe(true);
    expect((await api().get(`/api/receipts/${code.toLowerCase()}`).expect(200)).body.data.found).toBe(true);
    expect((await api().get('/api/receipts/DU-AAAA-BBBB').expect(200)).body.data.found).toBe(false);
    await api().get('/api/receipts/not-a-code').expect(400);
  });
});

describe('EC dispute photo viewer (FR-19)', () => {
  beforeEach(resetDb);

  it('serves the photo to the EC only, and audits every view with the voter id', async () => {
    const setup = await setupVoting();
    const { voter } = await voteAs(setup);
    const ec = await adminAgent('ec');

    const res = await ec.get(`/api/admin/photos/${voter.id}`).expect(200);
    expect(res.headers['content-type']).toMatch(/image\/jpeg/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await sharp(res.body).metadata()).format).toBe('jpeg');

    await ec.get(`/api/admin/photos/${voter.id}`).expect(200); // viewed twice => two entries
    const { rows } = await query(`SELECT actor_type, target FROM audit_log WHERE action = 'PHOTO_VIEWED'`);
    expect(rows).toEqual([
      { actor_type: 'admin', target: String(voter.id) },
      { actor_type: 'admin', target: String(voter.id) },
    ]);
  });

  it('is closed to voters, observers and anonymous visitors, and audits nothing for them', async () => {
    const setup = await setupVoting();
    const { voter } = await voteAs(setup);
    const { ag: other } = await voterAgent();
    const observer = await adminAgent('observer');

    await other.get(`/api/admin/photos/${voter.id}`).expect(403);
    await observer.get(`/api/admin/photos/${voter.id}`).expect(403);
    await api().get(`/api/admin/photos/${voter.id}`).expect(401);
    const { rows } = await query(`SELECT 1 FROM audit_log WHERE action = 'PHOTO_VIEWED'`);
    expect(rows).toHaveLength(0);
  });

  it('returns 404 when there is no photo, and does not audit a view that never happened', async () => {
    const setup = await setupVoting();
    const ec = await adminAgent('ec');
    const { voter } = await voterAgent(); // never voted
    await ec.get(`/api/admin/photos/${voter.id}`).expect(404);
    await ec.get('/api/admin/photos/abc').expect(400);
    const { rows } = await query(`SELECT 1 FROM audit_log WHERE action = 'PHOTO_VIEWED'`);
    expect(rows).toHaveLength(0);
    expect(setup.electionId).toBeGreaterThan(0);
  });
});

describe('photo auto-deletion after the dispute period (FR-19)', () => {
  beforeEach(resetDb);

  it('keeps photos while the dispute period is running', async () => {
    const setup = await setupVoting();
    await voteAs(setup);
    expect(await runPhotoPurge()).toBe(0);
    const { rows } = await query('SELECT count(*)::int AS n FROM voter_photos');
    expect(rows[0].n).toBe(1);
    const log = await query(`SELECT 1 FROM audit_log WHERE action = 'PHOTOS_PURGED'`);
    expect(log.rows).toHaveLength(0);
  });

  it('deletes every photo once the dispute period has ended, audited as a system action', async () => {
    const setup = await setupVoting();
    await voteAs(setup);
    await voteAs(setup);
    await closeVoting();
    await query(`UPDATE elections SET dispute_period_ends_at = now() - interval '1 hour'`);

    expect(await runPhotoPurge()).toBe(2);
    const { rows } = await query('SELECT count(*)::int AS n FROM voter_photos');
    expect(rows[0].n).toBe(0);
    const log = await query(`SELECT actor_type, actor_id, target FROM audit_log WHERE action = 'PHOTOS_PURGED'`);
    expect(log.rows).toEqual([{ actor_type: 'system', actor_id: null, target: '2 photos' }]);

    // Idempotent: a second run has nothing to do and writes no second audit entry.
    expect(await runPhotoPurge()).toBe(0);
    expect((await query(`SELECT 1 FROM audit_log WHERE action = 'PHOTOS_PURGED'`)).rows).toHaveLength(1);
  });

  it('does nothing when no dispute period has been set', async () => {
    const setup = await setupVoting();
    await voteAs(setup);
    await query('UPDATE elections SET dispute_period_ends_at = NULL');
    expect(await runPhotoPurge()).toBe(0);
  });
});
