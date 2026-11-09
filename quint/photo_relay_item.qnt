// -*- mode: Bluespec; -*-
// quint-check: max-steps=16 max-samples=4000
//
// photo_relay_item: one selected-photo relay item, from the member's consent to the provider fetch.
//
// WHAT THIS MODELS
//   PhotoRelayService (packages/platform/src/photo-relay.ts) for one item: select, review, revoke,
//   claimForAction, issueDelivery and delivery. Each LemmaScript function of
//   packages/platform/src/photo-relay-core.ts is a pure def here with the same name and the same
//   decision. Each action is one shell method under the item lock (PhotoRelayStore.locked); it calls
//   these defs and does not decide again. `current` is the shell's PhotoRelayService.current (policy,
//   expiry, parties, photo); the oracle `pair` stands for both of its outside reads: the parties check
//   (authorize, RelayDesk: match, adults, no block, no STOP) and the photo check (photos.relayPhoto: the
//   owner may still take photos and the row is there with the same bytes). Both are read again on each
//   call, so `pair` can come back (START after STOP, a hold lifted).
//   relay.qnt (claude/quint-state-machines) holds the same item inside the whole relay desk. This
//   model adds the consent input and the notice version, which relay.qnt leaves implicit.
//
// BOUNDS
//   One item, two notice versions (1 and 2), two action ids, two provider intents. Time steps of 1,
//   10 and 20 units; the item lives PHOTO_TTL = 15 and a fetch capability FETCH_TTL = 4 (the code:
//   15 minutes and 60 seconds; only the order of the values matters).
//
// RUN (quint 0.33.1)
//   bun run quint:check quint/photo_relay_item.qnt
//
// OUTSIDE THE MODEL
//   The photo bytes, the HMAC signature (an oracle: only the issued exp verifies), SQL and the row
//   lock (each action is atomic), the request id and the request hash (replay returns the same item),
//   the reviewer authorization (authorizeReviewer: a refused reviewer changes nothing), and the
//   descriptor and recipient checks of issueDelivery (a mismatch changes nothing).
module photo_relay_item {

  pure val PHOTO_TTL = 15
  pure val FETCH_TTL = 4
  pure val NONE = -1
  pure val ACTIONS = Set("act1", "act2")
  pure val INTENTS = Set("int1", "int2")

  type Item = {
    selected: bool, state: str, consent: bool, noticeVersion: int, expiresAt: int,
    boundAction: str, intent: str, deliveryExpiresAt: int,
  }
  type Ghost = {
    fetches: int,
    fetchedWithoutConsent: bool,  // a fetch of an item whose select had no consent to the policy version
    fetchedNotApproved: bool,     // a fetch of an item that is not approved, or not reviewed safe
    fetchedLate: bool,            // a fetch at or after the item or capability expired
    badEdge: bool,                // a state change that photoEdge does not allow
    actionChanged: bool,          // a claimed item got another action id
    reviewedSafe: bool,           // a safe review moved the item to approved
    revokedClaimed: bool,
  }

  var now: int
  var policyVersion: int          // the version of the configured PhotoRelayPolicy
  var pair: bool                  // RelayDesk authorize: active mutual match, adults, no block, no STOP
  var pri: Item
  var g: Ghost

  // ---------------------------------------------------------------- the core (photo-relay-core.ts)

  pure def photoEdge(src: str, dst: str): bool =
    dst == "revoked" or (src == "pending" and (dst == "approved" or dst == "rejected"))

  pure def photoSelectGate(requestIdOk: bool, isEnabled: bool, photoIdOk: bool, threadOk: bool,
                           consent: bool, noticeVersion: int, policyVersion: int): bool =
    requestIdOk and isEnabled and photoIdOk and threadOk and consent and noticeVersion == policyVersion

  pure def photoReviewable(state: str): bool = state == "pending" or state == "approved"

  // "" stands for null.
  pure def photoReviewNext(state: str, decision: str, expired: bool, current: bool): str =
    if (not(photoReviewable(state)) or expired) ""
    else if (decision == "safe") (if (state == "pending" and current) "approved" else "")
    else if (decision == "unsafe") (if (state == "approved") "revoked" else "rejected")
    else ""

  pure def photoHeld(state: str, hasAction: bool): bool =
    state == "pending" or (state == "approved" and not(hasAction))

  pure def photoUnclaimed(state: str, hasAction: bool): bool = state == "approved" and not(hasAction)

  pure def photoClaimable(state: str, hasAction: bool, boundAction: str, actionId: str): bool =
    state == "approved" and (not(hasAction) or boundAction == actionId)

  pure def photoMayIssue(state: str, hasAction: bool, hasIntent: bool, boundIntent: str, intent: str): bool =
    hasAction and state == "approved" and (not(hasIntent) or boundIntent == intent)

  pure def photoDeliveryDeadline(hasDeliveryExp: bool, deliveryExpiresAt: int, expiresAt: int, at: int, fetchTtl: int): int =
    if (hasDeliveryExp) deliveryExpiresAt else if (expiresAt < at + fetchTtl) expiresAt else at + fetchTtl

  pure def photoFetchable(state: str, hasAction: bool, hasIntent: bool, exp: int, at: int,
                          hasDeliveryExp: bool, deliveryExpiresAt: int, expiresAt: int): bool =
    hasAction and hasIntent and state == "approved" and exp > at and hasDeliveryExp
    and exp == deliveryExpiresAt and exp <= expiresAt

  // ---------------------------------------------------------------- the shell (photo-relay.ts)

  // PhotoRelayService.current: the policy and the notice did not change, not expired, not revoked or
  // rejected, and the parties still pass.
  def current(i: Item): bool =
    i.selected and i.noticeVersion == policyVersion and i.expiresAt > now
    and i.state != "revoked" and i.state != "rejected" and pair

  def setState(i: Item, dst: str): Ghost =
    { ...g, badEdge: g.badEdge or not(photoEdge(i.state, dst)) }

  action init = all {
    now' = 0,
    policyVersion' = 1,
    pair' = true,
    pri' = { selected: false, state: "", consent: false, noticeVersion: NONE, expiresAt: NONE,
              boundAction: "", intent: "", deliveryExpiresAt: NONE },
    g' = { fetches: 0, fetchedWithoutConsent: false, fetchedNotApproved: false, fetchedLate: false,
           badEdge: false, actionChanged: false, reviewedSafe: false, revokedClaimed: false },
  }

  // select: the member asks to share the photo, with or without consent, for one notice version.
  action selectPhoto(consent: bool, notice: int): bool = all {
    not(pri.selected),
    photoSelectGate(true, true, true, true, consent, notice, policyVersion),
    pair,
    pri' = { selected: true, state: "pending", consent: consent, noticeVersion: notice,
              expiresAt: now + PHOTO_TTL, boundAction: "", intent: "", deliveryExpiresAt: NONE },
    now' = now, policyVersion' = policyVersion, pair' = pair, g' = g,
  }

  // review: a reviewer decides. The first expiry check is the shell's, the second is the core's.
  action review(decision: str): bool = {
    val cur = decision == "safe" and pri.state == "pending" and current(pri)
    val nxt = photoReviewNext(pri.state, decision, now >= pri.expiresAt, cur)
    all {
      pri.selected, pri.noticeVersion == policyVersion, photoReviewable(pri.state),
      decision == "safe" or decision == "unsafe", now < pri.expiresAt,
      nxt != "",
      pri' = { ...pri, state: nxt },
      g' = { ...setState(pri, nxt), reviewedSafe: g.reviewedSafe or nxt == "approved",
             revokedClaimed: g.revokedClaimed or (nxt == "revoked" and pri.boundAction != "") },
      now' = now, policyVersion' = policyVersion, pair' = pair,
    }
  }

  // revoke: the sender withdraws the item, in every state, also after a STOP or a policy change.
  action revoke: bool = all {
    pri.selected,
    pri' = { ...pri, state: "revoked" },
    g' = { ...setState(pri, "revoked"), revokedClaimed: g.revokedClaimed or pri.boundAction != "" },
    now' = now, policyVersion' = policyVersion, pair' = pair,
  }

  // claimForAction, in the completeAction transaction. approvedForParty (photoUnclaimed) picks the
  // item first, but a retry of the same action reaches claimForAction with a claimed item.
  action claim(actionId: str): bool = all {
    pri.selected,
    photoClaimable(pri.state, pri.boundAction != "", pri.boundAction, actionId),
    current(pri),
    pri' = { ...pri, boundAction: actionId },
    g' = { ...g, actionChanged: g.actionChanged or (pri.boundAction != "" and pri.boundAction != actionId) },
    now' = now, policyVersion' = policyVersion, pair' = pair,
  }

  // issueDelivery: the first issue fixes the deadline; the same intent keeps it.
  action issue(intent: str): bool = {
    val exp = photoDeliveryDeadline(pri.deliveryExpiresAt != NONE, pri.deliveryExpiresAt, pri.expiresAt, now, FETCH_TTL)
    all {
      pri.selected,
      photoMayIssue(pri.state, pri.boundAction != "", pri.intent != "", pri.intent, intent),
      current(pri),
      exp > now,
      pri' = { ...pri, intent: intent, deliveryExpiresAt: exp },
      now' = now, policyVersion' = policyVersion, pair' = pair, g' = g,
    }
  }

  // delivery: the provider (or anyone with a URL) fetches with a signed exp. Only the issued exp has a
  // valid signature, so the other values model a forged or old link.
  action fetch(exp: int): bool = all {
    pri.selected,
    photoFetchable(pri.state, pri.boundAction != "", pri.intent != "", exp, now,
                   pri.deliveryExpiresAt != NONE, pri.deliveryExpiresAt, pri.expiresAt),
    exp == pri.deliveryExpiresAt,
    current(pri),
    g' = { ...g, fetches: g.fetches + 1,
           fetchedWithoutConsent: g.fetchedWithoutConsent or not(pri.consent),
           fetchedNotApproved: g.fetchedNotApproved or pri.state != "approved" or not(g.reviewedSafe),
           fetchedLate: g.fetchedLate or now >= exp or now >= pri.expiresAt },
    pri' = pri, now' = now, policyVersion' = policyVersion, pair' = pair,
  }

  action tick(d: int): bool = all {
    now' = now + d,
    pri' = pri, policyVersion' = policyVersion, pair' = pair, g' = g,
  }

  // The policy version changes (a new notice), or the match ends, a block or a STOP comes.
  action policyChange: bool = all {
    policyVersion' = 3 - policyVersion,
    now' = now, pri' = pri, pair' = pair, g' = g,
  }
  action pairEnds: bool = all {
    pair' = false,
    now' = now, pri' = pri, policyVersion' = policyVersion, g' = g,
  }
  // authorize and relayPhoto are read again on every call: a START after a STOP or a lifted hold
  // makes the item current again (photo-relay.ts current).
  action pairResumes: bool = all {
    not(pair),
    pair' = true,
    now' = now, pri' = pri, policyVersion' = policyVersion, g' = g,
  }

  action step = any {
    nondet consent = Set(true, false).oneOf()
    nondet notice = Set(1, 2).oneOf()
    selectPhoto(consent, notice),
    nondet decision = Set("safe", "unsafe", "unknown").oneOf()
    review(decision),
    nondet a = ACTIONS.oneOf()
    claim(a),
    nondet i = INTENTS.oneOf()
    issue(i),
    nondet e = Set(pri.deliveryExpiresAt, pri.deliveryExpiresAt + 1, now + FETCH_TTL, pri.expiresAt).oneOf()
    fetch(e),
    nondet d = Set(1, 10, 20).oneOf()
    tick(d),
    any { revoke, policyChange, pairEnds, pairResumes },
  }

  // ---------------------------------------------------------------- invariants

  // Rule: the platform never sends a member's photo without that member's consent to the notice
  // that is in force (founder decision 9, "per-item consent check"; CLAUDE.md, Relay).
  // LemmaScript: photoSelectGate `ensures \result ==> s.consent && s.noticeVersion === s.policyVersion`.
  // Code: photo-relay.ts select (photoSelectGate) and delivery (photoFetchable, current).
  val fetchOnlyWithConsent = not(g.fetchedWithoutConsent)

  // Rule: every proactive or member item goes through human review before anyone is contacted
  // (CLAUDE.md, Code invariants). LemmaScript: photoReviewNext `ensures \result === "approved" ==>
  // state === "pending" && decision === "safe" && current`, photoFetchable `ensures \result ==>
  // f.state === "approved"`. Code: photo-relay.ts review, delivery.
  val fetchOnlyApprovedReviewed = not(g.fetchedNotApproved)

  // Rule: the item moves only along the allowed edges (relay.qnt photo-relay-item).
  // LemmaScript: photoReviewNext `ensures \result !== null ==> photoEdge(state, \result)`,
  // photoRevokeNext `ensures photoEdge(state, \result)`. Code: photo-relay.ts review, revoke.
  val edgesOnly = not(g.badEdge)

  // Rule: an approved item was reviewed safe, and was selected with consent (as above).
  val approvedWasReviewed = pri.state != "approved" or (g.reviewedSafe and pri.consent)

  // Rule: a fetch capability never outlives the item, and a fetch is before both deadlines
  // (photo-relay.ts issueDelivery comment). LemmaScript: photoDeliveryDeadline, photoFetchable.
  val deadlineInItem = pri.deliveryExpiresAt == NONE or pri.deliveryExpiresAt <= pri.expiresAt
  val fetchInTime = not(g.fetchedLate)

  // Rule: one selection binds one action (photo-relay.ts claimForAction comment).
  // LemmaScript: photoClaimable `ensures \result && hasAction ==> boundAction === actionId`.
  val oneAction = not(g.actionChanged)

  val safety = and {
    fetchOnlyWithConsent, fetchOnlyApprovedReviewed, edgesOnly, approvedWasReviewed,
    deadlineInItem, fetchInTime, oneAction,
  }

  // ---------------------------------------------------------------- reachability witnesses (expected VIOLATED)
  // The provider fetches the photo.
  val witness_noFetch = g.fetches == 0
  // An unsafe review revokes an item that an action claimed.
  val witness_noRevokedClaim = not(g.revokedClaimed)
  // An unsafe review rejects a pending item.
  val witness_noRejected = pri.state != "rejected"

  // ---------------------------------------------------------------- traces
  run happyPathTest =
    init
      .then(selectPhoto(true, 1))
      .then(review("safe"))
      .then(claim("act1"))
      .then(issue("int1"))
      .then(fetch(FETCH_TTL))
      .then(all { assert(g.fetches == 1), assert(safety), tick(1) })

  run noConsentNoItemTest =
    init
      .then(selectPhoto(false, 1))
      .fail()

  run oldNoticeNoItemTest =
    init
      .then(selectPhoto(true, 2))
      .fail()

  run expiredNoReviewTest =
    init
      .then(selectPhoto(true, 1))
      .then(tick(20))
      .then(review("safe"))
      .fail()

  run unsafeAfterClaimRevokesTest =
    init
      .then(selectPhoto(true, 1))
      .then(review("safe"))
      .then(claim("act1"))
      .then(review("unsafe"))
      .then(all { assert(pri.state == "revoked"), assert(safety), tick(1) })
      .then(issue("int1"))
      .fail()

  run secondActionRefusedTest =
    init
      .then(selectPhoto(true, 1))
      .then(review("safe"))
      .then(claim("act1"))
      .then(claim("act2"))
      .fail()
}
