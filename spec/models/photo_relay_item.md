# Selected-photo delivery

## Story: Selected-photo delivery

A member needs to consent to sending a selected photo and withdraw that consent before delivery.

### Safety rules and reachability

Check review, consent, claim deadlines, and provider fetch eligibility. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Imported from `quint/photo_relay_item.qnt` at `30d950e`. Compared again with the code of branch `vibestack-matching` on 2026-11-18. See [model index](README.md) for scope and commands.

Production uses [selected-photo consent and review](../photoRelayReview.md) for selection, review, visibility, and cancellation. It uses [selected-photo relay delivery](../photoRelayItem.md) for the photo choice by text, claim, capability binding, and fetch admission. This model covers the whole flow.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=16 max-samples=4000
//
// photo_relay_item: one selected-photo relay item, from the member's choice and consent to the provider fetch.
//
// WHAT THIS MODELS (compared with branch vibestack-matching on 2026-11-18; code locations are names)
//   PhotoRelayService (packages/platform/src/photo-relay.ts) for one item: select, review, revoke,
//   claimForAction, issueDelivery and delivery, and the conversation step choosePhoto
//   (packages/network/service/photoIntakeRelayChoice.ts, called by /internal/relay in relay-endpoint.ts).
//   The pure defs below have the names and the decisions of the generated specs that the shell calls:
//   spec/photoRelayReview.md (checkSelection, photoReviewable, photoReviewMayProceed, recordReview,
//   photoHeldForReview, revokeSelection) and spec/photoRelayItem.md (canClaimAction, permitsIntentBinding,
//   deadlineForDelivery, photoFetchAllowed, photoDeliveryStillLive, photoRelayOfferLive). The item state is a
//   string here: "pending", "approved", "rejected", "revoked" (the shell's storedReview map). Each action is
//   one shell method under the item lock (PhotoRelayStore.locked). `current` is PhotoRelayService.current
//   (policy version and notice, expiry, not revoked or rejected, parties, photo); the oracle `pair` stands for
//   both of its outside reads: the parties (authorize: match, adults, no block, no STOP, no hold) and the photo
//   (photos.relayPhoto: the owner may still take photos, and the row has the same bytes). Both are read again
//   on each call, so `pair` can come back (START after STOP, a hold lifted). `policyVersion` merges the
//   policy version and its notice text.
//   Production binds the action id `photo-selection:<itemId>` in both callers (relay-endpoint.ts and the
//   staff release in service.ts), so every claim of one item uses the same id; the model lets the id vary to
//   check the binding rule itself. A second provider intent is refused (permitsIntentBinding).
//
// BOUNDS
//   One item, two notice versions (1 and 2), two action ids, two provider intents. Time steps of 1,
//   10 and 20 units; the item lives PHOTO_TTL = 15 (relayItemTtlMs, 15 minutes), the text offer
//   OFFER_TTL = 15 (photoRelayOfferTtlMs, 15 minutes) and a fetch capability FETCH_TTL = 4
//   (providerFetchTtlMs, 60 seconds; only the order of the values matters).
//
// OUTSIDE THE MODEL
//   The photo bytes, the HMAC signature (an oracle: only the issued exp verifies), SQL and the row
//   lock (each action is atomic), the request id and the request hash (replay returns the same item),
//   the reviewer authorization (authorizeReviewer: a refused reviewer changes nothing), the staff preview
//   token, the descriptor and recipient checks of issueDelivery (a mismatch changes nothing), the outbound
//   row checks of resolveRelayPhoto, and the choice of which offered photo (one item stands for it).
//   choosePhoto (photoIntakeRelayChoice.ts:51) is abstracted: relayOn is the constant true (the
//   PhotoRelayOff branch, relay.enabled false or no notice, is not explored), approvedReady is false as the
//   code passes it (DeliverApprovedPhoto is never taken there), photoCount is 1, and the stored list always
//   has OFFER_SIZE = 2 ids (the code passes offered.length, up to the upload limit, and a list may be longer
//   or shorter than the photos now live). The code's offer check compares policy_version and policy_notice;
//   the model compares only offerVersion, because policyVersion merges the version and its notice text.
//
// KNOWN CODE DEFECT (2026-11-18; spec/models/README.md)
//   PRI-D1 PhotoRelayService.revoke has one caller: the signed-in site route /api/relay-photos/revoke. The
//   conversation (/internal/relay, choosePhoto) has no withdraw command, and the sites have no account
//   portal (founder correction 2026-10-19), so a member who chose a photo by text cannot withdraw it before
//   delivery. The `revoke` action below is the intended behaviour (the story: withdraw consent before
//   delivery), not the code as it is.
module photo_relay_item {

  pure val PHOTO_TTL = 15
  pure val OFFER_TTL = 15
  pure val FETCH_TTL = 4
  pure val NONE = -1
  pure val ACTIONS = Set("act1", "act2")
  pure val INTENTS = Set("int1", "int2")
  /** The number of photos on the offered list (photo_ids); one item stands for the chosen one. */
  pure val OFFER_SIZE = 2
  /** "send them my photo" (0) and "send them my photo N" (photoChoice). */
  pure val CHOICES = Set(0, 1, 2, 3)

  type Item = {
    selected: bool, state: str, consent: bool, noticeVersion: int, expiresAt: int,
    boundAction: str, intent: str, deliveryExpiresAt: int,
  }
  type Ghost = {
    fetches: int,
    fetchedWithoutConsent: bool,  // a fetch of an item whose select had no consent to the policy version
    fetchedNotApproved: bool,     // a fetch of an item that is not approved, or not reviewed safe
    fetchedLate: bool,            // a fetch at or after the item or capability expired
    badEdge: bool,                // a state change that the review machine does not allow
    actionChanged: bool,          // a claimed item got another action id
    intentChanged: bool,          // a bound provider intent changed
    deadlineChanged: bool,        // a fixed delivery deadline changed
    unrevoked: bool,              // a revoked item left "revoked"
    approvedNotByReview: bool,    // an item became approved by a step other than a review
    reviewedSafe: bool,           // a safe review moved the item to approved
    revokedClaimed: bool,
    textChoice: bool,             // the item came from a numbered choice by text
    choiceWithoutLiveOffer: bool, // a text choice recorded an item without a live list of the same notice
    choiceOutsideList: bool,      // a text choice recorded an item for a number that is not on the list
  }

  var now: int
  var policyVersion: int          // the version (and notice) of the configured PhotoRelayPolicy
  var pair: bool                  // authorize and relayPhoto: active mutual match, adults, no block, no STOP, photo there
  var offerAt: int                // platform.photo_relay_offers.offered_at for this match (NONE: no list)
  var offerVersion: int           // the policy version and notice of that list
  var pri: Item
  var g: Ghost

  // ---------------------------------------------------------------- the generated decisions
  // spec/photoRelayReview.md
  pure def checkSelection(inputValid: bool, consent: bool, noticeVersion: int, policyVersion: int): bool =
    inputValid and consent and noticeVersion == policyVersion
  pure def photoReviewable(state: str): bool = state == "pending" or state == "approved"
  pure def reviewNeedsCurrent(decision: str): bool = decision == "safe"
  pure def photoReviewMayProceed(state: str, decision: str, reviewerAuthorized: bool, itemLive: bool): bool =
    photoReviewable(state) and reviewerAuthorized and itemLive
    and (decision == "unsafe" or (decision == "safe" and state == "pending"))
  pure def canRecordReview(state: str, decision: str, reviewerAuthorized: bool, currentItem: bool, itemLive: bool): bool =
    photoReviewMayProceed(state, decision, reviewerAuthorized, itemLive) and (not(reviewNeedsCurrent(decision)) or currentItem)
  pure def recordReview(state: str, decision: str): str =
    if (decision == "safe") "approved" else if (state == "approved") "revoked" else "rejected"
  pure def photoHeldForReview(state: str, claimed: bool): bool =
    photoReviewable(state) and (state == "pending" or not(claimed))
  // The allowed edges of the review machine (recordReview, revokeSelection).
  pure def photoEdge(src: str, dst: str): bool =
    dst == "revoked" or (src == "pending" and (dst == "approved" or dst == "rejected"))

  // spec/photoRelayItem.md
  pure def canClaimAction(state: str, hasAction: bool, boundAction: str, actionId: str, currentItem: bool): bool =
    currentItem and state == "approved" and (not(hasAction) or boundAction == actionId)
  pure def permitsIntentBinding(state: str, boundAction: str, hasIntent: bool, boundIntent: str, intent: str): bool =
    state == "approved" and boundAction != "" and (not(hasIntent) or boundIntent == intent)
  pure def deadlineForDelivery(hasDeadline: bool, deliveryUntil: int, expiresAt: int, at: int, fetchTtl: int): int =
    if (hasDeadline) deliveryUntil else if (expiresAt < at + fetchTtl) expiresAt else at + fetchTtl
  pure def photoDeliveryStillLive(deadline: int, expiresAt: int, at: int): bool = deadline > at and expiresAt > at
  pure def photoFetchAllowed(i: Item, deadline: int, at: int): bool =
    i.state == "approved" and i.boundAction != "" and i.intent != "" and i.deliveryExpiresAt != NONE
    and deadline == i.deliveryExpiresAt and deadline <= i.expiresAt and photoDeliveryStillLive(deadline, i.expiresAt, at)
  pure def photoRelayOfferLive(offeredAt: int, at: int, sameNotice: bool): bool =
    sameNotice and at >= offeredAt and at - offeredAt < OFFER_TTL
  pure def photoRelayEntryFor(relayOn: bool, approvedReady: bool, photoCount: int, choice: int, offerLive: bool, offerSize: int): str =
    if (approvedReady) "DeliverApprovedPhoto"
    else if (not(relayOn)) "PhotoRelayOff"
    else if (choice == 0 and photoCount > 0) "OfferPhotoChoices"
    else if (choice == 0) "AskForPhotosFirst"
    else if (offerLive and choice >= 1 and choice <= offerSize) "RecordPhotoChoice"
    else "PhotoChoiceUnknown"

  // ---------------------------------------------------------------- the shell (photo-relay.ts)

  // PhotoRelayService.current: the policy and the notice did not change, not expired, not revoked or
  // rejected, and the parties and the photo still pass.
  def current(i: Item): bool =
    i.selected and i.noticeVersion == policyVersion and i.expiresAt > now
    and i.state != "revoked" and i.state != "rejected" and pair

  def ghostFor(i: Item, nxt: Item): Ghost = {
    ...g,
    badEdge: g.badEdge or (nxt.state != i.state and not(photoEdge(i.state, nxt.state))),
    actionChanged: g.actionChanged or (i.boundAction != "" and nxt.boundAction != i.boundAction),
    intentChanged: g.intentChanged or (i.intent != "" and nxt.intent != i.intent),
    deadlineChanged: g.deadlineChanged or (i.deliveryExpiresAt != NONE and nxt.deliveryExpiresAt != i.deliveryExpiresAt),
    unrevoked: g.unrevoked or (i.state == "revoked" and nxt.state != "revoked"),
    approvedNotByReview: g.approvedNotByReview or (i.state != "approved" and nxt.state == "approved"),
  }

  action init = all {
    now' = 0,
    policyVersion' = 1,
    pair' = true,
    offerAt' = NONE,
    offerVersion' = NONE,
    pri' = { selected: false, state: "", consent: false, noticeVersion: NONE, expiresAt: NONE,
              boundAction: "", intent: "", deliveryExpiresAt: NONE },
    g' = { fetches: 0, fetchedWithoutConsent: false, fetchedNotApproved: false, fetchedLate: false,
           badEdge: false, actionChanged: false, intentChanged: false, deadlineChanged: false, unrevoked: false,
           approvedNotByReview: false, reviewedSafe: false, revokedClaimed: false,
           textChoice: false, choiceWithoutLiveOffer: false, choiceOutsideList: false },
  }

  action frame = all { now' = now, policyVersion' = policyVersion, pair' = pair, offerAt' = offerAt, offerVersion' = offerVersion }

  // select from the site route (/api/relay-photos/select): the member sends the notice version and consent.
  // checkSelection, checkParties and checkPhoto (pair), resolveNotice, then a pending item.
  action selectPhoto(consent: bool, notice: int): bool = all {
    not(pri.selected),
    checkSelection(true, consent, notice, policyVersion),
    pair,
    pri' = { selected: true, state: "pending", consent: consent, noticeVersion: notice,
              expiresAt: now + PHOTO_TTL, boundAction: "", intent: "", deliveryExpiresAt: NONE },
    frame, g' = g,
  }

  // choosePhoto, OfferPhotoChoices: "send them my photo" with no approved item ready: the shell stores the
  // numbered list with the current notice for this match (upsert: a new list replaces the old one).
  action offerList: bool = all {
    not(pri.selected and pri.state == "approved" and pri.boundAction == "" and current(pri)),
    offerAt' = now, offerVersion' = policyVersion,
    now' = now, policyVersion' = policyVersion, pair' = pair, pri' = pri, g' = g,
  }

  // choosePhoto: "send them my photo N". The shell computes live as the code does (a stored list and
  // photoRelayOfferLive with the same notice) and takes the branch that photoRelayEntryFor returns. Only
  // RecordPhotoChoice records one pending item through select (consent true, the current version). The
  // ghosts below restate "a live list of the notice in force" and "a number on the list" from the raw
  // state, not from these decisions, so the two laws check the entry decision as the shell calls it.
  action chooseByText(choice: int): bool = {
    val live = offerAt != NONE and photoRelayOfferLive(offerAt, now, offerVersion == policyVersion)
    all {
    not(pri.selected),
    photoRelayEntryFor(true, false, 1, choice, live, OFFER_SIZE) == "RecordPhotoChoice",
    checkSelection(true, true, policyVersion, policyVersion),
    pair,
    pri' = { selected: true, state: "pending", consent: true, noticeVersion: policyVersion,
              expiresAt: now + PHOTO_TTL, boundAction: "", intent: "", deliveryExpiresAt: NONE },
    g' = { ...g, textChoice: true,
           choiceWithoutLiveOffer: g.choiceWithoutLiveOffer or offerAt == NONE or offerVersion != policyVersion
             or now < offerAt or now - offerAt >= OFFER_TTL,
           choiceOutsideList: g.choiceOutsideList or choice < 1 or choice > OFFER_SIZE },
    frame,
    }
  }

  // review: a designated reviewer decides (the staff release reviews "safe", the staff reject "unsafe").
  // The shell refuses a policy change first; photoReviewMayProceed checks the live deadline; an approval
  // needs current; the save is under the item lock.
  action review(decision: str): bool = {
    val live = now < pri.expiresAt
    val cur = not(reviewNeedsCurrent(decision)) or current(pri)
    val nxt = { ...pri, state: recordReview(pri.state, decision) }
    all {
      pri.selected, pri.noticeVersion == policyVersion,
      decision == "safe" or decision == "unsafe" or decision == "unknown",
      canRecordReview(pri.state, decision, true, cur, live),
      pri' = nxt,
      g' = { ...ghostFor(pri, nxt), approvedNotByReview: g.approvedNotByReview, reviewedSafe: g.reviewedSafe or nxt.state == "approved",
             revokedClaimed: g.revokedClaimed or (nxt.state == "revoked" and pri.boundAction != "") },
      frame,
    }
  }

  // revoke: the sender withdraws the item, in every state, also after a STOP or a policy change
  // (revokeSelection; the site route /api/relay-photos/revoke).
  action revoke: bool = {
    val nxt = { ...pri, state: "revoked" }
    all {
      pri.selected,
      pri' = nxt,
      g' = { ...ghostFor(pri, nxt), revokedClaimed: g.revokedClaimed or pri.boundAction != "" },
      frame,
    }
  }

  // claimForAction, in the completeAction transaction. approvedForParty (photoHeldForReview with no claim)
  // picks the item first, but a retry of the same action reaches claimForAction with a claimed item.
  action claim(actionId: str): bool = {
    val nxt = { ...pri, boundAction: actionId }
    all {
      pri.selected,
      canClaimAction(pri.state, pri.boundAction != "", pri.boundAction, actionId, current(pri)),
      pri' = nxt,
      g' = ghostFor(pri, nxt),
      frame,
    }
  }

  // issueDelivery: the first issue fixes the deadline; the same intent keeps it (canIssueDelivery).
  action issue(intent: str): bool = {
    val exp = deadlineForDelivery(pri.deliveryExpiresAt != NONE, pri.deliveryExpiresAt, pri.expiresAt, now, FETCH_TTL)
    val nxt = { ...pri, intent: intent, deliveryExpiresAt: exp }
    all {
      pri.selected,
      permitsIntentBinding(pri.state, pri.boundAction, pri.intent != "", pri.intent, intent),
      current(pri),
      exp > now,
      pri' = nxt,
      g' = ghostFor(pri, nxt),
      frame,
    }
  }

  // delivery: the provider (or anyone with a URL) fetches with a signed exp. Only the issued exp has a
  // valid signature, so the other values model a forged or old link.
  action fetch(exp: int): bool = all {
    pri.selected,
    exp > now, exp <= now + FETCH_TTL,
    photoFetchAllowed(pri, exp, now),
    exp == pri.deliveryExpiresAt,
    current(pri),
    photoDeliveryStillLive(exp, pri.expiresAt, now),
    g' = { ...g, fetches: g.fetches + 1,
           fetchedWithoutConsent: g.fetchedWithoutConsent or not(pri.consent),
           fetchedNotApproved: g.fetchedNotApproved or pri.state != "approved" or not(g.reviewedSafe),
           fetchedLate: g.fetchedLate or now >= exp or now >= pri.expiresAt },
    pri' = pri, frame,
  }

  action tick(d: int): bool = all {
    now' = now + d,
    pri' = pri, policyVersion' = policyVersion, pair' = pair, offerAt' = offerAt, offerVersion' = offerVersion, g' = g,
  }

  // The policy version changes (a new notice), or the match ends, a block or a STOP comes.
  action policyChange: bool = all {
    policyVersion' = 3 - policyVersion,
    now' = now, pri' = pri, pair' = pair, offerAt' = offerAt, offerVersion' = offerVersion, g' = g,
  }
  action pairEnds: bool = all {
    pair' = false,
    now' = now, pri' = pri, policyVersion' = policyVersion, offerAt' = offerAt, offerVersion' = offerVersion, g' = g,
  }
  // authorize and relayPhoto are read again on every call: a START after a STOP or a lifted hold
  // makes the item current again (photo-relay.ts current).
  action pairResumes: bool = all {
    not(pair),
    pair' = true,
    now' = now, pri' = pri, policyVersion' = policyVersion, offerAt' = offerAt, offerVersion' = offerVersion, g' = g,
  }

  action step = any {
    nondet consent = Set(true, false).oneOf()
    nondet notice = Set(1, 2).oneOf()
    selectPhoto(consent, notice),
    offerList,
    nondet choice = CHOICES.oneOf()
    chooseByText(choice),
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
  // that is in force (founder decision 9, "per-item consent check"). Generated: checkSelection.
  // Both ways to make an item (selectPhoto, chooseByText) call checkSelection with consent, so this rule
  // mostly restates their guards; it guards against a later path that makes an item without it.
  // Code: photo-relay.ts select and delivery (photoFetchAllowed, current).
  val fetchOnlyWithConsent = not(g.fetchedWithoutConsent)

  // Rule: every member item goes through human review before anyone is contacted (AGENTS.md, Code
  // invariants). Generated: photoReviewMayProceed, recordReview, photoFetchAllowed.
  val fetchOnlyApprovedReviewed = not(g.fetchedNotApproved)

  // Rule: the item moves only along the allowed edges of the review machine.
  val edgesOnly = not(g.badEdge)

  // stepOnlyReviewApproves and stepRevocationIsFinal (spec/photoRelayReview.md) across the whole flow.
  val stepOnlyReviewApproves = not(g.approvedNotByReview)
  val stepRevocationIsFinal = not(g.unrevoked)

  // Rule: an approved item was reviewed safe, and was selected with consent (as above).
  val approvedWasReviewed = pri.state != "approved" or (g.reviewedSafe and pri.consent)

  // Rule: a fetch capability never outlives the item, and a fetch is before both deadlines
  // (deadlineForDelivery, photoFetchAllowed, photoDeliveryStillLive).
  val deadlineInItem = pri.deliveryExpiresAt == NONE or pri.deliveryExpiresAt <= pri.expiresAt
  val fetchInTime = not(g.fetchedLate)

  // stepAnActionBindingNeverChanges, stepAnIntentBindingNeverChanges, stepAFixedDeadlineNeverChanges
  // (spec/photoRelayItem.md) across the whole flow, with the review and revocation steps between them.
  val stepAnActionBindingNeverChanges = not(g.actionChanged)
  val stepAnIntentBindingNeverChanges = not(g.intentChanged)
  val stepAFixedDeadlineNeverChanges = not(g.deadlineChanged)

  // lawChoiceNeedsLiveOffer and lawChoiceStaysInsideTheList (spec/photoRelayItem.md): a choice by text
  // records an item only from a live list of the notice in force, and only for a number on that list.
  val lawChoiceNeedsLiveOffer = not(g.choiceWithoutLiveOffer)
  val lawChoiceStaysInsideTheList = not(g.choiceOutsideList)

  val safety = and {
    fetchOnlyWithConsent, fetchOnlyApprovedReviewed, edgesOnly, stepOnlyReviewApproves, stepRevocationIsFinal,
    approvedWasReviewed, deadlineInItem, fetchInTime,
    stepAnActionBindingNeverChanges, stepAnIntentBindingNeverChanges, stepAFixedDeadlineNeverChanges,
    lawChoiceNeedsLiveOffer, lawChoiceStaysInsideTheList,
  }

  // ---------------------------------------------------------------- reachability witnesses (expected VIOLATED)
  // The provider fetches the photo.
  val witness_noFetch = g.fetches == 0
  // An unsafe review revokes an item that an action claimed.
  val witness_noRevokedClaim = not(g.revokedClaimed)
  // An unsafe review rejects a pending item.
  val witness_noRejected = pri.state != "rejected"
  // A photo chosen by text is fetched.
  val witness_noTextFetch = not(g.textChoice and g.fetches > 0)

  // ---------------------------------------------------------------- traces
  run happyPathTest =
    init
      .then(selectPhoto(true, 1))
      .then(review("safe"))
      .then(claim("act1"))
      .then(issue("int1"))
      .then(fetch(FETCH_TTL))
      .then(all { assert(g.fetches == 1), assert(safety), tick(1) })

  run textChoiceTest =
    init
      .then(offerList)
      .then(tick(1))
      .then(chooseByText(1))
      .then(review("safe"))
      .then(claim("act1"))
      .then(issue("int1"))
      .then(fetch(1 + FETCH_TTL))
      .then(all { assert(g.fetches == 1 and g.textChoice), assert(safety), tick(1) })

  run staleListNoItemTest =
    init
      .then(offerList)
      .then(tick(20))
      .then(chooseByText(1))
      .fail()

  run newNoticeListNoItemTest =
    init
      .then(offerList)
      .then(policyChange)
      .then(chooseByText(1))
      .fail()

  run numberNotOnListNoItemTest =
    init
      .then(offerList)
      .then(chooseByText(3))
      .fail()

  run noListNoItemTest =
    init
      .then(chooseByText(1))
      .fail()

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

  run unknownKeepsPendingTest =
    init
      .then(selectPhoto(true, 1))
      .then(review("unknown"))
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

  run secondIntentRefusedTest =
    init
      .then(selectPhoto(true, 1))
      .then(review("safe"))
      .then(claim("act1"))
      .then(issue("int1"))
      .then(issue("int2"))
      .fail()
}
```
