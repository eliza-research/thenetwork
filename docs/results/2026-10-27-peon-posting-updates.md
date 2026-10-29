# Peon partial job edits retain the saved fields

## Result and scope

An openings-only edit to an existing job now reaches a complete confirmation using the saved salary, location, work mode and requirements. Previously `Update my data analyst post: 3 openings` asked for the salary again, although the existing post already had a pay range. Confirming after a service restart now changes only the requested field.

This fixes the existing Peon text-posting workflow (`packages/network/src/jobs.ts`, `postingTurn` in `network.ts`, PRD section 40) under the reproduced-bug contribution scope. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Implementation: `590d26f0f9a624ab438e16c36b19550a052478d1`. No matching policy, message template, model prompt or public API changes.

## Cause and implementation

`readPostingText` selected the existing posting ID and title, but checked required fields and built its confirmation from the partial edit alone. The existing `postingFromDraft` merged saved values only after a yes, too late to supply the required pay range or describe the retained fields in the confirmation.

The parser now accepts a lookup for the selected stored posting. ConsentNetwork supplies its existing manager-scoped `storedPosting` lookup. A new update draft copies the editable fields before applying the text's changes, checking missing fields and constructing the confirmation. Further corrections keep that draft; a different selected posting starts from its own saved fields. New-job drafts retain their existing required-field checks.

Alternatives considered:

- Populate every `PostingRef` with all posting facts. That widens a listing structure used for selection; the lookup needs the facts of only the selected post.
- Repair the partial result in `postingTurn` after parsing. That requires rebuilding the missing-field decision, ready flag and confirmation together. Initializing the draft before those decisions keeps them consistent.

## measurement

One added case in `packages/network/test/peon-postings.integration.test.ts` drives the actual NetworkService webhook handler, runtime and Postgres rows. A dry-run channel records replies; the phone numbers are fictional. The service restarts on the same database between the update confirmation and the manager's yes. This is a deterministic integration case, not a mocked parser or LLM test.

The initial post is a level-2 data analyst role: two openings, $90k-$120k, hybrid in Brooklyn, SQL required.

| Observation | Base plus regression case | Fixed |
|---|---|---|
| Openings-only edit | Asks for an already-stored pay range | Complete confirmation: three openings, original salary/mode/location/SQL |
| Saved rows before yes | Original post | Original post |
| Restart before yes, then confirm | Blocked at the first assertion | Same posting ID; only openings changes from 2 to 3 |
| Salary-only edit followed by an openings correction and no | Not reached | Confirmation keeps other fields; both unsaved edits discarded |
| New job without a salary | Existing behavior | Still asks for its own salary; creates no post |
| Test file | 1 pass, 1 fail; 39 assertions | 2 pass, 0 fail; 54 assertions |

Same command before and after:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 ./packages/network/test/peon-postings.integration.test.ts
```

The corrected baseline run took 5.05 seconds; the fixed run took 5.32 seconds. These times are not a performance claim. The first test draft expected `Must have:` instead of the existing `Must-haves:` text; that assertion was corrected and the baseline rerun before changing production code. Both baseline runs failed because the service asked for pay. One production implementation was tried and kept.

Additional validation:

```sh
bun run typecheck
bun run sim --only peon-seats
bun run sim --only network --only peon --only peon-seats
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- Typecheck: all four configurations pass.
- Peon job-seat simulation: 9/9 gates before and after; all nine records unchanged excluding runtime.
- Network + Peon + job seats: 97/97 blocking gates, no tracked misses, 250.0 seconds (213.9 / 36.0 / 0.0). Network's 63 existing gate records are unchanged. Fingerprints remain `24bb81f068060b33` (Network invariant run), `361f8cc2648fb9a6` (consent/push arms), and `b7736da857812394` (Peon pack/keyword/oracle arms).
- Full integration including security: 676 pass, 8 skip, 6 fail; 13,763 assertions, 690 tests in 68 files, 548.56 seconds. The six failures are the same Windows failures reproduced on main in the preceding contributions: absolute `/bin/bash` is absent, SIGTERM exits 143 rather than 0, and four site tests expect Unix path separators. The eight skips require the separate cleanup-reconciliation opt-in, not missing Postgres. Linux CI is still required.
- E2E: 42 pass, 1 optional skip, 0 fail; 654 assertions, 43 tests in three files, 77.21 seconds.
- Combined locally with the preceding eight contribution PRs: clean cherry-pick, typecheck passes, 9/9 job-seat gates pass; both posting integration cases pass with 54 assertions (5.96 seconds).

Compatibility follow-up (`32125f2d2aaff09aa3d1f23ae9672772af7cc6e9`): the later posting-metadata fix makes a confirmed edit correctly advance its stored update time. The successful-save assertion now excludes only the revision-time tag when comparing the unchanged job fields. Before confirmation and after cancellation, the test still compares every stored tag. The metadata regression separately verifies exact update times. This is a test-only adjustment: the isolated posting file still passes both tests (54 assertions, 7.88 seconds), all four typecheck configurations pass, and the eleven-contribution combination passes all four posting cases (109 assertions, 7.10 seconds). The full integration, e2e and simulation results above precede this assertion adjustment; production code is unchanged.

The simulation's existing pinned settings are unchanged. Network covers seed 3 over 10 days plus the consent/push comparisons on seeds 1-3 over 21 days and scenarios. Peon uses seeds 13-16, eight weeks, 400 candidates and 80 jobs per city, pack/keyword/oracle arms and realism v2. The job-seat block uses its existing hand-built service world. No new quality threshold was fitted. The repo's one-full-simulation-per-agent allowance was already used for PR #136; these runs cover the affected blocks.

## Reviewer reproduction evidence (2026-10-29)

The [code-reading review](https://github.com/eliza-research/thenetwork/pull/144#pullrequestreview-5679201189) requested terminal output, the database version, an explicit database-free reproduction status, and a merge order. This follow-up changes only this report and the PR description. Production code and test assertions remain unchanged from `49151db9bb663b2b234a133085cc010dbf7ecc07`.

Fresh run on that exact revision: Windows, Bun 1.4.2 (`744846f84`), and the running server reports `PostgreSQL 16.15, compiled by Visual C++ build 1944, 64-bit` from `SELECT version();`. PostgreSQL was running locally on port 54339. The environment supplied `USER=postgres`, `REQUIRE_PG=1`, `OBSERVATORY_PG_PORT=54339`, `OBSERVATORY_PG_DIR` pointing to the local test cluster, and `PG_BIN_DIR` plus `PATH` pointing to its PostgreSQL binaries.

Command:

```sh
bun test --conditions eliza-source --timeout 120000 ./packages/network/test/peon-postings.integration.test.ts
```

Actual terminal output (exit code 0):

```text
bun test v1.4.2 (744846f84)

packages\network\test\peon-postings.integration.test.ts:
[llm] Neither SURPLUS_API_KEY nor OPENAI_API_KEY is set: LLM calls will fail (see .env.example).
(pass) peon postings: text intake, restart, staff API (NetworkService, Postgres) > a job post by text is read back, saved on the yes, kept across a restart, and closed by staff [742.54ms]
(pass) peon postings: text intake, restart, staff API (NetworkService, Postgres) > partial text updates keep the saved post in the read-back, including across restart before confirmation [870.39ms]

 2 pass
 0 fail
 54 expect() calls
Ran 2 tests across 1 file. [4.45s]
```

No model calls are required by these tests. The startup warning above does not skip or replace the database tests.

**Database-free reproducer for this PR alone: none.** The existing Peon and job-seat simulation blocks do not exercise this stored-field update defect; their unchanged results are compatibility evidence, not reproduction evidence. A reviewer needs PostgreSQL and the focused integration command above to reproduce this PR's regression test. Without server binaries, this file can skip its cases; a skipped run is not validation.

The later, separate [PR #197](https://github.com/eliza-research/thenetwork/pull/197) adds a database-free gate for retaining edits while choosing a posting. Its [combined-run evidence](https://github.com/startrack3r/thenetwork/blob/7917094d4de9821bce133fb53de0353ccba7952a/docs/results/2026-10-29-peon-posting-update-choice.md) also observes that #144 removes salary re-asks in that combined checkout. That gate is not part of this PR and does not change the standalone reproduction requirement above.

Suggested merge order for the three overlapping posting fixes: **#144, then #145, then #146**. After #144 lands, rebase #145 on the updated main; after #145 lands, rebase #146. Resolve the shared posting-parser/integration-file context while retaining each regression case, then rerun the focused posting integration file and typecheck on each resulting branch. The earlier combined runs above are compatibility checks, not a claim that GitHub will merge all three current branches without rebasing. No merge or rebase was performed for this evidence-only update.

Only the focused integration file was rerun for this follow-up. The broader integration, E2E, typecheck and simulation results above retain their original scope and dates; no fresh full-suite or Linux CI pass is claimed.

## safety_gates

Existing Network and Peon consent, review, exclusion, cap and leak gates pass at their prior values. The regression checks that no posting is changed before yes, that cancellation retains the saved rows, and that a new post cannot reuse the old post's salary implicitly. No live sends or deployment were used. The lookup retains the existing manager-specific selection and ownership checks.

## llm_evidence and agent_clients

N/A for model-backed behavior: this changes deterministic draft construction and persistence through the existing text handler. Zero validation LLM requests and $0 model cost. No real-client acceptance run is claimed: Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS and Cursor were not driven. The signed synthetic webhook/service path and its replies were exercised directly.

Authoring: OpenAI / `gpt-6-astra`, identified by the operator; Codex desktop `26.1021.3705.0`. Validation: Windows, Bun 1.4.2, TypeScript 5.9.3, local PostgreSQL 16.15 on port 54339, frozen lockfile dependencies.

## Limits

The confirmed draft represents the saved post at edit initiation plus the manager's edits; this does not add optimistic concurrency control for a simultaneous staff edit. Existing incomplete drafts are not migrated. Posting grammar, closure behavior and matching/ranking remain outside this change. Linux CI must pass before merging.
