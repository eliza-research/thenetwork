-- 0004: one `network` schema for four apps (platform plan section 2.3).
--  - app_id on every app-scoped table, backfilled to 'ntwrk' (the only app with rows today).
--  - Composite keys (app_id, id) and composite foreign keys, so a row that joins two apps (an edge
--    from a slop member to a peon member) is a constraint error.
--  - network_state ids become '<app>:<city>' ('nyc' -> 'ntwrk:nyc').
--  - Row-level security: a read role per app, and a service write role bound to `app.app_id`.
-- Runs once (public.__migrations); every step is also safe to run again.

-- The app of a write: `set local app.app_id = '<app>'` in each unit of work. Writers that do not set
-- it yet (PgStore, the observatory seed) fall back to platform.settings 'legacy_default_app'
-- ('ntwrk'). Delete that setting when every writer sets app.app_id; a write with no app then fails.
create or replace function network.current_app_id() returns text language plpgsql stable as $$
declare a text := nullif(current_setting('app.app_id', true), '');
begin
  if a is null then
    select value into a from platform.settings where key = 'legacy_default_app';
  end if;
  if a is null then
    raise exception 'app.app_id is not set: run "set local app.app_id = ''<app>''" before writing network rows';
  end if;
  return a;
end $$;

-- Helpers for this migration only (pg_temp: gone when the connection closes).
create or replace function pg_temp.add_app_id(t text) returns void language plpgsql as $$
begin
  execute format('alter table network.%I add column if not exists app_id text', t);
  execute format('update network.%I set app_id = %L where app_id is null', t, 'ntwrk');
  execute format('alter table network.%I alter column app_id set not null', t);
  execute format('alter table network.%I alter column app_id set default network.current_app_id()', t);
  if not exists (select 1 from pg_constraint where conname = t || '_app_fk' and conrelid = ('network.' || t)::regclass) then
    execute format('alter table network.%I add constraint %I foreign key (app_id) references platform.apps (id)', t, t || '_app_fk');
  end if;
  execute format('create index if not exists %I on network.%I (app_id)', t || '_app', t);
end $$;

create or replace function pg_temp.replace_fk(t text, old_name text, new_name text, def text) returns void language plpgsql as $$
begin
  execute format('alter table network.%I drop constraint if exists %I', t, old_name);
  if not exists (select 1 from pg_constraint where conname = new_name and conrelid = ('network.' || t)::regclass) then
    execute format('alter table network.%I add constraint %I %s', t, new_name, def);
  end if;
end $$;

select pg_temp.add_app_id(t) from unnest(array[
  'members', 'opportunities', 'requests', 'matching_runs', 'events', 'messages', 'review_items',
  'facets', 'intents', 'presence', 'edges', 'participations', 'feedback'
]) t;

-- Composite keys on the parents.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_app_id_id_key') then
    alter table network.members add constraint members_app_id_id_key unique (app_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'opportunities_app_id_id_key') then
    alter table network.opportunities add constraint opportunities_app_id_id_key unique (app_id, id);
  end if;
end $$;

-- The person behind a member (null until the platform links one).
alter table network.members add column if not exists person_id uuid;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_person_fk') then
    alter table network.members add constraint members_person_fk foreign key (person_id) references platform.people (id);
  end if;
end $$;
create unique index if not exists members_app_person on network.members (app_id, person_id) where person_id is not null;

-- home_city: a reference to platform.cities instead of a fixed list.
alter table network.members drop constraint if exists members_home_city_check;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'members_home_city_fk') then
    alter table network.members add constraint members_home_city_fk foreign key (home_city) references platform.cities (id);
  end if;
end $$;

-- Composite foreign keys: a child row and its member (or opportunity) must be in the same app.
select pg_temp.replace_fk('members', 'members_invited_by_fkey', 'members_invited_by_app_fk',
  'foreign key (app_id, invited_by) references network.members (app_id, id)');
select pg_temp.replace_fk('facets', 'facets_member_id_fkey', 'facets_member_app_fk',
  'foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade');
select pg_temp.replace_fk('intents', 'intents_member_id_fkey', 'intents_member_app_fk',
  'foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade');
select pg_temp.replace_fk('presence', 'presence_member_id_fkey', 'presence_member_app_fk',
  'foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade');
select pg_temp.replace_fk('edges', 'edges_from_id_fkey', 'edges_from_app_fk',
  'foreign key (app_id, from_id) references network.members (app_id, id) on delete cascade');
select pg_temp.replace_fk('edges', 'edges_to_id_fkey', 'edges_to_app_fk',
  'foreign key (app_id, to_id) references network.members (app_id, id) on delete cascade');
select pg_temp.replace_fk('messages', 'messages_member_id_fkey', 'messages_member_app_fk',
  'foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade');
select pg_temp.replace_fk('feedback', 'feedback_from_id_fkey', 'feedback_from_app_fk',
  'foreign key (app_id, from_id) references network.members (app_id, id) on delete cascade');
select pg_temp.replace_fk('participations', 'participations_member_id_fkey', 'participations_member_app_fk',
  'foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade');
select pg_temp.replace_fk('participations', 'participations_opportunity_id_fkey', 'participations_opportunity_app_fk',
  'foreign key (app_id, opportunity_id) references network.opportunities (app_id, id) on delete cascade');
select pg_temp.replace_fk('review_items', 'review_items_opportunity_id_fkey', 'review_items_opportunity_app_fk',
  'foreign key (app_id, opportunity_id) references network.opportunities (app_id, id) on delete cascade');

-- network_state: one row per '<app>:<city>'. A legacy id with no ':' belongs to ntwrk.
alter table network.network_state add column if not exists app_id text
  generated always as (case when position(':' in id) > 0 then split_part(id, ':', 1) else 'ntwrk' end) stored;
update network.network_state set id = 'ntwrk:nyc'
  where id = 'nyc' and not exists (select 1 from network.network_state where id = 'ntwrk:nyc');
alter table network.network_state alter column id set default 'ntwrk:nyc';

-- Roles. Role names are cluster-wide; a parallel run in another database may create them first.
do $$
declare r text;
begin
  foreach r in array array['network_observatory', 'network_service', 'network_observatory_ntwrk',
                           'network_observatory_slop', 'network_observatory_peon', 'network_observatory_buddies'] loop
    begin
      execute format('create role %I nologin', r);
    exception when duplicate_object or unique_violation then null;
    end;
  end loop;
end $$;

-- Row-level security on every app-scoped table. FORCE applies it to the table owner too; superusers
-- and BYPASSRLS roles still skip it, so the console login must be neither.
do $$
declare
  t text;
  a text;
  tables text[] := array['members', 'opportunities', 'requests', 'matching_runs', 'events', 'messages', 'review_items',
                         'facets', 'intents', 'presence', 'edges', 'participations', 'feedback', 'network_state'];
begin
  foreach t in array tables loop
    execute format('alter table network.%I enable row level security', t);
    execute format('alter table network.%I force row level security', t);
    -- The service writes one app per unit of work: rows outside app.app_id are not visible or writable.
    execute format('drop policy if exists service_app on network.%I', t);
    execute format('create policy service_app on network.%I for all to network_service
                    using (app_id = current_setting(''app.app_id'', true))
                    with check (app_id = current_setting(''app.app_id'', true))', t);
    execute format('grant select, insert, update, delete on network.%I to network_service', t);
    if t <> 'network_state' then
      -- The original console role reads The Network (ntwrk) only.
      execute format('drop policy if exists observatory_ntwrk on network.%I', t);
      execute format('create policy observatory_ntwrk on network.%I for select to network_observatory using (app_id = %L)', t, 'ntwrk');
      foreach a in array array['ntwrk', 'slop', 'peon', 'buddies'] loop
        execute format('drop policy if exists %I on network.%I', 'observatory_app_' || a, t);
        execute format('create policy %I on network.%I for select to %I using (app_id = %L)',
                       'observatory_app_' || a, t, 'network_observatory_' || a, a);
        execute format('grant select on network.%I to %I', t, 'network_observatory_' || a);
      end loop;
    end if;
  end loop;
  foreach a in array array['ntwrk', 'slop', 'peon', 'buddies'] loop
    execute format('grant usage on schema network to %I', 'network_observatory_' || a);
    execute format('grant usage on schema platform to %I', 'network_observatory_' || a);
    execute format('grant select on platform.apps, platform.cities, platform.networks to %I', 'network_observatory_' || a);
  end loop;
end $$;

grant usage on schema network to network_service;
grant usage on all sequences in schema network to network_service;
grant select, insert, update on network.channel_identities to network_service;
grant select, insert on network.staff_audit to network_service;
grant usage on schema platform to network_service;
grant select on platform.settings, platform.apps, platform.cities, platform.networks to network_service;
