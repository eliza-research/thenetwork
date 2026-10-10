-- 0030: The Network's home domain moves from ntwrk.love to ntwrk.party (the backend is api.ntwrk.party).
-- 0003 seeded platform.apps with ntwrk.love; this updates the row on databases that already ran it.
-- Runs once (public.__migrations); safe to run again.
update platform.apps set domain = 'ntwrk.party' where id = 'ntwrk' and domain = 'ntwrk.love';
