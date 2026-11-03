// M1 — migration 001 obeys the ballot secrecy rules (work plan § 9, rules 1–3).
// M4 owns the full secrecy test suite; this guards the initial schema.
import { describe, it, expect } from 'vitest';
import { query } from '../../src/core/db.js';

const SECRET_TABLES = ['ballots', 'ballot_choices', 'receipts', 'voter_photos'];

async function columns(table) {
  const { rows } = await query(
    `SELECT column_name, data_type, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return rows;
}

describe('ballot secrecy in the schema', () => {
  it.each(SECRET_TABLES)('%s has no timestamps and no serial/sequence', async (table) => {
    const cols = await columns(table);
    expect(cols.length).toBeGreaterThan(0);
    for (const c of cols) {
      expect(c.data_type).not.toMatch(/time|date/);
      expect(c.column_default ?? '').not.toMatch(/nextval/);
    }
  });

  it('has no voted_at column anywhere', async () => {
    const { rows } = await query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name ILIKE '%voted_at%'`,
    );
    expect(rows).toEqual([]);
  });

  it('ballots and receipts have no voter column and no link to voters', async () => {
    for (const table of ['ballots', 'ballot_choices', 'receipts']) {
      const names = (await columns(table)).map((c) => c.column_name);
      expect(names).not.toContain('voter_id');
    }
    const { rows } = await query(
      `SELECT tc.table_name, ccu.table_name AS references
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu
           ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name IN ('ballots', 'ballot_choices', 'receipts', 'voter_photos')
          AND ccu.table_name IN ('voters', 'voter_photos', 'ballots', 'receipts', 'sessions')`,
    );
    // Only allowed links: ballot_choices -> ballots, voter_photos -> voters.
    const links = rows.map((r) => `${r.table_name}->${r.references}`).sort();
    expect(links).toEqual(['ballot_choices->ballots', 'voter_photos->voters']);
  });
});
