-- 0011: bans after a report, private member photos, and the app packs' matching switch.
--  1. platform.bans: staff ban a phone (this number can never join again) or a person (every phone
--     of the person, on every app; PRD 40.5 "ban by person, not by account"). A ban is a safety record:
--     delete everything keeps it, and the service login can add bans but never change or remove one.
--  2. platform.photos: a member's private photos (slop.date; adults only, checked in code before every
--     write and read). The bytes live in object storage (R2 in production, a local folder in dev),
--     under a random key; this row holds the key, the checksum and the person's photo consent. There
--     is no public URL: staff read a photo through the backend after an audited reveal.
--  3. slop:nyc and peon:nyc may now be switched on by an admin (their engine packs are wired). The
--     Network's stored switch still starts off, so nothing matches until a person turns it on.
-- Idempotent (if not exists / on conflict), like the earlier migrations.

create table if not exists platform.bans (
  id         text primary key,
  scope      text not null check (scope in ('phone', 'person')),
  person_id  uuid references platform.people (id),
  phone_hash text,
  reason     text not null,
  report_id  text,
  banned_by  text not null,
  at         timestamptz not null default now(),
  check (phone_hash is not null or person_id is not null)
);
create index if not exists bans_phone on platform.bans (phone_hash) where phone_hash is not null;
create index if not exists bans_person on platform.bans (person_id) where person_id is not null;
grant select, insert on platform.bans to platform_service;
revoke update, delete, truncate on platform.bans from platform_service;

create table if not exists platform.photos (
  id              text primary key,
  person_id       uuid not null references platform.people (id),
  app_id          text not null references platform.apps (id),
  storage_key     text not null unique,
  content_type    text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp')),
  bytes           int not null check (bytes > 0),
  sha256          text not null,
  consent_version text not null,
  created_at      timestamptz not null,
  deleted_at      timestamptz
);
create index if not exists photos_person on platform.photos (person_id, app_id) where deleted_at is null;
grant select, insert, update, delete on platform.photos to platform_service;
revoke truncate on platform.photos from platform_service;

update platform.networks set matching_enabled = true where id in ('slop:nyc', 'peon:nyc');
