-- Signed Shared-agent turns reuse the existing inbound owner. No parallel turn queue.
alter table platform.inbound drop constraint inbound_status_check;
alter table platform.inbound add constraint inbound_status_check check(status in ('pending','done','failed','processing','unresolved'));
alter table platform.inbound add column request_hash text;
alter table platform.inbound add column sender_hash text;
alter table platform.inbound add column response jsonb;
alter table platform.inbound add column app_id text;
alter table platform.inbound add column member_id text;
alter table platform.inbound add column replies jsonb not null default '[]'::jsonb;
alter table platform.inbound add column receipt_hash text;
alter table platform.inbound add column receipt jsonb;
create unique index inbound_signed_sender_processing on platform.inbound(sender_hash) where status='processing';
alter table network.messages add column inbound_id text;
