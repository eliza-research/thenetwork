-- 0013: relay between matched members (PRD 32.11, F16; packages/network/src/relay.ts).
--  1. network.relay_threads: one thread per booked plan between adults. It opens at the reveal and
--     closes 7 days after the meeting, or on STOP, leave, delete, block, ban or a cancelled plan.
--  2. network.relay_log: every relayed text, as ids, a status (sent, held, blocked), the reasons and a
--     hash. The text itself (body) is kept only while it is held for staff; after a release or a
--     reject it is null. The log is a safety record: past contacts of a banned member are told from it.
--  3. network.contact_shares: number swaps inside a booked plan (asked, accepted, declined, sent,
--     expired). The numbers themselves are never stored here.
-- PgStore.save writes these rows from the Network state (on conflict update; it never deletes them).
-- No foreign keys to opportunities or members: a member's delete removes those rows, and the relay
-- record must outlive it (ids only). Row-level security per app, as 0004. Idempotent.

create table if not exists network.relay_threads (
  app_id         text not null default network.current_app_id() references platform.apps (id),
  id             text not null,
  opportunity_id text not null,
  members        text[] not null,
  opened_at      timestamptz not null,
  closes_at      timestamptz not null,
  closed_at      timestamptz,
  closed_reason  text,
  primary key (app_id, id)
);
create index if not exists relay_threads_opportunity on network.relay_threads (app_id, opportunity_id);
create index if not exists relay_threads_members on network.relay_threads using gin (members);

create table if not exists network.relay_log (
  app_id      text not null default network.current_app_id() references platform.apps (id),
  id          text not null,
  thread_id   text not null,
  from_member text not null,
  to_member   text not null,
  at          timestamptz not null,
  status      text not null check (status in ('sent', 'held', 'blocked')),
  reason      text,
  body_hash   text not null,
  -- Only while held; a check keeps a sent or blocked row from carrying text.
  body        text,
  -- The first name the recipient saw in front of the text; removed when the sender deletes their data.
  from_name   text,
  primary key (app_id, id),
  check (body is null or status = 'held')
);
create index if not exists relay_log_thread on network.relay_log (app_id, thread_id);
create index if not exists relay_log_held on network.relay_log (app_id, at) where status = 'held';
create index if not exists relay_log_from on network.relay_log (app_id, from_member);

create table if not exists network.contact_shares (
  app_id         text not null default network.current_app_id() references platform.apps (id),
  id             text not null,
  opportunity_id text not null,
  requester      text not null,
  target         text not null,
  status         text not null check (status in ('asked', 'accepted', 'declined', 'sent', 'expired')),
  at             timestamptz not null,
  primary key (app_id, id)
);
create index if not exists contact_shares_opportunity on network.contact_shares (app_id, opportunity_id);

-- Row-level security: the service writes one app per unit of work (app.app_id); each app's console
-- role reads its own app's rows. The held text (relay_log.body) is not granted to the console roles:
-- staff read it through the backend's audited path.
do $$
declare
  t text;
  a text;
begin
  foreach t in array array['relay_threads', 'relay_log', 'contact_shares'] loop
    execute format('alter table network.%I enable row level security', t);
    execute format('alter table network.%I force row level security', t);
    execute format('drop policy if exists service_app on network.%I', t);
    execute format('create policy service_app on network.%I for all to network_service
                    using (app_id = current_setting(''app.app_id'', true))
                    with check (app_id = current_setting(''app.app_id'', true))', t);
    execute format('grant select, insert, update on network.%I to network_service', t);
    execute format('revoke delete, truncate on network.%I from network_service', t);
    execute format('drop policy if exists observatory_ntwrk on network.%I', t);
    execute format('create policy observatory_ntwrk on network.%I for select to network_observatory using (app_id = %L)', t, 'ntwrk');
    foreach a in array array['ntwrk', 'slop', 'peon', 'friends'] loop
      execute format('drop policy if exists %I on network.%I', 'observatory_app_' || a, t);
      execute format('create policy %I on network.%I for select to %I using (app_id = %L)', 'observatory_app_' || a, t, 'network_observatory_' || a, a);
    end loop;
  end loop;
  foreach a in array array['ntwrk', 'slop', 'peon', 'friends'] loop
    execute format('grant select on network.relay_threads, network.contact_shares to %I', 'network_observatory_' || a);
    execute format('grant select (app_id, id, thread_id, from_member, to_member, at, status, reason, body_hash) on network.relay_log to %I', 'network_observatory_' || a);
  end loop;
  grant select on network.relay_threads, network.contact_shares to network_observatory;
  grant select (app_id, id, thread_id, from_member, to_member, at, status, reason, body_hash) on network.relay_log to network_observatory;
end $$;
