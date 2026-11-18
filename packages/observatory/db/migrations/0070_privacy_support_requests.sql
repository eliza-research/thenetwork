-- Story F24: export and erasure requests sent to help@ntwrk.party, and the privacy replay after a restore.
--  1. platform.privacy_requests: one staff support request (spec/accountPrivacy.md, "Story: Staff carry out an
--     export or erasure request sent to support"). It keeps the keyed phone hash, never the number, and the
--     person the first step showed. The confirming step must name the same request, phone and person.
--  2. platform.privacy_replay: erasures, leaves and bans that a restore found in the source database after the
--     backup (spec/databaseRestore.md, "Story: Carry privacy changes made after the backup into the restored
--     database"). The restore command queues them; the staff replay route runs each one once.
create table if not exists platform.privacy_requests (
  id           uuid primary key,
  operation    text not null check (operation in ('export', 'erase')),
  app_id       text not null references platform.apps (id),
  scope        text not null check (scope in ('app', 'all')),
  phone_hash   text not null,
  person_id    uuid references platform.people (id),
  requested_by text not null,
  created_at   timestamptz not null,
  completed_at timestamptz,
  completed_by text,
  outcome      text check (outcome in ('exported', 'erased')),
  check (operation = 'export' or scope = 'all'),
  check ((completed_at is null) = (outcome is null))
);
create index if not exists privacy_requests_open on platform.privacy_requests (phone_hash, created_at) where completed_at is null;

create table if not exists platform.privacy_replay (
  id          bigserial primary key,
  kind        text not null check (kind in ('erase', 'leave', 'ban')),
  person_id   uuid not null references platform.people (id),
  app_id      text references platform.apps (id),
  member_id   text,
  queued_at   timestamptz not null,
  replayed_at timestamptz,
  outcome     text,
  check ((kind = 'leave') = (app_id is not null and member_id is not null)),
  check ((replayed_at is null) = (outcome is null))
);
create unique index if not exists privacy_replay_once on platform.privacy_replay (kind, person_id, coalesce(app_id, ''), coalesce(member_id, ''));

revoke all on platform.privacy_requests, platform.privacy_replay from public;
grant select, insert, update on platform.privacy_requests, platform.privacy_replay to network_service, platform_service;
grant usage on sequence platform.privacy_replay_id_seq to network_service, platform_service;
