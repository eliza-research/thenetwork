# Count a queued application's recruiter work once

Date: 2026-11-06. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: reproduced simulation defect, under PRD 34.3 and 40.6 and the approved
Slop simulation-validation scope.

## Problem and cause

Peon's weekly world gives each job a recruiter-hours budget. Reading an
application costs 0.1 hours. Reserving its interview costs 1.5 hours.
An acceptable application stays on file when the remaining budget cannot reserve
an interview. The next week's recruiter invites those applications first.

That invitation sets `reviewed = true` and clears `onFile`. The following unread
queue used the same pending array. It excluded expired and on-file applications,
but did not exclude the applications just invited. It could read and invite the
same application again, charging both costs twice and consuming another slot.
The stored interview week was overwritten with the same value, hiding the
duplicate reservation from the final flow record.

The fix requires `reviewed === undefined` when constructing the unread queue.
It uses the existing state transition and changes no capacity or cost parameter.

Two alternatives were considered:

- Capture the unread list before inviting on-file applications. This avoids the
  duplicate through operation order. Checking the current state makes the
  unread queue's meaning explicit.
- Add a separate set of applications processed this week. This duplicates the
  existing `reviewed` state and needs another update during scheduling.

## measurement

One new blocking gate reuses the real runs already made by the Peon block.
It compares recruiter-hours spending against each unique application's recorded
read and interview reservation. A read includes an application still on file.
A reservation counts even if the interview later cancels or the candidate does
not attend. The check uses a `1e-7` tolerance for floating-point accumulation.

The same command ran before and after:

```sh
bun run sim --only peon --json /tmp/peon-queue-accounting.json
```

Both runs use seeds 13-16, eight weeks, 400 candidates and 80 jobs per city,
NYC and SF, and the pack, keyword and oracle arms. These are 12 real weekly
worlds using the existing realism-v2 assumptions. Populations and oracle draws
are deterministic synthetic data. There are no model calls or live messages.

| Measure across the 12 worlds | Before | After |
| --- | ---: | ---: |
| Worlds with incorrect recruiter-hours totals | 4 | 0 |
| Excess simulated hours against unique recorded work | 8.0 | 0 |
| Unique application reads | 6,951 | 6,956 |
| Unique interview reservations | 3,592 | 3,593 |
| Recruiter hours spent | 6,091.1 | 6,085.1 |
| Expected hours from recorded work | 6,083.1 | 6,085.1 |
| Hires | 554 | 554 |
| Blocking gates passed | 27/28 | 28/28 |

The removed duplicate charges free capacity for five further reads and one
further interview reservation. That new work uses two hours. Total spending
therefore falls by six hours, while the eight-hour accounting discrepancy falls
to zero. These are simulated recruiter hours, not runtime savings.

| Affected arm and seed | Excess hours before | Excess hours after |
| --- | ---: | ---: |
| Pack, 15 | 1.6 | 0 |
| Keyword, 14 | 1.6 | 0 |
| Keyword, 15 | 3.2 | 0 |
| Keyword, 16 | 1.6 | 0 |

The other eight worlds reconcile before and after. Their read, reservation,
recruiter-hours and hire counts remain unchanged. Each world's hire count stays
unchanged, including the four affected worlds.

The before run uses base runtime with the final new gate. Only that gate fails.
It takes 32.3 seconds; the fixed run takes 33.3 seconds. No performance claim is
made under shared machine load. Of 29 gate records, 27 remain identical after
excluding timing fields. Only the new gate and metric fingerprint change.
The fingerprint changes from `b7736da857812394` to `501fd242fda22ce3`.

These are exact paired accounting checks. They establish neither production
effects nor a statistically significant hiring improvement. Cost rates and
recruiter behavior remain modeling assumptions.

## safety_gates

All existing gate results retain their values. The pack's declared-minor,
unverified-employer and missing-pay-range counts remain zero. Its scam-employer
reach gate remains median 1, maximum 1, with one reached employer. The automated
impact ratio remains 0.96 pooled, with worst seed 0.84.

The existing conformance checks for minor exclusion, blocks, consent, leaks and
hard filters all pass. No threshold, safety filter or production code changes.

## Validation and limits

- `bun run typecheck`: exit 0 across all four configurations.
- `bun run test:integration`: 675 pass, 8 skip, 6 fail, 13,741 assertions across
  68 files, 553.69 seconds. All six failure names match the failures previously
  reproduced on the same base: Wrangler `/bin/bash` ENOENT, backend SIGTERM exit
  code 143 vs expected 0, and four site-build path assertions with Windows
  backslashes. These remain unresolved; integration is not green. The optional
  cleanup-reconciliation group requires `NETWORK_RETRY_RECONCILIATION_TEST` and
  accounts for the eight skips. The integration run includes the security file
  list; it is not repeated.
- `bun run test:e2e`: 42 pass, 1 skip, 0 fail, 654 assertions, 100.12 seconds.
  The optional browser-SDK case requires `PLAYWRIGHT_MODULE`.
- Isolated combination with #363's runtime fix at
  `481c47287f7230dee42e9e90d9fe03bc4b9a622e`: the same Peon command passes 28/28
  blocking gates. All 12 worlds reconcile: 6,965 reads, 3,600 reservations,
  6,096.5 hours. The fingerprint is `0fc35855626894ed`. This does not include
  #363's separate regression gate. This PR is based directly on main.
  Both PRs extend the same qualification loop; retain both gates when combining
  their test changes.
- The full default simulation is not repeated. AGENTS.md permits one full run
  per agent, already used in this contribution session. Only Peon-block results
  are claimed for this change.

To reproduce the defect, use this PR's `scripts/sim/peon.ts` with the base
version of `packages/sim/src/apps/peon/world.ts`. Run the command above and
expect the new gate to report four mismatched worlds. Restore the fixed runtime
and repeat; all 28 blocking gates pass, with no accounting discrepancy.

## llm_evidence

N/A: the change is deterministic simulator queue logic. It changes no prompt,
language-model judge, provider or member conversation. Real-model calls: 0;
cost: 0. No real-LLM qualification is claimed.

## agent_clients

Bun 1.4.2 on Windows x64, driven from Codex desktop 26.1029.7803.0. Authoring
provider: OpenAI; exact model identifier unavailable in this client. No
member-facing agent workflow changes. Other clients were not tested, and no
client compatibility claim is made. GitHub operations used the connector and
CLI, without computer use.

The implementation and report were authored with AI assistance. The real
repository harness generated the synthetic populations and measurements.
