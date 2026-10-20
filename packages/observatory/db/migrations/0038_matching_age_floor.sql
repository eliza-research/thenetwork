-- Matching reads the lowest recorded age even when app-row propagation failed or is in flight.
-- The service view uses invoker permissions and network.members RLS. Console views expose only
-- member IDs and ages within one fixed app; they do not grant access to people or phone hashes.
do $$
declare
  a text;
  projection text := 'select m.app_id, m.id as member_id,
    least(m.age, p.lowest_age, f.lowest_age) as age
    from network.members m
    left join platform.people p on p.id = m.person_id
    left join platform.age_floor f on f.phone_hash = p.phone_hash';
begin
  execute 'create or replace view platform.matching_ages with (security_invoker=true) as ' || projection;
  revoke all on platform.matching_ages from public;
  grant select on platform.matching_ages to network_service;
  for a in select id from platform.apps order by id loop
    execute format('create or replace view platform.%I with (security_barrier=true) as %s where m.app_id = %L',
      'matching_ages_' || a, projection, a);
    execute format('revoke all on platform.%I from public', 'matching_ages_' || a);
    execute format('grant select on platform.%I to %I', 'matching_ages_' || a, 'network_observatory_' || a);
    if a = 'ntwrk' then
      grant select on platform.matching_ages_ntwrk to network_observatory;
    end if;
  end loop;
end $$;
