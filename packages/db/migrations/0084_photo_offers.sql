alter table platform.outbound drop column approved_photos;
update platform.photo_relay_items set state = 'revoked' where state in ('pending','approved');
alter table platform.photo_relay_items drop column action_id, drop column delivery_intent, drop column delivery_expires_at;

alter table platform.photos add column label text check (label is null or (length(label) <= 24 and label ~ '^[a-z0-9]+([ -][a-z0-9]+){0,2}$')),
  add column batch_id text check (batch_id is null or batch_id ~ '^[a-f0-9]{32}$');
create unique index photos_label_once on platform.photos (person_id, app_id, label) where label is not null and deleted_at is null;

create table platform.photo_relay_drafts (
  id text primary key check (id ~ '^pdr_[a-f0-9]{32}$'),
  sender_person_id uuid not null references platform.people(id) on delete cascade,
  app_id text not null references platform.apps(id),
  purpose text not null check (purpose in ('send','delete')),
  thread_id text check (thread_id is null or length(thread_id) between 1 and 200),
  recipient_member_id text,
  shown_ids text[] not null check (cardinality(shown_ids) <= 6),
  proposed_ids text[] not null check (cardinality(proposed_ids) <= 3),
  wants_set boolean not null, listed boolean not null,
  photo_set_sha text not null check (photo_set_sha ~ '^[a-f0-9]{64}$'),
  policy_version text not null,
  prompt_via text not null check (prompt_via in ('turn','send')),
  prompt_inbound_id text, prompt_key text not null,
  shown_at timestamptz not null, revision int not null check (revision >= 1),
  unique (sender_person_id, app_id),
  check ((purpose = 'send') = (thread_id is not null and recipient_member_id is not null))
);
grant select, insert, update, delete on platform.photo_relay_drafts to platform_service;

create table platform.photo_offers (
  id text primary key check (id ~ '^pof_[a-f0-9]{32}$'),
  request_key text not null unique,
  app_id text not null references platform.apps(id),
  thread_id text not null check (length(thread_id) between 1 and 200),
  sender_person_id uuid not null references platform.people(id) on delete cascade,
  recipient_person_id uuid not null references platform.people(id) on delete cascade,
  sender_member_id text not null, recipient_member_id text not null,
  photo_ids text[] not null check (cardinality(photo_ids) between 1 and 3),
  photo_sha256 text[] not null,
  photo_count int not null check (photo_count between 1 and 3),
  consent_id text not null unique, consented_at timestamptz not null, policy_version text not null,
  phase text not null check (phase in ('asking','reviewing','ready','declined','lapsed','rejected','check_timed_out','revoked','ended','reported')),
  answer_by timestamptz not null,
  was_ready boolean not null default false, ended_by_sender boolean not null default false,
  taken_back_ids text[] not null default '{}' check (cardinality(taken_back_ids) <= 3),
  party_ended boolean not null default false,
  sender_notice text check (sender_notice in ('sent','not_taken','not_approved','check_timed_out')),
  notice_at timestamptz, notice_sent_at timestamptz,
  created_at timestamptz not null, changed_at timestamptz not null, checked_at timestamptz not null,
  check (sender_person_id <> recipient_person_id), check (sender_member_id <> recipient_member_id)
);
create unique index photo_offers_one_open on platform.photo_offers (app_id, sender_person_id, recipient_person_id) where phase in ('asking','reviewing');
create index photo_offers_answer_due on platform.photo_offers (app_id, answer_by) where phase = 'asking';
create index photo_offers_notice_due on platform.photo_offers (app_id, notice_at) where sender_notice is not null and notice_sent_at is null;
create index photo_offers_recipient on platform.photo_offers (recipient_person_id, app_id, phase);
create index photo_offers_sender on platform.photo_offers (sender_person_id, app_id, phase);
create index photo_offers_changed on platform.photo_offers (app_id, changed_at);
create index photo_offers_checked on platform.photo_offers (app_id, checked_at) where phase in ('asking','reviewing') or (phase = 'ready' and party_ended);
grant select, insert, update, delete on platform.photo_offers to platform_service;

alter table platform.photo_relay_items add column offer_id text references platform.photo_offers(id) on delete cascade;
create index photo_relay_items_offer on platform.photo_relay_items (offer_id);

create table platform.photo_page_links (
  id text primary key check (id ~ '^[a-f0-9]{64}$'),
  person_id uuid not null references platform.people(id) on delete cascade,
  app_id text not null references platform.apps(id),
  purpose text not null check (purpose in ('check','mine','view')),
  draft_id text references platform.photo_relay_drafts(id) on delete cascade, draft_revision int,
  offer_id text references platform.photo_offers(id) on delete cascade,
  issued_at timestamptz not null, expires_at timestamptz check (expires_at > issued_at),
  device_hash text check (device_hash is null or device_hash ~ '^[a-f0-9]{64}$'),
  check ((purpose = 'check') = (draft_id is not null and draft_revision is not null)),
  check ((purpose = 'view') = (offer_id is not null)),
  constraint photo_page_links_view_open check ((purpose = 'view') = (expires_at is null))
);
create index photo_page_links_person on platform.photo_page_links (person_id, app_id, purpose);
create index photo_page_links_offer on platform.photo_page_links (offer_id) where purpose = 'view';
create index photo_page_links_expiry on platform.photo_page_links (expires_at);
grant select, insert, update, delete on platform.photo_page_links to platform_service;

create table platform.photo_receive_prefs (
  person_id uuid not null references platform.people(id) on delete cascade,
  app_id text not null references platform.apps(id),
  never boolean not null, changed_at timestamptz not null,
  primary key (person_id, app_id)
);
grant select, insert, update, delete on platform.photo_receive_prefs to platform_service;

create or replace function platform.forget_profile_suggestions() returns trigger
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if tg_op = 'UPDATE' then
    if new.state <> 'removed' then
      return null;
    end if;
  end if;
  delete from platform.profile_suggestion_batches where person_id=old.person_id and app_id=old.app_id;
  delete from platform.profile_suggestion_connection_receipts where person_id=old.person_id and app_id=old.app_id;
  delete from platform.photo_relay_items where recipient_person_id=old.person_id and app_id=old.app_id;
  delete from platform.photo_offers where recipient_person_id=old.person_id and app_id=old.app_id;
  delete from platform.photo_relay_drafts where sender_person_id=old.person_id and app_id=old.app_id;
  delete from platform.photo_page_links where person_id=old.person_id and app_id=old.app_id;
  delete from platform.photo_receive_prefs where person_id=old.person_id and app_id=old.app_id;
  return null;
end $$;
