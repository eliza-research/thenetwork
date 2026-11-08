-- 0044: identity sagas (docs/research/quint-findings/identity_sagas.md).
-- A legacy network.channel_identities phone row counts for routing only for a member with no person.
-- Migration 0006 gave the members from before the platform a person and a verified phone, but kept
-- their channel_identities rows. For a member with a person, platform.phone_identities is the one place
-- a phone lives: it follows a number change and the recycled-number hold. The legacy row did neither,
-- so the old number (later another person's) still reached the member (SD-026). Apple ID addresses
-- (not phones) still count.
create or replace function platform.member_apps(addr text)
returns table (app_id text, member_id text, last_out timestamptz, last_item timestamptz)
language sql stable security definer set search_path = pg_catalog, platform, network as $$
  select m.app_id, m.id,
    (select max(msg.ts) from network.messages msg where msg.app_id = m.app_id and msg.member_id = m.id and msg.direction = 'outbound'),
    (select max(msg.ts) from network.messages msg where msg.app_id = m.app_id and msg.member_id = m.id and msg.direction = 'outbound' and msg.opportunity_id is not null
       and msg.ts > coalesce((select max(i.ts) from network.messages i where i.app_id = m.app_id and i.member_id = m.id and i.direction = 'inbound'), '-infinity'::timestamptz))
  from network.members m
  where m.account_status not in ('invited', 'removed')
    and (m.person_id in (select ph.person_id from platform.phone_identities ph where ph.e164 = addr and ph.hold is null)
      or exists (select 1 from network.channel_identities ci where ci.app_id = m.app_id and ci.member_id = m.id and ci.address = addr and ci.channel in ('imessage', 'sms')
        and (m.person_id is null or left(ci.address, 1) <> '+')))
$$;

revoke all on function platform.member_apps(text) from public;
grant execute on function platform.member_apps(text) to network_service;
