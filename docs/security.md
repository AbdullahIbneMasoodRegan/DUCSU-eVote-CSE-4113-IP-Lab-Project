# DUCSU eVote — security checklist (NFR-05)

Owner: M1. Each line says where the control lives and how it is tested. Tick the box only when the
test exists and passes in CI.

## Transport and browser

- [x] **HTTPS only in production.** Render terminates TLS; `Strict-Transport-Security` (180 days) and
      `upgrade-insecure-requests` are sent when `NODE_ENV=production` (`server/src/app.js`).
- [x] **Session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production**
      (`server/src/core/sessions.js`). Same-origin app + API, so no CORS is enabled at all.
- [x] **Security headers via helmet:** `Content-Security-Policy` (scripts only from this site; fonts from
      Google Fonts; images `self`/`data:`/`blob:` for photo previews; `frame-ancestors 'none'`),
      `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy: no-referrer`,
      no `X-Powered-By`. Test: `tests/core/security.test.js`.

## Authentication and sessions

- [x] **Voter OTP:** 6 digits from a CSPRNG, stored only as HMAC-SHA256 bound to the voter, 5-minute
      expiry, 5 wrong tries then a 15-minute lockout, one active code per voter, burned on use inside the
      same transaction that creates the session. Tests: `tests/auth/otp.test.js`.
- [x] **No account enumeration:** the OTP request answers identically for unknown, ineligible and valid
      registration numbers, and sends the email in the background so timing does not differ. Admin login
      compares against a dummy bcrypt hash for unknown emails.
- [x] **Passwords:** bcrypt (cost 10) for EC/Observer accounts; seed passwords come from environment
      variables, never from the repo.
- [x] **Sessions:** 256-bit random token; only its SHA-256 hash is stored. 15-minute idle and 12-hour
      absolute expiry, enforced on the server. Logout deletes the row.
- [x] **Rate limits:** OTP request per IP and per registration number; OTP verify and admin login per IP.
      EC can tune them on the settings page. Test: `tests/core/security.test.js`.
- [x] **Role guards on every route** (`requireRole` in each router file). Tests:
      `tests/core/guards.test.js`.
- [x] **Dev-only `x-dev-user` header** is ignored outside development, and the server refuses to start if
      it is switched on anywhere else. Test: `tests/core/config-logging.test.js`.
- [x] **Admin logins are audited** (`ADMIN_LOGIN`); voter logins are not, to protect ballot secrecy.

## Input and data

- [x] **Every route validates input with zod** (`validate()` middleware); JSON bodies limited to 100 KB;
      photo uploads limited to 2 MB and re-encoded (M4).
- [x] **SQL is always parameterised** (`pg` placeholders); no string-built queries with user input.
- [x] **Errors never leak internals:** unknown errors become `500 INTERNAL_ERROR`; stack traces only in
      the server log.

## Ballot secrecy

- [x] **No link between voter and ballot:** no `voter_id`, timestamp or serial on `ballots`,
      `ballot_choices`, `receipts` or photos; `has_voted` is a boolean with no `voted_at`. Test:
      `tests/core/schema-secrecy.test.js`.
- [x] **Logs redact `/api/vote` and `/api/receipts`** (path prefix only, never bodies; errors log only the
      code). Test: `tests/core/config-logging.test.js`.
- [x] **Ballots encrypted at rest:** AES-256-GCM + RSA-OAEP (SHA-256) with the election public key;
      padded to a fixed size. The private key is generated in the EC's browser and never sent to the
      server; it is uploaded only at counting time and kept in memory. Tests: `tests/crypto/crypto.test.js`.
- [ ] **M4 stores `encrypted_choices` and stops writing plain `ballot_choices`** (Phase 2, M4).
- [ ] **M2 decrypts in memory at counting** (Phase 2, M2).

## Secrets and operations

- [x] **Secrets only in environment variables** (`DATABASE_URL`, `OTP_SECRET`, `BREVO_API_KEY`, seed
      passwords). `.env` is git-ignored; `render.yaml` marks them `sync: false`. Production refuses to start
      with the example `OTP_SECRET`.
- [x] **Least-privilege email key:** the Brevo API key is restricted to transactional email only.
- [x] **Audit log** for every admin action, hash-chained (M2).
- [x] **Backups:** `npm run backup` / `npm run restore` (JSON, or `pg_dump` when installed); backups are
      git-ignored because they hold voter emails. Test: `tests/core/backup.test.js`. Procedure:
      `docs/operations.md`.
- [ ] **Uptime monitor** on `/api/health` during the demo window (set up on the day; see
      `docs/operations.md`).
- [x] **Bulk email safety:** reserved test domains are never emailed; one sender at a time (database
      lock); progress saved so a restart never repeats an email. Test: `tests/notify/campaigns.test.js`.
- [ ] **`npm audit`** shows no high/critical issues in production dependencies before the final tag.

## If something goes wrong

1. Rotate the leaked secret on Render (and Brevo/Neon), then redeploy. Rotating `OTP_SECRET` only
   invalidates codes that are currently active.
2. Delete all sessions to force everyone to log in again: `DELETE FROM sessions;`
3. Check the audit log and its integrity check for admin actions around the time of the incident.
