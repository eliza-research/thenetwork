-- Turn and consent fixes (docs/research/quint-findings/turn_consent.md).
-- SD-002: a compliance turn (STOP, START, HELP, leave) has its own claim slot per sender, so a STOP is never
-- held back by an ordinary turn of the same sender that is still processing.
alter table platform.inbound add column if not exists compliance boolean not null default false;
drop index if exists platform.inbound_signed_sender_processing;
create unique index if not exists inbound_signed_sender_processing on platform.inbound(sender_hash, compliance) where status='processing';
