update platform.photo_offers set phase = 'ready' where phase = 'viewing';
update platform.photo_offers set phase = 'ended' where phase = 'closed';
alter table platform.photo_offers drop constraint if exists photo_offers_phase_check;
alter table platform.photo_offers add constraint photo_offers_phase_check
  check (phase in ('asking','reviewing','ready','declined','lapsed','rejected','check_timed_out','revoked','ended','reported'));
drop index if exists platform.photo_offers_one_open;
create unique index photo_offers_one_open on platform.photo_offers (app_id, sender_person_id, recipient_person_id) where phase in ('asking','reviewing','ready');
drop index if exists platform.photo_offers_checked;
create index photo_offers_checked on platform.photo_offers (app_id, checked_at) where phase in ('asking','reviewing','ready');
alter table platform.photo_offers drop column ready_by, drop column view_until;
alter table platform.photo_offers add column taken_back_ids text[] not null default '{}' check (cardinality(taken_back_ids) <= 3);

alter table platform.photo_relay_items drop constraint if exists photo_relay_items_state_check;
alter table platform.photo_relay_items add constraint photo_relay_items_state_check
  check (state in ('screening','pending','approved','rejected','revoked','expired'));
alter table platform.photo_relay_items add column screen_attempts int not null default 0 check (screen_attempts between 0 and 5),
  add column screen_at timestamptz;
alter table platform.photo_relay_items add constraint photo_relay_items_screen_at check ((state = 'screening') = (screen_at is not null));
create index photo_relay_screen_due on platform.photo_relay_items (app_id, screen_at) where state = 'screening';

alter table platform.photo_page_links alter column expires_at drop not null;
update platform.photo_page_links set expires_at = null where purpose = 'view';
alter table platform.photo_page_links add constraint photo_page_links_view_open check ((purpose = 'view') = (expires_at is null));
create index photo_page_links_offer on platform.photo_page_links (offer_id) where purpose = 'view';
