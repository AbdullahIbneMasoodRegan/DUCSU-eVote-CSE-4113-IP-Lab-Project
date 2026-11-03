-- Up Migration
-- 001 — initial schema agreed at the Phase 0 meeting (see work plan § 4).
-- NEVER edit this file after it is merged. Any change is a new migration,
-- created by the table's owner:  npm run migrate:create -- m3-add-panel-issue-order
--
-- SECRECY (work plan § 9): ballots, ballot_choices, receipts and voter_photos
-- have NO created_at / updated_at, NO serial id or sequence, and NO column
-- shared with voters. Do not add any.

-- ===================================================================== M1
CREATE TABLE admin_users (
  id            serial PRIMARY KEY,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('ec', 'observer')),
  name          text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_users_email_key ON admin_users (lower(email));

-- id is the SHA-256 hash of the cookie token; the raw token is never stored.
CREATE TABLE sessions (
  id           text PRIMARY KEY,
  subject_type text NOT NULL CHECK (subject_type IN ('admin', 'voter')),
  subject_id   integer NOT NULL,
  role         text NOT NULL CHECK (role IN ('ec', 'observer', 'voter')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_subject_idx ON sessions (subject_type, subject_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);

-- ===================================================================== M2
-- has_voted is a boolean ONLY. There is no voted_at column anywhere.
CREATE TABLE voters (
  id                 serial PRIMARY KEY,
  reg_no             text NOT NULL UNIQUE,
  name               text NOT NULL,
  email              text NOT NULL,
  hall               text NOT NULL,
  department         text NOT NULL,
  eligible           boolean NOT NULL DEFAULT true,
  has_voted          boolean NOT NULL DEFAULT false,
  otp_cooldown_until timestamptz
);
CREATE INDEX voters_hall_idx ON voters (hall);

CREATE TABLE elections (
  id                     serial PRIMARY KEY,
  title                  text NOT NULL,
  starts_at              timestamptz NOT NULL,
  ends_at                timestamptz NOT NULL,
  results_published_at   timestamptz,
  dispute_period_ends_at timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE positions (
  id             serial PRIMARY KEY,
  election_id    integer NOT NULL REFERENCES elections (id) ON DELETE CASCADE,
  name_en        text NOT NULL,
  name_bn        text NOT NULL,
  display_order  integer NOT NULL,
  max_selections integer NOT NULL DEFAULT 1 CHECK (max_selections >= 1),
  UNIQUE (election_id, display_order)
);

-- ===================================================================== M1 (needs voters)
-- One active code per voter; the row is deleted on use or expiry.
CREATE TABLE otp_codes (
  id              serial PRIMARY KEY,
  voter_id        integer NOT NULL UNIQUE REFERENCES voters (id) ON DELETE CASCADE,
  code_hash       text NOT NULL,
  expires_at      timestamptz NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ===================================================================== M3
-- Candidate photos and panel logos only (never voter photos).
CREATE TABLE files (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mime       text NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE panels (
  id           serial PRIMARY KEY,
  election_id  integer NOT NULL REFERENCES elections (id) ON DELETE CASCADE,
  name         text NOT NULL,
  slogan       text,
  logo_file_id uuid REFERENCES files (id) ON DELETE SET NULL,
  manifesto    text,
  created_by   integer REFERENCES voters (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, name)
);

CREATE TABLE panel_issues (
  id        serial PRIMARY KEY,
  panel_id  integer NOT NULL REFERENCES panels (id) ON DELETE CASCADE,
  issue_key text NOT NULL,
  stance    text NOT NULL,
  UNIQUE (panel_id, issue_key)
);

-- One nomination per student (voter_id UNIQUE).
CREATE TABLE candidates (
  id               serial PRIMARY KEY,
  voter_id         integer NOT NULL UNIQUE REFERENCES voters (id) ON DELETE CASCADE,
  position_id      integer NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
  panel_id         integer REFERENCES panels (id) ON DELETE SET NULL,
  photo_file_id    uuid REFERENCES files (id) ON DELETE SET NULL,
  bio              text,
  manifesto        text,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL)
);
CREATE INDEX candidates_position_idx ON candidates (position_id, status);

-- ===================================================================== M4
-- Random UUID id. No voter id, no timestamp, no serial.
CREATE TABLE ballots (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id integer NOT NULL REFERENCES elections (id)
);

CREATE TABLE ballot_choices (
  ballot_id    uuid NOT NULL REFERENCES ballots (id) ON DELETE CASCADE,
  position_id  integer NOT NULL REFERENCES positions (id),
  candidate_id integer NOT NULL REFERENCES candidates (id),
  PRIMARY KEY (ballot_id, position_id, candidate_id)
);

-- No link to voter or ballot.
CREATE TABLE receipts (
  code        text PRIMARY KEY,
  election_id integer NOT NULL REFERENCES elections (id)
);

-- No timestamp; never linked to ballots. Deleted after the dispute period.
CREATE TABLE voter_photos (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voter_id integer NOT NULL UNIQUE REFERENCES voters (id) ON DELETE CASCADE,
  mime     text NOT NULL CHECK (mime = 'image/jpeg'),
  data     bytea NOT NULL
);

-- ===================================================================== M2
-- Insert-only (an UPDATE/DELETE-blocking trigger is added in Phase 2).
-- Administrative actions only; never a voter casting a vote.
CREATE TABLE audit_log (
  id         bigserial PRIMARY KEY,
  actor_type text NOT NULL,
  actor_id   integer,
  action     text NOT NULL,
  target     text,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now(),
  prev_hash  text,
  hash       text NOT NULL
);
CREATE INDEX audit_log_action_idx ON audit_log (action);

-- Written only after voting closes.
CREATE TABLE results (
  election_id  integer NOT NULL REFERENCES elections (id) ON DELETE CASCADE,
  position_id  integer NOT NULL REFERENCES positions (id) ON DELETE CASCADE,
  candidate_id integer NOT NULL REFERENCES candidates (id) ON DELETE CASCADE,
  votes        integer NOT NULL DEFAULT 0,
  is_winner    boolean NOT NULL DEFAULT false,
  tie_flag     boolean NOT NULL DEFAULT false,
  PRIMARY KEY (election_id, position_id, candidate_id)
);

-- Down Migration
DROP TABLE IF EXISTS results, audit_log, voter_photos, receipts, ballot_choices, ballots,
  candidates, panel_issues, panels, files, otp_codes, positions, elections, voters,
  sessions, admin_users CASCADE;
