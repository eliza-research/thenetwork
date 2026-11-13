# Keep optional job skills out of Peon's required-skill list

## Result and scope

A posting ending `must have SQL, nice-to-have: Python` treated the optional clause as an additional required skill. A candidate with SQL but no Python was then excluded from matching. The existing optional-skill parser recognized the hyphenated phrase, but the required-skill parser did not stop at it.

This fixes a reproduced intake defect under the existing Peon local-pilot workflow and stated must-have matching requirements (PRD 40.6). Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Implementation: `1714dbdaafa90b25898a837e354cff6a7c6ee2c0`. The branch is independent of the other posting fixes.

## Cause and implementation

The required-skill capture stopped only at the exact spaced singular phrase `nice to have`. The next parser already accepted spaces or hyphens at either separator, and singular or plural `have(s)`. With another accepted spelling, the optional clause was read twice: correctly as optional, and incorrectly as part of the required list. The artificial extra requirement reduced the SQL candidate's coverage below the existing matching floor.

Make the required-list boundary recognize the same `nice[- ]to[- ]haves?` grammar. The production change is one regular-expression alternative. No matching threshold, ranker, skill-level rule, copy template or storage contract changes.

Alternatives considered:

- Normalize hyphens across the entire message before parsing. This also changes salary ranges and job titles, although only a clause boundary needs correction.
- Replace the posting parser with a tokenizer or general section parser. That broadens the change to unrelated fields and ambiguous text. The existing optional parser already defines the accepted boundary forms.

## measurement

One new blocking gate in `scripts/sim/peon-seats.ts` uses the repository's SeatWorld harness: the real ConsentNetwork, Peon service hooks, posting-to-seat projection and matching engine. The harness records confirmed posting rows and dry-run messages; it does not stub matching. Human review stays enabled and the gate approves no item.

The hand-written NYC fixture has one verified adult hiring manager and two adult candidates. Both candidates lack optional Python. One has SQL level 3; the negative control lacks required SQL. Each enters through the harness's normal text turns. The manager sends the existing complete data-analyst posting (level 2, two openings, $90k-$120k, hybrid Brooklyn, SQL required), followed by one optional-skill label and Python. Nothing is saved before yes. After confirmation, matching runs for up to two simulated days until a review item is available.

The eight labels exhaust the combinations already accepted by the optional parser: `nice to have`, `nice-to-have`, `nice to haves`, `nice-to-haves`, `nice-to have`, `nice to-have`, `nice-to haves`, and `nice to-haves`. The gate replays each on Network/engine seeds 7, 11 and 19: **24 fresh worlds**, each with one manager and two candidates. These are deterministic equivalence checks, not a statistical hiring-quality estimate.

| Observation | Before | After |
|---|---:|---:|
| Postings with exactly required SQL and optional Python | 3/24 | 24/24 |
| Qualified SQL candidates queued for human review | 3/24 | 24/24 |
| Candidate without required SQL queued | 0/24 | 0/24 |
| Match messages sent before human review | 0 | 0 |
| Existing plain `nice to have` controls | 3/3 | 3/3 |
| Peon plus job-seat blocking gates | 36/37 | 37/37 |

The seven other spellings recover 21 previously missing matches. Each case asserts the actual saved required/optional arrays and the review queue's exact candidate list. The plain-spelling controls remain unchanged. No threshold or expected result was adjusted after observing the baseline failure; one production implementation was tried.

For the fastest reproduction, run the block containing the new gate:

```sh
bun run sim --only peon-seats
```

Rechecked on 2026-10-30 at published head `e2342519db7421e23e433ccc48c07ef470ab4797`: **10/10 blocking gates**, zero tracked misses, 0.2 seconds. Keeping the same gate and using `packages/network/src/jobs.ts` from base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` gives **9/10**, zero tracked misses, also 0.2 seconds. Only `intake: nice-to-have spellings stay optional through confirmation and matching` fails; all nine other gate records match excluding runtime.

The separate `bun run sim --only peon` block stays at **27/27 before and after**, as recorded in the original paired results below. It does not run this regression gate. Its 28 records, including the matching fingerprint, are unchanged. These are two blocks: `peon-seats` proves the text-intake fix, and `peon` checks the existing matching comparison.

The broader paired command runs both blocks, with only the new gate applied to the base first:

```sh
bun run sim --only peon --only peon-seats
```

Baseline: 34.6 seconds; fixed: 36.4 seconds. No performance claim. An initial focused `--only peon-seats` baseline also reproduced the failure (9/10 gates). All 37 pre-existing gate records are identical excluding runtime, including the pack/keyword/oracle fingerprint `b7736da857812394`.

The general Peon world uses its existing seeds 13-16, eight weeks, 400 candidates and 80 jobs per city, pack/keyword/oracle arms and realism v2. It writes seats directly, so the new job-seat gate supplies the evidence for text intake. The one-full-simulation-per-agent allowance was already used for PR #136; affected blocks were rerun here.

Additional checks:

```sh
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- Typecheck: all four configurations pass.
- Full integration including security: 675 pass, 8 skip, 6 fail; 13,741 assertions, 689 tests in 68 files, 504.69 seconds. The six failures match the unchanged Windows failures reproduced on main in the preceding contributions: absent absolute `/bin/bash`, SIGTERM exits 143 rather than 0, and four site tests expect Unix path separators. The eight skips require the separate cleanup-reconciliation opt-in, not missing Postgres. Linux CI remains required.
- E2E: 42 pass, 1 optional skip, 0 fail; 654 assertions, 43 tests in three files, 72.43 seconds.
- Combined with the preceding eleven contribution PRs: clean cherry-pick, all four typecheck configurations, 10/10 job-seat gates and all four posting integration cases pass (109 assertions, 6.60 seconds). The new 24-world gate also reports 24 correct postings, 24 qualified matches and no unqualified matches in this combination.

## safety_gates

The negative control still cannot match without required SQL. No posting saves before confirmation, and all proposed matches wait for human review. Existing age, consent, review, closure, exclusion, capacity and leak gates retain their passing values. Synthetic data and dry-run messages only; no live sends or deployment.

## llm_evidence and agent_clients

Deterministic parsing and matching: zero validation LLM calls and $0 model cost. No model-backed behavior changed. No real-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot, elizaOS or Cursor. The existing text-intake and matching workflow was exercised through the simulation, with the service suites reported separately.

Authoring: OpenAI / `gpt-6-astra`, identified by the operator; Codex desktop `26.1021.3705.0`. Validation: Windows, Bun 1.4.2, TypeScript 5.9.3, PostgreSQL 16.15 on local port 54339, frozen lockfile dependencies.

## Limits

The change preserves the grammar the optional parser already supports; it does not add a general language parser or alter skill matching policy. Stored postings whose required skills were previously misparsed are not rewritten automatically and need corrected input. The fixture proves the stated optional/required distinction, not an aggregate hiring-quality improvement. Linux CI remains required before merge.
