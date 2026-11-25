-- Remove raw birth_date and birth-range columns from app-scoped console views
-- (platform.matching_ages_<app>). Only platform.matching_ages (network_service)
-- retains birth readings; console roles receive non-PII eligibility booleans
-- (birth_exact, age_conflict) and a restricted opportunity-scoped boolean check
-- for teen friendship rosters on friends and ntwrk.
do $$
declare
  a text;
  console_cap text := 'case when transaction_timestamp() < se.eligible_at and (
      to_char(se.eligible_at at time zone ''UTC'', ''YYYYMMDD'')::int is distinct from
        ((p.birth_date / 10000) + 18) * 10000 + case mod(p.birth_date, 10000) when 229 then 301 else mod(p.birth_date, 10000) end
      or se.eligible_at at time zone ''UTC'' <> date_trunc(''day'', se.eligible_at at time zone ''UTC'') + interval ''12 hours''
    ) then se.initial_minor_age
    when p.birth_date is null and se.person_id is not null then 18 end';
  effective_age text := format('least(case when p.birth_upper is null and f.birth_upper is null then least(m.age, p.lowest_age, f.lowest_age)
      else (to_char((transaction_timestamp() at time zone ''UTC'') - interval ''12 hours'', ''YYYYMMDD'')::int -
        case when greatest(p.birth_lower, f.birth_lower) >= least(p.birth_upper, f.birth_upper)
          then greatest(p.birth_youngest, f.birth_youngest)
          else least(p.birth_upper, f.birth_upper) end) / 10000 end,
      %s)', console_cap);
  console_projection text := format('select m.app_id, m.id as member_id, %1$s as age,
    exists (select 1 from platform.bans b where (b.scope = ''person'' and b.person_id = p.id)
      or b.phone_hash = p.phone_hash) as banned,
    exists (select 1 from platform.staff_safety_holds h where h.person_id=p.id
      and (h.app_id=m.app_id or (h.app_id is null and not (m.app_id=any(h.released_apps))))) as staff_held,
    exists (select 1 from platform.report_safety_carryovers c where c.person_id=p.id and c.app_id=m.app_id) as report_held,
    null::timestamptz as minor_signal_at,
    exists (select 1 from platform.teen_pool_bars t where t.phone_hash=p.phone_hash) as teen_pool_barred,
    exists (select 1 from platform.teen_pool_holds h where h.phone_hash=p.phone_hash and h.app_id <> m.app_id) as teen_pool_held,
    %2$s as signup_minor_cap,
    se.person_id is not null as signup_age_observed,
    (p.birth_date is not null
      and least(p.birth_upper, f.birth_upper) is not null
      and not (greatest(p.birth_lower, f.birth_lower) >= least(p.birth_upper, f.birth_upper))
      and least(p.birth_upper, f.birth_upper) = p.birth_date) as birth_exact,
    (greatest(p.birth_lower, f.birth_lower) is not null
      and least(p.birth_upper, f.birth_upper) is not null
      and greatest(p.birth_lower, f.birth_lower) >= least(p.birth_upper, f.birth_upper)) as age_conflict
    from network.members m
    left join platform.people p on p.id = m.person_id
    left join platform.age_floor f on f.phone_hash = p.phone_hash
    left join platform.signup_eligibility se on se.person_id = p.id', effective_age, console_cap);
begin
  for a in select id from platform.apps order by id loop
    execute format('drop view if exists platform.%I', 'matching_ages_' || a);
    execute format('create view platform.%I with (security_barrier=true) as %s where m.app_id = %L',
      'matching_ages_' || a, console_projection, a);
    execute format('revoke all on platform.%I from public', 'matching_ages_' || a);
    if exists (select 1 from pg_roles where rolname = 'network_observatory_' || a) then
      execute format('grant select on platform.%I to %I', 'matching_ages_' || a, 'network_observatory_' || a);
    end if;
    if a = 'ntwrk' and exists (select 1 from pg_roles where rolname = 'network_observatory') then
      grant select on platform.matching_ages_ntwrk to network_observatory;
    end if;
  end loop;
end $$;

create or replace function platform.console_teen_roster_allowed(
  p_app text,
  p_opportunity_id text,
  p_member_ids text[],
  p_min_day integer,
  p_max_day integer,
  p_ready_ids text[],
  p_adult_clear_ids text[]
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ids text[];
  v_birth integer[];
  v_adult boolean[];
  v_ready boolean[];
  v_n integer := 0;
  v_rec record;
  v_age_min integer;
  v_age_max integer;
  v_a boolean;
  v_r boolean;
  i integer;
  j integer;
begin
  if p_app not in ('friends', 'ntwrk') then
    raise exception 'permission denied for console teen check on app %', p_app using errcode = '42501';
  end if;
  if not (
    current_user = 'postgres'
    or exists (select 1 from pg_roles where rolname = current_user and rolsuper)
    or pg_has_role(current_user, 'network_service', 'member')
    or (exists (select 1 from pg_roles where rolname = 'network_observatory_' || p_app)
        and pg_has_role(current_user, 'network_observatory_' || p_app, 'member'))
    or (p_app = 'ntwrk' and exists (select 1 from pg_roles where rolname = 'network_observatory')
        and pg_has_role(current_user, 'network_observatory', 'member'))
  ) then
    raise exception 'permission denied for console teen check on app %', p_app using errcode = '42501';
  end if;

  select array_agg(distinct mid order by mid) into v_ids from unnest(coalesce(p_member_ids, array[]::text[])) as mid;
  if v_ids is null or cardinality(v_ids) < 2 or cardinality(v_ids) > 6 then
    return false;
  end if;

  if not exists (select 1 from network.opportunities o where o.app_id = p_app and o.id = p_opportunity_id) then
    return false;
  end if;
  if exists (
    select 1 from unnest(v_ids) as mid
    where not exists (
      select 1 from network.participations pa where pa.app_id = p_app and pa.opportunity_id = p_opportunity_id and pa.member_id = mid
    ) and not exists (
      select 1 from network.messages msg where msg.app_id = p_app and msg.opportunity_id = p_opportunity_id and msg.member_id = mid
    )
  ) then
    return false;
  end if;

  for v_rec in
    select
      m.id as member_id,
      case
        when least(p.birth_upper, f.birth_upper) is null then null
        when greatest(p.birth_lower, f.birth_lower) >= least(p.birth_upper, f.birth_upper)
          then greatest(p.birth_youngest, f.birth_youngest)
        else least(p.birth_upper, f.birth_upper)
      end as birth_key,
      (p.birth_date is not null
        and least(p.birth_upper, f.birth_upper) is not null
        and not (greatest(p.birth_lower, f.birth_lower) >= least(p.birth_upper, f.birth_upper))
        and least(p.birth_upper, f.birth_upper) = p.birth_date) as birth_exact,
      (greatest(p.birth_lower, f.birth_lower) is not null
        and least(p.birth_upper, f.birth_upper) is not null
        and greatest(p.birth_lower, f.birth_lower) >= least(p.birth_upper, f.birth_upper)) as age_conflict,
      exists (select 1 from platform.teen_pool_bars t where t.phone_hash = p.phone_hash) as teen_pool_barred
    from network.members m
    left join platform.people p on p.id = m.person_id
    left join platform.age_floor f on f.phone_hash = p.phone_hash
    where m.app_id = p_app and m.id = any(v_ids)
    order by m.id
  loop
    v_n := v_n + 1;
    if v_rec.birth_key is null then
      return false;
    end if;
    v_age_min := case when p_min_day >= v_rec.birth_key then (p_min_day - v_rec.birth_key) / 10000 else -1 end;
    v_age_max := case when p_max_day >= v_rec.birth_key then (p_max_day - v_rec.birth_key) / 10000 else -1 end;
    v_a := (v_age_min >= 18) and not v_rec.age_conflict and (v_rec.member_id = any(coalesce(p_adult_clear_ids, array[]::text[])));
    v_r := v_rec.birth_exact and not v_rec.age_conflict and not v_rec.teen_pool_barred
      and (v_rec.member_id = any(coalesce(p_ready_ids, array[]::text[])));
    v_birth := array_append(v_birth, v_rec.birth_key);
    v_adult := array_append(v_adult, v_a);
    v_ready := array_append(v_ready, v_r);
  end loop;

  if v_n <> cardinality(v_ids) then
    return false;
  end if;

  for i in 1..v_n loop
    for j in 1..v_n loop
      if not (v_adult[i] and v_adult[j]) then
        if not (
          v_ready[i] and v_ready[j]
          and (case when p_min_day >= v_birth[i] then (p_min_day - v_birth[i]) / 10000 else -1 end) >= 13
          and (case when p_max_day >= v_birth[i] then (p_max_day - v_birth[i]) / 10000 else -1 end) <= 18
          and (case when p_min_day >= v_birth[j] then (p_min_day - v_birth[j]) / 10000 else -1 end) >= 13
          and (case when p_max_day >= v_birth[j] then (p_max_day - v_birth[j]) / 10000 else -1 end) <= 18
          and (
            (case when p_min_day >= v_birth[i] then (p_min_day - v_birth[i]) / 10000 else -1 end) < 18
            or (case when p_min_day >= v_birth[j] then (p_min_day - v_birth[j]) / 10000 else -1 end) < 18
          )
          and abs(v_birth[i] - v_birth[j]) <= 20000
        ) then
          return false;
        end if;
      end if;
    end loop;
  end loop;

  return true;
end $$;

revoke all on function platform.console_teen_roster_allowed(text, text, text[], integer, integer, text[], text[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'network_service') then
    grant execute on function platform.console_teen_roster_allowed(text, text, text[], integer, integer, text[], text[]) to network_service;
  end if;
  if exists (select 1 from pg_roles where rolname = 'network_observatory_friends') then
    grant execute on function platform.console_teen_roster_allowed(text, text, text[], integer, integer, text[], text[]) to network_observatory_friends;
  end if;
  if exists (select 1 from pg_roles where rolname = 'network_observatory_ntwrk') then
    grant execute on function platform.console_teen_roster_allowed(text, text, text[], integer, integer, text[], text[]) to network_observatory_ntwrk;
  end if;
  if exists (select 1 from pg_roles where rolname = 'network_observatory') then
    grant execute on function platform.console_teen_roster_allowed(text, text, text[], integer, integer, text[], text[]) to network_observatory;
  end if;
end $$;
