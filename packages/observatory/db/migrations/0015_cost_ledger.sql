-- 0015: the cost ledger (PRD 36.4; critical path item 12).
--  - network.llm_usage: one row per LLM HTTP attempt the backend makes (core llm.ts setUsageObserver,
--    written by packages/network/service/costs.ts). Model, tokens, cost and latency only: never the
--    prompt, the reply or a member id.
--  - network.usage_daily: daily counters per app for the other paid calls (Blooio messages, Workers AI
--    calls), with the cost when a price is known.
-- Neither table names a member, so neither has row-level security: the service writes them for every
-- app, and only the cross-app console login reads them (a per-app console never sees another app's spend).
-- Runs once (public.__migrations); every step is also safe to run again.

create table if not exists network.llm_usage (
  id         bigserial primary key,
  at         timestamptz not null,
  app_id     text not null default 'platform',
  purpose    text not null default 'other',
  model      text not null,
  ok         boolean not null default true,
  tokens_in  int not null default 0,
  tokens_out int not null default 0,
  cost_micro bigint not null default 0,
  cost_known boolean not null default true,
  latency_ms int
);
create index if not exists llm_usage_at on network.llm_usage (at);
create index if not exists llm_usage_app_at on network.llm_usage (app_id, at);

create table if not exists network.usage_daily (
  day        date not null,
  app_id     text not null,
  kind       text not null check (kind in ('blooio_message', 'workers_ai_call')),
  n          int not null default 0,
  cost_micro bigint not null default 0,
  primary key (day, app_id, kind)
);

grant select, insert on network.llm_usage to network_service;
grant select, insert, update on network.usage_daily to network_service;
grant usage on sequence network.llm_usage_id_seq to network_service;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'network_observatory_cross_app') then
    grant select on network.llm_usage, network.usage_daily to network_observatory_cross_app;
  end if;
end $$;
