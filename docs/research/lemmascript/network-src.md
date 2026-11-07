# LemmaScript research: network-src

Scope: `packages/network/src` (15 files), `packages/network/harness` (5 files), `packages/network/db` (1 file). The ConsentNetwork state machine.

Main finding: **no function of `network.ts` can be annotated in place.** The state machine is a 5,000-line class with private `Map` state. Each decision is mixed with logging, ledger events and sends. The correct plan is one new file, `packages/network/src/transitions.ts`, that holds pure decision functions. The class then calls those functions. The trials below show that this file verifies. Two proofs failed on purpose, and both failures are real defects (bugs 1 and 2 in section 3).

Trial files: `/private/tmp/claude-501/-Users-nubs-thenetwork/71ebb7fb-9e02-4dbf-b300-9c31fec118b5/scratchpad/research/network-src/` (`transitions.ts`, `gates.ts`, `cap.ts`, `inplace/`, `repro-consent.ts`). They are models of the proposed extraction. Production does not call them yet. Each one must become code that the class really calls, or it is a shadow model and has no value.

## Trial results

| Trial | Command | Result |
|---|---|---|
| `transitions.ts` (trust level, abuse points, staff hold, review gate, SLA, reveal, sequential probes, probe answer) | `lsc check --backend=dafny` | 12 verified, 1 error. The error is `probeYesShipped`, which encodes the shipped logic: `\result ==> c === "yes"` cannot be proved. This is bug 1. `probeYesFixed` verifies. |
| `gates.ts` (minor status, decline, `recipientOk` with `every`, relay dispatch, report points, window count) | same | 14 verified, 1 error. The error is `sharesShipped`: `\result !== 1` cannot be proved. This is bug 2. `sharesFixed` verifies. |
| `cap.ts` (window count stays at or under the cap after one send) | same | 4 verified, 0 errors. |
| `inplace/trust.ts`, `//@ verify` on `Trust.relevel` | `lsc gen` | Failed: `Dafny emission failed for 'Trust' in trust.ts: Unsupported Dafny method call: .get() on user`. Also a warning that `TrustLevel === TrustLevel` compares non-primitive operands. |
| `inplace/outreach.ts`, pure `inWindow2` in the file | `lsc check` | Failed before verification: `Failed to extract const 'fmt' at outreach.ts:63: Unsupported expression: new Intl.DateTimeFormat(...)`. A module-level `Intl` constant stops the whole file. |

An early run of `transitions.ts` gave 2 errors. One was a mistake in my spec of `afterReview` (a stage that is already `probing` returns `probing`). I corrected the spec. It was not a code defect.

LS facts learned:
- A class method that uses `this.<Map>.get` does not emit. Decisions must be top-level functions.
- A file with a non-modelable module-level constant fails whole. `transitions.ts` must import nothing and have no `Intl`, `RegExp` or `Set` constants.
- `type Age = number | undefined` is not narrowed. An inline `number | undefined` is narrowed in statements, but not across `&&` in an expression-bodied function, and these are the only functions that specs can call. `attested!` is a parse error in a spec. Use `-1` for unknown age, and let one caller function convert from `validAge`. That conversion is trusted and unproved.
- `.every` with a lambda proves with a `forall` postcondition and needs no extra invariant.
- Recursion over `ts.slice(1)` proves with no `decreases` line. `[now, ...ts]` unfolds in one step. Shipped code appends (`m.proactive.push`), so a cap proof on the shipped order needs an append lemma, or the core must store newest first.

## 1. Files reviewed

Every file was read in full.

| File | Verdict | Why |
|---|---|---|
| `src/network.ts` (4998) | EXTRACT core then prove | The state machine. Decisions listed in section 2. Class, private Maps, regexes, `Intl`, hooks and I/O stop any in-place proof. |
| `src/trust.ts` (145) | EXTRACT core then prove | `relevel`, `report`, the `handleAbuse` points and the decay step are pure arithmetic inside a class. |
| `src/relay.ts` (408) | EXTRACT core then prove | The swap two-phase send and the `apply` routing. The rules are in the engine (engine area). Real `await` in `request` and `swap`. |
| `src/outreach.ts` (111) | EXTRACT core then prove | `inWindow`, budget tables. `fmt` (`Intl`) stops the file. Move `inWindow` and the budget check out. `nextAt` and `nyParts` are NOT APPLICABLE (time zones). |
| `src/jobs.ts` (294) | EXTRACT core then prove | `missing` and `postingFromDraft` are pure. `postingProblem` is pure except for one regex: split it. The rest is regex parsing and copy. |
| `src/classify.ts` (788) | EXTRACT core then prove | Only the last steps of `parseProbeReply` and `consentOf`, after the regexes reduce to booleans. All other code is regex: NOT APPLICABLE. |
| `src/extract.ts` (140) | PROVE in place (one function) after a move | `mergeConsent`: pure and small, but the file has imports and `Set` constants, so it moves to `transitions.ts`. `validateUnderstood` uses `unknown`: NOT APPLICABLE. Prompt code: NOT APPLICABLE. |
| `src/store.ts` (336) | MODEL ONLY | `oppState` and `partStatus` are pure switches with a low value. Locks, SQL and JSON are out of the fragment. The lock protocol is not an LS problem. |
| `src/reports.ts` (42) | NOT APPLICABLE | Regex only. The `URGENT_REPORTS` set is data. |
| `src/plans.ts` (91) | NOT APPLICABLE | Venue table and `Date` use. `planLedger` is simple mapping. The engine owns plan logic. |
| `src/geo.ts` (156) | NOT APPLICABLE | Floats, trigonometry, a table. No invariant. |
| `src/copy.ts` (209) | NOT APPLICABLE | Templates. `styleViolations` is regex. |
| `src/capital.ts` (60) | NOT APPLICABLE | Wiring, and `try`/`catch` around a ledger. |
| `src/apphooks.ts` (69) | NOT APPLICABLE | Interfaces only. |
| `src/index.ts` (13) | NOT APPLICABLE | Exports. |
| `harness/experiment.ts` (289) | NOT APPLICABLE | Simulation harness, reads hidden truth. |
| `harness/scenarios.ts` (405) | NOT APPLICABLE | Scenario data. It is a good runtime witness for section 4. |
| `harness/growth.ts` (52) | NOT APPLICABLE | Persona factory. |
| `harness/paraphrase.ts` (70) | NOT APPLICABLE | Text rewrite. |
| `harness/index.ts` (6) | NOT APPLICABLE | Exports. |
| `db/network-state.sql` (90) | NOT APPLICABLE | Schema. It has no constraint that ties `review_items.decision` to `opportunities.state`. |

## State transitions found

`Opp.stage` (`network.ts:338`):

| From | To | Where | Guard now |
|---|---|---|---|
| (new) | review | `newOpp:2103`, `submit:2054` | Category allowed, else closed. |
| review | probing | only `begin:2065`, `beginPlan:2941`, only from `decide:1927` | `reviewBlock`, `editBlock`, `approvalCheck`. **No deadline check** (bug 3). |
| review | closed | `decide` reject, `reroll` no alternate, `advance:3345` expiry, `dropMember`, `endSeat` | |
| probing | scheduled | `reveal:2438`, `bookPlan:3071` | All `available`, then `checkRecipient` per member; plans: quorum. |
| probing | closed | `close`, `closeNoCommonTime`, `replaceOrClose`, `planFallback` | |
| scheduled | done | `advance:3406` | Three hours after the meeting. |
| scheduled | closed | `handleDrop:2518`, `close` | |

The `stage` writes are few, and `begin` has one caller, so "no contact without approval" is a true property of the code today. It is only held by convention, because `o.stage` is a public field write.

`PStatus` per member: queued, probing, available, yes, unavailable, no, dropped. `available` is set in six places: `advanceProbes:2136` (primed), `onProbeAnswer:2300`, `advance:3378` (time retry silence), `times` hook `onRefused:4073`, `startProbes:2120` (sim only), `planAnswer:3014`. Two of them (`3378`, `4073`) act on silence or a refused send after an answer that bug 1 can read wrongly.

Other machines: member stage (new, age, q1, q2, q3, active), trust level, `RelayHeld.status`, swap pending/consumed, `FraudItem.status`, `SafetyCase.status`, report status, posting draft.

## 2. Candidates ranked by value

Each one goes in `transitions.ts`, and the class calls it. Effort: S under a day, M a few days, L a week or more. All carry "no await, no I/O" by construction.

### 1. Probe consent: only a yes is consent. classify.ts:663, extract.ts:131, network.ts:760-772
- Function: new `probeAnswerOf(c, hasOptions, neither, picks...)`, the tail of `parseProbeReply` after regexes become booleans, then `mergeConsent`.
- Property: the result is yes only when the shared reading is yes (or the LLM yes with reading `none`).
- Sketch: `//@ ensures \result === "yes" ==> c === "yes" || (c === "unclear" && why === "none" && llm === "yes")`.
- Protects: consent only on answer yes (decision 11), intro only after both sides said yes.
- Blockers: regexes stay outside; the booleans are trusted inputs. The tail has many branches but no loops.
- Effort: S. Trial: `probeYesShipped` fails (bug 1). `probeYesFixed` verifies.

### 2. Recipient gate. network.ts:4215
- Function: `recipientOk(r, kind, proactive, reply, about)`.
- Property: never to a declined, unknown or opted-out member; about-others kinds never to a minor or a watched member; every other person is known, adult, unblocked, not watched; never proactive to "only when I ask"; held and paused accounts get replies and safety notices only.
- Sketch: see `gates.ts`. Keep the reason code: return a string or null and prove `\result === null ==> ...`.
- Protects: minors, STOP, blocks, leak-adjacent policy. `recipientPolicy`, `blooioRecipientPolicy` and every `send` go through it.
- Blockers: `blocked()` and `syncRecord` run before the call and fill a record. That fill step is trusted. `ABOUT_OTHERS` must become a function, not a `Set` constant.
- Effort: S. Trial: all ensures verified in `gates.ts`, including the `forall` over `about`. The trial omits `ASK_KINDS` on line 4224: add it.

### 3. Review gate and SLA. network.ts:1889-1933, 3345
- Functions: `afterReview`, `afterSla`.
- Property: review to probing only on approve, before the deadline, with gates passed; an item past the deadline never moves to probing.
- Protects: human review before contact; expired items never sent.
- Effort: S. Trial: verified. The shipped code does not meet it (bug 3), so the fix goes in with the extraction.

### 4. Minor status step. network.ts:688-729, 4423, 1565
- Functions: `minorAfter`, `mustDecline`, and a guard for `clearMinorSignal`.
- Property: `minor` false implies a known age, every known age is 18 or more, and no new signal; a minor with a record age or any signal stays a minor; an attested adult is never deleted.
- Protects: minors never matched; the lowest age wins.
- Blockers: optional ages (sentinel `-1`, see LS facts). `handleInbound` runs the two updates with a `dropMember` between them: the extraction must keep that order.
- Effort: M, because the code around it is the riskiest to touch. Trial: verified (6 ensures).

### 5. Reveal and sequential probes. network.ts:2129-2147, 2400
- Functions: `allAvailable`, `afterAnswers`, `mayProbe`.
- Property: scheduled only with every participant available; a non-first member is probed only after the first said yes (for peon, the manager only after the candidate).
- Protects: double opt-in.
- Blockers: `Map<MemberId, PStatus>` must be read into an array by the caller.
- Effort: S. Trial: verified.
- Limit: this proves the step, not that `available` means consent. That needs candidate 1, and the two silent paths (`3378`, `4073`) must also take a recorded yes as input.

### 6. Relay dispatch. network.ts:4885-4930
- Functions: `relayPartyOk`, `relayDispatchOk`, called by `relayDispatchCheck` and `relayMemberOf`.
- Property: pass implies a mutual match, both accepted, both adults with no doubt flag, not opted out, not held, not blocked, two different members.
- Sketch: `gates.ts`. Keep the reason codes.
- Protects: relay safety at the final admission. It is the last gate before a relayed text leaves.
- Blockers: `st.opps.find` and `new Map` stay in the caller; `Math.min(...ages)` is not in the documented subset (SUBSET.md lists `Math.max(...arr)`), and the ages are optional, so the caller computes the lowest age.
- Effort: S. Trial: verified.

### 7. Number swap: all or nothing. relay.ts:269-305
- Function: `swapPlan(theirPass, myPass, canFirst, canSecond)`.
- Property: 0 or 2 numbers go, never 1.
- Effort: M. Needs a new preflight that answers "would send refuse" without side effects. Trial: `sharesFixed` verified; `sharesShipped` fails (bug 2). A proof shows only the plan. A send can still fail after the preflight (for example a provider error), so also order the sends and record what happened.

### 8. Budgets and caps. network.ts:4199, 4018; outreach.ts:96
- Functions: `recent`, `mayPush`, `record`, `unsolRefusal`.
- Property: after any send, the count in the rolling window is at or under the budget; the third unanswered unsolicited send is refused, except the one re-engagement.
- Protects: interruption budgets. The person-level cap of 3 a day is in `packages/network/service/service.ts:117` (network-service area). The same `recent` should serve it.
- Blockers: the shipped append order (see LS facts); `Date`-free already.
- Effort: S. Trial: `cap.ts` verified with newest-first order.

### 9. Trust. trust.ts:112, 136; network.ts:1144, 1319
- Functions: `nextLevel`, `abusePoints`, `staffHoldPoints`, `reportPoints`.
- Property: hold is sticky except for `lift`; one message from a clean record never reaches hold; staff hold always reaches hold; report points need a credible reporter who met the target, once, with corroboration.
- Effort: S. Trial: verified. Replace the literals with `WATCH` and `HOLD` in the moved code.

### 10. Quiet hours. outreach.ts:79
- Function: `inWindow`. Property: empty window is never in; a plain window is in only between its ends; a wrapped window is the complement of the plain one.
- Effort: S. Trial: not reached, because the `fmt` constant stopped the file. The function itself is in the fragment. Second tier: the hours come from `nyParts`, which stays trusted.

### 11. Posting validity. jobs.ts:186, 94, 201
- Functions: `missing`, `postingFromDraft`, and `postingProblem` without the id regex.
- Property: an active posting always has a title and a pay range; a closed draft never reopens a posting.
- Effort: S. No trial. Third tier: it has no safety invariant behind it, except "never a job without pay".

### 12. Held item lifecycle. relay.ts:347-376
- Property: rejected is terminal, text is gone after a decision, a released item has no text left. Effort: M. No trial. The value is in the privacy statement.

## 3. Bugs

Severity is my reading. Nothing here was fixed.

### Bug 1 (high): a counter-offer, or "neither", counts as a yes to a probe
- `classify.ts:666`: with no time options, `c.answer === "counter"` returns `answer: "yes"`.
- `classify.ts:719`: with options, a counter returns yes with no keys. `classify.ts:714`: "neither" also returns yes with no keys.
- Rule broken: AGENTS.md decision 11: "only `answer: "yes"` is consent, a counter is not a yes." The header of `classify.ts:503` says the same.
- Reproduced with `repro-consent.ts`: `"how about next week?"`, `"could we do a different day"` and `"rain check"` all give `consentOf` = counter and `parseProbeReply` = `{"answer":"yes","keys":[]}`, with and without options. `"neither"` and `"none of those work"` with options give `{"answer":"yes","keys":[]}`.
- Path without options: peon seat items always have no options (`network.ts:2180`). A candidate who says "rain check" becomes `available`, and the manager is told "A candidate said yes to your post".
- Path with options: `onProbeAnswer` offers other times once (`2314-2322`). If the member stays silent, `advance:3378` sets `available`, and the plan can book and reveal names. A member who said "rain check" and then nothing is revealed.
- The comment at `3377` shows the silence rule is on purpose, for a real "yes, but none of those". The defect is that a counter and a bare "neither" enter that path. The simulator hides it: `experiment.ts:138` also counts a counter as a yes.
- Fix: return unclear (ask once more), or no for a counter with no time to offer. Add a sim gate: a persona that sends a rain check and then goes silent must reach no reveal.

### Bug 2 (high): a number swap can go one way
- `relay.ts:292-299`: after both engine decisions pass, the first share is sent, then the second. If the second send is refused, the code returns "refused", but the first number already went out. The comment at `relay.ts:286` says "so nobody's number goes one way".
- Reachable: the second recipient is the member who asked first. `send` refuses logistics when `outbound > 2` (`network.ts:3885`, `attention.canSendLogistics`). A relay request is not an inbound turn, so `replyTo` is unset and the send is not a reply. That member may have three unanswered messages (relayed texts) since their request. The first share goes to the member who just wrote, so it passes. The second gets `conversation_streak`, then `refused`. Member B has A's number, and A does not have B's.
- A variant: a first share that is deferred counts as sent (`relay.ts:248`), and a later refusal at the tick is not seen.
- Not run end to end. The trace is by reading, and `sharesShipped` shows the logic.
- Fix: preflight both sends, or send the first only after the second is known deliverable.

### Bug 3 (medium): a reviewer can approve an expired item
- `decide:1889` and `reviewBlock:1941` do not compare `now` with `o.review.deadline`. Only `advance:3345` enforces the SLA, and it runs on the tick. `service.ts:1537` calls `decide` without a tick.
- Result: between the deadline and the next tick, an expired item is approved and probes go out. The tick is 60 s in `serve.ts:107`, and a tick skipped by a held lock makes the gap longer. `reroll` at `2033` also gives a past-deadline item a new deadline.
- Rule broken: "an item past its SLA expires unsent".
- Fix: `reviewBlock` returns `review_expired` when `now >= deadline`. Candidate 3 proves it. Test: an integration case that advances the clock past the deadline with no tick, then approves.

### Bug 4 (medium): crew offers skip the about-others checks
- `crewCheck:3186` sends with kind `"info"`, and `onFeedback:2619` with kind `"reply"`. Both pass `about`, but `checkRecipient` reads `about` only for `ABOUT_OTHERS` kinds, so it is ignored. `resolveCrew:3210` also uses `"info"`.
- Path: a plan is done. A member is found to be a minor afterwards (`dropMember` skips `done` stages). Their earlier "again" answer stays in `o.post`. A later answer by another attendee makes the crew and sends a crew offer ("the same people") to the minor. A block made after the plan is also not checked.
- Rule broken: decision 11 "plans copy never reaches minors". The judge may not see it, because the opportunity is already `done`. Traced by reading, not run.
- Fix: send as a kind in `ABOUT_OTHERS`, or make `recipientOk` check `about` whenever it is not empty. Filter minors in `crewCheck`.

### Bug 5 (medium): an open urgent report does not stop crew plans
- `reportHeld` is in `eligible:4360`, but not in `planSeatOk:2890` or `approvalCheck:1987`. `fileReport` says the member is "out of matching until staff decide".
- Path: a crew session is built in `crewSessions:3227` with `planSeatOk`. The reported member stays in `members`, and `planProbe:2969` uses `planSeatOk`. They get a new plan probe while the report is open. A reviewer sees it first. The review queue does not flag it.
- The planner path has a second filter through `safetyHolds`. I did not trace how the world uses it. The crew path has no such filter in `crewSessionPlan`.
- Fix: add `reportHeld` to `planSeatOk` and `approvalCheck`.

### Bug 6 (low to medium): two pending candidates for one manager share one `awaiting`
- `busy:4372` lets a manager have many seat items at once. The `probe` hook sets `m.awaiting` directly at `4055`, not through `expect`, so a second probe overwrites the first.
- Result: a yes that the manager meant for the first candidate applies to the second, because the reply binds to the newest item. The first expires after 26 hours. Consent can bind to the wrong person, and the manager then gets that candidate's name.
- Fix: one pending manager review at a time (defer the next), or name the candidate in the question and parse it.

### Bug 7 (low): the LLM can raise an unknown age to adult
- `extract.ts:11` says an LLM age "can only make the member younger". `withUnderstanding:653` accepts `u.selfAge` whenever the rules found no age. With no record age, `handleInbound:713` then clears `m.minor`.
- A stated age is enough for the founder, so the impact is small. The risk is an LLM reading of a text with no first-person age. Fix: accept `selfAge` only when `isMinor(selfAge)`.

### Bug 8 (low): a relayed number stays in the stored state
- `send:3951` keeps the text in `m.lastSent.body`, and that goes to `network_state` through `exportState`. A deferred share also keeps the body and `relayContact` (`3888`). `relay.ts:261` says a swap "keeps no number". The thread and the log are clean; these two fields are not.
- Fix: do not store the body of a `relay` send, keep a hash for the duplicate check.

### Notes, not defects
- Deferred sends live on after STOP. A STOP then START inside the deferral window lets the old send go. The send-time check is correct at that moment.
- `relay.ts:357` runs the release check with the old time, so the consent TTL is judged at `h.at`. This matters only when a held photo is released late. Photos need separate approval today.
- `relayDispatchCheck` reads `st.blocks` only, not snapshot `blocked` edges. `runtime.ts` `relayPairAdmission` runs next to it: confirm in the network-service report that it covers cross-app blocks.
- `close` updates a request only when its outcome is `probing`, so a request stays `booked` after a cancelled meeting. A new ask opens a new request, so nothing is lost.

## 4. Runtime guards

| Proved predicate | Replaces or backs | Exercised by |
|---|---|---|
| `recipientOk` | `checkRecipient:4215` | `harness/scenarios.ts` `minor_signal`, `stated_minor_first_message`; `bun run sim --only safety`; `packages/network/test/service-safety.test.ts` |
| `afterReview` | `reviewBlock`, `decide` | `bun run sim --only network` (`requireReview` judge). New integration case for bug 3. |
| `afterSla` | `advance:3345` | Same. |
| `probeAnswerOf` | `parseProbeReply` tail, `mergeConsent` | `packages/network/test/fixtures`; `--paraphrase` arm of `experiment.ts`. New corpus rows for bug 1. |
| `allAvailable`, `mayProbe` | `maybeReveal`, `advanceProbes` | `request_fulfilled` scenario; `packages/network/test/peon-seats.integration.test.ts` |
| `minorAfter`, `mustDecline` | `handleInbound:688-729` | `under_13_join`, `stated_minor_first_message`, `minor_signal` |
| `relayDispatchOk` | `relayDispatchCheck` | `shared-relay.integration.test.ts`, `bun run sim --only relay` |
| `swapPlan` | `RelayDesk.swap` | `relay.test.ts`. New case for bug 2: a recipient at the streak limit. |
| `recent`, `mayPush` | `overBudget`, `unsolicitedRefusal`, service person cap | `service-apps.test.ts` (cap across apps), `planChecks` in `experiment.ts` |
| `nextLevel`, `reportPoints` | `Trust.relevel`, `Trust.report` | `corroborated_report`, `block_abuse`, `spam_wave` |

Keep the runtime checks. A proof covers the core. The fill step (reading `Map`s, `syncRecord`) and the regex inputs stay trusted. The judge's invariants in `bun run sim` remain the end-to-end witness for those parts.

Note on repo rules: `transitions.ts` is a refactor, and the rules reject preference refactors. It needs maintainer scope confirmation, or it should land together with the bug fixes above as the fix. New tests must be integration, e2e, sim gate or corpus rows, not unit tests.

## 5. What not to verify, and why

- `classify.ts` regexes (`consentOf` body, `agesStated`, `extractProfile`, `availabilityTags`): no regex in the fragment, and the risk is in the phrasing. The corpora in `test/fixtures` and the paraphrase arm are the right tool.
- `send` as a whole: order of checks with hook closures, mutation and I/O. Prove its parts. Do not model the order in a shadow.
- `tick`, `advance`, `dailyRun`: scheduling over real `await` and whole-state iteration. A temporal property ("no probe before approval on every trace") needs a model checker, so it is out of LS scope. The same statement over the extracted step functions is what LS gives. This branch name suggests Quint is under study, and Quint would suit the trace properties.
- `forget`: the claim is "no field keeps the id", which is a schema-wide fact. A test that walks `exportState` for the id is cheaper and stronger.
- `store.ts`: locks and SQL. The value is in concurrency, which LS cannot state.
- `geo.ts`, `plans.ts` tables, `copy.ts`, `jobs.ts` parsing: no invariant, floats or text only.
- `reports.ts`, `withdrawsSwap`, `swapAsk`: regex. `swapAsk` matters for safety, but its check is on text.
- `harness/*`: reads hidden truth, not shipped.
