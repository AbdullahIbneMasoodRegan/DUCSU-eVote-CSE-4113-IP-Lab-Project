// M1 — FR-02 admin login, sessions, logout and inactivity timeout.
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/core/db.js';
import { api, agent, resetDb, createAdmin, createVoter, loginVoter } from '../helpers.js';

const login = (ag, email, password) =>
  ag.post('/api/auth/admin/login').send({ email, password });

describe('admin login', () => {
  beforeEach(resetDb);

  it('logs in EC and Observer with their roles', async () => {
    const ec = await createAdmin({ email: 'ec@x.test', role: 'ec', name: 'EC' });
    const ob = await createAdmin({ email: 'ob@x.test', role: 'observer', name: 'Obs' });

    const a = await login(agent(), ec.email, ec.password).expect(200);
    expect(a.body.data.user).toMatchObject({ type: 'admin', role: 'ec', email: 'ec@x.test' });

    // Email match is case-insensitive.
    const b = await login(agent(), 'OB@X.TEST', ob.password).expect(200);
    expect(b.body.data.user.role).toBe('observer');
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const ec = await createAdmin({ email: 'ec@x.test' });
    const wrong = await login(api(), ec.email, 'nope').expect(401);
    const unknown = await login(api(), 'who@x.test', 'nope').expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(wrong.headers['set-cookie']).toBeUndefined();
  });

  it('validates the body', async () => {
    const res = await api().post('/api/auth/admin/login').send({ email: 'x' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('sessions', () => {
  beforeEach(resetDb);

  it('requires a session for /api/me', async () => {
    const res = await api().get('/api/me').expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('logout deletes the server-side session, so the old cookie stops working', async () => {
    const ec = await createAdmin({ email: 'ec@x.test' });
    const ag = agent();
    const res = await login(ag, ec.email, ec.password).expect(200);
    const oldCookie = res.headers['set-cookie'][0].split(';')[0];

    await ag.get('/api/me').expect(200);
    await ag.post('/api/auth/logout').expect(200);
    await ag.get('/api/me').expect(401);
    // Replaying the stolen cookie does not work either.
    await api().get('/api/me').set('Cookie', oldCookie).expect(401);
    const { rows } = await query('SELECT count(*)::int AS n FROM sessions');
    expect(rows[0].n).toBe(0);
  });

  it('expires a session after 15 minutes of inactivity', async () => {
    const v = await createVoter();
    const ag = agent();
    await loginVoter(ag, v);
    await query(`UPDATE sessions SET last_seen_at = now() - interval '14 minutes'`);
    await ag.get('/api/me').expect(200); // activity resets the timer
    await query(`UPDATE sessions SET last_seen_at = now() - interval '16 minutes'`);
    const res = await ag.get('/api/me').expect(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
    const { rows } = await query('SELECT count(*)::int AS n FROM sessions');
    expect(rows[0].n).toBe(0);
  });

  it('expires a session at its absolute expiry time', async () => {
    const ec = await createAdmin({ email: 'ec@x.test' });
    const ag = agent();
    await login(ag, ec.email, ec.password).expect(200);
    await query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);
    const res = await ag.get('/api/me').expect(401);
    expect(res.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('logging in again replaces the previous session in that browser', async () => {
    const ec = await createAdmin({ email: 'ec@x.test' });
    const ag = agent();
    await login(ag, ec.email, ec.password).expect(200);
    await login(ag, ec.email, ec.password).expect(200);
    const { rows } = await query('SELECT count(*)::int AS n FROM sessions');
    expect(rows[0].n).toBe(1);
  });

  it('ignores a garbage cookie', async () => {
    await api().get('/api/me').set('Cookie', 'sid=garbage').expect(401);
  });
});
