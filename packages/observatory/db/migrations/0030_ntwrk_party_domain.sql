-- 0030: The Network's home domain is ntwrk.party (the backend is api.ntwrk.party).
-- Databases seeded before the move hold the old domain in platform.apps; this sets the current one.
-- Runs once (public.__migrations); safe to run again.
update platform.apps set domain = 'ntwrk.party' where id = 'ntwrk' and domain <> 'ntwrk.party';
