-- One app-scoped pending edit. The signed alias hides the facet's original ID and value.
create table platform.profile_fact_edit_drafts (
  app_id text not null,
  member_id text not null,
  fact_reference text not null check (fact_reference ~ '^pfr_[a-p]{32}$'),
  challenge_hash text not null check (challenge_hash ~ '^[0-9a-f]{64}$'),
  staged_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > staged_at),
  nonce bytea not null check (octet_length(nonce) = 12),
  ciphertext bytea not null check (octet_length(ciphertext) between 1 and 1024),
  auth_tag bytea not null check (octet_length(auth_tag) = 16),
  primary key (app_id, member_id),
  foreign key (app_id, member_id) references network.members (app_id, id) on delete cascade
);
create index profile_fact_edit_drafts_expiry on platform.profile_fact_edit_drafts (app_id, expires_at);

alter table platform.profile_fact_edit_drafts enable row level security;
create policy profile_fact_edit_drafts_app on platform.profile_fact_edit_drafts to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on platform.profile_fact_edit_drafts from public;
grant select, insert, update, delete on platform.profile_fact_edit_drafts to network_service;

-- The member row can remain as a stub after app leave. Its private draft cannot.
create function platform.forget_profile_fact_edit_draft() returns trigger
language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    delete from platform.profile_fact_edit_drafts where app_id=old.app_id and member_id=old.member_id;
    return old;
  elsif new.state = 'removed' then
    delete from platform.profile_fact_edit_drafts where app_id=old.app_id and member_id=old.member_id;
  end if;
  return new;
end $$;
revoke all on function platform.forget_profile_fact_edit_draft() from public;
create trigger forget_profile_fact_edit_draft after update of state or delete on platform.memberships
  for each row execute function platform.forget_profile_fact_edit_draft();
