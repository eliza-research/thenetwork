-- Pending source suggestions are private review data, never matching inputs.
create table platform.profile_suggestion_batches (
  id uuid primary key,
  app_id text not null references platform.apps(id),
  person_id uuid not null references platform.people(id) on delete cascade,
  member_id text not null,
  user_id text not null,
  organization_id text not null,
  chat_id text not null,
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  timezone text not null,
  allowed_kinds text[] not null,
  retain_on_disconnect boolean not null,
  check (created_at < expires_at and window_start < window_end),
  unique (app_id, id),
  foreign key (app_id, member_id) references network.members(app_id, id) on delete cascade
);
create table platform.profile_suggestions (
  id uuid primary key,
  batch_id uuid not null references platform.profile_suggestion_batches(id) on delete cascade,
  app_id text not null,
  connection_id text not null,
  source text not null check (source in ('gmail', 'google_calendar')),
  observed_at timestamptz not null,
  kind text not null check (kind in ('interest', 'goal', 'availability_pattern')),
  confidence real not null check (confidence >= 0 and confidence <= 1),
  value text,
  tags text[] not null default '{}',
  original_value_hash text not null,
  privacy_scope text not null check (privacy_scope in ('agent_private', 'matchable')),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'rejected', 'expired', 'withdrawn')),
  fact_id text references network.facets(id) on delete set null,
  foreign key (app_id, batch_id) references platform.profile_suggestion_batches(app_id, id) on delete cascade,
  check ((status = 'proposed' and value is not null) or (status <> 'proposed' and value is null))
);
alter table network.facets add column observed_at timestamptz;

alter table platform.profile_suggestion_batches enable row level security;
alter table platform.profile_suggestions enable row level security;
create policy profile_suggestion_batches_app on platform.profile_suggestion_batches to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
create policy profile_suggestions_app on platform.profile_suggestions to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
grant select, insert, update, delete on platform.profile_suggestion_batches, platform.profile_suggestions to network_service;

-- Removing the review record also removes only its linked derived facts.
create function platform.remove_suggestion_facts() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  delete from network.facets where app_id = old.app_id and id in
    (select fact_id from platform.profile_suggestions where batch_id = old.id and app_id = old.app_id);
  return old;
end $$;
create trigger remove_suggestion_facts before delete on platform.profile_suggestion_batches
  for each row execute function platform.remove_suggestion_facts();

-- The existing app leave/delete path cannot retain these new private records.
create function platform.forget_profile_suggestions() returns trigger language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    delete from platform.profile_suggestion_batches where person_id = old.person_id and app_id = old.app_id;
    return old;
  elsif new.state = 'removed' then
    delete from platform.profile_suggestion_batches where person_id = new.person_id and app_id = new.app_id;
  end if;
  return new;
end $$;
create trigger forget_profile_suggestions after update of state or delete on platform.memberships
  for each row execute function platform.forget_profile_suggestions();
