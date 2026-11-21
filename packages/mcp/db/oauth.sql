-- OAuth state for the MCP server (packages/mcp). Repeatable: it only creates what is missing.
-- PgOAuthStore.migrate() runs it. Tokens, codes and client secrets are stored as sha256 hashes only.
-- The phone of a grant is kept server-side as platform.sessions keeps it; it is never sent to a client.
create schema if not exists oauth;

create table if not exists oauth.clients (
  id text primary key,
  secret_hash text,
  name text,
  redirect_uris text[] not null,
  auth_method text not null check (auth_method in ('none', 'client_secret_basic', 'client_secret_post')),
  app_id text not null,
  surface text not null check (surface in ('full', 'openai')),
  kind text not null check (kind in ('dcr', 'cimd')),
  created_at timestamptz not null
);

create table if not exists oauth.auth_requests (
  id text primary key,
  browser_hash text not null,
  client_id text not null,
  app_id text not null,
  redirect_uri text not null,
  state text,
  code_challenge text not null,
  scopes text[] not null,
  resource text not null,
  e164 text,
  person_id text,
  step text not null check (step in ('phone', 'code', 'consent', 'enrolling', 'enrolled')),
  created_at timestamptz not null,
  expires_at timestamptz not null
);
-- The OAuth schema is applied to both new and existing databases by the service.
do $$ begin
  if exists (select 1 from pg_constraint where conrelid = 'oauth.auth_requests'::regclass
    and conname = 'auth_requests_step_check' and pg_get_constraintdef(oid) not like '%enrolled%') then
    alter table oauth.auth_requests drop constraint auth_requests_step_check;
    alter table oauth.auth_requests add constraint auth_requests_step_check
      check (step in ('phone', 'code', 'consent', 'enrolling', 'enrolled'));
  end if;
end $$;
create index if not exists auth_requests_expires on oauth.auth_requests (expires_at);
create index if not exists auth_requests_by_person on oauth.auth_requests (person_id, app_id) where person_id is not null;

create table if not exists oauth.grants (
  id text primary key,
  client_id text not null references oauth.clients (id) on delete cascade,
  app_id text not null,
  -- The platform's keyed hash of the number (PLATFORM_HASH_KEY), never the number (audit: oauth phone).
  phone_key text not null,
  person_id text,
  scopes text[] not null,
  resource text not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
-- An earlier draft of this schema kept the number itself (e164). Never deployed; such grants are dropped.
alter table oauth.grants add column if not exists phone_key text;
do $$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'oauth' and table_name = 'grants' and column_name = 'e164') then
    delete from oauth.grants where phone_key is null;
    alter table oauth.grants drop column e164;
  end if;
end $$;
alter table oauth.grants alter column phone_key set not null;
alter table oauth.grants add column if not exists cloud_authority jsonb;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='grants_cloud_authority_required' and conrelid='oauth.grants'::regclass) then
    alter table oauth.grants add constraint grants_cloud_authority_required check
      (id not like 'grant_cloud_%' or (cloud_authority is not null and jsonb_typeof(cloud_authority)='object' and coalesce(cloud_authority->>'version','')='1'));
  end if;
end $$;
create or replace function oauth.keep_cloud_grant_authority() returns trigger language plpgsql as $$
begin
  if (old.id like 'grant_cloud_%' or old.cloud_authority is not null) and (new.id<>old.id or new.client_id<>old.client_id or new.cloud_authority is distinct from old.cloud_authority
    or new.app_id<>old.app_id or new.phone_key<>old.phone_key or new.resource<>old.resource
    or new.person_id is distinct from old.person_id or new.scopes is distinct from old.scopes or new.expires_at>old.expires_at) then
    raise exception 'Cloud grant authority is immutable';
  end if;
  return new;
end $$;
drop trigger if exists keep_cloud_grant_authority on oauth.grants;
create trigger keep_cloud_grant_authority before update on oauth.grants for each row execute function oauth.keep_cloud_grant_authority();
drop index if exists oauth.grants_by_phone;
create index if not exists grants_by_phone_key on oauth.grants (phone_key, app_id) where revoked_at is null;
create index if not exists grants_by_person on oauth.grants (person_id, app_id) where person_id is not null;

create table if not exists oauth.codes (
  hash text primary key,
  grant_id text not null references oauth.grants (id) on delete cascade,
  client_id text not null,
  redirect_uri text not null,
  code_challenge text not null,
  resource text not null,
  scopes text[] not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists oauth.tokens (
  hash text primary key,
  kind text not null check (kind in ('access', 'refresh')),
  grant_id text not null references oauth.grants (id) on delete cascade,
  client_id text not null,
  app_id text not null,
  resource text not null,
  scopes text[] not null,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  rotated_at timestamptz
);
create index if not exists tokens_by_grant on oauth.tokens (grant_id);
create index if not exists tokens_expires on oauth.tokens (expires_at);

-- Append-only: who registered, consented, got, refreshed or lost a token. Never a token, code, secret or phone.
create table if not exists oauth.audit (
  id bigserial primary key,
  at timestamptz not null,
  kind text not null,
  client_id text,
  grant_id text,
  app_id text,
  detail text
);

create table if not exists oauth.rate_limits (
  bucket text primary key,
  window_start timestamptz not null,
  window_ms integer not null,
  count integer not null
);

create table if not exists oauth.signup_drafts (
  grant_id text primary key references oauth.grants(id) on delete cascade,
  app_id text not null check (app_id in ('ntwrk','friends')),
  phone_key text not null,
  fields jsonb not null,
  expires_at timestamptz not null
);
create index if not exists signup_drafts_phone_app on oauth.signup_drafts (phone_key, app_id);

-- A private at-most-once connector intake claim. The digest is keyed outside this database.
create table if not exists oauth.profile_submissions (
  grant_id text not null references oauth.grants(id) on delete cascade,
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  accepted boolean not null default false,
  primary key (grant_id, fingerprint)
);

-- Least privilege (audit: oauth grants hold phone numbers next to app ids). No role but the service
-- login may read this schema: never the console, analyst or per-app read roles.
revoke all on schema oauth from public;
revoke all on all tables in schema oauth from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'network_service') then
    grant usage on schema oauth to network_service;
    grant select, insert, update, delete on all tables in schema oauth to network_service;
    grant usage, select on all sequences in schema oauth to network_service;
  end if;
end $$;
