-- 0026: relay between matched members (packages/network/src/relay.ts; engine relay.ts; AGENTS.md "Relay (#7)").
--  1. network.relay_threads: one row per match whose members talked through the agent (ids, the time it
--     opened and how many delivered items it holds). The delivered wording itself stays in the stored
--     Network state only.
--  2. network.relay_records: the engine's RelayRecord for every relayed item (ids, kind, decision,
--     reason codes with leak matches as keyed hashes, photo count, whether a number was shared, whether
--     a minor's age showed, the policy version) and its staff review (held, released, rejected). Never a
--     message body, a contact value or a photo id. It is the rate-limit history, and a stored state that
--     lost its relay log reads it back from here after a restart (store.ts loadRelayRows).
-- PgStore.save writes both from the Network state (on conflict update; it never deletes them). No
-- foreign keys to opportunities or members: the record must outlive a member's delete (ids only).
-- Row-level security per app, as on every other app-scoped network table. Idempotent.

create table if not exists network.relay_threads (
  app_id         text not null,
  id             text not null,
  opportunity_id text not null,
  members        text[] not null,
  opened_at      timestamptz not null,
  messages       int not null default 0,
  primary key (app_id, id)
);
create index if not exists relay_threads_members on network.relay_threads using gin (members);

create table if not exists network.relay_records (
  app_id         text not null,
  item_id        text not null,
  opportunity_id text not null,
  kind           text not null check (kind in ('text', 'contact_share', 'photo')),
  from_member    text not null,
  to_member      text not null,
  at             timestamptz not null,
  decision       text not null check (decision in ('pass', 'hold', 'block')),
  reasons        text[] not null default '{}',
  photo_count    int not null default 0,
  contact_shared boolean not null default false,
  age_signal     boolean not null default false,
  policy         text not null,
  review         text check (review in ('held', 'released', 'rejected')),
  reviewed_by    text,
  reviewed_at    timestamptz,
  primary key (app_id, item_id)
);
create index if not exists relay_records_opportunity on network.relay_records (app_id, opportunity_id, at);
create index if not exists relay_records_held on network.relay_records (app_id, at) where review = 'held';
create index if not exists relay_records_from on network.relay_records (app_id, from_member, at);

do $$
declare
  t text;
  a text;
begin
  foreach t in array array['relay_threads', 'relay_records'] loop
    execute format('alter table network.%I enable row level security', t);
    execute format('alter table network.%I force row level security', t);
    execute format('drop policy if exists service_app on network.%I', t);
    execute format('create policy service_app on network.%I for all to network_service
                    using (app_id = current_setting(''app.app_id'', true))
                    with check (app_id = current_setting(''app.app_id'', true))', t);
    execute format('grant select, insert, update on network.%I to network_service', t);
    foreach a in array array['ntwrk', 'slop', 'peon', 'friends'] loop
      if exists (select 1 from pg_roles where rolname = 'network_observatory_' || a) then
        execute format('drop policy if exists %I on network.%I', 'observatory_app_' || a, t);
        execute format('create policy %I on network.%I for select to %I using (app_id = %L)', 'observatory_app_' || a, t, 'network_observatory_' || a, a);
        execute format('grant select on network.%I to %I', t, 'network_observatory_' || a);
      end if;
    end loop;
  end loop;
end $$;
