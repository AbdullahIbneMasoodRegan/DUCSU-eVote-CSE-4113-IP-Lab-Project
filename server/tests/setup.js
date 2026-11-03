// Runs in every test file: close the pool when the file is done.
import { afterAll } from 'vitest';
import { pool } from '../src/core/db.js';

afterAll(async () => {
  await pool.end();
});
