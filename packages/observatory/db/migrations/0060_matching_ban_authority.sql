-- Extend the existing app-scoped matching view with the canonical ban decision.
-- Observers receive only a member ID, age and restriction flag in their own app.
do $$
declare
  a text;
  projection text := 'select m.app_id, m.id as member_id,
    least(m.age, p.lowest_age, f.lowest_age) as age,
    exists (select 1 from platform.bans b where (b.scope = ''person'' and b.person_id = p.id)
      or b.phone_hash = p.phone_hash) as banned
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
