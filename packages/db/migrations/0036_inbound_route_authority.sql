-- Retain only the opaque signed route identity, separate from erased message bodies.
-- Existing production turns remain legacy (NULL); never infer an isolated authority.
alter table platform.inbound add column if not exists network_authority jsonb;
