import { defineConfig } from 'vitest/config';

// Tests run against a real PostgreSQL database (default: ducsu_evote_test on
// localhost). Set DATABASE_URL_TEST to point somewhere else. The database is
// created if missing and wiped + migrated before every run.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST || 'postgres://postgres:postgres@localhost:5432/ducsu_evote_test';
process.env.OTP_SECRET ??= 'test-otp-secret-0123456789';
process.env.DEV_USER_HEADER = 'false';
process.env.MAIL_TRANSPORT = 'memory';
process.env.LOG_LEVEL = 'silent';

export default defineConfig({
  test: {
    globalSetup: './tests/globalSetup.js',
    setupFiles: ['./tests/setup.js'],
    // One shared database, so test files run one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
