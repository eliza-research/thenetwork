# Matching and backend gap analysis (2026-11-16)

This report records the state of `origin/vibestack` at `06d46097` before the matching redesign. It is hand-written from six read-only reviews of the code, the specs, the open pull requests, the simulator, and the literature. No simulation, test, model check, or proof was run for this report. Each finding names the file that shows it.

## Scope and method

| Review | What it read |
|---|---|
| Vibestack conventions | `tools/vibestack` against `lalalune/vibestack@develop` (`d063ec75`), `SPEC.md`, the skills, five specs, one shell |
| Matching engine | `packages/engine` (16,590 lines), 19 matching specs, 3 flow models |
| Backend and agent flow | `packages/network`, `platform`, `mcp`, `core`, `notify`, `deploy/backend`, the skills |
| Theory | arXiv:1705.10116 (LaTeX source), `lalalune/jevector@b49a696`, the matching literature |
| Pull requests | 280 open pull requests against `main`, the last 40 merged, PR #521, the frontend branch |
| Validation | `scripts/sim`, `packages/sim`, the app worlds, the newest result reports |

## Branch state

- `eliza-research/thenetwork` has no `develop` branch. `origin/vibestack` contains all of `origin/main` (86 commits ahead, 0 behind).
- `tools/vibestack`, `.claude/skills`, and the body of `SPEC.md` equal the upstream `develop` tip. The only differences are eight files of the local Node 26 overlay.
- At the time of this audit, `vibestack-frontend` was 1 commit ahead and 77 commits behind, with 45 files changed on both sides.

## Matching: what the founder goal needs and what the code does

The goal is to match people who are close to each other in interests and in approximate value, with a good exchange in both directions, to form circles that fit, and to find the best matches without a check of every pair.

| Need | State on `vibestack` | Evidence |
|---|---|---|
| Value in both directions | Partly. A harmonic mean combines two side benefits. Most side benefits are constants. | `scoring.ts:23-39`; `genkit.ts:47` gives a provider 0.6 for any offer facet |
| Value parity (no large standing gap) | Absent for ntwrk and friends. Weak for slop. Present for peon only. | No tier input in the engine; `packs/slop/score.ts:153` turns the appearance term off for the bottom 40%; `packs/peon/rules.ts` allows a seniority gap of 1 |
| Circles that fit | Three group builders. No community structure. No coherence gate. | `group.ts`, `plans.ts`, `packs/friends/planner.ts`; a "cluster" is one dominant tag |
| Bounded search | Absent. Every path scans all members or all pairs. | `retrieval.ts:68-109` scans every member for each intent; `packs/slop/generators.ts:59-77` scores every pair in a market; three network generators are quadratic; `policy.ts:78-80` rescans all candidates for each pick |
| Semantic similarity | A 256-dimension n-gram hash. No embedding model runs in production. | `embed.ts:7,34`; `network.ts:4031` passes no embedder |
| Formal coverage of the decisions | Control flow only. Scores, retrieval channels, group scores, and all 11 network generators are hand-written. The flow models treat them as oracles. | `spec/candidateScreening.md`, `selectionRun.md`, `exposureFloor.md`; `spec/models/matching_engine.md` |
| The shipped planner is the measured planner | No, for friends. | `network.ts:3376` runs `planProposals`; the gates measure `planFriendsWeek` |

Other engine defects:

1. Exploration picks ignore the pack cap, so peon can propose two candidates for one opening (open PR #489).
2. A judged score and an unjudged score compete on different scales (`engine.ts:210-215`).
3. The ConsentNetwork sorts the engine output again and keeps 20 a day, which removes the exposure-floor picks first (`network.ts:695`).
4. Generic modules import `networkPack` directly. Several pack fields have no reader.
5. `nyc` is a literal in the friends generators and in `network.ts`.
6. The peon tuning constants are outside the config hash.

## Matching: what is not validated

- No gate checks the standing gap of a proposed pair.
- No gate checks a floor on both directed utilities.
- No simulated world plants communities, so group quality has no ground truth.
- No run compares pruned candidates with brute force. `MatchingRunLog` has no pair-check counter.
- The largest pinned world has 900 members. The last benchmark used 300.
- Stability is checked for one non-default slop option only.

One earlier result constrains the design. A slop experiment that paired similar appearance ratings raised second dates and starved the lowest quintile of dates (`docs/results`, slop pack report). A parity band must therefore be tested beside the lowest-band exposure gate.

## Backend: the agent journey does not complete

| Blocker | Evidence |
|---|---|
| Agent signup is refused under the documented configuration. Turnstile is required outside dev, and the exemption needs two settings that the deploy guide and `.env.example` do not name. | `platform/src/api.ts:149-155, 511` |
| The profile an agent submits does not reach matching. | `accounts.ts:438` stores `about` on the membership; `service.ts:831` `createMember` has no input for it |
| MCP tools return a link to a page that three sites redirect away. | `mcp/src/tools.ts`; `deploy/router.ts:40-48` |
| peon cannot match. Every job is refused while the employer is unverified, and only a test sets that flag. | `packs/peon/rules.ts:18,78`; `network/service/postings.ts:54,94` |

Production loop defects:

1. `deploy/backend/backend.ts:418-426` never runs the retention purge or the inbox redrive.
2. A review decision has no version check (`network.ts:2270`).
3. A turn waits on the network lock with no time limit while the engine run holds it (`store.ts:328`).
4. Photo relay cannot complete: the delivery origin is not passed and the resolve path is not forwarded.
5. A ban leaves cookies, connector tokens, and profile-share grants in force (open PRs #485, #496).

The work app is `peon.biz` in every file. The name `peon.nyc` does not occur.

## Recurring defect classes in 280 open pull requests

| Class | Count | Root cause |
|---|---|---|
| Free-text reply reading | about 60 | Consent meaning is in regular expressions. The models take a parsed boolean. |
| Eligibility missed on a side path | about 30 | No single pair gate that every generator must call |
| Counters and metrics | about 60 | No defined cohort or time anchor |
| Time and ordering | about 25 | Deadlines checked on ticks only |
| Changes that do not propagate | about 25 | Revocation is per reader |

Sixteen open pull requests fix defects that are still present on `vibestack`: #489, #490, #484, #499, #496, #485, #486, #475, #472, #470, #459, #457, #454, #453, #450, #449.

## What the literature gives

- **arXiv:1705.10116, Fractional Hedonic Games.** A member's utility for a group is the average value of the group's members. Dense groups win. A stable partition can fail to exist, and the test is hard. The paper gives the group cohesion measure and the rule that a group must be connected. It gives no guarantee to claim.
- **jevector.** A research repository. Its integer, three-valued decision vectors and its two-direction rule are sound. Its HNSW index reached 37% to 88% top-5 recall at 1,024 profiles, so approximate search is the wrong trade at this scale.
- **Assortative matching.** Becker, Burdett and Coles, and Bruch and Newman support a parity band on a vertical dimension.
- **Globally ranked pairs.** When each side ranks partners by one symmetric score, a greedy pass in score order returns a matching with no blocking pair.
- **Exact pruning.** A monotone score with a per-bucket upper bound gives an exact top-k without a check of every pair.

## Design that closes the matching gaps

All quantities are integers so that Quint can state them and Dafny can prove them.

1. **Lanes.** One table names each relationship lane (friend, date, cofounder, hire, mentor, invest, intro), its sides, and its limits.
2. **Standing.** Each lane membership has one private standing from 0 to 100 and an uncertainty. Evidence comes from stated and reviewed facts and private ratings. Acceptance counts never raise it.
3. **Pair value.** A pair has a value only if both directed utilities pass a floor, the standing gap is in the lane band, and the exchange is balanced. The value is the integer harmonic mean of the two utilities less a gap penalty.
4. **Bounded search.** Members are blocked by lane, side, and market, and sorted by standing. The band gives an exact window. A bucket upper bound and a stop rule give an exact top-k, or a stated bound when a check budget ends the scan.
5. **Selection.** The greedy phase takes pairs in score order under capacity. A refused pair always has a member with no room.
6. **Circles.** A circle is admitted only if every pair has a value above the floor, the standing spread is in the band, and the size is in the lane limits.

## Validation plan

A new `matching` simulation block runs the engine alone on planted worlds:

| Gate | Blocking |
|---|---|
| Pruned top-k equals brute force for N up to 400 | yes |
| Pair checks stay under the stated budget at 1k, 10k, and 100k members | yes |
| No proposed pair exceeds the standing band; both utilities pass the floor | yes |
| No blocking pair in the greedy phase | yes |
| Every pair in a circle passes the pair gate; standing spread is in the band | yes |
| Circles recover planted communities better than random groups of the same sizes | tracked first |
| Lowest-band exposure ratio | tracked first |

## Open decisions for the founder

1. Whether an agent may answer a probe, relay, or manage intents through MCP. The stories now keep these actions on the text line.
2. The live-send flags for each app, and the friends and peon "local only" status.
3. Whether `sf` signups are refused or held until an `sf` network exists.
4. The gate decision that open PR #449 needs (a safety fix lowers one peon quality gate by 0.0004).
