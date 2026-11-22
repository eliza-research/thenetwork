-- Bind each immutable booking notice to the participants represented in its text.
alter table network.messages add column booking_roster_member_ids text[];
alter table network.messages add constraint booking_notice_roster_has_members check (
  booking_roster_member_ids is null or (
    direction = 'outbound' and type is not distinct from 'proposal' and opportunity_id is not null
    and cardinality(booking_roster_member_ids) > 0 and array_position(booking_roster_member_ids, null) is null
  )
);
