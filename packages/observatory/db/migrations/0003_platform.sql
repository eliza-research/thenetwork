-- 0003: the cross-app `platform` schema (docs/research/2026-10-08-platform-architecture.md section 2.2).
-- One person (one verified phone) can be a member of several apps. A member id belongs to one app.
-- Runs once (the ledger in public.__migrations); written so that a second run is harmless too.

create schema if not exists platform;

-- Settings that founders change without a code change. 'environment' = dev | staging | production.
-- 'legacy_default_app' is the app that network rows written without `set local app.app_id` belong
-- to (network.current_app_id(), migration 0004). Delete that row when every writer sets app.app_id:
-- a write with no app then fails.
create table if not exists platform.settings (
  key   text primary key,
  value text not null
);
insert into platform.settings (key, value) values ('environment', 'dev'), ('legacy_default_app', 'ntwrk')
on conflict (key) do nothing;

-- The four apps and their policy switches (founder defaults 2026-10-08; change the rows, not code).
create table if not exists platform.apps (
  id            text primary key check (id in ('ntwrk', 'slop', 'peon', 'buddies')),
  name          text not null,
  domain        text not null,
  min_join_age  int  not null check (min_join_age >= 13),
  min_match_age int  not null default 18 check (min_match_age >= 18),
  join_mode     text not null check (join_mode in ('invite', 'open', 'waitlist')),
  status        text not null default 'dev' check (status in ('dev', 'staging', 'live', 'paused'))
);
insert into platform.apps (id, name, domain, min_join_age, min_match_age, join_mode) values
  ('ntwrk',   'The Network', 'ntwrk.party', 13, 18, 'invite'),
  ('slop',    'slop',        'slop.date',   18, 18, 'open'),
  ('peon',    'peon',        'peon.biz',    18, 18, 'open'),
  ('buddies', 'buddies',     'buddies.nyc', 18, 18, 'open')
on conflict (id) do nothing;

create table if not exists platform.cities (
  id   text primary key,
  name text not null,
  tz   text not null
);
insert into platform.cities (id, name, tz) values ('nyc', 'New York City', 'America/New_York'), ('sf', 'San Francisco', 'America/Los_Angeles')
on conflict (id) do nothing;

-- One network per app and city: the id is network.network_state.id ('<app>:<city>').
-- slop and peon matching stays off until their engine packs ship.
create table if not exists platform.networks (
  id               text primary key,
  app_id           text not null references platform.apps (id),
  city             text not null references platform.cities (id),
  matching_enabled boolean not null default false,
  run_hour         int check (run_hour between 0 and 23),
  pack_version     text,
  unique (app_id, city),
  check (id = app_id || ':' || city)
);
insert into platform.networks (id, app_id, city, matching_enabled) values
  ('ntwrk:nyc', 'ntwrk', 'nyc', true),
  ('slop:nyc', 'slop', 'nyc', false),
  ('peon:nyc', 'peon', 'nyc', false),
  ('buddies:nyc', 'buddies', 'nyc', true)
on conflict (id) do nothing;

-- One human. No PII here.
create table if not exists platform.people (
  id              uuid primary key,
  lowest_age      int,          -- the lowest age the person ever stated or a record held, on any app (fail closed)
  age_verified_at timestamptz,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz   -- tombstone after a delete of everything
);

-- The verified phone. The only place a phone number lives (with consent_events and sessions).
create table if not exists platform.phone_identities (
  e164         text primary key check (e164 ~ '^\+1[2-9][0-9]{2}[0-9]{7}$'),
  person_id    uuid not null references platform.people (id),
  verified_at  timestamptz not null,
  method       text not null check (method in ('otp_sms', 'otp_whatsapp', 'inbound_message', 'staff')),
  line_type    text,
  last_seen_at timestamptz
);
create index if not exists phone_identities_person on platform.phone_identities (person_id);

-- A person's account in one app. member_id is the id in network.members. first_name and profile
-- are what the person gave this app at join; forget() clears them.
create table if not exists platform.memberships (
  app_id     text not null references platform.apps (id),
  person_id  uuid not null references platform.people (id),
  member_id  text not null unique,
  state      text not null check (state in ('invited', 'onboarding', 'active', 'paused', 'restricted', 'removed')),
  review     text check (review in ('recycled_number')),  -- why staff must look before the membership is used
  first_name text,
  profile    jsonb not null default '{}'::jsonb,
  joined_at  timestamptz,
  left_at    timestamptz,
  primary key (app_id, person_id)
);
create index if not exists memberships_person on platform.memberships (person_id);

-- Opt-in and opt-out per app (app_id null = every app). The ledger reads the last event per
-- (e164, app_id) and per (e164, null).
create table if not exists platform.consent_events (
  id      bigserial primary key,
  e164    text not null,
  app_id  text references platform.apps (id),
  line    text,
  state   text not null check (state in ('opted_in', 'opted_out')),
  source  text not null,
  wording text,
  at      timestamptz not null
);
create index if not exists consent_events_e164 on platform.consent_events (e164, app_id, at desc, id desc);

-- Explicit sharing of base-profile fields from one app to another. A grant copies nothing.
create table if not exists platform.share_grants (
  person_id  uuid not null references platform.people (id),
  from_app   text not null references platform.apps (id),
  to_app     text not null references platform.apps (id),
  fields     text[] not null,
  granted_at timestamptz not null,
  revoked_at timestamptz,
  primary key (person_id, from_app, to_app),
  check (from_app <> to_app)
);

-- Blocks are person to person and hold on every app.
create table if not exists platform.person_blocks (
  from_person uuid not null references platform.people (id),
  to_person   uuid not null references platform.people (id),
  origin_app  text not null references platform.apps (id),
  at          timestamptz not null,
  primary key (from_person, to_person)
);

-- Staff roles per app (app_id null = every app).
create table if not exists platform.staff_roles (
  email      text not null,
  role       text not null check (role in ('admin', 'reviewer', 'safety', 'analyst', 'engineer', 'cross_app_safety')),
  app_id     text references platform.apps (id),
  granted_by text not null,
  granted_at timestamptz not null default now()
);
create unique index if not exists staff_roles_unique on platform.staff_roles (email, role, coalesce(app_id, '*'));

-- One audit log for staff and system actions on every app. Append-only (as network.staff_audit).
create table if not exists platform.audit (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  app_id      text references platform.apps (id),
  actor       text not null,
  roles       text[] not null default '{}',
  action      text not null,
  target_type text,
  target_id   text,
  reason      text,
  ok          boolean not null default true,
  detail      jsonb not null default '{}'::jsonb
);
create or replace function platform.audit_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'platform.audit is append-only';
end $$;
drop trigger if exists audit_no_change on platform.audit;
create trigger audit_no_change before update or delete on platform.audit
  for each row execute function platform.audit_append_only();
drop trigger if exists audit_no_truncate on platform.audit;
create trigger audit_no_truncate before truncate on platform.audit
  for each statement execute function platform.audit_append_only();

-- The messaging lines: inbound routing goes by the receiving line.
create table if not exists platform.app_lines (
  line_e164 text primary key,
  app_id    text not null references platform.apps (id),
  city      text references platform.cities (id),
  provider  text not null check (provider in ('blooio', 'twilio')),
  env       text not null check (env in ('dev', 'staging', 'production'))
);

-- Web OTP challenges. code_hash is set only when this server checks the code (the dev provider);
-- Twilio Verify keeps its own code.
create table if not exists platform.otp_challenges (
  id          bigserial primary key,
  app_id      text not null references platform.apps (id),
  e164        text not null,
  provider    text not null,
  code_hash   text,
  attempts    int not null default 0,
  created_at  timestamptz not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz
);
create index if not exists otp_challenges_e164 on platform.otp_challenges (app_id, e164, created_at desc);

-- Web sessions: the sha256 of a random 32-byte token, one app each. person_id is null until the
-- person joins (a verified phone with no membership).
create table if not exists platform.sessions (
  token_hash   text primary key,
  app_id       text not null references platform.apps (id),
  e164         text not null,
  person_id    uuid references platform.people (id),
  created_at   timestamptz not null,
  expires_at   timestamptz not null,
  rotated_from text,
  revoked_at   timestamptz
);
create index if not exists sessions_e164 on platform.sessions (e164);

-- Fixed-window counters. The bucket names a hash, never a raw phone or IP.
create table if not exists platform.rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  count        int not null,
  last_at      timestamptz not null,
  primary key (bucket, window_start)
);

-- Phones that deleted everything: an HMAC of the number, so a STOP is never forgotten.
create table if not exists platform.suppression (
  phone_hash text primary key,
  reason     text not null,
  at         timestamptz not null
);

-- Guard: in production, refuse the fictional 555-01xx numbers that tests and the simulator use.
create or replace function platform.refuse_synthetic_phone() returns trigger language plpgsql as $$
declare v text := coalesce(to_jsonb(new)->>'e164', to_jsonb(new)->>'line_e164');
begin
  if v ~ '^\+1[0-9]{3}55501[0-9]{2}$'
     and (select value from platform.settings where key = 'environment') = 'production' then
    raise exception 'synthetic phone % refused in production', v;
  end if;
  return new;
end $$;
drop trigger if exists phone_identities_synthetic on platform.phone_identities;
create trigger phone_identities_synthetic before insert or update on platform.phone_identities
  for each row execute function platform.refuse_synthetic_phone();
drop trigger if exists consent_events_synthetic on platform.consent_events;
create trigger consent_events_synthetic before insert on platform.consent_events
  for each row execute function platform.refuse_synthetic_phone();
drop trigger if exists app_lines_synthetic on platform.app_lines;
create trigger app_lines_synthetic before insert or update on platform.app_lines
  for each row execute function platform.refuse_synthetic_phone();

-- The service login for the public API (people, phones, sessions). Cross-app by nature: the
-- console roles get no access to this schema except the app list and their own memberships.
do $$ begin
  create role platform_service nologin;
exception when duplicate_object or unique_violation then null;
end $$;
grant usage on schema platform to platform_service;
grant select, insert, update, delete on all tables in schema platform to platform_service;
revoke update, delete, truncate on platform.audit from platform_service;
grant usage on all sequences in schema platform to platform_service;
