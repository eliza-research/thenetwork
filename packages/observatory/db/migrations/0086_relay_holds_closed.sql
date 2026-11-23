update network.relay_records
set decision = case when decision = 'hold' then 'block' else decision end,
    reasons = (select coalesce(array_agg(distinct r order by r), '{}'::text[]) from unnest(reasons || array['review:closed']) as u(r)),
    review = case when review = 'held' then 'expired' else review end,
    reviewed_by = case when review = 'held' then 'system:relay_automated' else reviewed_by end,
    reviewed_at = case when review = 'held' then now() else reviewed_at end
where decision = 'hold' or review = 'held';

alter table network.relay_records drop constraint if exists relay_records_decision_check;
alter table network.relay_records add constraint relay_records_decision_check check (decision in ('pass', 'block'));
alter table network.relay_records drop constraint if exists relay_records_review_check;
alter table network.relay_records add constraint relay_records_review_check check (review in ('released', 'rejected', 'expired'));
drop index if exists network.relay_records_held;

update network.network_state s
set state = jsonb_set(s.state, '{relay,log}', (
  select coalesce(jsonb_agg(
    case when l.e->>'decision' = 'hold'
      then l.e || jsonb_build_object('decision', 'block', 'reasons', (
        select coalesce(jsonb_agg(distinct x.r order by x.r), '[]'::jsonb)
        from jsonb_array_elements_text(coalesce(l.e->'reasons', '[]'::jsonb) || '["review:closed"]'::jsonb) as x(r)))
      else l.e end
    order by l.o), '[]'::jsonb)
  from jsonb_array_elements(s.state->'relay'->'log') with ordinality as l(e, o)))
where jsonb_typeof(s.state->'relay'->'log') = 'array'
  and exists (select 1 from jsonb_array_elements(s.state->'relay'->'log') as h(e) where h.e->>'decision' = 'hold');

update network.network_state
set state = state #- '{relay,held}'
where jsonb_typeof(state->'relay') = 'object' and state->'relay' ? 'held';
