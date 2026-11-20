-- 0042: the per-recipient hourly cap of the outbound queue counts sends in its own window table.
--
-- Before: the cap counted platform.outbound rows by to_address. A row to a non-member clears
-- to_address when it ends, and a delivery receipt ends it, so delivered texts to a non-member were
-- not counted. Keeping the address longer would keep a plaintext number after delivery.
--
-- platform.outbound_recipient_sends has one row for each send the provider took (accepted, sent,
-- delivered or read; spec/outboundReceipt.md "Only a send the provider took counts toward the
-- recipient's hourly cap"). The recipient is a keyed hash (HMAC-SHA256 with PLATFORM_HASH_KEY, the
-- same "phone:" key as the suppression list), never the address. A failure receipt deletes the row.
-- The queue's purge() deletes rows older than one hour by the (line, sent_at) index; it never reads
-- platform.outbound. Rows of the hour before this migration are not counted (the key needs the server key).
create table if not exists platform.outbound_recipient_sends (
  outbound_id   text primary key references platform.outbound (id) on delete cascade,
  line          text not null,
  recipient_key text not null,
  sent_at       timestamptz not null
);
create index if not exists outbound_recipient_sends_count on platform.outbound_recipient_sends (line, recipient_key, sent_at);
create index if not exists outbound_recipient_sends_expiry on platform.outbound_recipient_sends (line, sent_at);

grant select, insert, delete on platform.outbound_recipient_sends to platform_service;
