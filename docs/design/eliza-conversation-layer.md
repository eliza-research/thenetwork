# Eliza as The Network's conversation layer

Status: **agreed 2026-10-08** by the engine and platform owners. Owner of the Eliza side: the plugin-network session.

## Build status

| Part | Owner | State |
|---|---|---|
| Wire contract and shared signing (`@elizaos/plugin-network/contract`, `/svc-auth`, `/client`; mirrored in `packages/core/src/svc/`) | Eliza side | **Done** (import-free; plugin moved upstream 2026-10-09) |
| Gateway takeover: service turn first, handled replies, consent mirror, open-turn context | Eliza side | **Done**, behind `NETWORK_TAKEOVER=1` (eliza `spike/network-plugin` d8d186d) |
| Cloud route and runtime: service-backed Network store for open turns | Eliza side | **Done** |
| Service `POST /internal/turn` (collecting adapter around `inbound`) | Platform | Pending |
| Service `/internal/set-state`, `/internal/signals`, `/internal/updates` | Platform | Pending |
| Gateway `POST /internal/deliver` for signed service sends | Eliza side | Next |
| Plugin `RELAY` action → service (`relayItemAsync` with the luna classifier) | Eliza side + Platform | Next |
| Character flag | Eliza side | Next; going live needs the founder's go-ahead |

## Decision being implemented

Founder, 2026-10-08: conversations run in Eliza. The eliza.app shared agent becomes The Network's agent. It is still named "Eliza", but it speaks for every app on the shared line: ntwrk, slop, friends and peon.

## What already exists (and must not be rebuilt)

`packages/network/service/service.ts` (`NetworkService.inbound`) already runs the whole deterministic loop on the shared line:
- **Routing:** app line, whole-message keyword (`keywordApp`), pending join, newest open item, last writer, else ntwrk.
- **Opt-outs:** STOP / STOP ALL through the consent ledger, `leave <app>`, and numbers held for review.
- **Joining:** join age and invite-only checks, then "what are you looking for?" answered by `lookingFor`, which leads to `enroll`.
- **Onboarding and replies:** slop onboarding through the pack (`packs.ts`; moving to `extractSlopProfile` / `readBack` / `nextQuestion`), SHARE, HELP and START.

The Eliza gateway (`eliza/packages/cloud/services/gateway-webhook`) already has signed Blooio inbound, dedupe, the STOP fence and the consent ledger, Twilio fallback, and `/internal/deliver` for proactive sends that are appended to the agent's history.

Rebuilding the service's loop inside plugin-network would give two copies of the routing, consent and onboarding rules, and they would drift. **The plugin should call the service, not copy it.**

## Proposed design

```
Blooio ──webhook──> Eliza gateway ──> shared agent (The Network's Eliza)
                                         │ plugin-network, before any model call:
                                         │   POST service /internal/turn  {from, to, text, messageId, transport, app?}
                                         │     ├─ handled: [replies]  → send them; no LLM call
                                         │     └─ open: {member, app, context} → the LLM converses;
                                         │          plugin actions call service endpoints
Network service ──proactive sends──> Eliza gateway /internal/deliver ──> Blooio
                   (intros, reminders, read-backs)   (appended to the agent's history)
```

1. **One webhook owner: the Eliza gateway.** The service stops consuming Blooio webhooks for the shared line (it keeps its handler for tests and the simulator). This removes the double-STOP problem for good.
2. **`POST /internal/turn` on the service.** This is `NetworkService.inbound()` with a collecting adapter: it runs the existing loop unchanged and returns what it would have sent instead of sending it.
   - `{ outcome: "handled", replies: string[] }` covers STOP, HELP, START, leave, held, joins, the looking-for answer, onboarding questions, read-backs, SHARE, and yes/no to an open item. The agent sends exactly these replies, and **no model is called**.
   - `{ outcome: "open", app, memberId, context }` means free conversation. Eliza's model answers using plugin-network's `MEMBER_CONTEXT` (from `context`), and actions go to service endpoints (`/internal/set-state`, `/internal/updates`, and later relay and feedback).
   - Service-to-service auth is an HMAC header with a shared secret, like `PLATFORM_PROXY_SECRET`. Idempotency is keyed by `messageId`, so a gateway retry gets the same replies back without re-applying anything.
3. **Proactive sends go through the Eliza gateway.** The service's channel adapter for the shared line posts to `/internal/deliver`, so every Network message lands in the agent's conversation history. Quiet hours, caps and consent stay in the service; the gateway re-checks STOP, as it already does.
4. **The relay.** A message to a matched member is an `open` turn. The plugin's `RELAY` action calls the service, which runs `relayItem`; only `rendered` goes out, through `/internal/deliver`, to the other member.
5. **The character.** It's named Eliza and speaks as The Network's agent, with an app-aware voice (`APPS[app].brand.agentName`). It sits behind a Cloud flag, `NETWORK_TAKEOVER`. **Flipping it on for live eliza.app users needs the founder's explicit go-ahead.**

## What plugin-network becomes

- **`NetworkStore` → `NetworkBackend`.** It's an HTTP client for the service's `/internal/*` endpoints. The in-memory fake stays for the simulator, and the Cloud drizzle store is retired once the service owns member state.
- **A turn gate,** `ResponseHandlerFieldEvaluator` or the earliest available hook: it calls `/internal/turn` and, when `handled`, sets the reply and skips the planner.
- Its existing parts stay: `MEMBER_CONTEXT`, the design B structured field for state changes, which now executes through the backend, the `NETWORK_SIGNALS` evaluator, and `GET_UPDATES`.

## Open questions for the owners

- **Platform/service owner:** OK to add `/internal/turn` (a collecting adapter around `inbound`) and to point the shared line's adapter at the Eliza gateway? Which secret should sign service-to-service calls?
- **Engine owner:** the service's slop path moves to the pure onboarding functions per `docs/results/2026-10-09-slop-onboarding.md` §4, in the service, not the plugin. Agreed?
- **Latency:** handled turns cost one HTTP round trip and no model call. Open turns add that round trip to design B's measured p95 of 6.7 s.

## Tests (founder policy 2026-10-08: integration and e2e only)

- **Integration:** run `/internal/turn` against a real Postgres service, and the Workerd shared-runtime harness with plugin-network pointed at a local service.
- **e2e:** a scripted conversation through the Eliza gateway → agent → service → deliver path. It covers join, looking-for, slop onboarding to the read-back, STOP, and START.
- **Live:** the luna eval on open turns, and `bun run sim` gates.
