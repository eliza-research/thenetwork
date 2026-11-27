-- 0098: five launch cities, public red-line venue catalog & external API cache,
-- venue visits/rejections/concurrent holds, meetup arrival state, per-city dual
-- matchmaker personas, sanctioned external events & RSVPs, privacy-minimized
-- external dating prospect cache & suppression tombstones, dual-side external
-- sourcing tickets, and cross-app peon firewall RLS.
--
-- Idempotent (if not exists / on conflict / drop policy if exists): safe to run more than once.

-- ---------------------------------------------------------------- 1. Five launch cities
insert into platform.cities (id, name, tz) values
  ('sf',      'San Francisco', 'America/Los_Angeles'),
  ('nyc',     'New York City', 'America/New_York'),
  ('la',      'Los Angeles',   'America/Los_Angeles'),
  ('chicago', 'Chicago',       'America/Chicago'),
  ('miami',   'Miami',         'America/New_York')
on conflict (id) do nothing;

-- ---------------------------------------------------------------- 2. Public venue catalog (with red-line & teen all_ages capabilities)
create table if not exists platform.venues (
  id                     text primary key,
  city                   text not null references platform.cities (id),
  neighborhood           text not null,
  name                   text not null,
  address                text not null default '',
  lat                    double precision not null,
  lon                    double precision not null,
  is_public              boolean not null default true check (is_public = true),
  all_ages               boolean not null default true,
  category               text not null,
  price_tier             smallint not null check (price_tier between 0 and 4),
  age_min                smallint not null default 18 check (age_min >= 0),
  is_bar_only            boolean not null default false,
  is_alcohol_centric     boolean not null default false,
  alcohol_optional       boolean not null default true,
  serves_vegetarian      boolean not null default true,
  serves_vegan           boolean not null default false,
  halal_friendly         boolean not null default false,
  kosher_friendly        boolean not null default false,
  gluten_free_friendly   boolean not null default false,
  severe_allergen_safe   boolean not null default false,
  wheelchair_accessible  boolean not null default true,
  is_smoke_free          boolean not null default true,
  separate_checks        boolean not null default true,
  walk_in_group_capacity smallint not null default 6 check (walk_in_group_capacity >= 1),
  reservation_required   boolean not null default false,
  open_event_eligible    boolean not null default false,
  noise_level            text not null default 'conversational'
                         check (noise_level in ('quiet', 'conversational', 'lively', 'loud')),
  live_music_at_night    boolean not null default false,
  indoor                 boolean not null default true,
  outdoor                boolean not null default false,
  weather_sensitive      boolean not null default false,
  safety_score           smallint not null default 8 check (safety_score between 0 and 10),
  transit_score          smallint not null default 4 check (transit_score between 0 and 5),
  arrival_landmark       text not null default '',
  hours                  jsonb not null default '[]'::jsonb,
  hobbies                jsonb not null default '[]'::jsonb,
  cuisine_tags           jsonb not null default '[]'::jsonb,
  group_score            smallint not null default 70,
  date_score             smallint not null default 70,
  source                 text not null default 'curated',
  yelp_id                text,
  yelp_rating            double precision,
  yelp_review_count      integer,
  google_place_id        text,
  status                 text not null default 'active'
                         check (status in ('active', 'suspect_closed', 'closed_temporary', 'closed_permanent')),
  closure_reports        integer not null default 0 check (closure_reports >= 0),
  verified_open_at       timestamptz,
  geo_expires_at         timestamptz,
  recheck_after          timestamptz,
  persona_priors         jsonb not null default '{}'::jsonb,
  persona_stats          jsonb not null default '{}'::jsonb,
  overall_likes          integer not null default 0 check (overall_likes >= 0),
  overall_dislikes       integer not null default 0 check (overall_dislikes >= 0),
  visit_count            integer not null default 0 check (visit_count >= 0),
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

-- ---------------------------------------------------------------- 3. External venue API cache
create table if not exists platform.venue_api_cache (
  cache_key    text primary key,
  provider     text not null,
  city         text not null references platform.cities (id),
  payload      jsonb not null,
  result_count integer not null default 0 check (result_count >= 0),
  fetched_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);

create index if not exists venue_api_cache_provider_city_expires
  on platform.venue_api_cache (provider, city, expires_at);

-- ---------------------------------------------------------------- 4. App-scoped venue visits, rejections, arrivals, concurrent holds
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

create table if not exists network.venue_concurrent_holds (
  id             text primary key,
  app_id         text not null default network.current_app_id() references platform.apps (id),
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

create index if not exists venue_concurrent_holds_venue_window
  on network.venue_concurrent_holds (venue_id, window_start, window_end)
  where status = 'active';
create index if not exists venue_concurrent_holds_app_opp
  on network.venue_concurrent_holds (app_id, opportunity_id)
  where opportunity_id is not null;

-- ---------------------------------------------------------------- 5. Per-city dual matchmaker personas (10 launch personas)
create table if not exists platform.matchmaker_personas (
  id                      text primary key,
  city                    text not null references platform.cities (id),
  gender                  text not null check (gender in ('female', 'male')),
  first_name              text not null,
  tz                      text not null,
  hubs                    jsonb not null default '[]'::jsonb,
  verticals               jsonb not null default '["slop","friends"]'::jsonb,
  human_operated          boolean not null default true check (human_operated = true),
  bio_disclosure          text not null,
  status                  text not null default 'active'
                          check (status in ('active', 'throttled', 'degraded', 'suspended')),
  daily_outbound_cap      integer not null default 10 check (daily_outbound_cap > 0),
  daily_outbound_count    integer not null default 0 check (daily_outbound_count >= 0),
  rolling_chats_count     integer not null default 0 check (rolling_chats_count >= 0),
  rolling_unmatches_count integer not null default 0 check (rolling_unmatches_count >= 0),
  kill_switch_reason      text,
  kill_switch_at          timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (city, gender)
);

create index if not exists matchmaker_personas_city_status
  on platform.matchmaker_personas (city, status);

insert into platform.matchmaker_personas
  (id, city, gender, first_name, tz, hubs, verticals, human_operated, bio_disclosure, status, daily_outbound_cap)
values
  ('sf-f',  'sf',      'female', 'Maya',   'America/Los_Angeles', '["Hayes Valley","Mission","SoMa","North Beach"]'::jsonb,             '["slop","friends"]'::jsonb, true, 'Local matchmaker & small-group host in SF (not dating here myself — setting up real offline intros).',      'active', 10),
  ('sf-m',  'sf',      'male',   'Devon',  'America/Los_Angeles', '["Hayes Valley","Mission","SoMa","North Beach"]'::jsonb,             '["slop","friends"]'::jsonb, true, 'Local matchmaker & small-group host in SF (not dating here myself — setting up real offline intros).',      'active', 10),
  ('nyc-f', 'nyc',     'female', 'Clara',  'America/New_York',    '["Flatiron","West Village","East Village","Williamsburg"]'::jsonb,   '["slop","friends"]'::jsonb, true, 'Local matchmaker & small-group host in NYC (not dating here myself — setting up real offline intros).',     'active', 10),
  ('nyc-m', 'nyc',     'male',   'Julian', 'America/New_York',    '["Flatiron","West Village","East Village","Williamsburg"]'::jsonb,   '["slop","friends"]'::jsonb, true, 'Local matchmaker & small-group host in NYC (not dating here myself — setting up real offline intros).',     'active', 10),
  ('la-f',  'la',      'female', 'Elena',  'America/Los_Angeles', '["Arts District","Culver City","Silver Lake","West Hollywood"]'::jsonb, '["slop","friends"]'::jsonb, true, 'Local matchmaker & small-group host in LA (not dating here myself — setting up real offline intros).',   'active', 10),
  ('la-m',  'la',      'male',   'Marcus', 'America/Los_Angeles', '["Arts District","Culver City","Silver Lake","West Hollywood"]'::jsonb, '["slop","friends"]'::jsonb, true, 'Local matchmaker & small-group host in LA (not dating here myself — setting up real offline intros).',   'active', 10),
  ('chi-f', 'chicago', 'female', 'Nora',   'America/Chicago',     '["West Loop","Fulton Market","Loop","Wicker Park"]'::jsonb,          '["slop","friends"]'::jsonb, true, 'Local matchmaker & small-group host in Chicago (not dating here myself — setting up real offline intros).', 'active', 10),
  ('chi-m', 'chicago', 'male',   'Sam',    'America/Chicago',     '["West Loop","Fulton Market","Loop","Wicker Park"]'::jsonb,          '["slop","friends"]'::jsonb, true, 'Local matchmaker & small-group host in Chicago (not dating here myself — setting up real offline intros).', 'active', 10),
  ('mia-f', 'miami',   'female', 'Sofia',  'America/New_York',    '["Brickell","Wynwood","Coral Gables"]'::jsonb,                       '["slop","friends"]'::jsonb, true, 'Local matchmaker & small-group host in Miami (not dating here myself — setting up real offline intros).',   'active', 10),
  ('mia-m', 'miami',   'male',   'Mateo',  'America/New_York',    '["Brickell","Wynwood","Coral Gables"]'::jsonb,                       '["slop","friends"]'::jsonb, true, 'Local matchmaker & small-group host in Miami (not dating here myself — setting up real offline intros).',   'active', 10)
on conflict (id) do nothing;

-- ---------------------------------------------------------------- 6. External events (sanctioned sources only)
create table if not exists platform.external_events (
  id                        text primary key,
  city                      text not null references platform.cities (id),
  app_id                    text not null default 'friends' references platform.apps (id),
  source                    text not null check (source in ('host_native', 'official_api', 'member_submitted_public')),
  platform                  text not null check (platform in ('luma', 'meetup', 'partiful', 'internal')),
  external_event_id         text,
  external_url              text,
  title                     text not null,
  interest                  text not null default '',
  description               text not null default '',
  venue_id                  text not null references platform.venues (id),
  backup_venue_id           text references platform.venues (id),
  is_public                 boolean not null default true check (is_public = true),
  start_at                  timestamptz not null,
  end_at                    timestamptz not null,
  anchor_member_id          text,
  confirmed_network_anchors integer not null default 0 check (confirmed_network_anchors >= 0),
  confirmed_network_total   integer not null default 0 check (confirmed_network_total >= 0),
  approved_external_cap     integer not null default 0 check (approved_external_cap >= 0 and approved_external_cap <= 15),
  hide_guest_list           boolean not null default true check (hide_guest_list = true),
  approval_required         boolean not null default true check (approval_required = true),
  external_crowd_disclosed  boolean not null default false,
  human_review_approved     boolean not null default false,
  review_item_id            text,
  status                    text not null default 'draft'
                            check (status in ('draft', 'pending_review', 'published', 'active', 'completed', 'cancelled_no_anchor', 'cancelled_low_quorum', 'cancelled')),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (end_at > start_at)
);

create index if not exists external_events_city_status_start
  on platform.external_events (city, status, start_at);
create index if not exists external_events_platform_ext_id
  on platform.external_events (platform, external_event_id)
  where external_event_id is not null;

-- ---------------------------------------------------------------- 7. External event RSVPs (18+ adult only, max 1 invite)
create table if not exists platform.external_event_rsvps (
  id                text primary key,
  event_id          text not null references platform.external_events (id) on delete cascade,
  platform          text not null check (platform in ('luma', 'meetup', 'partiful', 'internal')),
  guest_external_id text not null,
  first_name        text not null default '',
  stated_age        integer not null check (stated_age >= 18 and stated_age <= 120),
  screening_answer  text not null default '',
  status            text not null default 'pending_approval'
                    check (status in ('pending_approval', 'approved', 'waitlist', 'declined', 'attended', 'no_show', 'cancelled')),
  network_vouched   boolean not null default false,
  safety_flag       boolean not null default false,
  invite_attempts   integer not null default 0 check (invite_attempts >= 0 and invite_attempts <= 1),
  invited_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (event_id, guest_external_id)
);

create index if not exists external_event_rsvps_event_status
  on platform.external_event_rsvps (event_id, status);

-- ---------------------------------------------------------------- 8. External prospects (minimized privacy cache; singlePersonaPerProspect)
create table if not exists platform.external_prospects (
  id                  text primary key,
  city                text not null references platform.cities (id),
  source_platform     text not null
                      check (source_platform in ('hinge', 'bumble', 'tinder', 'datemedoc', 'luma', 'partiful', 'referral')),
  assigned_persona_id text not null references platform.matchmaker_personas (id),
  dedupe_hash         text not null,
  phone_hash          text,
  first_name          text not null default '',
  stated_age          integer not null check (stated_age >= 18 and stated_age <= 120),
  gender              text not null default 'unknown'
                      check (gender in ('woman', 'man', 'nonbinary', 'unknown')),
  seeks               jsonb not null default '[]'::jsonb,
  neighborhood        text not null default '',
  facets              jsonb not null default '{}'::jsonb,
  consent_state       text not null default 'none'
                      check (consent_state in ('none', 'intro_single_only', 'intro_future_optin', 'sms_logistics_optin', 'declined', 'stopped', 'banned')),
  recontact_count     integer not null default 0 check (recontact_count >= 0 and recontact_count <= 2),
  invite_attempts     integer not null default 0 check (invite_attempts >= 0 and invite_attempts <= 1),
  expires_at          timestamptz not null,
  converted_member_id text,
  held                boolean not null default false,
  red_flagged         boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (city, dedupe_hash)
);

create index if not exists external_prospects_city_consent_expires
  on platform.external_prospects (city, consent_state, expires_at);
create index if not exists external_prospects_phone_hash
  on platform.external_prospects (phone_hash)
  where phone_hash is not null;

-- ---------------------------------------------------------------- 9. Suppression tombstones (keyed HMAC hashes surviving PII purge)
create table if not exists platform.external_prospect_suppressions (
  city           text not null references platform.cities (id),
  dedupe_hash    text not null,
  phone_hash     text,
  reason         text not null
                 check (reason in ('stopped', 'declined', 'blocked', 'deletion_requested', 'underage', 'red_flag', 'expired', 'no_show')),
  suppress_until timestamptz,
  permanent      boolean not null default true,
  created_at     timestamptz not null default now(),
  primary key (city, dedupe_hash)
);

create index if not exists external_prospect_suppressions_phone_hash
  on platform.external_prospect_suppressions (phone_hash)
  where phone_hash is not null;

-- ---------------------------------------------------------------- 10. Dual-side external sourcing tickets
create table if not exists platform.external_sourcing_tickets (
  id                    text primary key,
  city                  text not null references platform.cities (id),
  app_id                text not null default 'slop' references platform.apps (id)
                        check (app_id in ('slop', 'friends')),
  member_id             text not null,
  prospect_id           text references platform.external_prospects (id) on delete set null,
  prospect_dedupe_hash  text,
  assigned_persona_id   text not null references platform.matchmaker_personas (id),
  review_item_id        text,
  booked_opportunity_id text,
  state                 text not null default 'member_sparse'
                        check (state in (
                          'member_sparse', 'brief_review', 'scouting', 'prospect_qualifying',
                          'prospect_soft_yes', 'pair_review_desk', 'member_probed', 'member_yes',
                          'prospect_sms_optin', 'venue_verified_booked', 'pre_brief', 'active_arrival',
                          'completed', 'member_followup', 'quality_gate', 'warm_invite', 'closed'
                        )),
  off_app_sms_opted_in  boolean not null default false,
  venue_id              text references platform.venues (id),
  closed_reason         text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists external_sourcing_tickets_member_state
  on platform.external_sourcing_tickets (app_id, member_id, state);
create index if not exists external_sourcing_tickets_persona_state
  on platform.external_sourcing_tickets (assigned_persona_id, state);

-- ---------------------------------------------------------------- 11. Role grants & Row-Level Security
revoke all on
  platform.venues,
  platform.venue_api_cache,
  platform.matchmaker_personas,
  platform.external_events,
  platform.external_event_rsvps,
  platform.external_prospects,
  platform.external_prospect_suppressions,
  platform.external_sourcing_tickets
from public;

grant select, insert, update, delete on
  platform.venues,
  platform.venue_api_cache,
  platform.matchmaker_personas,
  platform.external_events,
  platform.external_event_rsvps,
  platform.external_prospects,
  platform.external_prospect_suppressions,
  platform.external_sourcing_tickets
to platform_service;

revoke truncate on
  platform.venues,
  platform.venue_api_cache,
  platform.matchmaker_personas,
  platform.external_events,
  platform.external_event_rsvps,
  platform.external_prospects,
  platform.external_prospect_suppressions,
  platform.external_sourcing_tickets
from platform_service;

grant select, insert, update, delete on
  platform.venues,
  platform.venue_api_cache,
  platform.matchmaker_personas,
  platform.external_events,
  platform.external_event_rsvps,
  platform.external_prospects,
  platform.external_prospect_suppressions,
  platform.external_sourcing_tickets
to network_service;

-- crossAppScoreFirewall RLS: deny ALL access to external dating prospect tables whenever
-- `app.current_app` or `app.app_id` (used by `network.current_app_id()`) is `'peon'`.
-- Never grant `network_observatory_peon` access to these tables.
do $$
declare
  t text;
begin
  foreach t in array array['external_prospects', 'external_sourcing_tickets', 'external_prospect_suppressions'] loop
    execute format('alter table platform.%I enable row level security', t);
    execute format('alter table platform.%I force row level security', t);

    execute format('drop policy if exists cross_app_score_firewall on platform.%I', t);
    execute format(
      'create policy cross_app_score_firewall on platform.%I for all to platform_service, network_service
       using (
         coalesce(current_setting(''app.current_app'', true), '''') <> ''peon''
         and coalesce(current_setting(''app.app_id'', true), '''') <> ''peon''
       )
       with check (
         coalesce(current_setting(''app.current_app'', true), '''') <> ''peon''
         and coalesce(current_setting(''app.app_id'', true), '''') <> ''peon''
       )',
      t
    );
  end loop;
end $$;

-- Standard app-scoped RLS for network.* tables.
do $$
declare
  t text;
  a text;
begin
  foreach t in array array['venue_visits', 'venue_rejections', 'meetup_arrivals', 'venue_concurrent_holds'] loop
    execute format('revoke all on network.%I from public', t);
    execute format('alter table network.%I enable row level security', t);
    execute format('alter table network.%I force row level security', t);

    execute format('drop policy if exists service_app on network.%I', t);
    execute format(
      'create policy service_app on network.%I for all to network_service
       using (app_id = current_setting(''app.app_id'', true))
       with check (app_id = current_setting(''app.app_id'', true))',
      t
    );
    execute format('grant select, insert, update, delete on network.%I to network_service', t);

    if exists (select 1 from pg_roles where rolname = 'network_observatory') then
      execute format('drop policy if exists observatory_ntwrk on network.%I', t);
      execute format('create policy observatory_ntwrk on network.%I for select to network_observatory using (app_id = %L)', t, 'ntwrk');
      execute format('grant select on network.%I to network_observatory', t);
    end if;

    foreach a in array array['ntwrk', 'slop', 'peon', 'friends'] loop
      if exists (select 1 from pg_roles where rolname = 'network_observatory_' || a) then
        execute format('drop policy if exists %I on network.%I', 'observatory_app_' || a, t);
        execute format(
          'create policy %I on network.%I for select to %I using (app_id = %L)',
          'observatory_app_' || a,
          t,
          'network_observatory_' || a,
          a
        );
        execute format('grant select on network.%I to %I', t, 'network_observatory_' || a);
      end if;
    end loop;
  end loop;
end $$;
