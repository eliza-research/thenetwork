-- The privacy replay of a restore after review (spec/databaseRestore.md, "A STOP after the backup is replayed on
-- each membership it still covers" and "The backend runs the queued replay at start, and each item by one runner
-- until it holds"):
--  1. kind 'stop': a STOP after the backup, for one membership (app_id and member_id), like a leave.
--  2. claimed_until: a runner claims an item until this time, so two runners never run one item.
--  3. outcome without replayed_at: the last result of an item that could not run yet (held, no phone, refused).
--     It stays open and the next start or staff replay retries it.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'platform.privacy_replay'::regclass and contype = 'c' loop
    execute format('alter table platform.privacy_replay drop constraint %I', c.conname);
  end loop;
end $$;

alter table platform.privacy_replay add column if not exists claimed_until timestamptz;
alter table platform.privacy_replay add constraint privacy_replay_kind check (kind in ('erase', 'leave', 'stop', 'ban'));
alter table platform.privacy_replay add constraint privacy_replay_membership
  check ((kind in ('leave', 'stop')) = (app_id is not null and member_id is not null));
alter table platform.privacy_replay add constraint privacy_replay_done check (replayed_at is null or outcome is not null);
create index if not exists privacy_replay_open on platform.privacy_replay (id) where replayed_at is null;
