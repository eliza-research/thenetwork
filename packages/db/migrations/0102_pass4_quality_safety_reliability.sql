-- 0101: Pass 4 cross-app safety quarantine, persistent boundary signals,
-- unified member reliability strike ledger, and banned media SHA-256 registry.
--
-- Additive and idempotent: safe to run more than once on fresh or already-migrated DBs.

-- ---------------------------------------------------------------- 1. platform.person_safety_quarantine
create table if not exists platform.person_safety_quarantine (
  person_id  text primary key,
  reason     text not null,
  origin_app text not null,
  origin_ref text,
  active     boolean not null default true,
  created_at bigint not null,
  cleared_at bigint
);

create index if not exists person_safety_quarantine_active_idx
  on platform.person_safety_quarantine (active)
  where active = true;

revoke all on platform.person_safety_quarantine from public;
grant select, insert, update, delete on platform.person_safety_quarantine to platform_service;
revoke truncate on platform.person_safety_quarantine from platform_service;
grant select, insert, update, delete on platform.person_safety_quarantine to network_service;

-- ---------------------------------------------------------------- 2. platform.person_boundary_signals
create table if not exists platform.person_boundary_signals (
  id                 bigserial primary key,
  subject_person_id  text,
  subject_phone_hash text not null,
  reporter_hash      text not null,
  app_id             text not null,
  kind               text not null check (kind in ('post_meet_block', 'checkin_concern', 'self_promotion')),
  created_at         bigint not null,
  unique (subject_phone_hash, reporter_hash, app_id, kind)
);

create index if not exists person_boundary_signals_phone_created_idx
  on platform.person_boundary_signals (subject_phone_hash, created_at desc);

create index if not exists person_boundary_signals_person_idx
  on platform.person_boundary_signals (subject_person_id)
  where subject_person_id is not null;

revoke all on platform.person_boundary_signals from public;
grant select, insert, update, delete on platform.person_boundary_signals to platform_service;
revoke truncate on platform.person_boundary_signals from platform_service;
grant select, insert, update, delete on platform.person_boundary_signals to network_service;
grant usage, select on sequence platform.person_boundary_signals_id_seq to platform_service, network_service;

-- ---------------------------------------------------------------- 3. platform.member_reliability
create table if not exists platform.member_reliability (
  person_id           text primary key,
  phone_hash          text not null,
  strikes             integer not null default 0,
  late_cancels_4h     integer not null default 0,
  late_cancels_24h    integer not null default 0,
  reschedule_churn    integer not null default 0,
  clean_streak        integer not null default 0,
  resolved_90d        integer not null default 0,
  completed_90d       integer not null default 0,
  provisional_no_show boolean not null default false,
  updated_at          bigint not null
);

create index if not exists member_reliability_phone_hash_idx
  on platform.member_reliability (phone_hash);

create index if not exists member_reliability_strikes_idx
  on platform.member_reliability (strikes)
  where strikes > 0;

revoke all on platform.member_reliability from public;
grant select, insert, update, delete on platform.member_reliability to platform_service;
revoke truncate on platform.member_reliability from platform_service;
grant select, insert, update, delete on platform.member_reliability to network_service;

-- ---------------------------------------------------------------- 4. platform.banned_media_hashes
create table if not exists platform.banned_media_hashes (
  sha256_hex text primary key,
  person_id  text,
  banned_at  bigint not null
);

create index if not exists banned_media_hashes_person_idx
  on platform.banned_media_hashes (person_id)
  where person_id is not null;

revoke all on platform.banned_media_hashes from public;
grant select, insert, update, delete on platform.banned_media_hashes to platform_service;
revoke truncate on platform.banned_media_hashes from platform_service;
grant select, insert, update, delete on platform.banned_media_hashes to network_service;
