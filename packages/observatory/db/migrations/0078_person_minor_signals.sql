create table platform.person_minor_signals (
  person_id uuid primary key references platform.people(id) on delete cascade,
  at timestamptz not null
);
revoke all on platform.person_minor_signals from public;
grant select, insert, update, delete on platform.person_minor_signals to network_service;
