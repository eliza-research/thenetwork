-- Profile learning (docs/research/quint-findings/profile_learning.md).
-- SD-170: delete everything removes the membership rows but keeps the person and member rows,
-- so the cascades on the connection cleanup receipts never fire. The receipts hold Cloud user,
-- organization, chat and connection ids. Remove them with the membership row.
create or replace function platform.forget_profile_suggestions() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    delete from platform.profile_suggestion_batches where person_id = old.person_id and app_id = old.app_id;
    delete from platform.profile_suggestion_connection_receipts where person_id = old.person_id and app_id = old.app_id;
    return old;
  elsif new.state = 'removed' then
    delete from platform.profile_suggestion_batches where person_id = new.person_id and app_id = new.app_id;
  end if;
  return new;
end $$;
