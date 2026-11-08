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

## 4. Not done, and limits

- `tests/e2e/auth-feedback.e2e.test.ts` skipped, because Playwright is not installed on this machine (`PLAYWRIGHT_MODULE` is not set). The callback path of `mountAuth` is covered by `api-security.test.ts`.
- The full `bun run sim`, `bun run test:integration` and `bun run test:e2e` were not run.
- No Quint models are written. The modeling requirement in AGENTS.md has the status "not yet met".
- The views, sites and server-ui slices had one mutant per core from the main session. They did not get the full adversarial pass that store and staff got.
- Bugs left, with reasons, from the implementer reports:
  - OAuth Cancel on the code page is still broken. It needs a change in `handler.ts` (backend session).
  - Backend: `reviewBlock` accepts an approve after the deadline; the OTP ban bypass is at `api.ts:471`.
  - These need copy changes, which CONTRIBUTING.md does not accept here: 0% against a dash on the Metrics tiles, the countdown tooltip, and the `/join` links in the terms.
  - Out of the slice file lists: B14 (graph view watch flag), and B5, B6, B8, B12, B16 in the views report.
- `number` is an ideal integer in the proofs. NaN, Infinity and fractions are guarded in the shell, not proved.
- Async order is not modelled. The wiring tests above cover the shell's calls into the cores.
- `lemmascript.json` is the same as on the backend branch. The shared setup (the devDependency, `bun run formal`, the CI Dafny step) is on `claude/lemmascript-backend`.
