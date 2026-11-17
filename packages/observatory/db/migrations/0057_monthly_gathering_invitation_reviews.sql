alter table network.monthly_gatherings add unique (app_id, id, revision);

create table network.monthly_gathering_invitation_reviews (
  app_id text not null check (app_id = 'ntwrk'),
  gathering_id uuid not null,
  revision integer not null check (revision > 0),
  selection_hash text not null check (selection_hash ~ '^[0-9a-f]{64}$'),
  recipient_count integer not null check (recipient_count between 0 and 150),
  reviewed_by text not null,
  reviewed_at timestamptz not null check (isfinite(reviewed_at)),
  primary key (app_id, gathering_id, revision),
  foreign key (app_id, gathering_id, revision) references network.monthly_gatherings (app_id, id, revision) on delete cascade
);

create table network.monthly_gathering_invitees (
  app_id text not null,
  gathering_id uuid not null,
  revision integer not null,
  member_id text not null,
  position integer not null check (position between 1 and 150),
  primary key (app_id, gathering_id, revision, member_id),
  unique (app_id, gathering_id, revision, position),
  foreign key (app_id, gathering_id, revision) references network.monthly_gathering_invitation_reviews (app_id, gathering_id, revision) on delete cascade,
  foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade
);
create index monthly_gathering_invitees_member on network.monthly_gathering_invitees (app_id, member_id);

alter table network.monthly_gathering_invitation_reviews enable row level security;
alter table network.monthly_gathering_invitees enable row level security;
create policy monthly_gathering_invitation_reviews_app on network.monthly_gathering_invitation_reviews to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
create policy monthly_gathering_invitees_app on network.monthly_gathering_invitees to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on network.monthly_gathering_invitation_reviews, network.monthly_gathering_invitees from public;
grant select, insert on network.monthly_gathering_invitation_reviews, network.monthly_gathering_invitees to network_service;

create function platform.forget_monthly_gathering_invitee() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op = 'UPDATE' and new.state <> 'removed' then return null; end if;
  delete from network.monthly_gathering_invitees where app_id=old.app_id and member_id=old.member_id;
  return null;
end $$;

revoke all on function platform.forget_monthly_gathering_invitee() from public;
create trigger forget_monthly_gathering_invitee after update of state or delete on platform.memberships
  for each row execute function platform.forget_monthly_gathering_invitee();
