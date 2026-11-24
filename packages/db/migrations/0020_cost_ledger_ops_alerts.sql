-- 0020: operations tables (docs/deploy.md section 7; mvp-plan items 11 and 12).
--  - network.cost_ledger: one row per costed event or daily accrual, per app and per day. Estimated
--    costs (rates in packages/network/service/cost.ts) carry estimated = true. No member id, no phone,
--    no text: the detail holds codes and counts only. app_id 'shared' is a cost no single app owns
--    (the Blooio line).
--  - network.ops_alerts and network.ops_alert_posts: the backend's alert dispatcher state
--    (deploy/backend/ops.ts): one row per alert key (dedupe survives a restart or a second replica)
--    and one row per webhook post (the rate limit).
-- Grants: the service (network_service) writes all three. Each console read role
-- (network_observatory_<app>) reads its app's cost rows and the shared ones (row-level security);
-- the cross-app role reads every cost row. No console role reads the alert tables.
-- The console's shared login (network_observatory) may read platform.staff_roles, so SSO staff get
-- the roles an admin stored there (src/staff.ts PgStaffRoles; before this it fell back to OBSERVATORY_ROLES).
-- Runs once (public.__migrations); every step is also safe to run again.

create table if not exists network.cost_ledger (
  id            text primary key,
  app_id        text not null,
  day           date not null,
  at            timestamptz not null,
  kind          text not null check (kind in ('llm', 'photo_rating', 'otp_verify', 'blooio_line', 'sms_fallback', 'other')),
  provider      text not null,
  quantity      numeric not null default 1,
  unit_cost_usd numeric,
  cost_usd      numeric not null check (cost_usd >= 0),
  estimated     boolean not null default true,
  detail        jsonb not null default '{}'::jsonb
);
create index if not exists cost_ledger_day_app on network.cost_ledger (day, app_id);

create table if not exists network.ops_alerts (
  key             text primary key,
  level           text not null check (level in ('warn', 'bad')),
  count           int not null default 0,
  text            text not null,
  open            boolean not null default true,
  first_at        timestamptz not null,
  last_at         timestamptz not null,
  last_sent_at    timestamptz,
  last_sent_level text,
  last_sent_count int
);

create table if not exists network.ops_alert_posts (
  id     bigserial primary key,
  at     timestamptz not null,
  alerts int not null,
  ok     boolean not null
);
create index if not exists ops_alert_posts_at on network.ops_alert_posts (at);

grant select, insert, update on network.cost_ledger, network.ops_alerts to network_service;
grant select, insert on network.ops_alert_posts to network_service;
grant usage on sequence network.ops_alert_posts_id_seq to network_service;

alter table network.cost_ledger enable row level security;
alter table network.cost_ledger force row level security;
drop policy if exists service_all on network.cost_ledger;
create policy service_all on network.cost_ledger for all to network_service using (true) with check (true);

do $$
declare
  a text;
  role text;
begin
  for a in select id from platform.apps order by id loop
    role := 'network_observatory_' || a;
    if exists (select 1 from pg_roles where rolname = role) then
      execute format('grant select on network.cost_ledger to %I', role);
      execute format('drop policy if exists %I on network.cost_ledger', 'console_' || a);
      execute format('create policy %I on network.cost_ledger for select to %I using (app_id in (%L, ''shared''))', 'console_' || a, role, a);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'network_observatory') then
    grant select on network.cost_ledger to network_observatory;
    drop policy if exists console_shared_login on network.cost_ledger;
    create policy console_shared_login on network.cost_ledger for select to network_observatory using (app_id in ('ntwrk', 'shared'));
    grant usage on schema platform to network_observatory;
    grant select on platform.staff_roles to network_observatory;
  end if;
  if exists (select 1 from pg_roles where rolname = 'network_observatory_cross_app') then
    grant select on network.cost_ledger to network_observatory_cross_app;
    drop policy if exists console_cross_app on network.cost_ledger;
    create policy console_cross_app on network.cost_ledger for select to network_observatory_cross_app using (true);
  end if;
end $$;
