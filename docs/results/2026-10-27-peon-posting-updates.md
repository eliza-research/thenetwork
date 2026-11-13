# Retain saved fields during partial Peon job updates

Updated: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Current code and regression: `7999271e8840de0e98d3c19829f2423f23d3b921`.
Local combined code: `46a37df5f9a6e33fc8af6692fbdf570c0d661eaa`.

## Requirement, problem and cause

Reproduced defect in the existing Peon posting workflow, under the approved Slop
scope and PRD section 40. A partial edit must preserve fields the manager did not change.

Originally, `Update my data analyst post: 3 openings` asked for an already-saved
salary. Required-field checks and the confirmation ran before the stored fields
were merged into the edit.

The earlier fix loaded those fields, but parsed the whole update command as new
metadata. Words in the selected title could overwrite the saved values:

| Saved title and field | Requested change | Incorrect result before this follow-up |
|---|---|---|
| principal data analyst, seniority 2 | 3 openings | Seniority becomes 5 |
| remote support engineer, onsite | 3 openings | Work mode becomes remote |
| hybrid systems engineer, onsite | 3 openings | Work mode becomes hybrid |
| brooklyn account manager, Queens | 3 openings | Location becomes Brooklyn |
| remote support engineer, hybrid | 3 openings, onsite in Queens | Explicit onsite edit loses to remote in the title |

These values reach both the saved posting and the engine's job seat after yes.
Cancellation keeps the stored post but can still show an incorrect confirmation.

## Fix and alternatives

Initialize the update draft from the selected saved posting using the existing
manager-scoped lookup. Apply the requested edits before checking missing fields
and constructing the confirmation. Further corrections keep the draft; selecting
a different posting starts from that posting's fields.

For an accepted update command, remove its existing command header before parsing
field changes. Keep the full message for selecting the posting. Creation and
ordinary correction replies keep their existing parsing path. No new grammar,
schema, dependency, message template or client contract is introduced.

Alternatives considered:

1. Put all fields in every `PostingRef`. The existing lookup needs only the
   selected post and preserves its manager scope.
2. Repair missing fields and confirmation in the caller. This duplicates decisions
   already made by the posting parser.
3. Suppress individual words such as `remote` or `principal` wherever they appear.
   That would also suppress explicit edits. The existing command boundary separates
   the identifier from the requested fields.

## measurement

One existing regression case was expanded; no second case was added for this
follow-up. It uses the actual signed webhook, NetworkService, staff posting routes,
PostgreSQL persistence and engine snapshot. Staff authorization is a fixture context,
not an authentication test. Members, phones and jobs are synthetic; sends use a dry-run adapter.

The original assertions remain: openings-only editing, salary correction, cancellation,
restart before confirmation, and a new post that still requires its own salary.
The added matrix has ten cases on seeds **7, 13 and 17**, for **30 workflows**.
It includes four title ambiguities, explicit seniority/mode/area edits, a generic
update command, cancellation, and an ordinary title control.

Each workflow creates a stored post through the staff route, restarts the service,
and submits an update through the signed webhook. It checks unchanged rows before
yes, restarts before yes/no, then restarts again and reads both the posting and job seat.
Saved metadata comparisons exclude revision timestamps; cancellation compares all original tags.

Before: previously published revision `474515a1bfc76b48fd97eb5e131110911f607f38`
with the expanded case. After: current code above. Same data, seeds and command:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source --timeout 120000 ./packages/network/test/peon-postings.integration.test.ts
```

| Observation | Before | After |
|---|---:|---:|
| Fully correct workflows | 12/30 | 30/30 |
| Incorrect confirmations | 15 | 0 |
| Incorrect saved postings | 15 | 0 |
| Incorrect engine seat metadata | 15 | 0 |
| Previously correct outcomes unchanged | 12 | 12 |
| Focused file | 1 pass, 1 fail | 2 pass, 0 fail |
| Assertions | 388 | 388 |

The confirmation and persistence failures overlap; their counts must not be added.
All 12 previously correct outcome records remain identical.

Actual terminal summaries:

```text
Before (exit 1):

 1 pass
 1 fail
 388 expect() calls
Ran 2 tests across 1 file. [28.90s]

After (exit 0):

 2 pass
 0 fail
 388 expect() calls
Ran 2 tests across 1 file. [26.76s]
```

Environment: Windows, Bun 1.4.2 (`744846f84`), TypeScript 5.9.3, and PostgreSQL
16.15, compiled by Visual C++ build 1944, 64-bit. The server version was read with
`SELECT version();`. Local port: 54339. The environment supplied `USER=postgres`,
`REQUIRE_PG=1`, `OBSERVATORY_PG_PORT=54339`, `OBSERVATORY_PG_DIR`, `PG_BIN_DIR`,
and PostgreSQL binaries on `PATH`. Run times are not performance claims.

**Database-free reproducer for this PR alone: none.** The unchanged simulations
below establish compatibility, not reproduction. PostgreSQL is required for this
regression; a skipped database test is not validation.

## Validation and safety_gates

Commands on the current code:

```sh
bun run typecheck
bun run sim --only network --only peon --only peon-seats --json results.json
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

- Four typecheck configurations pass, standalone and combined.
- Standalone simulation: **97/97 before and 97/97 after**, zero tracked
  misses, 283.2s and 302.3s. All **100 gate records** retain
  identical values, excluding runtime.
- Full integration, including all eleven security-script files: **676 pass,
  8 skip, 6 fail**, 14,097 assertions, 690 tests across 68 files, 525.46s.
- The six failures match the preceding baseline: absent absolute `/bin/bash`,
  SIGTERM exit 143 instead of 0, and four site path-separator assertions.
  The eight skips require the separate cleanup-reconciliation opt-in.
- E2E: **42 pass, 1 optional browser skip, 0 fail**, 654 assertions,
  43 tests across three files, 46.83s. `PLAYWRIGHT_MODULE` was not configured.
- Combined posting integration: **8 pass, 0 fail**, 690 assertions,
  37.50s. All 30 matrix outcome records match the standalone result.
- Combined simulation: **117/117**, zero tracked misses, 288.1s.
  All **120 prior gate records** retain their values. Reference artifacts:
  `availability-cues-combined` (Network), `closed-confirmation-combined` (Peon),
  and `group-absence-combined` (job seats).

Network retains seed 3 over ten days and consent/push comparisons on seeds 1-3
over 21 days. Peon retains seeds 13-16, eight weeks, 400 candidates and 80 jobs
per city, its pack/keyword/oracle arms and realism v2. Job seats use the existing
deterministic service world. Simulated reviews retain their existing configuration.
Consent, review, exclusions, caps and leak checks keep their prior values.
No posting changes before yes; no discards the draft.

The one-full-simulation allowance was used for #136. These are affected-block runs;
no fresh complete simulation run or Linux CI pass is claimed.

## Review history and merge coordination

The [previous review](https://github.com/eliza-research/thenetwork/pull/144#pullrequestreview-5679201189)
approved the earlier code reading and requested actual PostgreSQL output and a merge order.
That approval predates this code change. The current run output and reproduction
limits above replace the old 54-assertion evidence.

The [previous report](https://github.com/startrack3r/thenetwork/blob/474515a1bfc76b48fd97eb5e131110911f607f38/docs/results/2026-10-27-peon-posting-updates.md)
preserves the original main-versus-fix reproduction and earlier review response.
The initial defect changed from asking for stored pay to a complete confirmation.
Its original focused result was 1 pass/1 fail before, then 2 pass/0 fail after.

Suggested order for the original overlapping fixes: **#144, then #145, then #146**.
Rebase each later branch after its predecessor lands. Retain each regression case
and rerun the posting file and typecheck after resolving shared context.

The local combined application required a manual parser-context resolution with
#149 and #197. Their bare-title and posting-choice behavior was preserved alongside
this header change. The combined tests above passed after that resolution. This is
compatibility evidence, not a claim that every current branch merges automatically.
The combined branch is local only; no other PR was rebased or merged.

## llm_evidence and agent_clients

N/A for model-backed behavior: this changes deterministic draft parsing and persistence.
Zero validation model calls and $0 model cost. No agent-client acceptance run is
claimed for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw, Muse, Grok bot,
elizaOS or Cursor. The signed webhook/service workflow was exercised directly.

Authoring: Codex desktop, OpenAI / `gpt-6-astra`, identified by the operator.
The current desktop version was not collected. Frozen-lockfile dependencies were used.

## Limits

The draft represents the saved post at edit initiation plus requested changes.
This adds no concurrency control for simultaneous staff edits and migrates no old drafts.
The existing command grammar still defines which title/header forms are accepted.
No general natural-language title parser or historical metadata repair is added.
Linux CI must pass before merging.
