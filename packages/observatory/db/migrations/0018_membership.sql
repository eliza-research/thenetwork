-- 0018: membership hardening (PRD 28.1, 28.3, 11.5, F1, F25; audit platform-25).
--  1. platform.memberships.state gains 'waitlist': a person who texted the shared line with no keyword
--     while The Network is invite-only. They are not a network member (never matched, never texted
--     first); a staff invite of the same number makes them active.
--  2. platform.memberships.invited_at: an invite that nobody answered expires after 30 days.
--  3. A staff invite makes a phone identity before the invitee proves the number: verified_at stays
--     null until a message or a code comes from it.
--  4. platform.membership_flags: soft approval. A join that a rule flags (bursts from one IP or one
--     block of numbers, risk words) onboards normally but is never matched until staff clear it.
--     network.members.flagged carries it to the Network.
--  5. platform.phone_changes: a staff phone change (F25), confirmed by a code to the new number.
--  6. The support staff role (phone changes).
-- Runs once (public.__migrations); written so that a second run is harmless too.

alter table platform.memberships drop constraint if exists memberships_state_check;
alter table platform.memberships add constraint memberships_state_check
  check (state in ('invited', 'waitlist', 'onboarding', 'active', 'paused', 'restricted', 'removed'));

alter table platform.memberships add column if not exists invited_at timestamptz;
-- Invites from before this migration start their 30 days now.
update platform.memberships set invited_at = now() where state = 'invited' and invited_at is null;
create index if not exists memberships_invited on platform.memberships (invited_at) where state = 'invited';

alter table platform.phone_identities alter column verified_at drop not null;

create table if not exists platform.membership_flags (
  app_id     text not null references platform.apps (id),
  person_id  uuid not null references platform.people (id),
  reasons    text[] not null,
  flagged_at timestamptz not null,
  decision   text check (decision in ('clear', 'keep')),
  decided_by text,
  decided_at timestamptz,
  primary key (app_id, person_id)
);
create index if not exists membership_flags_open on platform.membership_flags (flagged_at) where decision is null;
grant select, insert, update, delete on platform.membership_flags to platform_service;

alter table network.members add column if not exists flagged boolean not null default false;

create table if not exists platform.phone_changes (
  id           uuid primary key,
  person_id    uuid not null references platform.people (id),
  app_id       text not null references platform.apps (id),
  new_e164     text not null check (new_e164 ~ '^\+1[2-9][0-9]{2}[0-9]{7}$'),
  requested_by text not null,
  requested_at timestamptz not null,
  confirmed_at timestamptz,
  -- Keyed hashes only: the old number is not kept.
  old_hash     text,
  new_hash     text
);
create index if not exists phone_changes_person on platform.phone_changes (person_id, requested_at desc);
grant select, insert, update, delete on platform.phone_changes to platform_service;

alter table platform.staff_roles drop constraint if exists staff_roles_role_check;
alter table platform.staff_roles add constraint staff_roles_role_check
  check (role in ('admin', 'reviewer', 'safety', 'analyst', 'engineer', 'cross_app_safety', 'support'));
