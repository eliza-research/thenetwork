# Network pilot after the probe consent fix

The Network's 21-day consent fixture uses 250 starting NYC personas, simulated staff approval, and the seeded persona policy. It makes no model or carrier calls. The runs used Node 26.13.0 and the default plan and review timing. The three fixed seeds are a regression check.

```bash
node --import tsx --input-type=module -e '
import { runArm } from "./packages/network/harness/experiment.ts";
for (const seed of [1, 2, 3]) {
  const result = await runArm("consent", { days: 21, seed });
  console.log({ seed, meetings: result.meetingsHeld, heldPlans: result.plans?.planMeetingsHeld, judge: result.judge });
}'
```

| Seed | Meetings before | Meetings after | Held plans before and after | Invariant violations before | Invariant violations after |
|---|---:|---:|---:|---:|---:|
| 1 | 48 | 48 | 0 | 0 | 0 |
| 2 | 59 | 59 | 1 | 0 | 0 |
| 3 | 53 | 57 | 0 | 1 | 0 |
| Total | 160 | 164 | 1 | 1 | 0 |

Before is the combined matching and Friends scheduling code at `284beff6`. After includes the probe-consent fix at `83a51905`. Both runs recorded zero canary leaks and minor contacts. The final run met the thresholds of more than 140 meetings and at least one held plan.

In seed 3, an unrelated dating answer was followed by “Thanks! 👍💯”. The Network applied the acknowledgment to an older chess invitation and revealed a participant before that person had agreed to meet. The hand-written reply path now checks the latest outbound context and the exact accepted receipt. The generated [probe reply rule](../../spec/probeReply.md#a-short-acknowledgement-must-immediately-follow-its-own-probe) requires an uninterrupted direct reply for a short acknowledgment. The focused regression also covers an unrelated turn with no Network response, an unresolved receipt, and an immediate thumbs-up to the current probe.

The hosted aggregate and live-client qualifications have their own evidence requirements. The fixed seeds support the simulation thresholds and the reproduced consent case.
