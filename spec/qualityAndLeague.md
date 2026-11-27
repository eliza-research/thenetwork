# Member quality, reliability, vampire defense, and league compatibility

This library holds pure rules for member signal quality, exposure-floor eligibility, meetup reliability tiers, network-vampire throttling, cross-app retaliatory-report guards, and adult league-gap bilateral-value compatibility. Every rule uses integers and booleans only. Minors are never scored or gated by status, wealth, aesthetics, or vampire heuristics; [friend introductions with a minor](friendIntroAge.md) and [match lane](matchLane.md) govern minors exclusively.

## Story: Curate member signal quality without penalizing terse high-status members

> As a member, I want low-effort spam, VoIP churn, and hype profiles kept out of reserved discovery slots while quiet, high-signal members stay eligible.

### Signal quality depends on provenance, specificity, hygiene, and completion rather than word count

Each score component is clamped to its bounded range (`provenance` in `0..35`, `specificity` in `0..25`, `hygiene` in `0..25`, `completion` in `0..15`). Message length is never an input. Sybil flags or unverified VoIP traffic quarantine the member to `Q0Quarantine`. Chronic low-effort behavior, unverified hype, or a low total places the member in `Q1Probationary`. Members at `40..69` are `Q2Standard`, and members at `70..100` are `Q3HighSignal`.

```quint
type QualityBand = Q0Quarantine | Q1Probationary | Q2Standard | Q3HighSignal

pure val qualityHighThreshold: int = 70
pure val qualityStandardThreshold: int = 40
pure val qualityProbationaryThreshold: int = 20
pure val newcomerGraceDays: int = 14

pure def clampRange(value: int, lo: int, hi: int): int =
  if (value < lo) lo else if (value > hi) hi else value

pure def memberQualityScore(provenance: int, specificity: int, hygiene: int, completion: int): int =
  clampRange(provenance, 0, 35)
    + clampRange(specificity, 0, 25)
    + clampRange(hygiene, 0, 25)
    + clampRange(completion, 0, 15)

pure def memberQualityBand(
  provenance: int,
  specificity: int,
  hygiene: int,
  completion: int,
  voipOrPumping: bool,
  sybilFlagged: bool,
  chronicLowEffort: bool,
  unverifiedHype: bool
): QualityBand =
  val prov = clampRange(provenance, 0, 35)
  val total = memberQualityScore(provenance, specificity, hygiene, completion)
  if (sybilFlagged or (voipOrPumping and prov < 15)) Q0Quarantine
  else if (chronicLowEffort or unverifiedHype or total < qualityProbationaryThreshold) Q1Probationary
  else if (total >= qualityHighThreshold) Q3HighSignal
  else if (total >= qualityStandardThreshold) Q2Standard
  else Q1Probationary
```

### Quarantined and probationary profiles do not receive reserved exposure-floor slots

Only `Q2Standard` and `Q3HighSignal` members with low exposure enter the exposure floor, either during the newcomer window or when they have zero recent exposure and clear matching signal.

```quint
pure def exposureFloorEligible(
  band: QualityBand,
  lowExposure: bool,
  newcomer: bool,
  recentExposure30: int,
  hasClearSignal: bool
): bool =
  band != Q0Quarantine
    and band != Q1Probationary
    and lowExposure
    and (newcomer or (recentExposure30 == 0 and hasClearSignal))

pure def lawQuietHighStatusNotPenalized(
  provenance: int,
  specificity: int,
  hygiene: int,
  completion: int
): bool =
  (provenance >= 25 and provenance <= 35
    and specificity >= 15 and specificity <= 25
    and hygiene >= 20 and hygiene <= 25
    and completion >= 10 and completion <= 15) implies (
      memberQualityBand(provenance, specificity, hygiene, completion, false, false, false, false) == Q3HighSignal
        and exposureFloorEligible(Q3HighSignal, true, false, 0, true)
    )
```

## Story: Escalate repeat no-shows and late cancellations fairly across all apps

> As a member, I want first-time accidents treated with grace while repeat flakes must confirm before commit or cool off across every lane.

### Weighted strikes preserve first-no-show grace and decay after two clean attendances

A first no-show adds two strikes and stays in `RelOk` so the agent can give a calm warning. Strikes at three require day-of confirmation (`RelConfirmRequired`, downranked to `850` permille). Strikes at five trigger `RelCoolOff` (`0` permille), and strikes at eight trigger `RelSuspended` (`0` permille). Each two clean attendances after the last strike remove one strike, so a single attendance never clears a serial flaker.

```quint
type ReliabilityTier = RelOk | RelConfirmRequired | RelCoolOff | RelSuspended

pure val firstNoShowStrikes: int = 2
pure val repeatNoShowStrikes: int = 3
pure val lateCancel4hStrikes: int = 2
pure val lateCancel24hStrikes: int = 1
pure val rescheduleChurnStrikes: int = 1
pure val relConfirmThreshold: int = 3
pure val relCoolOffThreshold: int = 5
pure val relSuspendedThreshold: int = 8
pure val relCleanAttendancesPerDecay: int = 2

pure def reliabilityStrikeDecay(cleanAttendancesSinceLastStrike: int): int =
  if (cleanAttendancesSinceLastStrike <= 0) 0
  else cleanAttendancesSinceLastStrike / relCleanAttendancesPerDecay

pure def reliabilityEffectiveStrikes(rawStrikes: int, cleanAttendancesSinceLastStrike: int): int =
  val decay = reliabilityStrikeDecay(cleanAttendancesSinceLastStrike)
  if (rawStrikes <= decay) 0 else rawStrikes - decay

pure def reliabilityTier(effectiveStrikes: int, provisionalNoShow: bool): ReliabilityTier =
  if (effectiveStrikes >= relSuspendedThreshold) RelSuspended
  else if (effectiveStrikes >= relCoolOffThreshold) RelCoolOff
  else if (effectiveStrikes >= relConfirmThreshold or (provisionalNoShow and effectiveStrikes >= 2)) RelConfirmRequired
  else RelOk

pure def reliabilityDownrankPermille(tier: ReliabilityTier): int =
  if (tier == RelOk) 1000
  else if (tier == RelConfirmRequired) 850
  else 0

pure def confirmBeforeCommitRequired(tier: ReliabilityTier): bool =
  tier == RelConfirmRequired

pure def lawFirstNoShowGrace(cleanAttendances: int): bool =
  (cleanAttendances >= 0) implies
    reliabilityTier(reliabilityEffectiveStrikes(firstNoShowStrikes, cleanAttendances), false) == RelOk

pure def lawSingleAttendanceNeverClearsSerialFlaker(rawStrikes: int): bool =
  val t = reliabilityTier(reliabilityEffectiveStrikes(rawStrikes, 1), false)
  (rawStrikes >= relCoolOffThreshold) implies (t == RelCoolOff or t == RelSuspended)
```

## Story: Throttle extractive network vampires and pitch-slappers without harming newcomers

> As a member, I want people who repeatedly pitch-slap or extract introductions without giving reciprocal value to be throttled and kept away from high-status members and newcomers.

### Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports

A newcomer with fewer than three completed introductions and zero pitch or self-promotion signals is always `VampireClean`. Two distinct self-promotion reports, four pitch signals, or five or more introductions with zero positive votes and at least three asymmetric negative votes quarantine the member (`VampireQuarantined`).

```quint
type VampireTier = VampireClean | VampireWatch | VampireThrottled | VampireQuarantined

pure val vampireMinIntros: int = 3
pure val vampireWatchPitches: int = 1
pure val vampireThrottlePitches: int = 2
pure val vampireQuarantinePitches: int = 4
pure val vampireQuarantineReports: int = 2

pure def vampireTier(
  intros90d: int,
  posVotes90d: int,
  asymNegVotes90d: int,
  pitchSignals90d: int,
  distinctSelfPromoReports90d: int
): VampireTier =
  if (distinctSelfPromoReports90d >= vampireQuarantineReports
      or pitchSignals90d >= vampireQuarantinePitches
      or (intros90d >= 5 and posVotes90d <= 0 and asymNegVotes90d >= 3)) VampireQuarantined
  else if (distinctSelfPromoReports90d >= 1
      or pitchSignals90d >= vampireThrottlePitches
      or (intros90d >= vampireMinIntros and asymNegVotes90d >= 2 and posVotes90d * 3 < intros90d)) VampireThrottled
  else if (pitchSignals90d >= vampireWatchPitches
      or (intros90d >= vampireMinIntros and asymNegVotes90d >= 1 and posVotes90d * 2 < intros90d)) VampireWatch
  else VampireClean

pure def vampireWeeklyCap(tier: VampireTier, baseCap: int): int =
  if (baseCap <= 0 or tier == VampireQuarantined) 0
  else if (tier == VampireThrottled) 1
  else if (tier == VampireWatch) (if (baseCap > 2) 2 else baseCap)
  else baseCap

pure def vampireAllowedTarget(
  senderTier: VampireTier,
  targetIsHighStatus: bool,
  targetIsNewcomer: bool
): bool =
  if (senderTier == VampireClean) true
  else if (senderTier == VampireWatch) not(targetIsHighStatus)
  else if (senderTier == VampireThrottled) not(targetIsHighStatus) and not(targetIsNewcomer)
  else false

pure def lawNewcomerNeverThrottledWithoutPitch(
  intros90d: int,
  posVotes90d: int,
  asymNegVotes90d: int
): bool =
  (intros90d < vampireMinIntros) implies
    vampireTier(intros90d, posVotes90d, asymNegVotes90d, 0, 0) == VampireClean
```

## Story: Guard retaliatory reports while isolating confirmed boundary violators

> As a member, I want urgent reports from clean reporters to isolate unsafe people quickly without letting a held bad actor retaliate and auto-hold their victim.

### A reporter already on hold cannot unilaterally restrict matching on another member

When the reporter is already on a safety hold, matching is restricted only if at least two distinct clean reporters have corroborated the concern. Otherwise, an urgent met report, an urgent severe offense, or two distinct clean reporters restricts matching.

```quint
pure def reportRestrictsMatchingV2(
  urgent: bool,
  met: bool,
  reporterOnHold: bool,
  distinctCleanReporters: int,
  severeOffense: bool
): bool =
  if (reporterOnHold) distinctCleanReporters >= 2
  else (urgent and (met or severeOffense)) or distinctCleanReporters >= 2

pure def lawHeldReporterCannotUnilaterallyHoldVictim(
  urgent: bool,
  met: bool,
  severeOffense: bool
): bool =
  not(reportRestrictsMatchingV2(urgent, met, true, 0, severeOffense))
    and not(reportRestrictsMatchingV2(urgent, met, true, 1, severeOffense))
```

## Story: Block wide adult league gaps unless verified bilateral value compensates

> As an adult member, I want wide gaps in status, wealth, domain rung, or dating aesthetics blocked unless explicit, verified compensating value exists on both sides, while minors, hiring firewalls, and dating-only aesthetic walls remain strictly invariant.

### Lane firewalls zero protected attributes before any gap or discretion check

For any minor, `leaguePairAllowed` always returns `true` so teen rules alone govern minor introductions. For `LeagueHire`, economic, social-capital, aesthetic, and publicity coordinates are zeroed so only job-related domain rung, verified evidence, and trajectory participate. Outside `LeagueDate`, aesthetic coordinates are always zeroed.

```quint
type LeagueLane = LeagueFriend | LeagueDate | LeagueHire | LeagueCofounder | LeagueMentor | LeagueInvest | LeagueIntro

type LeagueAxisProfile = {
  economic: int,
  socialCapital: int,
  domainRung: int,
  aesthetic: int,
  discretion: int,
  extractionRisk: int,
  publicity: int,
  verifiedEvidence: bool,
  trajectory: int,
  crossCapitalOpen: bool,
  sharedGuild: bool
}

pure def absDiff(x: int, y: int): int =
  if (x >= y) x - y else y - x

pure def effectiveLeagueProfile(lane: LeagueLane, a: LeagueAxisProfile): LeagueAxisProfile =
  if (lane == LeagueHire) {
    economic: 0,
    socialCapital: 0,
    domainRung: clampRange(a.domainRung, 0, 100),
    aesthetic: 0,
    discretion: 100,
    extractionRisk: 0,
    publicity: 0,
    verifiedEvidence: a.verifiedEvidence,
    trajectory: clampRange(a.trajectory, 0, 100),
    crossCapitalOpen: a.crossCapitalOpen,
    sharedGuild: false
  } else {
    economic: clampRange(a.economic, 0, 100),
    socialCapital: clampRange(a.socialCapital, 0, 100),
    domainRung: clampRange(a.domainRung, 0, 100),
    aesthetic: if (lane == LeagueDate) clampRange(a.aesthetic, 0, 100) else 0,
    discretion: clampRange(a.discretion, 0, 100),
    extractionRisk: clampRange(a.extractionRisk, 0, 100),
    publicity: clampRange(a.publicity, 0, 100),
    verifiedEvidence: a.verifiedEvidence,
    trajectory: clampRange(a.trajectory, 0, 100),
    crossCapitalOpen: a.crossCapitalOpen,
    sharedGuild: a.sharedGuild
  }

pure def discretionRespectsHighVisibility(a: LeagueAxisProfile, b: LeagueAxisProfile): bool =
  if (a.economic < 80 and a.publicity < 65) true
  else b.extractionRisk <= 25
    and b.discretion >= (if (a.sharedGuild and b.sharedGuild) 65 else 80)

pure def bilateralValueCompensates(lane: LeagueLane, a: LeagueAxisProfile, b: LeagueAxisProfile): bool =
  val effA = effectiveLeagueProfile(lane, a)
  val effB = effectiveLeagueProfile(lane, b)
  val rungGap = absDiff(effA.domainRung, effB.domainRung)
  if (lane == LeagueHire)
    effA.verifiedEvidence and effB.verifiedEvidence
      and (effA.trajectory >= 75 or effB.trajectory >= 75)
      and rungGap <= 35
  else if (lane == LeagueDate)
    false
  else if (effA.extractionRisk > 25 or effB.extractionRisk > 25)
    false
  else if (not(discretionRespectsHighVisibility(effA, effB)) or not(discretionRespectsHighVisibility(effB, effA)))
    false
  else if (lane == LeagueFriend)
    effA.sharedGuild and effB.sharedGuild and effA.crossCapitalOpen and effB.crossCapitalOpen
  else if (lane == LeagueMentor)
    rungGap >= 10 and rungGap <= 30
      and effA.crossCapitalOpen and effB.crossCapitalOpen
      and ((effA.domainRung < effB.domainRung and effA.verifiedEvidence and effA.trajectory >= 65)
        or (effB.domainRung < effA.domainRung and effB.verifiedEvidence and effB.trajectory >= 65))
  else if (lane == LeagueInvest)
    effA.verifiedEvidence and effB.verifiedEvidence
      and effA.crossCapitalOpen and effB.crossCapitalOpen
      and ((effA.economic < effB.economic and (effA.domainRung >= 65 or effA.trajectory >= 75))
        or (effB.economic < effA.economic and (effB.domainRung >= 65 or effB.trajectory >= 75)))
  else
    effA.verifiedEvidence and effB.verifiedEvidence
      and effA.crossCapitalOpen and effB.crossCapitalOpen
      and ((effA.domainRung >= 70 and (effB.economic >= 70 or effB.socialCapital >= 70))
        or (effB.domainRung >= 70 and (effA.economic >= 70 or effA.socialCapital >= 70)))

pure def leagueGapIsWide(lane: LeagueLane, a: LeagueAxisProfile, b: LeagueAxisProfile): bool =
  if (lane == LeagueDate) absDiff(a.aesthetic, b.aesthetic) > 28
  else if (lane == LeagueHire) absDiff(a.domainRung, b.domainRung) > 25
  else if (lane == LeagueFriend) absDiff(a.economic, b.economic) > 50 or absDiff(a.socialCapital, b.socialCapital) > 50
  else absDiff(a.economic, b.economic) > 45 or absDiff(a.socialCapital, b.socialCapital) > 45 or absDiff(a.domainRung, b.domainRung) > 35

pure def leaguePairAllowed(lane: LeagueLane, anyMinor: bool, a: LeagueAxisProfile, b: LeagueAxisProfile): bool =
  val effA = effectiveLeagueProfile(lane, a)
  val effB = effectiveLeagueProfile(lane, b)
  if (anyMinor) true
  else if (lane != LeagueHire
      and (effA.extractionRisk > 65 or effB.extractionRisk > 65
        or not(discretionRespectsHighVisibility(effA, effB))
        or not(discretionRespectsHighVisibility(effB, effA)))) false
  else if (not(leagueGapIsWide(lane, effA, effB))) true
  else bilateralValueCompensates(lane, effA, effB)

pure val aValues: Set[LeagueAxisProfile] = Set(
  { economic: 20, socialCapital: 25, domainRung: 30, aesthetic: 45, discretion: 85, extractionRisk: 10, publicity: 10, verifiedEvidence: false, trajectory: 40, crossCapitalOpen: false, sharedGuild: false },
  { economic: 85, socialCapital: 80, domainRung: 85, aesthetic: 85, discretion: 90, extractionRisk: 10, publicity: 70, verifiedEvidence: true, trajectory: 80, crossCapitalOpen: true, sharedGuild: true },
  { economic: 35, socialCapital: 40, domainRung: 75, aesthetic: 55, discretion: 85, extractionRisk: 15, publicity: 15, verifiedEvidence: true, trajectory: 80, crossCapitalOpen: true, sharedGuild: true },
  { economic: 40, socialCapital: 30, domainRung: 40, aesthetic: 50, discretion: 40, extractionRisk: 75, publicity: 20, verifiedEvidence: false, trajectory: 30, crossCapitalOpen: false, sharedGuild: false }
)

pure val bValues: Set[LeagueAxisProfile] = aValues

pure def lawMinorsNeverLeagueGated(lane: LeagueLane, a: LeagueAxisProfile, b: LeagueAxisProfile): bool =
  leaguePairAllowed(lane, true, a, b)

pure def lawPeonFirewallZeroesProtectedAxes(
  a: LeagueAxisProfile,
  b: LeagueAxisProfile,
  econA: int,
  econB: int,
  socA: int,
  socB: int,
  aesA: int,
  aesB: int,
  pubA: int,
  pubB: int
): bool =
  val modA = {
    economic: econA,
    socialCapital: socA,
    domainRung: a.domainRung,
    aesthetic: aesA,
    discretion: a.discretion,
    extractionRisk: a.extractionRisk,
    publicity: pubA,
    verifiedEvidence: a.verifiedEvidence,
    trajectory: a.trajectory,
    crossCapitalOpen: a.crossCapitalOpen,
    sharedGuild: a.sharedGuild
  }
  val modB = {
    economic: econB,
    socialCapital: socB,
    domainRung: b.domainRung,
    aesthetic: aesB,
    discretion: b.discretion,
    extractionRisk: b.extractionRisk,
    publicity: pubB,
    verifiedEvidence: b.verifiedEvidence,
    trajectory: b.trajectory,
    crossCapitalOpen: b.crossCapitalOpen,
    sharedGuild: b.sharedGuild
  }
  leaguePairAllowed(LeagueHire, false, a, b) == leaguePairAllowed(LeagueHire, false, modA, modB)

pure def lawAestheticWalledToDateOnly(
  lane: LeagueLane,
  a: LeagueAxisProfile,
  b: LeagueAxisProfile,
  aesA: int,
  aesB: int
): bool =
  val modA = {
    economic: a.economic,
    socialCapital: a.socialCapital,
    domainRung: a.domainRung,
    aesthetic: aesA,
    discretion: a.discretion,
    extractionRisk: a.extractionRisk,
    publicity: a.publicity,
    verifiedEvidence: a.verifiedEvidence,
    trajectory: a.trajectory,
    crossCapitalOpen: a.crossCapitalOpen,
    sharedGuild: a.sharedGuild
  }
  val modB = {
    economic: b.economic,
    socialCapital: b.socialCapital,
    domainRung: b.domainRung,
    aesthetic: aesB,
    discretion: b.discretion,
    extractionRisk: b.extractionRisk,
    publicity: b.publicity,
    verifiedEvidence: b.verifiedEvidence,
    trajectory: b.trajectory,
    crossCapitalOpen: b.crossCapitalOpen,
    sharedGuild: b.sharedGuild
  }
  (lane != LeagueDate) implies (leaguePairAllowed(lane, false, a, b) == leaguePairAllowed(lane, false, modA, modB))
```
