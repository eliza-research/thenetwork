-- 0100: Pass 2 hardening for meetup venues, cross-app venue concurrent holds,
-- external events & matchmaker constraints, slop-only cross-app firewall RLS,
-- global prospect suppression PK, operational indexes, city launch_status, and
-- dynamic SECURITY DEFINER phone_hash suppression bridge.
--
-- Additive and idempotent: safe to run more than once on fresh or already-migrated DBs.
-- Migration 0098 is untouched.

-- ---------------------------------------------------------------- 1. platform.cities launch_status
alter table platform.cities
  add column if not exists launch_status text not null default 'planned';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'platform.cities'::regclass
      and conname = 'cities_launch_status_check'
  ) then
    alter table platform.cities
      add constraint cities_launch_status_check
      check (launch_status in ('active', 'waitlist', 'planned'));
  end if;
end $$;

update platform.cities set launch_status = 'active' where id = 'nyc' and launch_status = 'planned';
update platform.cities set launch_status = 'waitlist' where id in ('sf', 'la', 'chicago', 'miami') and launch_status = 'planned';

-- ---------------------------------------------------------------- 2. platform.venues all_ages/age_min & source hardening
alter table platform.venues
  alter column all_ages set default false;

update platform.venues
  set all_ages = false
  where all_ages = true
    and (age_min > 13 or is_bar_only or is_alcohol_centric or not alcohol_optional);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'platform.venues'::regclass
      and conname = 'venues_all_ages_policy_check'
  ) then
    alter table platform.venues
      add constraint venues_all_ages_policy_check
      check (not all_ages or (age_min <= 13 and not is_bar_only and not is_alcohol_centric and alcohol_optional));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'platform.venues'::regclass
      and conname = 'venues_source_check'
  ) then
    alter table platform.venues
      add constraint venues_source_check
      check (source in ('curated', 'seed', 'google_places', 'places_api', 'overture', 'listing', 'bd_partner', 'member_suggested'));
  end if;
end $$;

-- ---------------------------------------------------------------- 3. Cross-app platform.venue_concurrent_holds (replaces network.venue_concurrent_holds)
create table if not exists platform.venue_concurrent_holds (
  id             text primary key,
  app_id         text not null references platform.apps (id),
  venue_id       text not null references platform.venues (id),
  opportunity_id text,
  window_start   timestamptz not null,
  window_end     timestamptz not null,
  headcount      smallint not null check (headcount > 0),
  status         text not null default 'active' check (status in ('active', 'released', 'completed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (window_end > window_start)
);

create index if not exists platform_venue_concurrent_holds_venue_window
  on platform.venue_concurrent_holds (venue_id, window_start, window_end)
  where status = 'active';
create index if not exists platform_venue_concurrent_holds_app_opp
  on platform.venue_concurrent_holds (app_id, opportunity_id)
  where opportunity_id is not null;

do $$
begin
  if to_regclass('network.venue_concurrent_holds') is not null then
    insert into platform.venue_concurrent_holds
      (id, app_id, venue_id, opportunity_id, window_start, window_end, headcount, status, created_at, updated_at)
    select id, app_id, venue_id, opportunity_id, window_start, window_end, headcount, status, created_at, updated_at
    from network.venue_concurrent_holds
    on conflict (id) do nothing;

    drop table network.venue_concurrent_holds;
  end if;
end $$;

-- Grant ONLY to platform_service and network_service; NEVER grant to network_observatory* (platform-7).
revoke all on platform.venue_concurrent_holds from public;
grant select, insert, update, delete on platform.venue_concurrent_holds to platform_service;
revoke truncate on platform.venue_concurrent_holds from platform_service;
grant select, insert, update, delete on platform.venue_concurrent_holds to network_service;

-- ---------------------------------------------------------------- 4. network.meetup_arrivals constraints & network.* RLS using network.current_app_id()
do $$
begin
  -- Deduplicate any pre-existing duplicate (app_id, opportunity_id, member_id) rows keeping latest updated_at.
  delete from network.meetup_arrivals a
  using network.meetup_arrivals b
  where a.app_id = b.app_id
    and a.opportunity_id = b.opportunity_id
    and a.member_id = b.member_id
    and a.ctid <> b.ctid
    and (a.updated_at < b.updated_at or (a.updated_at = b.updated_at and a.ctid < b.ctid));

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'network.meetup_arrivals'::regclass
      and conname = 'meetup_arrivals_app_opp_member_key'
  ) then
    alter table network.meetup_arrivals
      add constraint meetup_arrivals_app_opp_member_key
      unique (app_id, opportunity_id, member_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'network.meetup_arrivals'::regclass
      and conname = 'meetup_arrivals_state_check'
  ) then
    alter table network.meetup_arrivals
      add constraint meetup_arrivals_state_check
      check (state in (
        'en_route', 'late', 'arrived', 'seated', 'met',
        'venue_closed', 'venue_full', 'cannot_find', 'panic_exit', 'cancelled'
      ));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'network.meetup_arrivals'::regclass
      and conname = 'meetup_arrivals_backup_venue_id_fkey'
  ) then
    alter table network.meetup_arrivals
      add constraint meetup_arrivals_backup_venue_id_fkey
      foreign key (backup_venue_id) references platform.venues (id);
  end if;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['venue_visits', 'venue_rejections', 'meetup_arrivals'] loop
    execute format('drop policy if exists service_app on network.%I', t);
    execute format(
      'create policy service_app on network.%I for all to network_service
       using (app_id = network.current_app_id())
       with check (app_id = network.current_app_id())',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------- 5. platform.matchmaker_personas drop 'throttled' status
update platform.matchmaker_personas
  set status = 'degraded'
  where status = 'throttled';

do $$
declare
  c_name text;
begin
  for c_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'platform.matchmaker_personas'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%throttled%'
  loop
    execute format('alter table platform.matchmaker_personas drop constraint %I', c_name);
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'platform.matchmaker_personas'::regclass
      and conname = 'matchmaker_personas_status_valid_check'
  ) then
    alter table platform.matchmaker_personas
      add constraint matchmaker_personas_status_valid_check
      check (status in ('active', 'degraded', 'suspended'));
  end if;
end $$;

-- ---------------------------------------------------------------- 6. platform.external_events review_approved rename & publish CHECK
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'platform'
      and table_name = 'external_events'
      and column_name = 'human_review_approved'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'platform'
      and table_name = 'external_events'
      and column_name = 'review_approved'
  ) then
    alter table platform.external_events
      rename column human_review_approved to review_approved;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'platform.external_events'::regclass
      and conname = 'external_events_publish_gate_check'
  ) then
    alter table platform.external_events
      add constraint external_events_publish_gate_check
      check (
        status not in ('published', 'active')
        or (confirmed_network_anchors >= 1 and review_approved = true and external_crowd_disclosed = true)
      );
  end if;
end $$;

-- ---------------------------------------------------------------- 7. platform.external_prospect_suppressions global dedupe_hash PK
do $$
declare
  pk_name text;
  pk_cols text[];
begin
  select c.conname, array_agg(a.attname order by k.ord)
  into pk_name, pk_cols
  from pg_constraint c
  join unnest(c.conkey) with ordinality as k(attnum, ord) on true
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
  where c.conrelid = 'platform.external_prospect_suppressions'::regclass
    and c.contype = 'p'
  group by c.conname;

  if pk_cols is distinct from array['dedupe_hash']::text[] then
    delete from platform.external_prospect_suppressions a
    using platform.external_prospect_suppressions b
    where a.dedupe_hash = b.dedupe_hash
      and a.ctid <> b.ctid
      and (
        (b.permanent and not a.permanent)
        or (a.permanent = b.permanent and b.created_at > a.created_at)
        or (a.permanent = b.permanent and b.created_at = a.created_at and b.ctid > a.ctid)
      );

    if pk_name is not null then
      execute format('alter table platform.external_prospect_suppressions drop constraint %I', pk_name);
    end if;

    alter table platform.external_prospect_suppressions
      add constraint external_prospect_suppressions_pkey primary key (dedupe_hash);
  end if;
end $$;

create index if not exists external_prospect_suppressions_city_dedupe
  on platform.external_prospect_suppressions (city, dedupe_hash);

-- ---------------------------------------------------------------- 8. Missing operational indexes
create index if not exists external_prospects_city_persona
  on platform.external_prospects (city, assigned_persona_id);

create index if not exists external_sourcing_tickets_city_state
  on platform.external_sourcing_tickets (city, state);

-- ---------------------------------------------------------------- 9. Tighten cross_app_score_firewall RLS to slop-only (fail-closed)
do $$
declare
  t text;
begin
  foreach t in array array['external_prospects', 'external_sourcing_tickets', 'external_prospect_suppressions'] loop
    execute format('drop policy if exists cross_app_score_firewall on platform.%I', t);
    execute format(
      'create policy cross_app_score_firewall on platform.%I for all to platform_service, network_service
       using (
         coalesce(nullif(current_setting(''app.current_app'', true), ''''), nullif(current_setting(''app.app_id'', true), '''')) = ''slop''
         and coalesce(nullif(current_setting(''app.current_app'', true), ''''), ''slop'') = ''slop''
         and coalesce(nullif(current_setting(''app.app_id'', true), ''''), ''slop'') = ''slop''
       )
       with check (
         coalesce(nullif(current_setting(''app.current_app'', true), ''''), nullif(current_setting(''app.app_id'', true), '''')) = ''slop''
         and coalesce(nullif(current_setting(''app.current_app'', true), ''''), ''slop'') = ''slop''
         and coalesce(nullif(current_setting(''app.app_id'', true), ''''), ''slop'') = ''slop''
       )',
      t
    );
  end loop;
end $$;

-- ---------------------------------------------------------------- 10. Dynamic SECURITY DEFINER phone_hash suppression bridge
-- Safe on fresh DBs before repeatable 9004_marketing_schema runs (checks to_regclass + column existence dynamically).
-- Returns ONLY a boolean: zero PII, zero score/app leakage.
create or replace function platform.is_suppressed_phone_hash(p_hash text)
returns boolean
language plpgsql
security definer
set search_path = platform, pg_catalog
set app.current_app = 'slop'
set app.app_id = 'slop'
as $$
declare
  v_suppressed boolean := false;
  v_mkt_suppressed boolean := false;
begin
  if p_hash is null or btrim(p_hash) = '' then
    return false;
  end if;

  select exists (
    select 1
    from platform.external_prospect_suppressions
    where phone_hash = p_hash
      and (permanent or (suppress_until is not null and suppress_until > now()))
  )
  into v_suppressed;

  if coalesce(v_suppressed, false) then
    return true;
  end if;

  if to_regclass('marketing.humans') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'marketing'
         and table_name = 'humans'
         and column_name = 'phone_hash'
     ) then
    execute 'select exists (select 1 from marketing.humans where phone_hash = $1 and (stopped or banned))'
      into v_mkt_suppressed
      using p_hash;
    if coalesce(v_mkt_suppressed, false) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

revoke all on function platform.is_suppressed_phone_hash(text) from public;
grant execute on function platform.is_suppressed_phone_hash(text) to platform_service, network_service;
