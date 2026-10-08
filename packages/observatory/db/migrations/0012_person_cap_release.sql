-- 0012: the person cap counts only sends that went out (audit: "the person cap is taken before the
-- adapter runs"). platform.person_cap_take (0007) takes a slot before the channel adapter runs; a
-- send the adapter then refuses (the per-app live flag, a suppressed number, a channel error status)
-- gives its slot back with platform.person_cap_release. SECURITY DEFINER like person_cap_take: the
-- network_service role cannot touch platform.person_sends directly.
-- Runs once (public.__migrations), after 0007.
create or replace function platform.person_cap_release(ids text[])
returns int
language plpgsql volatile security definer set search_path = pg_catalog, platform as $$
declare
  n int;
begin
  perform pg_advisory_xact_lock(hashtext('platform.person_cap'));
  delete from platform.person_sends where msg_id = any(ids);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function platform.person_cap_release(text[]) from public;
grant execute on function platform.person_cap_release(text[]) to network_service;
