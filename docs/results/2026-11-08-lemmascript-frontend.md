# LemmaScript frontend cores: wave 2 results

Date: 2026-11-08. Base: main a0ed7bc. Branch: claude/lemmascript-frontend (draft PR eliza-research/thenetwork#419).
Toolchain: lemmascript 0.6.6 (`lsc`), Dafny 4.11.0, Bun test. No LLM calls: this work is proofs and browser-side logic, so CONTRIBUTING.md section 7.2 does not apply to these results.

Hand-written: this file. Generated: the `proofs/**/*.dfy.gen` files and the `lsc` and test outputs quoted below. Agent work: five implementer agents wrote the cores and the shell edits, and two skeptic agents verified the store and staff slices. The skeptic agents for views, sites and server-ui stopped at a usage limit. The main session then did those checks by hand (section 3).

Research input: [docs/research/lemmascript/frontend.md](../research/lemmascript/frontend.md).

## 1. Cores

Each core is import-free, is listed in `LemmaScript-files.txt` and is imported by the shipping code.

| Core | Called by | `lsc check` | Verified by |
|---|---|---|---|
| `packages/observatory/web/logic/sync.ts` | `store.ts`, `map.ts` | 24 verified, 0 errors | skeptic agent, 19 mutants for sync and filters together |
| `packages/observatory/web/logic/filters.ts` | `store.ts`, `drawer.tsx` | 11 verified, 0 errors | skeptic agent (see above) |
| `packages/observatory/web/logic/review.ts` | `review.tsx`, `admin.tsx`, `apps.tsx` | 18 verified, 0 errors | skeptic agent |
| `packages/observatory/web/logic/views.ts` | `panels.tsx`, `drawer.tsx`, `main.tsx`, `ui.tsx` | 31 verified, 0 errors | main session, 2 mutants |
| `sites/shared/join-core.ts` | `sites/shared/join.ts`, `auth.ts` | 5 verified, 0 errors | main session, 1 mutant |
| `packages/core/src/phone-core.ts` | `sites/shared/api.ts`, `packages/platform/src/phone.ts` | 15 verified, 0 errors | main session, 1 mutant |
| `packages/mcp/src/html-core.ts` | `packages/mcp/src/util.ts`, `pages.ts` | 30 verified, 0 errors | main session, 1 mutant |
| `tools/clef-label/core.ts` | `tools/clef-label/index.html` (inlined by `build.ts`) | 33 verified, 0 errors | main session, 1 mutant |

Total: 167 verified, 0 errors. Trust scan: `grep -rnE "\bassume\b|\baxiom\b|\{:extern|\{:axiom" proofs` gives 0 lines. For each `.dfy`, `diff X.dfy.gen X.dfy` has no `<` lines (additions only).

## 2. Bugs fixed

The numbers refer to the slice reports in docs/research/lemmascript/.

- **Observatory state** (store.ts, map.ts): B1-B12, B15-B19, and a roles fallback that did not match the server. Examples: a slow load for the old app overwrote the new app; an old delta moved the version back; the Origin filter hid Safety events; a failed `/api/me` showed admin controls. B13 (daylight-saving day start) is fixed in the shell and is not proved.
- **Staff work** (review.tsx, admin.tsx, apps.tsx): items 1-6, 8-14, 16 and 17. Examples: a decision went to an item the reviewer did not choose; one held key approved four items; the confirm press could turn matching on when the admin pressed Turn off.
- **Views** (panels.tsx, drawer.tsx, main.tsx, ui.tsx): B1, B4, B10, B13, B14, B15, the drawer table, a rate clamp, and a fail-closed `canPropose`. Example: a person who stated 16 still showed the adult photo form after an older read landed last.
- **Sites** (sites/shared): B1, B2, B5-B10. Example: a foreign number such as +65 9234 5678 was changed into a US number. Now the client refuses it, and the client and the server use the same `phone-core.ts`.
- **Server UIs** (mcp pages, clef-label): OAuth Cancel on the phone page (the CSP `form-action` now lists the redirect origin), flagged photos shown again in the label tool, undo, the retry gate and the CSP target filter.

## 3. Checks done by the main session

The skeptic agents for views, sites and server-ui did not run. The main session did these steps:

1. **Views proof repair.** The views skeptic stopped after it found one real bug and added stronger specs. The bug: `readLand` returned `show: true` for a stale read. Its fix (`show: false`) is kept. The new `yesCounts` postcondition (`yes > 0` only when one opportunity has a yes from everyone) did not prove, because Dafny found no witness for the nested quantifier. Fix: a ghost witness `w` in `views.dfy` (4 lines added, no change to the TS). Result: 31 verified, 0 errors.
2. **Mutation checks.** For each mutant: mutate the TS, run `lsc regen`, run `lsc check`, then restore.

   | Mutant | Result |
   |---|---|
   | views: count `yes` on revealed (`if (r) yes++`) | 2 errors (the `.dfy` was built by hand, because `regen` had a merge conflict next to the added line) |
   | views: show a stale read (`show: true`) | 7 errors |
   | phone-core: accept a `+` number that does not start with 1 | 1 error |
   | html-core: do not escape `'` | 3 errors |
   | clef-label core: `repeatPool` returns flagged pairs | 1 error |
   | join-core: keep another account's fields | fails on the `formResets` postconditions |

3. **Typecheck.** `bun run typecheck` found two errors. Both are fixed:
   - `packages/platform/test/api-security.test.ts:236` (security suite) called `mountAuth(root, () => {})`, but the sites implementer had changed the signature to `mountAuth(root, flow)`. The e2e page in `tests/e2e/auth-feedback.e2e.test.ts` makes the same call. Fix: `mountAuth` accepts the old callback too. It then builds a sign-in-only flow from `initialFlow` and `flowNext`, so the step decision still goes through the proved core.
   - `map-markers.test.ts` imports a `.tsx` file and failed under the root tsconfig. It is renamed to `map-markers.test.tsx`.

   After the fixes, `bun run typecheck` is clean.
4. **Tests** (dev Postgres on :54339):
   ```
   bun test packages/observatory/test/store-sync.test.ts packages/observatory/test/map-markers.test.tsx \
     packages/observatory/test/staff-keys-ui.test.tsx packages/observatory/test/views-ui.test.tsx \
     packages/observatory/test/held-photo-ui.test.tsx sites/test/join-flow.test.ts sites/test/clef-label.test.ts \
     sites/test/contract.test.ts packages/mcp/test/oauth-pages.integration.test.ts packages/platform/test/api-security.test.ts
   ```
   Result: 123 pass, 0 fail.

   The store implementer ran the new store and map tests against main's `store.ts` and `map.ts`: 20 of 22 cases failed, and the 2 that passed pin behavior that was kept on purpose.

## 4. Skeptic passes, Quint models and model-found defects

**Skeptic passes on views, sites and server-ui** (one agent per slice, after the usage limit reset):
- 83 mutants in all; 81 were caught. The 2 that were not:
  - one showed a weak `yesCounts` contract, now an exact count;
  - one was an equivalent mutant.
- Weak contracts were made stronger: `formOrigin`, `formTargets`, `hasFlag`, `samePair`, three `flowNext` clauses and five phone clauses.
- `undoKeepsFlags` returned true and no code called it. It was removed, and its property is now an `ensures` on `undoIndex`.
- The Metrics tiles computed their own percentages, and one showed 133%. They now use the core `rate`.
- `esc` gives the same bytes as the old regex escaper on 200,000 random strings.
- Code-page Cancel: `handler.ts` (a backend file, changed by 2 lines only) now passes `redirectHost` to both `codePage` calls. An integration case through the real OAuth handler checks the CSP. It fails with main's `handler.ts`.

**Quint models** in `quint/frontend/` (see [quint/README.md](../../quint/README.md)): `join_flow`, `review_desk`, `observatory_sync`, `console_views`.
- Each step function of the core is a `pure def` with the same name, and each invariant has the name of the LemmaScript contract it matches.
- Each model has `witness_*` invariants that are reachable, and at least 2 mutants that `quint run` catches.

**Defects found by the models.** These were not in the research reports. Each is fixed in the shell, and the decision is in the core where it is a decision.
- JF-1: a late `/api/me` answer could sign the Join flow in as the number on screen while the cookie session was another account.
- JF-3: a second submit during the `account_changed` reroute joined the cookie account with the fields of the account on screen.
- Reveal badge: a failed or stale `GET /api/reveal`, or a lost POST answer, removed the badge while the server still held the PII grant.
- Review desk: after the queue unmounted and mounted again, a late answer moved focus, so the next `a` approved an item the reviewer did not choose.

Each fix has an integration case that fails before the fix. The Quint models were updated to the fixed shell, and the violated invariants hold on 20000 samples with two seeds. The old traces stay reachable in scratch mutants.

**Check with a new seed** (seed 101, 5000 samples, run by the main session):
- `join_flow`: `safety`, `signInMatchesSession` and `joinAppliesToShownAccountWithMarker` hold.
- `observatory_sync`: `good` and `badgeFollowsGrant` hold.
- `console_views`: `photoNeverMinor`, `shownRise` and `canPropose_noMinor` hold.
- `review_desk`: `safety` and `decisionOnlyToReviewerChoice` hold.
- The expected violations stay violated: `joinAppliesToShownAccount` and `serverApproveBeforeDeadline`. `quint test` passes for each model that has replayed traces (5 and 7 traces).

**Expected violations (server work, backend session):**
- JF-2: `GET /api/me` gives `signupView` only on ntwrk and friends (`api.ts:513`, from #89). So on slop.date and peon.biz, `/api/join` joins the current cookie account. The shell now sends the marker whenever the server gives one.
- `reviewBlock` has no deadline check.
- A review decision does not name the version the reviewer saw.

## 5. Full suites

The suites ran one after the other, with `nice -n 10`, on a shared machine (load average about 17):

| Command | Result |
|---|---|
| `bun run typecheck` | exit 0 |
| `bun run test:e2e` | 42 pass, 1 skip (Playwright), 0 fail |
| `bun run test:integration` | 766 pass, 8 skip, 22 fail (these also fail on main, see below) |
| `bun run sim` | 327/327 blocking gates pass |

All 22 failures are in Observatory real-mode and network Postgres files, which this branch does not change (`git diff main -- packages/observatory/src packages/observatory/db packages/network` is empty). The errors came from the shared dev database, for example `relation "network.network_state_console_cross_app" does not exist`, while other sessions used it. The `relation ... does not exist` lines are noise: `apps.test.ts` renames that view on purpose. The real error is `Could not read the network schema: Failed to read data`, from the Postgres driver. Postgres had 19 of 100 connections in use, so the cause is not too many connections.

When each file ran alone on this branch, `shared-agent.integration` (14 pass) and `gateway-fixtures.integration` (7 pass) passed. Six Observatory real-mode files failed:
- `real-console`: 6
- `real-fixes`: 5
- `real`: 4
- `real-service`: 3
- `apps`: 2
- `server`, `consent` and `staff`: 1 each

On a clean `main` worktree with the same database, `real-console` failed with the same 6 tests and the same error. `real-service` and `apps` failed with the same 5 tests. So these failures exist on main in this environment, and they are not from this branch. They are not diagnosed further here.

`bun run sim` (one full run, at the end): exit 0, 327 of 327 blocking gates pass, 14 tracked gates off target, 364.6 s. The run made no model calls (the sim clears the provider keys).

## 6. Not done, and limits

- `tests/e2e/auth-feedback.e2e.test.ts` skipped, because Playwright is not installed on this machine (`PLAYWRIGHT_MODULE` is not set). The callback path of `mountAuth` is covered by `api-security.test.ts`.
- The modeling rule in AGENTS.md is still "not yet met" for the whole app. Only the frontend flows above have Quint models and LemmaScript cores. The backend modules are planned by the state-machine session.
- Quint checks are random simulation with fixed seeds (no Apalache). A pass is a bounded search, not a proof.
- Bugs left, with reasons, from the implementer reports:
  - Backend: `reviewBlock` accepts an approve after the deadline; the OTP ban bypass is at `api.ts:471`.
  - These need copy changes, which CONTRIBUTING.md does not accept here: 0% against a dash on the Metrics tiles, the countdown tooltip, and the `/join` links in the terms.
  - Out of the slice file lists: B14 (graph view watch flag), and B5, B6, B8, B12, B16 in the views report.
- `number` is an ideal integer in the proofs. NaN, Infinity and fractions are guarded in the shell, not proved.
- In LemmaScript, async order is not modelled. The Quint models cover late, repeated, failed and lost answers within their bounds, and the wiring tests cover the shell's calls into the cores.
- `lemmascript.json` is the same as on the backend branch. The shared setup (the devDependency, `bun run formal`, the CI Dafny step) is on `claude/lemmascript-backend`.
