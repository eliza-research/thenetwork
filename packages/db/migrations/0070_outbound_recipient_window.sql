-- Accepted nonmember sends still contribute to the one-hour cap after their payload is erased.
create table if not exists platform.outbound_recipient_window (
  outbound_id   text primary key references platform.outbound (id) on delete cascade,
  recipient_key text not null check (recipient_key ~ '^[0-9a-f]{64}$'),
  sent_at       timestamptz not null
);
create index if not exists outbound_recipient_window_count on platform.outbound_recipient_window (recipient_key, sent_at);
create index if not exists outbound_recipient_window_expiry on platform.outbound_recipient_window (sent_at);
grant select, insert, delete on platform.outbound_recipient_window to platform_service;
