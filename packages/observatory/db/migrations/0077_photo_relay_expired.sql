alter table platform.photo_relay_items drop constraint if exists photo_relay_items_state_check;
alter table platform.photo_relay_items add constraint photo_relay_items_state_check
  check (state in ('pending','approved','rejected','revoked','expired'));
create index if not exists photo_relay_pending_deadline on platform.photo_relay_items (app_id, expires_at) where state = 'pending';
