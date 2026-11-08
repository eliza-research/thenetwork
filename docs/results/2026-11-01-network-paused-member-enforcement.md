# Enforce paused member status across eligibility, recipient policy, plans, review, and relay

## Context & Root Cause

Under the Network's participation state architecture (PRD 32.9, `ParticipationState = "open" | "normal" | "quiet" | "receiving" | "paused"`), a member who pauses their account (`m.state = "paused"`) explicitly halts their participation in network introductions, matching, and proactive outreach.

However, several critical matching, review, send-time, and relay gates omitted checks for `m.state === "paused"`:

1. **`eligible(id)`**: Lines 4357–4366 checked `!m || m.minor || m.account || m.optedOut || m.stage === "new" || !this.trust.ok(id) || m.onlyWhenAsked || this.reportHeld(id)`, omitting `m.state === "paused"`. Consequently, paused members were selected in people request matching (`searchFor`, `tryRequest`), replacement alternates (`replaceOrClose`), reviewer rerolls (`reroll`), spontaneous local plans (`plansBuddy`), repeat meetups (`secondEncounter`), and newcomer welcomes (`newcomerWelcome`).
2. **`planSeatOk(m)`**: Line 2891 checked `!m.minor && !m.account && !m.optedOut && m.stage === "active" && !m.onlyWhenAsked && this.trust.ok(m.id)`, omitting `m.state === "paused"`. In weekly dinner and activity plans (`generatePlans`), paused members were assigned seats and sent invitations.
3. **`approvalCheck(o)`**: Lines 1987–1997 checked `declinedIds`, `unknown_member`, `opted_out`, trust level, `participant_minor`, and `busy_elsewhere`, but never verified whether a member paused their account while an opportunity was queued for review. Paused members passed review approval and received immediate probes.
4. **`checkRecipient()`**: Line 4216 checked `opted_out`, `account`, trust hold, and `only_when_asked`, but omitted `m.state === "paused"`. Proactive opportunity probes and plan invitations were delivered to paused members. Furthermore, in `ABOUT_OTHERS` (line 4234), `other.state === "paused"` was not checked, allowing proposals and plans about paused members to be sent to other members.
5. **`RelayHost.member()`**: Line 4757 returned `relayMemberOf(m, this.trust.level(id) === "hold")`, omitting `m.state === "paused"`. As a result, paused members were reported with `held: false` to `RelayDesk`, allowing relay messages and number swaps to proceed.
6. **`canInvite()`**: Line 2652 checked `!m.minor && this.trust.ok(m.id)` but omitted `m.state !== "paused"`.

## Changes

- **`packages/network/src/network.ts`**:
  - In `eligible()`: reject members with `m.state === "paused"`.
  - In `planSeatOk()`: require `m.state !== "paused"`.
  - In `approvalCheck()`: return `"participant_paused"` if any participant has `m.state === "paused"`.
  - In `checkRecipient()`: return `no("state_paused")` for non-reply, non-safety sends if `m.state === "paused"`, and return `no("other_not_matchable")` in `ABOUT_OTHERS` if `other.state === "paused"`.
  - In `RelayHost.member()`: pass `this.trust.level(id) === "hold" || m.state === "paused"` to `relayMemberOf` so `RelayDesk` holds requests involving paused parties.
  - In `canInvite()`: require `m.state !== "paused"`.
- **`packages/network/test/paused-member-enforcement.test.ts`**:
  - Added 5 unit tests covering:
    - `eligible(id)` returns `false` for paused members.
    - `planSeatOk(m)` returns `false` for paused members.
    - `recipientPolicy` rejects proactive outreach with `"state_paused"` and messages about paused members with `"other_not_matchable"`.
    - `approvalCheck` rejects opportunities containing paused members with `"participant_paused"`.
    - `RelayHost.member()` sets `held: true` for paused members.

## Verification

```sh
bun test packages/network/test/paused-member-enforcement.test.ts
bun run typecheck
bun run sim --only network,friends,evals
```

All 5 unit tests pass (15 assertions). TypeScript passes cleanly across all 4 tsconfigs. Simulation passes 104/104 blocking gates.

## Slop contribution receipt
- **provider**: google
- **model**: gemini-2.5-pro
- **client**: antigravity
