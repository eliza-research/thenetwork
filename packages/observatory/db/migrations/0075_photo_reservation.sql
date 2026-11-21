-- 0075: photo rows are reserved before the bytes are written (spec/photoRetention.md, "Reserve the photo row
-- under the person lock before the bytes"). stored_at is null while the row is reserved and is set when the
-- bytes are stored; deleted_at marks a row that a removal has hidden until the bytes, the rating and the row
-- are gone. Rows from before this migration are stored photos. The column defaults to now() so that a
-- writer that does not name it (an older instance during a rolling deploy, a fixture) writes a stored photo;
-- the reserve path writes null explicitly. Idempotent: the backfill runs only when the column is added.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'platform' and table_name = 'photos' and column_name = 'stored_at') then
    alter table platform.photos add column stored_at timestamptz;
    update platform.photos set stored_at = created_at;
  end if;
end $$;
alter table platform.photos alter column stored_at set default now();
create index if not exists photos_unfinished on platform.photos (coalesce(deleted_at, created_at), id) where stored_at is null or deleted_at is not null;
