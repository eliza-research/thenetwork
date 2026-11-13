# AGENTS.md

Read this file, [README.md](README.md), and [CONTRIBUTING.md](CONTRIBUTING.md)
before working. Keep `AGENTS.md` and `CLAUDE.md` byte-identical.

The Network is a [Slop](https://slop.cash) bounty repository. The monthly
pool is 1,000 USDC. Maintainers accept outcomes on GitHub. Slop scores
accepted merges and pays after maintainer review. There is no escrow.

## Before you start

1. Star and fork the repository with the contributor's own GitHub account.
   For normal contributions, open a PR from your fork into `main`.
2. Read the [product specification](spec/product/README.md) and the affected
   Vibespec stories and rules. The product specification owns launch scope.
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
  Vibespec generator's supported subset.
- `gen/` is disposable output. The production build imports generated
  TypeScript published by `bun run spec:sync` into
  `packages/core/src/generated/`. Commit those copies with their specs.
  Keep both forms of generated code free of manual edits.
- Change the model and implementation together. Compare their states, guards,
  writes, retries, leases, limits, and invariants. State which seams and proof
  obligations were checked, and which remain open.
- The [Eliza wire contract](packages/core/src/svc/contract.ts) and
  [signing code](packages/core/src/svc/svc-auth.ts) mirror upstream byte for
  byte. Land contract changes upstream before updating the mirror. Use
  `bun run check:mirror` to compare it.

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
- Validate with `bun run sim`, `bun run test:integration` and `bun run test:e2e`. A bug fix adds a sim gate, a scenario, a corpus row or an integration or e2e case that fails before the fix. No unit tests and no smoke tests ([docs/tests-policy.md](docs/tests-policy.md)).
- Defend the design: give two other implementations.
- Fill in the PR evidence checklist (CONTRIBUTING.md section 12.2).
- Write in ASD-STE100 Simplified Technical English (CONTRIBUTING.md section 13).

**Security suite** (`bun run security`, also part of `bun run test:integration`; the same list is in docs/tests-policy.md): `packages/platform/test/db.test.ts`, `packages/platform/test/api-security.test.ts`, `packages/platform/test/proxy.test.ts`, `packages/platform/test/cloud-auth.pg.test.ts`, `packages/platform/test/notify-retention.pg.test.ts`, `packages/mcp/test/oauth.test.ts`, `packages/mcp/test/pg.test.ts`, `deploy/backend/backend.test.ts`, `deploy/router.test.ts`, `packages/network/test/shared-agent.integration.test.ts`, `packages/observatory/test/staff.test.ts`.

**Postgres in the simulations.** The safety, ops, pipeline and audit blocks use the dev Postgres (:54339) when it is there and record a tracked "skipped" gate when it is not. CI's sim job has a Postgres service and `REQUIRE_PG=1`, and it fails on any such skip. The migration runner (`packages/observatory/db/migrate.ts`) refuses two numbered migrations with the same NNNN prefix: take the next free number.

## Code invariants

Do not break these. `bun run sim` checks them in every simulated run.

- Network code reads time only from `Clock` (`packages/core`). No `Date.now()`, no `new Date()` without an argument, no `Math.random()`. Randomness comes from the seeded RNG.
- Network code never reads hidden persona truth (`Persona.hidden`, the oracle, `hidden_truth.jsonl`). Only `packages/sim` and the judges that run inside the simulator can read it.
- Every proactive proposal, and every member-initiated request, must go through human review before any member is contacted (founder decision, below 1,000 members). **Status:** the ConsentNetwork (`packages/network`) enforces it: every opportunity, whatever its origin, waits in a review queue (default mode `human`; the member count never turns review off), and an item past its SLA expires unsent. Simulator runs use a simulated reviewer (`review: "auto"`); say so when you report a run. The simulator's `StubNetwork` has no review. The production service (`packages/network/service`) stores review state in Postgres and serves review decisions through its staff API (`/review`).
- Every outbound message must go through the leak check. **Status:** the ConsentNetwork send path and the Blooio outbound queue run the leak guard (`packages/core/src/guard.ts`) on every message; the MCP server withholds any inbox update that fails its output gate (`packages/mcp/src/leaks.ts`). The simulator's `StubNetwork` (the push baseline) has no leak check.
- Age policy (`packages/core/src/policy.ts`): under 13 cannot join and is declined kindly with nothing stored; members aged 13-17 can use the agent for themselves (chat, events, things to do) but are never matched or connected to other members. Use `canJoin`, `isMinor` and `canBeMatched`; do not hard-code ages.
- Canary leaks, invariant violations, and minor contacts are always 0. A change that makes any of them non-zero is wrong, whatever else it improves. One known judge issue: the single allowed 14-day re-engagement message shows as a `two_unanswered` violation in runs longer than about 14 days ([docs/network.md](docs/network.md) section 11). Any other violation is real.

## LLMs

- Use `defaultLLM()`, `judgeLLM()` or `recommenderLLM()` from `packages/core/src/llm.ts`. Every use is `gpt-6-luna` on Surplus Intelligence. OpenAI (same model IDs) is used when there is no `SURPLUS_API_KEY`, and as the fallback when Surplus returns 429 / 5xx / a timeout. Use `endpointsFor(provider)` to check whether a provider has a key. Do not add a new LLM client or provider.
- Requests time out after 60 s by default (`LLM_TIMEOUT_MS`) and retry at most 4 times (`LLM_MAX_RETRIES`). One call, retries included, stops at `LLM_DEADLINE_MS` (default 3x the timeout; 0 disables). Pass `fallback: false` to a call or client to turn off the OpenAI fallback; every fallback is logged and reported to `onFallback`.
- `bun run sim` never calls a model: it clears the provider keys before it starts. The one exception is `--llm`, which keeps them for the onboarding LLM arm (tracked gates only).
- PR evidence needs real LLM calls. The real-LLM commands are in CONTRIBUTING.md section 7.2. The service's engine judge is off by default. For bounded real-model qualification with `NETWORK_ENGINE_JUDGE=1`, use the budget, request limit and dry-run command in [the service README](packages/network/service/README.md#matching-judge-in-staging). The sim adapter still does not supply an LLM to the engine.
- Judge prompts write the explanation before the verdict.
- Recommendations and judges use the same model (`gpt-6-luna`) with a different prompt or pass. Use a different judge model for audits only, and a cross-family audit needs founder approval (it sends data to another provider).

## Commands

```bash
bun install --frozen-lockfile
bun run spec:setup
bun run spec:sync             # generate and publish the application rule modules
bun run check                 # model, simulation, replay, types, proof, tests, review
bun run sim                  # the validation layer: evals, onboard, network, slop, relay, peon, friends, clef, safety, ops, pipeline, audit (pinned seeds; exits 1 on a blocking gate)
bun run sim --only network   # one block (the names above, or capital); repeatable
bun run sim --quick          # fewer seeds, shorter runs; quality gates become tracked
bun run sim --with-capital   # adds the network-capital block (32 paired seeds; nightly)
bun run typecheck
bun run plugins/build.ts --check
bun run test:integration     # integration suite incl. the security files (real Postgres on :54339 via dev-pg; docs/tests-policy.md)
bun run test:e2e             # e2e: the full service and platform through HTTP (tests/e2e; needs Postgres)
bun run security             # the security subset of the integration suite (11 files; list below)
bun run clef <fit|calibrate|features|audit|synth>   # P2 Clef weight fitting (docs/results/2026-10-09-clef-fitting.md); only `features --live` calls Workers AI
bun run relay-eval [rules|fit] [--live]   # the relay classifier report; only --live calls Workers AI

# The ConsentNetwork on the NYC world (docs/runbook-simulation.md)
bun run packages/network/harness/experiment.ts --days 21 --seed 1
bun run packages/network/harness/scenarios.ts [scenario_id]

# The simulated world and its scenarios (pass^k)
bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/src/engineAdapter.ts
bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 4

# Per-app worlds (full tables; bun run sim runs their official gates)
bun run packages/sim/src/apps/slop/packEval.ts --seeds 13-16 --weeks 4 --arms random,slop --gates3 \
  --population '{"catfish":0.005,"bodyTypes":true}' --world '{"verification":true,"relay":true,"review":3,"widen":true,"checkin":true,"photos":1,"rater":true}'
bun run packages/sim/src/apps/peon/cli.ts --seeds 13-16
bun run packages/sim/src/apps/friends/cli.ts --seeds 5-8

# Observatory (prints http://127.0.0.1:4747/#token=...)
bun run observatory
bun run observatory --review human
bun run observatory:db       # local Postgres on :54339 with a 14-day simulated run

# The four apps on one backend (docs/runbook-platform.md): dry-run sends only
bun run db:migrate           # migrations (network and platform schemas), local hosts only
NETWORK_DATABASE_URL=postgres://$USER@localhost:54339/<your db> bun run platform:dev   # service :4848, API :8790, sites :5101-5104
bun run sites:dev            # the four sites only, /api/* proxied to :8790
```

## Environment

- Copy `.env.example` to `.env`. Never commit `.env` or anything in `runs/`. CONTRIBUTING.md section 5 lists every variable that testing needs, taken from the code.
- Never set `BLOOIO_ALLOW_SEND`, `NTWRK_LIVE_APPROVED`, `<APP>_LIVE_APPROVED` or `NETWORK_CHANNEL` locally. Without them every send is dry-run.
- The local dev Postgres for the Observatory is on port **54339**. Do not touch port 54329; another tool uses it.
- `packages/observatory/db/seed.ts` refuses non-local hosts. Do not pass `--allow-remote` unless a human asks.
- Cloudflare work for ntwrk.party goes through `scripts/wrangler.sh` only. It refuses `deploy` (except `--dry-run`) and other commands that change Cloudflare resources unless `NTWRK_ALLOW_DEPLOY=1` is set. Do not set it without the founder's approval.

## Results

Write experiment results to `docs/results/YYYY-MM-DD-<topic>.md`. Include the command, the seed, the model, the request settings, the sample size, and confidence intervals or significance tests for small differences. Say what is hand-written and what is generated.

## Who does what

`npm run check` detects; you translate: story → rules, rule → Quint, changed
Quint → prose, counterexample → rule. That is your work in this session; it
needs no other program or account.

**Whenever a Vibespec module or its application code has changed, follow
[.claude/skills/sync/SKILL.md](.claude/skills/sync/SKILL.md)**: the loop, what
each failure asks of you, and what to report. Claude Code loads the `sync` skill. Other agents read the file.

The user signs off with `npm run accept`.

## Hard rules

- Never edit generated TypeScript, `.spec-cache/` or `spec/*.lock.json` by hand, and never add a
  `lemmascript.json`. The tools own them; a change there could make a check
  pass that should not.
- Never run `npm run accept -- unproved` unless the user asks. It lowers the
  listed obligations from proved to simulated.
- Run `npm run accept` only when the user asks, and only after reading each
  rule `review` lists and finding that its prose and Quint say the same thing.
- Never weaken or delete a rule (`always`, `step`, `sometimes` or `law`) to
  make a check pass without telling the user which rule and why.
- Proving obligations is your work, in `spec/<name>.proof.dfy` or
  `src/<path>.proof.dfy` ("Proof files", below). Satisfy a check;
  never get past it: no trust or skip annotations, no edits to the tools or
  what they generate, no workaround for what a proof file may not contain.
- Verified logic belongs in the spec as `pure def`. Keep hand-written TypeScript in its owning package for behavior that needs the outside world or exceeds the supported Quint subset.

## Writing code

Check each point before you write, and again after.

- **Design.** Anything a person looks at follows
  [.claude/skills/design/SKILL.md](.claude/skills/design/SKILL.md).
- **One path.** Replace old code; do not keep it beside its replacement. No
  feature flags, environment variables or settings for a change.
- **Reuse.** Search for existing code and types first. Extend and share; no
  duplicates or one-offs.
- **Compact.** Reread for needless branches, `try` blocks, wrappers and
  indirection. Shorter, if it reads as well.
- **Comments** point to related code or to the spec rule a line serves. Never
  describe what changed or was added.
- **Scripts and tests.** Extend existing ones first. Delete code that becomes unused. Tests follow "Tests" below.
- **Speed.** Keep checks and CI fast: a small change reruns only what it
  touches; a full run is as quick as it can be.
- **Passes.** The first version is a draft. Review it two or three times
  against these points.

## Tests

The spec proves the rules for every state and input; a test covers only what
`npm run check`'s other stages cannot see: hand-written code meeting the
outside world. Write one only when its failure would be a bug a user meets
and nothing else would catch it.

| Earns a test | Never a test |
|---|---|
| A whole user journey, or an integration with a real service, through the real shell: input parsing, storage, HTTP, UI wiring | A guard, transition, rule or law the spec already proves, except as a step of a journey |
| Hand-written code that touches the outside world, through the journey that uses it. Pure logic becomes a `pure def` or gets a `//@` contract instead | Strings, labels, page titles, markup, styles, snapshots |
| A shell bug that was found: one more step in the journey it broke | That a function was called; what `tsc` already checks |

- **Journeys.** A test walks a story end to end, is named after it, and cites
  the rule each assertion serves (`// spec/order.md, "…"`). A story whose
  path never leaves the verified core needs none.
- **Real services.** Run the real database, server, queue and filesystem,
  started and reset by the `test` script or the runner's setup: an in-process
  database such as PGlite, a container, a local emulator, a provider's test
  mode. Fake only a service that costs money, cannot
  be undone, or cannot be run and reset locally; fake it once, at its network
  boundary, shared by every test. No mocks of your own code.
- **Extend before adding.** A step or assertion in an existing journey before
  a new test; a new test before a new file. A test that repeats another's
  setup to assert one more thing belongs inside it.
- **Compact.** Shared helpers over repeated setup, one assertion of a whole
  value over one per field, no comment that restates the test's name.
- **One owner.** Extend the package that owns the journey. The Network uses
  its existing integration, e2e, and simulator commands. The starter runner
  invokes the applicable package's `test` script when configured.
- **Size.** One file per package and runner is the norm, and 5,000 lines is fine. At
  15,000 lines, consolidate and simplify; split only at 20,000.
- **Never weaken a test to pass.** Fix the code. If the spec now asks for
  something else, change the assertion and name it and its rule in your
  report. Propose deleting a test; never delete one yourself.

How `npm run check` runs them:

- **Any runner.** It runs the package's `test` script with the package
  manager named by `packageManager` in `package.json`, or else by the lock file
  in the package or a directory above it: `node --test`, Vitest, Jest,
  `bun test` and Playwright all work. Without a `test` script it runs
  `node --test` on `test/**/*.test.ts`. The exit code decides; a failure shows
  the runner's summary of failures, or its last 80 lines.
- **Citations.** A test, or a shell file in `src/`, names the story or rule it
  serves by its heading, on one line:
  `// spec/order.md, "A payment never exceeds the balance"`, or
  `// spec/order.md, "Story: Check out"` for a story; several may share a line,
  separated by `;`. `check` fails on a
  citation whose heading the spec no longer has, so a renamed or removed rule
  brings its tests up for review.
- **Monorepos.** Each package with a `spec/` runs its own `check` and its own
  tests; run them all from the root with the workspace tool
  (`pnpm -r --if-present check`, `npm run check --workspaces --if-present`).
  A journey that crosses packages is tested in the package that owns it,
  usually the app.

## Definition of done

- `npm run check` is where step 3 of the sync skill's loop stops: what is
  left waits on the user.
- For changes to the vendored generator, `bun run spec:selftest`
  passes, with a new case for each new kind of mistake the change catches.
- What you wrote has had its passes under "Writing code".
- Your summary follows "When you stop" in the sync skill.

## Design from the spec

### Before you draw

1. **Inventory.** For each story in `spec/<name>.md`, write down what the user
   must see or do, and the rule behind it. That list is the whole content:
   everything on it ships; no page, section, setting or sample content off it does.
2. **Cut.** For each item ask: does the user need to see this, here, now? What
   do they need that is not on the list? Remove what fails; add what is missing.
3. **Three directions.** Sketch three different approaches (layout, hierarchy,
   brand treatment), a sentence or a rough SVG each. Pick the one that shows the
   inventory with the fewest elements and the clearest identity.

### Rules

| Instead of | Use |
|---|---|
| Text a visual can carry | A chart, icon, color, shape or SVG |
| A number inside a sentence | The number alone, large, or a bar or meter |
| A status word | Color, shape or icon, with the word as its accessible name |
| A paragraph explaining a flow | A diagram |
| A label repeating what the element shows | Nothing |
| A chip, pill, badge, eyebrow or divider | Position, weight or color, or nothing |
| Filler in empty space | Whitespace |

- **Few words.** Use one heading per view. Keep the words needed for actions,
  safety, consent, accessibility, and required policy.
- **Accessible.** Every visual keeps its meaning in `aria-label` or `alt`. Text
  contrast meets WCAG AA.
- **Untested.** Journey tests through the UI assert what the user can do and
  the resulting state. Assert specific words only when the story depends on
  them, such as consent or STOP instructions.
- **One system.** One type pairing, a small palette with one accent and one
  spacing scale, as shared tokens. Extend an existing component before adding one.

### Review: two or three passes

Reread the rules above before each pass, then ask:

- What could go with no story losing anything? Remove it.
- What text could be a visual? What visual could be smaller?
- What from the inventory is missing?
- Does the eye land first on what matters most?

Stop when a pass changes nothing. Report the chosen direction in one line, and
anything cut that the user might expect to see.

# Spec reference

The spec format, the generated code and the code built on it. The agent's
loop is the [`sync` skill](.claude/skills/sync/SKILL.md); setup and the stages
of `npm run check` are in [README.md](README.md).

The order and tracker examples live in the [vendored starter](tools/vibespec/README.md). Example paths and bare tool paths in this reference are relative to that starter.

## Writing a spec

`npx spec new <name>` writes a starter `spec/<name>.md` that passes every
stage but `review`. The file name is the module name: `[a-z][A-Za-z0-9]*`,
not `src` or `unproved` (their lock files are the tools' ledgers).
`spec/order.md` becomes `gen/order.ts`; `check` reads every `spec/*.md`.

````markdown
# Order checkout                         <- title, free text

## Story: Check out                      <- a story

> As a shopper, I want to …              <- the story's text

### Only a non-empty draft can be submitted      <- a rule: one checkable sentence

Submitting freezes the order.            <- the rule's prose, optional

```quint
pure def canSubmit(o: Order): bool = o.status == Draft and o.units > 0
pure def submit(o: Order): Order = { ...o, status: Pending }
```
````

| Line | Means |
|---|---|
| `## …` | a story, or any group of rules. Needs at least one rule. Its text runs to its first `###` |
| `### …` | a rule, keyed `<story> / <heading>`, unique in the spec. Needs a `quint` block |
| `` ```quint `` | the rule's formal half; only under a `###` |
| any other fence | prose; `##` and `###` inside it are not headings |
| `####`, bold, anything else | prose of the rule or story above |

A fence is three or more backticks or tildes. It closes only on a line of
the same character, at least as long, with nothing after it, so a fence of
four backticks can hold a ```` ```quint ```` example. A fence is Quint when
the first word of its info string is `quint`.

Quint errors are reported at `spec/<name>.md:line:col`.

### What goes in the Quint blocks

Only types, imports, `pure val` and `pure def`. There is no `var`, no
`action`, and no `init` or `step`: the state machine around your definitions
is generated. The role of a definition comes from its name and signature:

| You write | It is | Generated from it |
|---|---|---|
| `type Order = { … }`, `type Status = A \| B` | the vocabulary | `interface Order`, `type Status = "A" \| "B"` |
| `pure val initial: Order = …` | the initial state; its type is *the state type*. A spec without one is a library | `initial`, `parseState`, and a proof that it satisfies every `always` rule |
| `pure def pay(o: Order, amount: int): Order` | a transition: any `pure def` whose first parameter is the state and that returns the state | `pay(o, amount)`, an `Event` variant `{ type: "pay", amount }`, a case in `step`, `enabled` and `parseEvent`, and proofs that it preserves every rule |
| `pure def canPay(o: Order, amount: int): bool` | the guard of `pay`; takes the state and any subset of its other parameters, matched by name and type | `canPay`, used by `enabled` and `step`. What is proved about `pay` is proved for the cases the guard allows. A guard may call its own transition to look at the result |
| `pure def alwaysPaidWithinDue(o: Order): bool` | a rule that holds in every reachable state | a conjunct of `inv`; simulated and proved |
| `pure def stepNeverGoesBack(before: Order, after: Order): bool` | a rule about every single step | a postcondition on every transition; simulated and proved |
| `pure def stepAuthorized(before: Order, via: str, after: Order): bool` | a step rule that also sees the transition name | a postcondition on every transition |
| `pure def sometimesPaid(o: Order): bool` | a state that must be reachable | a reachability check with a witness trace |
| `pure def lawTotalIsNotNegative(xs: List[int]): bool` | a law: true for every value of its parameters | a function proved to return `true`, and sampled by the simulator |
| `pure val idValues = Set(1, 2, 3)` | what the simulator tries for a parameter named `id`. It must be a set whose elements match the parameter type; any supported Quint is allowed in it | nothing: it never reaches TypeScript |
| any other `pure val` or `pure def` | a constant or helper | the same constant or function |

A transition parameter named `by` identifies its sender. All such parameters
use the same type. It is supplied separately as `enabled(current, event, by)`
and `step(current, event, by)`; it never comes from `parseEvent`. The shell
must validate the authenticated sender before supplying it.

A helper that takes the state first and returns the state would be taken for
a transition. Give it the state as its second parameter, or return something
smaller.

Refused, each with a message saying why: the generated and harness names
(`init`, `step`, `inv`, `enabled`, `parseEvent`, `parseState`, `Event`,
`current`, `event`, `state`, …) and `ProofLib`; JavaScript globals and
keywords (`Number`, `delete`, …); Quint built-ins (`to`, `next`, `all`,
`size`, …); a parameter named like a variant; a variant field called `tag`;
and near-misses of the conventions above such as `alwayspaid` or `CanPay`.

### Using one spec from another

- **`import kernel.* from "./kernel"`** takes a library's names as they are.
  A library is a spec with no `initial`: definitions and laws, or a
  *component* such as an account with `canWithdraw` and `withdraw` and no
  state of its own (`tools/fixtures/account.md` in the vibespec-starter repository,
  used by `bank.md`).
- **`import lamp as L from "./lamp"`** takes any spec under a name, a state
  machine included. A room can then hold two `L::Lamp`s in its state, start
  them from `L::initial`, move them with `L::toggle`, require
  `L::alwaysFlipsAreCounted` of each, and add rules about the pair that
  neither lamp could state (`tools/fixtures/room.md` in the vibespec-starter
  repository).

A spec is imported once, one way or the other, and imports cannot form a
circle. In the generated TypeScript a name from another module is spelled
`<module>_<name>`, for example `lamp_toggle`.

### Supported Quint

| In a spec | In TypeScript | Notes |
|---|---|---|
| `int`, `bool`, `str` | `number`, `boolean`, `string` | Integer literals must fit in 2^53 |
| records | interfaces | Nest as deep as you like |
| `type Status = Draft \| Paid` | `"Draft" \| "Paid"` | |
| `type Parcel = Packed({ weight: int }) \| Lost` | `{ tag: "Packed"; weight: number } \| { tag: "Lost" }` | Read with `match p { \| Packed(x) => … \| _ => … }` |
| `List[T]` | `T[]` | `List(…)`, `append`, `concat`, `length`, `nth`, `head`, `tail`, `select`, `foldl`, and `every`, `some`, `includes`, `listMap` |
| `Set[T]` of simple values | `T[]` that never holds a value twice | `Set(…)`, `union`, `intersect`, `exclude`, `filter`, `map`, `forall`, `exists`, `contains`, `in`, `subseteq`, `size` |
| `str -> T` | `Record<string, T>` | `Map()`, `put`, `get`, `m.keys().contains(k)` |

Also: `+ - * / %`, comparisons, `and or not implies iff`, `if … else`, record
construction, spread update and field access, calls to your own definitions,
and `val` bindings at the top of a definition. Anything else stops the `model`
stage with the name of the construct.

- **`==` compares numbers, strings, booleans and plain variants only.** Compare
  records field by field, and lists with `every`.
- **Guard every partial operation in the definition that uses it.** An index
  outside a list, a missing map key and a zero divisor stop the simulator and
  cannot be proved safe. Test first and give a default, as `problemAt` does
  in the tracker example. For a map the form is exactly
  `if (m.keys().contains(k)) m.get(k) else 0`.
- **`/` and `%` go towards zero**, as in Quint: `-7 / 2` is `-3` and `-7 % 2`
  is `-1`. The generated TypeScript and the proofs agree.
- **There are no loops and no recursion.** To repeat something until done,
  fold over a list that is long enough, as `ancestors` does in the tracker
  example. What needs a real loop is written by hand in `src/` and proved
  there.
- **A set holds simple values only**, and `Set(a, b)` with members that are
  not literals is refused, because the two could be equal: write
  `Set(a).union(Set(b))`. Use a set when duplicates are impossible in the
  real thing and a list when they are not.
- **A map is a lookup table.** It cannot be listed or iterated; keep a list of
  keys beside it, or use a list of records with a key field. An event cannot
  carry one. In the generated state its keys carry a `$` in front, so that no
  key can collide with a property every JavaScript object has.
- **In a `match` arm, use the fields of what the variant carries**
  (`x.weight`), or rebuild the variant (`Packed({ ...x, weight: 2 })`). The
  carried value cannot be passed on whole. `match` must be on a name.
- **`every`, `some`, `includes` and `listMap` are not Quint.** They are
  rewritten into `foldl` before Quint reads the spec, because Quint evaluates
  a definition that takes a lambda wrongly when it is used inside its own
  argument.
- **The simulator tries small values**: integers −1…6, both booleans, three
  strings, every variant of a plain sum type, and short lists and sets of
  those. Define `<param>Values` to choose, which a record or a variant that
  carries data needs.

### Writing good rules

- `always` rules alone are satisfied by a system that does nothing. Add a
  `sometimes` rule for each kind of state a story is meant to make possible.
- A guard that never allows its event makes it impossible, and every rule
  then holds of it trivially. `check` fails when no simulated state allows
  one. It also lists guards it never saw refuse their event: such a guard
  often only restates an `always` rule, which is fine when it protects
  `enabled` from outside input, or refuses only beyond the simulator's 20
  events.
- `always` rules must hold *inductively*: from any state that satisfies all of
  them, every transition must lead to a state that satisfies all of them. If
  simulation passes but `proof` fails on a transition, a fact about which
  states are reachable is unstated. In the order example, "Drafts and
  cancelled orders hold no money" is such a fact: delete it and no simulated
  trace fails, but `submit` can no longer be proved to leave a balance.
- Keep simulation bounds out of guards. A guard such as "stop after day 6"
  ends up in the generated code. Bound the simulator with `<param>Values`.
- Compute something once with a `val` when a rule uses it several times;
  repeated folds are what make simulation slow.

### Review

`npm run accept` records a fingerprint of everything a person has
reconciled; `review` lists what differs. What each status asks of the agent
is in the [`sync` skill](.claude/skills/sync/SKILL.md).

| What | Recorded in, under | Fingerprint of | Statuses |
|---|---|---|---|
| story | `spec/<name>.lock.json`, `## <title>` | its text, whitespace collapsed | `story has no rules`, `new story`, `story changed`, `removed or renamed` |
| rule | `spec/<name>.lock.json`, `<story> / <heading>` | 1. its prose, whitespace collapsed<br>2. its Quint<br>3. the Quint of every rule it relies on | `not formalized` (no Quint), `new`, `prose changed`, `model changed`, `model changed through <names> (<rule>)`, `prose and model both changed`, `removed or renamed` |
| contract | `spec/src.lock.json`, `src/<path>.ts` | its `//@` lines and the declarations they belong to | `new contract`, `contract changed`, `contract removed` |

```mermaid
flowchart LR
  A["rule A"] -- "mentions Order" --> B["rule B<br/>defines Order"]
  B -- "mentions Status" --> C["rule C<br/>defines Status"]
```

A rule relies on every rule whose Quint defines a name (definition, type or
variant) that its own Quint mentions, transitively and across imports. Above,
editing C's Quint makes A and B `model changed through Status (…C)`; a rule in
another spec is named `spec/<file>: <rule>`. A renamed heading is one rule
removed and one new.

Accept records everything or nothing: only when every other stage passes,
every story has a rule and every rule has Quint.

### When a proof does not go through

Dafny proves arithmetic and simple list facts on its own. It usually cannot
prove a rule that depends on a fold, a count or a search without help. When
`proof` lists obligations as "not proved" although simulation found nothing,
for each one, in this order:

1. **Prove it** in the unit's proof file (next section). This is the agent's
   work, like any other translation.
2. **State the missing fact**, if the obligation is false for some state that
   satisfies every rule: no proof can help then. Add it as an `always` rule
   or a law (the inductiveness case above). Moving arithmetic into a small
   function with a law in a library spec, or writing a loop by hand in
   `src/`, also gives Dafny smaller steps.
3. **Accept simulation for it**: the user's decision, never the agent's, and
   only for a spec unit: nothing simulates hand-written code, so a `src`
   unit's obligations must be proved.
   `npm run accept -- unproved` records the obligations in
   `spec/unproved.lock.json`, per unit, with a fingerprint of the unit's text
   and proof file. The check then passes and says how many obligations are
   simulated only. It fails again if a *new* one appears, or if the unit or
   its proof file changes: what was accepted for one text does not carry over
   to another. Read the list before recording it: an obligation that is false
   is also "not proved".

Counting is per obligation. Dafny checks every `ensures` on its own, a
failing one is never assumed while another is checked, and the prover works
to a fixed resource limit (`RESOURCE_LIMIT` in `tools/prove.ts`) rather than a
time limit, so the answer does not depend on the machine. An obligation it
could not finish is marked `[the prover ran out of resources]`. A lemma
assumes what every lemma it calls ensures, so an obligation whose proof calls,
directly or through helpers, a lemma with an obligation not proved is not
proved either, and is marked `[rests on <that obligation>]`; the body the
tools give `step_ensures` is no exception. The total is the number of
`ensures` in the unit's generated Dafny. A proof line that relies on
obligations simulated only lists them.

### Proof files

`spec/<name>.proof.dfy` proves obligations of `gen/<name>.ts`;
`src/<path>.proof.dfy` proves those of `src/<path>.ts`. A proof file that
belongs to no unit is reported.

**What the prover sees** is `gen/proof/<unit>/<unit>.dfy`, written by every
`npm run check`, and Dafny's full output is `gen/proof/<unit>.log`. The file
is, in order: what LemmaScript generated (the modules the unit imports, with
names prefixed `<module>_` and without their obligations, then the unit
itself), the bodies the proof file supplied, the lemmas the tools add, the
proof file's helpers, and the library. Each obligation is one `ensures` of a
generated `lemma <fn>_ensures`: for a transition, one per `always` and `step`
rule, each conditional on `inv` and the guard; for a law, `<law>(...) == true`.

**Grammar.** A proof file holds only `lemma` declarations, each with a body,
and `//` comments. Anything else is refused with its file and line. A lemma
runs to the next `lemma`, and its body is the brace group it ends with, after
a complete header: the set display in `decreases {0}` or `x in {1}` is never
a body.

- A lemma named like a generated `<fn>_ensures` supplies that lemma's body.
  Its header must repeat the generated one exactly; copy it from the `.dfy`
  (whitespace and comments do not matter). When a rule changes, the header
  changes, and the old body is refused as stale.
- Any other lemma is a helper, added after the generated text. Its name must
  not be one the `.dfy` already declares.
- Inside bodies: `assert`, `assert … by`, `calc`, `forall … ensures`, `if`,
  `match`, `var`, `reveal`, calls to lemmas, and the attributes `{:trigger}`
  and `{:induction}`.
- Names from Dafny's standard library (`Std.…`) only as the generated code
  writes them, such as `Std.Collections.Seq.All`: the library holds axioms,
  and `dafny audit` does not report them in the unit. `ProofLib.<Name>` only
  for what `tools/proof/lib.dfy` declares.
- Refused: block comments, `@`, any other attribute, character literals, NUL,
  anything but ASCII outside comments and strings, and the words that
  declare or trust something: `assume`, `expect`, `function`, `predicate`,
  `method`, `ghost`, `const`, `type`, `datatype`, `include`, `import`,
  `module`, `reads`, `modifies`, `opaque`, `axiom`, `verify` and the rest of
  `FORBIDDEN` in `tools/prove.ts`.
- After that, LemmaScript refuses the `.dfy` unless it is its own output plus
  added lines, and `dafny audit` refuses anything assumed rather than proved.
  A failure anywhere but in a generated definition (a helper, the library, a
  lemma the tools add) fails the unit; it is never counted as an obligation.
  The tools know which definition each line of the `.dfy` belongs to from
  where they put it, and read only Dafny's own messages: at the start of a
  line, without source lines echoed, and as many as Dafny counted.

**What a proof can call:**

- `ProofLib.<Name>(...)` from `tools/proof/lib.dfy`, added to every unit that
  has a proof file: `Filter` (a heap-free view of `Std.Collections.Seq.Filter`,
  see below), `Distinct`, `DistinctBy`, and lemmas about filters
  (`FilterNil`, `FilterCons`, `FilterAppend`, `FilterMember`, `FilterSubset`,
  `FilterNone`, `FilterOne`, `FilterTwo`, `FilterCountOneIffUnique`,
  `FilterDistinctCountOne`, `FilterKeepsDistinctBy`, `FilterLengthPointwise`,
  `FilterPointwise`, `FilterSamePredicate`, `FilterOfFilterShorter`) and folds
  (`FoldLeftMax`, `FoldLeftPointwise`, `FoldLeftConcatEmpty`, `FoldLeftDedupDistinct`).
  Read the file for what each states. A lemma general enough for any project
  belongs there, with its proof; one about your spec belongs in your proof
  file.
- A law of an imported module, if its own unit proved it in the same run,
  neither simulated only nor resting on an obligation that is:
  `<module>_<law>_ensures(args)` gives `<module>_<law>(args) == true`. (In a
  `src` unit, the laws of the module it imports are `<law>_ensures`.)
- The generated `_ensures` lemmas, and Dafny's standard library by the names
  the generated code uses.

`step_ensures` gets a body from the tools that calls each transition's lemma;
supply one to replace it.

**Two Dafny facts** shape most proofs about lists:

- `Std.Collections.Seq.Filter` is opaque and reads the heap, so a fact about it
  proved in a lemma does not meet the same call inside a generated rule.
  State facts about `ProofLib.Filter`, and connect them to the rule with a
  helper whose `ensures` is the rule's body with `ProofLib.Filter` in place of
  `Std.Collections.Seq.Filter`; it proves with an empty body:
  `lemma KeysBridge(r: Registry) ensures alwaysAKeyNamesOneProject(r) == Std.Collections.Seq.All(r.entries, (a: Entry) => (|ProofLib.Filter((b: Entry) => (b.key == a.key), r.entries)| == 1)) { }`.
- A lambda is the same term only if it is the same text: pass the lambda the
  generated code uses, copied verbatim from the `.dfy`.

**To prove an obligation:**

1. Find its lemma in `gen/proof/<unit>/<unit>.dfy` (the check names the
   definition and the clause).
2. Copy the lemma's header into the proof file and write a body. For a
   transition, the usual shape is
   `if inv(s) && canX(s, …) { var after := x(s, …); …facts about after… }`.
3. Run `npm run check`. Dafny's messages point into the `.dfy`; the log has
   them all.

`tools/fixtures/highest.md` is the smallest example: its law needs induction
over a fold, and this proof file proves it (the selftest runs it):

```dafny
lemma lawTheHighestIsAtLeastTheStart_ensures(xs: seq<int>, start: int)
  ensures (lawTheHighestIsAtLeastTheStart(xs, start) == true)
{
  ProofLib.FoldLeftMax((top: int, x: int) => (if (x > top) then x else top), start, xs);
}
```

## Using the generated code

`gen/<name>.ts` exports your types, constants and functions under the names
you gave them, and for a state machine:

```ts
type Event = { type: "addItem"; qty: number } | { type: "submit" } | …
function parseEvent(x: unknown): Event | undefined   // an untrusted value as an event, or not
function parseState(x: unknown): Order | undefined   // an untrusted value as a state that satisfies inv, or not
function enabled(current: Order, event: Event): boolean  // do the rules allow event now?
function step(current: Order, event: Event): Order       // apply event; unchanged if not allowed
function inv(current: Order): boolean                    // every always-rule at once
```

Every definition from the spec carries a doc comment naming its rule and spec
line.

- Import with the `.ts` extension, as Node requires:
  `import { type Event, enabled, step } from "../gen/order.ts";`
- **Pass everything that arrives from outside through `parseEvent` or
  `parseState`.** The proofs assume whole numbers and plain data.

  | | Accepts | Extra fields |
  |---|---|---|
  | `parseEvent` | safe integers, sets without duplicates | dropped |
  | `parseState` | the state's exact shape, safe integers, sets without duplicates, and `inv` holds | refused |

  Both return a fresh copy, so nothing the caller keeps can change it
  afterwards.
- Calling a transition directly (`pay(o, 5)`) is only meaningful when its
  guard holds. Application code goes through `enabled` and `step`, as
  `src/app.ts` does.
- `gen/` is rebuilt by `bun run gen` and `bun run check`. The starter package
  also generates its own example during installation.

## Hand-written verified logic

Put logic in the spec when you can: it is then simulated, proved and
generated. For pure logic that Quint cannot express, such as a loop over an
event log, write TypeScript under `src/` with
[LemmaScript](https://github.com/midspiral/LemmaScript) annotations.
`src/ledger.ts` is the worked example.

- Any `.ts` file under `src/` that contains `//@` is proved by
  `npm run check`, as the unit `src-<path>`. Its `//@` lines are its
  contract, reviewed like a rule (see [Review](#review)).
- Such a file may import one generated module and nothing else, and only by
  name: no `as`, default or namespace import. Its annotations may mention
  anything that module defines (`inv`, guards, rules), imported or not.
- At the top level it may hold only imports, functions with a body,
  interfaces, type aliases and `const` declarations, each exported in its own
  declaration (`export function`, `export const`, …) or not at all: no
  `export { … }`, `export default` or statements. The proof reads names as
  written, and LemmaScript does not model what such statements do at run time.
- `//@` must be in a `//` comment, never in a block comment or a string. In
  any other script under `src/` (`.mts`, `.cts`, `.tsx`, `.js`, `.jsx`,
  `.mjs`, `.cjs`) it is an error.
- Allowed annotations: `backend`, `pure`, `requires`, `ensures`, `invariant`,
  `decreases`, `type`, `ghost`, `assert`. Any other, such as `assume`,
  `extern`, `havoc`, `skip` or `verify`, is refused wherever on a line it
  appears.
- Keep I/O, classes and libraries out of these files; put them in the shell.
- When a proof fails, the summary names the function and the annotation, and
  the full Dafny output is in `gen/proof/<unit>.log`. A proof that needs more
  than annotations goes in `src/<path>.proof.dfy` (see "Proof files").
- Such a unit is proved against the definitions of the module it imports.
  If that module has obligations that are simulated only, its proof line says
  that it is proved assuming them, and lists them. Its own obligations must
  be proved.

Tests for the shell: see [Tests](#tests) above.

## Using it from another package

The toolchain is a package with a `spec` command, installed from a path or
a tarball made with `npm pack`.

```sh
npm install --save-dev /path/to/vibespec-0.1.0.tgz
npx spec init          # adds what is missing; updates only its own marked instructions
npx spec new <name>    # a starter spec/<name>.md
npm run check
```

| `spec init` adds | |
|---|---|
| `.claude/skills/sync/`, `.claude/skills/design/`, `AGENTS.md`, `CONTRIBUTING.md` | the agent's procedure and this reference; existing AGENTS content is kept around a marked Vibespec section |
| `CLAUDE.md` | imports `AGENTS.md`, preserving any existing instructions |
| `tsconfig.json`, `spec/` | |
| `.gitignore` | `gen/`, `.spec-cache/` |
| `package.json` scripts | `check`, `gen`, `accept` |

`spec` works on `spec/*.md`, and optionally `src/`, the package's
[tests](#tests) and a `tsconfig.json`, in the directory it is run from. Without a `tsconfig.json`, a package containing `src/` or `test/` fails the
types stage; a spec-only package reports that there is no code to typecheck. To hand the generated code to another package, compile `gen/*.ts`
with `tsc`; it has no dependencies.

## Large applications

- **One spec per area**, each a few hundred lines: a state machine for each
  thing that has a life cycle, libraries for what they share, and machines
  that import machines where rules span them. `check` runs them in dependency
  order and proves each against the *definitions* of what it imports, not
  their proofs, so the cost of a proof grows with the spec, not with
  everything beneath it.
- **Only what changed is checked again.** Each passing simulation and proof
  result is kept in `.spec-cache/` under a fingerprint of the spec, everything it
  imports and the versions of the tools.
- **The spec covers the rules, not the plumbing.** Chat, HTTP and storage stay
  hand-written around the generated core, as `examples/dashboard/src/notify.ts`
  does for sending messages.

## Checking harder

Simulation is seeded from what it simulates, so a run repeats exactly. A
failing `always` rule or an unreached `sometimes` goal prints its seed and the
`npx quint run` command that replays it.

To check a model exhaustively up to a depth with the Apalache model checker
(needs Java 17+, downloads Apalache on first use):

```sh
npx quint verify gen/order.run.qnt --main order_run --invariant inv --max-steps 10
```

## Changing the tools

These paths are relative to `tools/vibespec/`:

| File | Role |
|---|---|
| `tools/spec.ts` | the pipeline and the `spec` command |
| `tools/parse.ts`, `tools/review.ts` | literate specs and the review ledgers |
| `tools/cache.ts`, `tools/run.ts` | stage caches and bounded tool execution |
| `tools/units.ts`, `tools/simulate.ts` | generation, proof units, simulation and replay |
| `tools/util.ts` | source discovery, test execution and citations |
| `tools/prove.ts` | proves one unit: checks and splices the proof file, runs LemmaScript and `dafny audit`, and rechecks alone every postcondition a failing one could hide |
| `tools/proof/lib.dfy` | the library proof files call |
| `tools/gen.ts` | the translator: reads what a module imports and defines |
| `tools/gen/types.ts` | everything decided by a type |
| `tools/gen/print.ts` | expressions |
| `tools/gen/classify.ts` | which definition is a transition, a guard or a rule |
| `tools/gen/typescript.ts`, `tools/gen/harness.ts` | the two outputs |

Node runs all of it directly; `npm run build` compiles it for the packaged
`spec` command.

`check(root)` returns `{ ok, results, next }`, and `spec check --json` prints
that object. Each result has `ok`, `stage` (a stage, or `skipped`),
`summary`, `detail` and, when it concerns one, `where`; `next` is the line
the command line ends with. `npm run selftest` builds scratch projects from
this project's spec or from `tools/fixtures/`, breaks one thing at a time and
asserts which stage catches each. Add a case for every new kind of mistake a
change is meant to catch.
