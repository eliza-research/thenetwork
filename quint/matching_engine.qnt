// -*- mode: Bluespec; -*-
// quint-check: max-steps=40 max-samples=4000 verify-steps=6
//
// The matching engine and the app packs as the ConsentNetwork drives them (module plan:
// docs/research/2026-11-07-state-machines.md section 6.16). Machines: engine-pipeline, hard-filter-chain,
// slop-onboarding, probe-flow, global-selection, judge-passes-and-cache, slop-assignment, job-posting,
// job-seat-item, peon-candidate-onboarded, peon-employer-verified, slop-time-venue-booking,
// slop-pair-reprobe. The model follows the code as it is now (base ad67275).
//
// Abstractions (quint/README.md rule 7):
//   - Scores, the orientation check and the readers (extract.ts readMessage, jobs.ts parsePosting) are
//     oracles: a message is one nondeterministic "kind", and the engine picks any eligible pair.
//   - Time is a day count. Ticks are 1, 3, 7 or 30 days.
//   - slop: three adults a, b, c and one member k aged 15. Only b smokes. The five hard fields are two
//     bits: `core` (gender, seeks, age range, distance) and `loc` (a placeable location).
//   - peon: one hiring manager with postings A and B, and one candidate.
//   - The engine run and the Network gate of one daily run are one action (in memory, then one unit).
module matching_engine {

  // ------------------------------------------------------------------ constants
  pure val NONE = -1000
  pure val SLOP_MEMBERS = Set("a", "b", "c", "k")
  pure val SLOP_ADULTS = Set("a", "b", "c")
  pure val AGE = Map("a" -> 30, "b" -> 28, "c" -> 32, "k" -> 15)
  pure val SMOKERS = Set("b")
  pure val PAIRS = Set(("a", "b"), ("a", "c"), ("b", "c"), ("a", "k"), ("b", "k"), ("c", "k"))
  pure val MAX_ASKS = 2            // extract.ts:43 MAX_ASKS_PER_QUESTION (read-back cap: service/packs.ts:140)
  pure val REPROBE_DAYS = 7        // packs/slop/options.ts:158 reprobeAfterDays
  pure val GATE_DAYS = 60          // network.ts:2041-2044 markDeclined, network.ts:3607 pairHistory(a, b, 60)
  pure val BUDGET_N = 2            // outreach.ts:19 budget.normal n=2 over 7 days; slop SLOP_ENGINE_CONFIG budgets limit 2 / 7 days
  pure val BUDGET_DAYS = 7
  pure val SWEEP_DAYS = 3          // network.ts:3285 awaiting cleared after 3 days
  pure val BASICS_EVERY = 21       // packs/slop/index.ts:137
  pure val JUDGE_TTL = 7           // config.ts:183 judge.ttlMs = 7 days
  pure val HORIZON = 90            // jobs.ts:229 intent horizonDays 90; world.ts:207 live intents only
  pure val MAX_NOW = 150
  pure val POSTINGS = Set("A", "B")
  pure val MESSAGE_KINDS = Set("core", "coreChange", "loc", "dbAdd", "dbRemove", "dbNone", "goal", "yes", "no", "nothing")
  pure val FOCI = Set("slop", "slopSafety", "peon", "peonSafety", "flow", "plan")

  // ------------------------------------------------------------------ types
  type Ob = { core: bool, loc: bool, confirmed: bool, readBacks: int, db: bool, noDb: bool, goal: bool }
  type Opp = { stage: str, at: int, everBooked: bool }
  type Slop = {
    minor: str -> bool, held: str -> bool, ob: str -> Ob, tags: str -> Set[str],
    awaiting: str -> str, awaitingAt: str -> int, pendingAsk: str -> bool, lastBasicsAsk: str -> int,
    opp: (str, str) -> Opp, netDeclAt: (str, str) -> int, engDeclAt: (str, str) -> int,
    sentTimes: str -> List[int], billedTimes: str -> List[int],
    judgeOn: bool, judgeLast: (str, str) -> int
  }
  type SlopHist = {
    lostAnswer: bool, basicsAfterAnswer: bool, matchedUnconfirmed: bool, matchedUnlocated: bool,
    matchedMinor: bool, matchedHeld: bool, gateDisagree: bool, selectedOverBudget: bool,
    unsentBilled: bool, hikeAtNight: bool, bookedConfirmed: bool, judgeRepeat: bool
  }
  type Posting = { status: str, openings: int, stated: int, reason: str, createdAt: int, version: int, seniority: bool, areaOk: bool }
  type Draft = { kind: str, id: str, openings: int, seniority: bool, areaOk: bool, mustDup: bool, said: str }
  type Seat = { stage: str, yesVersion: int }
  type Peon = {
    env: str, posting: str -> Posting, draft: Draft, verified: bool, candOn: bool, mgrHeld: bool,
    seat: str -> Seat, declAt: int, declOn: str, introduced: Set[str]
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
  pure def isOpen(stage: str): bool = stage == "review" or stage == "probing" or stage == "scheduled"  // network.ts:452
  pure def window(l: List[int], t: int, days: int): int = l.select(x => t - x < days).length()

  // extract.ts:808-845 mergeReading for one message kind (the reader is the oracle).
  pure def applyKind(o: Ob, k: str): Ob =
    if (k == "core" or k == "coreChange") { ...o, core: true }
    else if (k == "loc") { ...o, loc: true }
    else if (k == "dbAdd") { ...o, db: true, noDb: false }
    else if (k == "dbRemove") { ...o, db: false }               // "smoking is fine": removed, noDealbreakers stays unset
    else if (k == "dbNone") { ...o, db: false, noDb: true }
    else if (k == "goal") { ...o, goal: true }
    else o
  // extract.ts:842 stripMeta: only the hard fields and the age reset a confirmation.
  pure def changedHard(o: Ob, k: str): bool =
    k == "coreChange" or (k == "core" and not(o.core)) or (k == "loc" and not(o.loc))
  // onboard.ts:96 view(): any field change.
  pure def changedAny(o: Ob, k: str): bool =
    changedHard(o, k) or (k == "dbAdd" and not(o.db)) or (k == "dbRemove" and o.db)
    or (k == "dbNone" and (o.db or not(o.noDb))) or (k == "goal" and not(o.goal))
  // extract.ts:912-948 slopOnboardTags, then network.ts:1048-1060 learnAppTags (keep, replace, add).
  pure def tagsAfter(old: Set[str], o: Ob): Set[str] =
    val add = Set("core", "loc", "db:smoker", "goal").filter(t =>
      (t == "core" and o.core) or (t == "loc" and o.loc) or (t == "db:smoker" and o.db) or (t == "goal" and o.goal))
    // `replaces` gets "slop:dealbreaker:" only when the list is non-empty or noDealbreakers is set (extract.ts:937).
    val replaced = Set("core", "loc", "db:smoker", "goal").filter(t =>
      (t == "core" and o.core) or (t == "loc" and o.loc) or (t == "db:smoker" and (o.db or o.noDb)) or (t == "goal" and o.goal))
    old.filter(t => not(replaced.contains(t))).union(add)

  def adult(m: str): bool = AGE.get(m) >= 18 and not(slop.minor.get(m))
  def inOpen(m: str): bool = PAIRS.exists(p => has(p, m) and isOpen(slop.opp.get(p).stage))
  def engineCount(m: str): int = window(slop.billedTimes.get(m), now, BUDGET_DAYS)
  def sentCount(m: str): int = window(slop.sentTimes.get(m), now, BUDGET_DAYS)

  // Engine member view: network.ts:3747-3753 packInput (adults only), filters.ts:50-65 memberReason core
  // prefix (holds), packs/slop/rules.ts:64-84 (needs_answer reads tags only; your_turn). No budget rule
  // in slopMemberRules, and slopAssign does not read budgets (SD-207).
  def engineMemberOk(m: str): bool =
    adult(m) and not(slop.held.get(m)) and slop.tags.get(m).contains("core") and not(inOpen(m))
  // packs/slop/rules.ts:87-135: already_introduced / reprobe_cooldown (interactions only), dealbreaker on tags.
  def enginePairOk(p: (str, str)): bool = all {
    not(slop.opp.get(p).everBooked),
    now - slop.engDeclAt.get(p) >= REPROBE_DAYS,
    not(slop.tags.get(p._1).contains("db:smoker") and SMOKERS.contains(p._2)),
    not(slop.tags.get(p._2).contains("db:smoker") and SMOKERS.contains(p._1)),
  }
  def enginePairs: Set[(str, str)] = PAIRS.filter(p => engineMemberOk(p._1) and engineMemberOk(p._2) and enginePairOk(p))
  // The Network gate: network.ts:4357-4366 eligible (minor, hold, busy, overBudget) and 3595-3611 gateReason (pair_history 60 days).
  def netMemberOk(m: str): bool = adult(m) and not(slop.held.get(m)) and not(inOpen(m)) and sentCount(m) < BUDGET_N
  def pairHistory(p: (str, str)): bool = now - slop.netDeclAt.get(p) < GATE_DAYS

  // ------------------------------------------------------------------ peon helpers
  pure val noDraft: Draft = { kind: "none", id: "", openings: 0, seniority: false, areaOk: false, mustDup: false, said: "" }
  pure val noPosting: Posting = { status: "none", openings: 0, stated: 0, reason: "", createdAt: NONE, version: 0, seniority: false, areaOk: false }
  // jobs.ts:242 postingFromFacts and network.ts:4574-4584 storedPosting: a closed posting's openings facet is 0, read back as 1.
  pure def storedOpenings(p: Posting): int = if (p.status == "active") p.openings else 1
  // peon/profile.ts:188 p.open, world.ts:207 live intent, peon/rules.ts (job_closed, employer_unverified,
  // seniority_band, locationOk), peon_not_onboarded for the candidate. The engine holds list has member
  // ids only, never the seat (SD-296), so mgrHeld is not read here.
  def engineSeatOk(id: str): bool = all {
    peon.posting.get(id).status == "active",
    now < peon.posting.get(id).createdAt + HORIZON,
    peon.posting.get(id).openings > 0,
    peon.verified, peon.candOn,
    peon.posting.get(id).seniority, peon.posting.get(id).areaOk,
    not(peon.introduced.contains(id)),
  }

  // ------------------------------------------------------------------ probe flow helpers (attention.ts:769-831)
  def toProbe(f: Flow): Set[str] =
    if (f.stage == "probing_first") (if (f.answers.get("x") == "pending") Set("x") else Set())
    else if (f.stage == "probing_partners") f.answers.keys().filter(m => f.answers.get(m) == "pending" and m != "x")
    else Set()

  // ------------------------------------------------------------------ plan seat rule (plans.ts:146-149, network/rules.ts:15-46)
  def planReason(f: PlanFacts): str =
    val first = if (f.minor) "underage" else if (f.budgetFull) "interruption_budget" else if (f.reliabilityHold) "reliability_holdout" else ""
    if (first == "interruption_budget") "" else first

  // ------------------------------------------------------------------ init
  action initWith(env: str, judgeOn: bool, f: str): bool = all {
    now' = 0, focus' = f,
    slop' = {
      minor: SLOP_MEMBERS.mapBy(m => AGE.get(m) < 18), held: SLOP_MEMBERS.mapBy(m => false),
      ob: SLOP_MEMBERS.mapBy(m => emptyOb), tags: SLOP_MEMBERS.mapBy(m => Set()),
      awaiting: SLOP_MEMBERS.mapBy(m => "none"), awaitingAt: SLOP_MEMBERS.mapBy(m => NONE),
      pendingAsk: SLOP_MEMBERS.mapBy(m => false), lastBasicsAsk: SLOP_MEMBERS.mapBy(m => NONE),
      opp: PAIRS.mapBy(p => { stage: "none", at: NONE, everBooked: false }),
      netDeclAt: PAIRS.mapBy(p => NONE), engDeclAt: PAIRS.mapBy(p => NONE),
      sentTimes: SLOP_MEMBERS.mapBy(m => []), billedTimes: SLOP_MEMBERS.mapBy(m => []),
      judgeOn: judgeOn, judgeLast: PAIRS.mapBy(p => NONE),
    },
    sh' = {
      lostAnswer: false, basicsAfterAnswer: false, matchedUnconfirmed: false, matchedUnlocated: false,
      matchedMinor: false, matchedHeld: false, gateDisagree: false, selectedOverBudget: false,
      unsentBilled: false, hikeAtNight: false, bookedConfirmed: false, judgeRepeat: false,
    },
    // peon runs locally only (AGENTS.md platform decision 4). "prod": the service as deployed, where the
    // staff postings API is not registered (SD-225) and nothing writes candidate facts (SD-224).
    // "harness": the integration tests, which call jobPostingRoutes and seed candidate rows.
    peon' = {
      env: env, posting: POSTINGS.mapBy(p => noPosting), draft: noDraft, verified: false, candOn: false, mgrHeld: false,
      seat: POSTINGS.mapBy(p => { stage: "none", yesVersion: 0 }), declAt: NONE, declOn: "", introduced: Set(),
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
  // unconfirmed, asked fewer than MAX_ASKS times and not just answered (`skip`, network.ts:1068-1076);
  // else a question while a field is missing; else nothing.
  pure def nextMsg(o: Ob, skipReadBack: bool): str =
    if (o.core and o.loc and not(o.confirmed) and o.readBacks < MAX_ASKS and not(skipReadBack)) "readback"
    else if (not(o.core) or not(o.loc) or not(o.goal) or not(o.db or o.noDb)) "question"
    else "none"
  // The answer to what was asked (the reader is an oracle; `answers` false picks any other kind).
  pure def askedKind(o: Ob, aw: str): str =
    if (aw == "readback") "yes" else if (not(o.core)) "core" else if (not(o.loc)) "loc" else if (not(o.goal)) "goal" else "dbNone"
  // Send `msg` to m: a read-back counts on the cap (markAsked); either one is an open question.
  pure def asked(o: Ob, msg: str): Ob = if (msg == "readback") { ...o, readBacks: o.readBacks + 1 } else o

  // One inbound text of member m. With an open question (awaiting), the onboarding loop reads it
  // (network.ts:1115-1130 onAskAnswer, service/packs.ts:121-136: applyCorrection after a read-back, else
  // extractSlopProfile), the tags are persisted at once (network.ts:1048-1060), and the same turn sends
  // the loop's next message (onboardNext with skip = the answered question). With nothing awaited, the
  // text goes to an open turn and the loop does not read it (SD-427).
  action memberSays(m: str, answers: bool, k0: str): bool = all {
    adult(m),
    val o = slop.ob.get(m)
    val aw = slop.awaiting.get(m)
    val k = if (answers) askedKind(o, aw) else k0
    if (aw == "none") all {
      slop' = slop,
      sh' = { ...sh, lostAnswer: sh.lostAnswer or (slop.pendingAsk.get(m) and k != "nothing" and k != "no") },
    } else {
      val o1 = applyKind(o, k)
      val conf = if (aw == "readback") (if (changedAny(o, k)) false else k == "yes")   // onboard.ts:89-95
                 else (if (changedHard(o, k)) false else o.confirmed)                   // extract.ts:864
      val o2 = { ...o1, confirmed: conf }
      val msg = nextMsg(o2, aw == "readback")
      all {
        slop' = { ...slop, ob: slop.ob.set(m, asked(o2, msg)), tags: slop.tags.set(m, tagsAfter(slop.tags.get(m), o2)),
                  awaiting: slop.awaiting.set(m, if (msg == "none") "none" else msg),
                  awaitingAt: slop.awaitingAt.set(m, now), pendingAsk: slop.pendingAsk.set(m, msg != "none") },
        sh' = sh,
      }
    },
    keepPeon, keepOther, now' = now, lastAction' = "memberSays",
  }

  // The first question after the age question, or an engine ask that the loop answers with its own
  // next message (network.ts:1077-1083 onInterviewAnswer, 3490-3500 sendAsks without skip).
  action agentNext(m: str): bool = all {
    adult(m), slop.awaiting.get(m) == "none",
    val o = slop.ob.get(m)
    val msg = nextMsg(o, false)
    all {
      msg != "none",
      slop' = { ...slop, ob: slop.ob.set(m, asked(o, msg)), awaiting: slop.awaiting.set(m, msg),
                awaitingAt: slop.awaitingAt.set(m, now), pendingAsk: slop.pendingAsk.set(m, true) },
    },
    sh' = sh, keepPeon, keepOther, now' = now, lastAction' = "agentNext",
  }

  // network.ts:3281-3286: each tick clears an interview or read-back wait older than 3 days.
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
  // Trust or report hold (network.ts:3710), placed or lifted by another actor.
  action setHold(m: str, h: bool): bool = all {
    slop' = { ...slop, held: slop.held.set(m, h) },
    sh' = sh, keepPeon, keepOther, now' = now, lastAction' = "setHold",
  }

  // packs/slop/index.ts:121-139 extraAsks slop_basics, sent by network.ts:3490-3500 sendAsks when the loop
  // has nothing left to ask (next() undefined). needsBasics (rules.ts:41-43) reads tags only: a member who
  // said "no dealbreakers" has no dealbreaker tag and no politics value.
  action engineBasicsAsk(m: str): bool = all {
    adult(m), not(slop.held.get(m)), slop.tags.get(m).contains("core"), slop.awaiting.get(m) == "none",
    val o = slop.ob.get(m)
    val t = slop.tags.get(m)
    val needsBasics = not(t.contains("goal")) or not(t.contains("db:smoker"))
    val loopDone = nextMsg(o, false) == "none"
    all {
      needsBasics, loopDone, now - slop.lastBasicsAsk.get(m) >= BASICS_EVERY,
      slop' = { ...slop, lastBasicsAsk: slop.lastBasicsAsk.set(m, now), awaiting: slop.awaiting.set(m, "question"),
                awaitingAt: slop.awaitingAt.set(m, now), pendingAsk: slop.pendingAsk.set(m, true) },
      // loopDone means the member answered goal and dealbreakers already.
      sh' = { ...sh, basicsAfterAnswer: true },
    },
    keepPeon, keepOther, now' = now, lastAction' = "engineBasicsAsk",
  }

  // ================================================================== slop daily run (engine-pipeline, global-selection, slop-assignment)
  // network.ts:3438-3468 dailyRun: runEngine on packInput, then gateReason per proposal, then submit to review.
  // The engine's pick among eligible pairs is the score oracle.
  action slopDailyRun(p: (str, str)): bool = all {
    enginePairs.contains(p),
    val gateOk = netMemberOk(p._1) and netMemberOk(p._2) and not(pairHistory(p))
    val engineRepeat = slop.judgeOn and now - slop.judgeLast.get(p) < JUDGE_TTL
    all {
      slop' = { ...slop,
        opp: if (gateOk) slop.opp.set(p, { ...slop.opp.get(p), stage: "review", at: now }) else slop.opp,
        // world.ts:171-247: every recent proposal counts; the Network never passes unsentProposalIds.
        billedTimes: if (gateOk) slop.billedTimes.setBy(p._1, l => l.append(now)).setBy(p._2, l => l.append(now)) else slop.billedTimes,
        // engine.ts:174-199: dailyRun passes no judge cache, so each run builds a new one (SD-420).
        judgeLast: if (slop.judgeOn) slop.judgeLast.set(p, now) else slop.judgeLast,
      },
      sh' = { ...sh,
        matchedUnconfirmed: sh.matchedUnconfirmed or (gateOk and not(slop.ob.get(p._1).confirmed and slop.ob.get(p._2).confirmed)),
        matchedUnlocated: sh.matchedUnlocated or (gateOk and not(slop.tags.get(p._1).contains("loc") and slop.tags.get(p._2).contains("loc"))),
        matchedMinor: sh.matchedMinor or (gateOk and not(adult(p._1) and adult(p._2))),
        matchedHeld: sh.matchedHeld or (gateOk and (slop.held.get(p._1) or slop.held.get(p._2))),
        gateDisagree: sh.gateDisagree or pairHistory(p),
        selectedOverBudget: sh.selectedOverBudget or engineCount(p._1) >= BUDGET_N or engineCount(p._2) >= BUDGET_N,
        judgeRepeat: sh.judgeRepeat or engineRepeat,
      },
    },
    keepPeon, keepOther, now' = now, lastAction' = "slopDailyRun",
  }

  // network.ts:1905-1932 review: approve begins the probe (the first member's invite counts on the budget,
  // outreach.ts:14-17); reject or SLA expiry closes it unsent and marks the pair declined for the Network only.
  action slopReview(p: (str, str), approve: bool): bool = all {
    slop.opp.get(p).stage == "review",
    if (approve) all {
      slop' = { ...slop, opp: slop.opp.set(p, { ...slop.opp.get(p), stage: "probing" }), sentTimes: slop.sentTimes.setBy(p._1, l => l.append(now)) },
      sh' = sh,
    } else all {
      slop' = { ...slop, opp: slop.opp.set(p, { ...slop.opp.get(p), stage: "rejected" }), netDeclAt: slop.netDeclAt.set(p, now) },
      // The next engine run still reads it in recentProposals (world.ts:171 needs unsentProposalIds).
      sh' = { ...sh, unsentBilled: true },
    },
    keepPeon, keepOther, now' = now, lastAction' = "slopReview",
  }

  // Probe outcome (probe first, then the partner; network.ts:2300-2330). A no is an interaction the
  // engine sees (7-day reprobe) and a Network decline (60 days). Both yes: the booked date with a time
  // the slot logic picks without the activity (SD-443).
  action slopProbe(p: (str, str), outcome: str, activity: str, slot: str): bool = all {
    slop.opp.get(p).stage == "probing",
    if (outcome == "yes") all {
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
  // network.ts:4612-4646 postingTurn. A draft starts with a posting command; `src` "mcp" is a profile
  // from the member's assistant (network.ts:735-755: postingTurn runs before the mcp branch).
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
  // "Close my data analyst post" or "we filled it" (jobs.ts:151-159).
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

  // End a posting's seat items that are not booked (network.ts:4549-4560 endSeat).
  pure def endSeat(s: Seat): Seat = if (s.stage == "review" or s.stage == "probing" or s.stage == "candYes") { ...s, stage: "closed" } else s

  // The manager's yes (network.ts:4618-4628): postingFromDraft (jobs.ts:186-198) on the stored posting,
  // then applyPosting (network.ts:4592-4604), then savePosting in the unit's transaction (postings.ts:26-37).
  action mgrYes(src: str): bool = all {
    peon.draft.kind != "none",
    val d = peon.draft
    val prev = peon.posting.get(d.id)
    val isClose = d.kind == "close"
    val openings = if (d.openings > 0) d.openings else if (prev.status == "none") 1 else storedOpenings(prev)
    val stated = if (d.openings > 0) d.openings else if (prev.status == "none") 1 else prev.stated
    val saved: Posting =
      if (isClose) { ...prev, status: "closed", reason: "closed", version: prev.version + 1 }   // jobs.ts:188
      else { status: "active", openings: openings, stated: stated, reason: "",
             createdAt: if (prev.status == "none") now else prev.createdAt, version: prev.version + 1,
             seniority: if (d.kind == "new") d.seniority else prev.seniority, areaOk: if (d.kind == "new") d.areaOk else prev.areaOk }
    val refused = not(isClose) and peon.mgrHeld                        // managerProblem (network.ts:4497-4506)
    // network.facets.id is a primary key: a repeated must-have id fails the insert (postings.ts:33-36).
    val txFails = not(isClose) and d.kind == "new" and d.mustDup
    all {
      peon' = { ...peon, draft: noDraft,
        posting: if (refused or txFails) peon.posting else peon.posting.set(d.id, saved),
        seat: if (isClose and not(txFails)) peon.seat.setBy(d.id, endSeat) else peon.seat },
      ph' = { ...ph,
        mcpConfirmed: ph.mcpConfirmed or (src == "mcp" and not(refused)),
        filledLost: ph.filledLost or (isClose and d.said == "filled"),
        saveFailed: ph.saveFailed or txFails,
        reopened: ph.reopened or (not(refused) and not(isClose) and prev.status == "closed"),
        openingsLost: ph.openingsLost or (not(refused or txFails) and not(isClose) and openings != stated),
      },
    },
    keepSlop, keepOther, now' = now, lastAction' = "mgrYes",
  }

  // Staff postings API (postings.ts:94-157), reached only where jobPostingRoutes is called (harness).
  action staffClose(id: str, reason: str): bool = all {
    peon.env == "harness", peon.posting.get(id).status != "none",
    val prev = peon.posting.get(id)
    peon' = { ...peon, posting: peon.posting.set(id, { ...prev, status: "closed", reason: reason, version: prev.version + 1 }),
              seat: peon.seat.setBy(id, endSeat) },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "staffClose",
  }
  // POST /postings with an existing id (postings.ts:135-150): status "active" is forced; openings from loadPostings.
  action staffSave(id: str, openings: int): bool = all {
    peon.env == "harness", peon.posting.get(id).status != "none", not(peon.mgrHeld),
    val prev = peon.posting.get(id)
    val o = if (openings > 0) openings else storedOpenings(prev)
    val st = if (openings > 0) openings else prev.stated
    all {
      peon' = { ...peon, posting: peon.posting.set(id, { ...prev, status: "active", openings: o, stated: st, reason: "", version: prev.version + 1 }) },
      ph' = { ...ph, reopened: ph.reopened or prev.status == "closed", openingsLost: ph.openingsLost or o != st },
    },
    keepSlop, keepOther, now' = now, lastAction' = "staffSave",
  }
  action staffVerify: bool = all {
    peon.env == "harness", not(peon.mgrHeld),
    peon' = { ...peon, verified: true },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "staffVerify",
  }
  // The integration tests seed the candidate's peon:entity facts (no production writer: SD-224).
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
  // checks the manager (managerProblem) and pair_history on (candidate, manager) (network.ts:3595-3611).
  action peonEngineRun(id: str): bool = all {
    engineSeatOk(id),
    val gateOk = not(peon.mgrHeld) and not(now - peon.declAt < GATE_DAYS)
    all {
      peon' = { ...peon,
        seat: if (gateOk) peon.seat.set(id, { stage: "review", yesVersion: 0 }) else peon.seat,
        introduced: if (gateOk) peon.introduced.union(Set(id)) else peon.introduced },
      ph' = { ...ph,
        engineSelectedHeld: ph.engineSelectedHeld or peon.mgrHeld,
        crossJobBlock: ph.crossJobBlock or (now - peon.declAt < GATE_DAYS and peon.declOn != id) },
    },
    keepSlop, keepOther, now' = now, lastAction' = "peonEngineRun",
  }
  action seatReview(id: str, approve: bool): bool = all {
    peon.seat.get(id).stage == "review",
    peon' = { ...peon, seat: peon.seat.set(id, { ...peon.seat.get(id), stage: if (approve) "probing" else "closed" }),
              declAt: if (approve) peon.declAt else now, declOn: if (approve) peon.declOn else id },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "seatReview",
  }
  action candAnswer(id: str, yes: bool): bool = all {
    peon.seat.get(id).stage == "probing",
    peon' = { ...peon,
      seat: peon.seat.set(id, if (yes) { stage: "candYes", yesVersion: peon.posting.get(id).version } else { ...peon.seat.get(id), stage: "closed" }),
      declAt: if (yes) peon.declAt else now, declOn: if (yes) peon.declOn else id },
    ph' = ph, keepSlop, keepOther, now' = now, lastAction' = "candAnswer",
  }
  action mgrAnswer(id: str, yes: bool): bool = all {
    peon.seat.get(id).stage == "candYes",
    peon' = { ...peon, seat: peon.seat.set(id, { ...peon.seat.get(id), stage: if (yes) "booked" else "closed" }),
              declAt: if (yes) peon.declAt else now, declOn: if (yes) peon.declOn else id },
    ph' = { ...ph, seatFilled: ph.seatFilled or yes },
    keepSlop, keepOther, now' = now, lastAction' = "mgrAnswer",
  }

  // ================================================================== probe flow library (probe-flow)
  // startProbeFlow with a pair or a one-participant kind (attention.ts:781-795; network_growth size [1,1]).
  action flowStart(n: int): bool = all {
    flow.stage == "idle" or flow.stage == "closed" or flow.stage == "revealed",
    flow' = { n: n, stage: "probing_first", answers: Set("x", "y").mapBy(m => if (m == "x" or n == 2) "pending" else "none") },
    keepSlop, keepPeon, plan' = plan, focus' = focus, now' = now, lastAction' = "flowStart",
  }
  action flowAnswer(m: str, yes: bool): bool = all {
    toProbe(flow).contains(m),
    val answers = flow.answers.set(m, if (yes) "yes" else "no")
    val stage = if (m == "x") (if (yes) "probing_partners" else "closed")
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
    // network.ts:4531-4547 checkSeats at every tick: an open seat item of a posting that is not active ends.
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
  // Each holds by a rule, not by the code. The register id is the defect a violation reproduces.

  // AGENTS.md "Code invariants", platform decision 1: minors (13-17) are never matched; filters.ts:25-30.
  val minorNeverCandidate = not(sh.matchedMinor)
  // AGENTS.md "Keep every safety guard": a held member is never put in a new opportunity (filters.ts:57, network.ts:3710).
  val heldNeverCandidate = not(sh.matchedHeld)
  // onboard.ts:1-4 and extract.ts:77 (matchable = adult, every hard field set, and confirmed); AGENTS.md
  // "Clef ratings (2026-10-09)": slop onboarding is the readBack loop. A proposal waits for the read-back. SD-060.
  val readBackBeforeMatch = not(sh.matchedUnconfirmed)
  // extract.ts:41 HARD_FIELDS includes location; rules.ts:2-3 hard filters run before scoring. SD-209.
  val locatedBeforeMatch = not(sh.matchedUnlocated)
  // apphooks.ts:28-30 and network.ts:1047: the tags are what the member said; newer replace older. SD-061.
  val deletedFieldClearsTag = SLOP_MEMBERS.forall(m => slop.tags.get(m).contains("db:smoker") == slop.ob.get(m).db)
  // onboard.ts:84-87: a correction leaves the profile unconfirmed and "the service reads back again". SD-418.
  val readBackHasPath = SLOP_MEMBERS.forall(m =>
    val o = slop.ob.get(m)
    (adult(m) and o.core and o.loc and not(o.confirmed) and slop.awaiting.get(m) != "readback") implies o.readBacks < MAX_ASKS)
  // service/packs.ts:99-101: every answer goes to the onboarding loop. SD-427.
  val answersReachLoop = not(sh.lostAnswer)
  // onboard.ts:120-121 ("undefined when there is nothing left to ask"), index.ts:135 one compatibility message. SD-419.
  val askTerminates = not(sh.basicsAfterAnswer)
  // network.ts:2327 "a no is remembered for the pair: never probed again for a while, from any path";
  // the engine's view of a pair must agree with the gate, or the gate drops its pick every day. SD-223.
  val engineAgreesWithGate = not(sh.gateDisagree)
  // world.ts:170 "proposals the Network never sent neither count against budgets nor block the pair";
  // SLOP_ENGINE_CONFIG dispatch.billOnlySent. SD-262, SD-210.
  val unsentNotBilled = not(sh.unsentBilled)
  // PRD 40.3 caps, outreach.ts:14-21 budgets; engine config budgets limit 2 per 7 days. SD-207.
  val budgetAcrossAssign = not(sh.selectedOverBudget)
  // config.ts:183 judge ttlMs: a verdict is reused within its TTL. SD-420.
  val judgeCacheReused = not(sh.judgeRepeat)
  // service/packs.ts:153-154 "a daytime hike"; packs/slop/plan.ts PUBLIC_VENUE trailhead daytime. SD-443.
  val activityFitsSlot = not(sh.hikeAtNight)

  // jobs.ts:33-35 closedReason; jobs.ts:125 "no new candidates are sent": a closed post stays closed. SD-114.
  val closedTerminal = not(ph.reopened)
  // jobs.ts:186 "an update keeps what the draft does not change". SD-114.
  val openingsPreserved = not(ph.openingsLost)
  // jobs.ts:11-13 "rules only, never an LLM's open-turn output ... saved only after the manager's yes";
  // network.ts:735-738 only the member's own text answers. SD-042.
  val confirmedInOwnThread = not(ph.mcpConfirmed)
  // jobs.ts:14 and 34-35: "we filled it" closes as filled. SD-327.
  val filledRecorded = not(ph.filledLost)
  // postingProblem accepts it and the member hears "Posted": the rows must commit. SD-227.
  val acceptedPostingPersists = not(ph.saveFailed)
  // jobs.ts:4-10: an active posting is a job seat the engine can match ("Posted"). SD-121.
  val activeIsLive = POSTINGS.forall(id => peon.posting.get(id).status == "active" implies now < peon.posting.get(id).createdAt + HORIZON)
  // jobs.ts:114 copy "Posted"; a job saved must be able to pass the pack's own filters. SD-226.
  val postedCanMatch = POSTINGS.forall(id => peon.posting.get(id).status == "active" implies (peon.posting.get(id).seniority and peon.posting.get(id).areaOk))
  // postings.ts:8-9 "peonPack proposes no job of an unverified employer": a path to verify must exist. SD-225.
  val postedVerifiable = POSTINGS.forall(id => (peon.env == "prod" and peon.posting.get(id).status == "active") implies peon.verified)
  // peon/profile.ts:116-118: candidates come from peon:entity facts; something must write them. SD-224.
  val candidatesWritable = POSTINGS.forall(id => (peon.env == "prod" and peon.posting.get(id).status == "active") implies peon.candOn)
  // A yes is consent to the text the member saw (AGENTS.md consent guard). SD-440.
  val inFlightMatchesPosting = POSTINGS.forall(id => peon.seat.get(id).stage == "candYes" implies peon.seat.get(id).yesVersion == peon.posting.get(id).version)
  // A no is about one job (seat copy jobs.ts:279); the engine keys it by seat. SD-439.
  val declineScopedToJob = not(ph.crossJobBlock)
  // A held manager's seat is never selected (filters.ts:57 holds; network.ts:4497-4506). SD-296.
  val engineNeverSelectsHeld = not(ph.engineSelectedHeld)
  // network.ts:4531-4547 checkSeats: a seat is never booked past its openings.
  val seatCapacity = POSTINGS.forall(id => peon.seat.get(id).stage == "booked" implies peon.posting.get(id).openings >= 1)

  // attention.ts:776-779 "nobody is named before everyone needed said yes": a flow still probing has someone to ask. SD-063.
  val probeFlowProgresses = (flow.stage == "probing_first" or flow.stage == "probing_partners") implies toProbe(flow).size() > 0
  // plans.ts:141-144 "minors, paused, safety holds, ... and the reliability hold-out all exclude". SD-206.
  val planSeatHonorsHoldout = (plan.minor implies planReason(plan) == "underage") and (plan.reliabilityHold implies planReason(plan) != "")

  val safety = all {
    minorNeverCandidate, heldNeverCandidate, readBackBeforeMatch, locatedBeforeMatch, deletedFieldClearsTag,
    readBackHasPath, answersReachLoop, askTerminates, engineAgreesWithGate, unsentNotBilled, budgetAcrossAssign,
    judgeCacheReused, activityFitsSlot,
    closedTerminal, openingsPreserved, confirmedInOwnThread, filledRecorded, acceptedPostingPersists, activeIsLive,
    postedCanMatch, postedVerifiable, candidatesWritable, inFlightMatchesPosting, declineScopedToJob,
    engineNeverSelectsHeld, seatCapacity,
    probeFlowProgresses, planSeatHonorsHoldout,
  }

  // ================================================================== witnesses (must be reachable)
  val witness_readBackConfirmed = not(SLOP_MEMBERS.exists(m => slop.ob.get(m).confirmed))
  val witness_matchedAfterConfirm = not(sh.bookedConfirmed)
  val witness_postingActive = not(POSTINGS.exists(id => peon.posting.get(id).status == "active"))
  val witness_postingFilled = not(ph.seatFilled)
  val witness_flowRevealed = flow.stage != "revealed"
  val witness_probeDeclined = not(PAIRS.exists(p => slop.opp.get(p).stage == "declined"))

  // ================================================================== runs (traces from the code and the tests)
  action say(m: str, k: str): bool = memberSays(m, false, k)
  action hardFields(m: str): bool = agentNext(m).then(say(m, "core")).then(say(m, "loc"))

  // Onboarding to a confirmed read-back (docs/results/2026-10-09-slop-onboarding.md).
  run readBackTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(say("a", "loc"))
    .expect(slop.awaiting.get("a") == "readback" and slop.ob.get("a").readBacks == 1)
    .then(say("a", "yes")).expect(slop.ob.get("a").confirmed and slop.awaiting.get("a") == "question")

  // SD-060: both members state every hard field and never answer the read-back; the next run proposes them.
  run unconfirmedMatchTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(say("a", "loc"))
    .then(agentNext("b")).then(say("b", "core")).then(say("b", "loc"))
    .then(slopDailyRun(("a", "b"))).expect(not(readBackBeforeMatch) and slop.opp.get(("a", "b")).stage == "review")

  // SD-209: hard fields without a location still match (needs_answer reads tags; zipUnknown is false).
  run unlocatedMatchTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(agentNext("b")).then(say("b", "core"))
    .then(slopDailyRun(("a", "b"))).expect(not(locatedBeforeMatch))

  // SD-061: "no smokers", then "smoking is fine": the dealbreaker tag stays.
  run deletedDealbreakerTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "dbAdd")).then(say("a", "dbRemove"))
    .expect(not(slop.ob.get("a").db) and slop.tags.get("a").contains("db:smoker") and not(deletedFieldClearsTag))

  // The stale tag still filters: a (no dealbreaker now) and b (a smoker) are never proposed.
  run staleTagFiltersTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "dbAdd")).then(say("a", "dbRemove")).then(say("a", "core"))
    .then(agentNext("b")).then(say("b", "core"))
    .expect(not(enginePairs.contains(("a", "b"))))

  // SD-418: two read-backs answered with corrections; no third read-back, the profile stays unconfirmed.
  run readBackCapTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(say("a", "loc"))
    .then(say("a", "coreChange")).then(say("a", "goal")).then(say("a", "coreChange"))
    .expect(not(readBackHasPath) and slop.ob.get("a").readBacks == 2 and slop.awaiting.get("a") == "question")

  // SD-427: a question sent, four days of silence, the sweep, then the answer goes to an open turn.
  run sweptAnswerTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(tick(3)).then(tick(1)).then(sweep("a")).then(say("a", "core"))
    .expect(not(answersReachLoop) and not(slop.ob.get("a").core))

  // SD-223: a probe no at day 0; at day 7 the engine proposes the pair again; the gate drops it (60 days).
  run reprobeGateTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(agentNext("b")).then(say("b", "core"))
    .then(slopDailyRun(("a", "b"))).then(slopReview(("a", "b"), true)).then(slopProbe(("a", "b"), "no", "drinks", "eve"))
    .then(tick(7)).then(slopDailyRun(("a", "b")))
    .expect(not(engineAgreesWithGate) and slop.opp.get(("a", "b")).stage == "declined")

  // SD-262: a proposal rejected in review is still billed by the next engine run.
  run rejectedBilledTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(agentNext("b")).then(say("b", "core"))
    .then(slopDailyRun(("a", "b"))).then(slopReview(("a", "b"), false))
    .expect(not(unsentNotBilled) and engineCount("a") == 1 and sentCount("a") == 0)

  // Matched after both read-backs were confirmed; booked.
  run confirmedMatchTest = initWith("prod", false, "slop")
    .then(hardFields("a")).then(say("a", "yes")).then(hardFields("b")).then(say("b", "yes"))
    .then(slopDailyRun(("a", "b"))).then(slopReview(("a", "b"), true)).then(slopProbe(("a", "b"), "yes", "drinks", "eve"))
    .expect(not(witness_matchedAfterConfirm) and safety)

  // SD-207: two proposals for a in one week, both rejected in review; the engine selects a a third time.
  run overBudgetTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(agentNext("b")).then(say("b", "core")).then(agentNext("c")).then(say("c", "core"))
    .then(slopDailyRun(("a", "b"))).then(slopReview(("a", "b"), false))
    .then(slopDailyRun(("a", "c"))).then(slopReview(("a", "c"), false))
    .then(slopDailyRun(("a", "b"))).expect(not(budgetAcrossAssign) and engineCount("a") == 2)

  // A minor (k) never enters the engine input, whatever k says.
  run minorExcludedTest = initWith("prod", false, "slop")
    .then(hardFields("a")).expect(not(PAIRS.exists(p => has(p, "k") and enginePairs.contains(p))))

  // SD-042: a draft and its yes both come from the assistant (source "mcp").
  run mcpPostingTest = initWith("prod", false, "slop")
    .then(mgrDraftNew("A", 2, true, true, false)).then(mgrYes("mcp"))
    .expect(peon.posting.get("A").status == "active" and not(confirmedInOwnThread))

  // SD-114 (harness: the staff API as the integration test calls it): close as filled, then save with the id.
  run staffReopenTest = initWith("harness", false, "peon")
    .then(mgrDraftNew("A", 2, true, true, false)).then(mgrYes("sms"))
    .then(staffClose("A", "filled")).then(staffSave("A", 0))
    .expect(peon.posting.get("A").status == "active" and peon.posting.get("A").openings == 1 and not(closedTerminal) and not(openingsPreserved))

  // SD-327: "we filled it" is saved as closedReason "closed".
  run filledTest = initWith("prod", false, "slop")
    .then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms"))
    .then(mgrDraftClose("A", "filled")).then(mgrYes("sms"))
    .expect(peon.posting.get("A").reason == "closed" and not(filledRecorded))

  // SD-227: a repeated must-have: the save transaction fails after "Posted".
  run dupMustTest = initWith("prod", false, "slop").then(mgrDraftNew("A", 1, true, true, true)).then(mgrYes("sms"))
    .expect(not(acceptedPostingPersists) and peon.posting.get("A").status == "none")

  // SD-121: posted on day 0, still active on day 90 and later; the engine no longer sees a live intent.
  run silentExpiryTest = initWith("prod", false, "slop").then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms"))
    .then(tick(30)).then(tick(30)).then(tick(30)).expect(not(activeIsLive))

  // SD-440 (harness): the candidate says yes, the manager then edits the post; the item goes on.
  run staleYesTest = initWith("harness", false, "peon")
    .then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms")).then(staffVerify).then(harnessCandidate)
    .then(peonEngineRun("A")).then(seatReview("A", true)).then(candAnswer("A", true))
    .then(mgrDraftUpdate("A", 0)).then(mgrYes("sms"))
    .expect(not(inFlightMatchesPosting))

  // SD-439 (harness): the candidate says no to job A; job B of the same manager is gated for 60 days.
  run crossJobTest = initWith("harness", false, "peon")
    .then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms"))
    .then(mgrDraftNew("B", 1, true, true, false)).then(mgrYes("sms"))
    .then(staffVerify).then(harnessCandidate)
    .then(peonEngineRun("A")).then(seatReview("A", true)).then(candAnswer("A", false))
    .then(peonEngineRun("B")).expect(not(declineScopedToJob) and peon.seat.get("B").stage == "none")

  // SD-296 (harness): the manager is on hold; the engine still selects the seat.
  run heldSeatTest = initWith("harness", false, "peon")
    .then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms")).then(staffVerify).then(harnessCandidate)
    .then(setMgrHold(true)).then(peonEngineRun("A"))
    .expect(not(engineNeverSelectsHeld) and peon.seat.get("A").stage == "none")

  // A posting fills (harness): candidate yes, manager yes.
  run postingFillsTest = initWith("harness", false, "peon")
    .then(mgrDraftNew("A", 1, true, true, false)).then(mgrYes("sms")).then(staffVerify).then(harnessCandidate)
    .then(peonEngineRun("A")).then(seatReview("A", true)).then(candAnswer("A", true)).then(mgrAnswer("A", true))
    .expect(not(witness_postingFilled))

  // SD-063: a one-participant flow: the yes moves to probing_partners with nobody left to probe.
  run oneParticipantFlowTest = initWith("prod", false, "slop").then(flowStart(1)).then(flowAnswer("x", true))
    .expect(flow.stage == "probing_partners" and not(probeFlowProgresses))

  // A pair flow reveals on two yeses.
  run pairFlowTest = initWith("prod", false, "slop").then(flowStart(2)).then(flowAnswer("x", true)).then(flowAnswer("y", true))
    .expect(flow.stage == "revealed")

  // SD-206: at the weekly budget and in the reliability hold-out: planMemberReason returns null.
  run planHoldoutTest = initWith("prod", false, "slop").then(setPlanFacts(false, true, true)).expect(not(planSeatHonorsHoldout))

  // SD-419: goal and "no dealbreakers" answered and confirmed; the engine asks the basics every 21 days.
  run basicsLoopTest = initWith("prod", false, "slop")
    .then(agentNext("a")).then(say("a", "core")).then(say("a", "goal")).then(say("a", "dbNone")).then(say("a", "loc"))
    .then(say("a", "yes")).expect(slop.awaiting.get("a") == "none")
    .then(engineBasicsAsk("a")).expect(not(askTerminates))
}
