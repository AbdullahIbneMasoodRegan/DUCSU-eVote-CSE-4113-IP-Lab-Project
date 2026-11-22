// M2 — Audit Log & Hash Chaining Integrity Tests (FR-16).
import crypto from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import { query } from '../../src/core/db.js';
import { api, agent, resetDb, createAdmin } from '../helpers.js';
import { record } from '../../src/modules/audit/index.js';

describe('Audit Log (FR-16)', () => {
  beforeEach(resetDb);

  it('records admin actions with chained SHA-256 hashes', async () => {
    const mockReq1 = {
      user: { type: 'admin', id: 1, role: 'ec' },
      ip: '127.0.0.1',
    };
    const row1 = await record(mockReq1, 'CREATE_ELECTION', 'election:1');
    expect(row1.prev_hash).toBe('GENESIS');
    expect(row1.hash).toBeDefined();

    const mockReq2 = {
      user: { type: 'admin', id: 2, role: 'observer' },
      ip: '127.0.0.1',
    };
    const row2 = await record(mockReq2, 'VIEW_TURNOUT', 'turnout:live');
    expect(row2.prev_hash).toBe(row1.hash);

    // Verify hash computation
    const expectedPayload = `admin|2|VIEW_TURNOUT|turnout:live|127.0.0.1`;
    const expectedHash = crypto.createHash('sha256').update(row1.hash + expectedPayload).digest('hex');
    expect(row2.hash).toBe(expectedHash);
  });

  it('detects tampering when an entry or hash is altered', async () => {
    const mockReq = {
      user: { type: 'admin', id: 1, role: 'ec' },
      ip: '127.0.0.1',
    };
    const r1 = await record(mockReq, 'ACTION_1', 'target:1');
    await record(mockReq, 'ACTION_2', 'target:2');

    // Tamper with action of row 1 directly in DB
    await query('UPDATE audit_log SET action = $1 WHERE id = $2', ['TAMPERED_ACTION', r1.id]);

    const { rows } = await query('SELECT * FROM audit_log ORDER BY id ASC');
    const tamperedPayload = `${rows[0].actor_type}|${rows[0].actor_id}|${rows[0].action}|${rows[0].target}|${rows[0].ip}`;
    const recomputedHash = crypto.createHash('sha256').update(rows[0].prev_hash + tamperedPayload).digest('hex');

    // Hash mismatch proves tampering
    expect(recomputedHash).not.toBe(rows[0].hash);
  });

  it('restricts /api/audit to EC and Observer roles only', async () => {
    const ec = await createAdmin({ email: 'ec@test.local', role: 'ec' });
    const ag = agent();
    await ag.post('/api/auth/admin/login').send({ email: ec.email, password: ec.password }).expect(200);

    // EC can access
    const res = await ag.get('/api/audit').expect(200);
    expect(res.body.data.logs).toBeDefined();

    // Anonymous cannot access
    await api().get('/api/audit').expect(401);
  });
});
