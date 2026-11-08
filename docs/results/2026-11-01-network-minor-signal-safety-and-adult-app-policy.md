# Minor signal safety review and adult app policy enforcement

`packages/network/src/network.ts`, functions `handleInbound`, `welcome`, `afterAgeQuestion`, and `welcomeJoined`. Base revision `a0ed7bc6495d9e524afc3d500738212a28dc7bc2` (upstream `main`). **No LLM calls, $0.**

## Defect

The network enforces strict safety policies to protect minors, including single-player mode, immediate removal from matching opportunities, safety case event recording for adult counterparts (`minor_after_contact` and `contact_with_minor`), and adult app isolation (network-consent-3, network-consent-19).

However, four critical safety gaps existed in `network.ts`:

1. **Dead code bypass on incoming minor signals for unknown-age members**:
   Members joining with an unspecified age start with `m.minor = true` (since `isMinor(undefined) = true`) and `m.minorSignal = false`. In `handleInbound`:
   ```ts
   if (c.minorSignal && m.minor) m.minorSignal = true;
   ...
   if ((isMinor(age) || c.minorSignal) && !m.minor) {
     m.minor = true; m.minorSignal = true;
     this.minorAfterContact(m.id);
     this.dropMember(m.id, "minors policy");
     this.ctx.log("minor_signal", { memberId: m.id });
     ...
   }
   ```
   Because `m.minor` was already initialized to `true`, the condition `&& !m.minor` was permanently false whenever a minor signal was received from an unknown-age member. As a result:
   - `this.minorAfterContact(m.id)` was never executed (adults they had contacted were not audited in safety cases).
   - `this.dropMember(m.id, "minors policy")` was never called (the member was not dropped from active or scheduled opportunities).
   - `minor_signal` was never logged.
   - On 18+ apps, the required `age_review` safety case event was skipped.

2. **Sending teen copy and activating minors on 18+ apps in `welcome(m)`**:
   In `welcome(m)`:
   ```ts
   if (m.minor) {
     m.stage = "active";
     this.send(m, this.copy.welcomeMinor(m.first), ...);
     return;
   }
   ```
   On an adult app (`this.app.minJoinAge > 13`, e.g. Slop/Peon), minors must receive no teen copy and no teen service (network-consent-19). Sending `welcomeMinor` and activating their stage violated adult app isolation.

3. **Sending teen copy instead of staff review in `afterAgeQuestion` on 18+ apps**:
   When a member resolved their age with a minor signal in `afterAgeQuestion`, `network.ts` sent `copy.minorNotice` and marked the member active, rather than removing them from matching and opening an `age_review` safety case.

4. **Missing 18+ app minor guard in `welcomeJoined`**:
   `welcomeJoined` only checked `validAge(m.age) && !this.canJoinApp(m.age)`. For members with minor status where `m.age` is undefined or non-numerical, it proceeded directly to `welcome(m)`, sending teen copy on 18+ apps.

## Fix

1. In `handleInbound`:
   - Compute `const newMinor = (isMinor(age) && !m.minor) || (c.minorSignal && !m.minorSignal);`.
   - When `newMinor` is triggered, set `m.minor = true` and `m.minorSignal = true`, execute `this.minorAfterContact(m.id)`, `this.dropMember(m.id, "minors policy")`, and log `minor_signal`.
   - On apps with `this.app.minJoinAge > 13`, record an `age_review` safety case event and halt without sending teen notices.
   - Add a guard `else if (this.app.minJoinAge > 13 && m.minor && !m.ageUnknown)` to drop and halt existing minors on adult apps.
2. In `welcome(m)`:
   - If `m.minor` on an app with `this.app.minJoinAge > 13`, drop the member, log an `age_review` case event, and return without sending `welcomeMinor`.
3. In `afterAgeQuestion`:
   - If `m.minor` on an app with `this.app.minJoinAge > 13`, drop the member, log an `age_review` case event, and return without sending `minorNotice`.
4. In `welcomeJoined`:
   - Guard against `this.app.minJoinAge > 13 && m.minor && !m.ageUnknown`, dropping the member and logging `age_review`.

## Verification

1. Unit tests:
   ```sh
   bun test packages/network/test/minor-signal-safety-and-adult-app-policy.test.ts
   ```
   4/4 passed (22 assertions).

2. TypeScript typecheck:
   ```sh
   bun run typecheck
   ```
   0 errors across all 4 tsconfigs (`.`, `sites`, `packages/observatory`, `deploy/cloudflare`).

3. Simulation conformance:
   ```sh
   bun run sim --only network,friends,evals
   ```
   104/104 blocking gates pass (network 61/61, friends 18/18, evals 25/25).

---

### Slop Contribution Receipt

```yaml
provider: google
model: gemini-2.5-pro
client: antigravity
```
