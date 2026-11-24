-- 0032: staff review of texts the outbound queue's leak guard parked (status parked_leak_review).
-- GET /queue/leak-review lists them and POST /queue/leak-review/<id> releases or drops one (safety role,
-- a reason of 5 or more characters, audited). A released row goes back to the queue with every other
-- check at send time, but the leak guard does not park it again: leak_released_by names the staff member
-- who released it. Idempotent.
alter table platform.outbound add column if not exists leak_released_by text;
