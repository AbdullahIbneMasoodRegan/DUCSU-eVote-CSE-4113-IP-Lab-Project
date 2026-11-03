// Shared test helpers (M1). Other members may import these; add your own
// helpers in your own tests/<module>/ folder.
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { query } from '../src/core/db.js';
import { createApp } from '../src/app.js';
import notify from '../src/modules/notify/index.js';

export const app = createApp();
export const api = () => request(app);
export const agent = () => request.agent(app);

/** Empty every application table (keeps the migrations table). */
export async function resetDb() {
  const { rows } = await query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`,
  );
  if (rows.length) {
    await query(
      `TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`,
    );
  }
  notify.outbox.length = 0;
}

let voterSeq = 0;
export async function createVoter(overrides = {}) {
  voterSeq += 1;
  const v = {
    reg_no: `T-${Date.now() % 100000}-${voterSeq}`,
    name: `Test Voter ${voterSeq}`,
    email: `voter${voterSeq}@test.ducsu-evote.test`,
    hall: 'Test Hall',
    department: 'CSE',
    eligible: true,
    ...overrides,
  };
  const { rows } = await query(
    `INSERT INTO voters (reg_no, name, email, hall, department, eligible)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [v.reg_no, v.name, v.email, v.hall, v.department, v.eligible],
  );
  return rows[0];
}

export async function createAdmin({ email, password = 'secret-pass', role = 'ec', name = 'Admin' }) {
  const { rows } = await query(
    `INSERT INTO admin_users (email, password_hash, role, name) VALUES ($1, $2, $3, $4) RETURNING *`,
    [email, await bcrypt.hash(password, 4), role, name],
  );
  return { ...rows[0], password };
}

/** Make a voter a candidate (minimal election + position + candidate rows). */
export async function makeCandidate(voterId) {
  const { rows: e } = await query(
    `INSERT INTO elections (title, starts_at, ends_at)
     VALUES ('Test', now() + interval '1 day', now() + interval '2 days') RETURNING id`,
  );
  const { rows: p } = await query(
    `INSERT INTO positions (election_id, name_en, name_bn, display_order)
     VALUES ($1, 'VP', 'ভিপি', 1) RETURNING id`,
    [e[0].id],
  );
  await query(`INSERT INTO candidates (voter_id, position_id) VALUES ($1, $2)`, [voterId, p[0].id]);
}

/** The 6-digit code from the most recent OTP email to `to`. */
export function lastOtp(to) {
  const mail = [...notify.outbox].reverse().find((m) => m.to === to && m.template === 'otp');
  return mail?.data.code;
}

/** Request + verify an OTP with the given agent; returns the response. */
export async function loginVoter(ag, voter) {
  await ag.post('/api/auth/otp/request').send({ regNo: voter.reg_no }).expect(200);
  return ag.post('/api/auth/otp/verify').send({ regNo: voter.reg_no, code: lastOtp(voter.email) });
}

export const sessionCookie = (res) =>
  (res.headers['set-cookie'] ?? []).find((c) => c.startsWith('sid='));
