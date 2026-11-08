-- Safety state that follows the person (PRD 40.3; SD-021, SD-022).
--
-- A safety hold is on the person, not on one member id. Staff write a row when they hold a person
-- (app_id '*' for a hold on every app, or one app id for a hold by staff of that app only). A leave
-- writes a row for that app when the member is held, has an urgent report waiting for staff, or was
-- reported as a minor. Each app's snapshot reads the rows of its members' people, and the Network
-- holds a member that a row covers: a join on a new app, a rejoin after a leave (a new member id),
-- and an app that the staff hold loop did not reach. Only a staff lift deletes a row.
create table if not exists platform.person_holds (
  person_id uuid not null references platform.people (id) on delete cascade,
  app_id    text not null,  -- '*': every app
  held_by   text not null,
  at        timestamptz not null,
  primary key (person_id, app_id)
);
revoke all on platform.person_holds from public;
grant select, insert, delete on platform.person_holds to platform_service;

-- The console reads one app's snapshot through its own role (observatory real.ts appSnapshotSql): a
-- view per app with the rows that cover that app's members only.
do $$
declare
  a text;
begin
  for a in select id from platform.apps order by id loop
    execute format('create or replace view platform.%I with (security_barrier=true) as
      select h.person_id, h.app_id, h.held_by, h.at from platform.person_holds h
      where h.app_id in (%L, ''*'') and exists (select 1 from network.members m where m.app_id = %L and m.person_id = h.person_id)',
      'person_holds_' || a, a, a);
    execute format('revoke all on platform.%I from public', 'person_holds_' || a);
    execute format('grant select on platform.%I to %I', 'person_holds_' || a, 'network_observatory_' || a);
    if a = 'ntwrk' then
      grant select on platform.person_holds_ntwrk to network_observatory;
    end if;
  end loop;
end $$;

-- A safety notice (the hold notice) has its own outbound kind (SD-475): consent, the leak guard and
-- the ban still apply; the hold, quiet hours, the unanswered streak and the line caps do not.
alter table platform.outbound drop constraint if exists outbound_kind_check;
alter table platform.outbound add constraint outbound_kind_check
  check (kind in ('reply', 'compliance', 'proactive', 'safety', 'transactional'));
