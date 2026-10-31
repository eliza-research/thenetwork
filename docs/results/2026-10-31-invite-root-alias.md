# Inviter cohort walk and alias cycles

Hand-written. The command lines below are the runs from this checkout. No model was called. `bun run sim` clears provider keys, and no key was set. The reviewer in the network block is the simulated reviewer (`review: "auto"`).

## Defect

`World` follows `invitedBy` to a root. That root is the inviter cohort (PRD 33.8, ME-012). `idAliases` maps a phone or legacy id onto the member id before derived data is built (one ID space, PRD 33.5 and ME-006).

The cycle check compared the raw `invitedBy` string with canonical ids already visited. An alias is not that canonical id. A cycle stored with aliases never stopped. `new World(...)` did not return.

A chain that does not cycle already resolved. A cycle of plain member ids already stopped. The broken case is the alias cycle, including a member whose `invitedBy` is their own alias.

## Command

```bash
bun run --conditions eliza-source scripts/sim/network.ts
```

Seed 1. The members are fixed in `inviteRootGate` (`scripts/sim/network.ts`). The walk does not use randomness.

| Result | Before the fix | After the fix |
|---|---|---|
| Gate line | none | `PASS inviter cohort resolves alias invite chains and stops on a repeated canonical id` |
| Exit | 124 (stopped at 12 s) | 0 |
| Time | 12.1 s, still inside `World` | 0.125 s |

Before the fix the process printed only the missing-key warning, then did not finish. After the fix the same command prints the PASS line.

Roots after the fix, seed 1:

| Member | invitedBy | Root |
|---|---|---|
| a | phone:b (alias of b) | b |
| b | phone:a (alias of a) | a |
| c | phone:a | b |
| d | phone:e (alias of e) | f |
| e | f | f |
| f | none | f |
| g | phone:teen (alias of a 16-year-old) | g |
| p | q | q |
| q | p | p |
| s | phone:s (alias of s) | s |
| teen | none | teen |

`p` and `q` use member ids. Their roots match the previous stop rule (stop on the member before the repeat). `g` does not take the minor's id. `teen` is in `w.minors`.

## Other runs

`bun run typecheck`: pass (root, sites, observatory, deploy/cloudflare). About 16 s.

`bun run sim --only network --quick`: 48/48 blocking gates pass, 1 tracked, 112.3 s. The new gate is the first PASS.

`bun run sim` (full default blocks, dev Postgres on :54339, no `--quick`): **328/328 blocking gates pass**, 14 tracked off target, 351.4 s. Exit 0. The 14 tracked lines are the existing slop, relay, and friends metrics. They are not the new gate. Safety, ops, and pipeline ran on Postgres (they did not skip).

`bun run test:integration` (Postgres 16.15 on :54339): **681 pass, 8 skip, 0 fail**, 68 files, 223.3 s. Exit 0. The 8 skips are `isolated PostgreSQL completed cleanup reconciliation`. They skip without that suite's extra cluster. They are not this walk.

`bun run test:e2e`: **42 pass, 1 skip, 0 fail**, 3 files, 11.8 s. Exit 0. The skip is `failed security checks give recovery feedback and a later SDK success clears only that feedback`. It is not this walk.

No LLM. Provider and model: none. Calls: 0. Cost: 0.
