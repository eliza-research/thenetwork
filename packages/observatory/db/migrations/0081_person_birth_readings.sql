alter table platform.people
  add column birth_date int check (birth_date is null or birth_date between 19000101 and 99991231),
  add column birth_lower int,
  add column birth_upper int check (birth_upper is null or birth_upper between 0 and 99991231),
  add column birth_youngest int check (birth_youngest is null or birth_youngest between 0 and 99991231),
  add column birth_first_exact boolean,
  add check ((birth_upper is null) = (birth_youngest is null) and (birth_upper is null) = (birth_lower is null)),
  add check (birth_date is null or birth_upper is not null);

alter table platform.age_floor
  add column birth_lower int,
  add column birth_upper int,
  add column birth_youngest int,
  add column birth_first_exact boolean,
  add check ((birth_upper is null) = (birth_youngest is null) and (birth_upper is null) = (birth_lower is null));

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'network_observatory_cross_app') then
    revoke select on platform.people from network_observatory_cross_app;
    grant select (id, lowest_age, age_verified_at, created_at, deleted_at, phone_hash) on platform.people to network_observatory_cross_app;
  end if;
end $$;

alter table platform.pending_texts add column birth_date int check (birth_date is null or birth_date between 19000101 and 99991231);

create table platform.teen_pool_bars (
  phone_hash text primary key,
  reason text not null check (reason in ('conflict','report','older_than_stated','ban')),
  at timestamptz not null
);
revoke all on platform.teen_pool_bars from public;
grant select, insert, update, delete on platform.teen_pool_bars to network_service;
grant select, insert on platform.teen_pool_bars to platform_service;

update platform.people
  set birth_lower = to_char((created_at at time zone 'UTC') - interval '12 hours', 'YYYYMMDD')::int - (lowest_age + 1) * 10000,
      birth_upper = to_char((now() at time zone 'UTC') - interval '12 hours', 'YYYYMMDD')::int - lowest_age * 10000,
      birth_youngest = to_char((now() at time zone 'UTC') - interval '12 hours', 'YYYYMMDD')::int - lowest_age * 10000,
      birth_first_exact = false
  where lowest_age is not null and birth_upper is null;

update platform.age_floor f
  set birth_lower = to_char((f.at at time zone 'UTC') - interval '12 hours', 'YYYYMMDD')::int - (f.lowest_age + 1) * 10000,
      birth_upper = to_char((f.at at time zone 'UTC') - interval '12 hours', 'YYYYMMDD')::int - f.lowest_age * 10000,
      birth_youngest = to_char((f.at at time zone 'UTC') - interval '12 hours', 'YYYYMMDD')::int - f.lowest_age * 10000
  where f.birth_upper is null;

insert into platform.teen_pool_bars (phone_hash, reason, at)
  select distinct on (b.phone_hash) b.phone_hash, 'ban', b.at from platform.bans b
  where b.phone_hash is not null order by b.phone_hash, b.at
  on conflict (phone_hash) do nothing;

insert into platform.teen_pool_bars (phone_hash, reason, at)
  select distinct on (p.phone_hash) p.phone_hash, 'ban', b.at from platform.bans b join platform.people p on p.id = b.person_id
  where b.scope = 'person' and p.phone_hash is not null order by p.phone_hash, b.at
  on conflict (phone_hash) do nothing;
