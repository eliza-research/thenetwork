create table if not exists platform.photo_upload_links (
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
create index if not exists photo_upload_links_person on platform.photo_upload_links(person_id, issued_at);
grant select, insert, update, delete on platform.photo_upload_links to platform_service;
