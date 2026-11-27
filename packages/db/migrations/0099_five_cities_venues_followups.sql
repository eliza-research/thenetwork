-- 0098: five launch cities, 20 app-city networks, public venue catalog and external API cache,
-- member venue visits/rejections, meetup arrivals, work intros, and opportunity/feedback venue
-- and follow-up columns.
-- Idempotent (if not exists / on conflict / drop policy if exists): safe to run more than once.

-- ---------------------------------------------------------------- 1. Five cities
insert into platform.cities (id, name, tz) values
  ('sf',      'San Francisco', 'America/Los_Angeles'),
  ('nyc',     'New York',      'America/New_York'),
  ('la',      'Los Angeles',   'America/Los_Angeles'),
  ('chicago', 'Chicago',       'America/Chicago'),
  ('miami',   'Miami',         'America/New_York')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- 2. 20 <app>:<city> networks
insert into platform.networks (id, app_id, city)
select a.app_id || ':' || c.city, a.app_id, c.city
from (values ('ntwrk'), ('slop'), ('peon'), ('friends')) as a(app_id)
cross join (values ('sf'), ('nyc'), ('la'), ('chicago'), ('miami')) as c(city)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- 3. Public venue catalog
create table if not exists platform.venues (
  id                     text primary key,
  city                   text not null references platform.cities (id),
  neighborhood           text not null,
  name                   text not null,
  address                text not null default '',
  lat                    double precision not null,
  lon                    double precision not null,
  is_public              boolean not null default true check (is_public = true),
  category               text not null,
  price_tier             smallint not null check (price_tier between 0 and 4),
  age_min                smallint not null default 18,
  is_bar_only            boolean not null default false,
  alcohol_optional       boolean not null default true,
  serves_vegetarian      boolean not null default true,
  serves_vegan           boolean not null default false,
  wheelchair_accessible  boolean not null default true,
  separate_checks        boolean not null default true,
  walk_in_group_capacity smallint not null default 6,
  reservation_required   boolean not null default false,
  noise_level            text not null default 'conversational',
  live_music_at_night    boolean not null default false,
  indoor                 boolean not null default true,
  outdoor                boolean not null default false,
  weather_sensitive      boolean not null default false,
  arrival_landmark       text not null default '',
  hours                  jsonb not null default '[]'::jsonb,
  group_score            smallint not null default 70,
  date_score             smallint not null default 70,
  source                 text not null default 'curated',
  yelp_id                text,
  yelp_rating            double precision,
  yelp_review_count      integer,
  google_place_id        text,
  status                 text not null default 'active'
                         check (status in ('active', 'suspect_closed', 'closed_temporary', 'closed_permanent')),
  closure_reports        integer not null default 0,
  verified_open_at       timestamptz,
  geo_expires_at         timestamptz,
  recheck_after          timestamptz,
  persona_priors         jsonb not null default '{}'::jsonb,
  persona_stats          jsonb not null default '{}'::jsonb,
  overall_likes          integer not null default 0,
  overall_dislikes       integer not null default 0,
  visit_count            integer not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index if not exists venues_city_status_price
  on platform.venues (city, status, price_tier);
create index if not exists venues_city_neighborhood_status
  on platform.venues (city, neighborhood, status);
create unique index if not exists venues_yelp_id
  on platform.venues (yelp_id) where yelp_id is not null;
create unique index if not exists venues_google_place_id
  on platform.venues (google_place_id) where google_place_id is not null;

-- ---------------------------------------------------------------- 4. External venue API cache
create table if not exists platform.venue_api_cache (
  cache_key    text primary key,
  provider     text not null,
  city         text not null references platform.cities (id),
  payload      jsonb not null,
  result_count integer not null default 0,
  fetched_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index if not exists venue_api_cache_provider_city_expires
  on platform.venue_api_cache (provider, city, expires_at);

-- ---------------------------------------------------------------- 5. App-scoped venue, arrival, and work-intro tables
create table if not exists network.venue_visits (
  id             text primary key,
  app_id         text not null default network.current_app_id() references platform.apps (id),
  member_id      text not null,
  venue_id       text not null references platform.venues (id),
  opportunity_id text,
  visited_at     timestamptz not null,
  sentiment      text,
  issues         jsonb not null default '[]'::jsonb,
  closed_report  boolean not null default false
);

create index if not exists venue_visits_app_member
  on network.venue_visits (app_id, member_id, visited_at desc);
create index if not exists venue_visits_app_venue
  on network.venue_visits (app_id, venue_id, visited_at desc);
create index if not exists venue_visits_opportunity
  on network.venue_visits (app_id, opportunity_id) where opportunity_id is not null;

create table if not exists network.venue_rejections (
  app_id      text not null default network.current_app_id() references platform.apps (id),
  member_id   text not null,
  venue_id    text not null references platform.venues (id),
  reason      text not null default '',
  rejected_at timestamptz not null,
  primary key (app_id, member_id, venue_id)
);

create index if not exists venue_rejections_app_venue
  on network.venue_rejections (app_id, venue_id);

create table if not exists network.meetup_arrivals (
  id              text primary key,
  app_id          text not null default network.current_app_id() references platform.apps (id),
  opportunity_id  text not null,
  member_id       text not null,
  state           text not null,
  eta_mins        smallint,
  safe_cue        text not null default '',
  backup_venue_id text,
  updated_at      timestamptz not null
);

create index if not exists meetup_arrivals_app_opp
  on network.meetup_arrivals (app_id, opportunity_id, member_id);
create index if not exists meetup_arrivals_app_member
  on network.meetup_arrivals (app_id, member_id, updated_at desc);

create table if not exists network.work_intros (
  opportunity_id    text primary key,
  app_id            text not null default network.current_app_id() references platform.apps (id),
  channel           text not null check (channel in ('warm_email', 'scheduled_video', 'relay_share')),
  intro_sent_at     timestamptz,
  slot_confirmed_at timestamptz,
  meet_url          text,
  followup_due_at   timestamptz,
  followup_sent_at  timestamptz,
  stage             text not null default 'introduced',
  updated_at        timestamptz not null default now()
);

create index if not exists work_intros_app_stage
  on network.work_intros (app_id, stage);
create index if not exists work_intros_app_followup_due
  on network.work_intros (app_id, followup_due_at)
  where followup_sent_at is null and followup_due_at is not null;

-- ---------------------------------------------------------------- 6. Columns on opportunities and feedback
alter table network.opportunities add column if not exists venue_id text;
alter table network.opportunities add column if not exists backup_venue_id text;
alter table network.opportunities add column if not exists work_intro_channel text;
alter table network.opportunities add column if not exists followup_scheduled_at timestamptz;
alter table network.opportunities add column if not exists followup_sent_at timestamptz;

alter table network.feedback add column if not exists venue_id text;
alter table network.feedback add column if not exists venue_sentiment text;
alter table network.feedback add column if not exists venue_closed_report boolean not null default false;
alter table network.feedback add column if not exists venue_issues jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------- 7. Row-level security and role grants
revoke all on platform.venues, platform.venue_api_cache from public;
grant select, insert, update, delete on platform.venues, platform.venue_api_cache to platform_service;
revoke truncate on platform.venues, platform.venue_api_cache from platform_service;
grant select, insert, update, delete on platform.venues, platform.venue_api_cache to network_service;

do $$
declare
  t text;
  a text;
begin
  if exists (select 1 from pg_roles where rolname = 'network_observatory') then
    grant usage on schema platform to network_observatory;
    grant select on platform.cities, platform.venues to network_observatory;
  end if;

  for a in select id from platform.apps order by id loop
    if exists (select 1 from pg_roles where rolname = 'network_observatory_' || a) then
      execute format('grant select on platform.venues to %I', 'network_observatory_' || a);
    end if;
  end loop;

  foreach t in array array['venue_visits', 'venue_rejections', 'meetup_arrivals', 'work_intros'] loop
    execute format('revoke all on network.%I from public', t);
    execute format('alter table network.%I enable row level security', t);
    execute format('alter table network.%I force row level security', t);

    execute format('drop policy if exists service_app on network.%I', t);
    execute format('create policy service_app on network.%I for all to network_service
                    using (app_id = current_setting(''app.app_id'', true))
                    with check (app_id = current_setting(''app.app_id'', true))', t);
    execute format('grant select, insert, update, delete on network.%I to network_service', t);

    if exists (select 1 from pg_roles where rolname = 'network_observatory') then
      execute format('drop policy if exists observatory_ntwrk on network.%I', t);
      execute format('create policy observatory_ntwrk on network.%I for select to network_observatory using (app_id = %L)', t, 'ntwrk');
      execute format('grant select on network.%I to network_observatory', t);
    end if;

    for a in select id from platform.apps order by id loop
      if exists (select 1 from pg_roles where rolname = 'network_observatory_' || a) then
        execute format('drop policy if exists %I on network.%I', 'observatory_app_' || a, t);
        execute format('create policy %I on network.%I for select to %I using (app_id = %L)',
                       'observatory_app_' || a, t, 'network_observatory_' || a, a);
        execute format('grant select on network.%I to %I', t, 'network_observatory_' || a);
      end if;
    end loop;
  end loop;
end $$;
