-- The Network: proposed canonical `network` schema (PRD 32.1, 32.2, 32.4, 32.10, 32.11, 32.13,
-- 32.19, 33). Production (Eliza Cloud, Railway Postgres) does not have it yet; this file is the
-- contract the observatory's real-world mode reads. Field names mirror packages/core/src/types.ts.
-- Idempotent: safe to run on an existing database.
-- This file is migration 0001 (db/migrate.ts; bun run db:migrate). It runs again when it changes, so it
-- may only create what is missing. Put every other change (new columns on app tables, keys, policies)
-- in a new numbered file in db/migrations/.

create schema if not exists network;

-- 32.1 Identity and membership. PII (phone, email) lives only in channel_identities.
create table if not exists network.members (
  id                   text primary key,
  cloud_user_id        text,
  name                 text,  -- null for a member declined at join (under 13): only the id is kept
  home_city            text check (home_city in ('sf', 'nyc')),  -- null only for a member declined at join
  home_area            text,
  account_status       text not null default 'active'
                       check (account_status in ('invited', 'onboarding', 'active', 'paused', 'restricted', 'removed')),
  participation_state  text not null default 'normal'
                       check (participation_state in ('open', 'normal', 'quiet', 'receiving', 'paused')),
  opted_out            boolean not null default false,
  age                  int,
  invited_by           text references network.members (id),
  community            text,
  occupation           text,
  bio                  text,
  prefs                jsonb not null default '{}'::jsonb,
  unanswered_proactive int not null default 0,
  joined_at            timestamptz,
  created_at           timestamptz not null default now()
);

-- Older dev databases: a declined member keeps no name.
alter table network.members alter column name drop not null;

create table if not exists network.channel_identities (
  member_id   text not null references network.members (id) on delete cascade,
  channel     text not null check (channel in ('imessage', 'sms', 'voice', 'web', 'email')),
  address     text not null,
  verified_at timestamptz,
  is_primary  boolean not null default false,
  primary key (channel, address)
);

-- 32.4 Profile and knowledge model.
create table if not exists network.facets (
  id            text primary key,
  member_id     text not null references network.members (id) on delete cascade,
  kind          text not null,
  value         text not null,
  tags          text[] not null default '{}',
  privacy_scope text not null check (privacy_scope in ('agent_private', 'matchable', 'shareable', 'opportunity_specific')),
  provenance    text not null check (provenance in ('said', 'connected_source', 'inferred', 'vouched')),
  source        text,
  confidence    real not null default 0.5,
  status        text not null default 'confirmed' check (status in ('proposed', 'confirmed', 'rejected')),
  sensitive     text,
  valid_from    timestamptz,
  valid_to      timestamptz,
  revision      int not null default 1
);
create index if not exists facets_member on network.facets (member_id);

create table if not exists network.intents (
  id             text primary key,
  member_id      text not null references network.members (id) on delete cascade,
  objective      text not null,
  category       text not null,
  details        text,
  desired_people text,
  horizon_days   int not null default 60,
  status         text not null default 'active' check (status in ('active', 'paused', 'closed')),
  created_at     timestamptz not null default now()
);
create index if not exists intents_member on network.intents (member_id);

create table if not exists network.presence (
  id        bigserial primary key,
  member_id text not null references network.members (id) on delete cascade,
  city      text not null,
  type      text not null check (type in ('home', 'routine', 'temporary')),
  areas     text[] not null default '{}',
  from_at   timestamptz,
  to_at     timestamptz
);
create index if not exists presence_member on network.presence (member_id);

-- Section 13.2 / Appendix B.2 edges, including what the Network learns (32.13).
create table if not exists network.edges (
  id         bigserial primary key,
  from_id    text not null references network.members (id) on delete cascade,
  to_id      text not null references network.members (id) on delete cascade,
  type       text not null,
  strength   real not null default 0.5,
  explicit   boolean not null default true,
  created_at timestamptz not null default now(),
  unique (from_id, to_id, type)
);
create index if not exists edges_to on network.edges (to_id);

-- 32.10 Opportunity workflow and consent.
create table if not exists network.opportunities (
  id           text primary key,
  kind         text not null,
  state        text not null,
  source       text not null default 'engine' check (source in ('engine', 'reviewer', 'member', 'network', 'player', 'scenario')),
  generator    text,
  category     text,
  city         text not null,
  objective    text not null,
  score        real,
  components   jsonb,
  explanations jsonb not null default '{}'::jsonb,
  exploration  boolean not null default false,
  window_start timestamptz,
  window_end   timestamptz,
  meeting_at   timestamptz,
  reason       text,
  run_id       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists opportunities_state on network.opportunities (state);

create table if not exists network.participations (
  opportunity_id text not null references network.opportunities (id) on delete cascade,
  member_id      text not null references network.members (id) on delete cascade,
  role           text not null default 'participant' check (role in ('participant', 'alternate')),
  status         text not null,
  enjoyment      real,
  invited_at     timestamptz,
  responded_at   timestamptz,
  primary key (opportunity_id, member_id)
);
create index if not exists participations_member on network.participations (member_id);

-- 32.8 Human review: every opportunity the Network composes waits here before any member is
-- contacted. decision is null while it waits; 'expired' = missed the SLA and was never sent.
create table if not exists network.review_items (
  opportunity_id text primary key references network.opportunities (id) on delete cascade,
  queued_at      timestamptz not null,
  deadline       timestamptz not null,
  decision       text check (decision in ('approve', 'reject', 'expired')),
  reason         text check (reason in ('weak_reason', 'privacy_risk', 'capacity_concern', 'wrong_timing', 'safety', 'tone', 'duplicate', 'other')),
  note           text,
  reviewer       text,
  decided_at     timestamptz
);
create index if not exists review_items_open on network.review_items (deadline) where decision is null;

-- 32.2 Messages (inbound and outbound, one table; bodies are sensitive).
create table if not exists network.messages (
  id             text primary key,
  member_id      text not null references network.members (id) on delete cascade,
  direction      text not null check (direction in ('inbound', 'outbound')),
  channel        text not null default 'sms',
  body           text not null,
  status         text not null default 'delivered',
  type           text,
  opportunity_id text,
  proactive      boolean not null default false,
  system         boolean not null default false,
  ts             timestamptz not null
);
create index if not exists messages_member_ts on network.messages (member_id, ts);
create index if not exists messages_ts on network.messages (ts);

-- 32.13 Feedback.
create table if not exists network.feedback (
  id               bigserial primary key,
  from_id          text not null references network.members (id) on delete cascade,
  opportunity_id   text,
  about_id         text,
  sentiment        text check (sentiment in ('positive', 'neutral', 'negative')),
  would_meet_again boolean,
  text             text,
  at               timestamptz not null
);

-- 32.19 Append-only event log.
create table if not exists network.events (
  id          bigserial primary key,
  at          timestamptz not null,
  actor_type  text not null check (actor_type in ('member', 'agent', 'engine', 'reviewer', 'admin', 'sim')),
  actor_id    text,
  type        text not null,
  object_type text,
  object_id   text,
  payload     jsonb not null default '{}'::jsonb
);
create index if not exists events_at on network.events (at);

-- 32.20 Matching-run logs (summary per run; the full log can live in object storage).
create table if not exists network.matching_runs (
  id             text primary key,
  at             timestamptz not null,
  city           text,
  engine_version text not null,
  proposals      int not null,
  wall_ms        int,
  summary        jsonb not null
);

-- The ConsentNetwork's own tables. packages/network/db/network-state.sql (its PgStore) is the owner;
-- these definitions are the same, so the contract is complete here, and db/dev-pg.ts applySchema()
-- runs that file right after this one (a column added there still lands). Keep them in step.
-- 32.8: where the item came from, the time the reviewer spent, what they edited, how often it was
-- re-rolled, and why an approved item was not started (a gate failed on the re-check).
alter table network.review_items add column if not exists origin text;
alter table network.review_items add column if not exists seconds_spent real;
alter table network.review_items add column if not exists edits jsonb;
alter table network.review_items add column if not exists rerolls int not null default 0;
alter table network.review_items add column if not exists invalidated text;

-- The whole Network state as one JSON document per network (exportState / importState). It holds
-- full names, what members told the Network, message texts and safety notes: the console never
-- reads it. The read-only role reads network.network_state_console below.
create table if not exists network.network_state (
  id       text primary key default 'nyc',
  version  int not null,
  state    jsonb not null,
  saved_at timestamptz not null default now()
);

-- Only the JSON paths the console reads, named one by one (a new field in the Network state does not
-- reach the console until it is added here):
--   matchingEnabled; the deferred sends (member, kind, message type, opportunity; never the text);
--   trust levels; safety cases (ids, member, level, status, times, staff id, and per event its time,
--   kind, points and reporter); counters and gate reasons (numbers); and per member the age state
--   (minor, ageUnknown, network.md 6.3) and the availability opt-ins (calendar, weekly, offerMade).
drop view if exists network.console_state;
create or replace view network.network_state_console as
select id, saved_at,
  (state->>'matchingEnabled')::boolean as matching_enabled,
  coalesce(jsonb_array_length(state->'deferred'), 0)::int as deferred,
  coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('memberId', d->'memberId', 'kind', d->'kind', 'type', d->'meta'->'type', 'proposalId', d->'meta'->'proposalId')))
            from jsonb_array_elements(coalesce(state->'deferred', '[]'::jsonb)) d), '[]'::jsonb) as deferred_sends,
  coalesce((select jsonb_agg(jsonb_build_object('id', t->'id', 'level', t->'level'))
            from jsonb_array_elements(coalesce(state->'trust', '[]'::jsonb)) t), '[]'::jsonb) as trust,
  coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', c->'id', 'memberId', c->'memberId', 'opened', c->'opened', 'level', c->'level', 'status', c->'status',
              'closedAt', c->'closedAt', 'closedBy', c->'closedBy',
              'events', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('at', e->'at', 'kind', e->'kind', 'points', e->'points', 'by', e->'by')))
                                  from jsonb_array_elements(coalesce(c->'events', '[]'::jsonb)) e), '[]'::jsonb))))
            from jsonb_array_elements(coalesce(state->'cases', '[]'::jsonb)) c), '[]'::jsonb) as cases,
  coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(state->'counters', '{}'::jsonb)) x(k, v) where jsonb_typeof(v) = 'number'), '{}'::jsonb) as counters,
  coalesce((select jsonb_object_agg(k, v) from jsonb_each(coalesce(state->'gateReasons', '{}'::jsonb)) x(k, v) where jsonb_typeof(v) = 'number'), '{}'::jsonb) as gate_reasons,
  coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', m->'id', 'minor', m->'minor', 'ageUnknown', m->'ageUnknown',
              'calendar', m->'calendar', 'weekly', m->'weekly', 'offerMade', m->'offerMade')))
            from jsonb_array_elements(coalesce(state->'members', '[]'::jsonb)) m), '[]'::jsonb) as members
from network.network_state;

-- Member requests (admin-console 3.8). The member's own words are never stored: only what the
-- classifier read from them.
create table if not exists network.requests (
  id             text primary key,
  member_id      text not null,
  kind           text not null check (kind in ('people', 'plans')),
  category       text,
  desire_id      text,
  outcome        text,
  tries          int not null default 0,
  opportunity_id text,
  created_at     timestamptz not null,
  fulfilled_at   timestamptz,
  updated_at     timestamptz not null default now()
);
create index if not exists requests_member on network.requests (member_id);
create index if not exists requests_outcome on network.requests (outcome);

-- Admin-console 3.12: the staff audit log. Every PII reveal, staff read of a member, timeline or
-- opportunity, and staff action (review, safety, config). Append-only: updates, deletes and
-- truncates are refused. The observatory writes it through its own login
-- (OBSERVATORY_AUDIT_DATABASE_URL, insert and select only); the real-mode data login stays read-only.
create table if not exists network.staff_audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       text not null,
  roles       text[] not null default '{}',
  action      text not null,
  target_type text,
  target_id   text,
  reason      text,
  mode        text,
  ok          boolean not null default true,
  detail      jsonb not null default '{}'::jsonb
);
create index if not exists staff_audit_target on network.staff_audit (target_type, target_id);
create or replace function network.staff_audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'network.staff_audit is append-only';
end $$;
drop trigger if exists staff_audit_no_change on network.staff_audit;
create trigger staff_audit_no_change before update or delete on network.staff_audit
  for each row execute function network.staff_audit_append_only();
drop trigger if exists staff_audit_no_truncate on network.staff_audit;
create trigger staff_audit_no_truncate before truncate on network.staff_audit
  for each statement execute function network.staff_audit_append_only();

-- The audit login (grant it to the login in OBSERVATORY_AUDIT_DATABASE_URL).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'network_observatory_audit') then
    create role network_observatory_audit nologin;
  end if;
end $$;
grant usage on schema network to network_observatory_audit;
grant select, insert on network.staff_audit to network_observatory_audit;
grant usage on sequence network.staff_audit_id_seq to network_observatory_audit;

-- Observatory: a read-only role for the real-world mode (grant to the login it uses).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'network_observatory') then
    create role network_observatory nologin;
  end if;
end $$;
grant usage on schema network to network_observatory;
grant select on all tables in schema network to network_observatory;
revoke select on network.channel_identities from network_observatory;
-- The console reads network.network_state_console, never the whole stored state (names, what members told
-- the Network, message texts). Run after the grant above: "all tables" includes it.
revoke select on network.network_state from network_observatory;
alter default privileges in schema network grant select on tables to network_observatory;
