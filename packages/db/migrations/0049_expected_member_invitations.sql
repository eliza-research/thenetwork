-- Bind a service-sent invitation to one verified phone without saving its number.
alter table platform.member_invitations add column expected_recipient_hash text
  check (expected_recipient_hash ~ '^[0-9a-f]{64}$');

-- Keep the pending request sealed until confirmation and queue admission commit together.
create table platform.expected_member_invitations (
  app_id text not null,
  token_hash text not null,
  challenge_hash text not null check (challenge_hash ~ '^[0-9a-f]{64}$'),
  staged_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > staged_at),
  queued_at timestamptz,
  attempted_at timestamptz,
  body_hash text check (body_hash ~ '^[0-9a-f]{64}$'),
  nonce bytea,
  ciphertext bytea,
  auth_tag bytea,
  primary key (app_id, token_hash),
  unique (app_id, challenge_hash),
  foreign key (app_id, token_hash) references platform.member_invitations (app_id, token_hash) on delete cascade,
  check (attempted_at is null or (queued_at is not null and attempted_at >= queued_at)),
  check ((queued_at is null and body_hash is null and nonce is not null and ciphertext is not null and auth_tag is not null
      and octet_length(nonce) = 12 and octet_length(ciphertext) between 1 and 240 and octet_length(auth_tag) = 16)
    or (queued_at is not null and queued_at >= staged_at and queued_at < expires_at and body_hash is not null
      and nonce is null and ciphertext is null and auth_tag is null))
);

create index expected_member_invitations_pending_expiry on platform.expected_member_invitations (app_id, expires_at)
  where queued_at is null;
alter table platform.expected_member_invitations enable row level security;
create policy expected_member_invitations_app on platform.expected_member_invitations to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on platform.expected_member_invitations from public;
grant select, insert, update, delete on platform.expected_member_invitations to network_service;

-- The shared line consults the same rolling guard across all apps. It holds only keyed digests and times.
create table platform.expected_invitation_contacts (
  recipient_hash text primary key check (recipient_hash ~ '^[0-9a-f]{64}$'),
  reserved_at timestamptz not null,
  attempted_at timestamptz,
  declined_at timestamptz,
  check (declined_at is null or (attempted_at is not null and declined_at >= attempted_at))
);

create index expected_invitation_contacts_expiry on platform.expected_invitation_contacts (reserved_at) where declined_at is null;
revoke all on platform.expected_invitation_contacts from public;
grant select, insert, update, delete on platform.expected_invitation_contacts to network_service;
