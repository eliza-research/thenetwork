update platform.profile_suggestions s set source_authorized_at='epoch'
  from platform.profile_suggestion_batches b
  where b.id=s.batch_id and b.app_id=s.app_id and s.source_authorized_at=b.created_at
    and b.created_at < (select m.applied_at from public.__migrations m where m.id='0076_profile_suggestion_source_time');
