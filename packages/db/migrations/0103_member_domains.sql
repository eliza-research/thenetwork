-- 0103: unified member domains (dating, friendship, business) with idempotent backfill from platform.memberships.
-- Safe to run more than once on fresh or upgraded databases.

create table if not exists platform.member_domains (
  person_id    uuid not null references platform.people (id) on delete cascade,
  domain       text not null check (domain in ('dating', 'friendship', 'business')),
  enabled      boolean not null default true,
  origin_brand text not null default 'ntwrk' check (origin_brand in ('ntwrk', 'slop', 'peon', 'friends')),
  source       text not null default 'onboarding',
  enabled_at   timestamptz not null default now(),
  disabled_at  timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (person_id, domain)
);

create index if not exists idx_member_domains_domain_enabled
  on platform.member_domains (domain, enabled) where enabled = true;

-- Backfill single-domain app memberships (slop -> dating, peon -> business, friends -> friendship).
insert into platform.member_domains (
  person_id, domain, enabled, origin_brand, source, enabled_at, disabled_at, updated_at
)
select
  m.person_id,
  case m.app_id
    when 'slop' then 'dating'
    when 'peon' then 'business'
    when 'friends' then 'friendship'
  end as domain,
  (m.state <> 'paused') as enabled,
  m.app_id as origin_brand,
  'migration_0103' as source,
  coalesce(m.joined_at, now()) as enabled_at,
  case when m.state = 'paused' then now() else null end as disabled_at,
  now() as updated_at
from platform.memberships m
where m.app_id in ('slop', 'peon', 'friends')
  and m.state in ('active', 'onboarding', 'paused')
on conflict (person_id, domain) do nothing;

-- Backfill ntwrk-only members with friendship when no domain row exists yet.
insert into platform.member_domains (
  person_id, domain, enabled, origin_brand, source, enabled_at, disabled_at, updated_at
)
select
  m.person_id,
  'friendship' as domain,
  (m.state <> 'paused') as enabled,
  'ntwrk' as origin_brand,
  'migration_0103' as source,
  coalesce(m.joined_at, now()) as enabled_at,
  case when m.state = 'paused' then now() else null end as disabled_at,
  now() as updated_at
from platform.memberships m
where m.app_id = 'ntwrk'
  and m.state in ('active', 'onboarding', 'paused')
  and not exists (
    select 1
    from platform.member_domains d
    where d.person_id = m.person_id
  )
on conflict (person_id, domain) do nothing;

revoke all on platform.member_domains from public;
alter table platform.member_domains enable row level security;

do $$
declare
  app_row record;
  obs_role text;
begin
  if exists (select 1 from pg_roles where rolname = 'platform_service') then
    grant select, insert, update, delete on platform.member_domains to platform_service;
    revoke truncate on platform.member_domains from platform_service;
    drop policy if exists member_domains_platform_service on platform.member_domains;
    create policy member_domains_platform_service on platform.member_domains
      for all to platform_service using (true) with check (true);
  end if;

  if exists (select 1 from pg_roles where rolname = 'network_service') then
    grant select, insert, update, delete on platform.member_domains to network_service;
    drop policy if exists member_domains_network_service on platform.member_domains;
    create policy member_domains_network_service on platform.member_domains
      for all to network_service using (true) with check (true);
  end if;

  if exists (select 1 from pg_roles where rolname = 'network_observatory') then
    grant usage on schema platform to network_observatory;
    grant select on platform.member_domains to network_observatory;
    drop policy if exists member_domains_observatory_ntwrk on platform.member_domains;
    create policy member_domains_observatory_ntwrk on platform.member_domains
      for select to network_observatory
      using (exists (select 1 from network.members m where m.person_id = platform.member_domains.person_id and m.app_id = 'ntwrk'));
  end if;

  for app_row in select id from platform.apps order by id loop
    obs_role := 'network_observatory_' || app_row.id;
    if exists (select 1 from pg_roles where rolname = obs_role) then
      execute format('grant usage on schema platform to %I', obs_role);
      execute format('grant select on platform.member_domains to %I', obs_role);
      execute format('drop policy if exists %I on platform.member_domains', 'member_domains_obs_' || app_row.id);
      execute format(
        'create policy %I on platform.member_domains for select to %I using (exists (select 1 from network.members m where m.person_id = platform.member_domains.person_id and m.app_id = %L))',
        'member_domains_obs_' || app_row.id,
        obs_role,
        app_row.id
      );
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'network_observatory_cross_app') then
    grant usage on schema platform to network_observatory_cross_app;
    grant select on platform.member_domains to network_observatory_cross_app;
    drop policy if exists member_domains_observatory_cross_app on platform.member_domains;
    create policy member_domains_observatory_cross_app on platform.member_domains
      for select to network_observatory_cross_app using (true);
  end if;
end $$;
