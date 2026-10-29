# Keep role seniority separate from skill requirements

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Tested code: `a115d222b194b1ce378612490649024ae082b9f4`.

## Requirement and cause

This fixes a reproduced Peon posting defect under PRD 40.6 and `docs/network.md` section 1.4.
The existing text intake saves a confirmed posting as facts, which become a job seat for matching.

`parsePosting` searches the entire message for seniority words and the first numeric `level`.
Consequently, "senior data analyst ... must have SQL level 1" becomes a level-1 role.
"Principal ... nice to have junior mentoring" also becomes level 1.
The matching engine then applies its existing seniority band to the wrong value.
The reproduction selects a junior candidate and excludes the experienced candidate.

Mask the already-parsed must-have and nice-to-have sections before reading role seniority.
Keep their lengths so both original match offsets remain valid, even where the list patterns overlap.
Skill parsing, explicit role levels, matching thresholds, confirmation and member-facing copy stay unchanged.

Other implementations considered:

1. Read seniority only from the title. That loses supported separate role-level fields and draft corrections.
2. Drop everything after the first skill marker. That loses a role level after a semicolon.

Reusing the existing section matches avoids a second skill grammar and preserves both forms.

## measurement

Paired command: `bun run sim --only peon --only peon-seats --json <output-file>`.
Run the new gate on base production code, then on the fix, with identical inputs.
The gate uses seeds 7, 13 and 17. Its seven conversations run through actual ConsentNetwork intake,
confirmation, JSON state restarts, posting facts, job seats, the Peon engine and the human review queue.
Rows remain in the existing SeatWorld fixture across restarts; this is not a new Postgres persistence test.
No parser, matching result or engine proposal is mocked. The channel records synthetic messages only.

Each world has a verified adult manager and two eligible adult candidates, at role levels 4 and 1.
Both candidates want the posting's exact role family and have SQL level 3.
Each posting has one opening, $90k-$120k pay and hybrid work in Brooklyn.
The gate runs two simulated days after confirmation.

| Input variation | Expected role level | Before candidate | After candidate |
|---|---:|---|---|
| Senior title; must have SQL level 1 | 3 | Junior | Experienced |
| Principal title; must have SQL level 2 | 5 | Junior | Experienced |
| Senior title; SQL required; Excel level 1 optional | 3 | Junior | Experienced |
| Principal title; SQL required; junior mentoring optional | 5 | Junior | Experienced |
| Level 4 before SQL level 1 requirement | 4 | Experienced | Experienced |
| Level 4 after a semicolon following SQL level 1 | 4 | Junior | Experienced |
| No role level; must have SQL level 2 | Unspecified | Junior | None |

All three seeds produce the same row outcomes.
The last row preserves the engine's missing-seniority rejection; it does not invent a role level.

| Metric | Before | After |
|---|---:|---:|
| Correct candidate outcomes, seeds 7/13/17 | 3/21 | 21/21 |
| Incorrect junior proposals, seeds 7/13/17 | 18 | 0 |
| Explicit-role control retained | 3/3 | 3/3 |
| Correct outcomes on fresh seeds 19/23 | 2/14 | 14/14 |
| Incorrect junior proposals on fresh seeds | 12 | 0 |
| Peon and job-seat blocking gates | 36/37 | 37/37 |

The fresh-seed run executes the same gate with only its seed list replaced by `[19, 23]`.
Its before checkout has byte-identical base `jobs.ts`; its unrelated availability fix does not touch this workflow.
No production adjustment followed the first fix. These deterministic fixtures establish causality, not population hiring quality.

All 37 other gate records, including tracked metrics and fingerprints, match before and after when timing is excluded.
Their normalized SHA-256 prefix is `019c4aab21f3b82a`.
The paired blocks take 27.6 seconds before and 30 seconds after.

An initial fixture assertion looked for a standalone seniority facet that does not exist.
It was corrected to read the seat's actual seniority tag before both paired measurements above.

## safety_gates

The new gate checks read-back, no save before a separate yes, preserved SQL requirements and restart state.
No proposal message reaches a candidate or manager before review.
Existing minor, held-member, employer, pay, block, consent, leak and capacity gates keep their passing values.
The stock Peon simulation uses its simulated reviewer; the new SeatWorld gate keeps review human and approves nothing.
No live sends, production data or deployment are involved.

## Validation

- `bun install --frozen-lockfile`: passes; no dependency changes.
- `bun run typecheck`: all four TypeScript configurations pass.
- `bun run test:integration`: **675 pass, 8 skip, 6 fail**, 13,741 assertions, 689 tests in 68 files; 533.83 seconds.
- The integration run executes all 11 security files. It uses real PostgreSQL 16.15 with `REQUIRE_PG=1`.
- The six failures match the established Windows baseline: absolute `/bin/bash`, SIGTERM exit status, and four path-separator comparisons.
- The eight skips belong to the separately enabled retry-reconciliation suite.
- `bun run test:e2e`: **42 pass, 1 skip, 0 fail**, 654 assertions, 43 tests in 3 files; 67.73 seconds.
- The e2e skip requires external origins.

The local combination with the preceding 18 PRs applies without conflicts.
Its **39/39 Peon and job-seat gates** and all four typecheck configurations pass.
That includes the earlier optional-skill and alias regressions. Combined code is `685962e`.
This is affected-path compatibility evidence, not a new full combined integration or simulation claim.
The repository's one-full-simulation allowance was used for PR136; this change reruns the affected blocks.
Linux CI remains pending maintainer approval on the fork PR.

## llm_evidence

This handled-turn parser and its matching consequences are deterministic. No model-backed code changes.
Validation uses zero model calls and costs $0. No real-model qualification is claimed.

## agent_clients

No real-client acceptance run is claimed. The gate drives the actual backend workflow directly.
Authoring: Codex desktop, OpenAI `gpt-6-astra`, as identified by the operator.
No skill, MCP, client protocol or copy template changes.

## Reproduce and limits

1. Install dependencies with `bun install --frozen-lockfile`.
2. Run `bun run sim --only peon --only peon-seats --json runs/peon-role.json`.
3. Expect 37 blocking gates to pass and all 21 printed candidate outcomes to match their expected lists.
4. For the before result, apply only the sim-file diff to `a0ed7bc` and repeat the command.
5. Expect the new gate to fail; the other 36 blocking gates still pass.
6. Run the full typecheck, integration and e2e commands with dev Postgres and `REQUIRE_PG=1`.

The change uses the existing skill-section boundaries. It does not add free-form language understanding or multiple-list parsing.
It affects newly parsed text; it does not rewrite saved postings automatically.
Missing role seniority still prevents matching under the existing engine rule.
The report makes no claim about hires, real agent clients or production readiness.
