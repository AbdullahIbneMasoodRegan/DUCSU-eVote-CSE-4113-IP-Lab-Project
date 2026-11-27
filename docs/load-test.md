# Load test — 500 simultaneous voters (NFR-02, NFR-03)

Owner: M1. Scripts in `loadtest/`. **Status: ready to run once voting (M4) is wired into the app.**
Results go in the table at the bottom.

## What it proves

500 voters log in, load the 28-post ballot and submit a full vote with a photo **at the same moment**.
Pass means:

- zero failed requests and every check passing (k6 thresholds);
- every one of the 500 votes accepted;
- **no lost or extra votes:** new ballots = new receipts = new voters marked as voted = 500;
- vote submission p95 under 5 seconds.

## Never run it on the demo data

The test adds 500 voters and 500 ballots, and ballots cannot be removed one by one (they have no link
to voters, by design). Use a **Neon branch**, a copy of the database you can throw away:

1. Neon console → your project → **Branches** → **Create branch** from `main`, name it `loadtest`.
   Copy its connection string (direct host, not `-pooler`).
2. Make voting open on the branch: log in as EC on the server you will test and set the election start
   to a few minutes ago, or run the seeds with an open election.
3. Point the server under test at the branch:
   - **Staging:** Render → Environment → set `DATABASE_URL` to the branch URL → Save, rebuild, and deploy.
     Remember to switch it back afterwards.
   - **Local:** put the branch URL in `.env` and run `npm run build && npm start`.

## Run it

You need [k6](https://k6.io/docs/get-started/installation/) (`winget install k6` on Windows).
`DATABASE_URL` and `OTP_SECRET` in your `.env` must match the server under test (copy `OTP_SECRET`
from Render → Environment), because the codes are prepared directly in the database.

```bash
# 1. 500 voters with known login codes, rate limits raised for one test machine
node loadtest/prepare.mjs --voters 500 --yes

# 2. everyone votes at once (first request may wait ~1 min if the free server was asleep)
k6 run -e BASE_URL=https://ducsu-evote-staging.onrender.com loadtest/vote.js

# 3. count ballots, receipts and voted flags; writes loadtest/results/report.md
node loadtest/verify.mjs
```

Paste the report below, with a screenshot of the k6 summary for the demo slides. Then delete the Neon
branch and switch staging back to the main database.

Notes:
- All 500 requests come from one IP, so `prepare` raises the per-IP limits in `settings` (and the code
  lifetime to 30 minutes). On a real election day campus Wi-Fi does the same, which is why the defaults
  are generous.
- Load-test voters use `@loadtest.test` addresses, which the mailer never sends to.
- The free Render instance has 0.1 CPU and 512 MB RAM; if p95 is high, note it as a hosting limit in the
  report rather than a code problem, and say what a paid instance would give.

## Results

_Not run yet: waiting for M4's voting routes to be connected (`server/src/routes.js`)._

<!-- Paste loadtest/results/report.md here after each run, newest first. -->
