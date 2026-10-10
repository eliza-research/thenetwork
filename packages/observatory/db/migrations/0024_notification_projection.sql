-- One message projection marker serves both queued sends and signed handled replies.
alter table network.messages add column notification_recorded_at timestamptz;
update network.messages message set notification_recorded_at=outbound.notification_recorded_at
from platform.outbound outbound where outbound.id=message.id and outbound.app_id=message.app_id;
alter table platform.outbound drop column notification_recorded_at;
create index messages_notification_pending on network.messages(app_id,ts,id)
where direction='outbound' and notification_recorded_at is null and status in ('accepted','sent','delivered','read');
