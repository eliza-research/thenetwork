# Select the named job posting when titles overlap

## Result and scope

A manager with "analyst", "data analyst" and "senior data analyst" postings cannot update or close the senior role by its full title: every shorter title inside the name is treated as a separate posting mention. Answering the resulting "which post?" question has the same problem. The fix distinguishes a nested title from a separate mention, so these existing commands reach their read-back and confirmation.

This is the existing Peon posting workflow under PRD 40.6 and `docs/network.md` section 1.4. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Implementation: `08dc931cb8ef08e671967e63bbcbff386f22eb2e`. The branch is independent of the preceding posting fixes.

## Cause and implementation

The close-command, close-clarification and update-command paths each use a case-insensitive substring check against every active posting's title. A single occurrence of "senior data analyst" therefore selects three postings and is rejected as ambiguous.

Share one private selector across those three paths. It finds title occurrences and disregards an occurrence strictly contained within a longer title occurrence. A short title mentioned separately elsewhere in the message still counts. Equal spans remain distinct when two postings have identical titles, so duplicates remain ambiguous. Existing active-post filtering, single-post fallback, read-back and explicit confirmation remain unchanged.

Alternatives considered:

- Always choose the longest matching title. This incorrectly chooses one post when a message independently names both the long and short titles. The regression covers both mention orders.
- Parse each command into a single title by stripping its prefix and trailing fields. Updates also contain job details, and clarification replies have no command prefix; this introduces separate extraction rules for three paths. Comparing occurrence spans fixes the existing selector directly.

## measurement

One database-backed integration case uses the actual signed inbound handler, NetworkService, ConsentNetwork posting intake, Postgres rows and service restarts. Network seed 1, one synthetic adult manager, dry-run delivery and a reserved fictional phone number. Five postings are created through real text intake and confirmation: four initial roles and one duplicate-title control later.

The initial active titles are analyst, data analyst, senior data analyst and product designer, each with two openings, $90k-$120k pay, hybrid work in Brooklyn and required SQL. The service restarts after saving them.

| Existing operation | Before: correct read-back and save after yes | After |
|---|---|---|
| Update the senior data analyst post to three openings and $100k-$140k | false | true |
| Close the senior data analyst post | false | true |
| Ask to close a post, restart, then answer "data analyst" | false | true |

Correct selection and persistence improve from **0/3 to 3/3**. Every operation checks that nothing changes before the separate confirmation and that every unrelated posting's intent fields and complete facet-tag list stay unchanged afterward. The test updates with a full field set so it is independent of the earlier partial-update PR.

Controls, passing before and after:

- A message independently naming "analyst" and "senior data analyst" stays ambiguous in either order and changes no posting.
- The non-overlapping "product designer" title is read back, confirmed and closed normally.
- After creating a second active "analyst" posting, naming that title stays ambiguous and changes neither posting.

Same command and fixture before and after:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 packages/network/test/peon-postings.integration.test.ts
```

- Before: **1 pass, 1 fail**, 81 assertions, 5.95 seconds. The new regression fails all three target operations; the existing posting case passes.
- After: **2 pass, 0 fail**, the same 81 assertions, 6.61 seconds.
- One production implementation; no fixture, expected outcome or threshold changes after the baseline.

Affected simulation command, identical before and after:

```sh
bun run sim --only peon,peon-seats
```

**36/36 blocking gates pass** before (31.2 seconds) and after (34.9 seconds). All **37 gate records are identical excluding runtime**, including the pack/keyword/oracle fingerprint `b7736da857812394`. The official comparison remains seeds 13-16, eight weeks, 400 candidates and 80 jobs per city. This is a posting-selection correctness result, not a matching-quality or performance claim. The one-full-simulation-per-agent allowance was used for #136, so only affected blocks were rerun.

Additional validation:

- `bun run typecheck`: all four configurations pass.
- `REQUIRE_PG=1 bun run test:integration`, including the security files: **676 pass, 8 skip, 6 fail**, 13,790 assertions across 690 tests in 68 files; 601.88 seconds. The failures match pristine main on Windows: an absolute `/bin/bash` requirement, SIGTERM exit status, and four site path-separator comparisons. Eight skips require the separately enabled retry-reconciliation suite.
- `REQUIRE_PG=1 bun run test:e2e`: **42 pass, 1 optional skip, 0 fail**, 654 assertions across 43 tests in 3 files; 108.78 seconds.
- Combined with the preceding fourteen contribution PRs: all four typecheck configurations, **10/10 job-seat gates** and **6/6 posting integration cases** pass (271 assertions, 19.48 seconds). The combination retains partial updates, headcount reopening, revision metadata, optional-skill handling, direct title answers and overlapping title selection. The shared test insertion conflict retained all prior cases. Production changes applied without conflict or additional adjustment.

## safety_gates

Existing age, consent, confirmation, block, human-review and leak gates retain their passing values. Each update or closure still needs a separate yes after its read-back. No live sends or deployment. This changes title selection within one manager's active postings; it does not change ownership checks or posting validation.

## llm_evidence and agent_clients

Deterministic selection and persisted service behavior: zero validation model calls and $0 model cost. No model-backed behavior changed. No real-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS or Cursor. The actual inbound service path is covered directly; no client protocol or copy template changes.

Authoring: OpenAI / `gpt-6-astra`, identified by the operator; Codex desktop `26.1021.3705.0`. Validation: Windows, Bun 1.4.2, TypeScript 5.9.3, PostgreSQL 16.15 on local port 54339, frozen-lockfile dependencies.

## Limits

Existing case-insensitive substring matching is retained; this adds no fuzzy title matching, new command grammar or bulk-close operation. Identical titles remain ambiguous. Existing fallback behavior when only one active posting exists is unchanged. Linux CI remains required before merge.
