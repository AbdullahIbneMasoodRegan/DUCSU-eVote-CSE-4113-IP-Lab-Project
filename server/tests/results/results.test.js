// M2 — Results Calculation, Seat Limits, Ties, and Consistency Checks (FR-14).
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/core/db.js';
import { api, agent, resetDb, createAdmin, createVoter } from '../helpers.js';

describe('Results Calculation & Tally (FR-14)', () => {
  beforeEach(resetDb);

  it('blocks result calculation if voting is still open (before ends_at)', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    // Election that ends in the future
    await query(
      `INSERT INTO elections (title, starts_at, ends_at)
       VALUES ('Open Election', now() - interval '1 hour', now() + interval '1 hour')`
    );

    const res = await ag.post('/api/results/calculate').expect(409);
    expect(res.body.error.code).toBe('VOTING_STILL_OPEN');
  });

  it('calculates winners and detects ties correctly after voting closes', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    // Concluded election
    const { rows: el } = await query(
      `INSERT INTO elections (title, starts_at, ends_at)
       VALUES ('Closed Election', now() - interval '2 hours', now() - interval '1 hour') RETURNING id`
    );
    const electionId = el[0].id;

    // Position 1: VP (1 seat)
    const { rows: posVP } = await query(
      `INSERT INTO positions (election_id, name_en, name_bn, display_order, max_selections)
       VALUES ($1, 'VP', 'ভিপি', 1, 1) RETURNING id`,
      [electionId]
    );

    // Position 2: Member (1 seat, will test tie)
    const { rows: posMem } = await query(
      `INSERT INTO positions (election_id, name_en, name_bn, display_order, max_selections)
       VALUES ($1, 'Member', 'সদস্য', 2, 1) RETURNING id`,
      [electionId]
    );

    // Candidates
    const v1 = await createVoter();
    const v2 = await createVoter();
    const v3 = await createVoter();
    const v4 = await createVoter();

    const { rows: candA } = await query(
      `INSERT INTO candidates (voter_id, position_id, status) VALUES ($1, $2, 'approved') RETURNING id`,
      [v1.id, posVP[0].id]
    );
    const { rows: candB } = await query(
      `INSERT INTO candidates (voter_id, position_id, status) VALUES ($1, $2, 'approved') RETURNING id`,
      [v2.id, posVP[0].id]
    );
    const { rows: candC } = await query(
      `INSERT INTO candidates (voter_id, position_id, status) VALUES ($1, $2, 'approved') RETURNING id`,
      [v3.id, posMem[0].id]
    );
    const { rows: candD } = await query(
      `INSERT INTO candidates (voter_id, position_id, status) VALUES ($1, $2, 'approved') RETURNING id`,
      [v4.id, posMem[0].id]
    );

    // Cast dummy ballots in ballot_choices
    // Ballot 1 & 2 vote for candA, Ballot 3 votes for candB
    const { rows: b1 } = await query('INSERT INTO ballots (election_id) VALUES ($1) RETURNING id', [electionId]);
    const { rows: b2 } = await query('INSERT INTO ballots (election_id) VALUES ($1) RETURNING id', [electionId]);
    const { rows: b3 } = await query('INSERT INTO ballots (election_id) VALUES ($1) RETURNING id', [electionId]);

    // Votes for VP: Cand A gets 2 votes, Cand B gets 1 vote
    await query('INSERT INTO ballot_choices (ballot_id, position_id, candidate_id) VALUES ($1, $2, $3)', [b1[0].id, posVP[0].id, candA[0].id]);
    await query('INSERT INTO ballot_choices (ballot_id, position_id, candidate_id) VALUES ($1, $2, $3)', [b2[0].id, posVP[0].id, candA[0].id]);
    await query('INSERT INTO ballot_choices (ballot_id, position_id, candidate_id) VALUES ($1, $2, $3)', [b3[0].id, posVP[0].id, candB[0].id]);

    // Votes for Member: Cand C gets 1 vote, Cand D gets 1 vote (TIE!)
    await query('INSERT INTO ballot_choices (ballot_id, position_id, candidate_id) VALUES ($1, $2, $3)', [b1[0].id, posMem[0].id, candC[0].id]);
    await query('INSERT INTO ballot_choices (ballot_id, position_id, candidate_id) VALUES ($1, $2, $3)', [b2[0].id, posMem[0].id, candD[0].id]);

    // Calculate
    const calcRes = await ag.post('/api/results/calculate').expect(200);
    expect(calcRes.body.data.calculatedResultsCount).toBe(4);

    // Fetch results
    const resultsRes = await ag.get('/api/results').expect(200);
    const positions = resultsRes.body.data.positions;

    const vpPos = positions.find((p) => p.positionId === posVP[0].id);
    const memPos = positions.find((p) => p.positionId === posMem[0].id);

    // VP: candA should be winner with 2 votes
    const winnerVP = vpPos.candidates.find((c) => c.candidateId === candA[0].id);
    expect(winnerVP.isWinner).toBe(true);
    expect(winnerVP.votes).toBe(2);

    // Member: candC and candD tie with 1 vote each
    const c1 = memPos.candidates.find((c) => c.candidateId === candC[0].id);
    const c2 = memPos.candidates.find((c) => c.candidateId === candD[0].id);
    expect(c1.tieFlag).toBe(true);
    expect(c2.tieFlag).toBe(true);
    expect(c1.isWinner).toBe(false);
    expect(c2.isWinner).toBe(false);
  });

  it('validates cryptographic consistency check (ballots == receipts == voters marked voted)', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    const { rows: el } = await query(
      `INSERT INTO elections (title, starts_at, ends_at)
       VALUES ('E1', now() - interval '2 hours', now() - interval '1 hour') RETURNING id`
    );
    const electionId = el[0].id;

    // 2 ballots, 2 receipts, 2 voters marked as has_voted
    await query('INSERT INTO ballots (election_id) VALUES ($1), ($1)', [electionId]);
    await query('INSERT INTO receipts (code, election_id) VALUES ($1, $3), ($2, $3)', ['REC-1', 'REC-2', electionId]);
    await query(`INSERT INTO voters (reg_no, name, email, hall, department, has_voted) VALUES
      ('R1', 'N1', 'e1@x.test', 'H1', 'D1', true),
      ('R2', 'N2', 'e2@x.test', 'H1', 'D1', true)`);

    const res = await ag.get('/api/results').expect(200);
    expect(res.body.data.consistency).toEqual({
      totalBallots: 2,
      totalReceipts: 2,
      votersMarkedVoted: 2,
      isConsistent: true,
    });
  });

  it('enforces access control: public cannot view results until published', async () => {
    await query(
      `INSERT INTO elections (title, starts_at, ends_at)
       VALUES ('E1', now() - interval '2 hours', now() - interval '1 hour') RETURNING id`
    );

    // Public request before publish -> 403
    await api().get('/api/results').expect(403);

    // EC publishes results
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    await ag.post('/api/results/publish').expect(200);

    // Public request after publish -> 200
    const publicRes = await api().get('/api/results').expect(200);
    expect(publicRes.body.data.election.resultsPublishedAt).toBeDefined();
  });
});
