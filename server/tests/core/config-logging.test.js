// M1 — configuration guards and log redaction.
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/core/config.js';
import { safePath } from '../../src/core/middleware/requestLogger.js';

const base = { DATABASE_URL: 'postgres://x/y', OTP_SECRET: 'a-long-enough-secret' };

describe('loadConfig', () => {
  it('uses the documented defaults', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'development' });
    expect(c.otp.ttlMs).toBe(5 * 60_000);
    expect(c.otp.maxAttempts).toBe(5);
    expect(c.otp.cooldownMs).toBe(15 * 60_000);
    expect(c.session.idleMs).toBe(15 * 60_000);
    expect(c.mail.transport).toBe('console');
    expect(c.devUserHeader).toBe(true);
  });

  it('never enables the dev header outside development', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).devUserHeader).toBe(false);
    expect(loadConfig({ ...base, NODE_ENV: 'test' }).devUserHeader).toBe(false);
  });

  it('refuses to start if the dev header is explicitly enabled outside development', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production', DEV_USER_HEADER: 'true' })).toThrow(
      /DEV_USER_HEADER/,
    );
    expect(() => loadConfig({ ...base, NODE_ENV: 'test', DEV_USER_HEADER: '1' })).toThrow();
  });

  it('uses secure cookies and SMTP in production', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'production' });
    expect(c.session.secureCookie).toBe(true);
    expect(c.mail.transport).toBe('smtp');
  });

  it('requires DATABASE_URL and a real OTP secret', () => {
    expect(() => loadConfig({ OTP_SECRET: base.OTP_SECRET })).toThrow(/DATABASE_URL/);
    // A value that is not a URL (what caused "ENOTFOUND base" on Render) fails fast with a clear message.
    expect(() => loadConfig({ ...base, DATABASE_URL: 'neondb' })).toThrow(/postgresql:\/\//);
    expect(() => loadConfig({ ...base, DATABASE_URL: '"postgresql://u:p@h/db"' })).toThrow(/postgresql:\/\//);
    expect(() => loadConfig({ DATABASE_URL: 'x', OTP_SECRET: 'short' })).toThrow(/OTP_SECRET/);
    expect(() =>
      loadConfig({ ...base, NODE_ENV: 'production', OTP_SECRET: 'change-me-change-me' }),
    ).toThrow(/OTP_SECRET/);
  });
});

describe('request log redaction (secrecy rule 4)', () => {
  it('never logs receipt codes or query strings', () => {
    expect(safePath('/api/receipts/DU-7KQ4-M9XP')).toBe('/api/receipts');
    expect(safePath('/api/receipts?q=DU-7KQ4')).toBe('/api/receipts');
    expect(safePath('/api/vote')).toBe('/api/vote');
    expect(safePath('/api/candidates/3?x=1')).toBe('/api/candidates/3');
    expect(safePath('/api/voters')).toBe('/api/voters');
  });
});
