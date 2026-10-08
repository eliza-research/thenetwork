-- 0006: fixes from the platform safety review (2026-10-08).
--  - platform.age_floor: the lowest age ever stated for a phone, keyed by the server's keyed phone
--    hash. It holds no app, name or profile. An under-age refusal writes it (so a retry with an older
--    age is refused), and a delete of everything keeps it (it is a safety fact, not profile data).
--  - platform.phone_identities.hold: a number that may have a new owner (not seen for 12 months)
--    waits for staff review. While it is held, nobody can read or change the old owner's account.
--  - Two SECURITY DEFINER functions for the only reads that span apps: the person cap of proactive
--    messages a day, and the apps one address is a member of (inbound routing on the shared line).
--    Under the network_service role (row-level security, one app per unit of work) a direct query
--    sees one app only, so the cap counted 0 and failed open. The functions return ids and counts only.
--    The function owner must bypass row-level security (run the migrations as a superuser or a
--    BYPASSRLS role, as runbook-real says).
--  - Members of The Network from before the platform (network.channel_identities only) get a person,
--    a verified phone and an ntwrk membership, so export, stop and delete work for them.
-- Runs once (public.__migrations); every step is also safe to run again.

create table if not exists platform.age_floor (
  phone_hash text primary key,
  lowest_age int not null check (lowest_age > 0 and lowest_age < 130),
  at         timestamptz not null
);

alter table platform.phone_identities add column if not exists hold text check (hold in ('recycled_number'));
alter table platform.phone_identities add column if not exists hold_at timestamptz;

grant select, insert, update, delete on platform.age_floor to platform_service;

-- The person cap (PRD 40.3): for the members of one app in a batch, their person and the proactive
-- messages that person got in every app since `since` (sent or queued; refused and failed ones do
-- not count; the batch's own rows are excluded).
create or replace function platform.person_cap_counts(app text, member_ids text[], since timestamptz, exclude text[])
returns table (member_id text, person_id uuid, n int)
language sql stable security definer set search_path = pg_catalog, platform, network as $$
  with owners as (
    select m.id as member_id, m.person_id from network.members m
    where m.app_id = app and m.id = any(member_ids) and m.person_id is not null
  ), counts as (
    select m.person_id, count(*)::int as n from network.messages msg
    join network.members m on m.app_id = msg.app_id and m.id = msg.member_id
    where m.person_id in (select o.person_id from owners o) and msg.direction = 'outbound' and msg.proactive and msg.ts >= since
      and msg.status not like 'refused%' and msg.status not like 'failed%' and not (msg.id = any(exclude))
    group by m.person_id
  )
  select o.member_id, o.person_id, coalesce(c.n, 0) from owners o left join counts c on c.person_id = o.person_id
$$;

-- The joined members one address has, in every app, with the time of the newest outbound message to
-- each (the shared line answers in the app that wrote last). Platform phones and legacy
-- channel_identities both count.
create or replace function platform.member_apps(addr text)
returns table (app_id text, member_id text, last_out timestamptz)
language sql stable security definer set search_path = pg_catalog, platform, network as $$
  select m.app_id, m.id,
    (select max(msg.ts) from network.messages msg where msg.app_id = m.app_id and msg.member_id = m.id and msg.direction = 'outbound')
  from network.members m
  where m.account_status not in ('invited', 'removed')
    and (m.person_id in (select ph.person_id from platform.phone_identities ph where ph.e164 = addr and ph.hold is null)
      or m.id in (select ci.member_id from network.channel_identities ci where ci.address = addr and ci.channel in ('imessage', 'sms')))
$$;

revoke all on function platform.person_cap_counts(text, text[], timestamptz, text[]) from public;
revoke all on function platform.member_apps(text) from public;
grant execute on function platform.person_cap_counts(text, text[], timestamptz, text[]) to network_service;
grant execute on function platform.member_apps(text) to network_service;

-- Backfill: The Network's members from before the platform. A phone that already has a person joins
-- that person; otherwise a new person (lowest age = the member's recorded age). Apple ID addresses
-- (not phones) are left as they are.
do $$
declare
  r record;
  pid uuid;
begin
  for r in
    select distinct on (m.id) m.id, m.name, m.age, m.account_status, m.joined_at, m.created_at, ci.address, ci.verified_at
    from network.members m join network.channel_identities ci on ci.member_id = m.id
    where m.app_id = 'ntwrk' and m.person_id is null and m.account_status <> 'removed'
      and ci.channel in ('imessage', 'sms') and ci.address ~ '^\+1[2-9][0-9]{2}[0-9]{7}$'
    order by m.id, ci.is_primary desc
  loop
    select ph.person_id into pid from platform.phone_identities ph where ph.e164 = r.address;
    if pid is null then
      pid := gen_random_uuid();
      insert into platform.people (id, lowest_age, created_at) values (pid, r.age, coalesce(r.joined_at, r.created_at, now()));
      insert into platform.phone_identities (e164, person_id, verified_at, method, last_seen_at)
        values (r.address, pid, coalesce(r.verified_at, r.joined_at, r.created_at, now()), 'inbound_message',
                coalesce((select max(ts) from network.messages where app_id = 'ntwrk' and member_id = r.id and direction = 'inbound'), r.joined_at, r.created_at, now()));
    elsif r.age is not null then
      update platform.people set lowest_age = least(coalesce(lowest_age, r.age), r.age) where id = pid;
    end if;
    -- One ntwrk membership per person: a second legacy member with the same phone keeps no person.
    if not exists (select 1 from platform.memberships where app_id = 'ntwrk' and person_id = pid) then
      insert into platform.memberships (app_id, person_id, member_id, state, first_name, joined_at)
        values ('ntwrk', pid, r.id, r.account_status, r.name, r.joined_at)
        on conflict do nothing;
      update network.members set person_id = pid where app_id = 'ntwrk' and id = r.id;
    end if;
  end loop;
end $$;
