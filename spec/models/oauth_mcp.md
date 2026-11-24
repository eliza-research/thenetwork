# Connector authorization and member tools

## Story: Connector authorization and member tools

A member needs to give an agent scoped access to their account and revoke it.

### Safety rules and reachability

Check code use, refresh, ownership, ban and revocation, scoped tools, and request retention. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [connector browser authorization spec](../oauthBrowserAuthorization.md) generates the request binding, phone verification, and explicit consent decisions. The [connector grant issuance spec](../oauthGrantIssuance.md) drives the VibeLang shell from confirmed consent through authority and one commit for request consumption, grant, code and both audit rows. The [connector token spec](../oauthTokenLifecycle.md) generates token exchange, renewal, and client revocation decisions. This standalone model also covers persisted grant state and member tools.

Browser cookie names are part of the HTTP shell. Local app origins on one loopback hostname share the browser's cookie jar. Each app has a separate pending request cookie. On HTTP loopback, the server reads the old shared cookie if the app cookie is unavailable. HTTPS uses a secure host-only cookie. The browser authorization rule checks the app, expiry, and browser digest. The [platform end-to-end tests](../../tests/e2e/platform.e2e.test.ts) cover pending requests on two app origins.

The [signup draft rules](../mcpSignupDraft.md) drive draft preparation,
session-bound reads, discard, and expiry. The draft waits for the
person's final Join submission. The browser verifies the final signup submission and counts age from the birthday with [the calendar rules](../authorizationPages.md). [Signup age eligibility](signup_age_eligibility.md) covers private eligibility after joining. The [signup handoff rules](../agentPhoneHandoff.md) cover enrollment continuation. Draft disposal and expiry also stay in the serving flow.

A reader who is not an adult reads an update about another member only while the item is a teen item that the rule allows now (`teenFriendAgeRule`; [friend introductions with a minor](../friendIntroAge.md), [connector tools](../connectorTools.md) `readerAgeAllowed`, `ConsentNetwork.teenItemCurrent`): staff have not stopped teen introductions, the reader is teen ready, and the item was not closed by the teen sweep. A stop, a report and the sweep end readability for good (`teenSwitchOffNoMinor`). A minor with an exact birth date (`teenBirthDate`, `birthExact`) and no barred phone is teen ready (`teenReadyIn`), with no staff step. Teen introductions are on from the start (`teenStopped` is false); the staff roles of `teenStop` and `teenResume` are in [review_desk](review_desk.md) and [opportunity](opportunity.md). Erasure deletes the birth date, and a bar stays on the number. This model's apps are friends, peon and slop: a teen item is a friends.help item here, and an ntwrk `Friend`-lane teen item takes the same path in the code (`teenFriendApp`). A report is a bar here (a stricter abstraction: the code keeps a minor report as a doubt until the teen doubt clear of [safety_trust](safety_trust.md)). `minorIntroTest` shows that a minor reads their own items (four steps after a connection). Changed (owner decision 2026-11-22, answers A1 to A5): a minor may read a current teen friendship item, because the owner allowed teen friendship introductions with no staff confirm step.

The tools `listLookingFor`, `pauseLookingFor` and `resumeLookingFor` ([connector tools](../connectorTools.md), "The agent can list the person's standing things") have the grant owner check of `checkStatus` and serve only an active member; a resume serves only an adult (`lookingForOnlyActive`, `agentResumeOnlyAdult`; `noBannedUse`, `servedOnLiveOwnGrant` and `heldIsHeld` cover the three calls). The network change, its daily limit of three agent changes and the text to the person are in [standing changes](../standingIntentManagement.md). A grant holds the profile read scope only when its request asked for it; the model fixes this by request number (`readsProfile`: grant 2 only). A list needs that scope, and `listed` records that a result showed summaries; `lookingForListNeedsProfileRead` states that only a grant with the profile read scope sees them, from `submit_profile` and the change results too. Changed (owner decision D5 of 2026-11-22, standing changes): the model adds the three tools and the profile read scope, so that it can show that `submit_profile` gives the list only to a grant with that scope.

The tools `myPhotos` and `photoRequest` ([connector tools](../connectorTools.md), "The agent sees the person's photo list") exist only for the Slop app. The model has a Slop host client `cS` and the hub resource for Slop. A grant holds the separate `photos:use` scope only when its request asked for it (`readsPhotos`: grant 3 only), and only an eligible Slop resource offers that scope (spec/authorizationPages.md `scopeOfferedOn`); the guard `gr.app == "slop"` beside `readsPhotos` in `photoCall` and in `photoToolsOnlySlopWithScope` is this rule. A call without the scope is refused before the call (403), so the action is not enabled then. The calls serve only an active adult (`photoToolsOnlySlopWithScope`, `photoToolsOnlyActiveAdult`). The photo list, the proposal text and the offer are in [photo relay](../photoRelayItem.md) and the [photo relay model](photo_relay_item.md): a `photo_request` never consents. Changed (owner decision D4 of 2026-11-22, photo relay): the two photo tools are new, because photo relay between adults is on.

Imported from `quint/oauth_mcp.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// quint-check: max-steps=60 max-samples=10000 verify-steps=5
// quint-witness: witness_heldReadsOnHold heldStatusReachableTest
// quint-witness: witness_prefillShown prefillReachableTest
//
// Model of the MCP OAuth server and its tools: packages/mcp/src/handler.ts, tools.ts,
// pg-store.ts, hooks.ts, and the parts of packages/network/service/service.ts (SVC) and
// packages/notify/src/scheduler.ts that the tools call. Module plan: docs/research/2026-11-07-state-machines.md
// section 6.11. Source report: docs/research/state-machines/mcp-oauth.md. Findings and fix status:
// docs/research/quint-findings/oauth_mcp.md.
//
// This version follows the code after the fixes on branch wave2/oauth_mcp (SD-019, SD-089, SD-184,
// SD-185, SD-186 part (c), SD-214, SD-384, SD-389, SD-390, SD-393, SD-394, SD-395, SD-397, SD-428,
// SD-430, Q-oauth_mcp-1).
//
// Machines in this model: oauth-auth-request, oauth-grant, oauth-code, oauth-token-family,
// cloud-grant-authority (as an oracle), mcp-request-gate, grant-owner-binding, signup-draft,
// output-leak-gate, inbox-read-seen, assistant-surface-signal, submit-profile-intake,
// oauth-client-lifecycle, oauth-forget-revoke, oauth-phone-move, oauth-sweep-retention.
// Not in this model: openai-surface-gate (a boolean config table; the slop.date grants here are on the full surface and already satisfy the private pilot gate), skill-signup
// (agent text, see SD-058 in the findings file).
//
// Abstractions (hand-written):
//  - Each Postgres statement or transaction is one action. Each `await` between two statements is a
//    point where a process can stop (a crash action) or another actor can run.
//  - A grant gets the id of the auth request it came from. The model's approval action combines
//    request consumption and writes. Production commits them together after locking the
//    live approval. The serving flow spells out its authority and deadline checks.
//  - Time: grants, codes and tokens expire by nondeterministic clock actions. Auth requests have an
//    age in 5-minute ticks, because the README gives a minute limit for them (SD-393).
//  - Cloud validation is an oracle: a Cloud grant is valid only while its owner is the consent person
// (packages/platform/src/api.ts). "unavailable" writes no state (INV-CA3), so it is left out. The ban check that
// cloudGrantCurrent now runs first is in the model for every grant.
//  - Bans are per person here (the code also bans by number; the model's bans cover the person's
// numbers at ban time through `banned(phoneKey, personId)`).
//  - Revocation and its audit row are one action on every path. A crash between revokeGrant and its
//    audit row is not modelled.
//  - Leave, delete everything and the under-13 decline are each one action. The real paths are several
//    statements. The OAuth erasure transaction deletes pending requests before committed grants.
//    This ordering serializes deletion with the approval row lock, which the model abstracts.
//  - The leak gate (leaks.ts) is an oracle: each inbox item has a nondeterministic `leaky` flag.
//  - A signup draft has no clock here: its 10-minute expiry (T:288, P:232-233 scrubs it) only removes
//    data, and no invariant needs it.
//  - The platform number change records revocations in its own transaction. This move updates grants,
//    tokens and drafts without running the assistant-link hook. The model retains its existing ban handling.
//  - Hosts and apps (spec/connectorTools.md, "The ntwrk.party host serves every app at its own path"). This item and
//    the host and prefill comments below name the functions of the code on branch vibestack-frontend (compared on
//    2026-11-21, compared again on 2026-11-22 with the working tree after 53a589d4) and give no line numbers:
//    handler.ts requestApp, apps.ts mcpPath and appAtPath. A client is
//    registered on one host (client.app = the host in register and cimdClient; checked in authClient, authorizeStart
//    and validBrowserEntry). The friends, peon and slop sites serve only their own app. The ntwrk.party hub (`HUB`, client
//    cN) serves every app at /mcp/<app>, and the resource of the authorization link names the app (servedResource).
//    The app of the request, and so of its grant (finishAuthorization), comes from that resource, not from the
//    client. A resource that the host does not serve is invalid_target (canonicalResource in authorizeStart). The
//    model omits grants for The Network app itself. APPS holds friends, peon and slop; the hub can ask for each.
//  - Each later page of a request (phone, code, signup, consent) is read by liveRequest: the browser cookie of the
//    host and a resource that this host serves for the request's app. The model gives the host that receives the
//    consent POST as a parameter of approveReadOn; the other pages keep the request id only.
//  - The token endpoint is the host's (token). The code exchange and the refresh copy the resource of the request
//    into the tokens (tokenPair) and check that the host serves the grant's app (grantAppClosed). The model keeps
//    the token actions without a host: the client of a grant reaches only the token endpoint of its own host
//    (authClient).
//  - A tool call arrives on host `h` at the path of app `a`. The access token must be for the resource of that path
//    (the request resource, on the host of the grant's client) and for the app of the path (bearer, grantServesApp).
//    The tool guards take the app of the path as the host of the connection (mcp, connectionOf), so prepare_signup
//    on the hub's /mcp/peon is refused as on the peon site.
//  - The consents page on host `h` (consents) reads one session for each app that `h` serves and lists, for each
//    session, the grants of its phone and app from every client. The model keeps the list view out; consentsRevokeOn
//    is the removal, with the host as a parameter. On the hub, each other app has its own OTP session cookie.
//    Cookie selection stays in the HTTP adapter. The same-app session, browser owner and removal-proof checks still apply.
//  - Signup prefill (spec/authorizationPages.md, "The signup form shows the draft that the person approved in the
//    agent"; handler.ts signupPrefillFor and authorizeSignup with decision "open", store.ts and pg-store.ts
//    useSignupPrefill). The model merges the signup step into the consent step: openSignup reads the request at step
//    consent. The profile:write scope of the grant is left out (every model grant can write). The draft expiry has
//    no clock (see above). The signup form opens only for an app with browser signup (signupClientAllowed calls
//    browserSignupAppAllowed: ntwrk, slop and friends). Of the model APPS, friends and slop have the browser form. Draft preparation is still friends only
//    in this model, because prepare_signup permits friends and ntwrk. The draft discard of /oauth/signup-draft/discard (spec/mcpSignupDraft.md) is not in this model.
//  - The page views (pages.ts pageAppOf: the brand and the legal links of the request's app, absolute when another
//    host renders the page) hold no state and are not in this model.
//
// Comparison record (2026-11-22, working tree of vibestack-frontend after 53a589d4; handler.ts, apps.ts, store.ts,
// pg-store.ts, pages.ts and tools.ts read beside this model; compared again with the working tree after 723bc367,
// which removes comments and adds the birthday field of the signup form). The host, app, consents and prefill items
// above agree with the code. The signup form sends a birthday and the server computes the age from it; the model
// keeps age as a class (minor, under13) and does not model the Join submission. The private eligibility date
// belongs to memberAge.md, "A private signup date can end a birthday-only minor restriction." Neither a
// birthday nor an eligibility date enters the request, grant, or assistant view in this model. Known
// drift that this comparison does not fix:
//  - submitProfile and prepareSignup: the code counts every well-formed profile or draft call of a grant before the
//    status check (mcp: store.hit on profile:grant when args.ok), and spec/connectorTools.md says that a refused call
//    counts too. The model counts only calls that pass the status check, and quotaTest and quotaCountsAccepted keep
//    the earlier SD-395 rule. The code and the spec agree, so the model is stale here.
//  - The H:, T:, P: and K: line numbers in the older comments are for claude/formal-main and do not match this branch.
//  - A held member reading status and a draft shown on a second authorization use named witness traces.
//    They replay existing transitions. The independent random safety check uses the same step and bounds.
//    The step's ownEndpointTools, approveRead, grantItemFamily and draftSignupFamily pick arguments of
//    existing actions and add no transition.
//  - toolInvalidGrant writes a revocation audit row (SD-394, everyRevocationAudited). The code does not: when a tool
//    answer is invalid_grant (mcp) or the grant owner changed (grantAuthorityCurrent), handler.ts calls revokeGrant,
//    and neither revokeGrant nor the store's revokeGrant writes an oauth.audit row. This was so before f50b9c21 too.
//    The model follows the rule; the code is the defect.
//  - The earlier record of endIfBanned (a ban revoked a grant without an audit row) no longer applies: the ban check
//    (cloudGrantCurrent, grantAuthorityCurrent) only refuses the request, as the model does.
module oauth_mcp {

  // ---------------------------------------------------------------- constants
  pure val PERSONS = Set("p1", "p2")
  pure val PHONES = Set("n1", "n2")
  pure val APPS = Set("friends", "peon", "slop")
  /** cF, cP and cS registered on the friends, peon and slop sites; cN registered on the ntwrk.party hub. */
  pure val CLIENTS = Set("cF", "cP", "cS", "cN")
  /** The ntwrk.party host (connectorTools.md hubHost). */
  pure val HUB = "ntwrk"
  pure val HOSTS = APPS.union(Set(HUB))
  /** The host a client registered on (client.app, set in register and cimdClient). */
  pure def clientHost(c: str): str = if (c == "cF") "friends" else if (c == "cP") "peon" else if (c == "cS") "slop" else HUB
  /** connectorTools.md hostBindsApp: an app site serves only its own app; the hub serves every app. */
  pure def hostBindsApp(host: str, app: str): bool = host == app or host == HUB
  /** connectorTools.md grantServesApp: a token serves only the app of its grant. */
  pure def grantServesApp(grantApp: str, pathApp: str): bool = grantApp == pathApp
  pure val REQS = Set(1, 2, 3)
  pure val ITEMS = Set(1, 2)
  pure val NONE = "none"
  /** TTL.requestMs = 10 minutes = 2 ticks (SD-393 fix). */
  pure val REQ_TTL = 2
  /** packages/mcp/README.md section 3: "at most 10 minutes" = 2 ticks. */
  pure val README_REQ_MAX = 2
  /** PROFILES_PER_GRANT_DAY, scaled down from 5 to 2 to keep the state small. */
  pure val PROFILE_CAP = 2
  pure val MAX_TOKENS = 8

  // ---------------------------------------------------------------- types
  type Req = { live: bool, step: str, phone: str, person: str, client: str, app: str, age: int }
  type Grant = { st: str, expired: bool, phone: str, person: str, app: str, client: str, cloud: bool }
  type Code = { st: str, expired: bool }
  type Tok = { g: int, kind: str, origin: str, rotated: bool, revoked: bool, expired: bool }
  type Client = { exists: bool, old: bool }
  type Draft = { exists: bool, phone: str, scrubbed: bool, used: bool }
  type Quota = { count: int, accepted: int }
  // teenOk: a teen item that the rule allowed when it was made and that no sweep has ended (teenItemCurrent).
  type Item = { live: bool, person: str, app: str, kind: str, seen: bool, oppOpen: bool, leaky: bool, teenOk: bool }
  type Effect = { kind: str, person: str, grant: int, ok: bool, status: str, items: Set[int], app: str, listed: bool }
  /** Ghost: one signup prefill, with the bindings that held when the draft was used. */
  type Prefill = { req: int, grant: int, sameClient: bool, sameApp: bool, samePhone: bool, samePerson: bool }

  type OAuth = {
    reqs: int -> Req, grants: int -> Grant, codes: int -> Code, toks: int -> Tok, nextTok: int,
    clients: str -> Client, drafts: int -> Draft, quota: int -> Quota,
  }
  type Platform = {
    owner: str -> str, banned: Set[str], holdNum: Set[str], netHeld: Set[(str, str)], minor: Set[str],
    // under13: a person whose lowest age is under 13 (the join age of every app, apps.ts).
    under13: Set[str], deleted: Set[str],
    member: (str, str) -> str, forgotten: Set[(str, str)],
    // The stored teen stop (the key teenStop is present), the people with an exact birth date, and the barred
    // phones (platform.teen_pool_bars, keyed by phone_hash: a bar stays on the number after erasure).
    teenStopped: bool, birthExact: Set[str], teenBarred: Set[str],
  }
  type Inbox = { items: int -> Item, active: Set[str] }
  type Procs = { appr: int -> str, deny: int -> str, exch: int -> str, refr: int -> str }
  /**
   * `audits` are the rows of oauth.audit (real state: the sweep reads consent_granted rows).
   * The rest is ghost state for the invariants.
   */
  type Ghost = {
    audits: Set[(str, int)], granted: Set[int], denied: Set[int], everGranted: Set[str],
    revokedEver: Set[int], oldKey: Set[str], last: Effect, prefills: Set[Prefill],
  }

  // ---------------------------------------------------------------- state
  var oa: OAuth
  var pf: Platform
  var ib: Inbox
  var pc: Procs
  var gh: Ghost

  pure val NO_EFFECT: Effect = { kind: "none", person: NONE, grant: 0, ok: true, status: "", items: Set(), app: "", listed: false }
  /** The scopes of a grant are fixed by its request: grant 2 holds profile:read beside the default scopes; grants 1 and 3 hold the default scopes only. */
  pure def readsProfile(g: int): bool = g == 2
  /** Grant 3 holds photos:use beside the default scopes when it is a slop.date grant (spec/authorizationPages.md: never a default scope; scopeOfferedOn drops it on the other hosts). */
  pure def readsPhotos(g: int): bool = g == 3
  pure def eff(kind: str, person: str, g: int, ok: bool): Effect =
    { kind: kind, person: person, grant: g, ok: ok, status: "", items: Set(), app: "", listed: false }

  // ---------------------------------------------------------------- helpers (platform reads)
  // The age oracle starts p1 as a known adult and p2 with unknown age. This model takes new lower-age
  // evidence; signup_age_eligibility covers a private birthday-only restriction ending.
  def knownAdult(p: str): bool = p == "p1" and not(pf.minor.contains(p))
  /** personForKey: null when the number is on hold or has no live person. */
  def personForKey(p: Platform, n: str): str = if (p.holdNum.contains(n)) NONE else p.owner.get(n)
  /** login: "held" when banned or on hold. */
  def login(p: Platform, n: str): str =
    if (p.holdNum.contains(n) or p.banned.contains(p.owner.get(n))) "held" else p.owner.get(n)
  /**
   * status -> publicStatus (packages/mcp/src/hooks.ts publicStatus). SD-428 fix (serve.ts): an active
   * member that the app's Network holds reads on_hold.
   */
  def statusOf(p: Platform, person: str, app: str): str =
    if (person == NONE) "not_joined" else {
      val m = p.member.get((person, app))
      if (m == "active") (if (p.netHeld.contains((person, app))) "on_hold" else "active")
      else if (m == "paused") "stopped" else if (m == "restricted") "on_hold"
      else if (m == "invited") "invited" else "not_joined"
    }
  /** spec/connectorTools.md decideGrantOwner, called by packages/mcp/src/tools.ts checkGrantOwner (samePerson). */
  pure def stillTheirs(atConsent: str, now: str): bool = if (atConsent == NONE) now == NONE else now == atConsent
  def liveG(o: OAuth, g: int): bool = o.grants.get(g).st == "live" and not(o.grants.get(g).expired)
  /** banned(phoneKey, personId): the grant's person, else the number's owner now. */
  def banSubject(o: OAuth, p: Platform, g: int): str = {
    val gr = o.grants.get(g)
    if (gr.person != NONE) gr.person else p.owner.get(gr.phone)
  }
  /**
   * cloudGrantCurrent. SD-019 fix: a ban makes every grant invalid (no tool call,
   * no code exchange, no refresh). Legacy grants are then "valid" with no Cloud call; a Cloud grant is
   * an oracle.
   */
  def cloudValid(o: OAuth, p: Platform, g: int): bool = {
    val gr = o.grants.get(g)
    not(p.banned.contains(banSubject(o, p, g)))
      and (not(gr.cloud) or personForKey(p, gr.phone) == gr.person)
  }

  // ---------------------------------------------------------------- helpers (writes)
  /** revokeGrant: grant and its tokens in one transaction. */
  def revokeOa(o: OAuth, g: int): OAuth = {
    ...o,
    grants: o.grants.setBy(g, x => if (x.st == "live") { ...x, st: "revoked" } else x),
    toks: o.toks.keys().mapBy(t => { val k = o.toks.get(t); if (k.g == g) { ...k, revoked: true } else k }),
    drafts: o.drafts.setBy(g, d => { ...d, scrubbed: true }),
  }
  /**
   * revokeGrant then linked(grant, false). SD-186 (c) fix: for each grant in `gs` that this
   * revocation ended (st was live) and that has a person, the signal goes off only when no other live
   * grant of that person (and assistant; every client here is Claude) is left on the grant's phone key
   * (store.grantsFor). `oNew` is the state after every revocation of the step.
   */
  def unlinkAfter(act: Set[str], oOld: OAuth, oNew: OAuth, gs: Set[int]): Set[str] =
    act.exclude(gs.filter(g => {
      val gr = oOld.grants.get(g)
      gr.st == "live" and gr.person != NONE
        and not(REQS.exists(g2 => liveG(oNew, g2) and oNew.grants.get(g2).person == gr.person and oNew.grants.get(g2).phone == gr.phone))
    }).map(g => oOld.grants.get(g).person))
  def revokedEverAfter(h: Ghost, o: OAuth, g: int): Set[int] =
    if (o.grants.get(g).st == "live") h.revokedEver.union(Set(g)) else h.revokedEver
  def phonesOf(p: Platform, person: str): Set[str] = PHONES.filter(n => p.owner.get(n) == person)

  /** Revoke one grant with its audit row (consent revoke, the /oauth/revoke endpoint, a tool's invalid_grant, a replay). */
  action revokeWithAudit(g: int, extra: Set[(str, int)], last: Effect): bool = all {
    val o2 = revokeOa(oa, g)
    all {
      oa' = o2,
      ib' = { ...ib, active: unlinkAfter(ib.active, oa, o2, Set(g)) },
      gh' = { ...gh,
        audits: gh.audits.union(extra).union(if (oa.grants.get(g).st == "live") Set(("revoked", g)) else Set()),
        revokedEver: revokedEverAfter(gh, oa, g), last: last },
    },
  }

  // ---------------------------------------------------------------- init
  action init = all {
    oa' = {
      reqs: REQS.mapBy(r => { live: false, step: "none", phone: "", person: NONE, client: "", app: "", age: 0 }),
      grants: REQS.mapBy(g => { st: "none", expired: false, phone: "", person: NONE, app: "", client: "", cloud: false }),
      codes: REQS.mapBy(g => { st: "none", expired: false }),
      toks: Map(),
      nextTok: 1,
      clients: CLIENTS.mapBy(c => { exists: true, old: false }),
      drafts: REQS.mapBy(g => { exists: false, phone: "", scrubbed: false, used: false }),
      quota: REQS.mapBy(g => { count: 0, accepted: 0 }),
    },
    pf' = {
      owner: Map("n1" -> "p1", "n2" -> NONE),
      banned: Set(), holdNum: Set(), netHeld: Set(), minor: Set(), under13: Set(), deleted: Set(),
      member: tuples(PERSONS, APPS).mapBy(k => if (k._1 == "p1") "active" else "none"),
      forgotten: Set(),
      teenStopped: false, birthExact: Set(), teenBarred: Set(),
    },
    ib' = {
      items: ITEMS.mapBy(i => { live: false, person: NONE, app: "", kind: "", seen: false, oppOpen: false, leaky: false, teenOk: false }),
      active: Set(),
    },
    pc' = { appr: REQS.mapBy(r => "idle"), deny: REQS.mapBy(r => "idle"), exch: REQS.mapBy(g => "idle"), refr: Map() },
    gh' = { audits: Set(), granted: Set(), denied: Set(), everGranted: Set(), revokedEver: Set(), oldKey: Set(), last: NO_EFFECT, prefills: Set() },
  }

  // ---------------------------------------------------------------- oauth-auth-request
  /**
   * GET /oauth/authorize on the client's host for app `a` (the app that the resource names: authorizeStart and requestApp).
   * One row, step phone, bound to the app. An unknown (swept) client gets an error page. A resource of an app that
   * the host does not serve fails with invalid_target (canonicalResource) and stores nothing.
   */
  action startAuth(r: int, c: str, a: str): bool = all {
    not(oa.reqs.get(r).live), oa.reqs.get(r).step == "none", pc.appr.get(r) == "idle",
    if (oa.clients.get(c).exists and hostBindsApp(clientHost(c), a)) all {
      oa' = { ...oa, reqs: oa.reqs.set(r, { live: true, step: "phone", phone: "", person: NONE, client: c, app: a, age: 0 }) },
      gh' = { ...gh, last: { ...eff("authorize", NONE, r, true), app: a } },
    } else if (oa.clients.get(c).exists) all {
      oa' = oa,
      gh' = { ...gh, last: { ...eff("invalidTarget", NONE, r, false), app: a } },
    } else all {
      oa' = oa,
      gh' = { ...gh, last: eff("clientUnknown", NONE, r, false) },
    },
    pf' = pf, ib' = ib, pc' = pc,
  }

  /** POST /authorize/phone: startOtp, then updateAuthRequest(e164, step code). */
  action enterPhone(r: int, n: str): bool = all {
    val q = oa.reqs.get(r)
    all {
      q.live, q.age < REQ_TTL, oa.clients.get(q.client).exists, q.step == "phone" or q.step == "code",
      oa' = { ...oa, reqs: oa.reqs.set(r, { ...q, phone: n, step: "code" }) },
      pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("phone", NONE, r, true) },
    }
  }

  /** POST /authorize/code: verifyOtp (oracle: the person types the right code), login, step consent. */
  action enterCode(r: int): bool = all {
    val q = oa.reqs.get(r)
    val who = login(pf, q.phone)
    all {
      q.live, q.age < REQ_TTL, oa.clients.get(q.client).exists, q.step == "code",
      if (who == "held") all {
        // Held or banned: the request is deleted.
        oa' = { ...oa, reqs: oa.reqs.set(r, { ...q, live: false }) },
        pf' = pf,
      } else all {
        oa' = { ...oa, reqs: oa.reqs.set(r, { ...q, person: who, step: "consent" }) },
        // Model bookkeeping: a person who connects again after a forget starts a new consent.
        pf' = { ...pf, forgotten: pf.forgotten.exclude(Set((q.phone, q.app))) },
      },
      ib' = ib, pc' = pc, gh' = { ...gh, last: eff("code", who, r, who != "held") },
    }
  }

  /**
   * H:513-537 approve, up to the transaction: liveRequest, session and owner checks, the Cloud oracle.
   * The grant object is prepared in memory (no row yet; st stays "none"). The consent POST arrives on host `h`.
   * liveRequest reads the request only on the host of its client and its resource: the browser cookie
   * is the host's, and the request's resource must be one that `h` serves for the request's app. On another host
   * the page reads "This page has expired" and nothing changes.
   */
  action approveRead(r: int, cloud: bool): bool = approveReadOn(r, clientHost(oa.reqs.get(r).client), cloud)
  action approveReadOn(r: int, h: str, cloud: bool): bool = all {
    val q = oa.reqs.get(r)
    all {
      q.live, q.age < REQ_TTL, oa.clients.get(q.client).exists, q.step == "consent", pc.appr.get(r) == "idle",
      if (h != clientHost(q.client) or not(hostBindsApp(h, q.app))) all {
        oa' = oa, pc' = pc, gh' = { ...gh, last: { ...eff("pageOtherHost", NONE, r, false), status: h, app: q.app } },
      } else if (login(pf, q.phone) == "held" or login(pf, q.phone) != q.person) all {
        // H:518-527: the number is held or banned, or its person changed: the request is deleted
        // ("Connect again").
        oa' = { ...oa, reqs: oa.reqs.set(r, { ...q, live: false }) },
        pc' = pc, gh' = { ...gh, last: eff("approveOwnerChanged", NONE, r, false) },
      } else all {
        // Cloud authority needs a current owner; legacy grants need nothing more.
        not(cloud) or q.person != NONE,
        oa' = { ...oa,
          grants: oa.grants.setBy(r, x => { ...x, phone: q.phone, person: q.person, app: q.app, client: q.client, cloud: cloud }) },
        pc' = { ...pc, appr: pc.appr.set(r, "read") },
        gh' = { ...gh, last: { ...eff("approveRead", q.person, r, true), status: h, app: q.app } },
      },
      pf' = pf, ib' = ib,
    }
  }
  /**
   * SD-389 fix, approveConsent: one transaction deletes the request (only a live request at
   * step consent), and inserts the grant, its code and the consent_granted and code_issued rows. A
   * failed insert (`insertFails`, or the client row is gone: oauth.sql grants.client_id foreign key)
   * rolls everything back and the request stays for a retry. A request that is gone (taken by a
   * denial, deleted by a forget, expired) gives "This page has expired" and stores nothing.
   */
  action approveCommit(r: int, insertFails: bool): bool = all {
    pc.appr.get(r) == "read",
    val q = oa.reqs.get(r)
    val gr = oa.grants.get(r)
    if (not(q.live and q.step == "consent" and q.age < REQ_TTL)) all {
      oa' = oa, pc' = { ...pc, appr: pc.appr.set(r, "failed") }, gh' = { ...gh, last: eff("approveExpired", NONE, r, false) },
    } else if (insertFails or not(oa.clients.get(gr.client).exists)) all {
      oa' = oa, pc' = { ...pc, appr: pc.appr.set(r, "idle") }, gh' = { ...gh, last: eff("approveRolledBack", NONE, r, false) },
    } else all {
      oa' = { ...oa,
        reqs: oa.reqs.set(r, { ...q, live: false }),
        grants: oa.grants.setBy(r, x => { ...x, st: "live" }),
        codes: oa.codes.set(r, { st: "issued", expired: false }) },
      pc' = { ...pc, appr: pc.appr.set(r, "committed") },
      gh' = { ...gh, granted: gh.granted.union(Set(r)), everGranted: gh.everGranted.union(Set(gr.client)),
              // Ghost for Q-oauth_mcp-2: the grant is stored on a number its person no longer owns.
              oldKey: if (gr.person != NONE and pf.owner.get(gr.phone) != gr.person) gh.oldKey.union(Set(gr.person)) else gh.oldKey,
              audits: gh.audits.union(Set(("consent_granted", r), ("code_issued", r))),
              last: eff("approveCommit", gr.person, r, true) },
    },
    pf' = pf, ib' = ib,
  }
  /** linked(grant, true) after the commit: active=true, only for a grant with a person; then the 303 with the code. */
  action approveLink(r: int): bool = all {
    pc.appr.get(r) == "committed",
    val p = oa.grants.get(r).person
    ib' = { ...ib, active: if (p != NONE) ib.active.union(Set(p)) else ib.active },
    pc' = { ...pc, appr: pc.appr.set(r, "done") },
    oa' = oa, pf' = pf, gh' = { ...gh, last: eff("approved", oa.grants.get(r).person, r, true) },
  }

  /** liveRequest read of a cancel or a non-approve consent POST. */
  action denyRead(r: int): bool = all {
    oa.reqs.get(r).live, oa.reqs.get(r).age < REQ_TTL, oa.clients.get(oa.reqs.get(r).client).exists, pc.deny.get(r) == "idle",
    pc' = { ...pc, deny: pc.deny.set(r, "read") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("denyRead", NONE, r, true) },
  }
  /**
   * SD-397 fix, denyFinish: the delete reports whether it deleted the row. Only then the denial is
   * audited and the client gets access_denied; else (an approval took the request) "This page has expired".
   */
  action denyFinish(r: int): bool = all {
    pc.deny.get(r) == "read",
    pc' = { ...pc, deny: pc.deny.set(r, "done") },
    if (oa.reqs.get(r).live) all {
      oa' = { ...oa, reqs: oa.reqs.setBy(r, q => { ...q, live: false }) },
      gh' = { ...gh, audits: gh.audits.union(Set(("consent_denied", r))), denied: gh.denied.union(Set(r)), last: eff("denied", NONE, r, true) },
    } else all {
      oa' = oa, gh' = { ...gh, last: eff("denyExpired", NONE, r, false) },
    },
    pf' = pf, ib' = ib,
  }

  /**
   * The clock: each live request gets one tick older (5 minutes). SD-393 fix: the service's tick runs
   * the OAuth sweep at most once a minute with no OAuth traffic (serve.ts), so a
   * request is deleted when it reaches its 10-minute TTL.
   */
  action tickRequests = all {
    oa.reqs.keys().exists(r => oa.reqs.get(r).live),
    oa' = { ...oa, reqs: oa.reqs.keys().mapBy(r => {
      val q = oa.reqs.get(r)
      if (q.live) { ...q, age: q.age + 1, live: q.age + 1 < REQ_TTL } else q
    }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("tick", NONE, 0, true) },
  }

  // ---------------------------------------------------------------- oauth-code: exchange
  /** The token route checks: code unused, unexpired, grant live, ban and Cloud check (cloudGrantCurrent). */
  action exchCheck(g: int): bool = all {
    oa.codes.get(g).st == "issued", not(oa.codes.get(g).expired), liveG(oa, g), cloudValid(oa, pf, g),
    pc.exch.get(g) == "idle",
    pc' = { ...pc, exch: pc.exch.set(g, "checked") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("exchCheck", banSubject(oa, pf, g), g, true) },
  }
  /**
   * SD-184 fix, redeemCode: one transaction marks the code used and, on its
   * first use, stores both tokens and the token_issued row. The mint callback checks expiry only: when
   * the code or the grant expired meanwhile, the code is used and nothing is stored (invalid_grant).
   * A grant row deleted meanwhile fails the token insert (foreign key): the code stays unused.
   */
  action exchRedeem(g: int): bool = all {
    pc.exch.get(g) == "checked", oa.codes.get(g).st == "issued",
    val gr = oa.grants.get(g)
    val refreshTok = oa.nextTok + 1
    if (gr.st == "deleted") all {
      oa' = oa, pc' = { ...pc, exch: pc.exch.set(g, "idle") }, gh' = { ...gh, last: eff("exchRolledBack", NONE, g, false) },
    } else if (oa.codes.get(g).expired or gr.expired) all {
      oa' = { ...oa, codes: oa.codes.setBy(g, c => { ...c, st: "used" }) },
      pc' = { ...pc, exch: pc.exch.set(g, "idle") },
      gh' = { ...gh, last: eff("exchExpired", NONE, g, false) },
    } else all {
      refreshTok <= MAX_TOKENS,
      oa' = { ...oa,
        codes: oa.codes.setBy(g, c => { ...c, st: "used" }),
        toks: oa.toks
          .put(oa.nextTok, { g: g, kind: "access", origin: "code", rotated: false, revoked: false, expired: false })
          .put(refreshTok, { g: g, kind: "refresh", origin: "code", rotated: false, revoked: false, expired: false }),
        nextTok: oa.nextTok + 2 },
      pc' = { ...pc, exch: pc.exch.set(g, "done"), refr: pc.refr.put(refreshTok, "idle") },
      gh' = { ...gh, audits: gh.audits.union(Set(("token_issued", g))), last: eff("tokens", gr.person, g, true) },
    },
    pf' = pf, ib' = ib,
  }
  /**
   * The token route: a client presents a used code. The grant is revoked as a replay. codeVerdict
   * (spec/oauthTokenLifecycle.md readCode, called by the token route in packages/mcp/src/handler.ts) reads "used" before "expired": a used code is a replay until the sweep deletes
   * its row, also after it expired.
   * Model ghost: the replay is "true" when an earlier exchange of this code completed; "dead" when the
   * grant was not usable before (revoked, expired, or its one code used with no token issued: the
   * exchange that used it expired, exchRedeem), so the replay ends nothing.
   */
  action exchReplay(g: int): bool = all {
    oa.codes.get(g).st == "used",
    val trueReplay = pc.exch.get(g) == "done"
    val dead = not(liveG(oa, g)) or not(oa.toks.keys().exists(t => oa.toks.get(t).g == g))
    revokeWithAudit(g, Set(("code_replay", g)),
      { kind: "replay", person: NONE, grant: g, ok: trueReplay or dead,
        status: if (trueReplay) "true" else if (dead) "dead" else "false", items: Set(), app: "", listed: false }),
    pf' = pf, pc' = pc,
  }

  // ---------------------------------------------------------------- oauth-token-family: refresh
  /**
   * The refresh route checks: token unrevoked, unexpired, grant live, ban and Cloud check. The handler keeps the token
   * row it read: "checkedRot" when it was already rotated then (a replay with no rotateRefresh call).
   */
  action refrCheck(t: int): bool = all {
    oa.toks.keys().contains(t),
    val k = oa.toks.get(t)
    all {
      k.kind == "refresh", not(k.revoked), not(k.expired), liveG(oa, k.g), cloudValid(oa, pf, k.g),
      pc.refr.keys().contains(t), pc.refr.get(t) == "idle",
      pc' = { ...pc, refr: pc.refr.set(t, if (k.rotated) "checkedRot" else "checked") },
    },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("refrCheck", banSubject(oa, pf, oa.toks.get(t).g), oa.toks.get(t).g, true) },
  }
  /**
   * SD-185 fix, and rotateRefresh: one transaction that locks the grant. "stale"
   * when the grant is revoked, expired or gone (invalid_grant; no revocation, no audit row); "replay"
   * when the token was rotated or revoked (the grant is revoked, with a refresh_replay row); else it
   * rotates.
   */
  action refrRotate(t: int): bool = all {
    pc.refr.keys().contains(t), oa.toks.keys().contains(t), Set("checked", "checkedRot").contains(pc.refr.get(t)),
    val k = oa.toks.get(t)
    val g = k.g
    val gr = oa.grants.get(g)
    val idle = { ...pc, refr: pc.refr.set(t, "idle") }
    val replay = { kind: "replay", person: NONE, grant: g, ok: true, status: "true", items: Set(), app: "", listed: false }
    if (pc.refr.get(t) == "checkedRot") all {
      pc' = idle, revokeWithAudit(g, Set(("refresh_replay", g)), replay),
    } else if (gr.st != "live" or gr.expired) all {
      oa' = oa, pc' = idle, ib' = ib, gh' = { ...gh, last: eff("refreshStale", NONE, g, false) },
    } else if (k.rotated or k.revoked) all {
      pc' = idle,
      revokeWithAudit(g, Set(("refresh_replay", g)), { ...replay, ok: k.rotated, status: if (k.rotated) "true" else "false" }),
    } else if (oa.nextTok + 1 <= MAX_TOKENS) all {
      oa' = { ...oa,
        toks: oa.toks.set(t, { ...k, rotated: true })
          .put(oa.nextTok, { g: g, kind: "access", origin: "refresh", rotated: false, revoked: false, expired: false })
          .put(oa.nextTok + 1, { g: g, kind: "refresh", origin: "refresh", rotated: false, revoked: false, expired: false }),
        nextTok: oa.nextTok + 2 },
      pc' = { ...pc, refr: pc.refr.set(t, "idle").put(oa.nextTok + 1, "idle") },
      ib' = ib,
      gh' = { ...gh, audits: gh.audits.union(Set(("token_refreshed", g))), last: eff("refresh", gr.person, g, true) },
    } else all {
      oa' = oa, pc' = idle, ib' = ib, gh' = gh,
    },
    pf' = pf,
  }

  // ---------------------------------------------------------------- revocation by the client and the person
  /** /oauth/revoke with a refresh token: the grant ends, with an audit row. */
  action revokeEndpoint(t: int): bool = all {
    oa.toks.keys().contains(t), oa.toks.get(t).kind == "refresh",
    revokeWithAudit(oa.toks.get(t).g, Set(), eff("revoke", NONE, oa.toks.get(t).g, true)),
    pf' = pf, pc' = pc,
  }
  /** /oauth/revoke with an access token: that token only ends, with a token_revoked row. */
  action revokeAccessToken(t: int): bool = all {
    oa.toks.keys().contains(t), oa.toks.get(t).kind == "access", not(oa.toks.get(t).revoked),
    oa' = { ...oa, toks: oa.toks.setBy(t, k => { ...k, revoked: true }) },
    gh' = { ...gh, audits: gh.audits.union(Set(("token_revoked", oa.toks.get(t).g))), last: eff("revokeAccess", NONE, oa.toks.get(t).g, true) },
    pf' = pf, ib' = ib, pc' = pc,
  }
  /**
   * /oauth/consents/revoke by the person on host `h` (consents). The page reads one session for each app
   * that `h` serves, and a removal uses the session of the grant's own app, so `h` must serve that app. grantsFor
   * lists the grants of the phone and app from every client, so the hub also removes a grant made on an app site.
   * Audit only when revokeGrant returned true.
   */
  action consentsRevokeOn(g: int, h: str): bool = all {
    oa.grants.get(g).st == "live", hostBindsApp(h, oa.grants.get(g).app),
    revokeWithAudit(g, Set(), { ...eff("revoke", NONE, g, true), status: h, app: oa.grants.get(g).app }),
    pf' = pf, pc' = pc,
  }
  /** The removal on the grant's own app site. */
  action consentsRevoke(g: int): bool = consentsRevokeOn(g, oa.grants.get(g).app)

  // ---------------------------------------------------------------- mcp-request-gate and the tools
  /**
   * bearer on host `h` at the endpoint of app `a`: access token unrevoked, unexpired, minted for this
   * resource and for the app of the path (grantServesApp), grant live, ban and Cloud check (cloudGrantCurrent). The
   * token's resource is the resource of the grant's request, on the host of its client (startAuth). So a token of the
   * hub's /mcp/peon fails on the hub's /mcp/friends, and a hub token for friends fails on the friends site's /mcp.
   */
  def bearerOk(t: int, h: str, a: str): bool =
    oa.toks.keys().contains(t) and {
      val k = oa.toks.get(t)
      val gr = oa.grants.get(k.g)
      k.kind == "access" and not(k.revoked) and not(k.expired) and liveG(oa, k.g) and cloudValid(oa, pf, k.g)
        and h == clientHost(gr.client) and hostBindsApp(h, a) and grantServesApp(gr.app, a)
    }

  /** SD-394 fix, the tool gate: invalid_grant from a tool revokes the grant and writes consent_revoked when the revoke ended it. */
  action toolInvalidGrant(g: int, tool: str): bool = all {
    revokeWithAudit(g, Set(), { ...eff(tool, NONE, g, false), app: oa.grants.get(g).app }),
    pf' = pf, pc' = pc,
  }

  /**
   * T get_updates, SVC updatesFor and inboxUpdateOutcomes, and notify scheduler readUpdates. Each
   * selected item gets connectorUpdateOutcome (spec/connectorTools.md): an item whose opportunity
   * closed (SD-430), or an item about another member ("intro", "probe") when the reader cannot be
   * matched (MCP54: a minor, or unknown age), is retired: not shown, marked seen. An item that fails the
   * leak gate is withheld: not shown and NOT marked seen (MCP55). The rest are shown and marked seen.
   * An "own" item (a reminder for the reader alone) stays readable at every age.
   */
  action getUpdates(t: int, h: str, a: str): bool = all {
    bearerOk(t, h, a),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val now = personForKey(pf, gr.phone)
    if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, "getUpdates")
    else {
      val mine = ITEMS.filter(i => ib.items.get(i).live and not(ib.items.get(i).seen) and ib.items.get(i).person == now and ib.items.get(i).app == gr.app and now != NONE)
      val retired = mine.filter(i => not(ib.items.get(i).oppOpen) or (ib.items.get(i).kind != "own" and not(readerAgeAllowed(i))))
      val withheld = mine.filter(i => not(retired.contains(i)) and ib.items.get(i).leaky)
      val shown = mine.filter(i => not(retired.contains(i)) and not(ib.items.get(i).leaky))
      all {
        ib' = { ...ib, items: ib.items.keys().mapBy(i => if (mine.contains(i) and not(withheld.contains(i))) { ...ib.items.get(i), seen: true } else ib.items.get(i)) },
        gh' = { ...gh, last: { kind: "getUpdates", person: now, grant: g, ok: true, status: "", items: shown, app: gr.app, listed: false } },
        oa' = oa, pf' = pf, pc' = pc,
      }
    }
  }

  /** T:293-301 check_status (rate limit left out). */
  action checkStatus(t: int, h: str, a: str): bool = all {
    bearerOk(t, h, a),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val now = personForKey(pf, gr.phone)
    if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, "status")
    else all {
      gh' = { ...gh, last: { kind: "status", person: now, grant: g, ok: true, status: statusOf(pf, now, gr.app), items: Set(), app: gr.app, listed: false } },
      oa' = oa, pf' = pf, ib' = ib, pc' = pc,
    }
  }

  /**
   * submit_profile: grantStillTheirs, the status gate (active; the model has no onboarding
   * state), then (SD-395 fix) the per-grant profile bucket counts the call, then the
   * service's own ban check (SVC submitProfile).
   */
  action submitProfile(t: int, h: str, a: str): bool = all {
    bearerOk(t, h, a),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val q = oa.quota.get(g)
    val now = personForKey(pf, gr.phone)
    val st = statusOf(pf, now, gr.app)
    val count = if (q.count <= PROFILE_CAP) q.count + 1 else q.count
    val oaQ = { ...oa, quota: oa.quota.set(g, { ...q, count: count }) }
    if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, "profile")
    else if (now == NONE or st != "active") all {
      oa' = oa, gh' = { ...gh, last: { kind: "profile", person: now, grant: g, ok: false, status: st, items: Set(), app: gr.app, listed: false } },
      pf' = pf, ib' = ib, pc' = pc,
    } else if (count > PROFILE_CAP) all {
      oa' = oaQ, gh' = { ...gh, last: { kind: "quotaRefused", person: now, grant: g, ok: false, status: st, items: Set(), app: gr.app, listed: false } },
      pf' = pf, ib' = ib, pc' = pc,
    } else {
      val accepted = not(pf.banned.contains(now))
      all {
        oa' = if (accepted) { ...oaQ, quota: oaQ.quota.set(g, { count: count, accepted: q.accepted + 1 }) } else oaQ,
        gh' = { ...gh, last: { kind: "profile", person: now, grant: g, ok: accepted, status: st, items: Set(), app: gr.app, listed: accepted and readsProfile(g) } },
        pf' = pf, ib' = ib, pc' = pc,
      }
    }
  }

  /**
   * T:275-292 and P:47-60 prepare_signup (friends and ntwrk; friends here): the age policy first
   * (withSignupAgePolicy, K:126-135: canJoinApp, 13 on every app, so only an under-13 person is
   * refused; a 13-17 person may prepare a Join form), then grantStillTheirs (invalid_grant revokes the
   * grant, H:895-899), the status, then (SD-395 fix) the quota, then one draft row per grant, with the
   * grant's phone key.
   */
  action prepareSignup(t: int, h: str, a: str): bool = all {
    bearerOk(t, h, a),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val q = oa.quota.get(g)
    val count = if (q.count <= PROFILE_CAP) q.count + 1 else q.count
    val now = personForKey(pf, gr.phone)
    val st = statusOf(pf, now, gr.app)
    all {
      gr.app == "friends", not(pf.under13.contains(now)),
      if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, "prepare")
      else all {
        count <= PROFILE_CAP, st == "not_joined" or st == "invited",
        oa' = { ...oa, quota: oa.quota.set(g, { ...q, count: count }),
                drafts: if (oa.drafts.get(g).exists) oa.drafts else oa.drafts.set(g, { exists: true, phone: gr.phone, scrubbed: false, used: false }) },
        gh' = { ...gh, last: { ...eff("prepare", now, g, not(oa.drafts.get(g).exists)), app: gr.app } },
        pf' = pf, ib' = ib, pc' = pc,
      },
    }
  }

  /**
   * T list_looking_for, pause_looking_for and resume_looking_for (spec/connectorTools.md, "The agent can list the
   * person's standing things"): checkGrantOwner, then the status gate (active only, toolAllowedFor), then SVC
   * lookingFor or changeLookingFor, which recheck the phone, the person, the ban and the review (activeMembership).
   * A resume needs an adult (SVC changeLookingFor passes canBeMatched to agentStandingChange). The network state that a
   * pause or a resume changes, its daily limit and its text to the person are outside this model
   * (spec/standingIntentManagement.md standingChangeOutcome); the effect records whether the call served the person.
   * The handler refuses a list without the profile read scope before the call (403), so the action is not enabled then.
   * T callTool (resultShowsLookingFor): `listed` records that the result showed summaries, only with the profile read scope.
   */
  action lookingForCall(t: int, h: str, a: str, kind: str): bool = all {
    bearerOk(t, h, a),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val now = personForKey(pf, gr.phone)
    val st = statusOf(pf, now, gr.app)
    val served = now != NONE and st == "active" and not(pf.banned.contains(now)) and (kind != "resumeLookingFor" or knownAdult(now))
    // The 403 before the call is a guard (a conjunct), not a `false` branch: every branch of an `if` must update the same variables.
    all {
      kind != "listLookingFor" or readsProfile(g),
      if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, kind)
      else all {
        gh' = { ...gh, last: { kind: kind, person: now, grant: g, status: st, items: Set(), ok: served, app: gr.app, listed: served and readsProfile(g) } },
        oa' = oa, pf' = pf, ib' = ib, pc' = pc,
      },
    }
  }
  action listLookingFor(t: int, h: str, a: str): bool = lookingForCall(t, h, a, "listLookingFor")
  action pauseLookingFor(t: int, h: str, a: str): bool = lookingForCall(t, h, a, "pauseLookingFor")
  action resumeLookingFor(t: int, h: str, a: str): bool = lookingForCall(t, h, a, "resumeLookingFor")

  /**
   * T my_photos and photo_request (spec/connectorTools.md, "The agent sees the person's photo list"): toolListed lists
   * them only for an eligible Slop resource. The handler refuses a call without photos:use before calling the tool.
   * The tool checks the grant owner, the status gate (active only, toolAllowedFor) and the age gate (minorMember is
   * false only for a known adult), then SVC photoHoldings or photoRequest. The list, the proposal text and the offer are
   * outside this model; the effect records whether the call served the person.
   */
  action photoCall(t: int, h: str, a: str, kind: str): bool = all {
    bearerOk(t, h, a),
    val g = oa.toks.get(t).g
    val gr = oa.grants.get(g)
    val now = personForKey(pf, gr.phone)
    val st = statusOf(pf, now, gr.app)
    val served = now != NONE and st == "active" and not(pf.banned.contains(now)) and knownAdult(now)
    // The host and scope 403 before the call is a guard (a conjunct), as in lookingForCall.
    all {
      gr.app == "slop" and readsPhotos(g),
      if (not(stillTheirs(gr.person, now))) toolInvalidGrant(g, kind)
      else all {
        gh' = { ...gh, last: { kind: kind, person: now, grant: g, status: st, items: Set(), ok: served, app: gr.app, listed: false } },
        oa' = oa, pf' = pf, ib' = ib, pc' = pc,
      },
    }
  }
  action myPhotos(t: int, h: str, a: str): bool = photoCall(t, h, a, "myPhotos")
  action photoRequest(t: int, h: str, a: str): bool = photoCall(t, h, a, "photoRequest")

  /**
   * signupPrefillFor and the store's useSignupPrefill: the signup form of request `r` (a person who
   * has not joined the request's app) shows the one live draft of the same client, app, phone key and person, under
   * the age policy (withSignupAgePolicy: an under-13 person gets no prefill). The draft is used once: its fields are
   * scrubbed and consumed_at is set in the same transaction. No draft, two drafts or a refusal give an empty form.
   */
  action openSignup(r: int): bool = all {
    val q = oa.reqs.get(r)
    val st = statusOf(pf, q.person, q.app)
    val usable = REQS.filter(g => {
      val d = oa.drafts.get(g)
      val gr = oa.grants.get(g)
      d.exists and not(d.scrubbed) and not(d.used) and liveG(oa, g)
        and gr.person == q.person and gr.client == q.client and gr.app == q.app and d.phone == q.phone
    })
    all {
      q.live, q.age < REQ_TTL, oa.clients.get(q.client).exists, q.step == "consent", Set("friends", "slop").contains(q.app),
      st == "not_joined" or st == "invited",
      if (usable.size() == 1 and not(pf.under13.contains(q.person))) {
        nondet g = usable.oneOf()
        val gr = oa.grants.get(g)
        all {
          oa' = { ...oa, drafts: oa.drafts.setBy(g, d => { ...d, used: true, scrubbed: true }) },
          gh' = { ...gh,
            prefills: gh.prefills.union(Set({ req: r, grant: g, sameClient: gr.client == q.client, sameApp: gr.app == q.app,
              samePhone: oa.drafts.get(g).phone == q.phone, samePerson: gr.person == q.person })),
            last: { ...eff("prefill", q.person, g, true), app: q.app } },
        }
      } else all {
        oa' = oa, gh' = { ...gh, last: { ...eff("prefill", q.person, r, false), app: q.app } },
      },
      pf' = pf, ib' = ib, pc' = pc,
    }
  }

  // ---------------------------------------------------------------- crashes (a process stops between two statements)
  /** Before the approval's transaction nothing is written; after it, linked(true) may not run (SD-186 part (a), kept by contract). */
  action crashApprove(r: int): bool = all {
    Set("read", "committed").contains(pc.appr.get(r)),
    pc' = { ...pc, appr: pc.appr.set(r, if (pc.appr.get(r) == "read") "idle" else "crashed") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("crash", NONE, r, true) },
  }
  /** The exchange has one transaction now: a stop after the checks writes nothing. */
  action crashExchange(g: int): bool = all {
    pc.exch.get(g) == "checked",
    pc' = { ...pc, exch: pc.exch.set(g, "idle") },
    oa' = oa, pf' = pf, ib' = ib, gh' = { ...gh, last: eff("crash", NONE, g, true) },
  }

  // ---------------------------------------------------------------- clocks
  action expireGrant(g: int): bool = all {
    oa.grants.get(g).st == "live" or oa.grants.get(g).st == "revoked", not(oa.grants.get(g).expired),
    // tokens never outlive their grant.
    oa' = { ...oa, grants: oa.grants.setBy(g, x => { ...x, expired: true }),
            toks: oa.toks.keys().mapBy(t => { val k = oa.toks.get(t); if (k.g == g) { ...k, expired: true } else k }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("expireGrant", NONE, g, true) },
  }
  action expireCode(g: int): bool = all {
    oa.codes.get(g).st == "issued" or oa.codes.get(g).st == "used", not(oa.codes.get(g).expired),
    oa' = { ...oa, codes: oa.codes.setBy(g, c => { ...c, expired: true }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("expireCode", NONE, g, true) },
  }
  action expireToken(t: int): bool = all {
    oa.toks.keys().contains(t), not(oa.toks.get(t).expired),
    oa' = { ...oa, toks: oa.toks.setBy(t, k => { ...k, expired: true }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("expireToken", NONE, oa.toks.get(t).g, true) },
  }
  /** A day passes for a registered client (CLIENT_UNUSED_MS). */
  action clientAges(c: str): bool = all {
    oa.clients.get(c).exists, not(oa.clients.get(c).old),
    oa' = { ...oa, clients: oa.clients.setBy(c, x => { ...x, old: true }) },
    pf' = pf, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("clientAges", NONE, 0, true) },
  }

  /**
   * sweep (on every OAuth request and every service tick, at most once a minute; modelled as
   * any time). Expired codes and tokens go; revoked or expired grants go (after 30 days, abstracted)
   * with their codes, tokens and drafts. SD-390 fix: a day-old client goes only when no
   * grant row is left and it never got a consent_granted audit row.
   */
  /** The client has a consent_granted audit row (audit rows are never swept). */
  def everConsented(c: str): bool = REQS.exists(g => gh.audits.contains(("consent_granted", g)) and oa.grants.get(g).client == c)
  action sweep = all {
    val work = REQS.exists(g => oa.grants.get(g).st == "revoked" or oa.grants.get(g).expired or oa.codes.get(g).expired)
      or oa.toks.keys().exists(t => oa.toks.get(t).expired) or CLIENTS.exists(c => oa.clients.get(c).exists and oa.clients.get(c).old)
    work,
    val deadG = REQS.filter(g => oa.grants.get(g).st == "revoked" or (oa.grants.get(g).st == "live" and oa.grants.get(g).expired))
    val grants2 = oa.grants.keys().mapBy(g => if (deadG.contains(g)) { ...oa.grants.get(g), st: "deleted" } else oa.grants.get(g))
    val rowG = REQS.filter(g => grants2.get(g).st == "live" or grants2.get(g).st == "revoked")
    all {
      oa' = { ...oa,
        codes: oa.codes.keys().mapBy(g => { val c = oa.codes.get(g); if (c.expired or deadG.contains(g)) { ...c, st: if (c.st == "none") "none" else "deleted" } else c }),
        toks: oa.toks.keys().filter(t => not(oa.toks.get(t).expired) and not(deadG.contains(oa.toks.get(t).g))).mapBy(t => oa.toks.get(t)),
        drafts: oa.drafts.keys().mapBy(g => if (deadG.contains(g)) { ...oa.drafts.get(g), exists: false } else oa.drafts.get(g)),
        grants: grants2,
        clients: oa.clients.keys().mapBy(c => { val x = oa.clients.get(c); if (x.exists and x.old and not(rowG.exists(g => grants2.get(g).client == c)) and not(everConsented(c))) { ...x, exists: false } else x }),
      },
      pc' = { ...pc, refr: pc.refr.keys().filter(t => oa.toks.keys().contains(t) and not(oa.toks.get(t).expired) and not(deadG.contains(oa.toks.get(t).g))).mapBy(t => pc.refr.get(t)) },
      pf' = pf, ib' = ib, gh' = { ...gh, last: eff("sweep", NONE, 0, true) },
    }
  }

  // ---------------------------------------------------------------- platform and network actors
  /** SVC ban: ban rows, suppression, memberships restricted. No grant, token or request write: the OAuth checks read the ban. */
  action ban(p: str): bool = all {
    not(pf.banned.contains(p)), phonesOf(pf, p).size() > 0,
    pf' = { ...pf, banned: pf.banned.union(Set(p)),
            member: pf.member.keys().mapBy(k => if (k._1 == p and pf.member.get(k) != "none" and pf.member.get(k) != "removed" and pf.member.get(k) != "invited") "restricted" else pf.member.get(k)) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("ban", p, 0, true) },
  }
  /** SVC hold: the network holds the member (trust). platform.memberships is not written. */
  action staffHold(p: str): bool = all {
    APPS.exists(a => pf.member.get((p, a)) == "active" and not(pf.netHeld.contains((p, a)))),
    pf' = { ...pf, netHeld: pf.netHeld.union(APPS.filter(a => pf.member.get((p, a)) == "active").map(a => (p, a))) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("hold", p, 0, true) },
  }
  /** A number not seen for a year goes on hold for staff (accounts.ts seen): personForKey is null. */
  action holdNumber(n: str): bool = all {
    pf.owner.get(n) != NONE, not(pf.holdNum.contains(n)),
    pf' = { ...pf, holdNum: pf.holdNum.union(Set(n)) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("holdNumber", NONE, 0, true) },
  }
  /** Staff decide the held number has the same owner. */
  action clearHoldSame(n: str): bool = all {
    pf.holdNum.contains(n),
    pf' = { ...pf, holdNum: pf.holdNum.exclude(Set(n)) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("clearHold", NONE, 0, true) },
  }
  /** A person states an age under 18 (onAgeLowered): the person is a minor on every app. */
  action becomeMinor(p: str): bool = all {
    not(pf.minor.contains(p)), phonesOf(pf, p).size() > 0,
    pf' = { ...pf, minor: pf.minor.union(Set(p)) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("minor", p, 0, true) },
  }
  /**
   * Owner decision 2026-11-22, answers A2 to A5. spec/friendIntroAge.md teenReady, derived: a minor with an exact
   * birth date and no barred phone is teen ready, with no staff step.
   */
  def teenReadyIn(q: Platform, p: str): bool =
    q.minor.contains(p) and q.birthExact.contains(p) and phonesOf(q, p).forall(n => not(q.teenBarred.contains(n)))
  /** The person states an exact birth date (the join or the text line, a birth-date reading). */
  action teenBirthDate(p: str): bool = all {
    pf.minor.contains(p), not(pf.birthExact.contains(p)),
    not(pf.under13.contains(p)), not(pf.banned.contains(p)), not(pf.deleted.contains(p)), phonesOf(pf, p).size() > 0,
    pf' = { ...pf, birthExact: pf.birthExact.union(Set(p)) },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("teenBirthDate", p, 0, true) },
  }
  /**
   * A report, an older-than-stated statement, a conflict or a bar: readiness ends and each phone is barred.
   * ABSTRACTION (stricter than the code): here a minor report is a permanent bar. In the code a minor report, a
   * minor signal and an age conflict are a doubt that safety or admin staff can clear (NetworkService.clearMinor,
   * teenDoubtClearResult); the clear path is modeled in safety_trust (`teenDoubtClear`), not here.
   */
  action teenReadyLost(p: str): bool = all {
    teenReadyIn(pf, p),
    pf' = { ...pf, teenBarred: pf.teenBarred.union(phonesOf(pf, p)) },
    ib' = { ...ib, items: ib.items.keys().mapBy(i => if (ib.items.get(i).person == p) { ...ib.items.get(i), teenOk: false } else ib.items.get(i)) },
    oa' = oa, pc' = pc, gh' = { ...gh, last: eff("teenReadyLost", p, 0, true) },
  }
  /** The staff stop (spec/teenIntroSwitch.md; on from the start). A stop ends every teen item for good. */
  action teenStop: bool = all {
    not(pf.teenStopped),
    pf' = { ...pf, teenStopped: true },
    ib' = { ...ib, items: ib.items.keys().mapBy(i => { ...ib.items.get(i), teenOk: false }) },
    oa' = oa, pc' = pc, gh' = { ...gh, last: eff("teenStop", NONE, 0, true) },
  }
  /** One admin turns teen introductions on again; the items that the stop ended stay ended. */
  action teenResume: bool = all {
    pf.teenStopped,
    pf' = { ...pf, teenStopped: false },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("teenResume", NONE, 0, true) },
  }
  /** The teen sweep closes a teen item (a birthday at 19, a rule change): it is no longer current. */
  action teenItemEnds(i: int): bool = all {
    ib.items.get(i).teenOk,
    ib' = { ...ib, items: ib.items.setBy(i, x => { ...x, teenOk: false, oppOpen: false }) },
    oa' = oa, pf' = pf, pc' = pc, gh' = { ...gh, last: eff("teenItemEnds", NONE, 0, true) },
  }
  /** A new person for a number with none (p2 joins later on n2). */
  action createPerson(n: str): bool = all {
    pf.owner.get(n) == NONE, not(pf.holdNum.contains(n)), phonesOf(pf, "p2").size() == 0, not(pf.deleted.contains("p2")),
    pf' = { ...pf, owner: pf.owner.set(n, "p2") },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("createPerson", "p2", 0, true) },
  }
  /** POST /api/join (accounts.join refuses banned people). */
  action join(p: str, a: str): bool = all {
    phonesOf(pf, p).size() > 0, not(pf.banned.contains(p)),
    pf.member.get((p, a)) == "none" or pf.member.get((p, a)) == "removed",
    pf' = { ...pf, member: pf.member.set((p, a), "active") },
    oa' = oa, ib' = ib, pc' = pc, gh' = { ...gh, last: eff("join", p, 0, true) },
  }
  /**
   * SVC delivered: a member-facing send becomes an inbox item. An intro names another member, so it
   * exists only for an adult who can be matched (AGENTS decision 1). An "own" item (notify.add of a
   * reminder for the reader alone) has no opportunity. The leak flag is an oracle.
   */
  action produceItem(i: int, p: str, a: str, kind: str, leaky: bool): bool = all {
    not(ib.items.get(i).live), pf.member.get((p, a)) == "active", not(pf.banned.contains(p)),
    kind != "intro" or knownAdult(p),
    ib' = { ...ib, items: ib.items.set(i, { live: true, person: p, app: a, kind: kind, seen: false, oppOpen: true, leaky: leaky, teenOk: false }) },
    oa' = oa, pf' = pf, pc' = pc, gh' = { ...gh, last: eff("item", p, 0, true) },
  }
  /**
   * Owner decision 2026-11-22: a friends.help teen item (an intro or a probe of a teen friendship introduction)
   * for a teen-ready minor, made only while teen introductions are not stopped and the rule holds (P9 to P15 in
   * the network).
   */
  action produceTeenItem(i: int, p: str, kind: str, leaky: bool): bool = all {
    not(ib.items.get(i).live), pf.member.get((p, "friends")) == "active", not(pf.banned.contains(p)),
    kind != "own", not(pf.teenStopped), teenReadyIn(pf, p),
    ib' = { ...ib, items: ib.items.set(i, { live: true, person: p, app: "friends", kind: kind, seen: false, oppOpen: true, leaky: leaky, teenOk: true }) },
    oa' = oa, pf' = pf, pc' = pc, gh' = { ...gh, last: eff("teenItem", p, 0, true) },
  }
  /** The opportunity behind an item closes (completed, cancelled, skipped). The item is not touched. */
  action closeOpp(i: int): bool = all {
    ib.items.get(i).live, ib.items.get(i).oppOpen, ib.items.get(i).kind != "own",
    ib' = { ...ib, items: ib.items.setBy(i, x => { ...x, oppOpen: false }) },
    oa' = oa, pf' = pf, pc' = pc, gh' = { ...gh, last: eff("closeOpp", NONE, 0, true) },
  }

  /**
   * revokeAllFor(e164, app, {forget}): revoke and audit each live, unexpired grant
   * (grantsFor), then forgetPhone: delete the sign-in requests, then every grant row of
   * the number and app (with its codes, tokens and drafts).
   */
  def revokeAllForgetOa(o: OAuth, ns: Set[str], a: str): OAuth = {
    ...o,
    grants: o.grants.keys().mapBy(g => { val x = o.grants.get(g); if ((x.st == "live" or x.st == "revoked") and ns.contains(x.phone) and x.app == a) { ...x, st: "deleted" } else x }),
    toks: o.toks.keys().filter(t => { val x = o.grants.get(o.toks.get(t).g); not(ns.contains(x.phone) and x.app == a) }).mapBy(t => o.toks.get(t)),
    reqs: o.reqs.keys().mapBy(r => { val q = o.reqs.get(r); if (q.live and ns.contains(q.phone) and q.app == a) { ...q, live: false } else q }),
    drafts: o.drafts.keys().mapBy(g => { val x = o.grants.get(g); if (ns.contains(x.phone) and x.app == a) { ...o.drafts.get(g), exists: false } else o.drafts.get(g) }),
  }
  /** The grants that revokeAllFor revokes (and audits) before the delete: live and unexpired (grantsFor). */
  def forgetGhost(o: OAuth, ns: Set[str], apps: Set[str]): Set[int] =
    REQS.filter(g => liveG(o, g) and ns.contains(o.grants.get(g).phone) and apps.contains(o.grants.get(g).app))
  /** Every app of the number (pg-store.ts forgetPhone and forgetPerson with no app), also slop. */
  def forgetAllOa(o: OAuth, ns: Set[str]): OAuth = APPS.fold(o, (acc, a) => revokeAllForgetOa(acc, ns, a))
  /** The ghost and inbox side of a forget of `apps` on the numbers `ns`. */
  def forgetGh(gone: Set[int], last: Effect): Ghost =
    { ...gh, audits: gh.audits.union(gone.map(g => ("revoked", g))), revokedEver: gh.revokedEver.union(gone), last: last }

  /**
   * The account route, leave one app: hooks.onForget (SVC hooks().onForget) runs the listener, which calls
   * mcp.forgetPerson(personId, app) (serve.ts svc.onForget). SD-089 fix, restored for OPS61: a listener
   * error is not caught, so it stops the leave before forgetMembership and the request fails; the
   * consent opt-out already holds, and a retry deletes the grants and ends the membership.
   */
  action leave(p: str, a: str, listenerFails: bool): bool = all {
    val ns = phonesOf(pf, p)
    val o2 = revokeAllForgetOa(oa, ns, a)
    val gone = forgetGhost(oa, ns, Set(a))
    all {
      ns.size() > 0, pf.member.get((p, a)) != "none", pf.member.get((p, a)) != "removed",
      if (listenerFails) all {
        oa' = oa, ib' = ib, pf' = pf, gh' = { ...gh, last: eff("leave", p, 0, false) },
      } else all {
        oa' = o2,
        ib' = { ...ib, active: unlinkAfter(ib.active, oa, o2, gone) },
        gh' = forgetGh(gone, eff("leave", p, 0, true)),
        // The Network forgets the member: a later join is a new member with no hold.
        pf' = { ...pf, member: pf.member.set((p, a), "removed"), forgotten: pf.forgotten.union(ns.map(n => (n, a))),
                netHeld: pf.netHeld.exclude(Set((p, a))) },
      },
      pc' = pc,
    }
  }

  /**
   * The account route, delete everything: onForget for each live membership, then (SD-089 fix)
   * onForgetPhone, which runs the listener with no app: revokeAllFor of every app of the number,
   * also an app with no membership. Then the person is deleted (personForKey is null after).
   */
  action deleteAll(p: str): bool = all {
    val ns = phonesOf(pf, p)
    val o2 = forgetAllOa(oa, ns)
    val gone = forgetGhost(oa, ns, APPS)
    all {
      ns.size() > 0,
      oa' = o2,
      ib' = { ...ib, active: unlinkAfter(ib.active, oa, o2, gone) },
      gh' = forgetGh(gone, eff("deleteAll", p, 0, true)),
      pf' = { ...pf,
        owner: pf.owner.keys().mapBy(n => if (ns.contains(n)) NONE else pf.owner.get(n)),
        deleted: pf.deleted.union(Set(p)), netHeld: pf.netHeld.filter(k => k._1 != p),
        birthExact: pf.birthExact.exclude(Set(p)),
        member: pf.member.keys().mapBy(k => if (k._1 == p) "removed" else pf.member.get(k)),
        forgotten: pf.forgotten.union(tuples(ns, APPS)) },
      pc' = pc,
    }
  }

  /**
   * SVC statedAge with a decline (under 13). SD-089 fix: forgetPhone(e164) runs the forget
   * listeners with no app first (every app's grants), then forgetMembership on every app.
   */
  action declineUnder13(p: str): bool = all {
    val ns = phonesOf(pf, p)
    val apps = APPS.filter(a => pf.member.get((p, a)) != "none" and pf.member.get((p, a)) != "removed")
    val o2 = forgetAllOa(oa, ns)
    val gone = forgetGhost(oa, ns, APPS)
    all {
      ns.size() > 0, apps.size() > 0,
      oa' = o2,
      ib' = { ...ib, active: unlinkAfter(ib.active, oa, o2, gone) },
      gh' = forgetGh(gone, eff("decline", p, 0, true)),
      pf' = { ...pf, member: pf.member.keys().mapBy(k => if (k._1 == p) "removed" else pf.member.get(k)),
              minor: pf.minor.union(Set(p)), under13: pf.under13.union(Set(p)), forgotten: pf.forgotten.union(tuples(ns, APPS)),
              netHeld: pf.netHeld.filter(k => k._1 != p) },
      pc' = pc,
    }
  }

  /**
   * packages/platform/src/pg-store.ts movePhoneGrants: a current grant with the same person and
   * native authority moves with its draft. A current Cloud or unowned grant is revoked and audited.
   * Draft expiry is checked before the production move and has no separate clock in the model.
   */
  action movePhone(p: str, src: str, dst: str): bool = all {
    src != dst, pf.owner.get(src) == p, p != NONE, pf.owner.get(dst) == NONE,
    not(pf.holdNum.contains(src)), not(pf.holdNum.contains(dst)),
    val current = REQS.filter(g => liveG(oa, g) and oa.grants.get(g).phone == src)
    val movable = current.filter(g => not(oa.grants.get(g).cloud) and oa.grants.get(g).person == p)
    val retiring = current.exclude(movable)
    val ended = retiring.fold(oa, (state, g) => revokeOa(state, g))
    all {
      oa' = { ...ended,
        grants: ended.grants.keys().mapBy(g => { val x = ended.grants.get(g); if (movable.contains(g)) { ...x, phone: dst } else x }),
        drafts: ended.drafts.keys().mapBy(g => {
          val d = ended.drafts.get(g)
          if (retiring.contains(g)) { ...d, exists: false, phone: "", scrubbed: true }
          else if (movable.contains(g) and d.exists and not(d.scrubbed) and d.phone == src) { ...d, phone: dst }
          else d
        }) },
      // Ghost: a forget recorded for an earlier owner of dst does not cover the person who moves in.
      // pg-store movePhone copies the teen-pool bar of src to dst; readiness reads the bar of the current number.
      pf' = { ...pf, owner: pf.owner.set(src, NONE).set(dst, p), forgotten: pf.forgotten.filter(k => k._1 != dst),
              teenBarred: if (pf.teenBarred.contains(src)) pf.teenBarred.union(Set(dst)) else pf.teenBarred },
      gh' = { ...gh, audits: gh.audits.union(retiring.map(g => ("revoked", g))), revokedEver: gh.revokedEver.union(retiring),
        last: { ...eff("movePhone", p, 0, true), status: src } },
    },
    ib' = ib, pc' = pc,
  }

  // ---------------------------------------------------------------- step
  // The step picks one family, then one action in it, so that the long flows (sign-in, exchange, a
  // tool call) are reached in a random walk; every action of every family stays possible at each step.
  action step = {
    nondet r = REQS.oneOf()
    nondet c = CLIENTS.oneOf()
    nondet n = PHONES.oneOf()
    nondet n2 = PHONES.oneOf()
    nondet p = PERSONS.oneOf()
    nondet a = APPS.oneOf()
    nondet i = ITEMS.oneOf()
    nondet b = Set(true, false).oneOf()
    nondet b2 = Set(true, false).oneOf()
    nondet kind = Set("intro", "probe", "own").oneOf()
    nondet t = oa.toks.keys().union(Set(0)).oneOf()
    nondet h = HOSTS.oneOf()
    // The progress families are listed twice: the simulator picks among enabled branches, so this
    // doubles their weight against the environment. ownEndpointTools and approveRead pick, among the
    // hosts and apps that `h` and `a` can take, the endpoint of the grant or of the request.
    // draftSignupFamily walks one signup with a prefill, and grantItemFamily picks the person and app
    // of a grant for an inbox item. They add no behaviour; the calls with any other arguments stay in toolFamily,
    // approveReadOn, flowFamily and the environment.
    any {
      flowFamily(r, c, n, a, h, b, b2), clientFamily(r, t), toolFamily(t, h, a), ownEndpointTools(t, h, a),
      flowFamily(r, c, n, a, h, b, b2), clientFamily(r, t), toolFamily(t, h, a), ownEndpointTools(t, h, a),
      draftSignupFamily(r), grantItemFamily(i, kind, b),
      // Owner decision 2026-11-22: the teen path (birth date, stop, resume, teen item, sweep, report).
      any { teenBirthDate(p), teenStop, teenResume, produceTeenItem(i, p, kind, b), teenItemEnds(i), teenReadyLost(p) },
      // the environment: the person cancels or revokes, a process stops, clocks and the sweep,
      // the network and its inbox, staff and account changes
      any {
        any { denyRead(r), denyFinish(r), consentsRevokeOn(r, h), crashApprove(r), crashExchange(r) },
        any { tickRequests, expireGrant(r), expireCode(r), expireToken(t), clientAges(c), sweep },
        any { join(p, a), produceItem(i, p, a, kind, b), closeOpp(i), createPerson(n) },
        any {
          ban(p), staffHold(p), holdNumber(n), clearHoldSame(n), becomeMinor(p),
          leave(p, a, b2), deleteAll(p), declineUnder13(p), movePhone(p, n, n2),
        },
      },
    }
  }

  /** The person signs in and decides on the site. `fails` is a failed insert in the approval transaction. */
  action flowFamily(r: int, c: str, n: str, a: str, h: str, b: bool, fails: bool): bool = any {
    startAuth(r, c, a), enterPhone(r, n), enterCode(r), openSignup(r), approveRead(r, b), approveReadOn(r, h, b),
    approveCommit(r, fails), approveLink(r),
  }
  /** The client: code exchange, refresh, revocation. */
  action clientFamily(r: int, t: int): bool = any {
    exchCheck(r), exchRedeem(r), exchReplay(r),
    refrCheck(t), refrRotate(t), revokeEndpoint(t), revokeAccessToken(t),
  }
  /**
   * One signup with a prefill, for client cF, app friends, number n2 and its new person p2: a new person comes for n2
   * (createPerson); two sign-ins start (startAuth on an unused request), take the number (enterPhone) and the code
   * (enterCode); one is approved (approveRead, approveCommit) and exchanged (exchCheck, exchRedeem); the agent saves a
   * draft through prepare_signup at the endpoint of that grant (prepareSignup); the other sign-in opens the signup form
   * (openSignup). These are the same actions as in flowFamily, clientFamily, toolFamily and the environment, so they
   * add no behaviour; they only pick the arguments of one signup for a random walk. REQS has three request ids and
   * each is used once, and random sign-ins use them early, so the walk also continues requests that flowFamily started.
   */
  action draftSignupFamily(x: int): bool = {
    val q = oa.reqs.get(x)
    val mine = q.live and q.client == "cF" and q.app == "friends"
    val waiting = REQS.filter(y => oa.reqs.get(y).live and oa.reqs.get(y).client == "cF" and oa.reqs.get(y).app == "friends")
    val granted = REQS.filter(g => liveG(oa, g) and oa.grants.get(g).client == "cF" and oa.grants.get(g).app == "friends"
      and oa.grants.get(g).person == "p2")
    val drafted = granted.filter(g => oa.drafts.get(g).exists and not(oa.drafts.get(g).used))
    val ready = oa.toks.keys().filter(t => oa.toks.get(t).kind == "access" and granted.contains(oa.toks.get(t).g))
    any {
      createPerson("n2"),
      all { waiting.size() < 2, granted.size() == 0 or waiting.size() == 0, startAuth(x, "cF", "friends") },
      all { mine, q.step == "phone" or (q.step == "code" and q.phone != "n2"), enterPhone(x, "n2") },
      all { mine, q.step == "code", q.phone == "n2", enterCode(x) },
      all { mine, granted.size() == 0, waiting.size() == 2, approveRead(x, false) },
      approveCommit(x, false), exchCheck(x), exchRedeem(x),
      all { drafted.size() == 0, waiting.size() > 0, ready.size() > 0, prepareSignup(ready.fold(0, (m, t) => if (t > m) t else m), "friends", "friends") },
      all { mine, drafted.size() > 0, openSignup(x) },
    }
  }
  /** The network sends an inbox item to the person and app of a live grant (produceItem with those arguments). */
  action grantItemFamily(i: int, kind: str, leaky: bool): bool = {
    val held = REQS.filter(g => liveG(oa, g) and oa.grants.get(g).person != NONE)
    all {
      held.size() > 0,
      nondet g = held.oneOf()
      produceItem(i, oa.grants.get(g).person, oa.grants.get(g).app, kind, leaky),
    }
  }
  /** The client calls a tool. */
  action toolFamily(t: int, h: str, a: str): bool = any { getUpdates(t, h, a), checkStatus(t, h, a), submitProfile(t, h, a), prepareSignup(t, h, a),
    listLookingFor(t, h, a), pauseLookingFor(t, h, a), resumeLookingFor(t, h, a), myPhotos(t, h, a), photoRequest(t, h, a),
  }
  /** The client calls a tool at the endpoint of its token's grant: the grant's host and app. */
  action ownEndpointTools(t: int, h: str, a: str): bool =
    if (oa.toks.keys().contains(t)) {
      val gr = oa.grants.get(oa.toks.get(t).g)
      toolFamily(t, clientHost(gr.client), gr.app)
    } else toolFamily(t, h, a)

  // ================================================================ invariants (from the rules)

  /**
   * SD-019. AGENTS founder 2026-10-09 #3: a banned number is refused at join, OTP and inbound, on every
   * app; SVC "never matched or texted again". No banned person's agent gets inbox data, a tool answer,
   * or past the check of a code exchange or a refresh. Fix: cloudGrantCurrent checks the ban.
   * A ban that commits while an exchange or a refresh waits between its check and its transaction still
   * lets that one transaction commit; every later use of those tokens fails this check (bearer, refresh).
   */
  val noBannedUse =
    not(Set("getUpdates", "status", "profile", "exchCheck", "refrCheck", "listLookingFor", "pauseLookingFor", "resumeLookingFor", "myPhotos", "photoRequest").contains(gh.last.kind) and gh.last.ok
        and pf.banned.contains(gh.last.person))

  /**
   * SD-184, SD-185. packages/mcp/README.md section 3: "a reused refresh token or code ends the whole
   * grant"; "A refresh token used twice: someone else has a copy". A replay revocation ends a
   * usable grant only for a credential that was redeemed before (that redemption completed).
   */
  val replayIsTrue = gh.last.kind == "replay" implies gh.last.ok

  /** INV-C1 (OAuth 2.1 4.1.3): one code gives at most one token pair. */
  val codeOnce = REQS.forall(g => oa.toks.keys().filter(t => oa.toks.get(t).g == g and oa.toks.get(t).origin == "code").size() <= 2)

  /** INV-T1 (README: refresh tokens rotate): at most one unrotated, unrevoked refresh token per grant. */
  val oneRefreshHead = REQS.forall(g => oa.toks.keys().filter(t => {
    val k = oa.toks.get(t)
    k.g == g and k.kind == "refresh" and not(k.rotated) and not(k.revoked) and not(k.expired)
  }).size() <= 1)

  /** INV-G1: a revoked grant never becomes live again. */
  val revokedTerminal = gh.revokedEver.forall(g => oa.grants.get(g).st != "live")

  /**
   * INV-G2, INV-OB1 (tools.ts checkGrantOwner, spec/connectorTools.md decideGrantOwner, README "New owner"): a tool serves data only on a live grant, and only
   * about the person who consented.
   */
  val servedOnLiveOwnGrant =
    (Set("getUpdates", "status", "profile", "listLookingFor", "pauseLookingFor", "resumeLookingFor", "myPhotos", "photoRequest").contains(gh.last.kind) and gh.last.ok) implies {
      val gr = oa.grants.get(gh.last.grant)
      gr.st == "live" and not(gr.expired) and personForKey(pf, gr.phone) == gr.person and gh.last.person == gr.person
    }

  /**
   * SD-186 part (c), strict form. hooks.ts "An assistant was connected (consent granted) or disconnected (grant
   * revoked) for a person", keyed by person and assistant: while a live grant of the person whose
   * approval completed (linked) exists, the signal stays on.
   *
   * NOT in `safety` (Q-oauth_mcp-2, found by this model after the fix run, not fixed): the fix looks for
   * other live grants on the revoked grant's phone key only (store.grantsFor). When the number moves
   * between the approval's read and its commit, the new grant is stored on the old key (the grant object
   * is built from the request's number, and approveConsent does not check the owner again). Revoking that
   * grant then turns the signal off while the moved grant on the new key is live (`moveDuringApprovalTest`).
   * The random walk and the bounded check do not reach this 16-step trace. A fix needs a code change
   * (look up the person's live grants on every key, or refuse the commit when the request's number has a
   * new owner) with its own integration test.
   */
  val activeKeptWhileLiveAll = PERSONS.forall(p =>
    REQS.exists(g => liveG(oa, g) and oa.grants.get(g).person == p and pc.appr.get(g) == "done") implies ib.active.contains(p))

  /**
   * SD-186 part (c), in `safety`: `activeKeptWhileLiveAll` for every person who never got a grant stored
   * on a number they no longer own (ghost `oldKey`, the Q-oauth_mcp-2 race). This is what the fix
   * guarantees; the excluded case is the open defect above, not a weaker rule.
   */
  val activeKeptWhileLive = PERSONS.forall(p => not(gh.oldKey.contains(p)) implies
    (REQS.exists(g => liveG(oa, g) and oa.grants.get(g).person == p and pc.appr.get(g) == "done") implies ib.active.contains(p)))

  /**
   * SD-186 parts (a) and (b), NOT in `safety`: the signal is on exactly when a live grant exists. It
   * fails by design: the documented assistantLinked contract (hooks.ts) sends the signal on
   * "consent granted" and "grant revoked" only, so an expiry does not clear it (b) and a stop between
   * the approval's commit and linked(true) leaves it off (a). The fix commit c4b97ca left both as they
   * are; a change needs a maintainer decision on the hook contract.
   */
  val activeExactlyGrants = PERSONS.forall(p =>
    not(REQS.exists(g => pc.appr.get(g) == "committed" and oa.grants.get(g).person == p)) implies
      (ib.active.contains(p) iff REQS.exists(g => liveG(oa, g) and oa.grants.get(g).person == p)))

  /**
   * SD-089, Q-oauth_mcp-1. handler.ts and README section 3: after leave or delete everything
   * "nothing keeps the phone next to the app"; AGENTS age policy: under 13 is declined with nothing stored.
   */
  val grantDiesWithPerson = pf.forgotten.forall(na =>
    not(REQS.exists(g => (oa.grants.get(g).st == "live" or oa.grants.get(g).st == "revoked")
      and oa.grants.get(g).phone == na._1 and oa.grants.get(g).app == na._2)))

  /**
   * SD-428. "the profile never reaches a stopped or held one"; hooks.ts publicStatus and a held member reads
   * on_hold. A staff hold must not read "active" nor accept a profile.
   */
  val heldIsHeld =
    val held = gh.last.grant > 0 and pf.netHeld.contains((gh.last.person, oa.grants.get(gh.last.grant).app))
    not(gh.last.kind == "status" and gh.last.status == "active" and held)
    and not(gh.last.kind == "profile" and gh.last.ok and held)
    and not(Set("listLookingFor", "pauseLookingFor", "resumeLookingFor", "myPhotos", "photoRequest").contains(gh.last.kind) and gh.last.ok and held)

  /**
   * Owner decision 2026-11-22 (spec/connectorTools.md toolAllowedFor): the looking-for tools serve only an active
   * member, and the agent turns a search back on only for an adult.
   */
  val lookingForOnlyActive =
    (Set("listLookingFor", "pauseLookingFor", "resumeLookingFor").contains(gh.last.kind) and gh.last.ok) implies gh.last.status == "active"
  val agentResumeOnlyAdult = (gh.last.kind == "resumeLookingFor" and gh.last.ok) implies knownAdult(gh.last.person)
  /** Owner decision 2026-11-22 (spec/connectorTools.md resultShowsLookingFor): a result shows what the app looks for only to a grant with profile:read. */
  val lookingForListNeedsProfileRead = gh.last.listed implies readsProfile(gh.last.grant)
  /** Owner decision 2026-11-22 (spec/connectorTools.md toolListed, grantCovers): a photo tool acts only on a slop.date grant with photos:use. */
  val photoToolsOnlySlopWithScope =
    Set("myPhotos", "photoRequest").contains(gh.last.kind) implies
      (gh.last.grant > 0 and oa.grants.get(gh.last.grant).app == "slop" and readsPhotos(gh.last.grant))
  /** Owner decision 2026-11-22 (spec/connectorTools.md toolAllowedFor; photos are for adults only): a photo tool serves only an active adult. */
  val photoToolsOnlyActiveAdult =
    (Set("myPhotos", "photoRequest").contains(gh.last.kind) and gh.last.ok) implies
      (gh.last.status == "active" and knownAdult(gh.last.person))

  /**
   * SD-214, MCP54. AGENTS decision 1, changed by the owner decision of 2026-11-22: a minor is matched or
   * connected only through a teen friendship item under teenFriendAgeRule; a reader who cannot be matched
   * reads only items about themselves, and a minor reads about another member only through such an item that
   * is still readable (spec/connectorTools.md).
   */
  def teenReadable(i: int): bool =
    ib.items.get(i).teenOk and not(pf.teenStopped) and teenReadyIn(pf, ib.items.get(i).person)
  def readerAgeAllowed(i: int): bool = knownAdult(ib.items.get(i).person) or teenReadable(i)
  // Changed (owner decision 2026-11-22, spec/friendIntroAge.md teenFriendAgeRule): a reader who is not an adult
  // reads about another member only through a teen item that the rule allows now.
  val teenFriendAgeRule = gh.last.kind == "getUpdates" implies
    gh.last.items.forall(i => ib.items.get(i).kind == "own" or readerAgeAllowed(i))
  // While teen introductions are stopped a minor reads only items about themselves (the earlier noIntroToMinor).
  val teenSwitchOffNoMinor = (gh.last.kind == "getUpdates" and pf.teenStopped) implies
    gh.last.items.forall(i => ib.items.get(i).kind == "own" or knownAdult(gh.last.person))

  /**
   * MCP55. spec/connectorTools.md "A withheld update stays unseen": a leaky item of an open opportunity
   * is marked seen only when it was retired for a reader who cannot be matched.
   */
  val withheldStaysUnseen = ITEMS.forall(i => (ib.items.get(i).live and ib.items.get(i).leaky and ib.items.get(i).oppOpen and ib.items.get(i).seen)
    implies (ib.items.get(i).kind != "own" and not(readerAgeAllowed(i))))

  /**
   * SD-430. next_step "They answer by replying to the text": an update shown as new must still
   * be answerable, so its opportunity must be open.
   */
  val noStaleUpdate = gh.last.kind == "getUpdates" implies gh.last.items.forall(i => ib.items.get(i).oppOpen)

  /** SD-394. README section 3 Audit: "one row for each ... revocation and replay". */
  val everyRevocationAudited = gh.revokedEver.forall(g => gh.audits.contains(("revoked", g)))

  /** SD-397. RFC 6749 4.1.2: one authorization request ends in a code or in an error, never both. */
  val oneOutcome = gh.granted.intersect(gh.denied) == Set()

  /**
   * SD-389. README section 3 Audit (one row for each consent and code): a stored grant has its code and
   * its consent_granted row.
   */
  val grantHasCodeAndAudit = REQS.forall(g =>
    oa.grants.get(g).st == "live" implies (oa.codes.get(g).st != "none" and gh.audits.contains(("consent_granted", g))))

  /** SD-393. README section 3: "A sign-in request keeps the number only while it is open (at most 10 minutes, then swept)". */
  val requestRetention = REQS.forall(r => (oa.reqs.get(r).live and oa.reqs.get(r).phone != "") implies oa.reqs.get(r).age <= README_REQ_MAX)

  /**
   * SD-390. README section 3: the sweep deletes "registered clients that never got a grant after a
   * day"; client_secret_expires_at 0 (the registration does not expire).
   */
  val clientKeptOnceGranted = CLIENTS.forall(c => not(oa.clients.get(c).exists) implies not(gh.everGranted.contains(c)))

  /** SD-395. README section 2: "At most 5 accepted profiles per grant a day": only accepted ones count. */
  val quotaCountsAccepted = gh.last.kind == "quotaRefused" implies oa.quota.get(gh.last.grant).accepted >= PROFILE_CAP

  /** A completed move releases its source number and leaves no live grant on it. */
  val numberChangeWorks = gh.last.kind == "movePhone" implies (
    pf.owner.get(gh.last.status) == NONE and REQS.forall(g => not(liveG(oa, g) and oa.grants.get(g).phone == gh.last.status)))

  /** SD-384. P:61-79: a draft is claimed by its grant's phone key; a live draft keys the same phone as its grant. */
  val draftFollowsGrant = REQS.forall(g =>
    (oa.drafts.get(g).exists and not(oa.drafts.get(g).scrubbed) and oa.grants.get(g).st == "live")
      implies oa.drafts.get(g).phone == oa.grants.get(g).phone)

  /**
   * connectorTools.md lawAppSiteServesOnlyItsApp and lawHubServesEveryApp: a request and its grant are for an app
   * that the client's host serves. An app site's client never holds a grant for another app.
   */
  val requestOnItsHost = REQS.forall(r => oa.reqs.get(r).live implies hostBindsApp(clientHost(oa.reqs.get(r).client), oa.reqs.get(r).app))
  val grantOnItsHost = REQS.forall(g => Set("live", "revoked").contains(oa.grants.get(g).st)
    implies hostBindsApp(clientHost(oa.grants.get(g).client), oa.grants.get(g).app))

  /** connectorTools.md lawGrantNeverCrossesApps: a tool answer is always for the app of the grant that the token belongs to. */
  val servedInGrantApp =
    (Set("getUpdates", "status", "profile", "quotaRefused", "prepare", "listLookingFor", "pauseLookingFor",
      "resumeLookingFor", "myPhotos", "photoRequest").contains(gh.last.kind) and gh.last.grant > 0)
      implies gh.last.app == oa.grants.get(gh.last.grant).app

  /** liveRequest: a consent is read only on the host of the request's client, for the request's app. */
  val consentOnItsHost = gh.last.kind == "approveRead" implies {
    val gr = oa.grants.get(gh.last.grant)
    gh.last.status == clientHost(gr.client) and gh.last.app == gr.app
  }

  /** authorizationPages.md lawPrefillAtMostOnce: a draft fills at most one signup form. */
  val prefillAtMostOnce = REQS.forall(g => gh.prefills.filter(x => x.grant == g).size() <= 1)

  /** authorizationPages.md lawPrefillOnlyForItsClientAppAndPhone, and the grant's person (signupDraftGrantAllowed). */
  val prefillBound = gh.prefills.forall(x => x.sameClient and x.sameApp and x.samePhone and x.samePerson)

  /** authorizationPages.md lawAgeGuardRefusesPrefill: an under-13 person never sees a prefilled form. */
  val noPrefillUnder13 = gh.last.kind == "prefill" and gh.last.ok implies not(pf.under13.contains(gh.last.person))

  val safety = and {
    noBannedUse, replayIsTrue, codeOnce, oneRefreshHead, revokedTerminal, servedOnLiveOwnGrant,
    activeKeptWhileLive, grantDiesWithPerson, heldIsHeld, teenFriendAgeRule, teenSwitchOffNoMinor, withheldStaysUnseen, noStaleUpdate,
    everyRevocationAudited, oneOutcome, grantHasCodeAndAudit, requestRetention, clientKeptOnceGranted,
    quotaCountsAccepted, draftFollowsGrant, numberChangeWorks,
    requestOnItsHost, grantOnItsHost, servedInGrantApp, consentOnItsHost, prefillAtMostOnce, prefillBound, noPrefillUnder13,
    lookingForOnlyActive, agentResumeOnlyAdult, lookingForListNeedsProfileRead,
    photoToolsOnlySlopWithScope, photoToolsOnlyActiveAdult,
  }

  /** The invariants that the code kept before the fixes (no register defect). */
  val soundCore = and { codeOnce, oneRefreshHead, revokedTerminal, servedOnLiveOwnGrant }

  // ================================================================ witnesses (states that must be reachable)
  /** The full PKCE flow, then get_updates shows an update. */
  val witness_fullFlowUpdate = not(gh.last.kind == "getUpdates" and gh.last.items.size() > 0)
  /** A refresh rotates and mints a new pair. */
  val witness_refreshRotates = not(gh.last.kind == "refresh" and gh.last.ok)
  /** After a revoke, the next tool call is refused (no access token of the grant passes bearer). */
  val witness_revokeStops = not(REQS.exists(g => oa.grants.get(g).st == "revoked"
    and oa.toks.keys().exists(t => oa.toks.get(t).g == g and oa.toks.get(t).kind == "access" and not(oa.toks.get(t).expired))))
  /** A true code or refresh replay revokes the grant. */
  val witness_trueReplay = not(gh.last.kind == "replay" and gh.last.status == "true")
  /** MCP55: a read leaves a withheld update of the read app unseen. */
  val witness_withheldKept = not(gh.last.kind == "getUpdates" and gh.last.grant > 0 and ITEMS.exists(i => ib.items.get(i).live
    and ib.items.get(i).leaky and not(ib.items.get(i).seen) and ib.items.get(i).person == gh.last.person
    and ib.items.get(i).app == oa.grants.get(gh.last.grant).app))
  /** A person leaves an app and the grants of that app are deleted. */
  val witness_leaveDeletes = not(gh.last.kind == "leave" and gh.last.ok and pf.forgotten.size() > 0
    and REQS.exists(g => oa.grants.get(g).st == "deleted"))
  /** A refresh that loses the race with a revocation or an expiry ends as invalid_grant, not as a replay (SD-185). */
  val witness_refreshStale = not(gh.last.kind == "refreshStale")
  /** A denial that loses the race with an approval denies nothing (SD-397). */
  val witness_denyLoses = not(gh.last.kind == "denyExpired" and gh.granted.contains(gh.last.grant))
  /** A held member reads on_hold (SD-428). */
  val witness_heldReadsOnHold = not(gh.last.kind == "status" and gh.last.status == "on_hold")
  /** A grant made on the ntwrk.party hub serves a tool call for another app (/mcp/<app>). */
  val witness_hubServesApp = not(gh.last.kind == "status" and gh.last.grant > 0
    and oa.grants.get(gh.last.grant).client == "cN" and gh.last.app != HUB)
  /** A signup form shows the agent's draft. */
  val witness_prefillShown = not(gh.last.kind == "prefill" and gh.last.ok)
  /** The person's agent pauses one standing thing (owner decision 2026-11-22). */
  val witness_agentPauses = not(gh.last.kind == "pauseLookingFor" and gh.last.ok)
  /** A minor's agent cannot turn a search back on. */
  val witness_minorResumeRefused = not(gh.last.kind == "resumeLookingFor" and not(gh.last.ok) and pf.minor.contains(gh.last.person))
  /** The person's agent reads their slop.date photo list (owner decision 2026-11-22). */
  val witness_photoListShown = not(gh.last.kind == "myPhotos" and gh.last.ok)

  // ================================================================ run tests (traces from the code and its tests)
  /** p1 connects client c on number n with request r and holds its token pair (legacy or Cloud grant). */
  run connectOn(r: int, c: str, n: str, cloud: bool): bool =
    startAuth(r, c, clientHost(c)).then(enterPhone(r, n)).then(enterCode(r)).then(approveRead(r, cloud))
      .then(approveCommit(r, false)).then(approveLink(r))
      .then(exchCheck(r)).then(exchRedeem(r))
  run connect(r: int, c: str, cloud: bool): bool = connectOn(r, c, "n1", cloud)
  /** p1 connects client c for app a (the resource names a) on number n1. */
  run connectApp(r: int, c: str, a: str): bool =
    startAuth(r, c, a).then(enterPhone(r, "n1")).then(enterCode(r)).then(approveRead(r, false))
      .then(approveCommit(r, false)).then(approveLink(r))
      .then(exchCheck(r)).then(exchRedeem(r))

  /** oauth.test.ts "full flow: sign in on the page, approve, exchange, check_status". */
  run fullFlowTest =
    init.then(connect(1, "cF", false)).then(checkStatus(1, "friends", "friends"))
      .expect(gh.last.kind == "status" and gh.last.status == "active" and safety and activeExactlyGrants)

  /** tests/e2e/agent-profile.e2e.test.ts: list_looking_for and pause_looking_for for an active member; a held member gets nothing. */
  run lookingForTest =
    init.then(connect(2, "cF", false)).then(listLookingFor(1, "friends", "friends"))
      .expect(gh.last.kind == "listLookingFor" and gh.last.ok and gh.last.listed and safety)
      .then(pauseLookingFor(1, "friends", "friends"))
      .expect(gh.last.kind == "pauseLookingFor" and gh.last.ok and gh.last.listed and safety)
      .then(becomeMinor("p1")).then(resumeLookingFor(1, "friends", "friends"))
      .expect(gh.last.kind == "resumeLookingFor" and not(gh.last.ok) and agentResumeOnlyAdult and safety)

  /** packages/mcp/test/oauth.test.ts "slop.date photo tools": a grant with photos:use reads the list; a minor gets nothing. */
  run photoToolsTest =
    init.then(connect(3, "cS", false)).then(myPhotos(1, "slop", "slop"))
      .expect(gh.last.kind == "myPhotos" and gh.last.ok and photoToolsOnlySlopWithScope and safety)
      .then(photoRequest(1, "slop", "slop"))
      .expect(gh.last.kind == "photoRequest" and gh.last.ok and safety)
      .then(becomeMinor("p1")).then(myPhotos(1, "slop", "slop"))
      .expect(gh.last.kind == "myPhotos" and not(gh.last.ok) and photoToolsOnlyActiveAdult and safety)

  /** The eligible hub resource can use its photo grant only on that host and app. */
  run hubPhotoToolsTest =
    init.then(connectApp(3, "cN", "slop")).then(myPhotos(1, HUB, "slop"))
      .expect(gh.last.ok and servedInGrantApp and photoToolsOnlySlopWithScope and safety)
  run hubPhotoTokenOffSiteTest =
    init.then(connectApp(3, "cN", "slop")).then(myPhotos(1, "slop", "slop")).fail()
  run hubPhotoTokenOffAppTest =
    init.then(connectApp(3, "cN", "slop")).then(myPhotos(1, HUB, "friends")).fail()
  /** An active person of unknown age cannot use the photo list. */
  run photoToolsNeedKnownAdultTest =
    init.then(createPerson("n2")).then(join("p2", "slop")).then(connectOn(3, "cS", "n2", false))
      .then(myPhotos(1, "slop", "slop"))
      .expect(gh.last.kind == "myPhotos" and not(gh.last.ok) and photoToolsOnlyActiveAdult and safety)

  /** A default grant (no photos:use) cannot call a photo tool. */
  run photoToolsNeedScopeTest =
    init.then(connect(1, "cS", false)).then(myPhotos(1, "slop", "slop")).fail()
  /** The same slop.date grant: a held member's pause is not served. A run cannot continue after `fail()`, so this is a separate run. */
  run photoGrantHeldPauseTest =
    init.then(connect(1, "cS", false))
      .then(staffHold("p1")).then(pauseLookingFor(1, "slop", "slop"))
      .expect(not(gh.last.ok) and heldIsHeld and safety)

  /** packages/mcp/test/mcp.test.ts: with the default scopes only, submit_profile and pause_looking_for show no summaries, and list_looking_for is refused. */
  run lookingForScopeTest =
    init.then(connect(1, "cF", false)).then(submitProfile(1, "friends", "friends"))
      .expect(gh.last.kind == "profile" and gh.last.ok and not(gh.last.listed) and safety)
      .then(pauseLookingFor(1, "friends", "friends"))
      .expect(gh.last.kind == "pauseLookingFor" and gh.last.ok and not(gh.last.listed) and safety)
      .then(listLookingFor(1, "friends", "friends")).fail()

  /** oauth.test.ts "a second use of the code revokes what the first issued". */
  run codeReplayTest =
    init.then(connect(1, "cF", false)).then(exchReplay(1))
      .expect(oa.grants.get(1).st == "revoked" and not(bearerOk(1, "friends", "friends")) and gh.last.status == "true" and safety)

  /** oauth.test.ts "access tokens expire; refresh rotates; a reused refresh token ends the grant". */
  run refreshReplayTest =
    init.then(connect(1, "cF", false))
      .then(refrCheck(2)).then(refrRotate(2))
      .expect(gh.last.kind == "refresh" and gh.last.ok)
      .then(refrCheck(2)).then(refrRotate(2))
      .expect(oa.grants.get(1).st == "revoked" and gh.last.kind == "replay" and gh.last.status == "true"
        and gh.audits.contains(("refresh_replay", 1)) and safety)

  /** SD-019 fix (e2e "a staff ban ends get_updates and refresh on an existing grant"). */
  run banEndsGrantUseTest =
    init.then(connect(1, "cF", false)).then(produceItem(1, "p1", "friends", "probe", false))
      .then(ban("p1"))
      .expect(not(bearerOk(1, "friends", "friends")) and safety)
      .then(getUpdates(1, "friends", "friends")).fail()
  run banEndsRefreshTest =
    init.then(connect(1, "cF", false)).then(ban("p1")).then(refrCheck(2)).fail()
  run banEndsExchangeTest =
    init.then(startAuth(1, "cF", "friends")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(approveCommit(1, false)).then(approveLink(1)).then(ban("p1")).then(exchCheck(1)).fail()

  /** SD-184 fix (e2e "a failed token mint leaves the code unused, and the retry gets the tokens"). */
  run codeCrashRetryTest =
    init.then(startAuth(1, "cF", "friends")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(approveCommit(1, false)).then(approveLink(1))
      .then(exchCheck(1)).then(crashExchange(1))
      .expect(oa.codes.get(1).st == "issued" and oa.toks.keys() == Set())
      .then(exchCheck(1)).then(exchRedeem(1))
      .expect(oa.grants.get(1).st == "live" and bearerOk(1, "friends", "friends") and safety)

  /** SD-185 fix: the grant expires while a refresh waits; rotateRefresh says "stale"; no revocation, no replay row. */
  run refreshExpiredTest =
    init.then(connect(1, "cF", false))
      .then(refrCheck(2)).then(expireGrant(1)).then(refrRotate(2))
      .expect(gh.last.kind == "refreshStale" and oa.grants.get(1).st == "live"
        and not(gh.audits.contains(("refresh_replay", 1))) and safety)

  /** SD-185 fix (e2e "a refresh that waits on a grant revoked meanwhile writes no refresh_replay row"). */
  run refreshRevokedTest =
    init.then(connect(1, "cF", false))
      .then(refrCheck(2)).then(consentsRevoke(1)).then(refrRotate(2))
      .expect(gh.last.kind == "refreshStale" and not(gh.audits.contains(("refresh_replay", 1))) and safety)

  /** SD-089 fix (e2e "an under-13 decline deletes the person's grants on every app"). */
  run declineDeletesGrantTest =
    init.then(connect(1, "cF", false)).then(connect(2, "cP", false))
      .then(declineUnder13("p1"))
      .expect(oa.grants.get(1).st == "deleted" and oa.grants.get(2).st == "deleted"
        and grantDiesWithPerson and everyRevocationAudited and not(ib.active.contains("p1")))

  /** SD-089 fix (e2e "delete everything deletes the grant of an app with no membership"). */
  run deleteAllOtherAppTest =
    init.then(createPerson("n2")).then(join("p2", "peon")).then(connectOn(1, "cF", "n2", false))
      .expect(oa.grants.get(1).person == "p2" and pf.member.get(("p2", "friends")) == "none")
      .then(deleteAll("p2"))
      .expect(oa.grants.get(1).st == "deleted" and grantDiesWithPerson and safety)

  /** SD-089 and OPS61 fix (e2e "a leave whose grant cleanup fails is not completed, and a retry ends the app's grants"). */
  run leaveListenerFailsTest =
    init.then(connect(1, "cF", false))
      .then(leave("p1", "friends", true))
      .expect(pf.member.get(("p1", "friends")) == "active" and liveG(oa, 1) and safety)
      .then(leave("p1", "friends", false))
      .expect(oa.grants.get(1).st == "deleted" and grantDiesWithPerson and safety)

  /** Leave runs revokeAllFor with forget: the grant row is deleted (oauth.test.ts "leaving an app deletes the grants"). */
  run leaveDeletesTest =
    init.then(connect(1, "cF", false)).then(leave("p1", "friends", false))
      .expect(oa.grants.get(1).st == "deleted" and grantDiesWithPerson and activeExactlyGrants and everyRevocationAudited)

  /** SD-397 fix (e2e "a deny that loses the race with an approve does not answer access_denied"). */
  run approveDenyRaceTest =
    init.then(startAuth(1, "cF", "friends")).then(enterPhone(1, "n1")).then(enterCode(1))
      .then(denyRead(1)).then(approveRead(1, false)).then(approveCommit(1, false)).then(denyFinish(1))
      .expect(gh.last.kind == "denyExpired" and not(gh.audits.contains(("consent_denied", 1))) and oneOutcome and safety)
  /** The other order: the denial deletes the request first; the approval stores nothing. */
  run denyFirstTest =
    init.then(startAuth(1, "cF", "friends")).then(enterPhone(1, "n1")).then(enterCode(1))
      .then(approveRead(1, false)).then(denyRead(1)).then(denyFinish(1)).then(approveCommit(1, false))
      .expect(gh.last.kind == "approveExpired" and oa.grants.get(1).st == "none" and oneOutcome and safety)

  /**
   * SD-214 and MCP54 fix (e2e "a member whose age drops below 18 reads only their own updates, never one
   * about another member"): the intro is retired, the reminder is shown.
   */
  run minorIntroTest =
    init.then(connect(1, "cF", false)).then(produceItem(1, "p1", "friends", "intro", false))
      .then(produceItem(2, "p1", "friends", "own", false))
      .then(becomeMinor("p1")).then(getUpdates(1, "friends", "friends"))
      .expect(gh.last.items == Set(2) and ib.items.get(1).seen and ib.items.get(2).seen and teenFriendAgeRule and safety)

  /**
   * Owner decision 2026-11-22, answers A2 to A5: a minor with an exact birth date reads a friends.help teen intro
   * with no staff step; after the stop the next teen intro is retired, and the minor reads only their own items.
   */
  run teenIntroReadTest =
    init.then(connect(1, "cF", false)).then(becomeMinor("p1")).then(teenBirthDate("p1"))
      .then(produceTeenItem(1, "p1", "intro", false)).then(getUpdates(1, "friends", "friends"))
      .expect(gh.last.items == Set(1) and teenFriendAgeRule and safety)
      .then(produceTeenItem(2, "p1", "probe", false)).then(teenStop).then(getUpdates(1, "friends", "friends"))
      .expect(gh.last.items == Set() and ib.items.get(2).seen and teenSwitchOffNoMinor and safety)

  /** A minor without an exact birth date gets no teen item; a barred minor gets none either. */
  run teenNoBirthDateTest =
    init.then(connect(1, "cF", false)).then(becomeMinor("p1"))
      .then(produceTeenItem(1, "p1", "intro", false)).fail()
  run teenBarredTest =
    init.then(connect(1, "cF", false)).then(becomeMinor("p1")).then(teenBirthDate("p1")).then(teenReadyLost("p1"))
      .then(produceTeenItem(1, "p1", "intro", false)).fail()
  /** The bar is on the number. After erasure a new minor on the same number with a birth date is not teen ready. */
  run teenBarAfterEraseTest =
    init.then(becomeMinor("p1")).then(teenBirthDate("p1")).then(teenReadyLost("p1"))
      .then(deleteAll("p1")).then(createPerson("n1")).then(becomeMinor("p2"))
      .then(join("p2", "friends")).then(teenBirthDate("p2"))
      .expect(pf.owner.get("n1") == "p2" and pf.teenBarred.contains("n1") and not(teenReadyIn(pf, "p2")) and safety)
      .then(produceTeenItem(1, "p2", "intro", false)).fail()
  /** The bar moves with a number change: the person on the new number is still barred. */
  run teenBarMovesTest =
    init.then(becomeMinor("p1")).then(teenBirthDate("p1")).then(teenReadyLost("p1"))
      .then(movePhone("p1", "n1", "n2"))
      .expect(pf.teenBarred.contains("n2") and not(teenReadyIn(pf, "p1")) and safety)
      .then(produceTeenItem(1, "p1", "intro", false)).fail()

  /** MCP55 fix (e2e "an update that fails the output leak gate is withheld and stays unseen"). */
  run withheldTest =
    init.then(connect(1, "cF", false)).then(produceItem(1, "p1", "friends", "own", true))
      .then(produceItem(2, "p1", "friends", "own", false)).then(getUpdates(1, "friends", "friends"))
      .expect(gh.last.items == Set(2) and not(ib.items.get(1).seen) and ib.items.get(2).seen and withheldStaysUnseen and safety)
      .then(getUpdates(1, "friends", "friends"))
      .expect(gh.last.items == Set() and not(ib.items.get(1).seen) and safety)

  /** SD-430 fix (e2e "get_updates does not return a probe whose opportunity closed"): reading still marks it seen. */
  run staleProbeTest =
    init.then(connect(1, "cF", false)).then(produceItem(1, "p1", "friends", "probe", false))
      .then(closeOpp(1)).then(getUpdates(1, "friends", "friends"))
      .expect(gh.last.items == Set() and ib.items.get(1).seen and noStaleUpdate and safety)

  run heldStatusReachableTest =
    init.then(connect(1, "cF", false)).then(staffHold("p1")).then(checkStatus(1, "friends", "friends"))
      .expect(not(witness_heldReadsOnHold))

  /** SD-428 fix (e2e "a member on a staff hold reads on_hold and cannot submit a profile"). */
  run heldActiveTest =
    init.then(connect(1, "cF", false)).then(staffHold("p1")).then(checkStatus(1, "friends", "friends"))
      .expect(gh.last.status == "on_hold" and heldIsHeld)
      .then(submitProfile(1, "friends", "friends"))
      .expect(not(gh.last.ok) and oa.quota.get(1).count == 0 and heldIsHeld and safety)

  /** SD-394 fix (e2e "a tool call that ends the grant writes a consent_revoked row"); the hold stays final. */
  run silentRevokeTest =
    init.then(connect(1, "cF", false)).then(holdNumber("n1")).then(checkStatus(1, "friends", "friends"))
      .expect(oa.grants.get(1).st == "revoked" and gh.audits.contains(("revoked", 1)) and everyRevocationAudited)
      .then(clearHoldSame("n1"))
      .expect(not(bearerOk(1, "friends", "friends")) and safety)

  /** SD-389 fix: a stop after the approval's commit leaves a grant with its code and its audit row. */
  run consentCrashTest =
    init.then(startAuth(1, "cF", "friends")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(approveCommit(1, false)).then(crashApprove(1))
      .expect(liveG(oa, 1) and oa.codes.get(1).st == "issued" and grantHasCodeAndAudit and safety
        // SD-186 part (a), kept by the hook contract: linked(true) did not run.
        and not(ib.active.contains("p1")) and not(activeExactlyGrants))

  /** SD-389 fix (e2e "a failed code insert stores no grant, and the person can approve again"). */
  run consentInsertFailsTest =
    init.then(startAuth(1, "cF", "friends")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(approveCommit(1, true))
      .expect(oa.grants.get(1).st == "none" and oa.reqs.get(1).live and safety)
      .then(approveRead(1, false)).then(approveCommit(1, false)).then(approveLink(1))
      .expect(liveG(oa, 1) and grantHasCodeAndAudit and safety)

  /** SD-393 fix (e2e "a sign-in request with a number is swept 10 minutes after it starts, with no OAuth traffic"). */
  run requestRetentionTest =
    init.then(startAuth(1, "cF", "friends")).then(enterPhone(1, "n1"))
      .then(tickRequests)
      .expect(oa.reqs.get(1).live and requestRetention)
      .then(tickRequests)
      .expect(not(oa.reqs.get(1).live) and requestRetention)

  /** SD-390 fix (e2e "a client whose grant was revoked and deleted stays registered"). */
  run clientSweptTest =
    init.then(connect(1, "cF", false)).then(consentsRevoke(1)).then(clientAges("cF")).then(sweep)
      .expect(oa.grants.get(1).st == "deleted" and oa.clients.get("cF").exists and clientKeptOnceGranted)
      .then(startAuth(2, "cF", "friends"))
      .expect(gh.last.kind == "authorize")
  /** A client that never got a grant is still swept after a day (README section 3). */
  run unusedClientSweptTest =
    init.then(clientAges("cP")).then(sweep)
      .expect(not(oa.clients.get("cP").exists) and clientKeptOnceGranted)

  /** SD-395 fix (e2e "refused profiles do not use up the daily profile quota"). */
  run quotaTest =
    init.then(connectOn(1, "cF", "n2", false))
      .then(submitProfile(1, "friends", "friends")).then(submitProfile(1, "friends", "friends")).then(submitProfile(1, "friends", "friends"))
      .expect(gh.last.kind == "profile" and not(gh.last.ok) and oa.quota.get(1).count == 0 and safety)
  /** The quota still stops the third accepted profile of a joined member (cap 2 in the model). */
  run quotaAcceptedTest =
    init.then(connect(1, "cF", false))
      .then(submitProfile(1, "friends", "friends")).then(submitProfile(1, "friends", "friends"))
      .expect(oa.quota.get(1).accepted == 2)
      .then(submitProfile(1, "friends", "friends"))
      .expect(gh.last.kind == "quotaRefused" and quotaCountsAccepted and safety)

  /** SD-108: a Cloud grant ends on its original number while a native grant carries forward. */
  run cloudMoveTest =
    init.then(connect(1, "cF", true)).then(connect(2, "cP", false)).then(movePhone("p1", "n1", "n2"))
      .expect(numberChangeWorks and pf.owner.get("n2") == "p1" and oa.grants.get(1).phone == "n1"
        and oa.grants.get(1).st == "revoked" and gh.audits.contains(("revoked", 1))
        and liveG(oa, 2) and oa.grants.get(2).phone == "n2" and safety)

  /** SD-186 (c) fix (e2e "revoking one of two live Claude grants keeps the Claude signal active"). */
  run activeTwoGrantsTest =
    init.then(connect(1, "cF", false)).then(connect(2, "cP", false)).then(consentsRevoke(1))
      .expect(liveG(oa, 2) and ib.active.contains("p1") and activeKeptWhileLiveAll and activeExactlyGrants)
      .then(consentsRevoke(2))
      .expect(not(ib.active.contains("p1")) and safety)

  /** Q-oauth_mcp-2 trace: the number moves while an approval waits; revoking the new (old-key) grant turns the signal off. */
  run moveDuringApprovalTest =
    init.then(connect(1, "cF", false)).then(startAuth(2, "cP", "peon")).then(enterPhone(2, "n1")).then(enterCode(2))
      .then(approveRead(2, false)).then(movePhone("p1", "n1", "n2")).then(approveCommit(2, false)).then(approveLink(2))
      .expect(oa.grants.get(1).phone == "n2" and oa.grants.get(2).phone == "n1")
      .then(consentsRevoke(2))
      .expect(liveG(oa, 1) and pc.appr.get(1) == "done" and not(ib.active.contains("p1")) and not(activeKeptWhileLiveAll) and gh.oldKey == Set("p1") and safety)

  /** SD-186 (b) trace, kept by the hook contract: the grant expires; the signal stays on. */
  run activeExpiryTest =
    init.then(connect(1, "cF", false)).then(expireGrant(1))
      .expect(ib.active.contains("p1") and not(activeExactlyGrants) and safety)

  /** SD-384 fix (e2e "a signup draft follows its grant to the new number"). */
  run draftMoveTest =
    init.then(leave("p1", "friends", false)).then(connect(2, "cF", false)).then(prepareSignup(1, "friends", "friends"))
      .expect(oa.drafts.get(2).exists)
      .then(movePhone("p1", "n1", "n2"))
      .expect(oa.grants.get(2).phone == "n2" and oa.drafts.get(2).phone == "n2" and draftFollowsGrant and safety)

  /**
   * Q-oauth_mcp-1 fix (consent-forget.pg.test.ts "a grant approved while the person leaves the app does
   * not stay"): the leave deletes the request before the approval's transaction; the approval stores
   * nothing.
   */
  run consentDuringLeaveTest =
    init.then(startAuth(1, "cF", "friends")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(leave("p1", "friends", false)).then(approveCommit(1, false))
      .expect(gh.last.kind == "approveExpired" and oa.grants.get(1).st == "none" and grantDiesWithPerson and safety)
  /** The other order: the approval commits first (the forget waits on its row lock); the leave deletes the grant. */
  run leaveAfterConsentTest =
    init.then(startAuth(1, "cF", "friends")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveRead(1, false))
      .then(approveCommit(1, false)).then(leave("p1", "friends", false))
      .expect(oa.grants.get(1).st == "deleted" and grantDiesWithPerson and safety)

  /**
   * hub-endpoint.integration.test.ts: a client registered on ntwrk.party connects /mcp/peon; the grant is for peon;
   * its token serves /mcp/peon and is refused on /mcp/friends (grantServesApp).
   */
  run hubAppTest =
    init.then(connectApp(1, "cN", "peon"))
      .expect(oa.grants.get(1).app == "peon" and oa.grants.get(1).client == "cN" and bearerOk(1, HUB, "peon")
        and not(bearerOk(1, HUB, "friends")) and not(bearerOk(1, "peon", "peon")) and safety)
      .then(checkStatus(1, HUB, "peon"))
      .expect(gh.last.kind == "status" and gh.last.app == "peon" and gh.last.status == "active" and safety)
      .then(checkStatus(1, HUB, "friends")).fail()
  /** A token of the hub's /mcp/peon is not valid on the peon site's own /mcp (another resource). */
  run hubTokenOffSiteTest =
    init.then(connectApp(1, "cN", "peon")).then(checkStatus(1, "peon", "peon")).fail()
  /**
   * consents: the friends site removes only friends grants; the hub page removes a grant of any app, also one made on
   * an app site.
   */
  run consentsHostTest =
    init.then(connect(1, "cP", false)).then(consentsRevokeOn(1, "friends")).fail()
  run consentsHubTest =
    init.then(connect(1, "cP", false)).then(consentsRevokeOn(1, HUB))
      .expect(oa.grants.get(1).st == "revoked" and gh.audits.contains(("revoked", 1)) and gh.last.status == HUB and safety)
  /** An app site serves only its own app: the friends site refuses a resource of peon and stores nothing. */
  run siteRefusesOtherAppTest =
    init.then(startAuth(1, "cF", "peon"))
      .expect(gh.last.kind == "invalidTarget" and not(oa.reqs.get(1).live) and safety)
  /** liveRequest: the consent page of a hub request does not continue on the friends site. */
  run consentOtherHostTest =
    init.then(startAuth(1, "cN", "friends")).then(enterPhone(1, "n1")).then(enterCode(1)).then(approveReadOn(1, "friends", false))
      .expect(gh.last.kind == "pageOtherHost" and pc.appr.get(1) == "idle" and oa.grants.get(1).st == "none" and safety)

  run prefillReachableTest =
    init.then(leave("p1", "friends", false)).then(connect(2, "cF", false)).then(prepareSignup(1, "friends", "friends"))
      .then(startAuth(3, "cF", "friends")).then(enterPhone(3, "n1")).then(enterCode(3)).then(openSignup(3))
      .expect(not(witness_prefillShown))

  /**
   * signup-draft-prefill.test.ts: the agent saves a draft through prepare_signup; a new request of the same client,
   * app and phone shows it once; a second open of the form and a request of another client show an empty form.
   */
  run prefillOnceTest =
    init.then(leave("p1", "friends", false)).then(connect(2, "cF", false)).then(prepareSignup(1, "friends", "friends"))
      .expect(oa.drafts.get(2).exists)
      .then(startAuth(1, "cN", "friends")).then(enterPhone(1, "n1")).then(enterCode(1)).then(openSignup(1))
      .expect(gh.last.kind == "prefill" and not(gh.last.ok) and not(oa.drafts.get(2).used))
      .then(startAuth(3, "cF", "friends")).then(enterPhone(3, "n1")).then(enterCode(3)).then(openSignup(3))
      .expect(gh.last.kind == "prefill" and gh.last.ok and oa.drafts.get(2).used and gh.prefills.size() == 1 and safety)
      .then(openSignup(3))
      .expect(gh.last.kind == "prefill" and not(gh.last.ok) and gh.prefills.size() == 1 and prefillAtMostOnce and safety)
  /** signupClientAllowed: a peon request, also on the hub, has no signup form (browserSignupAppAllowed). */
  run signupNotForPeonTest =
    init.then(leave("p1", "peon", false)).then(startAuth(1, "cN", "peon")).then(enterPhone(1, "n1")).then(enterCode(1))
      .expect(oa.reqs.get(1).step == "consent" and statusOf(pf, "p1", "peon") == "not_joined")
      .then(openSignup(1)).fail()
}
```
