# DUCSU eVote

Online voting for the Dhaka University Central Students' Union election — CSE 4113 Internet
Programming Lab project. **Demo data only.**

- Plan and division of work: [`docs/ducsu_evote_work_plan.pdf`](docs/ducsu_evote_work_plan.pdf)
- API contract: [`docs/api.md`](docs/api.md)

## Stack

React + Vite + Tailwind + react-i18next (client) · Node 20 + Express 5 + zod (server) · PostgreSQL
with raw SQL and node-pg-migrate · Vitest + Supertest. One service: Express serves `/api` and the
built client from the same origin.

## Run it locally

Needs Node 20+ and PostgreSQL 13+.

```bash
npm run setup                 # installs server/ and client/ dependencies
cp .env.example .env          # then set DATABASE_URL, DATABASE_URL_TEST and OTP_SECRET
createdb ducsu_evote          # or create it in pgAdmin
npm run migrate               # applies server/migrations
npm run seed                  # demo accounts and data from server/seeds

npm run dev:server            # terminal 1 — API on http://localhost:3000
npm run dev:client            # terminal 2 — app on http://localhost:5173 (proxies /api)
```

In development, OTP emails are **printed in the server terminal** (`MAIL_TRANSPORT=console`), so no
SMTP account is needed.

### Demo accounts (development defaults)

| Role | Login |
| --- | --- |
| Election Commission | `ec@ducsu-evote.test` / `ec-demo-pass` |
| Observer | `observer@ducsu-evote.test` / `observer-demo-pass` |
| Voter | any seeded registration number → code from the server terminal |

## Tests and lint

```bash
npm test      # server (needs DATABASE_URL_TEST; the database is wiped each run) + client
npm run lint
```

CI (`.github/workflows/ci.yml`) runs lint, tests and the client build against Postgres on every PR.

## Deploy (staging)

`render.yaml` describes one Render web service. Create a free Neon or Supabase database, then
**New → Blueprint** on Render, pick this repo and set `DATABASE_URL`. Each push to `main`
auto-deploys; `npm start` runs pending migrations before starting. The free plan has no shell, so
seed from your own machine with `DATABASE_URL` in `.env` pointing at the same database:
`npm run seed`.

Staging prints OTP emails to the Render **Logs** tab (`MAIL_TRANSPORT=console`), because the demo
voters have dummy addresses.

## Repo layout and ownership

See section 3 of the work plan and `.github/CODEOWNERS`. In short: `server/src/modules/<module>` and
`client/src/features/<feature>` belong to one member each; `server/src/core`, `server/src/routes.js`
and `client/src/app` are shared files (small PRs, reviewed by M1). Never edit a merged migration;
add a new one with `npm run migrate:create --prefix server -- m3-short-name`.
