with pending as (
  select f.app_id, f.member_id, max(f.valid_from) as signalled_at
  from network.facets f
  where f.status = 'proposed' and f.tags @> array['signal:opt_out']::text[]
  group by f.app_id, f.member_id
), due as (
  select p.app_id, p.member_id from pending p
  where not exists (
    select 1 from network.events e
    where e.app_id = p.app_id and e.object_type = 'member' and e.object_id = p.member_id
      and e.type = 'member_state_requested' and e.at >= coalesce(p.signalled_at, '-infinity'::timestamptz))
), paused as (
  update network.members m set participation_state = 'paused', participation_window = null
  from due
  where m.app_id = due.app_id and m.id = due.member_id
    and (m.participation_state is distinct from 'paused' or m.participation_window is not null)
  returning m.app_id, m.id
)
insert into network.events (app_id, at, actor_type, actor_id, type, object_type, object_id, payload)
select app_id, now(), 'agent', id, 'member_state_requested', 'member', id,
  '{"state":"paused","from":null,"until":null,"source":"agent_signal"}'::jsonb
from paused;

update network.facets set status = 'confirmed'
where status = 'proposed' and tags @> array['signal:opt_out']::text[];
