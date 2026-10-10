-- 0025: the one-time notice on the eliza.app line (packages/network/service/README.md, "The Eliza seam").
-- One row per number that got the notice: a keyed hash of the number (never the number) and the time.
-- The service (platform_service) inserts a row in the same transaction as the collected notice, and
-- deletes it when the same turn declines an under-13 (nothing is kept for them).
-- Runs once (public.__migrations); every step is also safe to run again.
create table if not exists platform.eliza_notices (
  phone_hash text primary key,
  sent_at    timestamptz not null
);
grant select, insert, delete on platform.eliza_notices to platform_service;
