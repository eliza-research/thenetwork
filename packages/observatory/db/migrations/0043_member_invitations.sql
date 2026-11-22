-- Member invitations hold private evidence, separate from matching and public signup data.
create table platform.member_invitations (
  app_id text not null references platform.apps(id),
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  inviter_member_id text not null,
  relationship text not null check (relationship in ('friend', 'coworker', 'roommate', 'family')),
  issued_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > issued_at),
  redeemed_member_id text,
  redeemed_at timestamptz,
  projected_at timestamptz,
  primary key (app_id, token_hash),
  foreign key (app_id, inviter_member_id) references network.members(app_id, id) on delete cascade,
  foreign key (app_id, redeemed_member_id) references network.members(app_id, id) on delete cascade,
  check ((redeemed_member_id is null) = (redeemed_at is null)),
  check (projected_at is null or redeemed_at is not null),
  check (redeemed_member_id is distinct from inviter_member_id)
);

create unique index member_invitations_one_attribution
  on platform.member_invitations (app_id, redeemed_member_id) where redeemed_member_id is not null;
create index member_invitations_expiry on platform.member_invitations (app_id, expires_at);
create index member_invitations_inviter on platform.member_invitations (app_id, inviter_member_id);

alter table platform.member_invitations enable row level security;
create policy member_invitations_app on platform.member_invitations to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on platform.member_invitations from public;
grant select, insert, update, delete on platform.member_invitations to network_service;

-- A send that discloses a verified join can be rechecked without parsing its text.
alter table network.messages add column invite_join_members text[];
