# Photo relay offer

## Story: Photo relay offer

An adult slop.date member sends their own photo to a match through the agent. The member names the photo in their own words, sees exactly that photo and says YES, the match chooses to receive it, an automatic check screens it (a person on the safety team sees only a photo that the check does not clear), and the match opens it on one browser until the sender takes it back. The match can report it.

### Safety rules and reachability

Check consent to the newest fresh proposal, the receiver's yes before any check, a clean check or a staff approval before any view, the bound browser, take-back, the parties and the sender notices. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Rewritten (owner decision 2026-11-22) for the offer flow of [photo relay](../photoRelayItem.md): the earlier model of a numbered choice, an action claim, a provider capability and an MMS fetch is gone with that code. Production uses [photo relay](../photoRelayItem.md) for the reference decision (`photoPickFor`), the reply to a proposal (`photoDraftReplyFor`), the offer admission (`photoOfferAdmissionFor`), the offer machine, the sender notices, the page links and the receiver's answer, and [photo consent and review](../photoRelayReview.md) for each photo's review item. This model covers the whole flow for one sender and one receiver. Changed after review (owner decision 2026-11-22, no opened receipt): a take-back of a declined offer whose notice is not yet due now drops its notice and leaves its phase as it is (`photoTakeBackFor` TakeBackQuietly), a take-back from reviewing on also drops the photos from the offer, and a "sent" notice that is not yet out when the offer ends is dropped (`lawSentIsNotToldAfterTheEnd`). Changed (owner decision D14 of 2026-11-22, "automatic check. i like private link, but not the 24 hours restriction, its enabled until its retracted by the user"): each item now starts in the automatic check (`screen`), and only a flagged photo, a photo the model cannot take or a photo the check could not screen in its tries goes to staff (`review`); the offer is ready as soon as one photo is approved; the open deadline, the view window and the Viewing and Closed phases are gone (`lapseOpen`, `closeView` deleted), and a new view link (`renewLink`) replaces the old one; a taken-back photo is kept in `takenBack`, which the sender's list shows. Changed after review (owner decision D14 of 2026-11-22): a ready offer no longer counts as open for the next offer of the pair (`consentYes`); the transaction that records STOP, leaving, a block, a ban, a hold, erasure or an age under 18 records an end fact on the open offer (`pairEnds`, `partyEnded`), which a later START or released hold does not clear, so the view stays closed (`lawNoViewWhenNotCurrent`) and the tick ends the offer; a deleted photo hides only that photo.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=18 max-samples=4000
//
// photo_relay_item: one photo offer from one adult sender to one adult match, from the proposal to the view.
//
// WHAT THIS MODELS (owner decisions of 2026-11-22, D14 included; code locations are names)
//   PhotoRelayFlow (packages/network/service/photoRelayFlow.ts): turn and request (a proposal from the reader
//   readPhotoMessage, packages/network/service/photoReference.ts), the reply to the proposal (photoDraftReplyFor),
//   consent (photoOfferAdmissionFor), the ask to the receiver, the receiver's answer (photoAskAnswerFor), screenOffer,
//   settle, PHOTO LINK and tick. PhotoRelayService (packages/platform/src/photo-relay.ts): saveDraft, prepareOffer,
//   answer, screen (photoScreenVerdictFor, photoScreenOutcomeFor, screenSelection), review, expire, withdraw, settle,
//   renewViewLinks. PhotoPages (packages/platform/src/photo-pages.ts): the view page open and its image calls
//   (photoViewAllowed), and report.
//   The pure defs below have the names and the decisions of spec/photoRelayItem.md and spec/photoRelayReview.md.
//   The phases are strings here. One draft and one offer slot stand for the newest draft of the sender and the
//   newest offer of the pair.
//
// BOUNDS AND SCALED CONSTANTS
//   Four photos. Time steps of 1, 4, 8 and 16 units; one unit is 15 minutes for the draft (DRAFT_TTL = 1,
//   photoDraftTtlMs) and three hours elsewhere: the item deadline ITEM_TTL = 4 (relayItemTtlMs, 12 hours), the
//   answer window ANSWER_TTL = 8 (offerAnswerMs, 24 hours) and the cooldown COOLDOWN = 24 (photoOfferCooldownMs,
//   3 days). The check tries RETRY_MAX = 2 times (photoScreenRetryMax, 5) and waits RETRY_WAIT = 1 unit between
//   tries (photoScreenRetryDelayMs, 1 to 60 minutes). Only the order of the values matters. newDay stands for the
//   24-hour window of photoOffersDaily.
//
// OUTSIDE THE MODEL
//   The regex tables of the reader (the corpus evals/photo-references.jsonl covers them), SQL and the offer row lock
//   (each action is atomic), HTTP, the photo bytes, the Workers AI call and the parse of its answers (an oracle: the
//   verdict parameter of screen; a deleted photo gives no bytes, so only "down"), the page token hash and the browser
//   cookie (an oracle: the sameDevice parameter), the claim of a check attempt before the Workers AI call (the
//   screen step is atomic), the end-fact triggers of migration 0088 (part of pairEnds), the reviewer authority (a staff safety role; a refused reviewer
//   changes nothing), the texts and the leak guard. settle in the code also expires the due items first; here
//   expirePending is its own step. A new offer may replace the slot only after the sender notice of the earlier
//   offer was sent (the code keeps the earlier row, and an earlier ready offer stays viewable there; the slot is an
//   abstraction of "the newest offer of the pair").
module photo_relay_item {

  pure val DRAFT_TTL = 1
  pure val ITEM_TTL = 4
  pure val ANSWER_TTL = 8
  pure val COOLDOWN = 24
  pure val RETRY_MAX = 2
  pure val RETRY_WAIT = 1
  pure val SET_MAX = 3
  pure val UNOPENED_MAX = 2
  pure val DAILY_MAX = 6
  pure val PHOTOS = Set(1, 2, 3, 4)
  pure val OPEN_PHASES = Set("asking", "reviewing", "ready")
  pure val WAITING_PHASES = Set("asking", "reviewing")
  pure val OPEN_ITEMS = Set("screening", "pending", "approved")

  type Draft = { live: bool, shownAt: int, proposed: Set[int], noticeAt: int, snapshot: Set[int], newest: bool }
  type Offer = {
    exists: bool, phase: str, photos: Set[int], takenBack: Set[int], consentNotice: int, answerBy: int,
    askNewest: bool, wasReady: bool, bySender: bool, bound: bool, tell: str, tellAt: int, told: bool, partyEnded: bool,
  }
  type World = {
    photos: Set[int], noticeVersion: int, pair: bool, adults: bool, noMore: bool,
    draft: Draft, offer: Offer, items: int -> str, attempts: int -> int, screenAt: int -> int, itemDeadline: int,
    unopened: int, lastUnopenedAt: int, photosToday: int,
  }
  type Ghost = {
    views: int, declines: int, reports: int, tells: int, renews: int, receiverYes: bool,
    consentedStale: bool, offeredOutsideOwn: bool, offeredTooMany: bool, askedWhileNoMore: bool,
    offeredAfterTwoUnopened: bool, offeredWhileOpen: bool, yesNotNewest: bool, readyNotByReview: bool,
    endChanged: bool, readyEndedByClock: bool, notTakenEarly: bool, viewedOtherDevice: bool,
    viewedWithoutYes: bool, viewedWithoutApproval: bool, viewedRevoked: bool, offeredToMinor: bool, checkedBeforeYes: bool,
    sentToldAfterEnd: bool, releasedUnchecked: bool, viewedAfterAnEnd: bool,
  }

  var now: int
  var w: World
  var g: Ghost

  // ---------------------------------------------------------------- the generated decisions
  pure def photoDraftReplyFor(promptIsNewest: bool, shownAt: int, at: int, hasReference: bool, yes: bool, no: bool,
      proposed: bool, sameNotice: bool, sameSet: bool): str =
    if (not(promptIsNewest) or not(hasReference or yes or no)) "NotForTheDraft"
    else if (at < shownAt or at - shownAt >= DRAFT_TTL) "DraftLapsed"
    else if (hasReference) "ChangeProposal"
    else if (no) "CancelDraft"
    else if (not(proposed)) "AskWhichOne"
    else if (not(sameNotice) or not(sameSet)) "PhotosChanged"
    else "ConsentGiven"

  pure def photoOfferAdmissionFor(partiesOk: bool, openToPair: int, unopenedEnds: int, lastUnopenedEndAt: int, at: int,
      photosLastDay: int, count: int, receiverNever: bool): str =
    if (not(partiesOk) or count < 1 or count > SET_MAX) "OfferUnavailable"
    else if (unopenedEnds >= UNOPENED_MAX) "OfferPhotosOff"
    else if (openToPair > 0) "OfferWaitForAnswer"
    else if (unopenedEnds > 0 and at - lastUnopenedEndAt < COOLDOWN) "OfferCoolingDown"
    else if (photosLastDay + count > DAILY_MAX) "OfferDailyLimit"
    else if (receiverNever) "OfferSilentDecline"
    else "OfferAsk"

  pure def photoAskAnswerFor(promptIsNewest: bool, asking: bool, yes: bool, no: bool, noMore: bool): str =
    if (noMore) "ReceiverDeclinesAll"
    else if (not(promptIsNewest) or not(asking)) "NotForTheAsk"
    else if (no) "ReceiverDeclines"
    else if (yes) "ReceiverTakes"
    else "NotForTheAsk"

  /** photoScreenVerdictFor and photoScreenOutcomeFor (spec/photoRelayReview.md); verdict "down" is ScreenCannotRun. */
  pure def photoScreenOutcomeFor(verdict: str, attempts: int): str =
    if (verdict == "clean") "ReleasePhoto"
    else if (verdict == "flagged" or verdict == "unusable") "HoldForStaff"
    else if (attempts + 1 >= RETRY_MAX) "HoldForStaff"
    else "RetryScreen"

  pure def senderNoticeDueAt(notTaken: bool, at: int, answerBy: int): int = if (notTaken and at < answerBy) answerBy else at

  pure def keptTell(o: Offer, phase2: str): str =
    if (o.tell == "sent" and not(o.told) and phase2 != "ready") "none" else o.tell

  pure def photoViewAllowed(phase: str, deviceBound: bool, sameDevice: bool, itemsCurrent: bool): bool =
    itemsCurrent and phase == "ready" and (not(deviceBound) or sameDevice)

  // ---------------------------------------------------------------- the shell
  pure val NO_OFFER: Offer = {
    exists: false, phase: "none", photos: Set(), takenBack: Set(), consentNotice: 0, answerBy: 0,
    askNewest: false, wasReady: false, bySender: false, bound: false, tell: "none", tellAt: 0, told: false, partyEnded: false,
  }

  /** relayPhotoParties and photos.mayTake: both adults, no block, no STOP or leave, no hold, the thread open. */
  pure def partiesOk(x: World): bool = x.pair and x.adults

  /** PhotoRelayService.viewCurrent: no end fact, the parties current, and an approved photo that is still stored,
      under the notice in force. */
  pure def itemsCurrent(x: World): bool =
    not(x.offer.partyEnded) and partiesOk(x) and x.offer.consentNotice == x.noticeVersion and
    x.offer.photos.exists(p => x.items.get(p) == "approved" and x.photos.contains(p))

  /** The offer step rules of spec/photoRelayItem.md across the whole flow. */
  pure def offerGhost(gg: Ghost, o: Offer, o2: Offer, viaSettle: bool, viaEnd: bool): Ghost = {
    ...gg,
    endChanged: gg.endChanged or (o.exists and not(OPEN_PHASES.contains(o.phase)) and
      (o2.phase != o.phase or o2.answerBy != o.answerBy)),
    readyEndedByClock: gg.readyEndedByClock or (o.phase == "ready" and o2.phase != "ready" and not(viaEnd)),
    readyNotByReview: gg.readyNotByReview or (o.phase != "ready" and o2.phase == "ready" and not(viaSettle)),
  }

  action init = all {
    now' = 0,
    w' = {
      photos: PHOTOS, noticeVersion: 1, pair: true, adults: true, noMore: false,
      draft: { live: false, shownAt: 0, proposed: Set(), noticeAt: 1, snapshot: Set(), newest: false },
      offer: NO_OFFER, items: PHOTOS.mapBy(p => "none"), attempts: PHOTOS.mapBy(p => 0), screenAt: PHOTOS.mapBy(p => 0),
      itemDeadline: 0, unopened: 0, lastUnopenedAt: 0, photosToday: 0,
    },
    g' = {
      views: 0, declines: 0, reports: 0, tells: 0, renews: 0, receiverYes: false,
      consentedStale: false, offeredOutsideOwn: false, offeredTooMany: false, askedWhileNoMore: false,
      offeredAfterTwoUnopened: false, offeredWhileOpen: false, yesNotNewest: false, readyNotByReview: false,
      endChanged: false, readyEndedByClock: false, notTakenEarly: false, viewedOtherDevice: false,
      viewedWithoutYes: false, viewedWithoutApproval: false, viewedRevoked: false, offeredToMinor: false, checkedBeforeYes: false,
      sentToldAfterEnd: false, releasedUnchecked: false, viewedAfterAnEnd: false,
    },
  }

  // readPhotoMessage gives ProposePhotos (photoPickFor: own photos, one to three); saveDraft writes the draft and
  // the shell texts the proposal with its check page link (S1, S2). A new send reading always writes a new revision.
  action propose(ps: Set[int]): bool = all {
    partiesOk(w), ps.size() >= 1, ps.size() <= SET_MAX, ps.subseteq(w.photos),
    w' = { ...w, draft: { live: true, shownAt: now, proposed: ps, noticeAt: w.noticeVersion, snapshot: w.photos, newest: true } },
    now' = now, g' = g,
  }

  // photoDraftReplyFor ChangeProposal: a reply that names photos replaces the proposal (S1, S2 again); never a yes.
  action correct(ps: Set[int]): bool = all {
    w.draft.live,
    photoDraftReplyFor(w.draft.newest, w.draft.shownAt, now, true, false, false, true, true, true) == "ChangeProposal",
    partiesOk(w), ps.size() >= 1, ps.size() <= SET_MAX, ps.subseteq(w.photos),
    w' = { ...w, draft: { live: true, shownAt: now, proposed: ps, noticeAt: w.noticeVersion, snapshot: w.photos, newest: true } },
    now' = now, g' = g,
  }

  // Another outbound message to the sender (a probe, an answer from Eliza) or to the receiver: the proposal or the
  // ask is no longer the newest prompt (the newest-prompt check on network.messages).
  action otherPrompt(toSender: bool): bool = all {
    if (toSender) w.draft.live else w.offer.exists,
    w' = if (toSender) { ...w, draft: { ...w.draft, newest: false } } else { ...w, offer: { ...w.offer, askNewest: false } },
    now' = now, g' = g,
  }

  // YES to the newest fresh unchanged proposal, or Send on its check page: photoDraftReplyFor ConsentGiven, then
  // photoOfferAdmissionFor. OfferAsk makes an asking offer; OfferSilentDecline makes a declined offer whose notice is
  // due at the answer deadline. Either deletes the draft; any other admission keeps it and changes no offer.
  action consentYes: bool = {
    val d = w.draft
    val o = w.offer
    val reply = photoDraftReplyFor(d.newest, d.shownAt, now, false, true, false, d.proposed.size() > 0,
      d.noticeAt == w.noticeVersion, d.snapshot == w.photos)
    val openToPair = if (o.exists and (WAITING_PHASES.contains(o.phase) or (o.tell != "none" and now < o.tellAt))) 1 else 0
    val admission = photoOfferAdmissionFor(partiesOk(w), openToPair, w.unopened, w.lastUnopenedAt, now, w.photosToday, d.proposed.size(), w.noMore)
    val asked = admission == "OfferAsk"
    all {
      d.live, reply == "ConsentGiven", asked or admission == "OfferSilentDecline",
      not(o.exists and o.tell != "none" and not(o.told)),
      w' = { ...w,
        draft: { ...d, live: false },
        photosToday: w.photosToday + d.proposed.size(),
        offer: { ...NO_OFFER, exists: true, phase: if (asked) "asking" else "declined", photos: d.proposed, consentNotice: w.noticeVersion,
                 answerBy: if (asked) 0 else now + ANSWER_TTL, tell: if (asked) "none" else "notTaken", tellAt: now + ANSWER_TTL },
        items: PHOTOS.mapBy(p => "none"), attempts: PHOTOS.mapBy(p => 0), screenAt: PHOTOS.mapBy(p => 0), itemDeadline: 0,
        unopened: if (asked) w.unopened else w.unopened + 1,
        lastUnopenedAt: if (asked) w.lastUnopenedAt else now + ANSWER_TTL,
      },
      now' = now,
      g' = { ...g, receiverYes: false, tells: 0, declines: if (asked) g.declines else g.declines + 1,
        consentedStale: g.consentedStale or not(d.newest) or now < d.shownAt or now - d.shownAt >= DRAFT_TTL
          or d.noticeAt != w.noticeVersion or d.snapshot != w.photos,
        offeredOutsideOwn: g.offeredOutsideOwn or not(d.proposed.subseteq(w.photos)),
        offeredTooMany: g.offeredTooMany or d.proposed.size() < 1 or d.proposed.size() > SET_MAX,
        askedWhileNoMore: g.askedWhileNoMore or (asked and w.noMore),
        offeredAfterTwoUnopened: g.offeredAfterTwoUnopened or w.unopened >= UNOPENED_MAX,
        offeredWhileOpen: g.offeredWhileOpen or openToPair > 0,
        offeredToMinor: g.offeredToMinor or not(w.adults),
      },
    }
  }

  // The ask to the receiver (R1, type "relay", key photo-ask:<request key>) with its 24-hour answer window.
  action askReceiver: bool = all {
    w.offer.exists, w.offer.phase == "asking", w.offer.answerBy == 0, not(w.noMore), partiesOk(w),
    w' = { ...w, offer: { ...w.offer, answerBy: now + ANSWER_TTL, askNewest: true } },
    now' = now,
    g' = { ...g, askedWhileNoMore: g.askedWhileNoMore or w.noMore, offeredToMinor: g.offeredToMinor or not(w.adults) },
  }

  // photoAskAnswerFor ReceiverTakes and canAnswerYes: one item per photo in the automatic check (prepareSelection and
  // recordSelection with the offer's consent; explicit only under the notice in force), due at once, with the item
  // deadline ITEM_TTL later. answer needs every photo of the offer still stored and no end fact (offerParties); else
  // the offer ends (endOnParties).
  action receiverYes: bool = {
    val o = w.offer
    val o2 = { ...o, phase: "reviewing" }
    all {
      o.exists, photoAskAnswerFor(o.askNewest, o.phase == "asking", true, false, w.noMore) == "ReceiverTakes",
      o.answerBy > 0, now < o.answerBy, o.consentNotice == w.noticeVersion, partiesOk(w), not(o.partyEnded), o.photos.subseteq(w.photos),
      w' = { ...w, offer: o2, items: PHOTOS.mapBy(p => if (o.photos.contains(p)) "screening" else "none"),
             attempts: PHOTOS.mapBy(p => 0), screenAt: PHOTOS.mapBy(p => now), itemDeadline: now + ITEM_TTL },
      now' = now,
      g' = { ...offerGhost(g, o, o2, false, false), receiverYes: true, yesNotNewest: g.yesNotNewest or not(o.askNewest) },
    }
  }

  // photoAskAnswerFor ReceiverDeclines: declined; TellNotTaken due at senderNoticeDueAt (never before answerBy).
  action receiverNo: bool = {
    val o = w.offer
    val due = senderNoticeDueAt(true, now, o.answerBy)
    val o2 = { ...o, phase: "declined", tell: "notTaken", tellAt: due }
    all {
      o.exists, photoAskAnswerFor(o.askNewest, o.phase == "asking", false, true, w.noMore) == "ReceiverDeclines",
      w' = { ...w, offer: o2, unopened: w.unopened + 1, lastUnopenedAt: due },
      now' = now,
      g' = { ...offerGhost(g, o, o2, false, false), declines: g.declines + 1 },
    }
  }

  // NO MORE PHOTOS (ReceiverDeclinesAll): the preference is set, and an asking offer declines as for a no.
  action noMorePhotos: bool = {
    val o = w.offer
    val asking = o.exists and o.phase == "asking"
    val due = senderNoticeDueAt(true, now, o.answerBy)
    val o2 = if (asking) { ...o, phase: "declined", tell: "notTaken", tellAt: due } else o
    all {
      photoAskAnswerFor(o.askNewest, asking, false, false, true) == "ReceiverDeclinesAll",
      w' = { ...w, noMore: true, offer: o2,
             unopened: if (asking) w.unopened + 1 else w.unopened, lastUnopenedAt: if (asking) due else w.lastUnopenedAt },
      now' = now,
      g' = { ...offerGhost(g, o, o2, false, false), declines: if (asking) g.declines + 1 else g.declines },
    }
  }

  // PHOTOS OK clears the preference (R4b).
  action photosOk: bool = all { w.noMore, w' = { ...w, noMore: false }, now' = now, g' = g }

  // canLapseAnswer at the tick: lapsed; TellNotTaken due now (now >= answerBy).
  action lapseAnswer: bool = {
    val o = w.offer
    val due = senderNoticeDueAt(true, now, o.answerBy)
    val o2 = { ...o, phase: "lapsed", tell: "notTaken", tellAt: due }
    all {
      o.exists, o.phase == "asking", o.answerBy > 0, now >= o.answerBy,
      w' = { ...w, offer: o2, unopened: w.unopened + 1, lastUnopenedAt: due },
      now' = now, g' = offerGhost(g, o, o2, false, false),
    }
  }

  // The automatic check of photo p (PhotoRelayService.screen, at the receiver's yes and at each tick): the verdict
  // comes from the classifier. ReleasePhoto approves it; HoldForStaff makes it a pending exception for staff;
  // RetryScreen keeps it in the check and tries again RETRY_WAIT later. A deleted photo gives no bytes, so the
  // only verdict for it is "down". The check runs only before the item deadline (canScreenSelection).
  action screen(p: int, verdict: str): bool = {
    val outcome = photoScreenOutcomeFor(verdict, w.attempts.get(p))
    val item2 = if (outcome == "ReleasePhoto") "approved" else if (outcome == "HoldForStaff") "pending" else "screening"
    all {
      w.offer.exists, w.items.get(p) == "screening", now >= w.screenAt.get(p), now < w.itemDeadline,
      w.photos.contains(p) or verdict == "down",
      w' = { ...w, items: w.items.set(p, item2),
             attempts: if (verdict == "down") w.attempts.set(p, w.attempts.get(p) + 1) else w.attempts,
             screenAt: if (item2 == "screening") w.screenAt.set(p, now + RETRY_WAIT) else w.screenAt },
      now' = now,
      g' = { ...g, checkedBeforeYes: g.checkedBeforeYes or not(g.receiverYes),
             releasedUnchecked: g.releasedUnchecked or (item2 == "approved" and verdict != "clean") },
    }
  }

  // A safety reviewer decides one pending exception before its deadline (photoReviewMayProceed, recordReview), while
  // the offer is reviewing or ready (PhotoRelayService.current). An approval needs the photo still stored, the parties
  // and the notice in force.
  action review(p: int, safe: bool): bool = all {
    w.offer.exists, w.offer.phase == "reviewing" or w.offer.phase == "ready", w.items.get(p) == "pending", now < w.itemDeadline,
    not(safe) or (w.photos.contains(p) and partiesOk(w) and w.offer.consentNotice == w.noticeVersion),
    w' = { ...w, items: w.items.set(p, if (safe) "approved" else "rejected") },
    now' = now,
    g' = { ...g, checkedBeforeYes: g.checkedBeforeYes or not(g.receiverYes) },
  }

  // expirePending at the tick and in settle (expireSelection): an item still pending or in the check at or after its
  // deadline expires.
  action expirePending(p: int): bool = all {
    w.items.get(p) == "pending" or w.items.get(p) == "screening", now >= w.itemDeadline,
    w' = { ...w, items: w.items.set(p, "expired") },
    now' = now, g' = g,
  }

  // canSettleReview and settleReview over the items that were not taken back: ready as soon as one photo is approved
  // (TellSent now, a view link), else, when every photo is decided, rejected (TellNotApproved) or timed out
  // (TellCheckTimedOut).
  action settle: bool = {
    val o = w.offer
    val kept = o.photos.filter(p => w.items.get(p) != "revoked")
    val approved = kept.filter(p => w.items.get(p) == "approved").size()
    val rejected = kept.filter(p => w.items.get(p) == "rejected").size()
    val timedOut = kept.filter(p => w.items.get(p) == "expired").size()
    val ready = approved > 0
    val o2 = { ...o,
      phase: if (ready) "ready" else if (rejected > 0) "rejected" else "checkTimedOut",
      wasReady: ready, bound: false,
      tell: if (ready) "sent" else if (rejected > 0) "notApproved" else "checkTimedOut", tellAt: now }
    all {
      o.exists, o.phase == "reviewing", kept.size() >= 1, approved > 0 or approved + rejected + timedOut == kept.size(),
      w' = { ...w, offer: o2 },
      now' = now, g' = offerGhost(g, o, o2, true, false),
    }
  }

  // The view page open on a browser that the link is not yet bound to (photoViewAllowed): binds the link to it.
  // The offer stays ready; no window opens.
  action openView: bool = {
    val o = w.offer
    val o2 = { ...o, bound: true }
    all {
      o.exists, o.phase == "ready", not(o.bound), photoViewAllowed(o.phase, o.bound, true, itemsCurrent(w)),
      w' = { ...w, offer: o2 },
      now' = now, g' = offerGhost(g, o, o2, false, false),
    }
  }

  // The image call of the view page for photo p: photoViewAllowed, and the item and the photo row read again.
  action viewImage(p: int, sameDevice: bool): bool = {
    val o = w.offer
    all {
      o.exists, o.phase == "ready", o.bound, o.photos.contains(p), w.items.get(p) == "approved", w.photos.contains(p),
      photoViewAllowed(o.phase, o.bound, sameDevice, itemsCurrent(w)),
      w' = w, now' = now,
      g' = { ...g, views: g.views + 1,
        viewedOtherDevice: g.viewedOtherDevice or not(sameDevice) or not(o.bound),
        viewedWithoutYes: g.viewedWithoutYes or not(g.receiverYes),
        viewedWithoutApproval: g.viewedWithoutApproval or w.items.get(p) != "approved",
        viewedRevoked: g.viewedRevoked or w.items.get(p) == "revoked" or o.bySender or o.takenBack.contains(p),
        viewedAfterAnEnd: g.viewedAfterAnEnd or o.partyEnded or not(partiesOk(w)) },
    }
  }

  // PHOTO LINK by the receiver (photoViewLinkRenewable, renewViewLinks): the old link is deleted and a new unbound
  // link is issued.
  action renewLink: bool = {
    val o = w.offer
    all {
      o.exists, o.phase == "ready", itemsCurrent(w),
      w' = { ...w, offer: { ...o, bound: false } },
      now' = now, g' = { ...g, renews: g.renews + 1 },
    }
  }

  // The sender takes back photos ps ("take back photo 2", Take back on /photos/mine, or photo_request from the
  // member's agent): photoTakeBackFor, at once in one transaction. Every taken-back photo joins takenBack, which the
  // sender's list shows as taken back (photoListedAs).
  // TakeBackOffer: the offer drops those photos, and from reviewing on their open items are revoked; when no open
  // item is left, canRevokeOffer: revoked, with no sender notice and nothing to the receiver.
  // TakeBackQuietly: a declined offer whose notice is not yet due (it still shows as asked) drops those photos, and
  // when none is left it is marked as ended by the sender and its notice is dropped; its phase does not change.
  // TakeBackSeen: an offer that ended or was reported after ready keeps its phase; only takenBack grows.
  action revoke(ps: Set[int]): bool = {
    val o = w.offer
    val asking = o.phase == "asking"
    val quietly = o.phase == "declined" and not(o.wasReady) and not(o.bySender) and o.tell != "none" and not(o.told) and now < o.tellAt
    val seen = (o.phase == "ended" or o.phase == "reported") and o.wasReady and not(o.bySender)
    val items2 = PHOTOS.mapBy(p => if (not(asking) and not(quietly) and not(seen) and ps.contains(p) and o.photos.contains(p) and OPEN_ITEMS.contains(w.items.get(p))) "revoked" else w.items.get(p))
    val left = o.photos.exclude(ps)
    val live = if (asking or quietly) left else left.filter(p => OPEN_ITEMS.contains(items2.get(p)))
    val taken = o.takenBack.union(ps)
    val o2 = if (seen) { ...o, takenBack: taken }
      else if (live.size() == 0 and quietly) { ...o, bySender: true, tell: "none", takenBack: taken }
      else if (live.size() == 0) { ...o, phase: "revoked", bySender: true, tell: if (o.told) o.tell else "none", takenBack: taken }
      else { ...o, photos: left, takenBack: taken }
    all {
      o.exists, OPEN_PHASES.contains(o.phase) or quietly or seen, ps.size() >= 1, ps.subseteq(o.photos), ps.intersect(o.takenBack).size() == 0,
      w' = { ...w, items: items2, offer: o2 },
      now' = now, g' = offerGhost(g, o, o2, false, true),
    }
  }

  // The tick (settle) ends an open offer: canEndOffer. An asking offer ends when its parties fail or a photo is gone;
  // a reviewing offer when its parties fail or no photo is left; the tick visits a ready offer only when it has an
  // end fact (PhotoRelayService.due). TellNotTaken before ready, at senderNoticeDueAt; nothing after ready.
  action endOnParties: bool = {
    val o = w.offer
    val gone = if (o.phase == "asking") not(o.photos.subseteq(w.photos)) else o.photos.intersect(w.photos).size() == 0
    val lost = o.partyEnded or not(partiesOk(w)) or gone
    val o2 = { ...o, phase: "ended",
      tell: if (o.wasReady or o.told) keptTell(o, "ended") else "notTaken",
      tellAt: if (o.wasReady or o.told) o.tellAt else senderNoticeDueAt(true, now, o.answerBy) }
    all {
      o.exists, OPEN_PHASES.contains(o.phase), if (o.phase == "ready") o.partyEnded else lost,
      w' = { ...w, offer: o2, items: PHOTOS.mapBy(p => if (o.photos.contains(p) and OPEN_ITEMS.contains(w.items.get(p))) "revoked" else w.items.get(p)) },
      now' = now, g' = offerGhost(g, o, o2, false, true),
    }
  }

  // Report on the view page (canReportOffer): reported, and the existing report rule closes the pair.
  action report: bool = {
    val o = w.offer
    val o2 = { ...o, phase: "reported", tell: keptTell(o, "reported") }
    all {
      o.exists, o.phase == "ready",
      w' = { ...w, offer: o2, pair: false, items: PHOTOS.mapBy(p => if (o.photos.contains(p) and OPEN_ITEMS.contains(w.items.get(p))) "revoked" else w.items.get(p)) },
      now' = now, g' = { ...offerGhost(g, o, o2, false, true), reports: g.reports + 1 },
    }
  }

  // The tick sends a due sender notice once (type "info", key photo-notice:<offerId>).
  action sendNotice: bool = {
    val o = w.offer
    all {
      o.exists, o.tell != "none", not(o.told), now >= o.tellAt,
      w' = { ...w, offer: { ...o, told: true } },
      now' = now,
      g' = { ...g, tells: g.tells + 1, notTakenEarly: g.notTakenEarly or (o.tell == "notTaken" and o.answerBy > 0 and now < o.answerBy),
             sentToldAfterEnd: g.sentToldAfterEnd or (o.tell == "sent" and o.phase != "ready") },
    }
  }

  action tick(d: int): bool = all { now' = now + d, w' = w, g' = g }
  action newDay: bool = all { w.photosToday > 0, w' = { ...w, photosToday: 0 }, now' = now, g' = g }

  // STOP, leave, a block, a ban, a hold or erasure; minor: an age reading under 18 (the lowest age wins). The same
  // transaction records the end fact on an open offer (migration 0088 triggers; PhotoRelayService.endFor for an age).
  // A closed thread is here too: it fails the parties for good, and the code records no end fact for it but refuses
  // the view on every open.
  action pairEnds(minor: bool): bool = all {
    w.pair or (minor and w.adults),
    w' = { ...w, pair: false, adults: w.adults and not(minor),
           offer: if (w.offer.exists and OPEN_PHASES.contains(w.offer.phase)) { ...w.offer, partyEnded: true } else w.offer },
    now' = now, g' = g,
  }
  // START after STOP or a lifted hold; an age never comes back; the end fact stays.
  action pairResumes: bool = all { not(w.pair), w' = { ...w, pair: true }, now' = now, g' = g }
  // DELETE PHOTOS or "delete photo N": the photo row goes; the numbers of the others change (outside the model).
  action photoDeleted(p: int): bool = all { w.photos.contains(p), w' = { ...w, photos: w.photos.exclude(Set(p)) }, now' = now, g' = g }
  // A new PHOTO_SEND_NOTICE version ships.
  action noticeChange: bool = all { w' = { ...w, noticeVersion: 3 - w.noticeVersion }, now' = now, g' = g }

  action step = {
    nondet ps = PHOTOS.powerset().oneOf()
    nondet p = PHOTOS.oneOf()
    nondet b = Set(true, false).oneOf()
    nondet d = Set(1, 4, 8, 16).oneOf()
    nondet v = Set("clean", "flagged", "unusable", "down").oneOf()
    any {
      propose(ps), correct(ps), consentYes, askReceiver, receiverYes, receiverNo, noMorePhotos, lapseAnswer,
      screen(p, v), review(p, b), expirePending(p), settle, openView, viewImage(p, b), renewLink, revoke(ps),
      endOnParties, report, sendNotice,
      any { tick(d), otherPrompt(b), pairEnds(b), pairResumes, photoDeleted(p), noticeChange, newDay, photosOk },
    }
  }

  // ---------------------------------------------------------------- invariants (the law names of the specs)
  val lawChosenAreOwnPhotos = not(g.offeredOutsideOwn) and (w.draft.live implies w.draft.proposed.subseteq(w.draft.snapshot))
  val lawProposalHoldsOneToThree = not(g.offeredTooMany)
    and (w.draft.live implies (w.draft.proposed.size() >= 1 and w.draft.proposed.size() <= SET_MAX))
    and (w.offer.exists implies w.offer.photos.size() <= SET_MAX)
  val lawConsentNeedsAFreshUnchangedProposal = not(g.consentedStale)
  val lawOneOpenOfferPerPair = not(g.offeredWhileOpen)
  val lawNeverMeansNeverAsked = not(g.askedWhileNoMore)
  val lawPhotosOffAfterTwoUnopened = not(g.offeredAfterTwoUnopened)
  val lawOnlyAYesToTheNewestAskTakes = not(g.yesNotNewest)
  val stepOnlyReviewMakesReady = not(g.readyNotByReview)
  val stepEndsAreFinal = not(g.endChanged)
  val stepNoClockEndsAReadyOffer = not(g.readyEndedByClock)
  val lawNotTakenWaitsForTheAnswerDeadline = not(g.notTakenEarly)
  val lawNoReadReceipt = g.tells <= 1
  val lawViewNeedsTheBoundBrowser = not(g.viewedOtherDevice)
  val lawOnlyACleanScreenReleases = not(g.releasedUnchecked)
  val lawTakenBackShowsAsTakenBack = (w.offer.exists and w.offer.phase == "revoked") implies w.offer.takenBack.size() >= 1
  val noViewWithoutReceiverYes = not(g.viewedWithoutYes)
  val noViewWithoutApproval = not(g.viewedWithoutApproval)
  val revokedNeverViewed = not(g.viewedRevoked)
  val minorNeverOffered = not(g.offeredToMinor)
  val noCheckBeforeReceiverYes = not(g.checkedBeforeYes)
  val lawSentIsNotToldAfterTheEnd = not(g.sentToldAfterEnd)
  val lawNoViewWhenNotCurrent = not(g.viewedAfterAnEnd)

  val safety = and {
    lawChosenAreOwnPhotos, lawProposalHoldsOneToThree, lawConsentNeedsAFreshUnchangedProposal, lawOneOpenOfferPerPair,
    lawNeverMeansNeverAsked, lawPhotosOffAfterTwoUnopened, lawOnlyAYesToTheNewestAskTakes, stepOnlyReviewMakesReady,
    stepEndsAreFinal, stepNoClockEndsAReadyOffer, lawNotTakenWaitsForTheAnswerDeadline, lawNoReadReceipt,
    lawViewNeedsTheBoundBrowser, lawOnlyACleanScreenReleases, lawTakenBackShowsAsTakenBack, noViewWithoutReceiverYes,
    noViewWithoutApproval, revokedNeverViewed, minorNeverOffered, noCheckBeforeReceiverYes, lawSentIsNotToldAfterTheEnd,
    lawNoViewWhenNotCurrent,
  }

  // ---------------------------------------------------------------- reachability witnesses (expected VIOLATED)
  val witness_noView = g.views == 0
  val witness_noDecline = g.declines == 0
  val witness_noReport = g.reports == 0
  val witness_noLapse = w.offer.phase != "lapsed"
  val witness_noPartialTakeBack = not(w.offer.phase == "ready" and PHOTOS.exists(p => w.items.get(p) == "revoked"))
  val witness_noTimedOutCheck = w.offer.phase != "checkTimedOut"
  val witness_noStaffHold = not(PHOTOS.exists(p => w.items.get(p) == "pending"))
  val witness_noRenew = g.renews == 0

  // ---------------------------------------------------------------- traces
  /** tests/e2e/photo-relay.e2e.test.ts and photo-pages.pg.test.ts: request, YES, receiver yes, a clean check, page
      open, image, still an image 32 units (four days) later, report. */
  run happyPathTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(settle)
      .then(openView).then(viewImage(1, true))
      .expect(g.views == 1 and w.offer.phase == "ready" and safety)
      .then(tick(16)).then(tick(16)).then(viewImage(1, true))
      .expect(g.views == 2 and w.offer.phase == "ready" and safety)
      .then(report)
      .expect(w.offer.phase == "reported" and not(w.pair) and safety)
      .then(viewImage(1, true)).fail()

  run staleYesTest = init.then(propose(Set(1))).then(tick(1)).then(consentYes).fail()

  run otherPromptYesTest = init.then(propose(Set(1))).then(otherPrompt(true)).then(consentYes).fail()

  run photosChangedYesTest = init.then(propose(Set(1))).then(photoDeleted(2)).then(consentYes).fail()

  run declineLooksLikeLapseTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverNo)
      .expect(w.offer.phase == "declined" and w.offer.tell == "notTaken" and w.offer.tellAt == w.offer.answerBy and safety)
      .then(sendNotice).fail()

  run quietTakeBackTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverNo).then(revoke(Set(1)))
      .expect(w.offer.phase == "declined" and w.offer.bySender and w.offer.tell == "none" and w.offer.takenBack == Set(1) and safety)
      .then(tick(8)).then(sendNotice).fail()

  run sentDroppedOnReportTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(settle)
      .then(openView).then(report)
      .expect(w.offer.tell == "none" and safety)
      .then(sendNotice).fail()

  run noMorePhotosTest =
    init.then(noMorePhotos).then(propose(Set(1))).then(consentYes)
      .expect(w.offer.phase == "declined" and w.offer.tell == "notTaken" and safety)
      .then(askReceiver).fail()

  run noViewBeforeCheckTest = init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(openView).fail()

  run noCheckBeforeYesTest = init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(screen(1, "clean")).fail()

  run flaggedWaitsForStaffTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "flagged"))
      .expect(w.items.get(1) == "pending" and w.offer.phase == "reviewing" and safety)
      .then(settle).fail()

  run flaggedReleasedByStaffTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "flagged"))
      .then(review(1, true)).then(settle).then(openView).then(viewImage(1, true))
      .expect(g.views == 1 and safety)

  run outageNeverReleasesTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "down"))
      .expect(w.items.get(1) == "screening" and w.attempts.get(1) == 1 and safety)
      .then(tick(1)).then(screen(1, "down"))
      .expect(w.items.get(1) == "pending" and w.offer.phase == "reviewing" and safety)
      .then(settle).fail()

  run retryWaitsTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "down")).then(screen(1, "clean")).fail()

  run takeBackStopsViewTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(settle)
      .then(openView).then(viewImage(1, true)).then(revoke(Set(1)))
      .expect(w.offer.phase == "revoked" and w.offer.takenBack == Set(1) and safety)
      .then(viewImage(1, true)).fail()

  run otherPhoneTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(settle)
      .then(openView).then(viewImage(1, false)).fail()

  run renewedLinkTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(settle)
      .then(openView).then(renewLink)
      .expect(not(w.offer.bound) and g.renews == 1 and safety)
      .then(openView).then(viewImage(1, true))
      .expect(g.views == 1 and safety)

  run renewedLinkNeedsAnOpenTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(settle)
      .then(openView).then(renewLink).then(viewImage(1, true)).fail()

  run minorNeverOfferedTest = init.then(pairEnds(true)).then(propose(Set(1))).fail()

  run reviewWindowTest =
    init.then(propose(Set(1, 2))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "flagged")).then(screen(2, "flagged"))
      .then(tick(4)).then(expirePending(1)).then(expirePending(2)).then(settle)
      .expect(w.offer.phase == "checkTimedOut" and w.offer.tell == "checkTimedOut" and safety)
      .then(review(1, true)).fail()

  run partialReleaseTest =
    init.then(propose(Set(1, 2))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(screen(2, "flagged"))
      .then(settle).then(openView)
      .expect(w.offer.phase == "ready" and w.items.get(2) == "pending" and safety)
      .then(viewImage(2, true)).fail()

  run partialTakeBackTest =
    init.then(propose(Set(1, 2))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(screen(2, "clean"))
      .then(settle).then(openView).then(revoke(Set(2)))
      .expect(w.offer.phase == "ready" and w.items.get(2) == "revoked" and w.offer.takenBack == Set(2) and safety)
      .then(viewImage(1, true))
      .expect(g.views == 1 and safety)
      .then(viewImage(2, true)).fail()

  run stopThenStartTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(settle)
      .then(openView).then(pairEnds(false)).then(pairResumes)
      .expect(w.offer.phase == "ready" and w.offer.partyEnded and not(itemsCurrent(w)) and safety)
      .then(viewImage(1, true)).fail()

  run stopThenStartEndsTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(settle)
      .then(pairEnds(false)).then(pairResumes).then(endOnParties)
      .expect(w.offer.phase == "ended" and safety)
      .then(renewLink).fail()

  run secondOfferAfterReadyTest =
    init.then(propose(Set(1))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(settle)
      .then(sendNotice).then(propose(Set(2))).then(consentYes)
      .expect(w.offer.phase == "asking" and safety)

  run deletedPhotoHidesOnlyItTest =
    init.then(propose(Set(1, 2))).then(consentYes).then(askReceiver).then(receiverYes).then(screen(1, "clean")).then(screen(2, "clean"))
      .then(settle).then(openView).then(photoDeleted(2))
      .expect(w.offer.phase == "ready" and itemsCurrent(w) and safety)
      .then(viewImage(1, true))
      .expect(g.views == 1 and safety)
      .then(viewImage(2, true)).fail()
}
```
