-- 0102: trajectory storage manifests & crypto-shredding DEKs, first-party analytics tables,
-- privacy-safe signup attribution, and high-impact composite indexes on network tables.
-- Idempotent and additive: safe to run on both fresh and upgraded databases.

create schema if not exists analytics;

-- 1. Per-person wrapped AES-256-GCM DEKs for O(1) GDPR Article 17 crypto-shredding.
-- Console roles NEVER receive select access on this table.
create table if not exists analytics.trajectory_deks (
  person_id    uuid primary key,
  key_version  int not null default 1 check (key_version >= 1),
  wrapped_dek  bytea not null,
  expires_at   timestamptz,
  created_at   timestamptz not null default now()
);

-- 2. Compact trace-level manifest pointing to NDJSON.zst / Parquet chunks in R2 (or local dev store).
create table if not exists analytics.trajectory_manifests (
  trace_id       text not null,
  app_id         text not null check (app_id in ('ntwrk', 'slop', 'peon', 'friends', 'marketing', 'shared')),
  city           text,
  kind           text not null check (kind in ('turn', 'llm', 'match_run', 'review_judge', 'outreach', 'funnel', 'safety', 'sim_record')),
  entity_type    text check (entity_type is null or entity_type in ('member', 'opportunity', 'campaign', 'human', 'run')),
  entity_id      text,
  person_id      uuid,
  status         text not null check (status in ('ok', 'error', 'flagged', 'leak_blocked', 'fallback', 'budget_blocked')),
  model          text,
  span_count     int not null default 1 check (span_count >= 1),
  input_tokens   int not null default 0 check (input_tokens >= 0),
  output_tokens  int not null default 0 check (output_tokens >= 0),
  cost_micros    bigint not null default 0 check (cost_micros >= 0),
  duration_ms    int not null default 0 check (duration_ms >= 0),
  flags          text[] not null default '{}',
  storage_driver text not null check (storage_driver in ('r2', 'local', 'memory')),
  object_key     text not null,
  byte_offset    bigint not null default 0 check (byte_offset >= 0),
  byte_length    int not null default 0 check (byte_length >= 0),
  started_at     timestamptz not null,
  primary key (app_id, trace_id, object_key)
);
create index if not exists trajectory_manifests_app_started_idx
  on analytics.trajectory_manifests (app_id, started_at desc, trace_id);
create index if not exists trajectory_manifests_entity_idx
  on analytics.trajectory_manifests (app_id, entity_type, entity_id, started_at desc)
  where entity_id is not null;
create index if not exists trajectory_manifests_kind_status_idx
  on analytics.trajectory_manifests (app_id, kind, status, started_at desc);
create index if not exists trajectory_manifests_person_idx
  on analytics.trajectory_manifests (person_id)
  where person_id is not null;
create index if not exists trajectory_manifests_flags_gin
  on analytics.trajectory_manifests using gin (flags)
  where array_length(flags, 1) > 0;

-- 3. First-party privacy-safe site visit, shortlink click, and CTA telemetry (zero PII, zero raw IP).
create table if not exists analytics.site_events (
  id                bigserial primary key,
  app_id            text not null check (app_id in ('ntwrk', 'slop', 'peon', 'friends')),
  city_bucket       text not null default 'unknown',
  event_type        text not null check (event_type in ('site_visit', 'link_click', 'qr_scan', 'cta_copy_prompt', 'cta_open_sms', 'cta_open_join', 'oauth_start', 'join_underage_declined')),
  path              text not null,
  referrer_domain   text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  qr_code           text,
  mc_code           text,
  desire_lane       text,
  device_class      text not null default 'unknown' check (device_class in ('mobile_ios', 'mobile_android', 'desktop', 'bot', 'unknown')),
  visit_bucket_hash text,
  occurred_at       timestamptz not null default now()
);
create index if not exists site_events_app_time_idx
  on analytics.site_events (app_id, occurred_at desc);
create index if not exists site_events_campaign_time_idx
  on analytics.site_events (app_id, utm_campaign, occurred_at desc)
  where utm_campaign is not null;
create index if not exists site_events_qr_time_idx
  on analytics.site_events (qr_code, occurred_at desc)
  where qr_code is not null;

-- 4. Pre-aggregated daily funnel rollups for sub-50ms dashboard cards and slice-and-dice.
create table if not exists analytics.funnel_daily (
  day            date not null,
  app_id         text not null check (app_id in ('ntwrk', 'slop', 'peon', 'friends')),
  city           text not null default 'unknown',
  desire_lane    text not null default 'unknown',
  channel        text not null default 'direct',
  campaign_id    text not null default 'organic',
  age_band       text not null default 'unknown' check (age_band in ('18+', '13-17', 'unknown')),
  stage          text not null check (stage in ('outreach_sent', 'link_click', 'site_visit', 'cta_triggered', 'signup_verified', 'onboarding_completed', 'first_proposal', 'first_irl_meeting', 'retained_d30')),
  event_count    int not null default 0 check (event_count >= 0),
  unique_actors  int not null default 0 check (unique_actors >= 0),
  median_ttfv_ms bigint,
  updated_at     timestamptz not null default now(),
  primary key (day, app_id, city, desire_lane, channel, campaign_id, age_band, stage)
);
create index if not exists funnel_daily_app_day_idx
  on analytics.funnel_daily (app_id, day desc, stage);

-- 5. Pre-aggregated 7x24 hourly outreach performance rollups for heatmap and template lift.
create table if not exists analytics.outreach_hourly (
  day              date not null,
  local_dow        smallint not null check (local_dow between 0 and 6),
  local_hour       smallint not null check (local_hour between 0 and 23),
  app_id           text not null check (app_id in ('ntwrk', 'slop', 'peon', 'friends', 'all')),
  city             text not null default 'nyc',
  channel          text not null,
  campaign_id      text not null default 'default',
  persona_id       text not null default 'system',
  template_id      text not null default 'default',
  desire_lane      text not null default 'unknown',
  sent             int not null default 0 check (sent >= 0),
  delivered        int not null default 0 check (delivered >= 0),
  clicked          int not null default 0 check (clicked >= 0),
  replied          int not null default 0 check (replied >= 0),
  converted        int not null default 0 check (converted >= 0),
  stopped          int not null default 0 check (stopped >= 0),
  bounced          int not null default 0 check (bounced >= 0),
  rate_limited_429 int not null default 0 check (rate_limited_429 >= 0),
  updated_at       timestamptz not null default now(),
  primary key (day, local_dow, local_hour, app_id, city, channel, campaign_id, persona_id, template_id, desire_lane)
);
create index if not exists outreach_hourly_app_day_idx
  on analytics.outreach_hourly (app_id, day desc, local_dow, local_hour);

-- 6. App-scoped signup attribution (zero PII; adult verification flag explicitly enforced).
create table if not exists platform.signup_attribution (
  app_id            text not null references platform.apps (id),
  member_id         text not null,
  person_id         uuid references platform.people (id) on delete set null,
  is_adult_verified boolean not null default false,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  qr_code           text,
  mc_code           text,
  desire_lane       text,
  entry_surface     text not null default 'web' check (entry_surface in ('web', 'agent_skill', 'sms', 'mcp_oauth', 'referral', 'unknown')),
  landing_path      text,
  attributed_at     timestamptz not null default now(),
  primary key (app_id, member_id)
);
create index if not exists signup_attribution_person_idx
  on platform.signup_attribution (person_id)
  where person_id is not null;
create index if not exists signup_attribution_campaign_idx
  on platform.signup_attribution (app_id, utm_campaign, attributed_at desc)
  where utm_campaign is not null;
create index if not exists signup_attribution_qr_idx
  on platform.signup_attribution (qr_code, attributed_at desc)
  where qr_code is not null;

-- 7. Missing high-impact composite indexes on existing network tables.
create index if not exists messages_app_opp_member_idx
  on network.messages (app_id, opportunity_id, member_id)
  where opportunity_id is not null;
create index if not exists events_app_type_at_id_idx
  on network.events (app_id, type, at desc, id desc);
create index if not exists participations_app_opp_role_status_idx
  on network.participations (app_id, opportunity_id, role, status);

-- 8. Least-privilege grants and row-level security.
revoke all on schema analytics from public;
revoke all on all tables in schema analytics from public;
revoke all on platform.signup_attribution from public;

do $$
declare
  a text;
  role_name text;
begin
  if exists (select 1 from pg_roles where rolname = 'network_service') then
    grant usage on schema analytics to network_service;
    grant select, insert, update, delete on analytics.trajectory_deks, analytics.trajectory_manifests, analytics.site_events, analytics.funnel_daily, analytics.outreach_hourly to network_service;
    grant usage on all sequences in schema analytics to network_service;
    grant select, insert, update, delete on platform.signup_attribution to network_service;
  end if;

  if exists (select 1 from pg_roles where rolname = 'platform_service') then
    grant usage on schema analytics to platform_service;
    grant select, insert, update, delete on analytics.trajectory_deks, analytics.trajectory_manifests, analytics.site_events, analytics.funnel_daily, analytics.outreach_hourly to platform_service;
    grant usage on all sequences in schema analytics to platform_service;
    grant select, insert, update, delete on platform.signup_attribution to platform_service;
  end if;

  alter table analytics.trajectory_manifests enable row level security;
  alter table analytics.trajectory_manifests force row level security;
  alter table analytics.site_events enable row level security;
  alter table analytics.site_events force row level security;
  alter table analytics.funnel_daily enable row level security;
  alter table analytics.funnel_daily force row level security;
  alter table analytics.outreach_hourly enable row level security;
  alter table analytics.outreach_hourly force row level security;

  if exists (select 1 from pg_roles where rolname = 'network_service') then
    drop policy if exists service_all on analytics.trajectory_manifests;
    create policy service_all on analytics.trajectory_manifests for all to network_service using (true) with check (true);
    drop policy if exists service_all on analytics.site_events;
    create policy service_all on analytics.site_events for all to network_service using (true) with check (true);
    drop policy if exists service_all on analytics.funnel_daily;
    create policy service_all on analytics.funnel_daily for all to network_service using (true) with check (true);
    drop policy if exists service_all on analytics.outreach_hourly;
    create policy service_all on analytics.outreach_hourly for all to network_service using (true) with check (true);
  end if;

  if exists (select 1 from pg_roles where rolname = 'platform_service') then
    drop policy if exists platform_all on analytics.trajectory_manifests;
    create policy platform_all on analytics.trajectory_manifests for all to platform_service using (true) with check (true);
    drop policy if exists platform_all on analytics.site_events;
    create policy platform_all on analytics.site_events for all to platform_service using (true) with check (true);
    drop policy if exists platform_all on analytics.funnel_daily;
    create policy platform_all on analytics.funnel_daily for all to platform_service using (true) with check (true);
    drop policy if exists platform_all on analytics.outreach_hourly;
    create policy platform_all on analytics.outreach_hourly for all to platform_service using (true) with check (true);
  end if;

  for a in select id from platform.apps order by id loop
    role_name := 'network_observatory_' || a;
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant usage on schema analytics to %I', role_name);
      execute format('grant select on analytics.trajectory_manifests, analytics.site_events, analytics.funnel_daily, analytics.outreach_hourly to %I', role_name);
      execute format('drop policy if exists %I on analytics.trajectory_manifests', 'console_' || a);
      execute format('create policy %I on analytics.trajectory_manifests for select to %I using (app_id in (%L, ''shared''))', 'console_' || a, role_name, a);
      execute format('drop policy if exists %I on analytics.site_events', 'console_' || a);
      execute format('create policy %I on analytics.site_events for select to %I using (app_id = %L)', 'console_' || a, role_name, a);
      execute format('drop policy if exists %I on analytics.funnel_daily', 'console_' || a);
      execute format('create policy %I on analytics.funnel_daily for select to %I using (app_id = %L)', 'console_' || a, role_name, a);
      execute format('drop policy if exists %I on analytics.outreach_hourly', 'console_' || a);
      execute format('create policy %I on analytics.outreach_hourly for select to %I using (app_id in (%L, ''all''))', 'console_' || a, role_name, a);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'network_observatory') then
    grant usage on schema analytics to network_observatory;
    grant select on analytics.trajectory_manifests, analytics.site_events, analytics.funnel_daily, analytics.outreach_hourly to network_observatory;
    drop policy if exists console_shared_login on analytics.trajectory_manifests;
    create policy console_shared_login on analytics.trajectory_manifests for select to network_observatory using (app_id in ('ntwrk', 'shared'));
    drop policy if exists console_shared_login on analytics.site_events;
    create policy console_shared_login on analytics.site_events for select to network_observatory using (app_id = 'ntwrk');
    drop policy if exists console_shared_login on analytics.funnel_daily;
    create policy console_shared_login on analytics.funnel_daily for select to network_observatory using (app_id = 'ntwrk');
    drop policy if exists console_shared_login on analytics.outreach_hourly;
    create policy console_shared_login on analytics.outreach_hourly for select to network_observatory using (app_id in ('ntwrk', 'all'));
  end if;

  if exists (select 1 from pg_roles where rolname = 'network_observatory_cross_app') then
    grant usage on schema analytics to network_observatory_cross_app;
    grant select on analytics.site_events, analytics.funnel_daily, analytics.outreach_hourly to network_observatory_cross_app;
    drop policy if exists console_cross_app on analytics.site_events;
    create policy console_cross_app on analytics.site_events for select to network_observatory_cross_app using (true);
    drop policy if exists console_cross_app on analytics.funnel_daily;
    create policy console_cross_app on analytics.funnel_daily for select to network_observatory_cross_app using (true);
    drop policy if exists console_cross_app on analytics.outreach_hourly;
    create policy console_cross_app on analytics.outreach_hourly for select to network_observatory_cross_app using (true);
  end if;
end $$;
