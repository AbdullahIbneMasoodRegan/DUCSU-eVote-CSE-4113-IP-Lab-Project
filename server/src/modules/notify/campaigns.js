// M1 — bulk election emails (FR-17):
//   votingOpen        — every eligible voter, once voting opens
//   reminder          — eligible voters who have not voted, N hours before close
//                       (N = settings 'notify.reminderHoursBeforeClose', default 3)
//   resultsPublished  — every eligible voter, once the EC publishes results
//
// A timer calls tick() every NOTIFY_INTERVAL_SECONDS. Each tick sends ONE batch
// (NOTIFY_BATCH_SIZE emails) of the first unfinished campaign, so sending is
// spread out to stay inside the free email plan's limits. Progress is stored in
// notification_runs (cursor = last voter id), so a restart resumes where it
// stopped and nobody gets the same email twice. Each finished campaign is audited.
import config from '../../core/config.js';
import { pool, query } from '../../core/db.js';
import logger from '../../core/logger.js';
import audit from '../audit/index.js';
import { getCurrent } from '../election/index.js';
import settings from '../settings/index.js';
import notify from './index.js';

export const KINDS = ['votingOpen', 'reminder', 'resultsPublished'];

/** When each campaign becomes due (ISO strings; null = not scheduled). */
export async function schedule(election) {
  if (!election) return { votingOpen: null, reminder: null, resultsPublished: null };
  const hours = await settings.get('notify.reminderHoursBeforeClose');
  const ends = new Date(election.endsAt).getTime();
  const starts = new Date(election.startsAt).getTime();
  return {
    votingOpen: new Date(starts).toISOString(),
    reminder: new Date(Math.max(starts, ends - hours * 3_600_000)).toISOString(),
    resultsPublished: election.resultsPublishedAt ? new Date(election.resultsPublishedAt).toISOString() : null,
  };
}

/** Campaigns that should be running at `now`, in sending order. */
export async function dueKinds(election, now = new Date()) {
  if (!election) return [];
  const at = await schedule(election);
  const t = now.getTime();
  const open = t >= Date.parse(at.votingOpen) && t < Date.parse(election.endsAt) && !at.resultsPublished;
  const due = [];
  if (open) due.push('votingOpen');
  if (open && t >= Date.parse(at.reminder)) due.push('reminder');
  if (at.resultsPublished) due.push('resultsPublished');
  return due;
}

async function getRun(electionId, kind) {
  await query(
    `INSERT INTO notification_runs (election_id, kind) VALUES ($1, $2) ON CONFLICT (election_id, kind) DO NOTHING`,
    [electionId, kind],
  );
  const { rows } = await query('SELECT * FROM notification_runs WHERE election_id = $1 AND kind = $2', [
    electionId,
    kind,
  ]);
  return rows[0];
}

async function sendBatch(election, kind, run) {
  const batchSize = config.notify.batchSize;
  // Re-checked every batch: someone who votes mid-campaign gets no reminder.
  const notVoted = kind === 'reminder' ? 'AND has_voted = false' : '';
  const { rows: voters } = await query(
    `SELECT id, name, email FROM voters
      WHERE eligible AND id > $1 ${notVoted}
      ORDER BY id LIMIT $2`,
    [run.last_voter_id, batchSize],
  );

  const counts = { sent: 0, failed: 0, skipped: 0 };
  const data = { title: election.title, endsAt: election.endsAt, url: config.appUrl };
  for (const v of voters) {
    try {
      const r = await notify.send({ to: v.email, template: kind, data: { ...data, name: v.name }, lang: 'both' });
      if (r?.skipped) counts.skipped += 1;
      else counts.sent += 1;
    } catch (err) {
      counts.failed += 1;
      logger.warn('bulk email failed', { kind, voterId: v.id, error: err.message });
    }
  }

  const finished = voters.length < batchSize;
  const lastId = voters.length ? voters[voters.length - 1].id : run.last_voter_id;
  const { rows } = await query(
    `UPDATE notification_runs
        SET last_voter_id = $2, sent = sent + $3, failed = failed + $4, skipped = skipped + $5,
            finished_at = CASE WHEN $6 THEN now() ELSE NULL END
      WHERE id = $1 RETURNING *`,
    [run.id, lastId, counts.sent, counts.failed, counts.skipped, finished],
  );
  const updated = rows[0];
  if (finished) {
    await audit.record(
      null,
      'NOTIFY_SENT',
      `${kind} election:${election.id} sent:${updated.sent} failed:${updated.failed} skipped:${updated.skipped}`,
    );
    logger.info('bulk email finished', { kind, sent: updated.sent, failed: updated.failed, skipped: updated.skipped });
  }
  return { kind, batch: voters.length, finished, ...counts };
}

/** Sends one batch of the first unfinished, due campaign. Returns what it did, or null. */
export async function runOnce(now = new Date()) {
  const election = await getCurrent();
  for (const kind of await dueKinds(election, now)) {
    const run = await getRun(election.id, kind);
    if (run.finished_at) continue;
    return sendBatch(election, kind, run);
  }
  return null;
}

/** Progress of each campaign for the current election (EC / Observer page). */
export async function status() {
  const election = await getCurrent();
  if (!election) return null;
  const { rows: runs } = await query('SELECT * FROM notification_runs WHERE election_id = $1', [election.id]);
  const { rows: counts } = await query(
    `SELECT count(*) FILTER (WHERE eligible)::int AS all,
            count(*) FILTER (WHERE eligible AND NOT has_voted)::int AS not_voted
       FROM voters`,
  );
  const byKind = Object.fromEntries(runs.map((r) => [r.kind, r]));
  const at = await schedule(election);
  return {
    electionId: election.id,
    transport: config.mail.transport,
    batchSize: config.notify.batchSize,
    intervalSeconds: config.notify.intervalMs / 1000,
    enabled: config.notify.enabled,
    recipients: { all: counts[0].all, notVoted: counts[0].not_voted },
    campaigns: KINDS.map((kind) => {
      const r = byKind[kind];
      return {
        kind,
        dueAt: at[kind],
        state: r ? (r.finished_at ? 'finished' : 'sending') : 'waiting',
        sent: r?.sent ?? 0,
        failed: r?.failed ?? 0,
        skipped: r?.skipped ?? 0,
        startedAt: r?.started_at?.toISOString() ?? null,
        finishedAt: r?.finished_at?.toISOString() ?? null,
      };
    }),
  };
}

// ------------------------------------------------------------------ timer

let timer = null;
let running = false;
// Several servers may share one database (staging + a laptop). Only the one
// holding this Postgres advisory lock sends, so a batch never goes out twice.
const LOCK_KEY = 4113_017;

export async function tick(now = new Date()) {
  if (running) return null; // the previous batch is still sending
  running = true;
  let client;
  try {
    client = await pool.connect();
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_KEY]);
    if (!rows[0].ok) return null; // another server is sending
    try {
      return await runOnce(now);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } catch (err) {
    logger.error('notification job failed', { error: err.message });
    return null;
  } finally {
    client?.release();
    running = false;
  }
}

/** Called once by server.js. Does nothing in tests or when NOTIFY_ENABLED=false. */
export function startScheduler() {
  if (timer || !config.notify.enabled || config.isTest) return;
  timer = setInterval(() => tick(), config.notify.intervalMs);
  timer.unref();
  setTimeout(() => tick(), 10_000).unref();
  logger.info('notification job started', {
    batchSize: config.notify.batchSize,
    intervalSeconds: config.notify.intervalMs / 1000,
  });
}

export function stopScheduler() {
  clearInterval(timer);
  timer = null;
}
