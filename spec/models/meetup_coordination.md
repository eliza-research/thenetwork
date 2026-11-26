# Meetup arrival coordination and follow-ups

## Story: Coordinate safe on-site arrival, backup pivots, anchor failover, and quiet-hour follow-ups

Confirmed adult attendees need on-site arrival coordination with surprise closure and venue-full backup pivots, immediate relay halt on panic or block, anchor failover and cutoff quorum checks, T+12m/T+18m no-show escalation, and TCPA/FTSA-compliant post-encounter follow-ups.

### Safety rules and reachability

Check adult-only arrival relay, panic and block immediate halt, `venue_full` pivot without closing quarantine versus `venue_closed` pivot with quarantine, anchor drop reassignment or clean cancellation, cutoff quorum enforcement, LeakGuard and Clef gating, no-show escalation, and post-encounter follow-up quiet hours and daily proactive caps. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [meetup coordination spec](../meetupCoordination.md) generates pure arrival phase, relay safety, backup pivot, venue quarantine, anchor failover, no-show escalation, and follow-up scheduling decisions. The [booked meeting late arrivals spec](../groupLateArrival.md) governs fixed-text late-arrival notices (`lateArrivalLeadMs`, `lateArrivalGraceMs`, pair roster of 2 and group roster of at least 3 booked receipts without leaking reporter text). This whole-flow model composes that arrival window with live venue pivots, panic safety exits, anchor failover, and post-meetup follow-ups.

See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=30 max-samples=4000 verify-steps=8
//
// Agent-mediated on-site meetup arrival coordination ("finding each other"), surprise-closure
// and venue-full backup venue pivot, panic/block immediate relay halt, anchor failover & cutoff
// quorum guard, 18+ minor exclusion, T+12m/T+18m no-show escalation, and TCPA/FTSA-compliant
// post-encounter follow-up scheduling
// (docs/design/2026-11-26-meetup-setup-and-external-matchmaking.md;
// spec/meetupCoordination.md, spec/groupLateArrival.md).
//
// Bounds: up to 5 attendees (a..e); mode = "slop" (2 attendees: a, b) or "friends" (5 attendees: a..e).
// Leak guard and Clef classifier are modeled as nondeterministic boolean oracles.
module meetup_coordination {

  // ------------------------------------------------------------------------------------------ constants
  pure val ALL_PEOPLE = Set("a", "b", "c", "d", "e")
  pure val SLOP_ATTENDEES = Set("a", "b")
  pure val FRIENDS_ATTENDEES = Set("a", "b", "c", "d", "e")
  pure val DAILY_PROACTIVE_CAP = 3
  pure val QUIET_START_HOUR = 20
  pure val QUIET_END_HOUR = 9

  // ------------------------------------------------------------------------------------------ types
  type RelayEv = {
    sender: str,
    recipients: Set[str],
    phaseAtSend: str,
    senderAdult: bool,
    recipientsAdult: bool,
    allConfirmed: bool,
    noneBlockedOrOptedOut: bool,
    panicAtSend: bool,
    leakPassed: bool,
    clefPassed: bool,
  }

  type FollowupEv = {
    member: str,
    sendHour: int,
    optedOutAtSend: bool,
    minorAtSend: bool,
    dailyCountBefore: int,
  }

  type MetEv = {
    member: str,
    adultAtMet: bool,
  }

  // ------------------------------------------------------------------------------------------ state
  var mode: str                       // slop | friends
  var phase: str                      // before | pre_brief | active_arrival | closed
  var relMin: int                     // minutes relative to meetup start T=0 (-90..45)
  var meetupEndHour: int              // local hour 0..23 when meetup ends (14 daytime, 19 evening)
  var primaryVenue: str
  var primaryStatus: str              // active | suspect_closed
  var backupVenue: str                // "v_backup" or "" if none
  var backupVerifiedOpen: bool
  var activeVenue: str
  var backupPivoted: bool
  var closureReported: bool
  var venueFullReported: bool
  var crowdedLogged: bool
  var anchor: str                     // "" for slop; confirmed adult Network anchor for friends
  var anchorDropped: bool
  var coAnchorPromoted: bool
  var quorumCheckedAtCutoff: bool
  var meetupCancelled: bool
  var cancelReason: str               // "" | anchor_drop | low_quorum | panic | minor_evict
  var panicActive: bool
  var attendees: Set[str]
  var confirmed: Set[str]
  var arrived: Set[str]
  var met: Set[str]
  var metHistory: Set[MetEv]
  var optedOut: Set[str]
  var blocked: Set[str]
  var isMinor: Set[str]
  var relayedMessages: Set[RelayEv]
  var blockedBySafetyCount: int
  var noShowPinged: Set[str]
  var waitingNotified: Set[str]
  var followupScheduledHour: int      // -1 if unscheduled, else 9..19
  var followupNextDay: bool
  var followupSent: Set[str]
  var followupLog: Set[FollowupEv]
  var dailyProactiveCount: str -> int
  var feedbackRecorded: Set[str]

  // ------------------------------------------------------------------------------------------ helpers
  pure def isQuietHour(h: int): bool = h < QUIET_END_HOUR or h >= QUIET_START_HOUR

  pure def eligibleForRelay(
    m: str,
    att: Set[str],
    conf: Set[str],
    minors: Set[str],
    optOut: Set[str],
    blk: Set[str]
  ): bool =
    att.contains(m) and conf.contains(m) and not(minors.contains(m)) and not(optOut.contains(m)) and not(blk.contains(m))

  pure def eligibleForProactive(
    m: str,
    att: Set[str],
    conf: Set[str],
    minors: Set[str],
    optOut: Set[str],
    blk: Set[str],
    counts: str -> int
  ): bool =
    eligibleForRelay(m, att, conf, minors, optOut, blk) and counts.get(m) < DAILY_PROACTIVE_CAP

  pure def minQuorumFor(m: str): int =
    if (m == "friends") 3 else 2

  pure def pickBackupAnchor(rem: Set[str]): str =
    if (rem.contains("b")) "b"
    else if (rem.contains("c")) "c"
    else if (rem.contains("d")) "d"
    else if (rem.contains("e")) "e"
    else if (rem.contains("a")) "a"
    else ""

  // ------------------------------------------------------------------------------------------ init
  action init = all {
    mode' = "slop",
    phase' = "before",
    relMin' = -90,
    meetupEndHour' = 19,
    primaryVenue' = "v_primary",
    primaryStatus' = "active",
    backupVenue' = "v_backup",
    backupVerifiedOpen' = true,
    activeVenue' = "v_primary",
    backupPivoted' = false,
    closureReported' = false,
    venueFullReported' = false,
    crowdedLogged' = false,
    anchor' = "",
    anchorDropped' = false,
    coAnchorPromoted' = false,
    quorumCheckedAtCutoff' = false,
    meetupCancelled' = false,
    cancelReason' = "",
    panicActive' = false,
    attendees' = SLOP_ATTENDEES,
    confirmed' = SLOP_ATTENDEES,
    arrived' = Set(),
    met' = Set(),
    metHistory' = Set(),
    optedOut' = Set(),
    blocked' = Set(),
    isMinor' = Set(),
    relayedMessages' = Set(),
    blockedBySafetyCount' = 0,
    noShowPinged' = Set(),
    waitingNotified' = Set(),
    followupScheduledHour' = -1,
    followupNextDay' = false,
    followupSent' = Set(),
    followupLog' = Set(),
    dailyProactiveCount' = ALL_PEOPLE.mapBy(_ => 0),
    feedbackRecorded' = Set(),
  }

  // ------------------------------------------------------------------------------------------ actions
  action configureMeetup(newMode: str, endHour: int, hasBackup: bool): bool = {
    val att = if (newMode == "friends") FRIENDS_ATTENDEES else SLOP_ATTENDEES
    val adultAtt = att.filter(p => not(isMinor.contains(p)))
    val initAnchor = if (newMode == "friends") pickBackupAnchor(adultAtt) else ""
    all {
      phase == "before",
      not(meetupCancelled),
      relMin == -90,
      newMode == "slop" or newMode == "friends",
      endHour == 14 or endHour == 19,
      adultAtt.size() >= minQuorumFor(newMode),
      newMode == "friends" implies initAnchor != "",
      mode' = newMode,
      meetupEndHour' = endHour,
      backupVenue' = if (hasBackup) "v_backup" else "",
      backupVerifiedOpen' = hasBackup,
      anchor' = initAnchor,
      attendees' = att,
      confirmed' = adultAtt,
      phase' = phase, relMin' = relMin, primaryVenue' = primaryVenue, primaryStatus' = primaryStatus,
      activeVenue' = activeVenue, backupPivoted' = backupPivoted, closureReported' = closureReported,
      venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
      anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
      quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
      cancelReason' = cancelReason, panicActive' = panicActive,
      arrived' = arrived, met' = met, metHistory' = metHistory,
      optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
      relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
      noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
      followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
      followupSent' = followupSent, followupLog' = followupLog,
      dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
    }
  }

  action dropAttendee(m: str): bool = {
    val remConf = confirmed.exclude(Set(m))
    val remArr = arrived.exclude(Set(m))
    val wasAnchor = (mode == "friends" and m == anchor)
    val canPromote = wasAnchor and remConf.size() >= 3
    val mustCancel =
      if (wasAnchor) not(canPromote)
      else (phase == "pre_brief" and remConf.size() < minQuorumFor(mode))
    val nextAnchor =
      if (mustCancel) ""
      else if (canPromote) pickBackupAnchor(remConf)
      else anchor
    all {
      phase == "before" or phase == "pre_brief",
      not(meetupCancelled),
      confirmed.contains(m),
      confirmed' = remConf,
      arrived' = remArr,
      anchor' = nextAnchor,
      anchorDropped' = (anchorDropped or wasAnchor),
      coAnchorPromoted' = (coAnchorPromoted or canPromote),
      meetupCancelled' = (meetupCancelled or mustCancel),
      cancelReason' = if (mustCancel) (if (wasAnchor) "anchor_drop" else "low_quorum") else cancelReason,
      phase' = if (mustCancel) "closed" else phase,
      mode' = mode, relMin' = relMin, meetupEndHour' = meetupEndHour, primaryVenue' = primaryVenue,
      primaryStatus' = primaryStatus, backupVenue' = backupVenue, backupVerifiedOpen' = backupVerifiedOpen,
      activeVenue' = activeVenue, backupPivoted' = backupPivoted, closureReported' = closureReported,
      venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
      quorumCheckedAtCutoff' = quorumCheckedAtCutoff, panicActive' = panicActive,
      attendees' = attendees, met' = met, metHistory' = metHistory,
      optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
      relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
      noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
      followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
      followupSent' = followupSent, followupLog' = followupLog,
      dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
    }
  }

  action sendPreArrivalBrief: bool = {
    val liveAdults = confirmed.filter(p => not(isMinor.contains(p)) and not(optedOut.contains(p)) and not(blocked.contains(p)))
    val hasAnchor = (mode == "slop") or (anchor != "" and liveAdults.contains(anchor))
    val quorumOk = liveAdults.size() >= minQuorumFor(mode) and hasAnchor
    val nextCounts = ALL_PEOPLE.mapBy(m =>
      if (quorumOk and eligibleForProactive(m, attendees, confirmed, isMinor, optedOut, blocked, dailyProactiveCount))
        dailyProactiveCount.get(m) + 1
      else dailyProactiveCount.get(m)
    )
    all {
      phase == "before",
      not(meetupCancelled),
      quorumCheckedAtCutoff' = true,
      if (quorumOk) all {
        phase' = "pre_brief",
        relMin' = -75,
        meetupCancelled' = false,
        cancelReason' = cancelReason,
        dailyProactiveCount' = nextCounts,
      } else all {
        phase' = "closed",
        relMin' = -75,
        meetupCancelled' = true,
        cancelReason' = "low_quorum",
        dailyProactiveCount' = dailyProactiveCount,
      },
      mode' = mode, meetupEndHour' = meetupEndHour, primaryVenue' = primaryVenue,
      primaryStatus' = primaryStatus, backupVenue' = backupVenue, backupVerifiedOpen' = backupVerifiedOpen,
      activeVenue' = activeVenue, backupPivoted' = backupPivoted, closureReported' = closureReported,
      venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
      anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
      panicActive' = panicActive, attendees' = attendees, confirmed' = confirmed, arrived' = arrived,
      met' = met, metHistory' = metHistory, optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
      relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
      noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
      followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
      followupSent' = followupSent, followupLog' = followupLog, feedbackRecorded' = feedbackRecorded,
    }
  }

  action openArrivalWindow: bool = all {
    phase == "pre_brief",
    not(meetupCancelled),
    not(panicActive),
    quorumCheckedAtCutoff,
    confirmed.size() >= minQuorumFor(mode),
    mode == "friends" implies (anchor != "" and confirmed.contains(anchor)),
    phase' = "active_arrival",
    relMin' = -30,
    mode' = mode, meetupEndHour' = meetupEndHour, primaryVenue' = primaryVenue,
    primaryStatus' = primaryStatus, backupVenue' = backupVenue, backupVerifiedOpen' = backupVerifiedOpen,
    activeVenue' = activeVenue, backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
    cancelReason' = cancelReason, panicActive' = panicActive,
    attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
    optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
    relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
    noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
    followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
    followupSent' = followupSent, followupLog' = followupLog,
    dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
  }

  action advanceArrivalClock(nextMin: int): bool = all {
    phase == "active_arrival",
    not(meetupCancelled),
    not(panicActive),
    nextMin > relMin,
    Set(0, 12, 18, 45).contains(nextMin),
    relMin' = nextMin,
    mode' = mode, phase' = phase, meetupEndHour' = meetupEndHour, primaryVenue' = primaryVenue,
    primaryStatus' = primaryStatus, backupVenue' = backupVenue, backupVerifiedOpen' = backupVerifiedOpen,
    activeVenue' = activeVenue, backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
    cancelReason' = cancelReason, panicActive' = panicActive,
    attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
    optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
    relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
    noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
    followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
    followupSent' = followupSent, followupLog' = followupLog,
    dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
  }

  action markArrived(m: str): bool = all {
    phase == "active_arrival",
    not(meetupCancelled),
    not(panicActive),
    eligibleForRelay(m, attendees, confirmed, isMinor, optedOut, blocked),
    not(arrived.contains(m)),
    arrived' = arrived.union(Set(m)),
    mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
    primaryVenue' = primaryVenue, primaryStatus' = primaryStatus, backupVenue' = backupVenue,
    backupVerifiedOpen' = backupVerifiedOpen, activeVenue' = activeVenue,
    backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
    cancelReason' = cancelReason, panicActive' = panicActive,
    attendees' = attendees, confirmed' = confirmed, met' = met, metHistory' = metHistory,
    optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
    relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
    noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
    followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
    followupSent' = followupSent, followupLog' = followupLog,
    dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
  }

  action relayArrivalCue(sender: str, leakPassed: bool, clefPassed: bool): bool = {
    val recips = attendees.filter(r =>
      r != sender and eligibleForRelay(r, attendees, confirmed, isMinor, optedOut, blocked)
    )
    val ev: RelayEv = {
      sender: sender,
      recipients: recips,
      phaseAtSend: phase,
      senderAdult: not(isMinor.contains(sender)),
      recipientsAdult: recips.forall(r => not(isMinor.contains(r))),
      allConfirmed: confirmed.contains(sender) and recips.forall(r => confirmed.contains(r)),
      noneBlockedOrOptedOut:
        not(blocked.contains(sender)) and not(optedOut.contains(sender)) and
        recips.forall(r => not(blocked.contains(r)) and not(optedOut.contains(r))),
      panicAtSend: panicActive,
      leakPassed: leakPassed,
      clefPassed: clefPassed,
    }
    all {
      phase == "active_arrival",
      not(meetupCancelled),
      not(panicActive),
      eligibleForRelay(sender, attendees, confirmed, isMinor, optedOut, blocked),
      not(met.contains(sender)),
      recips.size() > 0,
      if (leakPassed and clefPassed) all {
        relayedMessages' = relayedMessages.union(Set(ev)),
        blockedBySafetyCount' = blockedBySafetyCount,
      } else all {
        relayedMessages' = relayedMessages,
        blockedBySafetyCount' = blockedBySafetyCount + 1,
      },
      mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
      primaryVenue' = primaryVenue, primaryStatus' = primaryStatus, backupVenue' = backupVenue,
      backupVerifiedOpen' = backupVerifiedOpen, activeVenue' = activeVenue,
      backupPivoted' = backupPivoted, closureReported' = closureReported,
      venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
      anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
      quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
      cancelReason' = cancelReason, panicActive' = panicActive,
      attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
      optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
      noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
      followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
      followupSent' = followupSent, followupLog' = followupLog,
      dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
    }
  }

  action reportArrivalClosureAndPivot(reporter: str): bool = {
    val canPivot = backupVenue != "" and backupVerifiedOpen
    all {
      phase == "pre_brief" or phase == "active_arrival",
      not(meetupCancelled),
      not(panicActive),
      eligibleForRelay(reporter, attendees, confirmed, isMinor, optedOut, blocked),
      primaryStatus == "active",
      primaryStatus' = "suspect_closed",
      closureReported' = true,
      activeVenue' = if (canPivot) backupVenue else activeVenue,
      backupPivoted' = (backupPivoted or canPivot),
      mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
      primaryVenue' = primaryVenue, backupVenue' = backupVenue, backupVerifiedOpen' = backupVerifiedOpen,
      venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
      anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
      quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
      cancelReason' = cancelReason, panicActive' = panicActive,
      attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
      optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
      relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
      noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
      followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
      followupSent' = followupSent, followupLog' = followupLog,
      dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
    }
  }

  action reportArrivalVenueFullAndPivot(reporter: str): bool = {
    val canPivot = backupVenue != "" and backupVerifiedOpen
    all {
      phase == "pre_brief" or phase == "active_arrival",
      not(meetupCancelled),
      not(panicActive),
      eligibleForRelay(reporter, attendees, confirmed, isMinor, optedOut, blocked),
      primaryStatus == "active",
      not(venueFullReported),
      not(closureReported),
      venueFullReported' = true,
      crowdedLogged' = true,
      primaryStatus' = primaryStatus,
      activeVenue' = if (canPivot) backupVenue else activeVenue,
      backupPivoted' = (backupPivoted or canPivot),
      mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
      primaryVenue' = primaryVenue, backupVenue' = backupVenue, backupVerifiedOpen' = backupVerifiedOpen,
      closureReported' = closureReported,
      anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
      quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
      cancelReason' = cancelReason, panicActive' = panicActive,
      attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
      optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
      relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
      noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
      followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
      followupSent' = followupSent, followupLog' = followupLog,
      dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
    }
  }

  action triggerPanicSafetyExit(m: str): bool = all {
    phase == "pre_brief" or phase == "active_arrival",
    not(meetupCancelled),
    not(panicActive),
    attendees.contains(m),
    panicActive' = true,
    meetupCancelled' = true,
    phase' = "closed",
    blocked' = blocked.union(attendees.exclude(Set(m))),
    cancelReason' = "panic",
    mode' = mode, relMin' = relMin, meetupEndHour' = meetupEndHour, primaryVenue' = primaryVenue,
    primaryStatus' = primaryStatus, backupVenue' = backupVenue, backupVerifiedOpen' = backupVerifiedOpen,
    activeVenue' = activeVenue, backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff,
    attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
    optedOut' = optedOut, isMinor' = isMinor,
    relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
    noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
    followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
    followupSent' = followupSent, followupLog' = followupLog,
    dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
  }

  action noShowPingLate(lateMember: str): bool = all {
    phase == "active_arrival",
    not(meetupCancelled),
    not(panicActive),
    relMin >= 12,
    arrived.size() > 0,
    eligibleForRelay(lateMember, attendees, confirmed, isMinor, optedOut, blocked),
    not(arrived.contains(lateMember)),
    not(noShowPinged.contains(lateMember)),
    noShowPinged' = noShowPinged.union(Set(lateMember)),
    mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
    primaryVenue' = primaryVenue, primaryStatus' = primaryStatus, backupVenue' = backupVenue,
    backupVerifiedOpen' = backupVerifiedOpen, activeVenue' = activeVenue,
    backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
    cancelReason' = cancelReason, panicActive' = panicActive,
    attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
    optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
    relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
    waitingNotified' = waitingNotified, followupScheduledHour' = followupScheduledHour,
    followupNextDay' = followupNextDay, followupSent' = followupSent, followupLog' = followupLog,
    dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
  }

  action noShowNotifyWaiting(waiter: str): bool = all {
    phase == "active_arrival",
    not(meetupCancelled),
    not(panicActive),
    relMin >= 18,
    arrived.contains(waiter),
    noShowPinged.size() > 0,
    eligibleForRelay(waiter, attendees, confirmed, isMinor, optedOut, blocked),
    not(waitingNotified.contains(waiter)),
    waitingNotified' = waitingNotified.union(Set(waiter)),
    mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
    primaryVenue' = primaryVenue, primaryStatus' = primaryStatus, backupVenue' = backupVenue,
    backupVerifiedOpen' = backupVerifiedOpen, activeVenue' = activeVenue,
    backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
    cancelReason' = cancelReason, panicActive' = panicActive,
    attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
    optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
    relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
    noShowPinged' = noShowPinged, followupScheduledHour' = followupScheduledHour,
    followupNextDay' = followupNextDay, followupSent' = followupSent, followupLog' = followupLog,
    dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
  }

  action confirmMetAndClose: bool = {
    val adultArrived = arrived.filter(p => not(isMinor.contains(p)))
    val newMetEvs = adultArrived.map(p => { member: p, adultAtMet: not(isMinor.contains(p)) })
    all {
      phase == "active_arrival",
      not(meetupCancelled),
      not(panicActive),
      adultArrived.size() >= 2,
      met' = adultArrived,
      metHistory' = metHistory.union(newMetEvs),
      phase' = "closed",
      mode' = mode, relMin' = relMin, meetupEndHour' = meetupEndHour, primaryVenue' = primaryVenue,
      primaryStatus' = primaryStatus, backupVenue' = backupVenue, backupVerifiedOpen' = backupVerifiedOpen,
      activeVenue' = activeVenue, backupPivoted' = backupPivoted, closureReported' = closureReported,
      venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
      anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
      quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
      cancelReason' = cancelReason, panicActive' = panicActive,
      attendees' = attendees, confirmed' = confirmed, arrived' = arrived, optedOut' = optedOut,
      blocked' = blocked, isMinor' = isMinor, relayedMessages' = relayedMessages,
      blockedBySafetyCount' = blockedBySafetyCount, noShowPinged' = noShowPinged,
      waitingNotified' = waitingNotified, followupScheduledHour' = followupScheduledHour,
      followupNextDay' = followupNextDay, followupSent' = followupSent, followupLog' = followupLog,
      dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
    }
  }

  action closeWindowTimeout: bool = all {
    phase == "active_arrival",
    relMin >= 45,
    phase' = "closed",
    mode' = mode, relMin' = relMin, meetupEndHour' = meetupEndHour, primaryVenue' = primaryVenue,
    primaryStatus' = primaryStatus, backupVenue' = backupVenue, backupVerifiedOpen' = backupVerifiedOpen,
    activeVenue' = activeVenue, backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
    cancelReason' = cancelReason, panicActive' = panicActive,
    attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
    optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
    relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
    noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
    followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
    followupSent' = followupSent, followupLog' = followupLog,
    dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
  }

  action schedulePostFollowup: bool = {
    val isDaytime = meetupEndHour <= 16
    val schedHour = if (isDaytime) meetupEndHour + 2 else QUIET_END_HOUR
    all {
      phase == "closed",
      not(meetupCancelled),
      followupScheduledHour == -1,
      followupScheduledHour' = schedHour,
      followupNextDay' = not(isDaytime),
      mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
      primaryVenue' = primaryVenue, primaryStatus' = primaryStatus, backupVenue' = backupVenue,
      backupVerifiedOpen' = backupVerifiedOpen, activeVenue' = activeVenue,
      backupPivoted' = backupPivoted, closureReported' = closureReported,
      venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
      anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
      quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
      cancelReason' = cancelReason, panicActive' = panicActive,
      attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
      optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
      relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
      noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
      followupSent' = followupSent, followupLog' = followupLog,
      dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
    }
  }

  action sendPostFollowup(m: str, sendHour: int): bool = {
    val cnt = dailyProactiveCount.get(m)
    val ev: FollowupEv = {
      member: m,
      sendHour: sendHour,
      optedOutAtSend: optedOut.contains(m),
      minorAtSend: isMinor.contains(m),
      dailyCountBefore: cnt,
    }
    all {
      phase == "closed",
      not(meetupCancelled),
      followupScheduledHour >= 0,
      sendHour == followupScheduledHour,
      not(isQuietHour(sendHour)),
      eligibleForProactive(m, attendees, confirmed, isMinor, optedOut, blocked, dailyProactiveCount),
      not(followupSent.contains(m)),
      followupSent' = followupSent.union(Set(m)),
      followupLog' = followupLog.union(Set(ev)),
      dailyProactiveCount' = dailyProactiveCount.set(m, cnt + 1),
      mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
      primaryVenue' = primaryVenue, primaryStatus' = primaryStatus, backupVenue' = backupVenue,
      backupVerifiedOpen' = backupVerifiedOpen, activeVenue' = activeVenue,
      backupPivoted' = backupPivoted, closureReported' = closureReported,
      venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
      anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
      quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
      cancelReason' = cancelReason, panicActive' = panicActive,
      attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
      optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
      relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
      noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
      followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
      feedbackRecorded' = feedbackRecorded,
    }
  }

  action recordPostFeedback(m: str): bool = all {
    followupSent.contains(m),
    not(feedbackRecorded.contains(m)),
    feedbackRecorded' = feedbackRecorded.union(Set(m)),
    mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
    primaryVenue' = primaryVenue, primaryStatus' = primaryStatus, backupVenue' = backupVenue,
    backupVerifiedOpen' = backupVerifiedOpen, activeVenue' = activeVenue,
    backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
    cancelReason' = cancelReason, panicActive' = panicActive,
    attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
    optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
    relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
    noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
    followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
    followupSent' = followupSent, followupLog' = followupLog,
    dailyProactiveCount' = dailyProactiveCount,
  }

  action memberOptOut(m: str): bool = all {
    attendees.contains(m),
    not(optedOut.contains(m)),
    optedOut' = optedOut.union(Set(m)),
    mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
    primaryVenue' = primaryVenue, primaryStatus' = primaryStatus, backupVenue' = backupVenue,
    backupVerifiedOpen' = backupVerifiedOpen, activeVenue' = activeVenue,
    backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
    cancelReason' = cancelReason, panicActive' = panicActive,
    attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
    blocked' = blocked, isMinor' = isMinor, relayedMessages' = relayedMessages,
    blockedBySafetyCount' = blockedBySafetyCount, noShowPinged' = noShowPinged,
    waitingNotified' = waitingNotified, followupScheduledHour' = followupScheduledHour,
    followupNextDay' = followupNextDay, followupSent' = followupSent, followupLog' = followupLog,
    dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
  }

  action memberBlock(m: str): bool = all {
    attendees.contains(m),
    not(blocked.contains(m)),
    blocked' = blocked.union(Set(m)),
    mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
    primaryVenue' = primaryVenue, primaryStatus' = primaryStatus, backupVenue' = backupVenue,
    backupVerifiedOpen' = backupVerifiedOpen, activeVenue' = activeVenue,
    backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
    cancelReason' = cancelReason, panicActive' = panicActive,
    attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
    optedOut' = optedOut, isMinor' = isMinor, relayedMessages' = relayedMessages,
    blockedBySafetyCount' = blockedBySafetyCount, noShowPinged' = noShowPinged,
    waitingNotified' = waitingNotified, followupScheduledHour' = followupScheduledHour,
    followupNextDay' = followupNextDay, followupSent' = followupSent, followupLog' = followupLog,
    dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
  }

  action flagMinor(m: str): bool = {
    val remConf = confirmed.exclude(Set(m))
    val remArr = arrived.exclude(Set(m))
    val wasAnchor = (mode == "friends" and m == anchor)
    val canPromote = wasAnchor and remConf.size() >= 3
    val inActivePhase = (phase == "pre_brief" or phase == "active_arrival")
    val mustCancel =
      if (wasAnchor) not(canPromote)
      else (inActivePhase and remConf.size() < minQuorumFor(mode))
    val nextAnchor =
      if (mustCancel) ""
      else if (canPromote) pickBackupAnchor(remConf)
      else anchor
    all {
      attendees.contains(m),
      not(isMinor.contains(m)),
      isMinor' = isMinor.union(Set(m)),
      confirmed' = remConf,
      arrived' = remArr,
      anchor' = nextAnchor,
      anchorDropped' = (anchorDropped or wasAnchor),
      coAnchorPromoted' = (coAnchorPromoted or canPromote),
      meetupCancelled' = (meetupCancelled or mustCancel),
      cancelReason' = if (mustCancel) "minor_evict" else cancelReason,
      phase' = if (mustCancel) "closed" else phase,
      mode' = mode, relMin' = relMin, meetupEndHour' = meetupEndHour, primaryVenue' = primaryVenue,
      primaryStatus' = primaryStatus, backupVenue' = backupVenue, backupVerifiedOpen' = backupVerifiedOpen,
      activeVenue' = activeVenue, backupPivoted' = backupPivoted, closureReported' = closureReported,
      venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
      quorumCheckedAtCutoff' = quorumCheckedAtCutoff, panicActive' = panicActive,
      attendees' = attendees, met' = met, metHistory' = metHistory,
      optedOut' = optedOut, blocked' = blocked, relayedMessages' = relayedMessages,
      blockedBySafetyCount' = blockedBySafetyCount, noShowPinged' = noShowPinged,
      waitingNotified' = waitingNotified, followupScheduledHour' = followupScheduledHour,
      followupNextDay' = followupNextDay, followupSent' = followupSent, followupLog' = followupLog,
      dailyProactiveCount' = dailyProactiveCount, feedbackRecorded' = feedbackRecorded,
    }
  }

  action otherAppProactive(m: str): bool = all {
    attendees.contains(m),
    dailyProactiveCount.get(m) < DAILY_PROACTIVE_CAP,
    dailyProactiveCount' = dailyProactiveCount.set(m, dailyProactiveCount.get(m) + 1),
    mode' = mode, phase' = phase, relMin' = relMin, meetupEndHour' = meetupEndHour,
    primaryVenue' = primaryVenue, primaryStatus' = primaryStatus, backupVenue' = backupVenue,
    backupVerifiedOpen' = backupVerifiedOpen, activeVenue' = activeVenue,
    backupPivoted' = backupPivoted, closureReported' = closureReported,
    venueFullReported' = venueFullReported, crowdedLogged' = crowdedLogged,
    anchor' = anchor, anchorDropped' = anchorDropped, coAnchorPromoted' = coAnchorPromoted,
    quorumCheckedAtCutoff' = quorumCheckedAtCutoff, meetupCancelled' = meetupCancelled,
    cancelReason' = cancelReason, panicActive' = panicActive,
    attendees' = attendees, confirmed' = confirmed, arrived' = arrived, met' = met, metHistory' = metHistory,
    optedOut' = optedOut, blocked' = blocked, isMinor' = isMinor,
    relayedMessages' = relayedMessages, blockedBySafetyCount' = blockedBySafetyCount,
    noShowPinged' = noShowPinged, waitingNotified' = waitingNotified,
    followupScheduledHour' = followupScheduledHour, followupNextDay' = followupNextDay,
    followupSent' = followupSent, followupLog' = followupLog, feedbackRecorded' = feedbackRecorded,
  }

  action step = any {
    nondet m = Set("slop", "friends").oneOf()
    nondet eh = Set(14, 19).oneOf()
    nondet hb = Set(true, false).oneOf()
    configureMeetup(m, eh, hb),
    nondet p = attendees.oneOf()
    dropAttendee(p),
    sendPreArrivalBrief,
    openArrivalWindow,
    nondet t = Set(0, 12, 18, 45).oneOf()
    advanceArrivalClock(t),
    nondet p = attendees.oneOf()
    markArrived(p),
    nondet p = attendees.oneOf()
    nondet leakOk = Set(true, false).oneOf()
    nondet clefOk = Set(true, false).oneOf()
    relayArrivalCue(p, leakOk, clefOk),
    nondet p = attendees.oneOf()
    reportArrivalClosureAndPivot(p),
    nondet p = attendees.oneOf()
    reportArrivalVenueFullAndPivot(p),
    nondet p = attendees.oneOf()
    triggerPanicSafetyExit(p),
    nondet p = attendees.oneOf()
    noShowPingLate(p),
    nondet p = attendees.oneOf()
    noShowNotifyWaiting(p),
    confirmMetAndClose,
    closeWindowTimeout,
    schedulePostFollowup,
    all {
      followupScheduledHour >= 0,
      nondet p = attendees.oneOf()
      sendPostFollowup(p, followupScheduledHour),
    },
    nondet p = attendees.oneOf()
    recordPostFeedback(p),
    // Adversarial / cross-app actors share one branch so normal flows complete often.
    nondet p = attendees.oneOf()
    any { memberOptOut(p), memberBlock(p), flagMinor(p), otherAppProactive(p) },
  }

  // ------------------------------------------------------------------------------------------ invariants
  val noMinorInArrivalRelay =
    relayedMessages.forall(e => e.senderAdult and e.recipientsAdult)

  val noMinorInAnyEventOrCoattend =
    confirmed.forall(p => not(isMinor.contains(p))) and
    arrived.forall(p => not(isMinor.contains(p))) and
    (anchor != "" implies not(isMinor.contains(anchor))) and
    metHistory.forall(e => e.adultAtMet) and
    relayedMessages.forall(e => e.senderAdult and e.recipientsAdult) and
    followupLog.forall(e => not(e.minorAtSend))

  val onlyConfirmedUnblockedAdultsRelayed =
    relayedMessages.forall(e => e.senderAdult and e.recipientsAdult and e.allConfirmed and e.noneBlockedOrOptedOut)

  val panicOrBlockImmediatelyHaltsRelay =
    relayedMessages.forall(e => not(e.panicAtSend) and e.noneBlockedOrOptedOut) and
    (panicActive implies phase == "closed")

  val noArrivalRelayOutsideWindow =
    relayedMessages.forall(e => e.phaseAtSend == "active_arrival")

  val noLeakOrPrivateContactInArrivalRelay =
    relayedMessages.forall(e => e.leakPassed and e.clefPassed)

  val closureAlwaysPivotsWhenBackupExists =
    (closureReported and backupVenue != "" and backupVerifiedOpen) implies
      (backupPivoted and activeVenue == backupVenue and primaryStatus == "suspect_closed")

  val venueFullTriggersBackupPivot =
    ((venueFullReported and backupVenue != "" and backupVerifiedOpen) implies
      (backupPivoted and activeVenue == backupVenue and crowdedLogged)) and
    ((venueFullReported and not(closureReported)) implies primaryStatus == "active") and
    (closureReported implies primaryStatus == "suspect_closed")

  val anchorDropReassignedOrCancelled =
    ((mode == "friends" and anchorDropped) implies (meetupCancelled or coAnchorPromoted)) and
    ((mode == "friends" and anchorDropped and (phase == "pre_brief" or phase == "active_arrival")) implies
      (coAnchorPromoted and anchor != "" and confirmed.contains(anchor) and not(isMinor.contains(anchor)) and confirmed.size() >= 3)) and
    ((mode == "friends" and not(meetupCancelled) and phase != "closed") implies
      (anchor != "" and confirmed.contains(anchor) and not(isMinor.contains(anchor))))

  val quorumOrCleanCancelBeforeCutoff =
    (((phase == "pre_brief" or phase == "active_arrival") and not(meetupCancelled)) implies
      (quorumCheckedAtCutoff and confirmed.size() >= minQuorumFor(mode) and
        (mode == "friends" implies (anchor != "" and confirmed.contains(anchor))))) and
    (meetupCancelled implies phase == "closed")

  val followupNeverDuringQuietHours =
    (followupScheduledHour >= 0 implies not(isQuietHour(followupScheduledHour))) and
    followupLog.forall(e => not(isQuietHour(e.sendHour)))

  val followupRespectsDailyCapAndOptOut =
    followupLog.forall(e => not(e.optedOutAtSend) and not(e.minorAtSend) and e.dailyCountBefore < DAILY_PROACTIVE_CAP) and
    ALL_PEOPLE.forall(m => dailyProactiveCount.get(m) <= DAILY_PROACTIVE_CAP)

  val safety = and {
    noMinorInArrivalRelay,
    noMinorInAnyEventOrCoattend,
    onlyConfirmedUnblockedAdultsRelayed,
    panicOrBlockImmediatelyHaltsRelay,
    noArrivalRelayOutsideWindow,
    noLeakOrPrivateContactInArrivalRelay,
    closureAlwaysPivotsWhenBackupExists,
    venueFullTriggersBackupPivot,
    anchorDropReassignedOrCancelled,
    quorumOrCleanCancelBeforeCutoff,
    followupNeverDuringQuietHours,
    followupRespectsDailyCapAndOptOut,
  }

  // ------------------------------------------------------------------------------------------ witnesses
  val witness_arrivalRelayAndFeedback = not(
    relayedMessages.size() > 0 and feedbackRecorded.size() > 0
  )

  val witness_groupClosurePivot = not(
    mode == "friends" and closureReported and backupPivoted and activeVenue == "v_backup"
  )

  val witness_venueFullPivotNoQuarantine = not(
    venueFullReported and not(closureReported) and backupPivoted and activeVenue == "v_backup" and primaryStatus == "active"
  )

  val witness_panicHaltsRelay = not(
    panicActive and phase == "closed"
  )

  val witness_anchorReassigned = not(
    mode == "friends" and anchorDropped and coAnchorPromoted and not(meetupCancelled)
  )

  val witness_lowQuorumCleanCancel = not(
    meetupCancelled and cancelReason == "low_quorum"
  )

  val witness_noShowEscalation = not(
    noShowPinged.size() > 0 and waitingNotified.size() > 0
  )

  val witness_safetyBlockedCue = not(blockedBySafetyCount > 0)

  val witness_nextMorningFollowup = not(
    followupNextDay and followupScheduledHour == 9 and followupSent.size() > 0
  )

  // ------------------------------------------------------------------------------------------ run tests
  run oneOnOneHappyArrivalNextMorningTest =
    init
      .then(configureMeetup("slop", 19, true))
      .then(sendPreArrivalBrief)
      .then(openArrivalWindow)
      .then(markArrived("a"))
      .then(relayArrivalCue("a", true, true))
      .then(markArrived("b"))
      .then(confirmMetAndClose)
      .expect(phase == "closed" and met == Set("a", "b") and relayedMessages.size() == 1 and safety)
      .then(schedulePostFollowup)
      .expect(followupScheduledHour == 9 and followupNextDay and safety)
      .then(sendPostFollowup("a", 9))
      .then(recordPostFeedback("a"))
      .expect(feedbackRecorded.contains("a") and followupNeverDuringQuietHours and safety)

  run groupArrivalBackupPivotTest =
    init
      .then(configureMeetup("friends", 14, true))
      .then(sendPreArrivalBrief)
      .then(openArrivalWindow)
      .then(markArrived("a"))
      .then(reportArrivalClosureAndPivot("a"))
      .expect(
        primaryStatus == "suspect_closed" and
        backupPivoted and
        activeVenue == "v_backup" and
        closureAlwaysPivotsWhenBackupExists and
        safety
      )
      .then(markArrived("b"))
      .then(relayArrivalCue("b", true, true))
      .then(confirmMetAndClose)
      .then(schedulePostFollowup)
      .expect(followupScheduledHour == 16 and not(followupNextDay) and safety)
      .then(sendPostFollowup("a", 16))
      .expect(followupSent.contains("a") and safety)

  run venueFullPivotPreservesActiveStatusTest =
    init
      .then(configureMeetup("friends", 14, true))
      .then(sendPreArrivalBrief)
      .then(openArrivalWindow)
      .then(markArrived("a"))
      .then(reportArrivalVenueFullAndPivot("a"))
      .expect(
        primaryStatus == "active" and
        crowdedLogged and
        backupPivoted and
        activeVenue == "v_backup" and
        venueFullTriggersBackupPivot and
        safety
      )

  run panicHaltsRelayImmediatelyTest =
    init
      .then(configureMeetup("slop", 19, true))
      .then(sendPreArrivalBrief)
      .then(openArrivalWindow)
      .then(triggerPanicSafetyExit("a"))
      .expect(panicActive and meetupCancelled and phase == "closed" and panicOrBlockImmediatelyHaltsRelay and safety)
      .then(relayArrivalCue("b", true, true))
      .fail()

  run anchorDropReassignThenCancelTest =
    init
      .then(configureMeetup("friends", 14, true))
      .then(dropAttendee("b"))
      .expect(anchorDropped and coAnchorPromoted and not(meetupCancelled) and anchor == "c" and safety)
      .then(dropAttendee("d"))
      .then(dropAttendee("e"))
      .then(dropAttendee("c"))
      .expect(meetupCancelled and cancelReason == "anchor_drop" and phase == "closed" and safety)

  run lowQuorumCleanCancelBeforeCutoffTest =
    init
      .then(configureMeetup("friends", 14, true))
      .then(dropAttendee("a"))
      .then(dropAttendee("d"))
      .then(dropAttendee("e"))
      .then(sendPreArrivalBrief)
      .expect(meetupCancelled and cancelReason == "low_quorum" and phase == "closed" and quorumOrCleanCancelBeforeCutoff and safety)

  run minorMidFlowEvictedTest =
    init
      .then(configureMeetup("slop", 19, true))
      .then(sendPreArrivalBrief)
      .then(openArrivalWindow)
      .then(flagMinor("b"))
      .expect(not(confirmed.contains("b")) and meetupCancelled and phase == "closed" and noMinorInAnyEventOrCoattend and safety)

  run noShowPingAndNotifyTest =
    init
      .then(configureMeetup("slop", 19, true))
      .then(sendPreArrivalBrief)
      .then(openArrivalWindow)
      .then(markArrived("a"))
      .then(advanceArrivalClock(12))
      .then(noShowPingLate("b"))
      .then(advanceArrivalClock(18))
      .then(noShowNotifyWaiting("a"))
      .then(advanceArrivalClock(45))
      .then(closeWindowTimeout)
      .expect(
        noShowPinged == Set("b") and
        waitingNotified == Set("a") and
        phase == "closed" and
        safety
      )

  run leakBlockedArrivalCueTest =
    init
      .then(configureMeetup("slop", 19, true))
      .then(sendPreArrivalBrief)
      .then(openArrivalWindow)
      .then(relayArrivalCue("a", false, true))
      .then(relayArrivalCue("a", true, false))
      .expect(
        relayedMessages.size() == 0 and
        blockedBySafetyCount == 2 and
        noLeakOrPrivateContactInArrivalRelay and
        safety
      )

  run optOutStopsFollowupTest =
    init
      .then(configureMeetup("slop", 19, true))
      .then(sendPreArrivalBrief)
      .then(openArrivalWindow)
      .then(markArrived("a"))
      .then(markArrived("b"))
      .then(confirmMetAndClose)
      .then(memberOptOut("a"))
      .then(schedulePostFollowup)
      .then(sendPostFollowup("a", 9))
      .fail()

  run relayOutsideWindowRefusedTest =
    init
      .then(configureMeetup("slop", 19, true))
      .then(sendPreArrivalBrief)
      .then(relayArrivalCue("a", true, true))
      .fail()

  run dailyCapBlocksFollowupTest =
    init
      .then(configureMeetup("slop", 19, true))
      .then(sendPreArrivalBrief)
      .then(otherAppProactive("a"))
      .then(otherAppProactive("a"))
      .then(openArrivalWindow)
      .then(markArrived("a"))
      .then(markArrived("b"))
      .then(confirmMetAndClose)
      .then(schedulePostFollowup)
      .then(sendPostFollowup("a", 9))
      .fail()
}
```
