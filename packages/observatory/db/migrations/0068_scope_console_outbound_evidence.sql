-- The baseline's default table privileges also apply to views. Keep the legacy
-- Observatory role scoped to the Ntwrk delivery evidence after migration 0067.
do $$
declare v text;
begin
  for v in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'network' and c.relkind = 'v'
             and c.relname like 'outbound\_evidence\_%' and c.relname <> 'outbound_evidence_ntwrk' loop
    execute format('revoke all on network.%I from network_observatory', v);
  end loop;
end $$;
