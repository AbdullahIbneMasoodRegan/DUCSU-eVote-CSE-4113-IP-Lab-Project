// Creates the test database if needed, wipes it and runs all migrations.
import pg from 'pg';

export default async function setup() {
  const url = new URL(process.env.DATABASE_URL);
  const dbName = url.pathname.slice(1);
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to wipe "${dbName}": the test database name must contain "test"`);
  }

  // Create the database if it does not exist.
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (!rowCount) await admin.query(`CREATE DATABASE "${dbName.replace(/"/g, '')}"`);
  await admin.end();

  // Fresh schema every run, then migrate.
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await client.end();

  const { migrate } = await import('../scripts/migrate.js');
  await migrate({ log: () => {} });

  const { pool } = await import('../src/core/db.js');
  await pool.end();
}
