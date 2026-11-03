// M1 — authentication and role guards (frozen signatures, see docs/api.md).
//
//   router.get('/x', requireAuth, handler)                 any logged-in user
//   router.post('/y', requireRole('ec'), handler)          EC only
//   router.get('/z', requireRole('ec', 'observer'), ...)   either role
//
// Both set req.user = { type: 'admin' | 'voter', id, role }.
// role is one of 'ec' | 'observer' | 'voter' | 'candidate'.
// A candidate is also a voter, so requireRole('voter') admits candidates too.
import config from '../config.js';
import { unauthorized, forbidden } from '../errors.js';
import { resolveSession, clearSessionCookie } from '../sessions.js';

export const ROLES = ['ec', 'observer', 'voter', 'candidate'];

/**
 * DEVELOPMENT ONLY: `x-dev-user: voter:12` (or candidate:12, ec:1, observer:1)
 * lets other members test their routes before real login is wired up.
 * Disabled unless NODE_ENV=development; config.js refuses to start if it is
 * explicitly enabled anywhere else.
 */
function devUser(req) {
  if (!config.devUserHeader) return null;
  const raw = req.get('x-dev-user');
  if (!raw) return null;
  const m = /^(ec|observer|voter|candidate):(\d+)$/.exec(raw.trim());
  if (!m) return null;
  const role = m[1];
  return { type: role === 'ec' || role === 'observer' ? 'admin' : 'voter', id: Number(m[2]), role };
}

async function authenticate(req, res) {
  if (req.user) return req.user;
  const dev = devUser(req);
  if (dev) return (req.user = dev);

  const token = req.cookies?.[config.session.cookieName];
  const result = await resolveSession(token);
  if (!result) {
    if (token) clearSessionCookie(res);
    throw unauthorized();
  }
  if (result.expired) {
    clearSessionCookie(res);
    throw unauthorized('SESSION_EXPIRED', 'Your session has expired. Please log in again.');
  }
  req.sessionToken = token;
  return (req.user = result.user);
}

export async function requireAuth(req, res, next) {
  await authenticate(req, res);
  next();
}

export function requireRole(...roles) {
  const allowed = roles.flat();
  for (const r of allowed) {
    if (!ROLES.includes(r)) throw new Error(`requireRole: unknown role "${r}"`);
  }
  // Candidates are voters: anything open to voters is open to candidates.
  if (allowed.includes('voter') && !allowed.includes('candidate')) allowed.push('candidate');

  return async function roleGuard(req, res, next) {
    const user = await authenticate(req, res);
    if (!allowed.includes(user.role)) throw forbidden();
    next();
  };
}
