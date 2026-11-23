-- Keep the Blooio chat locator beside the message reference for private status-only checks.
-- No message text or code is stored. Existing challenges remain valid with NULL metadata.
alter table platform.otp_challenges add column if not exists provider_chat_id text;
