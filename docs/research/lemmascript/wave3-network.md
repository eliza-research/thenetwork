# Wave 3: network (network-w3)

Area: `packages/network/**` and `packages/core/src/svc/` (not `contract.ts`, not `svc-auth.ts`). Six items from the "Skipped" sections of wave2-network-src.md, wave2-network-service.md, wave2-core.md and journeys.md B6 and B9. Each fix is fail-closed and has a case that failed before the fix. Hand-written report.

Proof file touched: `packages/network/src/transitions.ts` (already in LemmaScript-files.txt, line 19; no new line). Dafny is the release build with Z3 4.12.1.

## 1. Core bug 5: `String(x)` accepted arrays (fixed)

`["slop"].includes(String(["slop"]))` is true, so the svc parsers accepted `app: ["slop"]` and `operation: ["readback"]` where the type says string.

- Fix: a local `oneOf(v, list)` tests `typeof v === "string"` first. It replaces every `includes(String(...))` in `profile-review-disconnect.ts` (operation, app), `profile-review-withdrawal.ts` (operation, app, proof channel) and `profile-review-owner.ts` (channel, app, action). These files are not in the hash pin.
- Cases (new, real Postgres and the real service route):
  - `profile-suggestion-disconnect.integration.test.ts` "a signed cleanup request with an array where a string is expected is refused before any Cloud call".
  - `profile-suggestion-withdrawal.integration.test.ts` "V2 withdrawal refuses arrays where strings are expected, in the request and in the Cloud proof".
- Before the fix: both fail, `Expected: 400, Received: 403`. The array request passed the parser, the service called Cloud for the owner proof, and only the proof comparison (`v[k] !== request[k]`) stopped it. After: 400 with 0 Cloud calls, no receipt row, no SQL write.
- `profile-review-owner.ts`: the same fix, no separate case. Its request is built by our own code from a turn context whose `app` is compared with `!==` to the stored turn, and the proof compares fields with `JSON.stringify`, so an array cannot reach it today.

## 2. Journeys B9: "leave <app>" from a held number was silent (fixed)

inbox.ts treats "leave <app>" as compliance that is never held back, but `inbound()` returned `held` for a number on the recycled-number hold before it read the leave.

- Fix (service.ts, the hold branch): a leave from a held number records the app's opt-out in the consent ledger (`source: "leave"`, the message's consent time), sets the turn's `consent {opted_out, scope app}` and confirmation, and sends the app's fixed opt-out text (`brand.stopApp`, compliance kind). Anything else from the held number still returns `held`.
- What it does not do: it does not delete the membership. A held number is nobody's address by design (`Accounts.personFor` and `runtime.identities` skip it), and deleting the account behind a hold is the staff decision (`Accounts.clearHold`, new_owner deletes, same_owner keeps). So the confirmation is `stopApp` ("unsubscribed ... won't get more messages"), not `leftApp` ("I deleted what you shared"), which would not be true. This is the same treatment STOP gets on a held number.
- Case: `eliza-takeover.integration.test.ts` "leave <app> from a number on the recycled-number hold is honored and confirmed (journeys B9)". Before: `Expected: "left", Received: "held"`. After: reason `left`, consent opted_out scope app, replies `[brand.stopApp]`, `optedIn("friends")` false, and a later "hi" is still `held`.
- Open for the founder (not decided here): should a leave from a held number also delete that app's data, as a leave from a normal number does? It is an erasure requested by a person who may be the number's new owner.

## 3. Journeys B6: under-13 stated at a join kept other memberships live (fixed, fail-closed part only)

A friends member who texts "slop" and then "Fay, 12" is declined for slop; `recordAge` lowers the person's age to 12 and `ageLowered` writes 12 to every app's `network.members.age`. Until the person wrote to friends again, the friends Network kept sending: the recipient gate refused only matching sends to a minor.

- Decision from CLAUDE.md: under 13 cannot join and cannot use any app. Closing access needs no product choice; deleting data does (below).
- Fix: a new fact `cannotJoin` in the proved recipient gate: `recipientVerdict` refuses every send except a safety notice to a member whose record age fails core `canJoin` (`checkRecipient`: `validAge(m.age) && !canJoin(m.age)`). The decline itself is a safety send, so it still goes. The test uses core `canJoin`, not the app's join age, so a 13-17 member of an 18+ app is not changed (that is a separate product rule).
- New ensures: `\result === "ok" && !s.safety ==> !r.cannotJoin`.
- Case: `eliza-takeover.integration.test.ts` "an under-13 age stated at a join closes the person's other memberships at once (journeys B6)". Before: `recipientPolicy(friendsMember, "info")` was ok (`Expected: false, Received: true`). After: info, reply and checkin are refused, safety passes.
- Not decided (product): the delete. At the next inbound the friends Network sees record age 12 and `mustDecline` deletes the membership. When the person was an attested adult on friends, that contradicts network-service-1 ("an attested adult who states an age under the join age is held for staff, never deleted"): `statedAge()` records such a chat statement as 13 (`recordedAge`), but the join decline records the raw 12. Whether a join-time under-13 statement from an attested adult should delete or hold for staff is a founder question.

## 4. network-src bug 7: an LLM-read age could raise an unknown age to adult (fixed)

`withUnderstanding` took `u.selfAge` whenever the rules found no age, so an adult age from the LLM reader cleared `m.minor` for a member with no record age. The service does not pass `understand` today, so the path is dead in production; the fix is in place for when it is wired.

- Fix: proved `llmAgeCounts(rulesKnown, rulesAge, llmAge, llmMinor)` in transitions.ts, called from `withUnderstanding`. With no rules age, only a minor's age (core `isMinor`) counts; with one, only a lower age.
- Ensures: `\result && !rulesKnown ==> llmMinor`; `\result && rulesKnown ==> llmAge < rulesAge`; `!llmMinor && !rulesKnown ==> !\result`.
- Cases: `consent-transitions.integration.test.ts` "an age the LLM reads" (Mini world, the real Network; the reader is a fixed function standing in for the LLM's parsed output). "an adult age read by the LLM does not clear an unknown age" failed before (`minor` was false, `Expected: true, Received: false`). "a minor age read by the LLM still lowers it" passes before and after (guard against an over-fix).

## 5. network-src bug 8: a relayed number stayed in the stored state (fixed)

`send()` kept the full text in `m.lastSent.body`, which `exportState` writes to `network_state`. After a number swap both numbers stayed there.

- Fix (network.ts): `sentForm(text, contact)` cuts the relayed number out of the text kept in `lastSent` (the same cut the leak guard uses), and the duplicate checks (`send`, `relayWouldSend`) compare that form. A relay send with a number that would wait (deferral) is now refused with `contact_not_deferred` instead of being stored in `deferred` with its body and `relayContact`. The swap already asks `relayWouldSend` first, which refuses a send that would wait, so this changes no current flow.
- Case: `consent-transitions.integration.test.ts` "a number swap > goes both ways when both shares can go" now also checks that `JSON.stringify(exportState())` holds neither number. Before: failed, `lastSent.body` held "+12125550102" and "+12125550101". After: pass.
- A check that a repeated share is still caught by the duplicate rule was tried and dropped: the relay policy refuses a second swap first (c3, c4 refused), so it proved nothing.

## 6. Decision 11: `eligibilityFor` at send time (wired)

Rule-by-rule comparison of engine `sendTimeReason` (filters.ts, via `eligibilityFor`) with the Network's gate (`recipientVerdict`, about-others sends):

| sendTimeReason rule | recipientVerdict | Covered? |
|---|---|---|
| unknown member | `!r.known` | yes |
| `memberCore` underage: `!isMinorAge`, `age >= cfg.ageMin`, `age >= pack.minMatchAge` | `r.minor` (isMinor of the record, unknown age is a minor) | only while ageMin and minMatchAge are 18; a config or pack that raises them is not covered |
| `memberCore` safety hold (`w.holds` = not trust-ok, minor, minor signal, held report) | `r.held`, `r.trustOk`, `r.minor` | no: a held report (`reportHeld`) and a minor signal without `minor` are not checked |
| `memberCore` participation state paused | `r.account` is the account status, not the participation state | no |
| opted out | `r.optedOut` | yes |
| lane opt-in withdrawn (`category_opt_out`, `romance_opt_out`) | none | no |
| a block with anyone else in the opportunity | `otherVerdict` blocked | yes |

recipientOk does not cover the lane, the participation pause, a held report or a minor signal, or a raised match age. So it is wired, not duplicated:

- `checkRecipient` now calls the engine's own `eligibilityFor(world)(id, about, lane)` for an invite or an introduction (`probe`, `reveal`). The lane is passed only for an engine proposal (`sendLane`: `o.origin === "engine"`), whose lane opt-ins the engine checked when it proposed it (networkPack `category_opt_out` rule), so a refusal there is an opt-in withdrawn since (decision 11, engine-pipeline-10). A member's own request, the planner's plans and a player's proposal never had a lane check, so their lane is not re-checked; the engine's other send-time rules (age, holds, paused, blocks) run for every origin. `send()` takes the opportunity from `meta.proposalId`; the three reveal pre-checks (`reveal`, `bookPlan`, `planJoin`) pass the opportunity.
- Root cause of a regression found during the wave (coordinator report: `sim --only network` failed 3 blocking gates, "plans: 0 minors in any plan role", "attention: nothing agent-started in quiet hours", "meetings (pooled) > 140: 124"): the first version passed `o.category` as the lane for every origin. Seed 2 then logged 20 `probe:category_opt_out` and 27 `reveal:category_opt_out` refusals on requests and plans in lanes the personas never opted into, which the Network had always sent. That cut meetings (124) and changed the trajectories: on seed 2 the planner then put ny-0213 (hidden true age 16, claimed 20, so a teen the Network cannot detect) in plan nw-2-65, and a request-none message landed in quiet hours. No safety rule was loosened by the fix; the over-refusal was the change. With `sendLane`: seeds 1-3 meetings 46, 50, 57 (153), 0 minors in plan roles, no `category_opt_out` refusals (no engine proposal withdrew a lane in these runs). The other agent's `lsc check` failure on transitions.ts fell in a window where I had a mutation or an un-regenerated .dfy in place (mutation checks for items 3, 4, 6); `lsc check` passes now (below).
- The World is built per check from only the recipient and the others: their records as the engine run reads them, the blocked and avoid edges between them, the engine run's safety holds. `engineMember` and `engineHolds` are now shared with `engineInput`, so the age and hold rules exist once. Config is `resolveConfig(effectiveEngineConfig())` (cached), pack is `opts.pack ?? networkPack`. No rule from filters.ts is copied.
- Composition proved: `sendTimeVerdict(gate, invite, engineReason)` in transitions.ts. Ensures: a gate refusal is returned unchanged; `ok` needs gate `ok`; `ok` for an invite needs no engine reason; gate `ok` and no engine reason (or not an invite) gives `ok`. Dafny found a real hole in the first version: an engine reason that reads `"ok"` passed as `ok`. It now maps to `engine_refused`.
- Not applied to `nudge`, `scheduling`, `reminder`, `feedback` or `relay`: those are about a match already made, and the engine docstring limits the re-check to "invites, accepts and backfills". Extending it would stop reminders for a booked meeting after a lane opt-out, which is a product choice.
- Case: `consent-transitions.integration.test.ts` "the engine's send-time re-check (decision 11) > a lane opt-in withdrawn after the proposal stops the invite and the introduction" (the Mini opportunity is marked `origin: "engine"` after the first probe). With the engine check disabled (`invite = false`, a temporary edit) it fails: a meeting is booked (`w.meetings` has 1 entry, expected []). With it: pass, and the log has `send_refused` reason `category_opt_out`.

## Proofs

`node_modules/.bin/lsc check --backend=dafny packages/network/src/transitions.ts`: 51 verified, 0 errors (was 49 at the end of wave 2: +`llmAgeCounts`, +`sendTimeVerdict`).

New or changed verified functions: `recipientVerdict` (new `cannotJoin` fact and ensures), `llmAgeCounts` (new), `sendTimeVerdict` (new).

| Mutation | lsc result |
|---|---|
| `recipientVerdict`: `if (r.cannotJoin && !s.safety && !s.reply)` | error: postcondition on return path (48 verified, 1 error) |
| `llmAgeCounts`: `rulesKnown ? llmAge < rulesAge : true` | error: postcondition on return path (49 verified, 1 error) |
| `sendTimeVerdict` first version (engine reason "ok" passed) | error: postcondition on return path (50 verified, 1 error); the code was fixed |

What the proofs do not cover: the booleans passed in are trusted (`cannotJoin` is `validAge(m.age) && !canJoin(m.age)` in network.ts; `llmMinor` is core `isMinor`; `engineReason` is whatever the engine returns). The World built for the engine check, the sentForm cut and the service changes (items 1, 2) are not proved.

Trust: assume 0, havoc 0, extern 0, axiom 0 added. `proofs/trust.json` unchanged.

## Runs

All commands under `heavy`, one at a time. No model calls; the simulator uses a simulated reviewer (`review: "auto"`).

| Command | Result |
|---|---|
| `bun test packages/network/test/consent-transitions.integration.test.ts` | 17 pass, 0 fail |
| `... eliza-takeover.integration.test.ts` | 13 pass, 0 fail |
| `... collected-gate.integration.test.ts` | 10 pass, 0 fail |
| `... shared-agent.integration.test.ts` | 14 pass, 0 fail |
| `... service-safety.test.ts` | 9 pass, 0 fail |
| `... shared-relay.integration.test.ts` | 10 pass, 0 fail |
| `... relay.test.ts` | 5 pass, 0 fail (before the item 6 scope fix) |
| `... profile-suggestion-disconnect.integration.test.ts` | 5 pass, 0 fail |
| `... profile-suggestion-withdrawal.integration.test.ts` | 5 pass, 0 fail |
| `... profile-suggestions.integration.test.ts` | 51 pass, 0 fail |
| `bun run sim --only network` | 62/62 blocking gates pass, 2 tracked (121 s) |
| `bun run sim --only relay` | 60/60 blocking gates pass, 11 tracked (4 off target, unchanged area) |
| `bun run sim --only safety` | 17/17 blocking gates pass |
| `bun run sim --only pipeline` | 15/15 blocking gates pass, 1 tracked |
| `bunx tsc --noEmit -p .` | no error in packages/network or packages/core/src/svc |
| `lsc check --backend=dafny packages/network/src/transitions.ts` | 51 verified, 0 errors |

Diagnostic for the item 6 regression: `runArm("consent", {days: 21, seed})` for seeds 1-3 from a scratch script, with a temporary debug line in harness/experiment.ts `planChecks` (removed).

## Changes needed in files I do not own

- None required. Optional: `packages/engine/src/index.ts` could export `eligibilityFor`; network.ts imports it from `@thenetwork/engine/src/filters.ts`, as it already does for the network vocabulary.
