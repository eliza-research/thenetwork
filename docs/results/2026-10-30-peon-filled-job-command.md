# Peon: recognize filled-job closure requests

Date: 2026-10-30 (Asia/Tokyo). Reproduced defect under the approved Slop scope.
Requirements: `docs/network.md` section 1.4, posting closure by confirmed text, within PRD 40.6's hiring flow.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. Fix and gate: `325775836e9242d2a1f493a42754cbf01178132f`.
Combined compatibility commit: `f5914929161f2e2ada97cc499fdb124f0b40773b` (local only, includes the preceding 44 contributions).

## Problem and fix

The `jobs.ts` intake documentation lists “we filled it” as a closure command.
The command recognizer instead requires “the”, “our” or “my” after “we filled”.
The real Network therefore gives no closure prompt for “We filled it.”, leaves the job active, and keeps its candidate match in review.
The existing “We filled the data analyst role.” control reaches confirmation and closes correctly.

The production change adds the complete short statement to the existing command recognizer.
It accepts casing, surrounding whitespace, and an optional period or exclamation mark.
The end-of-statement check keeps “We filled it out.” from being read as a job closure.
Only the existing commands with “the”, “our” or “my” search for a named job.
The short command names no job, even if a posting is titled “IT”. Several open jobs still require a choice.

The existing close flow still owns job selection, read-back, confirmation, persistence and ending pending matches.
A no drops the close draft. No active job produces the existing empty-list response.
No new state, copy, permission, dependency or schema is introduced.

Other implementations considered:

1. Accept any sentence containing “filled it”. That would include quotations, negative statements and references to filling out a form.
2. Close the only active job immediately. That bypasses the documented confirmation and creates a second persistence/cancellation path.

The selected change only opens the existing confirmed workflow for its documented short command.
It uses the existing generic text-close reason; it does not add a separate filled-status transition or infer an actual hire.

## measurement

One new gate uses seeds 1, 2 and 3 across nine scenarios, for 27 complete workflows.
The existing `SeatWorld` starts at 2026-10-05 17:00 UTC. Its default seed remains 7 for all existing gates.
Each new case onboards a verified adult manager and an adult candidate through the real text path.
The manager posts a level-2 data analyst job, two openings, $90k–$120k, hybrid in Brooklyn, with SQL required.
The candidate has the existing qualified data analyst profile. The real engine creates a match and sends it to human review.
The no-post case has no job. The choice cases also create a barista posting or a job titled “IT”.

The gate sends “We filled it.”, “WE FILLED IT!”, or a whitespace-padded “we filled it”, depending on seed.
It checks a yes, a no, both two-post choices, and the no-post response.
Controls use the named-job command, “We haven't filled it yet.”, “We filled it out.” and “My colleague said we filled it.”
JSON restarts occur before the command, before confirmation, after confirmation and after two more simulated days.
The choice cases also restart before the selection reply.

| Complete scenario | Before | After |
|---|---:|---:|
| confirm | 0/3 | 3/3 |
| decline | 0/3 | 3/3 |
| choose | 0/3 | 3/3 |
| choose-it | 0/3 | 3/3 |
| no-post | 0/3 | 3/3 |
| named | 3/3 | 3/3 |
| negated | 3/3 | 3/3 |
| form | 3/3 | 3/3 |
| quoted | 3/3 | 3/3 |
| Total | 12/27 | 27/27 |

| Result | Before | After |
|---|---:|---:|
| Closure confirmation reached | 3 | 15 |
| Confirmed job closures | 3 | 12 |
| Pending review items ended by those closures | 3 | 12 |
| Ambiguous command asks which job | 0/6 | 6/6 |
| No-post command returns the empty-list response | 0/3 | 3/3 |
| Hiring blocking gates | 36/37 | 37/37 |
| PostgreSQL safety gates | 17/17 | 17/17 |

Paired rows for seed 1, confirmed short command:

```jsonl
{"seed":1,"scenario":"confirm","confirmation":false,"which":false,"empty":false,"unchangedBeforeYes":true,"queued":1,"closed":false,"ended":0,"queuedAfter":1,"siblingOpen":true,"correct":false}
{"seed":1,"scenario":"confirm","confirmation":true,"which":false,"empty":false,"unchangedBeforeYes":true,"queued":1,"closed":true,"ended":1,"queuedAfter":0,"siblingOpen":true,"correct":true}
```

All 12 original control rows match exactly. Every case keeps the posting and pending item unchanged before the confirmation reply.
The three declines leave their jobs active. Choosing one job preserves the other job.
Confirmed closures remove all target review items, and none reappears during the next two days.
The new gate leaves candidate matches unapproved in review; it does not claim candidate outreach or accepted-intro cancellation evidence.

All 37 prior hiring records match before and after, excluding runtime. The pack/keyword/oracle fingerprint remains `b7736da857812394`.
Those existing worlds use seeds 13–16, eight weeks, 400 candidates and 80 jobs per city in NYC/SF, realism v2.
Their synthetic job seats bypass text intake. Their unchanged aggregate results prove compatibility, not an improved hiring rate.
Paired runs took 33.3s before and 33s after. These are deterministic workflow checks, not population estimates.

## safety_gates

All 17 safety records match before and after, including PostgreSQL cases. No expectation or safety threshold changed.
Ownership, age, opt-in, review, candidate consent, leak checks and posting validation keep their existing implementation.
Synthetic members, simulated review and locally recorded sends only. No real messages or deployment.

## Validation

Typecheck passes all four configurations before and after, and on the combined branch.
Combined hiring simulations pass 51/51 blocking gates. Their 27 new rows exactly match the standalone run.
All 51 records from the preceding combined hiring run (#212) remain identical, excluding time.
On the combined branch, the same guard wraps the earlier named-title helper from #150.
The simulation insertion conflict retained every previous gate plus the new gate.

Integration, including the security subset, on the combined branch with PostgreSQL 16.15:

```text
684 pass
8 skip
6 fail
14439 expect() calls
Ran 698 tests across 70 files. [510.20s]
```

The six failure names exactly match #221: Windows absolute `/bin/bash`, SIGTERM exit status, and four site path-separator comparisons.
The eight skips require the separate retry-reconciliation opt-in. Integration is not claimed green; hosted Linux CI is pending.

E2E ran afterward on the same combined branch:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [44.34s]
```

The optional browser case requires `PLAYWRIGHT_MODULE`. PostgreSQL suites ran sequentially on port 54339.

## Reproduce

```powershell
bun install --frozen-lockfile
bun run sim --only peon,peon-seats --json filled-job.json
bun run typecheck
# With the repository's dev PostgreSQL configured and running:
bun run sim --only safety --json safety.json
bun run test:integration
bun run test:e2e
```

Expect 37/37 hiring gates and 27/27 new rows. Apply only the simulation change to the base to reproduce 36/37 and 12/27.
The one-full-simulation-per-agent allowance was used for #136. This work reruns affected blocks and makes no new full-run claim.
Local artifacts: `work/filled-job-{before,after,combined,safety-before,safety-after}.json` and their logs.

## llm_evidence

Zero validation model calls and $0 model cost. This handled posting path uses rules only and does not read open-turn LLM output.
No model-backed behavior changed. Existing safety fixtures are not real-model evidence.

## agent_clients

No external-client acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes, OpenClaw, Muse, Grok bot, elizaOS or Cursor.
The actual Network runs in the recording harness; the service suites above provide separate evidence.
Authoring: installed Codex desktop 26.1023.6621.0 on Windows, OpenAI `gpt-6-astra` (operator-identified), client `codex`.

## Limits

The fix handles the documented complete short statement. It does not add general natural-language closure intent detection.
Question marks, added explanations and other paraphrases are not newly accepted. Existing named-post commands keep their behavior.
Closure still needs the manager's separate yes. Already completed introductions retain the existing behavior.
No UI or member-copy change. Draft pending maintainer review and hosted CI.
