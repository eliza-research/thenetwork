# packages/sim/src/apps: the per-app worlds

Simulated worlds for the apps on The Network's shared matching engine, one folder per app. They were
`@thenetwork/worlds` until 2026-10-08. The Network's own world is the rest of `packages/sim`.

- `slop/`: slop.date (dating). Personas with hidden truth, the agent-visible snapshot
  (`buildSlopSnapshot`, read back with `visibleProfiles`), the oracle (`SlopOracle`, soft labels
  over chemistry), the persona behaviour model, the probe-first booked-plan harness
  (`runSlopWorld`), metrics and baselines (random, greedy-by-desirability, oracle-optimal).
  Model, calibration, snapshot mapping and baseline numbers: `docs/results/2026-10-08-slop-world.md`.
  The slop.date AppPack runs here through the real engine (`enginePack.ts slopEngineMatcher`,
  async: `runSlopWorldAsync`); `packEval.ts` compares it with the baselines and checks the launch
  gates: `docs/results/2026-10-08-slop-pack.md`.
- `peon/`: peon.biz (hiring). Candidates, companies and jobs with hidden truth and a sealed store,
  the application-flow harness, the adverse-impact audit, `officialGates`:
  `docs/results/2026-10-08-peon-pack.md`. `yardstick.ts` is an offline yardstick for the peon
  selector. It never runs in the engine path and never changes a proposal. Each week the engine-backed
  matcher (`packMatcher`) records a `PeonMarket`: the eligible Hire pairs that the engine scored, the
  value that the greedy order uses for each pair (the score times 1,000, rounded), and the room of each
  member. The room is rebuilt from the pack and engine rules, not read from the run: 0 in an open
  opportunity, else the smaller of the proactive budget left and the pack limit (a seat's slate cap,
  the Hire weekly capacity of a candidate). `load` holds every proposal of the run, in all lanes, for
  each member, against the same room. `optimumSelection` finds the largest total value of pairs within
  every room, each pair at most once: a maximum-weight b-matching, solved exactly as a min-cost flow
  (successive shortest paths with potentials on source, candidate, seat, sink, cost minus the value).
  It stops at the first path that does not raise the total, so the flow has the largest value, not the
  largest size. It is deterministic: the pairs are sorted and ties keep the first path. The other
  matchers record no market. `marketMeasures` sums the weeks of one run, and `trackedGates`
  (`gates.ts`) prints the tracked measures: the role-level gap of backed pairs, the greedy share of the
  optimum, proposals over room, and the load of candidates and seats. Each tracked measure has a
  target, and the targets never block. Results: `docs/results/2026-11-22-peon-level-gap-and-yardstick.md`.
- `friends/`: friends.help (NYC friendship). Personas, meetups, crews, `officialGates` and tracked
  metrics: `docs/results/2026-10-08-friends-pack.md`.

  The friends harness runs weekly rounds over about 400 New Yorkers. Week 0 of every friends run starts on Monday 2026-10-12, New York time (`FRIENDS_WORLD_START` in `friends/persona.ts`). Each week:
  1. Members answer the optional check-in ("what's your week like?"). The answers are stated windows.
  2. The matcher reads only the snapshot. It returns new plans (groups of 3 to 6, or an activity
     pair), "same table again" repeats, crew offers and crew sessions.
  3. Probes are anonymous and name the activity first, with 1 to 3 time options. Each member answers
     with the options that they are really free for. A plan books the option that most yes-sayers
     picked when the quorum is met. Alternates are probed to fill seats. A pair is asked one person
     after the other.
  4. The reveal is the booked plan: names go to each member, and this is a contact. A member can back out.
  5. The world draws attendance, enjoyment (least misery), harms, private "see again?" answers and
     hours together.
  6. Each member opts in to a crew offer. Three or more yeses form the crew. A crew meets weekly.
     After 3 sessions the crew moves to its own group chat and keeps meeting with less frequency.
  7. Pairs who both want to meet again also meet on their own (hidden hangouts).

  Caps: at most 1 new-plan invite for each member each week (repeats count; crew sessions and crew
  offers do not), at most 2 booked meetups for each member each week, and never two in one slot. A
  proposal past a cap loses that member and does not tell them. A proposal whose roster breaks the
  teen age rule (`spec/friendIntroAge.md`) is dropped and counted as `ageRuleBroken` (it must be 0).

  The snapshot gives each member the age on the snapshot day from the stated birth date (`birthKey`,
  `birthExact`, `maxAge`). An adult or a teen-ready minor gets the categories social and hobby. A minor
  who is not teen ready gets social only and no intent, so the engine never matches them.

  Onboarding checks are observable outcomes, not labels. Liveness: 95% of people pass, 4% never finish
  (pending) and 1% fail; 85% of bots fail. Age assurance: a facial age estimate (true age plus noise
  with SD 2.5). An estimate of 25 or more passes. Below 25 the member must show an ID: 90% of real
  adults finish it, and 97% of lying minors fail. A stated minor has no check result (pending). The
  production friends pack refuses a member without both passes (rule `unverified`), and only the staff
  verify path writes them, so the friends world does not give a teen a pass that production does not
  write.

`pnpm run sim` runs each app's official gates on pinned seeds (scripts/sim/{slop,peon,friends}.ts).
The CLIs print the full tables and exit 1 when an official gate fails:

```bash
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/slop/cli.ts --seeds 1-8 --per-city 300 --weeks 4     # slop baselines
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/slop/packEval.ts --seeds 13-16 --weeks 4 --arms random,slop --gates3 \
  --population '{"catfish":0.005,"bodyTypes":true}' --world '{"verification":true,"relay":true,"review":3,"widen":true,"checkin":true,"photos":1,"rater":true}'
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/peon/cli.ts --seeds 13-16
node --import tsx --env-file-if-exists=.env packages/sim/src/apps/friends/cli.ts --seeds 5-8
```

Network code never imports hidden truth from here: matchers read only the snapshot. The worlds run
without any LLM.
