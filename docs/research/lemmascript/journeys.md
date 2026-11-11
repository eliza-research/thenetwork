# LemmaScript research: journeys (cross-package flows)

Traced at commit a0ed7bc. Static trace: no sim, no test suite and no live service ran. One bun script ran the pure parser (`parseProbeReply`). The eliza upstream gateway and the Cloud deliver route are not in this repository, so behavior there is marked "upstream, not checked". All paths are repository-relative. Trial files are in the scratchpad folder `research/journeys/`.

## 0. The main result: outbound seams

A proof on one send function covers one seam only. There are five ways for text to leave the system. Every journey below uses one or more.

| Seam | Entry | Consent, ban | Person cap | Recipient policy | Live flags | Leak guard |
|---|---|---|---|---|---|---|
| Q. Queue | `OutboundQueue.dispatch` packages/blooio/src/outbound-queue.ts:364, then `send` :463 | yes | yes (kind `proactive` only) | yes | yes | yes |
| C1. Collected Network reply | `context.send` packages/network/service/runtime.ts:415 marks causal :422; `writeUnit` :453 | **no** | **no** | Network `checkRecipient` only | **no** | Network `guardCheck`; `collectedLeaks` only when the adapter is a BlooioAdapter (:469, :473) |
| C2. Collected system reply | `rt.system` runtime.ts:446 (`enrolledText`, `shareDone`, profile read, HELP, STOP) | **no** (profile read rechecks) | no | **no** | **no** | same as C1, but no Network guard |
| C3. Collected direct text | `NetworkService.direct` packages/network/service/service.ts:1367 | **no** | no | no | **no** | **no** |
| M. Eliza open-turn model reply | `{outcome:"open"}` service.ts:2086 | upstream | upstream | upstream | upstream (`NETWORK_TAKEOVER`) | **upstream, not checked**; here only the context gate `sharedContext` runtime.ts:369 |
| O. OTP text | `BlooioOtpProvider.send` packages/platform/src/otp.ts:92, or Twilio Verify | no | no | no | no | no (fixed format) |

Seams C1 to C3 are the key gap. `README` lines 209 and 256 of packages/network/service/README.md state that a direct text gets consent, bans and the leak guard, and that all collected replies get the leak guard. In a signed turn, `direct` returns at service.ts:1369-1372 before any of those run. Production traffic goes through signed turns, so most member-facing replies use C.

**Recommendation:** add one pure gate `collectGate` (trial T1) and call it at the one place collected replies are read: `Inbox.collect` packages/network/service/inbox.ts:166, or in `sharedTurn` before the reply list is returned. Then a proof on `decideGate` (Q, messaging-ops report) plus `collectGate` (C) covers every outbound path this repository owns. Seam M stays outside the proof boundary.

## 1. Files touched

Other areas review these files one by one. I read these for call paths: packages/network/service/{service,runtime,channel,cloud-channel,inbox,relay-endpoint,photoIntake,main,packs(part),route-authority}.ts; packages/network/src/{network(parts),relay,classify(consent part),extract(mergeConsent),copy(notice)}.ts; packages/blooio/src/outbound-queue.ts; packages/platform/src/{accounts,consent,age,api(part),otp,photos(part),photo-relay(part),pg-store(deleteAll),apps(part)}.ts; packages/core/src/policy.ts; packages/mcp/src/{hooks,tools(part),handler(part)}.ts; packages/notify/src/{scheduler,wiring}.ts (grep); packages/engine/src/relay.ts (header); deploy/backend/{backend,server}.ts (grep); packages/observatory/db/migrations/{0007,0012}; docs/design/eliza-conversation-layer.md; docs/go-live-handoff.md (grep); packages/network/service/README.md (parts). docs/network.md and docs/mvp-plan.md: not read in full; CLAUDE.md founder decisions were the invariant source.

## 1b. Journeys

Prefix: S = packages/network/service/service.ts, R = runtime.ts in that folder, N = packages/network/src/network.ts, Q = packages/blooio/src/outbound-queue.ts, A = packages/platform/src/accounts.ts.

### J1. Join by text with keyword routing
- Chain: gateway -> `sharedTurn` S:1976 -> `Inbox.signed` inbox.ts:81 -> `inbound` S:1006 -> `route` S:957 (`keywordApp`, pending join, open item, last writer, ntwrk) -> `elizaNotice` S:1175 -> `join` S:1384 -> `parseJoinText` S:243 -> `joinAgeCheck` packages/platform/src/age.ts -> `createPerson`, `recordConsent` -> `createMember` -> `memberMessage` S:1222 -> `lookingFor` ask; answer -> `enroll` S:1471.
- Invariants: no storage before the age check; ban refused; slop never enrolled below 18; opt-in recorded with its wording.
- Choke points: `joinAgeCheck`; proposed `joinStep` (T3), shared by `join` S:1384 and `joinLocked` A:351.
- Bypasses: text and web have two copies of the join rule (S:1384 and A:351). `elizaNotice` S:1198 collects with no leak check (fixed copy). Join prompts to an opted-out number use C3 (bug B2).

### J2. Join via agent (SKILL.md, phone confirm, MCP)
- Chain: site SKILL.md -> MCP `start_signup` / `prepare_signup` packages/mcp/src/tools.ts -> OAuth pages handler.ts:445 (`authorizeStep`) -> `startOtp`/`verifyOtp`/`login` packages/mcp/src/hooks.ts -> Join page -> `POST /api/join` packages/platform/src/api.ts:545 -> `Accounts.join` A:345 -> `joined` S:788 -> `welcomeJoined` N. Profile: tools.ts:303 -> `submitProfile` S:1207 -> `memberMessage` with `source:"mcp"` -> N:759 `learnFromProfile`.
- Invariants: the agent never sees the code; drafts never create a person or consent; an MCP profile is never an answer (N:758 sets `aw` undefined unless interview); ban refused.
- Choke points: `grantStillTheirs` (tools.ts), `Accounts.joinLocked`.
- Bypasses: `people_request` from MCP passes N:759 and reaches later branches with `aw` undefined; `optIns` N:775 is reachable with MCP text (only when the text also classifies as a people request; low). Public `/api/auth/otp/start` lacks the ban check that MCP `startOtp` has (bug B4).

### J3. Under 13 decline
- Chain A (join): `join` S:1417 `joinAgeCheck` fails -> `recordAge` -> `direct(underAge, compliance)` -> notice row deleted S:1147. Chain B (member states age): `handleInbound` N:697 -> `declineUnderMinAge` N:897 -> `forget` -> memberUnit S:1283 marks compliance and adds to `unit.forget` -> `statedAge` S:1293 removes every membership.
- Invariants: nothing stored but the age floor; a later older age is refused; one kind decline.
- Choke points: `canJoin`, `joinAgeCheck`, `lowestAge`; `validAge` input is `unknown`, so prove a number|undefined core.
- Bypasses: chain A does not run the membership removal of chain B (bug B6). Decline by C3 has no leak check (fixed copy, acceptable).

### J4. Member aged 13-17
- Chain: `createMember` S:723 -> age on `network.members` -> `syncRecord` sets `m.minor` N (about :4424) -> `eligible` N:4357 false -> `gateReason` -> `reviewBlock` N:1941 -> `approvalCheck` N:1987 -> `checkRecipient` N:4215 for ABOUT_OTHERS kinds -> `relayParties` R:208 adult check. App packs: `packInput` N:3741 removes non-adults. `ageLowered` S:776 propagates and drops photos and ratings.
- Invariants: never matched or connected in any app; lowest age wins; dating never offered.
- Choke points: `canBeMatched`, `checkRecipient` (pure given facts), `mayReveal` (T4).
- Bypasses: ABOUT_OTHERS (packages/network/src/outreach.ts:59) excludes `info`. Crew offers N:3186 and `planEvent` are sent as `info` with `about` set, so `about` is not checked; crew offers reach only attendees of a reviewed plan (adults at that time), so the risk is an age lowered after the plan. ntwrk uses `engineInput` unfiltered (N:3743) and relies on `eligible`; the engine's own filter is in other reports. `syncRecord` lowering does not drop open opportunities; the send-time checks catch it.

### J5. Onboarding
- Chain: `memberUnit` S:1233 -> `onInbound` N:595 -> `handleInbound` N:673 -> stage logic N:730-731 -> ntwrk interview N:1077-1092, or slop hook `AppHooks.onboarding` packs.ts:119 (`extractSlopProfile`, `applyCorrection`, `slopOnboardTags`, `readBack`, `nextQuestion`).
- Invariants: age policy runs first; one question at a time; a read-back before confirmed tags.
- Choke points: the slop engine functions (engine-packs report). Journey adds nothing new.
- Bypasses: none found. Replies use C1; network `send` guard runs.

### J6. Proactive match
- Chain: `tick` N:3263 -> `dailyRun` N:3438 -> `runEngine` -> `gateReason` N:3595 -> `fromProposal` N:3662 -> `submit` N:2047 -> staff `/review` -> `decide` N:1889 -> `reviewBlock`, `approvalCheck` -> `begin` N:2063 -> `advanceProbes` -> `probe` N:2154 -> `send` N:3862 -> answer N:762-773 (`parseProbeReply`, `mergeConsent`) -> `onProbeAnswer` N:2290 -> `maybeReveal` N:2400 -> `reveal` N:2411.
- Invariants: review before contact; both yes; only `answer: "yes"` is consent; minors never; blocks hold; leak check on every send.
- Choke points: `submit` is the single entry to the review queue (all seven callers checked); `begin` has one caller, N:1927, except `beginPlan` through it; `reveal` has two callers, N:2120 (`probes:false`, not set in production) and N:2402. `stage` transition core: `stageAfterReview`, `statusAfter`, `mayReveal` (T4).
- Bypasses: (a) `parseProbeReply` turns "counter" into yes (bug B1). (b) `replaceOrClose` N:2368 swaps an alternate into an approved opportunity and probes them with no new review; `reroll` N:2010 does send a swap back to review. The reviewer saw the alternates list, so this may be intended, but the pair (stay, alternate) was not reviewed. Founder question. (c) `primed` members skip a probe by design (a requester); `primed` is set only by `tryRequest` and a probe yes. (d) The reveal to the member whose yes triggered it is a C1 reply; the other side uses Q. (e) `mergeConsent` extract.ts:131 and `yesNoOf` N:666 let an LLM produce yes. `understand` is not wired in the service today (main.ts passes only `seed`), so this path is dead; a proof must treat it as a precondition.

### J7. Member-initiated request
- Chain: `handleInbound` -> `openRequest` N:1583 -> `tryRequest` N:1665 -> `send(requestAck, reply)` -> `submit` -> as J6 with `requester` primed.
- Invariants: review before anyone else is contacted; the ack names nobody.
- Choke points: `submit`.
- Bypasses: none found. `requestAck` goes before review but contacts only the requester.

### J8. Relay of number or photo
- Chain: open turn -> upstream RELAY action -> `relayEndpoint` packages/network/service/relay-endpoint.ts:138 (text must equal the turn's own inbound; turn scope; `activeMembership`) -> `parseRelayRequest` -> `relayParties` R:208 -> `RelayDesk.request` packages/network/src/relay.ts -> `swap` -> `decide` -> engine `relayItemAsync` -> `apply` -> `deliver` -> `relayHost.send` N:4778 -> `send` -> Q -> `relayAdmission` R:238 -> `relayDispatchCheck` N:4912.
- Invariants: mutual match only; per-item consent; both sides asked inside the TTL; only `rendered` leaves; a held contact share is never staff-released (relay.ts `release` gives no item for it).
- Choke points: engine `relayItem` decision merge; `relayDispatchCheck` (pure over state; PROVE after typing a small state view); `swapDecision` extract.
- Bypasses: `release` S:2461 passes no canonical view and no classifier hook (Q admission still rechecks). The number swap is not atomic after the first send (bug B7). The swap ask `relay:<id>:ask` skips `relayItem` for its own text, fixed copy plus the first name.

### J9. STOP, START, leave
- Chain: `inbound` S:1054 -> `stop` S:1317 -> `keywordEvent` packages/platform/src/consent.ts -> `recordConsent` -> `turn.consent` -> `memberMessage` -> `stopped` S:801 -> every member `optOut`. START S:1096. Leave S:1075 -> `Accounts.leave` A:421 -> `onForget`. Send time: `resolveConsent` consent.ts:37 through `consentRefused` S:696, `optedOut` R:186, and the member row check Q:~490.
- Invariants: STOP stops every app on the shared line; leave is one app; START is one app and cannot undo a newer STOP; compliance reply always goes; one consent event per ref.
- Choke points: `resolveConsent` (network-service report T); `detectKeyword` and `leaveTarget` (regex: not provable in LS); ordering rule in `inbound`.
- Bypasses: C seams do not read the ledger; the backend relies on the gateway fence for replies (upstream, not checked). `held` return S:1060 sits before the leave branch S:1075, so "leave <app>" on a held number gets no answer and no event although inbox.ts says leave is never held back (low). `Accounts.leave` stamps `now` while the no-person branch uses `consentAt` (S:1083 against A:425; low: a late retry orders differently). A replayed handled turn returns its old replies after a later STOP (inbox.ts:104; only open and onboarding are rechecked).

### J10. Ban
- Chain: staff -> `ban` S:1734 -> `people.ban`, `suppress`, `dropRatings`, membership and member `restricted`, `markBanned` N:1327 (trust hold, `dropMember`). Refusals: `join` S:1391, `joinLocked` A:355, `canJoin` A:311, `startOtp` hooks.ts, `login`, `submitProfile` S:1212, `consentRefused` S:~708, START S:1098, `activeMembership` A:324.
- Invariants (founder 2026-10-09 #3): refused at join, OTP and inbound, on every app.
- Choke points: `Accounts.banned`; proposed `collectGate`.
- Bypasses: site OTP (bug B4). Inbound has no ban check on the member branch, and block or report replies leave by C1 (bug B3). `restricted` members stay in the address book because `identities` excludes only `invited` and `removed` (R:390-395).

### J11. Photo upload and Clef rating
- Chain: site `/api/photos` -> `PhotoService.route` packages/platform/src/photos.ts:604 -> `upload` :457 -> `mayTake` :450 -> `adult` :439 -> strip -> `rate` :500 -> `rater.rate` -> rechecks -> `onRating` -> `writeRating` S:1611 -> `appearanceFacet`. Text: `inbound` S:1067 -> `PhotoIntake.photosIn`. Signed turns carry `mediaUrls: []` (S:2076), so photos by text work only on the legacy webhook; production has no photo-by-text path.
- Invariants: adults only; no rater call before checks; scores never shown; ban or under-18 deletes ratings.
- Choke points: `mayTake` (extract `photoGate`), `photoConsentReply` (regex).
- Bypasses: `verifiedAdult` S:1577 reads `runtimeFor(app)`, the app's first network; the query is by app and id, so it is safe. None found.

### J12. Proactive send through deliver
- Chain: `send` N:3862 -> `context.send` R:415 -> `unit.sends` -> `writeUnit` R:453 -> `BlooioAdapter.enqueue` channel.ts -> commit -> `deliver` R:569 -> `drainQueue` -> `dispatch` Q:364 -> `capTake` R:195 -> `capRefused` S:592 -> `person_cap_take` (0007 SQL) -> `leakReasons` Q:437 -> `send` Q:463 (admission transaction) -> CloudChannelAdapter `post` cloud-channel.ts -> `/api/internal/network/deliver`; `unknown` -> `reconcileUnknown` -> receipt path.
- Invariants: cap 3 per person per day at send time; leak check; unknown retried with the same id only; quiet hours.
- Choke points: `decideGate` (messaging-ops), `classifyDeliverAnswer` (extract from `post`), `isNotSent`.
- Bypasses: only `kind === "proactive"` takes a slot (Q:423). Not capped: `transactional` sends such as the weekly check-in (N:3319, `proactive:false`, own lane), reminders, feedback asks. A C1 reply whose meta was marked proactive by `unsolicited` N:3998 (reply burst over REPLY_BURST) has kind `reply`, so no slot. A member with no `person_id` is uncapped (0007 line 181). `failed_unknown` releases a slot (bug B8). Cloud kind mapping sends `transactional` as `proactive` (cloud-channel.ts), so Cloud's view differs from ours. The stale hook fails open Q:368 (messaging-ops noted it).

### J13. Export and deletion
- Chain: founder correction: requests go to help@ntwrk.party; routes remain: `/api/me/export` api.ts:574 -> `exportApp` A:447 -> `exportMember` S:828 (excludes `agent_private`). `/api/me/delete` api.ts:626 -> `leave` or `deleteAll` A:432 -> `onForget` per app -> `forget` S:821 -> `forgetMember` N -> `writeUnit` forget block R:521 -> `people.deleteAll` pg-store.ts:304.
- Invariants: no other app data in an export; scores never exported; suppression stays; age floor stays; queued rows dropped; signed payloads sealed.
- Choke points: SQL. Not an LS target. `exportMember` column list is a review item, not a proof.
- Bypasses: rows with `member_id` null (direct texts) are not cleared by forget; they are refused at send by suppression, then ended. A STOP-only `opted_out` retained. None serious.

### J14. eliza.app takeover notice
- Chain: `inbound` non-member branch S:1139 -> `elizaNotice` S:1175 -> insert `platform.eliza_notices` -> `inbox.collect` -> `onFail` undo.
- Invariants: once per number; never to a banned number or under-age; enrolls nobody; only in a signed turn.
- Choke points: extract `noticeDue(facts)`; small.
- Bypasses: a member of any app never gets it (design). Notice to an opted-out non-member: no consent check in `elizaNotice`; it is kind compliance, fixed copy. Founder question: should a number that sent STOP get it.

## 2. Candidates ranked by value

All are EXTRACT core then prove unless noted; the shipping code must call the extracted function. dispatch and resolveConsent are ranked in the messaging-ops and network-service reports; this list adds only the cross-package ones.

### C1. `collectGate` (new, inbox.ts or runtime.ts) — protects leak check, STOP, ban on seam C
- Property: a non-compliance reply is collected only when the number is not banned, suppressed, opted out or held; every collected text is leak-clean or fixed copy; a fixed compliance text always goes.
- Spec sketch: `ensures \result === "collect" && f.kind !== "compliance" ==> !f.banned && !f.suppressed && !f.optedOut && !f.held`; `ensures \result === "collect" ==> (f.leakChecked && f.leakClean) || f.fixedCopy`; `ensures f.kind === "compliance" && f.fixedCopy ==> \result === "collect"`.
- Blockers: none. The facts need an async read, so the caller reads them first. Effort M (wiring in `direct` and `writeUnit`). The join prompt to a person opting back in needs a decision: S join answers with name and age are an opt-in.
- Trial T1: `lsc gen` and `lsc check`: 1 verified, 0 errors.

### C2. `statusAfter`, `mayReveal`, `stageAfterReview` (network.ts) — protects both-yes and review
- Property: `available` only after `reply === "yes"`; reveal only if all participants are available, adult, not opted out, not blocked; `probing` only from `review` with approval and gates.
- Spec sketch: `ensures \result === "available" ==> reply === "yes" || prev === "available"`; `ensures \result ==> forall(i: nat, 0 <= i && i < ps.length ==> ps[i].status === "available" && ps[i].adult && !ps[i].optedOut && !ps[i].blocked)`.
- Blockers: `Opp` uses Map and Set; pass a Part[] view. `parseProbeReply` itself has regexes and cannot be proved; prove the mapping from `Consent.answer` to reply instead. Effort M.
- Trial T4: 4 verified, 0 errors. Mutation with today's rule (`counter` becomes available): 3 verified, 1 error on the first ensures. The proof finds bug B1.

### C3. `joinStep` shared by `join` S:1384 and `joinLocked` A:351 — protects age, ban, invite gate
- Property: `join` only when not banned or held, the age and name are present, the effective age (including the phone floor) is at least 13, and an invite-only app has an invite.
- Blockers: none in the core; `validAge(unknown)` needs a typed wrapper. Effort M (two call sites merge; this also removes a copy).
- Trial T3: 3 verified, 0 errors. Mutation that ignores the floor: 2 verified, 1 error.

### C4. `turnKind`, `accountEligible` from `sharedTurn` S:2078-2098 — protects open turns for ineligible people
- Property: `open` only with outcome open, nothing collected, member, binding and context ok; `accountEligible` implies not banned, held, suppressed or opted out and a known age of 13+.
- Blockers: none. Effort S.
- Trial T2: 4 verified, 0 errors.

### C5. `relayDispatchCheck` N:4912 in place — protects J8 at the last gate
- Property: non-null unless the match is mutual, both are adult, not opted out, not held, not blocked. Blockers: `new Map(opp.status)`, `Array.find`, `relayMemberOf`. Needs a small state view. Effort M. Not trialed.

### C6. `isNotSent(status)` replacing the `NOT_SENT` regex — protects the cap
- Property: `failed_unknown` and `unknown_acceptance` never release a slot. Regex blocker removed by a closed status union. Effort S. Not trialed; covers bug B8.

### C7. `classifyDeliverAnswer` from cloud-channel.ts `post` — protects J12 retry
- Property: only an ok receipt returns accepted; `unknown` never maps to `retryable`. JSON `unknown` blocker: parse to a typed record first. Effort S. Not trialed.

## 3. Bugs

Severity is my estimate. None is confirmed by a running service, except B1, whose parser I ran.

- **B1 (high). A counter is a yes on a probe.** packages/network/src/classify.ts:666 and :719. Founder decision 11: only `answer: "yes"` is consent. Reproduced: `parseProbeReply("rain check", [])` and with options both return `answer:"yes"`, keys `[]`; also "maybe another day". Path: N:768 -> `onProbeAnswer` yes -> with options, one time retry; a second counter gives `retry` true, `fresh` empty, status `available`, `primed.add` -> `maybeReveal` -> booked. With no options (a peon seat, N:2179) the first counter books the intro. Fix: return unclear, and offer other times as a separate step.
- **B2 (medium). Join prompts after STOP in a signed turn.** S:1367 collects before any ledger read. Reproduce: number sends STOP with no membership, then "hi" through `/internal/turn`: `join` S:1413 collects `ask`, then `stopHint` S:1161 collects the hint with the same id `sys:<rowId>`. Comment S:1142 and README:209 say the ask is refused. The gateway fence may drop it (upstream, not checked). Duplicate reply ids also go to the turn receipt.
- **B3 (medium). A banned member still gets collected replies.** S:1006 has no ban check for a member. Reproduce: ban a member, then text "block Sam" in a turn: N:740 runs before the hold return N:746 -> `handleBlock` N:1405 -> `send(reply)`; `checkRecipient` passes because `o.reply` (N:4222-4223) -> C1. `consentRefused` comment S:~707 says a banned number gets only compliance texts; founder #3 says refused at inbound.
- **B4 (medium). The site OTP does not refuse a banned number.** packages/platform/src/api.ts:462-476 and :479-494 have no ban check; MCP `startOtp` does. It applies when Cloud auth is off for the app, including `PLATFORM_PHONE_OTP_ONLY_APPS` (#131). Join stays refused, but a code and a session are issued.
- **B5 (medium). Dry-run adapter skips `collectedLeaks`, and live flags do not gate C.** R:469 reads the queue only from a BlooioAdapter. deploy/backend/backend.ts:141-147 falls to dry-run when flags are off while `SERVICE_TURN_SECRET` stays set; the isolated route mode forces dry-run (main.ts:35). If the gateway takeover is on in that state, `rt.system` replies have no leak check and all replies ignore `BLOOIO_ALLOW_SEND`. Reachable in staging cutover; production depends on flag order.
- **B6 (low). Under-13 stated at a join keeps other memberships.** S:1417-1424 and A:366-369 call `recordAge` only. A member of friends who texts "slop", then "12": memberships stay active until the next inbound on that app runs `declineUnderMinAge`. `activeMembership` closes open turns, but queued non-match sends continue.
- **B7 (low). Number swap can go one way.** relay.ts `swap`: the first `apply` sends; if the second is refused it logs undelivered only. At queue level, the two rows are independent: quiet hours, a STOP or a parked leak can end one row. README says "never one way".
- **B8 (low). `failed_unknown` releases a cap slot.** Q:195 regex matches `failed_unknown`, and Q:345 releases, although the send may have happened. Over-cap by one is possible.
- **B9 (low). Leave on a held number is silent.** S:1060 before S:1075, against inbox.ts line 10.

## 4. Runtime guards

| Guard | Replaces or backs | Exercised by |
|---|---|---|
| `collectGate` | S:1367 `direct`, R:473 loop | packages/network/test/shared-agent.integration.test.ts; add turn cases for STOP then "hi" and for a banned "block Sam" |
| `statusAfter` | N:2300 yes branch | `bun run sim --only network`; add a corpus row "rain check" to the probe reply corpus |
| `joinStep` | S:1384, A:351 | packages/network/test/service-apps.test.ts, `sim --only safety` |
| `turnKind` | S:2086-2098 | packages/network/test/eliza-takeover.integration.test.ts |
| ban check in `/api/auth/otp/start` | api.ts:471 | packages/platform/test/api-security.test.ts |
| boot refusal: `SERVICE_TURN_SECRET` set with a non-queue adapter outside dev | R:469 | deploy/backend/backend.test.ts |
| closed status union | Q:195 | `sim --only pipeline` |

## 5. What not to verify

- `detectKeyword`, `leaveTarget`, `consentOf`, `parseProbeReply`, `parseJoinText`, `parseRelayRequest`, `photoConsentReply`, `withdrawsSwap`: regex-heavy. Keep corpus tests; prove what happens with their result.
- SQL: `person_cap_take`, `deleteAll`, the forget block in `writeUnit`, `Q.send` admission. Their value is locks and transactions, which Dafny here cannot see. Use integration tests.
- `handleInbound` and `send` as whole functions: huge, stateful, closures. Extract only the small decisions above.
- `Inbox.signed`: concurrency and leases. Model checking fits it better than LS.
- Seam M and the gateway fence: outside this repository. A proof cannot claim them; state it in any assurance summary.
- A shadow model of the whole opportunity state machine: production would not run it, so the brief excludes it.
