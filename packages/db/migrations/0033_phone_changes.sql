-- 0033: a member changes their own phone number (PRD F25; packages/platform/src/accounts.ts
-- startNumberChange / confirmNumberChange; POST /api/me/phone/start and /api/me/phone/confirm).
--  platform.phone_changes: one row per change a person started. While it waits, new_e164 holds the
--  number the code went to. On confirm the row keeps only the keyed hashes of the old and the new
--  number (never the old number), who asked and when: the audit record of the change. A row that was
--  never confirmed is removed by the retention purge; delete everything removes the person's rows.
-- Idempotent.

create table if not exists platform.phone_changes (
  id           uuid primary key,
  person_id    uuid not null references platform.people (id),
  app_id       text not null references platform.apps (id),
  new_e164     text check (new_e164 is null or new_e164 ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
  requested_by text not null,
  requested_at timestamptz not null,
  confirmed_at timestamptz,
  old_hash     text,
  new_hash     text,
  check (confirmed_at is null or (new_e164 is null and old_hash is not null and new_hash is not null))
);
create index if not exists phone_changes_person on platform.phone_changes (person_id, requested_at desc);
grant select, insert, update, delete on platform.phone_changes to platform_service;
