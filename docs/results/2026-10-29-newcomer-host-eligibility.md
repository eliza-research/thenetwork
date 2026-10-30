# Newcomer welcomes need an eligible host

## Requirement and cause

PRD 28.3 includes newcomer welcomes. PRD 33.4 requires a host for the welcome group.

The composer counted a host tag as host coverage, even when that member could not take the host role.
The newcomer generator then discarded the winning group because it had no assigned host.
Another group with an eligible host could lose before that final check.

## Reproduction

Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.

One hand-written scenario uses four synthetic adults, two past help interactions, and seed 7.
The newcomer and guest can meet either host. The hosts are in town on different days.
The stronger match has reached the default contribution limit. The other host is eligible.
Only the newcomer-welcome generator runs. Scoring, budgets, thresholds, and safety settings keep their defaults.
The engine uses its deterministic local hashing embedding. No LLM or mock model is supplied.

| Same engine scenario | Before | After |
|---|---|---|
| Both hosts present | No candidate or proposal | One welcome with the eligible host |
| Unavailable host removed (control) | One welcome with the eligible host | Same welcome |
| Contribution limit | Respected | Respected |

The regression gate in `scripts/sim/network.ts` checks the complete engine output against the positive control.
It fails before the production fix and passes after it.
This is a deterministic counterexample, not an estimate of population-wide quality or recall.

## Fix and alternatives

Host coverage now uses the existing host-role eligibility check, as role assignment already does.
The composer can therefore select the group whose host can actually serve.

Two alternatives were rejected:

1. Remove the unavailable host from the whole pool. That would also remove a valid guest.
2. Retry composition after the newcomer generator rejects the winner. That repeats the search and leaves the scoring inconsistency elsewhere.

## Reproduce the gate

Run `bun run sim --only network`.
The gate is `newcomer welcome: an unavailable host does not hide an eligible host`.
Restore only `packages/engine/src/group.ts` from the base commit and rerun to see the failure.
The original result is an empty proposal list; the expected result contains the newcomer, guest, and eligible host.

## Validation and limits

- The isolated regression gate failed before the fix and passed after it with the same input and seed.
- Type checking passed after the fix.
- `bun run sim --json ../slop-apollo-preflight/host-full-sim.json`: 306/306 blocking gates pass, 20 tracked off target, 510 seconds.
- The network block passes 62/62 blocking gates, including the new gate. Unchanged main passed its original 61/61 gates.
- Seed 3's invariant-run fingerprint remains `24bb81f068060b33` before and after. Reported consent metrics remain 0.847 everyone-yes, 0.919 invite-yes, and 144 pooled meetings.
- The consent-arm fingerprint changed from `361f8cc2648fb9a6` to `cf66385a85b8ff71`. These results do not claim identical outputs everywhere.
- `bun run test:integration` with normal host access: 364 pass, 252 skip, 23 fail, 7,108 assertions, 169.91 seconds.
  The failures are missing-`initdb` setup failures and follow-on cleanup errors. The initial sandbox attempt also failed to bind local HTTP listeners.
- `bun run test:e2e`: zero pass, 47 skip, zero fail. Every case skipped; this is not end-to-end validation.
- PostgreSQL 16 is unavailable in this environment. Database-backed checks cannot be treated as passing if skipped or blocked.
- No real-model run was made. The changed path is deterministic group composition and does not invoke a model.
- No agent-client flow changed or was tested. No MCP schema, onboarding prompt, consent flow, or member-facing text changed.
- This also corrects the host-coverage score of optional-host groups. Full pack conformance checks cover those callers.
- No live messages, deployments, or real member data were used.

## Authoring disclosure

The operator reported the task's model selector as "Sol 6.1".
OpenAI's model documentation maps "6.1 Sol" to `gpt-6.1-sol`: <https://learn.chatgpt.com/docs/models>.
The declared authoring provider is OpenAI and the client is Codex.
This is operator-reported selection, not independent runtime attestation or real-model test evidence.
