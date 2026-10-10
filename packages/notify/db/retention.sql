-- Canonical Notify retention. Applied after the Notify baseline by migration 9003.
-- No new deletion ledger: platform.people and network.members remain the fences.
create function notify.lock_live_scope(person text, app text) returns boolean
language plpgsql set search_path = pg_catalog, platform, network, notify as $$
declare
  old_app text := current_setting('app.app_id', true);
  member text;
  membership_state text;
  account text;
begin
  -- Preserve existing producers for a live person; refuse an explicitly erased
  -- app scope. One lock order: person, known member, Notify records.
  perform 1 from platform.people where id::text = person and deleted_at is null for share;
  if not found then return false; end if;
  select member_id, state into member, membership_state from platform.memberships
    where person_id::text = person and app_id = app;
  if membership_state = 'removed' then return false; end if;
  if member is not null then
    perform set_config('app.app_id', app, true);
    select account_status into account from network.members where app_id = app and id = member for share;
    perform set_config('app.app_id', coalesce(old_app, ''), true);
    if account = 'removed' then return false; end if;
  end if;
  return true;
end $$;
revoke all on function notify.lock_live_scope(text, text) from public;
grant execute on function notify.lock_live_scope(text, text) to network_service;

create function notify.guard_inbox_member() returns trigger
language plpgsql set search_path = pg_catalog, notify as $$
begin
  if not notify.lock_live_scope(new.person_id, new.app_id) then
    raise exception 'Notify membership is unavailable';
  end if;
  return new;
end $$;
create trigger notify_inbox_live_member before insert on notify.inbox_items
for each row execute function notify.guard_inbox_member();

create function notify.guard_item_references() returns trigger
language plpgsql set search_path = pg_catalog, notify as $$
begin
  -- Existing item rows serialize a late delivery/token with erasure. Retain
  -- only this person's surviving references, in their original order.
  new.item_ids := array(select owned.id from (
    select item.id, ref.ordinality from unnest(new.item_ids) with ordinality ref(id, ordinality)
      join notify.inbox_items item on item.id = ref.id
      where item.person_id = new.person_id for key share of item
  ) owned order by owned.ordinality);
  if cardinality(new.item_ids) = 0 then return null; end if;
  return new;
end $$;
create trigger notify_delivery_live_items before insert on notify.deliveries
for each row execute function notify.guard_item_references();
create trigger notify_token_live_items before insert on notify.task_tokens
for each row execute function notify.guard_item_references();

create function notify.guard_surface_member() returns trigger
language plpgsql set search_path = pg_catalog, platform, notify as $$
declare app text;
begin
  for app in select app_id from platform.memberships where person_id::text = new.person_id
    and state not in ('removed', 'invited') order by app_id loop
    if notify.lock_live_scope(new.person_id, app) then return new; end if;
  end loop;
  -- OAuth unlink/outcome callbacks after erasure are harmless no-ops.
  return null;
end $$;
create trigger notify_surface_live_member before insert on notify.surface_signals
for each row execute function notify.guard_surface_member();

create function notify.forget_data(person text, app text default null) returns void
language plpgsql security definer set search_path = pg_catalog, platform, network, notify as $$
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
  -- live or pending membership; a sealed removed member cannot retain them.
  if app is not null then
    for other in select app_id, member_id from platform.memberships where person_id::text = person
      and app_id <> app and state not in ('removed', 'invited') order by app_id loop
      perform set_config('app.app_id', other.app_id, true);
      select account_status into other_status from network.members where app_id = other.app_id and id = other.member_id;
      if other_status is null or other_status not in ('removed', 'invited') then keep_signals := true; exit; end if;
    end loop;
  end if;
  perform set_config('app.app_id', coalesce(old_app, ''), true);
  if not keep_signals then delete from notify.surface_signals where person_id = person; end if;
end $$;
revoke all on function notify.forget_data(text, text) from public;
grant usage on schema notify to platform_service;
grant execute on function notify.forget_data(text, text) to platform_service, network_service;
