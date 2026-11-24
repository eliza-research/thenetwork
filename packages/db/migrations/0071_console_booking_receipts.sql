-- The game writer records a delivered notice for a particular start and revision.
-- A dry-run message without this evidence never supplies a booking receipt.
alter table network.messages add column if not exists simulated_booking_start timestamptz;
alter table network.messages add column if not exists simulated_booking_revision integer;
alter table network.messages drop constraint if exists simulated_booking_receipt_is_delivered;
alter table network.messages add constraint simulated_booking_receipt_is_delivered check (
  (simulated_booking_start is null and simulated_booking_revision is null)
  or (simulated_booking_start is not null and simulated_booking_revision is not null
    and simulated_booking_revision >= 0 and direction = 'outbound' and not system
    and opportunity_id is not null and status is not distinct from 'delivered'
    and type is not null and type in ('proposal','scheduling'))
);

-- Keep the app reader away from raw queue and network state rows. A schedule
-- with conflicting saved copies, or more than one matching live notice, is unknown.
do $$
declare
  app text;
  view_name text;
  projection text := $view$
    with schedules as (
      select o.app_id, o.id as opportunity_id, o.meeting_at as booking_at,
        coalesce(b."scheduleRevision",0) as revision, b.lane, b.status, b."bookedAt", b.participants,
        count(*) over (partition by o.app_id,o.id) as schedule_matches
      from network.network_state state
      cross join lateral jsonb_to_recordset(coalesce(nullif(state.state->'opps','null'::jsonb),'[]'::jsonb))
        as b(id text,"meetingAt" bigint,"scheduleRevision" integer,lane text,status jsonb,"bookedAt" jsonb,participants jsonb)
      join network.opportunities o on o.app_id=state.app_id and o.id=b.id
        and o.meeting_at=timestamptz 'epoch' + b."meetingAt" * interval '1 millisecond'
      where state.app_id=%L
    ), notices as (
      select b.app_id,b.opportunity_id,m.member_id,b.booking_at,b.revision,b.lane,
        q.status,q.sent_at,
        count(*) over (partition by b.app_id,b.opportunity_id,m.member_id) as notice_matches
      from schedules b
      join network.messages m on m.app_id=b.app_id and m.opportunity_id=b.opportunity_id
        and m.direction='outbound' and not m.system and m.simulated_booking_revision is null
      join platform.outbound q on q.app_id=m.app_id and q.id=m.id and q.member_id=m.member_id
      where b.schedule_matches=1 and b."bookedAt" ? m.member_id
        and b.status @> jsonb_build_array(jsonb_build_array(m.member_id,'yes'::text))
        -- Same key as currentBookingReceipt for a revised booking.
        and ((b.revision=0 and m.type='proposal') or (b.revision>0 and m.type='scheduling'
          and m.id=(case when b.lane='Cofounder' then 'cofounder-intro:reveal:' else '' end)
            || 'reschedule:updated:' || b.opportunity_id || ':r' || b.revision || ':' || m.member_id))
    )
    select app_id,opportunity_id,member_id,booking_at,revision,lane,sent_at as received_at,false as simulated
      from notices where notice_matches=1 and status in ('accepted','sent','delivered','read')
        and sent_at >= timestamptz 'epoch' and sent_at <= current_timestamp
    union all
    select b.app_id,b.opportunity_id,m.member_id,b.booking_at,b.revision,b.lane,min(m.ts) as received_at,true as simulated
      from schedules b join network.messages m on m.app_id=b.app_id and m.opportunity_id=b.opportunity_id
        and m.simulated_booking_revision=b.revision and m.simulated_booking_start=b.booking_at
      where b.schedule_matches=1 and b.participants ? m.member_id
        and not exists (select 1 from notices n where n.app_id=b.app_id and n.opportunity_id=b.opportunity_id and n.member_id=m.member_id)
      group by b.app_id,b.opportunity_id,m.member_id,b.booking_at,b.revision,b.lane
  $view$;
begin
  for app in select id from platform.apps order by id loop
    view_name := 'booking_receipts_' || app;
    execute format('create or replace view network.%I with (security_barrier=true) as ' || projection, view_name, app);
    execute format('revoke all on network.%I from public', view_name);
    execute format('grant select on network.%I to %I', view_name, 'network_observatory_' || app);
    if app='ntwrk' then
      grant select on network.booking_receipts_ntwrk to network_observatory;
    else
      execute format('revoke select on network.%I from network_observatory', view_name);
    end if;
  end loop;
end $$;
