// M1 — PostgreSQL access. Raw parameterised SQL only; never build SQL by
// string-concatenating user input.
import pg from 'pg';
import config from './config.js';

export const pool = new pg.Pool({
  connectionString: config.db.url,
  ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
  max: config.isTest ? 5 : 10,
});

/** Run one query on the pool. */
export function query(text, params) {
  return pool.query(text, params);
}

/**
 * Run fn(client) inside BEGIN ... COMMIT. Any thrown error rolls back.
 * Use client.query(...) inside fn, e.g. for SELECT ... FOR UPDATE.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** snake_case DB row -> camelCase API object (shallow). */
export function toCamel(row) {
  if (row == null) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) out[camel(k)] = v;
  return out;
}

export const rowsToCamel = (rows) => rows.map(toCamel);

export default { pool, query, withTransaction, toCamel, rowsToCamel };
