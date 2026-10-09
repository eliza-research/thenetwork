-- 0020: photos on the live path (slop.date; PRD 40.5, 37.1 items 5 and 7).
--  1. platform.photos: where the photo came from (web upload or a text), its moderation state (every
--     new photo is pending; staff approve or reject it, an automatic classifier may only reject), and
--     the rating state the service's retry reads (pending, rated, skipped, failed, refused; at most 5
--     tries with backoff). Existing photos start pending on both.
--  2. platform.photo_consents: the photo consent version a person agreed to, per app, and where. A
--     photo sent by text is kept only when the newest one is the current version.
--  3. network.bias_reports: the weekly bias monitor's report per app (aggregates by rating quintile
--     and by self-reported group, never a member or a rating), with the action taken (ok, alert, pause).
--  4. The rating facets of the first photo rater (one per photo, '<app>:rating:*' tags on 0..1) are
--     removed: the slop pack never read them. Ratings are now one facet per member ('<member>:appearance',
--     'appearance:*' tags on the engine's scale), written by the service.
-- Idempotent (if not exists / on conflict), like the earlier migrations.

alter table platform.photos add column if not exists source text not null default 'web';
alter table platform.photos add column if not exists moderation_status text not null default 'pending';
alter table platform.photos add column if not exists moderated_by text;
alter table platform.photos add column if not exists moderated_at timestamptz;
alter table platform.photos add column if not exists moderation_reason text;
alter table platform.photos add column if not exists rating_status text not null default 'pending';
alter table platform.photos add column if not exists rating_attempts int not null default 0;
alter table platform.photos add column if not exists rating_last_error text;
alter table platform.photos add column if not exists rating_next_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'photos_source_check') then
    alter table platform.photos add constraint photos_source_check check (source in ('web', 'mms'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'photos_moderation_check') then
    alter table platform.photos add constraint photos_moderation_check check (moderation_status in ('pending', 'approved', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'photos_rating_check') then
    alter table platform.photos add constraint photos_rating_check check (rating_status in ('pending', 'rated', 'skipped', 'failed', 'refused') and rating_attempts >= 0);
  end if;
end $$;
create index if not exists photos_rating_due on platform.photos (rating_next_at) where deleted_at is null and rating_status in ('pending', 'skipped', 'failed');

create table if not exists platform.photo_consents (
  person_id uuid not null references platform.people (id) on delete cascade,
  app_id    text not null references platform.apps (id),
  version   text not null,
  source    text not null check (source in ('web', 'mms')),
  at        timestamptz not null
);
create index if not exists photo_consents_person on platform.photo_consents (person_id, app_id, at desc);
grant select, insert, delete on platform.photo_consents to platform_service;
revoke update, truncate on platform.photo_consents from platform_service;

create table if not exists network.bias_reports (
  id           text primary key,
  app_id       text not null,
  at           timestamptz not null,
  window_start timestamptz not null,
  window_end   timestamptz not null,
  ratio        real not null,
  min_group    text not null,
  action       text not null check (action in ('ok', 'alert', 'pause')),
  report       jsonb not null
);
create index if not exists bias_reports_app_at on network.bias_reports (app_id, at desc);
alter table network.bias_reports enable row level security;
alter table network.bias_reports force row level security;
drop policy if exists service_app on network.bias_reports;
create policy service_app on network.bias_reports for all to network_service
  using (app_id = current_setting('app.app_id', true))
  with check (app_id = current_setting('app.app_id', true));
grant select, insert on network.bias_reports to network_service;
do $$
declare
  a text;
begin
  foreach a in array array['ntwrk', 'slop', 'peon', 'buddies', 'friends'] loop
    if exists (select 1 from pg_roles where rolname = 'network_observatory_' || a) then
      execute format('drop policy if exists %I on network.bias_reports', 'observatory_app_' || a);
      execute format('create policy %I on network.bias_reports for select to %I using (app_id = %L)', 'observatory_app_' || a, 'network_observatory_' || a, a);
      execute format('grant select on network.bias_reports to %I', 'network_observatory_' || a);
    end if;
  end loop;
end $$;

delete from network.facets where id like '%:photo:ph\_%' and exists (select 1 from unnest(tags) t where t like '%:rating:%');
