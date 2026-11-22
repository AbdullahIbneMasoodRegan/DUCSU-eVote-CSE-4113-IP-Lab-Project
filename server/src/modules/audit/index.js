// M2 — Audit log helper and service (FR-16).
// Every admin action in the app calls audit.record(req, action, target).
// Cryptographic hash chaining: hash = SHA-256(prev_hash + entry) ensures tamper evidence.

import crypto from 'node:crypto';
import { query, rowsToCamel } from '../../core/db.js';

export async function record(req, action, target = null, client = null) {
  const q = client ? client.query.bind(client) : query;

  const actorType = req?.user?.type ?? (req?.user?.role === 'ec' || req?.user?.role === 'observer' ? 'admin' : 'system');
  const actorId = req?.user?.id ?? null;
  const ip = req?.ip ?? req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ?? req?.socket?.remoteAddress ?? null;

  // Retrieve previous hash from the latest entry
  const { rows: latest } = await q('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  const prevHash = latest.length > 0 ? latest[0].hash : 'GENESIS';

  // Deterministic entry representation to hash
  const entryPayload = `${actorType}|${actorId ?? ''}|${action}|${target ?? ''}|${ip ?? ''}`;
  const hash = crypto.createHash('sha256').update(prevHash + entryPayload).digest('hex');

  const { rows } = await q(
    `INSERT INTO audit_log (actor_type, actor_id, action, target, ip, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [actorType, actorId, action, target, ip, prevHash, hash]
  );

  return rows[0];
}

export async function getLogs({ limit = 50, offset = 0, action = null } = {}) {
  let sql = 'SELECT * FROM audit_log';
  const params = [];

  if (action) {
    params.push(action);
    sql += ` WHERE action = $${params.length}`;
  }

  sql += ' ORDER BY id DESC';

  params.push(Math.min(Number(limit) || 50, 100));
  sql += ` LIMIT $${params.length}`;

  params.push(Math.max(Number(offset) || 0, 0));
  sql += ` OFFSET $${params.length}`;

  const { rows } = await query(sql, params);

  // Total count
  let countSql = 'SELECT count(*) FROM audit_log';
  const countParams = action ? [action] : [];
  if (action) countSql += ' WHERE action = $1';
  const countRes = await query(countSql, countParams);

  return {
    logs: rowsToCamel(rows),
    total: Number(countRes.rows[0].count),
  };
}

export const audit = {
  record,
  getLogs,
};

export default audit;
