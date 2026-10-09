-- 0014: the outbound queue in Postgres (PRD 32.2 network.outbound_messages; audit network-service-12 and
-- network-service-M5). One queue serves one Blooio line for every app, so these tables are per line, not per
-- app: no row-level security by app (the network_service role reads and writes them all), and the app is a
-- plain column on each record.
--  - outbound_queue: one row per message (idempotency key), with the 32.2 fields (provider message id, line,
--    attempts, next attempt, last error, delivered and read times). The text and the address are kept only
--    while the message may still be sent or is parked for leak review; a final row keeps neither.
--  - outbound_sends: one row per provider send (per-recipient and per-line new-conversation caps).
--  - outbound_contacts: per conversation, the unanswered count and the single re-engagement.
--  - outbound_inbound: the last inbound per address (the reply window).
--  - line_safety: the Blooio safety action per line ('*' when an event named no line and none is configured).
-- Addresses in the counters are keyed hashes (address_key), never the number. `mode` keeps a dry run's
-- state ('dry_run') apart from live sends ('live'), so a rehearsal never counts against the real line.
-- Runs once (public.__migrations), after 0012.
create table if not exists network.outbound_queue (
  mode                 text not null default 'live' check (mode in ('live', 'dry_run')),
  idempotency_key      text not null,
  id                   text not null,
  line                 text not null,
  address              text,
  address_key          text not null,
  app_id               text,
  channel              text not null,
  kind                 text not null,
  status               text not null,
  text                 text,
  fingerprint          text not null,
  provider_message_id  text,
  attempts             int not null default 0,
  next_attempt_at      timestamptz not null,
  last_error           jsonb,
  sent_at              timestamptz,
  delivered_at         timestamptz,
  read_at              timestamptz,
  created_at           timestamptz not null,
  updated_at           timestamptz not null default now(),
  record               jsonb not null default '{}'::jsonb,
  primary key (mode, idempotency_key)
);
create index if not exists outbound_queue_provider on network.outbound_queue (mode, provider_message_id) where provider_message_id is not null;
create index if not exists outbound_queue_status on network.outbound_queue (mode, status, created_at);

create table if not exists network.outbound_sends (
  id           bigserial primary key,
  mode         text not null default 'live' check (mode in ('live', 'dry_run')),
  line         text not null,
  address_key  text not null,
  at           timestamptz not null,
  new_chat     boolean not null default false
);
create index if not exists outbound_sends_at on network.outbound_sends (mode, at);

create table if not exists network.outbound_contacts (
  mode               text not null default 'live' check (mode in ('live', 'dry_run')),
  contact_key        text not null,
  unanswered         int not null default 0,
  last_inbound_at    timestamptz,
  last_outbound_at   timestamptz,
  reengagement_used  boolean not null default false,
  known              boolean not null default false,
  updated_at         timestamptz not null default now(),
  primary key (mode, contact_key)
);

create table if not exists network.outbound_inbound (
  mode         text not null default 'live' check (mode in ('live', 'dry_run')),
  address_key  text not null,
  at           timestamptz not null,
  primary key (mode, address_key)
);

create table if not exists network.line_safety (
  mode        text not null default 'live' check (mode in ('live', 'dry_run')),
  line        text not null,
  action      text not null,
  updated_at  timestamptz not null default now(),
  primary key (mode, line)
);

grant select, insert, update, delete on network.outbound_queue, network.outbound_sends, network.outbound_contacts,
  network.outbound_inbound, network.line_safety to network_service;
grant usage, select on sequence network.outbound_sends_id_seq to network_service;
