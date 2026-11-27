-- 0101: upgrade-safe 0098 venue columns, NYC city name normalization, and
-- meetup_arrivals deduplication + uniqueness + unified valid state check.
-- Idempotent: safe to run more than once on both fresh and upgraded databases.

-- ---------------------------------------------------------------- 1. Upgrade-safe 0098 columns on platform.venues
alter table platform.venues add column if not exists all_ages boolean not null default false;
alter table platform.venues add column if not exists is_alcohol_centric boolean not null default false;
alter table platform.venues add column if not exists halal_friendly boolean not null default false;
alter table platform.venues add column if not exists kosher_friendly boolean not null default false;
alter table platform.venues add column if not exists gluten_free_friendly boolean not null default false;
alter table platform.venues add column if not exists severe_allergen_safe boolean not null default false;
alter table platform.venues add column if not exists is_smoke_free boolean not null default true;
alter table platform.venues add column if not exists open_event_eligible boolean not null default false;
alter table platform.venues add column if not exists safety_score smallint not null default 8 check (safety_score between 0 and 10);
alter table platform.venues add column if not exists transit_score smallint not null default 4 check (transit_score between 0 and 5);
alter table platform.venues add column if not exists hobbies jsonb not null default '[]'::jsonb;
alter table platform.venues add column if not exists cuisine_tags jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------- 2. Normalize NYC city display name
update platform.cities
set name = 'New York City'
where id = 'nyc' and name = 'New York';

-- ---------------------------------------------------------------- 3. Deduplicate and constrain network.meetup_arrivals
delete from network.meetup_arrivals a
using (
  select id
  from (
    select
      id,
      row_number() over (
        partition by app_id, opportunity_id, member_id
        order by updated_at desc, id desc
      ) as rn
    from network.meetup_arrivals
  ) ranked
  where rn > 1
) dup
where a.id = dup.id;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'network'
      and t.relname = 'meetup_arrivals'
      and c.conname in ('meetup_arrivals_app_opp_member_key', 'meetup_arrivals_app_opp_member_uniq')
  ) then
    alter table network.meetup_arrivals
      add constraint meetup_arrivals_app_opp_member_key
      unique (app_id, opportunity_id, member_id);
  end if;

  alter table network.meetup_arrivals
    drop constraint if exists meetup_arrivals_state_check;

  alter table network.meetup_arrivals
    add constraint meetup_arrivals_state_check
    check (state in (
      'en_route',
      'late',
      'omw',
      'delayed',
      'arrived',
      'seated',
      'met',
      'venue_closed',
      'venue_full',
      'cannot_find',
      'panic_exit',
      'cancelled',
      'no_show'
    ));
end $$;

drop index if exists network.meetup_arrivals_app_opp;
