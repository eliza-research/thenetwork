-- The Network: proposed canonical `network` schema (PRD 32.1, 32.2, 32.4, 32.10, 32.11, 32.13,
-- 32.19, 33). Production (Eliza Cloud, Railway Postgres) does not have it yet; this file is the
-- contract the observatory's real-world mode reads. Field names mirror packages/core/src/types.ts.
-- Idempotent: safe to run on an existing database.

create schema if not exists network;

-- 32.1 Identity and membership. PII (phone, email) lives only in channel_identities.
create table if not exists network.members (
  id                   text primary key,
  cloud_user_id        text,
  name                 text not null,
  home_city            text not null check (home_city in ('sf', 'nyc')),
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

-- Observatory: a read-only role for the real-world mode (grant to the login it uses).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'network_observatory') then
    create role network_observatory nologin;
  end if;
end $$;
grant usage on schema network to network_observatory;
grant select on all tables in schema network to network_observatory;
revoke select on network.channel_identities from network_observatory;
alter default privileges in schema network grant select on tables to network_observatory;
