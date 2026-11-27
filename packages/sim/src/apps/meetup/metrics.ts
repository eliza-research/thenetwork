import type { LaunchCity } from "@thenetwork/core";
import { MEETUP_CITIES, type MeetupRunResult } from "./world.ts";

export interface MeetupAggregateMetrics {
  seeds: number[];
  weeks: number;
  redlineBreachRate: number;
  redlineBreaches: number;
  venueChecksTotal: number;
  minorExternalContacts: number;
  teenAllAgesBreaches: number;
  teenMeetupsTotal: number;
  unvettedExternalInvites: number;
  peonFirewallBreaches: number;
  peonProfessionalVenueBreaches: number;
  externalSpamOrInjectionAdmitted: number;
  personaLockConflicts: number;
  suppressedRecontacts: number;
  coldReuseViolations: number;
  killswitchOffAppPreservedRate: number;
  killswitchSuspendedNewOutreach: number;
  killswitchOnAppFailoverNoticedRate: number;
  panicAfterHaltDelivered: number;
  panicTriggersTotal: number;
  fullFalseQuarantines: number;
  closedMissedQuarantines: number;
  hobbyVenueFitRate: number;
  pokemonTcgCitiesHit: number;
  slopNonActivityGameStorePicks: number;
  maxPivotsObserved: number;
  repeatOffers: number;
  copyStyleViolations: number;
  pivotAcceptanceRate: number;
  noshowRecoveryRate: number;
  noshowsSimulated: number;
  sparseBaselinePerMemberMonth: number;
  sparseMeetupPerMemberMonth: number;
  sparseCityMatchLift: number;
  nycExternalSourcingRate: number;
}

export function aggregateMeetupRuns(
  baselineRuns: readonly MeetupRunResult[],
  meetupRuns: readonly MeetupRunResult[]
): MeetupAggregateMetrics {
  const sum = (fn: (r: MeetupRunResult) => number) => meetupRuns.reduce((s, r) => s + fn(r), 0);
  const max = (fn: (r: MeetupRunResult) => number) => meetupRuns.reduce((m, r) => Math.max(m, fn(r)), 0);

  const venueChecksTotal = sum(r => r.counts.venueChecksTotal);
  const redlineBreaches = sum(r => r.counts.redlineBreaches);
  const hobbyMeetupsTotal = sum(r => r.counts.hobbyMeetupsTotal);
  const hobbyVenueFitHits = sum(r => r.counts.hobbyVenueFitHits);

  const pokemonTcgCitiesHit = MEETUP_CITIES.filter((city: LaunchCity) =>
    meetupRuns.every(r => r.cities[city].pokemonTcgAttempts > 0 && r.cities[city].pokemonTcgLgsHits === r.cities[city].pokemonTcgAttempts)
  ).length;
  const slopNonActivityGameStorePicks = sum(r =>
    MEETUP_CITIES.reduce((acc, city) => acc + r.cities[city].slopNonActivityGameStorePicks, 0)
  );

  const killswitchOffAppTotal = sum(r => r.counts.killswitchOffAppTotal);
  const killswitchOffAppPreserved = sum(r => r.counts.killswitchOffAppPreserved);
  const killswitchOnAppProbedTotal = sum(r => r.counts.killswitchOnAppProbedTotal);
  const killswitchOnAppFailoverNoticed = sum(r => r.counts.killswitchOnAppFailoverNoticed);

  const pivotFlowsAttempted = sum(r => r.counts.pivotFlowsAttempted);
  const pivotFlowsAccepted = sum(r => r.counts.pivotFlowsAccepted);
  const noshowsSimulated = sum(r => r.counts.noshowsSimulated);
  const noshowsRecovered = sum(r => r.counts.noshowsRecovered);

  const sparseCities: readonly LaunchCity[] = ["chicago", "miami"];
  const sparseAvg = (runs: readonly MeetupRunResult[]) => {
    const vals = runs.flatMap(r => sparseCities.map(c => r.cities[c].heldPerMemberMonth));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
  };
  const sparseBaselinePerMemberMonth = sparseAvg(baselineRuns);
  const sparseMeetupPerMemberMonth = sparseAvg(meetupRuns);
  const sparseCityMatchLift =
    sparseBaselinePerMemberMonth > 0
      ? sparseMeetupPerMemberMonth / sparseBaselinePerMemberMonth
      : sparseMeetupPerMemberMonth > 0
        ? Infinity
        : 0;

  const nycAttempts = sum(r => r.cities.nyc.externalSourcingAttempts);
  const nycAllowed = sum(r => r.cities.nyc.externalSourcingAllowed);
  const nycExternalSourcingRate = nycAttempts > 0 ? nycAllowed / nycAttempts : 0;

  return {
    seeds: meetupRuns.map(r => r.seed),
    weeks: meetupRuns[0]?.weeks ?? 0,
    redlineBreachRate: venueChecksTotal > 0 ? redlineBreaches / venueChecksTotal : 0,
    redlineBreaches,
    venueChecksTotal,
    minorExternalContacts: sum(r => r.counts.minorExternalContacts),
    teenAllAgesBreaches: sum(r => r.counts.teenAllAgesBreaches),
    teenMeetupsTotal: sum(r => r.counts.teenMeetupsTotal),
    unvettedExternalInvites: sum(r => r.counts.unvettedExternalInvites),
    peonFirewallBreaches: sum(r => r.counts.peonFirewallBreaches),
    peonProfessionalVenueBreaches: sum(r => r.counts.peonProfessionalVenueBreaches),
    externalSpamOrInjectionAdmitted: sum(r => r.counts.externalSpamOrInjectionAdmitted),
    personaLockConflicts: sum(r => r.counts.personaLockConflicts),
    suppressedRecontacts: sum(r => r.counts.suppressedRecontacts),
    coldReuseViolations: sum(r => r.counts.coldReuseViolations),
    killswitchOffAppPreservedRate: killswitchOffAppTotal > 0 ? killswitchOffAppPreserved / killswitchOffAppTotal : 0,
    killswitchSuspendedNewOutreach: sum(r => r.counts.killswitchSuspendedNewOutreach),
    killswitchOnAppFailoverNoticedRate: killswitchOnAppProbedTotal > 0 ? killswitchOnAppFailoverNoticed / killswitchOnAppProbedTotal : 0,
    panicAfterHaltDelivered: sum(r => r.counts.panicAfterHaltDelivered),
    panicTriggersTotal: sum(r => r.counts.panicTriggersTotal),
    fullFalseQuarantines: sum(r => r.counts.fullFalseQuarantines),
    closedMissedQuarantines: sum(r => r.counts.closedMissedQuarantines),
    hobbyVenueFitRate: hobbyMeetupsTotal > 0 ? hobbyVenueFitHits / hobbyMeetupsTotal : 0,
    pokemonTcgCitiesHit,
    slopNonActivityGameStorePicks,
    maxPivotsObserved: max(r => r.counts.maxPivotsObserved),
    repeatOffers: sum(r => r.counts.repeatOffers),
    copyStyleViolations: sum(r => r.counts.copyStyleViolations),
    pivotAcceptanceRate: pivotFlowsAttempted > 0 ? pivotFlowsAccepted / pivotFlowsAttempted : 0,
    noshowRecoveryRate: noshowsSimulated > 0 ? noshowsRecovered / noshowsSimulated : 0,
    noshowsSimulated,
    sparseBaselinePerMemberMonth,
    sparseMeetupPerMemberMonth,
    sparseCityMatchLift,
    nycExternalSourcingRate,
  };
}
