-- Keep an explicitly stated home through a multi-turn native join. Existing pending flows are unchanged.
alter table platform.pending_texts add column if not exists home_city text references platform.cities(id);
