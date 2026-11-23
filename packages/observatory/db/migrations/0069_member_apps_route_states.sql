-- Use the routing states from textEnrollment. Keep the existing phone-owner
-- projection and one-argument signature for callers that only need membership.
create function platform.member_apps(addr text, route_states text[])
returns table (app_id text, member_id text, last_out timestamptz, last_item timestamptz)
language sql stable security definer set search_path = pg_catalog, platform, network as $$
  select m.app_id, m.id,
    (select max(msg.ts) from network.messages msg where msg.app_id = m.app_id and msg.member_id = m.id and msg.direction = 'outbound'),
    (select max(msg.ts) from network.messages msg where msg.app_id = m.app_id and msg.member_id = m.id and msg.direction = 'outbound' and msg.opportunity_id is not null
       and (route_states is null or exists (select 1 from network.opportunities o
         where o.app_id = msg.app_id and o.id = msg.opportunity_id and o.state = any(route_states)))
       and msg.ts > coalesce((select max(i.ts) from network.messages i where i.app_id = m.app_id and i.member_id = m.id and i.direction = 'inbound'), '-infinity'::timestamptz))
  from network.members m
  where m.account_status not in ('invited', 'removed')
    and (m.person_id in (select ph.person_id from platform.phone_identities ph where ph.e164 = addr and ph.hold is null)
      or (m.person_id is null and not exists (select 1 from platform.phone_identities ph where ph.e164 = addr) and exists (
        select 1 from network.channel_identities ci where ci.app_id = m.app_id and ci.member_id = m.id and ci.address = addr and ci.channel in ('imessage', 'sms')
      )))
$$;

create or replace function platform.member_apps(addr text)
returns table (app_id text, member_id text, last_out timestamptz, last_item timestamptz)
language sql stable security definer set search_path = pg_catalog, platform, network as $$
  select * from platform.member_apps(addr, null::text[])
$$;

revoke all on function platform.member_apps(text, text[]) from public;
grant execute on function platform.member_apps(text, text[]) to network_service;
