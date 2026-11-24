-- One voluntary photo choice, one current relay thread, one intended recipient.
-- No bytes, storage keys, appearance scores, member-facing URLs or blanket consent.
-- Idempotency survives deleted photos/items. Only opaque request/item IDs and a payload digest.
create table platform.photo_relay_requests (
  sender_person_id uuid not null references platform.people(id),
  app_id text not null references platform.apps(id),
  request_id text not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  item_id text not null unique,
  primary key (sender_person_id,app_id,request_id)
);
grant select, insert on platform.photo_relay_requests to platform_service;
revoke update, delete, truncate on platform.photo_relay_requests from platform_service;

create table platform.photo_relay_items (
  id text primary key check (id ~ '^pri_[a-f0-9]{32}$'),
  app_id text not null references platform.apps(id),
  sender_person_id uuid not null references platform.people(id),
  recipient_person_id uuid not null references platform.people(id),
  photo_id text not null references platform.photos(id) on delete cascade,
  thread_id text not null,
  sender_member_id text not null,
  recipient_member_id text not null,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  content_type text not null check (content_type in ('image/jpeg','image/png','image/webp')),
  content_bytes integer not null check (content_bytes > 0 and content_bytes <= 8388608),
  consent_id text not null unique,
  consented_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > consented_at),
  policy_version text not null,
  policy_notice text not null,
  notice text not null,
  state text not null check (state in ('pending','approved','rejected','revoked')),
  review_id text,
  reviewed_at timestamptz,
  reviewer_id text,
  action_id text unique,
  delivery_intent text unique,
  delivery_expires_at timestamptz,
  check ((delivery_intent is null) = (delivery_expires_at is null)),
  check (delivery_expires_at is null or delivery_expires_at <= expires_at),
  check ((state = 'approved' and review_id is not null and reviewed_at is not null and reviewer_id is not null) or state <> 'approved'),
  check (reviewed_at is null or (reviewed_at >= consented_at and reviewed_at < expires_at)),
  check (sender_person_id <> recipient_person_id),
  check (sender_member_id <> recipient_member_id)
);
create index photo_relay_owner on platform.photo_relay_items(sender_person_id, app_id);
create index photo_relay_photo on platform.photo_relay_items(photo_id);
grant select, insert, update, delete on platform.photo_relay_items to platform_service;

-- Restart-safe approved descriptors only. Provider fetch URLs are deliberately not persisted.
alter table platform.outbound add column approved_photos jsonb not null default '[]'::jsonb
  check (jsonb_typeof(approved_photos) = 'array');
