# Runbook: the simulation

This runbook tells you how to run the simulated world, read its results, and change it. It covers the Observatory game mode, headless experiments, per-app runs for the four apps (ntwrk, slop, peon, friends), scenarios, the synthetic dataset, and the tests to run before a PR.

Design: [network.md](network.md) (the ConsentNetwork), [observatory.md](observatory.md) (the Observatory). Latest numbers: [results/2026-10-07-network-consent.md](results/2026-10-07-network-consent.md). The real (non-simulated) side: [runbook-real.md](runbook-real.md).

Every command below was run on 2026-10-07 from the repository root, unless the step says `cd`.

## 1. What the simulation is

| Part | Where | What it does |
|---|---|---|
| Synthetic members | `data/synthetic/v1` | 500 members (250 SF, 250 NYC) with public profiles and hidden truth. The Network runs use the 250 NYC members. |
| World | `packages/sim/src/world.ts` | Runs members in simulated time (`SimClock`), delivers messages, decides outcomes, writes run records |
| Persona agents | `packages/sim/src/agent/` | Decide how each member replies (deterministic policy). An optional LLM writes the words. |
| Oracle | `packages/sim/src/oracle.ts` | The hidden answer key: who would accept, show up and enjoy a meeting |
| Network | `packages/network` | The ConsentNetwork under test ([network.md](network.md)) |
| Engine | `packages/engine` | engine-v1, called by the Network once a day |
| Judge | `packages/sim/src/judge` | Counts invariant violations, canary leaks, minor contacts and other metrics from run records |

The Network never reads hidden truth. Only `packages/sim`, the oracle, the judge and `packages/network/harness` read it.

No step in this runbook calls an LLM unless it says so. The persona agents use the deterministic policy, and the Network calls the engine without an LLM, so the engine judges do not run.

## 2. Play the world in the Observatory (game mode)

### 2.1 Start it

```bash
bun install
bun run observatory
```

The server prints one line:

```
The Network Observatory → http://127.0.0.1:4747/#token=<random token>  (mode: game)
```

1. Open that URL. The page keeps the token for the browser session and removes it from the address bar.
2. If the page shows "Token required", paste the token from the terminal.
3. To keep the same token across restarts, set it: `OBSERVATORY_TOKEN=<your token> bun run observatory`.

The server listens on 127.0.0.1 only. Every `/api/*` route and the `/ws` WebSocket need the token. The printed token is an admin token, so you see every tab. To see what another role sees, start the server with role tokens: `OBSERVATORY_TOKENS="admin:<32+ chars>,reviewer:<32+ chars>,..." bun run observatory` (every token needs 32 or more characters), then open `http://127.0.0.1:4747/#token=<the reviewer token>`. `?token=` is refused. See [observatory.md](observatory.md) sections 8 and 9 for the access rules.

The server writes an audit row for each member, timeline or opportunity read and each staff action, to `runs/audit/audit.jsonl` (`OBSERVATORY_AUDIT_DIR` changes the folder).

### 2.2 Options

Pass options after the script name: `bun run observatory --review human --port 4793`.

| Option | Default | What it does |
|---|---|---|
| `--review auto\|human` | `auto` | `auto`: the simulated reviewer approves each queued opportunity. `human`: you are the reviewer. Nothing reaches a member until you approve it. |
| `--level <id>` | none | Start a scenario as a level (list in section 4) |
| `--seed N` | 1 | World seed |
| `--days N` | 60 | Length of the world |
| `--network consent\|stub` | `consent` | The Network under test. `stub` is the simple simulator Network. |
| `--city nyc\|all` | `nyc` | NYC members only, or all 500 |
| `--personas N` | 0 | 0 uses the synthetic dataset. N > 0 generates N members. |
| `--engine engine-v1\|random` | `engine-v1` | The engine, or the random baseline |
| `--port N` | 4747 | Port |
| `--mode game\|real` | `game` | Start in real-world mode instead ([runbook-real.md](runbook-real.md)) |
| `--time-aware` | off | Personas answer offered times and booked plans from a hidden week, and a clashing meeting time stops attendance (section 6.1.2). The banner says "time-aware". Use it to see booked plans cancelled and time picks that differ by member. |

### 2.3 Review mode

- With `--review auto`, the Review tab is hidden. Each item shows "Approved by sim_auto_reviewer".
- Switch the reviewer to **You** in the Review tab or in Game → Your run. The queue then fills.
- Review keys: `j` and `k` move, `a` approves, `e` edits the text, `s` then `1`-`6` re-rolls (swaps out that participant), `r` then `1`-`8` rejects with a reason code (PRD 32.8), `n` adds a note, `x` shows the score, Enter opens the opportunity, Esc steps back.
- An edit is leak-checked. A refused edit shows its code (for example `edit_leak`) under the card.
- A re-roll swaps in the best eligible alternate, and the item waits again with a new deadline. With no alternate, the item closes and the engine composes again.
- Approve runs the gates again. If one fails, nobody is contacted and Decided shows "stopped on re-check (reason)".
- The time you spend on a card is recorded with the decision.
- An item that passes its SLA (12 hours, or 1 hour for same-day) expires. It shows as "Expired unsent" in Decided.
- Approve is blocked when a participant is under 18 or has an unknown age, and while matching is off (Config tab, admin only).

### 2.3.1 One world per app

The Observatory has an app switcher (ntwrk, slop, peon, friends, all). Each app has its own simulated world, started when someone first opens that app. Open an app with the switcher or the URL hash, for example `http://127.0.0.1:4747/#a=slop`. Every `/api` request carries `?app=` (default ntwrk).

- Every app's world uses the NYC synthetic members and The Network's engine, with that app's brand words and join age.
- In every app, personas whose stated age is under 13 never join (13+ may join every app; matching is 18+). Before 2026-10-08 slop, peon and friends had a join age of 18, and personas whose stated age was under 18 never joined (the app's join age; a persona that lies about its age can still join, and the Network's age rules then apply). In ntwrk, personas under 13 try to join and the Network declines them.
- slop and peon run with matching off ("matching off until pack"). Joins, onboarding and safety still run. The matching switch answers 409 `matching_locked`.
- "all" shows one line per app (members, review backlog, SLA misses, send failures, matching). It does not start a world.
- The levels (2.4) are ntwrk scenarios. In other apps, the join-age filter can remove part of a level's cast.
- To see one app only, start the server with a per-app token: `OBSERVATORY_TOKENS="admin@*:<32+ chars>,reviewer@slop:<32+ chars>" bun run observatory`, then open `http://127.0.0.1:4747/#token=<the slop reviewer token>`. The slop reviewer sees slop only.

Checked on 2026-10-08: with a `reviewer@slop` token, `/api/me?app=slop` listed `apps: ["slop"]`, `/api/state?app=ntwrk` gave 403, `?app=foo` gave 400, and the matching switch on slop gave 409 `matching_locked`.

### 2.4 Levels

The Game tab lists the levels (the NYC scenarios, section 4). Pick one to restart the world with that scenario's cast and script. Or start with `--level <id>`. The scenario checks show in the Game tab as the world plays.

### 2.5 Controls

Space plays or pauses. `n` steps one hour, `d` one day. `/` searches, `?` shows help, `g` switches map and graph. Esc steps back one level (popover, search, picks, focus).

## 3. Run experiments without the UI

### 3.1 Compare the three Networks

```bash
bun run packages/network/harness/experiment.ts --days 21 --seed 1
```

It runs three arms on the 250 NYC members and prints one JSON object on stdout:

| Arm | What it is |
|---|---|
| `push_baseline` | `StubNetwork` with engine-v1: intros go straight to members |
| `push_v2` | ConsentNetwork with probes, gates and growth off |
| `consent` | ConsentNetwork as designed |

Each arm took 3-8 seconds for 21 days on a laptop on 2026-10-07, and up to about 110 seconds when the machine was heavily loaded. Runs are deterministic: the same command on the same code gives the same JSON.

| Option | What it does |
|---|---|
| `--only consent` | Run some arms only (comma-separated) |
| `--live-asks` | Personas ask only for wants that are still live in hidden truth |
| `--primed-identity X` | Reveal acceptance after a probe yes (default 0.95) |
| `--primed-met X`, `--primed-partial X` | Acceptance for members who asked (defaults 0.96, 0.82) |
| `--max-new N` | Most new engine opportunities a day (default 20) |
| `--time-aware` | Personas answer offered times and booked plans from a hidden week, and a clashing meeting time stops attendance (section 6.1.2) |
| `--plans on\|off` | The Network's planner and plan lane (default `on`; [network.md](network.md) 5.3) |
| `--sim-plans on\|off` | Plan-aware personas (answers to plan probes, the weekly check-in, crew offers). Default: on when `--plans` is on. Use `--plans off --sim-plans on` as the fair "plans off" arm. |
| `--capital` | Attach an NC ledger and its levers (`capitalWiring()`, [network.md](network.md) 7.1). The JSON gets the ledger event counts. |

The JSON also reports the plan counters (plans proposed, probes, yes, booked, crews) and the plan safety checks (names before booking, minors in plans, reveals before quorum, the most plan and intro invites per member in 7 days). Checked on 2026-10-08: `--only consent --days 1 --seed 1 --capital` and `--plans off --sim-plans on` both ran with 0 canary leaks and 0 minor contacts.

The metrics are defined in the results doc, section 2. Every arm also reports `judge` (invariant violations by rule, canary leaks, minor contacts, from `computeMetrics`) and `scorecard` (PRD 28.2 proxies: worthwhile interruptions, opt-in, completion, first good meeting within 14 days). The Observatory lab can call `experiment.ts` directly. On a booked plan, the everyone-yes and accept rates count each member's own decision (silence is a yes). Latest numbers: [results/SUMMARY.md](results/SUMMARY.md) ("ConsentNetwork send defaults", before and after the send path) and [results/2026-10-07-network-consent.md](results/2026-10-07-network-consent.md) section 12 (all three arms on the current code).

### 3.2 The simulation lab (background runs)

The Lab tab in the Observatory runs the same three arms in the background: one child process of `packages/network/harness/experiment.ts` per seed, so the numbers are the ones section 3.1 gives, with the judge counts (invariant violations, canary leaks, minor contacts). It needs the analyst or admin role, and it is off on a real-only server.

1. Open the Lab tab in the app you want (the run records its app).
2. Pick the arms, 1-5 seeds and 1-60 days.
3. Start the run. At most 2 seeds run at a time. The list updates every 3 seconds.
4. Read the results. A red number is a safety count above 0.

Results are saved to `runs/lab/<id>.json`. A run's status changes only after its file is written. The analyst, engineer or admin role for the app can start a run.

Per app: `POST /api/lab/run?app=slop` with `{"arms":["consent"],"seeds":[1],"days":1,"app":"slop"}`. Every app runs The Network's NYC world; slop and peon runs still get `--max-new 0` (no new engine opportunities). That is stale: their packs are wired, so the lab should run them with `slopPack` and `peonPack` (docs/mvp-gaps.md, critical path item 6). There is no 18+ join gate in the lab yet. Checked on 2026-10-08: a 1-day slop run as `engineer@*` finished with 0 judge invariants, canary leaks and minor contacts.

One seed without the UI is the same command the lab runs:

```bash
bun run packages/network/harness/experiment.ts --only consent --days 1 --seed 1
```

It prints the experiment JSON (indented) with a `judge` object per arm. On 2026-10-07 the 1-day consent run gave `{"invariants":0,"byRule":{},"canaryLeaks":0,"minorContacts":0}` in about 1 second.

### 3.3 The Observatory report

```bash
bun run packages/observatory/src/report.ts --days 14 --seed 1
bun run packages/observatory/src/report.ts --days 2 --review human
```

It plays the game world headless and prints JSON: the review gate counts, the judge counts (invariants, canary leaks, minor contacts), the proposal funnel, engine runs by day, the learned graph and the scoreboard. With `--review human` nobody reviews, so every queued item expires unsent. Use that to check the gate.

### 3.4 The simulator CLI (StubNetwork)

```bash
bun run packages/sim/src/cli.ts --personas 150 --days 30 --mode discrete --seed 1 --network stub --engine ./packages/sim/src/engineAdapter.ts
bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/stop-keyword.json --k 4
```

The CLI runs only the `StubNetwork`. Use the harness (3.1, section 4) or the lab (3.2) for the ConsentNetwork. Details: [packages/sim/README.md](../packages/sim/README.md).

### 3.5 Per-app runs in code

`harness/experiment.ts` has no `--app` flag. Pass the app as a Network option instead (`NetworkOptions.app`, [network.md](network.md) 1.3). Write a script outside the repository (for example in your scratch folder):

```ts
import { runArm } from "/path/to/repo/packages/network/harness/experiment.ts";
const r = await runArm("consent", { days: 2, seed: 1, network: { app: "friends" } });
console.log(JSON.stringify({ arm: r.arm, judge: r.judge }));
process.exit(0);
```

Checked on 2026-10-08 (2 days, seed 1): `{"arm":"consent","judge":{"invariants":0,"byRule":{},"canaryLeaks":0,"minorContacts":0}}`. The app changes the copy and the join age only. It runs the NYC world and The Network's engine.

What does not exist yet:

- Per-app simulated worlds (slop daters, peon candidates and employers, friends crews) and their oracles. The engine session owns the app packs and their sim packs (PRD 40.8). The slop world is on `origin/main` (`packages/sim/src/apps`); this worktree does not have it yet.
- The `cross_app_leak` judge invariant. `packages/network/test/crossapp.test.ts` checks one two-app world (ntwrk and friends) in a test.
- STOP versus STOP ALL and person-to-person blocks in the simulator. The simulator runs one network.

## 4. Scenarios

A scenario is a scripted situation on the NYC world with checks that must pass.

```bash
bun run packages/network/harness/scenarios.ts                 # all scenarios
bun run packages/network/harness/scenarios.ts under_13_join   # one scenario
```

Output: `PASS <id>` or `FAIL <id>`, then each check.

| Id | Title | Days |
|---|---|---|
| `spam_wave` | Spam wave | 4 |
| `sales_pitch` | Sales pitch | 3 |
| `scam_money` | Money request | 3 |
| `contact_extraction` | Contact extraction | 3 |
| `prompt_injection` | Prompt injection | 3 |
| `harassment` | Pressure after a meeting | 3 |
| `block_abuse` | Block and report abuse | 4 |
| `corroborated_report` | Corroborated reports | 4 |
| `minor_signal` | Age signals | 4 |
| `under_13_join` | Under 13 tries to join | 4 |
| `stated_minor_first_message` | "Hi, I'm 15" | 4 |
| `request_fulfilled` | Ask and receive | 5 |
| `plans_buddy` | Plans for the weekend | 3 |
| `newcomer_wave` | Bring your friends | 7 |
| `bad_invitee` | A bad invitee | 7 |
| `traveler` | Out of town | 8 |

Every scenario uses the simulated reviewer (`review: "auto"`) and seed 7. The network tests run all of them. The Observatory offers all of them as levels.

### 4.1 Add a scenario

1. Open `packages/network/harness/scenarios.ts`.
2. Add an object to `SCENARIOS` with `id`, `title`, `description` and `days`.
3. Write `setup(personas, start)`. Pick the cast with the helpers (`adults()`, `nth()`). Return the member ids and the scripted actions (`say(id, text)` at `at(start, day, hourNy)`).
4. To script a member's first message, return `joinText`. To make invitees bad actors, return `badInvitees: true`.
5. Write `check(ctx)`. Return one check for each thing that must be true. Use the run records (`ctx.records`), the Network (`ctx.net`) and the cast (`ctx.ids`).
6. Run it alone: `bun run packages/network/harness/scenarios.ts <id>`.
7. Run the network tests (section 8). The new scenario runs there and shows as a level in the Observatory with no other change.

A bug fix needs one scenario or test that fails before the fix and passes after it (CONTRIBUTING.md 3.4). One is enough.

## 5. The synthetic dataset

Owner: the synthetic-data maintainer (`scripts/synthetic`, `data/synthetic`). Do not change it in a Network or Observatory PR. Ask the owner.

- `scripts/synthetic/generate.ts` makes `data/synthetic/v1`. Everything except the LLM text is a pure function of the seed. LLM text comes from `defaultLLM()` (gpt-6-luna) and is cached in `runs/synthetic-cache/`.
- `scripts/synthetic/validate.ts` checks the dataset against the core types and the privacy and safety rules.
- The hidden truth is in `hidden_truth.jsonl`, separate from the public files.

**Caution:** `generate.ts` without `--dry-run` overwrites `data/synthetic/v1`. `validate.ts` without `--out` writes `data/synthetic/v1/validation.json`.

```bash
bun scripts/synthetic/generate.ts --dry-run                  # cache hits and misses; writes nothing; no API calls
bun scripts/synthetic/validate.ts --out /tmp/validation.json # runs every check; exits 1 on a failure
```

A new dataset version changes every baseline. Re-baseline (section 7) in the same PR.

## 6. Change the simulation

### 6.1 Add a persona behavior

Persona decisions are in `packages/sim/src/agent/policy.ts`. The `sim` package has its own owner; agree the change with them first.

1. To change how a persona answers a message, edit `decide()`. It switches on the message type (`meta.type`: `probe`, `proposal`, `question`, `growth_ask`, and others).
2. To change what a persona starts on its own (asks, travel notices, attacks), edit `policyInitiative()`.
3. Take accept, decline and show-up decisions from the oracle (`ctx.oracle`), not from an LLM. LLM users over-accept.
4. Add a new behavior behind an option in `PolicyOptions` that is off by default (like `liveAsksOnly`). Existing baselines then do not move. Turn it on in a separate PR with a re-baseline.
5. Keep the LLM agent (`llmAgent.ts`) for words only.

### 6.1.1 Persona behaviors behind options

These options are in `PolicyOptions` (`packages/sim/src/agent/policy.ts`). All are off by default, so existing baselines do not move. With them off, seeds 1 and 2 gave the same run-log hash before and after they were added.

| Option | What it does |
|---|---|
| `liveAsksOnly` | Personas ask only for wants that are still live in hidden truth. CLI: `--live-asks` on the experiment. |
| `primeProbes` | A persona who asked for a category in the last 7 days answers a probe in that category that names its participants as it answers a named invitation (`oracle.evaluatePrimed`, basis "ask"). Other probes use the cold `oracle.probe` model. |
| `reactions` | Tapbacks. A message that offers outside-world items (`SimMeta.items` on a "concierge" or "info" message) gets an answer with a probability from the persona's hidden interest in the items. Some short acknowledgements of any message become tapbacks ("👍" like, "❤️" love). A tapback reaches the Network as an inbound message with an emoji body, `SimMeta.reaction`, and an extra `reaction` field on `InboundMessage`. |
| `plans` | Plans v1.1 (`packages/sim/src/plans.ts`, also `WorldOptions.plans`). A persona answers an anonymous plan probe (`meta.type` `"plan_probe"`) with picks or "can't make that time", answers "What's your week like?" with free windows, answers the one-time WEEKLY offer, answers crew offers (`"crew_offer"`), and answers "Would you do this again?". `WorldOptions.plans` also scores plan meetings with the plan oracle and turns on the `planAgainEdges` snapshot feature. Options (`PlanAgentOptions`): `windowPriming` (default true; an assumption, not a measurement), `weeklyOptIn`, `capture`. With it off, run logs are byte-identical to before. The experiment turns it on with `--plans on` (the default). |
| `timeAware` | Time awareness. Each persona has a hidden weekly availability (`agent/availability.ts` `hiddenFree`, from its routine: waking hours, busy blocks, free evenings, weekend or weekday, one-off commitments, trips). The persona answers offered times (`SimMeta.timeOptions`) with the options it is free for. It answers a booked-plan reveal (`SimMeta.booked`) with opt-out semantics. It answers a scheduled time that clashes with "can't make it". See section 6.1.2. |

Menus need no option. When a Network puts `SimMeta.menu` on a message, the persona replies with the key of the best option it would accept, "none", or nothing. An option with a `proposalId` is judged as a named invitation, and picking it is a yes. No Network sends menus today.

There is no CLI flag for `primeProbes`, `reactions` or `timeAware`. Turn them on in code:

```ts
new World({ ...options, policy: { primeProbes: true, reactions: true } });  // the default PolicyPersonaAgent
new PolicyPersonaAgent(start, { primeProbes: true, reactions: true });       // or an explicit agent
new LLMPersonaAgent(llm, start, { policy: { timeAware: true } });           // the LLM agent takes the same options
new World({ ...options, timeAware: true });  // attendance, and timeAware for the default persona agent
new StubNetwork({ seed, timeAware: true });  // stub meeting times from availability
```

Measured on the ConsentNetwork (150 NYC personas, 14 days, seeds 1-4, no confidence intervals): probe yes share 0.315 with neither option, 0.407 with `primeProbes`. Meetings held: 65, 81, and 77 with both options (140 tapbacks).

Limits:

- The ConsentNetwork reads a tapback as a short inbound message. It sets no `items` and sends no menus.
- The LLM persona agent takes the same options (`LLMAgentOptions.policy`). It sends menu answers (the key or "none") and tapbacks as the template text, with no model call. The Observatory takeover does not prime probes or tap back, and answers menus with free text.
- The answer and tapback probabilities and the 0.6 menu weight are estimates, not calibrated. Only the item interest values (1 and 0.2) come from the reference model.

### 6.1.2 Time awareness (`timeAware`)

Three flags. All are off by default. With all three off, the run log is identical to the run log before they were added (stub with random intros and stub with engine v1, seeds 1 and 2, 150 personas, 21 days, `reactions` and `primeProbes` on: same hash).

| Flag | Where | What it does |
|---|---|---|
| `PolicyOptions.timeAware` | persona agents | Answers to times, booked plans and clashing times (below). |
| `WorldOptions.timeAware` | `World` | Time-dependent attendance (below). It also turns on `PolicyOptions.timeAware` for the default persona agent. |
| `StubOptions.timeAware` | `StubNetwork` | The stub picks the meeting slot from availability instead of 19:00 two days after the last yes (below). |

**Hidden availability.** A 2-hour slot is free when it starts between waking + 1 hour and 2 hours before bedtime, and the day has no one-off commitment (p = 0.15 per day). Evenings (from 17:00) are free on the routine's free evenings, and on 30% of other weekend evenings. Weekday daytime is free outside the busy blocks, then half the time. Weekend daytime is free 60% of the time. A persona on a trip is not free for a meeting in another city. The draws are the same as the engine harness's `hiddenAvailability` (`packages/engine/experiments/attention.ts`), so both give the same answer for the same seed. The Network never sees this.

**Answers to time options** (`SimMeta.timeOptions`: `{ key, start, end, label }[]`, 2-3 options, keys "a", "b", "c"). The persona decides yes or no as before (probe, proposal or scheduling message). A yes names the options it is free for. The template words take these forms, and the first sentence always carries the answer:

| Picks | Example words |
|---|---|
| none | "Neither works this week, sorry." (2 options), "I'd be up for it, but none of those times work." (3 options) |
| all | "Either works for me.", "Any of those, either is fine." |
| one | "Thursday works.", "Thursday 7pm works for me.", "The first one works." |
| two of three | "Thursday or Saturday works.", "a or c works for me.", "Thursday 7pm or Saturday 10am works for me." |

A Network must parse all of these forms. The test `packages/sim/test/time-aware.test.ts` has a reference parser that maps every form back to the picks. The ConsentNetwork's parser (`parseProbeReply` in `packages/network/src/classify.ts`) is checked against every form in `packages/network/test/units.test.ts`.

**Booked-plan reveals** (`SimMeta.booked`: `{ proposalId, at, optOutHours: 48 }`). The persona judges the named plan as a proposal, then:

1. It says it can't make it when it would decline, or when the time clashes with its week. Every variant contains "can't make it".
2. A persona that plans not to come (flakiness) says so now 30% of the time. Otherwise it drops out later, at the morning flake check.
3. Otherwise it stays silent. 25% of the time it sends a short acknowledgement.

Responsiveness applies after that: an ignored "can't make it" becomes a silent no-show. A scheduling message (`meetingAt`) at a clashing time also gets "can't make it". A "can't make it" counts as a cancellation with notice in the outcome.

**Attendance** (`WorldOptions.timeAware`). A participant booked at a time it is not free does not come with p = 0.7 (the other 30% rearrange). That participant gives notice on the meeting morning with p = 0.8 (other flakers: 0.45). A meeting at a time that fits is decided as before. The persona agent and the World use the same draw (`timeConflict`), so they agree.

**Stub meeting times** (`StubOptions.timeAware`). The stub scores the engine's candidate slots (`candidateSlots`: weekday 19:00, weekend 10:00, 14:00 and 19:00, from 24 hours ahead) inside the proposal window. The score is the product over members of the engine's `availabilityProb`, from what the members told the Network: `availability_pattern` facets, trips away (temporary presence), and quiet hours. It spreads meetings over the slots within 80% of the best score, by proposal id. With no evidence, weekend daytime scores highest (engine priors), so the window decides the day. The stub imports these helpers from `packages/engine/src/attention.ts`.

Measured (150 NYC personas with richness tiers, 21 days, seeds 1-6, `introRate` 1, `WorldOptions.timeAware` on, hand-run script, no LLM): seats at a time the member is not free were 161 of 262 (61%) with 19:00 two days out, and 121 of 226 (54%) with `StubOptions.timeAware`. Seats that showed: 119 of 262 (45%) and 115 of 226 (51%). The samples are small. The stub hears little about availability (only connected-source facets), so most of the gain needs a Network that offers times.

Limits:

- The chat-stated availability (`Knowledge.chat.availability`) does not reach the snapshot as a facet. Only connected sources (gmail, calendar) give `availability_pattern` facets.
- The sim's facets tag days in lower case (`evening:tue`). The engine's `standingFromFacets` reads `evening:Tue` and ignores the lower-case tags. The stub converts them. The engine owner must fix `standingFromFacets` or the source tags.
- The 0.15, 0.3, 0.5, 0.6, 0.7, 0.8, 0.3 and 0.25 values are estimates, not calibrated.

### 6.2 Change the oracle model

The consent-first assumptions are in `PRIMED_MODEL` and `Oracle.probe` ([network.md](network.md) section 9). They are assumptions, not measurements. Any change needs a sensitivity run (`--primed-*`) and a results doc.

### 6.3 Change the Network

The send timing, cap counting, probe content and availability capture follow the engine session's reference, attention v1.2 ([network.md](network.md) sections 4 and 6.4). Import the engine's `attention` helpers; do not copy them. A change to these rules needs a before and after run (seeds 1-3, with and without `--time-aware`) and a results doc.

1. Edit `packages/network/src`. Read [network.md](network.md) first.
2. Read time only from `this.ctx.clock`. Use no `Date.now()`, no `new Date()` without an argument, no `Math.random()`.
3. Never read hidden truth in `src/`. The harness may.
4. Send every message through `send()`. It runs the recipient checks, the outreach rules, the sending window and the leak guard.
5. Put member-facing text in `src/copy.ts`. A copy change needs the videos in CONTRIBUTING.md 3.5.
6. Run the scenarios and the experiment before and after the change, with the same seed.

## 7. Re-baseline the numbers

Do this when the Network, the engine, the oracle, the personas or the dataset change.

1. Run the three arms for seeds 1-3, then the consent arm with the time-aware simulator. Use new file names; do not overwrite the files an earlier results doc cites.

   ```bash
   E=packages/network/harness/experiment.ts
   for s in 1 2 3; do bun run $E --days 21 --seed $s > docs/results/network/arms-21d-<topic>-seed$s.json; done
   for s in 1 2 3; do bun run $E --days 21 --seed $s --only consent --time-aware > docs/results/network/consent-time-aware-21d-<topic>-seed$s.json; done
   ```

2. Run the sensitivity runs and the long run (seed 1):

   ```bash
   E=packages/network/harness/experiment.ts
   bun run $E --days 21 --seed 1 --only consent --primed-identity 0.90 > docs/results/network/sensitivity-identity-0.90.json
   bun run $E --days 21 --seed 1 --only consent --primed-identity 0.98 > docs/results/network/sensitivity-identity-0.98.json
   bun run $E --days 21 --seed 1 --only consent --primed-met 0.9 --primed-partial 0.75 > docs/results/network/sensitivity-ask-lower.json
   bun run $E --days 42 --seed 1 --only consent > docs/results/network/consent-42d-seed1.json
   ```

3. Run one command twice and compare the JSON. It must be identical. If it is not, someone changed the code during the run; run again.
4. Write a new results doc `docs/results/YYYY-MM-DD-<topic>.md`. Give the commands, seeds, sample sizes and confidence intervals. Say what changed since the last baseline.
5. If a test threshold depends on the numbers (for example the all-yes threshold in `packages/network/test/network.test.ts`), update its comment with the new measured values.

The runs are CPU-heavy. On 2026-10-07 one arm took about 7-8 seconds on a quiet machine, and 70-110 seconds on a heavily loaded one.

## 8. Checks to run before a PR

The simulations are the validation layer (2026-10-08: the unit and golden tests were deleted). Run the blocks for what you changed, then the whole run and the typecheck.

| Changed | Command |
|---|---|
| `packages/network`, `packages/sim` | `bun run sim --only network` (the invariant run, consent vs push on seeds 1-3, every NYC scenario, the sim scenarios at pass^3; about 4-10 minutes depending on machine load) |
| An app pack or world | `bun run sim --only slop` (or `peon`, `friends`) |
| Parsers, corpora, the leak guard, opt-out | `bun run sim --only evals` |
| `packages/capital` | `bun run sim --only capital` (32 paired seeds; slow) |
| Platform, MCP or backend security | `bun run security` (the suite pending the founder's decision; needs the dev Postgres) |
| `sites/` | `DEPLOY_TARGET=production bun run sites/sites.ts` and `bunx tsc --noEmit -p sites/tsconfig.json` |
| Any TypeScript | `bun run typecheck` |
| Before you mark the PR ready | `bun run sim` and `bun run typecheck` |

Paste the commands and the gate summary line in the PR.

The safety gates are 0 canary leaks, 0 minor contacts and 0 invariant violations. `bun run sim` checks them on a 10-day run, and on the 21-day consent runs for seeds 1-3 (with pooled floors: everyone-yes 0.73 or more, 140 meetings or more). Runs of 30 days or more can show a `two_unanswered` violation from the one allowed re-engagement (D6). That is a known judge issue ([network.md](network.md) section 11); any other violation is a real failure. The 42-day seed-1 run on 2026-10-07 sent no re-engagement and had 0 violations.
