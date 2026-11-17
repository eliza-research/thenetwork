-- Staff safety authority belongs to the person and scope, independently of a membership ID.
create table if not exists platform.staff_safety_holds (
  person_id uuid not null references platform.people(id) on delete cascade,
  app_id text references platform.apps(id),
  decision_id uuid not null,
  held_at timestamptz not null,
  released_apps text[] not null default '{}',
  unique nulls not distinct (person_id, app_id),
  check (app_id is null or cardinality(released_apps) = 0)
);
revoke all on platform.staff_safety_holds from public;
grant select, insert, update, delete on platform.staff_safety_holds to network_service;
grant select (person_id), delete on platform.staff_safety_holds to platform_service;

-- Preserve explicit prior decisions in the apps that recorded them. Historical runtime actions
-- identify the app; they do not establish authority over a person in apps without a recorded action.
with latest_staff_action as (
  select distinct on (e.app_id, e.object_id) e.app_id, e.object_id, e.at, e.payload->>'action' as action
  from network.events e
  where e.type='safety_action' and e.object_type='member' and e.actor_id is not null
    and e.payload->>'action' in ('hold','lift_hold')
  order by e.app_id, e.object_id, e.at desc, e.id desc
)
insert into platform.staff_safety_holds (person_id, app_id, decision_id, held_at)
select m.person_id, m.app_id, gen_random_uuid(), e.at
from latest_staff_action e
join network.members m on m.app_id=e.app_id and m.id=e.object_id
join platform.people p on p.id=m.person_id and p.deleted_at is null
join platform.memberships membership on membership.app_id=m.app_id and membership.person_id=p.id and membership.member_id=m.id
where e.action='hold' and m.account_status not in ('removed','invited') and membership.state not in ('removed','invited')
on conflict (person_id, app_id) do nothing;

-- App consumers receive only whether the restriction applies here.
do $$
declare
  a text;
  projection text := 'select m.app_id, m.id as member_id,
    least(m.age, p.lowest_age, f.lowest_age) as age,
    exists (select 1 from platform.bans b where (b.scope = ''person'' and b.person_id = p.id)
      or b.phone_hash = p.phone_hash) as banned,
    exists (select 1 from platform.staff_safety_holds h where h.person_id=p.id
      and (h.app_id=m.app_id or (h.app_id is null and not (m.app_id=any(h.released_apps))))) as staff_held
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
