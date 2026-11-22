create table network.monthly_gatherings (
  app_id text not null check (app_id = 'ntwrk'),
  id uuid not null,
  city text not null check (city = 'nyc'),
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  venue_kind text not null check (venue_kind in ('curated', 'listing')),
  venue_ref text not null check (length(venue_ref) between 1 and 200),
  venue_name text not null check (length(venue_name) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  capacity integer not null check (capacity between 3 and 150),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  revision integer not null default 0,
  created_by text not null,
  created_at timestamptz not null,
  reviewed_by text,
  reviewed_at timestamptz,
  primary key (app_id, id),
  check (created_at < starts_at and ends_at - starts_at between interval '30 minutes' and interval '6 hours'),
  check (month = to_char(starts_at at time zone 'America/New_York', 'YYYY-MM')
    and month = to_char((ends_at - interval '1 millisecond') at time zone 'America/New_York', 'YYYY-MM')),
  check ((status = 'draft' and revision = 0 and reviewed_by is null and reviewed_at is null)
    or (status in ('approved', 'rejected') and revision = 1 and reviewed_by is not null and reviewed_at is not null and reviewed_at >= created_at)),
  check (status <> 'approved' or reviewed_at < starts_at)
);

create unique index monthly_gatherings_active_month on network.monthly_gatherings (app_id, city, month)
  where status in ('draft', 'approved');

alter table network.monthly_gatherings enable row level security;
create policy monthly_gatherings_app on network.monthly_gatherings to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());

revoke all on network.monthly_gatherings from public;
grant select, insert on network.monthly_gatherings to network_service;
grant update (status, revision, reviewed_by, reviewed_at) on network.monthly_gatherings to network_service;
