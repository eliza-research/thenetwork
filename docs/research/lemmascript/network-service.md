# LemmaScript research: network-service

Scope: every file in `packages/network/service` (26 files with the README). Every file was read in full. Trials: `lsc 0.6.6`, `dafny 4.11`, in `/private/tmp/claude-501/-Users-nubs-thenetwork/71ebb7fb-9e02-4dbf-b300-9c31fec118b5/scratchpad/research/network-service/` (`consent.ts`, `turn.ts`, `deliver.ts`, `cleanup.ts`, `mut/`, `real/`). Written by hand. Nothing in the repository changed except this report. No test and no simulation ran. The bugs in section 3 come from code reading, and each one says what confirms it.

Main result: no important decision in this folder can be proved in place. Each one sits inside an `async` function that uses SQL, or reads `unknown` JSON. The decisions themselves are small and pure. A new file, `packages/network/service/decisions.ts`, can hold about 30 of them. The trials proved 32 such functions (helpers included) with almost no proof text: 38 verified, 0 errors, no hand-written lemma. The service must call these functions, or the proofs say nothing about production.

## 1. Files reviewed

| File | Verdict | Why |
|---|---|---|
| `service.ts` | EXTRACT core then prove | The largest set of decisions: STOP scope, START, consent refusal, turn outcome, receipt state, set-state, enroll, recorded age. All are mixed with SQL and HTTP. `parseJoinText` is regex: not applicable. |
| `inbox.ts` | EXTRACT core then prove | Prior-claim answer, hold-back predicate, compliance-first pick, rescue decision. Advisory locks, leases and SQL `update` remain outside the proof. |
| `runtime.ts` | EXTRACT core then prove | `kind` at line 429, `relayParties` line 223, the loop in `relayPairAdmission`, the `deliver` partition. `writeUnit` and the forget path are SQL: not applicable. |
| `relay-endpoint.ts` | EXTRACT core then prove | `stored`, the `delivered` predicate and notice in `answer`. The rest is auth, SQL and I/O. |
| `cloud-channel.ts` | EXTRACT core then prove | Response classification (lines 51-67) decides resend or not. It must take a flat view of the parsed reply. |
| `channel.ts` | EXTRACT core then prove | `liveSendAllowed` needs one small change: read the flags, then decide. `stale` and `enqueue` go through the queue (messaging area). Dynamic `env[...]` keys fail in `lsc`. |
| `snapshot.ts` | EXTRACT core then prove | `effectiveParticipation`: split into parse (`unknown`, `Date.parse`) and decide. `loadSnapshot` is SQL. |
| `bias.ts` | EXTRACT core then prove | Only the adult filter. `biasRows` fails in `lsc` gen (array destructuring in an arrow). The rest is aggregate counting with engine calls. |
| `route-authority.ts` | MODEL ONLY | `routeEnvelopeAllowed` calls a parser of `unknown`. In-place gen passes, verify fails (optional versus `value === undefined`). With parsed input it is a one-line predicate. Staging only: low value. |
| `profile-suggestions.ts` | EXTRACT core then prove | Cleanup row table, edit-goes-to-preview, proposal range check. SQL holds the eligibility join. |
| `profile-suggestion-review.ts` | NOT APPLICABLE | Regex in the core of `currentBatch` and the parser (`lsc`: "Unsupported expression"). |
| `profile-suggestion-endpoint.ts` | NOT APPLICABLE | Wire shape checks over `unknown`, with regex. Identity lives in SQL. |
| `profile-suggestion-withdrawal-endpoint.ts` | NOT APPLICABLE | Auth shell, no decision other than fences of closures. |
| `profile-suggestion-disconnect-endpoint.ts` | NOT APPLICABLE | Same as withdrawal. |
| `profile-review-factory.ts` | NOT APPLICABLE | Closures over `WeakMap`, proof parsing, network calls. |
| `profile-review-proof-transport.ts` | NOT APPLICABLE | HTTP transport only. |
| `cloud-profile-review-owner.ts` | NOT APPLICABLE | SQL join plus Cloud proof. The rules are in the core parsers (core area). |
| `learning-consent-context-endpoint.ts` | NOT APPLICABLE | SQL-owned eligibility. It reuses `resolveConsent`, which the consent proof covers. |
| `postings.ts` | NOT APPLICABLE | SQL and route shell. The rules are in `src/jobs.ts`. See bug B5. |
| `photoIntake.ts` | MODEL ONLY | The order of checks is the safety property, and it is sequence of `await`s. One small extract is possible (`photoIntakeStep`, section 2 C10). `photoConsentReply` is regex. |
| `packs.ts` | NOT APPLICABLE here | Wiring and copy. `prefs` has a one-line age rule; the logic is in the engine (engine-packs area). |
| `cost.ts` | NOT APPLICABLE | Estimates in floats, no invariant depends on them. See section 5. |
| `main.ts` | NOT APPLICABLE | Process start. |
| `serve.ts` | NOT APPLICABLE | HTTP servers and tick loop. |
| `README.md` | NOT APPLICABLE | Used as the statement of intended behavior. |

`service.ts` also has `slaAlerts` (exported and pure, but it changes a `Set` and formats text; low value) and `reviewerOfRecord` (regex and `timingSafeEqual`; not applicable). Both are in section 5.

## 2. Candidates ranked by value

Sketches are the real text from the trials, which verified. Target file: `packages/network/service/decisions.ts`, one function per decision, with the service calling it. Effort counts the extract and the wiring, not the proof, which took no extra work in all trials.

### C1. Consent and ban refusal at send time. Effort S.
- Where: `service.ts:696` `consentRefused`, lines 706-711. Also `service.ts:1158-1159` `stopHint`.
- New function: `sendRefusal(kind, suppressed, banned, consent)`.
- Property: a non-compliance message never passes for a suppressed or banned number or one that is opted out. A compliance text always passes. This is the last gate for STOP and bans on every queued row, because `runtime.ts:186` `optedOut` reaches it.
- Sketch:
  ```
  //@ ensures kind === "compliance" ==> \result === "allowed"
  //@ ensures kind !== "compliance" && consent === "opted_out" ==> \result !== "allowed"
  //@ ensures \result === "allowed" ==> kind === "compliance" || (!suppressed && !banned && consent !== "opted_out")
  ```
- Protects: STOP, bans by phone. Blockers: none after extraction. The caller keeps the SQL lookups.
- Trial: verified (`consent.ts`, with C2 and C5: 8 verified, 0 errors). Mutation: `suppressed && banned` in place of `suppressed` gave 1 postcondition error.

### C2. `resolveConsent`. Effort S. Shared with the platform area.
- Where: `packages/platform/src/consent.ts:37`, called from `service.ts:710,1158,2064`.
- Property: a global opt-out holds unless a strictly newer app opt-in exists. An app opt-out always gives `opted_out`. `opted_in` needs an app opt-in event. So an older START never beats a newer STOP.
- Sketch:
  ```
  //@ ensures evIs(global, "opted_out") && evIs(app, "opted_in") && atOf(app) <= atOf(global) ==> resIs(\result, "opted_out")
  //@ ensures resIs(\result, "opted_in") ==> evIs(app, "opted_in")
  //@ ensures evIs(app, "opted_out") ==> resIs(\result, "opted_out")
  ```
- Blockers: the shipped form fails. With `!global || global.state === "opted_in"`, `lsc` emits `i_global_val.state == "opted_in"` and gives a type error, and `x !== undefined && x.field` does not narrow in `ensures`. The proved form uses two positional parameters, nested `if`s and helper predicates (`evIs`, `atOf`, `resIs`). The nested form behaves the same. The object parameter `{app, global}` was not tried.
- Trial: verified in `consent.ts`.

### C3. Signed turn outcome. Effort M.
- Where: `service.ts:2079-2096`.
- New function: `turnDecision(facts)`. The caller reads the facts (SQL, `activeMembership`, `sharedContext`) and passes booleans.
- Property: `open`, which lets the LLM talk to the person and gives it context, needs outcome open, no collected reply, a member, and a bound membership and context. `accountEligible` needs policy allowed, a known age and `canJoin`. Onboarding needs an unknown age and no member.
- Sketch:
  ```
  //@ ensures \result.tag === "open" ==> f.outcome === "open" && f.replies === 0 && f.hasMember && f.hasApp && f.bound && f.contextReady
  //@ ensures \result.tag === "handled" && \result.accountEligible ==> f.policyAllowed && f.ageKnown && f.canJoinAge
  //@ ensures \result.tag === "handled" && \result.onboarding ==> f.policyAllowed && !f.ageKnown && f.outcome === "join_asked" && !f.hasMember
  ```
- Protects: STOP, bans and minors at the LLM seam. `bound` is proved only as an input. It relies on `Accounts.activeMembership` (platform area), so the claim stops there. See guard G2.
- Trial: verified (`turn.ts`: 15 verified, 0 errors, with C4, C6).

### C4. Turn receipt state machine. Effort M.
- Where: `service.ts:2011-2034`.
- New functions: `receiptAction(facts)`, `receiptStatus(outcome)`.
- Property: a receipt is final, with one exception: `unknown` may become `accepted` or `rejected`. `accepted` needs provider ids and history, or a persisted account-free reply. Non-accepted never claims history. Empty collected replies need an empty receipt. Accepted is the only path to status `sent`.
- Sketch:
  ```
  //@ ensures \result === "store" ==> !r.hasPrior || (r.priorUnknown && r.outcome !== "unknown")
  //@ ensures \result === "store" && r.collected > 0 && r.outcome === "accepted" ==> r.providerIds > 0 && (r.history || r.accountFree)
  //@ ensures \result === "store" && r.collected === 0 ==> r.replyIds === 0 && r.providerIds === 0 && !r.history
  ```
- Protects: idempotency, consent evidence (the thread history that the leak guard reads). Blockers: `isDeepStrictEqual` and `JSON.stringify` stay outside and arrive as booleans (`identical`, `idsMatch`).
- Trial: verified. Mutation that let a final receipt change: 2 errors.

### C5. STOP, START and the outbound kind. Effort S.
- `stopScopeOf` (`service.ts:1055`): `stop_all` or shared line gives `global` (decision 7).
- `startOutcome` (`service.ts:1103-1107` and `1134-1136`): banned refused, `opted_in` only when the ledger says so after the write. The proof is cheap and the function fixes bug B1 if both branches call it.
- `outboundKind` (`runtime.ts:429`): `proactive && !reply ==> kind "proactive"`. It protects the cap of 3, because `outbound-queue.ts:423` takes a cap slot only for `row.kind === "proactive"`. The `proactive` flag does not reach the queue.
- `recordedAge` (`service.ts:1300`): a stated age under 18 stays under 18 after the `max` with `minJoinAge`. Needs `requires minJoinAge >= 13 && minJoinAge < 18`, which is an assumption about `platform.apps` rows. `fromDatabase` reads them from the table, so a runtime guard must enforce it (G4).
- `mayEnroll` (`service.ts:1481`): a minor or unknown age never enrolls in slop from "what are you looking for?".
- Trial: verified in `consent.ts`.

### C6. Inbox: compliance is never held back. Effort S.
- Where: `inbox.ts:96-97`, `101-107`, `148`, `251-259`.
- New functions: `turnHeldBack`, `priorAnswer`, `pickWaiting`, `rescueAction`.
- Properties: for a compliance text only a running turn holds it back. A row with a different hash never replays. If any waiting row is compliance, the first such row goes next. A committed consent change is never released. The proof states the exact limit in G5.
- Blockers: `turnHeldBack` must replace values inside the SQL `where`. The claim query reads rows, and then TS decides, or the `not exists` stays and the proof is a statement of a copy. Choose: read the three flags in the same locked transaction, then insert. That is a real change to the query, so it costs M for this one function. The others are S.
- Trial: verified, including `findIndex` with a `forall` postcondition, no invariant.

### C7. Cloud deliver classification. Effort S.
- Where: `cloud-channel.ts:51-67`.
- New function: `classifyDeliver(view, receiptOnly)`. The caller maps the parsed reply to `{status, ok, error, retryable, wellFormedAccept}`, then throws `ChannelSendError` by class.
- Property: never a resend on doubt. `unknown` from Cloud or a malformed body stays `unknown`. `retryable` needs an explicit `rejected` plus `retryable: true`. A receipt lookup never gives `blocked`, `invalid` or `retryable`. Accepted needs status 200 and a well-formed body.
- Sketch:
  ```
  //@ ensures v.error === "unknown" && v.ok !== "yes" ==> \result === "unknown"
  //@ ensures \result === "retryable" ==> !receiptOnly && v.ok === "no" && v.error === "rejected" && v.retryable
  //@ ensures receiptOnly ==> \result === "accepted" || \result === "not_admitted" || \result === "unknown"
  ```
- Protects: the deliver rule "on unknown retry only with the same id", and so at-most-once sends. Trial: verified (`deliver.ts`: 11 verified, 0 errors, with C8, C9, `biasEligible`). Mutation that dropped the status check and the `unknown` guard: 3 errors.

### C8. Relay fail-closed checks. Effort S.
- Where: `runtime.ts:223`, `runtime.ts:281-285`, `relay-endpoint.ts:133-134`.
- New functions: `relayCanonical`, `pairReason`, `relayDelivered`.
- Properties: no row or no binding gives `optedOut`. `ok` means every party is adult, not opted out and not held (a `for` loop with an invariant, proved). `delivered` means pass, a row, history and provider ids.
- Sketch:
  ```
  //@ ensures \result === "ok" ==> forall(i: nat, i < ps.length ==> ps[i].adult && !ps[i].optedOut && !ps[i].held)
  ```
- Protects: minors, STOP, holds at final relay dispatch. Trial: verified. The loop needed two `invariant`s and one `decreases`. `RelayCanonical` is also read by `packages/network/src/relay.ts`, so `pairReason` may belong beside `relayDispatchCheck`.

### C9. Participation: STOP outranks a window. Effort S to M.
- Where: `snapshot.ts:20-33`, `service.ts:1939-1943`.
- New functions: `windowActive`, `effectiveState`, `isScheduled`, `stateUnchanged`.
- Property: `optedOut ==> paused`, whatever window the agent set. A set-state call cannot undo STOP. `unchanged` means no event and no write.
- Blockers: the shipped function reads `unknown` and fails with "Unsupported Dafny method call: .isArray() on unknown". Split parse from decide. The caller turns `Date.parse` into numbers. The trial uses `-1` for "no bound", and the real code should use an optional or two booleans.
- Trial: `deliver.ts` and `cleanup.ts` (4 verified, 0 errors).

### C10. Smaller items. Effort S each.
- `liveAllowed` (`channel.ts:94`): `\result <==> allowSend && networkApproved && appApproved`. Verified, after reading flags first. In-place failed: `env.BLOOIO_ALLOW_SEND` becomes a field on a map, and `env[...]` gives `Option` compare errors.
- `cleanupAction` (`profile-suggestions.ts:277,328-331,419-426`): readback changes nothing, delete ignores retention, withdraw keeps accepted facts, disconnect honors retention. Verified. Note the three loops use one table only after a refactor.
- `reviewPath` (`profile-suggestions.ts:226`): an edit or scope change is never an acceptance. Verified.
- `biasEligible` (`bias.ts:26`): verified, weak property. Use `canBeMatched`.
- `photoIntakeStep` (not tried): an ordered state function for `photoIntake.ts` with inputs `member, refused, consented` and output `drop | ask | fetch`, with the property `fetch ==> member && !refused && consented`.
- `capRefused` filter (`service.ts:593`): trivial, skip.

The person cap itself is not provable here. The count and the check are in `platform.person_cap_take` (SQL, migration 0007) under an advisory lock. See section 5.

## 3. Bugs

All from code reading. None was run against Postgres, because the brief forbids test runs. A later wave should turn each into an integration case that fails first.

**B1. A stale START from a non-member reports `opted_in` to the gateway. Medium.** `service.ts:1132-1136`. The member branch (`1106-1107`) asks `accounts.optedIn` after the write and returns with no `turn.consent` when the START is older than the STOP. The non-member branch sets `turn.consent = {state: "opted_in"}` with no check, and goes on to the join flow. Path: a stranger's START at T1 is delayed. Their STOP at T2 is handled first. The START arrives with `receivedAt` T1. The ledger stays opted out, but the handled turn tells the gateway `opted_in`, and the gateway copies this into its send-time fence (CLAUDE.md "Consent path"). Whether the gateway compares `at` is not known here. `eliza-takeover.integration.test.ts:186` tests a member only. The non-member case with the same assertion (`late.consent` undefined) should fail. Fix: both branches call `startOutcome`.

**B2. After STOP, a stranger's text creates two replies with one id. Medium.** `service.ts:1413` sends the join ask with id `sys:${rowId}`, then `1144` calls `stopHint`, which sends the hint with the same id (`1161`).
- Signed turn: `Inbox.collect` appends both. `replyIds` holds the id twice and `replyKind` is `reply`, so an opted-out number's turn carries a join question. `direct()` (`1369`) has no consent check in a turn, so the comment at line 1143 ("refused at send time") does not hold there. Delivery depends on the gateway fence.
- Legacy path with the live Blooio adapter: `OutboundQueue.enqueue` finds the id with another fingerprint and throws `IdempotencyConflictError` (`outbound-queue.ts:243-250`). The inbox retries. The hint counter is already spent, so the retry succeeds with no hint.
- `service-platform.test.ts:442` passes because its fake `direct` records both and has no id check.
- Fix: check consent before the join ask, or give the hint its own id.

**B3. Leave uses the wrong event time. Low.** CLAUDE.md and the README say consent events in a turn use the gateway's `receivedAt`. `accounts.leave` stamps `now()` (`accounts.ts:422`) and `service.ts:1090` reports `at: t`. The branch next to it (`1089`) uses `consentAt(ev)`. A retried leave then gets a time later than a newer join. The error is in the safe direction (opt-out), but the ledger order is wrong and the code disagrees with itself.

**B4. `Date.now()` in network code. Low.** `profile-suggestions.ts:291,368` use `this.fence?.now() ?? Date.now()`, against the Clock invariant. Both run only with a fence in the shipped callers, so the fallback looks dead. A `new ProfileSuggestions(...)` with no fence reaches it. Fix: make `fence` required on these paths.

**B5. The peon postings staff API is not wired. Low.** `postings.ts:10` says the handler is "registered by the service". `jobPostingRoutes` has no caller outside `peon-postings.integration.test.ts`. So `verifyEmployer` has no production route, and the comment says peonPack proposes no job of an unverified employer. Peon is local only today (decision 4). Either wire it or fix the comment.

**B6. Weekly bias report counts every city. Latent.** `service.ts:543-545` reads members by `app_id` only. `rt.net.opps` holds one network. With two networks of one app, each report includes the other city's members with zero outcomes, and ratios go down. Today the seed has only `:nyc` rows, so nothing happens yet. The `sf` city exists in `platform.cities`. Fix: filter with `conversationCities(rt)`.

**B7. Hard-coded ages. Rule violation.** `service.ts:130,779,1481,1585`, `bias.ts:26`, `packs.ts:72` use 18 directly. CLAUDE.md says to use `isMinor` and `canBeMatched`. All are correct today.

**Observations, not bugs:**
- The member path of `inbound` has no ban check before `memberMessage` (`service.ts:1099`; `submitProfile` has one). A banned member is on trust `hold`, so `handleInbound` returns early at the hold line, but not before the age, welcome and block branches. A reply from those branches is collected in a signed turn with no `consentRefused`. On the legacy path the same reply is refused. Check whether line 707 ("nothing but compliance texts") must hold for collected replies.
- A held number's "leave <app>" is not handled, although `isComplianceText` treats it as compliance. STOP works.
- `Inbox.signed` holds a compliance turn back while another turn is `processing`, up to the 2-minute lease after a crash. The README says STOP is never held back. The answer is `turn_busy` and retryable, so STOP is delayed, not lost.
- Cloud wire `kind`: `transactional` maps to `proactive` (`cloud-channel.ts:37`). The wire has no fourth kind. If Cloud counts proactive sends, this count is higher than the service's.
- A member with no `person_id` has no person cap (`person_cap_take` line 181). Stated in the comment at `service.ts:590`.

## 4. Runtime guards

| Id | Proved predicate | Where it replaces or backs a check | Same code exercised by |
|---|---|---|---|
| G1 | `sendRefusal`, `resolveConsent` | `consentRefused`, `stopHint` and `admission` (`service.ts:2062`) call one function | `packages/network/test/service-platform.test.ts`, `eliza-takeover.integration.test.ts`, sim `pipeline` |
| G2 | `turnDecision` | Add `policyAllowed` to the `open` condition. Today only `binding` gates `open` (`service.ts:2089`). `activeMembership` is stronger, so this is a second check, not a change of behavior | `shared-agent.integration.test.ts` (security suite) |
| G3 | `startOutcome` | Both START branches. Fixes B1 | `eliza-takeover.integration.test.ts`, add the non-member case |
| G4 | `recordedAge` | `requires minJoinAge in [13, 18)`: assert at `fromDatabase` when rows load, or the proof does not apply to a changed row | `service-apps.test.ts` |
| G5 | `turnHeldBack`, `pickWaiting` | Replace the inline logic. Proof limit: it covers one decision, not lock order or the 50-row scan (`KEYWORD_SCAN`). A STOP past row 50 waits | inbox cases in `service-platform.test.ts` |
| G6 | `classifyDeliver` | Replaces the `if` chain, the thrown error comes from a table | `tests/e2e`, sim `pipeline` with the fake provider |
| G7 | `relayCanonical`, `pairReason` | `relayParties`, `relayPairAdmission` | sim `relay`, `shared-actions.integration.test.ts` |
| G8 | `receiptAction` | `sharedTurn` receipt branch | `shared-agent.integration.test.ts` |
| G9 | `effectiveState` | `effectiveParticipation` | `shared-actions.integration.test.ts` |

Repo policy allows no unit tests. A new `decisions.ts` is covered by `lsc check` plus these integration tests. A CI step `lsc check --backend=dafny packages/network/service/decisions.ts` belongs next to `bun run typecheck`.

## 5. What not to verify, and why

- `parseJoinText`, `profileReadRequest`, `photoConsentReply`, `parseSuggestionReview`, `reviewerOfRecord`, `valueOK`: regex core, out of fragment. Their value is in the corpus tests.
- `person_cap_take`, `person_cap_release`, the `owned()` eligibility join, the forget path in `writeUnit`, RLS: SQL. A TS copy would be a shadow model that production does not run. If a proof of "at most 3 in 24 h" is wanted, only a model is possible, and the sim `pipeline` gate and `service-apps.test.ts` already exercise it. Moving the count to TS gives up the single advisory-lock function, so do not move it.
- Crash, retry and lease behavior of `Inbox`: the properties are about interleavings over Postgres. LemmaScript proves one call at a time. This branch's Quint work is the better tool.
- `sharedContext` leak filter: it depends on `outputLeaks` (regex, core area).
- `cost.ts`: floats and estimates. `budgetLines` protects no invariant. `real` modeling also ignores float rounding, so a proof says little.
- `slaAlerts`: alert text and a mutated `Set`. A wrong alert does not contact a member.
- `sameNetworkAuthority`, the `parse*Proof` calls: `unknown` narrowing belongs in core.
- `packs.ts` hooks and copy: covered in the engine-packs area.
- All endpoints' body shape checks: `typeof` on `unknown` is out of fragment, and the failures are already fail-closed.

Limits of what the proofs in section 2 say: they prove the decision given its input booleans. They do not prove that the caller reads those booleans correctly or in one transaction. They model `number` as an integer (safe here, these are counts and epoch ms). They rely on `activeMembership`, `lowestAge` and the ledger read, which belong to the platform area.

LemmaScript notes for the implementers:
- `x !== undefined && x.f` does not narrow in `ensures`, and `??` fails in specs ("Unexpected: op ?"). Use a helper predicate with `if`.
- A string-literal value `"none"` clashes with `Option.None` (generated `Refusal.None` fails to resolve). Use another word.
- Array destructuring in arrow parameters is not supported (`[k, n]`).
- `Record` with a key built at run time gives `Option` compare errors.
