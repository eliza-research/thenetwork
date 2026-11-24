-- Delivery and responses for the requester and each helper on one reviewed revision.
create table network.bounded_home_help_consent (
  app_id text not null,
  plan_id uuid not null,
  revision integer not null check (revision > 0),
  recipient_id text not null,
  notice_id uuid not null unique default gen_random_uuid(),
  phase text not null check (phase in ('Pending', 'Sent', 'Accepted', 'Declined', 'Withdrawn', 'Cancelled')),
  sent_at timestamptz,
  answered_at timestamptz,
  primary key (app_id, plan_id, revision, recipient_id),
  foreign key (app_id, plan_id) references network.bounded_home_help(app_id,id) on delete cascade,
  foreign key (app_id, recipient_id) references network.members(app_id,id) on delete cascade,
  check ((phase = 'Pending' and sent_at is null and answered_at is null)
    or (phase = 'Sent' and sent_at is not null and answered_at is null)
    or (phase in ('Accepted','Declined','Withdrawn') and sent_at is not null and answered_at is not null and answered_at >= sent_at)
    or phase = 'Cancelled')
);

create index bounded_home_help_consent_recipient on network.bounded_home_help_consent(app_id, recipient_id, phase);
alter table network.bounded_home_help_consent enable row level security;
create policy bounded_home_help_consent_app on network.bounded_home_help_consent to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on network.bounded_home_help_consent from public;
grant select, insert, update, delete on network.bounded_home_help_consent to network_service;

-- A changed plan cannot reuse a delivery or decision from any earlier revision.
create function network.forget_stale_home_help_consent() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.revision is distinct from old.revision or new.phase <> 'Approved'
    or new.helper_ids is distinct from old.helper_ids or new.requester_id is distinct from old.requester_id
    or (new.task,new.area,new.alternative,new.effort_minutes,new.starts_at,new.ends_at,new.expires_at)
      is distinct from (old.task,old.area,old.alternative,old.effort_minutes,old.starts_at,old.ends_at,old.expires_at)
    or new.approved_at is distinct from old.approved_at or new.approved_by is distinct from old.approved_by then
    delete from network.bounded_home_help_consent where app_id = old.app_id and plan_id = old.id;
  end if;
  return new;
end $$;
revoke all on function network.forget_stale_home_help_consent() from public;
create trigger forget_stale_home_help_consent after update on network.bounded_home_help
  for each row execute function network.forget_stale_home_help_consent();
