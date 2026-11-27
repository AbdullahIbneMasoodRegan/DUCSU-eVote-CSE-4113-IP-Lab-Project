// M1 — NFR-05: security headers, rate limits and audited admin logins.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '../../src/core/db.js';
import { setRateLimitEnabled } from '../../src/core/middleware/rateLimit.js';
import { resetDb, api, agent, createAdmin, createVoter, loginAdmin } from '../helpers.js';

describe('security headers', () => {
  it('sends helmet headers and a strict Content-Security-Policy', async () => {
    const res = await api().get('/api/health').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('rate limits', () => {
  beforeEach(async () => {
    await resetDb();
    setRateLimitEnabled(true);
  });
  afterEach(() => setRateLimitEnabled(false));

  it('limits code requests per registration number, using the EC setting', async () => {
    await query(`INSERT INTO settings (key, value) VALUES ('rateLimit.otpPerRegNoPerHour', '2')`);
    const voter = await createVoter();
    const ask = () => api().post('/api/auth/otp/request').send({ regNo: voter.reg_no });
    await ask().expect(200);
    await ask().expect(200);
    const res = await ask().expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    // A different registration number is not affected.
    await api().post('/api/auth/otp/request').send({ regNo: 'OTHER-1' }).expect(200);
  });

  it('limits admin login attempts per IP address', async () => {
    await query(`INSERT INTO settings (key, value) VALUES ('rateLimit.loginPerIpPer15Minutes', '5')`);
    const login = () => api().post('/api/auth/admin/login').send({ email: 'nobody@example.com', password: 'nope' });
    for (let i = 0; i < 5; i += 1) await login().expect(401);
    const res = await login().expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('admin login audit', () => {
  beforeEach(resetDb);

  it('records successful EC/Observer logins in the audit log', async () => {
    const ec = await createAdmin({ email: 'ec@test.local' });
    await loginAdmin(agent(), ec).expect(200);
    const { rows } = await query(`SELECT actor_type, actor_id, target FROM audit_log WHERE action = 'ADMIN_LOGIN'`);
    expect(rows).toEqual([{ actor_type: 'admin', actor_id: ec.id, target: `admin:${ec.id}` }]);
  });
});
