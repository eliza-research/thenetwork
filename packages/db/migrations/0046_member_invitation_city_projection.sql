-- A welcome and its inviter notice may belong to different conversation runtimes.
alter table platform.member_invitations add column welcome_projected_at timestamptz;
update platform.member_invitations set welcome_projected_at=projected_at where projected_at is not null;
alter table platform.member_invitations add constraint member_invitations_welcome_before_notice
  check (projected_at is null or welcome_projected_at is not null);
