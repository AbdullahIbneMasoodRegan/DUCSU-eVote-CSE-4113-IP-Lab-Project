# DUCSU eVote — API contract

One section per member. Update **your own section in the same PR** as the route change.

## Conventions (all modules)

- Base path `/api`. Same origin as the web app; the session is an HTTP-only cookie (`sid`), so the
  client never handles tokens.
- JSON bodies and responses use **camelCase**; database columns are snake_case. Convert in the
  repository layer with `toCamel` / `rowsToCamel` from `server/src/core/db.js`.
- Success: `{ "data": ... }` with 200 (or 201 for creation).
- Error: `{ "error": { "code": "ALREADY_VOTED", "message": "...", "details"?: ... } }` with a proper
  HTTP status. Codes are UPPER_SNAKE_CASE and listed per module below.
- Times are stored and sent as UTC ISO 8601 strings. The client shows Asia/Dhaka time
  (`formatDhakaTime` in `client/src/i18n/index.js`).
- Every route declares its zod schema (`validate`) and role guard (`requireRole`) in the router file.

### Errors every route can return

| Status | Code | When |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | zod rejected the body/params/query. `details: [{ path, message }]` |
| 400 | `INVALID_JSON` | Body is not valid JSON |
| 401 | `UNAUTHENTICATED` | No valid session |
| 401 | `SESSION_EXPIRED` | Session idle for 15 minutes or past its 12-hour limit |
| 403 | `FORBIDDEN` | Logged in, but the role is not allowed |
| 404 | `ROUTE_NOT_FOUND` | No such API route |
| 413 | `PAYLOAD_TOO_LARGE` | JSON body over 100 KB |
| 500 | `INTERNAL_ERROR` | Bug; details are logged, never returned |

### Shared helpers (frozen signatures)

**Server** (`server/src/core/…`):

```js
import { requireAuth, requireRole } from '../../core/middleware/auth.js';
import { validate } from '../../core/middleware/validate.js';
import { query, withTransaction, toCamel } from '../../core/db.js';
import { AppError, badRequest, forbidden, notFound, conflict } from '../../core/errors.js';
import notify from '../notify/index.js';

router.post(
  '/admin/elections',
  requireRole('ec'),                         // sets req.user = { type, id, role }
  validate({ body: z.object({ title: z.string().min(1) }) }),
  async (req, res) => {                     // Express 5: thrown/rejected errors reach the error handler
    if (bad) throw conflict('ELECTION_EXISTS', 'An election already exists.');
    res.status(201).json({ data: toCamel(row) });
  },
);

await withTransaction(async (client) => {
  await client.query('SELECT ... FOR UPDATE', [...]);
});

await notify.send({ to, template: 'otp', data: { ... }, lang: 'bn' });
```

- `requireRole('ec' | 'observer' | 'voter' | 'candidate', ...)` — any listed role passes.
  **Candidates are voters**, so `requireRole('voter')` also admits candidates. The candidate role is
  computed on every request (a voter with a row in `candidates`), so it applies right after nominating.
- `req.user.type` is `'admin'` (EC/Observer, id = `admin_users.id`) or `'voter'` (id = `voters.id`).
- **Dev-only shortcut:** with `NODE_ENV=development`, send `x-dev-user: voter:12` (or `candidate:12`,
  `ec:1`, `observer:1`) instead of logging in. It is ignored in test/production, and the server refuses
  to start if `DEV_USER_HEADER=true` is set outside development.

**Client** (`client/src/app/…`):

```jsx
import { api, ApiError } from '../../app/api.js';
import { useAuth, RequireRole } from '../../app/auth.jsx';

const { user, role, login, logout } = useAuth();
const data = await api.get('/ballot');        // returns the `data` field, throws ApiError { status, code, message, details }
<RequireRole roles={['ec']}><Page /></RequireRole>
```

---

## M1 — Platform and auth

Owner: M1 · Folder: `server/src/modules/auth`, `server/src/modules/notify` · Tables: `admin_users`,
`sessions`, `otp_codes`

### `POST /api/auth/otp/request` — public (FR-01)

Emails a 6-digit code to the voter's university email.

```json
// body
{ "regNo": "2021-415-001", "lang": "en" }    // lang: "en" | "bn", default "en"
// 200 — ALWAYS the same, whatever the number
{ "data": { "expiresInSeconds": 300, "resendAfterSeconds": 60,
            "message": "If this registration number is on the voter list, a code has been sent to its university email." } }
```

- `regNo`: 3–32 letters, digits or dashes.
- The response is identical for unknown, ineligible, cooling-down and valid numbers, and for a resend
  that comes too early (no new email is sent in those cases). The email is sent in the background, so
  timing does not reveal anything either.
- One active code per voter. A request after `resendAfterSeconds` replaces the old code.
- Only an HMAC-SHA-256 of the code is stored; the row expires after 5 minutes.

### `POST /api/auth/otp/verify` — public (FR-01)

```json
// body
{ "regNo": "2021-415-001", "code": "123456" }
// 200 + Set-Cookie: sid=...; HttpOnly; SameSite=Lax (Secure in production)
{ "data": { "user": { "type": "voter", "id": 12, "role": "voter", "regNo": "2021-415-001",
                      "name": "…", "hall": "…", "department": "…", "eligible": true, "hasVoted": false } } }
```

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_CODE` | Wrong, expired, already used, or no code requested (one message for all) |
| 429 | `OTP_COOLDOWN` | 5 wrong codes → locked for 15 min. `details: { retryAt }` |

A correct code is deleted and the session is created in the same transaction, so a code works exactly once,
even under simultaneous requests.

### `POST /api/auth/admin/login` — public (FR-02)

```json
// body
{ "email": "ec@ducsu-evote.test", "password": "…" }
// 200 + Set-Cookie
{ "data": { "user": { "type": "admin", "id": 1, "role": "ec", "name": "…", "email": "…" } } }
```

| Status | Code | When |
| --- | --- | --- |
| 401 | `INVALID_CREDENTIALS` | Unknown email or wrong password (same response for both) |

### `POST /api/auth/logout` — any (FR-02)

Deletes the server-side session and clears the cookie. Safe to call when logged out.
`200 { "data": { "loggedOut": true } }`

### `GET /api/me` — logged in

`200 { "data": { "user": { ... } } }` — same shape as the login responses. `role` is `candidate` for a
voter with a nomination.

### `GET /api/health` — public (NFR-04)

`200 { "data": { "status": "ok", "time": "…" } }` after a database round-trip.

### Sessions

- Random 256-bit token in the cookie; only its SHA-256 hash is stored in `sessions.id`.
- Expires after **15 minutes without a request** (`SESSION_IDLE_MINUTES`) or 12 hours in total
  (`SESSION_MAX_HOURS`). Every authenticated request resets the idle timer.
- Logging in again replaces the browser's previous session.

### Mailer

`notify.send({ to, template, data, lang })`. Templates live in `server/src/modules/notify/templates.js`
(`otp` now; `votingOpen`, `reminder`, `resultsPublished` in Phase 2). Ask M1 to add a template.
Transports: `console` (dev), `memory` (tests, read `notify.outbox`), `smtp` (production).

---

## M2 — Election Commission, audit and results

_Owner: M2. Routes under `/api/admin/elections/*`, `/api/admin/voters/*`, `/api/admin/nominations/*`,
`/api/audit/*`, `/api/results/*`. To be written on Day 2._

## M3 — Candidates, panels, turnout and public pages

_Owner: M3. Routes under `/api/candidates/*`, `/api/panels/*`, `/api/nominations/*`, `/api/turnout/*`,
`/api/observer/*`. To be written on Day 2._

## M4 — Voting engine

_Owner: M4. Routes under `/api/ballot/*`, `/api/vote`, `/api/receipts/*`, `/api/admin/photos/*`.
To be written on Day 2._
