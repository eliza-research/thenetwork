# Preserve responses when a job application closes

A candidate says yes to a job introduction. The manager then declines or leaves
the delivered request unanswered. Both paths close the item with availability
states, but omit the actual replies from the interaction record. Peon cannot
count the application, distinguish an answer from silence, or update its existing
responsiveness estimate. A manager who declines also fails the existing
answered-application condition for company probation.

This fixes a reproduced defect under the approved scope and PRD 40.6. The job-seat
workflow is documented in `docs/network.md` 1.4. Peon's response-history contract
is in `profile.ts`; its existing probation and responsiveness rules are in
`selection.ts`. Those policies are unchanged.

The Network now saves actual job-probe answers separately from availability.
Only expiry of a sent probe records silence. Closure copies those answers into
`acceptedBy`, `declinedBy` and `noResponse`, restricted to the item's current
participants. An explicit refusal produces a declined interaction. The existing
seat view maps the manager ID to the job ID. JSON export/import already preserves
optional opportunity fields, so no database migration or state-version change
is required.

Inferring replies from `unavailable` would confuse refusal, silence, travel and
cancellation. Reconstructing them from logs would add a second history source.
Changing the engine's policy would leave its input incorrect. Retaining replies
where they happen fixes the producer and preserves the existing consumer.

## Revisions and setup

- Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
- Fix and gate: `bfa826cb9614f5a0b0a5daece204faae350dcaf0`.
- Local combined compatibility code: `4d2d2340029cfb5a07c4c06e107e8f2246b2b267`; never pushed.
- Native Windows, Bun 1.4.2, PostgreSQL 16.15; `bun install --frozen-lockfile`.
- Source checkout uses `core.autocrlf=false`.

## measurement

Same command before and after:

```sh
bun run sim --only peon,peon-seats --json result.json
```

For the before result, apply only the `scripts/sim/peon-seats.ts` diff from the
fix commit to the base. Keep production code at the base revision. The one new
gate uses seeds 1, 2 and 3 across seven scenarios. Existing SeatWorld callers
keep their default seed 7.

Each case onboards a verified adult manager and a qualified adult candidate
through real text. It confirms a one-opening posting, runs engine selection,
and applies human review. It then drives the actual reply, timeout or closure
path. A JSON restart occurs after the candidate's acceptance and again before
reading final history. Silence also survives restart before candidate timeout.
The recording channel and synthetic profile rows replace external delivery and
storage; consent, intake, review, persistence and engine history code are real.
No response history or trust decision is injected.

| Scenario (three seeds each) | Before | After |
|---|---|---|
| Candidate yes, manager no | No application or answer; responsiveness 0.8 | One application and answer; responsiveness 3/3.5; existing probation condition met |
| Candidate yes, manager silent | No application or silence; responsiveness 0.8 | One application and unanswered request; responsiveness 2/3.5; still on probation |
| Candidate no | Refusal absent | Candidate refusal retained; manager never contacted or counted |
| Candidate silent | Silence absent | Candidate timeout retained; manager never contacted or counted |
| Posting closed after candidate yes | Candidate acceptance absent | Acceptance retained; no invented manager reply or silence |
| Review rejected | No interaction or contact | Identical |
| Both say yes | Accepted introduction | Identical |

Correct cases improve **6/21 → 21/21**. These are deterministic regression cases,
not a population estimate or a measured hiring-quality gain. The accepted-intro
control advances to its recorded introduction time because future records do not
count as past history.

Every case checks one final interaction at most, restart stability, review before
contact, and mutual consent before reveal. Review rejection has zero interactions.
The six review-rejection and mutual-acceptance rows remain identical.

Standalone hiring improves **36/37 → 37/37** blocking gates. All 37 previous gate
records, excluding elapsed time, remain identical. The hiring-world fingerprint
stays `b7736da857812394`. The combined run passes **53/53** blocking gates. All 53
previous records from the #224 combined run remain identical. Its 21 new rows
match standalone. Existing Peon gates and the #224 slate/probation fix are retained.

## safety_gates

```sh
REQUIRE_PG=1 bun run sim --only safety --json safety.json
bun run typecheck
REQUIRE_PG=1 bun run test:integration
REQUIRE_PG=1 bun run test:e2e
```

Safety passes 17/17 before and after with identical records. All four final
typecheck configurations pass standalone and combined. Database suites run
sequentially on isolated port 54339, role `postgres`, with `PG_BIN_DIR`,
`OBSERVATORY_PG_DIR` and `OBSERVATORY_PG_PORT=54339` set.

Standalone integration, including the security subset:

```text
675 pass
8 skip
6 fail
13741 expect() calls
Ran 689 tests across 68 files. [497.98s]
```

The six existing Windows failures are the `/bin/bash` lookup, SIGTERM exit 143
instead of 0, and four site path comparisons. The latter are fixed separately by
#223, absent from this standalone branch. The eight skips are the opt-in cleanup
reconciliation cases and hooks. Full integration remains red.

Standalone E2E:

```text
42 pass
1 skip
0 fail
654 expect() calls
Ran 43 tests across 3 files. [36.76s]
```

The optional browser case requires `PLAYWRIGHT_MODULE`. Hosted CI still requires
maintainer approval for fork runs. No live sends, deployment, UI, copy, real member
data or dependency changes.

## llm_evidence

Deterministic response recording: zero validation model calls/$0. No model-backed
behavior is qualified by these results. The repository's one-full-simulation
allowance was used for #136; no new full simulation is claimed here.

## agent_clients

Authoring: Codex desktop, OpenAI `gpt-6-astra`; installed Windows app package
26.1023.6621.0, from package inventory rather than a running-executable claim.
The repository harness drives the actual workflow directly. No external-client
acceptance run is claimed for Claude Code, Codex/ChatGPT, Hermes Agent, OpenClaw,
Muse, Grok bot, an elizaOS agent or Cursor.

## Limits

Replies from before this field existed are not reconstructed, including replies
in older open items. Their ambiguous availability state cannot safely distinguish
actual replies from silence. New observed responses persist
in an optional opportunity field. Existing pending-application and check-in
history behavior is unchanged. Correct response history can affect later scores
and the existing probation condition; no quality gain or changed policy is claimed.
