-- A batch receipt keeps the original request binding so an expired replay cannot issue new links.
create table platform.seed_invitation_batches (
  app_id text not null references platform.apps(id),
  id text not null check (id ~ '^sib_[0-9a-f]{64}$'),
  issuer_id text not null check (length(issuer_id) > 0),
  body_hash text not null check (body_hash ~ '^[0-9a-f]{64}$'),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  primary key (app_id, id)
);

-- These rows have neither phone numbers nor reusable tokens. Close a link by clearing its private evidence.
create table platform.seed_invitations (
  app_id text not null,
  batch_id text not null,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  ordinal integer not null check (ordinal >= 0),
  home_city text not null check (home_city in ('nyc', 'sf')),
  recipient_hash text check (recipient_hash ~ '^[0-9a-f]{64}$'),
  closed_at timestamptz,
  nonce bytea,
  ciphertext bytea,
  auth_tag bytea,
  primary key (app_id, token_hash),
  unique (app_id, batch_id, ordinal),
  foreign key (app_id, batch_id) references platform.seed_invitation_batches (app_id, id),
  check ((closed_at is null and recipient_hash is not null and nonce is not null and ciphertext is not null
      and auth_tag is not null and octet_length(nonce) = 12 and octet_length(auth_tag) = 16 and octet_length(ciphertext) between 1 and 500)
    or (closed_at is not null and recipient_hash is null and nonce is null and ciphertext is null and auth_tag is null))
);
create index seed_invitation_recipient_lookup on platform.seed_invitations (app_id, recipient_hash) where closed_at is null;
create index seed_invitation_batch_expiration on platform.seed_invitation_batches (app_id, expires_at);

-- Attribution is separate from the member profile and the private invitation record.
create table platform.seed_invitation_attributions (
  app_id text not null,
  member_id text not null,
  batch_id text not null,
  issuer_id text not null,
  home_city text not null check (home_city in ('nyc', 'sf')),
  redeemed_at timestamptz not null,
  welcome_projected_at timestamptz,
  primary key (app_id, member_id),
  foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade,
  foreign key (app_id, batch_id) references platform.seed_invitation_batches (app_id, id),
  check (welcome_projected_at is null or welcome_projected_at >= redeemed_at)
);
create index seed_invitation_welcome_pending on platform.seed_invitation_attributions (app_id, redeemed_at, member_id)
  where welcome_projected_at is null;

alter table platform.seed_invitation_batches enable row level security;
alter table platform.seed_invitations enable row level security;
alter table platform.seed_invitation_attributions enable row level security;

create policy seed_invitation_batches_app on platform.seed_invitation_batches to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
create policy seed_invitations_app on platform.seed_invitations to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
create policy seed_invitation_attributions_app on platform.seed_invitation_attributions to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());

revoke all on platform.seed_invitation_batches, platform.seed_invitations, platform.seed_invitation_attributions from public;
grant select, insert on platform.seed_invitation_batches to network_service;
grant select, insert, update, delete on platform.seed_invitations to network_service;
grant select, insert, update on platform.seed_invitation_attributions to network_service;
