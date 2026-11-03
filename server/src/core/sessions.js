// M1 — server-side sessions. The browser holds a random token in an
// HTTP-only cookie; the database stores only its SHA-256 hash.
import crypto from 'node:crypto';
import config from './config.js';
import { query } from './db.js';

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

/**
 * Create a session and return the raw token (to put in the cookie).
 * subjectType: 'admin' | 'voter'. role: 'ec' | 'observer' | 'voter'.
 * Pass a transaction client as `db` to create it inside a transaction.
 */
export async function createSession({ subjectType, subjectId, role }, db = { query }) {
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    `INSERT INTO sessions (id, subject_type, subject_id, role, expires_at, last_seen_at)
     VALUES ($1, $2, $3, $4, now() + $5 * interval '1 millisecond', now())`,
    [hashToken(token), subjectType, subjectId, role, config.session.maxMs],
  );
  return token;
}

/**
 * Look up a session by raw token. Returns { user } for a live session,
 * { expired: true } if it existed but timed out (and deletes it), or null.
 * Touches last_seen_at so the idle timer restarts.
 */
export async function resolveSession(token) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const id = hashToken(token);
  const { rows } = await query(
    `SELECT s.subject_type, s.subject_id, s.role,
            (s.expires_at <= now()
              OR s.last_seen_at <= now() - $2 * interval '1 millisecond') AS expired,
            (s.subject_type = 'voter'
              AND EXISTS (SELECT 1 FROM candidates c WHERE c.voter_id = s.subject_id)) AS is_candidate
       FROM sessions s
      WHERE s.id = $1`,
    [id, config.session.idleMs],
  );
  const s = rows[0];
  if (!s) return null;
  if (s.expired) {
    await query('DELETE FROM sessions WHERE id = $1', [id]);
    return { expired: true };
  }
  await query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [id]);
  return { user: toUser(s) };
}

export async function destroySession(token) {
  if (!token || typeof token !== 'string') return;
  await query('DELETE FROM sessions WHERE id = $1', [hashToken(token)]);
}

/** Remove expired or idle sessions (cheap; called opportunistically at login). */
export async function purgeStaleSessions() {
  await query(
    `DELETE FROM sessions
      WHERE expires_at <= now() OR last_seen_at <= now() - $1 * interval '1 millisecond'`,
    [config.session.idleMs],
  );
}

/** A candidate is a voter with a row in candidates, so the role is computed per request. */
export function toUser(s) {
  const role = s.subject_type === 'voter' ? (s.is_candidate ? 'candidate' : 'voter') : s.role;
  return { type: s.subject_type, id: s.subject_id, role };
}

const cookieOptions = () => ({
  httpOnly: true,
  secure: config.session.secureCookie,
  sameSite: 'lax',
  path: '/',
});

export function setSessionCookie(res, token) {
  res.cookie(config.session.cookieName, token, { ...cookieOptions(), maxAge: config.session.maxMs });
}

export function clearSessionCookie(res) {
  res.clearCookie(config.session.cookieName, cookieOptions());
}
