# Let trusted postings use their job slate

A trusted employer with four open positions and four qualified candidates reaches
only three candidates. After all three decline, the fourth still gets no proposal
over the next two days. `peonSeats` copies the manager's normal participation state
to the synthetic seat. Core selection therefore applies the three-role candidate
budget to that posting, alongside Peon's own slate and opening-capacity limits.

The fix assigns a normal manager's seat the existing open job state specified in
`PEON_ENGINE_CONFIG`. The original manager and candidate records are untouched;
all other participation states pass through unchanged. Probation separately
subtracts proposals already counted in the rolling budget window from the seat's
share. A state-only change would relax that limit across repeated daily runs;
these two changes belong together. The default Peon budget window is seven days.

This is a reproduced hiring defect under the approved scope and PRD 40.6, using
the posting workflow documented in `docs/network.md` 1.4. Raising the shared normal
budget would raise candidate limits too. Changing core selection would affect
other packs. Correcting the Peon seat and its probation accounting preserves the
existing separation between candidate interruptions and requested job slates.

## Revisions and setup

- Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
- Fix and gate: `b8465ac60a74c02a1922f69bf7e0265d17389c9a`.
- Local combined compatibility code: `b2810ef0b066fbbf7f2bf905145cb51611de7e81`; never pushed.
- Native Windows, Bun 1.4.2, PostgreSQL 16.15; `bun install --frozen-lockfile`.
- Source checkout uses `core.autocrlf=false`.

## measurement

Same command before and after:

```sh
bun run sim --only peon,peon-seats --json result.json
```

For the before result, apply only the `scripts/sim/peon-seats.ts` diff from the
fix commit to the base. Keep both production files at the base revision.
The one added gate runs seeds 1, 2 and 3 over six scenarios. Existing SeatWorld
calls keep their default seed 7.

Each trusted-employer case establishes history through real text intake: onboard
a verified adult manager and a candidate, post and confirm an opening, approve
its engine review item, obtain both yeses and verify the scheduled intro. Close
the first posting without cancelling that intro, close the candidate's search
record, and restart. Assert that the engine input retains accepted history with
both participants before proceeding. No history or trust decision is injected.

Next onboard four qualified candidates, post and confirm the target job, restart
and run daily matching. Approve its review items; each candidate says no. Restart
and run two more days. The probation cases omit the establishing intro entirely.
The renewal case advances four further days, approves the remaining candidate's
review item and receives their no as well.

The existing SeatWorld drives the actual ConsentNetwork, app hooks, posting rows,
seat conversion, engine and consent workflow. Its rows stand in for storage and
its channel records sends locally. The closed search and quiet/paused controls
are member-record inputs; eligibility, selection and consent are not mocked.
This gate is not PostgreSQL-backed; the separate checks below use real PostgreSQL.

| Across three seeds per scenario | Before | After |
|---|---:|---:|
| Trusted four-opening jobs: distinct candidates queued and probed | 9 | 12 |
| One-opening case: initial candidates per run | 1 | 1 |
| Quiet manager: initial candidates per run | 1 | 1 |
| Paused manager: candidates | 0 | 0 |
| Probation: candidates before weekly renewal, per run | 3 | 3 |
| Probation renewal: additional candidate after seven days, per run | 1 | 1 |
| Cases satisfying every assertion | 15/18 | 18/18 |
| Hiring blocking gates | 36/37 | 37/37 |

All 15 control rows are identical. No target candidate is contacted before review;
each is probed at most once for the posting. Their refusals cause no manager probe.
Original manager/candidate states remain intact and pending reviews never exceed
openings. This measures candidate reach, not hires or acceptance rates.

All 37 previous hiring records are identical, excluding elapsed time. The pack,
keyword and oracle fingerprint stays `b7736da857812394`, with pinned hiring-world
seeds 13–16. Before/after runtime: 27.7s / 27.8s. These are affected
blocks, not a new full simulation.

The combined run passes 52/52 blocking gates. All 52 previous records from the
#222 combined run are identical, and all 18 new rows match standalone. The local
reconciliation preserves #212's derived owner/seat exclusion edge and the existing
job-seat gates, including #222. #223 changes only a site assertion and is also in
the combined branch.

## safety_gates

```sh
REQUIRE_PG=1 bun run sim --only safety --json safety.json
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

Safety passes 17/17 before and after with identical records. All four typecheck
configurations pass before, after and combined. Database suites run sequentially
on the isolated port 54339, role `postgres`, with `PG_BIN_DIR`,
`OBSERVATORY_PG_DIR` and `OBSERVATORY_PG_PORT=54339` set.

Standalone integration, including the security files:

```text
675 pass
8 skip
6 fail
13741 expect() calls
Ran 689 tests across 68 files. [403.07s]
```

The six existing Windows failures are the `/bin/bash` lookup, SIGTERM exit 143
instead of 0, and four site path comparisons. The latter are addressed separately
by #223, which is not on this standalone branch. Skips are the opt-in cleanup
reconciliation cases and their hooks. The full integration command remains red;
hosted Linux CI still requires maintainer approval.

Standalone E2E:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [42.68s]
```

The optional browser case requires `PLAYWRIGHT_MODULE`. Existing review, consent,
participation choices, candidate budgets and employer probation remain enforced.
No live sends, deployment, member data, UI, copy or schema changes.

## llm_evidence

Deterministic seat construction and selection: zero validation model calls/$0.
No model-backed behavior is qualified by these results.

## agent_clients

Authoring: Codex desktop, OpenAI `gpt-6-astra`; installed Windows app package
26.1023.6621.0 (package inventory, not a running-executable version claim).
The repository harness drives the actual app workflow directly. No external-client
acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw,
Muse, Grok bot, an elizaOS agent or Cursor.
