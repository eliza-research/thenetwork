-- 0015: the persisted Blooio queue for the shared line (mvp-plan critical path 3; audit network-service-2,
-- network-service-7, network-service-12). Runs once (public.__migrations), after 0014.
--
-- platform.outbound is the outbound queue. The service writes a row in the same transaction as the
-- Network state and the network.messages row (the unit of work). A worker delivers it after the commit,
-- with the row id as the provider's idempotency key ("tn:<id>"), retries with backoff, and holds a lease
-- while it calls the provider. After a crash, a row whose lease ran out is sent again with the same key,
-- so Blooio sends it once. The line is shared by every app, so the queue and its counters are in the
-- platform schema (one app per transaction does not apply here). Nothing reads another app's text:
-- the drain of one app reads its own rows; the counters hold ids, times and counts only.
--
-- platform.line_conversations keeps the Apple line-safety counters per line and address (the unanswered
-- streak, the one re-engagement, the first and last send). platform.line_safety keeps Blooio's safety
-- state per line. platform.inbound is the inbound inbox: the provider message id is the key (a retried or
-- replayed webhook is a duplicate), and the messages of one sender are handled in the order they were
-- received. A row keeps the event only until it is handled.

create table if not exists platform.outbound (
  id                  text primary key,
  app_id              text not null references platform.apps (id),
  -- null: a fixed text to someone who is not a member here (a join question, a decline, a keyword reply).
  member_id           text,
  line                text not null,
  -- E.164 or an Apple ID. Set to null when a row to a non-member ends, or when the member is forgotten.
  to_address          text,
  kind                text not null check (kind in ('reply', 'compliance', 'proactive', 'transactional')),
  body                text,
  media_urls          text[] not null default '{}',
  -- sha256 of the address, the text, the media and the kind: the same id with other content is an error.
  fingerprint         text not null,
  opportunity_id      text,
  time_zone           text not null,
  status              text not null,
  attempts            int not null default 0,
  next_attempt_at     timestamptz not null,
  created_at          timestamptz not null,
  updated_at          timestamptz not null,
  lease_owner         text,
  lease_until         timestamptz,
  -- The worker stopped during a provider call: the row was sent again with the same key.
  in_doubt            boolean not null default false,
  provider_message_id text unique,
  chat_id             text,
  transport           text,
  new_conversation    boolean not null default false,
  reengagement        boolean not null default false,
  person_cap          boolean not null default false,
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  ended_at            timestamptz,
  last_error          text,
  note                text
);
create index if not exists outbound_due on platform.outbound (line, app_id, next_attempt_at)
  where status in ('pending', 'retry_scheduled', 'deferred_quiet_hours');
create index if not exists outbound_sending on platform.outbound (lease_until) where status = 'sending';
create index if not exists outbound_held on platform.outbound (line, to_address) where status = 'held_awaiting_reply';
create index if not exists outbound_sent on platform.outbound (line, sent_at) where sent_at is not null;
create index if not exists outbound_member on platform.outbound (app_id, member_id);

create table if not exists platform.line_conversations (
  line              text not null,
  address           text not null,
  unanswered        int not null default 0,
  reengagement_used boolean not null default false,
  first_outbound_at timestamptz,
  last_outbound_at  timestamptz,
  last_inbound_at   timestamptz,
  primary key (line, address)
);

create table if not exists platform.line_safety (
  line       text primary key,
  action     text not null,
  event_type text,
  at         timestamptz not null
);

create sequence if not exists platform.inbound_handled_seq;
create table if not exists platform.inbound (
  id            text primary key,
  line          text,
  -- The sender only while the row waits (ordering per sender); null after it is handled.
  sender        text,
  received_at   timestamptz not null,
  arrived_at    timestamptz not null,
  event         jsonb,
  status        text not null check (status in ('pending', 'done', 'failed')),
  attempts      int not null default 0,
  outcome       text,
  handled_at    timestamptz,
  handled_order bigint
);
create index if not exists inbound_pending on platform.inbound (sender, received_at, id) where status = 'pending';

grant select, insert, update, delete on platform.outbound, platform.line_conversations, platform.line_safety, platform.inbound to platform_service;
grant usage on sequence platform.inbound_handled_seq to platform_service;

-- In production, refuse the fictional 555-01xx numbers here too (the 0003 guard reads e164 or line_e164).
create or replace function platform.refuse_synthetic_outbound() returns trigger language plpgsql as $$
begin
  if (new.to_address ~ '^\+1[0-9]{3}55501[0-9]{2}$' or new.line ~ '^\+1[0-9]{3}55501[0-9]{2}$')
     and (select value from platform.settings where key = 'environment') = 'production' then
    raise exception 'synthetic phone refused in production';
  end if;
  return new;
end $$;
drop trigger if exists outbound_synthetic on platform.outbound;
create trigger outbound_synthetic before insert on platform.outbound
  for each row execute function platform.refuse_synthetic_outbound();
