# One Friends standby place per member

A reviewed Friends table could list a person as a standby while another plan listed the same person as an initial invitee. In an eight-member fixture, the planner put two people on a closed-table bench after it assigned both to activity partners. The same fixture reproduced the collision in a repeat bench. The port keeps both partner invitations and removes the duplicate standby places. The original finding came from [#282](https://github.com/eliza-research/thenetwork/pull/282).

An open table contacts its extra candidates with the initial group. The test preserves those invitations. It also preserves standby places when the members have no initial invitation. The decision checks the published slate from all five plan types and reserves a standby once in planning order. The first alternative was to remove all rows labeled as alternates. That would remove some initial group invitations in the simulator. The second was to reserve the bench during the first planning pass. That would give a conditional invitation priority over a later initial invitation.

## Reproduce the result

Use Node 26.13.0 and pnpm 10.24.0. Run the same commands on `6664f931` and the port. To reproduce the original failure, copy only the new integration case to `6664f931`. It expects an empty closed-table bench and gets two standby candidates. The port passed all 19 cases across the seat-window, plan-reply, and venue-capacity integration files.

```sh
node node_modules/vitest/vitest.mjs run --project integration \
  packages/network/test/friends-seat-window.integration.test.ts \
  packages/network/test/plan-reply.integration.test.ts \
  packages/network/test/plan-venue-capacity.integration.test.ts
pnpm run sim --only friends
node --import tsx --conditions eliza-source packages/sim/src/apps/friends/cli.ts \
  --only pack --seeds 9-12 --n 400 --weeks 8 --json /tmp/friends-standbys-holdout.json
```

## Paired measurements

Each seed generates 400 synthetic personas and eight weeks with the default Friends pack. The automated suite uses seeds 5–8. The holdout uses seeds 9–12. There were no model calls, external sends or real members. The fixture is hand-written. The weekly outcomes come from the simulator.

| Measure | Baseline | Port |
| --- | ---: | ---: |
| Blocking gates | 29/29 | 29/29 |
| Pinned repeat-meetup rate | 30.466% | 30.466% |
| Pinned V14 | 37.251% | 37.244% |
| Pinned total harm events per seed | 19.75 | 19.75 |
| Holdout repeat-meetup rate | 27.017% | 27.017% |
| Holdout V14 | 34.417% | 34.383% |
| Holdout total harm events per seed | 21.75 | 21.50 |

The repeat rate is identical in each of the eight seed pairs. The exploratory paired 95% t interval for the V14 change is −0.074 to +0.061 percentage points on the four pinned seeds and −0.145 to +0.076 on the holdout. The holdout harm change has an interval of −1.05 to +0.55 events per seed. All eight pairs have zero declared-minor contacts and zero known-adversary contacts. The pinned undetected-harm comparison remains above its tracked target on both revisions. The small synthetic sample does not establish a population-level quality change.

The generated standby decision passed 12,000 Quint traces, 402 TypeScript replays and all 19 Dafny obligations in the weekly model. The native fixture covers the published slate and the two invitation roles used by the TypeScript planner. TypeScript passed. The product review ledger is pending.
