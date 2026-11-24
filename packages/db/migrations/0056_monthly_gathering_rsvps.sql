create table network.monthly_gathering_rsvps (
  app_id text not null,
  gathering_id uuid not null,
  member_id text not null,
  revision integer not null check (revision > 0),
  choice text not null check (choice in ('attending', 'grouping', 'withdrawn')),
  response_id text not null,
  responded_at timestamptz not null,
  primary key (app_id, gathering_id, member_id),
  foreign key (app_id, gathering_id) references network.monthly_gatherings (app_id, id) on delete cascade,
  foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade
);
create index monthly_gathering_rsvps_member on network.monthly_gathering_rsvps (app_id, member_id);

alter table network.monthly_gathering_rsvps enable row level security;
create policy monthly_gathering_rsvps_app on network.monthly_gathering_rsvps to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on network.monthly_gathering_rsvps from public;
grant select, insert, update, delete on network.monthly_gathering_rsvps to network_service;

create function platform.forget_monthly_gathering_rsvp() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op = 'UPDATE' and new.state <> 'removed' then return null; end if;
  delete from network.monthly_gathering_rsvps where app_id=old.app_id and member_id=old.member_id;
  return null;
end $$;

create trigger forget_monthly_gathering_rsvp after update of state or delete on platform.memberships
  for each row execute function platform.forget_monthly_gathering_rsvp();
