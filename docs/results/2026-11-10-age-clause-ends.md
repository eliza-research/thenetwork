# Age clause ends

Date: 2026-11-10 (Asia/Calcutta). Command: `bun run sim --only evals,onboard`. No seeds. The readers are deterministic. No model call. Provider keys were not set.

## Before, on `a0ed7bc`

| Text | Network `statedAge` | slop age | slop declined |
|---|---|---|---|
| I'm 3 and 0 this season | none | 3 | yes |
| im 8 now | none | 8 | yes |
| I'm 12.5 minutes away | 12 | none | no |
| I'm 12 and a half | none | 12 | yes |
| I'm 4 and a half | none | 4 | yes |
| im 16 and a half | 16 | 16 | no |
| i'm 38 and divorced | 38 | 38 | no |

## After

| Text | Network `statedAge` | explicit | slop age | slop declined |
|---|---|---|---|---|
| I'm 3 and 0 this season | none | none | none | no |
| im 8 now | none | none | none | no |
| I'm 12.5 minutes away | none | none | none | no |
| I'm 12 and a half | 12 | 12 | 12 | yes |
| I'm 4 and a half | 4 | 4 | 4 | yes |
| im 16 and a half | 16 | 16 | 16 | no |
| i'm 38 and divorced | 38 | none | 38 | no |
| I'm 12 and I like games | 12 | 12 | 12 | yes |
| i'm twelve and i like games | 12 | 12 | 12 | yes |
| I'm 12 and 0 this season | none | none | none | no |
| I'm 15 now | 15 | none | 15 | no |
| I'm 15 too | 15 | none | 15 | no |
| I'm 38 and I like games | 38 | 38 | 38 | no |

"I'm 12 and I like games" is an explicit age 12. "and" starts a new clause ("I like games"), so the number is the age at every age, including under 13. The slop reader declines it. The network reader stores it as an explicit age, which is the decline path in docs/network.md section 6.3. "and" followed by a number ("I'm 3 and 0", "I'm 12 and 0") is still not an age. "now" and "too" still end an age only at 13 or older.

`bun run sim --only evals,onboard` after the first change: 45/45 blocking gates pass. `bun run typecheck` exits 0. Full `bun run sim` after that change, before PostgreSQL was installed: 306/306 blocking gates pass in 408.8s, and the Postgres tracked gates skip.

## Tests after the clause fix, with PostgreSQL 16.15

Dev cluster from `bun run packages/observatory/db/dev-pg.ts up` on port 54339. `initdb`, `pg_ctl`, and `psql` are PostgreSQL 16.15. No provider keys.

- `bun run typecheck`: exit 0.
- `bun run sim --only evals,onboard,safety,ops,pipeline,audit`: 104/104 blocking gates pass in 25.1s. Two tracked gates are off target. One is the existing ported-parser miss (94.1%, unset age ranges such as "late twenties"). The other is `ops tables on Postgres`: `SQLError: COMMIT was rolled back by the server because the transaction was already aborted`. That gate is in `scripts/sim/ops.ts` and does not use the age readers.
- `bun run sim --only network`: 61/61 blocking gates pass in 234.8s, 0 tracked gates off target. That includes the minor-join scenarios and the conformance gates (0 minors in any role).
- `bun run test:e2e`: 42 pass, 1 skip, 0 fail, 43 tests, 11.55s. The skip is `failed security checks give recovery feedback and a later SDK success clears only that feedback`.
- `bun run test:integration`: 680 pass, 8 skip, 1 fail, 689 tests, 238.51s. The eight skips are `isolated PostgreSQL completed cleanup reconciliation`. The failure is `real mode fixes and per-app panels (Postgres) > an app login outside the app's role is refused...` in `packages/observatory/test/real-fixes.test.ts`. Both shadow runs return: `The argument 'strings' has an enumerable 'raw' property, so it is not a template object`. That comes from `appSnapshotSql` in `packages/observatory/src/sources/real.ts`, which this change does not edit. The query is the snapshot join on `platform.matching_ages`.

## Review follow-up, merged with main `64d85fb`

The shared fragments live in `packages/core/src/policy.ts`: `AGE_LOOSE_TAIL`, `AGE_AND_CLAUSE`, `AGE_AND_A_HALF`, `AGE_HALF`, `AGE_NOT_MEASURE`, and `ageAtLeastMin`. `ageAtLeastMin` uses `MIN_MEMBER_AGE` from the generated member-age spec. The network reader's other 13+ endings (`honestly`, `last week`, and the rest) stay local to that reader.

Per-sentence age reading on main split `12.5` into `12.` and `5`. The age scan joins a digit, a dot, and a digit back into one sentence before it reads an age. `I'm 30. I'm 15.` is still 15.

After that merge, on 21 Nov 2026 (Asia/Calcutta): `bun run typecheck` exits 0, and `bun run sim --only evals,onboard` is 50/50 blocking gates (evals 31/31, onboard 19/19). One tracked onboard miss remains: ported parser rows at 98.4%, with `lesbian`, `two miles`, and `half a mile` unset. PostgreSQL was not started for this follow-up.

## Ported onto vibestack `f662eda0`

The pull request base is `vibestack`. A half age or an "and I/we/my" clause under `MIN_MEMBER_AGE` is a stated age on the network reader and is not explicit, so it does not delete the member. The same forms at 13 or older stay explicit. A half followed by years (except "years old"), months, weeks, days, steps, or inches is not an age.

On 22 Nov 2026 (Asia/Calcutta), Node 26.13.1: `pnpm run sim --only evals,onboard` is 51/51 blocking gates. `./node_modules/.bin/tsc --noEmit -p .` exits 0. The tracked onboard miss is still 98.4%. PostgreSQL was not started. Integration, e2e, and the full sim were not re-run.
