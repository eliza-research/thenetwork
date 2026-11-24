-- Remove app-bound private receipts and incoming photo relay items with the membership.
-- The Network keeps tombstones, so person and member foreign-key cascades do not cover these rows.
create index if not exists profile_suggestion_connection_receipts_owner
  on platform.profile_suggestion_connection_receipts (person_id, app_id);
create index if not exists photo_relay_recipient on platform.photo_relay_items (recipient_person_id, app_id);

create or replace function platform.forget_profile_suggestions() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if new.state <> 'removed' then
      return null;
    end if;
  end if;
  delete from platform.profile_suggestion_batches where person_id=old.person_id and app_id=old.app_id;
  delete from platform.profile_suggestion_connection_receipts where person_id=old.person_id and app_id=old.app_id;
  delete from platform.photo_relay_items where recipient_person_id=old.person_id and app_id=old.app_id;
  return null;
end $$;

-- Erase rows retained by an earlier leave or account deletion.
delete from platform.profile_suggestion_connection_receipts receipt
where not exists (
  select from platform.memberships member
  where member.app_id=receipt.app_id and member.person_id=receipt.person_id and member.state<>'removed'
);
delete from platform.photo_relay_items item
where not exists (
  select from platform.memberships member
  where member.app_id=item.app_id and member.person_id=item.recipient_person_id and member.state<>'removed'
);
