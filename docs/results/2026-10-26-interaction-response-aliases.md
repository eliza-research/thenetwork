# Preserve response history when member IDs change

## Requirement and cause

PRD 33.5 and ME-006 require matching to use one canonical member ID space.
On base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, `World` resolves interaction
participants, declines and contributors but leaves `acceptedBy` and `noResponse`
under their old IDs. Acceptance estimates then lose those responses. Peon also
loses pending employer reviews, answered applications and ghosted applications.

Normalize the two response arrays with the same existing resolver. Preserve
missing arrays and the original input. No alias policy or stored data changes.

Alternatives: normalize separately inside each history consumer, which leaves
the shared interaction inconsistent; or fix only the snapshot producer, which
leaves imported snapshots and other callers affected. The World boundary already
normalizes the other interaction IDs, so it is the smallest common correction.

## measurement

Same command before and after:

```sh
bun run sim --only peon --json peon-alias.json
```

The new gate runs the actual engine on three generated hiring worlds (seeds
1–3, 90 candidates and 20 jobs each). Their initial engine runs produce 7, 11
and 9 introductions. These supply 27 synthetic pending, completed or expired
interaction records. Replay each world with canonical IDs, then with equivalent
`legacy:` aliases in the participants and response arrays. Compare every
proposal and every member's hiring history. The fixture is hand-written; the
people and initial introductions come from the seeded repository generator.

| Check | Before | After |
|---|---|---|
| Replay seeds with identical proposals | 0/3 | 3/3 |
| Replay seeds with identical hiring histories | 0/3 | 3/3 |
| Peon blocking gates | 27/28 | 28/28 |
| Existing Peon gate records | 28 | All 28 unchanged |
| Pack/keyword/oracle fingerprint | `b7736da857812394` | `b7736da857812394` |
| Hires / keyword; introductions / keyword | 1.05; 0.10 | 1.05; 0.10 |
| Hires / oracle | 0.91 | 0.91 |
| Peon runtime | 29.2 s | 30.8 s |

The official comparison uses pinned seeds 13–16, eight weeks, 400 candidates and
80 jobs in each of NYC and SF. It uses the existing realism-v2 settings and
simulated review. This is deterministic identity invariance, not a claim of an
aggregate quality increase. The before gate stops on the first unequal proposal;
the separate replay ran all three before seeds, and the after gate runs all three.

## safety_gates

Minors matched, unverified-employer introductions and jobs without pay ranges
remain zero. Scammer median reach remains one (the existing passing gate).
Blocks, consent, leaks, protected-attribute invariance and all Peon conformance
checks pass. All data is synthetic and sends are dry-run.

## Validation

Windows, Bun 1.4.2, the frozen lockfile, PostgreSQL 16.15 on loopback port 54339.
Database commands use `USER=postgres`, `REQUIRE_PG=1` and the local `PG_BIN_DIR`.

- `bun run sim --only peon`: 28/28 blocking gates pass.
- `bun run sim --only network,slop,friends`: 118/118 blocking gates pass;
  nine existing tracked misses; 279.7 s.
- `bun run typecheck`: all four configurations pass.
- `bun run test:integration`, including security: 675 pass, 8 skip, 6 fail,
  13,741 assertions, 537.36 s.
- `bun run test:e2e`: 42 pass, one optional skip, zero failures, 73.99 s.

The eight integration skips require the separate cleanup-reconciliation opt-in.
The six failures reproduce the existing Windows limits seen before this change:
`deploy/wrangler.integration.test.ts` requires absolute `/bin/bash`;
`deploy/backend/backend.test.ts` expects SIGTERM exit 0 instead of 143; and four
`sites/test/sites.test.ts` assertions compare slash paths with backslashes.
Those files are unchanged. The integration suite is not claimed to pass.

AGENTS.md permits one full simulation per agent. That run was already used for
#136; all four application blocks were rerun for this change. Linux CI must still
run the full matrix and integration suite. This PR stays draft pending that run.

## llm_evidence and agent_clients

No model-backed behavior, prompt, client protocol or authentication flow changes.
Zero validation model calls and cost; no model or client acceptance run claimed.
Authoring: Codex desktop 26.1021.3705.0, OpenAI `gpt-6-astra`, operator-identified.

## Reproduce and limits

Install with `bun install --frozen-lockfile`. Run the Peon command above and
expect 28/28 blocking gates. Apply only the new gate to base `a0ed7bc`; it fails
because equivalent histories produce different proposals. The change can alter
scores and selection for snapshots containing response aliases; canonical-only
snapshots retain their prior results. Historical database rows are not migrated.
