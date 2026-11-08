-- 0045: an outbound row belongs to one network ('<app>:<city>', platform.networks.id), not only to an app.
-- Every network of an app on the shared line has a queue with the same app and line. drain() selected the
-- due rows by app and line only, so a second city of an app (slop:sf) took the first city's rows and ran its
-- own send-time checks on them: the member was unknown there and the row ended suppressed_ineligible.
-- The queue of a network now drains only its own rows. Rows written before this migration belong to the
-- app's first city, '<app>:nyc' (every app ran only nyc until now). A queue with no network (a simulation
-- or a test of the queue alone) writes null and drains every row of its app. Idempotent.
alter table platform.outbound add column if not exists network_id text;
update platform.outbound set network_id = app_id || ':nyc' where network_id is null;
