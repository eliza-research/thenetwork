-- Durable gateway turn claims. An unfinished claim is never replayed as new work.
-- Request text and phone are not retained here; replies contain only that sender's output.
create table platform.service_turns (
  id text primary key,
  channel text not null check (channel in ('blooio', 'twilio')),
  message_id text not null,
  request_hash text not null,
  sender_hash text not null,
  state text not null check (state in ('processing', 'completed', 'unresolved')),
  response jsonb,
  receipt_hash text,
  receipt jsonb,
  created_at timestamptz not null,
  completed_at timestamptz,
  unique (channel, message_id),
  check ((state = 'completed') = (response is not null))
);
create table platform.service_turn_replies (
  turn_id text not null references platform.service_turns(id),
  reply_id text not null,
  ordinal bigserial not null,
  app_id text not null references platform.apps(id),
  body text not null,
  kind text not null check (kind in ('reply', 'compliance')),
  status text not null default 'collected' check (status in ('collected', 'sent', 'send_unknown', 'refused_gateway')),
  primary key (turn_id, reply_id)
);
alter table network.messages add column service_turn_id text references platform.service_turns(id);
revoke all on platform.service_turns, platform.service_turn_replies from public;
grant select, insert, update on platform.service_turns, platform.service_turn_replies to network_service;
grant usage, select on sequence platform.service_turn_replies_ordinal_seq to network_service;

-- A scheduled state is part of the canonical member record. The existing
-- participation_state remains the base outside the scheduled window.
alter table network.members add column participation_window jsonb;

-- Action receipts contain no second member state. State/signals completion
-- commits in the existing Network unit transaction; updates may fail unresolved.
create table platform.service_actions (
  id text primary key,
  turn_id text not null references platform.service_turns(id),
  operation text not null check (operation in ('/internal/set-state', '/internal/signals', '/internal/updates')),
  request_hash text not null,
  state text not null check (state in ('processing', 'completed', 'unresolved')),
  response jsonb,
  created_at timestamptz not null,
  check ((state = 'completed') = (response is not null))
);
revoke all on platform.service_actions from public;
grant select, insert, update on platform.service_actions to network_service;

-- Erase collected content while retaining opaque replay fences. Both canonical
-- lifecycle owners use this function; platform callers see only selector columns.
create function platform.scrub_service_turns(ids text[]) returns void
language sql volatile security definer set search_path = pg_catalog, platform as $$
  update platform.service_turns set
    response = case when state = 'completed' then '{"outcome":"ignored","reason":"membership_removed"}'::jsonb else null end,
    state = case when state = 'completed' then 'completed' else 'unresolved' end,
    receipt = null, receipt_hash = null
    where id = any(ids);
  delete from platform.service_turn_replies where turn_id = any(ids);
  update platform.service_actions set state = 'unresolved', response = null where turn_id = any(ids);
$$;
revoke all on function platform.scrub_service_turns(text[]) from public;
grant execute on function platform.scrub_service_turns(text[]) to platform_service, network_service;
grant select (id, sender_hash) on platform.service_turns to platform_service;

-- A deletion that seals an in-flight claim also fences its later reply writes.
create function platform.check_service_reply_claim() returns trigger
language plpgsql set search_path = pg_catalog, platform as $$
begin
  perform 1 from platform.service_turns where id = new.turn_id and state = 'processing' for share;
  if not found then raise exception 'service turn is no longer processing'; end if;
  return new;
end $$;
create trigger service_reply_claim before insert on platform.service_turn_replies
for each row execute function platform.check_service_reply_claim();

-- Preserve the exact dispatch payload for read-only reconciliation after restart.
alter table network.messages add column outbound_to text;
alter table network.messages add column outbound_kind text;
alter table network.messages add column receipt_checked_at timestamptz;

-- Provider acceptance and its idempotent inbox projection are separate receipts.
alter table network.messages add column accepted_at timestamptz;
alter table network.messages add column notification_recorded_at timestamptz;
