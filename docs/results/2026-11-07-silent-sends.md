# Stop automatic sends after scenario silence — 2026-11-07

## Problem and scope

`go_silent` marks a persona as no longer replying, but two automatic send paths ignored that state.
An already queued reply still reached the Network after the silence action.
The morning flake check could also send a cancellation notice directly, bypassing the persona agent's silence check.

This is a reproduced simulator defect under the approved project scope.
PRD 34.3 explicitly requires a scenario where a member stops replying.
`PersonaMemory.silentFrom` documents that replies stop from its timestamp onward.
Unsent replies matter because an inbound message resets the Network's unanswered-message history.

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, current main.
Runtime: Bun 1.4.2 on Windows, with PostgreSQL 16.15 for service checks.
Dependencies use the unchanged frozen lockfile.

## Cause and fix

The policy agent checks silence when choosing a response.
That decision can precede the eventual `persona_send` event by hours.
The event handler did not recheck silence before dispatch.
The automatic flake handler called `personaSend` directly without checking silence.

Recheck `silentFrom` at both automatic send points, before any message or cancellation-notice side effect.
Leave `personaSend` itself unchanged so explicit script actions retain their existing behavior.
The policy agent already suppresses new initiatives and responses after silence; these checks cover the two bypasses.

Other implementations considered:

1. Remove queued sends when `go_silent` runs. That needs a scheduler cancellation operation and still leaves the later flake handler.
2. Add the check inside `personaSend`. That also blocks explicit scenario messages and needs bypass arguments at those call sites.

The chosen change adds no scheduler API, dependency, runtime field or model behavior.

## measurement

The committed integration case runs fifteen complete worlds using the existing scenario fixtures and built-in policy personas.
It does not fabricate messages, decisions, bookings, outcomes or clocks.
It checks the actual resolved silence-action time, rather than inferring silence from the end-of-run grade.

### Queued replies

Use `member-goes-silent.json` with world seeds 8, 14 and 30.
For each seed, run three modes:

- Normal: remove the silence action.
- Silent: retain the fixture's day-one, noon silence action.
- Explicit: retain silence and add one `say` action at day two, noon.

The third mode sends `This is my one scripted update.`
It proves that an explicit script message still reaches the Network after automatic communication stops.

On base, each silent or explicit world sends a previously queued reply after silence starts.
The replies arrive 18.73, 29.72 and 462.27 minutes after silence for seeds 8, 14 and 30 respectively.
All three decisions were made before the silence action.
After the fix, none of those automatic replies sends.
All three explicit updates still arrive, and the three normal controls continue communicating.

### Automatic flake notices

Use `group-flake-morning-of.json` with seeds 1, 3 and 10.
Remove its forced-flake action and set `dinner-4`'s flakiness to one.
Keep the other personas and their normal decisions.
Compare a normal run with one that makes `dinner-4` silent at day two, noon.

On base, all three silent worlds still send an automatic morning cancellation notice.
After the fix, they send none and no longer mark that absence as cancelled with notice.
The three normal controls still send their notices.

Together, nine worlds stop their incorrect automatic send and six normal controls preserve their behavior.
All fifteen personas speak before the cutoff, so the test cannot pass by preventing initial participation.

Same command and unchanged case before and after:

```text
bun test --conditions eliza-source packages/sim/test/silent-sends.integration.test.ts

Before: 0 pass, 1 fail, 1 assertion; case 171.63 ms, command 219 ms
After:  1 pass, 0 fail, 1 assertion; case 165.89 ms, command 213 ms
```

The one assertion compares all fifteen completed workflows.
The timings describe these runs; no performance improvement is claimed.

### Wider corpus

Use world seeds 1–80, then additional seeds 81–120.
The StubNetwork keeps its default seed zero throughout.
Random introductions are enabled for the reply fixture and disabled for the dinner fixtures.

For each seed, run these seven worlds:

- Reply fixture: normal, silent and explicit modes above.
- Natural-flake fixture: normal and silent modes above.
- Forced-flake fixture: keep the original dinner fixture's notice action; compare normal and day-two silence modes.

This gives 840 worlds per revision.
The synthetic fixtures are repository-authored; these transformations and comparison scripts were written for this reproduction.

| Corpus | Worlds | Normal controls | Worlds with silence | Incorrect automatic messages before → after | Explicit updates before → after | Unchanged silent worlds |
|---|---:|---:|---:|---:|---:|---:|
| Seeds 1–80 | 560 | 240 | 320 | 142 → 0 | 80 → 80 | 178 |
| Seeds 81–120 | 280 | 120 | 160 | 70 → 0 | 40 → 40 | 90 |
| Total | 840 | 360 | 480 | 212 → 0 | 120 → 120 | 268 |

By fixture family, the removed messages are 44 in reply worlds, 48 in natural-flake worlds and 120 in forced-flake worlds.
There are 212 affected worlds, each with one incorrect automatic message on base.
All 360 normal controls retain identical complete run records and metrics.
The other 268 silent worlds also retain identical records and metrics.
All 840 worlds retain identical records before the silence cutoff.
Record comparison uses SHA-256 digests and excludes only `run_end.wallMs`.

This is a behavior correction, so affected worlds' later records and metrics can change.
Across silent arms, held meetings move from 315 to 318; seventeen individual worlds have a different held count.
Those changes are confined to the reply fixture, where suppressing an inbound response changes later Network decisions.
Recorded cancellation notices for the silent target move from 167 to zero.
These numbers are not evidence of improved matching or live-member outcomes.

All 480 silent arms have zero invariant violations before and after.
The normal reply controls retain three existing `decliner_exposed` violations: two in seed 17 and one in seed 59.
Their entire records and metrics remain identical; this fix does not resolve those baseline control misses.

## safety_gates

Qualification command:

```text
bun run sim --only network,slop,safety,audit --json <output>
```

Base: 133/133 blocking gates, eight tracked misses, 255.7 seconds.
Fix: 133/133 blocking gates, eight tracked misses, 216.8 seconds.
All 153 gate records match exactly after excluding elapsed time, including all fingerprints and safety values.
No threshold, expected fingerprint or oracle parameter changes.

The baseline qualification reuses the recorded PR #376 validation on the same clean main revision and setup.
The base source and independent dependency checkout were verified before reuse.
The new regression and all 840 baseline worlds ran specifically for this fix.

The full simulation is not repeated: AGENTS.md permits one full run per agent, already used on PR #355.
That earlier full run is not evidence for this revision.
The qualification uses automatic simulation reviewers with live-send and deployment flags disabled.

## Service validation

Type checking passes all four configurations.

```text
bun run test:integration
676 pass, 8 skip, 6 fail; 13,742 assertions; 552.13 seconds

bun run test:e2e
42 pass, 1 skip, 0 fail; 654 assertions; 67.31 seconds
```

The regression passed within the official integration command in 146.07 ms.
The integration command includes the security suite.
All six failures match the recorded base failures by test name and underlying error:

- The Wrangler shell test cannot spawn `/bin/bash` on this Windows setup.
- The boot test receives SIGTERM exit 143 instead of zero.
- Four site-build assertions expect slash-separated paths instead of Windows paths.

Eight optional completed-cleanup reconciliation cases were skipped.
The optional browser SDK case was skipped because `PLAYWRIGHT_MODULE` was not configured.
No computer controls were used.
The isolated PostgreSQL server was stopped after all runs completed and its client count reached zero.
A fully green integration suite is not claimed.

## Related work

PR #367 records cancellation notices when they are actually sent, rather than when a reply is queued.
That is separate from deciding whether a queued reply may send after silence starts.
This branch starts from main and does not duplicate or stack that change.

A temporary combination with #367 at `9a29ff462c301e1dc5296c23787800b0d1a12417` passed both regression cases.
Result: two passes, zero failures, 44 assertions in 274 ms.
The shared queued-send handler needed manual reconciliation, retaining both the silence guard and notice metadata.
The temporary worktree was restored; broader combined qualification is not claimed.

## llm_evidence

N/A: deterministic event dispatch with built-in policy personas.
Real-model calls: zero. Cost: $0.
No prompt or model-backed behavior changes.

## agent_clients

N/A: simulator internals, with no changed member-facing agent protocol.
Codex desktop 26.1029.7803.0 drove Bun 1.4.2.
Authoring provider: OpenAI; the exact model identifier was unavailable.
No other agent client, browser or computer control was used.

## How to test

1. Run the integration case above. Expect one passing case over fifteen worlds.
2. Copy it unchanged to base and repeat. Expect nine worlds to send after silence, including three incorrect cancellation notices.
3. Run qualification and compare every gate record, excluding elapsed time.
4. For the wider corpus, run the seven fixture modes on the seed ranges above and compare records before each silence cutoff.

## Risks and limits

Removing an incorrect inbound message changes unanswered-message tracking and later opportunities in affected scenarios.
This is intentional; the recorded behavior must match the scenario's silence instruction.
Explicit script actions retain their existing send path and can deliberately send after silence.
Earlier cancellation-notice accounting remains the separate scope of PR #367.
Saved runs are not rewritten automatically; rerun them for corrected behavior.

There is no UI, message-copy, dependency, live-send or production-service change.
Only synthetic repository personas were used; raw messages, logs, credentials and member data are not committed.
