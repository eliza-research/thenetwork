-- Replay receipts contain scope/identity only; never source text, tokens, raw proofs or history.
create table platform.profile_suggestion_connection_receipts (
  request_nonce uuid primary key,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  event_id text not null check (length(event_id) between 1 and 128),
  operation text not null check (operation in ('disconnect','delete','readback')),
  app_id text not null references platform.apps(id),
  person_id uuid not null references platform.people(id) on delete cascade,
  member_id text not null,
  user_id text not null,
  organization_id text not null,
  chat_id text not null,
  connection_id text not null,
  revoked_at timestamptz not null,
  created_at timestamptz not null default now(),
  foreign key(app_id,member_id) references network.members(app_id,id) on delete cascade
);
alter table platform.profile_suggestion_connection_receipts enable row level security;
create policy profile_suggestion_connection_receipts_app on platform.profile_suggestion_connection_receipts to network_service
  using(app_id=network.current_app_id()) with check(app_id=network.current_app_id());
grant select,insert on platform.profile_suggestion_connection_receipts to network_service;
