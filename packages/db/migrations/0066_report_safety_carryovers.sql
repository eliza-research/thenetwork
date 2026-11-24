-- An unresolved report is distinct from a staff hold and can be cleared only by its own disposition.
create table platform.report_safety_carryovers (
  app_id text not null references platform.apps(id),
  origin_runtime_id text not null,
  report_id text not null,
  person_id uuid not null references platform.people(id) on delete cascade,
  primary key (app_id, origin_runtime_id, report_id),
  check (split_part(origin_runtime_id, ':', 1) = app_id)
);
create index report_safety_carryovers_person_app on platform.report_safety_carryovers (person_id, app_id);
revoke all on platform.report_safety_carryovers from public;
grant select, insert, delete on platform.report_safety_carryovers to network_service;
grant select (person_id), delete on platform.report_safety_carryovers to platform_service;

-- The matching view reveals only whether there is an unresolved restriction in this app.
do $$
declare
  a text;
  projection text := 'select m.app_id, m.id as member_id,
    least(m.age, p.lowest_age, f.lowest_age) as age,
    exists (select 1 from platform.bans b where (b.scope = ''person'' and b.person_id = p.id)
      or b.phone_hash = p.phone_hash) as banned,
    exists (select 1 from platform.staff_safety_holds h where h.person_id=p.id
      and (h.app_id=m.app_id or (h.app_id is null and not (m.app_id=any(h.released_apps))))) as staff_held,
    exists (select 1 from platform.report_safety_carryovers c where c.person_id=p.id and c.app_id=m.app_id) as report_held
    from network.members m
    left join platform.people p on p.id = m.person_id
    left join platform.age_floor f on f.phone_hash = p.phone_hash';
begin
  execute 'create or replace view platform.matching_ages with (security_invoker=true) as ' || projection;
  for a in select id from platform.apps order by id loop
    execute format('create or replace view platform.%I with (security_barrier=true) as %s where m.app_id = %L',
      'matching_ages_' || a, projection, a);
  end loop;
end $$;
