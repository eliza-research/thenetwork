# People request category opt-in and romance gate enforcement

`packages/network/src/network.ts`, functions `openRequest`, `retryRequests`, `searchFor`, and `askFit`. Base revision `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` (upstream `main`). **No LLM calls, $0.**

## Defect

People requests (`openRequest`, `retryRequests`, `searchFor`) allow members to ask the network to find other people for a specific want or interest. However, four critical category opt-in and romance safety checks were missing or incomplete:

1. **Requester category and romance opt-in check in `openRequest`**:
   `openRequest` verified whether `this.allowedCategories.has(c.category ?? "social")`, but failed to check whether the requester had opted into that category (`rm.prefs.categoriesOptIn.includes(cat)`). Additionally, for romance requests, it failed to verify that the requester was a verified adult with explicit romance consent (`rm.prefs.romanceOptIn && rm.prefs.categoriesOptIn.includes("romance")`). As a result, members who opted out of specific categories (e.g. social or romance) had requests opened on their behalf instead of being answered with `copy.requestOutOfScope`.

2. **Candidate category opt-in in `searchFor`**:
   `searchFor` iterated candidates `x` and evaluated match fit, but never checked `rx.prefs.categoriesOptIn.includes(req.category)`. A candidate who opted out of professional networking or social meetups could be matched and contacted for those requests.

3. **Romance gating bypass in `searchFor` and `askFit`**:
   In `askFit`, the safety comment states: `if (def?.category === "romance") s = 0; // romance only via the engine's opt-in checks`. However, `req` did not pass `category` and only inspected `def?.category`. If a romance request was submitted without a recognized catalog `desireId`, `def` was undefined, bypassing the romance suppression and computing positive match scores based on shared tags (`0.35 + 0.15 * shared.length >= 0.50 >= 0.45`). Furthermore, `searchFor` never evaluated `this.romanceGate([m.id, x.id])`, allowing incompatible or unverified candidates to be returned.

4. **Category opt-in verification during standing retries in `retryRequests`**:
   When retrying standing requests up to 7 days old, `retryRequests` failed to check if the requester had subsequently opted out of the request's category or revoked romance opt-in.

## Fix

1. In `openRequest`:
   - Enforce requester opt-in against `c.category ?? "social"`.
   - If the requester's `categoriesOptIn` excludes the category, log `request_out_of_scope` and respond with `copy.requestOutOfScope`.
   - If the category is `"romance"`, verify romance opt-in (`romanceOptIn`, `categoriesOptIn.includes("romance")`, verified adult age `>= 18`, and absence of minor flags).
2. In `searchFor`:
   - Filter out candidate `x` if `rx.prefs.categoriesOptIn && !rx.prefs.categoriesOptIn.includes(req.category)`.
   - If `req.category === "romance"`, filter out candidate `x` if `this.romanceGate([m.id, x.id]) !== undefined`.
3. In `askFit`:
   - Accept optional `category?: Category` in `req`.
   - Enforce `if (req.category === "romance" || def?.category === "romance") s = 0;`.
4. In `retryRequests`:
   - Check requester's current `categoriesOptIn` and romance opt-in before attempting retries.

## Verification

1. Unit and regression tests:
   ```sh
   bun test packages/network/test/request-category-optin-and-romance-gates.test.ts
   ```
   5/5 passed (16 assertions).

2. TypeScript typecheck:
   ```sh
   bun run typecheck
   ```
   0 errors across all 4 tsconfigs.

3. Simulation suites:
   ```sh
   bun run sim --only network,friends,evals
   ```
   All 18 friends gates, all 25 evals gates, and all conformance gates pass.

---

### Slop Contribution Receipt

```yaml
provider: google
model: gemini-2.5-pro
client: antigravity
```
