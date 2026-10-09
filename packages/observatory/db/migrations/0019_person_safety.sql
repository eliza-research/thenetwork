-- 0019: person-level safety holds and evidence holds (PRD 17.4, 36.3, 40.3, F23, F24; docs/runbook-safety.md).
--  1. platform.person_safety: a hold on a person, on every app (an urgent report by someone who met
--     them, a minor report, a staff hold). It names the person and the phone's keyed hash, so leaving
--     an app, or deleting everything and joining again with the same number, does not escape it. Only
--     staff clear it (cleared_at, cleared_by); the service never deletes a row. `prior_age`: the
--     person's lowest age before a minor report lowered it (restored if staff find the report wrong).
--  2. platform.held_people(uuid[]): which of these people are on an open hold (ids only). The network
--     service reads it when it builds each app's snapshot: a held person is never matched anywhere,
--     and no app learns why (other apps see only "restricted").
--  3. network.evidence_holds: a report or a case keeps the members' messages, feedback and events
--     until `until` (EVIDENCE_RETENTION_DAYS in packages/network/src/safety.ts), even when they delete
--     their data. Staff only; nothing member-facing reads them.
-- Idempotent (if not exists / or replace), like the earlier migrations.

create table if not exists platform.person_safety (
  id          text primary key,
  person_id   uuid references platform.people (id),
  phone_hash  text,
  hold        boolean not null default true,
  reason      text not null check (reason in ('urgent_report', 'minor_report', 'staff_hold')),
  origin_app  text references platform.apps (id),
  case_id     text,
  prior_age   int,
  opened_at   timestamptz not null default now(),
  cleared_at  timestamptz,
  cleared_by  text,
  check (person_id is not null or phone_hash is not null),
  check ((cleared_at is null) = (cleared_by is null))
);
create index if not exists person_safety_person on platform.person_safety (person_id) where cleared_at is null;
create index if not exists person_safety_phone on platform.person_safety (phone_hash) where cleared_at is null and phone_hash is not null;
grant select, insert, update on platform.person_safety to platform_service;
revoke delete, truncate on platform.person_safety from platform_service;

create or replace function platform.held_people(p_people uuid[])
returns setof uuid
language sql stable security definer set search_path = pg_catalog, platform as $$
  select p.id from platform.people p
  where p.id = any(p_people)
    and exists (select 1 from platform.person_safety s
                where s.hold and s.cleared_at is null
                  and (s.person_id = p.id or (s.phone_hash is not null and s.phone_hash = p.phone_hash)))
$$;
revoke all on function platform.held_people(uuid[]) from public;
grant execute on function platform.held_people(uuid[]) to network_service;
-- The console's roles build the same snapshot (packages/observatory src/sources/real.ts).
do $$
declare r text;
begin
  for r in select rolname from pg_roles where rolname like 'network_observatory%' loop
    execute format('grant execute on function platform.held_people(uuid[]) to %I', r);
  end loop;
end $$;

create table if not exists network.evidence_holds (
  app_id     text not null,
  member_id  text not null,
  case_id    text not null default '',
  until      timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (app_id, member_id, case_id)
);
create index if not exists evidence_holds_until on network.evidence_holds (until);
alter table network.evidence_holds enable row level security;
alter table network.evidence_holds force row level security;
drop policy if exists service_app on network.evidence_holds;
create policy service_app on network.evidence_holds for all to network_service
  using (app_id = current_setting('app.app_id', true))
  with check (app_id = current_setting('app.app_id', true));
grant select, insert, update, delete on network.evidence_holds to network_service;
