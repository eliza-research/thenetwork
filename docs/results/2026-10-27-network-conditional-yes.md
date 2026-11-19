# A conditional yes booked every time it left open

Date: 2026-10-27
Branch: `fix/consent-conditional-yes`, tree at `a0ed7bc` plus this change
Commands: run from the repo root with `bun` 1.4.2
Sample size: `evals/network/consent-replies.jsonl` 332 rows, `evals/network/consent-heldout.jsonl` 75 rows, `evals/replies.jsonl` 188 rows
Provider and model: none. `consentOf` and `parseProbeReply` are pure functions, and `bun run sim` is offline and deterministic by design. No request settings apply.

## Root cause

`consentOf` finds a yes word, then asks the shared reader (`core parseReply`, AGENTS decision 11) only one question: is the reply a refusal? A conditional yes is not a refusal. When the Network's own `COND_RX` does not see the condition, the reply stays a yes.

`COND_RX` (`packages/network/src/classify.ts:547`) lists the subjects that may follow "if": it's, they, the, you, I, that, someone, nobody, everyone and a few more. It does not list nouns such as "nothing", "work", "traffic", "parking", "things" or "weather". `core parseReply` uses a general "if" rule and returns `unsure` with reason `conditional_yes` for these replies.

`parseProbeReply` then reads the yes as a plain yes and picks every offered time the member did not refuse, or the named time. `onProbeAnswer` records the member as available and the plan can be set at a time the member only accepted under a condition.

## Before and after

Same options (`Thu 7pm` / a, `Sat 11am` / b, `Sun 2pm` / c):

| Reply | Before | After |
|---|---|---|
| `yes if nothing comes up` | `{"answer":"yes","keys":["a","b","c"],"why":"affirm"}` | `{"answer":"unclear","keys":[],"why":"conditional"}` |
| `yes if work allows` | `{"answer":"yes","keys":["a","b","c"],"why":"affirm"}` | `{"answer":"unclear","keys":[],"why":"conditional"}` |
| `Thursday works if work allows` | `{"answer":"yes","keys":["a"],"why":"affirm"}` | `{"answer":"unclear","keys":[],"why":"conditional"}` |
| `Sunday works if parking is free` | `{"answer":"yes","keys":["c"],"why":"affirm"}` | `{"answer":"unclear","keys":[],"why":"conditional"}` |

The fix is in `consentOf` (`packages/network/src/classify.ts:601`): the existing shared-reader check also treats core's `conditional_yes` reason as unclear. It is a veto, so the Network can never become more permissive than the shared reader. It also covers conditions that `COND_RX` does not list.

## Corpus scores

The ten new `consent-replies.jsonl` rows were added before the fix, so the gate fails first:

| Corpus | Before | After | Gate |
|---|---|---|---|
| `consent-replies.jsonl` | 322/332 (96.98%) | **332/332 (100.00%)** | >= 97%, 0 no/unclear read as yes |
| `consent-heldout.jsonl` | 75/75 | 75/75 | >= 97%, 0 no/unclear read as yes |
| `replies.jsonl` | 188/188 | 188/188 | every row read as labelled |

`bun run sim --only evals` on the tree before the code fix:

```
FAIL  consent replies consent-replies.jsonl: accuracy >= 97% (n 332): 97.0%
FAIL  consent replies consent-replies.jsonl: no refusal or hedge read as yes: yes if nothing comes up | yes if work allows | yes if traffic is ok | yes if parking is free | sure if things calm down
FAIL: 23/25 blocking gates, 0 tracked off target, 0.3s (evals 0.3s)
```

After the fix:

```
PASS  consent replies consent-replies.jsonl: accuracy >= 97% (n 332): 100.0%
PASS  consent replies consent-replies.jsonl: no refusal or hedge read as yes
PASS: 25/25 blocking gates, 0 tracked off target, 0.3s (evals 0.3s)
```

## sim and typecheck

`bun run sim --only network,slop` on this tree:

```
-- network: 61/61 blocking gates pass, 2 tracked
-- slop: 39/39 blocking gates pass, 18 tracked
PASS: 100/100 blocking gates, 8 tracked off target, 354.7s (network 297.1s, slop 57.6s)
```

`bun run typecheck`: exit 0, no compiler output.

`test:integration` and `test:e2e` were not run: both need a Postgres instance on `:54339`, which this environment does not have. They are not reported as passing.

## Rejected widening

Treating every reply that `core parseReply` reads as `unsure` as unclear. On the two consent corpora, 38 rows are a Network yes but a core unsure (`Thursday`, `up for it`, `I'm game`, `either thursday or sunday`, and others), and all are labelled yes. A wider veto would break those rows. The narrow `conditional_yes` veto leaves all 397 rows that were in the two corpora before this change unchanged.

## Risks and trade-offs

The veto reads `parseReply(body).reason`, a documented reason of the shared parser. If the reason name changes, the veto stops applying; the corpus rows above would then fail the gate, so the change is pinned.

Time conditions are not affected: `core parseReply` returns `yes_with_time_constraint` for "yes if it's after 7pm", not `conditional_yes`. The Network's own `COND_RX` asks again for that reply today; this change does not alter it.

## Follow-ups

- `COND_RX` still lists subjects. The `conditional_yes` veto now covers the missed ones, so the list is an extra guard, not the only guard.
- A conditional reply that contains no yes word (`Saturday if nothing comes up`) is already unclear because the Network finds no affirmation. No change is needed.

## Review patch: dependency words (2026-10-28)

Reviewer patch `013d745` (`fix/conditional-dependency-words`) extends `COND_RX` with `depending on`, `subject to`, `as soon as` and the guarded `when (…)` / `once (…)` forms, and pins six consent-replies rows. The corpus is now 338 rows. The table in "Corpus scores" keeps the numbers of the first fix (n 332); the dependency-word rows change the sample.

Measured on this branch (bun 1.4.2 (repo-pinned), Linux; `bun run sim --only evals` is offline):

Base `9c5b039` plus the six rows, before the `COND_RX` change:

```
PASS  consent replies consent-replies.jsonl: accuracy >= 97% (n 338): 98.2%
FAIL  consent replies consent-replies.jsonl: no refusal or hedge read as yes: yes when work allows | Thursday works when work allows | yes once I know my schedule | yes depending on work | yes subject to my shift
FAIL: 24/25 blocking gates, 0 tracked off target, 0.4s (evals 0.4s)
```

After the `COND_RX` change (this branch):

```
PASS  consent replies consent-replies.jsonl: accuracy >= 97% (n 338): 100.0%
PASS  consent replies consent-replies.jsonl: no refusal or hedge read as yes
PASS  consent replies consent-heldout.jsonl: accuracy >= 97% (n 75): 100.0%
PASS: 25/25 blocking gates, 0 tracked off target, 0.5s (evals 0.5s)
```

Direct calls on this branch, options Thu 7pm / a, Sat 11am / b, Sun 2pm / c: `yes when work allows`, `Thursday works when work allows`, `yes once I know my schedule`, `yes depending on work`, `yes subject to my shift` and `yes as soon as I know` all read `{"answer":"unclear","keys":[],"why":"conditional"}`. The controls are unchanged: `sure if that works for you` and `yes if you want` stay `unclear/conditional`; `yes` and `Thursday works` stay `yes/affirm` and book all open times; `when are you free?` stays `unclear/hedged`.

A known reader divergence stays out of scope here: `no, I can't say yes` gives core `no/refusal` and the Network `unclear/mixed`. The readers disagree, so the member is asked again; nothing is booked. This is the fail-safe direction.
