# Slop population reuse preserves the starting state

## Requirement and cause

This fixes a reproduced simulator defect under the approved Slop contribution
scope and PRD 34.3's replay requirements. The simulator README promises seeded,
replayable runs. Supplying the same generated population and seed to successive
worlds should start those worlds from the same profiles.

`createSlopWorld` retained the caller's persona array and objects. When a real
Slop pack asked to widen a distance preference and the persona agreed, the
world changed `stated.maxMiles` and sometimes `stated.scope`. Those updates
escaped into the caller's population. A second run then started with wider
preferences, could produce different dates, and could even change a previously
returned world's profiles. Reusing the population for another matching arm
also changed that arm's starting conditions.

The factory now takes a deep copy of a supplied population. Internally
generated populations are already fresh and retain their existing path. Both
the synchronous and asynchronous runners use this factory. Widening still
updates the current world's profiles and affects subsequent weeks there.

Alternatives considered:

1. Copy only the array. That leaves persona objects and nested profiles shared,
   so the demonstrated mutation still escapes. A shallow profile copy would
   cover today's two assignments but leave other nested input state shared.
2. Restore the input after a run. That leaves simultaneous worlds sharing
   state, changes the returned world's profiles back, and complicates error
   handling. Ownership at world creation keeps the lifetime explicit.

The copy costs memory and time proportional to the supplied population. No
performance improvement is claimed. Personas are plain structured data; there
is no new dependency or public type change.

## measurement

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`. The same integration case runs
before and after the runtime fix:

```sh
bun test --conditions eliza-source --timeout 120000 packages/sim/test/slop-population.integration.test.ts
```

Seeds 1, 2 and 9, 70 personas per city, four weeks, default Slop engine options
and the world's normal radius-widening model. Each seed runs the actual engine
and Slop pack three times: the first run, a replay using the same input, and a
control using a pristine copy. A new matcher instance is created each time,
so exposure debt from a previous matcher cannot explain the difference.
Persona answers and widening agreements come from the normal seeded behavior;
none are forced or mocked.

| Observation over the three seeds | Before | After |
| --- | ---: | ---: |
| Input profiles changed by the first runs | 65 | 0 |
| Profiles widened within the first worlds | 65 | 65 |
| Replays identical to their first run | 0/3 | 3/3 |
| Pristine controls identical to their first run | 3/3 | 3/3 |
| Prior worlds unchanged after a replay | 2/3 | 3/3 |
| Integration case | 0 pass, 1 fail | 1 pass, 0 fail |

The case completes all nine worlds before asserting. It compares SHA-256
digests of flows, asks, metrics, final personas and the full network state,
including the contents of the paused set and learned-field maps. Both runs
execute ten assertions. Runtime: 3.24 seconds before and 3.34 seconds after.

A separate paired measurement confirms that each first-run flow/ask/metric
digest is identical before and after. The observed date counts illustrate
the replay error without claiming better matching:

| Seed | First-run dates, both revisions | Replay dates before | Replay dates after | Profiles widened in the first world |
| --- | ---: | ---: | ---: | ---: |
| 1 | 16 | 16 | 16 | 25 |
| 2 | 25 | 22 | 25 | 17 |
| 9 | 17 | 21 | 17 | 23 |

Equal date counts alone do not prove replay: seed 1's full trace differs on
the base even though it happens to retain 16 dates.

An additional paired probe uses seeds 3, 4, 10 and 11 with the same population
size and duration. Before, 87 input profiles change, all four engine replays
differ, and all four synchronous random-baseline runs on the reused population
differ from pristine-population controls. After, zero input profiles change
and all eight comparisons match. All four first-run engine digests remain
identical across the fix. With widening disabled, all four engine replay
controls already match and leave inputs unchanged on both revisions; their
digests also remain identical.

These are deterministic synthetic-world results, not production frequency
estimates or proof of a matching-quality improvement. The existing `runArm`
qualification creates fresh populations per arm; no prior qualification
score contamination is claimed.

## safety_gates

Same command and pinned configuration before and after:

```sh
bun run sim --only slop --json ../slop-replay-gates.json
```

Both runs pass **39/39 blocking gates** with eight tracked misses. All **57
gate records are identical after excluding execution-duration `ms` fields**.
The random/Slop fingerprint stays `445afd705328fe54`; the Slop live-workflow
fingerprint stays `eaeaf7bbe8c99c81`. Runtime: 32.5 seconds before, 34.0 after.

Declared-minor contacts, stated-filter violations, scammer median reach and
post-report repeat harassment remain zero. Relay leaks, contacts without
consent and relays to minors remain zero. The unchanged tracked misses cover
age-liar and adversary contact reductions, second-date rate and count, two
fairness ratios, reveal back-outs and four overlong probe texts. No threshold
or expected fingerprint was edited.

## Validation and limits

- Typecheck: all four configurations pass.
- Integration, including security: 676 passed, eight skipped and six failed;
  13,751 assertions across 69 files in 550.73 seconds. The six failure names
  match the clean-base Windows failures: Wrangler's `/bin/bash`, boot's
  SIGTERM exit status and four site-build path-separator checks. The eight
  skips require the optional cleanup-reconciliation flag. The suite is not green.
- E2E: 42 passed, one skipped and zero failed; 654 assertions in 72.93 seconds.
  The browser SDK recovery case is skipped without `PLAYWRIGHT_MODULE`.
- The full default simulation was not repeated. AGENTS.md allows one full
  run per agent, already used earlier in this contribution session. Only the
  affected Slop block is claimed for this revision.

Windows x64, Bun 1.4.2 and isolated PostgreSQL 16.15 on local port 54339.
Dependencies, hooks and lockfiles remain at the audited frozen install on
the base. Test processes have no provider keys or live-send/deploy flags.
No messages were sent to members and no production state was changed.

Reproduction: add the integration case to the base and run its command;
expect 65 changed input profiles and three unequal replays. Apply the factory
fix and repeat; expect zero changed input profiles, identical replays and
the same 65 within-world widening decisions. Run the Slop qualification,
typecheck, integration and E2E commands for broader checks.

## llm_evidence

Real-model calls: 0; cost: 0. This corrects ownership of deterministic
simulator input data. The real matcher and seeded persona behavior run;
no prompt, model-backed decision or generated voice changes. Real-LLM
qualification is not claimed.

## agent_clients

Codex desktop 26.1029.7803.0 drove Bun and GitHub through the connector and
CLI, without computer use. Authoring provider: OpenAI; exact model identifier:
unavailable. Claude Code/Claude, ChatGPT member flow, Hermes Agent, OpenClaw,
Muse, Grok bot, elizaOS and Cursor were not tested. Member-facing connectors
are unchanged; no untested-client result is claimed.
