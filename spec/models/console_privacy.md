# Staff console data visibility

## Story: Staff console data visibility

A staff user needs to see only the member data their assigned role permits.

### Safety rules and reachability

Check field filtering, private sources, restricted holds, and reasons for access. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/console_privacy.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

Production chooses its view class with [Observatory staff permissions](../staffPermissions.md). This standalone model covers the field-level effects.

`countsMember` in `packages/observatory/src/shape.ts` drops `declined`, `weekly`, `calendar` and `community` with the age fields, and `memberFieldLevel` puts them in the full class, so a counts-class caller reads no age fact (`countsGetNoAgeFacts` in `safety`, `declinedLeaksTest`). `packages/observatory/test/staff.test.ts` ("an analyst's members carry no age band") is the boundary case.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=15 max-samples=3000
//
// console_privacy: what the Observatory gives each staff caller about members and persons.
//
// WHAT THIS MODELS
//   - The view class of one caller for one app (viewClass in packages/observatory/src/shape.ts, which
//     calls the generated fullStaffView of spec/staffPermissions.md). The roles change at any time. The
//     server shapes each delta for the class that the socket has when it sends (server.ts sets w.cls
//     again on each check). The roles are the ones rolesFor gives after scopedGrants: an engineer grant
//     is already dropped in real mode, so the model takes the four role flags as given.
//   - The member and opportunity fields that one delta carries for that class (countsMember, countsOpp),
//     the hidden truth (shapeState) and the oracle verdict (stripOracle).
//   - The cross-app person view (packages/observatory/src/people.ts PeopleView.summary, web/apps.tsx): the
//     membership rows of one person change, the summary is built from them, and a staff member opens
//     one app's panel with a typed reason.
//   Compared with the code on vibestack-matching (2026-11-17). The old LemmaScript core privacy-core.ts
//   is gone. Its decisions are now inline: classOf is shape.ts viewClass (generated fullStaffView);
//   memberFieldUse/oppFieldUse are shape.ts countsMember/countsOpp; truthShown is shapeState with
//   server.ts truthFor; oracleShown is shape.ts stripOracle; membershipShown, holdLines and blockOrigin
//   are people.ts summary (its restricted() helper and origin()); reasonOk is the AppPanel button gate
//   (reason.trim().length < 5) and server.ts PERSON_REASON_MIN; crossAppShown is the generated
//   canOpenPerson of spec/consoleNavigation.md. Each pure def here keeps the decision of that code.
//   Compared again on 2026-11-18: no change in shape.ts, people.ts or apps.tsx. The member keys now include
//   declined, weekly and community (ObsMember in types.ts, written by sources/real.ts), which countsMember keeps.
//
// BOUNDS
//   One caller, one member, one opportunity, one person. Four apps (slop is private). Reasons of
//   length 0..7. Each run is at most max-steps events.
//
// RUN (from the repository root; quint 0.33.1)
//   corepack pnpm@10.24.0 run quint:check console_privacy
//   Each witness_<name> must be VIOLATED (the state is reachable).
//
// OUTSIDE THE MODEL
//   - The name pattern in feed lines (a regex: shape.ts namePattern). The feed is not modelled.
//   - SQL, the read-only login, the audit row and the role check of /api/person (server.ts). The model
//     takes the caller as one that may open the cross-app view.
//   - The server's own reason check (server.ts PERSON_REASON_MIN on /api/person/:id/app). The model has the
//     browser gate only; both use the same minimum of 5 trimmed characters.
//   - Key order of the shaped objects. A scratch comparison showed the same JSON as before the change.
module console_privacy {

  // ---------------------------------------------------------------- types
  type ViewClass = Full | Counts
  type FieldUse = Keep | Drop | Mask
  type RoleFlags = { admin: bool, reviewer: bool, safety: bool, engineer: bool }
  type Row = { app: str, hidden: bool, hold: bool, restricted: bool, recycled: bool }
  type HoldLine = { row: int, app: str, level: str }
  // One field as it went out: its key, and whether it carries the real value (not a mask).
  type Sent = { key: str, real: bool }

  // ---------------------------------------------------------------- decisions (shape.ts, people.ts, apps.tsx)
  pure def classRank(c: ViewClass): int = match c { | Full => 1 | Counts => 0 }

  pure def classOf(r: RoleFlags): ViewClass =
    if (r.admin or r.reviewer or r.safety or r.engineer) Full else Counts

  pure def memberFieldLevel(key: str): ViewClass =
    if (Set("name", "age", "minor", "ageUnknown", "trust", "occupation", "controlled", "declined", "weekly", "calendar", "community").contains(key)) Full else Counts

  pure def oppFieldLevel(key: str): ViewClass =
    if (Set("feedback", "explanations", "objective").contains(key)) Full else Counts

  pure def fieldUse(cls: ViewClass, level: ViewClass, maskable: bool): FieldUse =
    if (classRank(level) <= classRank(cls)) Keep else if (maskable) Mask else Drop

  pure def memberFieldUse(cls: ViewClass, key: str): FieldUse =
    fieldUse(cls, memberFieldLevel(key), key == "name")

  pure def oppFieldUse(cls: ViewClass, key: str): FieldUse =
    fieldUse(cls, oppFieldLevel(key), key == "explanations" or key == "objective")

  pure def truthShown(cls: ViewClass, lens: bool): bool = cls == Full and lens

  pure def oppResolved(state: str): bool = Set("COMPLETED", "FEEDBACK_COLLECTED", "ABANDONED").contains(state)

  pure def oracleShown(lens: bool, state: str, unsafe: bool): bool = lens or oppResolved(state) or unsafe

  pure val ANY_APP = "*"
  pure val PERSON_REASON_MIN = 5

  pure def membershipShown(r: Row): bool = not(r.hidden)

  pure def hiddenHeld(r: Row): bool = r.hidden and (r.hold or r.restricted)

  pure def holdLines(rows: List[Row]): List[HoldLine] = {
    val res = rows.indices().fold({ out: List(), star: false }, (acc, i) => {
      val r = rows[i]
      if (r.hidden)
        if ((r.hold or r.restricted) and not(acc.star))
          { out: acc.out.append({ row: -1, app: ANY_APP, level: "restricted" }), star: true }
        else acc
      else {
        val a = if (r.hold) acc.out.append({ row: i, app: r.app, level: "hold" }) else acc.out
        val b = if (r.restricted) a.append({ row: i, app: r.app, level: "restricted" }) else a
        val c = if (r.recycled) b.append({ row: i, app: r.app, level: "recycled_number" }) else b
        { out: c, star: acc.star }
      }
    })
    res.out
  }

  pure def blockOrigin(app: str, hidden: bool): str = if (hidden) ANY_APP else app

  pure def reasonOk(len: int): bool = len >= PERSON_REASON_MIN

  // A hold line is well formed: a named app comes from a row that is not private.
  pure def lineOk(rows: List[Row], h: HoldLine): bool =
    (h.row == -1 and h.app == ANY_APP and h.level == "restricted")
      or (0 <= h.row and h.row < rows.length() and not(rows[h.row].hidden) and h.app == rows[h.row].app)

  // The app of a hold or a block line names an app; ANY_APP names none (apps.tsx PersonView).
  pure def namesApp(app: str): bool = app != ANY_APP

  // The cross-app button shows only to a cross-app caller in real mode (apps.tsx CrossAppButton, generated canOpenPerson).
  pure def crossAppShown(crossApp: bool, real: bool): bool = crossApp and real

  // ---------------------------------------------------------------- shell (shape.ts, people.ts, apps.tsx)
  pure val APPS = List("ntwrk", "slop", "peon", "friends")
  // PRIVATE_APPS in apps.ts is {"slop"} today. The model also lets friends be private, so that a
  // person can hold two private memberships (the one-line rule of holdLines then has force).
  pure val PRIVATE_CHOICES = Set(Set("slop"), Set("slop", "friends"))
  pure val MEMBER_KEYS = Set("id", "name", "age", "minor", "ageUnknown", "trust", "occupation", "controlled", "area", "counters",
                             "declined", "weekly", "calendar", "community")
  // Fields that tell the member's age band. declined: declined at join (under 13); community "declined" says
  // the same; weekly: never set for members aged 13-17 (types.ts ObsMember); calendar: said only in a first booked
  // plan, which a member aged 13-17 never gets. countsMember drops all of them (PRIV-COUNTS, fixed 2026-11-22).
  pure val AGE_FACT_KEYS = Set("age", "minor", "ageUnknown", "trust", "declined", "weekly", "calendar", "community")
  pure val OPP_KEYS = Set("id", "state", "participants", "feedback", "explanations", "objective")
  pure val OPP_STATES = Set("PROPOSED", "ACCEPTED", "COMPLETED", "FEEDBACK_COLLECTED", "ABANDONED")

  // countsMember / countsOpp: a kept field carries its value, a masked one a value that tells nothing.
  pure def shapeKeys(ks: Set[str], use: str => FieldUse): Set[Sent] =
    ks.filter(k => use(k) != Drop).map(k => { key: k, real: use(k) == Keep })

  pure def isPrivateApp(priv: Set[str], app: str): bool = priv.contains(app)

  // ---------------------------------------------------------------- state
  // The private apps of this run (fixed at init).
  var privateApps: Set[str]
  var roles: RoleFlags
  var lens: bool
  // The last member and opportunity delta that went out, with the class of the socket when it went.
  var memberSent: { cls: ViewClass, fields: Set[Sent] }
  var oppSent: { cls: ViewClass, fields: Set[Sent] }
  // The last state read: the hidden truth went out, and with which class and lens.
  var truthSent: { sent: bool, cls: ViewClass, lens: bool }
  // The last opportunity sent with its oracle verdict, or the verdict stripped.
  var oracleSent: { sent: bool, oracle: bool, lens: bool, state: str, unsafe: bool }
  // The person's membership rows, in app order.
  var rows: List[Row]
  // The summary that the cross-app view shows now.
  var shownApps: List[str]
  var holds: List[HoldLine]
  var origins: List[{ app: str, shown: str }]
  // The app panels that the shell opened, with the reason length typed for each.
  var opened: List[{ app: str, reason: int }]

  def cls: ViewClass = classOf(roles)

  action unchangedPerson = all { privateApps' = privateApps, rows' = rows, shownApps' = shownApps, holds' = holds, origins' = origins, opened' = opened }
  action unchangedSends = all { memberSent' = memberSent, oppSent' = oppSent, truthSent' = truthSent, oracleSent' = oracleSent }

  action init = {
    nondet priv = PRIVATE_CHOICES.oneOf()
    all {
      privateApps' = priv,
      roles' = { admin: false, reviewer: false, safety: false, engineer: false },
      lens' = false,
      memberSent' = { cls: Counts, fields: Set() },
      oppSent' = { cls: Counts, fields: Set() },
      truthSent' = { sent: false, cls: Counts, lens: false },
      oracleSent' = { sent: false, oracle: false, lens: false, state: "PROPOSED", unsafe: false },
      rows' = List(), shownApps' = List(), holds' = List(), origins' = List(), opened' = List(),
    }
  }

  // The caller's roles for the app change (a grant or a removal).
  action roleChange = {
    nondet a = Bool.oneOf()
    nondet r = Bool.oneOf()
    nondet s = Bool.oneOf()
    nondet e = Bool.oneOf()
    all {
      roles' = { admin: a, reviewer: r, safety: s, engineer: e },
      lens' = lens, unchangedSends, unchangedPerson,
    }
  }

  action lensChange = {
    nondet l = Bool.oneOf()
    all { lens' = l, roles' = roles, unchangedSends, unchangedPerson }
  }

  // shapeDelta: one member delta. The full class keeps every field; the counts class goes through countsMember.
  action memberDelta = all {
    memberSent' = { cls: cls, fields: shapeKeys(MEMBER_KEYS, k => if (cls == Full) Keep else memberFieldUse(Counts, k)) },
    roles' = roles, lens' = lens, oppSent' = oppSent, truthSent' = truthSent, oracleSent' = oracleSent, unchangedPerson,
  }

  // shapeDelta: one opportunity delta, with stripOracle first.
  action oppDelta = {
    nondet st = OPP_STATES.oneOf()
    nondet has = Bool.oneOf()
    nondet unsafe = Bool.oneOf()
    val keep = not(has) or oracleShown(lens, st, unsafe)
    all {
      oppSent' = { cls: cls, fields: shapeKeys(OPP_KEYS, k => if (cls == Full) Keep else oppFieldUse(Counts, k)) },
      oracleSent' = { sent: true, oracle: has and keep, lens: lens, state: st, unsafe: unsafe },
      roles' = roles, lens' = lens, memberSent' = memberSent, truthSent' = truthSent, unchangedPerson,
    }
  }

  // shapeState: one /api/state read.
  action stateRead = all {
    truthSent' = { sent: truthShown(cls, lens), cls: cls, lens: lens },
    roles' = roles, lens' = lens, memberSent' = memberSent, oppSent' = oppSent, oracleSent' = oracleSent, unchangedPerson,
  }

  // The person's memberships change (join, leave, hold, restriction, recycled number), and the summary
  // is read again (people.ts summary).
  action rowsChange = {
    nondet pick = APPS.indices().powerset().oneOf()
    nondet holdS = APPS.indices().powerset().oneOf()
    nondet resS = APPS.indices().powerset().oneOf()
    nondet recS = APPS.indices().powerset().oneOf()
    val rs = APPS.indices().fold(List(), (acc, i) =>
      if (pick.contains(i))
        acc.append({ app: APPS[i], hidden: isPrivateApp(privateApps, APPS[i]), hold: holdS.contains(i), restricted: resS.contains(i), recycled: recS.contains(i) })
      else acc)
    all {
      rows' = rs,
      shownApps' = rs.select(r => membershipShown(r)).foldl(List(), (l, r) => l.append(r.app)),
      holds' = holdLines(rs),
      origins' = rs.foldl(List(), (l, r) => l.append({ app: r.app, shown: blockOrigin(r.app, isPrivateApp(privateApps, r.app)) })),
      opened' = opened, privateApps' = privateApps,
      roles' = roles, lens' = lens, unchangedSends,
    }
  }

  // apps.tsx AppPanel: the Open button is on only with a reason of PERSON_REASON_MIN characters.
  action openPanel = {
    nondet app = Set("ntwrk", "slop", "peon", "friends").oneOf()
    nondet len = 0.to(7).oneOf()
    all {
      reasonOk(len),
      opened' = opened.append({ app: app, reason: len }),
      rows' = rows, shownApps' = shownApps, holds' = holds, origins' = origins, privateApps' = privateApps,
      roles' = roles, lens' = lens, unchangedSends,
    }
  }

  action step = any { roleChange, lensChange, memberDelta, oppDelta, stateRead, rowsChange, openPanel }

  // ================================================================ invariants
  // Rule: admin-console 4.1 (an analyst sees counts and the shape of the network, never a person);
  // audit observatory-5, -6, -18. Code: shape.ts countsMember, countsOpp, shapeDelta.
  // Code: countsMember drops age, minor, ageUnknown, trust, occupation, controlled and masks name;
  // countsOpp drops feedback and masks explanations and objective.
  // A real value never goes to a class below the field's level.
  val noFieldAboveClass: bool = and {
    memberSent.fields.forall(f => f.real implies classRank(memberFieldLevel(f.key)) <= classRank(memberSent.cls)),
    oppSent.fields.forall(f => f.real implies classRank(oppFieldLevel(f.key)) <= classRank(oppSent.cls)),
    // The counts class never gets the age facts or the trust level, not even masked.
    memberSent.cls == Counts implies memberSent.fields.forall(f => not(Set("age", "minor", "ageUnknown", "trust").contains(f.key))),
  }

  // Rule: shape.ts header (hidden truth per person, with the truth lens only); server.ts truthFor.
  // Code: shapeState deletes truth unless truth is on, and always for the counts class.
  val truthOnlyFullLens: bool = truthSent.sent implies (truthSent.cls == Full and truthSent.lens)

  // Rule: shape.ts stripOracle (the oracle is a spoiler until the opportunity is resolved).
  // Code: shape.ts stripOracle and its RESOLVED set.
  val oracleOnlyWhenShown: bool =
    oracleSent.oracle implies (oracleSent.lens or oppResolved(oracleSent.state) or oracleSent.unsafe)

  // Rule: PRD 40.3 (dating stays private); people.ts summary; types.ts PersonSummary.privateApps.
  // Code: people.ts summary returns no membership row for a private app.
  // A private app never shows in the summary's memberships.
  val privateNotListed: bool = shownApps.indices().forall(i => not(isPrivateApp(privateApps, shownApps[i])))

  // Rule: PRD 40.3 and plan 2.4 rule 5 (a hold holds the person everywhere, a private hold as
  // "restricted" on an app not named). Code: people.ts summary, apps.tsx PersonView.
  // Code: people.ts summary, the restricted() helper adds at most one "*" line.
  val hiddenHoldsRestricted: bool = and {
    holds.indices().forall(i => holds[i].app != ANY_APP implies not(isPrivateApp(privateApps, holds[i].app))),
    holds.indices().forall(i => holds[i].app == ANY_APP implies holds[i].level == "restricted"),
    holds.indices().filter(i => holds[i].app == ANY_APP).size() <= 1,
    holds.indices().exists(i => holds[i].app == ANY_APP) iff rows.indices().exists(k => hiddenHeld(rows[k])),
    // Each line is well formed (lineOk).
    holdLines(rows).indices().forall(i => lineOk(rows, holdLines(rows)[i])),
  }

  // Rule: types.ts PersonSummary.blocks (a block made in a private app shows its origin as "*").
  // Code: people.ts summary origin().
  val privateOriginHidden: bool = origins.indices().forall(i => isPrivateApp(privateApps, origins[i].app) implies origins[i].shown == ANY_APP)

  // Rule: plan 5 / 2.4 (each app's panel opens only with a typed reason); apps.tsx AppPanel.
  // Code: apps.tsx AppPanel disables Open below 5 trimmed characters.
  val panelNeedsReason: bool = opened.indices().forall(i => opened[i].reason >= PERSON_REASON_MIN)

  // Rule: admin-console 4.1, the counts class gets no age fact at all, masked or not. Code: shape.ts countsMember
  // drops declined, weekly and community with the age fields (PRIV-COUNTS, fixed 2026-11-22).
  val countsGetNoAgeFacts: bool =
    memberSent.cls == Counts implies memberSent.fields.forall(f => not(AGE_FACT_KEYS.contains(f.key)))

  val safety: bool = and {
    noFieldAboveClass, truthOnlyFullLens, oracleOnlyWhenShown,
    privateNotListed, hiddenHoldsRestricted, privateOriginHidden, panelNeedsReason, countsGetNoAgeFacts,
  }

  // ================================================================ witnesses (each MUST be violated)
  // A counts-class delta goes out with the masked name.
  val witness_maskedName: bool = not(memberSent.cls == Counts and memberSent.fields.contains({ key: "name", real: false }))
  // A full-class delta goes out with the real age.
  val witness_fullAge: bool = not(memberSent.cls == Full and memberSent.fields.contains({ key: "age", real: true }))
  // The hidden truth goes out.
  val witness_truthSent: bool = not(truthSent.sent)
  // An oracle verdict on an unresolved opportunity is stripped.
  val witness_oracleStripped: bool = not(oracleSent.sent and not(oracleSent.oracle) and not(oppResolved(oracleSent.state)))
  // A private hold shows as "restricted" on an app not named, beside a named hold.
  val witness_starHold: bool =
    not(holds.indices().exists(i => holds[i].app == ANY_APP) and holds.indices().exists(i => holds[i].app != ANY_APP))
  // The private app's panel opens with a reason.
  val witness_privatePanelOpened: bool = not(opened.indices().exists(i => isPrivateApp(privateApps, opened[i].app)))

  // ================================================================ replayed traces
  // Two private rows held: one "restricted" line on the app not named; the named rows keep their order.
  run holdLinesTest = {
    val rs = [
      { app: "ntwrk", hidden: false, hold: true, restricted: true, recycled: false },
      { app: "slop", hidden: true, hold: true, restricted: true, recycled: true },
      { app: "slop", hidden: true, hold: false, restricted: true, recycled: false },
      { app: "peon", hidden: false, hold: false, restricted: false, recycled: true },
    ]
    assert(holdLines(rs) == [
      { row: 0, app: "ntwrk", level: "hold" },
      { row: 0, app: "ntwrk", level: "restricted" },
      { row: -1, app: "*", level: "restricted" },
      { row: 3, app: "peon", level: "recycled_number" },
    ])
  }

  // An analyst gets a masked name, no age, no feedback; an admin gets them all.
  run fieldsTest = assert(and {
    memberFieldUse(Counts, "name") == Mask, memberFieldUse(Counts, "age") == Drop, memberFieldUse(Counts, "area") == Keep,
    oppFieldUse(Counts, "feedback") == Drop, oppFieldUse(Counts, "objective") == Mask,
    memberFieldUse(Full, "age") == Keep,
    classOf({ admin: false, reviewer: false, safety: false, engineer: false }) == Counts,
  })

  // namesApp hides the private app on hold and block lines; the cross-app button needs both conditions.
  run namesAppTest = assert(and {
    not(namesApp(ANY_APP)), namesApp("peon"), namesApp(blockOrigin("slop", false)), not(namesApp(blockOrigin("slop", true))),
    crossAppShown(true, true), not(crossAppShown(true, false)), not(crossAppShown(false, true)),
  })

  // PRIV-COUNTS (fixed 2026-11-22): the counts class drops the declined flag, the weekly opt-in and the community.
  run declinedLeaksTest = assert(and {
    memberFieldUse(Counts, "declined") == Drop, memberFieldUse(Counts, "weekly") == Drop, memberFieldUse(Counts, "community") == Drop,
    memberFieldUse(Full, "declined") == Keep, AGE_FACT_KEYS.contains("declined"),
  })

  // A reason of four characters does not open a panel; five does.
  run reasonTest = assert(not(reasonOk(4)) and reasonOk(5))
}
```
