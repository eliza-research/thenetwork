# Simulation CPU and startup

Baseline `9bfc456c`, Node 26.13.0 on arm64 macOS. The processes shared the host with other jobs. CPU time includes user and system time. Each pair used the same corpus, seed and settings. The commands ran offline with zero model requests.

| Workload | Baseline median CPU | Revised median CPU | Samples per variant |
| --- | ---: | ---: | ---: |
| All ordered Slop date scores, 420 planted members, seed `matching-1` | 110.60 ms | 32.09 ms | 8 |
| Slop quick matching simulation, seeds 1–3, including the 10,000-member search | 15.91 s | 14.69 s | 3 |
| Eval-only CLI, 31 blocking gates | 2.37 s | 1.38 s | 5 |

The scorer now reuses the lifestyle comparison functions. Activity selection finds the best shared activity in one pass, then checks the remaining activities when the pair shares none. Its ordering includes the existing alphabetical tie break for unlisted activities. The same 176,400 ordered pairs returned the same compatibility estimate, activity and integer pack value. A second seed, `matching-7`, covered 9,612 additional combinations of goals and known or unknown lifestyle fields. A separate cross product checked 121 pairs of activity lists, including empty lists, duplicates and unlisted activities.

The application comparison used the original CLI for both sides and changed only the scorer. Each invocation was equivalent to `pnpm run sim --only matching --matching-pack slop --quick --json gates.json`. All six reports had identical gate results and metrics after excluding elapsed milliseconds. The separate CLI comparison ran `pnpm run sim --only evals --json gates.json` with static and on-demand block loading. All ten reports contained the same 31 results, including their details. Median elapsed time fell from 1.79 to 1.02 seconds. Full CI continues to select every default block.

Two experimental changes to the search loop were measured and set aside. Indexed query tag membership improved the median Friends sample and slowed Slop at 10,000 members. A sparse bitmap for touched positions gave the same mixed result at 100,000 members. Both compared the ordered candidate IDs, values, checks, touches, exactness and unseen bound on the same queries. The current search loop remains the reference.

This report is hand-written from process timings, simulator JSON and direct output comparisons.
