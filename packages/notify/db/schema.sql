-- Single inbox, deliveries, task tokens and surface signals (packages/notify).
-- Applied by packages/observatory/db/migrate.ts as the repeatable 9002_notify_schema (idempotent),
-- after the roles exist, so the deployed service login never needs CREATE rights.
-- person_id is platform.people.id (uuid, kept as text); no foreign key so this file also applies on
-- its own (packages/notify tests).

create schema if not exists notify;

create table if not exists notify.inbox_items (
  id           bigserial primary key,
  dedupe_key   text not null unique,
  person_id    text not null,
  app_id       text not null,
  event_type   text not null,
  subject_id   text not null,
  urgency      text not null check (urgency in ('urgent', 'normal', 'requested')),
  -- Member-safe line, leak-checked by the producer. Never put into links or prompts.
  summary      text not null check (length(btrim(summary)) > 0),
  created_at   timestamptz not null,
  expires_at   timestamptz,
  seen_at      timestamptz,
  seen_on      text,
  notified_at  timestamptz,
  delivery_id  text
);
create index if not exists inbox_unseen_idx on notify.inbox_items (person_id, created_at) where seen_at is null;
create index if not exists inbox_pending_idx on notify.inbox_items (person_id) where seen_at is null and notified_at is null;

create table if not exists notify.deliveries (
  delivery_id       text primary key,
  person_id         text not null,
  item_ids          bigint[] not null,
  target            text not null,
  counts_toward_cap boolean not null,
  sent_at           timestamptz not null,
  outcome           text check (outcome in ('acted', 'ignored')),
  outcome_at        timestamptz
);
create index if not exists deliveries_cap_idx on notify.deliveries (person_id, sent_at) where counts_toward_cap;
create index if not exists deliveries_pending_idx on notify.deliveries (sent_at) where outcome is null;

-- References, not credentials: no secret is derived from them, and access comes from the caller's grant.
create table if not exists notify.task_tokens (
  token       text primary key check (token ~ '^T-[2-9A-HJKMNP-TV-Z]{6}$'),
  person_id   text not null,
  item_ids    bigint[] not null,
  issued_at   timestamptz not null,
  expires_at  timestamptz not null,
  redeemed_at timestamptz,
  redeemed_on text
);

create table if not exists notify.surface_signals (
  person_id      text not null,
  surface        text not null,
  active         boolean not null default false,
  last_used_at   timestamptz,
  acted          integer not null default 0,
  ignored        integer not null default 0,
  ignored_streak integer not null default 0,
  primary key (person_id, surface)
);

-- Least privilege: only the service login reads or writes the inbox (it names people and what they were sent).
revoke all on schema notify from public;
revoke all on all tables in schema notify from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'network_service') then
    grant usage on schema notify to network_service;
    grant select, insert, update, delete on all tables in schema notify to network_service;
    grant usage, select on all sequences in schema notify to network_service;
  end if;
end $$;
