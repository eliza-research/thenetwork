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

`bun run sim --only evals,onboard` after the change: 45/45 blocking gates pass. `bun run typecheck` exits 0. Full `bun run sim` after the change: 306/306 blocking gates pass in 408.8s. Postgres is not installed here, so the Postgres tracked gates skip. The other tracked misses are the existing slop and relay targets.
