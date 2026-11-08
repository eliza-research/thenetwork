-- 0043: the join and age machines (docs/research/quint-findings/join_age.md).
-- The one-time notice row names the signed turn that collected it (platform.inbound.id). When that turn
-- loses its worker and the sweep marks it unresolved, or staff resolve it, the notice was never delivered:
-- the inbox deletes the row in the same statement, so the next first contact gets the notice (SD-276).
-- Rows written before this migration have no turn and count as delivered.
-- The existing SELECT/INSERT/DELETE grants cover the added column.
alter table platform.eliza_notices add column if not exists turn_id text;
create index if not exists eliza_notices_turn_id on platform.eliza_notices (turn_id) where turn_id is not null;

-- An age of 0 is a valid stated age in code (validAge in packages/core/src/policy.ts: 0 to 120) and is
-- under the join age. The age floor and a pending join keep it, so the decline holds and a later, older
-- age never replaces it (SD-383). Before, the check refused 0 and the join failed with a server error.
alter table platform.age_floor drop constraint if exists age_floor_lowest_age_check;
alter table platform.age_floor add constraint age_floor_lowest_age_check check (lowest_age >= 0 and lowest_age < 130);
alter table platform.pending_texts drop constraint if exists pending_texts_age_check;
alter table platform.pending_texts add constraint pending_texts_age_check check (age is null or (age >= 0 and age < 130));
