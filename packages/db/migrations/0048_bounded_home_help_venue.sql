-- Keep exact home-help addresses out of plans, conversations and staff views.
-- A row with no ciphertext records an explicit revocation for this revision.
create table network.bounded_home_help_venue (
  app_id text not null,
  plan_id uuid not null,
  revision integer not null check (revision > 0),
  expires_at timestamptz not null,
  nonce bytea,
  ciphertext bytea,
  auth_tag bytea,
  primary key (app_id, plan_id),
  foreign key (app_id, plan_id) references network.bounded_home_help (app_id, id) on delete cascade,
  check ((nonce is null and ciphertext is null and auth_tag is null)
    or (nonce is not null and ciphertext is not null and auth_tag is not null
      and octet_length(nonce) = 12 and octet_length(auth_tag) = 16 and octet_length(ciphertext) between 1 and 300))
);

create index bounded_home_help_venue_expiry on network.bounded_home_help_venue (app_id, expires_at);

alter table network.bounded_home_help_venue enable row level security;
create policy bounded_home_help_venue_app on network.bounded_home_help_venue to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on network.bounded_home_help_venue from public;
grant select, insert, update, delete on network.bounded_home_help_venue to network_service;

create function network.forget_stale_home_help_venue() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.phase <> 'Approved' or old.revision is distinct from new.revision
    or old.helper_ids is distinct from new.helper_ids or old.requester_id is distinct from new.requester_id
    or (old.task,old.area,old.alternative,old.effort_minutes,old.starts_at,old.ends_at,old.expires_at)
      is distinct from (new.task,new.area,new.alternative,new.effort_minutes,new.starts_at,new.ends_at,new.expires_at)
    or old.approved_at is distinct from new.approved_at or old.approved_by is distinct from new.approved_by then
    delete from network.bounded_home_help_venue where app_id = old.app_id and plan_id = old.id;
  end if;
  return new;
end $$;
revoke all on function network.forget_stale_home_help_venue() from public;
-- PostgreSQL runs matching triggers in name order. Clear consent rows before the venue row.
create trigger forget_stale_home_help_venue after update on network.bounded_home_help
  for each row execute function network.forget_stale_home_help_venue();

create function network.clear_unaccepted_home_help_venue() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.phase in ('Declined', 'Withdrawn', 'Cancelled') and old.phase is distinct from new.phase then
    update network.bounded_home_help_venue set nonce=null, ciphertext=null, auth_tag=null
      where app_id=new.app_id and plan_id=new.plan_id and revision=new.revision;
  end if;
  return new;
end $$;
revoke all on function network.clear_unaccepted_home_help_venue() from public;
create trigger clear_unaccepted_home_help_venue after update of phase on network.bounded_home_help_consent
  for each row execute function network.clear_unaccepted_home_help_venue();
