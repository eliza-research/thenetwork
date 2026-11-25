-- The trusted app projections keep the private signup date's numeric restriction.
-- No app-scoped view returns the date or grants access to the authority table.
do $$
declare
  a text;
  service_clock text := 'coalesce(nullif(current_setting(''app.age_as_of'', true), '''')::timestamptz, transaction_timestamp())';
  signup_cap text := 'case when %1$s < se.eligible_at and (
      to_char(se.eligible_at at time zone ''UTC'', ''YYYYMMDD'')::int is distinct from
        ((p.birth_date / 10000) + 18) * 10000 + case mod(p.birth_date, 10000) when 229 then 301 else mod(p.birth_date, 10000) end
      or se.eligible_at at time zone ''UTC'' <> date_trunc(''day'', se.eligible_at at time zone ''UTC'') + interval ''12 hours''
    ) then se.initial_minor_age
    when p.birth_date is null and se.person_id is not null then 18 end';
  effective_age text := 'least(case when p.birth_upper is null and f.birth_upper is null then %2$s
      else (to_char((%1$s at time zone ''UTC'') - interval ''12 hours'', ''YYYYMMDD'')::int -
        case when greatest(p.birth_lower, f.birth_lower) >= least(p.birth_upper, f.birth_upper)
          then greatest(p.birth_youngest, f.birth_youngest)
          else least(p.birth_upper, f.birth_upper) end) / 10000 end,
      %3$s)';
  projection text := 'select m.app_id, m.id as member_id, %1$s as age,
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
    %3$s as signup_minor_cap,
    se.person_id is not null as signup_age_observed
    from network.members m
    left join platform.people p on p.id = m.person_id
    left join platform.age_floor f on f.phone_hash = p.phone_hash
    left join platform.signup_eligibility se on se.person_id = p.id';
  service_cap text := format(signup_cap, service_clock);
  console_cap text := format(signup_cap, 'transaction_timestamp()');
begin
  execute 'create or replace view platform.matching_ages with (security_invoker=true) as '
    || format(projection, format(effective_age, service_clock, 'least(m.age, p.lowest_age, f.lowest_age)', service_cap),
        '(select s.at from platform.person_minor_signals s where s.person_id=p.id)', service_cap);
  for a in select id from platform.apps order by id loop
    execute format('create or replace view platform.%I with (security_barrier=true) as %s where m.app_id = %L',
      'matching_ages_' || a, format(projection, format(effective_age, 'transaction_timestamp()', 'least(m.age, p.lowest_age, f.lowest_age)', console_cap),
        'null::timestamptz', console_cap), a);
  end loop;
  execute format('create or replace view platform.observatory_person_ages with (security_barrier=true) as
    select p.id as person_id, %s as age
    from platform.people p
    left join platform.age_floor f on f.phone_hash = p.phone_hash
    left join platform.signup_eligibility se on se.person_id = p.id',
    format(effective_age, 'transaction_timestamp()', 'least(p.lowest_age, f.lowest_age)', console_cap));
end $$;
