// M1 — load test, step 2 of 3 (NFR-02, NFR-03). k6 script, see docs/load-test.md.
//
//   k6 run -e BASE_URL=https://ducsu-evote-staging.onrender.com loadtest/vote.js
//
// Every voter in loadtest/voters.json logs in with its code, loads the ballot
// and casts a full vote with a photo, all at the same moment (one virtual user
// per voter). Pass/fail thresholds: zero failed requests, every check passes.
import http from 'k6/http';
import { check, fail } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Trend } from 'k6/metrics';
import exec from 'k6/execution';

const BASE = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const data = JSON.parse(open('./voters.json'));
const voters = new SharedArray('voters', () => data.voters);
const photo = open('./photo.jpg', 'b');

const voteTime = new Trend('vote_submit_ms', true);
const fullFlowTime = new Trend('full_flow_ms', true);
const votesCast = new Counter('votes_cast');

export const options = {
  scenarios: {
    election_rush: {
      executor: 'per-vu-iterations',
      vus: voters.length,
      iterations: 1,
      maxDuration: '10m',
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
    vote_submit_ms: ['p(95)<5000'],
  },
  summaryTrendStats: ['min', 'med', 'avg', 'p(90)', 'p(95)', 'max'],
};

const json = { headers: { 'Content-Type': 'application/json' } };

export default function () {
  const voter = voters[exec.vu.idInTest - 1];
  const started = Date.now();

  const login = http.post(`${BASE}/api/auth/otp/verify`, JSON.stringify(voter), { ...json, tags: { step: 'login' } });
  if (!check(login, { 'login 200': (r) => r.status === 200 })) fail(`login ${login.status} ${login.body}`);

  const ballot = http.get(`${BASE}/api/ballot`, { tags: { step: 'ballot' } });
  if (!check(ballot, { 'ballot 200': (r) => r.status === 200 })) fail(`ballot ${ballot.status} ${ballot.body}`);

  // Fill every post: the first `maxSelections` candidates (a worst-case, full ballot).
  const choices = ballot.json('data.positions').map((p) => ({
    positionId: p.id,
    candidateIds: p.candidates.slice(0, p.maxSelections).map((c) => c.id),
  }));

  const t0 = Date.now();
  const vote = http.post(
    `${BASE}/api/vote`,
    { choices: JSON.stringify(choices), photo: http.file(photo, 'photo.jpg', 'image/jpeg') },
    { tags: { step: 'vote' } },
  );
  voteTime.add(Date.now() - t0);
  const ok = check(vote, {
    'vote 201': (r) => r.status === 201,
    'receipt code returned': (r) => r.status === 201 && typeof r.json('data.receiptCode') === 'string',
  });
  if (ok) votesCast.add(1);
  fullFlowTime.add(Date.now() - started);
}

export function handleSummary(summary) {
  const m = summary.metrics;
  const ms = (metric, stat) => (m[metric] ? Math.round(m[metric].values[stat]) : null);
  const result = {
    run: data.run,
    baseUrl: BASE,
    finishedAt: new Date().toISOString(),
    voters: voters.length,
    votesCast: m.votes_cast ? m.votes_cast.values.count : 0,
    failedRequestRate: m.http_req_failed.values.rate,
    checksPassRate: m.checks.values.rate,
    voteSubmitMs: { med: ms('vote_submit_ms', 'med'), p95: ms('vote_submit_ms', 'p(95)'), max: ms('vote_submit_ms', 'max') },
    fullFlowMs: { med: ms('full_flow_ms', 'med'), p95: ms('full_flow_ms', 'p(95)'), max: ms('full_flow_ms', 'max') },
  };
  return {
    'loadtest/results/k6-summary.json': JSON.stringify(result, null, 2),
    stdout: `\n${JSON.stringify(result, null, 2)}\n`,
  };
}
