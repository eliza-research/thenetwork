create table if not exists platform.erasure_ledger (
  id        bigserial primary key,
  person_id uuid not null references platform.people (id),
  erased_at timestamptz not null
);
create index if not exists erasure_ledger_person on platform.erasure_ledger (person_id);

create or replace function platform.record_erasure() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    insert into platform.erasure_ledger (person_id, erased_at) values (new.id, new.deleted_at);
  end if;
  return null;
end $$;

revoke all on function platform.record_erasure() from public;
drop trigger if exists record_erasure on platform.people;
create trigger record_erasure after update of deleted_at on platform.people
  for each row execute function platform.record_erasure();

revoke all on platform.erasure_ledger from public;
grant select on platform.erasure_ledger to network_service, platform_service;
