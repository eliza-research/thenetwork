create table platform.teen_pool_holds (
  phone_hash text not null,
  app_id text not null,
  at timestamptz not null,
  primary key (phone_hash, app_id)
);
revoke all on platform.teen_pool_holds from public;
grant select, insert, delete on platform.teen_pool_holds to network_service;
grant select, delete on platform.teen_pool_holds to platform_service;

create table platform.teen_pair_avoid (
  phone_hash_a text not null,
  phone_hash_b text not null,
  at timestamptz not null,
  primary key (phone_hash_a, phone_hash_b),
  check (phone_hash_a < phone_hash_b)
);
revoke all on platform.teen_pair_avoid from public;
grant select, insert, delete on platform.teen_pair_avoid to network_service;
grant select, delete on platform.teen_pair_avoid to platform_service;
