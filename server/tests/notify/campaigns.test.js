// M1 — FR-17 bulk emails: voting open, reminder, results published.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import config from '../../src/core/config.js';
import { query } from '../../src/core/db.js';
import notify from '../../src/modules/notify/index.js';
import { runOnce, tick, dueKinds, schedule } from '../../src/modules/notify/campaigns.js';
import { resetDb, agent, createAdmin, createElection, createVoter, loginAdmin } from '../helpers.js';

const originalBatch = config.notify.batchSize;
const originalMail = structuredClone(config.mail);

beforeEach(async () => {
  await resetDb();
  config.notify.batchSize = 2;
});
afterEach(() => {
  config.notify.batchSize = originalBatch;
  Object.assign(config.mail, structuredClone(originalMail));
  vi.unstubAllGlobals();
});

/** Run batches until the job has nothing left to do. */
async function drain(now) {
  const results = [];
  for (let i = 0; i < 50; i += 1) {
    const r = await runOnce(now);
    if (!r) break;
    results.push(r);
  }
  return results;
}

const sentTo = (template) => notify.outbox.filter((m) => m.template === template).map((m) => m.to).sort();

describe('election email campaigns', () => {
  it('sends nothing before voting opens', async () => {
    await createElection({ startsInDays: 1 });
    await createVoter();
    expect(await runOnce()).toBeNull();
    expect(notify.outbox).toHaveLength(0);
  });

  it('emails every eligible voter once when voting opens, in batches, in both languages', async () => {
    const election = await createElection({ startsInDays: -0.1, lengthDays: 2 });
    const voters = [];
    for (let i = 0; i < 5; i += 1) voters.push(await createVoter());
    await createVoter({ eligible: false });

    const batches = await drain();
    expect(batches.map((b) => b.batch)).toEqual([2, 2, 1]); // batch size 2
    expect(sentTo('votingOpen')).toEqual(voters.map((v) => v.email).sort());

    const mail = notify.outbox[0];
    expect(mail.lang).toBe('both');
    expect(mail.subject).toContain('ভোটগ্রহণ শুরু হয়েছে');
    expect(mail.subject).toContain('Voting is open');
    expect(mail.html).toContain(`${config.appUrl}/login`);

    // Running again sends nothing more.
    expect(await runOnce()).toBeNull();
    expect(notify.outbox).toHaveLength(5);

    const { rows } = await query(`SELECT target FROM audit_log WHERE action = 'NOTIFY_SENT'`);
    expect(rows[0].target).toBe(`votingOpen election:${election.id} sent:5 failed:0 skipped:0`);
  });

  it('resumes after the last voter it reached (no duplicates after a restart)', async () => {
    await createElection({ startsInDays: -0.1, lengthDays: 2 });
    for (let i = 0; i < 3; i += 1) await createVoter();
    await runOnce(); // first batch of 2, then "restart"
    await drain();
    const to = sentTo('votingOpen');
    expect(to).toHaveLength(3);
    expect(new Set(to).size).toBe(3);
  });

  it('reminds only voters who have not voted, from the configured hours before close', async () => {
    // Closes in 2 hours; default reminder is 3 hours before close, so it is due now.
    const { rows } = await query(
      `INSERT INTO elections (title, starts_at, ends_at)
       VALUES ('E', now() - interval '1 day', now() + interval '2 hours') RETURNING id`,
    );
    const voted = await createVoter();
    const waiting = await createVoter();
    await query('UPDATE voters SET has_voted = true WHERE id = $1', [voted.id]);
    await query(
      `INSERT INTO notification_runs (election_id, kind, finished_at) VALUES ($1, 'votingOpen', now())`,
      [rows[0].id],
    );

    await drain();
    expect(sentTo('reminder')).toEqual([waiting.email]);
  });

  it('does not remind early, and honours the EC setting', async () => {
    const election = await createElection({ startsInDays: -1, lengthDays: 2 }); // closes in ~1 day
    const now = new Date();
    expect(await dueKinds({ ...election, startsAt: election.starts_at, endsAt: election.ends_at }, now)).toEqual([
      'votingOpen',
    ]);
    await query(`INSERT INTO settings (key, value) VALUES ('notify.reminderHoursBeforeClose', '48')`);
    const { clearCache } = await import('../../src/modules/settings/index.js');
    clearCache();
    const el = { startsAt: election.starts_at, endsAt: election.ends_at };
    expect(await dueKinds(el, now)).toEqual(['votingOpen', 'reminder']);
    expect((await schedule(el)).reminder).toBe(new Date(el.startsAt).toISOString()); // never before opening
  });

  it('emails everyone when results are published', async () => {
    await query(
      `INSERT INTO elections (title, starts_at, ends_at, results_published_at)
       VALUES ('E', now() - interval '3 days', now() - interval '1 day', now())`,
    );
    const v = await createVoter();
    await drain();
    expect(sentTo('resultsPublished')).toEqual([v.email]);
    expect(sentTo('votingOpen')).toEqual([]);
  });

  it('counts failures without stopping, and tick() runs under the database lock', async () => {
    await createElection({ startsInDays: -0.1, lengthDays: 2 });
    await createVoter({ email: 'real@example.org' });
    await createVoter({ email: 'dummy@ducsu.test' });
    config.mail.transport = 'brevo';
    config.mail.brevo = { apiKey: 'k' };
    config.mail.fromAddress = { name: 'DUCSU eVote', email: 'ec@example.org' };
    const fetchMock = vi.fn(async () => new Response('{"message":"quota"}', { status: 402 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const r = await tick();
    expect(r).toMatchObject({ kind: 'votingOpen', failed: 1, skipped: 1, sent: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // the .test address never reached Brevo
  });
});

describe('/api/admin/notifications', () => {
  it('shows progress to EC and observers, and previews every template', async () => {
    await createElection({ startsInDays: -0.1, lengthDays: 2 });
    await createVoter();
    await drain();

    const ec = await createAdmin({ email: 'ec@test.local' });
    const ag = agent();
    await loginAdmin(ag, ec).expect(200);
    const res = await ag.get('/api/admin/notifications').expect(200);
    expect(res.body.data.recipients).toEqual({ all: 1, notVoted: 1 });
    expect(res.body.data.campaigns.find((c) => c.kind === 'votingOpen')).toMatchObject({ state: 'finished', sent: 1 });
    expect(res.body.data.campaigns.find((c) => c.kind === 'reminder').state).toBe('waiting');

    for (const template of ['otp', 'votingOpen', 'reminder', 'resultsPublished']) {
      const p = await ag.get(`/api/admin/notifications/preview?template=${template}&lang=bn`).expect(200);
      expect(p.body.data.html).toMatch(/^<!doctype html>/);
      expect(p.body.data.subject).toMatch(/[ঀ-৿]/); // Bangla
    }
    await ag.get('/api/admin/notifications/preview?template=nope').expect(400);

    const obs = await createAdmin({ email: 'obs@test.local', role: 'observer' });
    const oag = agent();
    await loginAdmin(oag, obs).expect(200);
    await oag.get('/api/admin/notifications').expect(200);
    await oag.get('/api/admin/notifications/preview?template=otp').expect(403);
  });
});
