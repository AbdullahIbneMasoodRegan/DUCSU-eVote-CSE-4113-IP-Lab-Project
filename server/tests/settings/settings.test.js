// M1 — NFR-09: EC settings page API, settings.get(), and settings taking effect.
import { describe, it, expect, beforeEach } from 'vitest';
import config from '../../src/core/config.js';
import { query } from '../../src/core/db.js';
import settings from '../../src/modules/settings/index.js';
import { resetDb, agent, api, createAdmin, createElection, loginAdmin, createVoter } from '../helpers.js';

async function asEc() {
  const ec = await createAdmin({ email: 'ec@test.local' });
  const ag = agent();
  await loginAdmin(ag, ec).expect(200);
  return ag;
}

const find = (list, key) => list.find((s) => s.key === key);

describe('settings', () => {
  beforeEach(resetDb);

  it('settings.get() falls back to the environment default', async () => {
    expect(await settings.get('otp.ttlMinutes')).toBe(config.otp.ttlMs / 60_000);
    expect(await settings.get('notify.reminderHoursBeforeClose')).toBe(3);
    await expect(settings.get('no.such.key')).rejects.toThrow(/unknown key/);
  });

  it('EC lists every setting with its default and range', async () => {
    const ag = await asEc();
    const res = await ag.get('/api/admin/settings').expect(200);
    const ttl = find(res.body.data.settings, 'otp.ttlMinutes');
    expect(ttl).toMatchObject({ isDefault: true, min: 1, max: 30, unit: 'minutes' });
    expect(res.body.data.locked).toBe(false);
  });

  it('a changed OTP expiry takes effect on the next code request, and is audited', async () => {
    const ag = await asEc();
    const res = await ag.put('/api/admin/settings').send({ values: { 'otp.ttlMinutes': 10 } }).expect(200);
    expect(find(res.body.data.settings, 'otp.ttlMinutes')).toMatchObject({ value: 10, isDefault: false });

    const voter = await createVoter();
    const otp = await api().post('/api/auth/otp/request').send({ regNo: voter.reg_no }).expect(200);
    expect(otp.body.data.expiresInSeconds).toBe(600);
    const { rows } = await query(
      `SELECT extract(epoch FROM expires_at - now()) AS secs FROM otp_codes WHERE voter_id = $1`,
      [voter.id],
    );
    expect(Number(rows[0].secs)).toBeGreaterThan(590);

    const audit = await query(`SELECT target FROM audit_log WHERE action = 'UPDATE_SETTING'`);
    expect(audit.rows[0].target).toBe(`otp.ttlMinutes: ${config.otp.ttlMs / 60_000} -> 10`);
  });

  it('null resets a setting to its default', async () => {
    const ag = await asEc();
    await ag.put('/api/admin/settings').send({ values: { 'session.idleMinutes': 30 } }).expect(200);
    const res = await ag.put('/api/admin/settings').send({ values: { 'session.idleMinutes': null } }).expect(200);
    expect(find(res.body.data.settings, 'session.idleMinutes').isDefault).toBe(true);
    const audit = await query(`SELECT count(*)::int n FROM audit_log WHERE action = 'RESET_SETTING'`);
    expect(audit.rows[0].n).toBe(1);
  });

  it('rejects out-of-range values and unknown keys, saving nothing', async () => {
    const ag = await asEc();
    const bad = await ag
      .put('/api/admin/settings')
      .send({ values: { 'otp.ttlMinutes': 5, 'otp.maxAttempts': 99 } })
      .expect(400);
    expect(bad.body.error).toMatchObject({ code: 'INVALID_SETTING', details: { key: 'otp.maxAttempts' } });
    const unknown = await ag.put('/api/admin/settings').send({ values: { 'x.y': 1 } }).expect(400);
    expect(unknown.body.error.code).toBe('UNKNOWN_SETTING');
    await ag.put('/api/admin/settings').send({ values: { 'otp.ttlMinutes': 2.5 } }).expect(400);
    const { rows } = await query('SELECT count(*)::int n FROM settings');
    expect(rows[0].n).toBe(0);
  });

  it('is locked while voting is open', async () => {
    await createElection({ startsInDays: -1, lengthDays: 2 });
    const ag = await asEc();
    const get = await ag.get('/api/admin/settings').expect(200);
    expect(get.body.data.locked).toBe(true);
    const res = await ag.put('/api/admin/settings').send({ values: { 'otp.ttlMinutes': 10 } }).expect(409);
    expect(res.body.error.code).toBe('SETTINGS_LOCKED');
  });

  it('observers can read but not change; voters and guests cannot read', async () => {
    const obs = await createAdmin({ email: 'obs@test.local', role: 'observer' });
    const ag = agent();
    await loginAdmin(ag, obs).expect(200);
    await ag.get('/api/admin/settings').expect(200);
    await ag.put('/api/admin/settings').send({ values: { 'otp.ttlMinutes': 10 } }).expect(403);
    await api().get('/api/admin/settings').expect(401);
  });
});
