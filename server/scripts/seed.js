// M1 — runs every file in server/seeds/ in name order.
// Each seed owner keeps their own file (01_admins = M1, 02_election = M2,
// 03_candidates = M3, 04_voters = M2). Seeds must be idempotent (safe to re-run)
// and contain DUMMY DATA ONLY — no real registration numbers or emails.
//
// A seed file looks like:
//   export default async function seed({ query, withTransaction }) { ... }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pool, query, withTransaction } from '../src/core/db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seeds');
const only = process.argv[2]; // optional: npm run seed -- 01_admins

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.js') && (!only || f.startsWith(only)))
  .sort();

try {
  for (const file of files) {
    const { default: seed } = await import(pathToFileURL(path.join(dir, file)).href);
    process.stdout.write(`seeding ${file} ... `);
    await seed({ query, withTransaction });
    console.log('done');
  }
} catch (err) {
  console.error('\nSeed failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
