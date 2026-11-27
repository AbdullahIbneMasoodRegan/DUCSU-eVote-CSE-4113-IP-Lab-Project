// M1 — database backup (NFR-04). Run before voting opens and after it closes:
//
//   npm run backup                 -> backups/ducsu-evote-<time>.json.gz
//   npm run backup -- --pg-dump    -> backups/ducsu-evote-<time>.dump (needs pg_dump 18+ on PATH)
//
// The JSON format needs nothing but Node, so it works on any laptop. Restore it
// with `npm run restore -- <file> --yes`. A .dump file restores with pg_restore.
// Backups contain voter emails: they are git-ignored; keep them off shared drives.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import config from '../src/core/config.js';
import { pool } from '../src/core/db.js';

export const BACKUP_DIR = path.join(config.repoRoot, 'backups');
export const FORMAT = 'ducsu-evote-backup/1';

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);

/** Encode values JSON cannot hold (bytea) so restore can rebuild them exactly. */
function encode(value) {
  if (Buffer.isBuffer(value)) return { $b64: value.toString('base64') };
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** Every application table, with its rows. */
export async function dumpTables(client) {
  const { rows: tables } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  const out = {};
  for (const { tablename } of tables) {
    const { rows, fields } = await client.query(`SELECT * FROM "${tablename}"`);
    out[tablename] = {
      columns: fields.map((f) => f.name),
      rows: rows.map((r) => fields.map((f) => encode(r[f.name]))),
    };
  }
  return out;
}

export async function backupJson({ dir = BACKUP_DIR } = {}) {
  const client = await pool.connect();
  let tables;
  try {
    // One consistent snapshot of every table.
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    tables = await dumpTables(client);
    await client.query('COMMIT');
  } finally {
    client.release();
  }
  const body = {
    format: FORMAT,
    createdAt: new Date().toISOString(),
    database: new URL(config.db.url).host, // host only, never the password
    tables,
  };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ducsu-evote-${stamp()}.json.gz`);
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(body)));
  const counts = Object.fromEntries(Object.entries(tables).map(([t, v]) => [t, v.rows.length]));
  return { file, counts };
}

function backupPgDump({ dir = BACKUP_DIR } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ducsu-evote-${stamp()}.dump`);
  const res = spawnSync('pg_dump', ['--format=custom', '--no-owner', `--file=${file}`, config.db.url], {
    stdio: 'inherit',
  });
  if (res.error) throw new Error('pg_dump was not found. Install PostgreSQL client tools, or run without --pg-dump.');
  if (res.status !== 0) throw new Error(`pg_dump failed with exit code ${res.status}`);
  return { file };
}

async function main() {
  const usePgDump = process.argv.includes('--pg-dump');
  const result = usePgDump ? backupPgDump() : await backupJson();
  console.log(`Backup written: ${path.relative(process.cwd(), result.file)}`);
  if (result.counts) {
    for (const [table, n] of Object.entries(result.counts)) console.log(`  ${table.padEnd(16)} ${n}`);
  }
  await pool.end();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (err) => {
    console.error(`Backup failed: ${err.message}`);
    await pool.end();
    process.exit(1);
  });
}
