# Matching, interviews, and job seats

## Story: Matching, interviews, and job seats

A member needs a match that fits their app, profile, preferences, and availability.

### Safety rules and reachability

Check candidate eligibility, profile corrections, consent flow, matching budgets, and job-seat capacity. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/matching_engine.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=40 max-samples=4000 verify-steps=6
//
// The matching engine and the app packs as the ConsentNetwork drives them (module plan:
// docs/research/2026-11-07-state-machines.md section 6.16). Machines: engine-pipeline, hard-filter-chain,
// slop-onboarding, probe-flow, global-selection, judge-passes-and-cache, slop-assignment, job-posting,
// job-seat-item, peon-candidate-onboarded, peon-employer-verified, slop-time-venue-booking,
// slop-pair-reprobe. The model follows the code as it is now (branch wave2/matching_engine: base ad67275
// plus the defect fixes listed in docs/research/quint-findings/matching_engine.md).
//
// Abstractions (quint/README.md rule 7):
//   - Scores, the orientation check and the readers (extract.ts readMessage, jobs.ts parsePosting) are
//     oracles: a message is one nondeterministic "kind", and the engine picks any eligible pair.
//   - Time is a day count. Ticks are 1, 3, 7 or 30 days.
//   - slop: three adults a, b, c and one member k aged 15. Only b smokes. The five hard fields are two
//     bits: `core` (gender, seeks, age range, distance) and `loc` (a placeable location).
//   - peon: one hiring manager with postings A and B, and one candidate.
//   - The engine run and the Network gate of one daily run are one action (in memory, then one unit).
//
// Values that are not in `safety` (each one names a defect that is not fixed, and why):
//   readBackBeforeMatch (SD-060, skipped: founder decision), readBackHasPath (SD-418, not reproduced:
//   the designed read-back cap), locatedBeforeMatchStrict (the 7-day silent fallback of the SD-209 fix,
//   by design), noBasicsAfterAnswer (the SD-419 fix bounds the ask, it does not remove it),
//   activeIsLive (SD-121, skipped), postedCanMatch (SD-226, skipped), candidatesWritable (SD-224,
//   skipped), inFlightMatchesPosting (SD-440, skipped).
module matching_engine {

  // ------------------------------------------------------------------ constants
  pure val NONE = -1000
  pure val SLOP_MEMBERS = Set("a", "b", "c", "k")
  pure val SLOP_ADULTS = Set("a", "b", "c")
  pure val AGE = Map("a" -> 30, "b" -> 28, "c" -> 32, "k" -> 15)
  pure val SMOKERS = Set("b")
  pure val PAIRS = Set(("a", "b"), ("a", "c"), ("b", "c"), ("a", "k"), ("b", "k"), ("c", "k"))
  pure val MAX_ASKS = 2            // extract.ts:44 MAX_ASKS_PER_QUESTION (read-back cap: service/packs.ts:140); options.ts:176 maxAsksPerField
  pure val REPROBE_DAYS = 7        // packs/slop/options.ts:158 reprobeAfterDays
  pure val GATE_DAYS = 60          // network.ts:481 PAIR_HISTORY_DAYS (gate and avoid edges)
  pure val BUDGET_N = 2            // outreach.ts:20 budget.normal n=2 over 7 days; slop SLOP_ENGINE_CONFIG budgets limit 2 / 7 days
  pure val BUDGET_DAYS = 7
  pure val SWEEP_DAYS = 3          // network.ts awaiting cleared after 3 days
  pure val SILENT_DAYS = 7         // packs/slop/profile.ts SILENT_AFTER_DAYS
  pure val BASICS_EVERY = 21       // packs/slop/index.ts:139
  pure val JUDGE_TTL = 7           // config.ts:183 judge.ttlMs = 7 days
  pure val HORIZON = 90            // jobs.ts intent horizonDays 90; world.ts live intents only
  pure val MAX_NOW = 150
  pure val POSTINGS = Set("A", "B")
  pure val MESSAGE_KINDS = Set("core", "coreChange", "loc", "dbAdd", "dbRemove", "dbNone", "goal", "yes", "no", "nothing")
  pure val FOCI = Set("slop", "slopSafety", "peon", "peonSafety", "flow", "plan")

  // ------------------------------------------------------------------ types
  type Ob = { core: bool, loc: bool, confirmed: bool, readBacks: int, db: bool, noDb: bool, goal: bool }
  type Opp = { stage: str, at: int, everBooked: bool }
  type Slop = {
    minor: str -> bool, held: str -> bool, ob: str -> Ob, tags: str -> Set[str],
    // awaiting: the open wait ("none", "readback", "question"); askedField: what the last ask was about
    // ("none", "readback", "core", "loc", "goal", "db", "basics"); pendingAsk: the last ask is unanswered.
    awaiting: str -> str, awaitingAt: str -> int, pendingAsk: str -> bool, askedField: str -> str,
    // The first slop_location ask, and whether any of them was answered (profile.ts silentAsks).
    locAskAt: str -> int, locAnswered: str -> bool,
    lastBasicsAsk: str -> int, basicsAsks: str -> int,
    opp: (str, str) -> Opp, netDeclAt: (str, str) -> int, engDeclAt: (str, str) -> int,
    // sentTimes: invites sent (the Network budget); billed: per pair, the proposals the engine counts.
    sentTimes: str -> List[int], billed: (str, str) -> List[int],
    judgeOn: bool, judgeLast: (str, str) -> int
  }
  type SlopHist = {
    lostAnswer: bool, matchedUnconfirmed: bool, matchedUnlocated: bool, matchedUnasked: bool,
    matchedMinor: bool, matchedHeld: bool, gateDisagree: bool, selectedOverBudget: bool,
    hikeAtNight: bool, bookedConfirmed: bool, judgeRepeat: bool, basicsAfterAnswer: bool, lateRead: bool
  }
  type Posting = { status: str, openings: int, stated: int, reason: str, createdAt: int, version: int, seniority: bool, areaOk: bool }
  type Draft = { kind: str, id: str, openings: int, seniority: bool, areaOk: bool, mustDup: bool, said: str }
  type Seat = { stage: str, yesVersion: int }
  type Peon = {
    env: str, posting: str -> Posting, draft: Draft, verified: bool, candOn: bool, mgrHeld: bool,
    // A no is kept per seat (network.ts seatSide, markDeclined): the pair is (candidate, seat).
    seat: str -> Seat, declAt: str -> int, introduced: Set[str]
  }
  type PeonHist = {
    reopened: bool, openingsLost: bool, mcpConfirmed: bool, filledLost: bool, saveFailed: bool,
    crossJobBlock: bool, engineSelectedHeld: bool, seatFilled: bool
  }
  type Flow = { n: int, stage: str, answers: str -> str }
  type PlanFacts = { minor: bool, budgetFull: bool, reliabilityHold: bool }

  // ------------------------------------------------------------------ state
  var now: int
  var slop: Slop
  var sh: SlopHist
  var peon: Peon
  var ph: PeonHist
  var flow: Flow
  var plan: PlanFacts
  var lastAction: str
  // The parts share only `now`, so a trace that steps one part (and time) covers all its behaviours.
  // "slopSafety" is "slop" plus holds and late minor ages, "peonSafety" is "peon" plus the manager's
  // hold; "slop" and "peon" leave them out so that deep
  // witnesses stay reachable by random simulation.
  var focus: str

  // ------------------------------------------------------------------ slop helpers
  pure val emptyOb: Ob = { core: false, loc: false, confirmed: false, readBacks: 0, db: false, noDb: false, goal: false }
  pure def has(p: (str, str), m: str): bool = p._1 == m or p._2 == m
  pure def isOpen(stage: str): bool = stage == "review" or stage == "probing" or stage == "scheduled"  // network.ts OPEN_STAGES
  pure def window(l: List[int], t: int, days: int): int = l.select(x => t - x < days).length()
  pure def listHas(l: List[int], v: int): bool = l.foldl(false, (acc, x) => acc or x == v)

  // extract.ts mergeReading for one message kind (the reader is the oracle).
  pure def applyKind(o: Ob, k: str): Ob =
    if (k == "core" or k == "coreChange") { ...o, core: true }
    else if (k == "loc") { ...o, loc: true }
    else if (k == "dbAdd") { ...o, db: true, noDb: false }
    else if (k == "dbRemove") { ...o, db: false }               // "smoking is fine": removed, noDealbreakers stays unset
    else if (k == "dbNone") { ...o, db: false, noDb: true }
    else if (k == "goal") { ...o, goal: true }
    else o
  // extract.ts stripMeta: only the hard fields and the age reset a confirmation.
  pure def changedHard(o: Ob, k: str): bool =
    k == "coreChange" or (k == "core" and not(o.core)) or (k == "loc" and not(o.loc))
  // onboard.ts view(): any field change.
  pure def changedAny(o: Ob, k: str): bool =
    changedHard(o, k) or (k == "dbAdd" and not(o.db)) or (k == "dbRemove" and o.db)
    or (k == "dbNone" and (o.db or not(o.noDb))) or (k == "goal" and not(o.goal))
  // The onboarding state after one answer to a wait `aw` (onboard.ts:89-95 after a read-back, else extract.ts:864).
  pure def readAnswer(o: Ob, aw: str, k: str): Ob =
    val conf = if (aw == "readback") (if (changedAny(o, k)) false else k == "yes")
               else (if (changedHard(o, k)) false else o.confirmed)
    { ...applyKind(o, k), confirmed: conf }
  // extract.ts slopOnboardTags, then network.ts learnAppTags (keep, replace, add). Fixed (SD-061, 8a14083):
  // `replaces` always holds "slop:dealbreaker:" (extract.ts:941), so a dealbreaker taken back drops its tag.
  pure def tagsAfter(old: Set[str], o: Ob): Set[str] =
    val add = Set("core", "loc", "db:smoker", "goal").filter(t =>
      (t == "core" and o.core) or (t == "loc" and o.loc) or (t == "db:smoker" and o.db) or (t == "goal" and o.goal))
    val replaced = Set("core", "loc", "db:smoker", "goal").filter(t =>
      (t == "core" and o.core) or (t == "loc" and o.loc) or t == "db:smoker" or (t == "goal" and o.goal))
    old.filter(t => not(replaced.contains(t))).union(add)

  def adult(m: str): bool = AGE.get(m) >= 18 and not(slop.minor.get(m))
  def inOpen(m: str): bool = PAIRS.exists(p => has(p, m) and isOpen(slop.opp.get(p).stage))
  // world.ts recentProactive: recent proposals minus unsentProposalIds (network.ts:4003, world.ts:179-180; SD-210, SD-262).
  def engineCount(m: str): int = PAIRS.filter(p => has(p, m)).fold(0, (s, p) => s + window(slop.billed.get(p), now, BUDGET_DAYS))
  def sentCount(m: str): int = window(slop.sentTimes.get(m), now, BUDGET_DAYS)
  // profile.ts silentAsks: a slop_location ask at least 7 days old, none of them answered.
  def locSilent(m: str): bool =
    slop.locAskAt.get(m) != NONE and not(slop.locAnswered.get(m)) and now - slop.locAskAt.get(m) >= SILENT_DAYS

  // Engine member view: network.ts packInput (adults only), filters.ts memberReason core prefix (holds),
  // packs/slop/rules.ts needs_answer: missingFields reads tags, and since 60eecb2 (SD-209) also asks for a
  // location (rules.ts:39) unless the location ask went silent for a week. slopAssign skips a member with
  // no budget left (assign.ts:78-79, 8d018ed, SD-207).
  def engineMemberOk(m: str): bool = all {
    adult(m), not(slop.held.get(m)), slop.tags.get(m).contains("core"),
    slop.tags.get(m).contains("loc") or locSilent(m),
    not(inOpen(m)), engineCount(m) < BUDGET_N,
  }
  def locUnasked(m: str): bool = not(slop.tags.get(m).contains("loc")) and not(locSilent(m))
  // The Network gate: network.ts eligible (minor, hold, busy, overBudget) and gateReason (pair_history 60 days).
  def netMemberOk(m: str): bool = adult(m) and not(slop.held.get(m)) and not(inOpen(m)) and sentCount(m) < BUDGET_N
  def pairHistory(p: (str, str)): bool = now - slop.netDeclAt.get(p) < GATE_DAYS
  // packs/slop/rules.ts: already_introduced / reprobe_cooldown (interactions only), dealbreaker on tags,
  // and the avoid edges packInput adds for pairs the gate refuses (network.ts:4050, 8e9120e, SD-223).
  def enginePairOk(p: (str, str)): bool = all {
    not(slop.opp.get(p).everBooked),
    now - slop.engDeclAt.get(p) >= REPROBE_DAYS,
    not(pairHistory(p)),
    not(slop.tags.get(p._1).contains("db:smoker") and SMOKERS.contains(p._2)),
    not(slop.tags.get(p._2).contains("db:smoker") and SMOKERS.contains(p._1)),
  }
  def enginePairs: Set[(str, str)] = PAIRS.filter(p => engineMemberOk(p._1) and engineMemberOk(p._2) and enginePairOk(p))

  // ------------------------------------------------------------------ peon helpers
  // service.ts:2546 registers jobPostingRoutes behind staff auth (f581d75, SD-225): the staff API is served in prod.
  pure val STAFF_API_SERVED = true
  pure val noDraft: Draft = { kind: "none", id: "", openings: 0, seniority: false, areaOk: false, mustDup: false, said: "" }
  pure val noPosting: Posting = { status: "none", openings: 0, stated: 0, reason: "", createdAt: NONE, version: 0, seniority: false, areaOk: false }
  // jobs.ts postingFromFacts and network.ts storedPosting: a closed posting's openings facet is 0, read back as 1.
  pure def storedOpenings(p: Posting): int = if (p.status == "active") p.openings else 1
  def seatDeclined(id: str): bool = now - peon.declAt.get(id) < GATE_DAYS
  // peon/profile.ts p.open, world.ts live intent, peon/rules.ts (job_closed, employer_unverified,
  // seniority_band, locationOk), peon_not_onboarded for the candidate. packInput holds the seat with its
  // manager (network.ts:4028-4035 seatHolds, d2921d3, SD-296), and the (candidate, seat) avoid edge keeps a declined
  // seat out (network.ts:4050 and 2164 with seatSide, c05b9b2, SD-439).
  def engineSeatOk(id: str): bool = all {
    peon.posting.get(id).status == "active",
    now < peon.posting.get(id).createdAt + HORIZON,
    peon.posting.get(id).openings > 0,
    peon.verified, peon.candOn, not(peon.mgrHeld), not(seatDeclined(id)),
    peon.posting.get(id).seniority, peon.posting.get(id).areaOk,
    not(peon.introduced.contains(id)),
  }

  // ------------------------------------------------------------------ probe flow helpers (attention.ts:769-831)
  def toProbe(f: Flow): Set[str] =
    if (f.stage == "probing_first") (if (f.answers.get("x") == "pending") Set("x") else Set())
    else if (f.stage == "probing_partners") f.answers.keys().filter(m => f.answers.get(m) == "pending" and m != "x")
    else Set()

  // ------------------------------------------------------------------ plan seat rule (plans.ts:148-152, filters.ts memberReason)
  // Fixed (7ca8fa2, SD-206): planMemberReason passes the budgets as `forgive`; the later rules still run.
  pure def planReason(f: PlanFacts): str =
    if (f.minor) "underage" else if (f.reliabilityHold) "reliability_holdout" else ""

  // ------------------------------------------------------------------ init
  action initWith(env: str, judgeOn: bool, f: str): bool = all {
    now' = 0, focus' = f,
    slop' = {
      minor: SLOP_MEMBERS.mapBy(m => AGE.get(m) < 18), held: SLOP_MEMBERS.mapBy(m => false),
      ob: SLOP_MEMBERS.mapBy(m => emptyOb), tags: SLOP_MEMBERS.mapBy(m => Set()),
      awaiting: SLOP_MEMBERS.mapBy(m => "none"), awaitingAt: SLOP_MEMBERS.mapBy(m => NONE),
      pendingAsk: SLOP_MEMBERS.mapBy(m => false), askedField: SLOP_MEMBERS.mapBy(m => "none"),
      locAskAt: SLOP_MEMBERS.mapBy(m => NONE), locAnswered: SLOP_MEMBERS.mapBy(m => false),
      lastBasicsAsk: SLOP_MEMBERS.mapBy(m => NONE), basicsAsks: SLOP_MEMBERS.mapBy(m => 0),
      opp: PAIRS.mapBy(p => { stage: "none", at: NONE, everBooked: false }),
      netDeclAt: PAIRS.mapBy(p => NONE), engDeclAt: PAIRS.mapBy(p => NONE),
      sentTimes: SLOP_MEMBERS.mapBy(m => []), billed: PAIRS.mapBy(p => []),
      judgeOn: judgeOn, judgeLast: PAIRS.mapBy(p => NONE),
    },
    sh' = {
      lostAnswer: false, matchedUnconfirmed: false, matchedUnlocated: false, matchedUnasked: false,
      matchedMinor: false, matchedHeld: false, gateDisagree: false, selectedOverBudget: false,
      hikeAtNight: false, bookedConfirmed: false, judgeRepeat: false, basicsAfterAnswer: false, lateRead: false,
    },
    // peon runs locally only (AGENTS.md platform decision 4). "prod": the service as deployed, where
    // nothing writes candidate facts (SD-224). "harness": the integration tests, which seed candidate rows.
    peon' = {
      env: env, posting: POSTINGS.mapBy(p => noPosting), draft: noDraft, verified: false, candOn: false, mgrHeld: false,
      seat: POSTINGS.mapBy(p => { stage: "none", yesVersion: 0 }), declAt: POSTINGS.mapBy(p => NONE), introduced: Set(),
    },
    ph' = { reopened: false, openingsLost: false, mcpConfirmed: false, filledLost: false, saveFailed: false,
            crossJobBlock: false, engineSelectedHeld: false, seatFilled: false },
    flow' = { n: 0, stage: "idle", answers: Set("x", "y").mapBy(m => "none") },
    plan' = { minor: false, budgetFull: false, reliabilityHold: false },
    lastAction' = "init",
  }
  action init = {
    nondet env = Set("prod", "harness").oneOf()
    nondet judgeOn = Set(true, false).oneOf()
    nondet f = FOCI.oneOf()
    initWith(env, judgeOn, f)
  }

  action keepSlop = all { slop' = slop, sh' = sh }
  action keepPeon = all { peon' = peon, ph' = ph }
  action keepOther = all { flow' = flow, plan' = plan, focus' = focus }

  // ================================================================== slop onboarding (slop-onboarding)
  // The loop's next message (service/packs.ts:137-147 next): the read-back while every hard field is set,
  // unconfirmed, asked fewer than MAX_ASKS times and not just answered (`skip`); else a question while a
  // field is missing; else nothing.
  pure def nextMsg(o: Ob, skipReadBack: bool): str =
    if (o.core and o.loc and not(o.confirmed) and o.readBacks < MAX_ASKS and not(skipReadBack)) "readback"
    else if (not(o.core) or not(o.loc) or not(o.goal) or not(o.db or o.noDb)) "question"
    else "none"
  // The answer to what was asked (the reader is an oracle; `answers` false picks any other kind).
  pure def askedKind(o: Ob, aw: str): str =
    if (aw == "readback") "yes" else if (not(o.core)) "core" else if (not(o.loc)) "loc" else if (not(o.goal)) "goal" else "dbNone"
  // The field a message asks about (nextQuestion order: hard fields, goal, dealbreakers).
  pure def fieldOf(o: Ob, msg: str): str =
    if (msg == "readback") "readback" else if (askedKind(o, "question") == "dbNone") "db" else askedKind(o, "question")
  // Send `msg` to m: a read-back counts on the cap (markAsked); either one is an open question
  // (network.ts deferred "ask" hook: an AskRecord with the reason, awaiting interview).
  def sendTo(s: Slop, m: str, o: Ob, msg: str): Slop =
    if (msg == "none") { ...s, ob: s.ob.set(m, o), awaiting: s.awaiting.set(m, "none"), pendingAsk: s.pendingAsk.set(m, false) }
    else {
      val f = fieldOf(o, msg)
      { ...s, ob: s.ob.set(m, if (msg == "readback") { ...o, readBacks: o.readBacks + 1 } else o),
        awaiting: s.awaiting.set(m, msg), awaitingAt: s.awaitingAt.set(m, now), pendingAsk: s.pendingAsk.set(m, true),
        askedField: s.askedField.set(m, f),
        locAskAt: if (f == "loc" and s.locAskAt.get(m) == NONE) s.locAskAt.set(m, now) else s.locAskAt }
    }

  // One inbound text of member m. With an open question (awaiting), the onboarding loop reads it
  // (network.ts onAskAnswer, service/packs.ts:121-136), the tags are persisted at once (learnAppTags), and
  // the same turn sends the loop's next message (onboardNext with skip = the answered question).
  // Fixed (461b02e, SD-427): with nothing awaited, network.ts:863 lateAnswer (1168-1179) still reads the text as the
  // answer to the last unanswered ask when that reading changes the onboarding state.
  action memberSays(m: str, answers: bool, k0: str): bool = all {
    adult(m),
    val o = slop.ob.get(m)
    val aw = slop.awaiting.get(m)
    val effAw = if (aw != "none") aw else if (slop.askedField.get(m) == "readback") "readback" else "question"
    val k = if (answers) askedKind(o, effAw) else k0
    val o2 = readAnswer(o, effAw, k)
    val late = aw == "none" and slop.pendingAsk.get(m) and o2 != o
    val read = aw != "none" or late
    if (not(read)) all {
      slop' = slop,
      sh' = { ...sh, lostAnswer: sh.lostAnswer or (slop.pendingAsk.get(m) and o2 != o) },
    } else {
      val msg = nextMsg(o2, effAw == "readback")
      val s1 = { ...slop, tags: slop.tags.set(m, tagsAfter(slop.tags.get(m), o2)),
                 locAnswered: if (slop.askedField.get(m) == "loc") slop.locAnswered.set(m, true) else slop.locAnswered }
      all { slop' = sendTo(s1, m, o2, msg), sh' = { ...sh, lateRead: sh.lateRead or late } }
    },
    keepPeon, keepOther, now' = now, lastAction' = "memberSays",
  }

  // The first question after the age question, or an engine ask that the loop answers with its own
  // next message (network.ts onInterviewAnswer, sendAsks without skip).
  action agentNext(m: str): bool = all {
    adult(m), slop.awaiting.get(m) == "none",
    val o = slop.ob.get(m)
    val msg = nextMsg(o, false)
    all { msg != "none", slop' = sendTo(slop, m, o, msg) },
    sh' = sh, keepPeon, keepOther, now' = now, lastAction' = "agentNext",
  }

  // network.ts tick: each tick clears an interview or read-back wait older than 3 days (the ask stays unanswered).
  action sweep(m: str): bool = all {
    slop.awaiting.get(m) != "none", now - slop.awaitingAt.get(m) > SWEEP_DAYS,
    slop' = { ...slop, awaiting: slop.awaiting.set(m, "none") },
    sh' = sh, keepPeon, keepOther, now' = now, lastAction' = "sweep",
  }

  // A member states an age under 18 later (the lowest age wins, AGENTS.md platform decision 1).
  action statesMinorAge(m: str): bool = all {
    not(slop.minor.get(m)),
    slop' = { ...slop, minor: slop.minor.set(m, true) },
    sh' = sh, keepPeon, keepOther, now' = now, lastAction' = "statesMinorAge",
  }
  // Trust or report hold (network.ts packInput holds), placed or lifted by another actor.
  action setHold(m: str, h: bool): bool = all {
    slop' = { ...slop, held: slop.held.set(m, h) },
    sh' = sh, keepPeon, keepOther, now' = now, lastAction' = "setHold",
  }

  // packs/slop/index.ts:139 extraAsks slop_basics, sent by network.ts sendAsks when the loop has nothing
  // left to ask. needsBasics (rules.ts) reads tags only: a member who said "no dealbreakers" has no
  // dealbreaker tag and no politics value. Fixed (45c479e, SD-419): at most maxAsksPerField asks.
  def basicsAskDue(m: str): bool = all {
    adult(m), not(slop.held.get(m)), slop.tags.get(m).contains("core"), slop.awaiting.get(m) == "none",
    not(slop.tags.get(m).contains("goal")) or not(slop.tags.get(m).contains("db:smoker")),
    nextMsg(slop.ob.get(m), false) == "none",
    now - slop.lastBasicsAsk.get(m) >= BASICS_EVERY,
    slop.basicsAsks.get(m) < MAX_ASKS,
  }
  action engineBasicsAsk(m: str): bool = all {
    basicsAskDue(m),
    slop' = { ...slop, lastBasicsAsk: slop.lastBasicsAsk.set(m, now), basicsAsks: slop.basicsAsks.setBy(m, n => n + 1),
              awaiting: slop.awaiting.set(m, "question"), awaitingAt: slop.awaitingAt.set(m, now),
              pendingAsk: slop.pendingAsk.set(m, true), askedField: slop.askedField.set(m, "basics") },
    // The loop has nothing left, so the member answered goal and dealbreakers already.
    sh' = { ...sh, basicsAfterAnswer: true },
    keepPeon, keepOther, now' = now, lastAction' = "engineBasicsAsk",
  }

  // ================================================================== slop daily run (engine-pipeline, global-selection, slop-assignment)
  // network.ts dailyRun: runEngine on packInput, then gateReason per proposal, then submit to review.
  // The engine's pick among eligible pairs is the score oracle.
  action slopDailyRun(p: (str, str)): bool = all {
    enginePairs.contains(p),
    val gateOk = netMemberOk(p._1) and netMemberOk(p._2) and not(pairHistory(p))
    // The judge reads every candidate pair of the run. Fixed (cdce14f, SD-420): the judge caches live
    // across daily runs (network.ts:3752 judgeCaches, used at 3710), so a pair judged within the TTL is a cache hit.
    val judged = if (slop.judgeOn) enginePairs.filter(q => now - slop.judgeLast.get(q) >= JUDGE_TTL) else Set()
    all {
      slop' = { ...slop,
        opp: if (gateOk) slop.opp.set(p, { ...slop.opp.get(p), stage: "review", at: now }) else slop.opp,
        billed: if (gateOk) slop.billed.setBy(p, l => l.append(now)) else slop.billed,
        judgeLast: PAIRS.mapBy(q => if (judged.contains(q)) now else slop.judgeLast.get(q)),
      },
      sh' = { ...sh,
        matchedUnconfirmed: sh.matchedUnconfirmed or (gateOk and not(slop.ob.get(p._1).confirmed and slop.ob.get(p._2).confirmed)),
        matchedUnlocated: sh.matchedUnlocated or (gateOk and not(slop.tags.get(p._1).contains("loc") and slop.tags.get(p._2).contains("loc"))),
        matchedUnasked: sh.matchedUnasked or (gateOk and (locUnasked(p._1) or locUnasked(p._2))),
        matchedMinor: sh.matchedMinor or (gateOk and not(adult(p._1) and adult(p._2))),
        matchedHeld: sh.matchedHeld or (gateOk and (slop.held.get(p._1) or slop.held.get(p._2))),
        gateDisagree: sh.gateDisagree or pairHistory(p),
        selectedOverBudget: sh.selectedOverBudget or engineCount(p._1) >= BUDGET_N or engineCount(p._2) >= BUDGET_N,
        judgeRepeat: sh.judgeRepeat or judged.exists(q => now - slop.judgeLast.get(q) < JUDGE_TTL),
      },
    },
    keepPeon, keepOther, now' = now, lastAction' = "slopDailyRun",
  }

  // network.ts review: approve begins the probe (the first member's invite counts on the budget,
  // outreach.ts:14-17); reject or SLA expiry closes it unsent and marks the pair declined (an avoid edge
  // for 60 days). Fixed (3c059f6, SD-210 and SD-262): the item is in unsentProposalIds, so the engine
  // no longer counts it (the model drops the proposal's own billed entry).
  action slopReview(p: (str, str), approve: bool): bool = all {
    slop.opp.get(p).stage == "review",
    if (approve) all {
      slop' = { ...slop, opp: slop.opp.set(p, { ...slop.opp.get(p), stage: "probing" }), sentTimes: slop.sentTimes.setBy(p._1, l => l.append(now)) },
    } else all {
      slop' = { ...slop, opp: slop.opp.set(p, { ...slop.opp.get(p), stage: "rejected" }), netDeclAt: slop.netDeclAt.set(p, now),
                billed: slop.billed.setBy(p, l => l.select(x => x != slop.opp.get(p).at)) },
    },
    sh' = sh, keepPeon, keepOther, now' = now, lastAction' = "slopReview",
  }

  // Probe outcome (probe first, then the partner). A no is an interaction the engine sees (7-day reprobe)
  // and a Network decline (60 days, an avoid edge). Both yes: the booked date. Fixed (8f3673a, SD-443):
  // plan.ts:44 keeps only the day slots for a daytime activity (hike).
  action slopProbe(p: (str, str), outcome: str, activity: str, slot: str): bool = all {
    slop.opp.get(p).stage == "probing",
    if (outcome == "yes") all {
      activity != "hike" or slot == "day",
      slop' = { ...slop, opp: slop.opp.set(p, { ...slop.opp.get(p), stage: "scheduled", everBooked: true }),
                sentTimes: slop.sentTimes.setBy(p._2, l => l.append(now)) },
      sh' = { ...sh, hikeAtNight: sh.hikeAtNight or (activity == "hike" and slot == "eve"),
              bookedConfirmed: sh.bookedConfirmed or (slop.ob.get(p._1).confirmed and slop.ob.get(p._2).confirmed) },
    } else all {
      slop' = { ...slop, opp: slop.opp.set(p, { ...slop.opp.get(p), stage: "declined" }),
                netDeclAt: slop.netDeclAt.set(p, now), engDeclAt: slop.engDeclAt.set(p, now) },
      sh' = sh,
    },
    keepPeon, keepOther, now' = now, lastAction' = "slopProbe",
  }

  action slopMeet(p: (str, str)): bool = all {
    slop.opp.get(p).stage == "scheduled",
    slop' = { ...slop, opp: slop.opp.set(p, { ...slop.opp.get(p), stage: "met" }) },
    sh' = sh, keepPeon, keepOther, now' = now, lastAction' = "slopMeet",
  }

  // ================================================================== peon postings (job-posting)
  // network.ts postingTurn: a draft starts with a posting command in the manager's own text. `dup`: the
  // text repeats a must-have; parsePosting keeps the first of each (jobs.ts:86, 6e5a4c4, SD-227).
  action mgrDraftNew(id: str, openings: int, sen: bool, area: bool, dup: bool): bool = all {
    peon.draft.kind == "none", peon.posting.get(id).status == "none", not(peon.mgrHeld),
    peon' = { ...peon, draft: { kind: "new", id: id, openings: openings, seniority: sen, areaOk: area, mustDup: dup, said: "" } },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "mgrDraftNew",
  }
  action mgrDraftUpdate(id: str, openings: int): bool = all {
    peon.draft.kind == "none", peon.posting.get(id).status == "active", not(peon.mgrHeld),
    peon' = { ...peon, draft: { ...noDraft, kind: "update", id: id, openings: openings } },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "mgrDraftUpdate",
  }
  // "Close my data analyst post" or "we filled it" (jobs.ts readPostingText; FILLED_COMMAND sets `filled`).
  action mgrDraftClose(id: str, said: str): bool = all {
    peon.draft.kind == "none", peon.posting.get(id).status == "active",
    peon' = { ...peon, draft: { ...noDraft, kind: "close", id: id, said: said } },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "mgrDraftClose",
  }
  action mgrNo: bool = all {
    peon.draft.kind != "none",
    peon' = { ...peon, draft: noDraft },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "mgrNo",
  }

  // End a posting's seat items that are not booked (network.ts endSeat).
  pure def endSeat(s: Seat): Seat = if (s.stage == "review" or s.stage == "probing" or s.stage == "candYes") { ...s, stage: "closed" } else s

  // A "yes" to the read-back. `src` "sms" is the manager's own text; "mcp" is a profile from the member's
  // assistant. Fixed (7c08084, SD-042): network.ts:793 runs postingTurn only for the member's own text,
  // so an "mcp" yes leaves the draft and the postings as they are.
  // The manager's yes: postingFromDraft (jobs.ts:189-201, transitions.ts:567 postingAction) on the stored posting, then applyPosting, then
  // savePosting in the unit's transaction. Fixed (ce667b2, SD-114): a stored posting that is not active
  // is final (jobs.ts:194: no posting, the draft is dropped). Fixed (dc84661, SD-327): closedReason
  // "filled" for "we filled it" (jobs.ts:193).
  action mgrYes(src: str): bool = all {
    peon.draft.kind != "none",
    val d = peon.draft
    val prev = peon.posting.get(d.id)
    val isClose = d.kind == "close"
    val isFinal = prev.status != "none" and prev.status != "active"
    val openings = if (d.openings > 0) d.openings else if (prev.status == "none") 1 else storedOpenings(prev)
    val stated = if (d.openings > 0) d.openings else if (prev.status == "none") 1 else prev.stated
    val saved: Posting =
      if (isClose) { ...prev, status: "closed", reason: if (d.said == "filled") "filled" else "closed", version: prev.version + 1 }
      else { status: "active", openings: openings, stated: stated, reason: "",
             createdAt: if (prev.status == "none") now else prev.createdAt, version: prev.version + 1,
             seniority: if (d.kind == "new") d.seniority else prev.seniority, areaOk: if (d.kind == "new") d.areaOk else prev.areaOk }
    val refused = not(isClose) and peon.mgrHeld                        // managerProblem
    val saves = src == "sms" and not(isFinal) and not(refused)
    val postings = if (saves) peon.posting.set(d.id, saved) else peon.posting
    all {
      peon' = if (src == "mcp") peon else { ...peon, draft: noDraft, posting: postings,
        seat: if (isClose and saves) peon.seat.setBy(d.id, endSeat) else peon.seat },
      ph' = { ...ph,
        mcpConfirmed: ph.mcpConfirmed or (src == "mcp" and postings != peon.posting),
        filledLost: ph.filledLost or (saves and isClose and d.said == "filled" and saved.reason != "filled"),
        saveFailed: ph.saveFailed or (saves and postings.get(d.id).status == "none"),
        reopened: ph.reopened or (saves and not(isClose) and prev.status == "closed"),
        openingsLost: ph.openingsLost or (saves and not(isClose) and openings != stated),
      },
    },
    keepSlop, keepOther, now' = now, lastAction' = "mgrYes",
  }

  // Staff postings API (postings.ts), served by the service since f581d75 (SD-225).
  action staffClose(id: str, reason: str): bool = all {
    STAFF_API_SERVED, peon.posting.get(id).status != "none",
    val prev = peon.posting.get(id)
    peon' = { ...peon, posting: peon.posting.set(id, { ...prev, status: "closed", reason: reason, version: prev.version + 1 }),
              seat: peon.seat.setBy(id, endSeat) },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "staffClose",
  }
  // POST /postings with an existing id. Fixed (ce667b2, SD-114): a posting that is not active is refused
  // with 409 posting_closed (postings.ts:143).
  action staffSave(id: str, openings: int): bool = all {
    STAFF_API_SERVED, peon.posting.get(id).status != "none", not(peon.mgrHeld),
    val prev = peon.posting.get(id)
    val ok = prev.status == "active"
    val o = if (openings > 0) openings else storedOpenings(prev)
    val st = if (openings > 0) openings else prev.stated
    all {
      peon' = if (ok) { ...peon, posting: peon.posting.set(id, { ...prev, status: "active", openings: o, stated: st, reason: "", version: prev.version + 1 }) } else peon,
      ph' = { ...ph, reopened: ph.reopened or (ok and prev.status == "closed"), openingsLost: ph.openingsLost or (ok and o != st) },
    },
    keepSlop, keepOther, now' = now, lastAction' = "staffSave",
  }
  action staffVerify: bool = all {
    STAFF_API_SERVED, not(peon.mgrHeld),
    peon' = { ...peon, verified: true },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "staffVerify",
  }
  // The integration tests seed the candidate's peon:entity facts (no production writer: SD-224, skipped).
  action harnessCandidate: bool = all {
    peon.env == "harness",
    peon' = { ...peon, candOn: true },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "harnessCandidate",
  }
  action setMgrHold(h: bool): bool = all {
    peon' = { ...peon, mgrHeld: h },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "setMgrHold",
  }

  // ================================================================== peon engine run and seat items (job-seat-item)
  // dailyRun for peon: the engine proposes (candidate, seat); seatRoute swaps in the manager; gateReason
  // checks the manager (managerProblem) and pair_history on the seat (network.ts:3872 gateReason with p.seat).
  action peonEngineRun(id: str): bool = all {
    engineSeatOk(id),
    val gateOk = not(peon.mgrHeld) and not(seatDeclined(id))
    all {
      peon' = { ...peon,
        seat: if (gateOk) peon.seat.set(id, { stage: "review", yesVersion: 0 }) else peon.seat,
        introduced: if (gateOk) peon.introduced.union(Set(id)) else peon.introduced },
      ph' = { ...ph,
        engineSelectedHeld: ph.engineSelectedHeld or peon.mgrHeld,
        crossJobBlock: ph.crossJobBlock or (not(gateOk) and not(seatDeclined(id)) and POSTINGS.exists(o => o != id and seatDeclined(o))) },
    },
    keepSlop, keepOther, now' = now, lastAction' = "peonEngineRun",
  }
  // A no (review reject, candidate no, manager no) marks (candidate, seat) declined (network.ts markDeclined with seatSide).
  action seatReview(id: str, approve: bool): bool = all {
    peon.seat.get(id).stage == "review",
    peon' = { ...peon, seat: peon.seat.set(id, { ...peon.seat.get(id), stage: if (approve) "probing" else "closed" }),
              declAt: if (approve) peon.declAt else peon.declAt.set(id, now) },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "seatReview",
  }
  action candAnswer(id: str, yes: bool): bool = all {
    peon.seat.get(id).stage == "probing",
    peon' = { ...peon,
      seat: peon.seat.set(id, if (yes) { stage: "candYes", yesVersion: peon.posting.get(id).version } else { ...peon.seat.get(id), stage: "closed" }),
      declAt: if (yes) peon.declAt else peon.declAt.set(id, now) },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "candAnswer",
  }
  action mgrAnswer(id: str, yes: bool): bool = all {
    peon.seat.get(id).stage == "candYes",
    peon' = { ...peon, seat: peon.seat.set(id, { ...peon.seat.get(id), stage: if (yes) "booked" else "closed" }),
              declAt: if (yes) peon.declAt else peon.declAt.set(id, now) },
    ph' = { ...ph, seatFilled: ph.seatFilled or yes },
    keepSlop, keepOther, now' = now, lastAction' = "mgrAnswer",
  }

  // ================================================================== probe flow library (probe-flow)
  // startProbeFlow with a pair or a one-participant kind (attention.ts; network_growth size [1,1]).
  action flowStart(n: int): bool = all {
    flow.stage == "idle" or flow.stage == "closed" or flow.stage == "revealed",
    flow' = { n: n, stage: "probing_first", answers: Set("x", "y").mapBy(m => if (m == "x" or n == 2) "pending" else "none") },
    keepSlop, keepPeon, plan' = plan, focus' = focus, now' = now, lastAction' = "flowStart",
  }
  // Fixed (dcf24da, SD-063): attention.ts:808, the first member's yes reveals a flow with no partners.
  action flowAnswer(m: str, yes: bool): bool = all {
    toProbe(flow).contains(m),
    val answers = flow.answers.set(m, if (yes) "yes" else "no")
    val stage = if (m == "x") (if (not(yes)) "closed" else if (flow.n == 2) "probing_partners" else "revealed")
                else (if (yes and answers.get("x") == "yes") "revealed" else "closed")
    flow' = { ...flow, answers: answers, stage: stage },
    keepSlop, keepPeon, plan' = plan, focus' = focus, now' = now, lastAction' = "flowAnswer",
  }

  // ================================================================== plan seat facts (hard-filter-chain)
  action setPlanFacts(mi: bool, b: bool, r: bool): bool = all {
    plan' = { minor: mi, budgetFull: b, reliabilityHold: r },
    keepSlop, keepPeon, flow' = flow, focus' = focus, now' = now, lastAction' = "setPlanFacts",
  }

  // ================================================================== time
  action tick(d: int): bool = all {
    now + d <= MAX_NOW,
    now' = now + d,
    // network.ts checkSeats at every tick: an open seat item of a posting that is not active ends.
    peon' = { ...peon, seat: POSTINGS.mapBy(id => if (peon.posting.get(id).status != "active") endSeat(peon.seat.get(id)) else peon.seat.get(id)) },
    ph' = ph, keepSlop, keepOther, lastAction' = "tick",
  }

  // ================================================================== step
  action slopStep(safetyEvents: bool): bool = any {
    nondet m = SLOP_ADULTS.oneOf()
    nondet ans = Set(true, false).oneOf()
    nondet k = MESSAGE_KINDS.oneOf()
    any { memberSays(m, ans, k), agentNext(m), sweep(m), engineBasicsAsk(m) },
    nondet m = SLOP_MEMBERS.oneOf()
    nondet h = Set(true, false).oneOf()
    all { safetyEvents, any { statesMinorAge(m), setHold(m, h) } },
    nondet p = PAIRS.oneOf()
    nondet ok = Set(true, false).oneOf()
    nondet out = Set("yes", "no").oneOf()
    nondet act = Set("hike", "drinks").oneOf()
    nondet slot = Set("day", "eve").oneOf()
    any { slopDailyRun(p), slopReview(p, ok), slopProbe(p, out, act, slot), slopMeet(p) },
    nondet d = Set(1, 3, 7, 30).oneOf()
    tick(d),
  }
  action peonStep(safetyEvents: bool): bool = {
    nondet id = POSTINGS.oneOf()
    nondet n = Set(0, 1, 2, 3).oneOf()
    nondet b1 = Set(true, false).oneOf()
    nondet b2 = Set(true, false).oneOf()
    nondet b3 = Set(true, false).oneOf()
    nondet src = Set("sms", "mcp").oneOf()
    nondet said = Set("filled", "closed").oneOf()
    any {
      any { all { n > 0, mgrDraftNew(id, n, b1, b2, b3) }, mgrDraftUpdate(id, n), mgrDraftClose(id, said), mgrNo, mgrYes(src) },
      any { staffClose(id, said), staffSave(id, n), staffVerify, harnessCandidate, all { safetyEvents, setMgrHold(b1) } },
      any { peonEngineRun(id), seatReview(id, b1), candAnswer(id, b1), mgrAnswer(id, b1) },
      nondet d = Set(1, 3, 7, 30).oneOf()
      tick(d),
    }
  }
  action flowStep = {
    nondet fm = Set("x", "y").oneOf()
    nondet fn = Set(1, 2).oneOf()
    nondet fy = Set(true, false).oneOf()
    nondet d = Set(1, 3, 7, 30).oneOf()
    any { flowStart(fn), flowAnswer(fm, fy), tick(d) }
  }
  action planStep = {
    nondet b1 = Set(true, false).oneOf()
    nondet b2 = Set(true, false).oneOf()
    nondet b3 = Set(true, false).oneOf()
    nondet d = Set(1, 3, 7, 30).oneOf()
    any { setPlanFacts(b1, b2, b3), tick(d) }
  }
  action step = any {
    all { focus == "slop", slopStep(false) },
    all { focus == "slopSafety", slopStep(true) },
    all { focus == "peon", peonStep(false) },
    all { focus == "peonSafety", peonStep(true) },
    all { focus == "flow", flowStep },
    all { focus == "plan", planStep },
  }

  // ================================================================== invariants
  // Each holds by a rule, not by the code. The register id is the defect a violation reproduced before its fix.

  // AGENTS.md "Code invariants", platform decision 1: minors (13-17) are never matched; filters.ts:25-30.
  val minorNeverCandidate = not(sh.matchedMinor)
  // AGENTS.md "Keep every safety guard": a held member is never put in a new opportunity (filters.ts:60, network.ts packInput holds).
  val heldNeverCandidate = not(sh.matchedHeld)
  // extract.ts:41 HARD_FIELDS includes location; rules.ts hard filters run before scoring: the engine asks
  // for a location before it proposes the member. SD-209.
  val locatedBeforeMatch = not(sh.matchedUnasked)
  // apphooks.ts:28-30 and network.ts learnAppTags: the tags are what the member said; newer replace older. SD-061.
  val deletedFieldClearsTag = SLOP_MEMBERS.forall(m => slop.tags.get(m).contains("db:smoker") == slop.ob.get(m).db)
  // service/packs.ts:99-101: every answer goes to the onboarding loop. SD-427.
  val answersReachLoop = not(sh.lostAnswer)
  // onboard.ts:122 ("undefined when there is nothing left to ask"), index.ts:135 one compatibility
  // message: the basics ask terminates (at most the per-question cap). SD-419.
  val askTerminates = SLOP_MEMBERS.forall(m => slop.basicsAsks.get(m) <= MAX_ASKS)
  // network.ts "a no is remembered for the pair: never probed again for a while, from any path";
  // the engine's view of a pair must agree with the gate, or the gate drops its pick every day. SD-223.
  val engineAgreesWithGate = not(sh.gateDisagree)
  // world.ts:179 "proposals the Network never sent neither count against budgets nor block the pair";
  // SLOP_ENGINE_CONFIG dispatch.billOnlySent. SD-262, SD-210.
  val unsentNotBilled = PAIRS.forall(p => slop.opp.get(p).stage == "rejected" implies not(listHas(slop.billed.get(p), slop.opp.get(p).at)))
  // PRD 40.3 caps, outreach.ts:14-21 budgets; engine config budgets limit 2 per 7 days. SD-207.
  val budgetAcrossAssign = not(sh.selectedOverBudget)
  // config.ts:183 judge ttlMs: a verdict is reused within its TTL. SD-420.
  val judgeCacheReused = not(sh.judgeRepeat)
  // service/packs.ts:152 "a daytime hike"; packs/slop/plan.ts:20 PUBLIC_VENUE trailhead daytime. SD-443.
  val activityFitsSlot = not(sh.hikeAtNight)

  // jobs.ts closedReason; jobs.ts "no new candidates are sent": a closed post stays closed. SD-114.
  val closedTerminal = not(ph.reopened)
  // jobs.ts "an update keeps what the draft does not change". SD-114.
  val openingsPreserved = not(ph.openingsLost)
  // jobs.ts:11-13 "rules only, never an LLM's open-turn output ... saved only after the manager's yes";
  // only the member's own text answers. SD-042.
  val confirmedInOwnThread = not(ph.mcpConfirmed)
  // jobs.ts:14 and 34-35: "we filled it" closes as filled. SD-327.
  val filledRecorded = not(ph.filledLost)
  // postingProblem accepts it and the member hears "Posted": the rows must commit. SD-227.
  val acceptedPostingPersists = not(ph.saveFailed)
  // A no is about one job (seat copy jobs.ts); the engine keys it by seat. SD-439.
  val declineScopedToJob = not(ph.crossJobBlock)
  // A held manager's seat is never selected (filters.ts:60 holds; managerProblem). SD-296.
  val engineNeverSelectsHeld = not(ph.engineSelectedHeld)
  // network.ts checkSeats: a seat is never booked past its openings.
  val seatCapacity = POSTINGS.forall(id => peon.seat.get(id).stage == "booked" implies peon.posting.get(id).openings >= 1)

  // attention.ts "nobody is named before everyone needed said yes": a flow still probing has someone to ask. SD-063.
  val probeFlowProgresses = (flow.stage == "probing_first" or flow.stage == "probing_partners") implies toProbe(flow).size() > 0
  // plans.ts:141-144 "minors, paused, safety holds, ... and the reliability hold-out all exclude". SD-206.
  val planSeatHonorsHoldout = (plan.minor implies planReason(plan) == "underage") and (plan.reliabilityHold implies planReason(plan) != "")

  val safety = all {
    minorNeverCandidate, heldNeverCandidate, locatedBeforeMatch, deletedFieldClearsTag,
    answersReachLoop, askTerminates, engineAgreesWithGate, unsentNotBilled, budgetAcrossAssign,
    judgeCacheReused, activityFitsSlot,
    closedTerminal, openingsPreserved, confirmedInOwnThread, filledRecorded, acceptedPostingPersists,
    declineScopedToJob, engineNeverSelectsHeld, seatCapacity,
    probeFlowProgresses, planSeatHonorsHoldout,
  }

  // ================================================================== known open defects (not in `safety`)
  // Each value is violated on the current code. Each one is kept out of `safety` for the reason given.

  // SD-060 (skipped: founder decision). onboard.ts:1-4 and extract.ts:77: matchable needs the read-back.
  // Nothing on the match path reads SlopOnboarding.confirmed. Gating on it would lock out members who
  // onboard only through their AI assistant (no thread read-back; AGENTS.md platform decision 10).
  val readBackBeforeMatch = not(sh.matchedUnconfirmed)
  // SD-418 (not reproduced as a harm). onboard.ts:84-87 says "the service reads back again" after a
  // correction; the MAX_ASKS_PER_QUESTION cap stops at two read-backs by design, and no production code
  // reads `confirmed` (see SD-060).
  val readBackHasPath = SLOP_MEMBERS.forall(m =>
    val o = slop.ob.get(m)
    (adult(m) and o.core and o.loc and not(o.confirmed) and slop.awaiting.get(m) != "readback") implies o.readBacks < MAX_ASKS)
  // The SD-209 fix keeps the 7-day silent fallback (rules.ts:38, the same as for an unknown zip: "never a
  // lockout"): a member who leaves the location question unanswered for a week is matched at the market
  // anchor cell. By design in the fix; a change needs a founder decision.
  val locatedBeforeMatchStrict = not(sh.matchedUnlocated)
  // The SD-419 fix bounds the basics ask with the per-question cap (two asks). needsBasics still reads
  // tags only, so a member who said "no dealbreakers" gets up to two basics asks. Changing needsBasics
  // changes who is asked, which the fix did not do.
  val noBasicsAfterAnswer = not(sh.basicsAfterAnswer)
  // SD-121 (skipped: founder decision on posting expiry). jobs.ts:4-10: an active posting is a job seat
  // the engine can match; after 90 days the intent is dropped and nobody is told.
  val activeIsLive = POSTINGS.forall(id => peon.posting.get(id).status == "active" implies now < peon.posting.get(id).createdAt + HORIZON)
  // SD-226 (skipped: founder decision, intake questions or matching rules). jobs.ts copy "Posted": a job
  // saved must be able to pass the pack's own filters (seniority_band, locationOk).
  val postedCanMatch = POSTINGS.forall(id => peon.posting.get(id).status == "active" implies (peon.posting.get(id).seniority and peon.posting.get(id).areaOk))
  // SD-224 (skipped: a missing peon candidate onboarding, new scope). peon/profile.ts: candidates come
  // from peon:entity facts; nothing in production writes them.
  val candidatesWritable = POSTINGS.forall(id => (peon.env == "prod" and peon.posting.get(id).status == "active") implies peon.candOn)
  // SD-440 (skipped: founder decision and new copy). A yes is consent to the text the member saw.
  val inFlightMatchesPosting = POSTINGS.forall(id => peon.seat.get(id).stage == "candYes" implies peon.seat.get(id).yesVersion == peon.posting.get(id).version)

  // ================================================================== witnesses (must be reachable)
  val witness_readBackConfirmed = not(SLOP_MEMBERS.exists(m => slop.ob.get(m).confirmed))
  val witness_matchedAfterConfirm = not(sh.bookedConfirmed)
  val witness_postingActive = not(POSTINGS.exists(id => peon.posting.get(id).status == "active"))
  val witness_postingFilled = not(ph.seatFilled)
  val witness_flowRevealed = flow.stage != "revealed"
  val witness_probeDeclined = not(PAIRS.exists(p => slop.opp.get(p).stage == "declined"))
  // SD-225: in prod, staff can verify an employer (the staff API is served).
  val witness_prodEmployerVerified = not(peon.env == "prod" and peon.verified)
  // SD-114 and SD-327: a posting closed as filled by the manager's text.
  val witness_postingClosedFilled = not(POSTINGS.exists(id => peon.posting.get(id).status == "closed" and peon.posting.get(id).reason == "filled"))
  // SD-427: a late answer (after the sweep) is read by the loop.
  val witness_lateAnswerRead = not(sh.lateRead)

  // ================================================================== runs (traces from the code and the tests)
  action say(m: str, k: str): bool = memberSays(m, false, k)
  action hardFields(m: str): bool = agentNext(m).then(say(m, "core")).then(say(m, "loc"))

  // Onboarding to a confirmed read-back (docs/results/2026-10-09-slop-onboarding.md).
  run readBackTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(say("a", "loc"))
    .expect(slop.awaiting.get("a") == "readback" and slop.ob.get("a").readBacks == 1)
    .then(say("a", "yes")).expect(slop.ob.get("a").confirmed and slop.awaiting.get("a") == "question")

  // SD-060 (skipped): both members state every hard field and never answer the read-back; the next run proposes them.
  run unconfirmedMatchTest = initWith("prod", false, "slop")
    .then(hardFields("a")).then(hardFields("b"))
    .then(slopDailyRun(("a", "b"))).expect(not(readBackBeforeMatch) and slop.opp.get(("a", "b")).stage == "review" and safety)

  // SD-209 fixed (slop-location.integration.test.ts): without a location the pair is not proposed; once
  // each member gives one, it is.
  run locationAskedTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(agentNext("b")).then(say("b", "core"))
    .expect(slop.askedField.get("a") == "loc" and not(enginePairs.contains(("a", "b"))))
    .then(say("a", "loc")).then(say("b", "loc"))
    .expect(enginePairs.contains(("a", "b")))
    .then(slopDailyRun(("a", "b"))).expect(locatedBeforeMatch and locatedBeforeMatchStrict)

  // The SD-209 fix's silent fallback: the location question unanswered for 7 days, then the pair is proposed.
  run locationSilentTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(agentNext("b")).then(say("b", "core"))
    .then(tick(3)).expect(not(enginePairs.contains(("a", "b"))))
    .then(tick(7)).then(slopDailyRun(("a", "b")))
    .expect(locatedBeforeMatch and not(locatedBeforeMatchStrict))

  // SD-061 fixed (slop-onboard-tags.integration.test.ts): "no smokers", then "smoking is fine": no tag.
  run deletedDealbreakerTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "dbAdd")).expect(slop.tags.get("a").contains("db:smoker"))
    .then(say("a", "dbRemove"))
    .expect(not(slop.ob.get("a").db) and not(slop.tags.get("a").contains("db:smoker")) and deletedFieldClearsTag)

  // The dealbreaker taken back no longer filters: a and b (a smoker) can be proposed.
  run takenBackDealbreakerTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "dbAdd")).then(say("a", "dbRemove")).then(say("a", "core")).then(say("a", "loc"))
    .then(hardFields("b"))
    .expect(enginePairs.contains(("a", "b")))

  // SD-418 (not reproduced as a harm): two read-backs answered with corrections; no third read-back.
  run readBackCapTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(say("a", "loc"))
    .then(say("a", "coreChange")).then(say("a", "goal")).then(say("a", "coreChange"))
    .expect(not(readBackHasPath) and slop.ob.get("a").readBacks == 2 and slop.awaiting.get("a") == "question")

  // SD-427 fixed (slop-late-answer.integration.test.ts): a question sent, four days of silence, the
  // sweep, then the answer: it is still read, and the loop sends its next question.
  run sweptAnswerTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(tick(3)).then(tick(1)).then(sweep("a"))
    .expect(slop.awaiting.get("a") == "none" and slop.pendingAsk.get("a"))
    .then(say("a", "core"))
    .expect(answersReachLoop and slop.ob.get("a").core and slop.tags.get("a").contains("core") and slop.awaiting.get("a") == "question")

  // A late text that changes nothing is not read as the answer (lateAnswer returns undefined).
  run lateNothingTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(tick(3)).then(tick(1)).then(sweep("a")).then(say("a", "nothing"))
    .expect(slop.awaiting.get("a") == "none" and slop.pendingAsk.get("a") and answersReachLoop)

  // SD-223 fixed (slop-declined-pair.integration.test.ts): a probe no at day 0; on day 7 the engine no
  // longer picks the pair (avoid edge for 60 days); on day 60 it may again.
  run reprobeGateTest = initWith("prod", false, "slop")
    .then(hardFields("a")).then(hardFields("b"))
    .then(slopDailyRun(("a", "b"))).then(slopReview(("a", "b"), true)).then(slopProbe(("a", "b"), "no", "drinks", "eve"))
    .then(tick(7)).expect(not(enginePairs.contains(("a", "b"))))
    .then(tick(30)).then(tick(30)).expect(enginePairs.contains(("a", "b")))
    .then(slopDailyRun(("a", "b"))).expect(engineAgreesWithGate and slop.opp.get(("a", "b")).stage == "review")

  // SD-223 through a review reject: the engine does not pick the pair the next day.
  run rejectAvoidTest = initWith("prod", false, "slop")
    .then(hardFields("a")).then(hardFields("b"))
    .then(slopDailyRun(("a", "b"))).then(slopReview(("a", "b"), false)).then(tick(1))
    .expect(not(enginePairs.contains(("a", "b"))) and engineAgreesWithGate)

  // SD-262 and SD-210 fixed (engine-unsent.integration.test.ts): a proposal rejected in review is not billed.
  run rejectedBilledTest = initWith("prod", false, "slop")
    .then(hardFields("a")).then(hardFields("b"))
    .then(slopDailyRun(("a", "b"))).expect(engineCount("a") == 1)
    .then(slopReview(("a", "b"), false))
    .expect(unsentNotBilled and engineCount("a") == 0 and sentCount("a") == 0)

  // Matched after both read-backs were confirmed; booked.
  run confirmedMatchTest = initWith("prod", false, "slop")
    .then(hardFields("a")).then(say("a", "yes")).then(hardFields("b")).then(say("b", "yes"))
    .then(slopDailyRun(("a", "b"))).then(slopReview(("a", "b"), true)).then(slopProbe(("a", "b"), "yes", "drinks", "eve"))
    .expect(not(witness_matchedAfterConfirm) and safety)

  // SD-207 fixed (scripts/sim/slop.ts gate): two proposals for a in one week (both sent); a is not
  // usable in selection until the budget period ends.
  run overBudgetTest = initWith("prod", false, "slop")
    .then(hardFields("a")).then(hardFields("b")).then(hardFields("c"))
    .then(slopDailyRun(("a", "b"))).then(slopReview(("a", "b"), true)).then(slopProbe(("a", "b"), "no", "drinks", "eve"))
    .then(slopDailyRun(("a", "c"))).then(slopReview(("a", "c"), true)).then(slopProbe(("a", "c"), "no", "drinks", "eve"))
    .expect(engineCount("a") == 2 and not(inOpen("a")) and not(engineMemberOk("a")) and budgetAcrossAssign)
    .then(tick(7)).expect(engineCount("a") == 0 and engineMemberOk("a"))

  // SD-420 fixed (engine-judge-cache.test.ts): the judge is on; a second daily run inside the TTL reuses the verdict.
  // The first run judges (a,b), (a,c) and (b,c) on day 0; the run on day 1 finds (a,c) and (b,c) in the cache.
  run judgeCacheTest = initWith("prod", true, "slop")
    .then(hardFields("a")).then(hardFields("b")).then(hardFields("c"))
    .then(slopDailyRun(("a", "b"))).then(slopReview(("a", "b"), false))
    .expect(slop.judgeLast.get(("a", "c")) == 0 and slop.judgeLast.get(("b", "c")) == 0)
    .then(tick(1)).then(slopDailyRun(("a", "c")))
    .expect(slop.judgeLast.get(("a", "c")) == 0 and slop.judgeLast.get(("b", "c")) == 0 and judgeCacheReused)


  // SD-443 fixed (slop-hike-slot.integration.test.ts): a booked hike has a day slot only.
  run hikeSlotTest = initWith("prod", false, "slop")
    .then(hardFields("a")).then(hardFields("b"))
    .then(slopDailyRun(("a", "b"))).then(slopReview(("a", "b"), true))
    .then(slopProbe(("a", "b"), "yes", "hike", "day"))
    .expect(slop.opp.get(("a", "b")).stage == "scheduled" and activityFitsSlot)

  // A minor (k) never enters the engine input, whatever k says.
  run minorExcludedTest = initWith("prod", false, "slop")
    .then(hardFields("a")).expect(not(PAIRS.exists(p => has(p, "k") and enginePairs.contains(p))))

  // SD-042 fixed (peon-posting-lifecycle.integration.test.ts): the assistant's "yes" does not post.
  run mcpPostingTest = initWith("prod", false, "peon")
    .then(mgrDraftNew("A", 2, true, true, false)).then(mgrYes("mcp"))
    .expect(peon.posting.get("A").status == "none" and peon.draft.kind == "new" and confirmedInOwnThread)
    .then(mgrYes("sms")).expect(peon.posting.get("A").status == "active")

  // SD-114 fixed (peon-posting-lifecycle.integration.test.ts): close as filled, then a staff save with the
  // id is refused; the posting stays closed with 0 openings.
  run staffReopenTest = initWith("prod", false, "peon")
    .then(mgrDraftNew("A", 2, true, true, false)).then(mgrYes("sms"))
    .then(staffClose("A", "filled")).then(staffSave("A", 0))
    .expect(peon.posting.get("A").status == "closed" and closedTerminal and openingsPreserved)

  // SD-114 fixed: a stale update draft confirmed after a staff close is dropped.
  run staleDraftTest = initWith("prod", false, "peon")
    .then(mgrDraftNew("A", 2, true, true, false)).then(mgrYes("sms"))
    .then(mgrDraftUpdate("A", 3)).then(staffClose("A", "closed")).then(mgrYes("sms"))
    .expect(peon.posting.get("A").status == "closed" and peon.draft.kind == "none" and closedTerminal)

  // SD-327 fixed (peon-filled-close.test.ts): "we filled it" is saved as closedReason "filled".
  run filledTest = initWith("prod", false, "peon")
    .then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms"))
    .then(mgrDraftClose("A", "filled")).then(mgrYes("sms"))
    .expect(peon.posting.get("A").reason == "filled" and filledRecorded and not(witness_postingClosedFilled))

  // SD-227 fixed (peon-posting-machine.integration.test.ts): a repeated must-have is saved once.
  run dupMustTest = initWith("prod", false, "peon").then(mgrDraftNew("A", 1, true, true, true)).then(mgrYes("sms"))
    .expect(acceptedPostingPersists and peon.posting.get("A").status == "active")

  // SD-225 fixed (peon-posting-machine.integration.test.ts): staff verify an employer in prod.
  run prodVerifyTest = initWith("prod", false, "peon").then(staffVerify).expect(not(witness_prodEmployerVerified))

  // SD-121 (skipped): posted on day 0, still active on day 90 and later; the engine no longer sees a live intent.
  run silentExpiryTest = initWith("prod", false, "peon").then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms"))
    .then(tick(30)).then(tick(30)).then(tick(30)).expect(not(activeIsLive))

  // SD-440 (skipped; harness): the candidate says yes, the manager then edits the post; the item goes on.
  run staleYesTest = initWith("harness", false, "peon")
    .then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms")).then(staffVerify).then(harnessCandidate)
    .then(peonEngineRun("A")).then(seatReview("A", true)).then(candAnswer("A", true))
    .then(mgrDraftUpdate("A", 0)).then(mgrYes("sms"))
    .expect(not(inFlightMatchesPosting))

  // SD-439 fixed (scripts/sim/peon-seats.ts gate; harness): the candidate says no to job A; job B of the
  // same manager still gets an item, and job A does not come back.
  run crossJobTest = initWith("harness", false, "peon")
    .then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms"))
    .then(mgrDraftNew("B", 1, true, true, false)).then(mgrYes("sms"))
    .then(staffVerify).then(harnessCandidate)
    .then(peonEngineRun("A")).then(seatReview("A", true)).then(candAnswer("A", false))
    .then(peonEngineRun("B"))
    .expect(declineScopedToJob and peon.seat.get("B").stage == "review" and not(engineSeatOk("A")))

  // SD-296 fixed (peon-held-seat.integration.test.ts; harness): the manager is on hold; the seat is held in the engine input.
  run heldSeatTest = initWith("harness", false, "peon")
    .then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms")).then(staffVerify).then(harnessCandidate)
    .expect(engineSeatOk("A"))
    .then(setMgrHold(true)).expect(not(engineSeatOk("A")) and engineNeverSelectsHeld)

  // A posting fills (harness): candidate yes, manager yes.
  run postingFillsTest = initWith("harness", false, "peon")
    .then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms")).then(staffVerify).then(harnessCandidate)
    .then(peonEngineRun("A")).then(seatReview("A", true)).then(candAnswer("A", true)).then(mgrAnswer("A", true))
    .expect(not(witness_postingFilled))

  // SD-063 fixed (scripts/sim/conformance.ts gate): a one-participant flow is revealed on its yes.
  run oneParticipantFlowTest = initWith("prod", false, "flow").then(flowStart(1)).then(flowAnswer("x", true))
    .expect(flow.stage == "revealed" and probeFlowProgresses)

  // A pair flow reveals on two yeses.
  run pairFlowTest = initWith("prod", false, "flow").then(flowStart(2)).then(flowAnswer("x", true))
    .expect(flow.stage == "probing_partners").then(flowAnswer("y", true))
    .expect(flow.stage == "revealed")

  // SD-206 fixed (scripts/sim/conformance.ts gate): at the weekly budget and in the reliability hold-out.
  run planHoldoutTest = initWith("prod", false, "plan").then(setPlanFacts(false, true, true))
    .expect(planReason(plan) == "reliability_holdout" and planSeatHonorsHoldout)
    .then(setPlanFacts(false, true, false)).expect(planReason(plan) == "")

  // SD-419 fixed (slop-compat-asks.integration.test.ts): goal and "no dealbreakers" answered and
  // confirmed; the engine asks the basics at most twice, 21 days apart.
  run basicsLoopTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(say("a", "goal")).then(say("a", "dbNone")).then(say("a", "loc"))
    .then(say("a", "yes")).expect(slop.awaiting.get("a") == "none")
    .then(engineBasicsAsk("a")).then(say("a", "dbNone"))
    .then(tick(30)).then(engineBasicsAsk("a")).then(say("a", "dbNone"))
    .then(tick(30)).expect(slop.basicsAsks.get("a") == 2 and not(basicsAskDue("a")) and askTerminates and not(noBasicsAfterAnswer))
}
```
