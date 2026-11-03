// M1 — minimal structured logger (JSON lines in production, readable in dev).
// NEVER pass request bodies, receipt codes or ballot choices to this logger.
import config from './config.js';

const levels = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const threshold = levels[config.logLevel] ?? levels.info;

function write(level, msg, fields) {
  if (levels[level] < threshold) return;
  const hasFields = fields && Object.keys(fields).length > 0;
  const line = config.isProd
    ? JSON.stringify({ time: new Date().toISOString(), level, msg, ...fields })
    : `[${level}] ${msg}${hasFields ? ' ' + JSON.stringify(fields) : ''}`;
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

export const logger = {
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};
export default logger;
