# Match valid Peon postings without mandatory skill lists

Date: 2026-10-29. Base: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`.
Tested code: `dd4e8d5dc43b7993b7954289718361eff3512f04`.

## Requirement and defect

Reproduced bug under the approved contribution scope and PRD 40.6's Peon intro workflow.
The existing posting intake requires a title and pay range; a mandatory skill list is optional
(`jobs.ts` `missing`, `postingFromDraft`, and `postingProblem`). Other matching requirements
such as role level, employer verification, location and pay still apply.

A manager can confirm a valid data analyst post with no required skills, or only a nice-to-have
skill. The post is saved, but no candidate reaches review. `pairScore` assigns an unspecified
must-have list a conservative 0.5 coverage prior. `pairTable` compares that prior with the 0.55
requirement cutoff and discards every pair. Both retrieval directions share this table.

Apply the cutoff only when the job states a nonempty required-skill list. Keep the 0.5 scoring
prior, all scoring weights, the 0.55 cutoff for stated requirements, and every existing filter.
This does not claim a candidate meets a skill the employer did not ask for.

Alternatives considered:
1. Require skills during intake: that changes the existing accepted posting contract and adds a
   new required field, rather than fixing matching for posts already accepted as valid.
2. Assign empty lists perfect coverage: that raises their employer-side score without additional
   skill evidence. Keeping the current prior avoids that scoring change.
3. Lower the global cutoff: that would also admit pairs which fail stated requirements.

## measurement

One gate drives 18 real backend posting workflows: six cases on seeds 7, 13 and 17. It uses
`SeatWorld`, production Peon wiring, the real text intake, confirmed posting rows, `peonSeats`,
the engine's review queue, human review, candidate-first consent, manager consent and the actual
intro messages. Fictional adults and their stated SQL skill, location and pay preferences are
hand-authored fixtures. No engine result, posting parser response or interaction is mocked.

Each posting is read back and saved only after yes. A JSON restart follows the save, and another
restart occurs between the two yeses when a match proceeds. Snapshot rows stay in the fixture;
this is not a new Postgres persistence test. No message about an opportunity goes out before
staff review. The manager gets no probe before the candidate says yes, and the intro waits for
the manager's separate yes.

| Posting case (three seeds each) | Review / intro before | Review / intro after |
|---|---:|---:|
| No required skills | 0/3 | 3/3 |
| Only optional SQL | 0/3 | 3/3 |
| Required SQL satisfied | 3/3 | 3/3 |
| Required Rust level 5 missing | 0/3 | 0/3 |
| No required skills, pay below candidate floor | 0/3 | 0/3 |
| No required skills, unverified employer | 0/3 | 0/3 |

Six previously blocked valid posts reach a consented intro. The three positive controls and all
nine exclusion controls keep their behavior. These are deterministic workflow outcomes, not a
statistical hiring-rate estimate or a claim of an interview, offer or hire actually occurring.

Paired command: `bun run sim --only peon,peon-seats --json <file>`.
Blocking gates: **36/37 -> 37/37**. Runtime: 36.1s -> 37.5s.
All 37 other result records are identical after excluding runtime, including the
Peon-world fingerprint `b7736da857812394`. The existing pinned simulation's quality and fairness
measurements do not move; the added real workflow isolates the missing-requirements case.

Combined locally with the preceding 25 contributions: **42/42** blocking gates
in 39.2s, zero tracked misses. All 38 shared records match the isolated fix,
and all earlier combined Peon records remain identical. The only merge conflict was adjacent gate
insertions; prior gates and the seedable fixture constructor are preserved. Combined branch not pushed.

## safety_gates

All pre-existing gate values stay unchanged: no minor or held candidate in seat items; no
unverified employer or payless role reaching candidates; candidate-first consent and human review;
no protected/proxy mentions; capacity, fairness and the current-employer exclusion rules.
The new path retains unmet-required-skill, low-pay and unverified-employer controls. No scoring
parameter, threshold, model prompt, client contract or member-facing copy changes.

## Reproduction and validation

1. At base `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`, copy only `scripts/sim/peon-seats.ts`
   from `dd4e8d5dc43b7993b7954289718361eff3512f04`. Use `bun install --frozen-lockfile` and run
   the paired command. Expect only the new gate to fail, with six valid posts never reviewed.
2. Load the production fix from that code commit and repeat. Expect all 37 blocking gates to pass,
   six restored intros, and unchanged controls and other measurements.
3. Run `bun run typecheck`, `bun run test:integration` and `bun run test:e2e`.

Bun 1.4.2, Windows, PostgreSQL 16.15 on local port 54339, `USER=postgres`, `REQUIRE_PG=1`.
Frozen dependencies unchanged. All four typechecks pass on isolated and combined branches.

- Integration including all 11 security files: **675 pass, 8 skip, 6 fail**, 13,741 assertions;
  481.60s. The failure identities match the existing Windows baseline: missing absolute
  `/bin/bash`, SIGTERM 143 versus 0, and four Unix path-separator assertions. Not claimed green.
- Eight skips require the retry-reconciliation opt-in `NETWORK_RETRY_RECONCILIATION_TEST=1`.
- E2E: **42 pass, 1 skip, 0 fail**, 654 assertions; 43.02s. The optional browser check needs
  `PLAYWRIGHT_MODULE`, which was not configured.

The one full-simulation allowance was used earlier; only affected blocks ran here. Draft pending
maintainer review and hosted CI. No live messages, production data, deployment or new dependency.

## llm_evidence and agent_clients

Zero validation model calls, no request settings, $0. This changes deterministic retrieval.
No model-quality or optional-judge acceptance result is claimed. Backend conversations and the
matching engine were exercised directly; no external-client acceptance claim. Authoring: Codex
desktop, OpenAI `gpt-6-astra` (operator supplied); app version not collected.

## Limits

Empty requirements retain the existing 0.5 prior; they do not become perfect skill matches.
All other eligibility criteria and final scoring still apply, so an empty list does not guarantee
an intro for every posting or candidate. The existing empty checklist copy is unchanged. This
does not add a new field or infer unstated requirements, and does not prove real hiring quality.
