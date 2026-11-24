alter table platform.profile_suggestions add column if not exists source_authorized_at timestamptz;
update platform.profile_suggestions s set source_authorized_at=b.created_at
  from platform.profile_suggestion_batches b where b.id=s.batch_id and s.source_authorized_at is null;
alter table platform.profile_suggestions alter column source_authorized_at set not null;
