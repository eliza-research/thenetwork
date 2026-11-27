create index if not exists members_app_home_city
  on network.members (app_id, home_city);

create index if not exists presence_app_city_type
  on network.presence (app_id, city, type);

create index if not exists opportunities_app_created_at
  on network.opportunities (app_id, created_at);
