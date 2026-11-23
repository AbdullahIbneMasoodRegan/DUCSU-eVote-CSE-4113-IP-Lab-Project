// M4 — ballot secrecy tests (NFR-06, NFR-09; work plan § 9). M4 is the secrecy guardian.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture everything the app would log so we can prove votes never reach the logs (rule 4).
const logged = vi.hoisted(() => []);
vi.mock('../../src/core/logger.js', () => {
  const rec = (level) => (msg, fields) => logged.push({ level, msg, fields });
  const logger = { debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error') };
  return { default: logger, logger };
});

const { query } = await import('../../src/core/db.js');
const { api, resetDb } = await import('../helpers.js');
const { castVote, setupVoting, voterAgent } = await import('./helpers.js');

const votingDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/modules/voting');

const columns = async (table) =>
  (
    await query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name`,
      [table],
    )
  ).rows.map((r) => r.column_name);

describe('secrecy rules 1–3: the schema carries no link between a voter and a ballot', () => {
  it('the secret tables have exactly the agreed columns and nothing else', async () => {
    expect(await columns('ballots')).toEqual(['election_id', 'id']);
    expect(await columns('ballot_choices')).toEqual(['ballot_id', 'candidate_id', 'position_id']);
    expect(await columns('receipts')).toEqual(['code', 'election_id']);
    expect(await columns('voter_photos')).toEqual(['data', 'id', 'mime', 'voter_id']);
  });

  it('ballot ids are random UUIDs, not sequences', async () => {
    const { rows } = await query(
      `SELECT data_type, column_default FROM information_schema.columns
        WHERE table_name = 'ballots' AND column_name = 'id'`,
    );
    expect(rows[0].data_type).toBe('uuid');
    expect(rows[0].column_default).toMatch(/gen_random_uuid/);
  });

  it('voters carry only a has_voted boolean: no voted_at, no ballot or receipt reference', async () => {
    const names = await columns('voters');
    expect(names).toContain('has_voted');
    expect(names.filter((n) => /voted_at|ballot|receipt/i.test(n))).toEqual([]);
    const { rows } = await query(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'voters' AND column_name = 'has_voted'`,
    );
    expect(rows[0].data_type).toBe('boolean');
  });

  it('the voting module never adds timestamps or sequences, and never reads ballots in insertion order', () => {
    for (const file of fs.readdirSync(votingDir).filter((f) => f.endsWith('.js'))) {
      // Code only: comments are allowed to say "no voted_at" and similar.
      const src = fs
        .readFileSync(path.join(votingDir, file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|\s)\/\/.*$/gm, '');
      expect(src, file).not.toMatch(/voted_at|created_at|updated_at|nextval|serial/i);
      expect(src, file).not.toMatch(/localStorage|sessionStorage/);
      // M4 never reads ballots back (M2 counts them); receipts are always listed ORDER BY code.
      expect(src, file).not.toMatch(/FROM\s+ballots|FROM\s+ballot_choices/i);
      const listings = src.match(/SELECT code FROM receipts/gi)?.length ?? 0;
      const ordered = src.match(/ORDER BY code/gi)?.length ?? 0;
      expect(ordered, `${file}: every receipt listing must be ORDER BY code`).toBe(listings);
    }
  });
});

describe('secrecy rule 4: vote bodies, choices and receipt codes never reach the logs', () => {
  beforeEach(async () => {
    await resetDb();
    logged.length = 0;
  });

  it('logs only the route prefix for /api/vote and /api/receipts, and nothing from the body', async () => {
    const setup = await setupVoting();
    const { ag } = await voterAgent();
    const choices = [{ positionId: setup.vp, candidateIds: [setup.c.vpA] }];
    const res = await (await castVote(ag, choices)).expect(201);
    const code = res.body.data.receiptCode;

    await query(`UPDATE elections SET starts_at = now() - interval '3 days', ends_at = now() - interval '1 day'`);
    await api().get(`/api/receipts/${code}?q=${code}`).expect(200);
    await api().get('/api/receipts').query({ q: code.slice(3, 7) }).expect(200);

    const everything = JSON.stringify(logged);
    expect(everything).not.toContain(code);
    expect(everything).not.toContain(code.slice(3, 7));
    expect(everything).not.toMatch(/candidateIds|positionId|choices|verify\.jpg|photo/);
    const paths = logged.filter((l) => l.msg === 'request').map((l) => l.fields.path);
    expect(paths).toContain('/api/vote');
    expect(paths).toContain('/api/receipts');
    expect(paths.some((p) => p.startsWith('/api/receipts/'))).toBe(false);
  });

  it('a failing vote logs only an error code, never the database message or the body', async () => {
    const setup = await setupVoting();
    const { ag } = await voterAgent();
    await query(`
      CREATE FUNCTION fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'SECRET-DB-DETAIL %', NEW.code; END $$;
      CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts
        FOR EACH ROW EXECUTE FUNCTION fail_receipt();`);
    try {
      logged.length = 0;
      await (await castVote(ag, [{ positionId: setup.vp, candidateIds: [setup.c.vpA] }])).expect(500);
    } finally {
      await query('DROP TRIGGER fail_receipt ON receipts; DROP FUNCTION fail_receipt();');
    }
    const errors = logged.filter((l) => l.level === 'error');
    expect(errors).toHaveLength(1);
    expect(Object.keys(errors[0].fields).sort()).toEqual(['code', 'method', 'path']);
    expect(errors[0].fields.path).toBe('/api/vote');
    expect(JSON.stringify(logged)).not.toMatch(/SECRET-DB-DETAIL|DU-[A-Z2-9]{4}-/);
  });
});

describe('what a successful vote reveals to the caller', () => {
  beforeEach(resetDb);

  it('returns only the receipt code: no ballot id, voter id or choices', async () => {
    const setup = await setupVoting();
    const { ag, voter } = await voterAgent();
    const res = await (await castVote(ag, [{ positionId: setup.vp, candidateIds: [setup.c.vpB] }])).expect(201);
    expect(Object.keys(res.body.data)).toEqual(['receiptCode']);
    const { rows } = await query('SELECT id FROM ballots');
    expect(JSON.stringify(res.body)).not.toContain(rows[0].id);
    expect(JSON.stringify(res.body)).not.toContain(String(voter.reg_no));
  });

  it('keeps no table that could pair the receipt with the voter after the vote', async () => {
    const setup = await setupVoting();
    const { ag, voter } = await voterAgent();
    await (await castVote(ag, [{ positionId: setup.vp, candidateIds: [setup.c.vpB] }])).expect(201);
    // The only voter-linked secret row is the photo; it holds no ballot, receipt or time.
    const { rows } = await query('SELECT * FROM voter_photos WHERE voter_id = $1', [voter.id]);
    expect(Object.keys(rows[0]).sort()).toEqual(['data', 'id', 'mime', 'voter_id']);
  });
});
