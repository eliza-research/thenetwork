-- 0014: photos by text and the weekly bias monitor (slop.date; critical path items 5 and 8).
--  1. platform.pending_texts may hold 'photo_consent': an adult slop member sent a photo by text before
--     they agreed to the photo consent. The photo is not kept; the service asks once and waits for YES.
--     The consent itself is stored on the membership (platform.memberships.profile.photoConsent), so
--     leaving the app clears it.
--  2. network.bias_reports: the weekly biasMonitor result per network (aggregates only, no member ids).
--     The service writes one row a week per network; the console reads the newest rows. Row-level
--     security as on every other app-scoped network table.
-- Idempotent, like the earlier migrations.

alter table platform.pending_texts drop constraint if exists pending_texts_kind_check;
alter table platform.pending_texts add constraint pending_texts_kind_check check (kind in ('join', 'looking_for', 'share', 'photo_consent'));

create table if not exists network.bias_reports (
  app_id     text not null,
  id         text primary key,
  network_id text not null,
  at         timestamptz not null,
  members    int not null,
  alerts     int not null,
  report     jsonb not null
);
create index if not exists bias_reports_network on network.bias_reports (network_id, at desc);

do $$
declare
  a text;
begin
  alter table network.bias_reports enable row level security;
  alter table network.bias_reports force row level security;
  drop policy if exists service_app on network.bias_reports;
  create policy service_app on network.bias_reports for all to network_service
    using (app_id = current_setting('app.app_id', true))
    with check (app_id = current_setting('app.app_id', true));
  grant select, insert on network.bias_reports to network_service;
  foreach a in array array['ntwrk', 'slop', 'peon', 'friends'] loop
    if exists (select 1 from pg_roles where rolname = 'network_observatory_' || a) then
      execute format('drop policy if exists %I on network.bias_reports', 'observatory_app_' || a);
      execute format('create policy %I on network.bias_reports for select to %I using (app_id = %L)', 'observatory_app_' || a, 'network_observatory_' || a, a);
      execute format('grant select on network.bias_reports to %I', 'network_observatory_' || a);
    end if;
  end loop;
end $$;
