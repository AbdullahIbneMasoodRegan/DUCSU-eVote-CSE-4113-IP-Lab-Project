// M3 — seed 2 panels + independent candidates (dummy data only).
// Idempotent: safe to re-run. Uses voters 2021-415-001 .. 2021-415-070 from 04_voters.js,
// which it seeds first if they are missing. Voters 071+ are left free to try nominating.
//
// Candidate photos are left empty on purpose: the UI shows the initials avatar.

const PANELS = [
  {
    name: 'Ekota Panel',
    slogan: 'United for every student',
    manifesto:
      'Safer halls, faster dining service, extended library hours and a student-run help desk in every faculty.',
    leader: 1, // voter 001 creates the panel
    // position display_order -> voter number
    members: { 1: 1, 2: 2, 3: 3, 5: 4, 8: 5, 9: 6, 13: 7, 15: 8, 16: 9, 17: 10, 18: 11 },
  },
  {
    name: 'Progoti Panel',
    slogan: 'Progress through participation',
    manifesto:
      'Open budgets, a 24-hour study room, better campus transport and a transparent union that reports every quarter.',
    leader: 21,
    members: { 1: 21, 2: 22, 3: 23, 5: 24, 8: 25, 9: 26, 13: 27, 15: 28, 16: 29, 17: 30, 18: 31 },
  },
];

// Independents: [position display_order, voter number]
const INDEPENDENTS = [
  [1, 41], [2, 42], [4, 43], [6, 44], [7, 45], [10, 46], [11, 47], [12, 48], [13, 49], [14, 50],
  [19, 51], [20, 52], [21, 53], [22, 54], [23, 55],
];

const regNo = (n) => `2021-415-${String(n).padStart(3, '0')}`;

export default async function seed({ query, withTransaction }) {
  // Seeds run in name order, so 03 runs before 04_voters.js. Both are idempotent,
  // so make sure the voters exist first (and the election, from 02).
  const { default: seedElection } = await import('./02_election.js');
  const { default: seedVoters } = await import('./04_voters.js');
  await seedElection({ query, withTransaction });
  await seedVoters({ query, withTransaction });

  const runner = withTransaction || (async (fn) => fn({ query }));

  await runner(async (client) => {
    const { rows: el } = await client.query('SELECT id FROM elections ORDER BY starts_at DESC LIMIT 1');
    if (!el[0]) throw new Error('No election found. Run 02_election first (npm run seed).');
    const electionId = el[0].id;

    const { rows: positions } = await client.query(
      'SELECT id, display_order FROM positions WHERE election_id = $1',
      [electionId],
    );
    const positionId = new Map(positions.map((p) => [p.display_order, p.id]));

    async function voterId(n) {
      const { rows } = await client.query('SELECT id FROM voters WHERE reg_no = $1', [regNo(n)]);
      if (!rows[0]) throw new Error(`Voter ${regNo(n)} not found. Run 04_voters first.`);
      return rows[0].id;
    }

    async function upsertCandidate(order, voterNo, panelId, bio, manifesto) {
      const vId = await voterId(voterNo);
      const pId = positionId.get(order);
      if (!pId) throw new Error(`Position ${order} not found.`);
      await client.query(
        `INSERT INTO candidates (voter_id, position_id, panel_id, bio, manifesto, status)
         VALUES ($1, $2, $3, $4, $5, 'approved')
         ON CONFLICT (voter_id) DO NOTHING`,
        [vId, pId, panelId, bio, manifesto],
      );
    }

    for (const panel of PANELS) {
      const leaderId = await voterId(panel.leader);
      let { rows } = await client.query(
        'SELECT id FROM panels WHERE election_id = $1 AND name = $2',
        [electionId, panel.name],
      );
      if (!rows[0]) {
        ({ rows } = await client.query(
          `INSERT INTO panels (election_id, name, slogan, manifesto, created_by)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [electionId, panel.name, panel.slogan, panel.manifesto, leaderId],
        ));
      }
      const panelId = rows[0].id;
      for (const [order, voterNo] of Object.entries(panel.members)) {
        await upsertCandidate(
          Number(order),
          voterNo,
          panelId,
          `Student leader and member of ${panel.name}. Demo profile for testing.`,
          `${panel.manifesto} (Candidate statement: demo data only.)`,
        );
      }
    }

    for (const [order, voterNo] of INDEPENDENTS) {
      await upsertCandidate(
        order,
        voterNo,
        null,
        'Independent candidate. Demo profile for testing.',
        'Standing alone to keep the union accountable to every student. Demo data only.',
      );
    }
  });
}
