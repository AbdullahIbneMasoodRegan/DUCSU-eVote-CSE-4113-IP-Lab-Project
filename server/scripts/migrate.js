// M1 — run database migrations with the app's own config.
//   npm run migrate            -> up (all pending)
//   npm run migrate -- down    -> roll back the last migration
//   npm run migrate -- down 3  -> roll back three
// New migration file:  npm run migrate:create -- m2-add-voter-phone
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import config from '../src/core/config.js';

export async function migrate({ direction = 'up', count, databaseUrl = config.db.url, log } = {}) {
  return runner({
    databaseUrl: {
      connectionString: databaseUrl,
      ssl: config.db.ssl ? { rejectUnauthorized: false } : undefined,
    },
    dir: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations'),
    migrationsTable: 'pgmigrations',
    direction,
    count: count ?? (direction === 'down' ? 1 : Infinity),
    log: log ?? ((msg) => console.log(msg)),
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [direction = 'up', count] = process.argv.slice(2);
  if (!['up', 'down'].includes(direction)) {
    console.error('Usage: npm run migrate -- [up|down] [count]');
    process.exit(1);
  }
  migrate({ direction, count: count ? Number(count) : undefined })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
