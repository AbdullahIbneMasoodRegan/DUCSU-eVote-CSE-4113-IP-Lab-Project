-- M1 — Phase 2: EC settings (NFR-09) and the election public key (FR-11 extension).

-- Values the EC can change on the settings page. Anything missing here falls
-- back to the environment variable default (see server/src/modules/settings).
CREATE TABLE settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_by integer REFERENCES admin_users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Public half of the ballot encryption key pair, as a PEM string. The EC
-- generates the pair in the browser; the private key never reaches the server.
ALTER TABLE elections ADD COLUMN public_key text;

-- Progress of each bulk email (FR-17): one row per election and kind, so a
-- restart resumes after last_voter_id and nobody gets the same email twice.
CREATE TABLE notification_runs (
  id            serial PRIMARY KEY,
  election_id   integer NOT NULL REFERENCES elections (id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('votingOpen', 'reminder', 'resultsPublished')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  last_voter_id integer NOT NULL DEFAULT 0,
  sent          integer NOT NULL DEFAULT 0,
  failed        integer NOT NULL DEFAULT 0,
  skipped       integer NOT NULL DEFAULT 0,
  UNIQUE (election_id, kind)
);
