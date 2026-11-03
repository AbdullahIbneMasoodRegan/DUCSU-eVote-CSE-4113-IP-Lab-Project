// M1 — requireAuth / requireRole / validate / error shape.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { z } from 'zod';
import config from '../../src/core/config.js';
import { requireAuth, requireRole } from '../../src/core/middleware/auth.js';
import { validate } from '../../src/core/middleware/validate.js';
import { errorHandler } from '../../src/core/middleware/errorHandler.js';
import { api, agent, resetDb, createAdmin, createVoter, loginVoter, makeCandidate } from '../helpers.js';

// A tiny app that uses the guards exactly the way module routers will.
const t = express();
t.use(express.json());
t.use(cookieParser());
t.get('/any', requireAuth, (req, res) => res.json({ data: req.user }));
t.get('/ec', requireRole('ec'), (req, res) => res.json({ data: req.user }));
t.get('/staff', requireRole('ec', 'observer'), (req, res) => res.json({ data: req.user }));
t.get('/voter', requireRole('voter'), (req, res) => res.json({ data: req.user }));
t.get('/candidate', requireRole('candidate'), (req, res) => res.json({ data: req.user }));
t.post(
  '/items/:id',
  validate({
    params: z.object({ id: z.coerce.number().int() }),
    query: z.object({ dry: z.enum(['0', '1']).default('0') }),
    body: z.object({ name: z.string().min(1) }),
  }),
  (req, res) => res.json({ data: { id: req.params.id, dry: req.query.dry, body: req.body } }),
);
t.use(errorHandler);

/** Copy the session cookie from a real login onto requests to the test app. */
const cookieOf = (res) => res.headers['set-cookie'][0].split(';')[0];

describe('requireAuth / requireRole', () => {
  beforeEach(resetDb);

  it('rejects anonymous requests with 401', async () => {
    const res = await request(t).get('/ec').expect(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
  });

  it('enforces roles', async () => {
    const ec = await createAdmin({ email: 'ec@x.test', role: 'ec' });
    const ob = await createAdmin({ email: 'ob@x.test', role: 'observer' });
    const ecCookie = cookieOf(
      await api().post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }),
    );
    const obCookie = cookieOf(
      await api().post('/api/auth/admin/login').send({ email: ob.email, password: ob.password }),
    );

    const ecUser = await request(t).get('/ec').set('Cookie', ecCookie).expect(200);
    expect(ecUser.body.data).toEqual({ type: 'admin', id: ec.id, role: 'ec' });
    await request(t).get('/ec').set('Cookie', obCookie).expect(403);
    await request(t).get('/staff').set('Cookie', obCookie).expect(200);
    await request(t).get('/voter').set('Cookie', ecCookie).expect(403);
  });

  it('treats candidates as voters, but not voters as candidates', async () => {
    const voter = await createVoter();
    const cand = await createVoter();
    await makeCandidate(cand.id);
    const vCookie = cookieOf(await loginVoter(agent(), voter));
    const cCookie = cookieOf(await loginVoter(agent(), cand));

    await request(t).get('/voter').set('Cookie', vCookie).expect(200);
    await request(t).get('/candidate').set('Cookie', vCookie).expect(403);
    const c = await request(t).get('/candidate').set('Cookie', cCookie).expect(200);
    expect(c.body.data.role).toBe('candidate');
    await request(t).get('/voter').set('Cookie', cCookie).expect(200);
  });

  it('throws on an unknown role name at startup', () => {
    expect(() => requireRole('admin')).toThrow(/unknown role/);
  });
});

describe('x-dev-user header', () => {
  afterEach(() => {
    config.devUserHeader = false;
  });

  it('is ignored unless enabled (development only)', async () => {
    await request(t).get('/any').set('x-dev-user', 'ec:1').expect(401);
  });

  it('sets req.user when enabled', async () => {
    config.devUserHeader = true;
    const a = await request(t).get('/ec').set('x-dev-user', 'ec:1').expect(200);
    expect(a.body.data).toEqual({ type: 'admin', id: 1, role: 'ec' });
    const b = await request(t).get('/voter').set('x-dev-user', 'voter:12').expect(200);
    expect(b.body.data).toEqual({ type: 'voter', id: 12, role: 'voter' });
    await request(t).get('/ec').set('x-dev-user', 'voter:12').expect(403);
    await request(t).get('/any').set('x-dev-user', 'root:1').expect(401);
  });
});

describe('validate()', () => {
  it('passes parsed values to the handler', async () => {
    const res = await request(t).post('/items/7?dry=1').send({ name: 'x', extra: 1 }).expect(200);
    expect(res.body.data).toEqual({ id: 7, dry: '1', body: { name: 'x' } });
  });

  it('returns VALIDATION_ERROR with details', async () => {
    const res = await request(t).post('/items/abc').send({}).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.map((d) => d.path)).toContain('id');
  });
});

describe('API error shape', () => {
  it('404s unknown API routes in the standard shape', async () => {
    const res = await api().get('/api/nope').expect(404);
    expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('rejects malformed JSON', async () => {
    const res = await api()
      .post('/api/auth/admin/login')
      .set('Content-Type', 'application/json')
      .send('{bad json')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  it('answers the health check', async () => {
    const res = await api().get('/api/health').expect(200);
    expect(res.body.data.status).toBe('ok');
  });
});
