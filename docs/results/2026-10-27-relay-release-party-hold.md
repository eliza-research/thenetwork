# Relay staff release party holds and canonical checks — 27 October 2026

Staff can release a held relay item through `RelayDesk.release` (`packages/network/src/relay.ts`) and `POST /staff/relay/:id/release` (`packages/network/service/service.ts`). The relay policy (`PRD 40.5`, `packages/network/src/network.ts` `relayDispatchCheck`, `packages/network/service/runtime.ts` `relayPairAdmission`) requires both members of the match to be eligible adults who have not opted out and are not under a safety hold.

## Cause

Two gaps existed on the staff release path:

1. In `RelayDesk.release` (`packages/network/src/relay.ts:357`), the desk re-runs `relayItem(item, this.context(item, match, o, h.at))`. When the sender or recipient is under a safety hold (`sender.held` or `recipient.held`), `relayItem` adds `safety:sender_held` or `safety:recipient_held`. Because the `safety` prefix belongs to `RELAY_REASON_FAMILIES.hold` (so a new request from a held member waits in the queue instead of returning a block notice), `again.decision` is `"hold"`. `RelayDesk.release` treated every `"hold"` decision on a text item as a content hold that staff could override, and delivered the message even when a party was on a safety hold. In addition, when a held photo item had valid photo consent and owned photo IDs (`h.kind === "photo"`) and was held only because of its caption, `again.decision` was `"hold"` (`again.rendered === ""` and `again.photos === []`), so `RelayDesk.release` could only render `item.kind === "text"` and dropped held photo captions on release.
2. In `NetworkService.fetch` (`packages/network/service/service.ts:2461`), the non-`pri_` branch of `/relay/:id/release` called `n.releaseRelay(itemId, user.id)` without passing `canonical` from `rt.relayParties([h.from, h.to])`. Platform-level changes after the item was held (such as a consent-ledger `STOP`, a platform ban, a removed membership, or a recorded minor age in `platform.people`) were not visible to `RelayDesk.release` during the unit of work.

## Fix and alternatives considered

- `RelayDesk.release` checks `const partyHeld = again.reasons.some(r => r.startsWith("safety:"))`. When `again.decision === "hold"` and `!partyHeld`, staff release overrides the item's hold reasons for both `"text"` (`RELAY_WORDING.text`) and `"photo"` (`RELAY_WORDING.photo`, preserving `item.photoIds` and `photoCount`). When `partyHeld` is true, `rendered` stays empty and the item is not delivered or logged as `"pass"`.
- `NetworkService.fetch` looks up the held item `h` in `n.relayHeld()`, reads `canonical = await rt.relayParties([h.from, h.to])`, and passes `{ canonical }` into `n.releaseRelay(itemId, user.id, { canonical })`.

Two alternatives were considered and rejected:

1. Move `safety` from `RELAY_REASON_FAMILIES.hold` to `RELAY_REASON_FAMILIES.block` in `packages/engine/src/relay.ts`. Rejected because an inbound relay request while a party is under a temporary safety hold is supposed to return decision `"hold"` (`NOTICE.hold`), not `"block"` (`NOTICE.block`), as tested by `scripts/sim/relay.ts:98-99`.
2. Rely only on the outbound queue's final admission (`runtime.ts` `relayAdmission`) to stop the message later. Rejected because `RelayDesk.release` still logs the relay record as `decision: "pass"` in `network.relay_records`, appends the message to `state.relay.threads` and `network.messages`, and reports `delivered: true` on dry-run or in-memory hosts before queue admission runs.

## Reproduction and verification

- **Date**: 2026-10-27
- **Base commit**: `a0ed7bc6495d9e524afc3d500738212a28dc7bc2`
- **Command**: `bun run sim --only relay --only evals` and `bun run typecheck`
- **Seeds**: deterministic relay clock `NOW = Date.UTC(2026, 9, 9, 18)` and adversarial seeds `13, 14, 15, 16`
- **Provider / model / request settings**: N/A (offline deterministic rule and desk evaluation; 0 LLM calls, \$0 cost)
- **Sample size**: 60 blocking relay gates (including corpus files `n = 145`, `n = 65`, `n = 65`, `n = 65`, `benign-adult.txt` `n = 221`, `requests.jsonl` `n = 37`, and `16,320` adversarial cases across seeds `13-16`) plus 25 blocking evals gates.

Before the fix (with the extended desk gate in `scripts/sim/relay.ts`):

```text
FAIL  relay desk: a scam is held for staff (nothing sent); staff reject drops the text, release delivers the engine wording: expected {"ok":true,"delivered":true} to equal {"ok":true,"delivered":false}
-- relay: 59/60 blocking gates pass, 11 tracked (4.6s)
FAIL: 59/60 blocking gates, 4 tracked off target, 4.6s (relay 4.6s)
```

After the fix:

```text
PASS  relay desk: a scam is held for staff (nothing sent); staff reject drops the text, release delivers the engine wording
-- relay: 60/60 blocking gates pass, 11 tracked (5s)
-- evals: 25/25 blocking gates pass (2s)
PASS: 85/85 blocking gates, 4 tracked off target, 7s (relay 5s, evals 2s)
```

`bun run typecheck` passed with 0 errors. `bun run test:integration` and `bun run test:e2e` were not run because this environment does not have the local PostgreSQL instance on `:54339`.
