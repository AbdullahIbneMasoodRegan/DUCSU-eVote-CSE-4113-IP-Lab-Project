// M1 — NFR-04: npm run backup / npm run restore round-trip on the test database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { query } from '../../src/core/db.js';
import { backupJson } from '../../scripts/backup.js';
import { restoreJson, readBackup } from '../../scripts/restore.js';
import { resetDb, createVoter, createAdmin, createElection } from '../helpers.js';

let dir;
beforeEach(async () => {
  await resetDb();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ducsu-backup-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('backup and restore', () => {
  it('restores every row exactly, including binary files, and keeps ids counting up', async () => {
    await createAdmin({ email: 'ec@test.local' });
    const v1 = await createVoter({ name: 'রহিম উদ্দিন' });
    await createVoter();
    const election = await createElection();
    const bytes = Buffer.from([0, 1, 2, 250, 255]);
    await query(`INSERT INTO files (mime, data) VALUES ('image/png', $1)`, [bytes]);
    await query(`INSERT INTO settings (key, value) VALUES ('otp.ttlMinutes', '7')`);

    const { file, counts } = await backupJson({ dir });
    expect(file.endsWith('.json.gz')).toBe(true);
    expect(counts.voters).toBe(2);
    const body = readBackup(file);
    expect(JSON.stringify(body)).not.toMatch(/postgres(ql)?:\/\/[^"]*:[^"]*@/); // no password

    // Lose everything, then restore.
    await resetDb();
    expect((await query('SELECT count(*)::int n FROM voters')).rows[0].n).toBe(0);
    const restored = await restoreJson(body);
    expect(restored.voters).toBe(2);

    const { rows: voters } = await query('SELECT * FROM voters ORDER BY id');
    expect(voters[0]).toMatchObject({ id: v1.id, name: 'রহিম উদ্দিন', reg_no: v1.reg_no });
    const { rows: files } = await query('SELECT data FROM files');
    expect(Buffer.compare(files[0].data, bytes)).toBe(0);
    const { rows: el } = await query('SELECT starts_at FROM elections');
    expect(el[0].starts_at.toISOString()).toBe(new Date(election.starts_at).toISOString());
    expect((await query(`SELECT value FROM settings`)).rows[0].value).toBe('7');

    // New rows get fresh ids, not ones that clash with restored rows.
    const v3 = await createVoter();
    expect(v3.id).toBeGreaterThan(Math.max(...voters.map((v) => v.id)));
  });

  it('refuses a file that is not a backup', async () => {
    await expect(restoreJson({ format: 'something-else', tables: {} })).rejects.toThrow(/Not a DUCSU/);
  });
});
