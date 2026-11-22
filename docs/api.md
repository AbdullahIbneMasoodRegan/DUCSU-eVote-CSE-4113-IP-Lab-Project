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
- `optionalAuth` — for **public** routes that show more to logged-in users (e.g. `GET /api/results`
  before publishing). Sets `req.user` if there is a valid session, otherwise leaves it `undefined`; it
  never rejects. Without one of these three guards, `req.user` is **never** set, even for a logged-in user.
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

Owner: M2 · Folder: `server/src/modules/election`, `server/src/modules/audit`, `server/src/modules/results` · Tables: `elections`, `positions`, `voters`, `audit_log`, `results`

### `GET /api/elections/current` — public (FR-03)

Status banner data and clock synchronization for all users.
```json
// 200
{
  "data": {
    "id": 1,
    "title": "DUCSU Election 2026-2027",
    "startsAt": "2026-11-23T04:00:00.000Z",
    "endsAt": "2026-11-23T12:00:00.000Z",
    "disputePeriodEndsAt": "2026-11-30T12:00:00.000Z",
    "status": "nomination", // "draft" | "nomination" | "open" | "closed" | "published"
    "serverTime": "2026-11-22T19:30:00.000Z"
  }
}
```

### `POST /api/admin/elections` — EC only (FR-03, FR-04)

Create or update election timing and settings. Blocked after `starts_at` passes.
```json
// body
{
  "title": "DUCSU Election 2026-2027",
  "startsAt": "2026-11-23T04:00:00.000Z",
  "endsAt": "2026-11-23T12:00:00.000Z",
  "disputePeriodEndsAt": "2026-11-30T12:00:00.000Z"
}
```

### `GET /api/admin/positions` — EC / Observer (FR-03)

Lists all positions for the election, candidate counts, and display order.

### `POST /api/admin/positions` — EC only (FR-03, FR-04)

Adds a position. Blocked by `assertEditable()` once voting begins.
```json
// body
{
  "nameEn": "Vice-President (VP)",
  "nameBn": "সহ-সভাপতি (ভিপি)",
  "displayOrder": 1,
  "maxSelections": 1
}
```

### `GET /api/admin/voters` — EC / Observer (FR-04)

Paginated voter roster with filters: `search`, `hall`, `department`, `eligible`, `hasVoted`, `limit`, `offset`.

### `POST /api/admin/voters/import` — EC only (FR-04)

CSV batch upload with row-by-row validation report. Rejects invalid emails and prevents duplicates.
```json
// body
{
  "csv": "reg_no,name,email,hall,department\n2021-001,Student One,s1@ducsu.test,Salimullah Muslim Hall,CSE"
}
// 200
{
  "data": {
    "totalProcessed": 1,
    "importedCount": 1,
    "errorCount": 0,
    "errors": []
  }
}
```

### `PATCH /api/admin/voters/:id/eligibility` — EC only (FR-04)

Toggle voter eligibility. Blocked once voting starts. Audited.
```json
// body
{ "eligible": false }
```

### `GET /api/admin/nominations` — EC / Observer (FR-06)

Queue of candidate nominations for review. Filters by `status` (`pending`, `approved`, `rejected`, `all`) and `positionId`.

### `PATCH /api/admin/nominations/:id` — EC only (FR-06)

Approve or reject a nomination. Rejection requires a mandatory reason. Audited.
```json
// body (rejection)
{
  "status": "rejected",
  "rejectionReason": "Academic standing requirement not met."
}
```

### `GET /api/audit` — EC / Observer (FR-16)

Paginated immutable audit log trail with cryptographic hash chaining (`prev_hash` + SHA-256).

### `POST /api/results/calculate` — EC only (FR-14)

Calculates vote tallies from `ballot_choices`, determines winners based on `max_selections`, flags ties, and verifies ballots == receipts == voters marked voted. Only executable after `ends_at`.

### `POST /api/results/publish` — EC only (FR-14)

Marks the election results published (`results_published_at = now()`).

### `GET /api/results` — Public when published, or EC / Observer (FR-14)

Returns full election results by position, winner flags, ties, and cryptographic consistency metrics.

## M3 — Candidates, panels, turnout and public pages

_Owner: M3. Routes under `/api/candidates/*`, `/api/panels/*`, `/api/nominations/*`, `/api/turnout/*`,
`/api/observer/*`. To be written on Day 2._

## M4 — Voting engine

_Owner: M4. Routes under `/api/ballot/*`, `/api/vote`, `/api/receipts/*`, `/api/admin/photos/*`.
To be written on Day 2._
