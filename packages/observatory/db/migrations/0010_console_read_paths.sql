-- 0010: the admin console's read paths keep each app to itself (audit platform-7 / observatory-4,
-- observatory-3; PRD 40.3 "Cross-app privacy").
--  - network.network_state_console runs as its owner, so row-level security does not filter it: a
--    role that may select it reads every app's trust levels, cases and minors. No console role may
--    select it now. Each app's read role (network_observatory_<app>) reads only its own view
--    network.network_state_console_<app>; the shared role network_observatory reads ntwrk's only.
--  - The cross-app role reads a narrow view (app, trust levels, cases) instead of the whole console
--    view, and only the columns of members, messages and participations that its counts need: never a
--    name, a bio, an age or a message text.
--  - Person-to-person blocks: each app's read role read every block of every app (person ids and the
--    time), which told it that a member of its app blocked, or was blocked by, someone on another app.
--    Now it reads platform.person_blocks_<app>: blocks where both people are members of that app (the
--    only ones the engine snapshot uses). The view runs as its owner, which may read the table.
-- The per-app objects are made for every row of platform.apps, so a renamed or new app gets its own.
-- Runs once (public.__migrations); every step is also safe to run again.

revoke all on network.network_state_console from public;
do $$
declare r text;
begin
  foreach r in array array['network_observatory', 'network_observatory_cross_app'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on network.network_state_console from %I', r);
    end if;
  end loop;
end $$;

do $$
declare
  a text;
  role text;
begin
  for a in select id from platform.apps order by id loop
    role := 'network_observatory_' || a;
    begin
      execute format('create role %I nologin', role);
    exception when duplicate_object or unique_violation then null;
    end;
    execute format('grant usage on schema network to %I', role);
    execute format('grant usage on schema platform to %I', role);
    execute format('revoke all on network.network_state_console from %I', role);

    -- This app's console view (as 0005 made it; again here for an app added since).
    execute format('create or replace view network.%I with (security_barrier) as
                    select c.* from network.network_state_console c join network.network_state s on s.id = c.id where s.app_id = %L',
                   'network_state_console_' || a, a);
    execute format('revoke all on network.%I from public', 'network_state_console_' || a);
    execute format('grant select on network.%I to %I', 'network_state_console_' || a, role);
    if a = 'ntwrk' then
      execute format('grant select on network.%I to network_observatory', 'network_state_console_' || a);
    else
      execute format('revoke all on network.%I from network_observatory', 'network_state_console_' || a);
    end if;

    -- Blocks between two members of this app only.
    execute format('create or replace view platform.%I with (security_barrier) as
                    select b.from_person, b.to_person, b.at from platform.person_blocks b
                    where exists (select 1 from platform.memberships m where m.person_id = b.from_person and m.app_id = %L)
                      and exists (select 1 from platform.memberships m where m.person_id = b.to_person and m.app_id = %L)',
                   'person_blocks_' || a, a, a);
    execute format('revoke all on platform.%I from public', 'person_blocks_' || a);
    execute format('grant select on platform.%I to %I', 'person_blocks_' || a, role);
    execute format('revoke all on platform.person_blocks from %I', role);
  end loop;
end $$;

-- The cross-app person view: trust levels and cases per app, nothing else from the stored state.
create or replace view network.network_state_console_cross_app with (security_barrier) as
  select s.app_id as app, c.id, c.saved_at, c.trust, c.cases
  from network.network_state_console c join network.network_state s on s.id = c.id;
revoke all on network.network_state_console_cross_app from public;
revoke all on network.network_state_console_cross_app from network_observatory;
grant select on network.network_state_console_cross_app to network_observatory_cross_app;

-- Column allow-list for the cross-app role (its per-app panel counts messages and opportunities).
revoke select on network.members, network.messages, network.participations from network_observatory_cross_app;
grant select (app_id, id, person_id, account_status, participation_state, joined_at) on network.members to network_observatory_cross_app;
grant select (app_id, member_id, direction, ts, system) on network.messages to network_observatory_cross_app;
grant select (app_id, member_id, opportunity_id, role) on network.participations to network_observatory_cross_app;
