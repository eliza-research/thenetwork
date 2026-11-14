# Peon confirms the posting the manager saw

The posting intake accepts a direct answer to the title question, chooses the
named offer even when one title contains another, keeps edits while asking
which job to update, and gives a new draft its own question count. An update
reads all fields back from the stored offer. Another correction requires a
new read-back. A stale yes cannot overwrite or reopen a changed offer. The
short closure command asks for confirmation before closing a filled job.

The generated posting policy requires an affirmative answer, a ready draft, no
new edits and a current revision. The shell compares the exact stored fields
so that two changes in the same clock interval cannot pass as the same version.
Using the draft timestamp alone would miss same-time changes. Merging the
draft with newer fields at save time could save terms absent from the read-back.

Run `REQUIRE_PG=1 bun test --conditions eliza-source packages/network/test/peon-postings.integration.test.ts`
with Bun 1.4.2 and PostgreSQL 16. The expanded Postgres journey previously
failed at the direct title answer. It now passes with 63 assertions, including
a stale reply after staff closure and a confirmed short close. This is the
deterministic Peon text intake. It uses fictional numbers and dry-run sends.
It requires no model calls and changes no agent-client transport.

Related PRs: #144, #149, #150, #151, #195, #197, #198, #222.
