-- spec/photoUploadLink.md: one app-bound, single-use, 15-minute photo upload link per row.
-- Only a keyed hash of the token is kept. No bytes, phone numbers or photo ids.
create table platform.photo_upload_links (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  person_id uuid not null references platform.people(id) on delete cascade,
  app_id text not null references platform.apps(id),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  used_at timestamptz,
  outcome text check (outcome in ('uploaded','refused')),
  via text not null check (via in ('text','agent')),
  check ((used_at is null) = (outcome is null))
);
create index photo_upload_links_person on platform.photo_upload_links(person_id, issued_at);
grant select, insert, update, delete on platform.photo_upload_links to platform_service;

-- spec/photoRelayItem.md, "A photo choice names a number from the list the member was just shown":
-- the photos one member was offered for one current relay thread, with the notice they saw.
create table platform.photo_relay_offers (
  sender_person_id uuid not null references platform.people(id) on delete cascade,
  app_id text not null references platform.apps(id),
  thread_id text not null check (length(thread_id) between 1 and 200),
  photo_ids text[] not null check (cardinality(photo_ids) between 1 and 6),
  policy_version text not null,
  policy_notice text not null,
  offered_at timestamptz not null,
  primary key (sender_person_id, app_id, thread_id)
);
grant select, insert, update, delete on platform.photo_relay_offers to platform_service;
