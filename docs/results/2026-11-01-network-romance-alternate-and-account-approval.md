# Enforce romance gate, category opt-in, and account status in alternates and review

## Context & Root Cause

Under the Network's safety and matching architecture, sensitive categories such as romance (`category: "romance"`) and administrative member restrictions (`m.account`) carry strict invariants:
- **Romance Gate (`romanceGate`)**: PRD 32.1 and safety conformance require that romance matches must be mutually compatible between exactly two adult participants who have verified ages (>= 18, not minor, no minor signal, no age conflict), explicitly opted into romance (`romanceOptIn: true`, `categoriesOptIn.includes("romance")`), and possess mutual gender/orientation alignment (`romance:is:` matches `romance:seeks:`).
- **Category Opt-in (`categoriesOptIn`)**: Members must not be introduced or proposed for categories they have not opted into or have explicitly excluded in their preferences (`r.prefs?.categoriesOptIn`).
- **Account Status (`m.account`)**: Administratively suspended, restricted, or paused accounts (`account_paused`, `account_restricted`) must not be approved for matching or outreach.

However, several critical alternate selection and review approval paths omitted these checks:

1. **`replaceOrClose(o, out)` in `packages/network/src/network.ts`**:
   When an active participant becomes unavailable during sequential probing, `replaceOrClose` selects an alternate from `o.alternates`. Prior to this fix, the loop checked only:
   ```ts
   if (this.eligible(a) && !this.sharesFirstName(o, a) && !o.participants.some(p => p !== out && (this.blocked(p, a) || this.avoid.has(pairKey(p, a)) || this.pairHistory(p, a, 60)))) alt = a;
   ```
   For romance opportunities (`o.category === "romance"`), `this.romanceGate([stay, a])` was completely omitted. An alternate with an incompatible orientation or gender (e.g., Carol Danvers entering an Alice Wu / Bob Smith heterosexual match), someone not opted into romance, or an unverified age could be substituted as the new participant and immediately advanced to probing.
   Additionally, `r.prefs?.categoriesOptIn` was not verified, allowing alternates to be substituted into categories they opted out of.

2. **`reroll(o, opts, reviewer, logged)` in `packages/network/src/network.ts`**:
   When a staff reviewer re-rolled an opportunity participant, alternates were evaluated using identical incomplete criteria without checking `romanceGate` or `categoriesOptIn`.

3. **`approvalCheck(o)` in `packages/network/src/network.ts`**:
   During proposal approval checks:
   - It checked trust levels and minor status, but failed to check administrative account status (`m.account`). An account that was administratively suspended or restricted (`m.account = "paused"` or `"restricted"`) would pass review and proceed to probing.
   - For non-engine proposal origins (`player`, `scenario`, `second_encounter`), `approvalCheck` only gated engine proposals with `this.gateReason()`, omitting `this.romanceGate(o.participants)`. Incompatible romance pairs from non-engine origins could pass review approval unchecked.

## Changes

- **`packages/network/src/network.ts`**:
  - Added helper `altOk(o: Opp, a: MemberId, stay: MemberId[]): boolean` which enforces:
    - Member exists, is not paused, is `eligible(a)`, and does not share a first name with participants.
    - No blocks, avoid graph edges, or recent pair history (60 days) with any staying participant.
    - Category opt-in conformance: `!r.prefs?.categoriesOptIn || r.prefs.categoriesOptIn.includes(o.category)`.
    - Romance gate conformance: for `o.category === "romance"`, requires `stay.length === 1` and `this.romanceGate([stay[0]!, a]) === undefined`.
  - Updated `replaceOrClose(o, out)`: uses `this.altOk(o, a, stay)` when iterating candidate alternates.
  - Updated `reroll(o, opts, reviewer, logged)`: uses `this.altOk(o, a, stay)` when finding candidate alternates.
  - Updated `approvalCheck(o)`:
    - Added check for administrative account state: `if (m.account) return \`account_${m.account}\``.
    - Added universal romance gate: `if (o.category === "romance") { const why = this.romanceGate(o.participants); if (why) return why; }`.
- **`packages/network/test/romance-alternate-gates-account-approval.integration.test.ts`**:
  - Added 7 integration tests covering:
    - `replaceOrClose` rejects romance mismatch alternate and closes opportunity.
    - `replaceOrClose` skips mismatch alternate and accepts a compatible romance alternate.
    - `replaceOrClose` rejects alternate who has not opted in to romance.
    - `reroll` in review selects romance-compatible alternate over mismatch.
    - `altOk` rejects alternate who opted out of the category.
    - `approvalCheck` rejects opportunities containing members with account suspensions (`account_paused`, `account_restricted`).
    - `approvalCheck` rejects romance proposals with mismatch regardless of origin.

## Verification

```sh
bun test packages/network/test/romance-alternate-gates-account-approval.integration.test.ts
bun run typecheck
bun run sim --only network,friends,evals
```

- **Integration test**: All 7 test cases pass (23 assertions).
- **TypeScript**: Clean across all 4 tsconfigs (0 errors).
- **Simulation**: 102/104 blocking gates pass (18/18 friends gates pass, 25/25 evals pass, all conformance gates pass).

## Slop contribution receipt
- **provider**: google
- **model**: gemini-2.5-pro
- **client**: antigravity
