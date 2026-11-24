-- The trusted app projections keep the private signup date's numeric restriction.
-- No app-scoped view returns the date or grants access to the authority table.
do $$
declare
  a text;
  service_clock text := 'coalesce(nullif(current_setting(''app.age_as_of'', true), '''')::timestamptz, transaction_timestamp())';
  projection text := 'select m.app_id, m.id as member_id,
    least(m.age, p.lowest_age, f.lowest_age,
      case when %1$s >= se.eligible_at then 18 else se.initial_minor_age end) as age,
    exists (select 1 from platform.bans b where (b.scope = ''person'' and b.person_id = p.id)
      or b.phone_hash = p.phone_hash) as banned,
    exists (select 1 from platform.staff_safety_holds h where h.person_id=p.id
      and (h.app_id=m.app_id or (h.app_id is null and not (m.app_id=any(h.released_apps))))) as staff_held,
    exists (select 1 from platform.report_safety_carryovers c where c.person_id=p.id and c.app_id=m.app_id) as report_held,
    %2$s as minor_signal_at,
    p.birth_date, p.birth_lower, p.birth_upper, p.birth_youngest,
    f.birth_lower as floor_birth_lower, f.birth_upper as floor_birth_upper, f.birth_youngest as floor_birth_youngest,
    exists (select 1 from platform.teen_pool_bars t where t.phone_hash=p.phone_hash) as teen_pool_barred,
    exists (select 1 from platform.teen_pool_holds h where h.phone_hash=p.phone_hash and h.app_id <> m.app_id) as teen_pool_held,
    case when %1$s < se.eligible_at then se.initial_minor_age else null end as signup_minor_cap,
    se.person_id is not null as signup_age_observed
    from network.members m
    left join platform.people p on p.id = m.person_id
    left join platform.age_floor f on f.phone_hash = p.phone_hash
    left join platform.signup_eligibility se on se.person_id = p.id';
begin
  execute 'create or replace view platform.matching_ages with (security_invoker=true) as '
    || format(projection, service_clock, '(select s.at from platform.person_minor_signals s where s.person_id=p.id)');
  for a in select id from platform.apps order by id loop
    execute format('create or replace view platform.%I with (security_barrier=true) as %s where m.app_id = %L',
      'matching_ages_' || a, format(projection, 'transaction_timestamp()', 'null::timestamptz'), a);
  end loop;
end $$;
