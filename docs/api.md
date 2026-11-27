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
- The EC can change both timeouts (and the OTP limits) on the settings page; the environment variables
  are the defaults.

### Mailer

`notify.send({ to, template, data, lang })`. Templates live in `server/src/modules/notify/templates.js`
(`otp` now; `votingOpen`, `reminder`, `resultsPublished` in Phase 2). Ask M1 to add a template.
Transports (`MAIL_TRANSPORT`): `console` (dev: printed to the server log), `memory` (tests, read
`notify.outbox`), `brevo` (real email over Brevo's HTTPS API; needs `BREVO_API_KEY` and a verified
`MAIL_FROM`), `smtp` (real email over any SMTP server). The server refuses to start if `brevo` is chosen
without a key or a valid sender. A failed send is logged; the OTP endpoint still answers neutrally.

### Rate limits (NFR-05)

`POST /api/auth/otp/request` is limited per IP (default 300 per 15 min, generous because campus Wi-Fi
shares IPs) and per registration number (default 5 per hour). `POST /api/auth/otp/verify` and
`POST /api/auth/admin/login` are limited per IP (default 100 per 15 min). The EC can change all three
on the settings page. Over the limit: `429 RATE_LIMITED` with `details.retryAfterSeconds`, plus
`RateLimit-*` headers. Limits are off in automated tests (`setRateLimitEnabled(true)` turns them on).

Successful EC/Observer logins are recorded in the audit log as `ADMIN_LOGIN`. Voter logins are not.

### `GET /api/admin/settings` — EC / Observer (NFR-09)

```json
{ "data": { "locked": false, "settings": [
  { "key": "otp.ttlMinutes", "group": "otp", "unit": "minutes", "min": 1, "max": 30,
    "default": 5, "value": 10, "isDefault": false, "updatedAt": "…" } ] } }
```

`locked` is `true` while voting is open. Keys: `otp.ttlMinutes`, `otp.maxAttempts`,
`otp.cooldownMinutes`, `otp.resendSeconds`, `session.idleMinutes`, `session.maxHours`,
`rateLimit.otpPerRegNoPerHour`, `rateLimit.otpPerIpPer15Minutes`, `rateLimit.loginPerIpPer15Minutes`,
`notify.reminderHoursBeforeClose`.

### `PUT /api/admin/settings` — EC only (NFR-09)

Body `{ "values": { "otp.ttlMinutes": 10, "session.idleMinutes": null } }`. `null` resets a key to its
environment default. All or nothing; each change is audited (`UPDATE_SETTING` / `RESET_SETTING`,
target `key: old -> new`). Returns the same shape as `GET`.

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_SETTING` | Not a whole number in range; `details: { key, min, max }` |
| 400 | `UNKNOWN_SETTING` | Key not in the list above |
| 409 | `SETTINGS_LOCKED` | Voting is open |

**For everyone:** read a setting with `await settings.get('notify.reminderHoursBeforeClose')`
(`server/src/modules/settings/index.js`). It returns the saved value or the environment default.

### `GET /api/admin/crypto/public-key` — EC / Observer (FR-11 extension)

`200 { "data": { "electionId": 1, "hasKey": true, "fingerprint": "3f2a:…", "publicKey": "-----BEGIN PUBLIC KEY-----…", "locked": false } }`
`400 NO_ELECTION` before an election exists.

### `PUT /api/admin/crypto/public-key` — EC only (FR-11 extension)

Body `{ "publicKey": "-----BEGIN PUBLIC KEY-----…" }` (RSA, at least 2048 bits, PEM/SPKI). The EC page
`/admin/encryption` generates the pair in the browser (RSA-OAEP 3072, SHA-256), downloads the private
key and uploads only the public key. Audited as `SET_PUBLIC_KEY` with the fingerprint.

| Status | Code | When |
| --- | --- | --- |
| 400 | `INVALID_PUBLIC_KEY` | Not a PEM public key, not RSA, or under 2048 bits |
| 409 | `ELECTION_LOCKED` | Voting has started (the key can no longer change) |

### Ballot encryption helpers — for M4 (cast) and M2 (count)

```js
import crypto from '../crypto/index.js';

// M4, inside the cast-vote transaction:
const publicKey = await crypto.getPublicKey(election.id, client);  // null if the EC never set one
const blob = crypto.encryptBallot([{ positionId, candidateId }, ...], publicKey); // string
// store blob in ballots.encrypted_choices (M4 adds this text column in its own migration)

// M2, at counting: privateKeyPem comes from the uploaded file, kept in memory only
if (!crypto.keyPairMatches(privateKeyPem, publicKey)) throw badRequest('WRONG_KEY', '…');
const choices = crypto.decryptBallot(blob, privateKeyPem); // throws if altered or wrong key
```

AES-256-GCM for the choices (detects tampering), RSA-OAEP SHA-256 for the AES key. Every ballot is
padded to the same size, so ciphertext length reveals nothing. Format: `v1.<key>.<iv>.<tag>.<data>`.

### `GET /api/admin/notifications` — EC / Observer (FR-17)

Progress of the three election emails for the current election:

```json
{ "data": { "electionId": 1, "transport": "brevo", "batchSize": 50, "intervalSeconds": 60, "enabled": true,
  "recipients": { "all": 202, "notVoted": 150 },
  "campaigns": [ { "kind": "votingOpen", "dueAt": "…", "state": "finished", "sent": 2, "failed": 0,
                   "skipped": 200, "startedAt": "…", "finishedAt": "…" } ] } }
```

`kind`: `votingOpen` | `reminder` | `resultsPublished`. `state`: `waiting` | `sending` | `finished`.
`skipped` counts reserved test addresses (`.test`, `.example`, `.invalid`, `.localhost`), which are printed
to the log instead of sent. Each finished campaign is audited as `NOTIFY_SENT` (system actor).
`400 NO_ELECTION` before an election exists.

### `GET /api/admin/notifications/preview?template=&lang=` — EC only

`template`: `otp` | `votingOpen` | `reminder` | `resultsPublished`; `lang`: `en` | `bn` | `both` (default).
Returns `{ subject, text, html }` rendered with sample data.

**For M2:** nothing to call when publishing. The email job sees `elections.results_published_at` and sends
the results email by itself.

### What the observer dashboard (`/observer`) expects from M2 and M3

The page already calls these and says "coming soon" while they return 404:

- **M3 `GET /api/turnout`** (observer must be allowed):
  `{ "total": 202, "voted": 50, "byHall": [ { "hall": "…", "total": 40, "voted": 12 } ] }`
  (`eligible` is accepted instead of `total`). Polled every 10 seconds. Aggregates only, no names.
- **M2 `GET /api/audit/verify`** (EC and observer): `{ "valid": true, "checked": 120 }` or
  `{ "valid": false, "firstBrokenId": 37 }`.

`GET /api/health` now also returns `uptimeSeconds`.

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

Owner: M3 · Folders: `server/src/modules/candidates` (turnout arrives in Phase 2) · Tables: `candidates`,
`panels`, `panel_issues`, `files`

All mutating routes call `election.assertEditable()`: once `starts_at` passes they return
`409 ELECTION_LOCKED`. Voter actions are **not** audited (the audit log is for administrative actions only).
Public responses never include a registration number or email.

Shapes used below:

```json
// Candidate (public)
{ "id": 7, "name": "…", "hall": "…", "department": "…", "photoUrl": "/api/candidates/7/photo" | null,
  "position": { "id": 1, "nameEn": "…", "nameBn": "…", "displayOrder": 1, "maxSelections": 1 },
  "panel": { "id": 1, "name": "…", "slogan": "…", "logoUrl": "/api/panels/1/logo" | null } | null,
  "bio": "…" }
// + "manifesto" on GET /api/candidates/:id and on the owner's routes
// + "status" ("pending" | "approved" | "rejected") and "rejectionReason" for the owner, EC and Observer only
```

Images are uploaded as the **raw request body** (`PUT`, `Content-Type: image/jpeg` or `image/png`, max 2 MB).
The server decodes the real bytes, rejects anything that is not a JPEG/PNG, resizes (photo ≤ 800 px, logo ≤ 512 px)
and **re-encodes** it, which strips EXIF/GPS metadata. Client helper: `uploadImage(path, file)` in
`client/src/features/candidates/upload.js`.

### `GET /api/nominations/me` — voter / candidate (FR-05)

```json
{ "data": { "electionStatus": "nomination", "editable": true,
            "nomination": { /* Candidate + manifesto + status + rejectionReason */ } | null,
            "ownedPanel": { "id": 3, "name": "…" } | null } }
```

`editable` is `false` once voting has started. This is the candidate's dashboard data (status and the EC's rejection reason).

### `POST /api/nominations` — voter / candidate (FR-05)

```json
// body
{ "positionId": 4, "bio": "≤ 1000 chars", "manifesto": "≤ 5000 chars" }   // 201 → Candidate (status "pending")
```

| Status | Code | When |
| --- | --- | --- |
| 403 | `NOT_ELIGIBLE` | The voter is marked ineligible |
| 404 | `POSITION_NOT_FOUND` | Position is not in the current election |
| 409 | `ALREADY_NOMINATED` | One nomination per student |
| 409 | `ELECTION_LOCKED` | Voting has started |

### `PATCH /api/nominations/me` — voter / candidate

Any of `positionId`, `bio`, `manifesto`, `panelId` (`null` = independent). A **rejected** nomination goes back to
`pending` (rejection reason cleared) when it is edited. Approved nominations are locked: `409 NOMINATION_APPROVED`.
Also `409 PANEL_POSITION_TAKEN`, `409 CREATOR_CANNOT_LEAVE`.

### `DELETE /api/nominations/me` — voter / candidate

Withdraws the nomination and deletes its photo. `409 NOMINATION_APPROVED` / `CREATOR_CANNOT_LEAVE` (disband your panel first).

### `PUT /api/nominations/me/photo` — voter / candidate (FR-05)

Raw image body, see above. `200` → Candidate. `400 INVALID_IMAGE`, `413 PAYLOAD_TOO_LARGE`, `404 NOT_NOMINATED`.
The previous photo is deleted. A rejected nomination goes back to `pending`.

### `GET /api/candidates` — public (FR-07)

Approved candidates only, grouped by post in ballot order. Posts with no candidates are included.
Optional filters: `positionId`, `panelId`.

```json
{ "data": [ { "position": { … }, "candidates": [ /* Candidate */ ] } ] }
```

### `GET /api/candidates/:id` — public (FR-07)

Full Candidate including `manifesto`. Only **approved** candidates are public (FR-06); the candidate themself, EC and
Observer can also open pending/rejected ones (those responses carry `status`). Otherwise `404 CANDIDATE_NOT_FOUND`.

### `GET /api/candidates/:id/photo` — public for approved

Returns the image (`Cache-Control: public` when approved, `private, no-store` for the owner/EC preview of a
pending one). `404 FILE_NOT_FOUND` when there is no photo or the viewer may not see it.
**M2:** use this URL to show the photo in the EC nomination queue.

### `GET /api/panels` — public

```json
{ "data": [ { "id": 1, "name": "…", "slogan": "…", "manifesto": "…", "logoUrl": "…" | null, "memberCount": 11 } ] }
```

`memberCount` counts approved candidates only.

### `GET /api/panels/:id` — public

Panel + `members: [{ id, name, hall, department, photoUrl, position }]` (approved only). The panel creator, EC and
Observer also get unapproved members with a `status` field. The creator additionally gets `isCreator: true` and `totalMembers`.

### `GET /api/panels/:id/logo` — public

### `POST /api/panels` — candidate (FR-05)

```json
{ "name": "≤ 80", "slogan": "≤ 160", "manifesto": "≤ 5000" }   // 201 → panel (creator view)
```

Needs an existing nomination; the creator becomes the first member. `409 NOMINATION_REQUIRED`,
`ALREADY_PANEL_CREATOR` (one panel per student), `PANEL_NAME_TAKEN`, `ALREADY_IN_PANEL`.

### `PATCH /api/panels/:id`, `PUT /api/panels/:id/logo`, `DELETE /api/panels/:id` — panel creator

Edit name/slogan/manifesto, upload the logo (raw image body), or disband (members become independents).
`403 NOT_PANEL_CREATOR` for anyone else.

### `POST /api/panels/:id/join` — candidate

Join immediately. A panel fields at most `max_selections` candidates per post: `409 PANEL_POSITION_TAKEN`.
`409 ALREADY_IN_PANEL`, `CREATOR_CANNOT_LEAVE` (creators must disband first).

### `DELETE /api/panels/membership/me` — candidate

Leave the current panel and stand as an independent. `400 NOT_IN_PANEL`.

### `DELETE /api/panels/:id/members/:candidateId` — panel creator

Remove a member from the panel (they become independent). The creator cannot remove themselves.

### Not built yet (Phase 2)

`/api/turnout/*`, candidate search, panel comparison (`panel_issues`), results page.

### For M4 — `<CandidateProfile>`

```jsx
import CandidateProfile from '../candidates/CandidateProfile.jsx';
import { Modal } from '../../components/ui';

<Modal open={open} onClose={close} title={name}><CandidateProfile id={candidate.id} /></Modal>
```

Also in the UI kit (`client/src/components/ui`): `Button`, `ButtonLink`, `Card`, `Badge`, `Alert`, `Avatar`, `Loading`,
`FormField`, `Modal`, `Stepper`, `PageLayout`, `useFetch`. Strings for `Modal`/`Stepper` are in the `ui` namespace.

## M4 — Voting engine

_Owner: M4. Routes under `/api/ballot/*`, `/api/vote`, `/api/receipts/*`, `/api/admin/photos/*`.
To be written on Day 2._
