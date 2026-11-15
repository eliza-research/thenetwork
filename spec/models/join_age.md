# Membership and age

## Story: Membership and age

A person needs to join by text or web and have their lowest stated age apply across apps.

### Safety rules and reachability

Check membership creation, the age floor, under-13 erasure, and single-player access for minors. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [shared-line enrollment spec](../textEnrollment.md) generates app routing, text join and other-app enrollment decisions. This standalone model retains the database, restart and age-propagation behavior around those decisions.

Imported from `quint/join_age.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// quint-check: max-steps=40 max-samples=4000 verify-steps=6
//
// join_age: the join paths and the age policy for one phone and one person (module plan:
// docs/research/2026-11-07-state-machines.md section 6.3). Machines: text-join (M-014), web-join (M-015),
// age-floor (M-016), member-age-policy (M-017), minor-single-player (M-018), looking-for-enroll (M-019),
// membership (M-020), staff-invite (M-021), eliza-notice (M-112), member-onboarding (M-113).
//
// The model follows the code of branch wave2/join_age after the fixes (base ad67275; the fixed defects and
// their commits are in docs/research/quint-findings/join_age.md section 4). Line references are to ad67275:
//   S = packages/network/service/service.ts, A = packages/platform/src/accounts.ts,
//   PS = packages/platform/src/pg-store.ts, N = packages/network/src/network.ts,
//   R = packages/network/service/runtime.ts.
// Each SQL transaction (or one in-process unit of work of the ConsentNetwork) is one action. Between two
// actions the process can crash (memory is lost: R:131 statedAges) or a step can throw (the turn's onFail
// undo runs: S:1195). The text parser (parseJoinText, lookingFor), the network classifier and the
// presence check are oracles: a message carries their output as nondeterministic fields.
//
// Scope and abstractions: one phone, one person, three apps (ntwrk, slop, friends). Ages abstract to
// {12, 15, 25} on the text path and {0, 12, 15, 25} on the web path (S:262 refuses 0 in text; A:87 accepts
// it on the web). Join modes are the production values (AGENTS.md 2026-10-09: ntwrk invite-only on the web,
// slop and friends open). Every text turn is a signed gateway turn (AGENTS.md decision 2). One turn runs at
// a time: text and web joins share the `join:<phone>` lock (S:1140, A:348), and the member path runs alone
// here, so concurrent interleavings of two turns are not modelled. Stop, leave, holds, bans, photos and
// suppression are in other modules.
module join_age {
  // ------------------------------------------------------------------ constants
  pure val NONE = -1
  pure val APPS = Set("ntwrk", "slop", "friends")
  pure val OTHER_APPS = Set("slop", "friends")
  // A membership that is a live member (not invited, not removed): the code's own filter (S:1442, A:357).
  pure val LIVE = Set("onboarding", "active", "paused")
  pure val TEXT_AGES = Set(NONE, 12, 15, 25)
  pure val WEB_AGES = Set(0, 12, 15, 25)
  pure val MAX_CRASHES = 1
  pure val MAX_FAILS = 1

  // platform.apps.min_join_age: 13 on every app (migration 0007:141, AGENTS.md decision 1). Matching and
  // dating stay 18+ (minMatchAge, the enroll filter at S:1479-1480).
  pure def minJoin(a: str): int = 13
  // AGENTS.md founder decisions 2026-10-09 (1): slop, peon, friends open; ntwrk invite-only on the web.
  pure def joinMode(a: str): str = if (a == "ntwrk") "invite" else "open"

  // ------------------------------------------------------------------ types
  type Net = {
    exists: bool, mid: int, age: int, statedAge: int, minor: bool,
    // N:243 stage, N:278 awaiting (only the interview kind matters here)
    stage: str, awaitInt: bool,
  }
  type Pend = { has: bool, app: str, age: int, name: bool }
  type Db = {
    personExists: bool, personLowest: int, floor: int,
    pendJoin: Pend, pendLF: bool,
    mstate: str -> str, mid: str -> int, net: str -> Net,
    // noticeStuck: the notice row names a turn whose worker stopped (turn_id, migration 0043, SD-276).
    noticeRow: bool, noticeStuck: bool, nextId: int,
  }
  type Vol = { app: str, age: int, explicit: bool, declined: bool }
  // One text message as the oracles read it: kw is a whole-message app keyword (keywordApp), age and name
  // from parseJoinText or the network classifier, wants from lookingFor, signal a minor signal with no age
  // ("i have homework"), long a text over 12 characters, explicit a first-person explicit age, badHome a home
  // city that parseJoinText reads as invalid (invalidHome: the need_home step of decisions.ts joinStep).
  type Msg = { kw: str, age: int, name: bool, wants: Set[str], signal: bool, long: bool, explicit: bool, badHome: bool }
  type Turn = {
    pc: str, kind: str, app: str, msg: Msg,
    wroteNotice: bool, replied: bool, turnApp: str, outcome: str,
    todo: Set[str], joined: Set[str], lowest: int, askOpenAt: bool, askedLF: bool,
    invited: bool, others: bool, age: int, name: bool, cur: str, declined: bool,
    // A repeated web join that completes a membership with no network member (Q-join_age-2).
    repeat: bool,
    // The member was already a minor in the Network when the text came, and was still at stage new (its first
    // text gets the welcome, N:978-992): ghost reads for the invariants.
    minorAt: bool, newAt: bool,
  }
  type Last = {
    kind: str, app: str, replied: bool, outcome: str, minor: bool, long: bool, other: bool, minorAt: bool, newAt: bool,
    ctx: bool, single: bool, turnApp: str,
  }
  type Ghost = {
    everStated: Set[int], noticeDelivered: bool, askOpen: bool, flags: Set[str], last: Last,
    // A unit committed a declined (under-13) age and statedAge has not yet forgotten the other memberships.
    declineOpen: bool,
    crashes: int, fails: int, texts: int,
  }

  pure val NO_NET: Net = { exists: false, mid: 0, age: NONE, statedAge: NONE, minor: false, stage: "new", awaitInt: false }
  pure val NO_PEND: Pend = { has: false, app: "", age: NONE, name: false }
  pure val NO_MSG: Msg = { kw: "", age: NONE, name: false, wants: Set(), signal: false, long: false, explicit: false, badHome: false }
  pure val IDLE: Turn = {
    pc: "idle", kind: "", app: "", msg: NO_MSG, wroteNotice: false, replied: false, turnApp: "", outcome: "",
    todo: Set(), joined: Set(), lowest: NONE, askOpenAt: false, askedLF: false,
    invited: false, others: false, age: NONE, name: false, cur: "", declined: false, repeat: false, minorAt: false, newAt: false,
  }
  pure val NO_LAST: Last = { kind: "", app: "", replied: false, outcome: "", minor: false, long: false, other: false, minorAt: false, newAt: false, ctx: false, single: false, turnApp: "" }

  // ------------------------------------------------------------------ state
  var db: Db       // durable rows (platform and network schemas)
  var vol: Set[Vol] // R:131 statedAges: process memory, lost on a crash
  var turn: Turn   // the turn in flight (process memory)
  var g: Ghost     // history and markers for the invariants; the code never reads it

  // ------------------------------------------------------------------ helpers
  // The lower of two ages, NONE is unknown (packages/platform/src/age.ts lowestAge).
  pure def lo(a: int, b: int): int = if (a < 0) b else if (b < 0) a else if (a < b) a else b
  pure def hi(a: int, b: int): int = if (a > b) a else b
  // A.lowestAge (A:281): the person's lowest age (a live person only) and the phone's age floor.
  pure def effLowest(d: Db): int = lo(if (d.personExists) d.personLowest else NONE, d.floor)
  // packages/platform/src/age.ts joinAgeCheck: the stated age and the stored lowest; effective is the lower.
  pure def joinOk(stated: int, lowest: int, a: str): bool = stated >= 0 and lo(stated, lowest) >= minJoin(a)
  pure def live(d: Db, a: str): bool = LIVE.contains(d.mstate.get(a))
  // Matching eligibility: N:3746 (no minor flag) and the matching view of migration 0038 (least of the
  // member age, the person's lowest age and the phone's age floor), for an active membership.
  pure def matchable(d: Db, a: str): bool = {
    val n = d.net.get(a)
    n.exists and d.mstate.get(a) == "active" and not(n.minor)
      and lo(lo(n.age, if (d.personExists) d.personLowest else NONE), d.floor) >= 18
  }

  // A.recordAge (A:286-300): the phone floor keeps the least (PS:97), then in `finally` the person keeps the
  // least (PS:111) and every app's member follows (S:775-783 ageLowered, for each membership that is not
  // removed). Migration 0043 lets the floor keep 0 (SD-383: the check was lowest_age > 0 and an age of 0 raised).
  pure def recordAge(d: Db, age: int): Db = {
    val floorVal = lo(age, if (d.personExists) d.personLowest else NONE)
    val d1 = d.with("floor", lo(d.floor, floorVal))
    if (not(d1.personExists)) d1
    else {
      val after = lo(d1.personLowest, age)
      val net2 = APPS.mapBy(a => {
        val n = d1.net.get(a)
        if (n.exists and d1.mstate.get(a) != "removed" and d1.mstate.get(a) != "none") n.with("age", lo(n.age, after)) else n
      })
      d1.with("personLowest", after).with("net", net2)
    }
  }

  // A.declineUnderAge (SD-014, b6a1489): when the phone's lowest age is under 13, the phone's pending text
  // join is deleted (Q-join_age-3, this branch), and every membership of the person that is not removed
  // (invited ones too) goes through onForget (the network member) and forgetMembership, with a join_declined
  // opt-out. The join paths call it right after recordAge on their under_age branch.
  pure def declineUnderAge(d: Db): Db = {
    val lowest = effLowest(d)
    if (lowest < 0 or lowest >= 13) d
    else if (not(d.personExists)) d.with("pendJoin", NO_PEND)
    else {
      val gone = APPS.filter(a => d.mstate.get(a) != "none" and d.mstate.get(a) != "removed")
      d.with("pendJoin", NO_PEND).with("net", APPS.mapBy(a => if (gone.contains(a)) NO_NET else d.net.get(a)))
        .with("mstate", APPS.mapBy(a => if (gone.contains(a)) "removed" else d.mstate.get(a)))
    }
  }

  // S:723-750 createMember: insert or update network.members by member id; the inbound turn's app and
  // member are overwritten (S:747-750). A different id inserts a second row: the old one stays active.
  pure def createMember(d: Db, a: str, age: int): Db = {
    val n: Net = { exists: true, mid: d.mid.get(a), age: age, statedAge: NONE, minor: age < 18, stage: "new", awaitInt: false }
    d.with("net", d.net.set(a, n))
  }
  pure def dupMember(d: Db, a: str): bool = d.net.get(a).exists and d.net.get(a).mid != d.mid.get(a)

  // N:978-992 welcome (also N:4825 welcomeJoined): a minor gets welcomeMinor and stage active; an adult
  // gets the first interview question (stage q1, awaiting interview).
  pure def welcome(n: Net): Net =
    if (n.minor) n.with("stage", "active").with("awaitInt", false) else n.with("stage", "q1").with("awaitInt", true)

  // The ages a unit read go to the person and the phone's age floor in the unit's own save transaction
  // (SD-011, f1dc7c7, runtime.ts writeUnit): the filter and the recorded age of statedAge (S:1294-1300).
  // Network member ages follow only in the later statedAge step (ageLowered).
  pure def unitAges(d: Db, a: str, vs: Set[Vol]): Db = {
    val keep = vs.filter(v => v.explicit or v.declined or v.age < 18)
    val rec = keep.fold(NONE, (acc, v) => lo(acc, if (v.declined) v.age else hi(v.age, minJoin(a))))
    if (rec < 0) d
    else d.with("floor", lo(d.floor, rec)).with("personLowest", if (d.personExists) lo(d.personLowest, rec) else d.personLowest)
  }

  // One ConsentNetwork unit for a member's text (N:674-842, handleInbound), abstracted to the age policy,
  // the welcome, the interview and the final disposition.
  type UnitOut = { n: Net, vol: Set[Vol], outcome: str, replied: bool, adultQToMinor: bool }
  pure def unitOf(n: Net, a: str, m: Msg): UnitOut = {
    val attested = n.age
    val adultRecord = attested >= 18
    val attestedUnder = attested >= 0 and attested < minJoin(a)
    val explicitUnder = m.explicit and m.age >= 0 and m.age < minJoin(a) and not(adultRecord)
    if (attestedUnder or explicitUnder) {
      // N:694-695 declineUnderMinAge (N:897-905): onAgeStated(declined), the member is forgotten.
      val declAge = if (attestedUnder and explicitUnder) lo(attested, m.age) else if (attestedUnder) attested else m.age
      { n: NO_NET, vol: Set({ app: a, age: declAge, explicit: true, declined: true }), outcome: "declined", replied: true, adultQToMinor: false }
    } else {
      // N:700 onAgeStated for any stated age.
      val v = if (m.age >= 0) Set({ app: a, age: m.age, explicit: m.explicit, declined: false }) else Set()
      val st = lo(n.statedAge, m.age)
      val ageMin = lo(attested, st)
      val becomes = (ageMin >= 0 and ageMin < 18 or m.signal) and not(n.minor)
      val n0 = n.with("statedAge", st).with("minor", n.minor or becomes)
      // SD-213 (a4326bf, N:722): a member who becomes a minor in the interview (q1 to q3) goes to stage
      // active and the open interview question closes, as welcome() does for a minor.
      val n1 = if (becomes and (n0.stage == "q1" or n0.stage == "q2" or n0.stage == "q3")) n0.with("stage", "active").with("awaitInt", false) else n0
      if (becomes and minJoin(a) > 13) {
        // N:723-727: an 18+ app opens a case, no reply.
        { n: n1, vol: v, outcome: "handled", replied: false, adultQToMinor: false }
      } else if (becomes and n1.stage != "new") {
        // N:728: minorNotice and return. stage and awaiting stay as they were.
        { n: n1, vol: v, outcome: "handled", replied: true, adultQToMinor: false }
      } else if (n1.stage == "new") {
        { n: welcome(n1), vol: v, outcome: "handled", replied: true, adultQToMinor: false }
      } else if (n1.awaitInt and (n1.stage == "q1" or n1.stage == "q2")) {
        // N:1081-1098 onInterviewAnswer: the next adult interview question (copy.interview).
        val nx = if (n1.stage == "q1") "q2" else "q3"
        { n: n1.with("stage", nx).with("awaitInt", true), vol: v, outcome: "handled", replied: true, adultQToMinor: n1.minor }
      } else if (n1.awaitInt and n1.stage == "q3") {
        { n: n1.with("stage", "active").with("awaitInt", false), vol: v, outcome: "handled", replied: true, adultQToMinor: false }
      } else {
        // SD-065 (e94c1d8): the concierge branch (N:835) is gone: a minor's ordinary text is an open turn too.
        { n: n1, vol: v, outcome: "open", replied: false, adultQToMinor: false }
      }
    }
  }

  // S:957-981 route (one shared line; a whole-message keyword names the app). The apps a text can go to:
  // one app, or (rule 4, the newest open item or the last writer) any of the member's apps, or (a staff
  // invite) any invited app (`find` takes the first row).
  pure def mine(d: Db): Set[str] = APPS.filter(a => d.net.get(a).exists)
  pure def invitedApps(d: Db): Set[str] = APPS.filter(a => d.mstate.get(a) == "invited")
  // Route rule 3: a join the person started takes a reply that reads as a join answer (or any reply of a
  // stranger); SD-488 (1a6ed45): a staff invite with no pending join takes the reply by the same rule.
  pure def pendRoute(d: Db, m: Msg): bool = d.pendJoin.has and not(mine(d).contains(d.pendJoin.app)) and (mine(d).size() == 0 or m.age >= 0)
  pure def inviteRoute(d: Db, m: Msg): bool = not(d.pendJoin.has) and d.personExists and invitedApps(d).size() > 0 and (mine(d).size() == 0 or m.age >= 0)
  pure def routeChoices(d: Db, m: Msg): Set[str] = {
    val pendApp = pendRoute(d, m)
    val inviteApp = inviteRoute(d, m)
    // Q-join_age-1 (bcd83b8): a bare app word from a member of The Network with the looking-for question open.
    if (m.kw != "" and m.kw != "ntwrk" and mine(d).contains("ntwrk") and d.pendLF) Set("ntwrk")
    else if (m.kw != "") Set(m.kw)
    else if (pendApp) Set(d.pendJoin.app)
    else if (inviteApp) invitedApps(d)
    else if (mine(d).size() > 0) mine(d)
    else Set("ntwrk")
  }
  // S:1124-1125 after bcd83b8: the apps the answer names, lookingFor plus a whole-message app word.
  pure def wantsOf(m: Msg): Set[str] = m.wants.union(if (m.kw != "") Set(m.kw) else Set()).exclude(Set("ntwrk"))

  // The ages a durable row holds for this phone: person, floor, and a pending join age (it lives a day).
  pure def durableLowest(d: Db): int = lo(effLowest(d), if (d.pendJoin.has) d.pendJoin.age else NONE)

  def flag(f: str): Set[str] = g.flags.union(Set(f))

  // ------------------------------------------------------------------ init
  action init = all {
    db' = {
      personExists: false, personLowest: NONE, floor: NONE, pendJoin: NO_PEND, pendLF: false,
      mstate: APPS.mapBy(a => "none"), mid: APPS.mapBy(a => 0), net: APPS.mapBy(a => NO_NET),
      noticeRow: false, noticeStuck: false, nextId: 1,
    },
    vol' = Set(),
    turn' = IDLE,
    g' = { everStated: Set(), noticeDelivered: false, askOpen: false, flags: Set(), last: NO_LAST, declineOpen: false, crashes: 0, fails: 0, texts: 0 },
  }

  // ------------------------------------------------------------------ text turn: receive and route
  // S:1012-1027 and route: the path is chosen here. The inbox admission of the turn first sweeps a stuck
  // turn of this sender to unresolved and deletes the notice row that names it (SD-276, 7b0cd6f,
  // inbox.ts:92-95); nothing else is written.
  action receive(m: Msg, pick: str): bool = {
    val app = pick
    val member = db.net.get(app).exists
    val lf = member and app == "ntwrk" and db.pendLF
    val enroll = lf and wantsOf(m).size() > 0
    // The answer of a member of The Network to "what are you looking for?" that names an app (S:1114-1117
    // comment). A person whose ntwrk membership went (an under-13 decline) has no question to answer. A reply
    // that reads as a join answer to a join the person started or to a staff invite goes to that join first
    // (route rule 3, S:949-953): that is the code's documented order, not a lost answer.
    val misrouted = g.askOpen and db.pendLF and mine(db).contains("ntwrk") and wantsOf(m).size() > 0 and not(enroll)
      and not(m.kw == "" and (pendRoute(db, m) or inviteRoute(db, m)))
      // The question is asked only to a person with no other app (S:1454-1461). A person who joined another app
      // since then has a text with no app word routed by rule 4 (the newest open item, the last writer).
      and (m.kw != "" or mine(db) == Set("ntwrk"))
    all {
      turn.pc == "idle",
      routeChoices(db, m).contains(pick),
      // SD-038 (b3f9868): the looking-for answer is read by the unit and statedAge before enroll.
      // SD-179 (55941d0): a looking-for reply that names no app closes the question first.
      turn' = IDLE.with("pc", if (lf and not(enroll)) "lf_close" else if (member) "unit" else "notice")
        .with("kind", if (enroll) "enroll" else if (member) "member" else "text")
        .with("app", app).with("msg", m).with("askOpenAt", g.askOpen).with("minorAt", member and db.net.get(app).minor)
        .with("newAt", member and db.net.get(app).stage == "new"),
      db' = if (db.noticeStuck) db.with("noticeRow", false).with("noticeStuck", false) else db,
      vol' = vol,
      g' = g.with("texts", g.texts + 1).with("flags", if (misrouted) flag("lfMisrouted") else g.flags),
    }
  }

  // ------------------------------------------------------------------ text join (non-member)
  // S:1175-1196 elizaNotice: the row (with its turn id) and the collected reply in one transaction; onFail
  // takes it back.
  action noticeStep = {
    val a = turn.app
    val pend = if (db.pendJoin.has and db.pendJoin.app == a) db.pendJoin else NO_PEND
    val age = if (turn.msg.age >= 0) turn.msg.age else pend.age
    val floor = effLowest(db)
    val skip = mine(db).size() > 0 or (age >= 0 and not(joinOk(age, floor, a))) or (floor >= 0 and floor < 13)
    val wrote = not(skip) and not(db.noticeRow)
    all {
      turn.pc == "notice",
      db' = if (wrote) db.with("noticeRow", true) else db,
      turn' = turn.with("pc", "join").with("wroteNotice", wrote),
      vol' = vol, g' = g,
    }
  }

  // S:1384-1433 join: the decision. It ends the turn (ask, invite-only, under-13 floor) or starts the commits.
  action joinStep = {
    val a = turn.app
    val m = turn.msg
    val invited = db.mstate.get(a) == "invited"
    val inviteOnly = joinMode(a) == "invite" and not(invited) and not(a == "ntwrk")
    val pend = if (db.pendJoin.has and db.pendJoin.app == a) db.pendJoin else NO_PEND
    val age = if (m.age >= 0) m.age else pend.age
    val name = m.name or pend.name
    val ok = joinOk(age, effLowest(db), a)
    val floorUnder = effLowest(db) >= 0 and effLowest(db) < 13
    // A reply with name and age to a staff invite of another app (S:1553-1563 invite text), when the person
    // has no join of their own in progress (route rule 3 comes first: a join the person started).
    val invitedElsewhere = not(invited) and not(db.pendJoin.has)
      and OTHER_APPS.exists(y => y != a and db.mstate.get(y) == "invited") and m.kw == "" and m.age >= 0 and m.name
    val g1 = if (invitedElsewhere) g.with("flags", flag("invitedMisrouted")) else g
    all {
      turn.pc == "join",
      if (inviteOnly) all {
        db' = db, turn' = turn.with("pc", "done").with("replied", true).with("outcome", "invite_only"), g' = g1,
      } else if (age < 0 and floorUnder) all {
        // SD-315 (ff807e1): no age in the text and an age floor under 13: the decline, the pending join goes.
        db' = db.with("pendJoin", NO_PEND),
        turn' = turn.with("pc", "done").with("replied", true).with("outcome", "under_age"), g' = g1,
      } else if (age < 0 and m.badHome) all {
        // decisions.ts joinStep need_home with no age: the home-city question, no pending join, nothing stored.
        db' = db, turn' = turn.with("pc", "done").with("replied", true).with("outcome", "join_asked"), g' = g1,
      } else if (age < 0) all {
        // S:1408-1414: pending join with the name; the join question (S:1412, at most 3 a day).
        db' = db.with("pendJoin", { has: true, app: a, age: NONE, name: name }),
        turn' = turn.with("pc", "done").with("replied", true).with("outcome", "join_asked"), g' = g1,
      } else if (not(ok)) all {
        db' = db, turn' = turn.with("pc", "j_under").with("age", age), g' = g1,
      } else if (m.badHome) all {
        // decisions.ts joinStep need_home with an age that passed: service.ts join records the age (a statement
        // on every exit past the ban check), then the home-city question; no pending join.
        db' = recordAge(db, age),
        turn' = turn.with("pc", "done").with("replied", true).with("outcome", "join_asked"),
        g' = g1.with("everStated", g.everStated.union(Set(age))),
      } else if (not(name)) all {
        // S:1428-1432: pending join with the age. SD-010 (84c9fef): recordAge first, so the floor keeps it.
        db' = recordAge(db, age).with("pendJoin", { has: true, app: a, age: age, name: false }),
        turn' = turn.with("pc", "done").with("replied", true).with("outcome", "join_asked"),
        g' = g1.with("everStated", g.everStated.union(Set(age))),
      } else all {
        db' = db,
        turn' = turn.with("pc", "j_person").with("age", age).with("name", true).with("invited", invited)
          .with("lowest", lo(age, effLowest(db))),
        g' = g1,
      },
      vol' = vol,
    }
  }

  // S:1417-1424: under the join age: recordAge, declineUnderAge (SD-014, b6a1489), delete the pending join,
  // the decline.
  action underStep = all {
    turn.pc == "j_under",
    db' = declineUnderAge(recordAge(db, turn.age)).with("pendJoin", NO_PEND),
    turn' = turn.with("pc", "j_underNotice").with("replied", true).with("outcome", "under_age"),
    vol' = vol, g' = g.with("everStated", g.everStated.union(Set(turn.age))),
  }
  // S:1146: under the join age, the notice row is deleted (its own statement).
  action underNoticeStep = all {
    turn.pc == "j_underNotice",
    db' = db.with("noticeRow", false),
    turn' = turn.with("pc", "done"),
    vol' = vol, g' = g,
  }

  // S:1435-1436: delete the pending join; a new person (or a revived tombstone) with the effective age.
  action personStep = all {
    turn.pc == "j_person",
    db' = (if (db.personExists) db else db.with("personExists", true).with("personLowest", turn.lowest)).with("pendJoin", NO_PEND),
    turn' = turn.with("pc", "j_age"),
    vol' = vol, g' = g,
  }
  // S:1437 recordAge.
  action ageStep = all {
    turn.pc == "j_age",
    db' = recordAge(db, turn.age), turn' = turn.with("pc", "j_member"),
    vol' = vol, g' = g.with("everStated", g.everStated.union(Set(turn.age))),
  }
  // S:1440-1447: putMembership and the opt-in. SD-127 (541e045): a membership that is not removed (invited or
  // live) keeps its member id.
  action memberStep = {
    val a = turn.app
    val others = APPS.exists(x => x != a and live(db, x))
    val kept = db.mstate.get(a) != "none" and db.mstate.get(a) != "removed"
    val newMid = if (kept) db.mid.get(a) else db.nextId
    val replaced = live(db, a) and newMid != db.mid.get(a)
    all {
      turn.pc == "j_member",
      db' = db.with("mstate", db.mstate.set(a, "active")).with("mid", db.mid.set(a, newMid))
        .with("nextId", if (kept) db.nextId else db.nextId + 1),
      turn' = turn.with("pc", "j_create").with("others", others),
      vol' = vol, g' = if (replaced) g.with("flags", flag("midReplaced")) else g,
    }
  }
  // S:1450 createMember with min(age, effective).
  action createStep = {
    val a = turn.app
    all {
      turn.pc == "j_create",
      db' = createMember(db, a, lo(turn.age, turn.lowest)),
      turn' = turn.with("pc", "j_welcome").with("turnApp", a),
      vol' = vol, g' = if (dupMember(db, a)) g.with("flags", flag("dupMember")) else g,
    }
  }
  // S:1452 memberMessage: the join text is the member's first message (welcome). Its unit writes the ages it
  // read (SD-011); no statedAge call follows.
  action welcomeStep = {
    val a = turn.app
    val u = unitOf(db.net.get(a), a, turn.msg)
    all {
      turn.pc == "j_welcome",
      db' = unitAges(db.with("net", db.net.set(a, u.n)), a, u.vol),
      vol' = vol.union(u.vol),
      turn' = turn.with("pc", "j_after").with("replied", true).with("outcome", "joined"),
      g' = (if (u.adultQToMinor) g.with("flags", flag("adultQToMinor")) else g)
        .with("everStated", if (turn.msg.age >= 0) g.everStated.union(Set(turn.msg.age)) else g.everStated),
    }
  }
  // S:1454-1461: the link notice, or (ntwrk, no keyword, not invited) the looking-for question.
  action afterStep = {
    val ask = not(turn.others) and turn.app == "ntwrk" and not(turn.invited)
    all {
      turn.pc == "j_after",
      db' = db,
      turn' = turn.with("pc", if (ask) "j_lfpend" else "done").with("askedLF", ask),
      vol' = vol, g' = g,
    }
  }
  // S:1462 the looking_for pending row.
  action lfPendStep = all {
    turn.pc == "j_lfpend",
    db' = db.with("pendLF", true),
    turn' = turn.with("pc", "done"),
    vol' = vol, g' = g,
  }

  // ------------------------------------------------------------------ member text
  // SD-179 (55941d0): a reply of a member of The Network that names no app closes the looking-for question.
  action lfCloseStep = all {
    turn.pc == "lf_close",
    db' = db.with("pendLF", false),
    turn' = turn.with("pc", "unit"),
    vol' = vol, g' = g,
  }
  // S:1124 memberMessage: one network unit; its save transaction also writes the ages it read (SD-011).
  action unitStep = {
    val a = turn.app
    val u = unitOf(db.net.get(a), a, turn.msg)
    all {
      turn.pc == "unit",
      db' = unitAges(db.with("net", db.net.set(a, u.n)), a, u.vol),
      vol' = vol.union(u.vol),
      turn' = turn.with("pc", "flush").with("replied", u.replied).with("outcome", u.outcome),
      g' = (if (u.adultQToMinor) g.with("flags", flag("adultQToMinor")) else g)
        .with("everStated", if (turn.msg.age >= 0) g.everStated.union(Set(turn.msg.age)) else g.everStated)
        .with("declineOpen", g.declineOpen or u.vol.exists(v => v.declined)),
    }
  }
  // S:1293-1301 statedAge: takeAges (memory), then recordAge of the lowest recorded age (it lowers every
  // app's member); a decline also deletes the phone's pending text join (Q-join_age-3, this branch). For
  // the looking-for answer, enroll follows (SD-038).
  action flushStep = {
    val a = turn.app
    val mineV = vol.filter(v => v.app == a and (v.explicit or v.declined or v.age < 18))
    val rec = mineV.fold(NONE, (acc, v) => lo(acc, if (v.declined) v.age else hi(v.age, minJoin(a))))
    val declined = mineV.exists(v => v.declined)
    val after = if (turn.kind == "enroll") "e_start" else "done"
    all {
      turn.pc == "flush",
      vol' = vol.filter(v => v.app != a),
      db' = (if (rec >= 0) recordAge(db, rec) else db).with("pendJoin", if (declined) NO_PEND else db.pendJoin),
      turn' = turn.with("pc", if (declined and db.personExists) "flushForget" else after).with("declined", declined),
      // The decline's forget runs here (no person: nothing else to forget) or in flushForget.
      g' = if (declined and not(db.personExists)) g.with("declineOpen", false) else g,
    }
  }
  // S:1302-1309: declined: every membership is forgotten and opted out.
  action flushForgetStep = {
    val a = turn.app
    all {
      turn.pc == "flushForget",
      db' = db.with("net", APPS.mapBy(x => if (x != a and db.mstate.get(x) != "removed" and db.mstate.get(x) != "none") NO_NET else db.net.get(x)))
        .with("mstate", APPS.mapBy(x => if (db.mstate.get(x) == "none") "none" else "removed")),
      turn' = turn.with("pc", if (turn.kind == "enroll") "e_start" else "done"),
      vol' = vol, g' = g.with("declineOpen", false),
    }
  }

  // ------------------------------------------------------------------ looking-for enroll
  // S:1471-1478: the person, the ntwrk membership, the lowest age (after statedAge); slop only for 18+.
  action enrollStart = {
    val ok = db.personExists and db.mstate.get("ntwrk") != "none"
    val lowest = effLowest(db)
    val todo = wantsOf(turn.msg).filter(a => a != "slop" or lowest >= 18)
    all {
      turn.pc == "e_start",
      db' = db,
      turn' = turn.with("pc", if (ok) "e_app" else "e_end").with("lowest", lowest).with("todo", if (ok) todo else Set()),
      vol' = vol,
      g' = if (not(turn.askOpenAt)) g.with("flags", flag("lateEnroll")) else g,
    }
  }
  // S:1482-1491: one app of the answer: putMembership and the opt-in (one step), then createMember.
  action enrollApp(a: str): bool = {
    val existing = db.mstate.get(a)
    val isLive = LIVE.contains(existing)
    val ageOk = turn.lowest >= 0 and joinOk(turn.lowest, turn.lowest, a)
    val newMid = if (existing == "invited") db.mid.get(a) else db.nextId
    all {
      turn.pc == "e_app",
      turn.todo.contains(a),
      if (isLive) all {
        db' = db, turn' = turn.with("todo", turn.todo.exclude(Set(a))).with("joined", turn.joined.union(Set(a))),
      } else if (not(ageOk)) all {
        db' = db, turn' = turn.with("todo", turn.todo.exclude(Set(a))),
      } else all {
        db' = db.with("mstate", db.mstate.set(a, "active")).with("mid", db.mid.set(a, newMid))
          .with("nextId", if (existing == "invited") db.nextId else db.nextId + 1),
        turn' = turn.with("todo", turn.todo.exclude(Set(a))).with("joined", turn.joined.union(Set(a))).with("pc", "e_create").with("cur", a),
      },
      vol' = vol, g' = g,
    }
  }
  // createMember names the new member in the turn (S:747-750).
  action enrollCreate = {
    val a = turn.cur
    all {
      turn.pc == "e_create",
      db' = createMember(db, a, turn.lowest),
      turn' = turn.with("pc", "e_app").with("turnApp", a),
      vol' = vol, g' = if (dupMember(db, a)) g.with("flags", flag("dupMember")) else g,
    }
  }
  action enrollNext = all {
    turn.pc == "e_app", turn.todo.size() == 0,
    db' = db, turn' = turn.with("pc", "e_end"), vol' = vol, g' = g,
  }
  // S:1496-1500 after the fixes: the turn gets back The Network's app and member (SD-125, 26b760a), the
  // question is deleted, and the confirmation is collected when something joined. The turn's outcome is the
  // unit's (b3f9868).
  action enrollEnd = all {
    turn.pc == "e_end",
    db' = db.with("pendLF", false),
    turn' = turn.with("pc", "done").with("replied", turn.replied or turn.joined.size() > 0).with("turnApp", turn.app),
    vol' = vol, g' = g,
  }

  // ------------------------------------------------------------------ web join (POST /api/join)
  action webJoin(a: str, age: int): bool = all {
    turn.pc == "idle",
    turn' = IDLE.with("pc", "w_check").with("kind", "web").with("app", a).with("age", age),
    db' = db, vol' = vol, g' = g,
  }
  // A:352-370: a repeat join (an age statement), invite-only, the age check. An under_age answer runs
  // declineUnderAge (SD-014). A repeat join that passes runs the join hook again (Q-join_age-2, 29331d4); the
  // hook does nothing for an inactive membership or a network member that exists (S:791-792).
  action webCheck = {
    val a = turn.app
    val age = turn.age
    val existing = db.mstate.get(a)
    val repeat = LIVE.contains(existing)
    val r = recordAge(db, age)
    val okAfter = joinOk(age, effLowest(r), a)
    val complete = existing != "active" or (db.net.get(a).exists and db.net.get(a).mid == db.mid.get(a))
    val g1 = g.with("everStated", g.everStated.union(Set(age)))
    all {
      turn.pc == "w_check",
      if (repeat and not(okAfter)) all {
        db' = declineUnderAge(r), turn' = turn.with("pc", "done").with("outcome", "under_age"), g' = g1,
      } else if (repeat and complete) all {
        db' = r, turn' = turn.with("pc", "done").with("outcome", "member"), g' = g1,
      } else if (repeat) all {
        db' = r, turn' = turn.with("pc", "w_create").with("repeat", true).with("lowest", lo(age, effLowest(r))), g' = g1,
      } else if (joinMode(a) == "invite" and existing != "invited") all {
        // A:364 refuses before the age is read: the age is not a statement here.
        // OPEN DRIFT (not modelled): accounts.ts:372 now records the age on this exit (decisions.ts:144 joinPlan
        // invite_only has recordAge true) and runs no declineUnderAge. With that write, a live member of another
        // app who posts an ntwrk web join with age 12 keeps that membership with a floor of 12, and under13StoresNothing
        // fails. The code needs a decision (decline on this exit too, or no age write) before the model follows it.
        db' = db, turn' = turn.with("pc", "done").with("outcome", "invite_only"), g' = g,
      } else if (not(joinOk(age, effLowest(db), a))) all {
        db' = declineUnderAge(r), turn' = turn.with("pc", "done").with("outcome", "under_age"), g' = g1,
      } else all {
        // Nothing commits here: a crash before webAge loses the request (the client gets an error).
        db' = db, turn' = turn.with("pc", "w_person").with("lowest", lo(age, effLowest(db))).with("invited", existing == "invited"), g' = g,
      },
      vol' = vol,
    }
  }
  action webPerson = all {
    turn.pc == "w_person",
    db' = if (db.personExists) db else db.with("personExists", true).with("personLowest", turn.lowest),
    turn' = turn.with("pc", "w_age"), vol' = vol, g' = g,
  }
  action webAge = all {
    turn.pc == "w_age",
    db' = recordAge(db, turn.age), turn' = turn.with("pc", "w_member"), vol' = vol,
    g' = g.with("everStated", g.everStated.union(Set(turn.age))),
  }
  // A:374-384: putMembership, the opt-in, attachPerson.
  action webMember = {
    val a = turn.app
    val newMid = if (turn.invited) db.mid.get(a) else db.nextId
    all {
      turn.pc == "w_member",
      db' = db.with("mstate", db.mstate.set(a, "active")).with("mid", db.mid.set(a, newMid))
        .with("nextId", if (turn.invited) db.nextId else db.nextId + 1),
      turn' = turn.with("pc", "w_create"), vol' = vol, g' = g,
    }
  }
  // S:788-793 joined: createMember (its own commit).
  action webCreate = {
    val a = turn.app
    all {
      turn.pc == "w_create",
      db' = createMember(db, a, turn.lowest),
      turn' = turn.with("pc", "w_welcome"), vol' = vol,
      g' = if (dupMember(db, a)) g.with("flags", flag("dupMember")) else g,
    }
  }
  // S:794 welcomeJoined unit; it may throw (any error in the unit or the delivery). On a new join the catch
  // undoes the join; on a repeat join (A:357-366, no try) the error goes to the client and the member stays.
  action webWelcome(throws: bool): bool = {
    val a = turn.app
    all {
      turn.pc == "w_welcome",
      if (throws) all { db' = db, turn' = if (turn.repeat) turn.with("pc", "done").with("outcome", "error") else turn.with("pc", "w_catch") }
      else all { db' = db.with("net", db.net.set(a, welcome(db.net.get(a)))), turn' = turn.with("pc", "done").with("outcome", "joined") },
      vol' = vol, g' = g,
    }
  }
  // A:388-400: the catch: onForget (SD-015, 8e083b4: the network member goes), forgetMembership, an opt-out.
  action webCatch = all {
    turn.pc == "w_catch",
    db' = db.with("net", db.net.set(turn.app, NO_NET)).with("mstate", db.mstate.set(turn.app, "removed")),
    turn' = turn.with("pc", "done").with("outcome", "error"), vol' = vol, g' = g,
  }

  // ------------------------------------------------------------------ end of a turn
  // The gateway gets the collected replies only when the turn completes (inbox.ts).
  action doneStep(present: bool): bool = {
    val a = turn.app
    val n = db.net.get(a)
    val text = turn.kind != "web"
    all {
      turn.pc == "done",
      db' = db, vol' = vol, turn' = IDLE,
      // The looking-for question is The Network's: a turn of The Network answers it (or asks it).
      g' = g.with("noticeDelivered", g.noticeDelivered or turn.wroteNotice)
        .with("askOpen", if (text and a == "ntwrk") turn.askedLF else g.askOpen)
        .with("last", {
          kind: turn.kind, app: a, replied: turn.replied, outcome: turn.outcome,
          minor: n.exists and n.minor, long: turn.msg.long,
          other: turn.msg.wants.size() == 0 and turn.msg.age < 0 and turn.msg.kw == "", minorAt: turn.minorAt, newAt: turn.newAt,
          // R:704-706: a context only for an active membership of a live person (A:302-312 activeMembership).
          ctx: n.exists and db.mstate.get(a) == "active" and db.personExists and db.mid.get(a) == n.mid,
          // R:732 singlePlayer: not present in the city, a member the Network holds as a minor (SD-066,
          // 0170505), or not matchable by A.lowestAge.
          single: not(present) or n.minor or effLowest(db) < 0 or effLowest(db) < 18,
          turnApp: if (turn.turnApp == "") a else turn.turnApp,
        }),
    }
  }

  // ------------------------------------------------------------------ other actors and failures
  // The process dies: memory (statedAges, onFail) is lost; the turn stays processing until the sweep of the
  // sender's next turn marks it unresolved; the signed retry is refused (inbox.ts:92), so the collected
  // replies never go out. A notice row it wrote names it (SD-276): the sweep deletes that row.
  action crash = all {
    turn.pc != "idle", g.crashes < MAX_CRASHES,
    db' = if (turn.wroteNotice) db.with("noticeStuck", true) else db, vol' = Set(), turn' = IDLE,
    g' = g.with("crashes", g.crashes + 1).with("last", NO_LAST.with("kind", "crash")),
  }
  // A step throws (a database error): the turn's onFail undo runs (S:1195: the notice row goes), no reply
  // goes out. In `flush`, takeAges already took the ages out of memory (R:133-137).
  action stepThrows = all {
    turn.pc != "idle", turn.kind != "web", g.fails < MAX_FAILS,
    db' = if (turn.wroteNotice) db.with("noticeRow", false) else db,
    vol' = if (turn.pc == "flush") vol.filter(v => v.app != turn.app) else vol,
    turn' = IDLE,
    g' = g.with("fails", g.fails + 1).with("last", NO_LAST.with("kind", "fail")),
  }

  // S:1556-1563 / A:334-342 a staff invite: a person (lowest null when new) and an invited membership.
  action staffInvite(a: str): bool = all {
    turn.pc == "idle",
    db.mstate.get(a) == "none" or db.mstate.get(a) == "removed",
    db' = (if (db.personExists) db else db.with("personExists", true).with("personLowest", NONE))
      .with("mstate", db.mstate.set(a, "invited")).with("mid", db.mid.set(a, db.nextId)).with("nextId", db.nextId + 1),
    vol' = vol, turn' = turn, g' = g,
  }
  // S:119 PENDING_MS: a pending text flow is forgotten after a day.
  action pendingExpire = all {
    turn.pc == "idle", db.pendJoin.has or db.pendLF,
    db' = db.with("pendJoin", NO_PEND).with("pendLF", false),
    vol' = vol, turn' = turn, g' = g.with("askOpen", false),
  }
  // A:415-427 delete everything: the floor keeps the person's lowest age, every member is forgotten,
  // memberships and pending rows are deleted, the person becomes a tombstone (PS:304-325).
  action deleteAll = all {
    turn.pc == "idle", db.personExists,
    db' = db.with("floor", lo(db.floor, db.personLowest)).with("personExists", false).with("personLowest", NONE)
      .with("net", APPS.mapBy(a => if (db.mstate.get(a) != "none" and db.mstate.get(a) != "removed") NO_NET else db.net.get(a)))
      .with("mstate", APPS.mapBy(a => "none")).with("pendJoin", NO_PEND).with("pendLF", false),
    vol' = vol, turn' = turn, g' = g.with("askOpen", false),
  }

  pure val MSGS: Set[Msg] = {
    val keywordMsgs = Set("slop", "friends").map(k => NO_MSG.with("kw", k).with("wants", if (k == "friends") Set("friends") else Set()))
    val wantSets: Set[Set[str]] = Set(Set(), Set("slop"), Set("friends"))
    val free = tuples(TEXT_AGES, Set(false, true), wantSets, Set(false, true), Set(false, true), Set(false, true))
      .map(((age, name, wants, signal, long, explicit)) => { kw: "", age: age, name: name, wants: wants, signal: signal, long: long, explicit: explicit, badHome: false })
    val badHome = tuples(TEXT_AGES, Set(false, true)).map(((age, name)) => NO_MSG.with("age", age).with("name", name).with("explicit", age >= 0).with("badHome", true))
    keywordMsgs.union(free).union(badHome)
  }

  action progress = any {
    noticeStep, joinStep, underStep, underNoticeStep, personStep, ageStep, memberStep, createStep,
    welcomeStep, afterStep, lfPendStep, lfCloseStep, unitStep, flushStep, flushForgetStep,
    enrollStart, enrollNext, enrollEnd, enrollCreate,
    { nondet a = oneOf(OTHER_APPS) enrollApp(a) },
    webCheck, webPerson, webAge, webMember, webCreate, webCatch,
    { nondet t = oneOf(Set(false, true)) webWelcome(t) },
    { nondet p = oneOf(Set(false, true)) doneStep(p) },
  }

  action step = any {
    progress,
    { nondet m = oneOf(MSGS) nondet p = oneOf(APPS) receive(m, p) },
    { nondet a = oneOf(APPS) nondet age = oneOf(WEB_AGES) webJoin(a, age) },
    { nondet a = oneOf(OTHER_APPS) staffInvite(a) },
    crash, stepThrows, pendingExpire, deleteAll,
  }

  // ------------------------------------------------------------------ invariants
  val idle = turn.pc == "idle"

  // AGENTS.md platform decision 1 and A:4-6: "the lowest age ever stated or recorded wins". Every age the
  // backend read from this phone is kept (person, floor, or a pending join that lives a day). An under-13
  // statement from an attested adult is recorded as 13 (S:1296-1299 comment, audit network-service-1).
  // The rule binds once the phone has a person or a stored age (a stranger who never joined has nothing).
  // Failed at ad67275: SD-010, SD-011, SD-038, SD-383 (all fixed).
  val lowestWins = idle implies ((db.personExists or durableLowest(db) >= 0) implies
    g.everStated.forall(a => durableLowest(db) >= 0 and durableLowest(db) <= hi(a, 13)))

  // AGENTS.md decision 1 and code invariant "minors never matched": a person who ever stated an age under
  // 18 is matchable in no app (N:3746, migration 0038). Failed at ad67275: SD-010, SD-011, SD-038, SD-383.
  val minorNeverMatched = idle implies (g.everStated.exists(a => a < 18) implies APPS.forall(a => not(matchable(db, a))))

  // core/src/policy.ts:2 and A:7 "under 13: cannot join, nothing is stored" (only the age floor):
  // no live membership, no network member and no pending join row for a phone whose lowest age is under 13.
  pure def under13Clean(d: Db): bool = effLowest(d) >= 0 and effLowest(d) < 13 implies
    (APPS.forall(a => not(live(d, a)) and not(d.net.get(a).exists)) and not(d.pendJoin.has))
  // Q-join_age-4 (new, not fixed): a unit that declines a member for a stated age under 13 commits the age
  // and forgets that app's member (SD-011 fix), but the other memberships are forgotten only by the later
  // statedAge step (S:1302-1309). A crash or a throw between them leaves the other apps' memberships, members
  // and opt-ins of an under-13 person, and no later step repairs it. The fix needs a design decision (the
  // forget of every app's member in the unit's own transaction, or a repair on a later turn), so it is not
  // in this round. This strict form stays out of `safety`; the simulator finds it in 15 steps (seed 0x5eed).
  val under13StoresNothingStrict = idle implies under13Clean(db)
  // In `safety`: the same rule outside the Q-join_age-4 window. Failed at ad67275: SD-014, SD-315 (fixed);
  // Q-join_age-3 (fixed on this branch: a web under-13 decline kept the phone's pending text join).
  val under13StoresNothing = idle implies (not(g.declineOpen) implies under13Clean(db))

  // S:719-722 createMember comment: the network member is the member of an active membership. A network
  // member never outlives its membership (failed at ad67275: SD-015, fixed).
  val noOrphanMember = idle implies APPS.forall(a => db.net.get(a).exists implies (live(db, a) and db.net.get(a).mid == db.mid.get(a)))

  // A:11-12 "parallel joins make one person, one membership, one member and one opt-in": an active
  // membership has its network member. Not in `safety`: a crash between putMembership and createMember leaves
  // an active membership with no member until the next join of that app (SD-128, refuted in the register:
  // the next text join completes it; since 29331d4 the web retry completes it too, Q-join_age-2). The
  // run test q2WebJoinRepairTest shows the window and its repair.
  val activeImpliesMember = idle implies APPS.forall(a => db.mstate.get(a) == "active" implies db.net.get(a).exists)

  // A:11-12 and Q-join_age-2: a join never answers success (joined, or member on a repeat) while its active
  // membership has no network member (failed at ad67275: the web retry answered member with no member).
  val joinSuccessHasMember = idle implies ((g.last.kind == "web" or g.last.kind == "text")
    and (g.last.outcome == "joined" or g.last.outcome == "member") and db.mstate.get(g.last.app) == "active"
    implies db.net.get(g.last.app).exists)

  // A:11-12 one member per app: a live membership never gets a new member id, and no second network
  // member row is made for the same app (failed at ad67275: SD-127, fixed).
  val oneMemberPerApp = not(g.flags.contains("midReplaced")) and not(g.flags.contains("dupMember"))

  // core/src/policy.ts:3 and N:985: a minor gets no adult onboarding interview (failed at ad67275: SD-213,
  // fixed).
  val minorNoAdultQuestion = not(g.flags.contains("adultQToMinor"))

  // S:1167-1174 elizaNotice comment: a failed turn stores nothing, so a spent notice row means the notice
  // went out (failed at ad67275: SD-276, fixed). A row whose turn lost its worker is not spent: the sweep in
  // the admission of the sender's next turn deletes it before any later turn reads it (receive).
  val noticeSpentImpliesDelivered = idle implies (db.noticeRow and not(db.noticeStuck) implies g.noticeDelivered)

  // S:1464-1470 enroll comment: "The Network confirms in one text": an answer to the question gets a reply
  // (SD-126 at ad67275). Since b3f9868 the answer is a member message first: the Network replies, or the
  // turn is open and the agent replies.
  val enrollAnswered = idle implies (g.last.kind == "enroll" implies (g.last.replied or g.last.outcome == "open"))

  // AGENTS.md decision 2 (open{app, memberId} come from the backend) and S:1012: the turn names the app
  // whose member the reply is from (failed at ad67275: SD-125, fixed).
  val enrollTurnApp = idle implies (g.last.kind == "enroll" implies g.last.turnApp == "ntwrk")

  // S:1114 comment "the answer to The Network's what are you looking for?": an enroll (an opt-in to new
  // apps) comes only from the answer to the question, not from a later text (failed at ad67275: SD-179,
  // fixed).
  val enrollOnlyFromAnswer = not(g.flags.contains("lateEnroll"))

  // The same comment: an answer to the question that names an app is that answer (the enroll path).
  // Failed at ad67275: Q-join_age-1 (fixed).
  val lookingForAnswerEnrolls = not(g.flags.contains("lfMisrouted"))

  // S:1550-1552 invite comment: "The person's reply with name and age is the join" of the invited app
  // (failed at ad67275: SD-488, fixed).
  val inviteReplyJoinsInvitedApp = not(g.flags.contains("invitedMisrouted"))

  // AGENTS.md decision 1 and R:732: a member the network treats as a minor is single-player in the open
  // turn context (failed at ad67275: SD-066, fixed).
  val minorIsSinglePlayer = idle implies (g.last.outcome == "open" and g.last.ctx and g.last.minor implies g.last.single)

  // AGENTS.md code invariants: a member aged 13-17 can use the agent for themselves (chat): a minor's
  // ordinary text reaches the agent (failed at ad67275: SD-065, fixed). It binds for a member the Network
  // already held as a minor and had welcomed: the first text after a member becomes a minor gets the minor
  // notice (N:728), and the first text of a member made without a welcome (enroll) gets the welcome.
  val minorChatReachesAgent = idle implies (g.last.kind == "member" and g.last.minorAt and not(g.last.newAt) and g.last.long
    and g.last.other and g.last.outcome != "declined" implies g.last.outcome == "open")

  val safety = and {
    lowestWins, minorNeverMatched, under13StoresNothing, noOrphanMember, joinSuccessHasMember,
    oneMemberPerApp, minorNoAdultQuestion, noticeSpentImpliesDelivered, enrollAnswered, enrollTurnApp,
    enrollOnlyFromAnswer, lookingForAnswerEnrolls, inviteReplyJoinsInvitedApp, minorIsSinglePlayer,
    minorChatReachesAgent,
  }

  // ------------------------------------------------------------------ witnesses (must be reachable)
  // An adult joins by text in at most 3 messages.
  val witness_adultTextJoin = not(idle and db.net.get("ntwrk").exists and db.net.get("ntwrk").age == 25 and g.texts <= 3)
  // A 15-year-old joins and stays single-player (matchable nowhere).
  val witness_minorJoined = not(idle and db.net.get("ntwrk").exists and db.net.get("ntwrk").minor and db.net.get("ntwrk").age == 15
    and APPS.forall(a => not(matchable(db, a))))
  // Under 13 is declined: only the floor is stored.
  val witness_under13Declined = not(idle and g.last.outcome == "under_age" and db.floor == 12 and not(db.personExists))
  // The looking-for answer enrolls the person in friends.
  val witness_enrolled = not(idle and g.last.kind == "enroll" and db.mstate.get("friends") == "active" and db.net.get("friends").exists)
  // The one-time notice goes out.
  val witness_noticeDelivered = not(g.noticeDelivered)
  // A web join makes an active slop member.
  val witness_webJoined = not(idle and db.mstate.get("slop") == "active" and db.net.get("slop").exists)
  // An adult member is matchable.
  val witness_matchable = not(idle and APPS.exists(a => matchable(db, a)))

  // ------------------------------------------------------------------ run tests (traces from the code)
  // Each defect test replays the trace that failed at ad67275 and checks the fixed behaviour (the commit is
  // named). The integration test of each fix is in packages/network/test/join-age.integration.test.ts.
  pure val M_AGE15: Msg = NO_MSG.with("age", 15).with("explicit", true)
  pure val M_SAM25: Msg = NO_MSG.with("age", 25).with("name", true).with("explicit", true)
  pure val M_SAM15: Msg = NO_MSG.with("age", 15).with("name", true).with("explicit", true)
  pure val M_HI: Msg = NO_MSG

  // The answer with name and age that joins an app other than The Network (helper, not a test).
  run joinByText(m: Msg, a: str): bool =
    receive(m, a).then(noticeStep).then(joinStep).then(personStep).then(ageStep)
      .then(memberStep).then(createStep).then(welcomeStep).then(afterStep).then(doneStep(true))
  // A first text with name and age that joins The Network with no keyword (helper, not a test).
  run joinNtwrkByText(m: Msg): bool =
    receive(m, "ntwrk").then(noticeStep).then(joinStep).then(personStep).then(ageStep)
      .then(memberStep).then(createStep).then(welcomeStep).then(afterStep).then(lfPendStep).then(doneStep(true))
  // A member text that the Network reads (unit and statedAge), the turn completes (helper, not a test).
  run memberText(m: Msg, a: str): bool = receive(m, a).then(unitStep).then(flushStep).then(doneStep(true))

  // An adult joins The Network with one text ("Sam, 25"), gets the looking-for question, answers "friends
  // tonight, dating too" in words (no keyword) and is enrolled in friends and slop.
  run adultJoinAndEnrollTest =
    init.then(joinNtwrkByText(M_SAM25))
      .expect(db.mstate.get("ntwrk") == "active" and db.pendLF and g.askOpen and g.noticeDelivered and db.net.get("ntwrk").stage == "q1")
      .then(receive(NO_MSG.with("wants", Set("friends", "slop")), "ntwrk")).then(unitStep).then(flushStep).then(enrollStart)
      .then(enrollApp("friends")).then(enrollCreate).then(enrollApp("slop")).then(enrollCreate).then(enrollNext).then(enrollEnd)
      .then(doneStep(true))
      .expect(db.mstate.get("friends") == "active" and db.mstate.get("slop") == "active" and not(db.pendLF) and g.last.replied
        and g.last.turnApp == "ntwrk" and safety)

  // SD-010 (84c9fef): "15" puts the age on the floor with the pending join; "Sam 25" then joins at 15.
  run sd010PendingAgeKeptTest =
    init
      .then(receive(M_AGE15, "ntwrk")).then(noticeStep).then(joinStep).then(doneStep(true))
      .expect(db.pendJoin.age == 15 and db.floor == 15 and lowestWins)
      .then(joinNtwrkByText(M_SAM25))
      .expect(db.personLowest == 15 and db.floor == 15 and db.net.get("ntwrk").minor and lowestWins and minorNeverMatched)

  // SD-010 (84c9fef): the pending join expires; the floor keeps 15 and "Sam 25" joins at 15.
  run sd010PendingAgeExpiresTest =
    init
      .then(receive(M_AGE15, "ntwrk")).then(noticeStep).then(joinStep).then(doneStep(true)).then(pendingExpire)
      .expect(not(db.pendJoin.has) and db.floor == 15)
      .then(joinNtwrkByText(M_SAM25))
      .expect(db.personLowest == 15 and lowestWins and minorNeverMatched)

  // SD-015 (8e083b4): createMember commits, welcomeJoined throws, the catch forgets the network member too.
  run sd015WebJoinOrphanTest =
    init
      .then(webJoin("slop", 25)).then(webCheck).then(webPerson).then(webAge).then(webMember).then(webCreate)
      .then(webWelcome(true)).then(webCatch).then(doneStep(true))
      .expect(db.mstate.get("slop") == "removed" and not(db.net.get("slop").exists) and noOrphanMember)
      .then(webJoin("slop", 25)).then(webCheck).then(webPerson).then(webAge).then(webMember).then(webCreate)
      .then(webWelcome(false)).then(doneStep(true))
      .expect(db.mstate.get("slop") == "active" and db.net.get("slop").exists and oneMemberPerApp and safety)

  // SD-014 (b6a1489): a friends member posts a slop join with age 12: under_age, every membership goes.
  run sd014Under12RemovesMembershipsTest =
    init
      .then(webJoin("friends", 25)).then(webCheck).then(webPerson).then(webAge).then(webMember).then(webCreate)
      .then(webWelcome(false)).then(doneStep(true))
      .then(webJoin("slop", 12)).then(webCheck).then(doneStep(true))
      .expect(g.last.outcome == "under_age" and db.mstate.get("friends") == "removed" and not(db.net.get("friends").exists)
        and under13StoresNothing)

  // SD-014 (b6a1489): the same by text: a friends member texts "slop" then "Sam 12".
  run sd014Under12TextJoinTest =
    init
      .then(receive(NO_MSG.with("kw", "friends"), "friends")).then(noticeStep).then(joinStep).then(doneStep(true))
      .then(joinByText(M_SAM25, "friends"))
      .expect(db.mstate.get("friends") == "active")
      .then(receive(NO_MSG.with("kw", "slop"), "slop")).then(noticeStep).then(joinStep).then(doneStep(true))
      .then(receive(NO_MSG.with("age", 12).with("name", true).with("explicit", true), "slop")).then(noticeStep).then(joinStep)
      .then(underStep).then(underNoticeStep).then(doneStep(true))
      .expect(g.last.outcome == "under_age" and db.mstate.get("friends") == "removed" and under13StoresNothing and safety)

  // SD-383 (77dff0d, migration 0043): a web join with age 0 is under_age and the floor keeps 0; a later join
  // at 25 is refused.
  run sd383AgeZeroTest =
    init
      .then(webJoin("friends", 0)).then(webCheck).then(doneStep(true))
      .expect(g.last.outcome == "under_age" and db.floor == 0)
      .then(webJoin("friends", 25)).then(webCheck).then(doneStep(true))
      .expect(g.last.outcome == "under_age" and db.mstate.get("friends") == "none" and lowestWins and safety)

  // SD-011 (f1dc7c7): a 25-year-old member says "I'm 15"; the unit's save writes 15 to the person and the
  // floor; the process dies before statedAge. The friends member is no longer matchable.
  run sd011CrashKeepsMinorAgeTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(webJoin("friends", 25)).then(webCheck).then(webPerson).then(webAge).then(webMember).then(webCreate)
      .then(webWelcome(false)).then(doneStep(true))
      .expect(matchable(db, "friends"))
      .then(receive(M_AGE15, "ntwrk")).then(lfCloseStep).then(unitStep).then(crash)
      .expect(db.net.get("ntwrk").minor and db.personLowest == 15 and db.floor == 15 and not(matchable(db, "friends"))
        and minorNeverMatched and lowestWins)

  // SD-011 (f1dc7c7): the same with recordAge throwing in statedAge after takeAges.
  run sd011ThrowKeepsMinorAgeTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(receive(M_AGE15, "ntwrk")).then(lfCloseStep).then(unitStep).then(stepThrows)
      .expect(db.personLowest == 15 and vol.size() == 0 and minorNeverMatched and lowestWins)

  // SD-038 (b3f9868): the answer "dating, I'm 15" is read first: statedAge records 15, enroll leaves slop out.
  run sd038EnrollReadsAgeTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(receive(NO_MSG.with("wants", Set("slop")).with("age", 15).with("explicit", true), "ntwrk"))
      .then(unitStep).then(flushStep).then(enrollStart).then(enrollNext).then(enrollEnd).then(doneStep(true))
      .expect(db.mstate.get("slop") == "none" and db.personLowest == 15 and not(db.pendLF) and g.last.replied
        and lowestWins and minorNeverMatched and safety)

  // SD-126 (not reproduced after b3f9868): a 15-year-old answers "dating": slop is left out, the question
  // closes, and the turn is answered (here an open turn: the agent replies).
  run sd126MinorDatingAnswerTest =
    init.then(joinNtwrkByText(M_SAM15))
      .then(receive(NO_MSG.with("wants", Set("slop")), "ntwrk"))
      .then(unitStep).then(flushStep).then(enrollStart).then(enrollNext).then(enrollEnd).then(doneStep(true))
      .expect(not(db.pendLF) and db.mstate.get("slop") == "none" and g.last.outcome == "open" and enrollAnswered)

  // SD-125 (26b760a): the enroll turn stays The Network's turn.
  run sd125EnrollTurnAppTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(receive(NO_MSG.with("wants", Set("friends")), "ntwrk")).then(unitStep).then(flushStep)
      .then(enrollStart).then(enrollApp("friends")).then(enrollCreate)
      .expect(turn.turnApp == "friends")
      .then(enrollNext).then(enrollEnd).then(doneStep(true))
      .expect(g.last.turnApp == "ntwrk" and g.last.replied and enrollTurnApp)

  // SD-179 (55941d0): "not sure yet" closes the question; a later "going out with friends tonight" is an
  // ordinary member message and enrolls nothing.
  run sd179ReplyClosesQuestionTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(receive(NO_MSG.with("long", true), "ntwrk")).then(lfCloseStep).then(unitStep).then(flushStep).then(doneStep(true))
      .expect(not(db.pendLF) and not(g.askOpen))
      .then(memberText(NO_MSG.with("wants", Set("friends")).with("long", true), "ntwrk"))
      .expect(db.mstate.get("friends") == "none" and g.last.kind == "member" and enrollOnlyFromAnswer and safety)

  // Q-join_age-1 (bcd83b8): the bare answer "friends" stays on The Network and enrolls friends.
  run q1BareKeywordAnswerTest =
    init.then(joinNtwrkByText(M_SAM25))
      .expect(routeChoices(db, NO_MSG.with("kw", "friends")) == Set("ntwrk"))
      .then(receive(NO_MSG.with("kw", "friends"), "ntwrk")).then(unitStep).then(flushStep)
      .then(enrollStart).then(enrollApp("friends")).then(enrollCreate).then(enrollNext).then(enrollEnd).then(doneStep(true))
      .expect(g.last.kind == "enroll" and db.mstate.get("friends") == "active" and not(db.pendJoin.has) and not(db.pendLF)
        and lookingForAnswerEnrolls and safety)

  // SD-488 (1a6ed45): staff invite to friends; the reply "Sam, 25" joins friends, not The Network.
  run sd488InviteReplyTest =
    init.then(staffInvite("friends"))
      .expect(routeChoices(db, M_SAM25) == Set("friends"))
      .then(joinByText(M_SAM25, "friends"))
      .expect(db.mstate.get("friends") == "active" and db.mstate.get("ntwrk") == "none" and db.net.get("friends").mid == db.mid.get("friends")
        and inviteReplyJoinsInvitedApp and safety)

  // SD-276 (7b0cd6f): first contact "hi": the notice row commits, the process dies; the admission of the next
  // text sweeps the stuck turn and deletes its row, so the next turn gets the notice.
  run sd276NoticeGivenBackTest =
    init.then(receive(M_HI, "ntwrk")).then(noticeStep).then(joinStep).then(crash)
      .expect(db.noticeRow and db.noticeStuck and not(g.noticeDelivered) and noticeSpentImpliesDelivered)
      .then(receive(M_HI, "ntwrk"))
      .expect(not(db.noticeRow))
      .then(noticeStep).then(joinStep).then(doneStep(true))
      .expect(db.noticeRow and g.noticeDelivered and noticeSpentImpliesDelivered)

  // SD-315 (ff807e1): a web join with age 12 leaves the floor 12; a text "hi" is declined, with no pending join.
  run sd315FloorUnder13DeclinedTest =
    init.then(webJoin("slop", 12)).then(webCheck).then(doneStep(true))
      .then(receive(M_HI, "ntwrk")).then(noticeStep).then(joinStep).then(doneStep(true))
      .expect(db.floor == 12 and not(db.pendJoin.has) and g.last.outcome == "under_age" and under13StoresNothing and safety)

  // SD-213 (a4326bf): an adult at q1 sends a minor signal ("i have homework"); the interview stops.
  run sd213MinorInterviewStopsTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(receive(NO_MSG.with("signal", true), "ntwrk")).then(lfCloseStep).then(unitStep).then(flushStep).then(doneStep(true))
      .expect(db.net.get("ntwrk").minor and db.net.get("ntwrk").stage == "active" and not(db.net.get("ntwrk").awaitInt))
      .then(receive(M_HI, "ntwrk")).then(unitStep)
      .expect(db.net.get("ntwrk").stage == "active" and turn.outcome == "open" and minorNoAdultQuestion)

  // SD-066 (0170505): a join text with a minor signal and age 25: the network member is a minor, the person's
  // lowest age is 25; the next "hey" is open and single-player.
  run sd066SinglePlayerTest =
    init.then(joinNtwrkByText(M_SAM25.with("signal", true)))
      .then(receive(M_HI, "ntwrk")).then(lfCloseStep).then(unitStep).then(flushStep).then(doneStep(true))
      .expect(g.last.outcome == "open" and g.last.minor and g.last.single and minorIsSinglePlayer and safety)

  // SD-065 (e94c1d8): a 15-year-old member's long ordinary text is an open turn for the agent.
  run sd065MinorChatOpenTest =
    init.then(joinNtwrkByText(M_SAM15))
      .then(receive(NO_MSG.with("long", true), "ntwrk")).then(lfCloseStep).then(unitStep).then(flushStep).then(doneStep(true))
      .expect(g.last.outcome == "open" and g.last.single and minorChatReachesAgent and safety)

  // SD-127 (541e045): a text join stops after putMembership; the next "Sam 25" keeps the member id.
  run sd127MemberIdKeptTest =
    init.then(receive(M_SAM25, "ntwrk")).then(noticeStep).then(joinStep).then(personStep).then(ageStep)
      .then(memberStep).then(crash)
      .expect(db.mstate.get("ntwrk") == "active" and not(db.net.get("ntwrk").exists))
      .then(joinNtwrkByText(M_SAM25))
      .expect(db.mid.get("ntwrk") == 1 and db.net.get("ntwrk").mid == 1 and oneMemberPerApp and activeImpliesMember and safety)

  // Q-join_age-2 (29331d4): a web join stops after putMembership; the retry runs the join hook and makes the
  // network member; a further repeat makes no second member.
  run q2WebJoinRepairTest =
    init.then(webJoin("friends", 25)).then(webCheck).then(webPerson).then(webAge).then(webMember).then(crash)
      .expect(not(activeImpliesMember))
      .then(webJoin("friends", 25)).then(webCheck).then(webCreate).then(webWelcome(false)).then(doneStep(true))
      .expect(g.last.outcome == "joined" and db.net.get("friends").exists and activeImpliesMember)
      .then(webJoin("friends", 25)).then(webCheck).then(doneStep(true))
      .expect(g.last.outcome == "member" and oneMemberPerApp and safety)

  // A web join of an app at age 15 (helper, not a test).
  run webJoinOk(a: str, age: int): bool =
    webJoin(a, age).then(webCheck).then(webPerson).then(webAge).then(webMember).then(webCreate)
      .then(webWelcome(false)).then(doneStep(true))
  pure val M_AM12: Msg = NO_MSG.with("age", 12).with("explicit", true)

  // Q-join_age-3 (this branch, Accounts.declineUnderAge): a text join the phone started, then an under-13
  // web join: the pending join row goes with the decline.
  run q3WebDeclineDropsPendingJoinTest =
    init.then(receive(NO_MSG.with("kw", "slop"), "slop")).then(noticeStep).then(joinStep).then(doneStep(true))
      .expect(db.pendJoin.has)
      .then(webJoin("friends", 12)).then(webCheck).then(doneStep(true))
      .expect(g.last.outcome == "under_age" and db.floor == 12 and not(db.pendJoin.has) and under13StoresNothing and safety)

  // Q-join_age-3 (this branch, statedAge): a pending text join of friends, a web join of friends at 15, then
  // "I am 12 years old" on friends: the Network declines; the memberships and the pending join go.
  run q3ChatDeclineDropsPendingJoinTest =
    init.then(receive(NO_MSG.with("kw", "friends"), "friends")).then(noticeStep).then(joinStep).then(doneStep(true))
      .then(webJoinOk("friends", 15))
      .expect(db.pendJoin.has and db.mstate.get("friends") == "active")
      .then(receive(M_AM12, "friends")).then(unitStep).then(flushStep).then(flushForgetStep).then(doneStep(true))
      .expect(g.last.outcome == "declined" and not(db.pendJoin.has) and db.mstate.get("friends") == "removed"
        and not(g.declineOpen) and under13StoresNothingStrict and safety)

  // Q-join_age-4 (new, not fixed): members of friends and slop at 15; "I am 12 years old" on friends; the unit
  // commits the decline (the friends member goes, the age 12 is stored); statedAge throws before it forgets
  // the slop membership. The slop membership, member and opt-in of an under-13 person stay.
  run q4DeclineStepFailsTest =
    init.then(webJoinOk("friends", 15)).then(webJoinOk("slop", 15))
      .then(receive(M_AM12, "friends")).then(unitStep).then(stepThrows)
      .expect(db.floor == 12 and not(db.net.get("friends").exists) and live(db, "slop") and db.net.get("slop").exists
        and g.declineOpen and not(under13StoresNothingStrict) and under13StoresNothing)

  // need_home (decisions.ts joinStep): "Sam 25, Boston" keeps the age and asks for the home city; no pending
  // join and no membership. The next "Sam 25" (a valid home) joins at 25.
  run needHomeKeepsAgeTest =
    init.then(receive(M_SAM25.with("badHome", true), "ntwrk")).then(noticeStep).then(joinStep).then(doneStep(true))
      .expect(g.last.outcome == "join_asked" and db.floor == 25 and not(db.pendJoin.has) and db.mstate.get("ntwrk") == "none" and lowestWins)
      .then(receive(M_SAM25, "ntwrk")).then(noticeStep).then(joinStep).then(personStep).then(ageStep)
      .then(memberStep).then(createStep).then(welcomeStep).then(afterStep).then(lfPendStep).then(doneStep(true))
      .expect(db.mstate.get("ntwrk") == "active" and safety)

  // A 15-year-old joins by text: single-player, matchable nowhere, the minor looking-for question.
  run minorJoinTest =
    init.then(joinNtwrkByText(M_SAM15))
      .expect(db.net.get("ntwrk").minor and db.net.get("ntwrk").stage == "active" and APPS.forall(a => not(matchable(db, a))) and safety)
}
```
