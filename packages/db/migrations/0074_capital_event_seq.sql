alter table network.capital_events add column if not exists seq bigint;
create sequence if not exists network.capital_events_seq owned by network.capital_events.seq;
update network.capital_events set seq = ordered.n
  from (select app_id, id, row_number() over (order by t, id) as n from network.capital_events) ordered
  where capital_events.app_id = ordered.app_id and capital_events.id = ordered.id and capital_events.seq is null;
select setval('network.capital_events_seq', coalesce((select max(seq) from network.capital_events), 0) + 1, false);
alter table network.capital_events alter column seq set default nextval('network.capital_events_seq');
alter table network.capital_events alter column seq set not null;
create index if not exists capital_events_replay on network.capital_events (app_id, seq);
grant usage on sequence network.capital_events_seq to network_service;
