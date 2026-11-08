// -*- mode: Bluespec; -*-
// quint-check: max-steps=16 max-samples=4000
//
// profile_read: two profile flows of the service on the shared line.
//
// WHAT THIS MODELS
//   A. The saved-profile read (packages/network/service/profile-read.ts profileReadRequest, and the
//      member unit in packages/network/service/service.ts route() and inbound, lines 964-965 and
//      1244-1270). A text arrives from one person for one member unit. The shell turns the text into
//      ReadFacts; readDecision (profile-core.ts) gives notRead, read, readApp, ambiguous or refused.
//      The member unit then rechecks the sender: the sender's person has an active membership in the
//      routed app, that membership is the member of the unit, and that member did not opt out.
//      Only then does it answer, and only with the sender's own saved profile.
//   B. The suggestion review batch (packages/network/service/profile-suggestion-review.ts
//      renderSuggestionReview, parseSuggestionReview and reviewSuggestionMessage). currentBatch
//      (profile-core.ts) selects the batch that a member may see and answer. A decision also needs
//      the token revision of the batch. An accept with a scope or an edit gives a preview with the
//      next revision; a reject resolves the batch (store decide, profile-suggestions.ts).
//   Each LemmaScript function in profile-core.ts is a pure def here with the same name and the same
//   decision: readOnly, readDecision, sameOwner, suggestionOk, currentBatch. Each shell handler is an
//   action that calls them and does not decide again.
//   The gateway is a nondeterministic environment: the member id of a turn can belong to another
//   person (a wrong or a forged binding), and a turn can come from another chat.
//
// BOUNDS
//   People 1 and 2. Apps SLOP and PEON (NONE is no app). Time 0..MAX_T. One batch at a time. Each
//   suggestion row is two values: valid (id, text, source and kind) and observedAt.
//
// RELATION TO quint/profile_learning.qnt (branch wave2/profile_learning)
//   That model has the whole connector journey. It reads currentBatch as one predicate (renderable) and
//   it does not model the profile read. This model has the decision inputs of currentBatch one by one,
//   so each conjunct of the core can fail.
//
// RUN (from the repository root; quint 0.33.1)
//   quint typecheck quint/profile_read.qnt
//   quint test quint/profile_read.qnt --main profile_read
//   quint run quint/profile_read.qnt --main profile_read --invariant=safety --max-samples=4000 --max-steps=16
//   Each witness_<name> must be VIOLATED (the state is reachable).
//
// OUTSIDE THE MODEL
//   - The regular expressions and the text normalization: the shell computes ReadFacts and the
//     batch flags, and LemmaScript proves the core from them. ownSubject (the "my " / "the ... i saved"
//     owner words) is the flag `own`.
//   - The reply copy and savedProfileText. A shown profile is a record of whose membership it is.
//   - The store transaction of decide (profile_learning.qnt has it).
module profile_read {

  // ---------------------------------------------------------------- constants
  type App = SLOP | PEON | NONE
  pure val PEOPLE = Set(1, 2)
  pure val APPS = Set(SLOP, PEON)
  pure val MAX_T = 6
  pure val MAX_SUGGESTIONS = 10

  // ---------------------------------------------------------------- core A (profile-core.ts)
  type ReadDecision = NotRead | Read | ReadApp | Ambiguous | Refused

  type ReadFacts = {
    readForm: bool,
    namesProfile: bool,
    asksChange: bool,
    own: bool,
    endsWithProfile: bool,
    appText: bool,
    appKnown: bool,
  }

  pure def readOnly(f: ReadFacts): bool = f.readForm and f.namesProfile and not(f.asksChange)

  pure def readDecision(f: ReadFacts): ReadDecision =
    if (not(f.readForm) or not(f.namesProfile)) NotRead
    else if (f.asksChange) NotRead
    else if (not(f.own)) Refused
    else if (not(f.endsWithProfile)) Ambiguous
    else if (not(f.appText)) Read
    else if (f.appKnown) ReadApp
    else Ambiguous

  // ---------------------------------------------------------------- core B (profile-core.ts)
  type Status = Pending | Resolved
  type Owner = { person: int, chat: int }
  type Suggestion = { valid: bool, observedAt: int }
  type Batch = {
    status: Status,
    owner: Owner,
    idOk: bool,
    expiresAt: int,
    revision: int,
    count: int,
    distinctIds: int,
    rows: Set[Suggestion],
  }

  pure def sameOwner(b: Batch, o: Owner): bool = b.owner == o

  pure def suggestionOk(s: Suggestion, now: int): bool = s.valid and s.observedAt <= now

  pure def currentBatch(b: Batch, o: Owner, now: int): bool = and {
    b.status == Pending, sameOwner(b, o),
    now < b.expiresAt,
    b.idOk, b.revision > 0,
    b.count > 0, b.count <= MAX_SUGGESTIONS,
    b.distinctIds == b.count,
    b.rows.forall(s => suggestionOk(s, now)),
  }

  // ---------------------------------------------------------------- state
  type Reply = RShow | RRefused | RAmbiguous | ROtherLine | RSilent | ROpen

  // One answered text. Ghost: the shell holds none of this; the invariants read it.
  type ReadLog = {
    sender: int,       // the person whose number sent the text
    recipient: int,    // the person of the member unit that gets the reply
    facts: ReadFacts,
    asked: App,        // the app that the text names (NONE when it names none)
    route: App,        // the app of the member unit
    optedOut: bool,
    reply: Reply,
    profileOf: int,    // whose saved membership the reply shows (0 when it shows none)
    profileApp: App,
  }

  type BatchLog = { kind: str, current: bool, revMatch: bool, at: int, owner: Owner, batchOwner: Owner, status: Status, expiresAt: int }

  var clock: int
  var members: Set[(int, App)]   // active memberships (person, app)
  var optedOut: Set[(int, App)]
  var reads: Set[ReadLog]
  var batch: Batch
  var hasBatch: bool
  var batchLog: Set[BatchLog]

  // ---------------------------------------------------------------- shell A
  // service.ts route(): a dedicated app line (platform.app_lines) picks its app first. On the shared
  // line an explicit own read of an app routes there; otherwise the member's open thread picks the app.
  pure def routeOf(d: ReadDecision, asked: App, lineApp: App, dedicated: bool): App =
    if (dedicated) lineApp else if (d == ReadApp) asked else lineApp

  // service.ts 1244-1270: the member unit. `memberOf` is the person that the unit's member id belongs to.
  pure def answer(f: ReadFacts, sender: int, memberOf: int, asked: App, route: App,
                  mem: Set[(int, App)], out: Set[(int, App)]): ReadLog =
    val d = readDecision(f)
    val ownOk = mem.contains((sender, route)) and memberOf == sender and not(out.contains((memberOf, route)))
    val reply =
      if (d == NotRead) ROpen
      else if (not(ownOk)) RSilent
      else if (d == Ambiguous) RAmbiguous
      else if (d == Refused) RRefused
      else if (d == ReadApp and asked != route) ROtherLine
      else RShow
    { sender: sender, recipient: memberOf, facts: f, asked: asked, route: route,
      optedOut: out.contains((memberOf, route)), reply: reply,
      profileOf: if (reply == RShow) sender else 0,
      profileApp: if (reply == RShow) route else NONE }

  action memberTexts = all {
    nondet sender = PEOPLE.oneOf()
    nondet memberOf = PEOPLE.oneOf()
    nondet lineApp = APPS.oneOf()
    nondet dedicated = Set(true, false).oneOf()
    nondet asked = Set(SLOP, PEON, NONE).oneOf()
    nondet readForm = Set(true, false).oneOf()
    nondet namesProfile = Set(true, false).oneOf()
    nondet asksChange = Set(true, false).oneOf()
    nondet own = Set(true, false).oneOf()
    nondet endsWithProfile = Set(true, false).oneOf()
    nondet appText = Set(true, false).oneOf()
    // keywordApp finds an app only for app words; the shell passes appKnown = (app !== undefined).
    val f = { readForm: readForm, namesProfile: namesProfile, asksChange: asksChange, own: own,
              endsWithProfile: endsWithProfile, appText: appText, appKnown: appText and asked != NONE }
    val route = routeOf(readDecision(f), asked, lineApp, dedicated)
    // A member unit exists only for a member of the routed app.
    all {
      members.contains((memberOf, route)),
      reads' = reads.union(Set(answer(f, sender, memberOf, asked, route, members, optedOut))),
    },
    clock' = clock, members' = members, optedOut' = optedOut,
    batch' = batch, hasBatch' = hasBatch, batchLog' = batchLog,
  }

  action join = all {
    nondet p = PEOPLE.oneOf()
    nondet a = APPS.oneOf()
    members' = members.union(Set((p, a))),
    clock' = clock, optedOut' = optedOut, reads' = reads, batch' = batch, hasBatch' = hasBatch, batchLog' = batchLog,
  }

  action stop = all {
    nondet p = PEOPLE.oneOf()
    nondet a = APPS.oneOf()
    optedOut' = optedOut.union(Set((p, a))),
    clock' = clock, members' = members, reads' = reads, batch' = batch, hasBatch' = hasBatch, batchLog' = batchLog,
  }

  // ---------------------------------------------------------------- shell B
  action tick = all {
    clock < MAX_T,
    clock' = clock + 1,
    members' = members, optedOut' = optedOut, reads' = reads, batch' = batch, hasBatch' = hasBatch, batchLog' = batchLog,
  }

  // The store makes a batch (PS propose). The environment can also give bad rows: currentBatch must refuse them.
  action propose = all {
    not(hasBatch) or batch.status == Resolved,
    nondet person = PEOPLE.oneOf()
    nondet chat = Set(1, 2).oneOf()
    nondet ttl = Set(1, 2, 3).oneOf()
    nondet count = Set(0, 1, 2, 11).oneOf()
    nondet dup = Set(true, false).oneOf()
    nondet idOk = Set(true, false).oneOf()
    nondet valid = Set(true, false).oneOf()
    nondet obs = Set(clock - 1, clock, clock + 1).oneOf()
    batch' = { status: Pending, owner: { person: person, chat: chat }, idOk: idOk, expiresAt: clock + ttl,
               revision: 1, count: count, distinctIds: if (dup and count > 1) count - 1 else count,
               rows: if (count == 0) Set() else Set({ valid: valid, observedAt: obs }) },
    hasBatch' = true,
    clock' = clock, members' = members, optedOut' = optedOut, reads' = reads, batchLog' = batchLog,
  }

  pure def logOf(kind: str, b: Batch, o: Owner, now: int, revMatch: bool): BatchLog =
    { kind: kind, current: currentBatch(b, o, now), revMatch: revMatch, at: now, owner: o,
      batchOwner: b.owner, status: b.status, expiresAt: b.expiresAt }

  // profile-suggestion-endpoint.ts: render the review text. No text when currentBatch is false.
  action render = all {
    hasBatch,
    nondet person = PEOPLE.oneOf()
    nondet chat = Set(1, 2).oneOf()
    val o = { person: person, chat: chat }
    all {
      currentBatch(batch, o, clock),
      batchLog' = batchLog.union(Set(logOf("render", batch, o, clock, true))),
    },
    clock' = clock, members' = members, optedOut' = optedOut, reads' = reads, batch' = batch, hasBatch' = hasBatch,
  }

  // reviewSuggestionMessage: parse (currentBatch and the token revision) then decide.
  action decide = all {
    hasBatch,
    nondet person = PEOPLE.oneOf()
    nondet chat = Set(1, 2).oneOf()
    nondet tokenRev = Set(batch.revision - 1, batch.revision, batch.revision + 1).oneOf()
    nondet kind = Set("preview", "reject").oneOf()
    val o = { person: person, chat: chat }
    val revMatch = tokenRev == batch.revision
    all {
      currentBatch(batch, o, clock), revMatch,
      batch' = if (kind == "preview") { ...batch, revision: batch.revision + 1 } else { ...batch, status: Resolved },
      batchLog' = batchLog.union(Set(logOf(kind, batch, o, clock, revMatch))),
    },
    clock' = clock, members' = members, optedOut' = optedOut, reads' = reads, hasBatch' = hasBatch,
  }

  action stutter = all {
    clock' = clock, members' = members, optedOut' = optedOut, reads' = reads, batch' = batch,
    hasBatch' = hasBatch, batchLog' = batchLog,
  }

  pure val NO_BATCH: Batch = { status: Resolved, owner: { person: 0, chat: 0 }, idOk: false, expiresAt: 0,
                               revision: 0, count: 0, distinctIds: 0, rows: Set() }

  action init = all {
    clock' = 0,
    members' = Set((1, SLOP), (2, SLOP)),
    optedOut' = Set(),
    reads' = Set(),
    batch' = NO_BATCH,
    hasBatch' = false,
    batchLog' = Set(),
  }

  action step = any { memberTexts, join, stop, tick, propose, render, decide, stutter }

  // ---------------------------------------------------------------- invariants
  // Rule: a member may read only the profile saved for their own number (service.ts reply
  // "I can only show the profile saved for your own number"; profile-read.ts savedProfileText uses
  // own.membership). Code: service.ts 1250-1265 own check; profile-core.ts readDecision.
  // LemmaScript: readDecision `ensures (\result === "read" || \result === "readApp") ==> readOnly(f) && f.own ...`.
  val inv_onlyOwnProfileShown = reads.forall(r =>
    r.reply == RShow implies (r.profileOf == r.sender and r.recipient == r.sender and r.facts.own))

  // Rule: a text that names another person's profile is refused or not read, never shown.
  // Code: profile-core.ts readDecision; LemmaScript `ensures (\result === "refused") === (readOnly(f) && !f.own)`.
  val inv_otherProfileRefused = reads.forall(r =>
    not(r.facts.own) implies (r.reply == RRefused or r.reply == RSilent or r.reply == ROpen))

  // Rule: "A combined read/edit is still an edit request, never a read-only operation" (profile-read.ts).
  // LemmaScript: readDecision `ensures f.asksChange ==> \result === "notRead"`.
  val inv_changeNeverRead = reads.forall(r => r.facts.asksChange implies r.reply == ROpen)

  // Rule: STOP stops every reply of the read path (AGENTS.md hard rule STOP; service.ts 1256-1259 optedOut check).
  val inv_optedOutGetsNoProfile = reads.forall(r => r.optedOut implies (r.reply == RSilent or r.reply == ROpen))

  // Rule: a read of one app shows only that app's profile (service.ts "This line is for ..." reply).
  // LemmaScript: readDecision `ensures \result === "readApp" ==> f.appText && f.appKnown`.
  val inv_shownAppIsAskedApp = reads.forall(r =>
    r.reply == RShow implies (r.profileApp == r.route and (r.asked == NONE or not(r.facts.appText) or r.asked == r.route)))

  // Rule: profile-suggestion-review.ts "Each command applies only to this batch": a review text is shown
  // only for the pending batch of the same person and chat, before it expires. Code: currentBatch.
  // LemmaScript: currentBatch `ensures \result ==> b.status === "pending" && sameOwner(b, o)` and the time conjunct.
  val inv_renderOnlyCurrent = batchLog.forall(l =>
    l.current and l.owner == l.batchOwner and l.status == Pending and l.at < l.expiresAt)

  // Rule: "The store must atomically recheck owner, revision, expiry and pending state"
  // (profile-suggestion-review.ts parseSuggestionReview). A decision has the batch's own revision.
  val inv_decisionOnlyCurrentRevision = batchLog.forall(l => l.kind != "render" implies (l.current and l.revMatch))

  // Rule: copy "Pending review expires <t>": no decision at or after the expiry.
  val inv_noDecisionAfterExpiry = batchLog.forall(l => l.kind != "render" implies l.at < l.expiresAt)

  val safety = and {
    inv_onlyOwnProfileShown, inv_otherProfileRefused, inv_changeNeverRead, inv_optedOutGetsNoProfile,
    inv_shownAppIsAskedApp, inv_renderOnlyCurrent, inv_decisionOnlyCurrentRevision, inv_noDecisionAfterExpiry,
  }

  // ---------------------------------------------------------------- reachability witnesses (expected VIOLATED)
  // A member reads their own saved profile.
  val witness_noShow = not(reads.exists(r => r.reply == RShow))
  // A member reads their own profile by app name.
  val witness_noAppShow = not(reads.exists(r => r.reply == RShow and r.facts.appText))
  // A read of another profile is refused.
  val witness_noRefused = not(reads.exists(r => r.reply == RRefused))
  // An ambiguous read gets the question.
  val witness_noAmbiguous = not(reads.exists(r => r.reply == RAmbiguous))
  // An app read on another app's dedicated line gets the other-line answer.
  val witness_noOtherLine = not(reads.exists(r => r.reply == ROtherLine))
  // A forged member binding gets no reply.
  val witness_noSilentForged = not(reads.exists(r => r.reply == RSilent and r.recipient != r.sender and r.facts.own))
  // A review text is shown.
  val witness_noRender = not(batchLog.exists(l => l.kind == "render"))
  // A scope change or an edit gives a new revision, and a later reject resolves the batch.
  val witness_noRejectAfterPreview = not(batchLog.exists(l => l.kind == "reject" and batch.revision > 1))

  // ---------------------------------------------------------------- traces
  pure val OWN_READ: ReadFacts = { readForm: true, namesProfile: true, asksChange: false, own: true,
                                   endsWithProfile: true, appText: false, appKnown: false }

  action textOf(f: ReadFacts, sender: int, memberOf: int, asked: App, lineApp: App): bool = all {
    val route = routeOf(readDecision(f), asked, lineApp, false)
    reads' = reads.union(Set(answer(f, sender, memberOf, asked, route, members, optedOut))),
    clock' = clock, members' = members, optedOut' = optedOut, batch' = batch, hasBatch' = hasBatch, batchLog' = batchLog,
  }

  action makeBatch(person: int, chat: int, ttl: int): bool = all {
    batch' = { status: Pending, owner: { person: person, chat: chat }, idOk: true, expiresAt: clock + ttl,
               revision: 1, count: 1, distinctIds: 1, rows: Set({ valid: true, observedAt: clock }) },
    hasBatch' = true,
    clock' = clock, members' = members, optedOut' = optedOut, reads' = reads, batchLog' = batchLog,
  }

  // "show my profile" from person 1 shows person 1's own slop profile.
  run ownReadTest = init.then(textOf(OWN_READ, 1, 1, NONE, SLOP))
    .then(all { assert(reads.exists(r => r.reply == RShow and r.profileOf == 1 and r.profileApp == SLOP)), stutter })

  // "show her profile" is refused; "show my profile and edit it" goes to the conversation.
  run otherAndEditTest = init.then(textOf({ ...OWN_READ, own: false }, 1, 1, NONE, SLOP))
    .then(textOf({ ...OWN_READ, asksChange: true }, 1, 1, NONE, SLOP))
    .then(all { assert(reads.exists(r => r.reply == RRefused) and reads.exists(r => r.reply == ROpen)
                       and not(reads.exists(r => r.reply == RShow))), stutter })

  // A member id that belongs to person 2 on a text from person 1: no reply at all.
  run forgedMemberTest = init.then(textOf(OWN_READ, 1, 2, NONE, SLOP))
    .then(all { assert(reads.forall(r => r.reply == RSilent)), stutter })

  // "show my slop profile" on the peon line: route() takes the shared line to slop, and the slop profile shows.
  run appReadTest = init.then(textOf({ ...OWN_READ, appText: true, appKnown: true }, 2, 2, SLOP, PEON))
    .then(all { assert(reads.exists(r => r.reply == RShow and r.profileApp == SLOP)), stutter })

  // The batch shows to its owner, not to another chat, and not after it expires.
  run batchExpiryTest = init.then(makeBatch(1, 1, 1))
    .then(all { assert(currentBatch(batch, { person: 1, chat: 1 }, clock)
                       and not(currentBatch(batch, { person: 1, chat: 2 }, clock))), stutter })
    .then(tick)
    .then(all { assert(not(currentBatch(batch, { person: 1, chat: 1 }, clock))), stutter })
}
