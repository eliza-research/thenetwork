-- The durable restriction can represent an explicit decision or a carried runtime hard hold.
alter table platform.staff_safety_holds add column origin text not null default 'staff'
  check (origin='staff' or (origin='automatic_carryover' and app_id is not null));
