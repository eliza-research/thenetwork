-- The ConsentNetwork's stored state (packages/network/src/store.ts, PgStore). Idempotent: safe to
-- run again, and safe before or after packages/observatory/db/schema.sql (the tables both define
-- have the same columns; this file only adds columns and tables).
create schema if not exists network;

-- The whole Network state as one JSON document per network (exportState / importState).
-- PgStore writes it under the advisory lock hashtext('network-tick-<id>'). Every unit of work (runTick, runStored) loads it first and saves after, so two processes never overwrite each other.
create table if not exists network.network_state (
  id       text primary key default 'nyc',
  version  int not null,
  state    jsonb not null,
  saved_at timestamptz not null default now()
);

-- Normalized rows for the console (written from the state on every save; read-only for the console).
-- Same definition as packages/observatory/db/schema.sql.
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

-- Who is in each opportunity (participants with their status, and alternates). Same columns as
-- packages/observatory/db/schema.sql; that file also adds a foreign key to network.members.
create table if not exists network.participations (
  opportunity_id text not null references network.opportunities (id) on delete cascade,
  member_id      text not null,
  role           text not null default 'participant' check (role in ('participant', 'alternate')),
  status         text not null,
  enjoyment      real,
  invited_at     timestamptz,
  responded_at   timestamptz,
  primary key (opportunity_id, member_id)
);
create index if not exists participations_member on network.participations (member_id);

-- Same definition as packages/observatory/db/schema.sql, plus the columns below.
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
-- PRD 32.8: where the item came from, the time the reviewer spent, what they edited, how often it
-- was re-rolled, and why an approved item was not started (a gate failed on the re-check).
alter table network.review_items add column if not exists origin text;
alter table network.review_items add column if not exists seconds_spent real;
alter table network.review_items add column if not exists edits jsonb;
alter table network.review_items add column if not exists rerolls int not null default 0;
alter table network.review_items add column if not exists invalidated text;

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
