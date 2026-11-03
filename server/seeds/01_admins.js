// M1 — demo EC and Observer accounts (dummy data only).
// Passwords come from SEED_EC_PASSWORD / SEED_OBSERVER_PASSWORD, with
// development defaults. Re-running updates the password and name.
import bcrypt from 'bcryptjs';

const admins = [
  {
    email: 'ec@ducsu-evote.test',
    name: 'Demo Election Commissioner',
    role: 'ec',
    password: process.env.SEED_EC_PASSWORD || 'ec-demo-pass',
  },
  {
    email: 'observer@ducsu-evote.test',
    name: 'Demo Observer',
    role: 'observer',
    password: process.env.SEED_OBSERVER_PASSWORD || 'observer-demo-pass',
  },
];

export default async function seed({ query }) {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_EC_PASSWORD) {
    throw new Error('Set SEED_EC_PASSWORD and SEED_OBSERVER_PASSWORD before seeding production');
  }
  for (const a of admins) {
    const hash = await bcrypt.hash(a.password, 10);
    await query(
      `INSERT INTO admin_users (email, password_hash, role, name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (lower(email)) DO UPDATE
          SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, name = EXCLUDED.name`,
      [a.email, hash, a.role, a.name],
    );
  }
}
