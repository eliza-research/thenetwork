create table network.monthly_gathering_grouping_reviews (
  app_id text not null check (app_id = 'ntwrk'),
  gathering_id uuid not null,
  revision integer not null check (revision > 0),
  review_id uuid not null,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  group_count integer not null check (group_count between 1 and 50),
  member_count integer not null check (member_count between 3 and 150),
  reviewed_by text not null,
  reviewed_at timestamptz not null check (isfinite(reviewed_at)),
  superseded_at timestamptz check (superseded_at is null or (isfinite(superseded_at) and superseded_at >= reviewed_at)),
  primary key (app_id, gathering_id, revision, review_id),
  foreign key (app_id, gathering_id, revision) references network.monthly_gatherings (app_id, id, revision) on delete cascade,
  check (group_count * 3 <= member_count and member_count <= group_count * 5)
);
create unique index monthly_gathering_current_grouping on network.monthly_gathering_grouping_reviews (app_id, gathering_id, revision)
  where superseded_at is null;

create table network.monthly_gathering_group_members (
  app_id text not null,
  gathering_id uuid not null,
  revision integer not null,
  review_id uuid not null,
  group_no integer not null check (group_no between 1 and 50),
  member_id text not null,
  primary key (app_id, gathering_id, revision, review_id, member_id),
  foreign key (app_id, gathering_id, revision, review_id) references network.monthly_gathering_grouping_reviews (app_id, gathering_id, revision, review_id) on delete cascade,
  foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade
);
create index monthly_gathering_group_members_member on network.monthly_gathering_group_members (app_id, member_id);

alter table network.monthly_gathering_grouping_reviews enable row level security;
alter table network.monthly_gathering_group_members enable row level security;
create policy monthly_gathering_grouping_reviews_app on network.monthly_gathering_grouping_reviews to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
create policy monthly_gathering_group_members_app on network.monthly_gathering_group_members to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on network.monthly_gathering_grouping_reviews, network.monthly_gathering_group_members from public;
grant select, insert on network.monthly_gathering_grouping_reviews, network.monthly_gathering_group_members to network_service;
grant update (superseded_at) on network.monthly_gathering_grouping_reviews to network_service;

create function platform.forget_monthly_gathering_group_member() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op = 'UPDATE' and new.state <> 'removed' then return null; end if;
  delete from network.monthly_gathering_group_members where app_id=old.app_id and member_id=old.member_id;
  return null;
end $$;

revoke all on function platform.forget_monthly_gathering_group_member() from public;
create trigger forget_monthly_gathering_group_member after update of state or delete on platform.memberships
  for each row execute function platform.forget_monthly_gathering_group_member();
