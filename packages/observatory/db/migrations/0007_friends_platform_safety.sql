-- 0007: founder decisions of 2026-10-08 (AGENTS.md "Platform decisions") and the platform audit fixes
-- (docs/audit/2026-10-08-weaknesses.md: platform-7, -8, -14, -15, -16, -M1; network-service-M1, -M2;
-- observatory-3).
--  1. The app 'buddies' (buddies.nyc) is renamed 'friends' (friends.help) everywhere: the app row, the
--     network ('friends:nyc'), memberships, consent and audit rows, every network table's app_id, the
--     console role, its policies and its view. Member ids keep their old prefix (they are opaque ids).
--  2. Join age 13 on every app (matching stays 18+).
--  3. platform.pending_texts: text flows waiting for the person's next message (a join that asked for
--     name and age, The Network's "what are you looking for?", a SHARE offer), so a restart or a
--     second instance does not lose them. Keyed by the keyed phone hash.
--  4. The person cap of proactive messages a day across apps: a platform counter
--     (platform.person_sends) taken under one lock by platform.person_cap_take (SECURITY DEFINER), so
--     two networks delivering at once cannot both pass the cap.
--  5. (see 7)
--  6. network.channel_identities gets app_id, a per-app key and row-level security.
--  7. platform.member_apps also returns the newest open item per app (shared-line routing).
--  (The console read paths per app, audit platform-7 and observatory-3, are migration 0010.)
--  8. Least privilege for platform_service; consent events are never updated; network_service gets the
--     platform rows it needs (the service is the platform's text channel).
--  9. Columns: consent_events.ref (a retried message writes one event) and wording_version,
--     otp_challenges.provider_ref, sessions.started_at, people.phone_hash (a deleted person who joins
--     again with the same phone comes back as the same person, so blocks still hold).
-- 10. network.capital_events: the network capital (NC) ledger events of every unit of work.
-- Runs once (public.__migrations). Run it as a role that row-level security does not filter.

-- ---------------------------------------------------------------- 1. buddies -> friends
alter table platform.apps drop constraint if exists apps_id_check;

do $$
declare
  r record;
  t text;
begin
  if not exists (select 1 from platform.apps where id = 'buddies') then
    return;
  end if;
  -- Every foreign key that names an app: dropped, the rows renamed, then put back as they were.
  create temp table _app_fks on commit drop as
    select c.conrelid::regclass::text as tbl, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c
    where c.contype = 'f' and c.connamespace in ('network'::regnamespace, 'platform'::regnamespace)
      and (c.confrelid = 'platform.apps'::regclass
        or exists (select 1 from unnest(c.conkey) k join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k where a.attname = 'app_id'));
  for r in select * from _app_fks loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;

  insert into platform.apps (id, name, domain, min_join_age, min_match_age, join_mode, status)
    select 'friends', 'friends', 'friends.help', min_join_age, min_match_age, join_mode, status from platform.apps where id = 'buddies'
    on conflict (id) do nothing;

  alter table platform.audit disable trigger audit_no_change;
  alter table network.staff_audit disable trigger staff_audit_no_change;
  -- Every plain app_id column (network_state.app_id is generated from its id).
  for r in
    select c.table_schema, c.table_name from information_schema.columns c join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema in ('network', 'platform') and c.column_name = 'app_id' and c.is_generated = 'NEVER'
      and c.table_name not in ('apps', 'networks')
  loop
    execute format('update %I.%I set app_id = %L where app_id = %L', r.table_schema, r.table_name, 'friends', 'buddies');
  end loop;
  alter table platform.audit enable trigger audit_no_change;
  alter table network.staff_audit enable trigger staff_audit_no_change;
  update platform.share_grants set from_app = 'friends' where from_app = 'buddies';
  update platform.share_grants set to_app = 'friends' where to_app = 'buddies';
  update platform.person_blocks set origin_app = 'friends' where origin_app = 'buddies';
  update platform.networks set id = 'friends:' || city, app_id = 'friends' where app_id = 'buddies';
  update network.network_state set id = 'friends:' || split_part(id, ':', 2) where id like 'buddies:%';
  delete from platform.apps where id = 'buddies';

  for r in select * from _app_fks loop
    execute format('alter table %s add constraint %I %s', r.tbl, r.conname, r.def);
  end loop;
end $$;

alter table platform.apps add constraint apps_id_check check (id in ('ntwrk', 'slop', 'peon', 'friends'));
insert into platform.apps (id, name, domain, min_join_age, min_match_age, join_mode) values ('friends', 'friends', 'friends.help', 13, 18, 'open')
on conflict (id) do nothing;
insert into platform.networks (id, app_id, city, matching_enabled) values ('friends:nyc', 'friends', 'nyc', true)
on conflict (id) do nothing;

-- The console role of the friends app (roles are cluster-wide: another database may have made it).
do $$ begin
  create role network_observatory_friends nologin;
exception when duplicate_object or unique_violation then null;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array['members', 'opportunities', 'requests', 'matching_runs', 'events', 'messages', 'review_items',
                           'facets', 'intents', 'presence', 'edges', 'participations', 'feedback'] loop
    execute format('drop policy if exists observatory_app_buddies on network.%I', t);
    execute format('drop policy if exists observatory_app_friends on network.%I', t);
    execute format('create policy observatory_app_friends on network.%I for select to network_observatory_friends using (app_id = %L)', t, 'friends');
    execute format('grant select on network.%I to network_observatory_friends', t);
  end loop;
end $$;
grant usage on schema network to network_observatory_friends;
grant usage on schema platform to network_observatory_friends;
grant select on platform.apps, platform.cities, platform.networks to network_observatory_friends;
drop view if exists network.network_state_console_buddies;
drop view if exists platform.person_blocks_buddies;
do $$ begin
  if to_regclass('platform.person_blocks_ntwrk') is null then
    -- 0010 has not run yet: it makes the friends app's console views from platform.apps.
    execute 'grant select (from_person, to_person, at) on platform.person_blocks to network_observatory_friends';
  else
    -- 0010 ran before this file (a database migrated out of order): the friends app's console views here.
    execute $v$create or replace view network.network_state_console_friends with (security_barrier) as
      select c.* from network.network_state_console c join network.network_state s on s.id = c.id where s.app_id = 'friends'$v$;
    execute 'revoke all on network.network_state_console_friends from public';
    execute 'grant select on network.network_state_console_friends to network_observatory_friends';
    execute $v$create or replace view platform.person_blocks_friends with (security_barrier) as
      select b.from_person, b.to_person, b.at from platform.person_blocks b
      where exists (select 1 from platform.memberships m where m.person_id = b.from_person and m.app_id = 'friends')
        and exists (select 1 from platform.memberships m where m.person_id = b.to_person and m.app_id = 'friends')$v$;
    execute 'revoke all on platform.person_blocks_friends from public';
    execute 'grant select on platform.person_blocks_friends to network_observatory_friends';
  end if;
end $$;

-- The old role: nothing of it stays in this database. It is dropped when no other database still uses it.
do $$
declare
  rid oid := (select oid from pg_roles where rolname = 'network_observatory_buddies');
begin
  if rid is null then return; end if;
  execute 'drop owned by network_observatory_buddies';
  if not exists (select 1 from pg_shdepend where refobjid = rid and dbid <> (select oid from pg_database where datname = current_database())) then
    begin
      execute 'drop role network_observatory_buddies';
    exception when others then null;  -- another database still uses it: its own migration drops it
    end;
  end if;
end $$;

-- ---------------------------------------------------------------- 2. join age 13 everywhere
update platform.apps set min_join_age = 13 where min_join_age <> 13;

-- ---------------------------------------------------------------- 3. pending text flows
create table if not exists platform.pending_texts (
  phone_hash text not null,
  kind       text not null check (kind in ('join', 'looking_for', 'share')),
  app_id     text not null references platform.apps (id),
  name       text,
  age        int check (age is null or (age > 0 and age < 130)),
  at         timestamptz not null,
  primary key (phone_hash, kind, app_id)
);
grant select, insert, update, delete on platform.pending_texts to platform_service;

-- ---------------------------------------------------------------- 4. the person cap
create table if not exists platform.person_sends (
  msg_id    text primary key,
  person_id uuid not null,
  app_id    text not null references platform.apps (id),
  at        timestamptz not null
);
create index if not exists person_sends_person on platform.person_sends (person_id, at);
revoke all on platform.person_sends from platform_service;

-- For a batch of proactive sends of one app ([{id, member}]): the ids the cap refuses. The others are
-- counted for their person (a redelivered id is never counted twice). One lock for every app, so the
-- count and the take are one step even when several networks deliver at once.
create or replace function platform.person_cap_take(app text, sends jsonb, since timestamptz, at timestamptz, cap int)
returns setof text
language plpgsql volatile security definer set search_path = pg_catalog, platform, network as $$
declare
  r record;
  pid uuid;
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('platform.person_cap'));
  delete from platform.person_sends where person_sends.at < since - interval '1 day';
  for r in select x->>'id' as id, x->>'member' as member from jsonb_array_elements(sends) x loop
    if exists (select 1 from platform.person_sends where msg_id = r.id) then continue; end if;
    select m.person_id into pid from network.members m where m.app_id = app and m.id = r.member;
    if pid is null then continue; end if;
    select count(*) into n from platform.person_sends where person_id = pid and person_sends.at >= since;
    if n >= cap then
      return next r.id;
    else
      insert into platform.person_sends (msg_id, person_id, app_id, at) values (r.id, pid, app, person_cap_take.at);
    end if;
  end loop;
end $$;
revoke all on function platform.person_cap_take(text, jsonb, timestamptz, timestamptz, int) from public;
grant execute on function platform.person_cap_take(text, jsonb, timestamptz, timestamptz, int) to network_service;
drop function if exists platform.person_cap_counts(text, text[], timestamptz, text[]);

-- ---------------------------------------------------------------- 6. channel identities per app
alter table network.channel_identities add column if not exists app_id text;
update network.channel_identities ci set app_id = m.app_id from network.members m where m.id = ci.member_id and ci.app_id is null;
update network.channel_identities set app_id = 'ntwrk' where app_id is null;
alter table network.channel_identities alter column app_id set not null;
alter table network.channel_identities alter column app_id set default network.current_app_id();
alter table network.channel_identities drop constraint if exists channel_identities_pkey;
alter table network.channel_identities add constraint channel_identities_pkey primary key (app_id, channel, address);
alter table network.channel_identities drop constraint if exists channel_identities_member_id_fkey;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'channel_identities_member_app_fk') then
    alter table network.channel_identities add constraint channel_identities_member_app_fk
      foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade;
  end if;
end $$;
alter table network.channel_identities enable row level security;
alter table network.channel_identities force row level security;
drop policy if exists service_app on network.channel_identities;
create policy service_app on network.channel_identities for all to network_service
  using (app_id = current_setting('app.app_id', true)) with check (app_id = current_setting('app.app_id', true));
grant select, insert, update, delete on network.channel_identities to network_service;

-- ---------------------------------------------------------------- 7. shared-line routing (after 6: it reads channel_identities.app_id)
-- last_item: the newest outbound message about an opportunity (a probe, a plan) that the member has
-- not answered yet in that app. A reply goes to the app with the open item first.
drop function if exists platform.member_apps(text);
create function platform.member_apps(addr text)
returns table (app_id text, member_id text, last_out timestamptz, last_item timestamptz)
language sql stable security definer set search_path = pg_catalog, platform, network as $$
  select m.app_id, m.id,
    (select max(msg.ts) from network.messages msg where msg.app_id = m.app_id and msg.member_id = m.id and msg.direction = 'outbound'),
    (select max(msg.ts) from network.messages msg where msg.app_id = m.app_id and msg.member_id = m.id and msg.direction = 'outbound' and msg.opportunity_id is not null
       and msg.ts > coalesce((select max(i.ts) from network.messages i where i.app_id = m.app_id and i.member_id = m.id and i.direction = 'inbound'), '-infinity'::timestamptz))
  from network.members m
  where m.account_status not in ('invited', 'removed')
    and (m.person_id in (select ph.person_id from platform.phone_identities ph where ph.e164 = addr and ph.hold is null)
      or exists (select 1 from network.channel_identities ci where ci.app_id = m.app_id and ci.member_id = m.id and ci.address = addr and ci.channel in ('imessage', 'sms')))
$$;

-- ---------------------------------------------------------------- 8. least privilege
-- platform_service runs the public API: people, phones, memberships, consent, sessions, limits. It
-- never changes the app list, the networks, the lines, the settings or the staff roles, and it never
-- edits a consent event (it may delete a phone's events when the person deletes everything).
revoke insert, update, delete, truncate on platform.apps, platform.cities, platform.networks, platform.app_lines, platform.settings, platform.staff_roles from platform_service;
revoke update, truncate on platform.consent_events from platform_service;
revoke truncate on all tables in schema platform from platform_service;
-- The service is the platform's text channel too (joins by text, the consent ledger, the person cap).
grant platform_service to network_service;

-- ---------------------------------------------------------------- 9. columns
alter table platform.consent_events add column if not exists ref text;
alter table platform.consent_events add column if not exists wording_version text;
create unique index if not exists consent_events_ref on platform.consent_events (e164, ref) where ref is not null;
alter table platform.otp_challenges add column if not exists provider_ref text;
alter table platform.sessions add column if not exists started_at timestamptz;
update platform.sessions set started_at = created_at where started_at is null;
alter table platform.people add column if not exists phone_hash text;
create index if not exists people_phone_hash on platform.people (phone_hash) where phone_hash is not null;

-- ---------------------------------------------------------------- 10. network capital events
create table if not exists network.capital_events (
  app_id    text not null default network.current_app_id() references platform.apps (id),
  id        text not null,
  type      text not null,
  member_id text,
  t         timestamptz not null,
  event     jsonb not null,
  primary key (app_id, id)
);
create index if not exists capital_events_member on network.capital_events (app_id, member_id);
alter table network.capital_events enable row level security;
alter table network.capital_events force row level security;
drop policy if exists service_app on network.capital_events;
create policy service_app on network.capital_events for all to network_service
  using (app_id = current_setting('app.app_id', true)) with check (app_id = current_setting('app.app_id', true));
grant select, insert, delete on network.capital_events to network_service;
revoke select on network.capital_events from network_observatory;
