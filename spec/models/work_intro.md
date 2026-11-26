# Non-in-person work introductions on peon.biz

## Story: Deliver adult double-opt-in work introductions without a physical venue

Work introductions on `peon.biz` connect adult candidates and verified hiring managers through candidate-first sequential double opt-in. No physical venue is ever booked or assigned, and strangers are never dropped into an unsolicited group SMS or cold three-way call. Warm double-opt-in email (`warm_email`) is the default when both opted-in adults have email; a scheduled video link (`scheduled_video`) requires explicit mutual slot confirmation; mediated relay (`relay_share`) requires explicit bilateral contact-share consent when email and a confirmed video slot are unavailable.

### Safety rules, adult-only policy, and bounds

The generated decision in [work introduction channel](../workIntroChannel.md) selects the channel. This whole-flow model checks sequential probe ordering (`managerNeverProbedBeforeCandidateYes`), double opt-in (`workIntroDoubleOptInRequired`), zero physical venues (`workIntroNeverInPersonVenue`), zero unsolicited group SMS or cold three-way calls (`noUnsolicitedGroupSmsOrColdCall`), mutual slot locking before video invites (`videoIntroRequiresMutualSlotConfirmation`), adult-only eligibility (`noMinorInWorkIntro`), opt-out handling, and `T+72h` bounce / `T+7d` outcome follow-ups.

Bounds: one candidate and one hiring manager pair, exploring adult/minor eligibility, email availability, video preference, mutual slot lock, bilateral relay share consent, declines, opt-outs, and bounce/outcome follow-ups.

```quint
// quint-check: max-steps=30 max-samples=4000 verify-steps=8
module work_intro {

  // ------------------------------------------------------------------------------------------ constants
  pure val ALLOWED_CHANNELS = Set("none", "warm_email", "scheduled_video", "relay_share")

  // ------------------------------------------------------------------------------------------ types
  type IntroSnap = {
    delivered: bool,
    channel: str,
    bothOptIn: bool,
    bothAdult: bool,
    bothHaveEmail: bool,
    bothSlotsConfirmed: bool,
    bothShareConsent: bool,
  }

  // ------------------------------------------------------------------------------------------ state
  var candAdult: bool
  var mgrAdult: bool
  var candOptIn: bool
  var mgrOptIn: bool
  var candHasEmail: bool
  var mgrHasEmail: bool
  var wantsVideo: bool
  var candSlotConfirmed: bool
  var mgrSlotConfirmed: bool
  var candShareConsent: bool
  var mgrShareConsent: bool
  var candOptedOut: bool
  var mgrOptedOut: bool

  var probeStage: str                // none | candidate_probed | candidate_yes | manager_probed | mutual_yes | declined
  var selectedChannel: str           // none | warm_email | scheduled_video | relay_share
  var physicalVenueAssigned: bool    // MUST ALWAYS BE FALSE
  var unsolicitedGroupSmsSent: bool  // MUST ALWAYS BE FALSE
  var coldThreeWayCallSent: bool     // MUST ALWAYS BE FALSE
  var introDelivered: bool
  var emailBounced: bool
  var followupStage: str             // none | bounce_72h | checkin_7d | completed

  // Ghost state for strict ordering and delivery-time verification
  var mgrProbed: bool
  var candWasYesBeforeMgrProbe: bool
  var introSnap: IntroSnap

  // ------------------------------------------------------------------------------------------ init
  action init = all {
    candAdult' = true,
    mgrAdult' = true,
    candOptIn' = false,
    mgrOptIn' = false,
    candHasEmail' = true,
    mgrHasEmail' = true,
    wantsVideo' = false,
    candSlotConfirmed' = false,
    mgrSlotConfirmed' = false,
    candShareConsent' = false,
    mgrShareConsent' = false,
    candOptedOut' = false,
    mgrOptedOut' = false,
    probeStage' = "none",
    selectedChannel' = "none",
    physicalVenueAssigned' = false,
    unsolicitedGroupSmsSent' = false,
    coldThreeWayCallSent' = false,
    introDelivered' = false,
    emailBounced' = false,
    followupStage' = "none",
    mgrProbed' = false,
    candWasYesBeforeMgrProbe' = true,
    introSnap' = {
      delivered: false,
      channel: "none",
      bothOptIn: false,
      bothAdult: false,
      bothHaveEmail: false,
      bothSlotsConfirmed: false,
      bothShareConsent: false,
    },
  }

  // ------------------------------------------------------------------------------------------ actions
  action configureParties(cAdult: bool, mAdult: bool, cEmail: bool, mEmail: bool, preferVideo: bool): bool = all {
    probeStage == "none",
    candAdult' = cAdult,
    mgrAdult' = mAdult,
    candHasEmail' = cEmail,
    mgrHasEmail' = mEmail,
    wantsVideo' = preferVideo,
    candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    probeStage' = probeStage, selectedChannel' = selectedChannel,
    physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent,
    coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced,
    followupStage' = followupStage, mgrProbed' = mgrProbed,
    candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  // Step 1: Probe candidate first with blind job details (never manager name). Adults only.
  action probeCandidate: bool = all {
    probeStage == "none",
    candAdult,
    mgrAdult,
    not(candOptedOut),
    not(mgrOptedOut),
    probeStage' = "candidate_probed",
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    selectedChannel' = selectedChannel, physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  action candidateAccepts: bool = all {
    probeStage == "candidate_probed",
    candAdult,
    not(candOptedOut),
    candOptIn' = true,
    probeStage' = "candidate_yes",
    candAdult' = candAdult, mgrAdult' = mgrAdult, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    selectedChannel' = selectedChannel, physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  action candidateDeclines: bool = all {
    probeStage == "candidate_probed",
    candOptIn' = false,
    probeStage' = "declined",
    candAdult' = candAdult, mgrAdult' = mgrAdult, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    selectedChannel' = selectedChannel, physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  // Step 2: Probe hiring manager with blind summary ONLY AFTER candidate said yes.
  action probeManager: bool = all {
    probeStage == "candidate_yes",
    candOptIn,
    candAdult,
    mgrAdult,
    not(candOptedOut),
    not(mgrOptedOut),
    probeStage' = "manager_probed",
    mgrProbed' = true,
    candWasYesBeforeMgrProbe' = (candWasYesBeforeMgrProbe and probeStage == "candidate_yes" and candOptIn),
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    selectedChannel' = selectedChannel, physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced, followupStage' = followupStage,
    introSnap' = introSnap,
  }

  action managerAccepts: bool = all {
    probeStage == "manager_probed",
    candAdult,
    mgrAdult,
    candOptIn,
    not(candOptedOut),
    not(mgrOptedOut),
    mgrOptIn' = true,
    probeStage' = "mutual_yes",
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    selectedChannel' = selectedChannel, physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  action managerDeclines: bool = all {
    probeStage == "manager_probed",
    mgrOptIn' = false,
    probeStage' = "declined",
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    selectedChannel' = selectedChannel, physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  // Default channel: double-opt-in warm email intro when both have email and are not locking video.
  action deliverWarmEmailIntro: bool = all {
    probeStage == "mutual_yes",
    not(introDelivered),
    candAdult,
    mgrAdult,
    candOptIn,
    mgrOptIn,
    candHasEmail,
    mgrHasEmail,
    not(wantsVideo and candSlotConfirmed and mgrSlotConfirmed),
    not(candOptedOut),
    not(mgrOptedOut),
    selectedChannel' = "warm_email",
    introDelivered' = true,
    introSnap' = {
      delivered: true,
      channel: "warm_email",
      bothOptIn: candOptIn and mgrOptIn,
      bothAdult: candAdult and mgrAdult,
      bothHaveEmail: candHasEmail and mgrHasEmail,
      bothSlotsConfirmed: candSlotConfirmed and mgrSlotConfirmed,
      bothShareConsent: candShareConsent and mgrShareConsent,
    },
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    probeStage' = probeStage, physicalVenueAssigned' = false,
    unsolicitedGroupSmsSent' = false, coldThreeWayCallSent' = false,
    emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe,
  }

  // Both parties explicitly confirm an overlapping video-call slot before any calendar/Meet invite goes out.
  action confirmMutualVideoSlot: bool = all {
    probeStage == "mutual_yes",
    not(introDelivered),
    candAdult,
    mgrAdult,
    candOptIn,
    mgrOptIn,
    not(candSlotConfirmed and mgrSlotConfirmed),
    not(candOptedOut),
    not(mgrOptedOut),
    candSlotConfirmed' = true,
    mgrSlotConfirmed' = true,
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    probeStage' = probeStage, selectedChannel' = selectedChannel,
    physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  // Fallback 1 / explicit video: deliver scheduled_video ONLY after mutual slot confirmation
  // and either missing email or explicit wantsVideo preference (spec/workIntroChannel.md).
  action deliverScheduledVideoIntro: bool = all {
    probeStage == "mutual_yes",
    not(introDelivered),
    candAdult,
    mgrAdult,
    candOptIn,
    mgrOptIn,
    not(candHasEmail and mgrHasEmail) or wantsVideo,
    candSlotConfirmed,
    mgrSlotConfirmed,
    not(candOptedOut),
    not(mgrOptedOut),
    selectedChannel' = "scheduled_video",
    introDelivered' = true,
    introSnap' = {
      delivered: true,
      channel: "scheduled_video",
      bothOptIn: candOptIn and mgrOptIn,
      bothAdult: candAdult and mgrAdult,
      bothHaveEmail: candHasEmail and mgrHasEmail,
      bothSlotsConfirmed: candSlotConfirmed and mgrSlotConfirmed,
      bothShareConsent: candShareConsent and mgrShareConsent,
    },
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    probeStage' = probeStage, physicalVenueAssigned' = false,
    unsolicitedGroupSmsSent' = false, coldThreeWayCallSent' = false,
    emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe,
  }

  action grantMutualShareConsent: bool = all {
    probeStage == "mutual_yes",
    not(introDelivered),
    candAdult,
    mgrAdult,
    candOptIn,
    mgrOptIn,
    not(candShareConsent and mgrShareConsent),
    not(candOptedOut),
    not(mgrOptedOut),
    candShareConsent' = true,
    mgrShareConsent' = true,
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    probeStage' = probeStage, selectedChannel' = selectedChannel,
    physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  // Fallback 2: agent-mediated relay_share intro when email is missing and no video slot is confirmed.
  action deliverRelayShareIntro: bool = all {
    probeStage == "mutual_yes",
    not(introDelivered),
    candAdult,
    mgrAdult,
    candOptIn,
    mgrOptIn,
    not(candHasEmail and mgrHasEmail),
    not(candSlotConfirmed and mgrSlotConfirmed),
    candShareConsent,
    mgrShareConsent,
    not(candOptedOut),
    not(mgrOptedOut),
    selectedChannel' = "relay_share",
    introDelivered' = true,
    introSnap' = {
      delivered: true,
      channel: "relay_share",
      bothOptIn: candOptIn and mgrOptIn,
      bothAdult: candAdult and mgrAdult,
      bothHaveEmail: candHasEmail and mgrHasEmail,
      bothSlotsConfirmed: candSlotConfirmed and mgrSlotConfirmed,
      bothShareConsent: candShareConsent and mgrShareConsent,
    },
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    probeStage' = probeStage, physicalVenueAssigned' = false,
    unsolicitedGroupSmsSent' = false, coldThreeWayCallSent' = false,
    emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe,
  }

  action markEmailBounced: bool = all {
    introDelivered,
    selectedChannel == "warm_email",
    not(emailBounced),
    followupStage == "none",
    emailBounced' = true,
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    probeStage' = probeStage, selectedChannel' = selectedChannel,
    physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  action sendBounceNudge72h: bool = all {
    introDelivered,
    selectedChannel == "warm_email",
    emailBounced,
    followupStage == "none",
    not(candOptedOut and mgrOptedOut),
    followupStage' = "bounce_72h",
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    probeStage' = probeStage, selectedChannel' = selectedChannel,
    physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  action sendOutcomeCheckin7d: bool = all {
    introDelivered,
    followupStage == "none" or followupStage == "bounce_72h",
    not(candOptedOut and mgrOptedOut),
    followupStage' = "checkin_7d",
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    probeStage' = probeStage, selectedChannel' = selectedChannel,
    physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  action recordWorkOutcome: bool = all {
    introDelivered,
    followupStage == "checkin_7d",
    followupStage' = "completed",
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    candOptedOut' = candOptedOut, mgrOptedOut' = mgrOptedOut,
    probeStage' = probeStage, selectedChannel' = selectedChannel,
    physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  action partyOptOut(who: str): bool = all {
    who == "candidate" or who == "manager",
    if (who == "candidate") not(candOptedOut) else not(mgrOptedOut),
    candOptedOut' = if (who == "candidate") true else candOptedOut,
    mgrOptedOut' = if (who == "manager") true else mgrOptedOut,
    candAdult' = candAdult, mgrAdult' = mgrAdult, candOptIn' = candOptIn, mgrOptIn' = mgrOptIn,
    candHasEmail' = candHasEmail, mgrHasEmail' = mgrHasEmail, wantsVideo' = wantsVideo,
    candSlotConfirmed' = candSlotConfirmed, mgrSlotConfirmed' = mgrSlotConfirmed,
    candShareConsent' = candShareConsent, mgrShareConsent' = mgrShareConsent,
    probeStage' = probeStage, selectedChannel' = selectedChannel,
    physicalVenueAssigned' = physicalVenueAssigned,
    unsolicitedGroupSmsSent' = unsolicitedGroupSmsSent, coldThreeWayCallSent' = coldThreeWayCallSent,
    introDelivered' = introDelivered, emailBounced' = emailBounced, followupStage' = followupStage,
    mgrProbed' = mgrProbed, candWasYesBeforeMgrProbe' = candWasYesBeforeMgrProbe, introSnap' = introSnap,
  }

  action step = any {
    nondet cAdult = Set(true, false).oneOf()
    nondet mAdult = Set(true, false).oneOf()
    nondet cEmail = Set(true, false).oneOf()
    nondet mEmail = Set(true, false).oneOf()
    nondet pVideo = Set(false, true).oneOf()
    configureParties(cAdult, mAdult, cEmail, mEmail, pVideo),
    probeCandidate,
    candidateAccepts,
    candidateDeclines,
    probeManager,
    managerAccepts,
    managerDeclines,
    deliverWarmEmailIntro,
    confirmMutualVideoSlot,
    deliverScheduledVideoIntro,
    grantMutualShareConsent,
    deliverRelayShareIntro,
    markEmailBounced,
    sendBounceNudge72h,
    sendOutcomeCheckin7d,
    recordWorkOutcome,
    nondet who = Set("candidate", "manager").oneOf()
    partyOptOut(who),
  }

  // ------------------------------------------------------------------------------------------ invariants
  // peon work intros NEVER book or assign an in-person venue.
  val workIntroNeverInPersonVenue = not(physicalVenueAssigned)

  // Never drop strangers into unsolicited group SMS or cold 3-way calls.
  val noUnsolicitedGroupSmsOrColdCall =
    not(unsolicitedGroupSmsSent) and
    not(coldThreeWayCallSent) and
    ALLOWED_CHANNELS.contains(selectedChannel)

  // Double opt-in (mutual_yes) is required before any intro is delivered.
  val workIntroDoubleOptInRequired =
    (introDelivered implies (probeStage == "mutual_yes" and candOptIn and mgrOptIn and introSnap.bothOptIn)) and
    (selectedChannel != "none" implies introDelivered)

  // Hiring manager is NEVER probed before candidate explicitly says yes.
  val managerNeverProbedBeforeCandidateYes =
    (mgrProbed implies candOptIn) and
    (probeStage == "manager_probed" implies candOptIn) and
    candWasYesBeforeMgrProbe

  // scheduled_video (Google Meet/.ics) ONLY after mutual slot confirmation.
  val videoIntroRequiresMutualSlotConfirmation =
    (selectedChannel == "scheduled_video") implies
      (candSlotConfirmed and mgrSlotConfirmed and introSnap.bothSlotsConfirmed)

  // Minors are never probed or introduced on peon.biz.
  val noMinorInWorkIntro =
    (probeStage != "none" implies (candAdult and mgrAdult)) and
    (introDelivered implies introSnap.bothAdult)

  val safety = and {
    workIntroNeverInPersonVenue,
    noUnsolicitedGroupSmsOrColdCall,
    workIntroDoubleOptInRequired,
    managerNeverProbedBeforeCandidateYes,
    videoIntroRequiresMutualSlotConfirmation,
    noMinorInWorkIntro,
  }

  // ------------------------------------------------------------------------------------------ witnesses
  val witness_warmEmailCompleted = not(
    selectedChannel == "warm_email" and introDelivered and followupStage == "completed"
  )

  val witness_scheduledVideoDelivered = not(
    selectedChannel == "scheduled_video" and introDelivered
  )

  val witness_relayShareDelivered = not(
    selectedChannel == "relay_share" and introDelivered
  )

  val witness_candidateDeclineBeforeMgr = not(
    probeStage == "declined" and not(mgrProbed)
  )

  val witness_bounceNudgeReached = not(followupStage == "bounce_72h")

  // ------------------------------------------------------------------------------------------ run tests
  run happyWarmEmailIntroTest =
    init
      .then(probeCandidate)
      .then(candidateAccepts)
      .then(probeManager)
      .then(managerAccepts)
      .then(deliverWarmEmailIntro)
      .expect(
        selectedChannel == "warm_email" and
        introDelivered and
        not(physicalVenueAssigned) and
        safety
      )
      .then(sendOutcomeCheckin7d)
      .then(recordWorkOutcome)
      .expect(followupStage == "completed" and safety)

  run fallbackScheduledVideoIntroTest =
    init
      .then(configureParties(true, true, false, true, false))
      .then(probeCandidate)
      .then(candidateAccepts)
      .then(probeManager)
      .then(managerAccepts)
      .then(confirmMutualVideoSlot)
      .then(deliverScheduledVideoIntro)
      .expect(
        selectedChannel == "scheduled_video" and
        introDelivered and
        videoIntroRequiresMutualSlotConfirmation and
        not(physicalVenueAssigned) and
        safety
      )
      .then(sendOutcomeCheckin7d)
      .then(recordWorkOutcome)
      .expect(followupStage == "completed" and safety)

  run explicitVideoPreferenceWithEmailTest =
    init
      .then(configureParties(true, true, true, true, true))
      .then(probeCandidate)
      .then(candidateAccepts)
      .then(probeManager)
      .then(managerAccepts)
      .then(confirmMutualVideoSlot)
      .then(deliverScheduledVideoIntro)
      .expect(
        selectedChannel == "scheduled_video" and
        introDelivered and
        videoIntroRequiresMutualSlotConfirmation and
        safety
      )

  run candidateDeclineStopsBeforeManagerTest =
    init
      .then(probeCandidate)
      .then(candidateDeclines)
      .expect(
        probeStage == "declined" and
        not(mgrProbed) and
        not(introDelivered) and
        managerNeverProbedBeforeCandidateYes and
        safety
      )

  run managerProbeAfterCandidateDeclineRefusedTest =
    init
      .then(probeCandidate)
      .then(candidateDeclines)
      .then(probeManager)
      .fail()

  run relayShareFallbackMissingEmailTest =
    init
      .then(configureParties(true, true, false, false, false))
      .then(probeCandidate)
      .then(candidateAccepts)
      .then(probeManager)
      .then(managerAccepts)
      .then(grantMutualShareConsent)
      .then(deliverRelayShareIntro)
      .expect(
        selectedChannel == "relay_share" and
        introDelivered and
        not(physicalVenueAssigned) and
        safety
      )

  run unsolicitedVideoInviteRefusedTest =
    init
      .then(configureParties(true, true, false, true, false))
      .then(probeCandidate)
      .then(candidateAccepts)
      .then(probeManager)
      .then(managerAccepts)
      .then(deliverScheduledVideoIntro)
      .fail()

  run minorCandidateBlockedFromWorkIntroTest =
    init
      .then(configureParties(false, true, true, true, false))
      .then(probeCandidate)
      .fail()

  run minorManagerBlockedFromWorkIntroTest =
    init
      .then(configureParties(true, false, true, true, false))
      .then(probeCandidate)
      .fail()

  run bounceNudgeThenCheckinTest =
    init
      .then(probeCandidate)
      .then(candidateAccepts)
      .then(probeManager)
      .then(managerAccepts)
      .then(deliverWarmEmailIntro)
      .then(markEmailBounced)
      .then(sendBounceNudge72h)
      .expect(followupStage == "bounce_72h" and safety)
      .then(sendOutcomeCheckin7d)
      .then(recordWorkOutcome)
      .expect(followupStage == "completed" and safety)
}
```
