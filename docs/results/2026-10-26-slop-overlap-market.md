# Keep Slop proposals inside the members' distance limits

## Requirement and cause

PRD 40.5 makes stated cities and distance limits hard filters in both directions.
This report uses synthetic adults and local dry-run validation only.

On base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, two New York members with
zip codes 10002 and 10463, two-mile limits, and multi-city scope `nyc,sf` receive
a New York proposal. Their only market inside both limits is San Francisco:
the existing visitor model places both at its anchor cell. Neither has shared
presence there in the proposal window.

The generator checks `mutualMarkets` and sets San Francisco as `preferredCity`.
The candidate filter then asks for presence overlap. Slop delegates that search
to the city-bucket model, which can fall back to any configured city. New York
has overlap but fails the distance check. The chosen city is not checked again.

## Change and alternatives

Move the existing interval search into `overlapInMarkets`. The city-bucket model
passes the same cities, in the same order, as before. Slop passes only cities
that satisfy every pair's existing `mutualMarkets` check. The search retains the
same presence intervals, preferred-city rule, overlap threshold and tie order.
It returns no overlap if no qualifying city has shared presence.

Two alternatives:

1. Require the generator's preferred city. This would discard a valid fallback
   city when the closest market has no shared presence.
2. Check the chosen city after the unrestricted search. This could reject a pair
   even when another qualifying city has shared presence. Repeating the interval
   search inside Slop would also duplicate the core algorithm.

## measurement

Same command before and after:

```sh
bun run sim --only slop --json slop-market.json
```

The before run uses the new gate with unchanged production code from the base.
The after run uses the same gate, settings and seeds with the fix.

| Measurement | Before | After |
|---|---|---|
| Proposal for the two-mile, no-trip fixture | New York, outside both limits | No proposal |
| New regression gate | Fails on `no_trip` | Passes all 30 engine runs |
| Slop blocking gates | 39/40 | 40/40 |
| Existing gate results and values | 57 records | All 57 identical |
| Random/Slop arm fingerprint | `445afd705328fe54` | `445afd705328fe54` |
| Slop-live fingerprint | `eaeaf7bbe8c99c81` | `eaeaf7bbe8c99c81` |
| Dates per member-month / random | 1.005 | 1.005 |
| Slop-live dates held | 32 | 32 |
| Tracked gates off target | 8 | 8 |
| Runtime | 32.6 s | 31.2 s |

The new gate calls `runEngine` with the default Slop pack. Its hand-written
snapshot contains two adults, stated dating preferences, one shared interest,
active dating intents and presence records. It runs five cases with seeds 1, 2
and 3 in both input orders:

- No trip: the only market inside both limits has no shared presence.
- Shared trip: the proposal uses San Francisco and exactly the shared trip window.
- Disjoint trips: the members visit San Francisco at different times; no proposal.
- Valid fallback: 25-mile limits allow New York when San Francisco has no overlap.
- Outside scope: a shared New York zip cannot override scope restricted to San Francisco.

The before run stops at the first failed assertion. It does not claim that all
30 before cases were executed. The after run executes all 30.

The broader Slop comparison uses the existing pinned seeds 13–16, four weeks,
300 generated personas per city in SF, NYC and LA (900 per seed), and the
repository's random and Slop arms. Slop-live uses seeds 21–22 and 30 days. The
existing conformance worlds use seeds 1–4. Review and member responses are
simulated. No statistical improvement is claimed; this is a deterministic
hard-filter defect, and the aggregate simulation values are unchanged.

## safety_gates

Declared-minor contacts, stated-filter violations and scammer median reach stay
at zero in the pinned world. Rating, contact and canary leaks stay at zero.
All existing conformance, relay and Slop-live blocking gates pass. The additional
hand-written gate covers the multi-city presence case absent from that world.
The eight existing tracked misses remain visible and unchanged.

## Validation

Validation host: Windows, Bun 1.4.2, TypeScript from the frozen lockfile,
PostgreSQL 16.15 bound to loopback port 54339. No live-send or deploy flags.
The checkout uses the repository's LF bytes. Database-backed commands set
`USER=postgres`, `REQUIRE_PG=1`, and `PG_BIN_DIR` to the local PostgreSQL binaries.

- `bun run sim --only slop`: 40/40 blocking gates pass.
- `bun run sim --only network,peon,friends`: 106/106 blocking gates pass
  (61 Network, 27 Peon, 18 Friends), one existing tracked miss, 292.7 s.
- `bun run typecheck`: exit 0 for all four configurations.
- `bun run test:e2e`: 42 pass, one optional skip, zero failures, 139.81 s.
  This includes the real HTTP/PostgreSQL multi-market profile intake, correction
  and matching case.

The repository's machine-load instruction permits at most one full simulation
per agent. That run was already used for #136 earlier in this session. This PR
reruns the four application blocks affected by the shared geography helper;
it does not claim a second full-matrix pass. All 112 existing records in the
Network, Peon and Friends rerun match the earlier matrix values, excluding timing.

`bun run test:integration` (including the security files): **675 pass, 8 skip,
6 fail**, 13,741 assertions across 68 files, 638.35 s. The eight skipped entries
belong to the separate cleanup-reconciliation suite, whose
`NETWORK_RETRY_RECONCILIATION_TEST` opt-in is unset.

All six failures are the same Windows-specific failures observed before this
change while validating #136, in files untouched by this PR:

| File | Failure |
|---|---|
| `deploy/wrangler.integration.test.ts` | Absolute `/bin/bash` cannot be spawned on this Windows host. |
| `deploy/backend/backend.test.ts` | SIGTERM returns 143; the assertion expects 0. |
| `sites/test/sites.test.ts` | Four site-file assertions compare forward-slash paths with Windows backslashes. |

The Slop service integration covers joining, onboarding, review approval,
mutual consent, booking, check-in and post-date reporting; it passes. The
integration suite as a whole is not claimed to pass. This PR remains draft
pending the Linux CI run, including the full simulation matrix.

## llm_evidence

Not applicable to this deterministic geometry path. It changes no model-backed
behavior, prompt, parser or model configuration. Validation makes zero model
calls and has zero model cost. No real-model qualification is claimed.

## agent_clients

No client protocol, authentication or tool workflow changes. No client acceptance
run is claimed. Authoring client: Codex desktop 26.1021.3705.0, OpenAI
`gpt-6-astra`, as identified by the operator.

## Reproduce and limits

Install with `bun install --frozen-lockfile`, then run the Slop command above.
Expect 40/40 blocking gates. Apply only the added gate to base `a0ed7bc` to see
the New York proposal fail the assertion. Keep the gate unchanged between runs.

The existing coarse zip cells and visitor anchor assumptions are unchanged.
This fix can remove a proposal when the members have no shared presence within
their stated limits; that is the required behavior. It does not claim new
matching quality gains or change stored proposals.
