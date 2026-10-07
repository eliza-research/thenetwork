# Contributing to The Network

Read this document before you open an issue or a pull request (PR). Maintainers close issues and PRs that do not obey these rules. Contributors who send busywork lose standing.

## 1. The scope rule

The scope of this repository is the MVP. Two documents define the MVP:

- The PRD: [Google Doc (canonical)](https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit), with a local copy in [docs/prd-snapshot.md](docs/prd-snapshot.md). Section 28 is the MVP definition. Section 29 lists the MVP flows. Section 37 is the build plan.
- The prototype and test plans: [docs/prototypes.md](docs/prototypes.md) and [docs/test-plan.md](docs/test-plan.md).

If a capability is not in PRD Section 28.3, it is not in the MVP. PRD Section 28.4 lists capabilities that are explicitly not in the MVP. Do not build them.

**New features need human approval first.** Maintainers discuss a new feature with the founders. If they agree, they add it to the PRD and to the MVP plan. Only after that can a contributor build it. An issue or PR cannot add a feature by itself.

## 2. Issues

### 2.1 What an issue must be

An issue must identify one of these:

1. **A bug.** Something is broken. You can show the steps that cause it and the incorrect result.
2. **An MVP gap.** The PRD or the MVP plan says that the MVP must do something, and the code does not do it, or does it incorrectly. Give the PRD section number.
3. **A measured problem.** A score that matters is below its target, and you know a probable cause. Examples of scores: precision against the oracle, worthwhile-interruption rate, canary leaks, invariant violations, eval accuracy (see section 5).

### 2.2 What an issue must not be

Maintainers close these issues without discussion:

- Features that are not in the MVP, or that PRD Section 28.4 excludes.
- Pedantic issues: style preferences, naming opinions, comment wording, file order.
- Requests for more unit tests, more coverage, or tests that do not test real behavior.
- Requests for defensive code, extra validation, extra null checks, input truncation, or error handling for conditions that cannot occur.
- Refactors with no measured result and no bug.
- Duplicates of an open issue. Search first.
- Vague issues ("improve matching", "make it faster") with no evidence.

### 2.3 Issue template

```markdown
## Type
Bug | MVP gap | Measured problem

## Summary
One or two sentences. Say what is incorrect. Say who it affects.

## PRD reference
Section number(s) that require the correct behavior. Example: PRD 32.9, PRD 28.5.

## Steps to see the problem
1. Do this.
2. Do this.
3. Look at this result.

## Actual result
What happens now. Include the command output, the score, or a screenshot.

## Expected result
What must happen. Use the PRD text or a target number.

## Evidence
Logs, run IDs, report paths, or numbers. Give the seed and the command so that a maintainer can do it again.
```

## 3. Pull requests

### 3.1 A PR must show a meaningful improvement

Each PR must show one of these, with evidence:

- **A fix.** Something was definitely broken. The PR shows it broken before the change and working after the change.
- **A better score.** A score that matters goes up (or a bad score goes down). Show the number before and after, with the same seed, data, and command. Give the sample size. When the change is small, give a confidence interval or a significance test. The reports in [docs/results/](docs/results/) show the standard.
- **A new MVP capability.** The PRD MVP requires it, and the code did not have it.

A PR with no evidence of improvement will be closed.

### 3.2 A PR must make the code smaller or simpler where it can

Each PR must:

- Use the code that exists. Look for an existing type, function, or module before you write a new one.
- Remove code that is not necessary. Remove dead code, duplicated logic, and unused options.
- Consolidate. If two types or two functions do the same thing, make them one.
- Add a new type, file, or package only when it is necessary. Explain why the existing code cannot do the job.
- Not add a dependency unless it is necessary. Explain why.

A good PR often removes more lines than it adds.

### 3.3 A PR must defend its design

In the PR description:

1. Explain the problem and the cause.
2. Describe at least two other possible implementations.
3. Explain why your implementation is better than each of them. Give the trade-offs.
4. Give the research that supports the decision: PRD sections, docs in [docs/research/](docs/research/), earlier results, or external sources.

### 3.4 A PR must show end-to-end test validation

We want tests that run the real system. We do not want unit tests that only test mocks, or tests that pass when the feature is broken.

- Run an end-to-end check that uses the real code path. Use one or more of these:
  - A simulated world: `bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/engines/engine-v1.ts`
  - A scenario with pass^k: `bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/<name>.json --k 4`
  - The model evals: `bun run packages/evals/src/cli.ts --suite recommender,judge` or `--suite passes`
  - The Observatory, for UI and data changes: `bun run observatory`
- Paste the result into the PR: the command, the seed, and the output numbers. Show the result before and after the change.
- If you fix a bug, add one test or one scenario that fails before the fix and passes after it. That is enough. Do not add more.
- Run `bun run test` and `bun run typecheck`. Both must pass. If a test fails for a reason that is not related to your change, say so in the PR.

Do not add these tests:

- Tests that only check that a mock was called.
- Tests that repeat the implementation.
- Tests for getters, constants, or types.
- Tests for conditions that cannot occur.

### 3.5 PRs that change the UI

A PR that changes a user interface (the Observatory, the admin console, the member web pages, or any message copy that a member sees) must also include:

- **A walkthrough video.** Explain what changed and why. Show the change in use. Upload it to the PR.
- **Video evidence.** Show the behavior before and after the change.
- **A detailed how-to-test.** Give each step that a reviewer must do to see the change. Start from a clean checkout. Include the commands, the URL, and what to click.

### 3.6 PR template

```markdown
## Summary
One or two sentences. Say what this PR changes. Say why.

## Type
Fix | Score improvement | MVP capability

## PRD reference
Section number(s). Example: PRD 33.6.

## Problem and cause
What was incorrect. Why it was incorrect.

## Evidence of improvement
| Metric | Before | After | Command and seed |
|---|---|---|---|
| | | | |

## Other implementations considered
1. Option A: what it is. Why we did not use it.
2. Option B: what it is. Why we did not use it.

## Why this implementation is correct
The trade-offs. The research or PRD text that supports it.

## Simplification
Lines added and removed. Types, functions, or files that this PR removes or merges. New types or files, and why each one is necessary.

## End-to-end validation
The commands you ran and their output. `bun run test` and `bun run typecheck` results.

## How to test (UI changes: required)
1. Step.
2. Step.

## Videos (UI changes: required)
Walkthrough: <link>
Before and after: <link>
```

## 4. Write in ASD-STE100 Simplified Technical English

All issues and PRs must be in ASD-STE100 Simplified Technical English. A person who is not technical must be able to read and understand them. Use these rules:

- **Short sentences.** Use a maximum of 20 words in an instruction. Use a maximum of 25 words in a description.
- **One instruction in one sentence.** Write "Run the tests. Then open the report." Do not write "Run the tests and then open the report and check the score."
- **Use the active voice.** Write "The engine skips the proposal." Do not write "The proposal is skipped by the engine."
- **Use the imperative for steps.** Write "Open the Observatory." Do not write "You should open the Observatory."
- **Use simple tenses.** Use the simple present, the simple past, and the simple future.
- **Use one word for one meaning.** If you write "proposal", do not also write "suggestion" or "match" for the same thing. Use the terms in the PRD.
- **Short paragraphs.** Use a maximum of six sentences in a paragraph. Write about one topic in each paragraph.
- **Explain technical words.** If you must use a technical term, explain it the first time. Example: "the oracle (the simulator's hidden answer key)".
- **Give the warning first.** Put a warning or a caution before the step that it applies to.
- **Use lists and tables** for steps, options, and numbers.

Example:

> Bad: "It was observed that a significant fraction of proposals end up getting dropped at dispatch time owing to double-booking conflicts."
>
> Good: "The engine makes too many proposals for the same member. The dispatcher then skips 39% of them, because the member is already booked."

## 5. Scores that matter

These numbers measure real progress. A change to them is evidence. A change to line coverage or test count is not evidence.

| Score | Where it comes from | Target |
|---|---|---|
| Precision against the oracle | Simulated world run | Higher is better |
| Worthwhile-interruption rate | Simulated world run (persona-judged); pilot | 70% or more (PRD 28.2) |
| Opt-in and completion rates | Simulated world run; pilot | 40% opt-in, 70% completion (PRD 28.2) |
| Members with a first outcome in 14 days | Simulated world run; pilot | 60% or more (PRD 28.2) |
| Pair recall and member recall | Simulated world run | Higher is better |
| Exposure fairness (Gini, members with no proposal) | Simulated world run | Lower is better |
| Recommender and judge accuracy, precision, recall, ECE | `packages/evals` | Higher accuracy and precision; lower ECE |
| Canary leaks, invariant violations, minor contacts | Every simulated run | Always 0 |

Safety scores are gates. A PR that increases canary leaks, invariant violations, or minor contacts is not accepted, even if other scores improve.

## 6. Development rules

- Use Bun. Run `bun install`, then `bun run test` and `bun run typecheck`. These are offline. Live tests (paid LLM or network calls) run only with `LIVE_TESTS=1`. CI (`.github/workflows/ci.yml`) runs the offline suite with no keys.
- Network code reads time only from `Clock`. Do not use `Date.now()`, `new Date()` with no argument, or `Math.random()` in Network code (test plan 3.2).
- Network code never reads the hidden persona truth. Only the simulator and the oracle can read it (test plan 3.3).
- Every outbound message must go through the leak check, and every proactive proposal must go through human review (PRD 28.5). Today these are only partly true: the connector prototype checks every output, and the engine state machine has the review states (`IN_REVIEW` → `approve`), but `packages/network` does not use the review states yet and its send path has no inline leak check (audit 2026-10-07 P0-1). Do not claim otherwise in a PR or a results doc.
- Members under 18 are never connected to other members (test plan 6.6).
- The LLM for every use is `gpt-6-luna` on Surplus Intelligence, through `defaultLLM()`, `judgeLLM()` and `recommenderLLM()` in `packages/core/src/llm.ts`. There is no automatic fallback to OpenAI. `LLM_ALLOW_OPENAI_FALLBACK=1` is an explicit opt-in and logs a warning. Cerebras is optional and legacy. Requests time out after 60 s and retry at most 4 times. Do not add a new LLM client.
- Deploys to ntwrk.love go through `scripts/wrangler.sh`, which refuses them unless `NTWRK_ALLOW_DEPLOY=1`. Set it only with founder approval.
- Write results to [docs/results/](docs/results/) with the date, the command, the seed, the model, and the sample size, so that someone can run it again.
- Do not commit `.env`, `runs/`, or real member data.
