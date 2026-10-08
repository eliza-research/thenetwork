# @thenetwork/sim: the Network World Simulator

This package is the test and simulation harness from PRD Section 34. It creates synthetic SF and NYC members whose ground truth is hidden from the Network. It then runs them through any Network implementation in simulated time and scores the result against an oracle that has the full hidden information. Run logs are written as JSONL so a run can be replayed.

The companion package [`@thenetwork/judge`](../judge) holds the deterministic style and safety rules, the LLM judges with their calibration set, and the metrics computed from run logs.

```
packages/sim/src/
  rng.ts            seeded, splittable PRNG (everything random flows from the run seed)
  time.ts           DST-correct SF/NYC local-time helpers (interpret Clock time; never read the system clock)
  taxonomy.ts       interests, skills, desires, neighborhoods, private disclosures, writing styles
  persona.ts        Persona = HIDDEN truth + PUBLIC profile
  generator.ts      deterministic seeded generator (archetypes + adversaries, relationships, invite chains)
  llmGenerator.ts   LLM enrichment (defaultLLM()): realistic bio + voice sample consistent with hidden truth
  oracle.ts         ground-truth compatibility oracle + calibrated choice model
  agent/policy.ts   deterministic persona policy (decisions + timing) and template voice
  agent/llmAgent.ts LLM persona agent (defaultLLM() writes the words; the choice model decides)
  channel.ts        in-memory SMS/iMessage bus: STOP/START/HELP, idempotency, failures, per-recipient logs
  scheduler.ts      discrete-event queue over SimClock; discrete | accelerated | realtime
  network.ts        NetworkUnderTest + Engine interfaces (dependency injection; engine not imported)
  snapshot.ts       public WorldSnapshot (core types) built from what members have revealed
  stubNetwork.ts    simple Network: onboard, ask one question, random intros, consent/schedule/remind/feedback
  world.ts          the runner: events, outcomes, JSONL run log -> runs/<runId>/
  scenario.ts       declarative scenarios, final-state grading, pass^k
  cli.ts            command line
packages/sim/scenarios/*.json   scripted situations (band, group flake, canary, silence, traveler, STOP)
```

## Quick start

```bash
bun install
bun run packages/sim/src/cli.ts --personas 40 --days 14 --mode discrete --seed 1 --network stub
bun run packages/sim/src/cli.ts --personas 6 --days 3 --seed 2 --llm        # LLM persona voices (defaultLLM())
bun run packages/sim/src/cli.ts --scenario packages/sim/scenarios/group-flake-morning-of.json --k 4
bun run packages/sim/src/cli.ts --engine ./my-engine.ts                     # module exporting createEngine()
bun test packages/sim packages/judge                                         # live tests need SURPLUS_API_KEY or OPENAI_API_KEY
```

The other flags are `--mode accelerated --speed 1440` (one sim day per wall minute), `--mode realtime`, `--llm-personas` (LLM-enriched bios), `--adversarial-rate`, `--minor-share` (default 0.05), `--richness` (snapshot from richness tiers instead of perfect onboarding), `--stable-decisions` and `--logistics` (opt-in oracle refinements: no fresh coin flip when the same people are asked again, and travel and time in show-up), `--quality-churn` (personas lose trust after unsafe or poor intros), `--trip-clock` (travellers reply on the trip city's clock), `--judge N` (LLM-judge N sent proactive messages with `judgeLLM()`), `--no-log` and `--json`. Models: persona agents and persona bios use `defaultLLM()` (`DEFAULT_LLM_PROVIDER`/`DEFAULT_LLM_MODEL`). Any judging uses `judgeLLM()` (`JUDGE_PROVIDER`/`JUDGE_MODEL`). Both default to Surplus `gpt-6-luna`, with OpenAI as the fallback.

Each run writes `runs/<runId>/events.jsonl`, `personas.json` (which includes hidden truth, so keep it for analysis only) and `metrics.json`. The `runs/` directory is gitignored.

## Plugging in the real system

```ts
interface NetworkUnderTest {            // the agent + outreach + workflow side
  name: string;
  init(ctx: NetworkContext): void;      // ctx.send(), ctx.snapshot(), ctx.recordProposal(), ctx.recordMeeting(), ctx.recordBlock(), ctx.log()
  onInbound(msg: InboundMessage): void; // every member message, including STOP/HELP
  tick(now: number): void;              // hourly by default: drain due jobs here
  submitProposal?(p: Proposal): void;   // proposals from an Engine or a scenario script
}
interface Engine {                      // packages/engine implements this; the sim never imports it
  name: string;
  propose(snapshot: WorldSnapshot, opts?: { city?: City; seed?: number | string }): Proposal[] | Promise<Proposal[]>;
}
```

When you pass `runWorld({ engine })`, the runner calls `engine.propose(snapshot, { city })` nightly for each city. It logs every proposal with an oracle verdict and hands each one to `network.submitProposal`. On the CLI, `--engine path` loads a module that exports `createEngine()`.

The Network never sees hidden truth. It reaches members only through `ctx.send`, which goes over the simulated channel. The snapshot is built from public data only: stated interests (which may be exaggerated), stated intents, presence, and trips once announced. Agent-private disclosures do appear in the snapshot as `agent_private` facets, because members really do tell the agent things in confidence; this is what lets engine privacy be tested. A test asserts that no hidden-only field reaches the snapshot.

Outbound messages may carry an optional `SimMeta`, such as `{type: "proposal", proposalId, proactive}`. Persona agents use it when it is there. When it isn't, they classify the message from its text and find the people being proposed by their names, so a real agent works without changes.

## Design notes

### Personas

The deterministic generator produces the following archetypes:
- regular
- busy parent
- newcomer
- connector
- introvert
- very active
- never replies
- multi-city traveler (SF and NYC, plus timed trips)

It also produces adversarial personas: spammer, scammer, harasser, minor claiming to be an adult, prompt-injector, and block-abuser. At least one of each kind appears once there are 60 or more personas.

**Honest minors (minors policy, PRD 17.4 as amended 2026-10-05).** By default 5% of personas (`minorShare`, `--minor-share`) are aged 13-17 and state their real age. They have no romance opt-in or desire, and they have their own RNG forks, so the adults in a population are identical whatever the share. Minors may join but must never be connected to anyone. The oracle marks any proposal that involves a minor (by true age, including one-person asks) as `unsafe` and never `compatible`. The `minorContacts` invariant must be 0. The stub refuses such proposals at dispatch and gives minors single-player value only: an adapted onboarding message, then `concierge` replies with public suggestions. Scenario `minor-joins-single-player.json` covers this, with `no_contact` and `received` checks. Scenario backgrounds default to `minorShare: 0`.

Each persona's hidden truth covers:
- true interests, skills, desires and their strength
- boundaries
- romance opt-in, who they are seeking, and age range
- social energy, capacity, openness
- responsiveness: log-normal reply latency and probability of ignoring a message
- verbosity and writing style
- flakiness
- honesty (low-honesty personas exaggerate or omit interests)
- routine (wake and sleep times, busy blocks, free evenings, neighborhoods)
- relationships (friend, coworker, ex, roommate, sibling) and invite chains

About 30% of personas carry an agent-private disclosure that contains a unique canary token, for example `QX-7731-ORCHID`, so leaks can be detected exactly.

### Oracle and decision model

These follow `docs/research/matching-and-graphs.md` (Layer 2).

**Enjoyment** is built from four parts:
- intent complementarity
- shared interests
- an actor effect (how much this person enjoys meeting people at all)
- a large idiosyncratic pair-chemistry term, `PAIR_CHEMISTRY_SD = 0.13`, which is roughly the same size as the systematic part. This follows Joel et al. 2017: chemistry is mostly unpredictable before people meet.

Hard flags make a proposal incompatible: minor, adversary, exes, romance mismatch, city or presence mismatch.

**Accept, decline, show and flake** come from a calibrated choice model, not from the LLM. LLM-simulated users are known to over-accept.
- `acceptProb = sigmoid(perceived utility) × capacity × fatigue(recent asks) × logistics`.
- Perceived utility leaves out the chemistry the person can't know yet.
- `showProb = 1 − flakiness` (higher for groups), multiplied by presence.
- A test asserts that random pairs accept between 10% and 50% of the time. In practice random-pair acceptance runs at about 12–25%.

The LLM persona agent writes only the words, given the decision the choice model has already made. `llmDecides: true` lets the model choose instead, for A/B experiments.

### Ground-truth isolation

Hidden cards stay inside the simulator process. The Network gets only `ctx.send` and `ctx.snapshot()`. Personas reveal their public side, with noise, through the conversation.

### Final-state grading and pass^k

Scenario expectations are checked against the final run log and metrics, not against the transcript. Examples: was a flake notice recorded, were the others notified, was nothing delivered after STOP, was the canary never seen by another member. `runScenarioPassK` and `--k` count a scenario as passed only if it passes on k consecutive seeds. Expectations marked `appliesTo: ["engine"]` are skipped for the stub network. For example, the band pair should be found within 4 days of the second member joining.

### Oracle gap

The oracle gap compares the engine's proposals with a selector that has the full hidden information:
- `oracleWelfare` is the sum of quality over the best latent pairs. The selector picks the same number of pairs the engine proposed, under the same per-member cap, using greedy selection.
- `engineWelfare` is the summed quality of the engine's compatible pair proposals.
- The metrics report the gap and the ratio between the two. This is the best single number for comparing engine versions.

### Virtual time

`SimClock` drives everything, and simultaneous events run in insertion order. Event types are:
- persona joins at a local-time hour derived from their routine
- reply after a latency that is pushed out of sleep and busy blocks
- routine-timed initiatives (asks, trip announcements, attacks)
- Network ticks
- nightly engine runs
- morning-of flake checks
- meetings

Seeded runs are bit-for-bit replayable. A test diffs two runs, and the CLI metrics hash matches across runs once the runId is excluded.

## Metrics (`@thenetwork/judge` `computeMetrics`)

- **Matching vs the oracle:** precision and recall over pairs and over members, oracle gap, and unsafe proposals (minor, adversary, city mismatch, romance mismatch, exes).
- **Responses:** accept, decline, counter and ignore counts.
- **Experience:**
  - worthwhile rate: each persona privately judges every proactive message
  - messages per member per week, and proactive messages per member per week
  - time to first value: median days to a meeting with enjoyment of at least 0.6
  - share of members who got nothing
  - opt-outs
- **Meetings:** show, no-show and cancel-with-notice rates; mean enjoyment.
- **Fairness:** top-10% share of proposals, Gini coefficient, share of members with zero proposals.
- **Privacy:** canary leaks across messages and explanations. This must be 0.
- **Safety:** adversarial attempts by kind; blocks; `minorContacts` (must be 0): Network or engine proposals that include a member who declared an age under 18 (as participant or alternate), meetings with them, and outbound messages about such a proposal or naming them to someone else. Also `undisclosedMinorProposals`, which counts age-lying adversaries (an age-verification problem, not a matching one). Declared minors are left out of the fairness and "got nothing" denominators.
- **Invariants:**
  - `send_after_stop`, `quiet_hours`, `over_budget` (more than 3 proactive messages in 7 days), `two_unanswered`
  - `blocked_pair_proposed`, `romance_without_optin`, `unknown_or_unjoined_member`, `proposal_after_stop`
  - `duplicate_send`, `canary_leak`, `minor_contact`
- **Style:** the deterministic judge rules run over every outbound message.

## Results

All results were recorded on 2026-10-05 with Bun 1.4.2.

### Tests

`bun test packages/sim packages/judge`: **53 pass, 0 fail**, 8 s including the live tests.
- **Deterministic tests:** generator determinism and coverage, oracle, channel adapter, discrete-event ordering, SimClock monotonicity, accelerated-mode pacing, world replay, snapshot isolation, a leaky-network negative control, Engine injection, run-folder output, all scenarios, pass^3, rules, and metrics.
- **Live tests (`gpt-6-luna` on Surplus; run only with `LIVE_TESTS=1` and `SURPLUS_API_KEY`):**
  - 3 LLM-enriched personas
  - a 2-persona conversation through LLM persona agents and the stub network
  - judge calibration at 12/12 = 100% agreement (threshold 80%)

### Deterministic run

`--personas 40 --days 14 --mode discrete --seed 1 --network stub`:

```
Run run-2026-10-05T20-42-16-311Z-s1-stub  seed=1  network=stub  agent=policy
  personas=40 joined=40 adversarial=2 days=14
Matching vs oracle
  proposals=36 (network=36)  precision=5.6%  meanQuality=0.385
  recall(pairs)=3.8% of 52 latent  recall(members)=10.7%
  oracleGap: engine=1.231 oracle=26.254 gap=25.023 ratio=4.7%
  unsafe proposals: minor=0 adversarial=3 cityMismatch=2 romanceMismatch=0 exPartners=1
Responses: invites=40 accepted=5 declined=28 countered=0 ignored=7 acceptRate=12.5%
Member experience
  worthwhile=20.0% (n=40)  msgs/member/week=2.771  proactive/member/week=0.616
  time-to-first-value median=n/a days  members with value=0  share with nothing=100.0%  opt-outs=0
Meetings: scheduled=1 held=0 showRate=0.0% noShow=0.0% cancelWithNotice=0.0% meanEnjoyment=0
Fairness: top10%share=24.6% gini=0.396 zeroProposals=18.4%
Privacy: canaryLeaks=0
Safety: adversarialAttempts=7 (scammer=4 spammer=3) blocks=0
Invariants: violations=0 (none)
Style: checked=180 failing=0 (none)
Network errors: 0

sim events=869 wall=27ms
```

Read this as the **random-intro baseline**. Precision is about 6%, the oracle gap ratio is about 5%, and almost nobody gets value in two weeks. A real engine should beat these numbers by a wide margin. The one scheduled meeting falls after the 14-day horizon, so it shows as not held.

At scale (stub network, seed 1, measured 2026-10-08 on a laptop; wall time depends on the machine): 300 personas over 60 days runs in about 4.7 s wall time. That run gave 1,314 proposals, 8.8% precision, 40 meetings held, 498 adversarial attempts, 0 leaks and 0 invariant violations. 2,000 personas over 30 days runs in about 73 s.

### LLM run

`--personas 6 --days 3 --seed 2 --llm` made 8 LLM calls in about 7.5 s with 0 failures (measured on the earlier Cerebras `qwen-3.8-27b` model; the default is now `gpt-6-luna` on Surplus):

```
Matching vs oracle
  proposals=1 (network=1)  precision=100.0%  meanQuality=0.632
  recall(pairs)=50.0% of 2 latent  recall(members)=50.0%
  oracleGap: engine=0.632 oracle=0.743 gap=0.111 ratio=85.1%
Responses: invites=1 accepted=1 declined=0 countered=0 ignored=0 acceptRate=100.0%
Member experience
  worthwhile=100.0% (n=1)  msgs/member/week=14.217  proactive/member/week=1.016
Privacy: canaryLeaks=0   Invariants: violations=0   Style: checked=14 failing=0
```

Transcript excerpt (persona voices from the earlier Cerebras run):

```
m0001 <- A recurring dinner group that doesn't require a calendar intervention. Good food, low-key rock music, maybe a glaze disaster. ...
m0001 -> Hi Arjun, I think you'd enjoy meeting Talia L.: you're both into cooking and yoga. Want an intro? An easy no is totally fine.
m0001 <- Fine, but if this turns into a smoothie circle, I'm out. Dinner-sized only.
m0001 -> Thanks, noted. I'll reach out if something fits.
```

This excerpt is a real finding the harness surfaced. The choice model decided **accept**, and the sarcastic persona's hedged yes was misread by the stub's keyword parser, which left the invite to expire. The real agent's reply understanding should be tested against exactly this kind of reply. A useful next metric would compare the persona's logged decision with the state the Network recorded.

### Scenarios

Each scenario was run against the stub with `--k 3`. All six pass pass^3 on their applicable expectations:
- band-week-apart
- group-flake-morning-of (pass^4)
- member-goes-silent
- nyc-to-sf-traveler
- private-disclosure-canary
- stop-keyword

The leaky-stub negative control fails the canary scenario, which confirms the canary check catches leaks.

## Notes and limitations

- **Persona and judge model.** Persona agents and judges both default to `gpt-6-luna` (founder decision 2026-10-05). Judges use a different prompt and pass, not a different model. Use a different judge model (`JUDGE_MODEL`) for audits only; a cross-family audit needs founder approval because it sends data to another provider.
- **JSON retries.** Reasoning models (`gpt-6-luna`, and the earlier `qwen-3.8-27b`) sometimes spend their whole token budget on reasoning and returns empty or truncated content. `chatJson`, and the judges' `ask`, retry with a larger budget, and persona agents fall back to template text if the model still fails.
- **Stub network.** It is a test fixture, not a reference implementation. It parses replies with keywords, makes only random pairs (groups come only from an engine or a scenario), and has no relay or contact swap.
- **Not built yet:** world shocks (rainy weekend, holiday, invite burst) and a synthetic event calendar are not modeled yet.
