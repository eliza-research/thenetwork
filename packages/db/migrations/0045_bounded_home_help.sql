-- Home-help plans store safe task metadata and the reviewed roster.
create table network.bounded_home_help (
  app_id text not null,
  id uuid not null,
  requester_id text not null,
  phase text not null check (phase in ('AwaitingHelpers', 'AwaitingReview', 'Approved', 'Closed')),
  revision integer not null check (revision > 0),
  task text not null check (task in ('MoveFurniture', 'CarryBoxes')),
  area text not null,
  alternative text not null check (alternative in ('NoSuitableService', 'ServiceUnavailable', 'MemberDeclinedService')),
  effort_minutes integer not null check (effort_minutes > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  expires_at timestamptz not null,
  helper_ids text[] not null default '{}',
  approved_by text,
  approved_at timestamptz,
  primary key (app_id, id),
  foreign key (app_id, requester_id) references network.members(app_id, id) on delete cascade,
  check (expires_at <= starts_at and extract(epoch from ends_at - starts_at) >= effort_minutes::bigint * 60),
  check ((phase in ('AwaitingHelpers', 'Closed') and cardinality(helper_ids) = 0)
    or (phase in ('AwaitingReview', 'Approved') and cardinality(helper_ids) between 1 and 3)),
  check (array_position(helper_ids, requester_id) is null and array_position(helper_ids, null) is null),
  check ((phase = 'Approved' and approved_at is not null and approved_by is not null and approved_at < expires_at)
    or (phase <> 'Approved' and approved_at is null and approved_by is null))
);

create index bounded_home_help_review on network.bounded_home_help(app_id, expires_at, id)
  where phase in ('AwaitingHelpers', 'AwaitingReview');
create index bounded_home_help_requester on network.bounded_home_help(app_id, requester_id);

alter table network.bounded_home_help enable row level security;
create policy bounded_home_help_app on network.bounded_home_help to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on network.bounded_home_help from public;
grant select, insert, update, delete on network.bounded_home_help to network_service;

-- The canonical membership forget path also removes a plan that names an erased helper.
create function network.forget_bounded_home_help() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    delete from network.bounded_home_help where app_id = old.app_id
      and (requester_id = old.member_id or old.member_id = any(helper_ids));
    return old;
  end if;
  if new.state = 'removed' and old.state is distinct from new.state then
    delete from network.bounded_home_help where app_id = old.app_id
      and (requester_id = old.member_id or old.member_id = any(helper_ids));
  end if;
  return new;
end $$;
revoke all on function network.forget_bounded_home_help() from public;
create trigger forget_bounded_home_help after update of state or delete on platform.memberships
  for each row execute function network.forget_bounded_home_help();
