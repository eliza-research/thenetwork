# LemmaScript integration: research and plan

Date: 2026-11-07. Toolchain: lemmascript 0.6.6 (Dafny backend), Dafny 4.11.0. Hand-written from the area reports in
docs/research/lemmascript/. No LLM calls. Machine-checked numbers come from `lsc check` runs.
Wave 2 results are at the end of this file.

## Result of the research

1. LemmaScript fits the decisions, not the service. Almost no safety decision can be proved in place: each one is in async SQL,
   in a class with Map state, or reads `unknown`. Small import-free decision functions, called by the shipping code, prove with
   little or no hand proof. The areas ran these as trials on copies: all but the deliberate negative controls verified.
2. A proof of a function has no value if a send path skips it. Text leaves through 5 seams (journeys.md). `dispatch` covers the
   queue only. Collected replies in signed turns skip consent, ban, cap and the live flags.
3. The review and the proof attempts found real defects (below). Three of the failed proofs were the shipped logic, not the spec.

## What LemmaScript does not cover

SQL (person_cap_take, per-line caps, row-level security, the advisory locks), concurrency, regex tables (keyword and phone
parsers), crypto, and the Eliza model reply, which is outside this repository. Numbers model as ideal reals, so NaN, Infinity and
rounding are outside the proofs. Those stay with integration tests, `evals/` corpora and `bun run sim`.

## Defects found

Severity is an estimate. "Reproduced" means a script ran. The others are from code reading.

| # | Severity | Where | Defect | Status |
|---|---|---|---|---|
| 1 | high | packages/platform/src/photos.ts:267 | A 24-byte WebP hangs `stripMetadata`: the length turns negative, the offset stops moving | reproduced |
| 2 | high | packages/network/src/classify.ts:666,719 | "rain check" and "maybe another day" parse as yes on a probe; a counter can book or reveal a match | reproduced |
| 3 | high | packages/platform/src/api.ts:462-494 | Site OTP start and verify have no ban check | reproduced |
| 4 | high | packages/platform/src/accounts.ts | A stated age is lost on two join exits: 15 then 25 gives lowest age 25 | reproduced |
| 5 | high | packages/network/src/relay.ts:292-299 | A number swap can go one way | logic proof fails |
| 6 | high | packages/platform/src/consent.ts:65 | `detectKeyword` misses "STOP NOW", "stop it", "stop pls" | reproduced at parser level |
| 7 | medium | packages/network/service/service.ts:1367 | After STOP, a join prompt is collected in a signed turn, with a duplicate id | reading |
| 8 | medium | packages/network/service/service.ts:1006 | A banned member still gets collected replies | reading |
| 9 | medium | packages/network/service/service.ts:1132 | A stale START from a non-member reports opted_in to the gateway | reading |
| 10 | medium | packages/engine/src/packs/slop/onboard.ts:93 | "right now i'm not sure" confirms the read-back | reproduced |
| 11 | medium | packages/engine/src/packs/slop/clef.ts:96,220 | A missing `gate.one_adult` answer passes the gate | reproduced |
| 12 | medium | packages/core/src/replies.ts | `parseReply` gives yes for "are you sure?", "yes?", "she said yes" | reproduced |
| 13 | medium | packages/core/src/guard.ts | `isPhone` lets "id 2125550102" pass the contact check on relay text | reproduced |
| 14 | medium | packages/network/src/network.ts | `decide()` has no deadline check: an expired item can be approved until the next tick | reading |
| 15 | medium | packages/engine/src/plans.ts:375 | One member can be an alternate in two plans of one run | reproduced |
| 16 | medium | packages/blooio/src/outbound-queue.ts:291 | One bad photo row stops the drain of the app | reading |

| 17 | medium | scripts/wrangler.sh | The deploy guard reads `--dry-run --dryRun=false` and `--help --no-help deploy` as read-only | fixed; reproduced on a copy with `exec` removed; audit gate added; wrangler was not run |
| 18 | medium | packages/observatory/src/server.ts:548 | An analyst gets member names through `events` | reading |

The area reports list the lower items. coverage-gaps.md shows the depth of review per file: some simulator and gate files were scanned, not read line by line.

## Founder or maintainer decisions

- Scope: PRD 28 and the MVP plan do not mention formal verification. CONTRIBUTING.md section 2 needs written scope confirmation.
- `replaceOrClose` probes an alternate with no new review.
- `transactional` sends (weekly check-in, reminders) are not on the person cap.
- The takeover notice can reach a number that sent STOP.
- A member with no `person_id` has no person cap.
- Line review also holds STOP confirmations.
- biasMonitor compares with the overall rate, not the best group.

## Plan for wave 2

Each area gets one owner and one set of files. Decisions move to import-free cores that the shipping code calls.
`bun run sim --only formal` runs every proof and fails on a file with `//@ verify` that is not listed, a listed file that no
non-test code imports, or a growth in assume, havoc, extern or axiom counts.
