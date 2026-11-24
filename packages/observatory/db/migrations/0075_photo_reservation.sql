do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'platform' and table_name = 'photos' and column_name = 'stored_at') then
    alter table platform.photos add column stored_at timestamptz;
    update platform.photos set stored_at = created_at;
  end if;
end $$;
alter table platform.photos alter column stored_at set default now();
create index if not exists photos_unfinished on platform.photos (coalesce(deleted_at, created_at), id) where stored_at is null or deleted_at is not null;
