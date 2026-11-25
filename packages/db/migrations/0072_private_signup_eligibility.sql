-- A minor signup keeps an adult eligibility date in the platform authority only.
create table platform.signup_eligibility (
  person_id uuid primary key references platform.people(id) on delete cascade,
  initial_minor_age smallint not null check (initial_minor_age >= 13 and initial_minor_age < 18),
  eligible_at timestamptz not null
);
revoke all on platform.signup_eligibility from public;
grant select, insert, update, delete on platform.signup_eligibility to platform_service, network_service;

-- Preserve the existing current-age and safety projection. Staff roles can read only
-- the effective age of members of their own app. The staff view ignores the service clock setting.
do $$
declare
  a text;
  projection text := 'select m.app_id, m.id as member_id,
    least(m.age, p.lowest_age, f.lowest_age, case when %s >= s.eligible_at then 18 else s.initial_minor_age end) as age,
    exists (select 1 from platform.bans b where (b.scope = ''person'' and b.person_id = p.id)
      or b.phone_hash = p.phone_hash) as banned,
    exists (select 1 from platform.staff_safety_holds h where h.person_id=p.id
      and (h.app_id=m.app_id or (h.app_id is null and not (m.app_id=any(h.released_apps))))) as staff_held,
    exists (select 1 from platform.report_safety_carryovers c where c.person_id=p.id and c.app_id=m.app_id) as report_held
    from network.members m
    left join platform.people p on p.id = m.person_id
    left join platform.age_floor f on f.phone_hash = p.phone_hash
    left join platform.signup_eligibility s on s.person_id = p.id';
  service_clock text := 'coalesce(nullif(current_setting(''app.age_as_of'', true), '''')::timestamptz, transaction_timestamp())';
begin
  execute 'create or replace view platform.matching_ages with (security_invoker=true) as ' || format(projection, service_clock);
  for a in select id from platform.apps order by id loop
    execute format('create or replace view platform.%I with (security_barrier=true) as %s where m.app_id = %L',
      'matching_ages_' || a, format(projection, 'transaction_timestamp()'), a);
  end loop;
end $$;

-- Cross-app safety staff see the effective numeric age, not its source or date.
create view platform.observatory_person_ages with (security_barrier=true) as
  select p.id as person_id,
    least(p.lowest_age, f.lowest_age,
      case when transaction_timestamp() >= s.eligible_at then 18 else s.initial_minor_age end) as age
  from platform.people p
  left join platform.age_floor f on f.phone_hash = p.phone_hash
  left join platform.signup_eligibility s on s.person_id = p.id;
revoke all on platform.observatory_person_ages from public;
grant select on platform.observatory_person_ages to network_observatory_cross_app;
