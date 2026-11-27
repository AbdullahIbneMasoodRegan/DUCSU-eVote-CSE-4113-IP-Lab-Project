# Operations — election day runbook (NFR-04, NFR-10)

Owner: M1.

## Before voting opens

1. **EC creates the ballot key:** `/admin/encryption` → generate → download the private key file (keep two
   copies offline) → upload the public key. The fingerprint shows on the observer dashboard.
2. **EC checks settings:** `/admin/settings` (code expiry, timeouts, rate limits, reminder time). They
   lock while voting is open.
3. **Back up:** `npm run backup` (writes `backups/ducsu-evote-<time>.json.gz`; with PostgreSQL client tools
   installed, `npm run backup -- --pg-dump` makes a `pg_dump` file instead). Keep it off shared drives:
   it contains voter emails.
4. **Uptime monitor:** create a free monitor (for example UptimeRobot, HTTP type) on
   `https://ducsu-evote-staging.onrender.com/api/health`, every 5 minutes. It alerts if the site goes down
   **and keeps the free Render instance awake** (Render sleeps a free service after 15 minutes without
   traffic, and the first request after that takes about a minute).
5. Check `/observer` shows the server online, the election, and the key fingerprint.

## While voting is open

- **Emails go out by themselves** (`/admin/notifications` shows progress): "voting is open" to everyone
  when it starts, and a reminder to voters who have not voted, 3 hours before it closes (EC setting).
  They are sent 50 at a time, once a minute (`NOTIFY_BATCH_SIZE`, `NOTIFY_INTERVAL_SECONDS`).
- **Brevo's free plan allows 300 emails a day.** With more voters than that, either spread the campaigns
  over days, raise the plan for the election, or lower the batch size so the remainder goes the next day.
  Seeded voters (`@ducsu-evote.test`) are skipped and do not count.
- Observers watch `/observer`.

## After voting closes

1. **Back up again** (`npm run backup`).
2. EC calculates results (M2), uploading the private key file at counting time; it is used in memory only.
3. EC publishes. The "results published" email goes to everyone automatically.

## Restore

```bash
npm run migrate                                        # schema first
npm run restore -- backups/ducsu-evote-<time>.json.gz  # shows what it would do
npm run restore -- backups/ducsu-evote-<time>.json.gz --yes
```

Restore **replaces all data** in the database named by `DATABASE_URL`, in one transaction. A `.dump` file
restores with `pg_restore --clean --no-owner -d "<DATABASE_URL>" <file>`.

## Environment variables added in Phase 2

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_URL` | `http://localhost:5173` | Site address used in email links. **Set it on Render.** |
| `NOTIFY_ENABLED` | `true` in production, otherwise `false` | Runs the election email job. Keep it off on laptops that share the database with staging. |
| `NOTIFY_BATCH_SIZE` / `NOTIFY_INTERVAL_SECONDS` | 50 / 60 | Email batch size and pause. |
| `REMINDER_HOURS_BEFORE_CLOSE` | 3 | Default for the EC setting. |
| `RATE_LIMIT_*` | see `.env.example` | Defaults for the EC rate-limit settings. |

Only one server sends election emails at a time (a database lock), so a laptop and staging sharing one
database never send the same email twice.
