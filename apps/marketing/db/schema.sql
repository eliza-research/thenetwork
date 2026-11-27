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
  phone_hash           text,
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
alter table marketing.humans
  add column if not exists phone_hash text;
create index if not exists marketing_humans_phone_hash_idx
  on marketing.humans (phone_hash) where phone_hash is not null;

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
    event_type not in ('signup_verified_18plus', 'signup_verified_adult')
    or is_adult_verified = true
  )
);
create index if not exists marketing_attribution_batch_type_idx
  on marketing.attribution_events (qr_batch_code, event_type, occurred_at desc);
create index if not exists marketing_attribution_campaign_idx
  on marketing.attribution_events (campaign_id, occurred_at desc);
create index if not exists idx_attribution_campaign_created
  on marketing.attribution_events (campaign_id, event_type, created_at desc);

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
  from_reserve         boolean not null default false,
  payout_rail          text not null default 'none'
                       check (payout_rail in ('none', 'fiat_stripe', 'fiat_tremendous', 'usdc_direct', 'agency_invoice', 'platform_escrow', 'card_api', 'slop_cash')),
  idempotency_key      text not null unique check (length(btrim(idempotency_key)) > 0),
  external_ref         text,
  notes                text,
  created_at           timestamptz not null default now()
);
alter table marketing.budget_ledger
  add column if not exists from_reserve boolean not null default false;
create index if not exists marketing_budget_campaign_created_idx
  on marketing.budget_ledger (campaign_id, created_at desc);
create index if not exists idx_budget_ledger_campaign_day
  on marketing.budget_ledger (campaign_id, entry_type, created_at desc);
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

-- 12. Contextual Thompson-Sampling Bandit arms (Pass 2)
create table if not exists marketing.bandit_arms (
  id                   text primary key default gen_random_uuid()::text,
  campaign_id          text not null references marketing.campaigns (id) on delete cascade,
  arm_key              text not null check (length(btrim(arm_key)) > 0),
  label                text not null check (length(btrim(label)) > 0),
  track                text not null check (length(btrim(track)) > 0),
  alpha                double precision not null default 1.0 check (alpha > 0),
  beta                 double precision not null default 1.0 check (beta > 0),
  weight               double precision not null default 0.0 check (weight >= 0 and weight <= 1),
  spend_cents          integer not null default 0 check (spend_cents >= 0),
  signups              integer not null default 0 check (signups >= 0),
  stop_events          integer not null default 0 check (stop_events >= 0),
  total_contacts       integer not null default 0 check (total_contacts >= 0),
  status               text not null default 'active'
                       check (status in ('active', 'killed', 'paused')),
  updated_at           timestamptz not null default now(),
  unique (campaign_id, arm_key)
);
create index if not exists idx_bandit_arms_campaign_status
  on marketing.bandit_arms (campaign_id, status);

-- 13. Zero-Human BD Venue & Event-Host Deals (Pass 2)
create table if not exists marketing.bd_deals (
  id                       text primary key default gen_random_uuid()::text,
  campaign_id              text not null references marketing.campaigns (id) on delete cascade,
  city                     text not null default 'nyc',
  venue_name               text not null check (length(btrim(venue_name)) > 0),
  vertical                 text not null check (vertical in ('slop', 'peon', 'friends', 'ntwrk', 'all')),
  contact_email            text,
  business_phone           text,
  stage                    text not null default 'prospect'
                           check (stage in ('prospect', 'enriched', 'pitched', 'negotiating', 'contracted', 'kit_shipped', 'live', 'audited', 'closed_lost')),
  offered_cents            integer not null default 0 check (offered_cents >= 0),
  phone_callback_verified  boolean not null default false,
  contract_hash            text,
  qr_batch_id              text,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists idx_bd_deals_campaign_stage
  on marketing.bd_deals (campaign_id, stage, updated_at desc);

-- 14. Serialized QR Batches (Pass 2)
create table if not exists marketing.qr_batches (
  id                   text primary key default gen_random_uuid()::text,
  campaign_id          text not null references marketing.campaigns (id) on delete cascade,
  city                 text not null default 'nyc',
  batch_code           text not null unique check (length(btrim(batch_code)) > 0),
  destination_url      text not null check (length(btrim(destination_url)) > 0),
  dub_link_id          text,
  print_qty            integer not null default 0 check (print_qty >= 0),
  assigned_to_type     text check (assigned_to_type is null or assigned_to_type in ('human', 'bd_deal')),
  assigned_to_id       text,
  scans                integer not null default 0 check (scans >= 0),
  verified_signups     integer not null default 0 check (verified_signups >= 0),
  created_at           timestamptz not null default now()
);
create index if not exists idx_qr_batches_campaign_code
  on marketing.qr_batches (campaign_id, batch_code);

-- 15. 18-Archetype High-Status VIP Prospects (Pass 2)
create table if not exists marketing.vip_prospects (
  id                   text primary key default gen_random_uuid()::text,
  campaign_id          text not null references marketing.campaigns (id) on delete cascade,
  city                 text not null default 'nyc',
  name                 text not null check (length(btrim(name)) > 0),
  archetype            text not null check (length(btrim(archetype)) > 0),
  organization         text,
  public_source        text not null check (length(btrim(public_source)) > 0),
  source_url           text,
  prestige_score       smallint not null default 0 check (prestige_score between 0 and 100),
  contact_email        text,
  invite_draft         text,
  status               text not null default 'discovered'
                       check (status in ('discovered', 'scored', 'drafted', 'invited', 'replied', 'onboarded', 'declined')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_vip_prospects_campaign_status
  on marketing.vip_prospects (campaign_id, status, prestige_score desc);

-- 16. 5-Agent Short-Form Funny Video Factory Assets (Pass 2)
create table if not exists marketing.video_assets (
  id                   text primary key default gen_random_uuid()::text,
  campaign_id          text not null references marketing.campaigns (id) on delete cascade,
  agent_id             text references marketing.agents (id) on delete set null,
  title                text not null check (length(btrim(title)) > 0),
  hook                 text not null check (length(btrim(hook)) > 0),
  script               text not null check (length(btrim(script)) > 0),
  stage                text not null default 'trend'
                       check (stage in ('trend', 'script', 'voice_render', 'qa', 'published', 'measured', 'killed')),
  video_url            text,
  platform             text,
  views                integer not null default 0 check (views >= 0),
  retention_3s_pct     numeric(5, 2) not null default 0 check (retention_3s_pct >= 0 and retention_3s_pct <= 100),
  signups              integer not null default 0 check (signups >= 0),
  ftc_disclosed        boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists idx_video_assets_campaign_stage
  on marketing.video_assets (campaign_id, stage, updated_at desc);

-- 17. Anti-Fraud & Vesting Claims Ledger (Pass 2)
create table if not exists marketing.antifraud_claims (
  id                   text primary key default gen_random_uuid()::text,
  campaign_id          text not null references marketing.campaigns (id) on delete cascade,
  person_key           text not null check (length(btrim(person_key)) > 0),
  worker_id            text references marketing.humans (id) on delete set null,
  task_id              text references marketing.tasks (id) on delete set null,
  phone_line_type      text not null default 'unknown'
                       check (phone_line_type in ('postpaid', 'prepaid', 'mvno', 'voip', 'landline', 'unknown')),
  media_hash           text,
  cluster_id           text,
  vesting_tier         smallint not null default 1 check (vesting_tier between 0 and 4),
  amount_cents         integer not null default 0 check (amount_cents >= 0),
  status               text not null default 'vesting'
                       check (status in ('vesting', 'approved', 'quarantined', 'rejected')),
  reason               text,
  created_at           timestamptz not null default now()
);
create index if not exists idx_antifraud_claims_campaign_status
  on marketing.antifraud_claims (campaign_id, status, created_at desc);
create index if not exists idx_antifraud_claims_person_key
  on marketing.antifraud_claims (person_key);
create index if not exists idx_antifraud_claims_media_hash
  on marketing.antifraud_claims (media_hash) where media_hash is not null;

-- Additional composite operational indexes (Pass 2)
create index if not exists idx_tasks_campaign_status
  on marketing.tasks (campaign_id, status, created_at desc);
create index if not exists idx_proofs_task_verdict
  on marketing.proofs (task_id, verifier_verdict, verified_at desc);
create index if not exists idx_outreach_status_created
  on marketing.outreach_messages (campaign_id, status, created_at desc);

-- Pass 3 performance indexes
create index if not exists idx_proofs_checkin_media_hashes_gin
  on marketing.proofs using gin (checkin_media_hashes);
create index if not exists idx_antifraud_claims_worker_created
  on marketing.antifraud_claims (worker_id, created_at desc) where worker_id is not null;
create index if not exists idx_tasks_human_status_paid
  on marketing.tasks (human_id, status, paid_at) where human_id is not null;

-- 18. LLM Trajectories & Token/Cost Audit Ledger (Pass 3)
create table if not exists marketing.llm_trajectories (
  id                   text primary key default gen_random_uuid()::text,
  agent_id             text,
  campaign_id          text references marketing.campaigns (id) on delete set null,
  provider             text not null check (length(btrim(provider)) > 0),
  model                text not null check (length(btrim(model)) > 0),
  prompt_hash          text not null check (length(btrim(prompt_hash)) > 0),
  input_tokens         integer not null default 0 check (input_tokens >= 0),
  output_tokens        integer not null default 0 check (output_tokens >= 0),
  cached               boolean not null default false,
  cost_micros          integer not null default 0 check (cost_micros >= 0),
  latency_ms           integer not null default 0 check (latency_ms >= 0),
  status               text not null default 'ok'
                       check (status in ('ok', 'cached', 'fallback', 'budget_blocked', 'leak_blocked', 'error')),
  failover_chain       text,
  leak_blocked         boolean not null default false,
  created_at           timestamptz not null default now()
);
create index if not exists idx_llm_trajectories_created
  on marketing.llm_trajectories (created_at desc);
create index if not exists idx_llm_trajectories_agent_created
  on marketing.llm_trajectories (agent_id, created_at desc) where agent_id is not null;
create index if not exists idx_llm_trajectories_prompt_hash
  on marketing.llm_trajectories (prompt_hash);

-- 19. Cross-Surface Contact Suppression Ledger (Pass 3)
create table if not exists marketing.contact_suppression (
  contact_hash         text primary key check (length(btrim(contact_hash)) > 0),
  reason               text not null check (length(btrim(reason)) > 0),
  source_channel       text not null default 'marketing',
  is_minor             boolean not null default false,
  suppressed_at        timestamptz not null default now()
);
create index if not exists idx_contact_suppression_minor
  on marketing.contact_suppression (is_minor) where is_minor = true;

-- 20. Cross-Surface Contact Touchpoint Cooldown Ledger (Pass 3)
create table if not exists marketing.contact_touchpoints (
  id                   text primary key default gen_random_uuid()::text,
  contact_hash         text not null check (length(btrim(contact_hash)) > 0),
  campaign_id          text references marketing.campaigns (id) on delete set null,
  surface              text not null check (surface in ('outreach', 'vip', 'bd', 'agent')),
  is_cold              boolean not null default true,
  replied              boolean not null default false,
  touched_at           timestamptz not null default now()
);
create index if not exists idx_contact_touchpoints_hash_time
  on marketing.contact_touchpoints (contact_hash, touched_at desc);

-- 21. Persistent Global City Pack Overrides (Pass 3)
create table if not exists marketing.city_packs (
  code                 text primary key check (length(btrim(code)) > 0),
  stage                text not null default 'scout'
                       check (stage in ('scout', 'seed_waitlist', 'soft_launch', 'density_growth', 'mature')),
  config               jsonb not null default '{}'::jsonb,
  updated_at           timestamptz not null default now()
);

-- Pass 3 additive columns (idempotent)
alter table marketing.humans add column if not exists contact_email text;
alter table marketing.campaigns add column if not exists desire_lane text;
alter table marketing.bandit_arms add column if not exists desire_lane text;
alter table marketing.bandit_arms add column if not exists verified_outcomes integer not null default 0 check (verified_outcomes >= 0);
alter table marketing.bd_deals add column if not exists desire_lane text;
alter table marketing.vip_prospects add column if not exists desire_lane text;
alter table marketing.video_assets add column if not exists desire_lane text;
alter table marketing.tasks add column if not exists desire_lane text;
alter table marketing.attribution_events add column if not exists desire_lane text;
alter table marketing.attribution_events add column if not exists arm_id text;

-- Idempotent constraint upgrades without unconditional ACCESS EXCLUSIVE locks on boot
do $$
declare
  v_def text;
  v_et_con text;
  v_et_def text;
begin
  select pg_get_constraintdef(c.oid) into v_def
  from pg_constraint c
  where c.conrelid = 'marketing.attribution_events'::regclass
    and c.conname = 'chk_attribution_verified_adult';

  if v_def is null or v_def not like '%first_match_accepted%' then
    if v_def is not null then
      alter table marketing.attribution_events drop constraint chk_attribution_verified_adult;
    end if;
    alter table marketing.attribution_events
      add constraint chk_attribution_verified_adult check (
        event_type not in (
          'signup_verified_18plus',
          'signup_verified_adult',
          'first_match_accepted',
          'irl_meeting_confirmed',
          'second_meetup_retained',
          'intro_or_hire_unlocked',
          't3_match_verified'
        )
        or is_adult_verified = true
      );
  end if;

  select c.conname, pg_get_constraintdef(c.oid) into v_et_con, v_et_def
  from pg_constraint c
  where c.conrelid = 'marketing.attribution_events'::regclass
    and c.contype = 'c'
    and c.conname <> 'chk_attribution_verified_adult'
    and pg_get_constraintdef(c.oid) like '%event_type%';

  if v_et_con is not null and v_et_def not like '%first_match_accepted%' then
    execute format('alter table marketing.attribution_events drop constraint %I', v_et_con);
    alter table marketing.attribution_events
      add constraint chk_attribution_event_type check (
        event_type in (
          'qr_scan',
          'site_visit',
          'link_click',
          'signup_started',
          'signup_verified_18plus',
          'signup_verified_adult',
          'release_signed',
          'video_view',
          'video_view_snapshot',
          'first_match_accepted',
          'irl_meeting_confirmed',
          'second_meetup_retained',
          'intro_or_hire_unlocked',
          't3_match_verified'
        )
      );
  end if;
end $$;

-- Guarded least-privilege SECURITY DEFINER bridge RPCs inside marketing schema (Pass 3).
-- Only created/updated when shared platform.* + network.* tables exist AND caller holds owner role.
do $$
declare
  v_people_oid regclass := to_regclass('platform.people');
begin
  if v_people_oid is not null
     and to_regclass('platform.bans') is not null
     and to_regclass('platform.suppression') is not null
     and to_regclass('platform.consent_events') is not null
     and to_regclass('platform.phone_identities') is not null
     and to_regclass('platform.age_floor') is not null
     and to_regclass('platform.signup_eligibility') is not null
     and to_regclass('platform.person_minor_signals') is not null
     and to_regclass('platform.line_safety') is not null
     and to_regclass('platform.outbound') is not null
     and to_regclass('platform.networks') is not null
     and to_regclass('network.members') is not null
     and to_regclass('network.review_items') is not null
  then
    if pg_has_role(current_user, (select relowner from pg_class where oid = v_people_oid), 'MEMBER') then
    create or replace function marketing.contact_fence(
      p_phone_hash text,
      p_e164 text default null,
      p_today date default current_date
    ) returns table (
      banned boolean,
      globally_stopped boolean,
      known_minor boolean,
      recycled_hold boolean,
      reason text
    )
    language plpgsql
    security definer
    set search_path = pg_catalog
    as $fn$
    declare
      v_hash text := nullif(btrim(p_phone_hash), '');
      v_e164 text := nullif(btrim(p_e164), '');
      v_today date := coalesce(p_today, current_date);
      v_today_ymd integer := to_char(coalesce(p_today, current_date), 'YYYYMMDD')::integer;
      v_banned boolean := false;
      v_stopped boolean := false;
      v_minor boolean := false;
      v_recycled boolean := false;
      v_reason text := null;
    begin
      if v_e164 is null and v_hash is not null then
        select pi.e164 into v_e164
        from platform.people p
        join platform.phone_identities pi on pi.person_id = p.id
        where p.phone_hash = v_hash
        order by pi.verified_at desc nulls last
        limit 1;
      end if;

      if v_hash is not null then
        v_banned := exists (select 1 from platform.bans b where b.phone_hash = v_hash)
          or exists (select 1 from platform.suppression s where s.phone_hash = v_hash);
      end if;

      if not v_banned and v_e164 is not null then
        v_banned := exists (
          select 1
          from platform.phone_identities pi
          join platform.bans b on b.person_id = pi.person_id
          where pi.e164 = v_e164
        );
      end if;

      if v_e164 is not null then
        select coalesce((
          select ce.state = 'opted_out'
          from platform.consent_events ce
          where ce.e164 = v_e164 and ce.app_id is null
          order by ce.at desc, ce.id desc
          limit 1
        ), false) into v_stopped;

        v_recycled := exists (
          select 1
          from platform.phone_identities pi
          where pi.e164 = v_e164 and pi.hold is not null
        );
      end if;

      if v_hash is not null then
        v_minor := exists (
          select 1 from platform.age_floor af
          where af.phone_hash = v_hash
            and (
              (af.lowest_age is not null and af.lowest_age < 18)
              or (af.birth_youngest is not null and (v_today_ymd - af.birth_youngest) / 10000 < 18)
              or (af.birth_upper is not null and (v_today_ymd - af.birth_upper) / 10000 < 18)
            )
        ) or exists (
          select 1 from platform.people p
          where p.phone_hash = v_hash
            and (
              (p.lowest_age is not null and p.lowest_age < 18)
              or (p.birth_date is not null and (v_today_ymd - p.birth_date) / 10000 < 18)
              or (p.birth_youngest is not null and (v_today_ymd - p.birth_youngest) / 10000 < 18)
              or (p.birth_upper is not null and (v_today_ymd - p.birth_upper) / 10000 < 18)
              or exists (select 1 from platform.signup_eligibility se where se.person_id = p.id and se.eligible_at > v_today::timestamptz)
              or exists (select 1 from platform.person_minor_signals ms where ms.person_id = p.id)
            )
        );
      end if;

      if not v_minor and v_e164 is not null then
        v_minor := exists (
          select 1
          from platform.phone_identities pi
          join platform.people p on p.id = pi.person_id
          where pi.e164 = v_e164
            and (
              (p.lowest_age is not null and p.lowest_age < 18)
              or (p.birth_date is not null and (v_today_ymd - p.birth_date) / 10000 < 18)
              or (p.birth_youngest is not null and (v_today_ymd - p.birth_youngest) / 10000 < 18)
              or (p.birth_upper is not null and (v_today_ymd - p.birth_upper) / 10000 < 18)
              or exists (select 1 from platform.signup_eligibility se where se.person_id = p.id and se.eligible_at > v_today::timestamptz)
              or exists (select 1 from platform.person_minor_signals ms where ms.person_id = p.id)
            )
        );
      end if;

      v_reason := case
        when v_minor then 'platform_known_minor'
        when v_banned then 'platform_banned_or_suppressed'
        when v_stopped then 'platform_global_stop'
        when v_recycled then 'platform_recycled_number_hold'
        else null
      end;

      return query select v_banned, v_stopped, v_minor, v_recycled, v_reason;
    end;
    $fn$;

    create or replace function marketing.supply_demand_k5(
      p_city text default null
    ) returns table (
      app_id text,
      city text,
      active_adult_bucket integer,
      matching_enabled boolean,
      open_review_count integer,
      overdue_review_count integer,
      outbound_waiting_count integer,
      line_restricted boolean,
      closed_venue_count integer
    )
    language plpgsql
    security definer
    set search_path = pg_catalog
    as $fn$
    declare
      v_city text := nullif(lower(btrim(p_city)), '');
      v_line_restricted boolean := false;
      v_has_venues boolean := to_regclass('platform.venues') is not null;
    begin
      select exists (
        select 1 from platform.line_safety ls where ls.action <> 'none'
      ) into v_line_restricted;

      if v_has_venues then
        return query
        select
          n.app_id,
          n.city,
          case
            when coalesce(mc.adult_cnt, 0) < 5 then 0
            else (floor(mc.adult_cnt / 5.0)::integer * 5)
          end as active_adult_bucket,
          n.matching_enabled,
          coalesce(rc.open_cnt, 0)::integer as open_review_count,
          coalesce(rc.overdue_cnt, 0)::integer as overdue_review_count,
          coalesce(oc.waiting_cnt, 0)::integer as outbound_waiting_count,
          v_line_restricted as line_restricted,
          coalesce(vc.closed_cnt, 0)::integer as closed_venue_count
        from platform.networks n
        left join (
          select m.app_id, lower(m.home_city) as city, count(*)::integer as adult_cnt
          from network.members m
          left join platform.people p on p.id = m.person_id
          where m.account_status = 'active'
            and (m.age is null or m.age >= 18)
            and (p.lowest_age is null or p.lowest_age >= 18)
          group by m.app_id, lower(m.home_city)
        ) mc on mc.app_id = n.app_id and mc.city = n.city
        left join (
          select
            ri.app_id,
            count(*) filter (where ri.decision is null)::integer as open_cnt,
            count(*) filter (where ri.decision is null and ri.deadline < now())::integer as overdue_cnt
          from network.review_items ri
          group by ri.app_id
        ) rc on rc.app_id = n.app_id
        left join (
          select o.app_id, count(*)::integer as waiting_cnt
          from platform.outbound o
          where o.status in ('pending', 'retry_scheduled', 'deferred_quiet_hours', 'held_awaiting_reply', 'sending', 'unknown_acceptance')
          group by o.app_id
        ) oc on oc.app_id = n.app_id
        left join (
          select lower(v.city) as city, count(*)::integer as closed_cnt
          from platform.venues v
          where v.status in ('suspect_closed', 'closed_temporary', 'closed_permanent')
          group by lower(v.city)
        ) vc on vc.city = n.city
        where v_city is null or n.city = v_city
        order by n.city, n.app_id;
      else
        return query
        select
          n.app_id,
          n.city,
          case
            when coalesce(mc.adult_cnt, 0) < 5 then 0
            else (floor(mc.adult_cnt / 5.0)::integer * 5)
          end as active_adult_bucket,
          n.matching_enabled,
          coalesce(rc.open_cnt, 0)::integer as open_review_count,
          coalesce(rc.overdue_cnt, 0)::integer as overdue_review_count,
          coalesce(oc.waiting_cnt, 0)::integer as outbound_waiting_count,
          v_line_restricted as line_restricted,
          0::integer as closed_venue_count
        from platform.networks n
        left join (
          select m.app_id, lower(m.home_city) as city, count(*)::integer as adult_cnt
          from network.members m
          left join platform.people p on p.id = m.person_id
          where m.account_status = 'active'
            and (m.age is null or m.age >= 18)
            and (p.lowest_age is null or p.lowest_age >= 18)
          group by m.app_id, lower(m.home_city)
        ) mc on mc.app_id = n.app_id and mc.city = n.city
        left join (
          select
            ri.app_id,
            count(*) filter (where ri.decision is null)::integer as open_cnt,
            count(*) filter (where ri.decision is null and ri.deadline < now())::integer as overdue_cnt
          from network.review_items ri
          group by ri.app_id
        ) rc on rc.app_id = n.app_id
        left join (
          select o.app_id, count(*)::integer as waiting_cnt
          from platform.outbound o
          where o.status in ('pending', 'retry_scheduled', 'deferred_quiet_hours', 'held_awaiting_reply', 'sending', 'unknown_acceptance')
          group by o.app_id
        ) oc on oc.app_id = n.app_id
        where v_city is null or n.city = v_city
        order by n.city, n.app_id;
      end if;
    end;
    $fn$;

    revoke all on function marketing.contact_fence(text, text, date) from public;
    revoke all on function marketing.supply_demand_k5(text) from public;
    if exists (select 1 from pg_roles where rolname = 'network_service') then
      grant execute on function marketing.contact_fence(text, text, date) to network_service;
      grant execute on function marketing.supply_demand_k5(text) to network_service;
    end if;
    end if;
  end if;
end $$;

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
