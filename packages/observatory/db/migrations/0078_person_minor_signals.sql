create table platform.person_minor_signals (
  person_id uuid primary key references platform.people(id) on delete cascade,
  at timestamptz not null
);
revoke all on platform.person_minor_signals from public;
grant select, insert, update, delete on platform.person_minor_signals to network_service;

do $$
declare
  a text;
  projection text := 'select m.app_id, m.id as member_id,
    least(m.age, p.lowest_age, f.lowest_age) as age,
    exists (select 1 from platform.bans b where (b.scope = ''person'' and b.person_id = p.id)
      or b.phone_hash = p.phone_hash) as banned,
    exists (select 1 from platform.staff_safety_holds h where h.person_id=p.id
      and (h.app_id=m.app_id or (h.app_id is null and not (m.app_id=any(h.released_apps))))) as staff_held,
    exists (select 1 from platform.report_safety_carryovers c where c.person_id=p.id and c.app_id=m.app_id) as report_held,
    %s as minor_signal_at
    from network.members m
    left join platform.people p on p.id = m.person_id
    left join platform.age_floor f on f.phone_hash = p.phone_hash';
begin
  execute 'create or replace view platform.matching_ages with (security_invoker=true) as '
    || format(projection, '(select s.at from platform.person_minor_signals s where s.person_id=p.id)');
  for a in select id from platform.apps order by id loop
    execute format('create or replace view platform.%I with (security_barrier=true) as %s where m.app_id = %L',
      'matching_ages_' || a, format(projection, 'null::timestamptz'), a);
  end loop;
end $$;
