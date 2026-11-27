// M1 — rate limits on logins and OTP requests (NFR-05).
//
// Limits are read from the EC settings page on every request (environment
// values are the defaults), so the EC can raise them on election day without
// a redeploy. Counters live in memory: the app runs as a single instance.
// A blocked request gets 429 RATE_LIMITED in the usual error format.
import rateLimit from 'express-rate-limit';
import config from '../config.js';
import { tooMany } from '../errors.js';
import settings from '../../modules/settings/index.js';

const MINUTE = 60_000;

// Off in automated tests so other modules' tests can log in freely;
// the rate-limit tests switch it on.
let enabled = !config.isTest;
export function setRateLimitEnabled(on) {
  enabled = on;
}

function limiter({ windowMs, settingKey, keyGenerator, message }) {
  return rateLimit({
    windowMs,
    limit: () => settings.get(settingKey),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => !enabled,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res, next, options) => {
      const retryAfter = Math.ceil(options.windowMs / 1000);
      next(tooMany('RATE_LIMITED', message, { retryAfterSeconds: retryAfter }));
    },
  });
}

/** OTP requests from one IP address (campus Wi-Fi shares IPs, so the default is generous). */
export const otpRequestPerIp = limiter({
  windowMs: 15 * MINUTE,
  settingKey: 'rateLimit.otpPerIpPer15Minutes',
  message: 'Too many code requests from this network. Please wait a few minutes and try again.',
});

/** OTP requests for one registration number: stops anyone flooding a voter's inbox. */
export const otpRequestPerRegNo = limiter({
  windowMs: 60 * MINUTE,
  settingKey: 'rateLimit.otpPerRegNoPerHour',
  keyGenerator: (req) => `regno:${String(req.body?.regNo ?? '').trim().toUpperCase()}`,
  message: 'Too many codes were requested for this registration number. Please try again later.',
});

/** Code checks and admin password logins from one IP address. */
export const loginPerIp = limiter({
  windowMs: 15 * MINUTE,
  settingKey: 'rateLimit.loginPerIpPer15Minutes',
  message: 'Too many login attempts from this network. Please wait a few minutes and try again.',
});
