-- One message projection marker serves both queued sends and signed handled replies.
alter table network.messages add column notification_recorded_at timestamptz;
create index messages_notification_pending on network.messages(app_id,ts,id)
where direction='outbound' and notification_recorded_at is null and status in ('accepted','sent','delivered','read');
