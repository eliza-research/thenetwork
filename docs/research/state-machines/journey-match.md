# State machines: the journey from match to meeting

Scope: the daily engine run, human review, proposal expiry past SLA, consent probes on both sides, accept, counter, decline, pause, intro, group proposals, backfills and alternates, booking, feedback, repeat plans, member-initiated requests.
Branch: `claude/quint-state-machines` (a0ed7bc). This is research only. Nothing was fixed. No repository file changed except this report.

This report follows the member, not a package. The per-package reports hold the machine definitions. This report holds what happens where the machines meet. It does not repeat them. It links to them.

File shorthand:

| Short | File |
|---|---|
| `N` | `packages/network/src/network.ts` |
| `C` | `packages/network/src/classify.ts` |
| `RT` | `packages/network/service/runtime.ts` |
| `SV` | `packages/network/service/service.ts` |
| `P` | `packages/network/service/packs.ts` |
| `E` | `packages/engine/src/plans.ts` |
| `W` | `packages/engine/src/world.ts` |
| `OQ` | `packages/blooio/src/outbound-queue.ts` |

Sibling reports: `core` is `network-consent-core.md` (its D1 to D29 are written `core-D1`). `sweep` is `implicit-sweep.md`. `out` is `network-service-outbound.md`.

## 0. Method

- I read the docs first: PRD 7.2, 22.3, 28, 29, 32.8 to 32.13 in `docs/prd-snapshot.md`, `docs/mvp-plan.md`, `docs/network.md`, `docs/design/eliza-conversation-layer.md` (the first part).
- I read `N` in full for the journey paths (inbound routing, requests, review, probes, plans, tick, engine run, send path, hooks). I read `P` and `RT` in full, `E` from line 520 to the end, and the routing and review parts of `SV`.
- "Reproduced" means that I ran the scenario on the real `ConsentNetwork` with `packages/network/test/mini.ts`, in memory, with a sim clock, from a script in the session scratchpad. No model, no Postgres, no external service. The script names are in section 7.
- "Read" means that I traced the code and did not run it.
- Mini's `review: "auto"` stands in for a person. Every scenario still passes through `submit` and `decide`.

## 1. Machine index

These are the composite machines that exist only across packages. The single machines (`opportunity-lifecycle`, `opp-participant-status`, `review-item`, `plan-run`, `booked-attendance`, `member-request`, `awaiting-slot`) are defined in `network-consent-core.md`.

| # | id | Kind | Where the state lives | Priority |
|---|---|---|---|---|
| 1 | `match-to-meeting` | implicit, composite | `Opp.stage`, `Opp.status`, `Opp.review`, `MemberState.awaiting` | P0 |
| 2 | `reply-router` | implicit | `route()` in `SV`, `platform.member_apps.last_item`, `MemberState.awaiting`, `handleInbound` order | P0 |
| 3 | `yes-hold` | implicit | `Opp.status = available` with `awaiting` empty | P0 |
| 4 | `participation-vs-open-items` | implicit | `network.members.participation_*`, `MemberState.state`, open `Opp` rows | P1 |
| 5 | `cross-app-block-vs-booked` | implicit | `platform.person_blocks`, snapshot edges, `Opp.stage = scheduled` | P0 |
| 6 | `booked-change-window` | implicit | `awaiting.kind = booked`, `C` cancel regex, `meetingAt`, `meetingAt + 3h` | P1 |
| 7 | `probe-belief` | implicit | `Opp.contacted`, `Opp.sentAt`, `pendingAsks` versus `platform.outbound.status` | P0 |
| 8 | `engine-billing` | implicit | `recentProposals`, `unsentProposalIds`, `activePairs`, `recentProactive` | P1 |
| 9 | `tick-poison-window` | implicit | `lastRunDay`, store save, the 09:00 to 20:00 run window | P1 |
| 10 | `repeat-encounter` | implicit | `again`, `planAgain`, `crewOffers`, `allowedCategories` | P1 |
| 11 | `standing-request-loop` | implicit | `Request.outcome`, `tries`, `lastTry`, `toldNone`, `matchingEnabled` | P1 |
| 12 | `group-quorum-to-pair` | implicit | `Opp.participants`, `status`, `declinedTimes`, `handleDrop.keep`, plan fallback | P0 |

## 2. Suspected defects, ranked

Each entry has a trigger, the evidence and a confidence. The defects in `core`, `out` and `sweep` are not repeated. Section 2.4 lists how they appear in the journeys.

### 2.1 P0: consent, privacy, safety

**M1. A member cannot take back a yes before the reveal. The name still goes out.** (`yes-hold`)
- PRD 28.3: "independent double opt-in". F11 and F29 want an easy no. Decision 8 in `CLAUDE.md`: consent comes first.
- `N:2300` sets `available`. `N:772` already cleared `awaiting`. So the next message has no slot.
- `N:799` handles `cancel` only for `stage == scheduled`. No other branch reads `available`. `onProbeAnswer` needs `awaiting` and `status == probing` (`N:2292`).
- The window is long: the partner has `PROBE_WAIT` (2 days) to get a probe, then 26 hours to answer.
- Trigger (reproduced, `s1.ts`): first member "yes". Then "actually no, sorry", or "I need to cancel". The Network sends nothing and changes nothing. The partner says yes. Both get the booked plan. The first member's name reaches the partner.
- The plan lane has the same hole: a yes to a plan waits for quorum. `busy()` even lets this member into other items (`N:4376`).
- Confidence: high. Severity: high.

**M2. A "no" after a silent time retry is swallowed, and the plan books.** (`yes-hold`, `reply-router`)
- `N:3378`: a member in `timeRetry` who stays silent goes back to `available`. `awaiting` stays `probe` (core-D10 notes the stale slot, not this effect).
- `N:772` clears the slot. Then `N:2292` returns, because `status` is not `probing`. So a clear "no" is dropped with no reply.
- Trigger (reproduced, `s1.ts` s4): "neither of those"; silence for 26 hours; "no thanks"; the partner says yes. `stage: scheduled`. The member got "You're both in: meet Ben I.".
- The member said no in the thread, and the Network revealed them anyway.
- Confidence: high. Severity: high.

**M3. A feedback answer is read as a yes to a new probe.** (`reply-router`)
- `N:4055` overwrites `awaiting: feedback` with no `expect()`. core-D5 lists the overwrite for `booked` and `probe`, and does not list this path.
- `expect()` protects a probe from later feedback, but nothing protects feedback from a later probe.
- A member is eligible if they sent anything after the reminder (`outbound <= 1`, `N:4363`). So the probe can arrive one day after the date, before they answer "How did it go?".
- Reproduced (`s2.ts` fb), with a probe for a new item open:

| Answer to "How did it go with Ben?" | Result |
|---|---|
| "Great time, thanks!" | Yes to the new probe. Feedback lost. |
| "Yes it was great" | Yes to the new probe. Feedback lost. |
| "no it was awful" | No to the new probe, which closes. Feedback lost. No `avoid` edge. |
| "It was great" | Feedback, correct. Falls through at `N:806`. |
| "Loved it" | Nothing is recorded. |

- `outboundBefore >= 2` at `N:771` covers only a bare ack.
- A bad date lost this way also loses the `avoid` edge and, on slop, the post-date report text path. A safety answer can go missing.
- Confidence: high. Severity: high.

**M4. A block made on another app does not end a booked meeting.** (`cross-app-block-vs-booked`)
- PRD F23: "Block takes effect immediately". `RT:511` writes `platform.person_blocks`. `snapshot.ts:98` reads it into `blocked` edges of the other apps.
- Only `applyBlock` (`N:1429-1442`) closes a shared opportunity. That is the app where the member typed the block. `syncMember`, `advance` and `checkSeats` do not look at blocks.
- Trigger (reproduced, `s2.ts` crossBlock, edge injected in the snapshot): a pair is `scheduled` on app X, the block is made on app Y. The item stays `scheduled`, then `done`. Reminders and feedback are refused (`blocked_pair`), and no member is told. Both think the date is on.
- The relay is safe (`RT:276-280`). The meeting is not called off.
- Confidence: high for one network. Severity: high once two apps match.

**M5. On the shared line a consent reply goes to the newest open item of one app.** (`reply-router`)
- `SV:974-976` sorts by `last_item`. Migration 0007 line 225 takes the newest outbound row with an `opportunity_id` after the last inbound in that app.
- Probes are anonymous. The member cannot say which one they answer.
- Trigger (read): a slop date probe at 12:00, a friends probe at 12:05, both in budget (the person cap is 3 a day). The member answers the first with "yes". The yes lands on friends. The slop probe waits. A second "yes" answers it, if one comes.
- "can't make it" about a booked date on app X, with a newer probe on app Y, is read as a no to the probe on Y. The date stays on.
- `RT:432` writes `oppId: meta.proposalId ?? meta.probe?.key`. A plan probe carries `meta.plan.planId`, so its row has no `opportunity_id` and is not an open item at all (`N:2992-2995`).
- Confidence: high for the code path. Latent until a second app matches (AGENTS decision 4).

**M6. A booked group can shrink to a pair with no new consent.** (`group-quorum-to-pair`)
- Engine contract (`E:600-606`, `E:612-616`): "a group plan's two yes-sayers, or a booking that shrank to two" become a partner plan. "Never book the pair directly".
- `N:2514`: `keep = o.participants.length > 2 && still.length >= 2`. Two left is enough.
- Trigger (reproduced, `s2.ts` group): a group of 3 is booked. One says "can't make it". The other two hear "The rest of you are still on." They are now a two-person meeting that neither agreed to.
- core-D2 covers the fallback before booking. This is the same rule after booking, for engine groups and plans.
- Confidence: high. Severity: medium to high.

**M7. A member who pauses after a yes is still revealed.** (`participation-vs-open-items`)
- `syncRecord` copies `state` (`N:4416`). It returns true only for a minor or an account status (`N:4426`), so `syncMember` does not drop a paused member.
- `checkRecipient` does not read `state` for a reveal. PRD 7.2: paused means no outreach. F28 keeps messages "inside an accepted opportunity" on, so a date already booked is fine. A date not yet booked is a new commitment.
- Trigger (reproduced, `s2.ts` pausedYes): yes, then `state = paused`, then the partner says yes. `scheduled`. Both got the booked plan.
- Only the partner's own "yes" made the meeting. The paused member said yes before they paused and has no way back (M1).
- Confidence: high. Severity: medium.

**M8. A probe the queue refused or held still counts as a contact.** (`probe-belief`)
- `sweep` D3 shows this for the reveal. The probe path is worse, because it feeds the pause rules.
- `onSent` sets `contacted`, `sentAt`, `asked`, and the send path sets `proactive` and `pendingAsks` (`N:3938`, `N:4053-4058`). In production this means "written to the queue".
- The row can end `refused_person_cap` (`OQ:424`), wait in `held_awaiting_reply` (`OQ:401`), or expire after 24 hours. No code in `packages/network/src` reads that status.
- Effects on a member who never saw the text: the probe "expires" at 26 hours (`N:3376`), and `probeExpired` and `m.asked` grow, so `responsiveness()` falls. After 72 hours it counts as unanswered (`N:3325`). Two of these move the member to "only when I ask" (`N:3326`). That breaks PRD F28: "two consecutive unanswered proactive messages".
- The budget is spent too (`m.proactive`).
- Confidence: high (read). Severity: medium.

### 2.2 P1: liveness and data integrity

**M9. "Can't make it" after the start deletes a no-show.** (`booked-change-window`)
- `N:799-801` has no time check. `stage` stays `scheduled` until `meetingAt + 3h` (`N:3405`).
- Trigger (reproduced, `s1.ts` s3): at T+1h Ana says "sorry can't make it". The item closes. Ben, who may be waiting at the venue, gets "this one is off now". No feedback goes out. The ledger gets `plan_cancelled:a`, which is free with notice (`N:2507-2508`). `drop_notice.valid` would stop this text if deferred (`N:4105`), but a first send does not read `valid`.
- A late flake becomes a free cancel, so it does not reach `noShows`. PRD 15.2 needs attendance.
- Confidence: high.

**M10. Cancel and reschedule work only inside a narrow slot.** (`booked-change-window`)
- The booked text says "Reply if your plans change." (`copy.ts:79`, `copy.ts:144`; `docs/network.md` 4.2 quotes an older text). That invites a change. After "ok" (`N:785`) or after 48 hours the slot is gone.
- `C:69` cancel needs one of five phrases. Reproduced (`s2.ts` resched):

| Message after "ok" | Result |
|---|---|
| "no actually I can't" | `open`. The plan stays on. |
| "not going anymore" | `open`. The plan stays on. |
| "can we do next week instead?" (slot still set) | `open`. The plan stays on. The slot stays set. |

- `open` hands the turn to the Eliza model. No signed action can cancel or move a booking (the contract has `set-state`, `signals`, `updates`, `relay`).
- PRD 28.3 and F17, F18 put reschedule, replacement and running-late in the MVP. PRD 32.10 lists `RESCHEDULE_REQUESTED` and `NEEDS_REPLACEMENT`. Neither has code (`reschedule` appears only in `C`, as a parser word).
- Confidence: high. Severity: high for a real pilot, because the member then counts as a no-show.

**M11. Repeat plans die at `submit` on slop and peon. The plans buddy dies on slop, peon and friends.** (`repeat-encounter`)
- `N:3818` makes a `social` item. `N:1812` makes an `events` item. `submit` closes anything outside `allowedCategories` (`N:2050`). slop allows only `romance`, peon only `professional`, friends `social` and `hobby`.
- `N:3816` deletes the `again` entry first, so the mutual wish is lost.
- Reproduced (`s2.ts` slop): both say they would meet again. Next day: `second_encounter`, `closedReason: "category not allowed"`, `again` empty.
- Reproduced (`s2.ts` friends): the offer "Want me to see if anyone else is up" goes out. The item closes at once. Both requests keep `oppId`, so `!r.oppId` at `N:1808` stops them from matching anyone else.
- On slop the pair also fails the engine's `pair_history` for 60 days (`N:3607`), so no path proposes a second date. The relay stays open, but "second-date rate" (mvp-plan weekly gate) has no Network path.
- Confidence: high.

**M12. One throw in the engine run freezes all tick work until 20:00 New York.** (`tick-poison-window`)
- `N:3279` and `N:3269-3277` run in memory. Then `N:3293` awaits the engine. A throw means no save (`store.ts stored()`), and the unit's sends are dropped at the next `load`. `serve.ts:131` logs and goes on. The next tick does the same.
- core 3.26 calls the retry the wanted behavior. It does not count the cost.
- Reproduced (`s2.ts` freeze, `onEngineRun` throws, SLA 2 hours): ticks at 14:00 to 19:00 throw. The stored stage stays `review` past the deadline, and `lastTick` does not move. The 20:00 tick saves, because the run window has ended. That day's engine run, `retryRequests`, `trust.decay` and `localEncounters` are skipped.
- While frozen: no review expiry, no probes, no deferred sends, no reminders (a 19:00 date loses its reminder), no feedback. Inbound still saves. An overdue item can be approved (core-D11), so a freeze widens that window.
- Confidence: high for the mechanism. Reach depends on a throw from `runEngine`, a pack hook or `onEngineRun`.

**M13. Proposals nobody received count against the engine's budgets.** (`engine-billing`)
- `W:171`: `input.unsentProposalIds` exists so that unsent proposals "do not count against budgets and do not block the pair". `grep` finds no writer in `packages/network`.
- `N:3712` passes every opportunity of the last 30 days, also rejected, expired and invalidated ones. `SLOP_ENGINE_CONFIG` has `billOnlySent: true`, which does nothing without the ids.
- `W:235` adds it to `recentProactive`. `rules.ts:25` fails `interruption_budget` at the limit. `W:179` adds an `active_duplicate` for 7 days, because `close()` writes no interaction for a review close (`N:2559`), so the id is never "resolved". `peon/rules.ts:52` treats it as `already_introduced`.
- Trigger (read): a weekend with no reviewer. Two items per member expire. Those members are out of the engine for the period, and the pairs are blocked for 7 days. Nobody was contacted.
- A missed SLA is staff's failure, and the member pays for it. Confidence: high (read). I did not measure the size.

**M14. A yes-sayer whose partner says no hears nothing.** (`yes-hold`)
- PRD F29: "Partial acceptances are released politely". `close()` tells only when `!wasProbing` (`N:2540`), and for the first member the status is `available`, not `yes`.
- Reproduced (`s4.ts`): the first says yes, the partner says no, no alternates. In 10 days the first member got no message. The pending "Great, thanks." ack is dropped after 24 hours.
- A requester gets `tellNoneYet`. Plans get a `note`. Engine intros get nothing.
- Confidence: high.

**M15. One "neither" closes a whole group, but a "no" does not.** (`group-quorum-to-pair`)
- `N:2303` adds every offered time to `declinedTimes`. So `commonPicks` is empty, and `N:2313` closes the item.
- Reproduced (`s3.ts`): group of 4, two yes. One "no thanks": the item goes on with 3. One "neither of those": `closedReason: "no common time"`, and the two yes-sayers hear nothing (M14).
- `docs/network.md` 4.1: "A group of 3 or more continues without them". Confidence: high.

**M16. A request stays `booked` for good when nobody answers the check-in.** (`standing-request-loop`)
- core-D12 covers a cancelled meeting. This is the other exit. `finalize` sets `fulfilled` only when two are `present` (`N:2776`).
- Reproduced (`s2.ts` stuckBooked): a meeting done, finalized, no answers, 14 days later `outcome: "booked"`. No later state exists.
- Confidence: high. Severity: low to medium (metric `requestsFulfilled`, console).

**M17. A repeat ask gets no answer at all.** (`standing-request-loop`)
- `N:1589`: a prior request younger than the re-search interval. `tellNoneYet` returns at once when `toldNone` (`N:1644`). `openRequest` returns, so the turn is `handled` with no reply and no model call.
- Reproduced (`s2.ts` repeat): the second "anyone around...?" two hours later gets `handled`, with no text. The gateway then sends nothing.
- Confidence: high.

**M18. A request told "I'll keep your request open" dies after 7 days while matching is off.** (`standing-request-loop`)
- `N:1695`: `now - r.at > 7 * DAY` skips it. Nothing tells the member. Copy at `copy.ts:96`.
- Reproduced (`s2.ts` waiting): matching off, ask, matching on at day 8. `tries` stays empty, queue empty, no text. slop starts with matching off, so a pre-launch ask lands here.
- Confidence: high.

**M19. A plan yes-sayer can be double-booked by an intro.** (`match-to-meeting`)
- A plan `available` member is not busy (`N:4376`), so they can get an intro probe and pick Thursday 7pm. `evidence()` counts only `scheduled` items as away (`N:2285`). The plan books Thursday 7pm. `bookPlan` looks at `bookedNear` only over `scheduled` items, and the intro is `probing`. Then the partner says yes and `reveal` has no `bookedNear` check (`N:2411-2459`). `planJoin` has it (`N:3097`).
- Read. Confidence: medium-high. Severity: low to medium.

**M20. F15 has no entry point.** (`match-to-meeting`)
- PRD 29.1 marks F15 (member-initiated intro) as MVP. `classify("introduce me to Sam Lee")`, `"you would really like my friend Theo"` and `"can you intro me to Theo?"` all return `other` (reproduced, `c.ts`). The turn goes `open`. `findByName` serves only blocks and reports.
- Member requests by want (F8, F9) work. A request for a named member does not.
- Confidence: high.

### 2.3 P2: small

- **M21.** A late joiner learns the names, and the people already booked never learn theirs (`N:3095-3100`). The reminder is `about` them, so checks run, but `planReveal` goes only to the joiner. Read.
- **M22.** A plan yes-sayer left out at booking (`plan_conflict`, `N:3046`, or a failed check, `N:3056`) gets no note. They were told "I'll tell you once enough people are in" (`N:2347`). A note also lapses after 7 days with no message (`N:3903`). Read.
- **M23.** A group or plan is all or nothing at approval. `approvalCheck` fails the whole item on one member `busy`, `on_watch` or `opted_out` (`N:1988-1997`), although alternates exist. Read.
- **M24.** A reviewer's reject marks all pairs as declined (`N:1930`). For a plan of 6 that is 15 pairs for 60 days, for a reason like "wrong timing". A reroll with no `swapOut` on a group does the same (`N:2023`). `docs/network.md` says so; the cost is that the planner's rejected groups block intros. Read.
- **M25.** A retried request that is rejected or expires tells the requester "That one didn't come together this time." (`N:2554`), when they never heard about it. Documented in 5.1, but the text has no antecedent. Read.
- **M26.** `o.reminded.add(id)` runs before the send (`N:3402`), and `feedbackSent` is set before the sends (`N:3406`). A refused send (streak) is not tried again. A silent `timeRetry` member reaches `outbound == 3` at feedback. Read.
- **M27.** `requestRetryFound` waits for the send slot (`kind: info`), and the time question waits only for quiet hours. So "Good news" can arrive after the question. Read.
- **M28.** F28: "the next time they message the agent it says so and offers to resume". `heardFrom` resumes silently (`N:641`), and logs only. Links to core-D15.
- **M29.** `submitProposal` has no caller in `packages/network/service`. `docs/network.md` 2 lists "intros that staff compose in the Observatory". That origin does not exist in production. Also, while matching is off `dailyRun` does not run, so the queue would not drain.
- **M30.** A `slot` for a job intro: `reveal` computes a `meetingAt` for a job seat. The check-in time comes from a time nobody agreed to. By design, but `relayMatchOf` then reports `metAt`. Read.

### 2.4 Sibling defects seen on the journeys

| Journey step | Sibling defect | Effect |
|---|---|---|
| Counter on a probe | core-D1 | "next week instead?", "can we reschedule?" read as yes (confirmed again, `c.ts`) |
| Plan falls to two | core-D2 | Pair booked with names |
| Approve past SLA | core-D11, out-D6 | Probe after the deadline |
| Slot overwritten | core-D5, core-D10 | Lost or stale answer path (M2, M3 are new effects) |
| Decline recorded as expired | core-D13 | `declinedBy: []` (reproduced again, `s4.ts`) |
| Requester in `booked` after cancel | core-D12 | Extended by M16 |
| Silence confirms an undelivered reveal | sweep-D3 | Extended by M8 |
| No pair history on second encounter and buddy | core-D16 | A human is the only guard |
| Late no-show counted twice | core-D24 | Same area as M9 |

### 2.5 Checked, and not a defect

- Pair-level alternates on slop: the slop generators set no alternates, so a romance pair cannot get an alternate who skips `romanceGate`. Only requests and groups carry alternates. Friends groups do.
- A review reroll of an engine item runs `approvalCheck`, which runs `gateReason` and `romanceGate` at approve.
- Alternates are visible to the reviewer (`web/review.tsx:347`, `GET /review` carries `proposal.alternates`). So a backfill is a person the reviewer saw. A replacement after approval is not reviewed again (founder rule: "every proposal"). This is a reading of the rule, not a clear break. Ask the founder.
- A forget during a booked plan: `dropMember` runs first, so the other member is told, then the row goes (`N:917`).
- Two reviewers at once: the second gets `not_in_review`.
- A late probe answer after expiry: `awaiting` is cleared (`N:3381`), so nothing books.

## 3. PRD state names and the code

PRD 32.10 calls itself canonical. The code has five stages. This table is the map for the model.

| PRD state | Code |
|---|---|
| DRAFT, PROPOSED | `newOpp`, one synchronous step |
| IN_REVIEW | `stage = review` |
| APPROVED | no state; `begin` runs in the same step |
| PROBING | `stage = probing`, anyone `probing` or `queued` |
| INVITING | none; the reveal replaced it (attention v1.2) |
| PARTIALLY_ACCEPTED | `stage = probing`, someone `available` (`yes-hold`) |
| QUORUM_MET, MUTUALLY_ACCEPTED | none; the reveal is one step with booking |
| SCHEDULING | none |
| SCHEDULED | `stage = scheduled` |
| RESCHEDULE_REQUESTED | **missing** (M10) |
| NEEDS_REPLACEMENT | **missing** (`handleDrop` closes or keeps; F18) |
| IN_PROGRESS | none; `scheduled` until `meetingAt + 3h` (M9) |
| COMPLETED | `stage = done` |
| FEEDBACK_COLLECTED | `finalized` |
| REJECTED_IN_REVIEW, EXPIRED_IN_REVIEW | `closed`, `review.decision` |
| DECLINED, EXPIRED | `closed`, not told apart (core-D13) |
| QUORUM_FAILED | `closed`, `planRun.stage = closed` |
| CANCELLED | `closed`, `closedFrom = scheduled` |
| SAFETY_HOLD | none on the item; the member drops out |
| DISPUTED, ABANDONED | none |

PRD participation states `expired`, `confirmed`, `attended`, `cancelled_with_notice`, `no_show`, `replaced` have no `PStatus`. They are spread over `confirmed`, `post`, ledger events, and the member's removal from `participants`.

PRD 32.10 also asks for a transition table in code, and a rejected-transition alert. There is none. It asks for a database constraint against duplicate active opportunities. `network-state.sql` has none, and `opportunities` is a read-only mirror.

Numbers that differ from the PRD: invite expiry 48 hours (F11, F29) against `PROBE_TTL` 26 hours. Reminders T-24h and T-3h (32.12) against one at T-4h. Explicit yes from everyone (F17) against the 48-hour silence rule (attention v1.2, founder). Peon review alert 24 hours against 12 (out-D30). Slop alert 6 hours against expiry 12.

## 4. The journeys

Legend for the state columns: **Opp** is `stage`. **A**, **B** are `status`. **aw** is `awaiting.kind`. **Rev** is `review.decision`. Crossed: `rev` review item, `opp`, `part` participant status, `aw` slot, `out` outreach, `send` send pipeline, `q` outbound queue, `ledger`, `req` request.

### J1. Daily engine run to the review queue

Trigger: the tick, first after `runHour` (9) and before 20:00 New York (`N:3289`). Actor: clock. In production matching starts off (`RT:152`), and `RT:361` forces it off when `platform.networks` does.

| # | Step | Line | State after |
|---|---|---|---|
| 1 | `syncMember` for all | N:3267 | members re-read; a minor or held account drops out |
| 2 | Deferred sends run | N:3269 | each goes through `send` again |
| 3 | `advance` for all items | N:3279 | expiries, reminders, feedback |
| 4 | `lastRunDay = today` | N:3290 | only in memory until save |
| 5 | `trust.decay`, `retryRequests` | N:3291-3293 | requests back to `probing` |
| 6 | `packInput`, `runEngine` | N:3442-3444 | **throw here: M12** |
| 7 | `seatRoute`, cap, `gateReason` | N:3458-3465 | gated: logged only |
| 8 | `fromProposal`, `submit` | N:3662, N:2047 | Opp `review`, members `queued`, so they are `busy` |
| 9 | `sendAsks` | N:3490 | one ask per member |
| 10 | `localEncounters`, `reengage`, fraud | N:3294-3296 | M11 |
| 11 | Plans: Monday and Thursday | N:3299 | one review item per plan |
| 12 | Save; `RT:writeUnit`; deliver | store.ts, RT:454 | one transaction |

Crash: before step 12 all is lost, and the next tick repeats it. That is safe for state. It is not safe for liveness (M12).

Machines: `engine-billing` reads every item of the last 30 days at step 6 (M13). `busy()` at step 8 ties review to admission: a member in a queued item waits up to 12 hours, and cannot get another item.

Invariant: step 8 is the only way in for engine output. Every path passes `submit`. `noContactBeforeApproval` holds. Verified: `probe`, `reveal`, `planProbe` are reached only from `begin` or `beginPlan`, and `begin` has one caller chain from `decide`.

### J2. Human review

Actor: staff, `POST /review/:oppId` (`SV:2372`), one unit under the lock with a two-phase audit (`SV:1520`).

| Decision | Guards in order | Opp | Rev | Members |
|---|---|---|---|---|
| approve | `reviewBlock`, then `approvalCheck` | `probing` | approve | first gets a probe or a deferral |
| approve, check fails | | `closed` | approve + `invalidated` | nobody; `ok:false` |
| edit | also `editBlock` | as approve | approve + `edits` | edited text reaches only the requester's confirm |
| reject | | `closed` | reject | nobody; `markDeclined` (M24) |
| reroll, alternate | `cannot_swap` | `review` | none; new deadline | nobody |
| reroll, none | | `closed` | none | nobody; pairs marked |

Gaps: no check of `now >= deadline` (core-D11). `approvalCheck` is all or nothing for groups (M23). Reroll can extend an item with no limit, since `queuedAt` stays and nothing counts rerolls.

Reviewer identity: `reviewerOfRecord` takes `X-Network-Staff-Id` only from the console's token (`SV:2536`). `docs/network.md` section 11 still says the service does not read it. That line is stale.

### J3. Proposal expiry past SLA

| # | Step | Actor | Opp | Rev | Request | Engine view |
|---|---|---|---|---|---|---|
| 1 | Item waits | | `review` | none | `probing` | counted (M13) |
| 2 | `now >= deadline`, next tick | clock | `closed` | expired | request: `none` | counted, active pair 7 days |
| 3a | Non-retry request | | | | `tellNoneYet` once | |
| 3b | Retried request | | | | `declinedQuiet` once (M25) | |
| 3c | Plan | | | | none | `lastPlannedAt` stays set |
| 4 | Next day | clock | | | `retryRequests` tries again | same candidate, as no `declined` is set |

Loop: a request can re-queue the same pair each day for 7 days and expire each time. It stops at 7 days. This is a bounded loop.

Stick: during a tick freeze (M12) step 2 does not save. `advance` is the only expiry path. So an item can stay in `review` for 6 hours or more past its deadline.

Liveness wanted: every `review` item leaves within SLA plus one successful tick. The word "successful" is the gap.

### J4. Intro, the happy path

Two members, engine origin, A first.

| # | Step | Actor | Opp | A | B | aw(A) | aw(B) | Other |
|---|---|---|---|---|---|---|---|---|
| 1 | Submit | clock | review | queued | queued | | | `review_queued` |
| 2 | Approve | staff | probing | queued | queued | | | `probe_started` |
| 3 | Turn starts | | probing | probing | queued | | | `turnAt` |
| 4 | Window closed | | probing | probing | queued | | | `send_deferred`, retried each tick |
| 5 | Probe out | clock | probing | probing | queued | probe | | `contacted`, `sentAt`, `proactive`, `pendingAsks`; row `proactive` |
| 6 | "Thursday" | A | probing | available | queued | | | `picks`, `declinedTimes`, ack waits |
| 7 | B's turn, same step | | probing | available | probing | | | B gets only A's picks |
| 8 | B's probe out | clock | probing | available | probing | | probe | M8 |
| 9 | "yes" | B | scheduled | yes | yes | booked | booked | `reveal`; `bookedTold`, `bookedAt`, `plan_accepted`; A's text may defer |
| 10 | "ok" or silence 48 h | A, clock | scheduled | yes | yes | | | `plan_confirmed` |
| 11 | Reminder | clock | scheduled | yes | yes | | | one at about T-4h |
| 12 | T+3h | clock | done | yes | yes | feedback | feedback | check-in text |
| 13 | Answer | A | done | yes | yes | | feedback | `post`, `feedback`, `again`, `avoid` |
| 14 | All answered or +4 days | clock | done | yes | yes | | | `finalize`, `plan_attended` |

Step 9 is the reveal. It crosses the service boundary: in a signed turn B's reply is collected, and A's text goes through the queue (`RT:421-424`). The gateway then owns B's delivery (`/internal/turn-receipt`).

In steps 6 to 9 A is in `yes-hold`. See section 5.

### J5. Time answers, neither, counter

| Reply | Parser | From | To | Next |
|---|---|---|---|---|
| "Thursday" | yes, keys | probing | available | as J4 |
| "yes" | yes, all open keys | probing | available | as J4 |
| "neither" | yes, no keys | probing | probing, `timeRetry` | other times once, or closes if none (M15) |
| second "neither" | yes, no keys | probing | available | best time from the other's picks |
| silence after retry | none | probing | available | keeps the yes (M2) |
| "next week instead?" | counter → yes | probing | as neither | **core-D1** |
| "maybe" | unclear | probing | probing | `clarify` once; then falls to `open` |
| counter to a plan probe | `yn = counter` | pending | pending | no clarify, no reply; expires as silence |

Journey loop check: `clarify` runs once (`aw.clarified`), and `timeRetry` runs once. No loop.

Stick: after a second unclear, the turn goes to the model. `sharedContext` passes `activeItems: null` (`RT:732`), so Eliza cannot see the open probe. The member thinks they are talking about it. The probe expires at 26 hours. The only guidance in the thread is "Reply STOP anytime to opt out."

### J6. Decline, expiry and alternates

| Trigger | Line | Requester out | Manager out | Alternate found | No alternate, 2 people | No alternate, group ≥ 3 left |
|---|---|---|---|---|---|---|
| "no" | N:2334 | close | close | swap, new probe | close | shrink |
| silence 26 h | N:3382 | close | close | swap | close | shrink |
| not sent in 2 days | N:3376 | close | close | swap | close | shrink |
| send refused | N:4065 | close | close | swap | close | shrink |
| STOP, hold, watch | N:2580 | close | close | swap | close | shrink |
| reveal check fails | N:2420 | close | close | swap | close | shrink |

`replaceOrClose` is the single exit, and it has at most 3 swaps. A member who answers `yes` keeps it across swaps, and the alternate gets only the picks left. Alternates pass `eligible`, name, block, avoid and pair history checks, again at swap time.

After the close: the yes-sayer hears nothing (M14). `markDeclined` is set only on a real no (`N:2328`). Expiry sets nothing, so the pair can return. `interactions` gets `expired` for a no as well (core-D13).

### J7. Pause, STOP and leave in the middle

| When | STOP | Set state paused | Account paused by staff | Hold or watch |
|---|---|---|---|---|
| review | closes | stays; engine item invalidated at approve; others stop at send | closes | closes |
| queued, not contacted | swap or close | budget refuses the send, then swap | swap or close | swap or close |
| probing, contacted | swap or close | **stays; can still answer** | swap or close | swap or close |
| available (yes-hold) | swap or close | **stays; reveal goes (M7)** | swap or close | swap or close |
| scheduled | drop notice | stays (F28 allows) | drop notice | drop notice |
| plan pending | `planOut` | refused at send, `planOut` | `planOut` | `planOut` |
| plan yes | `planOut`, seat freed | stays; booked | `planOut` | `planOut` |

The text path: no branch in `handleInbound` reads "pause". `classify("pause")` is `ack`, and `ACK_ONLY` does not match it, so the turn is `open`. In a live turn Eliza calls `SET_STATE` and the service writes `participation_window`. With no open turn path the word does nothing. The probe's pause path says only "Reply STOP anytime to opt out." So the mild option in the text is the strongest one: STOP ends every app.

`effectiveParticipation` maps `busy` and `traveling` to `quiet`. A window starts and ends on its own at the snapshot. So `state` can change with no event, and `syncRecord` emits `state_changed` keyed on `now`.

### J8. Group proposals

Engine group, 3 to 6 people, or event co-attendance. Plans are J9.

| # | Step | Opp | Status |
|---|---|---|---|
| 1 | Approve; every member must pass `approvalCheck` (M23) | probing | queued |
| 2 | First probed | probing | first probing |
| 3 | First says yes; all others probed at once | probing | available, rest probing |
| 4 | One no, group ≥ 3 left | probing | removed from `participants` |
| 5 | One "neither" | **closed** (M15) | |
| 6 | One alternate swap | probing | alternate queued, then probing at once |
| 7 | All `available` | scheduled | yes |
| 8 | One cancels, ≥ 2 left | scheduled | **may be a pair (M6)** |

Time handling is a set intersection over `picks`. `declinedTimes` is global, so each member narrows the set for all. A time common to all but one is lost. The result is many `no_common_time` closes in big groups.

The group path at `N:2392` does not call `advanceProbes`. From `onProbeAnswer` the caller does it. From `dropMember` the next tick does it. No stuck state, at most one tick late.

### J9. Plans: quorum, backfill, fallback, late join

ntwrk and friends only (`P:70`, `P:77`: `plans: false` for slop and peon).

| # | Step | Actor | Opp | planRun | Answers |
|---|---|---|---|---|---|
| 1 | Planner, Mon and Thu | clock | review | | |
| 2 | Approve | staff | probing | probing | invited pending |
| 3 | `planProbe`: seat, NYC, busy, window, one a day, allowance | clock | probing | probing | pending, `sentAt` |
| 4 | Yes | member | probing | probing | yes; status available |
| 5 | No | member | probing | probing | no; bench → backfill |
| 6 | Silence 26 h | clock | probing | probing | no (silent), backfill |
| 7 | Quorum | member | scheduled | booked | names go out |
| 8 | Late yes, before T-6h | member | scheduled | booked | join (M21) |
| 9 | Deadline with no quorum | clock | closed or scheduled | closed | fallback |
| 10 | T+3h | clock | done | booked | pending → unavailable |

Fallback outcomes: `smaller` with 3 or more books a group. `smaller` with 2 books the pair (core-D2). `solo_event` closes and sends one event text. `next_week` carries demand and leaves a note. `none` closes.

Stale data: `o.plan.invited` is set once (core-D8). `hostId` is not updated by a reroll: a reviewer can swap out the host, and `finalize` then finds no host in `going` (`N:2740`), so the plan has no organizer record. Read.

Conflicts: M19 from the plan side. A probe that waits as `busy` is deferred until the deadline, which is fine.

Reviewer view: the planner's reject has a large pair cost (M24).

### J10. Booking and what can change it

| Event | While | Result | Line |
|---|---|---|---|
| "can't make it" | any time before T+3h | drop; pair closes; group keeps | N:784, N:799 (M9) |
| "no" | `aw = booked` only | drop | N:784 |
| "no actually I can't" | after the slot | **nothing** | M10 |
| "next week instead?" | any | **nothing** | M10 |
| bare "CANCEL" | any | STOP, all apps | known, network.md 11 |
| block, same app | | close, neutral notice | N:1429 |
| block, other app | | **nothing; reminders refused** | M4 |
| STOP, hold | | `handleDrop` | N:2581 |
| report | | as block, then file | N:1429-1451 |
| forget | | drop, then row deleted | N:917-921 |
| becomes minor | | stays open if between adults; `minorAfterContact` | N:2575-2577 |
| time passes | | `done` at T+3h | N:3405 |

A member who cannot reach a change path becomes a no-show at finalize: the other reports them, and with no word they get `plan_ghosted` (`N:2762`). So M10 turns into a reliability mark on a member who tried to cancel.

Reveal timing: A told, B's text deferred to the morning. A can already use the relay, since `acceptedBy` reads status `yes`, not `bookedTold` (`N:4899`). B can get "From Ana" before the booked plan. Read. It is low risk, and it is a state mismatch between `bookedTold` and `relayMatchOf`.

### J11. Feedback and attendance

| # | Step | Line | State |
|---|---|---|---|
| 1 | T+3h: `done`, ask each `yes` | N:3405-3421 | `feedbackSent`, `expect(feedback)` |
| 2 | Slot taken by a probe | N:4055 | **M3** |
| 3 | Answer | N:806-814 | `post`, `feedbackFrom` |
| 4 | Slop: report words or no-show | N:2608-2616 | report, block, safety case |
| 5 | Good: growth ask, at most monthly | N:2643 | |
| 6 | No slot: `feedback_like` within 7 days | N:2587 | still works |
| 7 | All answered, or +4 days | N:3427 | `finalize` |
| 8 | Attendance | N:2733 | ledger events; `noShows` |
| 9 | Request | N:2776 | `fulfilled`, or stuck (M16) |

`finalize` does not retry and does not read later answers, but `onFeedback` still runs up to +7 days (core-D24). So a +5 day answer changes `again`, `avoid` and `noShows`, with no ledger event.

Silent pair: nothing emitted, `reliability` unchanged, request stuck. This is by design for the ledger ("Nothing known: nothing is sent").

### J12. Repeat plans

| Path | App | Works? |
|---|---|---|
| Both "would meet again" → second encounter | ntwrk, friends | Yes, through review. No check of blocks at composition (core-D16); `again` is consumed even if a member is not eligible that day |
| Same | slop, peon | **No (M11)** |
| Engine re-proposal | all | Blocked 60 days by `pair_history` |
| Relay | pairs | Thread stays open after the date (founder 2026-10-11) |
| Plan `planAgain` edges | ntwrk, friends | Fed to the engine and planner |
| Crew offer after one great plan | ntwrk, friends | `crewCheck`, opt-in, sessions through review |
| Crew session dedupe | | Broken (core-D17) |

One-sided `again` never expires. A says again in October. In June B answers on another meeting with A. The second encounter fires. Read. Low.

### J13. Member-initiated requests

| # | Step | Actor | req.outcome | Opp |
|---|---|---|---|---|
| 1 | People ask, in scope | member | undefined | |
| 2a | Nobody fits | | none, `toldNone` | |
| 2b | Fits | | probing | review |
| 2c | Matching off | | none, "keep open" | |
| 2d | Watch | | none, honest text | |
| 2e | Busy | | none, text | |
| 3 | Daily retry for 7 days, 20 h gap | clock | probing | review (`retry`) |
| 4 | Review closes | | none, one text | closed |
| 5 | Approve; requester first if a confirm or time question is needed | staff | probing | probing |
| 6 | Requester "no" | member | none, `noCount+1`; second closes | closed |
| 7 | Candidate "no" | member | probing | swap or close |
| 8 | All yes | member | booked | scheduled |
| 9 | Attendance | clock | fulfilled, or stuck (M16) | done |

Exits missing or silent: M16, M17, M18, M20. Plans buddy: M11. On slop, `askFit` scores romance at 0 (`N:1784`), so a request for a date can never find anyone. The member gets "none yet", and daily retries find nobody. This is by design ("romance only via the engine"), and the text promises more than the path can do.

A requester who is primed and gets a time question counts it as `lastConfirmAt`, so `retryRequests` waits 72 hours. Silence closes as "requester unavailable" and the request returns to `none`. It retries at most about twice. Bounded.

### J14. Peon seat

Candidate first, then the manager, then the intro. `checkSeats` ends items on a closed or filled posting. core-D5 (manager's slot), D22, D23 apply. M3 applies too. `peon/rules.ts:52` plus M13 means an expired seat item blocks that candidate for that seat for good, as `recentPairs` has no time limit in the rule, within the 30-day input window. Read.

### J15. Slop date

Same as J4, with these differences: `hooks.probe`, `hooks.timeOptions`, `hooks.venue`, `hooks.booked`, `hooks.checkIn`, `postDateReports`. Engine origin only. `romanceGate` at gate and at approve. No plans. No alternates. So a no closes the item. M1, M2, M3, M8, M9, M10, M11 apply. M3 is sharpest here, since the check-in text is where a safety report starts.

## 5. Composite machines

### 5.1 `match-to-meeting` (P0)

States are the product of `stage`, each `status`, each `awaiting` and `review`. Sections 3 and 4 give the reachable set. Transitions are J1 to J13.

Invariants to check across the product:
1. `noContactBeforeApproval` (AGENTS). Holds.
2. `namesAfterAllYes`: a reveal to X about Y implies that Y's last consent word was a yes. **Broken: M1, M2, core-D1, core-D2.**
3. `noReviewAfterDeadline`. Broken: core-D11.
4. `everyOpenItemHasAnExit`: holds if ticks succeed. M12 is the exception.
5. `exactlyOneAnswerPath`: while `status == probing` and contacted, `awaiting` points at this item. Broken: core-D5, M3.
6. `slotOwnerAlive`. Broken: core-D10, M2.
7. `blockedPairNotBooked`. **Broken across apps: M4.**
8. `yesHearsEnd`: a member who said yes hears the outcome. **Broken: M14.**

Liveness: every `yes` leads to `scheduled` or a closing notice.

### 5.2 `reply-router` (P0)

The order that decides what a message means:

1. `route()`: line, keyword, pending join, newest open item, last writer.
2. `handleInbound`: STOP, START, HELP; age; welcome; block or report; pending who; hold; abuse; postings; `awaiting` probe; opt-ins; crew; booked; check-in; cancel; feedback; interview; growth; requests.

A consent word is meaningful only by position. So the router is consent state. Each slot writer without `expect()` can turn a word into consent for another item (M3). Each app with an open item can take a word meant for another (M5).

Quint notes: state `awaiting: Member -> Slot`, `open: Set[Item]`. Action `reply(m, intent, word)`, where `intent` is a hidden variable naming the item the member means. The invariant is `recorded(item) implies intent == item`. It finds M3, M5, core-D5 at depth 4. This is the highest-value model in this report.

### 5.3 `yes-hold` (P0)

States: `available`, plus the implied `withdrawn` that the code lacks.

| From | Event | To |
|---|---|---|
| probing | yes | available |
| available | partner yes | yes |
| available | partner no, no alternate | gone, silent (M14) |
| available | swap | available |
| available | STOP, hold, drop | unavailable |
| available | member "no" | **no transition (M1)** |
| available | set paused | **no transition (M7)** |
| plan available | `planOut` | unavailable |

Failure: all in one unit, no crash issue.

Quint: add `withdraw(m)`, and check `withdrawnNeverRevealed`.

### 5.4 `booked-change-window` (P1)

States over time: `told-slot-open`, `told-slot-closed`, `started`, `ended`, `done`. Events: `can't`, `no`, `reschedule`. Table in J10.

Invariant: `cancelAfterStart` must not read as free notice. A late "can't make it" should reach attendance, not close the item.

### 5.5 `probe-belief`, `engine-billing`, `tick-poison-window`

`probe-belief`: extend `sweep` `send_belief.qnt` with a probe row. Check `unansweredImpliesDelivered`.

`engine-billing`: a small pure check: for every item with `contacted` empty at close, the id is in `unsentProposalIds`.

`tick-poison-window`: add a `throw` action to the store model. Check `eventually saved` for ticks in the window. It needs a fairness rule that the throw stops.

### 5.6 `repeat-encounter`, `standing-request-loop`, `group-quorum-to-pair`

`repeat-encounter`: invariant `allowedOriginCategory`: for each app, every origin the Network composes has a category in `allowedCategories`. This is a table check, and it does not need Quint. A sim gate is enough.

`standing-request-loop`: invariant `everyAskGetsAReply`: a member ask in a `handled` turn has at least one reply or a stated reason. Liveness: `none` ends in a final message.

`group-quorum-to-pair`: invariant `pairNeverFromGroup`, over all paths: fallback, `bookPlan`, `handleDrop`, `replaceOrClose`, `dropMember`.

## 6. Concurrency and failure along the journeys

- All Network steps run in one unit under one advisory lock. Two members answering at once serialize. The first runs `advanceProbes`, the second sees the result. No double reveal: `maybeReveal` checks `stage`.
- A staff decision and a tick serialize the same way. `withTickLock` skips when a unit holds the lock, so a tick can be skipped many times under load. Expiry waits for the next tick that runs.
- Clock skew: `decide` reads `now` with no deadline check. `advance` compares at tick. A meeting window has no expiry on `reveal`: `meetingTime` looks forward from `now`.
- Duplicate inbound: the inbox dedupes by message id before the Network. Two different messages "yes" "yes": the second finds no slot. It goes to the end of `handleInbound`. `ACK_ONLY` matches and it returns silently.
- Crash after commit, before delivery: the row is in the queue. Network state is ahead of the member (sweep-D3, M8).
- Crash in a signed turn: `collected` replies go back through the gateway. A reveal to B is in the turn. If the receipt never arrives, Network state has `bookedTold` for B with no delivery. The turn-receipt machine is in `out` section 3.
- Reply racing an expiry: a reply and an expiry serialize. The reply after expiry finds no slot and goes to `open`.

## 7. Scripts

All scripts are in `/private/tmp/claude-501/-Users-nubs-thenetwork/fb3a81a2-1e7b-4e4d-a9fa-a85215213426/scratchpad/jm/`. Run with `bun run <path>` from the repository root, with no provider keys. `s2.ts` takes a scenario name as an argument.

| Script | Scenarios | Defects |
|---|---|---|
| `s1.ts` | s1 withdraw (run first with both texts), s3 late cancel, s4 no after retry | M1, M2, M9 |
| `s2.ts` | fb, slop, friends, repeat, stuckBooked, group, freeze, pausedYes, crossBlock, waiting, resched | M3, M4, M6, M7, M10, M11, M12, M16, M17, M18 |
| `s3.ts` | group "no" against "neither" | M15 |
| `s4.ts` | partner no, first hears nothing | M14 |
| `c.ts` | parser table | M20, core-D1 |

Mini limits: time is hourly ticks. The snapshot has no block edges, so `crossBlock` injects one. `pausedYes` edits the member record the way the service would.

## 8. Quint plan

Build on section 5 of `network-consent-core.md`. Add:

1. `replyRouter.qnt` (P0). Two items, one member, hidden `intent`. Merge `awaiting-slot` and `route()`. Finds M3, M5, core-D5.
2. Extend `consent.qnt` with `withdraw`, `silentRetryExpiry`, `pause` and an `everyYesHearsEnd` check. Finds M1, M2, M7, M14.
3. `groupPair.qnt` (P0). 4 members, actions: no, neither, cancel, shrink. Check `pairNeverFromGroup`, `neitherDoesNotKillGroup`. Finds M6, M15, core-D2.
4. `bookedWindow.qnt` (P1). Time as `before`, `started`, `ended`. Actions: cancel words by class. Finds M9, M10.
5. `crossAppBlock.qnt` (P0). Two networks, one person pair, `person_blocks` as a shared variable. Finds M4.
6. Table checks, no model needed: `allowedOriginCategory` (M11), `unsentProposalIds` (M13), `everyAskGetsAReply` (M17).

Bounds: 4 members, 2 items, 2 apps at most, time as named events. Abstractions: parser as a word class (`yes`, `no`, `counter`, `neither`, `ambiguous`). Engine as a nondeterministic proposer. The send pipeline as `canSend(member, kind)`.
