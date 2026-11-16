create table platform.calendar_invites (
  app_id text not null,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  member_id text not null,
  phone_hash text not null,
  network_id text not null,
  opportunity_id text not null,
  meeting_at timestamptz not null,
  schedule_revision integer not null check (schedule_revision >= 0),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at and expires_at <= meeting_at),
  primary key (app_id, token_hash),
  foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade
);
create index calendar_invites_expiry on platform.calendar_invites (app_id, expires_at);

alter table platform.calendar_invites enable row level security;
create policy calendar_invites_app on platform.calendar_invites to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on platform.calendar_invites from public;
grant select, insert, delete on platform.calendar_invites to network_service;
