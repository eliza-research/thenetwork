-- 0017: shadow labels and blind second reviews on review items (docs/admin-console.md 3.2;
-- PRD 34.6 and 37.3). Runs once (public.__migrations).
--   shadow             the item came from a shadow engine run (matching off, shadow on): its
--                      approve or reject is a label only, and nobody was contacted.
--   second_*           a blind second review of a decided item (a share of items, default 10%):
--                      pending, then the second reviewer's decision. It never changes the first.
-- The Network writes these from its stored state (packages/network/src/store.ts consoleRows); a
-- database without them gets rows without them. The console reads them through its read logins,
-- which already have select on the whole table.
alter table network.review_items add column if not exists shadow boolean not null default false;
alter table network.review_items add column if not exists second_status text check (second_status in ('pending', 'done'));
alter table network.review_items add column if not exists second_decision text check (second_decision in ('approve', 'reject'));
alter table network.review_items add column if not exists second_reviewer text;
alter table network.review_items add column if not exists second_reason text check (second_reason in ('weak_reason', 'privacy_risk', 'capacity_concern', 'wrong_timing', 'safety', 'tone', 'duplicate', 'other'));
alter table network.review_items add column if not exists second_decided_at timestamptz;
create index if not exists review_items_shadow_decided on network.review_items (decided_at) where shadow;
