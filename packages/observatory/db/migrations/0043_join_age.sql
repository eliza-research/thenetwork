-- 0043: the join and age machines (docs/research/quint-findings/join_age.md).
-- The one-time notice row names the signed turn that collected it (platform.inbound.id). When that turn
-- loses its worker and the sweep marks it unresolved, or staff resolve it, the notice was never delivered:
-- the inbox deletes the row in the same statement, so the next first contact gets the notice (SD-276).
-- Rows written before this migration have no turn and count as delivered.
-- The existing SELECT/INSERT/DELETE grants cover the added column.
alter table platform.eliza_notices add column if not exists turn_id text;
create index if not exists eliza_notices_turn_id on platform.eliza_notices (turn_id) where turn_id is not null;
