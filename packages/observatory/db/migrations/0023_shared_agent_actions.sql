-- Action receipts belong to their original signed inbound turn, not another queue.
alter table platform.inbound add column action_receipts jsonb not null default '{}'::jsonb;
alter table network.members add column participation_window jsonb;
