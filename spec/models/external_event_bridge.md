# External event platform bridge

## Story: Syndicate adult impromptu events safely with confirmed anchors, quorum gates, and quality-gated invites

When local in-network density is sparse for a niche hobby or activity, an adult Network anchor may co-host an impromptu public meetup syndicated through sanctioned external platforms (Luma Plus API, Meetup Pro GraphQL, or human-assisted Partiful Event Kits) only after recorded review approval, honest crowd disclosure, hidden and approval-gated guest lists, strict 18+ screening, walk-in capacity clamping, T-24h quorum checks, and post-event quality-gated onboarding invites.

### Safety rules and reachability

Check sanctioned ingestion (rejecting scraped sources), confirmed adult anchor presence, recorded review approval ([automated review](../automatedReview.md): review judge or named staff for held items), hidden and gated guest lists, upfront external crowd disclosure, strict 18+ exclusion (consistent with [friend introductions with a minor](../friendIntroAge.md) `lawTeenShapeNeverAnEvent`: minors never enter external or event-anchored items), overbooking math clamped to `min(15, venueWalkInCapacity)`, T-24h quorum cancellation, and post-event quality-gated invites. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [external event bridge spec](../externalEventBridge.md) generates pure source allow-list, publish gate, overbooking cap, T-24h quorum, RSVP approval, and post-event invite decisions. The [public event catalog spec](../publicEventCatalog.md) governs public municipal event ingestion; this model covers syndicated impromptu hosted events and their anchor/RSVP/invite lifecycle.

See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=30 max-samples=4000 verify-steps=8
//
// External event platform bridge (Luma Plus REST + HMAC, Meetup Pro GraphQL + polling,
// Partiful human-assisted Event Kit), anchor recruitment & failover, automated/staff review
// approval (spec/automatedReview.md), T-24h quorum gate, approval & no-show overbooking math
// clamped to min(15, walkInCapacity), hidden guest list & crowd disclosure, 18+ adult-only
// screening, event completion, Network feedback, and post-event quality-gated onboarding invite
// (docs/design/2026-11-26-meetup-setup-and-external-matchmaking.md;
// spec/externalEventBridge.md, spec/automatedReview.md, spec/friendIntroAge.md).
//
// Bounds: 3 Network members (n1, n2 adult; n3 minor), 5 external applicants (e1..e4 adult; e5 minor).
module external_event_bridge {

  // ------------------------------------------------------------------------------------------ constants
  pure val NET_MEMBERS = Set("n1", "n2", "n3")
  pure val EXT_GUESTS = Set("e1", "e2", "e3", "e4", "e5")
  pure val SANCTIONED_SOURCES = Set("host_native", "official_api", "member_submitted_public")
  pure val ALL_SOURCES = Set("host_native", "official_api", "member_submitted_public", "scraped")
  pure val HARD_OPEN_EVENT_CAP = 15

  // ------------------------------------------------------------------------------------------ types
  type NetMember = {
    age: int,
    banned: bool,
    optedOut: bool,
    held: bool,
  }

  type ExtGuest = {
    age: int,
    banned: bool,
    optedOut: bool,
    held: bool,
    alreadyMember: bool,
    answeredScreening: bool,
  }

  type PublishEv = {
    source: str,
    confirmedAnchorCount: int,
    reviewApprover: str,        // "judge" | "staff" (spec/automatedReview.md)
    humanReviewApproved: bool,
    isPublicVenue: bool,
    hideGuestList: bool,
    approvalRequired: bool,
    externalCrowdDisclosed: bool,
    plannedTotal: int,
    effectiveCap: int,
  }

  type ConfirmEv = {
    member: str,
    ageAtConfirm: int,
    crowdDisclosedAtConfirm: bool,
  }

  type RsvpEv = {
    guest: str,
    ageAtApprove: int,
    bannedAtApprove: bool,
    optedOutAtApprove: bool,
    heldAtApprove: bool,
    answeredScreening: bool,
    totalAfterApprove: int,
    effectiveCap: int,
  }

  type InviteEv = {
    guest: str,
    eventCompleted: bool,
    networkFeedbackPositive: bool,
    safetyFlagged: bool,
    attendeeAge: int,
    optedOutAtSend: bool,
    bannedAtSend: bool,
    alreadyMember: bool,
    invitesBefore: int,
    safeFollowupWindow: bool,
  }

  // ------------------------------------------------------------------------------------------ state
  var status: str                     // draft | published | confirmed_go | completed | cancelled_no_anchor | cancelled_low_quorum
  var source: str                     // "" | host_native | official_api | member_submitted_public
  var isPublicVenue: bool
  var venueWalkInCapacity: int        // e.g. 4, 10, or 18
  var targetRoomSize: int             // e.g. 6, 8, or 12
  var hideGuestList: bool
  var approvalRequired: bool
  var externalCrowdDisclosed: bool
  var reviewApprover: str             // "" | "judge" | "staff" (spec/automatedReview.md)
  var humanReviewApproved: bool
  var hoursToStart: int               // 72 -> 24 -> 0
  var t24Checked: bool
  var t24QuorumMet: bool
  var approvedExternalCap: int
  var netMembers: str -> NetMember
  var extGuests: str -> ExtGuest
  var confirmedNetwork: Set[str]
  var confirmedAnchors: Set[str]
  var approvedExternals: Set[str]
  var networkFeedbackRecorded: bool
  var networkFeedbackPositive: bool
  var safetyFlaggedGuests: Set[str]
  var invitesSent: str -> int
  var safeFollowupWindow: bool
  // Ghost state & witness counters
  var publishHistory: Set[PublishEv]
  var confirmHistory: Set[ConfirmEv]
  var rsvpHistory: Set[RsvpEv]
  var inviteHistory: Set[InviteEv]
  var rejectedScrapeCount: int
  var anchorDropCount: int
  var coAnchorPromoted: bool

  // ------------------------------------------------------------------------------------------ helpers
  pure def minInt(a: int, b: int): int = if (a <= b) a else b

  pure def isAdult(age: int): bool = age >= 18 and age <= 120

  pure def computeExternalCap(netConfirmed: int, walkInCap: int, targetRoom: int): int = {
    val effCap = minInt(HARD_OPEN_EVENT_CAP, walkInCap)
    val maxExt = if (effCap > netConfirmed) effCap - netConfirmed else 0
    val num = targetRoom * 100 - 85 * netConfirmed
    val rawNeeded = if (num <= 0) 0 else (num + 54) / 55
    minInt(maxExt, rawNeeded)
  }

  pure def pickBackupNetAnchor(membersSet: Set[str]): str =
    if (membersSet.contains("n2")) "n2"
    else if (membersSet.contains("n1")) "n1"
    else ""

  // ------------------------------------------------------------------------------------------ init
  action init = all {
    status' = "draft",
    source' = "",
    isPublicVenue' = true,
    venueWalkInCapacity' = 10,
    targetRoomSize' = 8,
    hideGuestList' = true,
    approvalRequired' = true,
    externalCrowdDisclosed' = false,
    reviewApprover' = "",
    humanReviewApproved' = false,
    hoursToStart' = 72,
    t24Checked' = false,
    t24QuorumMet' = false,
    approvedExternalCap' = 0,
    netMembers' = Map(
      "n1" -> { age: 28, banned: false, optedOut: false, held: false },
      "n2" -> { age: 31, banned: false, optedOut: false, held: false },
      "n3" -> { age: 16, banned: false, optedOut: false, held: false },
    ),
    extGuests' = Map(
      "e1" -> { age: 25, banned: false, optedOut: false, held: false, alreadyMember: false, answeredScreening: true },
      "e2" -> { age: 29, banned: false, optedOut: false, held: false, alreadyMember: false, answeredScreening: true },
      "e3" -> { age: 32, banned: false, optedOut: false, held: false, alreadyMember: false, answeredScreening: true },
      "e4" -> { age: 27, banned: false, optedOut: false, held: false, alreadyMember: false, answeredScreening: true },
      "e5" -> { age: 16, banned: false, optedOut: false, held: false, alreadyMember: false, answeredScreening: true },
    ),
    confirmedNetwork' = Set(),
    confirmedAnchors' = Set(),
    approvedExternals' = Set(),
    networkFeedbackRecorded' = false,
    networkFeedbackPositive' = false,
    safetyFlaggedGuests' = Set(),
    invitesSent' = EXT_GUESTS.mapBy(_ => 0),
    safeFollowupWindow' = true,
    publishHistory' = Set(),
    confirmHistory' = Set(),
    rsvpHistory' = Set(),
    inviteHistory' = Set(),
    rejectedScrapeCount' = 0,
    anchorDropCount' = 0,
    coAnchorPromoted' = false,
  }

  // ------------------------------------------------------------------------------------------ actions
  action ingestEventSource(src: str, walkInCap: int, targetRoom: int, isPub: bool): bool = all {
    status == "draft",
    ALL_SOURCES.contains(src),
    walkInCap == 4 or walkInCap == 10 or walkInCap == 18,
    targetRoom == 6 or targetRoom == 8 or targetRoom == 12,
    if (SANCTIONED_SOURCES.contains(src)) all {
      source' = src,
      venueWalkInCapacity' = walkInCap,
      targetRoomSize' = targetRoom,
      isPublicVenue' = isPub,
      rejectedScrapeCount' = rejectedScrapeCount,
    } else all {
      source' = source,
      venueWalkInCapacity' = venueWalkInCapacity,
      targetRoomSize' = targetRoomSize,
      isPublicVenue' = isPublicVenue,
      rejectedScrapeCount' = rejectedScrapeCount + 1,
    },
    status' = status, hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
    externalCrowdDisclosed' = externalCrowdDisclosed, reviewApprover' = reviewApprover,
    humanReviewApproved' = humanReviewApproved,
    hoursToStart' = hoursToStart, t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet,
    approvedExternalCap' = approvedExternalCap,
    netMembers' = netMembers, extGuests' = extGuests, confirmedNetwork' = confirmedNetwork,
    confirmedAnchors' = confirmedAnchors, approvedExternals' = approvedExternals,
    networkFeedbackRecorded' = networkFeedbackRecorded, networkFeedbackPositive' = networkFeedbackPositive,
    safetyFlaggedGuests' = safetyFlaggedGuests, invitesSent' = invitesSent,
    safeFollowupWindow' = safeFollowupWindow, publishHistory' = publishHistory,
    confirmHistory' = confirmHistory, rsvpHistory' = rsvpHistory, inviteHistory' = inviteHistory,
    anchorDropCount' = anchorDropCount, coAnchorPromoted' = coAnchorPromoted,
  }

  action discloseExternalCrowd: bool = all {
    status == "draft",
    not(externalCrowdDisclosed),
    externalCrowdDisclosed' = true,
    status' = status, source' = source, isPublicVenue' = isPublicVenue,
    venueWalkInCapacity' = venueWalkInCapacity, targetRoomSize' = targetRoomSize,
    hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
    reviewApprover' = reviewApprover, humanReviewApproved' = humanReviewApproved,
    hoursToStart' = hoursToStart, t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet,
    approvedExternalCap' = approvedExternalCap,
    netMembers' = netMembers, extGuests' = extGuests, confirmedNetwork' = confirmedNetwork,
    confirmedAnchors' = confirmedAnchors, approvedExternals' = approvedExternals,
    networkFeedbackRecorded' = networkFeedbackRecorded, networkFeedbackPositive' = networkFeedbackPositive,
    safetyFlaggedGuests' = safetyFlaggedGuests, invitesSent' = invitesSent,
    safeFollowupWindow' = safeFollowupWindow, publishHistory' = publishHistory,
    confirmHistory' = confirmHistory, rsvpHistory' = rsvpHistory, inviteHistory' = inviteHistory,
    rejectedScrapeCount' = rejectedScrapeCount, anchorDropCount' = anchorDropCount,
    coAnchorPromoted' = coAnchorPromoted,
  }

  action confirmNetworkMember(m: str, asAnchor: bool): bool = {
    val nm = netMembers.get(m)
    val effCap = minInt(HARD_OPEN_EVENT_CAP, venueWalkInCapacity)
    val nextNet = confirmedNetwork.union(Set(m))
    val nextAnchors = if (asAnchor) confirmedAnchors.union(Set(m)) else confirmedAnchors
    val ev: ConfirmEv = {
      member: m,
      ageAtConfirm: nm.age,
      crowdDisclosedAtConfirm: externalCrowdDisclosed,
    }
    all {
      status == "draft" or status == "published",
      NET_MEMBERS.contains(m),
      externalCrowdDisclosed,
      isAdult(nm.age),
      not(nm.banned),
      not(nm.optedOut),
      not(nm.held),
      not(confirmedNetwork.contains(m)),
      nextNet.size() + approvedExternals.size() <= effCap,
      confirmedNetwork' = nextNet,
      confirmedAnchors' = nextAnchors,
      approvedExternalCap' = if (status == "published")
        computeExternalCap(nextNet.size(), venueWalkInCapacity, targetRoomSize)
      else approvedExternalCap,
      confirmHistory' = confirmHistory.union(Set(ev)),
      status' = status, source' = source, isPublicVenue' = isPublicVenue,
      venueWalkInCapacity' = venueWalkInCapacity, targetRoomSize' = targetRoomSize,
      hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
      externalCrowdDisclosed' = externalCrowdDisclosed, reviewApprover' = reviewApprover,
      humanReviewApproved' = humanReviewApproved,
      hoursToStart' = hoursToStart, t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet,
      netMembers' = netMembers, extGuests' = extGuests, approvedExternals' = approvedExternals,
      networkFeedbackRecorded' = networkFeedbackRecorded, networkFeedbackPositive' = networkFeedbackPositive,
      safetyFlaggedGuests' = safetyFlaggedGuests, invitesSent' = invitesSent,
      safeFollowupWindow' = safeFollowupWindow, publishHistory' = publishHistory,
      rsvpHistory' = rsvpHistory, inviteHistory' = inviteHistory,
      rejectedScrapeCount' = rejectedScrapeCount, anchorDropCount' = anchorDropCount,
      coAnchorPromoted' = coAnchorPromoted,
    }
  }

  // Recorded review approval (spec/automatedReview.md): review judge or named staff for a held item.
  action reviewApproveEvent(approver: str): bool = all {
    status == "draft",
    not(humanReviewApproved),
    Set("judge", "staff").contains(approver),
    SANCTIONED_SOURCES.contains(source),
    isPublicVenue,
    hideGuestList,
    approvalRequired,
    externalCrowdDisclosed,
    confirmedAnchors.size() >= 1,
    reviewApprover' = approver,
    humanReviewApproved' = true,
    status' = status, source' = source, isPublicVenue' = isPublicVenue,
    venueWalkInCapacity' = venueWalkInCapacity, targetRoomSize' = targetRoomSize,
    hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
    externalCrowdDisclosed' = externalCrowdDisclosed, hoursToStart' = hoursToStart,
    t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet, approvedExternalCap' = approvedExternalCap,
    netMembers' = netMembers, extGuests' = extGuests, confirmedNetwork' = confirmedNetwork,
    confirmedAnchors' = confirmedAnchors, approvedExternals' = approvedExternals,
    networkFeedbackRecorded' = networkFeedbackRecorded, networkFeedbackPositive' = networkFeedbackPositive,
    safetyFlaggedGuests' = safetyFlaggedGuests, invitesSent' = invitesSent,
    safeFollowupWindow' = safeFollowupWindow, publishHistory' = publishHistory,
    confirmHistory' = confirmHistory, rsvpHistory' = rsvpHistory, inviteHistory' = inviteHistory,
    rejectedScrapeCount' = rejectedScrapeCount, anchorDropCount' = anchorDropCount,
    coAnchorPromoted' = coAnchorPromoted,
  }

  action publishExternalEvent: bool = {
    val extCap = computeExternalCap(confirmedNetwork.size(), venueWalkInCapacity, targetRoomSize)
    val effCap = minInt(HARD_OPEN_EVENT_CAP, venueWalkInCapacity)
    val plannedTotal = confirmedNetwork.size() + extCap
    val ev: PublishEv = {
      source: source,
      confirmedAnchorCount: confirmedAnchors.size(),
      reviewApprover: reviewApprover,
      humanReviewApproved: humanReviewApproved,
      isPublicVenue: isPublicVenue,
      hideGuestList: hideGuestList,
      approvalRequired: approvalRequired,
      externalCrowdDisclosed: externalCrowdDisclosed,
      plannedTotal: plannedTotal,
      effectiveCap: effCap,
    }
    all {
      status == "draft",
      SANCTIONED_SOURCES.contains(source),
      confirmedAnchors.size() >= 1,
      confirmedAnchors.forall(a => confirmedNetwork.contains(a) and isAdult(netMembers.get(a).age)),
      confirmedNetwork.forall(m => isAdult(netMembers.get(m).age)),
      humanReviewApproved,
      Set("judge", "staff").contains(reviewApprover),
      isPublicVenue,
      hideGuestList,
      approvalRequired,
      externalCrowdDisclosed,
      plannedTotal <= effCap,
      status' = "published",
      approvedExternalCap' = extCap,
      publishHistory' = publishHistory.union(Set(ev)),
      source' = source, isPublicVenue' = isPublicVenue, venueWalkInCapacity' = venueWalkInCapacity,
      targetRoomSize' = targetRoomSize, hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
      externalCrowdDisclosed' = externalCrowdDisclosed, reviewApprover' = reviewApprover,
      humanReviewApproved' = humanReviewApproved,
      hoursToStart' = hoursToStart, t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet,
      netMembers' = netMembers, extGuests' = extGuests, confirmedNetwork' = confirmedNetwork,
      confirmedAnchors' = confirmedAnchors, approvedExternals' = approvedExternals,
      networkFeedbackRecorded' = networkFeedbackRecorded, networkFeedbackPositive' = networkFeedbackPositive,
      safetyFlaggedGuests' = safetyFlaggedGuests, invitesSent' = invitesSent,
      safeFollowupWindow' = safeFollowupWindow, confirmHistory' = confirmHistory,
      rsvpHistory' = rsvpHistory, inviteHistory' = inviteHistory,
      rejectedScrapeCount' = rejectedScrapeCount, anchorDropCount' = anchorDropCount,
      coAnchorPromoted' = coAnchorPromoted,
    }
  }

  action approveExternalRsvp(g: str): bool = {
    val eg = extGuests.get(g)
    val effCap = minInt(HARD_OPEN_EVENT_CAP, venueWalkInCapacity)
    val totalAfter = confirmedNetwork.size() + approvedExternals.size() + 1
    val ev: RsvpEv = {
      guest: g,
      ageAtApprove: eg.age,
      bannedAtApprove: eg.banned,
      optedOutAtApprove: eg.optedOut,
      heldAtApprove: eg.held,
      answeredScreening: eg.answeredScreening,
      totalAfterApprove: totalAfter,
      effectiveCap: effCap,
    }
    all {
      status == "published" or status == "confirmed_go",
      EXT_GUESTS.contains(g),
      not(approvedExternals.contains(g)),
      isAdult(eg.age),
      not(eg.banned),
      not(eg.optedOut),
      not(eg.held),
      eg.answeredScreening,
      approvedExternals.size() < approvedExternalCap,
      totalAfter <= effCap,
      approvedExternals' = approvedExternals.union(Set(g)),
      rsvpHistory' = rsvpHistory.union(Set(ev)),
      status' = status, source' = source, isPublicVenue' = isPublicVenue,
      venueWalkInCapacity' = venueWalkInCapacity, targetRoomSize' = targetRoomSize,
      hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
      externalCrowdDisclosed' = externalCrowdDisclosed, reviewApprover' = reviewApprover,
      humanReviewApproved' = humanReviewApproved,
      hoursToStart' = hoursToStart, t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet,
      approvedExternalCap' = approvedExternalCap,
      netMembers' = netMembers, extGuests' = extGuests, confirmedNetwork' = confirmedNetwork,
      confirmedAnchors' = confirmedAnchors, networkFeedbackRecorded' = networkFeedbackRecorded,
      networkFeedbackPositive' = networkFeedbackPositive, safetyFlaggedGuests' = safetyFlaggedGuests,
      invitesSent' = invitesSent, safeFollowupWindow' = safeFollowupWindow,
      publishHistory' = publishHistory, confirmHistory' = confirmHistory, inviteHistory' = inviteHistory,
      rejectedScrapeCount' = rejectedScrapeCount, anchorDropCount' = anchorDropCount,
      coAnchorPromoted' = coAnchorPromoted,
    }
  }

  action anchorDrop(a: str): bool = {
    val remNet = confirmedNetwork.exclude(Set(a))
    val remAnchors = confirmedAnchors.exclude(Set(a))
    val backup = if (remAnchors.size() == 0) pickBackupNetAnchor(remNet) else ""
    val nextAnchors = if (backup != "") remAnchors.union(Set(backup)) else remAnchors
    val mustCancel = nextAnchors.size() == 0
    val nextStatus = if (mustCancel) "cancelled_no_anchor" else status
    all {
      status == "published" or status == "confirmed_go",
      confirmedAnchors.contains(a),
      confirmedNetwork' = remNet,
      confirmedAnchors' = nextAnchors,
      status' = nextStatus,
      anchorDropCount' = anchorDropCount + 1,
      coAnchorPromoted' = (coAnchorPromoted or (backup != "")),
      source' = source, isPublicVenue' = isPublicVenue, venueWalkInCapacity' = venueWalkInCapacity,
      targetRoomSize' = targetRoomSize, hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
      externalCrowdDisclosed' = externalCrowdDisclosed, reviewApprover' = reviewApprover,
      humanReviewApproved' = humanReviewApproved,
      hoursToStart' = hoursToStart, t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet,
      approvedExternalCap' = approvedExternalCap,
      netMembers' = netMembers, extGuests' = extGuests, approvedExternals' = approvedExternals,
      networkFeedbackRecorded' = networkFeedbackRecorded, networkFeedbackPositive' = networkFeedbackPositive,
      safetyFlaggedGuests' = safetyFlaggedGuests, invitesSent' = invitesSent,
      safeFollowupWindow' = safeFollowupWindow, publishHistory' = publishHistory,
      confirmHistory' = confirmHistory, rsvpHistory' = rsvpHistory, inviteHistory' = inviteHistory,
      rejectedScrapeCount' = rejectedScrapeCount,
    }
  }

  action evaluateT24Quorum: bool = {
    val noAnchor = confirmedAnchors.size() == 0
    val lowQuorum = confirmedNetwork.size() < 3 and approvedExternals.size() < 3
    val nextStatus =
      if (noAnchor) "cancelled_no_anchor"
      else if (lowQuorum) "cancelled_low_quorum"
      else "confirmed_go"
    all {
      status == "published",
      not(t24Checked),
      hoursToStart' = 24,
      t24Checked' = true,
      t24QuorumMet' = (not(noAnchor) and not(lowQuorum)),
      status' = nextStatus,
      source' = source, isPublicVenue' = isPublicVenue, venueWalkInCapacity' = venueWalkInCapacity,
      targetRoomSize' = targetRoomSize, hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
      externalCrowdDisclosed' = externalCrowdDisclosed, reviewApprover' = reviewApprover,
      humanReviewApproved' = humanReviewApproved,
      approvedExternalCap' = approvedExternalCap, netMembers' = netMembers, extGuests' = extGuests,
      confirmedNetwork' = confirmedNetwork, confirmedAnchors' = confirmedAnchors,
      approvedExternals' = approvedExternals, networkFeedbackRecorded' = networkFeedbackRecorded,
      networkFeedbackPositive' = networkFeedbackPositive, safetyFlaggedGuests' = safetyFlaggedGuests,
      invitesSent' = invitesSent, safeFollowupWindow' = safeFollowupWindow,
      publishHistory' = publishHistory, confirmHistory' = confirmHistory,
      rsvpHistory' = rsvpHistory, inviteHistory' = inviteHistory,
      rejectedScrapeCount' = rejectedScrapeCount, anchorDropCount' = anchorDropCount,
      coAnchorPromoted' = coAnchorPromoted,
    }
  }

  action completeEvent: bool = all {
    status == "confirmed_go",
    t24Checked,
    t24QuorumMet,
    confirmedAnchors.size() >= 1,
    hoursToStart' = 0,
    status' = "completed",
    source' = source, isPublicVenue' = isPublicVenue, venueWalkInCapacity' = venueWalkInCapacity,
    targetRoomSize' = targetRoomSize, hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
    externalCrowdDisclosed' = externalCrowdDisclosed, reviewApprover' = reviewApprover,
    humanReviewApproved' = humanReviewApproved,
    t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet, approvedExternalCap' = approvedExternalCap,
    netMembers' = netMembers, extGuests' = extGuests, confirmedNetwork' = confirmedNetwork,
    confirmedAnchors' = confirmedAnchors, approvedExternals' = approvedExternals,
    networkFeedbackRecorded' = networkFeedbackRecorded, networkFeedbackPositive' = networkFeedbackPositive,
    safetyFlaggedGuests' = safetyFlaggedGuests, invitesSent' = invitesSent,
    safeFollowupWindow' = safeFollowupWindow, publishHistory' = publishHistory,
    confirmHistory' = confirmHistory, rsvpHistory' = rsvpHistory, inviteHistory' = inviteHistory,
    rejectedScrapeCount' = rejectedScrapeCount, anchorDropCount' = anchorDropCount,
    coAnchorPromoted' = coAnchorPromoted,
  }

  action recordNetworkFeedback(positive: bool, flaggedGuest: str): bool = all {
    status == "completed",
    not(networkFeedbackRecorded),
    flaggedGuest == "" or approvedExternals.contains(flaggedGuest),
    networkFeedbackRecorded' = true,
    networkFeedbackPositive' = positive,
    safetyFlaggedGuests' = if (flaggedGuest != "") safetyFlaggedGuests.union(Set(flaggedGuest)) else safetyFlaggedGuests,
    status' = status, source' = source, isPublicVenue' = isPublicVenue,
    venueWalkInCapacity' = venueWalkInCapacity, targetRoomSize' = targetRoomSize,
    hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
    externalCrowdDisclosed' = externalCrowdDisclosed, reviewApprover' = reviewApprover,
    humanReviewApproved' = humanReviewApproved,
    hoursToStart' = hoursToStart, t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet,
    approvedExternalCap' = approvedExternalCap,
    netMembers' = netMembers, extGuests' = extGuests, confirmedNetwork' = confirmedNetwork,
    confirmedAnchors' = confirmedAnchors, approvedExternals' = approvedExternals,
    invitesSent' = invitesSent, safeFollowupWindow' = safeFollowupWindow,
    publishHistory' = publishHistory, confirmHistory' = confirmHistory,
    rsvpHistory' = rsvpHistory, inviteHistory' = inviteHistory,
    rejectedScrapeCount' = rejectedScrapeCount, anchorDropCount' = anchorDropCount,
    coAnchorPromoted' = coAnchorPromoted,
  }

  action sendNetworkInvite(g: str): bool = {
    val eg = extGuests.get(g)
    val prevInvites = invitesSent.get(g)
    val ev: InviteEv = {
      guest: g,
      eventCompleted: status == "completed",
      networkFeedbackPositive: networkFeedbackPositive,
      safetyFlagged: safetyFlaggedGuests.contains(g),
      attendeeAge: eg.age,
      optedOutAtSend: eg.optedOut,
      bannedAtSend: eg.banned,
      alreadyMember: eg.alreadyMember,
      invitesBefore: prevInvites,
      safeFollowupWindow: safeFollowupWindow,
    }
    all {
      status == "completed",
      approvedExternals.contains(g),
      networkFeedbackRecorded,
      networkFeedbackPositive,
      not(safetyFlaggedGuests.contains(g)),
      isAdult(eg.age),
      not(eg.optedOut),
      not(eg.banned),
      not(eg.alreadyMember),
      prevInvites == 0,
      safeFollowupWindow,
      invitesSent' = invitesSent.set(g, prevInvites + 1),
      inviteHistory' = inviteHistory.union(Set(ev)),
      status' = status, source' = source, isPublicVenue' = isPublicVenue,
      venueWalkInCapacity' = venueWalkInCapacity, targetRoomSize' = targetRoomSize,
      hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
      externalCrowdDisclosed' = externalCrowdDisclosed, reviewApprover' = reviewApprover,
      humanReviewApproved' = humanReviewApproved,
      hoursToStart' = hoursToStart, t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet,
      approvedExternalCap' = approvedExternalCap,
      netMembers' = netMembers, extGuests' = extGuests, confirmedNetwork' = confirmedNetwork,
      confirmedAnchors' = confirmedAnchors, approvedExternals' = approvedExternals,
      networkFeedbackRecorded' = networkFeedbackRecorded, networkFeedbackPositive' = networkFeedbackPositive,
      safetyFlaggedGuests' = safetyFlaggedGuests, safeFollowupWindow' = safeFollowupWindow,
      publishHistory' = publishHistory, confirmHistory' = confirmHistory, rsvpHistory' = rsvpHistory,
      rejectedScrapeCount' = rejectedScrapeCount, anchorDropCount' = anchorDropCount,
      coAnchorPromoted' = coAnchorPromoted,
    }
  }

  action guestOptOutOrBan(g: str, isOptOut: bool): bool = {
    val eg = extGuests.get(g)
    all {
      EXT_GUESTS.contains(g),
      extGuests' = extGuests.set(g, {
        ...eg,
        optedOut: eg.optedOut or isOptOut,
        banned: eg.banned or not(isOptOut),
      }),
      approvedExternals' = if (status == "completed") approvedExternals else approvedExternals.exclude(Set(g)),
      status' = status, source' = source, isPublicVenue' = isPublicVenue,
      venueWalkInCapacity' = venueWalkInCapacity, targetRoomSize' = targetRoomSize,
      hideGuestList' = hideGuestList, approvalRequired' = approvalRequired,
      externalCrowdDisclosed' = externalCrowdDisclosed, reviewApprover' = reviewApprover,
      humanReviewApproved' = humanReviewApproved,
      hoursToStart' = hoursToStart, t24Checked' = t24Checked, t24QuorumMet' = t24QuorumMet,
      approvedExternalCap' = approvedExternalCap,
      netMembers' = netMembers, confirmedNetwork' = confirmedNetwork, confirmedAnchors' = confirmedAnchors,
      networkFeedbackRecorded' = networkFeedbackRecorded, networkFeedbackPositive' = networkFeedbackPositive,
      safetyFlaggedGuests' = safetyFlaggedGuests, invitesSent' = invitesSent,
      safeFollowupWindow' = safeFollowupWindow, publishHistory' = publishHistory,
      confirmHistory' = confirmHistory, rsvpHistory' = rsvpHistory, inviteHistory' = inviteHistory,
      rejectedScrapeCount' = rejectedScrapeCount, anchorDropCount' = anchorDropCount,
      coAnchorPromoted' = coAnchorPromoted,
    }
  }

  action step = any {
    nondet src = ALL_SOURCES.oneOf()
    nondet cap = Set(4, 10, 18).oneOf()
    nondet tgt = Set(6, 8, 12).oneOf()
    nondet pub = Set(true, false).oneOf()
    ingestEventSource(src, cap, tgt, pub),
    discloseExternalCrowd,
    nondet m = NET_MEMBERS.oneOf()
    nondet anc = Set(true, false).oneOf()
    confirmNetworkMember(m, anc),
    nondet ap = Set("judge", "staff").oneOf()
    reviewApproveEvent(ap),
    publishExternalEvent,
    nondet g = EXT_GUESTS.oneOf()
    approveExternalRsvp(g),
    nondet a = NET_MEMBERS.oneOf()
    anchorDrop(a),
    evaluateT24Quorum,
    completeEvent,
    all {
      status == "completed",
      not(networkFeedbackRecorded),
      nondet pos = Set(true, false).oneOf()
      nondet fg = Set("", "e1").oneOf()
      recordNetworkFeedback(pos, fg),
    },
    nondet g = EXT_GUESTS.oneOf()
    sendNetworkInvite(g),
    nondet g = EXT_GUESTS.oneOf()
    nondet oo = Set(true, false).oneOf()
    guestOptOutOrBan(g, oo),
  }

  // ------------------------------------------------------------------------------------------ invariants
  val externalEventIngestSanctionedOnly =
    (source != "" implies SANCTIONED_SOURCES.contains(source)) and
    publishHistory.forall(e => SANCTIONED_SOURCES.contains(e.source))

  val externalEventHasConfirmedAnchor =
    ((status == "published" or status == "confirmed_go" or status == "completed") implies and {
      confirmedAnchors.size() >= 1,
      confirmedAnchors.forall(a => confirmedNetwork.contains(a) and isAdult(netMembers.get(a).age)),
      humanReviewApproved,
      Set("judge", "staff").contains(reviewApprover),
      isPublicVenue,
      confirmedNetwork.size() + approvedExternals.size() <= minInt(HARD_OPEN_EVENT_CAP, venueWalkInCapacity),
    }) and
    publishHistory.forall(e => and {
      e.confirmedAnchorCount >= 1,
      e.humanReviewApproved,
      Set("judge", "staff").contains(e.reviewApprover),
      e.isPublicVenue,
      e.plannedTotal <= e.effectiveCap,
      e.effectiveCap <= HARD_OPEN_EVENT_CAP,
    })

  val externalEventT24QuorumGuard =
    ((status == "confirmed_go" or status == "completed") implies and {
      t24Checked,
      t24QuorumMet,
      confirmedAnchors.size() >= 1,
    }) and
    ((t24Checked and not(t24QuorumMet)) implies (status == "cancelled_low_quorum" or status == "cancelled_no_anchor"))

  val hostedEventGuestListHiddenAndGated =
    ((status == "published" or status == "confirmed_go" or status == "completed") implies
      (hideGuestList and approvalRequired)) and
    publishHistory.forall(e => e.hideGuestList and e.approvalRequired)

  val externalCrowdDisclosedBeforeConfirm =
    confirmHistory.forall(e => e.crowdDisclosedAtConfirm) and
    (confirmedNetwork.size() > 0 implies externalCrowdDisclosed) and
    publishHistory.forall(e => e.externalCrowdDisclosed)

  val noMinorInAnyEventOrCoattend =
    confirmedNetwork.forall(m => isAdult(netMembers.get(m).age)) and
    confirmedAnchors.forall(a => isAdult(netMembers.get(a).age)) and
    approvedExternals.forall(g => isAdult(extGuests.get(g).age)) and
    confirmHistory.forall(e => isAdult(e.ageAtConfirm)) and
    rsvpHistory.forall(e => isAdult(e.ageAtApprove) and e.answeredScreening and not(e.bannedAtApprove) and not(e.optedOutAtApprove) and not(e.heldAtApprove)) and
    inviteHistory.forall(e => isAdult(e.attendeeAge))

  val externalInviteQualityGated =
    inviteHistory.forall(e => and {
      e.eventCompleted,
      e.networkFeedbackPositive,
      not(e.safetyFlagged),
      isAdult(e.attendeeAge),
      not(e.optedOutAtSend),
      not(e.bannedAtSend),
      not(e.alreadyMember),
      e.invitesBefore == 0,
      e.safeFollowupWindow,
    }) and
    EXT_GUESTS.forall(g => invitesSent.get(g) <= 1)

  val safety = and {
    externalEventIngestSanctionedOnly,
    externalEventHasConfirmedAnchor,
    externalEventT24QuorumGuard,
    hostedEventGuestListHiddenAndGated,
    externalCrowdDisclosedBeforeConfirm,
    noMinorInAnyEventOrCoattend,
    externalInviteQualityGated,
  }

  // ------------------------------------------------------------------------------------------ witnesses
  val witness_scrapedSourceRejected = not(rejectedScrapeCount > 0)

  val witness_qualityGatedInviteSent = not(inviteHistory.size() > 0)

  val witness_t24LowQuorumCancel = not(status == "cancelled_low_quorum")

  val witness_anchorDropHandled = not(
    anchorDropCount > 0 and (status == "cancelled_no_anchor" or coAnchorPromoted)
  )

  val witness_overbookingCapReached = not(
    (status == "published" or status == "confirmed_go") and
    approvedExternalCap > 0 and
    approvedExternals.size() == approvedExternalCap
  )

  // ------------------------------------------------------------------------------------------ run tests
  run happyLumaEventAndQualityInviteTest =
    init
      .then(ingestEventSource("official_api", 10, 8, true))
      .then(discloseExternalCrowd)
      .then(confirmNetworkMember("n1", true))
      .then(reviewApproveEvent("judge"))
      .then(publishExternalEvent)
      .then(approveExternalRsvp("e1"))
      .then(approveExternalRsvp("e2"))
      .then(approveExternalRsvp("e3"))
      .then(evaluateT24Quorum)
      .expect(status == "confirmed_go" and t24Checked and safety)
      .then(completeEvent)
      .then(recordNetworkFeedback(true, ""))
      .then(sendNetworkInvite("e1"))
      .expect(invitesSent.get("e1") == 1 and externalInviteQualityGated and safety)
      .then(sendNetworkInvite("e1"))
      .fail()

  run scrapedSourceRejectedTest =
    init
      .then(ingestEventSource("scraped", 10, 8, true))
      .expect(rejectedScrapeCount == 1 and source == "" and externalEventIngestSanctionedOnly and safety)
      .then(publishExternalEvent)
      .fail()

  run t24LowQuorumCancelsCleanlyTest =
    init
      .then(ingestEventSource("official_api", 10, 8, true))
      .then(discloseExternalCrowd)
      .then(confirmNetworkMember("n1", true))
      .then(reviewApproveEvent("staff"))
      .then(publishExternalEvent)
      .then(approveExternalRsvp("e1"))
      .then(approveExternalRsvp("e2"))
      .then(evaluateT24Quorum)
      .expect(status == "cancelled_low_quorum" and externalEventT24QuorumGuard and safety)

  run soleAnchorDropCancelsCleanlyTest =
    init
      .then(ingestEventSource("host_native", 10, 8, true))
      .then(discloseExternalCrowd)
      .then(confirmNetworkMember("n1", true))
      .then(reviewApproveEvent("judge"))
      .then(publishExternalEvent)
      .then(anchorDrop("n1"))
      .expect(status == "cancelled_no_anchor" and externalEventHasConfirmedAnchor and safety)

  run backupAnchorPromotedOnDropTest =
    init
      .then(ingestEventSource("member_submitted_public", 10, 8, true))
      .then(discloseExternalCrowd)
      .then(confirmNetworkMember("n1", true))
      .then(confirmNetworkMember("n2", false))
      .then(reviewApproveEvent("judge"))
      .then(publishExternalEvent)
      .then(anchorDrop("n1"))
      .expect(status == "published" and coAnchorPromoted and confirmedAnchors.contains("n2") and safety)

  run minorRefusedTest =
    init
      .then(ingestEventSource("official_api", 10, 8, true))
      .then(discloseExternalCrowd)
      .then(confirmNetworkMember("n3", true))
      .fail()

  run minorExternalRsvpRefusedTest =
    init
      .then(ingestEventSource("official_api", 10, 8, true))
      .then(discloseExternalCrowd)
      .then(confirmNetworkMember("n1", true))
      .then(reviewApproveEvent("judge"))
      .then(publishExternalEvent)
      .then(approveExternalRsvp("e5"))
      .fail()

  run negativeFeedbackBlocksInviteTest =
    init
      .then(ingestEventSource("official_api", 10, 8, true))
      .then(discloseExternalCrowd)
      .then(confirmNetworkMember("n1", true))
      .then(reviewApproveEvent("judge"))
      .then(publishExternalEvent)
      .then(approveExternalRsvp("e1"))
      .then(approveExternalRsvp("e2"))
      .then(approveExternalRsvp("e3"))
      .then(evaluateT24Quorum)
      .then(completeEvent)
      .then(recordNetworkFeedback(false, ""))
      .then(sendNetworkInvite("e1"))
      .fail()

  run overbookingCapClampedTest =
    init
      .then(ingestEventSource("official_api", 4, 12, true))
      .then(discloseExternalCrowd)
      .then(confirmNetworkMember("n1", true))
      .then(reviewApproveEvent("judge"))
      .then(publishExternalEvent)
      .expect(approvedExternalCap == 3 and safety)
      .then(approveExternalRsvp("e1"))
      .then(approveExternalRsvp("e2"))
      .then(approveExternalRsvp("e3"))
      .then(approveExternalRsvp("e4"))
      .fail()
}
```
