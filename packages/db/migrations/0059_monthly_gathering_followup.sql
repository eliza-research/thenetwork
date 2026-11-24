create table network.monthly_gathering_attendance (
  app_id text not null,
  gathering_id uuid not null,
  revision integer not null,
  member_id text not null,
  attended boolean not null,
  response_id text not null,
  responded_at timestamptz not null check (isfinite(responded_at)),
  primary key (app_id, gathering_id, revision, member_id),
  foreign key (app_id, gathering_id, revision) references network.monthly_gatherings (app_id, id, revision) on delete cascade,
  foreign key (app_id, gathering_id, member_id) references network.monthly_gathering_rsvps (app_id, gathering_id, member_id) on delete cascade
);

create table network.monthly_gathering_followup_choices (
  app_id text not null,
  gathering_id uuid not null,
  revision integer not null,
  group_review_id uuid not null,
  member_id text not null,
  peer_id text not null check (peer_id <> member_id),
  wanted boolean not null,
  response_id text not null,
  responded_at timestamptz not null check (isfinite(responded_at)),
  own_attendance_response text not null,
  peer_attendance_response text not null,
  primary key (app_id, gathering_id, revision, group_review_id, member_id, peer_id),
  foreign key (app_id, gathering_id, revision, group_review_id, member_id)
    references network.monthly_gathering_group_members (app_id, gathering_id, revision, review_id, member_id) on delete cascade,
  foreign key (app_id, gathering_id, revision, group_review_id, peer_id)
    references network.monthly_gathering_group_members (app_id, gathering_id, revision, review_id, member_id) on delete cascade,
  foreign key (app_id, gathering_id, revision, member_id)
    references network.monthly_gathering_attendance (app_id, gathering_id, revision, member_id) on delete cascade,
  foreign key (app_id, gathering_id, revision, peer_id)
    references network.monthly_gathering_attendance (app_id, gathering_id, revision, member_id) on delete cascade
);
create index monthly_gathering_followup_peer on network.monthly_gathering_followup_choices (app_id, gathering_id, revision, peer_id);

alter table network.monthly_gathering_attendance enable row level security;
alter table network.monthly_gathering_followup_choices enable row level security;
create policy monthly_gathering_attendance_app on network.monthly_gathering_attendance to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
create policy monthly_gathering_followup_choices_app on network.monthly_gathering_followup_choices to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on network.monthly_gathering_attendance, network.monthly_gathering_followup_choices from public;
grant select, insert, update on network.monthly_gathering_attendance, network.monthly_gathering_followup_choices to network_service;
