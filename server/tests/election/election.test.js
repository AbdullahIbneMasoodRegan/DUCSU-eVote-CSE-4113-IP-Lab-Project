// M2 — Election Setup, Positions, Voter Import, and Nomination Review Tests (FR-03, FR-04, FR-06).
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/core/db.js';
import { agent, resetDb, createAdmin, createVoter } from '../helpers.js';

describe('Election Setup (FR-03)', () => {
  beforeEach(resetDb);

  it('allows EC to create an election with valid dates', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    const startsAt = new Date(Date.now() + 60000).toISOString();
    const endsAt = new Date(Date.now() + 120000).toISOString();

    const res = await ag
      .post('/api/admin/elections')
      .send({
        title: 'DUCSU Test Election',
        startsAt,
        endsAt,
      })
      .expect(201);

    expect(res.body.data).toMatchObject({
      title: 'DUCSU Test Election',
      status: 'nomination',
    });
  });

  it('rejects invalid election dates where endsAt <= startsAt', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    const startsAt = new Date(Date.now() + 120000).toISOString();
    const endsAt = new Date(Date.now() + 60000).toISOString();

    const res = await ag
      .post('/api/admin/elections')
      .send({
        title: 'Invalid Dates Election',
        startsAt,
        endsAt,
      })
      .expect(400);

    expect(res.body.error.code).toBe('INVALID_DATES');
  });
});

describe('Position Management & Edit Lock (FR-03, FR-04)', () => {
  beforeEach(resetDb);

  it('allows EC to add and list positions', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    // Create election
    await ag.post('/api/admin/elections').send({
      title: 'DUCSU 2026',
      startsAt: new Date(Date.now() + 3600000).toISOString(),
      endsAt: new Date(Date.now() + 7200000).toISOString(),
    });

    // Add position
    await ag
      .post('/api/admin/positions')
      .send({
        nameEn: 'Vice President',
        nameBn: 'সহ-সভাপতি',
        displayOrder: 1,
        maxSelections: 1,
      })
      .expect(201);

    const listRes = await ag.get('/api/admin/positions').expect(200);
    expect(listRes.body.data.length).toBe(1);
    expect(listRes.body.data[0]).toMatchObject({
      nameEn: 'Vice President',
      nameBn: 'সহ-সভাপতি',
      displayOrder: 1,
    });
  });

  it('enforces edit lock once election starts_at has passed (FR-04)', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    // Create already started election
    await ag.post('/api/admin/elections').send({
      title: 'Started Election',
      startsAt: new Date(Date.now() - 60000).toISOString(),
      endsAt: new Date(Date.now() + 60000).toISOString(),
    });

    // Attempting to add a position must be locked
    const res = await ag
      .post('/api/admin/positions')
      .send({
        nameEn: 'General Secretary',
        nameBn: 'সাধারণ সম্পাদক',
        displayOrder: 2,
        maxSelections: 1,
      })
      .expect(409);

    expect(res.body.error.code).toBe('ELECTION_LOCKED');
  });
});

describe('Voter Roster & CSV Import (FR-04)', () => {
  beforeEach(resetDb);

  it('imports valid voters and reports duplicate/format errors', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    const csvContent = [
      'reg_no,name,email,hall,department',
      '2021-001,Student One,s1@ducsu.test,Salimullah Muslim Hall,CSE',
      '2021-002,Student Two,s2@ducsu.test,Shahidullah Hall,EEE',
      '2021-001,Duplicate Student,dup@ducsu.test,Salimullah Muslim Hall,CSE', // Duplicate reg_no
      '2021-003,Bad Email Student,invalid-email,Jagannath Hall,Physics', // Bad email
    ].join('\n');

    const res = await ag.post('/api/admin/voters/import').send({ csv: csvContent }).expect(200);

    expect(res.body.data.importedCount).toBe(2);
    expect(res.body.data.errorCount).toBe(2);
    expect(res.body.data.errors.length).toBe(2);

    // Verify imported voters in database
    const listRes = await ag.get('/api/admin/voters').expect(200);
    expect(listRes.body.data.total).toBe(2);
  });

  it('allows toggling voter eligibility and logs an audit record', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const voter = await createVoter({ eligible: true });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    const patchRes = await ag
      .patch(`/api/admin/voters/${voter.id}/eligibility`)
      .send({ eligible: false })
      .expect(200);

    expect(patchRes.body.data.eligible).toBe(false);

    // Verify audit log has entry
    const { rows: logs } = await query('SELECT * FROM audit_log WHERE action = $1', ['UPDATE_VOTER_ELIGIBILITY']);
    expect(logs.length).toBe(1);
    expect(logs[0].target).toContain(`voter:${voter.id}:ineligible`);
  });
});

describe('Nomination Review (FR-06)', () => {
  beforeEach(resetDb);

  it('allows EC to approve a pending nomination', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const voter = await createVoter();

    // Create an election, position, and candidate
    const { rows: el } = await query(
      `INSERT INTO elections (title, starts_at, ends_at) VALUES ('DUCSU', now() + interval '1 day', now() + interval '2 days') RETURNING id`
    );
    const { rows: pos } = await query(
      `INSERT INTO positions (election_id, name_en, name_bn, display_order) VALUES ($1, 'VP', 'ভিপি', 1) RETURNING id`,
      [el[0].id]
    );
    const { rows: cand } = await query(
      `INSERT INTO candidates (voter_id, position_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [voter.id, pos[0].id]
    );

    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    const res = await ag
      .patch(`/api/admin/nominations/${cand[0].id}`)
      .send({ status: 'approved' })
      .expect(200);

    expect(res.body.data.status).toBe('approved');
  });

  it('requires a reason when rejecting a candidate nomination', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const voter = await createVoter();

    const { rows: el } = await query(
      `INSERT INTO elections (title, starts_at, ends_at) VALUES ('DUCSU', now() + interval '1 day', now() + interval '2 days') RETURNING id`
    );
    const { rows: pos } = await query(
      `INSERT INTO positions (election_id, name_en, name_bn, display_order) VALUES ($1, 'VP', 'ভিপি', 1) RETURNING id`,
      [el[0].id]
    );
    const { rows: cand } = await query(
      `INSERT INTO candidates (voter_id, position_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
      [voter.id, pos[0].id]
    );

    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    // Rejection without reason must fail with 400
    await ag
      .patch(`/api/admin/nominations/${cand[0].id}`)
      .send({ status: 'rejected' })
      .expect(400);

    // Rejection with reason succeeds
    const successRes = await ag
      .patch(`/api/admin/nominations/${cand[0].id}`)
      .send({ status: 'rejected', rejectionReason: 'Ineligible year of study' })
      .expect(200);

    expect(successRes.body.data.status).toBe('rejected');
    expect(successRes.body.data.rejectionReason).toBe('Ineligible year of study');
  });
});
