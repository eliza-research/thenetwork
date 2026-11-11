# Wave 3 sweep: packages/engine/src (packs, slop/peon/friends, options, onboarding, relay policy, probes, pause paths)

Hand-written. Read-only research on branch claude/quint-state-machines (no file in the repository changed).
Inputs read: docs/research/2026-11-07-state-machines.md (sections 2, 5, 6, 6.18), docs/research/state-machines/engine.md,
gap-app-journeys.md, the quint-findings for matching_engine, relay, plan_run, plan_crew, safety_trust, photos_rating,
quint/*.qnt on this branch, and on claude/formal-main: docs/results/2026-11-09-quint-drift.md, quint/drift.json,
docs/formal-coverage.md (it has 12 more models: candidate_pool, engine_rules, chatjson_loop, review_desk, ...).
Not re-reported: the formal-main fixes (auth_edge rotateSession, invite_only declineUnderAge), the known register rows
(D1-D30 of engine.md, SD-331, SD-418, SD-419, SD-060, D18 review latch), and the formal-main open drift for
matching_engine (per-question ask caps, late-read guard, soft questions). No quint command was needed: every gap
below is a missing state or action, read from the model sources.

Coverage rule used: a machine is covered only if a model has its states and transitions. The formal-coverage ledger
on formal-main marks every engine file "covered" at FILE level; several of those rows point at a model that holds
the machine only as an oracle. Those are reported as model_gap.

## 1. New machines (no model has their states)

### N1. Relay rate window per sender per match (P1) -> extend quint/relay.qnt
- Where: packages/engine/src/relay.ts:97-115 (RelayLimits, RELAY_LIMITS), :372-377 (the four rate rules),
  :391-392 (a rate-only hold gets its own notice); packages/network/src/relay.ts:396-398 (staff release re-judges
  "at the original time", history = the whole log of the match, :228).
- States per (sender, match): counts of attempts in the last 10 min (burst, n=6), in 24 h (daily, 40), passed
  photos in 24 h (6), delivered contact shares (1, a block family reason, so permanent per match).
- Transitions: every relay attempt appends a log row (pass, hold or block all count for burst and daily; only
  passed photos and delivered shares count for the other two); the item's own id is excluded (replay safe);
  RelayDesk.unsent rewrites a lost share to contactShared=false (SD-252 fix), which reopens the share slot.
- Rules: relay.ts header item 6; founder decision 9 (one number share per match, both consented);
  relay.qnt photoRetryAfterRateHold (SD-320).
- Today relay.qnt has "rate" only as one oracle outcome of textDecision (relay.qnt:208); no counter exists, so it
  cannot show the release-time asymmetry in D2 below, nor that a share lost by the queue may be retried once.
- Quint value: yes, small (two counters and a log of at most 3 rows per sender, already bounded by RELAY_LOG_MAX=3).
  Invariants: atMostOneDeliveredShare(sender, match); rateHoldOnlyFromEarlierAttempts (a rate reason counts only
  rows with at <= item.at).

### N2. Employer probation for peon job seats (P2, local only) -> extend quint/matching_engine.qnt (peon part)
- Where: packages/engine/src/packs/peon/selection.ts:33-41 (probationProbes 3 "a week", probationUntil), :59-71
  (companyTrusted, cached per World), :95-106 (slateCap: min(seat cap, ceil(probation / open seats))), :117-124
  (peonAdjust: -Infinity at cap; `times` is timesSelectedInRun, pack.ts:218); peon/index.ts:36-38 (job seats are
  state "open", budget 1000 per 7 days).
- States per company: probation (no answered application), trusted (answered > 0 under "answered", or a real
  interview under "interview"); back to probation when the answered history row disappears (gap-app-journeys AJ20:
  the ":seat" row with acceptedBy vanishes at the first check-in answer, network.ts).
- Rule: the code comment and docs/results peon Iteration 2: "at most probationProbes probes a week ... until the
  company has answered" (scam reach <= 1 per seed).
- Quint value: moderate; add `trusted: bool`, `probesThisWeek: int` and a daily run action, invariant
  probationWeeklyCap. See suspected defect D3: the cap is per run, not per week.

### N3. Declared pack consent policy (ConsentFlow) (P2) -> no Quint model; a conformance check or deletion
- Where: packages/engine/src/pack.ts:235-244 (probe_first {order, reveal}, double_opt_in {expiresHours},
  application {initiator, reviewer, blindReview, stages}, group_rsvp {quorum, lateJoinHours});
  packs/network/index.ts:80 (group quorum 3, event_coattend quorum 2), packs/friends/index.ts:101,
  packs/slop/index.ts:142-147 (probe_first wanter_first, reveal opt_out), packs/peon/index.ts:97-101 (stages).
- Readers: only attention.ts:799-803 startProbeFlowFor (LIBRARY: no production caller), and it reads only `kind`
  and `order`. `quorum`, `lateJoinHours`, `expiresHours`, `reveal`, `stages`, `blindReview` are read by nothing.
  startProbeFlow hard-codes the group quorum max(3, ceil(0.66 n)) (attention.ts:787), so the network pack's
  event_coattend quorum 2 is never honoured even in the library. The production consent machine is the network
  Opp (opportunity.qnt, plan_run.qnt) with PlansConfig quorum and lateJoinHours (config.ts:443, 494).
- validatePack (pack.ts:342-358) asserts the core age invariants, but only scripts/sim/conformance.ts calls it; the
  service builds makeSlopPack({ verification: { required: false } }) in service/packs.ts:67 and never validates it.
- Why not Quint: the declared flow has no runtime; a model would prove a value nothing reads. Recommend: either
  delete the unused fields (simplify-first rule) or add a sim gate that the Opp machine's quorum, lateJoinHours and
  probe order equal each pack's declared ConsentFlow, and call validatePack where the service builds packs.

## 2. Model gaps (a model owns the machine but misses part of it)

### G1. quint/relay.qnt: the Clef classifier availability states are an oracle (P1)
- Where: packages/engine/src/relayClef.ts:262-301 (clefRelayClassifier: cache lookup, live call with a 2.5 s
  race, fallback), :255 (RELAY_HIGH_RISK_CUE), :272-276 (fallback: hold `clef:unavailable` only when the cue
  matches, else no flags); packages/engine/src/relay.ts:427-447 (relayItemAsync: a thrown hook is `llm:error` hold
  unless failOpen); packages/network/service/relay-endpoint.ts:82-112 (env selection).
- States: unconfigured-dev (rules only), unconfigured-prod (hook always throws: every text the rules pass is held),
  configured-up (Clef decides: hold, block, uncertain), configured-degraded (timeout, HTTP error: no-cue texts pass
  on rules alone; cue texts held).
- AGENTS.md says production "fails closed" without Clef. With Clef configured but down, the same production fails
  open for texts with no cue. The cue regex runs on the raw text, while the rules run on textVariants (homoglyphs,
  leetspeak), so an obfuscated money ask that the rules miss also misses the cue. Rules alone are ~50-60% on unseen
  phrasing (AGENTS.md Relay #7).
- relay.qnt:14 and :207-219 keep relay-classifier-hook as six oracle outcomes; no env or availability variable
  exists, so no property can say "in production, a passed text was read by Clef or carried no cue".
- Proposal: add `clefEnv in {off, prodClosed, live}` and `clefUp: bool` to relay.qnt, a ghost `passedUnread`, and a
  named (non-safety) value `prodNoUnreadPass` until a founder decides whether degraded mode should hold everything.

### G2. quint/photos_rating.qnt: the rater call cannot hang (P1)
- Where: packages/engine/src/packs/slop/clef.ts:200-203 (WorkersAIClefRater.ask calls clefRun with no AbortSignal),
  :154-164 (clefRun passes `signal` only if given); ClefRaterOptions (:167-176) has no timeout, unlike
  ClefRelayOptions.timeoutMs. packages/platform/src/photos.ts:126-131 retries TimeoutError and AbortError, :143-155
  withRetry, :547 the upload handler awaits `this.rate(...)` before it answers.
- photos_rating.qnt:296 models the rater as "a score, null or an error". A stalled Workers AI call is a fourth
  outcome: nothing aborts it, withRetry's timeout branch is dead, and the upload response waits (see D4).
- Proposal: add outcome `hang` with a `stalled` flag on the in-flight rating; liveness witness "an upload answers".

### G3. quint/plan_run.qnt: partner plans are left out, but they are wired (P1)
- Where: packages/engine/src/plans.ts:335-366 (planner makes a partner plan of 2 when no group clears; config.ts:496
  partnerPlans: true), :545-549 (startPlanRun probes only invited[0]; bench = partner + alternates), :577-591
  (first yes -> probe_partner before the deadline; a no from the first closes, a no from the partner backfills
  the next alternate); network.ts:3105-3108 (planProposals in production), :3134 (startPlanRun), :3218-3229
  (planAct probe_partner and backfill), :3169 (item stage "partner").
- plan_run.qnt:24-26 says "Partner plans are not modelled" and the network "never runs the fallback's partnerPlan"
  (SD-008). That is true for partnerPlanFor, but the planner's own partner plans run through the same beginPlan /
  planAct path. The one-to-one consent order (partner probed only after the first's yes; the first's no ends it;
  nobody named before both yes) is the core invariant 6 (pack.ts:20) and has no model.
- Proposal: add `partner: bool` to the plan in plan_run.qnt, a sequential first/partner stage, and invariants
  partnerNotBeforeFirstYes and firstNoCloses; witness: a partner plan books.

### G4. quint/matching_engine.qnt: the slop "extra asks" ladder is partial (P2)
- Where: packages/engine/src/packs/slop/index.ts:121-140 (extraAsks: hard fields weekly, capped by
  maxAsksPerField; widen once ever; basics and type every 21 days, capped), rules.ts:28-40 (missingFields),
  :74 (needs_answer holds the member), options.ts:157 (silentFallback.enabled false), :190 (widen 25 mi);
  network/service/packs.ts:126-130 (a "yes" to slop_widen sets radius 25).
- The model has the basics ask (SD-419) and the location ask with its 7-day fallback. It has no orientation,
  age_range or distance asks (the `core` bit is set by the reader only), no widen ask and its yes -> 25 mi change,
  and no type ask. With silentFallback off, a capped unanswered orientation / age_range / distance leaves the member
  in needs_answer with no further ask (by design per engine.md section 16; not a new defect). The widen yes changes a
  hard filter (the radius) through a yes/no read, with no read-back.
- Proposal: one `hardAsk` counter per field, `widenAsked`, and an invariant widenOnlyRaisesRadiusOnYes (a plain
  "yes" to the widen ask is the only path from <25 to 25 without the member stating a distance).

### G5. quint/matching_engine.qnt: probe-flow groups (P2, LIBRARY)
- Where: packages/engine/src/attention.ts:781-831. The model's flowStart takes 1 or 2 participants; the group
  branch (quorum, close when yes + pending < quorum, reveal only to yes-sayers) is not modelled. recordProbeAnswer
  (:810) accepts a second answer from the same member while the stage is open (no `answers[member] === pending`
  guard), so a yes can be flipped to no and close a group. Library only today: model it when it is wired (6.18).

### G6. Slop assignment (M-162) and attention-compose (M-163) are mapped to matching_engine but absent (P2)
- slop/assign.ts:62-121 rounds (perMemberPerTick, backup round when backupMaxDegree > 0) and stableRound
  (:138-222) are one nondeterministic "engine pick" in slopDailyRun. The selectionGuard and greedyPick LemmaScript
  cores (formal-main) cover the arithmetic, so Quint adds little; keep as an oracle, but correct the ledger text.
- attention.ts:469-550 composeMessage is wired on the plan allowance path only (network.ts:3170-3174); plan_run.qnt
  treats the allowance as a deferral oracle. No model has the gate order (paused -> only-when-asked/two-unanswered
  -> streak -> quiet -> cap -> break-in -> item gates). Value is low while one path uses it; record it as an oracle.

## 3. Suspected defects

### D1. Duplicate-send check never matches an unsolicited message (P2, pause path)
- Where: packages/network/src/network.ts:4184-4188 compares `m.lastSent.body === text` BEFORE the pause path is
  added at :4194-4195 (`text = attention.withPausePath(text)`), and :4205 stores `lastSent.body = text` AFTER it.
  engine attention.ts:956-958 withPausePath appends "Reply STOP anytime to opt out." unless the body already has one.
- Trigger: member idle past REPLY_WINDOW (unsolicited(m) true, network.ts:4252-4262); the same unsolicited text with
  no onSent hook is sent twice within 10 minutes (for example two deferred copies flushed at the same tick, or a
  retried info send). First send stores "<body> Reply STOP anytime to opt out."; the second compares "<body>" with
  it, finds no match, and sends again. The guard works only for solicited sends.
- Detection gap: sim.md notes the World logs duplicate_send but the judge never reads it, so no gate catches this.
- Fix shape: compare after the pause path (or compare withPausePath(text)); add a scenario that fails before.

### D2. Released held photo is judged against later photos (P2, relay rate)
- Where: packages/engine/src/relay.ts:376: the photo rule filters `item.at - h.at < 86_400_000` with no `>= 0` lower
  bound (burst and daily at :374-375 have it); network/src/relay.ts:398 re-runs relayItem at `h.at` with the full
  match log (:228).
- Trigger: A sends photo P1 with a caption that is held (for example "rating" or "contact" words); A then sends 6
  photos that pass the same day; staff release P1. The re-judgement counts the 6 later passed photos (negative
  difference) -> rate:photos -> hold; release() renders "" for a photo hold (:399-401), marks it released and
  delivers nothing. The same item released before the 6 later photos would have gone out. Inside the SD-320 area,
  but this asymmetry is new. Small fix: add `item.at - h.at >= 0` as in the other two rules.

### D3. Peon probation cap is per engine run, the documented cap is per week (P2, local only)
- Where: peon/selection.ts:33-41 ("at most probationProbes probes a week"), :103-105, :123 (`times` counts this run
  only); peon/index.ts:37 (seats in state "open": 1000 per 7 days, so no member budget limits them);
  network.ts:3512-3513 (the service runs the engine once a DAY, lastRunDay); packages/sim/src/apps/peon/world.ts:1
  (the sim runs weekly rounds, so per run == per week there, which is where 3 was tuned).
- Trigger: an unverified, untrusted employer posts a role with 5 openings; in the service each daily run may select
  min(5, ceil(3/1)) = 3 candidates; declines and expiries free seats (seats.ts:99-111), and pendingReview is never
  written (AJ20), so the next day allows 3 more. Up to ~21 probes a week instead of 3. Scam reach was gated in the
  weekly sim only. Needs a run of the service harness with daily ticks to confirm the count.

### D4. Photo upload can wait forever on a stalled Clef call (P1 if CLEF_RATINGS on in production)
- Where: engine slop/clef.ts:200-203 (no signal, no timeout), platform photos.ts:547 (upload awaits the rating),
  :126-131 (retryable expects a TimeoutError that nothing raises).
- Trigger: Workers AI accepts the TCP connection and never answers (or answers very slowly). The upload's HTTP
  response waits for up to 4 sequential calls (maxPhotos 4) x 3 tries; with no timeout, until the runtime's own
  fetch limit, if any. The relay hook in the same module bounds its call at 2.5 s, so the rater is the odd one out.
  Confirm with a fetch stub that never resolves (photos integration test); if Bun's fetch has no default timeout,
  the request never answers.

## 4. Checked and not reported (already known or not a defect)
- Onboarding vs engine ask counters: both write this.asks and ob.asked (network.ts:4370-4380), so the counts agree.
- vocabGuard WeakMap keyed by Set and validated by size (judgeCommon.ts:214-221): every caller builds a fresh set
  per candidate and never mutates it after the call; no stale guard path found.
- Judge pass failure fails open to the pre-judge outcome (engine.ts:178-191, 203): design, human review follows.
- Exposure debt is persisted (network.ts:4965, 5021) and filtered to adults (:4013).
- slopProfiles / friendsInfo / peon worldScratch caches are keyed by an immutable input or World: no TTL state.
- startPlanRun without canMatch (SD-331, refuted), review tag latch (D18), read-back cap (SD-418), capped hard-field
  lockout with silentFallback off (engine.md section 16, by design).
