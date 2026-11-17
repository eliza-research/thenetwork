create table network.peon_candidate_search_drafts (
  app_id text not null check (app_id = 'peon'),
  member_id text not null,
  reference text not null check (reference ~ '^search_[a-p]{16}$'),
  terms jsonb not null,
  staged_at timestamptz not null,
  primary key (app_id, member_id),
  foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade
);
create index peon_candidate_search_drafts_expiry on network.peon_candidate_search_drafts (app_id, staged_at);

alter table network.peon_candidate_search_drafts enable row level security;
create policy peon_candidate_search_drafts_app on network.peon_candidate_search_drafts to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on network.peon_candidate_search_drafts from public;
grant select, insert, update, delete on network.peon_candidate_search_drafts to network_service;

-- App leave retains a member stub, but no draft.
create function network.erase_peon_search_draft() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    delete from network.peon_candidate_search_drafts where app_id=old.app_id and member_id=old.member_id;
    return old;
  elsif new.state = 'removed' then
    delete from network.peon_candidate_search_drafts where app_id=old.app_id and member_id=old.member_id;
  end if;
  return new;
end $$;
revoke all on function network.erase_peon_search_draft() from public;
create trigger erase_peon_search_draft after update of state or delete on platform.memberships
  for each row execute function network.erase_peon_search_draft();
