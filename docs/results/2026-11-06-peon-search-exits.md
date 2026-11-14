# Peon search exits stop pending hiring activity

Date: 2026-11-06. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Scope: a reproduced simulator defect, under PRD 34.3 and 40.6/40.8 and the
approved Slop scope for simulation validation.

## Problem and cause

The hiring world's timing model says that candidates leave the search, including
when hired elsewhere. `state.exited` already removes them from snapshots and new
probes. Pending employer reviews, scheduled interviews and offer decisions only
checked platform hires, so they could continue after an outside exit. This gave
the platform credit for hires of candidates who had already left the search.

For example, in the pack arm at seed 13, `c-nyc-0204` received a platform hire at
week 2 and `c-sf-0201` at week 4 after entering `state.exited`. Exits skip anyone
already hired by the platform, so an intersection of these two sets proves that
the exit came first.

The fix checks search exits at each pending stage. Queued applications and
scheduled interviews cancel; an exited interviewee is removed before allocating
offers. These are withdrawals, not employer rejections, no-shows or unanswered
applications. Completed interviews and feedback from before an exit remain in
the record. Another eligible candidate can use an available offer or review slot.

Alternatives considered:

- Filter only offer recipients: this prevents false hires but still spends review
  and interview capacity on candidates who have left, and records false feedback.
- Clear every application when an exit happens: this requires distinguishing all
  completed and pending stages inside the exit loop. The existing stage guards
  already handle cancellations and keep completed history; extending them keeps
  the change local to the actions that must stop.

## measurement

One new blocking simulation gate observes the first weekly round in which each
candidate is already in `state.exited`. It delegates to the unchanged real
matcher, then counts reviews, interviews, offers and hires at or after that round.
The gate reuses the official worlds; it adds no mock matcher or extra world run.
It also requires exits to occur and the pack to make hires on every seed.

The same command ran with the gate added to the base runtime, then with the fix:

```sh
bun run sim --only peon --json /tmp/peon-search-exits.json
```

Settings: seeds 13, 14, 15, 16; eight weeks; 400 candidates and 80 jobs per city
(NYC and SF); REALISM_V2; pack, keyword and oracle arms. This is 12 worlds using
the same keyed random draws. The harness uses simulated people, employers,
screening and interviews. There are no live messages, model calls or real users.

| Observation across 12 worlds | Before | After |
| --- | ---: | ---: |
| Candidate exits observed before a subsequent round | 518 | 518 |
| Employer reviews after exit | 26 | 0 |
| Interviews after exit | 39 | 0 |
| Offers after exit | 21 | 0 |
| Platform hires after exit | 17 | 0 |
| Blocking gates | 27/28 | 28/28 |
| Runtime | 27.5 s | 27.4 s |

All 27 existing blocking gates passed before and after. Only the new gate failed
on the base runtime. There are 29 total gate records including the fingerprint:
23 are identical after excluding timing fields. The new gate, the fingerprint,
and four quality values change. No threshold changes.

| Existing quality gate value | Before | After |
| --- | --- | --- |
| Hires relative to keyword; intros relative to keyword | 1.05x; 0.10x | 1.05x; 0.10x |
| Hires relative to oracle | 0.91x | 0.90x |
| Interviews per hire relative to keyword | 0.75x | 0.74x |
| Retention difference from keyword | 1.8 pt | 1.9 pt |
| Under-applied hires relative to keyword | 1.04x | 1.00x |
| Gini of applications, pack vs keyword | 0.52 vs 0.53 | 0.52 vs 0.53 |

The metrics fingerprint changes from `b7736da857812394` to `b0fe163a5166da5f`.
These are deterministic correctness results, not an estimate of production
placement lift or statistical significance. Stopping invalid activity changes
capacity and later decisions, so total hires need not fall by exactly the count
of invalid hires removed.

An independent pack-only replay with the same settings gave:

| Seed | Total hires before / after | Hires after exit before / after |
| --- | --- | --- |
| 13 | 36 / 36 | 2 / 0 |
| 14 | 53 / 52 | 1 / 0 |
| 15 | 45 / 44 | 1 / 0 |
| 16 | 47 / 45 | 3 / 0 |

Control: seed 13, pack, same population and eight weeks, but REALISM_V2 timing
with `exitBase: 0, exitStrength: 0`. Before and after there are zero search exits
and 37 hires. SHA-256 of `JSON.stringify({flows: r.flows, hires: r.hires,
metrics: peonMetrics(r)})` is identical:
`4fc3a98c158ff18365e37aeeb6ea16a551d614a392726fa84e3b78e17c97fa8d`.

## safety_gates

All Peon safety values are unchanged: median scam-employer reach 1 (one employer,
max 1), minors matched 0, unverified-employer intros 0, and intros without a pay
range 0. Automated impact ratio remains 0.96 pooled, worst seed 0.84. Both
conformance sets pass: minors, blocks, consent, member-facing leak checks and hard
filters. Hidden-truth isolation, sealed-attribute invariance and the discriminatory
proxy negative control also pass. No safety or quality threshold is weakened.

## Validation

- `bun run sim --only peon --quick`: 21/21 blocking gates pass, seven tracked,
  two tracked quality misses, 6.2 seconds. The new exit gate stays blocking and
  passes with the shorter four-week, seed-13 run too. Qualification uses the full
  pinned Peon run above, whose quality gates all pass. Quick-only misses are
  hires vs keyword (0.80x) and the under-applied/Gini gate (hires 1.00x, Gini
  0.56 vs 0.53); no before/after quality claim is made for quick mode.
- `bun run typecheck`: exit 0 across all four TypeScript configurations.
- `bun run test:integration`: 675 pass, 8 skip, 6 fail, 13,741 assertions across
  68 files, 500.41 seconds. All six failure names match the previously reproduced
  failures on the same base revision and Windows/Bun environment: one Wrangler
  `/bin/bash` ENOENT, one backend SIGTERM exit-code expectation (143 vs 0), and
  four site-build path assertions using native Windows backslashes. These remain
  unresolved here; this is not a claim that integration is green. The eight skips
  are the optional PostgreSQL cleanup-reconciliation group, which requires
  `NETWORK_RETRY_RECONCILIATION_TEST`.
- `bun run test:e2e`: 42 pass, 1 skip, 0 fail, 654 assertions, 83.77 seconds.
  The optional browser-SDK case needs `PLAYWRIGHT_MODULE` and was skipped.
- `bun run security`: its complete file list is included in `test:integration`;
  it is not run a second time.
- The full default simulation was not repeated. AGENTS.md permits at most one
  full run per agent, already used in this contribution session. This head was
  validated with the affected `peon` block, not the full suite.

To reproduce the failing gate, keep this branch's `scripts/sim/peon.ts` while
using `packages/sim/src/apps/peon/world.ts` from the base commit. Run the command
above: only the new gate fails with the before counts. Restore the fixed world
and repeat: all 28 blocking gates pass and all four after-exit counts are zero.

## llm_evidence

N/A: the changed workflow is a deterministic, local hiring simulator. It does
not call a language model or change prompts, a provider, an agent conversation
or a judge. Real-model calls: 0; model cost: 0. No real-LLM result is claimed.

## agent_clients

Executed with Bun 1.4.2 on Windows x64 from Codex desktop 26.1029.7803.0.
Authoring provider: OpenAI; exact model identifier unavailable in this client.
No member-facing agent workflow changed. Claude Code, ChatGPT, Hermes Agent,
OpenClaw, Muse, Grok bot, elizaOS and Cursor were not tested; no client
compatibility result is claimed. GitHub access used the connector and CLI.

The implementation and report were authored with an AI assistant. Synthetic
populations and before/after measurements were generated by the repository's
real simulation harness. This fix does not qualify production hiring outcomes.
