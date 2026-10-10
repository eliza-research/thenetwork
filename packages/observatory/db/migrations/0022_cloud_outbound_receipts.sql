-- Cloud uses the existing persisted outbox. Unknown acceptance is held for receipt lookup only.
alter table platform.outbound add column provider_message_ids jsonb;
alter table platform.outbound add column history_recorded boolean;
alter table platform.outbound add column notification_recorded_at timestamptz;
create index outbound_unknown_receipt on platform.outbound(app_id,line,updated_at,id) where status='unknown_acceptance';
