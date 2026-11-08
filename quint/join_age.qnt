// quint-check: max-steps=40 max-samples=4000 verify-steps=10
//
// join_age: the join paths and the age policy for one phone and one person (module plan:
// docs/research/2026-11-07-state-machines.md section 6.3). Machines: text-join (M-014), web-join (M-015),
// age-floor (M-016), member-age-policy (M-017), minor-single-player (M-018), looking-for-enroll (M-019),
// membership (M-020), staff-invite (M-021), eliza-notice (M-112), member-onboarding (M-113).
//
// The model follows the code as it is at ad67275:
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
    noticeRow: bool, nextId: int,
  }
  type Vol = { app: str, age: int, explicit: bool, declined: bool }
  // One text message as the oracles read it: kw is a whole-message app keyword (keywordApp), age and name
  // from parseJoinText or the network classifier, wants from lookingFor, signal a minor signal with no age
  // ("i have homework"), long a text over 12 characters, explicit a first-person explicit age.
  type Msg = { kw: str, age: int, name: bool, wants: Set[str], signal: bool, long: bool, explicit: bool }
  type Turn = {
    pc: str, kind: str, app: str, msg: Msg,
    wroteNotice: bool, replied: bool, turnApp: str, outcome: str,
    todo: Set[str], joined: Set[str], lowest: int, askOpenAt: bool, askedLF: bool,
    invited: bool, others: bool, age: int, name: bool, cur: str, declined: bool,
  }
  type Last = {
    kind: str, app: str, replied: bool, outcome: str, minor: bool, long: bool, other: bool,
    ctx: bool, single: bool, turnApp: str,
  }
  type Ghost = {
    everStated: Set[int], noticeDelivered: bool, askOpen: bool, flags: Set[str], last: Last,
    crashes: int, fails: int, texts: int,
  }

  pure val NO_NET: Net = { exists: false, mid: 0, age: NONE, statedAge: NONE, minor: false, stage: "new", awaitInt: false }
  pure val NO_PEND: Pend = { has: false, app: "", age: NONE, name: false }
  pure val NO_MSG: Msg = { kw: "", age: NONE, name: false, wants: Set(), signal: false, long: false, explicit: false }
  pure val IDLE: Turn = {
    pc: "idle", kind: "", app: "", msg: NO_MSG, wroteNotice: false, replied: false, turnApp: "", outcome: "",
    todo: Set(), joined: Set(), lowest: NONE, askOpenAt: false, askedLF: false,
    invited: false, others: false, age: NONE, name: false, cur: "", declined: false,
  }
  pure val NO_LAST: Last = { kind: "", app: "", replied: false, outcome: "", minor: false, long: false, other: false, ctx: false, single: false, turnApp: "" }

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

  // A.recordAge (A:286-300): the phone floor keeps the least (PS:97, check lowest_age > 0: an age of 0
  // raises), then in `finally` the person keeps the least (PS:111) and every app's member follows
  // (S:775-783 ageLowered, for each membership that is not removed).
  type RecOut = { d: Db, threw: bool }
  pure def recordAge(d: Db, age: int): RecOut = {
    val floorVal = lo(age, if (d.personExists) d.personLowest else NONE)
    val threw = floorVal == 0
    val d1 = if (threw) d else d.with("floor", lo(d.floor, floorVal))
    if (not(d1.personExists)) { d: d1, threw: threw }
    else {
      val after = lo(d1.personLowest, age)
      val net2 = APPS.mapBy(a => {
        val n = d1.net.get(a)
        if (n.exists and d1.mstate.get(a) != "removed" and d1.mstate.get(a) != "none") n.with("age", lo(n.age, after)) else n
      })
      { d: d1.with("personLowest", after).with("net", net2), threw: threw }
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
      val n1 = n.with("statedAge", st).with("minor", n.minor or becomes)
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
      } else if (n1.minor and m.long and m.wants.size() == 0) {
        // N:835: a minor's text of kind other over 12 characters goes to concierge (handled, no LLM).
        { n: n1, vol: v, outcome: "concierge", replied: true, adultQToMinor: false }
      } else {
        { n: n1, vol: v, outcome: "open", replied: false, adultQToMinor: false }
      }
    }
  }

  // S:957-981 route (one shared line; a whole-message keyword names the app).
  pure def mine(d: Db): Set[str] = APPS.filter(a => d.net.get(a).exists)
  pure def routeNeedsPick(d: Db, m: Msg): bool = {
    val pendApp = d.pendJoin.has and not(mine(d).contains(d.pendJoin.app)) and (mine(d).size() == 0 or m.age >= 0)
    m.kw == "" and not(pendApp) and mine(d).size() > 0
  }
  pure def routeOf(d: Db, m: Msg, pick: str): str = {
    val pendApp = d.pendJoin.has and not(mine(d).contains(d.pendJoin.app)) and (mine(d).size() == 0 or m.age >= 0)
    if (m.kw != "") m.kw
    else if (pendApp) d.pendJoin.app
    else if (mine(d).size() > 0) pick
    else "ntwrk"
  }
  pure def wantsOf(m: Msg): Set[str] = m.wants.exclude(Set("ntwrk"))

  // The ages a durable row holds for this phone: person, floor, and a pending join age (it lives a day).
  pure def durableLowest(d: Db): int = lo(effLowest(d), if (d.pendJoin.has) d.pendJoin.age else NONE)

  def flag(f: str): Set[str] = g.flags.union(Set(f))

  // ------------------------------------------------------------------ init
  action init = all {
    db' = {
      personExists: false, personLowest: NONE, floor: NONE, pendJoin: NO_PEND, pendLF: false,
      mstate: APPS.mapBy(a => "none"), mid: APPS.mapBy(a => 0), net: APPS.mapBy(a => NO_NET),
      noticeRow: false, nextId: 1,
    },
    vol' = Set(),
    turn' = IDLE,
    g' = { everStated: Set(), noticeDelivered: false, askOpen: false, flags: Set(), last: NO_LAST, crashes: 0, fails: 0, texts: 0 },
  }

  // ------------------------------------------------------------------ text turn: receive and route
  // S:1012-1027 and route: read-only. The path is chosen here; nothing is written.
  action receive(m: Msg, pick: str): bool = {
    val app = routeOf(db, m, pick)
    val member = db.net.get(app).exists
    val enroll = member and app == "ntwrk" and db.pendLF and wantsOf(m).size() > 0
    // The answer to "what are you looking for?" that names an app (S:1114-1117 comment).
    val misrouted = g.askOpen and db.pendLF and wantsOf(m).size() > 0 and not(enroll)
    all {
      turn.pc == "idle",
      not(routeNeedsPick(db, m)) or mine(db).contains(pick),
      turn' = IDLE.with("pc", if (enroll) "e_start" else if (member) "unit" else "notice")
        .with("kind", if (enroll) "enroll" else if (member) "member" else "text")
        .with("app", app).with("msg", m).with("askOpenAt", g.askOpen),
      db' = db, vol' = vol,
      g' = g.with("texts", g.texts + 1).with("flags", if (misrouted) flag("lfMisrouted") else g.flags),
    }
  }

  // ------------------------------------------------------------------ text join (non-member)
  // S:1175-1196 elizaNotice: the row and the collected reply in one transaction; onFail takes it back.
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

  // S:1384-1433 join: the decision. It ends the turn (ask, invite-only, name ask) or starts the commits.
  action joinStep = {
    val a = turn.app
    val m = turn.msg
    val invited = db.mstate.get(a) == "invited"
    val inviteOnly = joinMode(a) == "invite" and not(invited) and not(a == "ntwrk")
    val pend = if (db.pendJoin.has and db.pendJoin.app == a) db.pendJoin else NO_PEND
    val age = if (m.age >= 0) m.age else pend.age
    val name = m.name or pend.name
    val ok = joinOk(age, effLowest(db), a)
    // A reply with name and age to a staff invite of another app (S:1553-1563 invite text).
    val invitedElsewhere = OTHER_APPS.exists(y => y != a and db.mstate.get(y) == "invited") and m.kw == "" and m.age >= 0 and m.name
    val g1 = if (invitedElsewhere) g.with("flags", flag("invitedMisrouted")) else g
    all {
      turn.pc == "join",
      if (inviteOnly) all {
        db' = db, turn' = turn.with("pc", "done").with("replied", true).with("outcome", "invite_only"), g' = g1,
      } else if (age < 0) all {
        // S:1408-1414: pending join with the name; the join question (S:1412, at most 3 a day).
        db' = db.with("pendJoin", { has: true, app: a, age: NONE, name: name }),
        turn' = turn.with("pc", "done").with("replied", true).with("outcome", "join_asked"), g' = g1,
      } else if (not(ok)) all {
        db' = db, turn' = turn.with("pc", "j_under").with("age", age), g' = g1,
      } else if (not(name)) all {
        // S:1428-1432: pending join with the age, no recordAge.
        db' = db.with("pendJoin", { has: true, app: a, age: age, name: false }),
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

  // S:1417-1424: under the join age: recordAge, delete the pending join, the decline.
  action underStep = {
    val r = recordAge(db, turn.age)
    all {
      turn.pc == "j_under",
      db' = r.d.with("pendJoin", NO_PEND),
      turn' = turn.with("pc", "j_underNotice").with("replied", true).with("outcome", "under_age"),
      vol' = vol, g' = g.with("everStated", g.everStated.union(Set(turn.age))),
    }
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
  action ageStep = {
    val r = recordAge(db, turn.age)
    all {
      turn.pc == "j_age",
      db' = r.d, turn' = turn.with("pc", "j_member"),
      vol' = vol, g' = g.with("everStated", g.everStated.union(Set(turn.age))),
    }
  }
  // S:1440-1447: putMembership (member id kept only for an invited row) and the opt-in.
  action memberStep = {
    val a = turn.app
    val others = APPS.exists(x => x != a and live(db, x))
    val newMid = if (turn.invited) db.mid.get(a) else db.nextId
    val replaced = live(db, a) and newMid != db.mid.get(a)
    all {
      turn.pc == "j_member",
      db' = db.with("mstate", db.mstate.set(a, "active")).with("mid", db.mid.set(a, newMid))
        .with("nextId", if (turn.invited) db.nextId else db.nextId + 1),
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
  // S:1452 memberMessage: the join text is the member's first message (welcome). No statedAge call follows.
  action welcomeStep = {
    val a = turn.app
    val u = unitOf(db.net.get(a), a, turn.msg)
    all {
      turn.pc == "j_welcome",
      db' = db.with("net", db.net.set(a, u.n)),
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
  // S:1124 memberMessage: one network unit.
  action unitStep = {
    val a = turn.app
    val u = unitOf(db.net.get(a), a, turn.msg)
    all {
      turn.pc == "unit",
      db' = db.with("net", db.net.set(a, u.n)),
      vol' = vol.union(u.vol),
      turn' = turn.with("pc", "flush").with("replied", u.replied).with("outcome", u.outcome),
      g' = (if (u.adultQToMinor) g.with("flags", flag("adultQToMinor")) else g)
        .with("everStated", if (turn.msg.age >= 0) g.everStated.union(Set(turn.msg.age)) else g.everStated),
    }
  }
  // S:1293-1301 statedAge: takeAges (memory), then recordAge of the lowest recorded age.
  action flushStep = {
    val a = turn.app
    val mineV = vol.filter(v => v.app == a and (v.explicit or v.declined or v.age < 18))
    val rec = mineV.fold(NONE, (acc, v) => lo(acc, if (v.declined) v.age else hi(v.age, minJoin(a))))
    val declined = mineV.exists(v => v.declined)
    val r = recordAge(db, rec)
    all {
      turn.pc == "flush",
      vol' = vol.filter(v => v.app != a),
      db' = if (rec >= 0) r.d else db,
      turn' = turn.with("pc", if (declined and db.personExists) "flushForget" else "done").with("declined", declined),
      g' = g,
    }
  }
  // S:1302-1309: declined: every membership is forgotten and opted out.
  action flushForgetStep = {
    val a = turn.app
    all {
      turn.pc == "flushForget",
      db' = db.with("net", APPS.mapBy(x => if (x != a and db.mstate.get(x) != "removed" and db.mstate.get(x) != "none") NO_NET else db.net.get(x)))
        .with("mstate", APPS.mapBy(x => if (db.mstate.get(x) == "none") "none" else "removed")),
      turn' = turn.with("pc", "done"),
      vol' = vol, g' = g,
    }
  }

  // ------------------------------------------------------------------ looking-for enroll
  // S:1471-1478: the person, the ntwrk membership, the lowest age; slop only for 18+.
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
  // S:1496-1500: delete the question; store the inbound row (the text is never read by the network);
  // a reply only when something joined.
  action enrollEnd = all {
    turn.pc == "e_end",
    db' = db.with("pendLF", false),
    turn' = turn.with("pc", "done").with("replied", turn.joined.size() > 0).with("outcome", "handled"),
    vol' = vol,
    g' = g.with("everStated", if (turn.msg.age >= 0) g.everStated.union(Set(turn.msg.age)) else g.everStated),
  }

  // ------------------------------------------------------------------ web join (POST /api/join)
  action webJoin(a: str, age: int): bool = all {
    turn.pc == "idle",
    turn' = IDLE.with("pc", "w_check").with("kind", "web").with("app", a).with("age", age),
    db' = db, vol' = vol, g' = g,
  }
  // A:352-370: a repeat join (an age statement), invite-only, the age check.
  action webCheck = {
    val a = turn.app
    val age = turn.age
    val existing = db.mstate.get(a)
    val repeat = LIVE.contains(existing)
    val r = recordAge(db, age)
    val okAfter = joinOk(age, effLowest(r.d), a)
    val g1 = g.with("everStated", g.everStated.union(Set(age)))
    all {
      turn.pc == "w_check",
      if (repeat) all {
        db' = r.d, turn' = turn.with("pc", "done").with("outcome", if (r.threw) "error" else if (okAfter) "member" else "under_age"), g' = g1,
      } else if (joinMode(a) == "invite" and existing != "invited") all {
        // A:364 refuses before the age is read: the age is not a statement here.
        db' = db, turn' = turn.with("pc", "done").with("outcome", "invite_only"), g' = g,
      } else if (not(joinOk(age, effLowest(db), a))) all {
        db' = r.d, turn' = turn.with("pc", "done").with("outcome", if (r.threw) "error" else "under_age"), g' = g1,
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
    db' = recordAge(db, turn.age).d, turn' = turn.with("pc", "w_member"), vol' = vol,
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
  // S:794 welcomeJoined unit; it may throw (any error in the unit or the delivery).
  action webWelcome(throws: bool): bool = {
    val a = turn.app
    all {
      turn.pc == "w_welcome",
      if (throws) all { db' = db, turn' = turn.with("pc", "w_catch") }
      else all { db' = db.with("net", db.net.set(a, welcome(db.net.get(a)))), turn' = turn.with("pc", "done").with("outcome", "joined") },
      vol' = vol, g' = g,
    }
  }
  // A:388-391: the catch: forgetMembership and an opt-out; onForget is not called.
  action webCatch = all {
    turn.pc == "w_catch",
    db' = db.with("mstate", db.mstate.set(turn.app, "removed")),
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
      g' = g.with("noticeDelivered", g.noticeDelivered or turn.wroteNotice)
        .with("askOpen", if (text) turn.askedLF else g.askOpen)
        .with("last", {
          kind: turn.kind, app: a, replied: turn.replied, outcome: turn.outcome,
          minor: n.exists and n.minor, long: turn.msg.long,
          other: turn.msg.wants.size() == 0 and turn.msg.age < 0 and turn.msg.kw == "",
          // R:704-706: a context only for an active membership of a live person (A:302-312 activeMembership).
          ctx: n.exists and db.mstate.get(a) == "active" and db.personExists and db.mid.get(a) == n.mid,
          // R:732 singlePlayer: not present in the city, or not matchable by A.lowestAge.
          single: not(present) or effLowest(db) < 0 or effLowest(db) < 18,
          turnApp: if (turn.turnApp == "") a else turn.turnApp,
        }),
    }
  }

  // ------------------------------------------------------------------ other actors and failures
  // The process dies: memory (statedAges, onFail) is lost; the sweep marks the turn unresolved and the
  // signed retry is refused (inbox.ts:92), so the collected replies never go out.
  action crash = all {
    turn.pc != "idle", g.crashes < MAX_CRASHES,
    db' = db, vol' = Set(), turn' = IDLE,
    g' = g.with("crashes", g.crashes + 1).with("askOpen", false).with("last", NO_LAST.with("kind", "crash")),
  }
  // A step throws (a database error): the turn's onFail undo runs (S:1195: the notice row goes), no reply
  // goes out. In `flush`, takeAges already took the ages out of memory (R:133-137).
  action stepThrows = all {
    turn.pc != "idle", turn.kind != "web", g.fails < MAX_FAILS,
    db' = if (turn.wroteNotice) db.with("noticeRow", false) else db,
    vol' = if (turn.pc == "flush") vol.filter(v => v.app != turn.app) else vol,
    turn' = IDLE,
    g' = g.with("fails", g.fails + 1).with("askOpen", false).with("last", NO_LAST.with("kind", "fail")),
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
      .map(((age, name, wants, signal, long, explicit)) => { kw: "", age: age, name: name, wants: wants, signal: signal, long: long, explicit: explicit })
    keywordMsgs.union(free)
  }

  action progress = any {
    noticeStep, joinStep, underStep, underNoticeStep, personStep, ageStep, memberStep, createStep,
    welcomeStep, afterStep, lfPendStep, unitStep, flushStep, flushForgetStep,
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
  // Expected to fail: SD-010, SD-011, SD-038, SD-383.
  val lowestWins = idle implies ((db.personExists or durableLowest(db) >= 0) implies
    g.everStated.forall(a => durableLowest(db) >= 0 and durableLowest(db) <= hi(a, 13)))

  // AGENTS.md decision 1 and code invariant "minors never matched": a person who ever stated an age under
  // 18 is matchable in no app (N:3746, migration 0038).
  val minorNeverMatched = idle implies (g.everStated.exists(a => a < 18) implies APPS.forall(a => not(matchable(db, a))))

  // core/src/policy.ts:2 and A:7 "under 13: cannot join, nothing is stored" (only the age floor):
  // no live membership, no network member and no pending join row for a phone whose lowest age is under 13.
  // Expected to fail: SD-014, SD-315.
  val under13StoresNothing = idle implies (effLowest(db) >= 0 and effLowest(db) < 13 implies
    (APPS.forall(a => not(live(db, a)) and not(db.net.get(a).exists)) and not(db.pendJoin.has)))

  // S:719-722 createMember comment: the network member is the member of an active membership. A network
  // member never outlives its membership (expected to fail: SD-015).
  val noOrphanMember = idle implies APPS.forall(a => db.net.get(a).exists implies (live(db, a) and db.net.get(a).mid == db.mid.get(a)))

  // A:11-12 "parallel joins make one person, one membership, one member and one opt-in": an active
  // membership has its network member (expected to fail after a crash: SD-128).
  val activeImpliesMember = idle implies APPS.forall(a => db.mstate.get(a) == "active" implies db.net.get(a).exists)

  // A:11-12 one member per app: a live membership never gets a new member id, and no second network
  // member row is made for the same app (expected to fail: SD-127).
  val oneMemberPerApp = not(g.flags.contains("midReplaced")) and not(g.flags.contains("dupMember"))

  // core/src/policy.ts:3 and N:985: a minor gets no adult onboarding interview (expected to fail: SD-213).
  val minorNoAdultQuestion = not(g.flags.contains("adultQToMinor"))

  // S:1167-1174 elizaNotice comment: a failed turn stores nothing, so a spent notice row means the notice
  // went out (expected to fail: SD-276).
  val noticeSpentImpliesDelivered = idle implies (db.noticeRow implies g.noticeDelivered)

  // S:1464-1470 enroll comment: "The Network confirms in one text": an answer to the question gets a reply
  // (expected to fail: SD-126).
  val enrollAnswered = idle implies (g.last.kind == "enroll" implies g.last.replied)

  // AGENTS.md decision 2 (open{app, memberId} come from the backend) and S:1012: the turn names the app
  // whose member the reply is from (expected to fail: SD-125).
  val enrollTurnApp = idle implies (g.last.kind == "enroll" implies g.last.turnApp == "ntwrk")

  // S:1114 comment "the answer to The Network's what are you looking for?": an enroll (an opt-in to new
  // apps) comes only from the answer to the question, not from a later text (expected to fail: SD-179).
  val enrollOnlyFromAnswer = not(g.flags.contains("lateEnroll"))

  // The same comment: an answer to the question that names an app is that answer (the enroll path).
  val lookingForAnswerEnrolls = not(g.flags.contains("lfMisrouted"))

  // S:1550-1552 invite comment: "The person's reply with name and age is the join" of the invited app
  // (expected to fail: SD-488).
  val inviteReplyJoinsInvitedApp = not(g.flags.contains("invitedMisrouted"))

  // AGENTS.md decision 1 and R:732: a member the network treats as a minor is single-player in the open
  // turn context (expected to fail: SD-066).
  val minorIsSinglePlayer = idle implies (g.last.outcome == "open" and g.last.ctx and g.last.minor implies g.last.single)

  // AGENTS.md code invariants: a member aged 13-17 can use the agent for themselves (chat): a minor's
  // ordinary text reaches the agent (expected to fail: SD-065).
  val minorChatReachesAgent = idle implies (g.last.kind == "member" and g.last.minor and g.last.long and g.last.other
    and g.last.outcome != "declined" implies g.last.outcome == "open")

  val safety = and {
    lowestWins, minorNeverMatched, under13StoresNothing, noOrphanMember, activeImpliesMember,
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
  pure val M_AGE15: Msg = NO_MSG.with("age", 15).with("explicit", true)
  pure val M_SAM25: Msg = NO_MSG.with("age", 25).with("name", true).with("explicit", true)
  pure val M_SAM15: Msg = NO_MSG.with("age", 15).with("name", true).with("explicit", true)
  pure val M_HI: Msg = NO_MSG

  // An adult joins The Network with one text ("Sam, 25"), gets the looking-for question, answers "friends
  // tonight, dating too" in words (no keyword) and is enrolled in friends and slop.
  run adultJoinAndEnrollTest =
    init
      .then(receive(M_SAM25, "ntwrk")).then(noticeStep).then(joinStep).then(personStep).then(ageStep)
      .then(memberStep).then(createStep).then(welcomeStep).then(afterStep).then(lfPendStep).then(doneStep(true))
      .expect(db.mstate.get("ntwrk") == "active" and db.pendLF and g.askOpen and g.noticeDelivered and db.net.get("ntwrk").stage == "q1")
      .then(receive(NO_MSG.with("wants", Set("friends", "slop")), "ntwrk")).then(enrollStart)
      .then(enrollApp("friends")).then(enrollCreate).then(enrollApp("slop")).then(enrollCreate).then(enrollNext).then(enrollEnd)
      .then(doneStep(true))
      .expect(db.mstate.get("friends") == "active" and db.mstate.get("slop") == "active" and not(db.pendLF) and g.last.replied)

  // SD-010 (S:1428-1432, S:1437): "15" stores the age only in the pending join; "Sam 25" joins at 25.
  run sd010PendingAgeReplacedTest =
    init
      .then(receive(M_AGE15, "ntwrk")).then(noticeStep).then(joinStep).then(doneStep(true))
      .expect(db.pendJoin.age == 15 and lowestWins)
      .then(receive(M_SAM25, "ntwrk")).then(noticeStep).then(joinStep).then(personStep).then(ageStep)
      .then(memberStep).then(createStep).then(welcomeStep).then(afterStep).then(lfPendStep).then(doneStep(true))
      .expect(db.personLowest == 25 and db.floor == 25 and not(lowestWins))

  // SD-015 (S:788-794, A:386-392): createMember commits, welcomeJoined throws, the catch removes the
  // membership; the network member stays.
  run sd015WebJoinOrphanTest =
    init
      .then(webJoin("slop", 25)).then(webCheck).then(webPerson).then(webAge).then(webMember).then(webCreate)
      .then(webWelcome(true)).then(webCatch).then(doneStep(true))
      .expect(db.mstate.get("slop") == "removed" and db.net.get("slop").exists and not(noOrphanMember))

  // SD-014 (A:357-362): a friends member posts a slop join with age 12: under_age, memberships stay.
  run sd014Under12KeepsMembershipsTest =
    init
      .then(webJoin("friends", 25)).then(webCheck).then(webPerson).then(webAge).then(webMember).then(webCreate)
      .then(webWelcome(false)).then(doneStep(true))
      .then(webJoin("slop", 12)).then(webCheck).then(doneStep(true))
      .expect(g.last.outcome == "under_age" and db.mstate.get("friends") == "active" and not(under13StoresNothing))

  // SD-383 (policy.ts:15, PS:97 check): a web join with age 0 from a new number stores nothing.
  run sd383AgeZeroTest =
    init
      .then(webJoin("friends", 0)).then(webCheck).then(doneStep(true))
      .expect(g.last.outcome == "error" and db.floor == NONE)
      .then(webJoin("friends", 25)).then(webCheck).then(webPerson).then(webAge).then(webMember).then(webCreate)
      .then(webWelcome(false)).then(doneStep(true))
      .expect(db.mstate.get("friends") == "active" and db.personLowest == 25 and not(lowestWins))

  // SD-011 (R:131-137, S:1122-1123): a 25-year-old member says "I'm 15"; the unit commits; the process dies
  // before statedAge records it. The friends member stays matchable.
  run sd011CrashLosesMinorAgeTest =
    init
      .then(receive(M_SAM25, "ntwrk")).then(noticeStep).then(joinStep).then(personStep).then(ageStep)
      .then(memberStep).then(createStep).then(welcomeStep).then(afterStep).then(lfPendStep).then(doneStep(true))
      .then(webJoin("friends", 25)).then(webCheck).then(webPerson).then(webAge).then(webMember).then(webCreate)
      .then(webWelcome(false)).then(doneStep(true))
      .expect(matchable(db, "friends"))
      .then(receive(M_HI.with("age", 15).with("explicit", true), "ntwrk")).then(unitStep).then(crash)
      .expect(db.net.get("ntwrk").minor and matchable(db, "friends") and not(minorNeverMatched) and not(lowestWins))

  // A first text with name and age that joins The Network with no keyword (helper, not a test).
  run joinNtwrkByText(m: Msg): bool =
    receive(m, "ntwrk").then(noticeStep).then(joinStep).then(personStep).then(ageStep)
      .then(memberStep).then(createStep).then(welcomeStep).then(afterStep).then(lfPendStep).then(doneStep(true))

  // SD-038 (S:1115-1117): the answer "dating, I'm 15" goes to enroll; no unit reads the age; slop is joined
  // at the stored adult age and the slop member is matchable.
  run sd038EnrollSkipsAgeTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(receive(NO_MSG.with("wants", Set("slop")).with("age", 15).with("explicit", true), "ntwrk"))
      .then(enrollStart).then(enrollApp("slop")).then(enrollCreate).then(enrollNext).then(enrollEnd).then(doneStep(true))
      .expect(matchable(db, "slop") and not(lowestWins) and not(minorNeverMatched))

  // SD-126 (S:1479-1481, 1496-1500): a 15-year-old answers "dating": nothing joins, no reply, question gone.
  run sd126SilentEnrollTest =
    init.then(joinNtwrkByText(M_SAM15))
      .then(receive(NO_MSG.with("wants", Set("slop")), "ntwrk"))
      .then(enrollStart).then(enrollNext).then(enrollEnd).then(doneStep(true))
      .expect(not(db.pendLF) and not(g.last.replied) and not(enrollAnswered))

  // SD-125 (S:747-750): the enroll turn reports friends as its app; the confirmation is the ntwrk member's.
  run sd125EnrollTurnAppTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(receive(NO_MSG.with("wants", Set("friends")), "ntwrk"))
      .then(enrollStart).then(enrollApp("friends")).then(enrollCreate).then(enrollNext).then(enrollEnd).then(doneStep(true))
      .expect(g.last.turnApp == "friends" and not(enrollTurnApp))

  // SD-179 (S:1115-1118): "not sure yet" leaves the question open; a later "going out with friends
  // tonight" enrolls the person in friends.
  run sd179LateEnrollTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(receive(NO_MSG.with("long", true), "ntwrk")).then(unitStep).then(flushStep).then(doneStep(true))
      .expect(db.pendLF and not(g.askOpen))
      .then(receive(NO_MSG.with("wants", Set("friends")).with("long", true), "ntwrk"))
      .then(enrollStart).then(enrollApp("friends")).then(enrollCreate).then(enrollNext).then(enrollEnd).then(doneStep(true))
      .expect(db.mstate.get("friends") == "active" and not(enrollOnlyFromAnswer))

  // Q-join_age-1 (S:968-969 before S:1114-1117): the bare answer "friends" is the friends keyword: it starts
  // a new friends join that asks for name and age again; the question stays open.
  run q1BareKeywordAnswerTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(receive(NO_MSG.with("kw", "friends").with("wants", Set("friends")), "ntwrk"))
      .then(noticeStep).then(joinStep).then(doneStep(true))
      .expect(g.last.outcome == "join_asked" and db.pendLF and db.mstate.get("friends") == "none" and not(lookingForAnswerEnrolls))

  // SD-488 (S:957-981, S:1553-1563): staff invite to friends; the reply "Sam, 25" joins ntwrk.
  run sd488InviteReplyTest =
    init.then(staffInvite("friends")).then(joinNtwrkByText(M_SAM25))
      .expect(db.mstate.get("ntwrk") == "active" and db.mstate.get("friends") == "invited" and not(inviteReplyJoinsInvitedApp))

  // SD-276 (S:1187-1196, inbox.ts:92): first contact "hi": the notice row commits, the process dies before
  // the turn completes; the notice never goes out and the row stays.
  run sd276NoticeSpentTest =
    init.then(receive(M_HI, "ntwrk")).then(noticeStep).then(joinStep).then(crash)
      .expect(db.noticeRow and not(g.noticeDelivered) and not(noticeSpentImpliesDelivered))

  // SD-315 (S:1406-1414): a web join with age 12 leaves the floor 12; a text "hi" stores a pending join and
  // gets the join question.
  run sd315FloorUnder13AskedTest =
    init.then(webJoin("slop", 12)).then(webCheck).then(doneStep(true))
      .then(receive(M_HI, "ntwrk")).then(noticeStep).then(joinStep).then(doneStep(true))
      .expect(db.floor == 12 and db.pendJoin.has and g.last.outcome == "join_asked" and not(under13StoresNothing))

  // SD-213 (N:728, N:1094): an adult at q1 sends a minor signal ("i have homework"); the next text gets the
  // adult q2 question.
  run sd213MinorGetsInterviewTest =
    init.then(joinNtwrkByText(M_SAM25))
      .then(receive(NO_MSG.with("signal", true), "ntwrk")).then(unitStep).then(flushStep).then(doneStep(true))
      .expect(db.net.get("ntwrk").minor and db.net.get("ntwrk").stage == "q1")
      .then(receive(M_HI, "ntwrk")).then(unitStep)
      .expect(db.net.get("ntwrk").stage == "q2" and not(minorNoAdultQuestion))

  // SD-066 (R:732, N:717-718): a join text with a minor signal and age 25: the network member is a minor,
  // the person's lowest age is 25; the next "hey" is open with singlePlayer false.
  run sd066SinglePlayerTest =
    init.then(joinNtwrkByText(M_SAM25.with("signal", true)))
      .then(receive(M_HI, "ntwrk")).then(unitStep).then(flushStep).then(doneStep(true))
      .expect(g.last.outcome == "open" and g.last.minor and not(g.last.single) and not(minorIsSinglePlayer))

  // SD-065 (N:835): a 15-year-old member's long ordinary text goes to concierge, never to the agent.
  run sd065MinorConciergeTest =
    init.then(joinNtwrkByText(M_SAM15))
      .then(receive(NO_MSG.with("long", true), "ntwrk")).then(unitStep).then(flushStep).then(doneStep(true))
      .expect(g.last.outcome == "concierge" and not(minorChatReachesAgent))

  // SD-127 (S:1440-1446, PS:124-129): a text join stops after putMembership; the next "Sam 25" joins again
  // and replaces the live membership's member id.
  run sd127MemberIdReplacedTest =
    init.then(receive(M_SAM25, "ntwrk")).then(noticeStep).then(joinStep).then(personStep).then(ageStep)
      .then(memberStep).then(crash)
      .expect(db.mstate.get("ntwrk") == "active" and not(db.net.get("ntwrk").exists) and not(activeImpliesMember))
      .then(joinNtwrkByText(M_SAM25))
      .expect(not(oneMemberPerApp))

  // Q-join_age-2 (A:357-362, A:383-392): a web join stops after putMembership; the retry takes the repeat
  // branch, answers ok and never creates the network member.
  run q2WebJoinNoRepairTest =
    init.then(webJoin("friends", 25)).then(webCheck).then(webPerson).then(webAge).then(webMember).then(crash)
      .then(webJoin("friends", 25)).then(webCheck).then(doneStep(true))
      .expect(g.last.outcome == "member" and db.mstate.get("friends") == "active" and not(db.net.get("friends").exists)
        and not(activeImpliesMember))

  // A 15-year-old joins by text: single-player, matchable nowhere, the minor looking-for question.
  run minorJoinTest =
    init
      .then(receive(M_SAM15, "ntwrk")).then(noticeStep).then(joinStep).then(personStep).then(ageStep)
      .then(memberStep).then(createStep).then(welcomeStep).then(afterStep).then(lfPendStep).then(doneStep(true))
      .expect(db.net.get("ntwrk").minor and db.net.get("ntwrk").stage == "active" and APPS.forall(a => not(matchable(db, a))) and safety)
}
