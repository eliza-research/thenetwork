-- A held relay item that staff do not decide by its review deadline expires unsent
-- (spec/relayLifecycle.md, "A held item that staff do not decide by its review deadline expires unsent").
-- network.relay_records.review keeps the expired status beside held, released and rejected.
alter table network.relay_records drop constraint if exists relay_records_review_check;
alter table network.relay_records add constraint relay_records_review_check check (review in ('held', 'released', 'rejected', 'expired'));
