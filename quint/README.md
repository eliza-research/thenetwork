# Quint models

Quint is the high level of the formal modeling rule (AGENTS.md, "Formal modeling requirement"). Each model holds one flow: its states, its transitions and its invariants, across the browser and the server. The low level is LemmaScript: the step functions in the shipping code have `//@ ` contracts that Dafny proves (`LemmaScript-files.txt`, `proofs/`). An invariant has the same name at both levels.

Toolchain: Quint 0.33.1 (`npx @informalsystems/quint@0.33.1`). Apalache is not set up, so the checks are `quint typecheck`, `quint test` (replayed traces) and `quint run` (random simulation with fixed seeds). A random run is a bounded search, not a proof.

## Frontend models

| Model | Flow | LemmaScript core | Shell |
|---|---|---|---|
| `frontend/join_flow.qnt` | Web Join: phone, code, profile, done, with late answers and a second tab | `sites/shared/join-core.ts`, `packages/core/src/phone-core.ts` | `sites/shared/join.ts`, `auth.ts` |
| `frontend/review_desk.qnt` | Staff review desk: queue, chosen card, keys, modes, deadlines, the matching flip, remounts | `packages/observatory/web/logic/review.ts` | `review.tsx`, `admin.tsx`, `apps.tsx` |
| `frontend/observatory_sync.qnt` | Console sync: app switch, load generations, delta versions, reveal badges, filters | `packages/observatory/web/logic/sync.ts`, `filters.ts` | `store.ts`, `map.ts`, `drawer.tsx` |
| `frontend/console_views.qnt` | Console person views: the read gate, the adults-only photo gate, tabs, proposals | `packages/observatory/web/logic/views.ts` | `panels.tsx`, `main.tsx`, `ui.tsx` |

The header of each file gives its bounds, its run commands and what stays outside the model. Each model has `witness_*` invariants. A witness is expected to be violated: it shows that the run reaches the state that the matching invariant is about, so a pass is not vacuous.

## How to run

```bash
quint typecheck quint/frontend/review_desk.qnt
quint test quint/frontend/review_desk.qnt
quint run quint/frontend/review_desk.qnt --invariant=safety --max-samples=5000 --max-steps=20 --seed=101
```

`observatory_sync.qnt` takes `--step=tick` (all events) or `--step=syncTick` (sync events only).

## Expected violations (open server work)

Each of these invariants fails today because of a gap on the server. The comment at each invariant explains the gap.

| Invariant | Gap | Owner |
|---|---|---|
| `join_flow.joinAppliesToShownAccount` | `GET /api/me` gives `signupView` only on ntwrk and friends (`packages/platform/src/api.ts:513`), so on slop.date and peon.biz `/api/join` joins the current cookie account. The marker variant (`joinAppliesToShownAccountWithMarker`) holds. | backend |
| `review_desk.serverApproveBeforeDeadline` | `reviewBlock` in `packages/network/src/network.ts` has no deadline check. | backend |
| `review_desk.approveMatchesSeenPeople` | A review decision names only the opportunity id, not the version the reviewer saw. | backend |

## Backend models

The state-machine session plans the backend modules (`quint/turn_consent.qnt`, `quint/join_age.qnt` and others) on its own branch. Those modules are not written yet.
