// M4 — the double-vote test (work plan § 5, FR-10): ten simultaneous votes for one voter
// must produce exactly one ballot, one receipt and one photo.
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from '../helpers.js';
import { castVote, counts, setupVoting, voterAgent } from './helpers.js';

describe('concurrent double voting', () => {
  beforeEach(resetDb);

  it('10 simultaneous votes for one voter => exactly one ballot, one receipt, one photo', async () => {
    const { vp, em, c } = await setupVoting();
    const { ag } = await voterAgent();

    const choices = [
      { positionId: vp, candidateIds: [c.vpA] },
      { positionId: em, candidateIds: [c.emA, c.emB] },
    ];
    const responses = await Promise.all(
      Array.from({ length: 10 }, async () => (await castVote(ag, choices)).send()),
    );

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    for (const r of responses.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('ALREADY_VOTED');
    }

    expect(await counts()).toEqual({ ballots: 1, choices: 3, receipts: 1, photos: 1, voted: 1 });
  });

  it('different voters voting at the same time all succeed independently', async () => {
    const { vp, c } = await setupVoting();
    const voters = await Promise.all(Array.from({ length: 6 }, () => voterAgent()));
    const results = await Promise.all(
      voters.map(async ({ ag }) => (await castVote(ag, [{ positionId: vp, candidateIds: [c.vpA] }])).send()),
    );
    expect(results.map((r) => r.status)).toEqual(Array(6).fill(201));
    expect(new Set(results.map((r) => r.body.data.receiptCode)).size).toBe(6);
    expect(await counts()).toEqual({ ballots: 6, choices: 6, receipts: 6, photos: 6, voted: 6 });
  });
});
