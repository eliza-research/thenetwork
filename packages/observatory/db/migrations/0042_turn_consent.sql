-- Turn and consent fixes (docs/research/quint-findings/turn_consent.md).
-- SD-002: a compliance turn (STOP, START, HELP, leave) has its own claim slot per sender, so a STOP is never
-- held back by an ordinary turn of the same sender that is still processing.
alter table platform.inbound add column if not exists compliance boolean not null default false;
drop index if exists platform.inbound_signed_sender_processing;
create unique index if not exists inbound_signed_sender_processing on platform.inbound(sender_hash, compliance) where status='processing';
-- SD-004: a hit with a minimum gap (the 30-day STOP hint) keeps its row until the gap ends, so the 2-day
-- retention purge does not reset the gap.
alter table platform.rate_limits add column if not exists keep_until timestamptz;
-- SD-318: a global STOP keeps the app its confirmation named ("Reply START to resume <app>"), so the next START
-- resumes that app and not the app that routing picks then.
alter table platform.consent_events add column if not exists named_app text references platform.apps (id);
-- SD-496: a running signed turn renews its lease in its own column, so arrived_at stays the Network arrival
-- (profile collection deadlines read it). A row without a lease (claimed before this migration) uses arrived_at.
alter table platform.inbound add column if not exists lease_at timestamptz;
