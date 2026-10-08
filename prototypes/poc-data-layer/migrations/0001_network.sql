-- P02 PoC: minimal `network` schema. Must apply unchanged on PGlite (PG18 wasm) and Postgres 16+ with pgvector.
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS network;

-- Opportunity states that count as "active" for the no-duplicate rule (non-terminal states of OpportunityState).
CREATE FUNCTION network.is_active_state(s text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT s IN ('DRAFT','PROPOSED','IN_REVIEW','APPROVED','INVITING','PARTIALLY_ACCEPTED','MUTUALLY_ACCEPTED',
               'QUORUM_MET','SCHEDULING','SCHEDULED','RESCHEDULE_REQUESTED','NEEDS_REPLACEMENT','IN_PROGRESS',
               'SAFETY_HOLD','DISPUTED')
$$;

-- Order-independent participant-set key, computed by the database so callers cannot get it wrong.
CREATE FUNCTION network.participant_key(ids uuid[]) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT string_agg(x::text, ',' ORDER BY x) FROM (SELECT DISTINCT unnest(ids) AS x) s
$$;

CREATE TABLE network.members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  email text,
  home_city text NOT NULL CHECK (home_city IN ('sf','nyc')),
  account_status text NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('invited','onboarding','active','paused','restricted','removed')),
  participation_state text NOT NULL DEFAULT 'normal'
    CHECK (participation_state IN ('open','normal','quiet','receiving','paused')),
  time_zone text NOT NULL DEFAULT 'America/Los_Angeles',
  invited_by uuid REFERENCES network.members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE network.facets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES network.members(id) ON DELETE CASCADE,
  city text NOT NULL,                       -- denormalised from presence for filtered ANN
  kind text NOT NULL,
  value text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  scope text NOT NULL DEFAULT 'matchable',
  provenance text NOT NULL DEFAULT 'said',
  confidence real NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('proposed','confirmed','rejected')),
  revision int NOT NULL DEFAULT 1,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX facets_member_idx ON network.facets (member_id);
CREATE INDEX facets_city_idx ON network.facets (city);
CREATE INDEX facets_embedding_hnsw ON network.facets USING hnsw (embedding vector_cosine_ops);

CREATE TABLE network.intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES network.members(id) ON DELETE CASCADE,
  objective text NOT NULL,
  category text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','closed')),
  horizon_days int NOT NULL DEFAULT 30,
  embedding vector(1536),
  last_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX intents_member_idx ON network.intents (member_id);

CREATE TABLE network.edges (
  from_id uuid NOT NULL REFERENCES network.members(id) ON DELETE CASCADE,
  to_id uuid NOT NULL REFERENCES network.members(id) ON DELETE CASCADE,
  type text NOT NULL,
  strength real NOT NULL DEFAULT 0.5,
  explicit boolean NOT NULL DEFAULT false,
  privacy_scope text NOT NULL DEFAULT 'agent_private',
  evidence text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (from_id, to_id, type)
);
CREATE INDEX edges_to_idx ON network.edges (to_id);

CREATE TABLE network.opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  city text NOT NULL,
  objective text NOT NULL,
  objective_hash text NOT NULL,
  participants uuid[] NOT NULL CHECK (cardinality(participants) >= 1),
  participant_key text GENERATED ALWAYS AS (network.participant_key(participants)) STORED,
  state text NOT NULL DEFAULT 'PROPOSED',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- 34.1: at most one ACTIVE opportunity per (participant set, objective hash).
CREATE UNIQUE INDEX opportunities_one_active ON network.opportunities (participant_key, objective_hash)
  WHERE network.is_active_state(state);
CREATE INDEX opportunities_participants_gin ON network.opportunities USING gin (participants);

CREATE TABLE network.participations (
  opportunity_id uuid NOT NULL REFERENCES network.opportunities(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES network.members(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'invited',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (opportunity_id, member_id)
);
CREATE INDEX participations_member_idx ON network.participations (member_id);

CREATE TABLE network.outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES network.members(id) ON DELETE CASCADE,  -- recipient
  channel text NOT NULL,
  to_address text NOT NULL,
  body text NOT NULL,
  mentions uuid[] NOT NULL DEFAULT '{}',   -- other members named in the body (needed for erasure)
  status text NOT NULL DEFAULT 'queued',
  due_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX outbound_mentions_gin ON network.outbound_messages USING gin (mentions);

-- 32.18: jobs with due_at, attempts, leases (owner + fencing token + expiry), idempotency key.
CREATE TABLE network.jobs (
  id bigserial PRIMARY KEY,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  due_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','dead')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 25,
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  idempotency_key text UNIQUE,
  completed_at timestamptz,
  completed_by text
);
CREATE INDEX jobs_ready_idx ON network.jobs (due_at, id) WHERE status = 'pending';
CREATE INDEX jobs_lease_idx ON network.jobs (lease_expires_at) WHERE status = 'running';

-- Side-effect ledger for the exactly-once test (deliberately NOT unique, so duplicates would be visible).
CREATE TABLE network.job_effects (
  id bigserial PRIMARY KEY,
  job_id bigint NOT NULL,
  worker text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE network.matching_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL,
  runner text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz
);

-- 32.19: append-only event log. Any event that refers to a member lists them in subject_ids.
CREATE TABLE network.events (
  id bigserial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL CHECK (actor_type IN ('member','agent','engine','reviewer','admin','sim')),
  actor_id uuid,
  type text NOT NULL,
  subject_ids uuid[] NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX events_subjects_gin ON network.events USING gin (subject_ids);
CREATE INDEX events_actor_idx ON network.events (actor_id);

CREATE FUNCTION network.events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- The only permitted mutation is redaction inside network.erase_member().
  IF TG_OP = 'UPDATE' AND current_setting('network.erasure', true) = 'on' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'network.events is append-only (%)', TG_OP USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER events_append_only BEFORE UPDATE OR DELETE ON network.events
  FOR EACH ROW EXECUTE FUNCTION network.events_append_only();
CREATE TRIGGER events_no_truncate BEFORE TRUNCATE ON network.events
  FOR EACH STATEMENT EXECUTE FUNCTION network.events_append_only();

-- Retention table: the only place a trace of an erased member may remain (unsalted sha256 of the member id, no PII).
CREATE TABLE network.erasure_log (
  id bigserial PRIMARY KEY,
  member_hash text NOT NULL,
  erased_at timestamptz NOT NULL DEFAULT now(),
  row_counts jsonb NOT NULL
);

-- SEC-005: erase a member everywhere. Cascades remove owned rows; references elsewhere are redacted.
CREATE FUNCTION network.erase_member(p uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c jsonb := '{}'; n int;
BEGIN
  PERFORM set_config('network.erasure', 'on', true);
  UPDATE network.events SET actor_id = CASE WHEN actor_id = p THEN NULL ELSE actor_id END,
         subject_ids = array_remove(subject_ids, p), payload = '{"redacted":true}'
   WHERE actor_id = p OR p = ANY(subject_ids);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('events_redacted', n);
  UPDATE network.outbound_messages SET body = '[redacted]', mentions = array_remove(mentions, p) WHERE p = ANY(mentions);
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('messages_redacted', n);
  UPDATE network.opportunities
     SET state = CASE WHEN network.is_active_state(state) THEN 'CANCELLED' ELSE state END,
         participants = array_remove(participants, p), objective = '[redacted]', updated_at = now()
   WHERE participants @> ARRAY[p];
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('opportunities_scrubbed', n);
  UPDATE network.jobs SET payload = '{"redacted":true}' WHERE payload::text LIKE '%' || p::text || '%';
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('jobs_redacted', n);
  DELETE FROM network.members WHERE id = p;   -- cascades: facets, intents, edges, participations, outbound_messages
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('members_deleted', n);
  PERFORM set_config('network.erasure', 'off', true);
  INSERT INTO network.erasure_log (member_hash, row_counts) VALUES (encode(sha256(convert_to(p::text, 'UTF8')), 'hex'), c);
  INSERT INTO network.events (actor_type, type, payload) VALUES ('admin', 'member.erased', '{}');
  RETURN c;
END $$;
