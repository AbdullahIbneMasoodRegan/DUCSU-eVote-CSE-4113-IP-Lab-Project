// M1 — FR-01 voter OTP login.
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/core/db.js';
import notify from '../../src/modules/notify/index.js';
import {
  api,
  agent,
  resetDb,
  createVoter,
  lastOtp,
  loginVoter,
  makeCandidate,
  sessionCookie,
} from '../helpers.js';

const request = (regNo) => api().post('/api/auth/otp/request').send({ regNo });
const verify = (regNo, code) => api().post('/api/auth/otp/verify').send({ regNo, code });

describe('POST /api/auth/otp/request', () => {
  beforeEach(resetDb);

  it('emails a 6-digit code and stores only its hash', async () => {
    const v = await createVoter();
    const res = await request(v.reg_no).expect(200);
    expect(res.body.data).toMatchObject({ expiresInSeconds: 300, resendAfterSeconds: 60 });

    const code = lastOtp(v.email);
    expect(code).toMatch(/^\d{6}$/);
    const { rows } = await query('SELECT code_hash FROM otp_codes WHERE voter_id = $1', [v.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).not.toContain(code);
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gives unknown and ineligible numbers the same neutral response, and sends nothing', async () => {
    const ok = await createVoter();
    const ineligible = await createVoter({ eligible: false });
    const a = await request(ok.reg_no).expect(200);
    const b = await request(ineligible.reg_no).expect(200);
    const c = await request('NO-SUCH-NUMBER').expect(200);
    expect(b.body).toEqual(a.body);
    expect(c.body).toEqual(a.body);
    expect(notify.outbox.map((m) => m.to)).toEqual([ok.email]);
    const { rows } = await query('SELECT count(*)::int AS n FROM otp_codes');
    expect(rows[0].n).toBe(1);
  });

  it('does not send a new code before the resend interval', async () => {
    const v = await createVoter();
    await request(v.reg_no).expect(200);
    await request(v.reg_no).expect(200);
    expect(notify.outbox).toHaveLength(1);

    // After the interval a new code replaces the old one.
    const first = lastOtp(v.email);
    await query(`UPDATE otp_codes SET created_at = now() - interval '61 seconds'`);
    await request(v.reg_no).expect(200);
    expect(notify.outbox).toHaveLength(2);
    const second = lastOtp(v.email);
    if (first !== second) await verify(v.reg_no, first).expect(400);
    await verify(v.reg_no, second).expect(200);
  });

  it('sends the email in Bangla when asked', async () => {
    const v = await createVoter();
    await api().post('/api/auth/otp/request').send({ regNo: v.reg_no, lang: 'bn' }).expect(200);
    expect(notify.outbox[0].subject).toContain('ডাকসু');
  });

  it('rejects a malformed registration number', async () => {
    const res = await request("x'; DROP TABLE voters;--").expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /api/auth/otp/verify', () => {
  beforeEach(resetDb);

  it('logs the voter in with an HTTP-only session cookie', async () => {
    const v = await createVoter();
    const ag = agent();
    const res = await loginVoter(ag, v);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toMatchObject({ type: 'voter', id: v.id, role: 'voter', regNo: v.reg_no });

    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);

    const me = await ag.get('/api/me').expect(200);
    expect(me.body.data.user.id).toBe(v.id);

    // The OTP row is gone and the stored session id is a hash, not the token.
    const { rows: otp } = await query('SELECT 1 FROM otp_codes');
    expect(otp).toHaveLength(0);
    const token = cookie.split(';')[0].split('=')[1];
    const { rows: s } = await query('SELECT id FROM sessions');
    expect(s).toHaveLength(1);
    expect(s[0].id).not.toBe(token);
  });

  it('accepts a code only once', async () => {
    const v = await createVoter();
    await request(v.reg_no).expect(200);
    const code = lastOtp(v.email);
    await verify(v.reg_no, code).expect(200);
    const again = await verify(v.reg_no, code).expect(400);
    expect(again.body.error.code).toBe('INVALID_CODE');
  });

  it('accepts a code only once even under simultaneous requests', async () => {
    const v = await createVoter();
    await request(v.reg_no).expect(200);
    const code = lastOtp(v.email);
    const results = await Promise.all(Array.from({ length: 8 }, () => verify(v.reg_no, code)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const { rows } = await query('SELECT count(*)::int AS n FROM sessions');
    expect(rows[0].n).toBe(1);
  });

  it('rejects a code after it expires', async () => {
    const v = await createVoter();
    await request(v.reg_no).expect(200);
    await query(`UPDATE otp_codes SET expires_at = now() - interval '1 second'`);
    const res = await verify(v.reg_no, lastOtp(v.email)).expect(400);
    expect(res.body.error.code).toBe('INVALID_CODE');
  });

  it('starts a cooldown after 5 wrong codes', async () => {
    const v = await createVoter();
    await request(v.reg_no).expect(200);
    const code = lastOtp(v.email);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i++) {
      const r = await verify(v.reg_no, wrong).expect(400);
      expect(r.body.error.code).toBe('INVALID_CODE');
    }
    const fifth = await verify(v.reg_no, wrong).expect(429);
    expect(fifth.body.error.code).toBe('OTP_COOLDOWN');
    expect(new Date(fifth.body.error.details.retryAt).getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);

    // Even the right code is now refused, and no new code is sent during cooldown.
    await verify(v.reg_no, code).expect(429);
    await query(`UPDATE otp_codes SET created_at = now() - interval '1 hour'`);
    await request(v.reg_no).expect(200);
    expect(notify.outbox).toHaveLength(1);

    // After the cooldown the voter can log in again.
    await query(`UPDATE voters SET otp_cooldown_until = now() - interval '1 second'`);
    await request(v.reg_no).expect(200);
    await verify(v.reg_no, lastOtp(v.email)).expect(200);
  });

  it('does not log in an ineligible voter', async () => {
    const v = await createVoter();
    await request(v.reg_no).expect(200);
    await query('UPDATE voters SET eligible = false WHERE id = $1', [v.id]);
    await verify(v.reg_no, lastOtp(v.email)).expect(400);
  });

  it('reports the candidate role for a voter who has nominated', async () => {
    const v = await createVoter();
    await makeCandidate(v.id);
    const res = await loginVoter(agent(), v);
    expect(res.body.data.user.role).toBe('candidate');
  });
});
