-- Preserve the original completed V1 result for exact, authenticated retry reconciliation.
-- Existing receipts remain NULL: completion alone cannot reconstruct an earlier response.
-- The receipt table’s existing SELECT/INSERT grants cover the added column; no UPDATE privilege is added.
alter table platform.profile_suggestion_connection_receipts add column if not exists result jsonb;
