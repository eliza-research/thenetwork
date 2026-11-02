-- Shared-line routing (service.ts route(), rule 4): a member's text goes to the app with the newest open
-- item, else to the app that wrote to them last. Before, the last outbound message about an opportunity
-- counted as an open item until the member wrote to that app, even after the probe expired (PROBE_TTL)
-- or the match closed, so a two-app member's later reply to the other app's plain text was routed to the
-- app with the dead probe. Now an item is open only while its opportunity is (network.opportunities.state,
-- store.ts oppState): IN_REVIEW, PROPOSED or SCHEDULED, or COMPLETED (the feedback question) for at most
-- 48 hours (the PRD's per-side window, 1031). A cancelled or skipped opportunity has no open item.
-- `at` is the caller's clock (the service runs on a simulated clock in tests).
drop function if exists platform.member_apps(text);
create function platform.member_apps(addr text, at timestamptz default now())
returns table (app_id text, member_id text, last_out timestamptz, last_item timestamptz)
language sql stable security definer set search_path = pg_catalog, platform, network as $$
  select m.app_id, m.id,
    (select max(msg.ts) from network.messages msg where msg.app_id = m.app_id and msg.member_id = m.id and msg.direction = 'outbound'),
    (select max(msg.ts) from network.messages msg
       join network.opportunities o on o.app_id = msg.app_id and o.id = msg.opportunity_id
       where msg.app_id = m.app_id and msg.member_id = m.id and msg.direction = 'outbound'
       and (o.state in ('IN_REVIEW', 'PROPOSED', 'SCHEDULED') or (o.state = 'COMPLETED' and msg.ts > at - interval '48 hours'))
       and msg.ts > coalesce((select max(i.ts) from network.messages i where i.app_id = m.app_id and i.member_id = m.id and i.direction = 'inbound'), '-infinity'::timestamptz))
  from network.members m
  where m.account_status not in ('invited', 'removed')
    and (m.person_id in (select ph.person_id from platform.phone_identities ph where ph.e164 = addr and ph.hold is null)
      or exists (select 1 from network.channel_identities ci where ci.app_id = m.app_id and ci.member_id = m.id and ci.address = addr and ci.channel in ('imessage', 'sms')))
$$;
revoke all on function platform.member_apps(text, timestamptz) from public;
grant execute on function platform.member_apps(text, timestamptz) to network_service;
