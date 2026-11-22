// M2 — seed 200 dummy voters across 5 halls (dummy data only).
// Idempotent: safe to re-run.

const HALLS = [
  'Salimullah Muslim Hall',
  'Dr. Muhammad Shahidullah Hall',
  'Jagannath Hall',
  'Fazlul Huq Muslim Hall',
  'Ruqayyah Hall',
];

const DEPARTMENTS = [
  'Computer Science and Engineering',
  'Electrical and Electronic Engineering',
  'Physics',
  'Mathematics',
  'Economics',
  'Law',
  'International Relations',
  'Chemistry',
  'Biochemistry and Molecular Biology',
  'Pharmacy',
];

export default async function seed({ query, withTransaction }) {
  const runner = withTransaction || (async (fn) => fn({ query }));

  await runner(async (client) => {
    // Generate 200 dummy voters
    const voters = [];
    for (let i = 1; i <= 200; i++) {
      const pad = String(i).padStart(3, '0');
      const regNo = `2021-415-${pad}`;
      const name = `DU Student ${pad}`;
      const email = `voter${pad}@ducsu-evote.test`;
      const hall = HALLS[(i - 1) % HALLS.length];
      const department = DEPARTMENTS[(i - 1) % DEPARTMENTS.length];
      const eligible = true;
      const hasVoted = false;

      voters.push({ regNo, name, email, hall, department, eligible, hasVoted });
    }

    // Batch insert using parameterized VALUES
    for (const v of voters) {
      await client.query(
        `INSERT INTO voters (reg_no, name, email, hall, department, eligible, has_voted)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (reg_no) DO UPDATE
            SET name = EXCLUDED.name,
                email = EXCLUDED.email,
                hall = EXCLUDED.hall,
                department = EXCLUDED.department,
                eligible = EXCLUDED.eligible,
                has_voted = EXCLUDED.has_voted`,
        [v.regNo, v.name, v.email, v.hall, v.department, v.eligible, v.hasVoted]
      );
    }
  });
}
