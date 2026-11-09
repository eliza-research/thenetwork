-- runtime_ops fixes (state-machine research, 2026-11-07).
--
-- network.ops_alerts.last_failed_at (SD-235): the last time a post that carried this alert failed.
-- An alert that was never posted closes quietly only when no post of it failed; else its end is
-- posted, so an alert the webhook did not take during an outage is not lost. The existing update
-- grant to network_service covers the new column.
alter table network.ops_alerts add column if not exists last_failed_at timestamptz;
