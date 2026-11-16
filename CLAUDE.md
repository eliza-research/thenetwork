# AGENTS.md

Read this file, [README.md](README.md), [SPEC.md](SPEC.md), and
[CONTRIBUTING.md](CONTRIBUTING.md) before working. Keep `AGENTS.md` and `CLAUDE.md` byte-identical.

This procedure applies the [Vibestack agent guide](tools/vibestack/AGENTS.md)
to The Network.

The Network is a [Slop](https://slop.cash) bounty repository. The monthly
pool is 1,000 USDC. Maintainers accept outcomes on GitHub. Slop scores
accepted merges and pays after maintainer review. There is no escrow.

## Before you start

1. Star and fork the repository with the contributor's own GitHub account.
   For normal contributions, open a PR from your fork into `main`.
2. Read the [product specification](spec/product/README.md) and the affected
   Vibestack stories and rules. The product specification owns launch scope.
   The [founder decision history](spec/product/source/founder-decisions.md)
   records the source decisions.
3. Read the affected package's README or design document and its latest
   [result](docs/results/SUMMARY.md).
4. Use the [sync skill](.claude/skills/sync/SKILL.md) when editing a story,
   rule, model, or production code that uses generated logic. Use the
   [design skill](.claude/skills/design/SKILL.md) for approved changes to
   anything a person sees.

## Sources of behavior

- `spec/<name>.md` holds a story, its rules, and the Quint each rule means.
  Put pure decisions there and have the existing package call the generated
  code. Keep I/O, text parsing, and storage in the shell.
- `spec/models/` holds the existing action-based Quint flow models. They
  preserve behavior and trace coverage while each flow moves into the
  Vibestack generator's supported subset.
- `gen/` is disposable output. The production build imports generated
  TypeScript published by `pnpm run spec:sync` into
  `packages/core/src/generated/`. Commit those copies with their specs.
  The same command compiles the serving shells under
  `packages/core/src/vibe/`. Commit emitted JavaScript and declarations
  with each shell and spec. Keep generated code free of manual edits.
- Change the model and implementation together. Compare their states, guards,
  writes, retries, leases, limits, and invariants. State which seams and proof
  obligations were checked, and which remain open.
- The [Eliza wire contract](packages/core/src/svc/contract.ts) and
  [signing code](packages/core/src/svc/svc-auth.ts) mirror upstream byte for
  byte. Land contract changes upstream before updating the mirror. Use
  `pnpm run check:mirror` to compare it.

## The Network contribution rules

[CONTRIBUTING.md](CONTRIBUTING.md) defines the full workflow.

- Star and fork first. Work from the fork.
- Stay within the launch scope in the [product specification](spec/product/README.md). Get written maintainer approval for new scope.
- Accepted: reproduced bugs, matching-algorithm and simulation validation, measured hill-climbing, security, and tests that prove real behavior (CONTRIBUTING.md section 3).
- Not accepted: UI, style or copy changes, preference refactors, speculative features, busywork tests, mock-only proof, placeholders or TODOs, unverified claims, duplicates and secrets.
- No UI changes. The only exception is a fix for a broken user flow, with before and after video.
- Evidence or nothing: numbers before and after, same command and seeds, and a run with real LLM calls (CONTRIBUTING.md section 7.2). Mocked LLM output is not proof.
- Test the changed flow in several agent clients and report client, version, provider and model for each (CONTRIBUTING.md section 8). Install other clients and drive them with computer use when they have no command line.
- Simplify first: extend or merge what exists; remove dead code.
- Validate with `pnpm run sim`, `pnpm run test:integration` and `pnpm run test:e2e`. A bug fix adds a sim gate, a scenario, a corpus row or an integration or e2e case that fails before the fix. No unit tests and no smoke tests ([docs/tests-policy.md](docs/tests-policy.md)).
- Defend the design: give two other implementations.
- Fill in the PR evidence checklist (CONTRIBUTING.md section 12.2).
- Write in ASD-STE100 Simplified Technical English (CONTRIBUTING.md section 13).

**Security suite** (`pnpm run security`, also part of `pnpm run test:integration`; the same list is in docs/tests-policy.md): `packages/platform/test/db.test.ts`, `packages/platform/test/api-security.test.ts`, `packages/platform/test/proxy.test.ts`, `packages/platform/test/cloud-auth.pg.test.ts`, `packages/platform/test/notify-retention.pg.test.ts`, `packages/mcp/test/oauth.test.ts`, `packages/mcp/test/pg.test.ts`, `deploy/backend/backend.test.ts`, `deploy/router.test.ts`, `packages/network/test/shared-agent.integration.test.ts`, `packages/observatory/test/staff.test.ts`.

**Postgres in the simulations.** The safety, ops, pipeline, pipeline-slop and audit blocks use the dev Postgres (:54339) when it is there and record a tracked "skipped" gate when it is not. CI's sim job has a Postgres service and `REQUIRE_PG=1`, and it fails on any such skip. The migration runner (`packages/observatory/db/migrate.ts`) refuses two numbered migrations with the same NNNN prefix: take the next free number.

## Code invariants

Do not break these. `pnpm run sim` checks them in every simulated run.

- Network code reads time only from `Clock` (`packages/core`). No `Date.now()`, no `new Date()` without an argument, no `Math.random()`. Randomness comes from the seeded RNG.
- Network code never reads hidden persona truth (`Persona.hidden`, the oracle, `hidden_truth.jsonl`). Only `packages/sim` and the judges that run inside the simulator can read it.
- Every proactive proposal, and every member-initiated request, must go through human review before any member is contacted (founder decision, below 1,000 members). **Status:** the ConsentNetwork (`packages/network`) enforces it: every opportunity, whatever its origin, waits in a review queue (default mode `human`; the member count never turns review off), and an item past its SLA expires unsent. Simulator runs use a simulated reviewer (`review: "auto"`); say so when you report a run. The simulator's `StubNetwork` has no review. The production service (`packages/network/service`) stores review state in Postgres and serves review decisions through its staff API (`/review`).
- Every outbound message must go through the leak check. **Status:** the ConsentNetwork send path and the Blooio outbound queue run the leak guard (`packages/core/src/guard.ts`) on every message; the MCP server withholds any inbox update that fails its output gate (`packages/mcp/src/leaks.ts`). The simulator's `StubNetwork` (the push baseline) has no leak check.
- Age policy (`packages/core/src/policy.ts`): under 13 cannot join and is declined kindly with nothing stored; members aged 13-17 can use the agent for themselves (chat, events, things to do) but are never matched or connected to other members. Use `canJoin`, `isMinor` and `canBeMatched`; do not hard-code ages.
- Canary leaks, invariant violations, and minor contacts are always 0. A change that makes any of them non-zero is wrong, whatever else it improves. One known judge issue: the single allowed 14-day re-engagement message shows as a `two_unanswered` violation in runs longer than about 14 days ([docs/network.md](docs/network.md) section 11). Any other violation is real.

## LLMs

- Use `defaultLLM()`, `judgeLLM()` or `recommenderLLM()` from `packages/core/src/llm.ts`. Every use is `gpt-6-luna` on Surplus Intelligence. OpenAI (same model IDs) is used when there is no `SURPLUS_API_KEY`, and as the fallback when Surplus returns 429 / 5xx / a timeout. Use `endpointsFor(provider)` to check whether a provider has a key. Do not add a new LLM client or provider.
- Requests time out after 60 s by default (`LLM_TIMEOUT_MS`) and retry at most 4 times (`LLM_MAX_RETRIES`). One call, retries included, stops at `LLM_DEADLINE_MS` (default 3x the timeout; 0 disables). Pass `fallback: false` to a call or client to turn off the OpenAI fallback; every fallback is logged and reported to `onFallback`.
- `pnpm run sim` never calls a model: it clears the provider keys before it starts. The one exception is `--llm`, which keeps them for the onboarding LLM arm (tracked gates only).
- PR evidence needs real LLM calls. The real-LLM commands are in CONTRIBUTING.md section 7.2. The service's engine judge is off by default. For bounded real-model qualification with `NETWORK_ENGINE_JUDGE=1`, use the budget, request limit and dry-run command in [the service README](packages/network/service/README.md#matching-judge-in-staging). The sim adapter still does not supply an LLM to the engine.
- Judge prompts write the explanation before the verdict.
- Recommendations and judges use the same model (`gpt-6-luna`) with a different prompt or pass. Use a different judge model for audits only, and a cross-family audit needs founder approval (it sends data to another provider).

## Commands

```bash
pnpm install --frozen-lockfile
pnpm run spec:setup
pnpm run spec:sync             # generate and publish the application rule modules
pnpm run check                 # check the selected compiler inputs
pnpm run spec:check-generated  # compare the published copies with fresh output
pnpm run sim                  # the validation layer: evals, onboard, network, slop, relay, peon, friends, clef, safety, ops, pipeline, audit (pinned seeds; exits 1 on a blocking gate)
pnpm run sim --only network   # one block (the names above, or capital); repeatable
pnpm run sim --quick          # fewer seeds, shorter runs; quality gates become tracked
pnpm run sim --with-capital   # adds the network-capital block (32 paired seeds; nightly)
pnpm run typecheck
node --import tsx --env-file-if-exists=.env plugins/build.ts --check
pnpm run test:integration     # integration suite incl. the security files (real Postgres on :54339 via dev-pg; docs/tests-policy.md)
pnpm run test:e2e             # e2e: the full service and platform through HTTP (tests/e2e; needs Postgres)
pnpm run security             # the security subset of the integration suite (11 files; list below)
pnpm run clef <fit|calibrate|features|audit|synth>   # P2 Clef weight fitting (docs/results/2026-10-09-clef-fitting.md); only `features --live` calls Workers AI
pnpm run relay-eval [rules|fit] [--live]   # the relay classifier report; only --live calls Workers AI

# The ConsentNetwork on the NYC world (docs/runbook-simulation.md)
node --import tsx --env-file-if-exists=.env packages/network/harness/experiment.ts --days 21 --seed 1
node --import tsx --env-file-if-exists=.env packages/network/harness/scenarios.ts [scenario_id]

# The simulated world and its scenarios (pass^k)
node --import tsx --env-file-if-exists=.env packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/src/engineAdapter.ts
node --import tsx --env-file-if-exists=.env packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 4

# Per-app worlds (full tables; pnpm run sim runs their official gates)
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/slop/packEval.ts --seeds 13-16 --weeks 4 --arms random,slop --gates3 \
  --population '{"catfish":0.005,"bodyTypes":true}' --world '{"verification":true,"relay":true,"review":3,"widen":true,"checkin":true,"photos":1,"rater":true}'
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/peon/cli.ts --seeds 13-16
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/friends/cli.ts --seeds 5-8

# Observatory (prints http://127.0.0.1:4747/#token=...)
pnpm run observatory
pnpm run observatory --review human
pnpm run observatory:db       # local Postgres on :54339 with a 14-day simulated run

# The four apps on one backend (docs/runbook-platform.md): dry-run sends only
pnpm run db:migrate           # migrations (network and platform schemas), local hosts only
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/<your db> pnpm run platform:dev   # service :4848, API :8790, sites :5101-5104
pnpm run sites:dev            # the four sites only, /api/* proxied to :8790
```

## Environment

- Copy `.env.example` to `.env`. Never commit `.env` or anything in `runs/`. CONTRIBUTING.md section 5 lists every variable that testing needs, taken from the code.
- Never set `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED`, `<APP>_LIVE_APPROVED` or `NETWORK_CHANNEL` locally. Without them every send is dry-run.
- The local dev Postgres for the Observatory is on port **54339**. Do not touch port 54329; another tool uses it.
- `packages/observatory/db/seed.ts` refuses non-local hosts. Do not pass `--allow-remote` unless a human asks.
- Cloudflare work for ntwrk.party goes through `scripts/wrangler.sh` only. It refuses `deploy` (except `--dry-run`) and other commands that change Cloudflare resources unless `NTWRK_ALLOW_DEPLOY=1` is set. Do not set it without the founder's approval.

## Results

Write experiment results to `docs/results/YYYY-MM-DD-<topic>.md`. Include the command, the seed, the model, the request settings, the sample size, and confidence intervals or significance tests for small differences. Say what is hand-written and what is generated.

## Working on a task

Restate the goal and the smallest change that meets it. Carry the goal into
subagent briefs and the pull request. Identify the data shape and the
boundary that owns it before writing code. For novel designs that cross
function boundaries, use the [architect skill](.claude/skills/architect/SKILL.md)
to compare independent approaches before implementing. Use the
[why skill](.claude/skills/why/SKILL.md) to trace ownership and layering
decisions back to their rationale. Carry out authorized, reversible work.

## Loading skills

The canonical skills and their bundled references live in
[`.claude/skills/`](.claude/skills/). The shared [`.agents/skills/`](.agents/skills/)
directory links to those files for agent discovery. A name and description
help select the skill. Read its `SKILL.md` in full and open the relevant
references before using it. Resolve repository links from the project root
and relative links in a skill from its own directory. Clients without
repository skill discovery can read these files directly.

| Read | Before |
|---|---|
| [Spec reference](SPEC.md) and [sync](.claude/skills/sync/SKILL.md) | Changing a story, rule, model, generated-code caller, or resolving a failed spec stage |
| [Shell](.claude/skills/shell/SKILL.md) | Designing an effectful boundary, including input decoding, storage, retries, and the Vibestack Machine adapter |
| [Prove](.claude/skills/prove/SKILL.md) | Writing a proof file or a `//@` contract, or working on a failed proof |
| [Design](.claude/skills/design/SKILL.md) | Making an approved change to anything a person sees |
| [Architect](.claude/skills/architect/SKILL.md), [arena](.claude/skills/arena/SKILL.md), and [why](.claude/skills/why/SKILL.md) | Comparing designs or changing existing ownership |
| [Benchmark checklist](.claude/skills/benchmark-checklist/SKILL.md) | Measuring performance |
| [TypeScript best practices](.claude/skills/typescript-best-practices/SKILL.md) | Reading or writing TypeScript |

The architect skill uses Arena for parallel exploration. When its runners
are unavailable, use independent subagents and the skill's
[runner prompt](.claude/skills/architect/references/runner-prompt.md).
Screen and synthesize the designs before implementing.

## The stack

The application, tests, and vendored Vibestack toolchain use Node 26
and pnpm. Use the Node patch version in `.nvmrc`. Pure rules, transitions and
validation types come from Quint. Existing services consume its generated
TypeScript at their boundaries. The public backend health route runs its
database and tick effects in a compiled VibeLang shell. Use the existing
application framework and component system in each package. Read
the [Network command map](README.md#commands)
when an imported skill refers to the standalone template's pnpm commands,
VibeLang shell, React design system, or Vitest setup.

## Who does what

`pnpm run check` reports where the executable spec requires attention. Use
the [sync skill](.claude/skills/sync/SKILL.md) to translate between stories,
rules, Quint, and implementation. Read each rule beside its Quint. Use
`pnpm run spec:sync` to publish the generated TypeScript for application
callers. The product owner runs `pnpm run accept` to record review.

## Hard rules

- Edit the source specs and proof files. Treat `gen/`, the published
  `packages/core/src/generated/`, `.spec-cache/`, `.studio/`, and the
  review ledger `spec/lock.json` as tool-owned.
- Keep each rule at its intended strength. Investigate a failing model,
  simulation, replay, or proof and trace it to the source. Report any
  proposed rule change or unresolved proof obligation with its evidence.
- Put pure business decisions in the spec as `pure def`. Keep dependencies,
  I/O, input parsing and persistence in the owning package. Preserve the
  Eliza wire contract and existing product safety guards.
- Put proof lemmas beside the source spec or contract. Use the
  [prove skill](.claude/skills/prove/SKILL.md) for permitted proof constructs.
  Run `pnpm run accept` only at the product owner's request after reviewing
  each listed rule. Simulated-only approval (`pnpm run accept unproved`) also
  requires that request.
- Use the shared instructions and product spec as the home for rules. Keep
  the existing guides and guides' skill references up to date.

## Writing code

- **One path.** Migrate callers to the generated decision and remove the
  replaced logic. Preserve required operational configuration.
- **Reuse.** Extend existing components, types, services and tests.
- **Boundaries.** Parse external input at entry. Let the generated types
  and guards constrain internal transitions.
- **Clarity.** Use domain names and readable structure. Keep comments for
  tool directives, spec citations, and information the code cannot express.
- **Speed.** Keep checks focused while working. Use the Network evidence
  commands required for the change before claiming full validation.
- **Review.** Reread the wiring and its corresponding rule on a second pass.

## Principles


Read the leaf skill in full for any principle you apply. Each entry names when
it applies. Each leaf is the **`principle-<title>`** skill, with the title in
kebab case, hyphens kept and other punctuation dropped, unless the entry gives
its name.

- **Laziness Protocol.** Refactoring, sizing a diff, or tempted to add
  abstractions, layers, or signal threading. Bias to deletion and the smallest
  change that solves the problem.
- **Foundational Thinking.** Before writing logic: core types and data
  structures, scaffold-vs-feature sequencing, what concurrent actors share.
- **Redesign from First Principles.** Integrating a new requirement into an
  existing design. Redesign as if it had been foundational from day one.
- **Attack the Premise.** Two or more fixes that share one premise have failed
  the same gate. Write the premise down and test it directly before you write
  another fix that assumes it.
- **Subtract Before You Add.** Sequencing an addition, refactor, or rewrite.
  Remove dead weight first, then build on the simpler base.
- **Minimize Reader Load.** Reviewing or shaping code that's hard to trace.
  Count layers and hidden state, collapse one-caller wrappers, shrink mutable
  scope.
- **Outcome-Oriented Execution.** Planned rewrites and migrations with explicit
  phase boundaries. Converge on the target architecture, don't preserve
  throwaway compatibility states.
- **Experience First.** Product, UX, or feature-scope tradeoffs. Choose user
  delight over implementation convenience.
- **Exhaust the Design Space.** A novel interaction or architectural decision
  with no precedent. Build 2-3 competing prototypes and compare before
  committing.
- **Build the Lever.** Any non-trivial work. Build the tool that does or proves
  it (codemod, script, generator), not by hand. The tool is the artifact a
  reviewer reruns.
- **Model the Domain.** Writing stateful logic, or code that branches a lot or
  repeats a shape assumption across files. Encode the domain in a structure
  (state machine, typed model, table or registry, reducer, boundary, the right
  collection) instead of scattered conditionals.
- **Boundary Discipline.** Wiring validation, error handling, or framework
  adapters. Guards at system boundaries, trust internal types, keep business
  logic pure.
- **Type System Discipline.** Designing types or a signature in any typed
  language. Make illegal states unrepresentable, brand primitives, parse
  external data at boundaries.
- **Make Operations Idempotent.** Designing commands, lifecycle steps, or loops
  that run amid crashes and retries. Converge to the same end state.
- **Migrate Callers Then Delete Legacy APIs.** Introducing a new internal API
  while old callers exist. Migrate and delete in one wave.
- **Separate Before Serializing Shared State.** Concurrent actors might write
  the same file, branch, key, or object. Eliminate the sharing first.
- **Prove It Works.** After a task, before declaring done. Verify against the
  real artifact, not a proxy or "it compiles".
- **Fix Root Causes.** Debugging. Trace each symptom back to the first place the
  system went wrong and fix it there. A guard is a fix only when the state it
  handles is legitimate.
- **Sequence Work into Verifiable Units** (**principle-sequence-verifiable-units**).
  Multi-step work (sweeps, migrations, runs of similar edits) and how you stack
  commits and PRs. Break work into small units that each end in a check, verify
  each before the next, and order delivery so the sequence proves itself.
- **Test Behavior, Not Implementation.** Writing, changing, or keeping a test.
  Assert what the code's users can observe, so the test fails when that behavior
  breaks and keeps passing when only the internals change.
- **Explain the Number.** Apply before you measure, and before you trust,
  report, or act on a number you measured (a speedup, a regression, a
  throughput, a latency, or an eval result). Find what limits it, and rule out
  that it measured something other than the work you think.
- **Guard the Context Window.** Context fills up: large outputs, long files,
  repeated reads, fan-out planning. Route bulk to subagents, keep summaries in
  the main thread.
- **Never Block on the Human.** Tempted to ask "should I do X?" on reversible
  work. Proceed, present the result, let the human course-correct.
- **Encode Lessons in Structure.** You catch yourself writing the same
  instruction a second time. Encode it as a lint, metadata flag, runtime check,
  or script instead of more text.

## TypeScript best practices

Read the [`typescript-best-practices` skill](.claude/skills/typescript-best-practices/SKILL.md)
before reading or editing `.ts` or `.tsx` files. Adapt the
[TypeScript type reference](tools/vibestack/vibestack/reference/typereferences.md)
to the repository's schema library. Validate that a duration is nonnegative
when it represents an ordered range.

Make the compiler reject impossible states, mismatched primitives, and
unhandled variants. Prefer defining errors and special cases out of existence
over proliferating handlers.

- **Brand semantic primitives.** Give `UserId` and `OrderId` distinct types, even
  if each is a string underneath. Use a branded intersection in TypeScript or
  a newtype elsewhere. Validate once at creation, then trust the type
  downstream. Brand arguments that share a primitive type and have different
  meanings.
- **External data is untyped until parsed.** Parse RPC payloads, JSON, IPC
  messages, CLI args, config files, environment variables, and database rows
  into the typed model at each boundary. See the
  [**boundary-discipline** principle skill](.claude/skills/principle-boundary-discipline/SKILL.md).
- **Derive types from authoritative schemas.** When a protocol buffer, OpenAPI
  spec, GraphQL schema, database migration, design-token file, or another file
  owns a shape, derive the type from that source. See the
  [**encode-lessons-in-structure** principle skill](.claude/skills/principle-encode-lessons-in-structure/SKILL.md).

| Rule | Summary |
|---|---|
| Discriminated unions | Model variants with a `kind` literal discriminant and give each variant exactly the fields it needs. |
| Branded types | Brand primitives with `& { readonly __brand: "X" }` to keep them distinct. Validate once at the boundary. Establish the brand with a verifying type guard such as `input is AgentId`. |
| Constructive modeling | Build the shape so the illegal value can't be constructed. Use `[T, ...T[]]` for a non-empty list, `[T, T][]` for an even number of elements, and `start` plus a `NonNegativeDuration` type for an ordered range. |
| Simplest total type | Keep `T[]` while every operation on it stays total. Strengthen to `NonEmpty<T>` only where the loose type forces `!`, a cast, or a "should never happen" throw. |
| `unknown` over `any` | External data is `unknown`. |
| Schemas before guards | Use the repository's runtime schema library and infer the type from the schema before writing a property-by-property guard. |
| Type assertions | Use an `as` cast only after validation. |
| Narrowing hierarchy | Prefer a discriminant switch, then `in`, then `typeof` or `instanceof`, then a user-defined type guard. A validated `as` cast is the last resort. |
| Type guards | Verify the full claim and name the guard `isX` or `hasX`. A misleading guard hides an unsafe assertion behind a name that promises safety. |
| Exhaustiveness | Inline `const _exhaustive: never = x;` in default arms so the compiler errors when a new variant is added. |
| `satisfies` over `as` | Check that a value conforms to a type while retaining the inferred type of the expression. |
| Boundary validation | Parse incoming data into a named domain type. Keep `Record<string, unknown>` and equivalent raw shapes on the input side of that parse. Trust the resulting types inside. See the **boundary-discipline** principle skill linked above. |
| Schema-derived types | Reach for `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, or `typeof` before declaring a new interface. |
| Object args | Use named object properties to make arguments self-documenting. Positional arguments suit hot paths such as per-frame rendering, tokenizers, or parsers. |
| Real tests | Use real framework test primitives with leak and disposal checks, and verify UI in a running build. Mock only services you can't run locally, following the rules below. |
| Structured telemetry | Use structured logger diagnostics with enough context to debug from an ID. No `console.log` in shipped code. |

## Design from the spec

Follow the [design skill](.claude/skills/design/SKILL.md) within the approvals
and public interface rules in [CONTRIBUTING.md](CONTRIBUTING.md#9-public-interface-changes).
Inventory the actions and information each story requires. Compare three
directions and choose the clearest hierarchy with the fewest elements.
Use visuals, position and weight where they carry the meaning. Give each
view one main heading and keep the words required for actions, safety,
consent, accessibility, and policy. Use shared tokens, a single type pairing,
an accent and a spacing scale. Retain accessible names for visuals and WCAG
AA contrast. Review the content and layout across two or three passes.

## Tests

- Exercise a full journey or a real integration when input parsing, HTTP,
  storage, queues, or interface wiring carry behavior outside the model.
  Cite the relevant story or rule and extend its existing journey first.
- Use real local services and their reset support. Simulate an external
  provider at its boundary when it costs money, cannot be reset, or has
  irreversible effects.
- Assert behavior an end user can observe. Leave proved guards and
  transitions to the model except where a journey exercises them. Treat
  safety or consent wording as behavior when its story requires the words.
- Run the Network's integration and end-to-end lanes for application
  evidence. A Vibestack conformance driver uses the app's own entry point
  and imports the generated machine's types only.
  [Conformance reference](SPEC.md#conformance)

## Definition of done

Check the generated snapshots against the source specs and compare the
affected model with the running behavior. Report open proof, review, and
application validation separately with the evidence for each. Refer to the
[sync skill](.claude/skills/sync/SKILL.md) for what to report and to
[CONTRIBUTING.md](CONTRIBUTING.md#122-evidence-checklist) for pull request
evidence. The product owner records sign-off after reading the changed
requirements and their formal meaning.
