# Preserve dating profiles between matching and date planning

## Requirement and cause

PRD 33.5 / ME-006 requires one canonical member-ID space. PRD 40.5 requires
matched pairs to receive a first-date plan. Base revision:
`a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

The matcher passes `World.canonical` when reading Slop profiles. Standalone
consumers, including `planFromInput`, call `slopProfiles(input)` without that
resolver. Its old default was identity, so profile facets, presence and intents
stored under older IDs disappeared. The engine could match the same people,
then the date planner returned null because it could no longer read their
distance limits. The profile cache also ignored which resolver built its data.

Extract the existing World resolver unchanged into `identity.ts`, and reuse it
as the default for Slop profiles. Keep profile cache entries separate by resolver.
Member IDs still take precedence over aliases, unknown IDs are preserved, and
the existing eight-hop bound remains. No alias policy or stored data is changed.

Alternatives considered:

1. Construct a complete World in every standalone date-planning call. That builds
   embeddings, relationship indexes and history counters just to resolve IDs.
2. Duplicate the resolver in the planner. That leaves other standalone profile
   consumers affected and lets the two implementations drift.

## measurement

Same command before and after:

```sh
bun run sim --only slop --json slop-plan-alias.json
```

The new gate runs the actual engine and `planFromInput` on three repository-generated
worlds: seeds 1–3, 50 people per city in SF, NYC and LA, no declared minors in this
fixture, and the existing conformance blocks and holds. The normal conformance
suite still covers minors. Replay each world with its original identifiers and
with two-hop aliases on every facet, presence and intent's member ID.

The matches must remain exactly equal. For each matched pair, the date's market,
activity, venue, duration, options and distance band must match the canonical
input's plan. Check first reads, repeated reads and reads after the same input
was used with an explicit identity resolver. The alias mapping and call order
are hand-written fixtures; the people and recommendations are generated.

| Seed | Canonical matches and plans | Plans from aliased input before | After |
|---|---:|---:|---:|
| 1 | 36 | 0 | 36 |
| 2 | 33 | 0 | 33 |
| 3 | 32 | 0 | 32 |
| Total | 101 | 0 | 101 |

Matching already returned all 101 pairs before the fix. The failure was the
handoff to date planning. Each canonical input has 126 profiles with distance
information; standalone aliased reads previously had zero and now have all 126.
The baseline gate stops at its first unequal plan; a separate replay enumerated
all three seeds before and after.

Fresh seeds 4–6 produce 39, 30 and 36 plans respectively, all exactly equal to
their canonical controls. This is deterministic identity equivalence, not a
claim of better aggregate dating quality. There was one production attempt.

## safety_gates

The change restores the existing canonical profile view. It does not add fields
or expose profile data to a client. All data is synthetic and sends are dry-run.
All 57 pre-existing Slop gate records remain identical after excluding assertion
runtime. The pack/random fingerprint remains `445afd705328fe54`; declared-minor
contacts and stated-filter violations remain zero, and scam harm reduction stays
100%. All Slop conformance and relay checks pass. The existing tracked misses
remain unchanged.

## Validation

Windows, Bun 1.4.2, TypeScript 5.9.3 from the frozen lockfile, PostgreSQL 16.15
on loopback port 54339. Database commands use `USER=postgres`, `REQUIRE_PG=1`
and the local `PG_BIN_DIR`.

- `bun run sim --only slop,network,peon,friends`: 146/146 blocking gates pass,
  nine existing tracked misses, 317.8 s. Slop is 40/40 after versus 39/40 before;
  its block took 31.2 s after versus 32.5 s before.
- `bun run typecheck`: all four configurations pass.
- `bun run test:integration`, including security: 675 pass, eight skip, six fail,
  13,741 assertions, 582.81 s.
- `bun run test:e2e`: 42 pass, one optional skip, zero failures,
  654 assertions, 75.36 s.

The six integration failures reproduce the existing Windows limitations:
the Wrangler test requires absolute `/bin/bash`; the backend expects SIGTERM
exit zero instead of 143; and four site-build assertions compare slash paths
against backslashes. The eight skips require the separate cleanup opt-in.
Integration is not claimed to pass.

The one-full-simulation-per-agent allowance was already used for #136. These
four application blocks cover the reused World resolver and Slop profile change.
Linux CI still needs the full matrix; the PR remains draft until then.

## llm_evidence and agent_clients

No model-backed behavior, prompt, authentication or client protocol changes.
Zero validation model calls and cost; no real-client acceptance run is claimed.
Authoring: Codex desktop 26.1021.3705.0, OpenAI `gpt-6-astra`, operator-identified.

## Reproduce and limits

Install with `bun install --frozen-lockfile`, then run the Slop command above.
Apply only the new gate to `a0ed7bc` to reproduce null date plans despite
successful matching. The fixture uses canonical participant IDs returned by the
matcher; it does not introduce a new contract for alias-valued planner arguments.

Inputs remain immutable snapshots: changing the same input object after it has
been cached is unsupported. Separate resolver entries can add a profile build
when a caller uses several resolver functions for the same input. There is no
change to date selection for canonical-only snapshots.
