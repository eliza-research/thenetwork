-- The erasure ledger (spec/databaseRestore.md, "An erasure after the backup is replayed"). Each account erasure
-- (people.deleted_at changes from null to a time) appends one row. A new join by the same number revives the
-- tombstone (deleted_at back to null) but keeps the row, so a restore finds every erasure after its backup:
-- a source row that the restored database lacks. The table holds no phone and no number, and nothing
-- updates or deletes it; only the trigger writes it.
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
