// M1 — load test, step 1 of 3 (NFR-02, NFR-03). See docs/load-test.md.
//
//   node loadtest/prepare.mjs --voters 500 --yes
//
// Against the database in DATABASE_URL (use a Neon BRANCH, never the demo data):
//   * creates N voters LT-<run>-0001… with reserved emails (@loadtest.test: never emailed);
//   * gives each one a known login code (stored hashed, exactly as the server would);
//   * raises the rate limits and code lifetime so one machine can play 500 voters;
//   * writes loadtest/voters.json (codes, git-ignored) and loadtest/photo.jpg.
// Run it with the SAME OTP_SECRET as the server under test, or the codes will not match.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import config from '../server/src/core/config.js';
import { pool, query } from '../server/src/core/db.js';
import { hashOtp } from '../server/src/modules/auth/service.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// sharp is a server dependency; load it from there.
const sharp = createRequire(new URL('../server/package.json', import.meta.url))('sharp');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const N = Number(arg('voters', 500));
const HALLS = ['Jagannath Hall', 'Ruqayyah Hall', 'Salimullah Muslim Hall', 'Fazlul Huq Muslim Hall', 'Amar Ekushey Hall'];

async function main() {
  const target = new URL(config.db.url);
  console.log(`Database: ${target.host}${target.pathname}`);
  if (!process.argv.includes('--yes')) {
    console.log(`Would create ${N} load-test voters there. Add --yes to continue.`);
    return;
  }

  const { rows: el } = await query(
    `SELECT id, title, starts_at <= now() AND ends_at > now() AS open FROM elections ORDER BY starts_at DESC LIMIT 1`,
  );
  if (!el[0]) throw new Error('No election in this database. Run the seeds first.');
  if (!el[0].open) console.warn('WARNING: voting is not open right now; votes will be refused (VOTING_NOT_OPEN).');

  const run = crypto.randomBytes(2).toString('hex').toUpperCase();
  const voters = [];
  for (let i = 1; i <= N; i += 1) {
    const regNo = `LT-${run}-${String(i).padStart(4, '0')}`;
    const { rows } = await query(
      `INSERT INTO voters (reg_no, name, email, hall, department, eligible)
       VALUES ($1, $2, $3, $4, 'Load Test', true) RETURNING id`,
      [regNo, `Load Tester ${i}`, `lt-${run}-${i}@loadtest.test`.toLowerCase(), HALLS[i % HALLS.length]],
    );
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await query(
      `INSERT INTO otp_codes (voter_id, code_hash, expires_at, failed_attempts, created_at)
       VALUES ($1, $2, now() + interval '2 hours', 0, now())`,
      [rows[0].id, hashOtp(rows[0].id, code)],
    );
    voters.push({ regNo, code });
    if (i % 100 === 0) console.log(`  ${i} voters ready`);
  }

  // One machine plays every voter, so it shares one IP address.
  const limits = {
    'rateLimit.loginPerIpPer15Minutes': 1000,
    'rateLimit.otpPerIpPer15Minutes': 1000,
    'otp.ttlMinutes': 30,
  };
  for (const [key, value] of Object.entries(limits)) {
    await query(
      `INSERT INTO settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, String(value)],
    );
  }

  const { rows: base } = await query(
    `SELECT (SELECT count(*) FROM ballots)::int AS ballots,
            (SELECT count(*) FROM receipts)::int AS receipts,
            (SELECT count(*) FROM voters WHERE has_voted)::int AS voted`,
  );

  fs.mkdirSync(path.join(here, 'results'), { recursive: true }); // k6 writes its summary here
  fs.writeFileSync(
    path.join(here, 'voters.json'),
    JSON.stringify({ run, electionId: el[0].id, createdAt: new Date().toISOString(), baseline: base[0], voters }),
  );
  const photo = await sharp({ create: { width: 320, height: 240, channels: 3, background: '#0f5c39' } })
    .jpeg({ quality: 70 })
    .toBuffer();
  fs.writeFileSync(path.join(here, 'photo.jpg'), photo);

  console.log(`\nRun ${run}: ${N} voters written to loadtest/voters.json`);
  console.log('Rate limits raised for the test. The server picks them up within 10 seconds.');
  console.log('Next: k6 run -e BASE_URL=<server url> loadtest/vote.js');
}

main()
  .catch((err) => {
    console.error(`prepare failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
