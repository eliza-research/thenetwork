-- 0016: what a live engine run read, so it can be replayed (audit ME-004; PRD 32.20).
-- network.matching_runs keeps the summary. This table keeps, per run, the engine input (phone numbers
-- scrubbed), the resolved engine config, the exposure debt carried in, the model versions and the
-- proposals it made. It holds member data (facets, ages, intents), so it has the same row-level
-- security as the other network tables and no console grant: scripts/replay-run.ts reads it with the
-- migration login. Rows are kept 30 days (expires_at); the runtime deletes older ones when it writes.
-- Runs once (public.__migrations); every step is also safe to run again.

create table if not exists network.matching_run_inputs (
  run_id        text primary key,
  app_id        text not null,
  at            timestamptz not null,
  city          text,
  engine_version text not null,
  input         jsonb not null,
  config        jsonb not null,
  exposure_debt jsonb not null default '{}'::jsonb,
  models        jsonb not null default '{}'::jsonb,
  proposals     jsonb not null default '[]'::jsonb,
  expires_at    timestamptz not null
);
create index if not exists matching_run_inputs_app_at on network.matching_run_inputs (app_id, at);
create index if not exists matching_run_inputs_expires on network.matching_run_inputs (expires_at);

alter table network.matching_run_inputs enable row level security;
alter table network.matching_run_inputs force row level security;
drop policy if exists service_app on network.matching_run_inputs;
create policy service_app on network.matching_run_inputs for all to network_service
  using (app_id = current_setting('app.app_id', true))
  with check (app_id = current_setting('app.app_id', true));
grant select, insert, delete on network.matching_run_inputs to network_service;
