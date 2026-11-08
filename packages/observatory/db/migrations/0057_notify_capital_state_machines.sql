-- notify_capital state machines (docs/research/2026-11-07-state-machines.md, module notify_capital).
--
-- SD-153. network.capital_events: the order in which the ledger accepted the events. A restart
-- replayed the events by (t, id). Events of one unit of work have one t, so the replay sorted
-- help_confirmed before help_given (and member_activated before member_joined), and the ledger
-- dropped the first one as an event about an unknown record. The service now replays by seq. The
-- service writes no value: the identity gives each row its number in insert order (the unit's events
-- are inserted in emit order). Rows from before this migration get numbers in table order.
-- An identity column needs no privilege on its sequence: the existing insert grant covers it.
alter table network.capital_events add column if not exists seq bigint generated always as identity;
