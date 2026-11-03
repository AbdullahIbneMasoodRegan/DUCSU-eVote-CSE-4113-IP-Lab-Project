// M1 — login logic: voter OTP (FR-01) and EC/Observer password login (FR-02).
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import config from '../../core/config.js';
import { query, withTransaction } from '../../core/db.js';
import { AppError, badRequest, unauthorized, tooMany } from '../../core/errors.js';
import logger from '../../core/logger.js';
import { createSession, purgeStaleSessions } from '../../core/sessions.js';
import notify from '../notify/index.js';

// ---------------------------------------------------------------- OTP helpers

export function generateOtp() {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Keyed hash of the code, bound to the voter, so a leaked table is useless. */
export function hashOtp(voterId, code) {
  return crypto.createHmac('sha256', config.otp.secret).update(`${voterId}:${code}`).digest('hex');
}

function sameHash(a, b) {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const INVALID_CODE = () =>
  badRequest('INVALID_CODE', 'The code is incorrect or has expired. Please try again or request a new code.');

// ------------------------------------------------------------- OTP request

/**
 * Always resolves with the same neutral response, whether the registration
 * number is unknown, ineligible, in cooldown, asking too soon, or valid, so
 * this endpoint cannot be used to discover who is on the voter list.
 * The email is sent in the background so response time does not leak either.
 */
export async function requestOtp({ regNo, lang }) {
  const neutral = {
    expiresInSeconds: Math.round(config.otp.ttlMs / 1000),
    resendAfterSeconds: Math.round(config.otp.resendMs / 1000),
  };

  const { rows } = await query(
    `SELECT id, name, email, eligible, otp_cooldown_until > now() AS in_cooldown
       FROM voters WHERE reg_no = $1`,
    [regNo],
  );
  const voter = rows[0];
  if (!voter || !voter.eligible || voter.in_cooldown) return neutral;

  const code = generateOtp();
  // One active code per voter. A new request replaces the old code, but only
  // after the resend interval has passed (atomic: no row returned = too soon).
  const { rowCount } = await query(
    `INSERT INTO otp_codes (voter_id, code_hash, expires_at, failed_attempts, created_at)
     VALUES ($1, $2, now() + $3 * interval '1 millisecond', 0, now())
     ON CONFLICT (voter_id) DO UPDATE
        SET code_hash = EXCLUDED.code_hash,
            expires_at = EXCLUDED.expires_at,
            failed_attempts = 0,
            created_at = now()
      WHERE otp_codes.created_at <= now() - $4 * interval '1 millisecond'`,
    [voter.id, hashOtp(voter.id, code), config.otp.ttlMs, config.otp.resendMs],
  );
  if (rowCount === 0) return neutral;

  notify
    .send({
      to: voter.email,
      template: 'otp',
      data: { name: voter.name, code, minutes: Math.round(config.otp.ttlMs / 60_000) },
      lang,
    })
    .catch((err) => logger.error('OTP email failed', { voterId: voter.id, error: err.message }));

  return neutral;
}

// -------------------------------------------------------------- OTP verify

/**
 * Checks the code once. On success the code row is deleted and a session is
 * created in the same transaction, so a code can never be used twice even by
 * two simultaneous requests. Returns { token, voter }.
 */
export async function verifyOtp({ regNo, code }) {
  // The transaction returns an outcome instead of throwing, so the
  // failed-attempt counter is committed even when the code is wrong.
  const outcome = await withTransaction(async (client) => {
    const { rows: vrows } = await client.query(
      `SELECT id, name, eligible, otp_cooldown_until,
              otp_cooldown_until > now() AS in_cooldown
         FROM voters WHERE reg_no = $1 FOR UPDATE`,
      [regNo],
    );
    const voter = vrows[0];
    if (!voter || !voter.eligible) return { error: 'invalid' };
    if (voter.in_cooldown) return { error: 'cooldown', until: voter.otp_cooldown_until };

    const { rows: orows } = await client.query(
      `SELECT id, code_hash, failed_attempts, expires_at <= now() AS expired
         FROM otp_codes WHERE voter_id = $1 FOR UPDATE`,
      [voter.id],
    );
    const otp = orows[0];
    if (!otp) return { error: 'invalid' };
    if (otp.expired) {
      await client.query('DELETE FROM otp_codes WHERE id = $1', [otp.id]);
      return { error: 'invalid' };
    }

    if (!sameHash(otp.code_hash, hashOtp(voter.id, code))) {
      const attempts = otp.failed_attempts + 1;
      if (attempts >= config.otp.maxAttempts) {
        await client.query('DELETE FROM otp_codes WHERE id = $1', [otp.id]);
        const { rows } = await client.query(
          `UPDATE voters SET otp_cooldown_until = now() + $2 * interval '1 millisecond'
            WHERE id = $1 RETURNING otp_cooldown_until`,
          [voter.id, config.otp.cooldownMs],
        );
        return { error: 'cooldown', until: rows[0].otp_cooldown_until };
      }
      await client.query('UPDATE otp_codes SET failed_attempts = $2 WHERE id = $1', [
        otp.id,
        attempts,
      ]);
      return { error: 'invalid' };
    }

    // Correct code: burn it and start a session atomically.
    await client.query('DELETE FROM otp_codes WHERE id = $1', [otp.id]);
    const token = await createSession(
      { subjectType: 'voter', subjectId: voter.id, role: 'voter' },
      client,
    );
    return { token, voterId: voter.id };
  });

  if (outcome.error === 'cooldown') {
    throw tooMany('OTP_COOLDOWN', 'Too many wrong codes. Please wait before trying again.', {
      retryAt: new Date(outcome.until).toISOString(),
    });
  }
  if (outcome.error) throw INVALID_CODE();

  purgeStaleSessions().catch(() => {});
  return { token: outcome.token, voterId: outcome.voterId };
}

// ------------------------------------------------------------ admin login

// Compared against when the email is unknown, so timing does not reveal
// which admin emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export async function adminLogin({ email, password }) {
  const { rows } = await query(
    `SELECT id, password_hash, role FROM admin_users WHERE lower(email) = lower($1)`,
    [email],
  );
  const admin = rows[0];
  const ok = await bcrypt.compare(password, admin?.password_hash ?? DUMMY_HASH);
  if (!admin || !ok) {
    throw unauthorized('INVALID_CREDENTIALS', 'Email or password is incorrect.');
  }
  const token = await createSession({ subjectType: 'admin', subjectId: admin.id, role: admin.role });
  purgeStaleSessions().catch(() => {});
  return { token, adminId: admin.id };
}

// -------------------------------------------------------------------- me

/** Profile for the logged-in user (req.user from requireAuth). */
export async function getProfile(user) {
  if (user.type === 'admin') {
    const { rows } = await query('SELECT name, email FROM admin_users WHERE id = $1', [user.id]);
    return { ...user, ...(rows[0] ?? {}) };
  }
  const { rows } = await query(
    `SELECT reg_no AS "regNo", name, hall, department, eligible, has_voted AS "hasVoted"
       FROM voters WHERE id = $1`,
    [user.id],
  );
  if (!rows[0] && !config.devUserHeader) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Please log in.');
  }
  return { ...user, ...(rows[0] ?? {}) };
}

export const hashPassword = (password) => bcrypt.hash(password, 10);
