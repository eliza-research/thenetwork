import type { GateResult } from "../gates.ts";
import type { MeetupAggregateMetrics } from "./metrics.ts";

export interface MeetupGateResult extends GateResult {
  blocking: boolean;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function meetupOfficialGates(
  m: MeetupAggregateMetrics,
  opts: { quick: boolean }
): MeetupGateResult[] {
  const qualityBlocking = !opts.quick;
  return [
    {
      id: "meetup_redline_breach_rate",
      gate: "meetup_redline_breach_rate == 0 (strictSober, halal, kosher, severeAllergen, wheelchair, daytimeOnly, after-dark, allAges)",
      value: `${m.redlineBreaches}/${m.venueChecksTotal} (${pct(m.redlineBreachRate)})`,
      pass: m.venueChecksTotal > 0 && m.redlineBreaches === 0,
      blocking: true,
    },
    {
      id: "meetup_minor_external_contact",
      gate: "meetup_minor_external_contact == 0 (0 minors in external events/matchmakers; underage -> HMAC tombstone)",
      value: `${m.minorExternalContacts}`,
      pass: m.minorExternalContacts === 0,
      blocking: true,
    },
    {
      id: "meetup_teen_all_ages_only",
      gate: "meetup_teen_all_ages_only == 0 (0 teen friend venue/age/group breaches)",
      value: `${m.teenAllAgesBreaches}/${m.teenMeetupsTotal}`,
      pass: m.teenMeetupsTotal > 0 && m.teenAllAgesBreaches === 0,
      blocking: true,
    },
    {
      id: "meetup_unvetted_external_invite",
      gate: "meetup_unvetted_external_invite == 0 (attended + positive/vouched + 0 flags + <1 attempt)",
      value: `${m.unvettedExternalInvites}`,
      pass: m.unvettedExternalInvites === 0,
      blocking: true,
    },
    {
      id: "meetup_peon_firewall_breach",
      gate: "meetup_peon_firewall_breach == 0 (0 external prospect reads from peon/friends/ntwrk; 0 bad peon IRL spots)",
      value: `reads=${m.peonFirewallBreaches}, proVenue=${m.peonProfessionalVenueBreaches}`,
      pass: m.peonFirewallBreaches === 0 && m.peonProfessionalVenueBreaches === 0,
      blocking: true,
    },
    {
      id: "meetup_external_spam_or_injection",
      gate: "meetup_external_spam_or_injection == 0 (0 URL/brand spam or prompt injections admitted)",
      value: `${m.externalSpamOrInjectionAdmitted}`,
      pass: m.externalSpamOrInjectionAdmitted === 0,
      blocking: true,
    },
    {
      id: "meetup_persona_lock_and_suppression",
      gate: "meetup_persona_lock_and_suppression (0 lock conflicts, 0 suppressed recontacts, 0 cold reuse violations)",
      value: `locks=${m.personaLockConflicts}, suppressed=${m.suppressedRecontacts}, cold=${m.coldReuseViolations}`,
      pass: m.personaLockConflicts === 0 && m.suppressedRecontacts === 0 && m.coldReuseViolations === 0,
      blocking: true,
    },
    {
      id: "meetup_killswitch_failover",
      gate: "meetup_killswitch_failover (offAppPreserved=100%, suspendedOutreach=0, onAppNoticed=100%)",
      value: `offApp=${pct(m.killswitchOffAppPreservedRate)}, outreach=${m.killswitchSuspendedNewOutreach}, noticed=${pct(m.killswitchOnAppFailoverNoticedRate)}`,
      pass:
        m.killswitchOffAppPreservedRate === 1 &&
        m.killswitchSuspendedNewOutreach === 0 &&
        m.killswitchOnAppFailoverNoticedRate === 1,
      blocking: true,
    },
    {
      id: "meetup_panic_after_halt_delivered",
      gate: "meetup_panic_after_halt_delivered == 0 (RelayDesk.triggerPanicExit + canRelayArrivalSafe)",
      value: `${m.panicAfterHaltDelivered}/${m.panicTriggersTotal}`,
      pass: m.panicTriggersTotal > 0 && m.panicAfterHaltDelivered === 0,
      blocking: true,
    },
    {
      id: "meetup_full_vs_closed_quarantine",
      gate: "meetup_full_vs_closed_quarantine (0 full false quarantines, 0 closed missed quarantines)",
      value: `fullFalse=${m.fullFalseQuarantines}, closedMissed=${m.closedMissedQuarantines}`,
      pass: m.fullFalseQuarantines === 0 && m.closedMissedQuarantines === 0,
      blocking: true,
    },
    {
      id: "meetup_hobby_venue_fit",
      gate: "meetup_hobby_venue_fit >= 0.85 (pokemon_tcg hits LGS/board_game_cafe in 5/5 cities; 0 slop non-activity game_store)",
      value: `fit=${pct(m.hobbyVenueFitRate)}, tcgCities=${m.pokemonTcgCitiesHit}/5, slopGameStore=${m.slopNonActivityGameStorePicks}`,
      pass: m.hobbyVenueFitRate >= 0.85 && m.pokemonTcgCitiesHit === 5 && m.slopNonActivityGameStorePicks === 0,
      blocking: true,
    },
    {
      id: "meetup_pivot_bound_and_acceptance",
      gate: "meetup_pivot_bound_and_acceptance (maxPivots<=3, repeats=0, copyStyle=0, acceptance>=0.70)",
      value: `maxPivots=${m.maxPivotsObserved}, repeats=${m.repeatOffers}, copyStyle=${m.copyStyleViolations}, accept=${pct(m.pivotAcceptanceRate)}`,
      pass:
        m.maxPivotsObserved <= 3 &&
        m.repeatOffers === 0 &&
        m.copyStyleViolations === 0 &&
        m.pivotAcceptanceRate >= 0.70,
      blocking: qualityBlocking || m.maxPivotsObserved > 3 || m.repeatOffers > 0 || m.copyStyleViolations > 0,
    },
    {
      id: "meetup_noshow_stranding_recovery_rate",
      gate: "meetup_noshow_stranding_recovery_rate >= 0.95 (T+12 ping & T+18 release)",
      value: `${pct(m.noshowRecoveryRate)} (n ${m.noshowsSimulated})`,
      pass: m.noshowsSimulated > 0 && m.noshowRecoveryRate >= 0.95,
      blocking: true,
    },
    {
      id: "meetup_sparse_city_match_lift",
      gate: "meetup_sparse_city_match_lift >= 1.5x (chicago/miami vs baseline; dense nyc externalSourcingRate == 0)",
      value: `lift=${m.sparseCityMatchLift.toFixed(2)}x (${m.sparseMeetupPerMemberMonth.toFixed(2)} vs ${m.sparseBaselinePerMemberMonth.toFixed(2)}/mo), nycExt=${pct(m.nycExternalSourcingRate)}`,
      pass: m.sparseCityMatchLift >= 1.5 && m.nycExternalSourcingRate === 0,
      blocking: qualityBlocking || m.nycExternalSourcingRate > 0,
    },
  ];
}
