-- 0031: relay rows belong to one network ('<app>:<city>', platform.networks.id), not only to an app.
-- network.relay_threads and network.relay_records (0026) were keyed by app only, so a second city of an
-- app would read the first city's held items and rate-limit history (store.ts loadRelayRows) and could
-- overwrite their review columns. Rows written before this migration belong to the app's first city,
-- '<app>:nyc' (every app ran only nyc until now). The primary keys stay (item ids and match ids are
-- unique per app); reads and writes filter by network_id as well. Idempotent.
alter table network.relay_threads add column if not exists network_id text;
alter table network.relay_records add column if not exists network_id text;
update network.relay_threads set network_id = app_id || ':nyc' where network_id is null;
update network.relay_records set network_id = app_id || ':nyc' where network_id is null;
alter table network.relay_threads alter column network_id set not null;
alter table network.relay_records alter column network_id set not null;
create index if not exists relay_records_network on network.relay_records (app_id, network_id, at);
