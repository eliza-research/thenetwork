-- P02 PoC fixes (see RESULTS.md "Fixes"). Must apply unchanged on PGlite (PG18 wasm) and Postgres 16+ with pgvector.

-- Fix 2: per-city partial HNSW indexes replace the global one. The planner picks them for `WHERE city = '<literal>'`
-- without steering, and the graph only holds that city's rows, so no candidates are thrown away by the filter.
DROP INDEX network.facets_embedding_hnsw;
CREATE INDEX facets_embedding_hnsw_sf ON network.facets USING hnsw (embedding vector_cosine_ops) WHERE city = 'sf';
CREATE INDEX facets_embedding_hnsw_nyc ON network.facets USING hnsw (embedding vector_cosine_ops) WHERE city = 'nyc';

-- Fix 3: jobs name the members they refer to explicitly (replaces the LIKE scan of payload in erasure).
ALTER TABLE network.jobs ADD COLUMN member_ids uuid[] NOT NULL DEFAULT '{}';
CREATE INDEX jobs_member_ids_gin ON network.jobs USING gin (member_ids);

-- Fix 6: every outbound message has an idempotency key; provider bookkeeping for exactly-one send.
ALTER TABLE network.outbound_messages ALTER COLUMN idempotency_key SET NOT NULL;
ALTER TABLE network.outbound_messages ADD COLUMN provider_message_id text;
ALTER TABLE network.outbound_messages ADD COLUMN send_attempts int NOT NULL DEFAULT 0;
ALTER TABLE network.outbound_messages ADD COLUMN sent_at timestamptz;
ALTER TABLE network.outbound_messages ADD CONSTRAINT outbound_status_chk
  CHECK (status IN ('queued','sending','sent','failed'));

-- Fix 5b: profile data synced from the member's own sources lives apart from engine-learned state.
CREATE TABLE network.profiles (
  member_id uuid PRIMARY KEY REFERENCES network.members(id) ON DELETE CASCADE,
  headline text,
  bio text,
  links jsonb NOT NULL DEFAULT '[]',
  source text NOT NULL,
  source_rev text NOT NULL,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE network.engine_member_state (
  member_id uuid PRIMARY KEY REFERENCES network.members(id) ON DELETE CASCADE,
  learned_embedding vector(1536),
  affinity jsonb NOT NULL DEFAULT '{}',
  response_rate real,
  last_matched_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Engine-owned tables reject writes from a session that declared itself the profile sync.
CREATE FUNCTION network.engine_tables_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('network.writer', true) = 'profile_sync' THEN
    RAISE EXCEPTION 'profile sync may not write engine table %', TG_TABLE_NAME USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER engine_guard BEFORE INSERT OR UPDATE OR DELETE ON network.engine_member_state
  FOR EACH STATEMENT EXECUTE FUNCTION network.engine_tables_guard();
CREATE TRIGGER engine_guard BEFORE INSERT OR UPDATE OR DELETE ON network.facets
  FOR EACH STATEMENT EXECUTE FUNCTION network.engine_tables_guard();
CREATE TRIGGER engine_guard BEFORE INSERT OR UPDATE OR DELETE ON network.intents
  FOR EACH STATEMENT EXECUTE FUNCTION network.engine_tables_guard();
CREATE TRIGGER engine_guard BEFORE INSERT OR UPDATE OR DELETE ON network.edges
  FOR EACH STATEMENT EXECUTE FUNCTION network.engine_tables_guard();

-- Fix 5a: the event log is complete for the member / opportunity / participation projections.
-- Every row change appends a snapshot event (full row after the change) or a tombstone (key only), in the same
-- transaction. Rebuild = latest non-redacted event per key. Row locks order concurrent writers to one key, so
-- event id order matches commit order per key.
CREATE FUNCTION network.emit_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kind text := TG_ARGV[0];
  r jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
  target uuid := nullif(current_setting('network.erasure_target', true), '')::uuid;
  subj uuid[]; body jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Tombstones carry only the key; their subjects are only the members that are part of the key.
    IF kind = 'member' THEN body := jsonb_build_object('id', r->'id'); subj := ARRAY[(r->>'id')::uuid];
    ELSIF kind = 'opportunity' THEN body := jsonb_build_object('id', r->'id'); subj := '{}';
    ELSE body := jsonb_build_object('opportunity_id', r->'opportunity_id', 'member_id', r->'member_id');
         subj := ARRAY[(r->>'member_id')::uuid];
    END IF;
  ELSE
    body := r;
    subj := CASE kind
      WHEN 'member' THEN array_remove(ARRAY[(r->>'id')::uuid, (r->>'invited_by')::uuid], NULL)
      WHEN 'opportunity' THEN ARRAY(SELECT jsonb_array_elements_text(r->'participants')::uuid)
      ELSE ARRAY[(r->>'member_id')::uuid] END;
  END IF;
  -- During erasure, changes to rows about the erased member leave no new trace (their history is redacted anyway).
  IF target IS NOT NULL AND target = ANY(subj) THEN RETURN NULL; END IF;
  INSERT INTO network.events (actor_type, type, subject_ids, payload)
  VALUES ('engine', kind || CASE WHEN TG_OP = 'DELETE' THEN '.deleted' ELSE '.snapshot' END, subj, body);
  RETURN NULL;
END $$;
CREATE TRIGGER members_events AFTER INSERT OR UPDATE OR DELETE ON network.members
  FOR EACH ROW EXECUTE FUNCTION network.emit_snapshot('member');
CREATE TRIGGER opportunities_events AFTER INSERT OR UPDATE OR DELETE ON network.opportunities
  FOR EACH ROW EXECUTE FUNCTION network.emit_snapshot('opportunity');
CREATE TRIGGER participations_events AFTER INSERT OR UPDATE OR DELETE ON network.participations
  FOR EACH ROW EXECUTE FUNCTION network.emit_snapshot('participation');
CREATE INDEX events_type_idx ON network.events (type);

-- Rebuilt projections: latest non-redacted event per key, tombstones dropped.
CREATE FUNCTION network.rebuilt_members() RETURNS SETOF network.members LANGUAGE sql STABLE AS $$
  SELECT (jsonb_populate_record(NULL::network.members, payload)).* FROM (
    SELECT DISTINCT ON (payload->>'id') type, payload FROM network.events
     WHERE type IN ('member.snapshot', 'member.deleted') AND NOT payload ? 'redacted'
     ORDER BY payload->>'id', id DESC) s
   WHERE type = 'member.snapshot'
$$;
CREATE FUNCTION network.rebuilt_opportunities() RETURNS SETOF network.opportunities LANGUAGE sql STABLE AS $$
  SELECT (jsonb_populate_record(NULL::network.opportunities, payload)).* FROM (
    SELECT DISTINCT ON (payload->>'id') type, payload FROM network.events
     WHERE type IN ('opportunity.snapshot', 'opportunity.deleted') AND NOT payload ? 'redacted'
     ORDER BY payload->>'id', id DESC) s
   WHERE type = 'opportunity.snapshot'
$$;
CREATE FUNCTION network.rebuilt_participations() RETURNS SETOF network.participations LANGUAGE sql STABLE AS $$
  SELECT (jsonb_populate_record(NULL::network.participations, payload)).* FROM (
    SELECT DISTINCT ON (payload->>'opportunity_id', payload->>'member_id') type, payload FROM network.events
     WHERE type IN ('participation.snapshot', 'participation.deleted') AND NOT payload ? 'redacted'
     ORDER BY payload->>'opportunity_id', payload->>'member_id', id DESC) s
   WHERE type = 'participation.snapshot'
$$;
-- Rows that differ between live and rebuilt, per projection (0/0/0 means rebuilt == live).
CREATE FUNCTION network.projection_diff() RETURNS TABLE (projection text, only_live int, only_rebuilt int) LANGUAGE sql STABLE AS $$
  SELECT 'members', (SELECT count(*)::int FROM (SELECT to_jsonb(x) FROM network.members x EXCEPT SELECT to_jsonb(y) FROM network.rebuilt_members() y) a),
                    (SELECT count(*)::int FROM (SELECT to_jsonb(y) FROM network.rebuilt_members() y EXCEPT SELECT to_jsonb(x) FROM network.members x) b)
  UNION ALL
  SELECT 'opportunities', (SELECT count(*)::int FROM (SELECT to_jsonb(x) FROM network.opportunities x EXCEPT SELECT to_jsonb(y) FROM network.rebuilt_opportunities() y) a),
                          (SELECT count(*)::int FROM (SELECT to_jsonb(y) FROM network.rebuilt_opportunities() y EXCEPT SELECT to_jsonb(x) FROM network.opportunities x) b)
  UNION ALL
  SELECT 'participations', (SELECT count(*)::int FROM (SELECT to_jsonb(x) FROM network.participations x EXCEPT SELECT to_jsonb(y) FROM network.rebuilt_participations() y) a),
                           (SELECT count(*)::int FROM (SELECT to_jsonb(y) FROM network.rebuilt_participations() y EXCEPT SELECT to_jsonb(x) FROM network.participations x) b)
$$;

-- Fix 3: physical purge. Erasure enqueues one coalesced job per maintenance window; the job runner (src/purge.ts)
-- rewrites the tables that held the member's data with VACUUM (FULL) and re-ANALYZEs them (pg_statistic can hold
-- sampled values). Window: the purge job is due at the next 03:00 UTC and must finish within 24 h of the erasure.
CREATE FUNCTION network.purge_tables() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['members','facets','intents','edges','opportunities','participations','outbound_messages',
               'events','jobs','profiles','engine_member_state']
$$;

-- SEC-005 erasure, v2: jobs matched through member_ids (GIN), single-member opportunities deleted, projections
-- re-snapshotted by the triggers above, and a physical-purge job enqueued.
CREATE OR REPLACE FUNCTION network.erase_member(p uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE c jsonb := '{}'; n int; window_start timestamptz;
BEGIN
  PERFORM set_config('network.erasure', 'on', true);
  PERFORM set_config('network.erasure_target', p::text, true);
  UPDATE network.events SET actor_id = CASE WHEN actor_id = p THEN NULL ELSE actor_id END,
         subject_ids = array_remove(subject_ids, p), payload = '{"redacted":true}'
   WHERE actor_id = p OR subject_ids @> ARRAY[p];
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('events_redacted', n);
  UPDATE network.outbound_messages SET body = '[redacted]', mentions = array_remove(mentions, p) WHERE mentions @> ARRAY[p];
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('messages_redacted', n);
  DELETE FROM network.opportunities WHERE participants = ARRAY[p];   -- would violate cardinality >= 1 otherwise
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('opportunities_deleted', n);
  UPDATE network.opportunities
     SET state = CASE WHEN network.is_active_state(state) THEN 'CANCELLED' ELSE state END,
         participants = array_remove(participants, p), objective = '[redacted]', updated_at = now()
   WHERE participants @> ARRAY[p];
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('opportunities_scrubbed', n);
  UPDATE network.jobs SET payload = '{"redacted":true}', member_ids = array_remove(member_ids, p)
   WHERE member_ids @> ARRAY[p];
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('jobs_redacted', n);
  DELETE FROM network.members WHERE id = p;   -- cascades: facets, intents, edges, participations, outbound, profiles, engine state
  GET DIAGNOSTICS n = ROW_COUNT; c := c || jsonb_build_object('members_deleted', n);
  PERFORM set_config('network.erasure', 'off', true);
  PERFORM set_config('network.erasure_target', '', true);
  INSERT INTO network.erasure_log (member_hash, row_counts) VALUES (encode(sha256(convert_to(p::text, 'UTF8')), 'hex'), c);
  INSERT INTO network.events (actor_type, type, payload) VALUES ('admin', 'member.erased', '{}');
  window_start := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '27 hours';
  IF window_start - now() > interval '24 hours' THEN window_start := window_start - interval '24 hours'; END IF;
  INSERT INTO network.jobs (type, payload, due_at, idempotency_key, max_attempts)
  VALUES ('physical_purge', jsonb_build_object('tables', to_jsonb(network.purge_tables()), 'deadline', now() + interval '24 hours'),
          window_start, 'physical_purge:' || to_char(window_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24'), 100)
  ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN c;
END $$;
