// M1 — process entry point.
import config from './core/config.js';
import logger from './core/logger.js';
import { pool } from './core/db.js';
import { createApp } from './app.js';

const app = createApp();
const server = app.listen(config.port, () => {
  logger.info(`DUCSU eVote listening on http://localhost:${config.port}`, { env: config.env });
  if (config.devUserHeader) logger.warn('x-dev-user header is ENABLED (development only)');
});

function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
