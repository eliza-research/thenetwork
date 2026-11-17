-- Keep the canonical ban append-only apart from its successful runtime projection receipt.
alter table platform.bans add column if not exists projection_completed_at timestamptz;
grant update (projection_completed_at) on platform.bans to platform_service;
