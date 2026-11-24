-- QSM state machine schema fixes ported from origin/claude/quint-state-machines.
-- Covers DB items needed by Slices 1, 2, and 3; all statements are idempotent.

-- SD-002: a compliance turn (STOP, START, HELP, leave) has its own claim slot per sender, so a STOP is
-- never held back by an ordinary turn of the same sender that is still processing.
alter table platform.inbound add column if not exists compliance boolean not null default false;
drop index if exists platform.inbound_signed_sender_processing;
create unique index if not exists inbound_signed_sender_processing
  on platform.inbound (sender_hash, compliance) where status = 'processing';

-- SD-496: a running signed turn renews its lease in its own column, so arrived_at stays the Network
-- arrival (profile collection deadlines read it).
alter table platform.inbound add column if not exists lease_at timestamptz;

-- SD-004: keep_until column on platform.rate_limits for minimum-gap retention tracking.
alter table platform.rate_limits add column if not exists keep_until timestamptz;

-- SD-318: a global STOP keeps the app its confirmation named ("Reply START to resume <app>"), so the
-- next START resumes that app and not the app that routing picks then.
alter table platform.consent_events add column if not exists named_app text references platform.apps (id);

-- SD-276: link one-time Eliza notices to the signed turn that collected them.
alter table platform.eliza_notices add column if not exists turn_id text;
create index if not exists eliza_notices_turn_id
  on platform.eliza_notices (turn_id) where turn_id is not null;

-- SD-383: age 0 is a valid under-join stated age (validAge allows 0..120).
alter table platform.age_floor drop constraint if exists age_floor_lowest_age_check;
alter table platform.age_floor add constraint age_floor_lowest_age_check
  check (lowest_age >= 0 and lowest_age < 130);
alter table platform.pending_texts drop constraint if exists pending_texts_age_check;
alter table platform.pending_texts add constraint pending_texts_age_check
  check (age is null or (age >= 0 and age < 130));

-- Outbound queue rows belong to one network ('<app>:<city>'); backfill legacy rows to ':nyc'.
alter table platform.outbound add column if not exists network_id text;
update platform.outbound set network_id = app_id || ':nyc' where network_id is null;
create index if not exists messages_outbound_status
  on network.messages (app_id, status) where direction = 'outbound';

-- SD-475: safety hold notices have their own outbound kind ('safety').
alter table platform.outbound drop constraint if exists outbound_kind_check;
alter table platform.outbound add constraint outbound_kind_check
  check (kind in ('reply', 'compliance', 'proactive', 'safety', 'transactional'));

-- SD-235: track when an ops alert post last failed so failed alerts post their resolution cleanly.
alter table network.ops_alerts add column if not exists last_failed_at timestamptz;

-- SD-153: preserve exact insert order for Network Capital ledger replay within the same timestamp.
alter table network.capital_events add column if not exists seq bigint generated always as identity;

-- SD-341: preserve notify.surface_signals when another live or invited membership exists.
-- Matches packages/notify/db/retention.sql (9003_notify_retention runs after this on fresh databases).
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
