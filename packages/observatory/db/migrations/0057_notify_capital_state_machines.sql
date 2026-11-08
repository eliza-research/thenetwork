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

-- SD-341. notify.forget_data: leaving one app deleted the person's surface signals when their other
-- membership was invited, although the insert trigger lets an invited membership write signals (so a
-- new one was written again at once). The keep rule now counts every membership that is not removed,
-- as the trigger does. packages/notify/db/retention.sql (9003) has the same text for a new database;
-- 9003 runs after this file there, so this block replaces the function only where 9003 already ran.
do $mig$
begin
  if to_regprocedure('notify.forget_data(text, text)') is not null then
    execute $body$
create or replace function notify.forget_data(person text, app text default null) returns void
language plpgsql security definer set search_path = pg_catalog, platform, network, notify as $fn$
declare
  old_app text := current_setting('app.app_id', true);
  other record;
  other_status text;
  keep_signals boolean := false;
  deleted timestamptz;
  member text;
  membership_state text;
  member_state text;
begin
  select deleted_at into deleted from platform.people where id::text = person for update;
  if not found then raise exception 'Notify erasure requires a canonical person'; end if;
  if app is null then
    if deleted is null then raise exception 'Notify full erasure requires canonical deletion'; end if;
  else
    if old_app is distinct from app then raise exception 'Notify app erasure requires canonical app scope'; end if;
    select member_id, state into member, membership_state from platform.memberships where person_id::text = person and app_id = app;
    if not found then raise exception 'Notify app erasure requires a canonical membership'; end if;
    select account_status into member_state from network.members where app_id = app and id = member;
    if membership_state <> 'removed' and member_state is distinct from 'removed' then
      raise exception 'Notify app erasure requires canonical removal';
    end if;
  end if;
  delete from notify.inbox_items where person_id = person and (app is null or app_id = app);
  update notify.deliveries d set item_ids = array(
    select item.id from unnest(d.item_ids) with ordinality ref(id, ordinality)
      join notify.inbox_items item on item.id = ref.id and item.person_id = person
      order by ref.ordinality
  ) where d.person_id = person;
  delete from notify.deliveries where person_id = person and cardinality(item_ids) = 0;
  update notify.task_tokens token set item_ids = array(
    select item.id from unnest(token.item_ids) with ordinality ref(id, ordinality)
      join notify.inbox_items item on item.id = ref.id and item.person_id = person
      order by ref.ordinality
  ) where token.person_id = person;
  delete from notify.task_tokens where person_id = person and cardinality(item_ids) = 0;
  -- Signals are person/surface data, not app data. Preserve them for another
  -- live or pending (invited) membership, the same rule as the insert trigger
  -- (notify_surface_live_member); a sealed removed member cannot retain them.
  if app is not null then
    for other in select app_id, member_id from platform.memberships where person_id::text = person
      and app_id <> app and state <> 'removed' order by app_id loop
      perform set_config('app.app_id', other.app_id, true);
      select account_status into other_status from network.members where app_id = other.app_id and id = other.member_id;
      if other_status is distinct from 'removed' then keep_signals := true; exit; end if;
    end loop;
  end if;
  perform set_config('app.app_id', coalesce(old_app, ''), true);
  if not keep_signals then delete from notify.surface_signals where person_id = person; end if;
end $fn$;
    $body$;
  end if;
end $mig$;
