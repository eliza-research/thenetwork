-- A read-only app view for existing message rows. None of the queue's address, body, provider
-- identifiers, diagnostic errors, or notes are granted to the console role.
do $$
declare
  a text;
  view_name text;
  projection text := $view$
    select q.app_id, q.member_id, q.id as message_id,
      case when q.status in ('pending','retry_scheduled','deferred_quiet_hours','held_awaiting_reply',
        'sending','accepted','sent','delivered','read','blocked','failed','failed_unknown','unknown_acceptance',
        'expired','refused_not_approved','refused_opted_out','suppressed_ineligible','refused_person_cap',
        'parked_invalid_timezone','parked_error','parked_leak_review','dropped_leak_review','dropped_forgotten') then q.status end as status,
      case
        when q.status = 'retry_scheduled' and q.attempts = 0 then case
          when q.note in ('line safety review','line safety reply_only','line safety pause_new') then 'line_paused'
          when q.note = 'per-recipient hourly cap' then 'recipient_cap'
          when q.note = 'per-line daily cap' then 'line_cap'
          when q.note = 'per-line new conversation cap' then 'new_conversation_cap'
          else 'awaiting_admission' end
        when q.status = 'retry_scheduled' then 'earlier_attempt'
        when q.status = 'suppressed_ineligible' and q.note = 'reply without a recent inbound' then 'reply_window'
        when q.status = 'suppressed_ineligible' and q.note = 'plan_availability_changed' then 'plan_availability_changed'
        when q.status = 'suppressed_ineligible' then 'eligibility'
        when q.status = 'expired' then 'expired_or_stale'
        when q.status = 'refused_not_approved' then 'sending_not_approved'
        when q.status = 'refused_opted_out' then 'no_send_consent'
        when q.status = 'refused_person_cap' then 'person_cap'
        when q.status = 'deferred_quiet_hours' then 'quiet_hours'
        when q.status = 'held_awaiting_reply' then 'awaiting_reply'
        when q.status in ('parked_leak_review','dropped_leak_review') then 'leak_guard'
        when q.status = 'parked_invalid_timezone' then 'invalid_timezone'
        when q.status = 'dropped_forgotten' then 'membership_unavailable'
        when q.status in ('unknown_acceptance','failed_unknown') then 'acceptance_unknown'
        when q.status in ('blocked','failed') then 'provider_refused'
        when q.status = 'parked_error' then 'dispatch_error'
        when q.status in ('accepted','sent') and q.sent_at is not null then 'accepted_by_provider'
      end as reason,
      q.status in ('parked_leak_review','dropped_leak_review') as leak_stopped,
      q.leak_released_by is not null as staff_released,
      (q.attempts > 0 and q.body is not null and q.body=m.body) as attempted
    from platform.outbound q
    join network.messages m on m.app_id=q.app_id and m.member_id=q.member_id and m.id=q.id
    where m.direction='outbound' and not m.system
  $view$;
begin
  for a in select id from platform.apps order by id loop
    view_name := 'outbound_evidence_' || a;
    execute format('create view network.%I with (security_barrier=true) as %s and q.app_id = %L', view_name, projection, a);
    execute format('revoke all on network.%I from public', view_name);
    execute format('grant select on network.%I to %I', view_name, 'network_observatory_' || a);
    if a = 'ntwrk' then
      grant select on network.outbound_evidence_ntwrk to network_observatory;
    end if;
  end loop;
end $$;
