# Preserve simulated intent check-in history

Date: 2026-11-07. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

## Requirement and reproduced problem

This fixes a reproduced simulator defect under the approved contribution scope, PRD 34.3–34.4, and the MVP validation plan.
The contract in `packages/sim/src/persona.ts` says an unanswered check-in leaves the previous intent record unchanged.
A check-in can confirm a live want or close a want that has lapsed.

Previously, `buildSnapshot` applied the member's current unanswered-message count to every historical check-in.
At two unanswered proactive messages, it discarded all earlier confirmations and returned the original active intent.
A later reply could also create an answer to a check-in that occurred while the member was unresponsive.

The initial reproduction used 12 complete worlds, seeds 1–12, with 40 generated adults and 100 days per world.
Personas used the shipped policy agent and StubNetwork, with hidden wants lasting 20 days on average.
No fabricated message logs or replacement network implementation were used.
For seed 7, member `m0010` had two closed intents on day 34.
Both became active on day 35, when the unanswered count reached two.
The same snapshot moved another intent's confirmation time back by 30 days.

## Change

Snapshots replay the existing conversation records into intervals with two or more unanswered proactive messages.
Each modeled check-in reads the interval at its own time.
Only delivered proactive messages increase the count; inbound messages reset it, matching the World's existing counter.
Earlier answers survive later silence. A later inbound does not supply an answer during an earlier silent interval.

`intentRecordTiming` accepts a time-specific responsiveness predicate.
Its existing boolean input remains available for static population generation.
Snapshots without conversation records retain the existing boolean fallback.
Both full profiles and richness-limited profiles use the same history.

Alternatives considered:

1. Remove the unanswered-message check. This would invent confirmations while members ignore the agent.
2. Cache the latest intent record. Its correctness would depend on snapshot polling frequency and require extra persisted state.

Replaying existing messages preserves deterministic reconstruction without adding a schema, dependency, or cache.

## measurement

One integration case runs four complete worlds: seeds 7 and 9, each with richness off and on.
Each world has 40 generated adults, 100 days, and a 20-day mean hidden-want lifetime.
It observes daily snapshots after real simulated conversations.
It checks that closed intents stay closed, confirmation times never move backward, and confirmations occur outside unresponsive intervals.
Positive controls require observed closed intents, confirmations, and unresponsive members.

Command on base plus the new test, then on the candidate:

```sh
bun test packages/sim/test/intent-history.integration.test.ts
```

| Result | Before | After |
|---|---:|---:|
| Passed cases | 0 | 1 |
| Failed cases | 1 | 0 |
| Assertions | 8 | 8 |
| Case duration | 1773.70 ms | 1856.99 ms |
| Command duration | 1.82 s | 1.90 s |

The wider comparison ran 88 paired worlds with the same command, inputs, and seeds on both revisions.
Each world used 40 generated adults, `adversarialRate: 0`, `minorShare: 0`, and `joinSpreadDays: 1`.

| Variant | Seeds | Days | Hidden wants | Richness |
|---|---|---:|---|---|
| lapse | 13–32 | 100 | 20-day mean lifetime | off |
| rich | 13–32 | 100 | 20-day mean lifetime | on |
| live | 13–32 | 100 | no lapse | off |
| short | 13–32 | 14 | 20-day mean lifetime | off |
| engine | 7, 9, 13, 14 | 65 | 20-day mean lifetime | off |
| engine-rich | 7, 9, 13, 14 | 65 | 20-day mean lifetime | on |

The first four variants use StubNetwork's normal random introductions.
The last two use the real engine adapter and disable the stub's random introductions.

| Observed defect | Before | After |
|---|---:|---:|
| Closed-to-active transitions | 155 | 0 |
| Confirmation times moving backward | 155 | 0 |
| Distinct confirmations during unresponsive intervals | 47 | 0 |

These counts measure different properties and can overlap. They are not a count of affected people.
The first two count transitions between daily snapshots.
The third counts distinct intent/timestamp pairs within each run.

All 88 pairs retained identical generated personas, complete metrics, and conversation traces.
Only `run_end.wallMs` was normalized for trace comparison.
All non-intent snapshot fields remained identical.
Intent histories changed in 57 worlds; the other 31 remained identical.
All 20 short controls and all eight engine-driven worlds remained identical, including their intent histories.
The engine-driven sample therefore establishes an unchanged control, not a demonstrated matching-quality improvement.

Separately, 16,248 direct comparisons retained identical static `intentRecordTiming` results.
These used seeds 13–32, 40 generated personas per seed, and days 14, 30, 60, and 100.
Every stated intent used the omitted, false, and true boolean inputs on both revisions.
This is a compatibility comparison, separate from the complete-world regression.

Closed-intent observations across daily snapshots changed from 148,173 to 149,309.
Confirmed-intent observations changed from 118,785 to 120,486.
Unresponsive member-days stayed at 3,618.
These are repeated observations, not distinct members or intents.

## safety_gates

All 88 paired runs retained identical safety, privacy, invariant, and error results.
Every run had zero network errors, declared-minor contacts, and privacy-canary leaks.
Thirteen worlds had existing invariant failures. All remained unchanged:

| Variant / seed | Existing rules and counts |
|---|---|
| live / 13 | decliner_exposed 1 |
| lapse, rich, live, short / 18 | decliner_exposed 2 in each |
| lapse, rich / 22 | decliner_exposed 2, proactive_mislabeled 1, pause_path_missing 1 in each |
| live, short / 22 | decliner_exposed 1 in each |
| live / 30 | decliner_exposed 1, proactive_mislabeled 1, over_budget 1, pause_path_missing 1 |
| live / 32 | decliner_exposed 1 |
| engine-rich / 9 | over_budget 1 |
| engine / 14 | decliner_exposed 3 |

These exploratory worlds do not claim clean baseline behavior.
No threshold was changed or waived.

## Repository qualification

The simulation command ran on both revisions, with local PostgreSQL required.
The remaining commands qualify the candidate:

```sh
bun run sim --only network,slop,safety,audit --json ../intent-history-gates-after.json
bun run typecheck
bun run test:integration
bun run test:e2e
```

Both gate runs passed **133/133 blocking gates**, with **8 existing tracked targets off target**.
All **153 gate records** retained identical names, classifications, pass states, details, values, and fingerprints after excluding execution time.
Total gate time was 198.2 seconds before and 197.3 seconds after; this is not a performance claim.
All four TypeScript configurations passed.

Integration: **676 pass, 8 skip, 6 known Windows failures**, 13,749 assertions, 382.91 seconds.
The six failing test names and underlying causes match the previously recorded failures on the same base commit:

- Wrangler cannot spawn `/bin/bash` on this Windows host.
- The boot test expects exit zero after SIGTERM; this host returns 143.
- Four site-build assertions compare a Windows path with `.well-known/agent-skills/index.json`.

E2E: **42 pass, 1 optional browser-SDK skip, 0 fail**, 654 assertions, 40.45 seconds.
The validation script confirmed those baseline failure signatures and completed with exit zero.

The security suite runs within `test:integration`; it was not run again as a separate command.
The agent's one full-simulation allowance was used earlier in this contribution session.
These affected blocks were run on both revisions; no fresh full-suite claim is made here.

## llm_evidence

N/A: the change reconstructs deterministic check-in history from simulator records.
Validation used zero model calls and incurred zero model-call cost.
No claim is made about optional LLM personas, graders, or model-based response quality.

## agent_clients

| Client | Provider | Exact model | Result |
|---|---|---|---|
| Codex desktop 26.1103.3517.0 | OpenAI | unavailable | Local Bun workflows and direct GitHub operations |

Runtime: Bun 1.4.2, Windows, PowerShell 7.6.9, and PostgreSQL 16.15 on the owned local port 54339.
No other agent client was tested. This is a simulator-library change, not a member-facing client workflow.
Computer use was not used, following the operator's instruction.

## Limits and tradeoffs

- Check-ins remain the existing synthetic 30-day model, with the same deterministic reply draws and lapse rules.
- Full World logs provide the historical counter. Callers without logs retain the old static behavior.
- Conversation history is replayed once per snapshot. No persistent cache or migration is introduced.
- Same-timestamp messages use recorded order; an interval that opens and closes at that timestamp has zero duration.
- The 100-day sample deliberately exercises check-ins. It does not estimate the defect's frequency in production.
- This fixes simulated knowledge. No production database, send path, or UI is changed.

## Reproduce the wider comparison

Save the following program outside the checkout as `intent-history-measure.ts`.
Run it once from each revision with that checkout as the argument.
Use `engine` as the second argument for the eight engine-driven controls.
Compare rows by variant and seed. Require zero defects after the fix and identical hashes for personas and traces.

```sh
bun ../intent-history-measure.ts . > ../intent-history-after.jsonl
bun ../intent-history-measure.ts . engine > ../intent-history-engine-after.jsonl
```

```ts
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const root = process.argv[2]!;
const imp = (p: string) => import(pathToFileURL(resolve(root, p)).href);
const { World } = await imp("packages/sim/src/world.ts");
const { generatePersonas } = await imp("packages/sim/src/generator.ts");
const { StubNetwork } = await imp("packages/sim/src/stubNetwork.ts");
const { createEngine } = await imp("packages/sim/src/engineAdapter.ts");
const hash = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
const engineMode = process.argv[3] === "engine";
for (const seed of engineMode ? [7, 9, 13, 14] : Array.from({ length: 20 }, (_, i) => i + 13)) {
  for (const variant of engineMode ? ["engine", "engine-rich"] : ["lapse", "rich", "live", "short"]) {
    const richness = variant.includes("rich");
    const days = variant === "short" ? 14 : engineMode ? 65 : 100;
    const personas = generatePersonas({ n: 40, seed, richness, adversarialRate: 0, minorShare: 0, joinSpreadDays: 1, ...(variant !== "live" ? { intentLapse: { meanDays: 20 } } : {}) });
    const seen = new Map();
    const retroactive = new Set();
    let reopened = 0, rewound = 0, closed = 0, confirmed = 0, silentMemberDays = 0;
    const intentsHash = createHash("sha256"), otherSnapshotHash = createHash("sha256");
    let w: InstanceType<typeof World>;
    w = new World({ seed, personas, days, writeLog: false, runId: `intent-history-${variant}-${seed}`,
      network: new StubNetwork({ seed, randomIntros: !engineMode }), ...(engineMode ? { engine: createEngine() } : {}),
      onDay() {
        const snapshot = w.snapshot();
        const { intents, ...other } = snapshot;
        intentsHash.update(JSON.stringify(intents)); otherSnapshotHash.update(JSON.stringify(other));
        silentMemberDays += snapshot.members.filter((m: any) => m.unansweredProactive >= 2).length;
        for (const intent of intents) {
          const prev = seen.get(intent.id);
          if (intent.status === "closed") closed++;
          if (prev?.status === "closed" && intent.status !== "closed") reopened++;
          if (prev && intent.createdAt < prev.createdAt) rewound++;
          if (intent.createdAt > w.memories.get(intent.memberId)!.joinedAt!) {
            confirmed++;
            let unanswered = 0;
            for (const r of w.records) if (r.type === "message" && r.msg.memberId === intent.memberId && r.msg.ts <= intent.createdAt) {
              if (r.msg.direction === "inbound") unanswered = 0;
              else if (r.msg.status === "delivered" && r.msg.meta?.proactive) unanswered++;
            }
            if (unanswered >= 2) retroactive.add(`${intent.id}/${intent.createdAt}`);
          }
          seen.set(intent.id, { status: intent.status, createdAt: intent.createdAt });
        }
      }
    });
    const result = await w.run();
    const trace = result.records.map((r: any) => r.type === "run_end" ? { ...r, wallMs: 0 } : r);
    console.log(JSON.stringify({ seed, variant, days, reopened, rewound, retroactive: retroactive.size, closed, confirmed, silentMemberDays,
      metrics: result.metrics, hashes: { personas: hash(result.personas), trace: hash(trace), intents: intentsHash.digest("hex"), otherSnapshots: otherSnapshotHash.digest("hex") } }));
  }
}
```
