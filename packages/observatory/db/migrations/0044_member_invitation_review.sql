-- Keep coarse evidence for staff review. No name, contact data, message ID or bearer token.
create table platform.member_invitation_reviews (
  app_id text not null references platform.apps(id),
  id text not null check (id ~ '^mir_[0-9a-f]{32}$'),
  inviter_member_id text not null,
  relationship text not null check (relationship in ('friend', 'coworker', 'roommate', 'family')),
  duration_months integer not null check (duration_months between 0 and 1500),
  depth text not null check (depth in ('met_once', 'somewhat', 'well')),
  review_reasons text[] not null check (cardinality(review_reasons) between 1 and 3
    and review_reasons <@ array['weak_vouch', 'burst', 'risk_language']::text[]),
  requested_at timestamptz not null,
  expires_at timestamptz not null check (expires_at > requested_at),
  state text not null default 'pending' check (state in ('pending', 'approved', 'denied', 'released')),
  reviewed_at timestamptz,
  reviewer_id text,
  released_at timestamptz,
  primary key (app_id, id),
  foreign key (app_id, inviter_member_id) references network.members(app_id, id) on delete cascade,
  check ((state = 'pending') = (reviewed_at is null)),
  check ((reviewed_at is null) = (reviewer_id is null)),
  check (reviewed_at is null or (reviewed_at >= requested_at and reviewed_at < expires_at)),
  check ((state = 'released') = (released_at is not null)),
  check (released_at is null or (released_at >= reviewed_at and released_at < expires_at))
);

create index member_invitation_reviews_pending on platform.member_invitation_reviews (app_id, requested_at, id) where state = 'pending';
create index member_invitation_reviews_expiry on platform.member_invitation_reviews (app_id, expires_at);

alter table platform.member_invitation_reviews enable row level security;
create policy member_invitation_reviews_app on platform.member_invitation_reviews to network_service
  using (app_id = network.current_app_id()) with check (app_id = network.current_app_id());
revoke all on platform.member_invitation_reviews from public;
grant select, insert, update, delete on platform.member_invitation_reviews to network_service;

-- Earlier issued links keep their original relationship-only evidence.
alter table platform.member_invitations
  add column duration_months integer check (duration_months between 0 and 1500),
  add column depth text check (depth in ('met_once', 'somewhat', 'well')),
  add check ((duration_months is null) = (depth is null));
