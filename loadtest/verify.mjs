// M1 — load test, step 3 of 3 (NFR-03): no lost or extra votes.
//
//   node loadtest/verify.mjs
//
// Compares the database with the counts saved by prepare.js:
//   new ballots == new receipts == new voters marked as voted == load-test voters who voted
// and prints a Markdown block for docs/load-test.md (plus loadtest/results/report.md).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, query } from '../server/src/core/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const prep = JSON.parse(fs.readFileSync(path.join(here, 'voters.json'), 'utf8'));
  const k6File = path.join(here, 'results', 'k6-summary.json');
  const k6 = fs.existsSync(k6File) ? JSON.parse(fs.readFileSync(k6File, 'utf8')) : null;

  const { rows } = await query(
    `SELECT (SELECT count(*) FROM ballots)::int AS ballots,
            (SELECT count(*) FROM receipts)::int AS receipts,
            (SELECT count(*) FROM voters WHERE has_voted)::int AS voted,
            (SELECT count(*) FROM voters WHERE has_voted AND reg_no LIKE $1)::int AS lt_voted`,
    [`LT-${prep.run}-%`],
  );
  const now = rows[0];
  const d = {
    ballots: now.ballots - prep.baseline.ballots,
    receipts: now.receipts - prep.baseline.receipts,
    voted: now.voted - prep.baseline.voted,
  };
  const n = prep.voters.length;
  const equal = d.ballots === d.receipts && d.receipts === d.voted && d.voted === now.lt_voted;
  const complete = now.lt_voted === n;
  const pass = equal && complete && (!k6 || (k6.failedRequestRate === 0 && k6.votesCast === n));

  const report = [
    `### Load test run ${prep.run} — ${pass ? 'PASSED' : 'FAILED'}`,
    '',
    `| Measure | Result |`,
    `| --- | --- |`,
    `| Simultaneous voters | ${n} |`,
    ...(k6
      ? [
          `| Votes accepted (k6) | ${k6.votesCast} |`,
          `| Failed requests | ${(k6.failedRequestRate * 100).toFixed(2)}% |`,
          `| Vote submit time (median / p95 / max) | ${k6.voteSubmitMs.med} / ${k6.voteSubmitMs.p95} / ${k6.voteSubmitMs.max} ms |`,
          `| Whole flow per voter (median / p95 / max) | ${k6.fullFlowMs.med} / ${k6.fullFlowMs.p95} / ${k6.fullFlowMs.max} ms |`,
        ]
      : []),
    `| New ballots / receipts / voters marked voted | ${d.ballots} / ${d.receipts} / ${d.voted} |`,
    `| Load-test voters marked voted | ${now.lt_voted} of ${n} |`,
    `| Counts equal (no lost or extra votes) | ${equal ? 'yes' : 'NO'} |`,
    '',
    `Server: ${k6?.baseUrl ?? 'unknown'} · ${k6?.finishedAt ?? new Date().toISOString()}`,
  ].join('\n');

  fs.mkdirSync(path.join(here, 'results'), { recursive: true });
  fs.writeFileSync(path.join(here, 'results', 'report.md'), `${report}\n`);
  console.log(report);
  process.exitCode = pass ? 0 : 1;
}

main()
  .catch((err) => {
    console.error(`verify failed: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
