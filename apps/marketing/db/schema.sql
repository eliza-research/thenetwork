-- Autonomous marketing orchestration schema (apps/marketing).
-- Applied by packages/db/migrate.ts as repeatable 9004_marketing_schema (idempotent),
-- after roles exist, so the deployed service login never needs CREATE rights.
-- Hard walls:
--   1. Isolated from platform.*, network.*, and packages/capital (zero cash/capital crossover).
--   2. Paid external workers/creators/interviewees must be 18+ (inv_adult_only_paid).
--   3. Proof verification required before Tier 4 payout (inv_proof_required_before_payout).
--   4. slop.cash hooks stay disabled_stub by default (inv_slop_cash_disabled).

create schema if not exists marketing;

-- 1. Campaigns (NYC-first $10,000 cap, multi-city ready)
create table if not exists marketing.campaigns (
  id                   text primary key default gen_random_uuid()::text,
  slug                 text not null unique check (length(btrim(slug)) > 0),
  name                 text not null check (length(btrim(name)) > 0),
  city                 text not null default 'nyc',
  app_id               text not null check (app_id in ('slop', 'peon', 'friends', 'ntwrk', 'all')),
  tier                 smallint not null default 1 check (tier in (1, 2, 3, 4)),
  risk_zone            text not null default 'zone_2_amber'
                       check (risk_zone in ('zone_1_green', 'zone_2_amber', 'zone_3_red')),
  risk_dial            text not null default 'conservative'
                       check (risk_dial in ('normal', 'conservative', 'balanced', 'blitz', 'lockdown')),
  monthly_budget_cents integer not null default 1000000 check (monthly_budget_cents >= 0),
  daily_cap_cents      integer not null default 100000 check (daily_cap_cents >= 0),
  max_task_cents       integer not null default 150000 check (max_task_cents >= 0),
  reserved_cents       integer not null default 0 check (reserved_cents >= 0),
  spent_cents          integer not null default 0 check (spent_cents >= 0),
  daily_spent_cents    integer not null default 0 check (daily_spent_cents >= 0),
  billing_armed        boolean not null default false,
  slop_cash_enabled    boolean not null default false,
  status               text not null default 'active'
                       check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint chk_campaigns_budget_cap check (reserved_cents + spent_cents <= monthly_budget_cents)
);
create index if not exists marketing_campaigns_city_status_idx
  on marketing.campaigns (city, status);

-- 2. Subscription-connected branded agents (Chadwick, Sloane, Peon, Venn, The Operator)
create table if not exists marketing.agents (
  id                   text primary key default gen_random_uuid()::text,
  persona_id           text not null unique
                       check (persona_id in ('chadwick', 'sloane', 'peon', 'venn', 'operator', 'eliza')),
  display_name         text not null check (length(btrim(display_name)) > 0),
  app_id               text not null check (app_id in ('slop', 'peon', 'friends', 'ntwrk', 'all')),
  provider             text not null check (provider in ('chatgpt', 'claude', 'gemini', 'surplus')),
  failover_provider    text check (failover_provider is null or failover_provider in ('chatgpt', 'claude', 'gemini', 'surplus')),
  auth_mode            text not null default 'cli'
                       check (auth_mode in ('cli', 'mcp', 'oauth', 'browser', 'api', 'api_key')),
  session_ref          text not null default '',
  session_healthy      boolean not null default true,
  daily_turn_cap       integer not null default 60 check (daily_turn_cap >= 0),
  turns_used_today     integer not null default 0 check (turns_used_today >= 0),
  cooldown_until       timestamptz,
  status               text not null default 'idle'
                       check (status in ('idle', 'running', 'cooldown', 'rate_limited', 'paused_stop')),
  config               jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists marketing_agents_provider_status_idx
  on marketing.agents (provider, status);

-- 3. Tier 2 local hardware slots (1x MacBook host + 1x Dedicated Android + 1x Dedicated iPhone)
create table if not exists marketing.devices (
  id                   text primary key default gen_random_uuid()::text,
  label                text not null unique check (length(btrim(label)) > 0),
  platform             text not null check (platform in ('macbook', 'android', 'ios')),
  host_machine         text not null default 'local-macbook',
  serial_or_udid       text not null unique check (length(btrim(serial_or_udid)) > 0),
  assigned_persona     text check (assigned_persona is null or assigned_persona in ('chadwick', 'sloane', 'peon', 'venn', 'operator', 'eliza')),
  sim_carrier          text,
  wifi_disabled        boolean not null default true,
  battery_pct          smallint not null default 60 check (battery_pct between 0 and 100),
  temp_c               numeric(4, 1) not null default 30.0 check (temp_c >= -10.0 and temp_c <= 85.0),
  warmup_day           integer not null default 0 check (warmup_day >= 0),
  warmup_stage         text not null default 'birth_passive'
                       check (warmup_stage in ('birth_passive', 'light_organic', 'branded_cadence', 'steady_state')),
  daily_actions_used   integer not null default 0 check (daily_actions_used >= 0),
  daily_action_cap     integer not null default 0 check (daily_action_cap >= 0),
  lease_holder         text,
  lease_expires_at     timestamptz,
  status               text not null default 'online'
                       check (status in ('online', 'leased', 'charging_wait', 'thermal_cooldown', 'needs_takeover', 'offline')),
  last_seen_at         timestamptz not null default now(),
  created_at           timestamptz not null default now()
);
create index if not exists marketing_devices_platform_status_idx
  on marketing.devices (platform, status);

-- 4. Social, email, gig-platform, QR, and print channels/accounts owned by the marketing engine
create table if not exists marketing.channels_and_accounts (
  id                   text primary key default gen_random_uuid()::text,
  agent_id             text references marketing.agents (id) on delete set null,
  device_id            text references marketing.devices (id) on delete set null,
  app_id               text not null check (app_id in ('slop', 'peon', 'friends', 'ntwrk', 'all')),
  platform             text not null
                       check (platform in ('x', 'instagram', 'tiktok', 'youtube', 'reddit', 'email', 'craigslist', 'rentahuman', 'backstage', 'trusted_herd', 'collabstr', 'passionfroot', 'luma', 'eventbrite', 'dub', 'print', 'venue', 'sms_opted_in', 'other')),
  handle               text not null check (length(btrim(handle)) > 0),
  city                 text not null default 'nyc',
  auth_ref             text,
  warmup_day           integer not null default 0 check (warmup_day >= 0),
  daily_post_cap       integer not null default 5 check (daily_post_cap >= 0),
  posts_today          integer not null default 0 check (posts_today >= 0),
  status               text not null default 'active'
                       check (status in ('warming', 'active', 'cooldown', 'suspended', 'disabled', 'needs_takeover', 'retired')),
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (platform, handle)
);
create index if not exists marketing_channels_agent_idx
  on marketing.channels_and_accounts (agent_id, status);
create index if not exists marketing_channels_device_idx
  on marketing.channels_and_accounts (device_id) where device_id is not null;

-- 5. External humans, contacts, street workers, creators, agencies, printers, venues & global STOP fence
create table if not exists marketing.humans (
  id                   text primary key default gen_random_uuid()::text,
  contact_key          text not null unique check (length(btrim(contact_key)) > 0),
  display_name         text not null check (length(btrim(display_name)) > 0),
  role                 text not null
                       check (role in ('applicant', 'street_worker', 'event_activator', 'creator', 'agency', 'printer', 'venue', 'vip', 'community')),
  source_channel       text not null
                       check (source_channel in ('craigslist', 'rentahuman', 'backstage', 'trusted_herd', 'collabstr', 'passionfroot', 'agency_email', 'youtube', 'tiktok', 'instagram', 'x', 'reddit', 'luma', 'eventbrite', 'nyc_open_data', 'nys_sla', 'hn', 'github', 'arxiv', 'email', 'venue', 'sms_opted_in', 'referral', 'other')),
  city                 text not null default 'nyc',
  neighborhood         text,
  email                text,
  handle               text,
  profile_url          text,
  age_years            smallint check (age_years is null or (age_years >= 0 and age_years <= 120)),
  age_verified         boolean not null default false,
  contract_signed      boolean not null default false,
  contract_signed_at   timestamptz,
  payout_rail          text not null default 'none'
                       check (payout_rail in ('none', 'fiat_stripe', 'fiat_tremendous', 'usdc_direct', 'agency_invoice', 'platform_escrow', 'slop_cash')),
  payout_account_ref   text,
  screening_score      smallint check (screening_score is null or (screening_score between 0 and 100)),
  stopped              boolean not null default false,
  stop_reason          text,
  stopped_at           timestamptz,
  banned               boolean not null default false,
  ban_reason           text,
  daily_sends_today    integer not null default 0 check (daily_sends_today >= 0),
  last_contacted_at    timestamptz,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists marketing_humans_city_role_idx
  on marketing.humans (city, role);
create index if not exists marketing_humans_stopped_idx
  on marketing.humans (stopped) where stopped = true;
create index if not exists marketing_humans_banned_idx
  on marketing.humans (banned) where banned = true;

-- 6. Tasks (street fliering shifts, event activations, creator videos, agency bookings, print orders, OSS dev bounties)
create table if not exists marketing.tasks (
  id                   text primary key default gen_random_uuid()::text,
  campaign_id          text not null references marketing.campaigns (id) on delete cascade,
  agent_id             text references marketing.agents (id) on delete set null,
  human_id             text references marketing.humans (id) on delete set null,
  tier                 smallint not null check (tier in (1, 2, 3, 4)),
  task_kind            text not null
                       check (task_kind in ('street_fliering', 'event_activation', 'creator_video', 'agency_booking', 'print_order', 'digital_outreach', 'discovery', 'oss_dev_bounty')),
  app_id               text not null default 'all' check (app_id in ('slop', 'peon', 'friends', 'ntwrk', 'all')),
  city                 text not null default 'nyc',
  neighborhood         text,
  title                text not null check (length(btrim(title)) > 0),
  brief_text           text not null check (length(btrim(brief_text)) > 0),
  vendor_channel       text not null
                       check (vendor_channel in ('craigslist', 'rentahuman', 'backstage', 'trusted_herd', 'collabstr', 'passionfroot', 'agency_email', 'creator_direct', 'print_local', 'print_api', 'internal', 'slop_cash')),
  worker_age_years     smallint check (worker_age_years is null or (worker_age_years >= 0 and worker_age_years <= 120)),
  amount_cents         integer not null default 0 check (amount_cents >= 0),
  bonus_cap_cents      integer not null default 0 check (bonus_cap_cents >= 0),
  qr_batch_code        text unique,
  short_url            text,
  payout_rail          text not null default 'fiat_stripe'
                       check (payout_rail in ('none', 'fiat_stripe', 'fiat_tremendous', 'usdc_direct', 'agency_invoice', 'platform_escrow', 'slop_cash')),
  proof_verified       boolean not null default false,
  status               text not null default 'drafted'
                       check (status in ('drafted', 'posted_or_emailed', 'applicant_screened', 'contract_sent', 'hired', 'shift_active', 'proof_submitted', 'proof_verified', 'payout_queued', 'paid', 'disputed', 'cancelled')),
  scheduled_start_at   timestamptz,
  scheduled_end_at     timestamptz,
  paid_at              timestamptz,
  metadata             jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint chk_tasks_adult_when_hired check (
    tier < 4
    or status not in ('hired', 'shift_active', 'proof_submitted', 'proof_verified', 'payout_queued', 'paid')
    or (worker_age_years is not null and worker_age_years >= 18)
  ),
  constraint chk_tasks_adult_when_paid check (
    status <> 'paid'
    or (worker_age_years is not null and worker_age_years >= 18)
    or tier < 4
  ),
  constraint chk_tasks_proof_before_paid check (
    status <> 'paid'
    or tier < 4
    or proof_verified = true
  ),
  constraint chk_tasks_positive_paid_amount check (
    status <> 'paid'
    or amount_cents > 0
  ),
  constraint chk_tasks_slop_cash_oss_only check (
    payout_rail <> 'slop_cash'
    or task_kind = 'oss_dev_bounty'
  )
);
create index if not exists marketing_tasks_campaign_status_idx
  on marketing.tasks (campaign_id, status);
create index if not exists marketing_tasks_human_idx
  on marketing.tasks (human_id) where human_id is not null;
create index if not exists marketing_tasks_city_kind_idx
  on marketing.tasks (city, task_kind, status);

-- 7. Proofs of work (GPS shift check-ins, public creator video URLs, FTC #Ad & NY §§ 50-51 releases, QR counts)
create table if not exists marketing.proofs (
  id                           text primary key default gen_random_uuid()::text,
  task_id                      text not null references marketing.tasks (id) on delete cascade,
  human_id                     text references marketing.humans (id) on delete set null,
  proof_kind                   text not null
                               check (proof_kind in ('street_shift', 'creator_video', 'event_checkin', 'agency_recap', 'print_receipt', 'oss_pr_merge')),
  evidence_url                 text,
  checkin_media_hashes         jsonb not null default '[]'::jsonb,
  geo_time_valid               boolean not null default false,
  qr_scans_count               integer not null default 0 check (qr_scans_count >= 0),
  verified_signups_count       integer not null default 0 check (verified_signups_count >= 0),
  ftc_disclosed                boolean not null default false,
  likeness_releases_count      integer not null default 0 check (likeness_releases_count >= 0),
  featured_interviewees_count  integer not null default 0 check (featured_interviewees_count >= 0),
  likeness_release_ok          boolean not null default false,
  verifier_verdict             text not null default 'pending'
                               check (verifier_verdict in ('pending', 'verified', 'rejected')),
  verifier_notes               text,
  verified_at                  timestamptz,
  created_at                   timestamptz not null default now(),
  constraint chk_proofs_creator_video_verified check (
    verifier_verdict <> 'verified'
    or proof_kind <> 'creator_video'
    or (
      evidence_url is not null
      and length(btrim(evidence_url)) > 0
      and ftc_disclosed = true
      and likeness_release_ok = true
      and likeness_releases_count >= featured_interviewees_count
    )
  )
);
create index if not exists marketing_proofs_task_verdict_idx
  on marketing.proofs (task_id, verifier_verdict);

-- 8. Outbound & inbound outreach messages (email, Craigslist relay, agency RFPs, creator briefs, reminders)
create table if not exists marketing.outreach_messages (
  id                   text primary key default gen_random_uuid()::text,
  campaign_id          text references marketing.campaigns (id) on delete set null,
  task_id              text references marketing.tasks (id) on delete set null,
  agent_id             text references marketing.agents (id) on delete set null,
  human_id             text references marketing.humans (id) on delete set null,
  channel              text not null
                       check (channel in ('email', 'craigslist', 'craigslist_relay', 'rentahuman', 'backstage', 'collabstr', 'passionfroot', 'youtube', 'tiktok', 'instagram', 'x', 'x_dm', 'ig_dm', 'venue', 'sms_opted_in', 'eliza_deliver', 'other')),
  tier                 smallint not null default 1 check (tier in (1, 2, 3, 4)),
  direction            text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  provider_used        text check (provider_used is null or provider_used in ('chatgpt', 'claude', 'gemini', 'surplus', 'template')),
  template_id          text,
  subject              text,
  body_text            text not null check (length(btrim(body_text)) > 0),
  leak_check_pass      boolean not null default true,
  external_message_id  text,
  status               text not null default 'drafted'
                       check (status in ('drafted', 'dry_run', 'queued', 'sent', 'delivered', 'replied', 'bounced', 'blocked_stop', 'blocked_policy', 'failed')),
  sent_at              timestamptz,
  created_at           timestamptz not null default now()
);
create index if not exists marketing_outreach_human_created_idx
  on marketing.outreach_messages (human_id, created_at desc);
create index if not exists marketing_outreach_task_idx
  on marketing.outreach_messages (task_id, status) where task_id is not null;

-- 9. Attribution events (serialized QR scans, shortlink clicks, verified 18+ signups, release signatures)
create table if not exists marketing.attribution_events (
  id                   bigserial primary key,
  campaign_id          text not null references marketing.campaigns (id) on delete cascade,
  task_id              text references marketing.tasks (id) on delete set null,
  human_id             text references marketing.humans (id) on delete set null,
  qr_batch_code        text,
  app_id               text not null check (app_id in ('slop', 'peon', 'friends', 'ntwrk', 'all')),
  city                 text not null default 'nyc',
  event_type           text not null
                       check (event_type in ('qr_scan', 'site_visit', 'link_click', 'signup_started', 'signup_verified_18plus', 'signup_verified_adult', 'release_signed', 'video_view', 'video_view_snapshot')),
  count                integer not null default 1 check (count >= 0),
  dedupe_key           text unique,
  subject_hash         text,
  is_adult_verified    boolean not null default false,
  fraud_flagged        boolean not null default false,
  metadata             jsonb not null default '{}'::jsonb,
  occurred_at          timestamptz not null default now(),
  created_at           timestamptz not null default now(),
  constraint chk_attribution_verified_adult check (
    event_type <> 'signup_verified_18plus'
    or is_adult_verified = true
  )
);
create index if not exists marketing_attribution_batch_type_idx
  on marketing.attribution_events (qr_batch_code, event_type, occurred_at desc);
create index if not exists marketing_attribution_campaign_idx
  on marketing.attribution_events (campaign_id, occurred_at desc);

-- 10. Append-only budget & spend circuit-breaker ledger (isolated from packages/capital)
create table if not exists marketing.budget_ledger (
  id                   bigserial primary key,
  campaign_id          text not null references marketing.campaigns (id) on delete cascade,
  task_id              text references marketing.tasks (id) on delete set null,
  human_id             text references marketing.humans (id) on delete set null,
  adapter_id           text not null check (length(btrim(adapter_id)) > 0),
  tier                 smallint not null check (tier in (1, 2, 3, 4)),
  track                text check (track is null or track in ('street_fliering', 'creator_video', 'event_activation', 'print_qr', 'agency_reserve', 'tier3_api', 'oss_dev_bounty')),
  amount_cents         integer not null check (amount_cents > 0),
  entry_type           text not null check (entry_type in ('dry_run', 'reserve', 'commit', 'release', 'refund')),
  payout_rail          text not null default 'none'
                       check (payout_rail in ('none', 'fiat_stripe', 'fiat_tremendous', 'usdc_direct', 'agency_invoice', 'platform_escrow', 'card_api', 'slop_cash')),
  idempotency_key      text not null unique check (length(btrim(idempotency_key)) > 0),
  external_ref         text,
  notes                text,
  created_at           timestamptz not null default now()
);
create index if not exists marketing_budget_campaign_created_idx
  on marketing.budget_ledger (campaign_id, created_at desc);
create index if not exists marketing_budget_task_idx
  on marketing.budget_ledger (task_id) where task_id is not null;

-- 11. Disabled-by-default slop.cash integration metadata (inv_slop_cash_disabled)
create table if not exists marketing.slop_cash_hooks (
  id                   text primary key default gen_random_uuid()::text,
  task_id              text not null unique references marketing.tasks (id) on delete cascade,
  repo_slug            text not null default 'eliza-research/thenetwork',
  issue_number         integer check (issue_number is null or issue_number > 0),
  vault_chain          text not null default 'base'
                       check (vault_chain in ('base', 'solana', 'robinhood_4663')),
  estimated_usdc_cents integer not null default 0 check (estimated_usdc_cents >= 0),
  enabled              boolean not null default false,
  hook_state           text not null default 'disabled_stub'
                       check (hook_state in ('disabled_stub', 'ready_for_sync', 'manifest_submitted', 'month_closed', 'settled_onchain', 'rejected')),
  external_tx_hash     text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint chk_slop_cash_disabled_fence check (
    enabled = true or hook_state = 'disabled_stub'
  )
);
create index if not exists marketing_slop_cash_state_idx
  on marketing.slop_cash_hooks (hook_state);

-- Least privilege: only the service login reads or writes marketing data.
revoke all on schema marketing from public;
revoke all on all tables in schema marketing from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'network_service') then
    grant usage on schema marketing to network_service;
    grant select, insert, update, delete on all tables in schema marketing to network_service;
    grant usage, select on all sequences in schema marketing to network_service;
  end if;
end $$;
