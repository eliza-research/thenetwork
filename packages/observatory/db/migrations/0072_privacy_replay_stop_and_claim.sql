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
