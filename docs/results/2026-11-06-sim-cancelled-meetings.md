# Delivered cancellations in simulated attendance

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: the reproduced-defect and simulation-validation provisions in CONTRIBUTING 3.1,
and PRD 34.3's persona attendance and cancellation scenarios.

The World continued to record attendance after the Network told a persona that
the whole meeting was off. In a two-person reproduction, the remaining persona
received the cancellation at 2026-10-08 15:41 UTC, then attended alone at
2026-10-09 02:00 UTC. Its cached attendance decision survived the message.

The cancellation message type also covers group updates where the other people
still meet. Both Network implementations now annotate that distinction with
`SimMeta.meetingCancelled`. The World processes a whole-meeting cancellation
when the channel delivers it, clears that persona's attendance plan, and skips
later flake checks for that cancelled commitment.

An optional `cancelledByNetwork` outcome field distinguishes receiving a
cancellation from giving one's own flake notice. Both excuse a missing attendance
in the aggregate no-show calculation, counted once if both apply. The scenario
grader continues to attribute flake notices only to their senders. Its notification
check now requires delivered notices before the meeting for every remaining
participant; a failed send cannot satisfy it. Historical outcome records still
work because the new field is optional.

Alternatives considered:

- Treat every cancellation message as a cancelled meeting. That cancels the
  remaining group even when the message explicitly says it is still on.
- Cancel the meeting at send time. That hides the real consequence of a failed
  notice: an uninformed persona may still attend.
- Infer the distinction from message wording. The sender already knows whether
  the meeting remains on; an annotation avoids a second interpretation of copy.

## Measurement

Windows, Bun 1.4.2, PostgreSQL 16.15 on an isolated local port 54339.
All personas and messages are synthetic. There are no mocked agent decisions,
model responses or transport results.

The integration case adapts the existing `group-flake-morning-of` scenario.
Each arm runs five simulated days through the actual World, policy persona agent,
StubNetwork, SimChannel, attendance scorer and scenario grader. The forced flake
is set before booking, using the existing working scenario hook. It does not
address the after-booking hook in PR #340.

| Arm | Seed | Before | After |
|---|---:|---|---|
| Intact pair | 21 | Both attend | Both attend |
| Pair, one cancellation delivered | 21 | Other person attends alone | Neither attends; recipient is not graded as a flaker |
| Intact six-person group | 21 | Six attend | Six attend |
| Group, one member drops | 21 | Five attend | Five attend |
| Pair, cancellation delivery fails | 35 | Uninformed person attends; notification check incorrectly passes | Same attendance; notification check correctly fails |

Seed 35 uses the channel's existing 10% seeded delivery-failure option; the other
arms use its default zero failure rate. Assertions verify an actual scheduled
meeting, notice delivery status and timing, attendance, cancellation attribution,
scenario results, zero no-show rate, zero invariant violations and zero errors.
The final case against the base runtime: **0 pass / 1 fail, 26 assertions**.
The same case with the fix: **1 pass / 0 fail, 26 assertions** (99 ms).
These are deterministic fixture outcomes, not estimates requiring confidence intervals.

```sh
bun test --conditions eliza-source packages/sim/test/cancellation.integration.test.ts
bun run sim --only network,slop,peon-seats,friends,safety,audit --json <output>
bun run typecheck
bun run test:integration
bun run test:e2e
```

The same six simulation blocks ran before and after, with the defaults in
`scripts/sim/*.ts`: network invariant seed 3, consent seeds 1–3 for 21 days and
scenario pass^3; Slop seeds 13–16 and live seeds 21–22; Friends seeds 5–8;
the existing Peon seat scenarios; PostgreSQL safety and audit checks.
Both runs use the simulated reviewer. No thresholds or classifications change.

| Block | Blocking gates before | Blocking gates after |
|---|---:|---:|
| network | 61/61 | 60/61 |
| slop | 39/39 | 39/39 |
| peon-seats | 9/9 | 9/9 |
| friends | 18/18 | 18/18 |
| safety | 17/17 | 17/17 |
| audit | 16/16 | 16/16 |
| Total | 160/160 | 159/160 |

Both runs retain nine off-target tracked gates. Of 183 gate records, 174 match
exactly after excluding elapsed time. These are all nine changed records:

| Record | Before | After |
|---|---|---|
| Invariant run fingerprint | `24bb81f068060b33` | `0bd2ce56424cbe35` |
| Consent/push fingerprint | `361f8cc2648fb9a6` | `069d15b0f23e6113` |
| Everyone-yes rate | 0.847 | 0.840 |
| Invite-yes rate | 0.919 | 0.918 |
| Consent vs push held meetings, seed 1 | 50 vs 36 | 49 vs 36 |
| Pooled held meetings (>140 gate) | 144, pass | 138, fail |
| New members, seed 1 | 20 | 15 |
| Plan meetings held, seeds 1–3 | 1, 0, 1 | 0, 1, 1 |
| Slop-live fingerprint | `eaeaf7bbe8c99c81` | `d4fcbc7b47efdeaf` |

The other eight changed records retain passing results. Runtime was 304.1 seconds
before and 340.9 seconds after; timings are not a performance claim.

The held-meeting floor remains **greater than 140**. The corrected count is below
that floor. This is a real failing blocking gate, not a green simulation claim.
The PR is a draft so maintainers can review the corrected measurement and decide
how to qualify the existing quality baseline before merging.

A diagnostic repeats the same consent arms with `runArm("consent", { days: 21,
seed, onRecords })`, seeds 1–3. It joins each outcome to an earlier
`opportunity_closed` (participant dropped or blocked) or `meeting_cancelled`
record and delivered whole-meeting cancellation messages between closure and meeting time.
The diagnostic recognizes the two existing full-cancellation templates inside any
folded acknowledgement or pause hint, and excludes the still-on group template.
A group update sent at the same timestamp cannot be mistaken for a cancellation.
It counts attendance by recipients of those notices, without publishing run logs.

| Seed | Held before / after | Informed attendees before / after | Closed meetings still counted held before / after |
|---:|---:|---:|---:|
| 1 | 50 / 49 | 11 / 0 | 0 / 0 |
| 2 | 47 / 43 | 20 / 0 | 1 / 0 |
| 3 | 47 / 46 | 18 / 0 | 1 / 0 |

The base has **49 attendance records after delivered whole-meeting cancellations**;
the fixed runs have **zero**. Two closed meetings counted as held on base; none
do in the fixed runs. The number of closed meetings with a delivered notice is
56 before and 53 after. New members joining are 20/15/15 before and 15/13/15 after.
Every diagnostic arm has zero invariant violations, canary leaks and minor contacts.

To repeat that diagnostic on base and head, save this as a scratch `.ts` file in
the repository root and run `bun run --conditions eliza-source <file>`:

```ts
import { runArm } from "./packages/network/harness/experiment.ts";
import { copy } from "./packages/network/src/copy.ts";
for (const seed of [1, 2, 3]) {
  let informedShowed = 0, closedStillHeld = 0, closedWithNotice = 0;
  const arm = await runArm("consent", { days: 21, seed, onRecords(records) {
    for (const r of records) if (r.type === "outcome") {
      const closure = records.find(c => c.type === "network_log" && c.t <= r.at && (
        c.kind === "opportunity_closed" && c.detail.proposalId === r.proposalId &&
          ["participant dropped", "blocked"].includes(String(c.detail.reason)) ||
        c.kind === "meeting_cancelled" && c.detail.proposalId === r.proposalId));
      if (!closure) continue;
      const informed = new Set(records.flatMap(m => m.type === "message" &&
        m.msg.direction === "outbound" && m.msg.status === "delivered" &&
        m.msg.meta?.type === "cancellation" && m.msg.meta.proposalId === r.proposalId &&
        !m.msg.body.includes(copy.dropNotice("", true)) &&
        [copy.dropNotice("", false), copy.declinedQuiet].some(text => m.msg.body.includes(text)) &&
        m.msg.ts >= closure.t && m.msg.ts <= r.at ? [m.msg.memberId] : []));
      const showed = Object.entries(r.attendance).filter(([, a]) => a.showed).map(([id]) => id);
      if (informed.size) {
        closedWithNotice++;
        if (showed.length >= 2) closedStillHeld++;
        informedShowed += showed.filter(id => informed.has(id)).length;
      }
    }
  }});
  console.log({ seed, held: arm.meetingsHeld, informedShowed, closedStillHeld,
    closedWithNotice, newMembersJoined: arm.newMembersJoined, judge: arm.judge });
}
```

Future matching and growth depend on earlier attendance, so these runs can diverge
after the first corrected outcome. The pooled difference is not a claim that all
six lost held meetings were directly cancelled. This is a correction to the
simulated truth, not a matching-quality improvement claim.

## Validation and safety gates

- Typecheck: all four configurations pass.
- Integration including security: **676 pass, 8 skip, 6 fail**, 13,766 assertions,
  69 files, 580.83 seconds. The new five-arm regression passes inside this command
  in 21.98 ms. All six failure titles match the previously reproduced base failures.
- End-to-end: **42 pass, 1 skip, 0 fail**, 654 assertions, 102.50 seconds.
- The six affected simulation blocks: **159/160** blocking gates, with the one
  quality-floor failure documented above. Every safety gate remains passing.

The integration command includes all security-suite files. The six known base
failures concern `/bin/bash` being unavailable, SIGTERM exiting 143 instead of 0,
and four native Windows path comparisons in site builds. They were reproduced
on the same base revision in the existing local baseline run. Full integration
is not green. Eight integration skips are the opt-in cleanup-reconciliation suite;
the e2e skip is the optional browser SDK case.

The agent's one full `bun run sim` allowance was used on an earlier contribution.
AGENTS.md's machine-load rule limits this change to affected-block runs; no new
full-suite pass is claimed. Live-send and deployment flags were disabled.

## LLM evidence and agent clients

Model calls: 0. Inference cost: $0. Provider/model/request settings for validation:
N/A. This is deterministic simulator state and scoring; no model-backed behavior
is claimed. The existing LLM persona agent uses the same World, but no LLM voice
or external member-facing agent client was tested.

Authoring client: Codex desktop 26.1029.7803.0, OpenAI; the exact assistant model
identifier was not exposed. The disclosure helper uses its supported `unavailable`
value. No computer or browser use occurred.

## Limits

Custom Network implementations that omit the optional cancellation annotation
retain their prior behavior. Message text, booking policy and production
attendance inference are outside this fix. Old run logs are not rewritten.
The result adds one optional outcome field and corrects the simulator's attendance
and notification accounting. Maintainer review of the failing quality floor and
hosted CI remain necessary before the draft is ready to merge.
