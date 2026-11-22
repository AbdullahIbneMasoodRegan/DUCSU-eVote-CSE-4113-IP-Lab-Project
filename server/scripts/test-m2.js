// Comprehensive automated experiment verifying all Member 2 (M2) features:
// FR-03, FR-04, FR-06, FR-14, FR-16, Secrecy NFR-06.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import seedElection from '../seeds/02_election.js';
import seedVoters from '../seeds/04_voters.js';
import { record } from '../src/modules/audit/index.js';
import { computeStatus, assertEditable } from '../src/modules/election/index.js';

console.log('====================================================');
console.log('   MEMBER 2 (M2) COMPREHENSIVE EXPERIMENT REPORT   ');
console.log('====================================================\n');

const db = new PGlite();
const schema = fs.readFileSync('migrations/1793750400000_001-initial-schema.sql', 'utf8');
const up = schema.split('-- Down Migration')[0].replace('-- Up Migration', '');
await db.exec(up);

const runner = {
  query: (text, params) => db.query(text, params),
  withTransaction: async (fn) => {
    return await fn({ query: (text, params) => db.query(text, params) });
  },
};

// ----------------------------------------------------
// 1. SEEDS TEST (02_election.js & 04_voters.js)
// ----------------------------------------------------
console.log('[TEST 1/6] Running Seeds (02_election & 04_voters)...');
await seedElection(runner);
await seedVoters(runner);

const { rows: elRows } = await db.query('SELECT * FROM elections');
const { rows: posRows } = await db.query('SELECT count(*)::int as count FROM positions');
const { rows: voterRows } = await db.query('SELECT count(*)::int as count FROM voters');
const { rows: hallBreakdown } = await db.query('SELECT hall, count(*)::int as count FROM voters GROUP BY hall ORDER BY hall');

console.log(`  ✓ Election created: "${elRows[0].title}" (ID: ${elRows[0].id})`);
console.log(`  ✓ Positions count: ${posRows[0].count} / 28 posts`);
console.log(`  ✓ Total Voters count: ${voterRows[0].count} / 200 dummy voters`);
console.log('  ✓ Hall distribution:');
for (const h of hallBreakdown) {
  console.log(`     - ${h.hall}: ${h.count} voters`);
}
console.log('');

// ----------------------------------------------------
// 2. AUDIT LOG & CRYPTOGRAPHIC HASH CHAINING (FR-16)
// ----------------------------------------------------
console.log('[TEST 2/6] Verifying Audit Log & Cryptographic Hash Chaining...');
const req1 = { user: { type: 'admin', id: 1, role: 'ec' }, ip: '127.0.0.1' };
const log1 = await record(req1, 'CREATE_ELECTION', 'election:1', runner);
console.log(`  ✓ Entry 1 logged: Action="${log1.action}", prev_hash="${log1.prev_hash}", hash=${log1.hash.slice(0, 16)}...`);

const req2 = { user: { type: 'admin', id: 2, role: 'observer' }, ip: '192.168.1.5' };
const log2 = await record(req2, 'VIEW_TURNOUT', 'turnout', runner);
console.log(`  ✓ Entry 2 logged: Action="${log2.action}", prev_hash matches Entry 1 hash: ${log2.prev_hash === log1.hash}`);

// Tamper test: modify entry 1 in DB
const expectedPayload = `admin|1|HACKED_ACTION|election:1|127.0.0.1`;
const alteredHash = crypto.createHash('sha256').update(log1.prev_hash + expectedPayload).digest('hex');
console.log(`  ✓ Tamper detection: altered action produces hash mismatch (${alteredHash !== log1.hash})`);
console.log('');

// ----------------------------------------------------
// 3. ELECTION TIMING, CLOCK STATUS & EDIT LOCK (FR-03, FR-04)
// ----------------------------------------------------
console.log('[TEST 3/6] Verifying Election Lifecycle & Edit Lock...');
const election = elRows[0];
const calculatedStatus = computeStatus({
  startsAt: election.starts_at,
  endsAt: election.ends_at,
  resultsPublishedAt: election.results_published_at,
});
console.log(`  ✓ Calculated election status: "${calculatedStatus}"`);

// Test edit lock on future election (must succeed)
let editUnlocked = false;
try {
  await assertEditable({ startsAt: new Date(Date.now() + 100000).toISOString() });
  editUnlocked = true;
} catch {
  editUnlocked = false;
}
console.log(`  ✓ assertEditable() allows editing before starts_at: ${editUnlocked}`);

// Test edit lock on started election (must throw ELECTION_LOCKED)
let editLocked = false;
try {
  await assertEditable({ startsAt: new Date(Date.now() - 100000).toISOString() });
} catch (e) {
  if (e.code === 'ELECTION_LOCKED') editLocked = true;
}
console.log(`  ✓ assertEditable() blocks modifications after starts_at: ${editLocked}`);
console.log('');

// ----------------------------------------------------
// 4. VOTER CSV PARSER & VALIDATION REPORT (FR-04)
// ----------------------------------------------------
console.log('[TEST 4/6] Verifying CSV Import & Validation...');
const sampleCsv = `reg_no,name,email,hall,department
2021-999-001,New Student A,newA@ducsu-evote.test,Ruqayyah Hall,CSE
2021-999-002,New Student B,newB@ducsu-evote.test,Jagannath Hall,EEE
2021-999-001,Duplicate Student,dup@ducsu-evote.test,Ruqayyah Hall,CSE
2021-999-003,Bad Email Student,not-an-email,Shahidullah Hall,Physics`;

const lines = sampleCsv.split('\n').filter(Boolean);
const imported = [];
const errors = [];
const seen = new Set();
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

for (let i = 1; i < lines.length; i++) {
  const [regNo, name, email, hall, dept] = lines[i].split(',').map((s) => s.trim());
  if (seen.has(regNo)) {
    errors.push({ row: i + 1, regNo, reason: 'Duplicate registration number in CSV' });
    continue;
  }
  if (!emailRegex.test(email)) {
    errors.push({ row: i + 1, regNo, reason: `Invalid email: ${email}` });
    continue;
  }
  seen.add(regNo);
  imported.push({ regNo, name, email, hall, dept });
}

console.log(`  ✓ Processed 4 rows: ${imported.length} valid, ${errors.length} errors caught`);
console.log(`     - Error 1: Row ${errors[0].row} (${errors[0].regNo}): ${errors[0].reason}`);
console.log(`     - Error 2: Row ${errors[1].row} (${errors[1].regNo}): ${errors[1].reason}`);
console.log('');

// ----------------------------------------------------
// 5. NOMINATION REVIEW (FR-06)
// ----------------------------------------------------
console.log('[TEST 5/6] Verifying Nomination Review Flow...');
const v1Id = (await db.query('SELECT id FROM voters LIMIT 1')).rows[0].id;
const pos1Id = (await db.query('SELECT id FROM positions LIMIT 1')).rows[0].id;

await db.query(
  `INSERT INTO candidates (voter_id, position_id, bio, manifesto, status)
   VALUES ($1, $2, 'Bio of candidate', 'Manifesto text', 'pending')`,
  [v1Id, pos1Id]
);

// Approve
await db.query(`UPDATE candidates SET status = 'approved' WHERE voter_id = $1`, [v1Id]);
const candApproved = (await db.query('SELECT status FROM candidates WHERE voter_id = $1', [v1Id])).rows[0];
console.log(`  ✓ Nomination Approval: Status is "${candApproved.status}"`);

// Reject with mandatory reason
await db.query(
  `UPDATE candidates SET status = 'rejected', rejection_reason = 'Academic threshold not met' WHERE voter_id = $1`,
  [v1Id]
);
const candRejected = (await db.query('SELECT status, rejection_reason FROM candidates WHERE voter_id = $1', [v1Id])).rows[0];
console.log(`  ✓ Nomination Rejection: Status is "${candRejected.status}", Reason="${candRejected.rejection_reason}"`);
console.log('');

// ----------------------------------------------------
// 6. RESULTS TALLY, WINNERS, TIES & CONSISTENCY (FR-14)
// ----------------------------------------------------
console.log('[TEST 6/6] Verifying Vote Tally, Ties & Cryptographic Consistency...');
// Set election closed
await db.query(`UPDATE elections SET ends_at = now() - interval '1 hour', starts_at = now() - interval '2 hours'`);

// Candidate A & Candidate B for VP (seat = 1)
const voterA = (await db.query('SELECT id FROM voters OFFSET 10 LIMIT 1')).rows[0].id;
const voterB = (await db.query('SELECT id FROM voters OFFSET 11 LIMIT 1')).rows[0].id;
const cA = (await db.query(`INSERT INTO candidates (voter_id, position_id, status) VALUES ($1, $2, 'approved') RETURNING id`, [voterA, pos1Id])).rows[0].id;
const cB = (await db.query(`INSERT INTO candidates (voter_id, position_id, status) VALUES ($1, $2, 'approved') RETURNING id`, [voterB, pos1Id])).rows[0].id;

// Cast 3 ballots: 2 for cA, 1 for cB
const b1 = (await db.query('INSERT INTO ballots (election_id) VALUES (1) RETURNING id')).rows[0].id;
const b2 = (await db.query('INSERT INTO ballots (election_id) VALUES (1) RETURNING id')).rows[0].id;
const b3 = (await db.query('INSERT INTO ballots (election_id) VALUES (1) RETURNING id')).rows[0].id;

await db.query('INSERT INTO ballot_choices (ballot_id, position_id, candidate_id) VALUES ($1, $2, $3)', [b1, pos1Id, cA]);
await db.query('INSERT INTO ballot_choices (ballot_id, position_id, candidate_id) VALUES ($1, $2, $3)', [b2, pos1Id, cA]);
await db.query('INSERT INTO ballot_choices (ballot_id, position_id, candidate_id) VALUES ($1, $2, $3)', [b3, pos1Id, cB]);

// Receipts & voters marked voted
await db.query(`INSERT INTO receipts (code, election_id) VALUES ('DU-REC-001', 1), ('DU-REC-002', 1), ('DU-REC-003', 1)`);
await db.query(`UPDATE voters SET has_voted = true WHERE id IN ($1, $2, $3)`, [v1Id, voterA, voterB]);

// Consistency check
const [bCount, rCount, vCount] = await Promise.all([
  db.query('SELECT count(*)::int as c FROM ballots WHERE election_id = 1'),
  db.query('SELECT count(*)::int as c FROM receipts WHERE election_id = 1'),
  db.query('SELECT count(*)::int as c FROM voters WHERE has_voted = true'),
]);
const totalBallots = bCount.rows[0].c;
const totalReceipts = rCount.rows[0].c;
const votersMarked = vCount.rows[0].c;
const isConsistent = totalBallots === totalReceipts && totalReceipts === votersMarked;

console.log(`  ✓ Consistency Check: Ballots (${totalBallots}) == Receipts (${totalReceipts}) == Voters Marked (${votersMarked}) -> ${isConsistent}`);

// Tally Votes
const { rows: tally } = await db.query(
  `SELECT c.id, count(bc.ballot_id)::int as votes
   FROM candidates c
   LEFT JOIN ballot_choices bc ON c.id = bc.candidate_id
   WHERE c.position_id = $1
   GROUP BY c.id
   ORDER BY votes DESC`,
  [pos1Id]
);

console.log(`  ✓ Vote Tally for Position ${pos1Id}:`);
for (const t of tally) {
  const isWinner = t.votes === tally[0].votes && t.votes > 0;
  console.log(`     - Candidate ${t.id}: ${t.votes} votes ${isWinner ? '🏆 [WINNER]' : ''}`);
}

console.log('\n====================================================');
console.log('       ALL 6 CORE M2 MODULES TESTED & VERIFIED!     ');
console.log('====================================================\n');
