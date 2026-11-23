create table network.review_judgments (
  app_id text not null,
  network_id text not null,
  opportunity_id text not null,
  revision integer not null check (revision >= 0),
  packet_hash text not null,
  base_packet_hash text not null,
  packet jsonb not null,
  member_ids text[] not null,
  rubric text not null check (rubric in ('adult', 'minor')),
  status text not null check (status in ('running', 'decided')),
  claims integer not null check (claims between 0 and 2),
  claimed_at timestamptz not null,
  lease_until timestamptz not null,
  verdict text check (verdict in ('approve', 'flag', 'undecided', 'cannot_run')),
  reason text,
  explanation text check (char_length(explanation) <= 1200),
  model text,
  prompt_version text not null,
  decided_at timestamptz,
  reviewer text,
  primary key (app_id, network_id, opportunity_id, revision, packet_hash),
  check ((status = 'decided') = (verdict is not null and reason is not null and decided_at is not null and reviewer is not null))
);
create index review_judgments_claimed on network.review_judgments (app_id, claimed_at);
create index review_judgments_members on network.review_judgments using gin (member_ids);

create table network.review_judge_requests (
  app_id text not null,
  day date not null,
  n integer not null check (n >= 0),
  primary key (app_id, day)
);

alter table network.review_items add column if not exists approver text check (approver in ('judge', 'staff'));
alter table network.review_items add column if not exists exception_reason text;
alter table network.review_items add column if not exists judge_verdict text check (judge_verdict in ('approve', 'flag', 'undecided', 'cannot_run'));

grant select, insert, update, delete on network.review_judgments, network.review_judge_requests to network_service;

alter table network.review_judgments enable row level security;
alter table network.review_judgments force row level security;
drop policy if exists service_all on network.review_judgments;
create policy service_all on network.review_judgments for all to network_service
  using (app_id = current_setting('app.app_id', true)) with check (app_id = current_setting('app.app_id', true));

alter table network.review_judge_requests enable row level security;
alter table network.review_judge_requests force row level security;
drop policy if exists service_all on network.review_judge_requests;
create policy service_all on network.review_judge_requests for all to network_service
  using (app_id = current_setting('app.app_id', true)) with check (app_id = current_setting('app.app_id', true));

do $$
declare
  a text;
  role text;
  cols text := 'app_id, opportunity_id, revision, status, verdict, reason, explanation, decided_at';
begin
  for a in select id from platform.apps order by id loop
    role := 'network_observatory_' || a;
    if exists (select 1 from pg_roles where rolname = role) then
      execute format('grant select (%s) on network.review_judgments to %I', cols, role);
      execute format('drop policy if exists %I on network.review_judgments', 'console_' || a);
      execute format('create policy %I on network.review_judgments for select to %I using (app_id = %L)', 'console_' || a, role, a);
    end if;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'network_observatory') then
    execute format('grant select (%s) on network.review_judgments to network_observatory', cols);
    drop policy if exists console_shared_login on network.review_judgments;
    create policy console_shared_login on network.review_judgments for select to network_observatory using (app_id = 'ntwrk');
  end if;
end $$;
