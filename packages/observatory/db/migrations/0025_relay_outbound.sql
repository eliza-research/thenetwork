-- Relay uses the existing outbox; only the engine's rendered wording enters it.
alter table platform.outbound drop constraint outbound_kind_check;
alter table platform.outbound add constraint outbound_kind_check check(kind in ('reply','compliance','proactive','transactional','relay'));
