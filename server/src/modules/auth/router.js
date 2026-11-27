// M1 — /api/auth/* and /api/me. See docs/api.md § M1.
import { Router } from 'express';
import { z } from 'zod';
import config from '../../core/config.js';
import { requireAuth } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { otpRequestPerIp, otpRequestPerRegNo, loginPerIp } from '../../core/middleware/rateLimit.js';
import {
  setSessionCookie,
  clearSessionCookie,
  destroySession,
  resolveSession,
} from '../../core/sessions.js';
import { requestOtp, verifyOtp, adminLogin, getProfile } from './service.js';
import audit from '../audit/index.js';

const router = Router();

const regNo = z
  .string()
  .trim()
  .min(3)
  .max(32)
  .regex(/^[A-Za-z0-9-]+$/, 'Registration number may contain only letters, digits and dashes');

/**
 * Finish a login: drop any session this browser already had, set the new
 * cookie, and return the profile exactly as /api/me would.
 */
async function finishLogin(req, res, token) {
  await destroySession(req.cookies?.[config.session.cookieName]);
  await setSessionCookie(res, token);
  const { user } = await resolveSession(token);
  res.json({ data: { user: await getProfile(user) } });
}

// FR-01: ask for a one-time code. Always the same neutral response.
router.post(
  '/auth/otp/request',
  otpRequestPerIp,
  validate({ body: z.object({ regNo, lang: z.enum(['en', 'bn']).default('en') }) }),
  otpRequestPerRegNo,
  async (req, res) => {
    const data = await requestOtp(req.body);
    res.json({
      data: {
        ...data,
        message:
          'If this registration number is on the voter list, a code has been sent to its university email.',
      },
    });
  },
);

// FR-01: exchange the code for a session cookie.
router.post(
  '/auth/otp/verify',
  loginPerIp,
  validate({
    body: z.object({ regNo, code: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits') }),
  }),
  async (req, res) => {
    const { token } = await verifyOtp(req.body);
    await finishLogin(req, res, token);
  },
);

// FR-02: EC and Observer login.
router.post(
  '/auth/admin/login',
  loginPerIp,
  validate({
    body: z.object({
      email: z.string().trim().email().max(254),
      password: z.string().min(1).max(200),
    }),
  }),
  async (req, res) => {
    const { token, adminId } = await adminLogin(req.body);
    // Admin logins go in the audit log (FR-16); voter logins never do (ballot secrecy).
    await audit.record({ user: { type: 'admin', id: adminId }, ip: req.ip }, 'ADMIN_LOGIN', `admin:${adminId}`);
    await finishLogin(req, res, token);
  },
);

// FR-02: logout deletes the server-side session. Safe to call when logged out.
router.post('/auth/logout', async (req, res) => {
  await destroySession(req.cookies?.[config.session.cookieName]);
  clearSessionCookie(res);
  res.json({ data: { loggedOut: true } });
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ data: { user: await getProfile(req.user) } });
});

export default router;
