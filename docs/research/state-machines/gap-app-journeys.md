# Gap report: per-app journeys (slop date and peon seat)

Scope key: `gap-app-journeys`. This file fills the stubs J14 and J15 in `journey-match.md`. It adds the photo, rating, check-in, posting and seat machines that had no production model. It does not repeat what other files already cover. It points to them.

Hand-written from reading the code on branch `claude/quint-state-machines`, and from local runs of the real code with fake clocks. No external service was called. No file outside this document changed. Scratch runs are in `/private/tmp/claude-501/-Users-nubs-thenetwork/fb3a81a2-1e7b-4e4d-a9fa-a85215213426/scratchpad/gap/` (`a.ts` to `f.ts`, `b2.ts`). They use the real `ConsentNetwork` through `packages/network/test/mini.ts`, the real engine and the real hooks. Simulated review. No Postgres. No model calls.

Read in part only, and not relied on: `packages/network/src/network.ts` and `packages/network/service/service.ts` (the sections cited), `packages/engine/src/plans.ts` (crew section). Not read: `packages/engine/src/packs/slop/extract.ts`, `learn.ts`, `zips.ts`, and most of `score.ts`. These hold onboarding parsing and scoring, not journey state.

File keys:

| Key | File |
|---|---|
| N | `packages/network/src/network.ts` |
| PK | `packages/network/service/packs.ts` |
| J | `packages/network/src/jobs.ts` |
| PO | `packages/network/service/postings.ts` |
| RP | `packages/network/src/reports.ts` |
| PH | `packages/platform/src/photos.ts` |
| PI | `packages/network/service/photoIntake.ts` |
| SV | `packages/network/service/service.ts` |
| SN | `packages/network/service/snapshot.ts` |
| SP | `packages/engine/src/packs/slop/profile.ts` |
| SR | `packages/engine/src/packs/slop/rules.ts` |
| PL | `packages/engine/src/packs/slop/plan.ts` |
| SC | `packages/engine/src/packs/slop/copy.ts` |
| PS | `packages/engine/src/packs/peon/seats.ts` |
| PR | `packages/engine/src/packs/peon/rules.ts` |
| PP | `packages/engine/src/packs/peon/profile.ts` |

Other reports: M and J numbers are `journey-match.md`. D numbers are `network-consent-core.md`. PC numbers are `platform-consent.md`.

## 1. Answers to the questions in the task

**Does the live probe attach a photo? No.** Four separate facts each stop it:

1. `SLOP_PROBE_PHOTOS = false` (PK:47). The comment names the reason: the upload consent says that no other member sees a photo, so no member can consent to it until Legal approves a new consent version.
2. The hook passes `photoIds: []` as a literal (PK:257). So a flip of the flag alone returns nothing, because `probePhotoRefs` filters an empty list (PL:83-86).
3. The hook returns `slopProbeMessage(...).text` (PK:258). It throws away `.photos`. `AppHooks.probe` returns a string (`apphooks.ts:58`), so no field exists to carry an id.
4. `DeliverRequest` has no media field (AGENTS.md, "eliza.app users and deliver path"). Also, there is no input: PC-20 shows that no production path stores a photo.

So the `slop-probe-photo` machine has one reachable state in production: `off`. The sim has a working photo arm (`packages/sim/src/apps/slop/world.ts:206`), and the slop defaults were tuned with photos in the probe (`options.ts:177-184`). That evidence does not describe production.

**Is the peon seat path reachable in production? No, not end to end.** Three gaps stop it. Each one was checked by a search of `packages`, `deploy` and `sites`.

1. Nothing writes `peon:entity:candidate` or an intent with details `peon:search`. Only tests and fixtures do (AJ7). So `peon_not_onboarded` (PR:15) excludes every real candidate.
2. `jobPostingRoutes` is never registered (AJ8). So `POST /employers/:id/verify` has no route. Nothing can write `peon:verified`, and `employer_unverified` (PR:18) excludes every seat.
3. A job post that has no seniority word, or no area for a non-remote job, is unmatchable (AJ9).

With those facts injected by hand, the Network seat flow works (`gap/f.ts`, section 5). No test covers it: a search of `packages` and `tests` finds no reference to `seatRoute`, `SEAT_COPY`, `checkSeats`, `seat_ended` or `o.seat` outside `network.ts` and `packs.ts`. `peon-seats.integration.test.ts` stops at the engine.

## 2. Machines in this report

| Id | Name | Kind | Priority | Where the state lives |
|---|---|---|---|---|
| `slop-date-journey` | Composite: review to check-in | composite | P0 | `Opp.stage`, `Opp.status`, `MemberState.awaiting` |
| `slop-probe-photo` | Photo in the probe | implicit | P0 | `SLOP_PROBE_PHOTOS`, hook arguments |
| `photo-to-rating-to-match` | Upload, rating, use in matching | implicit | P1 | `platform.photos`, facet `<member>:appearance`, `SlopProfile.appearance` |
| `slop-time-venue-booking` | Time options, picks, venue, booking | implicit | P1 | `Opp.offered`, `picks`, `declinedTimes`, `timeRetry`, `meetingAt`, `venue` |
| `slop-check-in-report` | Check-in answer to report and block | implicit | P0 | `Opp.feedbackFrom`, `Opp.post`, `reports`, `blocks`, `minorReported` |
| `slop-review-hold` | Engine member hold | implicit | P0 | Derived in `reviewReason`, from tags and history |
| `slop-member-history` | History from interactions | implicit | P1 | `Network.interactions`, `feedback`, read by `SP:histories` |
| `slop-pair-reprobe` | Pair cooldown, engine and gate | implicit | P1 | `Network.declined`, `pairInteractions` |
| `peon-candidate-onboarded` | Candidate facts | implicit | P1 | Facets `peon:entity:*`, intent `peon:search` |
| `peon-employer-verified` | Employer verification | implicit | P1 | Facets `<member>-peon-verified`, `-peon-company` |
| `job-posting-draft` | Draft by text | explicit | P1 | `MemberState.posting`, `awaiting.kind = "posting"` |
| `job-posting-record` | Posting rows | explicit | P1 | `network.intents.status`, tagged facets |
| `job-seat-item` | Candidate, manager, intro | implicit | P1 | `Opp.seat`, `Opp.status` |
| `seat-capacity` | Openings left and filled | implicit | P1 | Derived by `peonSeatCapacity`, `checkSeats` |
| `crew-offer-and-crew` | Offer, crew, sessions, hand-off | implicit | P2 | `crewOffers`, `crews` |

## 3. Suspected defects

Ranked by harm. "Reproduced" means that a run of the real code showed it. "Read" means traced in the code and not run.

| Id | Title | Priority | Confidence | Evidence |
|---|---|---|---|---|
| AJ1 | A happy check-in answer can file a report, block the date and mark an adult a minor | P0 | high | reproduced |
| AJ2 | `trust_review` has no human, no notice and no exit | P0 | high | read, search |
| AJ3 | A safety disclosure after the first check-in answer files no report | P1 | high | reproduced |
| AJ4 | The peon check-in asks what "felt off", and the answer goes nowhere | P1 | high | reproduced |
| AJ5 | A self-reported no-show counts against the innocent partner | P1 | medium-high | read |
| AJ6 | Slop re-proposes a declined pair for 53 days, and the gate drops it each day | P1 | high | reproduced |
| AJ7 | No production writer for peon candidates | P1 | high | search |
| AJ8 | The postings staff API is not registered, so no employer can be verified | P1 | high | search |
| AJ9 | "Posted" for a job that can never match | P1 | high | reproduced |
| AJ10 | A repeated must-have makes the save transaction fail, and a retry repeats it | P1 | high (ids), medium (effect) | ids reproduced, no Postgres run |
| AJ11 | An opening has no hire state, so the first intro ends a job for good | P1 | high | read, part reproduced |
| AJ12 | Check-in reports skip the trust rules of "report X" | P1 | high | read |
| AJ13 | `.photos` is dropped, so a later wiring says "I've attached a photo" with none | P1 latent | high | read |
| AJ14 | `photoConsent` means two things | P1 latent | medium | read |
| AJ15 | Clef sees a photo that does not show one adult, and no state changes | P1 | medium | read |
| AJ16 | One decline for job A blocks that candidate from job B of the same manager | P2 | high | read |
| AJ17 | A posting update does not touch items in flight | P2 | high | read |
| AJ18 | A held manager's seat stays in the engine input | P2 | medium-high | read |
| AJ19 | `closedReason` is never stored, and a reopened job loses its openings | P2 | high | read |
| AJ20 | Peon history inputs are mostly never written | P2 | high | read |
| AJ21 | `attendedSlots` uses the time of the answer, in UTC | P2 | high | read |
| AJ22 | The planned public venue and duration are unused | P2 | high | read |
| AJ23 | A crew stops without a word, and failed sessions count | P2 | medium | read |
| AJ24 | "Write here and I'll pass it on" while the relay is off | P2 | medium | read |

### AJ1. A happy check-in answer can file a report, block the date and mark an adult a minor

- Where: `checkInReport` (RP:38), `KINDS` (RP:17-24), N:2608-2616. Linked: AGENTS "Age policy", "Canary leaks, invariant violations, and minor contacts", PRD 40.5.
- `checkInReport` runs a bag of keyword patterns on the whole answer. It has no negation and no check that the words describe the date.
- Trigger, reproduced (`gap/b.ts`, slop hooks, a booked date, check-in sent):
  - "She's 10/10, what a great night" gives `minor`. Result: `b.minor = true`, `minorReported = true`, block `a|b`, report open, `reportHeld("b") = true`, log `minor_after_contact`.
  - "He was so fun, not rude at all, want to see him again" gives `harassment`. Result: block, open report, subject held.
- Pure checks (`gap/a.ts`), all from `checkInReport`:

| Answer | Kind |
|---|---|
| "He was 9/10, really fun" | minor |
| "So fun! He has a kid and a dog" | minor |
| "He told me he was in high school once" | minor |
| "He wasn't creepy, I liked him" | harassment |
| "we talked about investment banking, loved it" | scam |
| "He is into crypto, kind of fun" | scam |
| "he was great, a little older than I expected" | lying |
| "I was scared I'd spill my drink, lol, fun date" | unsafe |

- Effect: the member is told "I've blocked them for you", and there is no unblock (`network-consent-core.md`: `block` is one way). The subject leaves matching until staff act. A `minor` kind also sets `target.minor` (N:1555) and closes their open items as minors policy (N:1557). `clearMinorSignal` is the only way back (N:1565).
- The failure is on the safe side for a real minor, so it is not an AGENTS violation. It is a wrong state in a P0 machine. It costs staff a 1-hour urgent item each time (RP:15). It also feeds AJ2: each false block adds to `blockedBy`.
- `good` (N:2603) still emits `value_received` for the same answer, in the same turn as the report. So the ledger says value was received from a person who was just reported.
- `onFeedback` also records `again` and `sentiment` after the block (N:2624-2640). `feedbackOf` gave "negative" for "not rude at all", so the same regex problem exists there.

### AJ2. `trust_review` has no human, no notice and no exit

- Where: `reviewReason` (SR:46-62), `slopMemberRules` "review_hold" (SR:70), SP:200.
- The comment says "held for human review". The code path has no human:
  - No code writes `review:confirmed`, `review:cleared` or any `safety:*` tag. A search of `packages` and `deploy`, without tests and sim, finds readers only. So `review_confirmed` and `safety_review` are unreachable, and `cleared` is unreachable.
  - `trust_review` needs no tag. It is derived from `blockedBy >= 2` (SR:57) or `noShows >= 2 && noShows > dates` (SR:58).
  - The `cleared` guard does not cover the trust branch (SR:54-60). Even with a writer, "cleared" would not lift it.
  - `trust_review` appears nowhere outside `rules.ts`. It makes no staff case, no queue row and no message. It shows only as a count in `memberFunnel`.
- Trigger (read): two different members block X. `recordBlock` writes an edge, and `SP:273` counts it. X is then out of `memberReason` for every later engine run, for good, because blocks never expire. X hears nothing. Staff see nothing. `liftHold` and `closeCase` act on the Network's trust record, not on this rule.
- This is a stuck state. A block is a personal choice ("block X"). The trust rules in `trust.ts` require corroboration, and this rule does not. With AJ1, two false positives are enough.
- Also: `extraAsks` stops for a member with a `reviewReason` (`index.ts:123`). So X also gets no more questions.

### AJ3. A safety disclosure after the first check-in answer files no report

- Where: N:804-813, N:833-837, `SC:slopCheckInText`.
- The check-in says "tell me and I'll pass it to our safety team". The report path runs only inside `onFeedback`, and `onFeedback` runs once per member per opportunity on the `aw.kind === "feedback"` route, or on `feedback_like` through `feedbackDue` (N:2587-2591), which needs `!feedbackFrom.has` and under 7 days.
- Reproduced (`gap/b2.ts`):
  - "It was fine", then "actually he followed me home": result `open`, 0 reports, no block.
  - No answer for 8 days, then "she asked me for money and I feel unsafe": result `open`, 0 reports.
- `classify` returns `other` for "he grabbed me on our date", "my date scared me", "she asked me for money" (`gap/a.ts`). A report needs the word form that `classify` reads as `report`.
- `awaiting` for feedback also ends after 3 days (N:3285).
- Partial cover: an open turn goes to Eliza, and Eliza can post `safety_concern` to `/internal/signals`, which waits for staff in `GET /signals` (SV:1957-1959). That depends on a model. It makes no report, hold or block, and the member gets no block. I did not check upstream.
- M3 notes the same area. This is a different cause: M3 is a wrong route for the first answer. This is no route for the later ones.

### AJ4. The peon check-in asks what "felt off", and the answer goes nowhere

- Where: `SEAT_COPY.checkIn` (J:288), `peonHooks` (PK:286-313, no `postDateReports`), N:2608.
- `reportKind` needs `hooks.postDateReports`. Only slop sets it (PK:275).
- Reproduced (`gap/f.ts`, S1): candidate answers "They asked me to pay $200 for training and for my SSN. It felt like a scam." Result: `reports: []`, `blocks: []`, no `abuse_disclosed` log, no staff case. The check-in text says "tell me if anything felt off".
- Peon copy also says "We never ask for money, bank details or your SSN" (`peon/copy.ts:16`). This is the moment a scam employer would be caught. `SAFETY.scam` has no writer in production (section AJ2 search), so the pack's `employer_scam_signal` rule cannot fire either.
- Peon is local only today (AGENTS decision 4), so harm waits for launch.

### AJ5. A self-reported no-show counts against the innocent partner

- Where: N:2641, SP:247, SR:58.
- `onFeedback` writes one interaction per answer, with `participants: [...o.participants]` and `outcome: f.selfNoShow ? "no_show" : "completed"`.
- `histories` adds `noShows++` for every participant of a `no_show` record. The comment says "either side". In the simulator the record is one per date. In production it is one per answer, and only the person who admits it writes `no_show`.
- Trigger (read; `feedbackOf("I couldn't make it")` gives `selfNoShow: true`): B has two dates, with A and with C. A and C each answer "I couldn't make it". B does not answer either check-in. B then has `noShows = 2` and `dates = 0`, which is `trust_review` (AJ2) with no way out. B did nothing wrong.
- Also: a date both people attended writes two `completed` records, so `dates` counts 2 per date. The check `h.noShows > h.dates` then compares two different units.
- Also: the person who really did not show and stays silent writes nothing here. `finalize` raises `m.noShows` (N:2773), which feeds `reliability`, not this history.

### AJ6. Slop re-proposes a declined pair for 53 days, and the gate drops it each day

- Where: `options.ts:158` (`reprobeAfterDays: 7`), SR:92-99, N:2328, N:1747-1751, N:3607, `assign.ts:103-119`.
- Two rules disagree. The pack allows a re-probe of a pair after 7 days. `markDeclined` keeps the pair out for 60 days, and `gateReason` refuses with `pair_history`.
- The engine does not see `Network.declined`: it is not in `EngineInput`. Slop weights set `repetition: 0` (`index.ts:45`), and `perMemberPerTick: 1`. So from day 7 the greedy round pairs the same two people every run. The gate then drops the item, and neither person gets their one slot.
- Reproduced (`gap/d.ts`): `a` says no to `b` on day 0. `e` and `f` join on day 9 and fit `a` and `b`. Engine run log days 7-29: `a+b` every day. 36 `pair_history` gate drops. `a+e` and `b+f` are never proposed in 23 days, though both are eligible and untried.
- This is a liveness failure: the best-scored pair starves both members. A member stays stuck for the rest of the 60 days.
- `dailyRun` counts `started` only for items that pass the gate, so the daily cap is not used. The loss is in `slopAssign`, which already consumed both members.

### AJ7. No production writer for peon candidates

- Where: PP:116-118, PP:151, PR:15, PR:22.
- A search for `peon:entity`, `peon:search`, `SEARCH_INTENT`, `T.entity`, and `peon:` in `packages/network/src`, `packages/network/service`, `packages/mcp/src`, `packages/platform/src` and `sites/peon.biz` finds no writer for a candidate. `peonHooks` has no `onboarding` (PK:286-313), so a peon member gets the generic Network interview. Its tags are not `peon:*`.
- Fixtures write them: `peon-seats.integration.test.ts:57-63`, `observatory/test/real-fixes.test.ts:103`, `testkit.ts`, and the sim.
- Effect: `profileOf` returns null. Every peon member is excluded as `peon_not_onboarded`. `askQuestions` in the pack cover `no_structured_want` and `few_facets`, but nothing turns an answer into those tags.
- A hiring manager can post. The post then waits for candidates that cannot exist.

### AJ8. The postings staff API is not registered

- Where: PO:10 and PO:91-94 say "registered by the service". `docs/network.md:120` documents the routes. A search of `packages` and `deploy` without tests finds `jobPostingRoutes` only in its own file. `SV` has no reference. `peon-postings.integration.test.ts` calls the handler directly.
- Effect: `verifyEmployer`, staff close, staff create and `GET /postings` have no HTTP path in production. `peon:verified` has no writer, so `employer_unverified` (PR:18) always fires. `closedReason: "filled"` also has no writer, which extends D23.
- A manager can still close by text.

### AJ9. "Posted" for a job that can never match

- Where: `missing` (J:94-97) requires a title and pay only. `postingProblem` (J:201-209) does not require more. `POSTING_COPY.saved` (J:114). PR:57-60, PR:41-46.
- `seniority_band` fails when either side has no seniority (PR:59). `locationOk` fails for a non-remote job with no area (PR:45). Both run inside `pairTable` (`peon/generators.ts:36`), so they do not even show in `rejectedBy`.
- Reproduced (`gap/e.ts`, three fitting candidates, verified employer):

| Text | Read | Proposals |
|---|---|---|
| "We're hiring a data analyst (level 2), 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL" | seniority 2, area brooklyn | 2 |
| Same without "(level 2)" | no seniority | 0 |
| "...(level 2), 2 openings, $90k-$120k, must have SQL" | onsite, no area | 0 |
| First text, unverified employer | | 0 (`employer_unverified: 1`) |

- The header example in `jobs.ts:11` ("We're hiring a data analyst, 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL") is the second row. The test adds "(level 2)", which hides it.
- `saved` says "you see a short summary of each candidate who says yes". Nothing tells the manager that the job can never match.

### AJ10. A repeated must-have makes the save transaction fail

- Where: `parsePosting` (J:84-87), `postingFacts` (J:216-228), `savePosting` (PO:33-36), `schema.sql:48`.
- `network.facets.id` is a primary key. `savePosting` inserts with no `on conflict`. Facet ids are `<posting>-must-<skill>`. `postingProblem` does not check for repeats.
- Reproduced (`gap/a.ts`): "We're hiring a nurse, $80k-$90k, must have SQL and sql" gives ids `p1-role, p1-pay, p1-mode, p1-must-sql, p1-must-sql, p1-open`.
- Expected effect (read, no Postgres run): `writeUnit` throws in the save transaction. The unit rolls back, with its sends. `m.posting` stays `ready` in stored state, so the next "yes" fails in the same way. The turn returns an error each time until the manager sends a correction.
- Same for `nice`, and for a skill repeated through slugging ("C++" and "C#" both give `c`).

### AJ11. An opening has no hire state

- Where: PS:96-111, N:4528-4531, N:4543-4553, J:289.
- The pack's stages list `interview, offer, hire, check_in_90d` (`peon/index.ts`, `consent.default.stages`). No production code has these states. The Network has only "intro revealed".
- Two counters define "filled", and they disagree:
  - `checkSeats`: distinct candidates with `meetingAt` set and stage not closed. A `done` item counts for good, because `opps` has no time pruning (the only delete is the forget path, N:920).
  - `seatFills`: interactions `accepted`, `completed`, `pending`, plus open items. PS:97-98 says that no-show frees the opening. But the other side's answer writes `completed`, and `checkSeats` ignores outcomes.
- Effect (read; S1 of `gap/f.ts` shows that `c2` gets no probe after the one opening is taken): a one-opening job gets one intro. After the check-in, any answer writes `completed`. So "we talked, not a fit" uses up the opening. `hires++` too (PP:201). The posting stays `active`, the seat reads `peon:openings:0`, and `job_closed` fires. The manager is told nothing, and no state lets the opening free again. Only a text update that raises `openings` helps, and the manager has no way to know.
- `meetingAt` for an intro is a time nobody agreed to (M30). The check-in fires 3 hours after it. In the S1 run the estimated `meetingAt` was Oct 10 14:00 UTC, so the check-in fell at 17:00 UTC that day, whether or not they had talked.
- A candidate told "That job is no longer open" (J:289) may be told so because of an intro that later fails.

### AJ12. Check-in reports skip the trust rules of "report X"

- Where: N:2608-2616 and N:1421-1450.

| Effect | `applyBlock` | Check-in report |
|---|---|---|
| Block | yes, plus `trust.block` | `blocks.add` only |
| Trust points | `trust.report` | none |
| Close open items of the pair | yes (N:1434-1445) | no |
| `met` | computed | hard-coded `true` |

- Result: the same words count toward the trust hold in one path and not in the other. A non-urgent check-in report (`lying`, `no_show`, `other`) holds nobody and adds no points, though the member heard "I've blocked them".
- `met: true` is wrong when the kind is `no_show`: they did not meet. `no_show` is not urgent, so a hold does not follow, but an answer such as "he never came and I felt scared" gives `unsafe` with `met: true`.

### AJ13. `.photos` is dropped, so a later wiring lies

- Where: PK:257-258, SC:55-60.
- `slopProbeMessage` puts "I've attached a photo they chose to share" in the text when `photos` is not empty. The hook returns only `.text`. If a later change passes real ids, the member reads that a photo is attached, and none is.
- `held` is not passed either (PK:257), so `probePhotoRefs`' hold check is idle. This is safe only because `photoConsent` is false.

### AJ14. `photoConsent` means two things

- Where: PL:68 (`ProbePhotoSubject.photoConsent`: consent to show photos to a proposed match), PI:124 (`profile.photoConsent`: the version of the upload consent), `PHOTO_CONSENT.text` (PH:97: "No other member sees them").
- The names match and the meanings conflict. Wiring `photoConsent: !!profile.photoConsent` would show photos against the text the member agreed to.
- No field exists for show consent. Quint must keep them apart: `uploadConsent` and `showConsent`.

### AJ15. Clef sees a photo that does not show one adult, and no state changes

- Where: `clef.ts:220`, PH:511-512.
- Rows under `gate.one_adult` are dropped. If none is left, `rate` returns null. `PhotoService.rate` returns `{rated: false}`. There is no case, no log and no age review.
- A photo that the model thinks shows a child causes no transition, though AGENTS says that the lowest age wins and that minors must stay out. The stated age stays. The photo stays stored.
- Whether Clef's gate is good enough to act on is a founder question. The gap is that no transition exists.
- Related: on an upload that returns null, the old rating stays, though the newest 4 photos no longer support it (PH:512).

### AJ16. One decline for job A blocks job B of the same manager

- Where: N:2328, N:3607, N:1747-1756.
- The engine models each job as one seat, and it dedupes per seat. `seatRoute` turns the seat into the manager before `gateReason` runs. So `declined`, `avoid` and `metRecently` use the pair (candidate, manager).
- Trigger (read): a candidate says no to job A, or the manager says no. For 60 days job B of that manager fails at the gate with `pair_history`. The engine keeps selecting it (same starvation as AJ6).

### AJ17. A posting update does not touch items in flight

- Where: N:4591-4603.
- `applyPosting` calls `endSeat` only for a closed posting. A text update can lower pay, or change the place, while a candidate said yes to the old text and a reviewer approved it. `seatJob` reads the current facets, so the manager's probe shows new data.
- It can also lower `openings` under the items in flight. `checkSeats` ends some at the next tick. `reveal` has no seat check (core 3.22 TOCTOU).

### AJ18. A held manager's seat stays in the engine input

- Where: N:3710, N:3744-3747, PS:68.
- `holds` lists member ids from `this.members`. The seat is a separate id with no `MemberState`, and `adult` passes it because `!m` is true. So the seat of a manager on trust hold, or with a minor signal, stays eligible in the engine. `seatRoute` and `eligibleIn` drop it at the gate each day.
- Not a safety failure: the gate and `managerProblem` hold (checked at N:4503-4504). It wastes the candidate's selection budget (`candidateWeekly`) in the run, as in AJ6.

### AJ19. `closedReason` is never stored

- Where: J:216-231 writes no `closedReason`. J:234-248 reads none. `postingFromFacts` reads `peon:openings:0` as `|| 1` (J:242).
- So "filled" against "closed" is lost after the call. A staff re-save of a closed job (status `active`, PO:149) restores `openings: 1` whatever it was. D23 covers the text side. The staff route is dead today (AJ8).

### AJ20. Peon history inputs are mostly never written

- Where: PP:195-211, N:2559, N:4530.
- `answered` needs `acceptedBy` with both sides, or `declinedBy`. The Network writes `acceptedBy` only on the synthetic `:seat` row, and that row vanishes when the first check-in answer arrives (N:4529). `declinedBy` is empty by D13. `noResponse` has no writer. So `ghosted` is always 0, and `responsiveness` is the prior.
- `companyTrusted` (`selection.ts:60`) flips on while an intro is open and off after the check-in. A company goes back on probation after its first success.
- `pendingReview` needs `outcome: "pending"`, which the Network never writes.

### AJ21. `attendedSlots` uses the time of the answer, in UTC

- Where: SP:224-230, SP:244, N:2641.
- `r.at` for a check-in row is `now` at the answer, not the meeting. `slotOf` reads UTC hours, and the header says that the mapping is for the sim's UTC slots. Production slots are New York time (PK:176). So a Thursday 7pm date answered on Friday morning is learned as "not a slot", and a Saturday 2pm date reads as `sat_eve`.
- `freeScore` (PL:31-35) then uses it to choose time options.

### AJ22. The planned public venue and duration are unused

- Where: `PUBLIC_VENUE` (PL:15-20), `DatePlan.venue` and `minutes` (PL:23), PK:260-266, PK:188-205.
- `slopVenue` chooses the place. It reads only `activity`. A plan for `hike` says "a popular trailhead (daytime)". The slot logic has no link to the activity, so a probe can read "a daytime hike, Thu 7pm" and the booked text can then name an evening food hall. Public place is still kept, so this is not a safety failure.
- `end` is always `start + 2h` (PK:242).

### AJ23. A crew stops without a word, and failed sessions count

- Where: N:3230-3236, `copy.ts:154`, `config.ts:511`.
- `crewFormed` promises a weekly crew. After `handOffAfterSessions` (3), `crew.handedOff = true` writes only a log line. No member hears that it ended.
- `crew.sessions.push` runs before `submitPlan`, so a session that review rejects or lets expire still counts. D17 means that the dedupe at N:3230 cannot see the earlier id. So after a rejection the same start can be planned again on the next daily step, and three rejections can end a crew inside a week. Read, medium.
- `onCrewAnswer` needs the `crew` slot, and `expect` refuses it while a probe or booked answer is pending (N:4137). That member's yes is then lost, and a crew can fail to reach 3.
- Unreachable on slop and peon (`plans: false`, PK:70, PK:77): crews need `o.plan`.

### AJ24. "Write here and I'll pass it on" while the relay is off

- Where: `SEAT_COPY.candidateIntro`, `managerIntro` (J:286-287). AGENTS: the RELAY action exists only with `NETWORK_RELAY_ENABLED=1`, which stays off.
- A reply after the intro goes to an open turn, and the promise is not kept. This holds only when peon goes live with the flag off.

### Checked, and not a defect

- A minor is never a seat owner: `peonSeats` needs a valid adult age (PS:65). A later age drop removes the seat from the snapshot, and `checkSeats` then ends the items as closed. An already booked intro goes through `dropMember`.
- `seatView` keeps the seat id stable across restarts: it rebuilds from `opps`.
- `rate()` in `PhotoService` checks three times (before, after the rater, after the write). A photo deleted during a rate is caught by `ratingRefusal(..., ids)`. PC-05 covers the upload path, not this.
- `slopHooks.probe` never names the other person: `probeNames` checks it again (N:2195).
- The slop pack cannot book a private place: `slopVenue` chooses from public lists only, and `meetingSpot` is the fallback.
- The `intents.status` value `closed` is allowed by the CHECK in `schema.sql:73`.

## 4. Slop date: the machines

### 4.1 `slop-date-journey` (P0, composite)

This is J15 in full. It builds on J4 and `match-to-meeting`. Who: E engine, S staff, M member, C clock.

| # | From | Event | Guard | Effects | To | Where | Who |
|---|---|---|---|---|---|---|---|
| 1 | no item | daily run | matching on, pack rules, `gateReason`, `romanceGate` | `newOpp`, `submit` | review | N:3438-3466, N:3595-3598, N:3642 | E |
| 2 | review | approve | `reviewBlock`, `approvalCheck`, `romanceGate` again through `gateReason` | `begin` | probing | N:1941, N:1987, N:2063 | S |
| 3 | review | reject or SLA | | `close`, no interaction row | closed | N:1931, N:3345 | S, C |
| 4 | probing, first queued | turn | quiet window, no open ask, in NYC, `commonTimeGone` | hook probe, time options | first `probing`, contacted | N:2154-2203 | C |
| 5 | first probing | yes with a time | | status `available`, `picks`, `declinedTimes` | partner queued | N:2298-2307 | M |
| 6 | first probing | yes, none of the times | not retried, times left | `timeRetry`, new options | first probing again | N:2314-2322 | M |
| 7 | any probing | no | | `markDeclined` 60 days, `replaceOrClose` | closed (no alternates) | N:2326-2334 | M |
| 8 | any probing | silence 26 h | | if `timeRetry`, keep the yes; else `unavailable` | closed | N:3373-3384 | C |
| 9 | partner probing | yes | a common pick left | `available` | reveal | N:2400-2403 | M |
| 10 | all available | reveal | `checkRecipient`, streak, `meetingTime` | venue, `meetingAt`, `recordMeeting`, `booked` text, `awaiting = booked` | scheduled | N:2411-2459 | system |
| 11 | scheduled | "can't", cancel | | `handleDrop`, the other hears | closed | N:784, N:799, N:2502 | M |
| 12 | scheduled | block, report, minor, hold, STOP | | see core | closed | N:1434, N:2564 | M, S |
| 13 | scheduled | 48 h silence | | `confirmPlan`, `plan_confirmed` | scheduled | N:3390-3393 | C |
| 14 | scheduled | T-4 h | window | reminder | scheduled | N:3397-3404 | C |
| 15 | scheduled | T+3 h | | `feedbackSent`, check-in | done | N:3405-3421 | C |
| 16 | done | check-in answer | see 4.5 | feedback, maybe report | done | N:804-813, N:2593 | M |
| 17 | done | all answered or T+4 d | | `finalize` | done, finalized | N:3425-3428 | C |

Terminal states: `closed`, and `done` with `finalized`. Slop differences from J4: engine origin only, no plans, no alternates (the generators set none), hook text at steps 4, 10, 15, venue by hook.

Invariants:

- I1 `noContactBeforeApproval` (AGENTS review rule). Holds.
- I2 `onlyAdultsInSlopItem`: every participant has a record age of 18+ at gate and at approval (AGENTS decision 1). Holds. Between gate and reveal, an age drop goes through `dropMember`.
- I3 `oneOpenFirstDate`: `your_turn` rule and `busy`.
- I4 `revealOnlyAfterAllYes`: names leave only in step 10. D1 and M1 weaken "yes".
- I5 `noRatingInText`: no `appearance:*` tag and no looks word in member text (AGENTS decision 13). `editBlock` checks reviewer words. Pack text never reads ratings.
- L1 Every non-terminal stage has a clock exit: the review SLA (`review`), 26 h (`probing`), T+3 h (`scheduled`), T+4 d (`done`).
- L2 A person who said yes hears the end. Fails (M14).
- L3 A safety disclosure after a date reaches staff. Fails (AJ3).

Interactions: `your_turn` reads open items. `recently_matched` reads `lastDateAt`. Relay opens on `mutual` (`relayMatchOf`). `slop-pair-reprobe` reads the close outcome. M11: no second date path exists.

Concurrency and failure: each unit is one store lock (`store-unit-of-work`). All of steps 2 to 10 sit inside one unit per inbound or tick. Sends go in the unit's save transaction. A crash before commit loses the state and the sends together. Step 10 sets `scheduled` first and sends after, in a loop, and a refused send drops the plan (N:4087). A duplicate inbound is stopped by `inbound` ids. Out-of-order delivery of two answers cannot pass `status === "probing"` twice (N:2292).

Quint: model with `slop-time-venue-booking` and `slop-check-in-report` as one module. Two members, one item. State: `stage`, `status[m]`, `awaiting[m]`, `age[m]`, `told[m]`. Merge with `match-to-meeting` from `journey-match.md`.

### 4.2 `slop-probe-photo` (P0)

States in the design: `off`, `eligible`, `refused`, `attached`, `sent`. Reachable in production: `off`.

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| off | probe text built | flag false | off, no line, no ids | PK:257-258 |
| (design) eligible | `probePhotoRefs` | both `canBeMatched`, show consent, not held, opaque id | attached, max 1 | PL:83-86 |
| (design) attached | `slopProbeMessage` | ids not empty | text with photo line | SC:55-60 |

Sim only: `sim/apps/slop/world.ts:206` and `adversarial.ts:254-272`, which include a `flagOff` case that asserts today's live arguments give no ref.

Invariants: P1 no photo of or to a person under 18 (AGENTS decisions 1, 9). P2 no photo without show consent. P3 name and contact stay hidden until both say yes (PRD 40.5). P4 at most one photo.

Defects: AJ13, AJ14. Priority stays P0 because of what it would show when turned on.

Quint: do not model the off path alone. Model the guard as a pure predicate, and check with `showConsent` separate from `uploadConsent`: `sent(photo) implies adult(subject) and adult(recipient) and showConsent(subject) and not held(subject)`. Include a `leakedLine` variable to catch AJ13: `textSaysPhoto iff attachedId != none`.

### 4.3 `photo-to-rating-to-match` (P1)

`platform-consent.md` 5.1 to 5.3 model the photo object, the consent and the rating write. This section adds the downstream part.

States of a member's rating as the pack sees it:

| State | Meaning | Where |
|---|---|---|
| `no_photos` | no row | |
| `photos_unrated` | rows, no facet: rater off, all over 4 MiB (PH:507), or null | PH:502-512 |
| `rated` | facet with `conf >= 0.3` | `options.ts:186` |
| `rated_ignored` | facet below `minConfidence`, or person not `canRatePhotos` | SP:197 |
| `protected` | rated in the lowest 40% of this input: no similarity term | `options.ts:186` |
| `dropped` | `dropRatings` ran | SV:1596 |

Transitions: upload (`PH:473`), remove (`PH:556-557`, drop then rate again), `deleteFor` plus `onRemoved`, ban (`SV:1753`), age under 18 (`SV:779`), staff `verify:age:fail` (ratings only, PC-23).

Reachability in production: `no_photos` only (PC-20). `/internal/turn` passes `mediaUrls: []` (SV:2069). No site or MCP path calls `/api/photos`. So `appearance` is undefined for every member, `appearanceFactor` is 1, and the weekly bias report has one group, `unrated` (`bias.ts:37`). `CLEF_RATINGS` being "on" has no effect yet. `deploy/backend/server.ts:70` passes the rater.

Invariants: AGENTS 12, 13. R1 adults only. R2 never shown. R3 a rating is dropped within one step of the last photo or of the age drop. R4 (fails, PC-05, PC-22) at quiescence, a rating implies supporting rows.

Defects here: AJ15, and `rate()` ignores `consentVersion`: a stored photo from an old consent version is still rated (PH:507; PC-24 covers the wider point).

Quint: use the PC models. Add `ratingUsable` as a derived value. Merge with `platform-consent` 5.3.

### 4.4 `slop-time-venue-booking` (P1)

| Variable | Meaning |
|---|---|
| `offered[m]` | options sent, keys a, b, c |
| `picks[m]` | starts picked; empty means "yes, none of these" |
| `declinedTimes` | every offered time not picked, by anyone |
| `timeRetry` | members who got the one retry |
| `meetingAt`, `venue`, `venueArea` | set in `reveal` |

States per item: `no_options`, `first_offered`, `first_picked`, `first_retry`, `partner_offered`, `common_found`, `no_common`, `booked`.

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| no_options | first's turn | pack `timeOptions`, at least 12 h out, not declined | first_offered | N:2267-2271 |
| no_options | first's turn | pack gives none | first_offered (attention slots) | N:2272-2274 |
| first_offered | yes with key | | first_picked | N:2301-2303 |
| first_offered | yes, none | fresh left, not retried | first_retry | N:2314-2322 |
| first_offered | yes, none | no fresh | first_picked (empty) | N:2324 |
| first_retry | silence | 26 h | first_picked (keeps yes) | N:3378 |
| first_picked | partner's turn | `commonPicks` not empty | partner_offered | N:2262 |
| first_picked | partner's turn | none left | no_common | N:2178, N:2216 |
| partner_offered | yes with key | | common_found | N:2402 |
| common_found | reveal | `meetingTime` | booked | N:2425 |
| any | `meetingTime` undefined | | no_common | N:2426 |

`meetingTime` order: `picked`, `partly_picked`, `estimated`, `default` (N:2468-2489). `MIN_NOTICE` and `PARTNER_LEAD` differ, so a slot can pass one and fail the other.

Slop specifics: `slotStart` gives the next start at least one day away (PK:182). `slopVenue` picks by the longest trip, with a bonus for tags, from the evening list at or after 17:00 or before 09:00 (PK:188-205). `meetingAt` reaches the hook through `hookOpp` (N:2429).

Invariants: T1 `meetingAt` is never a time a member said no to (`declinedTimes`). `partly_picked` is allowed by design, and M2 shows a way around it. T2 the venue is public. T3 `meetingAt >= now + MIN_NOTICE`, except `default`, which is about 20 h.

Clock: a probe can go out days after planning (N:2174), so the options are computed at send time. DST: `nextAt` runs on local time. Clock skew does not apply: one Clock.

Quint: abstract time to 4 slots and a `now` counter. Keep sets for `picks` and `declinedTimes`. Check T1 and "booked implies each member who named times has the slot, or said none".

### 4.5 `slop-check-in-report` (P0)

State per (member, item): `not_asked`, `asked`, `answered_plain`, `answered_report`, `late_unanswered`, `expired`.

| From | Event | Guard | Effects | To | Where |
|---|---|---|---|---|---|
| not_asked | T+3 h | status yes, send passes | `expect(feedback)`; refused by a pending probe or booked slot | asked | N:3414-3421, N:4106, N:4137 |
| not_asked | send refused | | `feedbackSent` already true, no retry (M26) | late_unanswered | N:3406 |
| asked | ack only | neutral | no reply, question stays | asked | N:810-812 |
| asked | answer | `checkInReport` undefined | `feedbackThanks` | answered_plain | N:2593-2646 |
| asked | answer | `checkInReport` set, or `otherNoShow` | `fileReport` per other, `blocks.add`, `recordBlock`, maybe `minorReported`, `copy.reported` | answered_report | N:2608-2616 |
| asked | 3 days | | `awaiting` cleared | late_unanswered | N:3285 |
| late_unanswered | `feedback_like` text | under 7 days, done, not answered | as answer | answered_* | N:804, N:2587 |
| late_unanswered | other text | | open turn, no report | late_unanswered | N:837 (AJ3) |
| answered_plain | any later text | | open turn, no report | answered_plain | N:837 (AJ3) |

Report status: `open`, `held`, `banned`, `dismissed` (RP:8). Staff act on it (`journey-exit-safety.md`).

Invariants:

- R1 Every urgent report by someone who met the subject holds the subject until staff decide (`reportHeld`, N:1295). Holds.
- R2 A `minor` report takes the subject out of matching (AGENTS). Holds, with AJ1 false positives.
- R3 The reporter's words are not stored: ids and kind only (RP:2). Holds.
- R4 Same report words give same effects on both paths. Fails (AJ12).
- R5 A positive answer files no report. Fails (AJ1).
- L1 A disclosure inside the promised window reaches staff. Fails (AJ3).

Failure: the unit is atomic. `recordBlock` writes the edge in the unit. `fileReport` calls `dropMember`, which can send cancellations in the same unit. The order is: reports, then minor, then ack.

Concurrency: both members can answer at the same time. Units are serial, so each sees the other. If each reports the other, both are held. `others` reads status at the answer (N:2598). A subject who dropped is not reported.

Quint: model the classifier as a nondeterministic input: `{plain, report(kind), falsePositive(kind)}`. Check R4 and L1 as temporal properties. Merge with `journey-exit-safety` report states.

### 4.6 `slop-review-hold` (P0)

`reviewReason` is a derived state, evaluated at each engine run. Order matters (SR:47-60).

| State | Condition | Writer of the input | Reachable |
|---|---|---|---|
| `review_confirmed` | tag `review:confirmed` | none | no |
| `verification_failed` | `verify:*:fail`, not cleared | staff `verify` (SV:1635) | yes |
| `unverified` | `verification.required` | option false (founder decision 9) | no |
| `safety_review` | `safety:*` cue, not cleared | none | no |
| `trust_review` | see below | `blocked` edges, `no_show` rows | yes |
| none | | | yes |

Trust branch with defaults (`options.ts:151`): `negativeFrom: 0` off, `blockedBy: 2`, `noShows: 2`, `eagerYes: 0` off.

Exits: `verification_failed` leaves when staff record a pass for that check, because `verify` upserts one facet per check (SV:1642-1645). `trust_review` has no exit (AJ2).

Invariant wanted: every held member has a staff-visible reason and a staff exit. Fails.

Quint: small. One member, inputs `blocks`, `noShows`, `tags`. Check `held => EF notHeld or staffVisible`. Keep alone, then link to `trust` from `network-consent-core`.

### 4.7 `slop-member-history` (P1)

Derived in `histories` (SP:232-276). Which inputs have production writers:

| Field | Source | Production writer |
|---|---|---|
| `yes` | `acceptedBy` | none for slop (only the peon `:seat` row) |
| `no` | outcome `declined` | none: no caller passes that reason (D13) |
| `backouts` | `cancelled` with `declinedBy` | never: status is never `no` (D13) |
| `silent` | `noResponse` | none |
| `dates` | `completed` | one per answer (AJ5) |
| `noShows` | `no_show` | one per self-report, all participants (AJ5) |
| `negativeFrom`, `rated` | `feedback` | yes |
| `blockedBy` | `blocked` edges | yes |
| `attendedSlots` | `completed.at` | wrong clock (AJ21) |
| `lastDateAt`, `liked` | `completed`, `wouldMeetAgain` | yes, but `liked` needs the answer to follow |

The sim writes all of these, so sim gates exercise paths that production cannot reach. `attraction` is off, which limits the harm.

Quint: not a machine to model alone. Use the table as a check: for each engine read, name a production writer.

### 4.8 `slop-pair-reprobe` (P1)

Pair states: `fresh`, `engine_cooldown` (7 days), `engine_open_gate_closed` (day 7 to 60), `open`, `revealed_never`.

| From | Event | To | Where |
|---|---|---|---|
| fresh | "no" | engine_cooldown, `declined[k] = now` | N:2328, SR:97 |
| fresh | silence | engine_cooldown, no `declined` | N:3373-3384 |
| engine_cooldown | 7 days, after "no" | engine_open_gate_closed | SR:97 |
| engine_cooldown | 7 days, after silence | open | SR:97 |
| engine_open_gate_closed | engine selects it | same, gate drop (AJ6) | N:3607 |
| engine_open_gate_closed | 60 days | open | N:1749 |
| any | reveal | revealed_never | SR:96 |

Invariant wanted: if the engine may propose a pair, the gate must accept it. Fails.

Quint: two counters and two thresholds. Check `engineEligible => gateAccepts`. Then a three-member liveness check: `F(proposed(a, e))` while `e` is free.

## 5. Peon seat: the machines

### 5.1 `peon-candidate-onboarded` (P1)

States: `member_no_facts`, `candidate_profile`, `searching`. Production reach: `member_no_facts` only (AJ7). Exits exist only in fixtures. Consumers: `peon_not_onboarded`, `not_searching`, all pair rules.

Quint: state as a reachability assumption. Do not model further until a writer exists.

### 5.2 `peon-employer-verified` (P1)

States: `unverified`, `verified`. No revoke path: nothing deletes the facet, except the replace in `verifyEmployer` and the forget path.

| From | Event | Guard | To | Where |
|---|---|---|---|---|
| unverified | staff verify | admin, `company`, note of 5+ chars, `managerProblem` | verified | PO:114-123 |
| verified | staff verify again | same | verified, new facts | PO:56-59 |

The route is dead (AJ8). The pair of `delete` and `insert` in `verifyEmployer` run in one `rt.scoped` transaction. The audit runs after, outside it. A crash between them leaves a verified employer with no audit row. The check `managerProblem` and the write are in different transactions (PO:119-121), so a hold in between is missed.

A seat reads `peon:verified` at snapshot time (PS:75). So a verified company stays verified, whatever happens later, unless a staff hold stops it at the gate.

### 5.3 `job-posting-draft` (P1)

Builds on core 3.21. State: `MemberState.posting` and `awaiting`.

States: `none`, `collecting(asks)`, `ready_new`, `ready_update`, `ask_which_close`, `ready_close`.

| From | Event | Guard | Effects | To | Where |
|---|---|---|---|---|---|
| none | posting command | `managerProblem` clear | draft, question | collecting | N:4629-4638, J:148-183 |
| none | command, all fields | clear | read-back | ready_new | J:182 |
| none | "update my..." | one match | read-back | ready_update | J:168-176 |
| none | close command | one open | read-back | ready_close | J:151-158 |
| none | close command | several open | | ask_which_close | J:157 |
| none | close command | none open | reply, no draft | none | J:153 |
| collecting | text with a field | asks at most 2 | question or read-back | collecting, ready | N:4632-4638 |
| collecting | third question due | asks over 2 | "OK, I didn't post" | none | N:4634 |
| collecting | unrelated text | | clear, handled as usual | none | N:4628 |
| ready_* | yes | `yesNoOf` | `applyPosting`, reply | none | N:4616-4623 |
| ready_* | no, no digits | | dropped | none | N:4625 |
| ready_* | correction | | new read-back | ready | N:4627 |
| ask_which_close | names one | | | ready_close | J:160-164 |
| any | 3 days | | `awaiting` cleared, `posting` stale | none | N:3285 |
| any | a probe sent | `awaiting` overwritten | draft orphan | none (D5) | N:4055 |
| any | MCP text | no source check | D4 | as text | N:755 |

Invariants: D1 nothing is saved without an explicit yes (J:13). Holds for text, with D4 as the gap. D2 a posting needs title and pay (`job_without_pay`, PRD 40.6). Holds. D3 only an adult can post. Holds. D4 a draft that cannot match is not called posted. Fails (AJ9). D5 a yes to a read-back is never a yes to a probe. Depends on the slot (D5).

Failure: see AJ10. Otherwise the draft is plain JSON in the state row, and it is atomic with the unit.

Quint: a small state machine per manager, with the `awaiting` slot shared with `reply-router`. Merge with `reply-router`.

### 5.4 `job-posting-record` (P1)

States: `absent`, `active`, `closed`. `paused` is allowed by SQL and by `Intent`, but has no writer. `postingFromFacts` reads it as closed.

| From | Event | Guard | Effects | To | Where |
|---|---|---|---|---|---|
| absent | yes on a draft, or staff | `postingProblem`, `managerProblem`, owner | `onPosting`, log | active | N:4591-4603 |
| active | update | same | rows replaced | active | PO:26-37 |
| active | close | owner, member exists | `endSeat`, rows | closed | N:4600 |
| closed | staff POST with same id | same as active | `status: active` | active | PO:149 (dead route) |
| any | manager forget | | rows cascade | absent | SN, `forget` |

Never: expiry. `horizonDays: 90` is written (J:229). No code reads it for a seat: `peonSeats` does not check it, and `PP:188` needs only an intent and openings. So a posting never ends by time. A manager who goes silent keeps a live job. Liveness gap; read; high confidence.

Rows: one intent, plus facets tagged `peon:posting:<id>`. `savePosting` does delete then insert in the unit's transaction, so a reader sees all or nothing (SN comment). `network.facets.id` is global, so ids must be unique (AJ10).

Crash windows: staff route (dead today) audits after `unitOfWork`, so a crash loses the audit row. Text path: atomic.

Quint: merge with 5.5. State: `posting: {status, openings}`.

### 5.5 `job-seat-item` (P1)

This is J14 in full. Reproduced with injected facts (`gap/f.ts`), including the texts below.

| # | From | Event | Guard | Effects | To | Where | Who |
|---|---|---|---|---|---|---|---|
| 1 | no item | daily run | seat open, verified, pay, scam cue, pair rules; `seatRoute` finds one manager | participants become candidate and manager, `seat` set | review | N:3460, N:4468 | E |
| 2 | no item | no owner | | `seat_without_manager` | none | N:3461 | E |
| 3 | review | approve | `approvalCheck`; manager by `managerProblem` | `begin`, `first` = candidate | probing | N:2083 | S |
| 4 | review | reroll | candidate only; manager never swapped | | review or closed | N:2013 | S |
| 5 | review, probing | posting closed | at once, or at tick | `endSeat`; yes-sayers get `postingClosed` | closed | N:4560, N:4600 | M, C |
| 6 | review, probing | openings used | tick | `endSeat` | closed | N:4552 | C |
| 7 | candidate queued | turn | timing `slot`, no options | `candidateProbe` | candidate probing | N:2160, N:2180, PK:296 | C |
| 8 | candidate probing | yes | | `available`; no picks | manager queued | N:2298 | M |
| 9 | candidate probing | no or silence | no alternates path for a seat | `markDeclined` on no | closed, silent | N:2334, N:2368 | M, C |
| 10 | manager queued | turn | timing `logistics`, not on the cap | `managerProbe`, blind | manager probing | N:2160, PK:300 | C |
| 11 | manager probing | no or silence | | `close("manager unavailable")`; candidate hears nothing | closed | N:2372, M14 | M, C |
| 12 | manager probing | yes | | | reveal | N:2400 | M |
| 13 | manager away | `inNyc` false | | `refuse`, close | closed | N:2176 | C |
| 14 | all available | reveal | `checkRecipient` | invented `meetingAt` (M30), intro names | scheduled | N:2425-2458, PK:302-308 | system |
| 15 | scheduled | meeting time | no reminder for a seat | | scheduled | N:3397 | C |
| 16 | scheduled | T+3 h | | `SEAT_COPY.checkIn` | done | N:3418 | C |
| 17 | done | answer | no report path | feedback row | done | N:2593, AJ4 | M |

Texts seen in the run:

- Candidate: "A verified employer is hiring: data analyst, $90k-$120k, hybrid in Brooklyn. Want me to put you forward? They see only a short summary, never your name, until they say yes too."
- Manager: "A candidate said yes to your data analyst post. Meets 1 of 1 must-haves (sql yes). Can start in 2 weeks. Want an intro? Reply yes or no. You get their name only if you say yes."
- After "no" from the manager, the candidate gets nothing (M14). After both yes, each gets the other's name.

Invariants:

- S1 Candidate first (PRD 40.6): the manager hears nothing before the candidate's yes. `firstOf` and N:2142. Holds, and reproduced.
- S2 The manager's probe has no name, score or rank. Holds. `mustMarks` reads levels and prints yes or no.
- S3 No item for an unverified employer or a job with no pay. Engine rule plus `peonHardGate`. Holds.
- S4 Openings: `filled <= posted`. Can fail between ticks (core 3.22, AJ17). Low.
- S5 The manager is never swapped. Holds.
- L1 A candidate who said yes hears the end. Fails, except on `endSeat` (M14 for seats).
- L2 A posted job with fitting candidates gets a probe. Fails (AJ7, AJ8, AJ9, AJ18).

Interactions: the manager is exempt from `busy` (N:4372), so several items share one `awaiting` slot (D5). This is the sharpest D5 case: two candidates in review at once lose one answer. S2 of `gap/f.ts` ran them one after the other, so it did not show the loss; the loss is from D5, read. The seat ids in `seatView` tie this to `seat-capacity`.

Concurrency: units are serial per network. `applyPosting` and `endSeat` run in one unit. `seatView` rebuilds from `opps`, so it survives a restart.

Quint: two candidates, one manager, one posting with openings 1 or 2. Keep one `awaiting` slot for the manager. Check S1, S4, and "a manager's yes answers the item it was asked for".

### 5.6 `seat-capacity` (P1)

Inputs: `posted` from the intent and facet (PS:79), `fills` (PS:100-111), `filled` (N:4551).

States: `open(left > 0)`, `in_flight_full`, `filled`, `closed`, `vanished` (no seat in the snapshot).

| From | Event | To | Where |
|---|---|---|---|
| open | item enters | in_flight_full when none left | PS:109 |
| in_flight_full | item ends before reveal | open | PS:97-98 |
| in_flight_full | reveal | filled when `filled >= posted` | N:4552 |
| filled | intro closes | open | N:4551 |
| filled | check-in answered | stays filled (`completed`), no exit (AJ11) | PS:108 |
| any | posting closed | closed | PS:79 |
| any | manager age under 18 | vanished | PS:65 |
| vanished | | items end as "posting closed" | N:4548 |

Window: `this.interactions` and `opps` have no time limit in the input (N:3724, N:920), so a `completed` row and a `done` item both hold an opening for good. `recentProposals` has a 30-day window, which is what M13 and `peon/rules.ts:52` read.

Quint: abstract `left = posted - |fills|`. Check `|filled| <= posted` and `posted > 0 and no fills and candidates => EF proposal`.

### 5.7 `crew-offer-and-crew` (P2)

Builds on core 3.23. Reachable on ntwrk and friends only. Not on slop or peon: `plans: false` means no `o.plan`, and `crewCheck` needs it (N:3163).

Offer: `open(offered, yes, no)`, `resolved`. Crew: `formed`, `handedOff`. Session: plan through review.

| From | Event | Guard | Effects | To | Where |
|---|---|---|---|---|---|
| none | plan answer `again` | at least `minMembers` | offer, texts | open | N:3176-3188 |
| open | a later `again` | same plan, not resolved | added to offered | open | N:3171-3174 |
| open | answer | in offered, not answered | yes or no | open | N:3192-3199 |
| open | all answered | | `resolveCrew` | resolved | N:3199 |
| open | 3 days | at the daily plans step | `resolveCrew` | resolved | N:3221 |
| open | member dropped | | removed from lists | open | N:964 |
| resolved | at least `minMembers` yes | | `crews.push`, `crewFormed` | formed | N:3204-3210 |
| resolved | fewer | | `crewNotFormed` to yes-sayers only | none | N:3210 |
| formed | daily step | no open session, 3+ `planSeatOk` members, new start | `sessions.push`, `submitPlan` | formed | N:3222-3236 |
| formed | sessions reach 3 | | `handedOff`, log only | handedOff | N:3235 |

Defects: AJ23, D17. Offers wait while plans do not run (core 3.23).

Quint: small, P2. A bounded model of 4 members and 3 sessions shows AJ23. Only worth it after the plan lane is modelled.

## 6. Quint plan for this area

Order:

1. `slopCheckIn.qnt` (4.5, P0). Nondeterministic classifier input. Show AJ1 as a state where `minor[b]` holds with `trueAge[b] >= 18`, and AJ3 as a trace with a disclosure and no report. Bounds: 2 members, 1 item, 3 messages.
2. `slopHold.qnt` (4.6, P0). Show AJ2: `held` with no exit. Bounds: 3 members.
3. `pairReprobe.qnt` (4.8, P1). Show AJ6 as a liveness failure. Bounds: 4 members, a 70-day counter in steps of 1 day.
4. `seatFlow.qnt` (5.3, 5.4, 5.5, 5.6, P1). One manager, 2 candidates, 1 posting. Include the shared `awaiting` slot. Assumptions as parameters: `candidateWriter`, `verifyRoute`, so the model shows L2 failing today and passing once those exist.
5. `slopDate.qnt` (4.1, 4.4). Merge with `match-to-meeting`.
6. `probePhoto.qnt` (4.2). A pure guard. Do this before anyone turns on the flag.

Abstractions: time as discrete ticks with named deadlines (26 h, 3 days, 7 days, 60 days). Text as a small enum of classifier results. One store lock, so each action is one atomic unit, except where a report above names a gap between units.

Invariants to carry to the shared library: `noContactBeforeApproval`, `minorNeverMatched`, `everyHoldHasAnExit`, `engineEligibleImpliesGateAccepts`, `promiseImpliesPath` (any text that promises a next step must have a transition that can do it). AJ3, AJ4, AJ23, AJ24 and M14 are all failures of the last one.
