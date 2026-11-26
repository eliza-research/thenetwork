-- The booked plan reached this member, projected from the saved state's bookedTold onto the
-- participation row. The snapshot builder derives introduced edges from this column, which the
-- console's read roles can read, instead of network.network_state, which they must never read.
alter table network.participations add column if not exists booked_told boolean not null default false;

-- Backfill from the saved state. The next PgStore save rewrites every participation row from the
-- state, so this only covers rows read before that save.
update network.participations p set booked_told = true
from network.network_state saved,
  lateral jsonb_array_elements(coalesce(saved.state->'opps', '[]'::jsonb)) item
where saved.app_id = p.app_id and item->>'id' = p.opportunity_id and item->'bookedTold' ? p.member_id;
