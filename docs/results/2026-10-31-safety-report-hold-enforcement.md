# Enforce safety report holds in approval check, relay host, recipient policy, and request matching

## Context & Root Cause

Under the Network's trust and safety design, an urgent report (`"harassment"`, `"unsafe"`, `"scam"`, `"minor"`) from a counterpart who met the member (`met: true`) marks the subject under an immediate safety hold (`reportHeld`) pending human staff review. However, because trust risk points require corroboration (at least two distinct reporters) before `this.trust.level(id)` transitions to `"hold"`, a member with a pending urgent report remains at trust level `"ok"` until a second report arrives or staff manually applies a hold.

Multiple safety enforcement boundaries checked only `this.trust.level(id)` or `this.trust.ok(id)`, bypassing `this.reportHeld(id)`:
1. **`approvalCheck()`**: Only checked `this.trust.level(id)`. Opportunities with reported members passed review approval with `undefined` instead of returning `"held"`.
2. **`checkRecipient()`**: Line 4224 only checked `this.trust.level(id) === "hold"`, allowing proactive messages to be sent to reported members. Line 4235 only checked `!this.trust.ok(x)`, allowing messages about reported members to be sent to counterparts.
3. **`RelayHost.member()`**: Line 4757 returned `held: this.trust.level(id) === "hold"`, allowing reported members to continue sending text messages, photos, and number swaps through `RelayDesk`.
4. **`relayDispatchCheck()`**: Line 4923 only checked `trust.get(id) === "hold"`, failing to inspect `st.reports` for open urgent counterpart reports.
5. **`planSeatOk()` & `canInvite()`**: Lines 2890 and 2652 omitted `!this.reportHeld(m.id)`, allowing reported members to take plan seats and issue invitations.
6. **Request processing**: Lines 1593 and 1616 omitted `this.reportHeld(m.id)`, allowing requests from reported members to proceed to matching.

## Changes

- **`packages/network/src/network.ts`**:
  - In `approvalCheck()`, return `"held"` if `this.reportHeld(id)` is true.
  - In `checkRecipient()`, reject proactive messages with `"held"` if `this.reportHeld(id)` is true, and reject messages about counterparts with `"other_on_watch"` if `this.reportHeld(x)` is true.
  - In `RelayHost.member()`, set `held: this.trust.level(id) === "hold" || this.reportHeld(id)` so `RelayDesk` refuses messages involving held parties.
  - In `relayDispatchCheck()`, verify if either member has an open urgent counterpart report in `st.reports`.
  - In `planSeatOk()` and `canInvite()`, enforce `!this.reportHeld(m.id)`.
  - In request retry and people request handling (lines 1593, 1616), enforce `!this.reportHeld(m.id)`.
- **`packages/network/test/safety-report-hold-enforcement.test.ts`**:
  - Added 5 unit tests covering `approvalCheck` rejection, `RelayHost.member` and `RelayDesk.request` refusal, `relayDispatchCheck` stored state detection, `recipientPolicy` blocking, and `planSeatOk`/`canInvite` gating.

## Verification

```sh
bun test ./packages/network/test/safety-report-hold-enforcement.test.ts
bun run typecheck
bun run sim --only network,friends,evals
```

All 5 unit tests pass (17 assertions). TypeScript passes cleanly across all tsconfigs.

## Slop contribution receipt
- **provider**: google
- **model**: gemini-2.5-pro
- **client**: antigravity
