// -*- mode: Bluespec; -*-
// quint-check: max-steps=20 max-samples=2000
//
// join_flow: the web Join journey on the four sites, on the browser side.
//
// WHAT THIS MODELS
//   The browser state of /join (sites/shared/join.ts and sites/shared/auth.ts, OTP mode):
//   steps loading, invite, phone, code, profile, member, blocked, done; the profile form in the DOM;
//   the shell's generation counter and its account marker; the busy flags of the three forms.
//   Each LemmaScript step function in sites/shared/join-core.ts is a pure def here with the same
//   name and the same decision: isEmpty, flowOk, initialFlow, afterAuth, fieldsFor, signIn,
//   flowNext, formResets, formProblems, formPasses. phoneE164 (packages/core/src/phone-core.ts)
//   is an oracle that keeps its contract: a non-empty result is a US or Canadian number.
//   Each shell handler is an action that calls these defs and does not decide again.
//   The server is a nondeterministic environment. An answer can come late, out of order, two
//   times (a repeated request), or fail. A second tab can sign in as another account, or sign out,
//   at any time. This tab gets no event for that.
//
// BOUNDS
//   Numbers A and B (US numbers, which are also the account keys) and X (a foreign number).
//   At most 1 repeated request per run (the server runs it, the page never sees that answer). Field values come from a set of 5 forms.
//   Run with --max-steps=20.
//
// TIME
//   The core has no time-based decision. Turnstile, the auth-mode backoff and the OTP expiry
//   are timers in the shell or the server. Time is the order of actions only, so the model has no
//   tick variable.
//
// RUN (from the repository root; quint 0.33.1; there is no Apalache in this setup)
//   quint typecheck quint/join_flow.qnt
//   quint run quint/join_flow.qnt --invariant=<name> --max-samples=2000 --max-steps=20 --seed=11
//   Each witness_<name> must be VIOLATED (the state is reachable). noStaleAnswerSeen holds (part of safety).
//   Defects JF-1 and JF-3 are fixed in the shell and the core. These hold (seeds 11 and 29):
//   quint run quint/join_flow.qnt --invariant=<name> --max-samples=20000 --max-steps=20 --seed=29
//   for signInMatchesSession, staleAnswerNeverMovesStep, joinAppliesToShownAccountWithMarker, safety.
//   joinAppliesToShownAccount is still VIOLATED when markerApp is false: slop.date and peon.biz get no
//   signupView from /api/me (api.ts), so the page has no marker to send (JF-2 needs a server change).
//   `safety` is the conjunction of the invariants that hold.
//
// ABSTRACTIONS
//   - Account keys. The shell uses signupView, else E.164 after verified (when /api/me shows the last
//     4 digits of the verified number), and signupView or phoneMasked after loaded and rerouted. Here one person has one key (A or B). Two keys for one person only clear
//     fields that could stay. Two people with the same last 4 digits share a phoneMasked key on
//     slop.date and peon.biz; the model does not have that collision.
//   - phoneE164 maps an input to itself when it is A or B, and to "" for X. Formats ("(212) ...",
//     "+1 ...") are outside the model; LemmaScript proves them.
//   - Field values: firstName "" or "Ann"; age "", "30", "200" or "12.5". The ZIP is always empty.
//     formProblems keeps the shipping comparisons on age.
//   - The server answer is computed when the answer arrives (the server reads its state then).
//
// OUTSIDE THE MODEL
//   - The DOM, the messages, the radio groups (shell-only checks before formPasses), Turnstile.
//   - prefill (the /oauth/signup-draft read). The research report calls it dead in production.
//     Its account check is the same rerouted event that account_changed sends.
//   - Cloud mode (a page reload) and resend without Turnstile (no step change).
//   - The server's own join checks (age, ban, invite). Here they are the "refused" set.
module join_flow {

  // ---------------------------------------------------------------- types (own, small)
  type FlowStep = Loading | Invite | Phone | Code | Profile | Member | Blocked | Done

  type JoinFields = { firstName: str, age: str, ticked: bool }

  type Flow = {
    step: FlowStep,
    phone: str,
    shown: str,
    account: str,
    fields: JoinFields,
    owner: str,
    consented: bool,
    notice: str,
  }

  type LoadedEv = { signedInAs: str, canJoin: bool, member: bool, inviteOnly: bool, notice: str }
  // phone: the number that otp/verify used. account: the session that /api/me read after it.
  type AuthEv = { phone: str, account: str, canJoin: bool, member: bool }
  type RerouteEv = { account: str, canJoin: bool, member: bool, notice: str }

  type FlowEvent =
    | Loaded(LoadedEv)
    | Typed(JoinFields)
    | OtpStarted(str)
    | ChangeNumber
    | Verified(AuthEv)
    | Rerouted(RerouteEv)
    | SessionEnded(str)
    | Refused
    | Joined

  // The form as the shell reads it. age is Number(age) as an integer; wholeAge is Number.isInteger.
  type JoinForm = { firstName: str, age: int, wholeAge: bool, zip: str, ticked: bool }
  type FormProblems = { name: bool, age: bool, zip: bool, consent: bool }

  // ---------------------------------------------------------------- the core (join-core.ts)
  pure val NO_FIELDS: JoinFields = { firstName: "", age: "", ticked: false }
  pure val MAX_FIRST_NAME = 50

  pure def isEmpty(f: JoinFields): bool = f.firstName == "" and f.age == "" and not(f.ticked)

  pure def asksForNumber(st: FlowStep): bool = st == Loading or st == Invite or st == Phone or st == Code

  // The five conjuncts of flowOk. Each one is also a named invariant below.
  pure def codeHasShownNumber(s: Flow): bool = s.step != Code or (s.phone != "" and s.shown == s.phone)
  pure def askStepsHaveNoSession(s: Flow): bool = not(asksForNumber(s.step)) or s.account == ""
  pure def signedInStepsHaveSession(s: Flow): bool = (s.step != Profile and s.step != Member) or s.account != ""
  pure def doneOnlyAfterConsent(s: Flow): bool =
    s.step != Done or (s.account != "" and s.consented and s.fields.ticked and s.notice == "")
  pure def fieldsNeverCrossAccounts(s: Flow): bool = s.account == "" or s.owner == s.account or isEmpty(s.fields)

  pure def flowOk(s: Flow): bool = and {
    codeHasShownNumber(s),
    askStepsHaveNoSession(s),
    signedInStepsHaveSession(s),
    doneOnlyAfterConsent(s),
    fieldsNeverCrossAccounts(s),
  }

  pure def initialFlow(fs: JoinFields): Flow =
    { step: Loading, phone: "", shown: "", account: "", fields: fs, owner: "", consented: false, notice: "" }

  pure def afterAuth(canJoin: bool, member: bool): FlowStep =
    if (canJoin) Profile else if (member) Member else Blocked

  pure def fieldsFor(fs: JoinFields, owner: str, account: str): JoinFields =
    if (owner == "" or owner == account) fs else NO_FIELDS

  pure def signIn(s: Flow, account: str, canJoin: bool, member: bool, notice: str): Flow =
    { ...s, account: account, owner: account, fields: fieldsFor(s.fields, s.owner, account),
      step: afterAuth(canJoin, member), consented: false, notice: notice }

  pure def flowNext(s: Flow, e: FlowEvent): Flow = match e {
    | Loaded(l) =>
        if (s.step != Loading) s
        else if (l.signedInAs == "") { ...s, step: if (l.inviteOnly) Invite else Phone, notice: l.notice }
        else signIn(s, l.signedInAs, l.canJoin, l.member, l.notice)
    | Typed(f) => if (s.step != Profile) s else { ...s, fields: f, owner: s.account }
    | OtpStarted(n) => if (s.step != Phone or n == "") s else { ...s, step: Code, phone: n, shown: n }
    | ChangeNumber => if (s.step != Code) s else { ...s, step: Phone }
    | Verified(a) => if (s.step != Code or a.phone != s.phone or a.account == "") s else signIn(s, a.account, a.canJoin, a.member, "")
    | Rerouted(r) => if (s.step != Profile or r.account == "") s else signIn(s, r.account, r.canJoin, r.member, r.notice)
    | SessionEnded(n) => if (s.step == Done) s else { ...s, account: "", consented: false, step: Phone, notice: n }
    | Refused => if (s.step != Profile) s else { ...s, step: Blocked }
    | Joined => if (s.step != Profile or not(s.fields.ticked)) s else { ...s, step: Done, consented: true, notice: "" }
  }

  pure def formResets(prev: Flow, nx: Flow): bool = prev.owner != nx.owner and isEmpty(nx.fields)

  // zipOk with an empty ZIP is true. The ZIP scan is outside the model (LemmaScript proves it).
  pure def zipOk(zip: str): bool = zip == ""

  pure def formProblems(f: JoinForm): FormProblems = {
    name: f.firstName == "",  // length 0; "Ann" is shorter than MAX_FIRST_NAME
    age: not(f.wholeAge) or f.age < 1 or f.age > 120,
    zip: not(zipOk(f.zip)),
    consent: not(f.ticked),
  }

  pure def formPasses(f: JoinForm): bool =
    val p = formProblems(f)
    not(p.name) and not(p.age) and not(p.zip) and not(p.consent)

  // ---------------------------------------------------------------- phoneE164 (oracle)
  // Contract kept: a non-empty result is a US or Canadian number (phone-core.ts ensures).
  pure val US_CA: Set[str] = Set("A", "B")
  pure val NUMBERS: Set[str] = Set("A", "B", "X")
  pure def phoneE164(input: str): str = if (US_CA.contains(input)) input else ""

  // ---------------------------------------------------------------- shell and server state
  type Kind = KMeLoad | KOtpStart | KOtpVerify | KMeVerify | KJoin | KMeReroute
  type Ctx = { step: FlowStep, phone: str, account: str }
  type Msg = { id: int, kind: Kind, num: str, form: JoinFields, marker: str, gen: int, ctx: Ctx }

  type Shell = {
    dom: JoinFields,        // the profile form in the page
    generation: int,
    marker: str,            // join.ts `account`: the signupView sent with /api/join
    markerApp: bool,        // /api/me gives a signupView: friends and ntwrk today; slop and peon need a server change
    phoneBusy: bool,
    codeBusy: bool,
    profileBusy: bool,
    inflight: Set[Msg],
    nextId: int,
    dupLeft: int,
  }

  type Server = { cookie: str, codes: Set[str], members: Set[str], refused: Set[str], inviteOnly: bool }

  // Ghost state for the invariants. Nothing in the shell reads it.
  type Hist = {
    author: str,             // the account that typed the fields in the DOM ("" for the link prefill)
    started: Set[str],       // every number that otpStarted got
    sentUnticked: bool,      // a /api/join left with the box not ticked
    joinedAs: str,           // the account that the server joined
    joinedFor: str,          // the account that the page showed when it sent that join
    signInMismatch: bool,    // a sign-in step took an account that is not the session
    staleMoved: bool,        // a stale answer moved the step
    staleSeen: bool,         // a stale answer arrived
    crossClears: int,        // sign-ins that cleared fields of another account
  }

  type St = { flow: Flow, prev: Flow, sh: Shell, srv: Server, hist: Hist }

  var st: St

  // ---------------------------------------------------------------- shell helpers
  // join.ts dispatch: flowNext, then profile.reset() when formResets.
  pure def dispatch(s: St, e: FlowEvent): St =
    val nx = flowNext(s.flow, e)
    val reset = formResets(s.flow, nx)
    { ...s,
      flow: nx,
      sh: if (reset) { ...s.sh, dom: NO_FIELDS } else s.sh,
      hist: if (reset) { ...s.hist, author: "", crossClears: s.hist.crossClears + (if (isEmpty(s.flow.fields)) 0 else 1) }
            else s.hist }

  pure def ctxOf(f: Flow): Ctx = { step: f.step, phone: f.phone, account: f.account }

  pure def send(s: St, kind: Kind, num: str, form: JoinFields): St =
    val m = { id: s.sh.nextId, kind: kind, num: num, form: form, marker: s.sh.marker, gen: s.sh.generation, ctx: ctxOf(s.flow) }
    { ...s, sh: { ...s.sh, inflight: s.sh.inflight.union(Set(m)), nextId: s.sh.nextId + 1 } }

  // join.ts resetAccount: generation++, account = undefined.
  pure def resetAccount(s: St): St = { ...s, sh: { ...s.sh, generation: s.sh.generation + 1, marker: "" } }

  // join.ts takeAccount, at each sign-in step on every site: `account` is the signupView of a person
  // who can join, when /api/me gives one. `marked` is markerApp here.
  pure def takeMarker(s: St, account: str, canJoin: bool): St =
    { ...s, sh: { ...s.sh, marker: if (s.sh.markerApp and canJoin) account else "" } }

  pure def canJoinOf(srv: Server, a: str): bool = not(srv.members.contains(a)) and not(srv.refused.contains(a))

  // A sign-in step must take the account of the session that the me answer read.
  pure def checkSignIn(before: St, after: St, session: str): St =
    val entered = before.flow.account != after.flow.account and after.flow.account != ""
    if (entered and after.flow.account != session) { ...after, hist: { ...after.hist, signInMismatch: true } } else after

  // ---------------------------------------------------------------- answer handlers
  // auth.ts phone submit, after api.otpStart. The server normalizes with the same phoneE164.
  pure def onOtpStart(s0: St, m: Msg, failed: bool): St =
    val s = { ...s0, sh: { ...s0.sh, phoneBusy: false } }
    if (failed or phoneE164(m.num) == "") s
    else
      val s1 = { ...s, srv: { ...s.srv, codes: s.srv.codes.union(Set(m.num)) } }
      val s2 = dispatch(s1, OtpStarted(m.num))
      { ...s2, hist: { ...s2.hist, started: s2.hist.started.union(Set(m.num)) } }

  // auth.ts code submit, after api.otpVerify; then onSignedIn: resetAccount, api.me(). The code form
  // stays busy until that answer lands (busy() wraps both requests).
  pure def onOtpVerify(s0: St, m: Msg, failed: bool, rightCode: bool): St =
    if (failed or not(rightCode) or not(s0.srv.codes.contains(m.num))) { ...s0, sh: { ...s0.sh, codeBusy: false } }
    else
      val s1 = { ...s0, srv: { ...s0.srv, cookie: m.num, codes: s0.srv.codes.exclude(Set(m.num)) } }
      send(resetAccount(s1), KMeVerify, m.num, NO_FIELDS)

  // join.ts first load: api.me() then loaded.
  pure def onMeLoad(s: St, failed: bool): St =
    val c = s.srv.cookie
    if (failed or c == "")
      dispatch(s, Loaded({ signedInAs: "", canJoin: false, member: false, inviteOnly: s.srv.inviteOnly, notice: "" }))
    else
      val cj = canJoinOf(s.srv, c)
      val s1 = dispatch(s, Loaded({ signedInAs: c, canJoin: cj, member: s.srv.members.contains(c), inviteOnly: s.srv.inviteOnly, notice: "" }))
      takeMarker(checkSignIn(s, s1, c), c, cj)

  // join.ts onSignedIn, after api.me(): the generation check, then verified with the verified number
  // and the account that me read. busy() ends here.
  pure def onMeVerify(s0: St, m: Msg, failed: bool): St =
    val s = { ...s0, sh: { ...s0.sh, codeBusy: false } }
    val c = s.srv.cookie
    if (m.gen != s.sh.generation) s
    else if (failed or c == "")
      (if (s.flow.step == Code and s.flow.phone == m.num) dispatch(s, SessionEnded("unauthorized")) else s)
    else
      val cj = canJoinOf(s.srv, c)
      val s1 = dispatch(s, Verified({ phone: m.num, account: c, canJoin: cj, member: s.srv.members.contains(c) }))
      takeMarker(checkSignIn(s, s1, c), c, cj)

  // join.ts account_changed branch, after api.me(): routeTo, or sessionEnded. busy() ends here.
  pure def onMeReroute(s0: St, m: Msg, failed: bool): St =
    val s = { ...s0, sh: { ...s0.sh, profileBusy: false } }
    val c = s.srv.cookie
    if (m.gen != s.sh.generation) s
    else if (failed or c == "") dispatch(s, SessionEnded("account_changed"))
    else
      val cj = canJoinOf(s.srv, c)
      val s1 = dispatch(s, Rerouted({ account: c, canJoin: cj, member: s.srv.members.contains(c), notice: "account_changed" }))
      takeMarker(checkSignIn(s, s1, c), c, cj)

  // join.ts profile submit, after api.join. The server acts first; the page then checks generation.
  // On account_changed the form stays busy until the reroute answer lands (JF-3 fix).
  pure def onJoin(s0: St, m: Msg, failed: bool): St =
    val s = { ...s0, sh: { ...s0.sh, profileBusy: false } }
    val c = s.srv.cookie
    val current = m.gen == s.sh.generation
    if (failed) s
    else if (c == "") (if (current) dispatch(resetAccount(s), SessionEnded("unauthorized")) else s)
    else if (m.marker != "" and m.marker != c)
      (if (current) send(resetAccount({ ...s, sh: { ...s.sh, profileBusy: true } }), KMeReroute, "", NO_FIELDS) else s)
    else if (s.srv.refused.contains(c)) (if (current) dispatch(s, Refused) else s)
    // A member who is not refused gets ok with the existing membership (accounts.ts joinLocked,
    // joinPlan "existing"), so the page takes it as a join: generation++, then joined.
    else if (s.srv.members.contains(c))
      (if (current) dispatch({ ...s, sh: { ...s.sh, generation: s.sh.generation + 1 } }, Joined) else s)
    else
      val s1 = { ...s, srv: { ...s.srv, members: s.srv.members.union(Set(c)) },
                       hist: { ...s.hist, joinedAs: c, joinedFor: m.ctx.account } }
      if (current) dispatch({ ...s1, sh: { ...s1.sh, generation: s1.sh.generation + 1 } }, Joined) else s1

  pure def handle(s: St, m: Msg, failed: bool, rightCode: bool): St = match m.kind {
    | KMeLoad => onMeLoad(s, failed)
    | KOtpStart => onOtpStart(s, m, failed)
    | KOtpVerify => onOtpVerify(s, m, failed, rightCode)
    | KMeVerify => onMeVerify(s, m, failed)
    | KJoin => onJoin(s, m, failed)
    | KMeReroute => onMeReroute(s, m, failed)
  }

  // ---------------------------------------------------------------- actions
  pure val LINK_FIELDS: Set[JoinFields] = Set(NO_FIELDS, { firstName: "Ann", age: "30", ticked: false })
  pure val TYPED_FIELDS: Set[JoinFields] = Set(
    NO_FIELDS,
    { firstName: "Ann", age: "30", ticked: true },
    { firstName: "Ann", age: "30", ticked: false },
    { firstName: "Ann", age: "200", ticked: true },
    { firstName: "Ann", age: "12.5", ticked: true },
  )

  pure def ageNum(a: str): int = if (a == "30") 30 else if (a == "200") 200 else if (a == "12.5") 12 else 0
  pure def toForm(f: JoinFields): JoinForm =
    { firstName: f.firstName, age: ageNum(f.age), wholeAge: f.age != "12.5", zip: "", ticked: f.ticked }

  action init = {
    nondet link = LINK_FIELDS.oneOf()
    nondet cookie = Set("", "A", "B").oneOf()
    nondet members = US_CA.powerset().oneOf()
    nondet refused = US_CA.powerset().oneOf()
    nondet inviteOnly = Set(true, false).oneOf()
    nondet markerApp = Set(true, false).oneOf()
    val f0 = initialFlow(link)
    val s0 = {
      flow: f0, prev: f0,
      sh: { dom: link, generation: 0, marker: "", markerApp: markerApp, phoneBusy: false, codeBusy: false,
            profileBusy: false, inflight: Set(), nextId: 0, dupLeft: 1 },
      srv: { cookie: cookie, codes: Set(), members: members, refused: refused, inviteOnly: inviteOnly },
      hist: { author: "", started: Set(), sentUnticked: false, joinedAs: "", joinedFor: "",
              signInMismatch: false, staleMoved: false, staleSeen: false, crossClears: 0 },
    }
    st' = send(s0, KMeLoad, "", NO_FIELDS)
  }

  action go(ns: St): bool = st' = { ...ns, prev: st.flow }

  // The person types in the profile form: input and change listeners call typed().
  action userTypes = all {
    st.flow.step == Profile, not(st.sh.profileBusy),
    nondet f = TYPED_FIELDS.oneOf()
    val s1 = { ...st, sh: { ...st.sh, dom: f }, hist: { ...st.hist, author: st.flow.account } }
    go(dispatch(s1, Typed(f))),
  }

  // auth.ts phone submit: toE164, then api.otpStart. A null number stops in the shell.
  action userSubmitPhone = all {
    st.flow.step == Phone, not(st.sh.phoneBusy),
    nondet n = NUMBERS.oneOf()
    val e = phoneE164(n)
    all {
      e != "",
      go(send({ ...st, sh: { ...st.sh, phoneBusy: true } }, KOtpStart, e, NO_FIELDS)),
    },
  }

  // auth.ts code submit: api.otpVerify(flow.current().phone).
  action userSubmitCode = all {
    st.flow.step == Code, not(st.sh.codeBusy),
    go(send({ ...st, sh: { ...st.sh, codeBusy: true } }, KOtpVerify, st.flow.phone, NO_FIELDS)),
  }

  // auth.ts change number (also resend with Turnstile on). busy() disables it while verify runs.
  action userChangeNumber = all {
    st.flow.step == Code, not(st.sh.codeBusy),
    go(dispatch(st, ChangeNumber)),
  }

  // join.ts profile submit: typed(), formProblems, formPasses, the marker guard, then api.join.
  action userSubmitJoin = all {
    st.flow.step == Profile, not(st.sh.profileBusy),
    val s1 = dispatch(st, Typed(st.sh.dom))
    all {
      formPasses(toForm(s1.sh.dom)),
      // `if (marked && !account) return;`
      not(st.sh.markerApp) or st.sh.marker != "",
      val s2 = { ...s1, sh: { ...s1.sh, profileBusy: true },
                        hist: { ...s1.hist, sentUnticked: s1.hist.sentUnticked or not(s1.sh.dom.ticked) } }
      go(send(s2, KJoin, "", s1.sh.dom)),
    },
  }

  // A second tab signs in as another account, or signs out. This tab gets no event.
  action otherTab = {
    nondet c = Set("", "A", "B").oneOf()
    all { c != st.srv.cookie, go({ ...st, srv: { ...st.srv, cookie: c } }) }
  }

  // One server answer arrives: late, in any order, or failed. A browser runs the handler of one fetch
  // once. "Repeated" is the server side only: the request runs on the server, the answer is lost, and
  // the same request stays in flight (a proxy retry). The page sees only the later answer.
  action deliver = all {
    st.sh.inflight != Set(),
    nondet m = st.sh.inflight.oneOf()
    nondet failed = Set(true, false).oneOf()
    nondet rightCode = Set(true, false).oneOf()
    val s1 = handle({ ...st, sh: { ...st.sh, inflight: st.sh.inflight.exclude(Set(m)) } }, m, failed, rightCode)
    val stale = m.ctx != ctxOf(st.flow)
    val moved = s1.flow.step != st.flow.step
    go({ ...s1, hist: { ...s1.hist, staleSeen: s1.hist.staleSeen or stale,
                                      staleMoved: s1.hist.staleMoved or (stale and moved) } }),
  }

  action serverRepeats = all {
    st.sh.inflight != Set(), st.sh.dupLeft > 0,
    nondet m = st.sh.inflight.oneOf()
    nondet rightCode = Set(true, false).oneOf()
    val s1 = handle(st, m, false, rightCode)
    go({ ...st, sh: { ...st.sh, dupLeft: st.sh.dupLeft - 1 }, srv: s1.srv,
                hist: { ...st.hist, joinedAs: s1.hist.joinedAs, joinedFor: s1.hist.joinedFor } }),
  }

  action stutter = go(st)

  action step = any { userTypes, userSubmitPhone, userSubmitCode, userChangeNumber, userSubmitJoin, otherTab, deliver, serverRepeats, stutter }

  // ---------------------------------------------------------------- invariants
  // Rule: join-core.ts flowOk conjunct 1 (frontend-sites.md section 2.2, invariant 1). The code step
  // holds a number, and the number shown is the number that verify uses.
  // LemmaScript: flowOk, kept by flowNext `ensures flowOk(s) ==> flowOk(\result)`.
  val inv_codeHasShownNumber = codeHasShownNumber(st.flow)

  // Rule: join-core.ts flowOk conjunct 2. A step that asks for a number or a code holds only with no session.
  // LemmaScript: flowOk via flowNext ensures.
  val inv_askStepsHaveNoSession = askStepsHaveNoSession(st.flow)

  // Rule: join-core.ts flowOk conjunct 3 (frontend-sites.md 2.2, invariant 2). profile and member need a session.
  // LemmaScript: flowOk via flowNext ensures.
  val inv_signedInStepsHaveSession = signedInStepsHaveSession(st.flow)

  // Rule: join-core.ts flowOk conjunct 4 (frontend-sites.md 2.2, invariant 3; AGENTS.md hard rule "consent";
  // PRD 40.3 opt-in). done only with a session, the consent box ticked, and no page error.
  // LemmaScript: flowOk; flowNext `ensures \result.step === "done" && s.step !== "done" ==> s.step === "profile" && s.fields.ticked`.
  val inv_doneOnlyAfterConsent = doneOnlyAfterConsent(st.flow)

  // Rule: join-core.ts flowOk conjunct 5 (frontend-sites.md 2.2, invariant 5). A signed-in form never
  // holds the fields of another account, by the owner field.
  // LemmaScript: flowOk via flowNext ensures.
  val inv_fieldsNeverCrossAccounts = fieldsNeverCrossAccounts(st.flow)

  // Rule: join-core.ts flowOk, all conjuncts together.
  // LemmaScript: initialFlow `ensures flowOk(\result)`; flowNext `ensures flowOk(s) ==> flowOk(\result)`.
  val inv_flowOk = flowOk(st.flow)

  // Rule: "fields of one account never shown to another" (frontend-sites.md 2.2, invariant 5, bug B2 fix).
  // The ghost author is who typed the fields; flowOk's owner is rewritten by signIn, so this is the
  // stronger check. LemmaScript: flowNext `ensures s.step === "code" && s.owner !== "" && e.tag === "verified"
  // && e.phone === s.phone && e.account !== "" && s.owner !== e.account ==> formResets(s, \result)` and fieldsFor.
  val fieldsNeverShownToOtherAccount =
    st.flow.step != Profile or isEmpty(st.sh.dom) or st.hist.author == "" or st.hist.author == st.flow.account

  // Rule: the DOM shows what the flow holds (join.ts dispatch resets the form when formResets).
  // LemmaScript: formResets; flowNext `ensures flowOk(s) && s.owner === "" && !isEmpty(s.fields) ==> !formResets(s, \result)`.
  val shownFieldsAreFlowFields = st.sh.dom == st.flow.fields

  // Rule: done is final (flowNext contract). LemmaScript: flowNext `ensures s.step === "done" ==> \result === s`.
  val doneIsFinal = st.prev.step != Done or st.flow == st.prev

  // Rule: done comes only from a profile with the box ticked.
  // LemmaScript: flowNext `ensures \result.step === "done" && s.step !== "done" ==> s.step === "profile" && s.fields.ticked`.
  val doneOnlyFromTickedProfile =
    st.flow.step != Done or st.prev.step == Done or (st.prev.step == Profile and st.prev.fields.ticked)

  // Rule: a foreign number never reaches otpStarted (phone-core.ts phoneE164: US and Canadian numbers only;
  // SMS pumping). LemmaScript: phoneE164 `ensures \result !== null ==> usOrCanadaArea(...)`; the shell
  // and the server both call it.
  val foreignNumberNeverStarts =
    st.hist.started.forall(n => US_CA.contains(n)) and (st.flow.step != Code or US_CA.contains(st.flow.phone))

  // Rule: the client form never sends what the consent rule refuses.
  // LemmaScript: formPasses `ensures \result ==> parseJoinTakes(f) && f.ticked`.
  val joinSentOnlyWhenFormPasses = not(st.hist.sentUnticked)

  // Rule: a stale answer never moves the step. An answer is stale when the step, the number or the
  // account changed after its request left. LemmaScript: the flowNext guards (each event acts only from
  // its own step); flowNext `ensures e.tag === "verified" && e.phone !== s.phone ==> \result === s`.
  // Fixed (DEFECT JF-1): the code form stays busy until onSignedIn's api.me() answer lands, that answer
  // has a generation check, and verified carries the verified number.
  val staleAnswerNeverMovesStep = not(st.hist.staleMoved)

  // Rule: a sign-in step takes the account of the session that the server holds.
  // LemmaScript: flowNext `ensures s.step === "code" && e.tag === "verified" && e.phone === s.phone
  // && e.account !== "" ==> \result.account === e.account`, and each new account comes from its event.
  // Fixed (DEFECT JF-1): verified carries the account that /api/me read, not the number on screen.
  val signInMatchesSession = not(st.hist.signInMismatch)

  // Rule: the server joins the account that the page showed (api.ts account_changed check).
  // No LemmaScript function: the marker is shell state. The shell now takes the marker on every site
  // (DEFECT JF-2), but STILL FAILS on slop.date and peon.biz: /api/me gives them no signupView, so the
  // server joins the cookie account. It holds when markerApp is true (the next invariant).
  val joinAppliesToShownAccount = st.hist.joinedAs == st.hist.joinedFor

  // Rule: the same, on a site where /api/me gives the signupView marker. Fixed (DEFECT JF-3): after
  // account_changed the profile form stays busy until the api.me() answer lands, and no join leaves
  // without the marker when the server gave one.
  val joinAppliesToShownAccountWithMarker = not(st.sh.markerApp) or st.hist.joinedAs == st.hist.joinedFor

  val safety = and {
    noStaleAnswerSeen,
    inv_flowOk, fieldsNeverShownToOtherAccount, shownFieldsAreFlowFields, doneIsFinal,
    doneOnlyFromTickedProfile, foreignNumberNeverStarts, joinSentOnlyWhenFormPasses,
  }

  // ---------------------------------------------------------------- reachability witnesses (expected VIOLATED)
  // A person reaches done.
  val witness_neverDone = st.flow.step != Done
  // A person reaches member.
  val witness_neverMember = st.flow.step != Member
  // A sign-in as another account cleared fields (fieldsFor and formResets act).
  val witness_noCrossClear = st.hist.crossClears == 0
  // Rule: each form stays busy until its last answer (JF-1 fix in sites/shared/auth.ts and join.ts), so
  // no answer is stale when it lands. This is an invariant now, part of safety. With the code form
  // released after otp/verify (the old busy) it is violated, and staleAnswerNeverMovesStep still holds
  // by the core guard (flowNext ignores a verified event for another number).
  val noStaleAnswerSeen = not(st.hist.staleSeen)
  // Link prefill fields survive into profile (bug B2 fix: the first session keeps them).
  val witness_noPrefillInProfile = not(st.flow.step == Profile and st.flow.fields.firstName == "Ann" and st.hist.author == "")
}
