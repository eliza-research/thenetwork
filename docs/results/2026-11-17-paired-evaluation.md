# Paired, low-variance evaluation: common random numbers, A/A arms and expected value (2026-11-17)

This report measures what the simulator can detect when two engines are compared on the same seeds. It is hand-written from saved command output (each table names its files). The runs were made on 2026-11-21 and the report was written on 2026-11-22; the file name keeps the date of the plan. The simulator makes no model call: it clears the provider keys. The reviewer is simulated (`review: "auto"`). These runs predate the review judge (owner decisions D15 to D17 of 2026-11-22): they used the removed simulated reviewer that approved every item, and the simulator now uses the deterministic stand-in judge. No real member data is in this report. The problem statement is [R9-test-data-quality.md](../research/2026-11-17-matching-optimization/R9-test-data-quality.md) (plan item 2).

## What changed

- **Common random numbers (CRN).** A simulated member's decision draws its coin from a key that says what the decision is about: the member, the counterpart or group (a sorted signature), the kind of decision, the week or day, and the activity or category. It never uses a proposal index, a message id or a meeting sequence number. One helper holds the keys: `packages/sim/src/coins.ts` (`h01`, `signature`, `Coins.key`). The n-th distinct event with the same meaning gets occurrence n, so each event still gets its own independent draw and the marginal probabilities do not change. Only the coupling across runs changes.
  - ntwrk world: `packages/sim/src/world.ts` (persona context per message meaning and day; flake check and morning time per meeting, keyed by the participants at the first booking and the day), `oracle.ts` (accept, show and probe draws), `agent/policy.ts` and `plans.ts` (plan option, plan show, crew opt-in), `agent/availability.ts` (the time-conflict draw is keyed by persona and meeting time, with the proposal as its instance), `packages/network/harness/growth.ts` and `World.invite` (the n-th invite of a member makes the same friend in every run).
  - slop world: `apps/slop/world.ts` (after the reveal: pair and week), `behavior.ts` (`answerProbe` keys the anonymous probe by member and week; it still takes the flow key, so a hook can identify the flow), `relay.ts`.
  - friends world: `apps/friends/world.ts` (probe: member, week, kind and activity; reveal and meetup: the table's members; a crew's own session: activity, members and week, with the crew id as the instance), `oracle.ts`. `h01` moved from `apps/friends/persona.ts` to `coins.ts`.
  - Every key now has an instance id, so two different events never share a coin. The review of 2026-11-21 found three keys without one (time conflict, crew session, a meeting after a late joiner). They were fixed after the block runs below, so the trajectories of those draws changed again (see "Validity of the numbers").
  - Peon already keyed its draws by (candidate, job). It is not changed, and its block output is identical (fingerprint `ce7ae5b8e44da802` before and after).
- **Expected-value metrics (simulator only).** For each proposal the harness computes from the oracle the probability of the good outcome, before any coin is drawn. The engine never sees these numbers.
  - friends: `FriendsOracle.expectedGood` (32 fixed Monte Carlo draws of replies, yeses, slot, attendance, chemistry and side noise; fatigue 0, so the value does not depend on the order of the week's proposals); `FriendsMetrics.expected.perProposal` and `perMember`.
  - slop: `SlopOracle.pDateHappens` times `softLabel` P(good) and P(second date) (32 chemistry draws); `SlopMetrics.expected`.
  - ntwrk: the oracle verdict recorded with each proposal (the product of accept and show probabilities when the oracle rates the meeting good, else 0); `ArmResult.expected` in `packages/network/harness/experiment.ts`.
- **A/A arms (tracked lines).** Each block runs its main arm twice on the same seeds with a neutral perturbation. It prints the per-seed difference, its SD and SE, a 95% t interval, the correlation between the arms, the minimum detectable effect (MDE, alpha 0.05 two-sided, power 0.8) and the Jaccard overlap of who met whom. Perturbations (simulator only, no engine flag): friends sees every member under a salted alias (`idsSalted`; the planner has no seed); slop runs the engine with another seed (`$engineSalt`); ntwrk runs the Network with seed + 1000. The statistics are in `packages/sim/src/paired.ts`.
- **Paired comparison tool.** `scripts/sim/paired.ts` (see below).
- **Gate fixtures (no threshold and no assertion changed).** Two existing gates name generated members or a seed. The re-keyed world no longer puts those members or that seed in the state that the gate needs, so the fixture is pinned again. Each gate keeps every assertion and its strength: one seed, one pair.
  - `scripts/sim/friends.ts` "plans: every offered time fits the selected venue's opening hours": the pairs are now f0157/f0159 (seed 101) and f0072/f0147 (seed 102). They are the pairs that satisfy all of the gate's partner assertions in the re-keyed world (one partner plan, three options when the venue opens all day, the same window and invitees). The scratch search `find-pair.mts` found them (`find-pair.out`, `find-pair-101-all.out`). The old comment said that the pair "attended a group"; f0157/f0159 did not meet before (`met=false`). The gate does not need it.
  - `scripts/sim/slop.ts` "world: a check-in report holds the offender": the gate needs at least one harassment that only the check-in reports. Seed 5 now has none. Harassment reported through the check-in on seeds 5-8 is 0, 0, 2, 2 after and 1, 2, 1, 1 before (scratch `checkin.mts`; PROGRESS.md). The gate now runs on seed 7 alone. An earlier version pooled seeds 5-8; the review rejected that as a looser assertion, so it was replaced by the single seed.
- **StubNetwork honours STOP on every send.** `packages/sim/src/stubNetwork.ts` `send` sends nothing to a member who texted STOP. Before, a member who stopped after a booking still got the stub's booked reminder and feedback request. The channel suppressed both, but the judge counts `send_after_stop`. The scenario `stop-keyword.json` (pass^3) is the case that fails before the fix (seed 62, `stopkw-new2.out`).
- **slop-live "one date at a time" reads the Network's cancellations.** The gate compared the World's meeting records only. The World keeps a meeting after the Network closes it (the Network has no call to remove a meeting from the World). The gate now ends a member's booking at the first of: the meeting time, the Network's `booked_cancelled` log for that member and opportunity, and the `opportunity_closed` log for the opportunity. A second booking while the first is still open fails as before.
- **New tracked gate.** `scripts/sim/slop.ts` "world: common random numbers: the same proposals in reverse order meet the same member coins and outcomes": the random matcher's proposals of one week, in the given order and in reverse order, give the same outcome for every flow. This tree: 241 of 241 flows identical. The old code (`d483de38`): 80 of 241, so the gate fails before the change (`crn-gate.out`). It passes inside the slop block (`after3-slop.txt`).

## Method

| Item | Value |
|---|---|
| Before | `d483de38` (a clean checkout of origin/vibestack `908aec03`, code-identical) |
| After | this tree (branch `wave1/eval`) |
| Block commands | `corepack pnpm@10.24.0 run sim --only <friends\|slop\|network\|peon>` |
| Before-A/A command | `node --import tsx --conditions eliza-source scripts/sim/paired.ts --block <block> --a <before tree> --b-salt 1 --seeds <block seeds> --json <out>` |
| Seeds | friends 5-8, slop 13-16, ntwrk 1-3 (the pinned seeds of each block) |
| Model | None. Simulated reviewer. |
| Variance | Each run is deterministic for a seed. The A/A SDs come from 3 or 4 seeds; a 3-seed SD has a 95% interval of about 0.5x to 6x its value. Read them as orders of magnitude. |

Output files (not in the repository; `<run dir>` is the wave's run directory on the build machine): before blocks `base/sim-<block>.txt`; after blocks `w1-eval/after2-<block>.txt`; before A/A `w1-eval/aa-base-<block>.txt` and `.json`.

## A/A results: before and after CRN

Paired SD = SD over seeds of (arm B - arm A). Corr = Pearson correlation of the two arms over seeds. Same = Jaccard overlap of who met whom, per seed.

| Block, outcome | Before: paired SD, corr | After: paired SD, corr | Target |
|---|---|---|---|
| ntwrk meetings held (n 3) | 18.5, -0.99 | 17.1, -0.53 | SD < 3, corr > 0.8 |
| ntwrk everyone-yes proposals | 14.9, -0.95 | 17.4, -0.74 | |
| ntwrk new members joined | 2.1, 0.98 | 4.5, 0.97 | |
| ntwrk expected value per proposal (oracle) | not present | 0.002, 1.00 (mean 0.079) | |
| ntwrk expected good meetings per member (oracle) | not present | 0.008, 0.90 (mean 0.056) | |
| ntwrk same meetings | 0.05, 0.02, 0.05 | 0.26, 0.33, 0.21 | |
| slop dates (n 4) | 15.0, -0.18 | 6.8, 0.90 | |
| slop second dates | 3.3, -0.03 | 4.6, 0.09 | |
| slop expected P(good date) per proposal (oracle) | not present | 0.001, 0.82 (mean 0.022) | |
| slop expected P(second date) per proposal (oracle) | not present | 0.001, 0.73 (mean 0.014) | |
| slop expected good dates per member (oracle) | not present | 0.004, 0.87 (mean 0.058) | |
| slop same dates | 0.08, 0.13, 0.11, 0.09 | 0.42, 0.39, 0.37, 0.45 | |
| friends meetups held (n 4) | 16.6, 0.59 | 19.6, 0.40 | |
| friends V14 | 0.015, 0.87 | 0.023, 0.56 | |
| friends repeat rate | 0.023, 0.85 | 0.046, 0.80 | |
| friends expected P(held and good) per proposal (oracle) | not present | 0.006, 0.95 (mean 0.176) | |
| friends expected good meetups per member (oracle) | not present | 0.062, 0.97 (mean 2.31) | |
| friends same meetups | 0.04, 0.16, 0.07, 0.04 | 0.17, 0.41, 0.57, 0.18 | |

Sources: before `aa-base-network.txt`, `aa-base-slop.txt`, `aa-base-friends.txt`; after the "A/A" lines of `after2-network.txt`, `after2-slop.txt`, `after2-friends.txt`. The before A arm of ntwrk reproduces the before block (pooled meetings 63 + 64 + 47 = 174).

What this shows:

1. **CRN couples the worlds.** The share of identical meetings between the two arms rises 3 to 10 times in every block (ntwrk 2-5% to 21-33%, slop 8-13% to 37-45%, friends 4-16% to 17-57%).
2. **Slop dates reach the target.** Paired SD 15.0 to 6.8, correlation -0.18 to 0.90. The MDE of dates on 4 seeds falls from 31 to 14 dates per seed (31% to 14% of the mean).
3. **ntwrk and friends realized counts do not reach it.** ntwrk meetings stay at a paired SD of about 17 (target below 3) and friends meetups at about 17-20. The perturbations are not pure tie-breaks: the Network seed also changes the engine's exploration, and a salted alias reorders every candidate list of the friends planner. Most of the remaining difference comes from the two arms making different proposals, which CRN cannot remove.
4. **Expected value is the low-variance measure.** Its paired SD is 1% to 14% of its mean, with correlation 0.73 to 1.00, in every block (lowest: slop expected P(second date), corr 0.73; highest relative SD: ntwrk expected good meetings per member, SD 0.008 on a mean of 0.056). Judge a quality change on these metrics first and on the realized counts second.
5. **The friends id order is not neutral.** On the before tree the salted alias lowered the repeat rate by 5.5 points (95% CI [-9.2, -1.8], 4 seeds); after CRN the difference is -3.1 points (CI [-10.5, 4.2]). The planner breaks ties by member id, and the generated ids are not in random order. The engine owner should look at this.

## Gate values before -> after

All values come from `base/sim-<block>.txt` -> `w1-eval/after2-<block>.txt`. Only gates whose value moved are listed.

| Block | Blocking gates before -> after |
|---|---|
| friends | 29/29 -> 28/29 |
| slop | 45/45 -> 44/45 (the new tracked CRN gate is not in this count) |
| ntwrk (network block) | 67/67 -> 65/67 |
| peon | 27/27 -> 27/27 (identical output) |

### Gates and tests that fail after re-keying

| Gate | Before | After (saved run) | Diagnosis and status now |
|---|---|---|---|
| friends: Total harm events <= 0.5x random | 0.48x (19.8 vs 41.5 per seed) | 0.56x (24.5 vs 43.5) | The margin before was 0.02x, inside the seed noise. The undetected-adversary ratio is 1.88x -> 1.58x. No code change: the threshold is not changed and the pack is not tuned. Still fails. Decision for the product owner. |
| slop-live: one date at a time | pass | fail (seed 22, member d0070) | d0070 had date mt5 (slop.nw-22-28, 2026-10-08 23:00) and was booked for mt6 (slop.nw-22-43, 2026-10-10) at 22:19, 41 minutes before mt5 (`d0070-b6.out`). d0070 did not come to mt5 (`cancelledWithNotice` false); d0005 did. The Network makes a member busy in every open opportunity (`busy` in packages/network/src/network.ts), so it can book mt6 only after d0070 left nw-22-28. The likely path is the one in `decliner-seed2.out`, where a "No thanks" to a booked plan gives `booked_cancelled` and closes the opportunity. The World does not remove a closed meeting, so the old gate counted it. The gate now reads the Network's cancellations (see "What changed"). If d0070 has no `booked_cancelled` or `opportunity_closed` for nw-22-28 before 22:19, the gate still fails, and that is a real double booking in the Network. Not run yet. |
| network: consent arms judge 0 invariants | {} {} {} | {} {"decliner_exposed":1} {} | Seed 2 (`decliner-seed2.out`): ny-0082 planned a 👍 acknowledgement to the reminder o004078 for nw-2-244 (00:05, sent 76 minutes later). nw-2-244 was cancelled at 00:38. At 01:05 the Network sent probe o004090 for nw-2-225. The persona decided "no", due 15 hours later. At 01:21 the old "👍 Appreciate it :)" arrived. It was the member's only turn after the probe, so `spec/probeReply.md` ("A brief acknowledgement such as OK or a thumbs-up can answer a regular probe only while it remains the member's latest outgoing question...") reads it as a yes. The Network booked and named ny-0082 to ny-0242 (o004096). The Network follows its spec. The exposure is in the spec rule: a late acknowledgement of an older message counts as consent to a newer probe. No code change here: the fix is a spec decision (below). Still fails. |
| network: sim scenario stop-keyword.json (pass^3) | pass | fail | Seed 62 (`stopkw-new2.out`): the StubNetwork booked the quitter before STOP. After STOP it tried a reminder (o000077) and a feedback request (o000084). The channel suppressed both (`suppressed_opted_out`), and the judge counts send_after_stop = 2. Fixed: the stub sends nothing to an opted-out member. Not run yet. |
| slop: world: a check-in report holds the offender | pass (seed 5) | seed 5 has no check-in-only harassment | Re-pinned to seed 7 (see "What changed"). Not run yet in this form; the pooled form passed in `after3-slop.txt`. |
| integration: packages/sim/test/slop-dispatch-holds.integration.test.ts | pass | fail ("Unknown native proposal", `review/vitest-sim.txt`) | The world passed the probe coin to `answerProbe`, and the test maps the flow key. Fixed: `answerProbe` takes the flow key and computes the coin. Not run yet. |
| integration: packages/sim/test/slop-baseline-holds.integration.test.ts | pass (random arm: 3 cleared, 1 boundary proposals, seed 16) | fail (random arm: 0 and 0, `review/holds.out`) | The random baseline proposes few members whose hold has cleared, and on seed 16 of the re-keyed world it proposes none. The test is not changed. Find a seed where every arm has cleared and boundary proposals (`scratch/holds-seeds.mts`), then pin the test to that one seed. Still fails. |

### Other gate values that moved

| Gate | Before | After |
|---|---|---|
| network: everyone-yes (pooled) > 0.73 | 0.880 | 0.874 |
| network: invite-yes (pooled) > 0.85 | 0.938 | 0.940 |
| network: push all-yes < 0.25 | 0.090 | 0.080 |
| network: unsafe proposals < push / 4 (seed 1) | 0 vs 18 | 2 vs 18 |
| network: more meetings than push (seed 1) | 63 vs 17 | 52 vs 10 |
| network: meetings (pooled) > 140 | 174 | 161 |
| network: > 5 new members joined (seed 1) | 21 | 23 |
| network: plans booked and held | 1,1,0 | 0,3,5 |
| slop: Harm events cut (>= 90%) | 93.9% | 95.9% |
| slop: Lowest rating quintile dates vs overall (>= 0.85x) | 0.928 (q1) | 0.921 (q5) |
| slop (tracked): Second-date rate vs random (>= 2.5x) | 1.923 | 2.584 |
| slop (tracked): Second dates per seed vs random (>= 2x) | 1.541 | 2.222 |
| slop (tracked): Minor contacts (age liars) cut (>= 90%) | 70.6% | 87.5% |
| slop (tracked): Adversary contacts cut (>= 90%) | 48.5% | 61.1% |
| slop (tracked): Dates per member-month vs random (>= 0.9x) | 0.834 | 0.887 |
| slop (tracked): Back-outs at reveal (< 10%) | 0.130 | 0.133 |
| slop (tracked): Lowest group vs overall (>= 0.7x) | 0.324 | 0.371 |
| slop relay: scam and harassment held, content only (>= 90%) | 100.0% (n 31) | 96.6% (n 29) |
| slop relay: honest messages held, content only / in thread (<= 5%) | 0.0% / 1.5% | 0.0% / 1.7% |
| slop-live quality: dates held | 30 | 24 |
| slop-live quality: yes per probe answer | 0.442 | 0.407 |
| friends: Repeat-meetup rate >= 30% | 30.5% | 30.3% |
| friends: V14 >= 0.75x oracle and >= 1.75x random | 37.3%: 0.89x, 2.20x | 37.5%: 0.89x, 2.36x |
| friends: Members with a friendship forming >= 2x random | 4.0x | 4.9x |
| friends: No borough below 0.7x V14 | 0.80 (worst seed 0.63) | 0.78 (worst seed 0.51) |
| friends: Median group max travel <= 35 min | 27.0 | 27.1 |

The other safety counts stay 0 in both runs: minor contacts, canary leaks, minors in a plan role, names before booking, review before contact, false flags.

Oracle-unsafe proposals of the consent arm on seed 1 rose from 0 to 2 (the gate is "< push / 4", push 18, so it passes). The Network made these proposals and the review gate passed them in the simulated review (`review: "auto"`). The count is a property of the engine's proposals under the new trajectory, not of the world's coins. One seed cannot say whether it is noise: the A/A lines do not include it. The engine owner should look at the two proposals (seed 1 of the network block) before this is read as noise.

## Gates too close to their threshold to inform

The noise of one run under a neutral change is estimated as the after-CRN A/A paired SD / sqrt(2) per seed.

| Gate | Value after | Margin | Noise of the gated value | P(fail with no real change), approx. |
|---|---|---|---|---|
| network: meetings (pooled seeds 1-3) > 140 | 161 | 21 | 17.1 x sqrt(3) / sqrt(2) = 20.9 | 16% |
| friends: Repeat-meetup rate >= 30% (mean of 4 seeds) | 30.3% | 0.3 points | 4.6 / sqrt(2) / sqrt(4) = 1.6 points | 43% |
| friends: Total harm events <= 0.5x random | 0.56x (fails) | -0.06x (before +0.02x) | not measured (harm counts are not in the A/A lines) | the before margin was 4% of the value |

## Recommended seeds

A paired comparison of two engines that must detect a 10% change of the mean (power 0.8, alpha 0.05) needs n = (2.8 x SD / delta)^2 seeds, with the after-CRN paired SD.

| Measure | Paired SD | 10% of the mean | Seeds needed |
|---|---|---|---|
| ntwrk meetings | 17.1 | 5.4 | about 80 |
| ntwrk expected value per proposal | 0.002 | 0.0079 | 3 (the minimum for a t interval) |
| slop dates | 6.8 | 10.0 | 4 (before CRN: 18) |
| slop expected P(good date) per proposal | 0.001 | 0.0022 | 3 |
| friends meetups | 19.6 | 20.9 | 7 |
| friends expected P(held and good) per proposal | 0.006 | 0.018 | 3 |

A threshold gate (not paired) keeps P(fail with no real change) at or below 5% when its margin per seed is at least 1.645 x noise / sqrt(n). The network meetings gate (per-seed noise 12.1, margin 7 per seed) needs about 9 seeds. The friends repeat-rate gate (per-seed noise 3.3 points, margin 0.3) needs about 300 seeds, so it needs a non-inferiority form, not more seeds.

## Paired comparison tool

```bash
node --import tsx --conditions eliza-source scripts/sim/paired.ts --block friends|slop|network \
  --a <tree> --b <tree> [--seeds 1-20] [--a-salt 0] [--b-salt 0] [--a-opts '<json>'] [--b-opts '<json>'] [--json out.json]
```

The tool runs the main arm of the block (friends: pack arm, 400 members, 8 weeks; slop: slop arm in the slop block's world, 300 per city, 4 weeks; ntwrk: consent arm, 21 days) on K seeds (default 20) in arm A and in arm B. For each outcome and each expected-value metric it prints the paired mean difference B - A, its SD and SE, the 95% t interval, the correlation and the MDE, then the overlap of who met whom. An A/A run is one tree with `--b-salt 1`. A metric that a tree does not report prints "not reported".

Each arm runs in a child process whose working directory is its tree, so each tree loads its own code. A tree must resolve its workspace packages inside itself: the tool refuses a tree whose `node_modules/@thenetwork/*` or `packages/*/node_modules/@thenetwork/*` links point outside it (such a copy runs the other tree's code). The child runs the invoking tree's `scripts/sim/paired.ts`, and the perturbations (`idsSalted`, `saltSeed`) come from the invoking tree's `packages/sim/src/paired.ts`; the worlds, the engine and the metrics come from the arm's tree. The `tsx` loader is resolved from the arm's tree. Make a tree with `git archive <rev> | tar -x -C <dir>`, then run `corepack pnpm@10.24.0 install --frozen-lockfile --offline` in `<dir>`. pnpm's workspace links are relative, so `cp -R` of an installed tree also works. The before A/A runs above used this tool on the before tree and reproduced its block value (pooled ntwrk meetings 174).

## Validity of the numbers

Every block number above comes from runs of 2026-11-21 between 03:30 and 06:18. After them the code changed in four ways: (1) the three keys without an instance id got one (time conflict: ntwrk; crew session: the friends pack arm; a meeting after a late joiner: ntwrk); (2) the slop probe coin moved into `answerProbe` with the same key strings, so slop trajectories do not change; (3) the StubNetwork STOP fix (push baseline and scenarios only); (4) the gate changes in "What changed". So the ntwrk and friends numbers will move again in a small way, and every number must be measured again with the commands in "Commands to run". Until then the tables are the measured state of the earlier code, not of this tree.

## Decisions for the product owner

1. **Late acknowledgement as consent (safety).** `spec/probeReply.md` lets a bare acknowledgement answer a probe when it is the member's only turn after that probe. A late 👍 to an older message then becomes consent to a newer probe, and the Network names the member. Options: (a) an acknowledgement never answers a probe that reveals a name (an explicit yes is needed); (b) an acknowledgement answers a probe only when no other message to the member is still unanswered; (c) keep the rule and accept the exposure. This branch changes nothing here, so the network block keeps its judge failure until the rule is decided.
2. **friends harm gate.** 0.48x before was 0.02x inside the 0.5x threshold; after re-keying it is 0.56x. Options: more seeds for this gate, a non-inferiority form, or an engine change that lowers harm. The threshold is not changed here.
3. **Fixture re-pins.** Three fixtures name a seed or generated members (friends opening hours, slop check-in, the slop baseline holds test). This branch pins the first two again to one seed or one pair with every assertion kept. Confirm that a re-pin of this kind is acceptable after a sanctioned world change; the holds test needs the same re-pin after a seed search.
4. **slop-live one date at a time.** Confirm that the gate's measure is the Network's own bookings (a booking ends at its cancellation or close), not the World's meeting list.

## Commands to run

```bash
corepack pnpm@10.24.0 run sim --only friends
corepack pnpm@10.24.0 run sim --only slop
corepack pnpm@10.24.0 run sim --only peon
corepack pnpm@10.24.0 run sim --only network
corepack pnpm@10.24.0 run sim --only audit,safety,ops,pipeline,pipeline-slop,relay,peon-seats
corepack pnpm@10.24.0 run sim --only matching --quick
node --env-file-if-exists=.env node_modules/vitest/vitest.mjs run --project integration packages/sim/test
node --import tsx --conditions eliza-source <run dir>/w1-eval/scratch/holds-seeds.mts "$PWD" 16,17,18,19,20,21,22,23   # a scratch script, not in the repository
```

## Not done

- The 20-seed default was not run: the machine load (load average 90 to 280) allowed only the blocks' own seeds.
- The A/A SDs come from 3 or 4 seeds.
- The friends A/A was not measured with identical proposals (for example the same matcher with its proposals in reverse order), so the effect of the planner's reordering is not separated from the world's coupling. The slop CRN gate does this check for slop.
- The blocks audit, safety, ops, pipeline, pipeline-slop, relay, peon-seats and matching, the integration suite and the e2e suite were not run on this tree.
