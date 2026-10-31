# Enforce snapshot avoid edges in approval check, relay host, and recipient policy

## Context & Root Cause

1. **Snapshot avoid edges dropped on read**: While `ConsentNetwork.exportEdges()` exports avoid relationships derived from negative feedback as `{ type: "avoid" }` edges into the world snapshot, `snapshotBlocks()` only filtered `e.type === "blocked"`. There was no corresponding snapshot avoid reader, meaning avoid relationships persisted across restart or sync were completely ignored.
2. **Review approval bypass**: In `approvalCheck()`, pairs of participants were checked only with `this.blocked(o.participants[i], o.participants[j])`. Avoided pairs passed review approval and proceeded to scheduling.
3. **Relay desk leakage**: `RelayHost.blocked(a, b)` only checked `this.blocked()`, allowing participants with an avoid relationship to exchange relay messages, photos, and number swaps through `RelayDesk`.
4. **Recipient policy & dispatch bypass**: `checkRecipient()` only checked `this.blocked(id, x)` when verifying if messages about other members were permissible. In addition, `relayDispatchCheck()` checked `st.blocks` but omitted `st.avoid`.

## Changes

- **`packages/network/src/network.ts`**:
  - Added `snapshotAvoid()` and unified `avoided(a, b)` helper that queries both local `this.avoid` and snapshot avoid edges (`e.type === "avoid"`).
  - Ensured `snapshotBlocks()` and `snapshotAvoid()` safely access `this.snapshotCached()` to keep avoid/block indexes updated when dirty.
  - Enforced `this.avoided()` in `approvalCheck()` so opportunities with avoided pairs fail review with `"blocked_pair"`.
  - Enforced `this.avoided()` in `RelayHost.blocked()` so `RelayDesk` refuses messages between avoided participants with `"blocked_pair"`.
  - Enforced `this.avoided()` in `checkRecipient()` so members are not probed or contacted about avoided counterparts.
  - Added `st.avoid` check in `relayDispatchCheck()` on stored state dispatch.
  - Enforced `this.avoided()` across candidate filtering: `distinctAlternates`, `local newcomer welcome`, `proposeCheck`, `organizing reach`, `reroll`, and `replace`.
- **`packages/network/test/snapshot-avoid-approval-relay.test.ts`**:
  - 6 unit tests covering snapshot avoid edge loading, `approvalCheck` rejection, `RelayHost.blocked` and `RelayDesk.request` refusal, `relayDispatchCheck`, `recipientPolicy`, and `distinctAlternates` filtering.

## Verification

```sh
bun test ./packages/network/test/snapshot-avoid-approval-relay.test.ts
bun run typecheck
bun run sim --only network,friends,evals
```

All 6 unit tests pass (23 assertions). Typecheck passes cleanly across all tsconfigs.

## Slop contribution receipt
- **provider**: google
- **model**: gemini-2.5-pro
- **client**: antigravity
