-- Public city event supply. This catalog is separate from network.events (the internal audit log).
create table if not exists network.public_event_imports (
  source text primary key check (source = 'nyc-parks'),
  checked_at timestamptz not null check (isfinite(checked_at))
);

create table if not exists network.public_events (
  source text not null references network.public_event_imports (source),
  source_id text not null check (source_id ~ '^[0-9]{1,18}$'),
  city text not null check (city = 'nyc'),
  source_url text not null check (source_url like 'https://www.nycgovparks.org/events/%'),
  title text not null check (length(title) between 1 and 160),
  venue text not null check (length(venue) between 1 and 160),
  area text not null check (length(area) between 1 and 48),
  latitude float8 not null check (latitude between 40.47 and 40.92),
  longitude float8 not null check (longitude between -74.27 and -73.68),
  starts_at timestamptz not null check (isfinite(starts_at)),
  ends_at timestamptz not null check (isfinite(ends_at) and ends_at > starts_at),
  category text not null check (category in ('events', 'hobby')),
  tags text[] not null check (cardinality(tags) <= 20),
  primary key (source, source_id)
);

create index if not exists public_events_city_start on network.public_events (city, starts_at, source_id);

do $$ begin
  create role network_public_event_ingest nologin;
exception when duplicate_object or unique_violation then null;
end $$;

grant usage on schema network to network_public_event_ingest;
revoke all on network.public_events, network.public_event_imports from public;
grant select, insert, update on network.public_event_imports to network_public_event_ingest;
grant insert, delete, select (source) on network.public_events to network_public_event_ingest;
grant select on network.public_events, network.public_event_imports to network_service, network_observatory,
  network_observatory_ntwrk, network_observatory_slop, network_observatory_peon, network_observatory_friends,
  network_observatory_cross_app;
