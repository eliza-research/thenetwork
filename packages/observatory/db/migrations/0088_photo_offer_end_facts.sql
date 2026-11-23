alter table platform.photo_offers add column party_ended boolean not null default false;

drop index if exists platform.photo_offers_one_open;
create unique index photo_offers_one_open on platform.photo_offers (app_id, sender_person_id, recipient_person_id) where phase in ('asking','reviewing');
drop index if exists platform.photo_offers_checked;
create index photo_offers_checked on platform.photo_offers (app_id, checked_at) where phase in ('asking','reviewing') or (phase = 'ready' and party_ended);

create function platform.end_photo_offers_of(people uuid[], app text, released text[]) returns void
  language sql security definer set search_path = pg_catalog as $$
  update platform.photo_offers set party_ended = true
   where phase in ('asking','reviewing','ready') and not party_ended
     and (sender_person_id = any(people) or recipient_person_id = any(people))
     and (app is null or app_id = app) and not (app_id = any(released))
$$;
revoke all on function platform.end_photo_offers_of(uuid[], text, text[]) from public;

create function platform.end_photo_offers_between(a uuid, b uuid) returns void
  language sql security definer set search_path = pg_catalog as $$
  update platform.photo_offers set party_ended = true
   where phase in ('asking','reviewing','ready') and not party_ended
     and ((sender_person_id = a and recipient_person_id = b) or (sender_person_id = b and recipient_person_id = a))
$$;
revoke all on function platform.end_photo_offers_between(uuid, uuid) from public;

create function platform.photo_offers_end_member() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if (new.opted_out and not old.opted_out) or (old.account_status = 'active' and new.account_status <> 'active') then
    update platform.photo_offers set party_ended = true
     where phase in ('asking','reviewing','ready') and not party_ended and app_id = new.app_id
       and (sender_member_id = new.id or recipient_member_id = new.id);
  end if;
  return null;
end $$;
revoke all on function platform.photo_offers_end_member() from public;
create trigger photo_offers_end_member after update of opted_out, account_status on network.members
  for each row execute function platform.photo_offers_end_member();

create function platform.photo_offers_end_block_edge() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.type = 'blocked' then
    update platform.photo_offers set party_ended = true
     where phase in ('asking','reviewing','ready') and not party_ended and app_id = new.app_id
       and ((sender_member_id = new.from_id and recipient_member_id = new.to_id) or (sender_member_id = new.to_id and recipient_member_id = new.from_id));
  end if;
  return null;
end $$;
revoke all on function platform.photo_offers_end_block_edge() from public;
create trigger photo_offers_end_block_edge after insert on network.edges
  for each row execute function platform.photo_offers_end_block_edge();

create function platform.photo_offers_end_person_block() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform platform.end_photo_offers_between(new.from_person, new.to_person);
  return null;
end $$;
revoke all on function platform.photo_offers_end_person_block() from public;
create trigger photo_offers_end_person_block after insert on platform.person_blocks
  for each row execute function platform.photo_offers_end_person_block();

create function platform.photo_offers_end_ban() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform platform.end_photo_offers_of(array(
    select p.id from platform.people p where new.phone_hash is not null and p.phone_hash = new.phone_hash
    union select new.person_id where new.scope = 'person' and new.person_id is not null), null, '{}');
  return null;
end $$;
revoke all on function platform.photo_offers_end_ban() from public;
create trigger photo_offers_end_ban after insert on platform.bans
  for each row execute function platform.photo_offers_end_ban();

create function platform.photo_offers_end_staff_hold() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'INSERT' or new.decision_id <> old.decision_id or not (new.released_apps @> old.released_apps) then
    perform platform.end_photo_offers_of(array[new.person_id], new.app_id, new.released_apps);
  end if;
  return null;
end $$;
revoke all on function platform.photo_offers_end_staff_hold() from public;
create trigger photo_offers_end_staff_hold after insert or update on platform.staff_safety_holds
  for each row execute function platform.photo_offers_end_staff_hold();

create function platform.photo_offers_end_report_hold() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  perform platform.end_photo_offers_of(array[new.person_id], new.app_id, '{}');
  return null;
end $$;
revoke all on function platform.photo_offers_end_report_hold() from public;
create trigger photo_offers_end_report_hold after insert on platform.report_safety_carryovers
  for each row execute function platform.photo_offers_end_report_hold();

create function platform.photo_offers_end_membership() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if tg_op = 'DELETE' then
    perform platform.end_photo_offers_of(array[old.person_id], old.app_id, '{}');
  elsif old.state = 'active' and new.state <> 'active' then
    perform platform.end_photo_offers_of(array[new.person_id], new.app_id, '{}');
  end if;
  return null;
end $$;
revoke all on function platform.photo_offers_end_membership() from public;
create trigger photo_offers_end_membership after update of state or delete on platform.memberships
  for each row execute function platform.photo_offers_end_membership();

create function platform.photo_offers_end_erasure() returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    perform platform.end_photo_offers_of(array[new.id], null, '{}');
  end if;
  return null;
end $$;
revoke all on function platform.photo_offers_end_erasure() from public;
create trigger photo_offers_end_erasure after update of deleted_at on platform.people
  for each row execute function platform.photo_offers_end_erasure();
