alter table platform.photo_relay_items drop constraint if exists photo_relay_items_state_check;
alter table platform.photo_relay_items add constraint photo_relay_items_state_check
  check (state in ('screening','pending','approved','rejected','revoked','expired'));
alter table platform.photo_relay_items add column screen_attempts int not null default 0 check (screen_attempts between 0 and 5),
  add column screen_at timestamptz;
alter table platform.photo_relay_items add constraint photo_relay_items_screen_at check ((state = 'screening') = (screen_at is not null));
create index photo_relay_screen_due on platform.photo_relay_items (app_id, screen_at) where state = 'screening';
create index photo_relay_pending_deadline on platform.photo_relay_items (app_id, expires_at) where state = 'pending';
