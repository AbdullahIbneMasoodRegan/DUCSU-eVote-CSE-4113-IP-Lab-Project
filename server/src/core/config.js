// M1 — application configuration, read once from environment variables.
// Every tunable value has a safe default and is documented in /.env.example.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
// Load the repo-root .env (if any). Real environment variables always win.
dotenv.config({ path: path.join(repoRoot, '.env'), quiet: true });

const bool = (fallback) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const int = (fallback) => z.coerce.number().int().positive().default(fallback);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: int(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_SSL: bool(false),

  SESSION_COOKIE_NAME: z.string().default('sid'),
  SESSION_IDLE_MINUTES: int(15),
  SESSION_MAX_HOURS: int(12),

  OTP_SECRET: z.string().min(16, 'OTP_SECRET must be at least 16 characters'),
  OTP_TTL_MINUTES: int(5),
  OTP_MAX_ATTEMPTS: int(5),
  OTP_COOLDOWN_MINUTES: int(15),
  OTP_RESEND_SECONDS: int(60),

  MAIL_TRANSPORT: z.enum(['console', 'smtp', 'memory']).optional(),
  MAIL_FROM: z.string().default('DUCSU eVote <no-reply@ducsu-evote.local>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: int(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  DEV_USER_HEADER: bool(true),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).optional(),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const e = parsed.data;
  const isDev = e.NODE_ENV === 'development';
  const isProd = e.NODE_ENV === 'production';

  // The x-dev-user shortcut is only ever allowed in development. If someone
  // explicitly turns it on anywhere else, refuse to start.
  if (!isDev && env.DEV_USER_HEADER !== undefined && e.DEV_USER_HEADER) {
    throw new Error('DEV_USER_HEADER may only be enabled when NODE_ENV=development');
  }
  if (isProd && e.OTP_SECRET.includes('change-me')) {
    throw new Error('OTP_SECRET must be changed in production');
  }

  return {
    env: e.NODE_ENV,
    isDev,
    isProd,
    isTest: e.NODE_ENV === 'test',
    port: e.PORT,
    repoRoot,
    db: { url: e.DATABASE_URL, ssl: e.DATABASE_SSL },
    session: {
      cookieName: e.SESSION_COOKIE_NAME,
      idleMs: e.SESSION_IDLE_MINUTES * 60_000,
      maxMs: e.SESSION_MAX_HOURS * 3_600_000,
      secureCookie: isProd,
    },
    otp: {
      secret: e.OTP_SECRET,
      ttlMs: e.OTP_TTL_MINUTES * 60_000,
      maxAttempts: e.OTP_MAX_ATTEMPTS,
      cooldownMs: e.OTP_COOLDOWN_MINUTES * 60_000,
      resendMs: e.OTP_RESEND_SECONDS * 1000,
    },
    mail: {
      transport:
        e.MAIL_TRANSPORT ?? (isProd ? 'smtp' : e.NODE_ENV === 'test' ? 'memory' : 'console'),
      from: e.MAIL_FROM,
      smtp: { host: e.SMTP_HOST, port: e.SMTP_PORT, user: e.SMTP_USER, pass: e.SMTP_PASS },
    },
    devUserHeader: isDev && e.DEV_USER_HEADER,
    logLevel: e.LOG_LEVEL ?? (e.NODE_ENV === 'test' ? 'silent' : 'info'),
  };
}

export const config = loadConfig();
export default config;
