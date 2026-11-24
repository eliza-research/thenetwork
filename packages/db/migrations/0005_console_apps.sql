-- 0005: the admin console for four apps (platform plan section 5).
--  - network.staff_audit gets app_id: every staff read and action names its app (null: no app, for
--    example a mode switch). The cross-app person view writes its row here before it reads.
--  - One console view of the Network state per app. network.network_state_console runs as its owner,
--    so row-level security does not filter it; each per-app view keeps to its app, and only that
--    app's read role (network_observatory_<app>) may select it.
--  - network_observatory_cross_app: the read role for the cross-app person view (cross_app_safety
--    staff). It reads memberships, blocks and the per-member facts the view shows, never a phone.
-- Runs once (public.__migrations); every step is also safe to run again.

alter table network.staff_audit add column if not exists app_id text;
create index if not exists staff_audit_app on network.staff_audit (app_id, id);

do $$
declare a text;
begin
  foreach a in array array['ntwrk', 'slop', 'peon', 'buddies'] loop
    execute format('create or replace view network.%I with (security_barrier) as
                    select c.* from network.network_state_console c join network.network_state s on s.id = c.id where s.app_id = %L',
                   'network_state_console_' || a, a);
    execute format('revoke all on network.%I from public', 'network_state_console_' || a);
    execute format('grant select on network.%I to %I', 'network_state_console_' || a, 'network_observatory_' || a);
    -- The original console role reads ntwrk only (as its row policies in 0004). Default privileges may
    -- have granted it every new view: take the other apps away.
    if a = 'ntwrk' then
      execute format('grant select on network.%I to network_observatory', 'network_state_console_' || a);
    else
      execute format('revoke select on network.%I from network_observatory', 'network_state_console_' || a);
    end if;
  end loop;
end $$;

do $$ begin
  create role network_observatory_cross_app nologin;
exception when duplicate_object or unique_violation then null;
end $$;
grant usage on schema platform to network_observatory_cross_app;
grant usage on schema network to network_observatory_cross_app;
grant select on platform.apps, platform.people, platform.memberships, platform.person_blocks to network_observatory_cross_app;
grant select on network.network_state_console to network_observatory_cross_app;
-- The per-app panel reads members, messages and participations of every app (counts and states only).
do $$
declare t text;
begin
  foreach t in array array['members', 'messages', 'participations'] loop
    execute format('drop policy if exists observatory_cross_app on network.%I', t);
    execute format('create policy observatory_cross_app on network.%I for select to network_observatory_cross_app using (true)', t);
    execute format('grant select on network.%I to network_observatory_cross_app', t);
  end loop;
end $$;

-- The engine snapshot (packages/network/service/snapshot.ts, a shadow run) reads person-to-person
-- blocks: each app's read role may read who blocked whom (person ids and the time), never the app
-- where the block was made.
do $$
declare a text;
begin
  foreach a in array array['ntwrk', 'slop', 'peon', 'buddies'] loop
    execute format('grant select (from_person, to_person, at) on platform.person_blocks to %I', 'network_observatory_' || a);
  end loop;
end $$;
