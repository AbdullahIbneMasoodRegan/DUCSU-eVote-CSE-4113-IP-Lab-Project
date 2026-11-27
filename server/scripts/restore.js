// M1 — restore a JSON backup made by `npm run backup` (NFR-04).
//
//   npm run restore -- backups/ducsu-evote-<time>.json.gz --yes
//
// REPLACES every row in the database named by DATABASE_URL with the backup's
// rows, in one transaction (all or nothing). Run `npm run migrate` first so the
// schema matches. Without --yes it only prints what it would do.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import config from '../src/core/config.js';
import { pool } from '../src/core/db.js';
import { FORMAT } from './backup.js';

const decode = (v) => (v && typeof v === 'object' && '$b64' in v ? Buffer.from(v.$b64, 'base64') : v);

/** Tables ordered so every table comes after the tables it references. */
async function insertOrder(client, names) {
  const { rows } = await client.query(
    `SELECT DISTINCT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
       FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace`,
  );
  const deps = new Map(names.map((n) => [n, new Set()]));
  for (const { child, parent } of rows) {
    const c = child.replace(/"/g, '');
    const p = parent.replace(/"/g, '');
    if (deps.has(c) && deps.has(p) && c !== p) deps.get(c).add(p);
  }
  const order = [];
  const done = new Set();
  const visit = (n, stack = new Set()) => {
    if (done.has(n)) return;
    if (stack.has(n)) throw new Error(`Circular foreign keys at ${n}`);
    stack.add(n);
    for (const p of deps.get(n)) visit(p, stack);
    done.add(n);
    order.push(n);
  };
  names.forEach((n) => visit(n));
  return order;
}

export async function restoreJson(body) {
  if (body.format !== FORMAT) throw new Error('Not a DUCSU eVote backup file');
  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('BEGIN');
    const { rows: existing } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'pgmigrations'`,
    );
    const live = existing.map((r) => r.tablename);
    const missing = Object.keys(body.tables).filter((t) => t !== 'pgmigrations' && !live.includes(t));
    if (missing.length) throw new Error(`Run migrations first; missing tables: ${missing.join(', ')}`);

    await client.query(`TRUNCATE ${live.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

    for (const table of await insertOrder(client, live)) {
      const data = body.tables[table];
      counts[table] = 0;
      if (!data?.rows.length) continue;
      const cols = data.columns.map((c) => `"${c}"`).join(', ');
      const perBatch = Math.max(1, Math.floor(30_000 / data.columns.length));
      for (let i = 0; i < data.rows.length; i += perBatch) {
        const batch = data.rows.slice(i, i + perBatch);
        const params = [];
        const tuples = batch.map((row) => {
          const ph = row.map((v) => {
            params.push(decode(v));
            return `$${params.length}`;
          });
          return `(${ph.join(', ')})`;
        });
        await client.query(`INSERT INTO "${table}" (${cols}) VALUES ${tuples.join(', ')}`, params);
      }
      counts[table] = data.rows.length;

      // Move serial counters past the restored ids.
      const { rows: serials } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_default LIKE 'nextval(%'`,
        [table],
      );
      for (const { column_name: col } of serials) {
        await client.query(
          `SELECT setval(pg_get_serial_sequence($1, $2), GREATEST((SELECT max("${col}") FROM "${table}"), 1))`,
          [`"${table}"`, col],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return counts;
}

export function readBackup(file) {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
}

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!file) throw new Error('Usage: npm run restore -- <backup.json.gz> --yes');
  const body = readBackup(file);
  const target = new URL(config.db.url).host + new URL(config.db.url).pathname;
  console.log(`Backup from ${body.createdAt} (${body.database})`);
  for (const [t, v] of Object.entries(body.tables)) console.log(`  ${t.padEnd(16)} ${v.rows.length}`);
  if (!process.argv.includes('--yes')) {
    console.log(`\nThis would REPLACE all data in ${target}. Add --yes to do it.`);
    return;
  }
  const counts = await restoreJson(body);
  console.log(`\nRestored ${Object.values(counts).reduce((a, b) => a + b, 0)} rows into ${target}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((err) => {
      console.error(`Restore failed: ${err.message}`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
