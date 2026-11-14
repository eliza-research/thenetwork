# Peon keeps stated posting fields

A hiring manager could not publish a job with a full dollar range. The parser
could also treat a refused work mode or sponsorship term as part of the offer.
SQL rejected duplicate skill IDs. Closing an offer lost the posted headcount
and the close reason on the next read.

The parser reads complete monetary amounts, removes refused modes before
selecting a mode, checks sponsorship refusals first, and keeps skill levels
separate from role seniority. Persistence stores one row per skill with the
highest stated requirement. It keeps the original headcount on closed rows.
The existing seat projection gives closed rows zero openings. Private revision
metadata preserves the modification time and closure reason in the same write.

Alternatives considered: storing each mention as a separate facet would lose
the single skill requirement and create inconsistent reads. A new posting
table would duplicate the existing atomic intent and facet write.

Run `REQUIRE_PG=1 bun test --conditions eliza-source packages/network/test/peon-postings.integration.test.ts`
on PostgreSQL 16 with Bun 1.4.2. With the expanded journey on the original
implementation, the service asks for a pay range after the manager specified
it (0 pass, 1 fail). With the fixes, the same journey saves the exact offer,
preserves one skill row, closes the seat and restores its headcount on a
staff reopen (1 pass, 0 fail). The Peon seat simulation passed 9/9 gates with
its pinned world (seed 7). The fixtures are fictional and sends are dry-run.
The posting reader is deterministic. There are no model calls in either arm
and no change to an MCP or hosted agent transport.

Related PRs: #145, #146, #176, #182, #190, #196, #231.
