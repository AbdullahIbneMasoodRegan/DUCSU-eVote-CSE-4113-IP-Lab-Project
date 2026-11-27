// M1 — EC-editable settings (NFR-09). Frozen signature:
//
//   await settings.get(key)  -> the saved value, or the environment default
//
// Every setting is declared once in DEFINITIONS with its range and default, so
// the settings page, the validation and the defaults can never disagree.
// Saved values live in the `settings` table; environment variables are the defaults.
// Changes are refused while voting is open, and each change is audited.
import config from '../../core/config.js';
import { query, withTransaction } from '../../core/db.js';
import { badRequest, conflict } from '../../core/errors.js';
import audit from '../audit/index.js';
import { status as electionStatus } from '../election/index.js';

/** key -> { group, unit, min, max, default() } */
export const DEFINITIONS = {
  'otp.ttlMinutes': {
    group: 'otp',
    unit: 'minutes',
    min: 1,
    max: 30,
    default: () => config.otp.ttlMs / 60_000,
  },
  'otp.maxAttempts': {
    group: 'otp',
    unit: 'attempts',
    min: 1,
    max: 10,
    default: () => config.otp.maxAttempts,
  },
  'otp.cooldownMinutes': {
    group: 'otp',
    unit: 'minutes',
    min: 1,
    max: 180,
    default: () => config.otp.cooldownMs / 60_000,
  },
  'otp.resendSeconds': {
    group: 'otp',
    unit: 'seconds',
    min: 10,
    max: 600,
    default: () => config.otp.resendMs / 1000,
  },
  'session.idleMinutes': {
    group: 'session',
    unit: 'minutes',
    min: 5,
    max: 120,
    default: () => config.session.idleMs / 60_000,
  },
  'session.maxHours': {
    group: 'session',
    unit: 'hours',
    min: 1,
    max: 24,
    default: () => config.session.maxMs / 3_600_000,
  },
  'rateLimit.otpPerRegNoPerHour': {
    group: 'rateLimit',
    unit: 'requests',
    min: 1,
    max: 50,
    default: () => config.rateLimit.otpPerRegNoPerHour,
  },
  'rateLimit.otpPerIpPer15Minutes': {
    group: 'rateLimit',
    unit: 'requests',
    min: 5,
    max: 1000,
    default: () => config.rateLimit.otpPerIpPer15Min,
  },
  'rateLimit.loginPerIpPer15Minutes': {
    group: 'rateLimit',
    unit: 'requests',
    min: 5,
    max: 1000,
    default: () => config.rateLimit.loginPerIpPer15Min,
  },
  'notify.reminderHoursBeforeClose': {
    group: 'notify',
    unit: 'hours',
    min: 1,
    max: 48,
    default: () => config.notify.reminderHoursBeforeClose,
  },
};

// Small cache: settings are read on every login and session check. A change
// made through set() updates it at once; the TTL only matters if the table is
// edited by hand.
const CACHE_MS = 10_000;
let cache = null; // { at, values: Map }

async function load() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.values;
  const { rows } = await query('SELECT key, value FROM settings');
  const values = new Map(rows.map((r) => [r.key, Number(r.value)]));
  cache = { at: Date.now(), values };
  return values;
}

/** Forget cached values (tests, or after editing the table by hand). */
export function clearCache() {
  cache = null;
}

function definition(key) {
  const def = DEFINITIONS[key];
  if (!def) throw new Error(`settings: unknown key "${key}"`);
  return def;
}

/** The saved value, or the environment default when the EC has not changed it. */
export async function get(key) {
  const def = definition(key);
  const saved = (await load()).get(key);
  return Number.isFinite(saved) ? saved : def.default();
}

/** Every setting with its current value, default and allowed range (for the settings page). */
export async function getAll() {
  const values = await load();
  const { rows } = await query('SELECT key, updated_at FROM settings');
  const updatedAt = new Map(rows.map((r) => [r.key, r.updated_at]));
  return Object.entries(DEFINITIONS).map(([key, def]) => {
    const saved = values.get(key);
    const isSaved = Number.isFinite(saved);
    return {
      key,
      group: def.group,
      unit: def.unit,
      min: def.min,
      max: def.max,
      default: def.default(),
      value: isSaved ? saved : def.default(),
      isDefault: !isSaved,
      updatedAt: updatedAt.get(key)?.toISOString?.() ?? null,
    };
  });
}

/**
 * Save several settings at once (all or nothing). `values` is { key: number | null };
 * null resets that key to its environment default. Refused while voting is open.
 */
export async function set(req, values) {
  if ((await electionStatus()) === 'open') {
    throw conflict('SETTINGS_LOCKED', 'Settings cannot be changed while voting is open.');
  }
  const entries = Object.entries(values);
  for (const [key, value] of entries) {
    const def = DEFINITIONS[key];
    if (!def) throw badRequest('UNKNOWN_SETTING', `Unknown setting: ${key}`, { key });
    if (value === null) continue;
    if (!Number.isInteger(value) || value < def.min || value > def.max) {
      throw badRequest('INVALID_SETTING', `${key} must be a whole number from ${def.min} to ${def.max}.`, {
        key,
        min: def.min,
        max: def.max,
      });
    }
  }

  const before = await load();
  await withTransaction(async (client) => {
    for (const [key, value] of entries) {
      const old = Number.isFinite(before.get(key)) ? before.get(key) : definition(key).default();
      if (value === null) {
        const { rowCount } = await client.query('DELETE FROM settings WHERE key = $1', [key]);
        if (rowCount) {
          await audit.record(req, 'RESET_SETTING', `${key}: ${old} -> default ${definition(key).default()}`, client);
        }
        continue;
      }
      if (value === old && before.has(key)) continue; // unchanged
      await client.query(
        `INSERT INTO settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by,
                                         updated_at = now()`,
        [key, String(value), req.user?.type === 'admin' ? req.user.id : null],
      );
      await audit.record(req, 'UPDATE_SETTING', `${key}: ${old} -> ${value}`, client);
    }
  });
  clearCache();
  return getAll();
}

export const settings = { get, getAll, set, clearCache, DEFINITIONS };
export default settings;
