import {
  ALL_SEED_VENUES,
  CITY_IDS,
  CITY_TZ,
  DAY,
  HOUR,
  MINUTE,
  LeakGuard,
  canBeMatched,
  chooseFairMidpoint,
  computeFollowupTimestamp,
  computeVenuePersonaScore,
  earliestDayKeyOf,
  estimateTravelMinutes,
  evaluateArrivalRelay,
  evaluateBackupPivot,
  evaluateFollowupSend,
  evaluateMeetupPhase,
  evaluateNoShow,
  fromLocal,
  inQuietHours,
  latestDayKeyOf,
  localParts,
  needsPreRecommendOpenCheck,
  parseOptOut,
  parseReply,
  pickPrimaryAndBackupVenue,
  rankVenuesForMatch,
  selectWorkIntroChannel,
  shouldFetchExternalVenues,
  type AppId,
  type City,
  type VenueRecord,
} from "@thenetwork/core";
import { groupAgeAllowed, teenPlaceAllowed, teenRosterSizeAllowed } from "../../core/src/generated/friendIntroAge.ts";
import { appearanceLeak } from "../../engine/src/packs/slop/appearance.ts";
import { relayItem, type RelayContext, type RelayItem } from "../../engine/src/relay.ts";
import { holdEveryItem, simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";
import { PEON_ENGINE_CONFIG } from "../../engine/src/packs/peon/index.ts";
import { peonSeats } from "../../engine/src/packs/peon/seats.ts";
import {
  MeetupCoordinator,
  VenueManager,
  feedbackOf,
  meetingSpot,
  seedVenueToGeoVenue,
  type MeetupCoordHost,
} from "../../network/src/index.ts";
import { postingFacts, type JobPosting } from "../../network/src/jobs.ts";
import { appWiring } from "../../network/service/packs.ts";
import { APPS } from "../../platform/src/apps.ts";
import { detectKeyword, leaveTarget } from "../../platform/src/consent.ts";
import { friendsOutboundLog } from "./apps/friends/metrics.ts";
import { runFriendsWorldAsync } from "./apps/friends/world.ts";
import { friendsTeenMatcher } from "./apps/friends/packMatcher.ts";
import {
  LiveConsentHarness,
  SimVenueProvider,
  cloneSeedVenues,
  formatLocalTime,
  formatTranscripts,
  generateFiveCityPopulation,
  toVenuePrefs,
  type ConversationTurn,
  type FiveCityInvariantCounts,
  type FiveCityMember,
  type FiveCityScenarioResult,
  type FiveCitySuiteResult,
  type ScenarioCheck,
} from "./fiveCityHarness.ts";

function makeScenario(
  id: string,
  title: string,
  city: City | "multi",
  app: AppId,
  kind: "happy" | "unhappy",
  checks: ScenarioCheck[],
  transcript: ConversationTurn[],
  summary: string
): FiveCityScenarioResult {
  return {
    id,
    title,
    city,
    app,
    kind,
    pass: checks.every(c => c.pass),
    checks,
    transcript,
    summary,
  };
}

function emptyInvariants(): FiveCityInvariantCounts {
  return {
    canaryLeaks: 0,
    minorContacts: 0,
    minorBarRecs: 0,
    teenAdultContact: 0,
    teenGapContact: 0,
    teenLaneContact: 0,
    teenUnreadyContact: 0,
    teenSwitchOffContact: 0,
    teenRelayContact: 0,
    teenGroupContact: 0,
    teenPlaceContact: 0,
    peonPhysicalVenues: 0,
    visitedOrRejectedRepeats: 0,
    nonDrinkerBarRecs: 0,
    quietHourViolations: 0,
    dailyCapViolations: 0,
    externalApiCallsAfterSufficiency: 0,
    unsolicitedVideoInvites: 0,
    blockedOrHeldSafetyItems: 0,
  };
}

export async function runFiveCitySuite(
  opts: { seed?: number; perCity?: number } = {}
): Promise<FiveCitySuiteResult> {
  const seed = opts.seed ?? 42;
  const perCity = opts.perCity ?? 30;
  const { members, summary: population } = generateFiveCityPopulation(seed, perCity);
  const invariants = emptyInvariants();
  const scenarios: FiveCityScenarioResult[] = [];

  const scanTranscriptCanaries = (transcript: readonly ConversationTurn[], involved: readonly FiveCityMember[]) => {
    for (const turn of transcript) {
      if (turn.from !== "Eliza") continue;
      for (const m of involved) {
        if (turn.to !== m.firstName && turn.to !== m.name && turn.text.includes(m.canary)) {
          invariants.canaryLeaks++;
        }
      }
    }
  };

  // ============================================================================================
  // S1. SF slop 1-on-1 Date (Happy) — real ConsentNetwork + VenueManager + MeetupCoordinator
  // ============================================================================================
  {
    const provider = new SimVenueProvider();
    const tz = CITY_TZ.sf;
    const startMs = fromLocal(2026, 11, 26, 18, tz);
    const alice: FiveCityMember = {
      ...members.find(m => m.city === "sf" && !m.isMinor)!,
      id: "sf-s1-alice",
      name: "Maya Chen",
      firstName: "Maya",
      neighborhood: "Hayes Valley",
      age: 29,
      maxBudgetTier: 2,
      drinksAlcohol: true,
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      archetype: "foodie",
      visitedVenueIds: [],
      rejectedVenueIds: [],
    };
    const bob: FiveCityMember = {
      ...members.filter(m => m.city === "sf" && !m.isMinor)[1]!,
      id: "sf-s1-bob",
      name: "Theo Alvarez",
      firstName: "Theo",
      neighborhood: "Mission District",
      age: 31,
      maxBudgetTier: 2,
      drinksAlcohol: true,
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      archetype: "social",
      visitedVenueIds: [],
      rejectedVenueIds: [],
    };

    const h = new LiveConsentHarness({
      app: "slop",
      city: "sf",
      startMs: fromLocal(2026, 11, 25, 11, tz),
      networkOptions: {
        app: "slop",
        city: "sf",
        seed: 101,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
        arrivalBriefs: true,
        venueProvider: provider,
        engine: { cities: ["sf"] },
      },
    });
    h.addMember(alice, { romanceOptIn: true, quietHours: [23, 7] });
    h.addMember(bob, { romanceOptIn: true, quietHours: [23, 7] });
    await h.onboard(alice.id, bob.id);

    const midpoint = chooseFairMidpoint("sf", [alice.neighborhood, bob.neighborhood], "date");
    const pick = await h.net.venues.pickForMatchAsync(
      {
        city: "sf",
        memberAreas: [alice.neighborhood, bob.neighborhood],
        members: [toVenuePrefs(alice), toVenuePrefs(bob)],
        startMs,
        mode: "date",
      },
      startMs - 4 * HOUR
    );
    const primary = pick.primary!;
    const backup = pick.backup!;
    const preOpen = await provider.checkOpen(primary.venue, startMs - 4 * HOUR);
    const preScoreBefore = computeVenuePersonaScore(primary.venue, [alice.archetype, bob.archetype]);

    const oppId = h.propose([alice.id, bob.id], {
      category: "romance",
      objective: `coffee date near ${midpoint?.neighborhood.name ?? "Mission District"}`,
      startMs,
      endMs: startMs + 2 * HOUR,
    });
    await h.answerProbes([alice.id, bob.id], () => "Yes, count me in!", 4 * DAY, oppId);
    const opp = h.opp(oppId);
    const meetingAt = opp?.meetingAt ?? startMs;
    const meetup = h.net.meetups.getMeetup(oppId);
    if (!meetup) {
      h.net.meetups.registerMeetup({
        meetupId: oppId,
        app: "slop",
        city: "sf",
        startMs: meetingAt,
        participants: [alice.id, bob.id],
        primaryVenueId: primary.venue.id,
        backupVenueId: backup.venue.id,
      });
    }

    await h.advanceTo(meetingAt - 75 * MINUTE);
    const briefSent = h.sent.some(s => s.body.includes(opp?.venue ?? primary.venue.name) || s.meta.type === "info");
    const briefPhase = evaluateMeetupPhase(meetingAt - 75 * MINUTE, meetingAt);
    await h.advanceTo(meetingAt - 50 * MINUTE);
    await h.say(bob.id, "Got it, see you there!", "brief_ack");

    await h.advanceTo(meetingAt - 15 * MINUTE);
    const arrPhase = evaluateMeetupPhase(meetingAt - 15 * MINUTE, meetingAt);
    const beforeArr = h.mark();
    await h.say(alice.id, "I'm here wearing a green jacket by the front counter!", "arrival_cue");
    const arrRelays = h.to(bob.id, beforeArr);
    await h.say(bob.id, "Spotted you — we met!", "met");
    const metAfter = h.net.meetups.getMeetup(oppId)?.met === true;

    const endMs = fromLocal(2026, 11, 26, 20, tz);
    const followup = computeFollowupTimestamp(endMs, tz);
    const fuParts = localParts(followup.scheduledAt, tz);
    const canSendFu = evaluateFollowupSend({
      optedOut: false,
      isQuietHours: inQuietHours(followup.scheduledAt, tz, [20, 9]),
      dailyProactiveCount: 0,
      remindersSent: 0,
    });

    const fbText = "It was great! Definitely want to see Theo again, loved the venue and great vibe.";
    const parsedFb = feedbackOf(fbText);
    const updatedVenue = h.net.venues.recordFeedback(
      primary.venue.id,
      alice.id,
      [alice.archetype, bob.archetype],
      parsedFb.venue!,
      followup.scheduledAt + 12 * MINUTE
    )!;
    h.net.venues.recordVisit(bob.id, primary.venue.id);
    const postScoreAfter = computeVenuePersonaScore(updatedVenue, [alice.archetype, bob.archetype]);
    const visitedSaved = h.net.venues.visitedBy(alice.id).includes(primary.venue.id);

    invariants.canaryLeaks += h.scanCanaries([alice, bob]);
    scanTranscriptCanaries(h.transcript, [alice, bob]);

    const checks: ScenarioCheck[] = [
      {
        name: "fair midpoint selected in central SF",
        pass: !!midpoint && midpoint.maxMinutes <= 25,
        detail: `${midpoint?.neighborhood.name} (max ${midpoint?.maxMinutes}m)`,
      },
      {
        name: "budget $$ respected and pre-rec open check passes",
        pass: primary.venue.priceTier <= 2 && preOpen === "ProviderOpen" && !!backup,
        detail: `${primary.venue.name} (tier ${primary.venue.priceTier}), backup ${backup.venue.name}`,
      },
      {
        name: "ConsentNetwork sequential probes -> mutual yes -> scheduled SF date",
        pass: opp?.stage === "scheduled" && h.meetings.length >= 1,
        detail: `stage=${opp?.stage}, venue=${opp?.venue}, meetings=${h.meetings.length}`,
      },
      {
        name: "T-75m brief, T-15m arrival relay, and met check-in pass through MeetupCoordinator",
        pass:
          briefPhase === "pre_brief" &&
          arrPhase === "active_arrival" &&
          briefSent &&
          arrRelays.some(m => /green jacket/i.test(m.body)) &&
          metAfter,
        detail: `brief=${briefSent}, relays=${arrRelays.length}, met=${metAfter}`,
      },
      {
        name: "evening date follow-up deferred to next-morning 09:30",
        pass: followup.nextDay && fuParts.hour === 9 && fuParts.minute === 30 && canSendFu,
        detail: `local ${fuParts.hour}:${String(fuParts.minute).padStart(2, "0")} nextDay=${followup.nextDay}`,
      },
      {
        name: "positive feedbackOf marks visited and raises VenueManager persona affinity",
        pass: parsedFb.venue?.venueSentiment === "liked" && postScoreAfter > preScoreBefore && visitedSaved,
        detail: `personaScore ${preScoreBefore} -> ${postScoreAfter}, visited=${visitedSaved}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S1",
        "SF slop 1-on-1 Date (Happy)",
        "sf",
        "slop",
        "happy",
        checks,
        h.transcript,
        `${primary.venue.name} + backup ${backup.venue.name}, affinity ${preScoreBefore}->${postScoreAfter}`
      )
    );
  }

  // ============================================================================================
  // S2. NYC friends 5-Person Impromptu Meetup (Happy + Non-Drinker + Vegan)
  // ============================================================================================
  {
    const tz = CITY_TZ.nyc;
    const nycAdults = members.filter(m => m.city === "nyc" && !m.isMinor).slice(0, 5);
    const areas = [
      "Flatiron / Union Square",
      "Chelsea / Meatpacking",
      "West Village",
      "Midtown West / Hudson Yards",
      "Williamsburg",
    ];
    const group: FiveCityMember[] = nycAdults.map((m, idx) => ({
      ...m,
      id: `nyc-s2-${idx + 1}`,
      neighborhood: areas[idx]!,
      maxBudgetTier: 3,
      archetype: idx === 0 || idx === 1 ? "foodie" : m.archetype,
      drinksAlcohol: idx !== 1,
      vegetarian: idx === 2 || idx === 3,
      vegan: idx === 3,
      wheelchairNeeded: false,
      visitedVenueIds: idx === 0 ? ["nyc-veselka-ev"] : [],
      rejectedVenueIds: [],
    }));
    const startMs = fromLocal(2026, 11, 27, 18, tz);
    const endMs = startMs + 2 * HOUR;

    const h = new LiveConsentHarness({
      app: "friends",
      city: "nyc",
      startMs: fromLocal(2026, 11, 26, 10, tz),
      networkOptions: {
        app: "friends",
        city: "nyc",
        seed: 102,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
        arrivalBriefs: true,
        engine: { cities: ["nyc"] },
      },
    });
    for (const m of group) h.addMember(m, { quietHours: [23, 7] });
    await h.onboard(...group.map(m => m.id));

    const pick = h.net.venues.pickForMatch(
      {
        city: "nyc",
        memberAreas: group.map(m => m.neighborhood),
        members: group.map(toVenuePrefs),
        startMs,
        mode: "group",
      },
      startMs - 3 * HOUR
    );
    const primary = pick.primary!;
    if (primary.venue.isBarOnly || !primary.venue.alcoholOptional) invariants.nonDrinkerBarRecs++;

    const oppId = h.propose(
      group.map(m => m.id),
      { category: "social", objective: "impromptu 5-person food-hall table", startMs, endMs }
    );
    await h.answerProbes(group.map(m => m.id), () => "Yes, count me in!", 4 * DAY, oppId);
    const opp = h.opp(oppId);
    const meetingAt = opp?.meetingAt ?? startMs;
    if (!h.net.meetups.getMeetup(oppId)) {
      h.net.meetups.registerMeetup({
        meetupId: oppId,
        app: "friends",
        city: "nyc",
        startMs: meetingAt,
        participants: group.map(m => m.id),
        primaryVenueId: primary.venue.id,
        backupVenueId: pick.backup?.venue.id,
      });
    }

    await h.advanceTo(meetingAt - 50 * MINUTE, 15 * MINUTE);
    for (const m of group.slice(2)) {
      await h.say(m.id, "See you all there!", "brief_ack");
    }
    await h.advanceTo(meetingAt - 12 * MINUTE, 15 * MINUTE);
    const beforeDigest = h.mark();
    await h.say(group[0]!.id, "I'm here wearing a navy coat by the front entrance!", "group_arr_1");
    await h.say(group[1]!.id, "On my way, 5 min out!", "group_arr_2");
    const immediateSpam = h.sent.slice(beforeDigest).filter(s => s.meta.type === "relay" || /navy coat/i.test(s.body)).length;
    await h.advanceTo(meetingAt - 8 * MINUTE, 2 * MINUTE);
    const digestMsgs = h.sent.slice(beforeDigest).filter(s => s.body.includes(group[0]!.firstName) && s.body.includes(group[1]!.firstName));

    const fu = computeFollowupTimestamp(endMs, tz);
    const fuParts = localParts(fu.scheduledAt, tz);
    const updated = h.net.venues.recordFeedback(
      primary.venue.id,
      group[0]!.id,
      group.map(m => m.archetype),
      feedbackOf("Loved the food hall, great vibe — would definitely see everyone again!").venue!,
      fu.scheduledAt + HOUR
    )!;

    // Verify heavy_drinker is NOT classified as nonDrinker while strict_sober IS blocked from alcohol-centric venues
    const hDrink = new LiveConsentHarness({
      app: "friends",
      city: "nyc",
      startMs: fromLocal(2026, 11, 26, 10, tz),
      networkOptions: {
        app: "friends",
        city: "nyc",
        seed: 1021,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
        engine: { cities: ["nyc"] },
      },
    });
    const heavyMember: FiveCityMember = { ...group[0]!, id: "nyc-s2-heavy", drinksAlcohol: true };
    const soberMember: FiveCityMember = { ...group[1]!, id: "nyc-s2-sober", drinksAlcohol: false };
    const peerMember: FiveCityMember = { ...group[2]!, id: "nyc-s2-peer", drinksAlcohol: true };
    hDrink.addMember(heavyMember, {
      quietHours: [23, 7],
      extraFacets: [{ kind: "trait", value: "heavy_drinker", tags: ["heavy_drinker"], scope: "matchable", provenance: "said", confidence: 1 }],
    });
    hDrink.addMember(soberMember, {
      quietHours: [23, 7],
      extraFacets: [{ kind: "boundary", value: "strict_sober", tags: ["strict_sober"], scope: "agent_private", provenance: "said", confidence: 1 }],
    });
    hDrink.addMember(peerMember, { quietHours: [23, 7] });
    await hDrink.onboard(heavyMember.id, soberMember.id, peerMember.id);
    const alcoholVenue = ALL_SEED_VENUES.find(v => v.city === "nyc" && v.isAlcoholCentric)!;
    const heavyAllowed = hDrink.net.venuePassesRedLines(alcoholVenue, [heavyMember.id, peerMember.id], startMs);
    const soberBlocked = !hDrink.net.venuePassesRedLines(alcoholVenue, [soberMember.id, peerMember.id], startMs);

    invariants.canaryLeaks += h.scanCanaries(group);
    scanTranscriptCanaries(h.transcript, group);

    const checks: ScenarioCheck[] = [
      {
        name: "Tier S alcohol-optional vegan food hall selected (never bar-only)",
        pass:
          primary.venue.category === "food_hall" &&
          !primary.venue.isBarOnly &&
          primary.venue.alcoholOptional &&
          primary.venue.servesVegan &&
          primary.rubricScore >= 90,
        detail: `${primary.venue.name} (${primary.venue.category}, rubric=${primary.rubricScore})`,
      },
      {
        name: "heavy_drinker is not classified as nonDrinker while strict_sober rejects alcohol-centric venues",
        pass: heavyAllowed && soberBlocked,
        detail: `venue=${alcoholVenue.id}, heavyAllowed=${heavyAllowed}, soberBlocked=${soberBlocked}`,
      },
      {
        name: "all 5 attendees confirmed through ConsentNetwork and scheduled",
        pass: opp?.stage === "scheduled" && opp.participants.length === 5,
        detail: `stage=${opp?.stage}, count=${opp?.participants.length}`,
      },
      {
        name: "group arrival cues batched into debounced digest (0 immediate spam)",
        pass: immediateSpam === 0 && digestMsgs.length >= 3,
        detail: `immediate=${immediateSpam}, digestRecipients=${digestMsgs.length}`,
      },
      {
        name: "next-morning follow-up + positive venue feedback raises prior",
        pass:
          fu.nextDay &&
          fuParts.hour === 9 &&
          fuParts.minute === 30 &&
          updated.personaPriors.default!.alpha > primary.venue.personaPriors.default!.alpha,
        detail: `alpha ${primary.venue.personaPriors.default!.alpha} -> ${updated.personaPriors.default!.alpha}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S2",
        "NYC friends 5-Person Impromptu Meetup (Happy + Non-Drinker)",
        "nyc",
        "friends",
        "happy",
        checks,
        h.transcript,
        `${primary.venue.name} rubric=${primary.rubricScore}, 5/5 booked, debounced digest -> ${digestMsgs.length} members`
      )
    );
  }

  // ============================================================================================
  // S3. LA slop/friends Car-Radius & 405 Barrier (Happy + Too-Far Rejection)
  // ============================================================================================
  {
    const tz = CITY_TZ.la;
    const startMs = fromLocal(2026, 11, 28, 14, tz);
    const laAdults = members.filter(m => m.city === "la" && !m.isMinor).slice(0, 3);
    const smMember: FiveCityMember = {
      ...laAdults[0]!,
      id: "la-s3-sm",
      neighborhood: "Santa Monica",
      maxBudgetTier: 2,
      drinksAlcohol: true,
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      visitedVenueIds: [],
      rejectedVenueIds: [],
    };
    const ccMember: FiveCityMember = {
      ...laAdults[1]!,
      id: "la-s3-cc",
      neighborhood: "Culver City",
      maxBudgetTier: 2,
      drinksAlcohol: true,
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      visitedVenueIds: [],
      rejectedVenueIds: [],
    };
    const hlpMember: FiveCityMember = {
      ...laAdults[2]!,
      id: "la-s3-hlp",
      neighborhood: "Highland Park",
      maxBudgetTier: 2,
      drinksAlcohol: true,
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      visitedVenueIds: [],
      rejectedVenueIds: [],
    };

    const h = new LiveConsentHarness({
      app: "slop",
      city: "la",
      startMs: fromLocal(2026, 11, 27, 10, tz),
      networkOptions: {
        app: "slop",
        city: "la",
        seed: 103,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
        engine: { cities: ["la"] },
      },
    });
    h.addMember(smMember, { romanceOptIn: true, quietHours: [23, 7] });
    h.addMember(ccMember, { romanceOptIn: true, quietHours: [23, 7] });
    await h.onboard(smMember.id, ccMember.id);

    const smToCcMin = estimateTravelMinutes("la", "Santa Monica", "Culver City");
    const smToHlpMin = estimateTravelMinutes("la", "Santa Monica", "Highland Park");
    const happyPick = h.net.venues.pickForMatch(
      {
        city: "la",
        memberAreas: [smMember.neighborhood, ccMember.neighborhood],
        members: [toVenuePrefs(smMember), toVenuePrefs(ccMember)],
        startMs,
        mode: "date",
      },
      startMs - 2 * HOUR
    );
    const tooFarMidpoint = chooseFairMidpoint("la", ["Santa Monica", "Highland Park"], "date");
    const tooFarRanked = rankVenuesForMatch(
      h.net.venues.listVenues("la"),
      {
        city: "la",
        memberAreas: [smMember.neighborhood, hlpMember.neighborhood],
        members: [toVenuePrefs(smMember), toVenuePrefs(hlpMember)],
        startMs,
        mode: "date",
      },
      startMs - 2 * HOUR
    );
    const centralMidpoint = chooseFairMidpoint("la", ["Silver Lake", "West Hollywood / Fairfax"], "date");

    const oppId = h.propose([smMember.id, ccMember.id], {
      category: "romance",
      objective: "afternoon coffee in Culver City",
      startMs,
      endMs: startMs + 2 * HOUR,
    });
    await h.answerProbes([smMember.id, ccMember.id], () => "Yes, Culver City is super easy from Santa Monica!");
    const opp = h.opp(oppId);
    h.transcript.push({
      atMs: h.clock.now(),
      atLabel: formatLocalTime(h.clock.now(), "la"),
      from: "Eliza",
      to: "Planner",
      app: "friends",
      text: `Refused Santa Monica <-> Highland Park across the 405 (~${smToHlpMin}m > 35m limit); Silver Lake <-> WeHo resolves to ${centralMidpoint?.neighborhood.name} (max ${centralMidpoint?.maxMinutes}m).`,
      tag: "405_barrier_guard",
    });

    invariants.canaryLeaks += h.scanCanaries([smMember, ccMember, hlpMember]);

    const checks: ScenarioCheck[] = [
      {
        name: "Santa Monica + Culver City match cleanly within LA 35m car radius and book through ConsentNetwork",
        pass: smToCcMin <= 35 && !!happyPick.primary && happyPick.primary.maxTravelMinutes <= 35 && opp?.stage === "scheduled",
        detail: `drive=${smToCcMin}m, venue=${happyPick.primary?.venue.name}, opp=${opp?.venue}`,
      },
      {
        name: "Santa Monica + Highland Park across 405 refused (exceeds T_max)",
        pass: smToHlpMin > 60 && tooFarMidpoint === undefined && tooFarRanked.length === 0,
        detail: `405 travel=${smToHlpMin}m, midpoint=${String(tooFarMidpoint)}, venues=${tooFarRanked.length}`,
      },
      {
        name: "Silver Lake + WeHo resolves fair central midpoint",
        pass: !!centralMidpoint && centralMidpoint.maxMinutes <= 40,
        detail: `${centralMidpoint?.neighborhood.name} (max ${centralMidpoint?.maxMinutes}m)`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S3",
        "LA slop/friends Car-Radius & 405 Barrier (Happy + Too-Far Rejection)",
        "la",
        "slop",
        "happy",
        checks,
        h.transcript,
        `SM+CC=${happyPick.primary?.venue.name} (${smToCcMin}m), SM+HLP refused (${smToHlpMin}m)`
      )
    );
  }

  // ============================================================================================
  // S4. Chicago & Miami Price-Tier Ceiling & Geographic Barriers (Happy)
  // ============================================================================================
  {
    const chiTz = CITY_TZ.chicago;
    const chiStart = fromLocal(2026, 11, 28, 13, chiTz);
    const chiAdults = members.filter(m => m.city === "chicago" && !m.isMinor).slice(0, 2);
    const chiLow: FiveCityMember = {
      ...chiAdults[0]!,
      id: "chi-s4-low",
      neighborhood: "Wicker Park / Bucktown",
      maxBudgetTier: 1,
      drinksAlcohol: true,
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      visitedVenueIds: [],
      rejectedVenueIds: [],
    };
    const chiHigh: FiveCityMember = {
      ...chiAdults[1]!,
      id: "chi-s4-high",
      neighborhood: "West Loop / Fulton Market",
      maxBudgetTier: 3,
      drinksAlcohol: true,
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      visitedVenueIds: [],
      rejectedVenueIds: [],
    };
    const hChi = new LiveConsentHarness({
      app: "slop",
      city: "chicago",
      startMs: fromLocal(2026, 11, 27, 10, chiTz),
      networkOptions: {
        app: "slop",
        city: "chicago",
        seed: 104,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
        engine: { cities: ["chicago"] },
      },
    });
    hChi.addMember(chiLow, { romanceOptIn: true, quietHours: [23, 7] });
    hChi.addMember(chiHigh, { romanceOptIn: true, quietHours: [23, 7] });
    await hChi.onboard(chiLow.id, chiHigh.id);
    const chiPick = hChi.net.venues.pickForMatch(
      {
        city: "chicago",
        memberAreas: [chiLow.neighborhood, chiHigh.neighborhood],
        members: [toVenuePrefs(chiLow), toVenuePrefs(chiHigh)],
        startMs: chiStart,
        mode: "date",
      },
      chiStart - 2 * HOUR
    );
    const chiOppId = hChi.propose([chiLow.id, chiHigh.id], { category: "romance", objective: "coffee in Wicker Park", startMs: chiStart });
    await hChi.answerProbes([chiLow.id, chiHigh.id], () => "Yes, sounds great!");
    const chiDiagonalMin = estimateTravelMinutes("chicago", "Logan Square", "Lakeview");
    const chiSameLineMin = estimateTravelMinutes("chicago", "Logan Square", "Wicker Park / Bucktown");

    const miaTz = CITY_TZ.miami;
    const miaStart = fromLocal(2026, 11, 27, 19, miaTz);
    const miaAdults = members.filter(m => m.city === "miami" && !m.isMinor).slice(0, 2);
    const miaUp1: FiveCityMember = {
      ...miaAdults[0]!,
      id: "mia-s4-1",
      neighborhood: "Brickell",
      maxBudgetTier: 4,
      drinksAlcohol: true,
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      archetype: "upscale",
      visitedVenueIds: [],
      rejectedVenueIds: [],
    };
    const miaUp2: FiveCityMember = {
      ...miaAdults[1]!,
      id: "mia-s4-2",
      neighborhood: "Downtown / Arts & Entertainment",
      maxBudgetTier: 4,
      drinksAlcohol: true,
      vegetarian: false,
      vegan: false,
      wheelchairNeeded: false,
      archetype: "romantic",
      visitedVenueIds: [],
      rejectedVenueIds: [],
    };
    const hMia = new LiveConsentHarness({
      app: "slop",
      city: "miami",
      startMs: fromLocal(2026, 11, 26, 11, miaTz),
      networkOptions: {
        app: "slop",
        city: "miami",
        seed: 105,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
        engine: { cities: ["miami"] },
      },
    });
    hMia.addMember(miaUp1, { romanceOptIn: true, quietHours: [23, 7] });
    hMia.addMember(miaUp2, { romanceOptIn: true, quietHours: [23, 7] });
    await hMia.onboard(miaUp1.id, miaUp2.id);
    const miaPick = hMia.net.venues.pickForMatch(
      {
        city: "miami",
        memberAreas: [miaUp1.neighborhood, miaUp2.neighborhood],
        members: [toVenuePrefs(miaUp1), toVenuePrefs(miaUp2)],
        startMs: miaStart,
        mode: "date",
      },
      miaStart - 2 * HOUR
    );
    const miaOppId = hMia.propose([miaUp1.id, miaUp2.id], { category: "romance", objective: "evening cocktails in Brickell", startMs: miaStart });
    await hMia.answerProbes([miaUp1.id, miaUp2.id], () => "Yes, I'm in!");
    const miaCausewayMin = estimateTravelMinutes("miami", "South Beach", "Brickell");
    const miaSameZoneMin = estimateTravelMinutes("miami", "Brickell", "Downtown / Arts & Entertainment");

    invariants.canaryLeaks += hChi.scanCanaries([chiLow, chiHigh]) + hMia.scanCanaries([miaUp1, miaUp2]);

    const checks: ScenarioCheck[] = [
      {
        name: "Chicago $ + $$$ pair strictly respects $ ceiling and books in Chicago ConsentNetwork",
        pass:
          chiPick.candidates.length > 0 &&
          chiPick.candidates.every(c => c.venue.priceTier <= 1) &&
          hChi.opp(chiOppId)?.stage === "scheduled",
        detail: `top=${chiPick.primary?.venue.name} (tier ${chiPick.primary?.venue.priceTier}), all ${chiPick.candidates.length} <= 1`,
      },
      {
        name: "Chicago diagonal CTA L penalty applied (Logan Square <-> Lakeview)",
        pass: chiDiagonalMin >= chiSameLineMin + 15,
        detail: `diagonal=${chiDiagonalMin}m vs same-line=${chiSameLineMin}m`,
      },
      {
        name: "Miami $$$$ pair selects upscale cocktail lounge and books in Miami ConsentNetwork",
        pass:
          !!miaPick.primary &&
          miaPick.primary.venue.priceTier === 4 &&
          miaPick.primary.venue.id === "mia-viceversa" &&
          hMia.opp(miaOppId)?.stage === "scheduled",
        detail: `top=${miaPick.primary?.venue.name} (tier ${miaPick.primary?.venue.priceTier})`,
      },
      {
        name: "Miami causeway penalty applied (South Beach <-> Brickell)",
        pass: miaCausewayMin >= miaSameZoneMin + 18,
        detail: `causeway=${miaCausewayMin}m vs mainland=${miaSameZoneMin}m`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S4",
        "Chicago & Miami Price-Tier & Geographic Barriers (Happy)",
        "multi",
        "slop",
        "happy",
        checks,
        [...hChi.transcript, ...hMia.transcript],
        `CHI=${chiPick.primary?.venue.name} ($), MIA=${miaPick.primary?.venue.name} ($$$$)`
      )
    );
  }

  // ============================================================================================
  // S5. Boardy-Style peon Work Intros (WarmEmail, ScheduledVideo, RelayShare, Decline, 0 Venues)
  // ============================================================================================
  {
    const cand = members.find(m => m.city === "sf" && !m.isMinor && !!m.email)!;
    const mgr = members.find(m => m.city === "nyc" && !m.isMinor && !!m.email)!;
    const emails: Record<string, string> = { [cand.id]: cand.email!, [mgr.id]: mgr.email! };

    // 5A: WarmEmail through real ConsentNetwork (peon + Cofounder) + T+72h bounce + T+7d outcome check-in
    const warmStart = fromLocal(2026, 11, 23, 10, CITY_TZ.nyc);
    const hWarm = new LiveConsentHarness({
      app: "peon",
      city: "nyc",
      startMs: warmStart,
      networkOptions: {
        app: "peon",
        city: "nyc",
        seed: 1051,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
        workIntroEmailOf: id => emails[id],
      },
    });
    hWarm.addMember(cand, {
      quietHours: [23, 7],
      extraPresence: [{ city: "nyc", type: "temporary", areas: ["Remote"], from: warmStart - DAY, to: warmStart + 30 * DAY }],
    });
    hWarm.addMember(mgr, { quietHours: [23, 7] });
    await hWarm.onboard(cand.id, mgr.id);
    const warmId = hWarm.propose([cand.id, mgr.id], { category: "professional", objective: "Senior Systems Engineer intro" });
    await hWarm.answerProbes([cand.id, mgr.id], () => "Yes, let's connect!", 4 * DAY, warmId);
    const warmOpp = hWarm.opp(warmId);
    if (warmOpp?.venue !== undefined || warmOpp?.venueId !== undefined || hWarm.log("venue").length > 0) {
      invariants.peonPhysicalVenues++;
    }
    await hWarm.run(73 * HOUR, HOUR);
    const bounceLogged = hWarm.log("work_intro_bounce_check").length >= 1;
    await hWarm.run(4 * DAY + 2 * HOUR, 2 * HOUR);
    const outcomeLogged = hWarm.log("work_intro_outcome_checkin").length >= 1;

    // 5B: Slot-locked ScheduledVideo via generated chooseWorkIntroChannel (refuses unsolicited video before mutual confirm)
    const beforeSlot = selectWorkIntroChannel({
      candAge: cand.age,
      mgrAge: mgr.age,
      candOptedIn: true,
      mgrOptedIn: true,
      candHasEmail: false,
      mgrHasEmail: false,
      mutualSlotConfirmed: false,
      wantsVideo: true,
    });
    if (beforeSlot === "ScheduledVideo") invariants.unsolicitedVideoInvites++;
    const afterSlot = selectWorkIntroChannel({
      candAge: cand.age,
      mgrAge: mgr.age,
      candOptedIn: true,
      mgrOptedIn: true,
      candHasEmail: false,
      mgrHasEmail: false,
      mutualSlotConfirmed: true,
      wantsVideo: true,
    });

    // 5C: RelayShare fallback through real ConsentNetwork when no emails exist (0 physical venues!)
    const relayStart = fromLocal(2026, 11, 24, 10, CITY_TZ.sf);
    const hRelay = new LiveConsentHarness({
      app: "peon",
      city: "sf",
      startMs: relayStart,
      networkOptions: {
        app: "peon",
        city: "sf",
        seed: 1052,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
      },
    });
    hRelay.addMember({ ...cand, email: undefined }, { quietHours: [23, 7] });
    hRelay.addMember(
      { ...mgr, email: undefined },
      {
        quietHours: [23, 7],
        extraPresence: [{ city: "sf", type: "temporary", areas: ["Remote"], from: relayStart - DAY, to: relayStart + 30 * DAY }],
      }
    );
    await hRelay.onboard(cand.id, mgr.id);
    const relayId = hRelay.propose([cand.id, mgr.id], { category: "professional", objective: "Backend engineering intro" });
    await hRelay.answerProbes([cand.id, mgr.id], () => "Yes, sounds great!", 4 * DAY, relayId);
    const relayOpp = hRelay.opp(relayId);
    if (relayOpp?.venue !== undefined || relayOpp?.venueId !== undefined || hRelay.log("venue").length > 0) {
      invariants.peonPhysicalVenues++;
    }

    // 5D: Candidate decline on real peon job seat -> manager is NEVER probed!
    const peonWiring = appWiring("peon", "nyc");
    let savedPosting: JobPosting | undefined;
    const hDecline = new LiveConsentHarness({
      app: "peon",
      city: "nyc",
      startMs: fromLocal(2026, 11, 23, 13, CITY_TZ.nyc),
      networkOptions: {
        app: APPS.peon,
        city: "nyc",
        seed: 1053,
        inlineJudge: holdEveryItem.inline,
        reviewSlaHours: 120,
        maxNewPerDay: 20,
        matchingEnabled: true,
        plans: false,
        pack: peonWiring.pack!,
        hooks: peonWiring.hooks!,
        engine: { ...PEON_ENGINE_CONFIG, cities: ["nyc"] },
        onPosting: p => {
          savedPosting = p;
          const { intent, facets } = postingFacts(p);
          hDecline.intents.push(intent);
          hDecline.facets.push(...facets);
        },
      },
      snapshotTransform: snap => peonSeats(snap),
    });
    const nowDecline = hDecline.clock.now();
    hDecline.addMember(
      { ...mgr, id: "peon-hm", city: "nyc", neighborhood: "Williamsburg" },
      {
        quietHours: [23, 7],
        extraFacets: [
          { kind: "fact", value: "Company: Acme", tags: ["peon:company:acme"], scope: "shareable", provenance: "said", confidence: 0.9, validFrom: nowDecline - 10 * DAY, source: "chat", confirmedByMember: true },
          { kind: "fact", value: "Employer verified", tags: ["peon:verified"], scope: "matchable", provenance: "said", confidence: 0.9, validFrom: nowDecline - 10 * DAY, source: "chat", confirmedByMember: true },
        ],
      }
    );
    hDecline.addMember(
      { ...cand, id: "peon-cand", city: "nyc", neighborhood: "Williamsburg" },
      {
        quietHours: [23, 7],
        extraFacets: [
          { kind: "fact", value: "Looking for work", tags: ["peon:entity:candidate"], scope: "matchable", provenance: "said", confidence: 0.9, validFrom: nowDecline - 10 * DAY, source: "chat", confirmedByMember: true },
          { kind: "goal", value: "Wants data analyst work", tags: ["peon:family:data_analyst", "peon:seniority:2"], scope: "matchable", provenance: "said", confidence: 0.9, validFrom: nowDecline - 10 * DAY, source: "chat", confirmedByMember: true },
          { kind: "skill", value: "sql level 3", tags: ["peon:skill:sql:3"], scope: "matchable", provenance: "said", confidence: 0.9, validFrom: nowDecline - 10 * DAY, source: "chat", confirmedByMember: true },
          { kind: "preference", value: "Pay floor", tags: ["peon:pay_floor:85"], scope: "matchable", provenance: "said", confidence: 0.9, validFrom: nowDecline - 10 * DAY, source: "chat", confirmedByMember: true },
          { kind: "preference", value: "Work models", tags: ["peon:mode:hybrid", "peon:area:brooklyn"], scope: "matchable", provenance: "said", confidence: 0.9, validFrom: nowDecline - 10 * DAY, source: "chat", confirmedByMember: true },
          { kind: "fact", value: "Work authorization", tags: ["peon:auth:yes", "peon:sponsorship:no", "peon:start_weeks:2"], scope: "matchable", provenance: "said", confidence: 0.9, validFrom: nowDecline - 10 * DAY, source: "chat", confirmedByMember: true },
        ],
        extraIntents: [
          { id: "peon-cand-search", objective: "Find a data analyst role", category: "professional", details: "peon:search", horizonDays: 90, status: "active", createdAt: nowDecline - 10 * DAY },
        ],
      }
    );
    await hDecline.onboard("peon-hm", "peon-cand");
    await hDecline.say("peon-hm", "We're hiring a data analyst (level 2), 1 opening, $90k-$120k, hybrid in Brooklyn, must have SQL", "job_post");
    await hDecline.say("peon-hm", "yes", "confirm_post");
    await hDecline.runUntil(() => hDecline.net.reviewQueue().length > 0, 2 * DAY, HOUR);
    const seatOppIds = hDecline.approvePendingReviews("sim_staff");
    const candProbed = await hDecline.runUntil(() => hDecline.probed("peon-cand"), 2 * DAY, HOUR);
    await hDecline.say("peon-cand", "Thanks, I'll pass on this one.", "candidate_decline");
    await hDecline.run(2 * DAY, HOUR);
    const managerProbesAfterDecline = hDecline.sent.filter(s => s.to === "peon-hm" && s.meta.type === "probe").length;

    invariants.canaryLeaks +=
      hWarm.scanCanaries([cand, mgr]) +
      hRelay.scanCanaries([cand, mgr]) +
      hDecline.scanCanaries([cand, mgr]);

    const checks: ScenarioCheck[] = [
      {
        name: "happy peon intro uses WarmEmail with 0 physical venues + T+72h bounce & T+7d check-in",
        pass:
          warmOpp?.workIntro?.channel === "WarmEmail" &&
          warmOpp.venue === undefined &&
          warmOpp.venueId === undefined &&
          hWarm.log("venue").length === 0 &&
          bounceLogged &&
          outcomeLogged,
        detail: `channel=${warmOpp?.workIntro?.channel}, venue=${String(warmOpp?.venue)}, bounce=${bounceLogged}, checkin=${outcomeLogged}`,
      },
      {
        name: "unsolicited video refused before slot confirmation; ScheduledVideo allowed after mutual confirm",
        pass: beforeSlot !== "ScheduledVideo" && afterSlot === "ScheduledVideo",
        detail: `before=${beforeSlot}, after=${afterSlot}`,
      },
      {
        name: "no-email fallback selects RelayShare in ConsentNetwork with 0 physical venues",
        pass:
          relayOpp?.workIntro?.channel === "RelayShare" &&
          relayOpp.venue === undefined &&
          relayOpp.venueId === undefined &&
          hRelay.log("venue").length === 0,
        detail: `channel=${relayOpp?.workIntro?.channel}, venue=${String(relayOpp?.venue)}`,
      },
      {
        name: "candidate decline on real peon job seat halts before manager is ever probed",
        pass: !!savedPosting && seatOppIds.length > 0 && candProbed && managerProbesAfterDecline === 0,
        detail: `posting=${savedPosting?.id}, candProbed=${candProbed}, managerProbes=${managerProbesAfterDecline}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S5",
        "Boardy-Style peon Work Intros (WarmEmail + Video + Relay + Decline + 0 Venues)",
        "multi",
        "peon",
        "happy",
        checks,
        [...hWarm.transcript, ...hRelay.transcript, ...hDecline.transcript],
        `WarmEmail + ScheduledVideo + RelayShare, 0 physical venues, 0 manager probes on decline`
      )
    );
  }

  // ============================================================================================
  // S6. Organic Venue Growth ("Own Yelp") & API Sufficiency Cutoff (>= 10 local -> 0 API calls)
  // ============================================================================================
  {
    const provider = new SimVenueProvider();
    const tz = CITY_TZ.miami;
    const startMs = fromLocal(2026, 11, 28, 13, tz);
    const sparseSeed = cloneSeedVenues()
      .filter(v => v.city === "miami" && v.priceTier <= 2 && !v.isBarOnly && v.indoor)
      .slice(0, 4);
    const vm = new VenueManager({ seedVenues: sparseSeed, provider, sufficiencyThreshold: 10, apiBudgetRemaining: 50 });

    const miaAdults = members.filter(m => m.city === "miami" && !m.isMinor).slice(0, 2);
    const u1: FiveCityMember = { ...miaAdults[0]!, id: "mia-s6-1", neighborhood: "Wynwood", maxBudgetTier: 2, drinksAlcohol: true, vegetarian: false, vegan: false, wheelchairNeeded: false, visitedVenueIds: [], rejectedVenueIds: [] };
    const u2: FiveCityMember = { ...miaAdults[1]!, id: "mia-s6-2", neighborhood: "Downtown / Arts & Entertainment", maxBudgetTier: 2, drinksAlcohol: true, vegetarian: false, vegan: false, wheelchairNeeded: false, visitedVenueIds: [], rejectedVenueIds: [] };
    const req = { city: "miami" as const, memberAreas: [u1.neighborhood, u2.neighborhood], members: [toVenuePrefs(u1), toVenuePrefs(u2)], startMs, mode: "date" as const };

    const beforePick = vm.pickForMatch(req, startMs - 2 * HOUR);
    const hydrated = await vm.pickForMatchAsync(req, startMs - 2 * HOUR);
    const callsAfterHydrate = provider.searchCalls;

    let extraCalls = 0;
    for (let k = 0; k < 20; k++) {
      const callsBefore = provider.searchCalls;
      const p = await vm.pickForMatchAsync(req, startMs - HOUR);
      if (provider.searchCalls > callsBefore || shouldFetchExternalVenues(p.candidates.length)) {
        extraCalls++;
      }
    }
    invariants.externalApiCallsAfterSufficiency += extraCalls;

    const mentionText = "We ended up trying Panther Coffee in Wynwood and loved it!";
    const parsedMention = feedbackOf(mentionText);
    const mentioned = vm.recordOrganicMention(
      "miami",
      parsedMention.venue?.mentionedVenue ?? "Panther Coffee",
      "Wynwood",
      startMs + 3 * HOUR
    );
    const afterMention = vm.pickForMatch(
      { city: "miami", memberAreas: ["Wynwood", "Wynwood"], members: [toVenuePrefs(u1), toVenuePrefs(u2)], startMs: startMs + 24 * HOUR, mode: "date" },
      startMs + 23 * HOUR
    );
    const mentionRanked = afterMention.candidates.some(c => c.venue.id === mentioned.id);

    const t: ConversationTurn[] = [
      { atMs: startMs - 2 * HOUR, atLabel: formatLocalTime(startMs - 2 * HOUR, "miami"), from: "Eliza", to: "VenueManager", app: "ntwrk", text: `Local qualified=${beforePick.candidates.length} (<10) -> SimulatedVenueProvider search (${callsAfterHydrate} call) -> qualified=${hydrated.candidates.length} (>=10). Next 20 picks made ${extraCalls} API calls.`, tag: "sufficiency_cutoff" },
      { atMs: startMs + 3 * HOUR, atLabel: formatLocalTime(startMs + 3 * HOUR, "miami"), from: u1.firstName, to: "Eliza", app: "slop", text: mentionText },
      { atMs: startMs + 3 * HOUR + MINUTE, atLabel: formatLocalTime(startMs + 3 * HOUR + MINUTE, "miami"), from: "Eliza", to: "VenueManager", app: "ntwrk", text: `Ingested organic mention "${mentioned.name}" (${mentioned.neighborhood}, id=${mentioned.id}) -> ranked=${mentionRanked}.`, tag: "organic_mention" },
    ];

    const checks: ScenarioCheck[] = [
      {
        name: "sparse catalog (<10) triggers SimulatedVenueProvider fetch once and reaches >=10",
        pass: beforePick.shouldFetchExternal && callsAfterHydrate === 1 && hydrated.candidates.length >= 10,
        detail: `initial=${beforePick.candidates.length}, calls=${callsAfterHydrate}, after=${hydrated.candidates.length}`,
      },
      {
        name: "sufficiency cutoff makes 0 external API calls across 20 subsequent picks",
        pass: extraCalls === 0 && provider.searchCalls === callsAfterHydrate,
        detail: `extraCalls=${extraCalls}, totalSearchCalls=${provider.searchCalls}`,
      },
      {
        name: "organic member mention extracted by feedbackOf, stored in VenueManager, and ranked",
        pass: !!mentioned.public && mentionRanked,
        detail: `id=${mentioned.id}, ranked=${mentionRanked}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S6",
        "Organic Venue Growth ('Own Yelp') & API Sufficiency Cutoff",
        "miami",
        "ntwrk",
        "happy",
        checks,
        t,
        `${beforePick.candidates.length}->${hydrated.candidates.length} local venues, 0/20 extra API calls, Panther Coffee ingested`
      )
    );
  }

  // ============================================================================================
  // S7. Unhappy: Pre-Rec Open Check Detects Closure -> Quarantines & Falls Back to #2
  // ============================================================================================
  {
    const provider = new SimVenueProvider();
    const tz = CITY_TZ.sf;
    const startMs = fromLocal(2026, 11, 28, 13, tz);
    const nowMs = startMs - 2 * HOUR;
    const sfAdults = members.filter(m => m.city === "sf" && !m.isMinor).slice(0, 2);
    const a: FiveCityMember = { ...sfAdults[0]!, id: "sf-s7-a", neighborhood: "Hayes Valley", maxBudgetTier: 2, drinksAlcohol: true, vegetarian: false, vegan: false, wheelchairNeeded: false, visitedVenueIds: [], rejectedVenueIds: [] };
    const b: FiveCityMember = { ...sfAdults[1]!, id: "sf-s7-b", neighborhood: "Mission District", maxBudgetTier: 2, drinksAlcohol: true, vegetarian: false, vegan: false, wheelchairNeeded: false, visitedVenueIds: [], rejectedVenueIds: [] };
    const req = { city: "sf" as const, memberAreas: [a.neighborhood, b.neighborhood], members: [toVenuePrefs(a), toVenuePrefs(b)], startMs, mode: "date" as const, isWeekendOrHoliday: true };

    const vm = new VenueManager({ provider, sufficiencyThreshold: 1 });
    const initial = vm.pickForMatch(req, nowMs);
    const topVenue = initial.primary!.venue;
    vm.upsertVenue({ ...topVenue, lastVerifiedAt: nowMs - 10 * HOUR });
    provider.setVenueStatus(topVenue.id, "ProviderTemporaryClosed");

    const staleNeeded = needsPreRecommendOpenCheck(10 * 60, true);
    const fallbackPick = await vm.pickForMatchAsync(req, nowMs);
    const quarantined = vm.getVenue(topVenue.id)!;

    const t: ConversationTurn[] = [
      { atMs: nowMs, atLabel: formatLocalTime(nowMs, "sf"), from: "Eliza", to: "VenueManager", app: "slop", text: `Pre-rec open check on stale ${topVenue.name} (10h > 6h weekend TTL) returned closed_temporary -> status=${quarantined.status}, falling back to ${fallbackPick.primary?.venue.name}.`, tag: "prerec_closure_fallback" },
      { atMs: nowMs + MINUTE, atLabel: formatLocalTime(nowMs + MINUTE, "sf"), from: "Eliza", to: a.firstName, app: "slop", text: `You're set for 1pm at ${fallbackPick.primary?.venue.name} (${fallbackPick.primary?.venue.address}).`, tag: "booking" },
    ];

    const checks: ScenarioCheck[] = [
      {
        name: "weekend stale venue (600 min > 360 min TTL) triggers live provider open check",
        pass: staleNeeded && provider.openCheckCalls >= 1,
        detail: `needsCheck=${staleNeeded}, openCheckCalls=${provider.openCheckCalls}`,
      },
      {
        name: "closed top venue quarantined to ClosedTemporary and replaced by #2",
        pass:
          quarantined.status === "closed_temporary" &&
          !!fallbackPick.primary &&
          fallbackPick.primary.venue.id !== topVenue.id &&
          !fallbackPick.candidates.some(c => c.venue.id === topVenue.id),
        detail: `quarantined=${quarantined.name} (${quarantined.status}), fallback=${fallbackPick.primary?.venue.name}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S7",
        "Unhappy: Pre-Rec Open Check Detects Closure",
        "sf",
        "slop",
        "unhappy",
        checks,
        t,
        `${quarantined.name} quarantined -> fallback ${fallbackPick.primary?.venue.name}`
      )
    );
  }

  // ============================================================================================
  // S8. Unhappy: Surprise Closure On Arrival -> Quarantine + One-Shot Backup Pivot
  // ============================================================================================
  {
    const tz = CITY_TZ.nyc;
    const startMs = fromLocal(2026, 11, 28, 14, tz);
    const nycAdults = members.filter(m => m.city === "nyc" && !m.isMinor).slice(0, 2);
    const a: FiveCityMember = { ...nycAdults[0]!, id: "nyc-s8-a", neighborhood: "Financial District / Seaport", maxBudgetTier: 2, drinksAlcohol: true, vegetarian: false, vegan: false, wheelchairNeeded: false, visitedVenueIds: [], rejectedVenueIds: [] };
    const b: FiveCityMember = { ...nycAdults[1]!, id: "nyc-s8-b", neighborhood: "Financial District / Seaport", maxBudgetTier: 2, drinksAlcohol: true, vegetarian: false, vegan: false, wheelchairNeeded: false, visitedVenueIds: [], rejectedVenueIds: [] };

    const h = new LiveConsentHarness({
      app: "slop",
      city: "nyc",
      startMs: startMs - 2 * HOUR,
      networkOptions: {
        app: "slop",
        city: "nyc",
        seed: 108,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
        arrivalBriefs: true,
        engine: { cities: ["nyc"] },
      },
    });
    h.addMember(a, { romanceOptIn: true, quietHours: [23, 7] });
    h.addMember(b, { romanceOptIn: true, quietHours: [23, 7] });
    await h.onboard(a.id, b.id);

    const pick = h.net.venues.pickForMatch(
      { city: "nyc", memberAreas: [a.neighborhood, b.neighborhood], members: [toVenuePrefs(a), toVenuePrefs(b)], startMs, mode: "date" },
      startMs - 2 * HOUR
    );
    const primary = pick.primary!.venue;
    const backup = pick.backup!.venue;
    h.net.meetups.registerMeetup({
      meetupId: "nyc-s8-meetup",
      app: "slop",
      city: "nyc",
      startMs,
      participants: [a.id, b.id],
      primaryVenueId: primary.id,
      backupVenueId: backup.id,
    });

    await h.advanceTo(startMs - 75 * MINUTE, 15 * MINUTE);
    await h.advanceTo(startMs - 10 * MINUTE, 15 * MINUTE);
    const beforePivot = h.mark();
    await h.say(a.id, "Heads up, the cafe is closed tonight!", "arrival_closure_report");
    const pivotMsgs = h.sent.slice(beforePivot).filter(s => s.body.includes(backup.name));
    const updatedPrimary = h.net.venues.getVenue(primary.id)!;
    const meetupAfter = h.net.meetups.getMeetup("nyc-s8-meetup")!;
    const secondPivot = evaluateBackupPivot(true, true, startMs - 10 * MINUTE, startMs, meetupAfter.pivoted);

    // Also verify venue_full pivots to backup WITHOUT quarantining the primary venue
    const vmFull = new VenueManager();
    const fullSent: { to: string; body: string; kind: string }[] = [];
    const fullCoord = new MeetupCoordinator({
      venues: vmFull,
      ratesPhotos: false,
      party: (_mid, id) => {
        const person = id === a.id ? a : id === b.id ? b : undefined;
        return person ? { id: person.id, firstName: person.firstName, age: person.age, optedOut: false, confirmed: true } : undefined;
      },
      blocked: () => false,
      privateFacts: () => ({ forbidden: [], canaries: [] }),
      send: (to, body, meta) => { fullSent.push({ to, body, kind: meta.kind }); },
    });
    fullCoord.registerMeetup({
      meetupId: "nyc-s8-full",
      app: "slop",
      city: "nyc",
      startMs,
      participants: [a.id, b.id],
      primaryVenueId: primary.id,
      backupVenueId: backup.id,
    });
    const fullRes = fullCoord.handleInbound(a.id, "The cafe is completely full, no tables left!", startMs - 10 * MINUTE);
    const fullPrimaryAfter = vmFull.getVenue(primary.id)!;

    invariants.canaryLeaks += h.scanCanaries([a, b]);

    const checks: ScenarioCheck[] = [
      {
        name: "arrival closure text quarantines primary to suspect_closed in VenueManager",
        pass: updatedPrimary.status === "suspect_closed" && updatedPrimary.closureReports === 1,
        detail: `status=${updatedPrimary.status}, reports=${updatedPrimary.closureReports}`,
      },
      {
        name: "MeetupCoordinator broadcasts one-shot backup pivot to both parties and blocks duplicate pivot",
        pass: meetupAfter.pivoted && meetupAfter.activeVenueId === backup.id && pivotMsgs.length === 2 && !secondPivot,
        detail: `active=${meetupAfter.activeVenueId}, broadcasts=${pivotMsgs.length}, secondPivot=${secondPivot}`,
      },
      {
        name: "venue_full arrival pivots to backup without quarantining primary venue",
        pass:
          fullRes.handled &&
          fullRes.state === "venue_full" &&
          fullRes.pivotedToVenueId === backup.id &&
          fullPrimaryAfter.status === "active" &&
          fullPrimaryAfter.closureReports === 0 &&
          fullSent.filter(s => s.kind === "backup_pivot").length === 2 &&
          fullSent[0]!.body.includes("is full"),
        detail: `pivoted=${fullRes.pivotedToVenueId}, primaryStatus=${fullPrimaryAfter.status}, closureReports=${fullPrimaryAfter.closureReports}, broadcasts=${fullSent.length}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S8",
        "Unhappy: Surprise Closure On Arrival",
        "nyc",
        "slop",
        "unhappy",
        checks,
        h.transcript,
        `${primary.name} SuspectClosed -> broadcast pivot to ${backup.name}`
      )
    );
  }

  // ============================================================================================
  // S9. Unhappy: Post-Event Feedback Reports Closure -> Quarantine -> Permanent Closure
  // ============================================================================================
  {
    const vm = new VenueManager();
    const tz = CITY_TZ.chicago;
    const startMs = fromLocal(2026, 11, 28, 13, tz);
    const target0 = vm.getVenue("chi-wormhole-coffee")!;
    const chiAdults = members.filter(m => m.city === "chicago" && !m.isMinor).slice(0, 2);
    const u1: FiveCityMember = { ...chiAdults[0]!, neighborhood: "Wicker Park / Bucktown", maxBudgetTier: 2, drinksAlcohol: true, vegetarian: false, vegan: false, wheelchairNeeded: false, visitedVenueIds: [], rejectedVenueIds: [] };
    const u2: FiveCityMember = { ...chiAdults[1]!, neighborhood: "Wicker Park / Bucktown", maxBudgetTier: 2, drinksAlcohol: true, vegetarian: false, vegan: false, wheelchairNeeded: false, visitedVenueIds: [], rejectedVenueIds: [] };

    const msg1 = "We went by Wormhole Coffee but the place was shut down.";
    const fb1 = feedbackOf(msg1);
    const after1 = vm.recordFeedback(target0.id, u1.id, ["creative"], fb1.venue!, startMs + 20 * HOUR)!;
    const rankedAfter1 = vm.pickForMatch(
      { city: "chicago", memberAreas: [u1.neighborhood, u2.neighborhood], members: [toVenuePrefs(u1), toVenuePrefs(u2)], startMs: startMs + 48 * HOUR, mode: "date" },
      startMs + 24 * HOUR
    ).candidates;

    const msg2 = "Confirming the spot is permanently closed.";
    const fb2 = feedbackOf(msg2);
    const after2 = vm.recordFeedback(target0.id, u2.id, ["foodie"], fb2.venue!, startMs + 22 * HOUR)!;
    const rankedAfter2 = vm.pickForMatch(
      { city: "chicago", memberAreas: [u1.neighborhood, u2.neighborhood], members: [toVenuePrefs(u1), toVenuePrefs(u2)], startMs: startMs + 48 * HOUR, mode: "date" },
      startMs + 24 * HOUR
    ).candidates;

    const t: ConversationTurn[] = [
      { atMs: startMs + 20 * HOUR, atLabel: formatLocalTime(startMs + 20 * HOUR, "chicago"), from: u1.firstName, to: "Eliza", app: "slop", text: msg1, tag: "closure_feedback_1" },
      { atMs: startMs + 20 * HOUR + MINUTE, atLabel: formatLocalTime(startMs + 20 * HOUR + MINUTE, "chicago"), from: "Eliza", to: u1.firstName, app: "slop", text: `Thanks for letting me know — quarantined ${target0.name} (${after1.status}) so we won't suggest it.` },
      { atMs: startMs + 22 * HOUR, atLabel: formatLocalTime(startMs + 22 * HOUR, "chicago"), from: u2.firstName, to: "Eliza", app: "slop", text: msg2, tag: "closure_feedback_2" },
      { atMs: startMs + 22 * HOUR + MINUTE, atLabel: formatLocalTime(startMs + 22 * HOUR + MINUTE, "chicago"), from: "Eliza", to: "VenueManager", app: "slop", text: `${target0.name} transitioned to ${after2.status} (reports=${after2.closureReports}).`, tag: "permanent_closure" },
    ];

    const checks: ScenarioCheck[] = [
      {
        name: "1st report via feedbackOf transitions active -> suspect_closed and excludes venue",
        pass: fb1.venue?.venueClosed === true && after1.status === "suspect_closed" && !rankedAfter1.some(c => c.venue.id === target0.id),
        detail: `status=${after1.status}, recCount=${rankedAfter1.filter(c => c.venue.id === target0.id).length}`,
      },
      {
        name: "2nd report transitions suspect_closed -> closed_permanent and never recommends again",
        pass: fb2.venue?.venueClosed === true && after2.status === "closed_permanent" && after2.closureReports === 2 && !rankedAfter2.some(c => c.venue.id === target0.id),
        detail: `status=${after2.status}, reports=${after2.closureReports}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S9",
        "Unhappy: Post-Event Feedback Reports Closure",
        "chicago",
        "slop",
        "unhappy",
        checks,
        t,
        `${target0.name}: Active -> SuspectClosed -> ClosedPermanent (0 future recs)`
      )
    );
  }

  // ============================================================================================
  // S10. Unhappy: Visited & Rejected ("Not Interested") Exclusion
  // ============================================================================================
  {
    const vm = new VenueManager();
    const tz = CITY_TZ.sf;
    const startMs = fromLocal(2026, 11, 28, 13, tz);
    const sfAdults = members.filter(m => m.city === "sf" && !m.isMinor).slice(0, 2);
    const u1: FiveCityMember = { ...sfAdults[0]!, id: "sf-s10-1", neighborhood: "Mission District", maxBudgetTier: 3, drinksAlcohol: true, vegetarian: false, vegan: false, wheelchairNeeded: false, visitedVenueIds: [], rejectedVenueIds: [] };
    const u2: FiveCityMember = { ...sfAdults[1]!, id: "sf-s10-2", neighborhood: "Hayes Valley", maxBudgetTier: 3, drinksAlcohol: true, vegetarian: false, vegan: false, wheelchairNeeded: false, visitedVenueIds: [], rejectedVenueIds: [] };

    const baseline = vm.pickForMatch(
      { city: "sf", memberAreas: [u1.neighborhood, u2.neighborhood], members: [toVenuePrefs(u1), toVenuePrefs(u2)], startMs, mode: "date" },
      startMs - 2 * HOUR
    ).candidates;
    const venueA = baseline[0]!.venue;
    const venueB = baseline[1]!.venue;

    vm.recordVisit(u1.id, venueA.id);
    const rejText = `Not interested in ${venueB.name}, wrong vibe.`;
    const rejFb = feedbackOf(rejText);
    vm.recordFeedback(venueB.id, u1.id, [u1.archetype], rejFb.venue!, startMs - HOUR);

    let repeats = 0;
    let nextTop: string | undefined;
    for (let k = 0; k < 10; k++) {
      const res = vm.pickForMatch(
        { city: "sf", memberAreas: [u1.neighborhood, u2.neighborhood], members: [toVenuePrefs(u1), toVenuePrefs(u2)], startMs: startMs + k * 5 * MINUTE, mode: "date" },
        startMs - HOUR
      ).candidates;
      if (k === 0) nextTop = res[0]?.venue.name;
      if (res.some(c => c.venue.id === venueA.id || c.venue.id === venueB.id)) repeats++;
    }
    invariants.visitedOrRejectedRepeats += repeats;

    const t: ConversationTurn[] = [
      { atMs: startMs - HOUR, atLabel: formatLocalTime(startMs - HOUR, "sf"), from: u1.firstName, to: "Eliza", app: "slop", text: `Already been to ${venueA.name}, and ${rejText}` },
      { atMs: startMs - HOUR + MINUTE, atLabel: formatLocalTime(startMs - HOUR + MINUTE, "sf"), from: "Eliza", to: u1.firstName, app: "slop", text: `Got it — saved both exclusions. How about ${nextTop} instead?`, tag: "exclusion_respected" },
    ];

    const checks: ScenarioCheck[] = [
      {
        name: "visited Venue A and rejected ('not interested') Venue B never recommended across 10 runs",
        pass:
          rejFb.notInterested === true &&
          vm.visitedBy(u1.id).includes(venueA.id) &&
          vm.rejectedBy(u1.id).includes(venueB.id) &&
          repeats === 0 &&
          !!nextTop &&
          nextTop !== venueA.name &&
          nextTop !== venueB.name,
        detail: `repeats=${repeats}, nextTop=${nextTop}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S10",
        "Unhappy: Visited & Rejected ('Not Interested') Exclusion",
        "sf",
        "slop",
        "unhappy",
        checks,
        t,
        `excluded ${venueA.name} & ${venueB.name} across 10/10 runs -> ${nextTop}`
      )
    );
  }

  // ============================================================================================
  // S11. Unhappy: Arrival No-Show Guard at T+12m and T+18m (real MeetupCoordinator + ConsentNetwork)
  // ============================================================================================
  {
    const tz = CITY_TZ.la;
    const startMs = fromLocal(2026, 11, 28, 19, tz);
    const laAdults = members.filter(m => m.city === "la" && !m.isMinor).slice(0, 2);
    const a = { ...laAdults[0]!, id: "la-s11-a" };
    const b = { ...laAdults[1]!, id: "la-s11-b" };

    const h = new LiveConsentHarness({
      app: "slop",
      city: "la",
      startMs: startMs - HOUR,
      networkOptions: {
        app: "slop",
        city: "la",
        seed: 111,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
        arrivalBriefs: true,
        engine: { cities: ["la"] },
      },
    });
    h.addMember(a, { romanceOptIn: true, quietHours: [23, 7] });
    h.addMember(b, { romanceOptIn: true, quietHours: [23, 7] });
    await h.onboard(a.id, b.id);
    const laVenue = h.net.venues.listVenues("la").find(v => !v.isBarOnly)!;
    h.net.meetups.registerMeetup({
      meetupId: "la-s11-meetup",
      app: "slop",
      city: "la",
      startMs,
      participants: [a.id, b.id],
      primaryVenueId: laVenue.id,
    });

    await h.advanceTo(startMs - 50 * MINUTE, 15 * MINUTE);
    await h.say(b.id, "Got it, see you at 7!", "brief_ack");
    await h.advanceTo(startMs, 15 * MINUTE);
    await h.say(a.id, "I'm here by the front counter!", "arrived_on_time");
    const d5 = evaluateNoShow(startMs + 5 * MINUTE, startMs, true, false, false, false);
    const d12 = evaluateNoShow(startMs + 12 * MINUTE, startMs, true, false, false, false);
    const d18 = evaluateNoShow(startMs + 18 * MINUTE, startMs, true, false, true, false);
    const d22 = evaluateNoShow(startMs + 22 * MINUTE, startMs, true, false, true, true);

    const beforeT12 = h.mark();
    await h.advanceTo(startMs + 13 * MINUTE, 2 * MINUTE);
    const t12Ping = h.to(b.id, beforeT12);

    const beforeT18 = h.mark();
    await h.advanceTo(startMs + 19 * MINUTE, 2 * MINUTE);
    const t18Notice = h.to(a.id, beforeT18);

    const beforeT22 = h.mark();
    await h.advanceTo(startMs + 23 * MINUTE, 2 * MINUTE);
    const t22Extra = h.sent.slice(beforeT22);

    invariants.canaryLeaks += h.scanCanaries([a, b]);

    const checks: ScenarioCheck[] = [
      {
        name: "generated noShowDecision: T+5m none -> T+12m ping_late -> T+18m notify_waiting -> T+22m none",
        pass: d5 === "none" && d12 === "ping_late" && d18 === "notify_waiting" && d22 === "none",
        detail: `T+5=${d5}, T+12=${d12}, T+18=${d18}, T+22=${d22}`,
      },
      {
        name: "MeetupCoordinator fires T+12m ping to late member, T+18m notice to waiting member, 0 duplicate at T+22m",
        pass: t12Ping.length === 1 && t18Notice.length === 1 && t22Extra.length === 0,
        detail: `t12=${t12Ping.length}, t18=${t18Notice.length}, t22=${t22Extra.length}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S11",
        "Unhappy: Arrival No-Show Guard (T+12m / T+18m)",
        "la",
        "slop",
        "unhappy",
        checks,
        h.transcript,
        `T+12m pinged late attendee, T+18m freed waiting attendee, 0 duplicates`
      )
    );
  }

  // ============================================================================================
  // S12. Unhappy: Arrival Leak / Harassment / Contact-Slip Blocked (MeetupCoordinator + relayItem)
  // ============================================================================================
  {
    const tz = CITY_TZ.sf;
    const startMs = fromLocal(2026, 11, 28, 19, tz);
    const arrMs = startMs - 10 * MINUTE;
    const sfAdults = members.filter(m => m.city === "sf" && !m.isMinor).slice(0, 2);
    const sender = sfAdults[0]!;
    const recip = sfAdults[1]!;

    const vm = new VenueManager();
    const sent: { to: string; body: string; kind: string }[] = [];
    const guard = new LeakGuard({
      canaries: [sender.canary, recip.canary],
      facts: [
        { owner: sender.id, text: sender.privateDisclosure },
        { owner: recip.id, text: recip.privateDisclosure },
      ],
    });
    let panicked = false;
    const host: MeetupCoordHost = {
      venues: vm,
      ratesPhotos: true,
      party: (_mid, id) => {
        const m = id === sender.id ? sender : id === recip.id ? recip : undefined;
        return m ? { id: m.id, firstName: m.firstName, lastName: m.name.split(" ")[1], age: m.age, optedOut: false, confirmed: true } : undefined;
      },
      blocked: () => false,
      panicTriggered: () => panicked,
      privateFacts: () => ({
        forbidden: [
          { owner: sender.id, text: sender.privateDisclosure },
          { owner: recip.id, text: recip.privateDisclosure },
        ],
        canaries: [sender.canary, recip.canary],
      }),
      send: (to, body, meta) => sent.push({ to, body, kind: meta.kind }),
    };
    const coord = new MeetupCoordinator(host);
    coord.registerMeetup({
      meetupId: "sf-s12-meetup",
      app: "slop",
      city: "sf",
      startMs,
      participants: [sender.id, recip.id],
      primaryVenueId: vm.listVenues("sf")[0]!.id,
    });

    const baseCtx: RelayContext = {
      now: arrMs,
      opportunity: { id: "opp-s12", app: "slop", participants: [sender.id, recip.id], acceptedBy: [sender.id, recip.id], status: "mutual" },
      sender: { id: sender.id, firstName: sender.firstName, age: sender.age },
      recipient: { id: recip.id, firstName: recip.firstName, age: recip.age },
      blocked: false,
      guard,
      extraRules: txt => (appearanceLeak(txt) ? ["rating:appearance"] : []),
    };

    const attacks: { label: string; text: string }[] = [
      { label: "phone_slip", text: "I'm here, text me directly at four one five five five five zero one nine two" },
      { label: "address_and_canary", text: `I'm here, skip the cafe and come to 742 Evergreen St (ref ${recip.canary})` },
      { label: "harassment", text: "I'm here, you better show up or else you idiot" },
      { label: "appearance_rating_leak", text: "I'm here, they told me our photo rating score was a top 10% attractive match" },
    ];

    const t: ConversationTurn[] = [];
    const results = attacks.map((atk, idx) => {
      const item: RelayItem = { id: `s12-bad-${idx}`, kind: "text", from: sender.id, to: recip.id, at: arrMs + idx * 1000, text: atk.text };
      const r = relayItem(item, baseCtx);
      const coordRes = coord.handleInbound(sender.id, atk.text, arrMs + idx * 1000);
      const allowed = evaluateArrivalRelay({
        senderAge: sender.age,
        recipientAge: recip.age,
        senderConfirmed: true,
        recipientConfirmed: true,
        blocked: false,
        senderOptedOut: false,
        recipientOptedOut: false,
        nowMs: arrMs + idx * 1000,
        startMs,
        alreadyMet: false,
        passedSafetyAndLeakCheck: r.decision === "pass" && coordRes.relayedTo.length > 0,
      });
      if (r.decision !== "pass" && coordRes.relayedTo.length === 0 && !allowed) {
        invariants.blockedOrHeldSafetyItems++;
      } else {
        invariants.canaryLeaks++;
      }
      t.push({ atMs: arrMs + idx * 1000, atLabel: formatLocalTime(arrMs + idx * 1000, "sf"), from: sender.firstName, to: "Eliza", app: "slop", text: `[${atk.label}] ${atk.text}` });
      t.push({ atMs: arrMs + idx * 1000, atLabel: formatLocalTime(arrMs + idx * 1000, "sf"), from: "Eliza", to: sender.firstName, app: "slop", text: `Blocked/held (relay=${r.decision}, coord=${coordRes.blockedReason ?? "blocked"}): ${r.senderNotice}`, tag: `stopped_${atk.label}` });
      return { label: atk.label, decision: r.decision, rendered: r.rendered, coordRelayed: coordRes.relayedTo.length, allowed };
    });

    const cleanText = "I'm here wearing a denim jacket near the window!";
    const cleanCoord = coord.handleInbound(sender.id, cleanText, arrMs + 10_000);
    const cleanSent = sent.find(s => s.to === recip.id && s.kind === "arrival_relay");
    t.push({ atMs: arrMs + 10_000, atLabel: formatLocalTime(arrMs + 10_000, "sf"), from: sender.firstName, to: "Eliza", app: "slop", text: cleanText });
    t.push({ atMs: arrMs + 10_000, atLabel: formatLocalTime(arrMs + 10_000, "sf"), from: "Eliza", to: recip.firstName, app: "slop", text: cleanSent?.body ?? "", tag: "clean_pass" });

    // Panic halt blocks arrival relay immediately
    const sentBeforePanic = sent.length;
    panicked = true;
    const panicCoord = coord.handleInbound(sender.id, "I'm here by the front entrance wearing a blue coat!", arrMs + 20_000);
    const panicBlocked = panicCoord.relayedTo.length === 0 && panicCoord.blockedReason === "panic_triggered" && sent.length === sentBeforePanic;
    t.push({ atMs: arrMs + 20_000, atLabel: formatLocalTime(arrMs + 20_000, "sf"), from: "Eliza", to: sender.firstName, app: "slop", text: `Panic halt blocked arrival relay (reason=${panicCoord.blockedReason ?? "none"}).`, tag: "panic_halt" });

    scanTranscriptCanaries(t, [sender, recip]);

    const checks: ScenarioCheck[] = [
      {
        name: "all 4 unsafe arrival cues stopped by both MeetupCoordinator and relayItem",
        pass: results.every(r => r.decision !== "pass" && r.rendered === "" && r.coordRelayed === 0 && !r.allowed),
        detail: results.map(r => `${r.label}:${r.decision}/relayed=${r.coordRelayed}`).join(", "),
      },
      {
        name: "clean arrival cue passes MeetupCoordinator with outfit & landmark cue preserved",
        pass: cleanCoord.handled && cleanCoord.relayedTo.includes(recip.id) && !!cleanSent?.body.includes("denim jacket"),
        detail: `relayed=${cleanCoord.relayedTo.length}, body=${cleanSent?.body}`,
      },
      {
        name: "panic halt blocks arrival relay in MeetupCoordinator",
        pass: panicBlocked,
        detail: `relayed=${panicCoord.relayedTo.length}, reason=${panicCoord.blockedReason}, sentDelta=${sent.length - sentBeforePanic}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S12",
        "Unhappy: Arrival Leak / Harassment / Contact-Slip Blocked",
        "sf",
        "slop",
        "unhappy",
        checks,
        t,
        `4/4 attacks stopped, 1/1 clean arrival cue relayed, 0 leaks`
      )
    );
  }

  // ============================================================================================
  // S13. Unhappy: Group Flake (5 -> 3 Viable vs 5 -> 1 Graceful Cancel) through real ConsentNetwork
  // ============================================================================================
  {
    const tz = CITY_TZ.nyc;
    const nycAdults = members.filter(m => m.city === "nyc" && !m.isMinor).slice(5, 10);
    const startMs = fromLocal(2026, 11, 29, 18, tz);

    const runGroupFlake = async (dropCount: number, seedOffset: number) => {
      const h = new LiveConsentHarness({
        app: "friends",
        city: "nyc",
        startMs: fromLocal(2026, 11, 27, 10, tz),
        networkOptions: {
          app: "friends",
          city: "nyc",
          seed: 1130 + seedOffset,
          inlineJudge: simulatedReviewJudge({ exceptions: false }),
          maxNewPerDay: 0,
          plans: false,
          engine: { cities: ["nyc"] },
        },
      });
      const ids = nycAdults.map((m, i) => `nyc-s13-${seedOffset}-${i + 1}`);
      nycAdults.forEach((m, i) => h.addMember({ ...m, id: ids[i]! }, { quietHours: [23, 7] }));
      await h.onboard(...ids);
      const oppId = h.propose(ids, { category: "social", objective: "weekend supper table", startMs, endMs: startMs + 2 * HOUR });
      await h.answerProbes(ids, () => "Yes, I'm in!");
      const beforeDrops = h.opp(oppId)?.stage;
      for (let k = 0; k < dropCount; k++) {
        await h.say(ids[4 - k]!, "Sorry, something came up — I have to cancel and can't make it.", `drop_${k + 1}`);
      }
      await h.run(HOUR, HOUR);
      const after = h.opp(oppId);
      invariants.canaryLeaks += h.scanCanaries(nycAdults);
      return { h, oppId, beforeDrops, after };
    };

    const viableRun = await runGroupFlake(2, 1);
    const cancelRun = await runGroupFlake(4, 2);

    const viableRemaining = viableRun.after?.status.filter(([, s]) => s === "yes").length ?? 0;
    const cancelStage = cancelRun.after?.stage;

    const checks: ScenarioCheck[] = [
      {
        name: "5 -> 3 flakes remains scheduled and viable (>= quorum 3) in ConsentNetwork",
        pass: viableRun.beforeDrops === "scheduled" && viableRun.after?.stage === "scheduled" && viableRemaining === 3,
        detail: `before=${viableRun.beforeDrops}, after=${viableRun.after?.stage}, remaining=${viableRemaining}`,
      },
      {
        name: "5 -> 1 flakes triggers graceful cancellation in ConsentNetwork (never strands 1 solo)",
        pass: cancelRun.beforeDrops === "scheduled" && cancelStage !== "scheduled",
        detail: `before=${cancelRun.beforeDrops}, after=${cancelStage}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S13",
        "Unhappy: Group Flake (5->3 Viable vs 5->1 Graceful Cancel)",
        "nyc",
        "friends",
        "unhappy",
        checks,
        [...viableRun.h.transcript, ...cancelRun.h.transcript],
        `5->3 held (${viableRun.after?.stage}), 5->1 gracefully cancelled (${cancelStage})`
      )
    );
  }

  // ============================================================================================
  // S14. Unhappy: Quiet Hours & 3/Day Cap on Follow-Ups (Chicago)
  // ============================================================================================
  {
    const tz = CITY_TZ.chicago;
    const endMs = fromLocal(2026, 11, 27, 22, tz);
    const lateCheckMs = endMs + 30 * MINUTE;
    const lateParts = localParts(lateCheckMs, tz);
    const lateInQuiet = inQuietHours(lateCheckMs, tz, [20, 9]);
    const allowLate = evaluateFollowupSend({
      optedOut: false,
      isQuietHours: lateInQuiet,
      dailyProactiveCount: 0,
      remindersSent: 0,
    });
    if (allowLate) invariants.quietHourViolations++;

    const fu = computeFollowupTimestamp(endMs, tz);
    const fuParts = localParts(fu.scheduledAt, tz);
    const allowAtCap = evaluateFollowupSend({
      optedOut: false,
      isQuietHours: false,
      dailyProactiveCount: 3,
      remindersSent: 0,
    });
    if (allowAtCap) invariants.dailyCapViolations++;
    const allowNextDay = evaluateFollowupSend({
      optedOut: false,
      isQuietHours: false,
      dailyProactiveCount: 0,
      remindersSent: 0,
    });

    // Also verify quiet hours suppression in a real Chicago ConsentNetwork at 22:30 CST
    const chiAdults = members.filter(m => m.city === "chicago" && !m.isMinor).slice(0, 2);
    const h = new LiveConsentHarness({
      app: "slop",
      city: "chicago",
      startMs: lateCheckMs,
      networkOptions: {
        app: "slop",
        city: "chicago",
        seed: 114,
        inlineJudge: simulatedReviewJudge({ exceptions: false }),
        maxNewPerDay: 0,
        plans: false,
        engine: { cities: ["chicago"] },
      },
    });
    h.addMember(chiAdults[0]!, { romanceOptIn: true, quietHours: [20, 9] });
    h.addMember(chiAdults[1]!, { romanceOptIn: true, quietHours: [20, 9] });
    await h.onboard(chiAdults[0]!.id, chiAdults[1]!.id);
    const markNight = h.mark();
    h.propose([chiAdults[0]!.id, chiAdults[1]!.id], { category: "romance", objective: "Chicago coffee" });
    await h.run(2 * HOUR, 30 * MINUTE); // 22:30 -> 00:30 CST (still quiet hours!)
    const proactiveSentInQuiet = h.sent.slice(markNight).filter(s => s.meta.proactive !== false && s.meta.type === "probe").length;
    if (proactiveSentInQuiet > 0) invariants.quietHourViolations += proactiveSentInQuiet;

    h.transcript.push({
      atMs: lateCheckMs,
      atLabel: formatLocalTime(lateCheckMs, "chicago"),
      from: "Eliza",
      to: "Scheduler",
      app: "slop",
      text: `Suppressed night follow-up (local=${lateParts.hour}:30, quiet=${lateInQuiet}, proactiveInQuiet=${proactiveSentInQuiet}) -> deferred to Sat ${fuParts.hour}:${String(fuParts.minute).padStart(2, "0")} CST; 3/day cap deferred until reset.`,
      tag: "quiet_hours_and_cap",
    });

    const checks: ScenarioCheck[] = [
      {
        name: "10 PM Chicago end schedules next-morning 09:30 and blocks 22:30 quiet-hours send",
        pass: !allowLate && proactiveSentInQuiet === 0 && fu.nextDay && fuParts.hour === 9 && fuParts.minute === 30,
        detail: `allow22:30=${allowLate}, proactiveInQuiet=${proactiveSentInQuiet}, scheduled=${fuParts.hour}:${String(fuParts.minute).padStart(2, "0")}`,
      },
      {
        name: "member at 3/day proactive cap deferred cleanly, sent once cap resets",
        pass: !allowAtCap && allowNextDay,
        detail: `atCap=${allowAtCap}, nextDay=${allowNextDay}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S14",
        "Unhappy: Quiet Hours & 3/Day Cap",
        "chicago",
        "slop",
        "unhappy",
        checks,
        h.transcript,
        `0 quiet-hour sends, 0 cap violations (deferred to 09:00 CST)`
      )
    );
  }

  // ============================================================================================
  // S15. Unhappy: Teens (13-17) Across All 5 Cities — 0 Matches, 0 Relays, 0 Bars, All Teen Gates 0
  // ============================================================================================
  {
    const vm = new VenueManager();
    const t: ConversationTurn[] = [];
    let minorsTested = 0;
    let soloMinorChecks = 0;
    let soloVenuesNonEmpty = 0;
    let failClosedSoloChecks = 0;
    let stoppedCityChecks = 0;
    const namedBreweries = ["sf-biergarten-hayes", "sf-cellarmaker-mission", "nyc-threes-brewing"] as const;
    let breweryExcludedOk = namedBreweries.every(id => {
      const rec = ALL_SEED_VENUES.find(v => v.id === id);
      return !!rec && rec.isAlcoholCentric === true && rec.allAges === false && seedVenueToGeoVenue(rec).allAges === false;
    });
    let teenParityCities = 0;
    let teenOnCleanCities = 0;

    for (const city of CITY_IDS) {
      const tz = CITY_TZ[city];
      const startMs = fromLocal(2026, 11, 28, 14, tz);
      const cityMinors = members.filter(m => m.city === city && m.isMinor);
      const cityAdult = members.find(m => m.city === city && !m.isMinor)!;

      // Verify teen brewery exclusion in meetingSpot across all 5 cities
      const citySeedVenues = ALL_SEED_VENUES.filter(v => v.city === city);
      const teenSpot = meetingSpot([], "social", ["food", "outdoors", "social"], true, city, { venues: citySeedVenues });
      const teenSpotRec = citySeedVenues.find(v => v.id === teenSpot.venue.id);
      if (
        !teenSpotRec ||
        teenSpotRec.allAges !== true ||
        teenSpotRec.isAlcoholCentric === true ||
        teenSpotRec.isBarOnly ||
        (namedBreweries as readonly string[]).includes(teenSpotRec.id)
      ) {
        breweryExcludedOk = false;
        invariants.teenPlaceContact++;
      }

      // Verify 5-city teenStop=false vs teenStop=true parity against pre-feature reference world
      const worldSeed = 700 + CITY_IDS.indexOf(city);
      const worldOpts = { seed: worldSeed, city, n: 40, weeks: 1, minorShare: 0.25, teenBirthDates: true, matcher: friendsTeenMatcher() };
      const teenOnWorld = await runFriendsWorldAsync({ ...worldOpts, teenStop: false });
      const teenStopWorld = await runFriendsWorldAsync({ ...worldOpts, teenStop: true });
      const refWorld = await runFriendsWorldAsync({ ...worldOpts, teenBirthDates: false });
      const onBroken = teenOnWorld.flows.filter(f => f.ageRuleBroken).length;
      if (onBroken === 0) teenOnCleanCities++;
      else invariants.teenPlaceContact += onBroken;
      const stopMinorIds = new Set(teenStopWorld.world.personas.filter(p => p.hidden.trueAge < 18).map(p => p.id));
      const stopMinorContacts = teenStopWorld.contacts.filter(c => stopMinorIds.has(c.a) || stopMinorIds.has(c.b)).length;
      const stopBroken = teenStopWorld.flows.filter(f => f.ageRuleBroken).length;
      const stopContacts = stopMinorContacts + stopBroken;
      if (stopContacts > 0) {
        invariants.teenSwitchOffContact += stopContacts;
        invariants.minorContacts += stopContacts;
      }
      const worldSnap = (r: Awaited<ReturnType<typeof runFriendsWorldAsync>>) =>
        JSON.stringify({
          flows: r.flows.map(f => ({ key: f.key, stage: f.stage, invited: f.invited, booked: f.booked, attended: f.attended, ageRuleBroken: f.ageRuleBroken })),
          meetups: r.meetups,
          contacts: r.contacts,
          outbound: friendsOutboundLog(r),
        });
      const stopEqualsRef = worldSnap(teenStopWorld) === worldSnap(refWorld);
      if (stopContacts === 0 && stopEqualsRef) teenParityCities++;

      // Verify real ConsentNetwork with teenStop=true produces 0 minor contacts in every city
      const hTeen = new LiveConsentHarness({
        app: "friends",
        city,
        startMs: fromLocal(2026, 11, 27, 11, tz),
        networkOptions: {
          app: "friends",
          city,
          seed: 1150 + CITY_IDS.indexOf(city),
          inlineJudge: simulatedReviewJudge({ exceptions: false }),
          maxNewPerDay: 0,
          plans: false,
          engine: { cities: [city] },
        },
      });
      hTeen.net.stopTeenIntros("sim_staff");
      const m0 = cityMinors[0]!;
      hTeen.addMember(m0, { quietHours: [23, 7] });
      hTeen.addMember(cityAdult, { quietHours: [23, 7] });
      await hTeen.onboard(m0.id, cityAdult.id);
      hTeen.propose([m0.id, cityAdult.id], { category: "social", objective: "park walk", startMs });
      await hTeen.run(2 * DAY, 2 * HOUR);
      const minorProbes = hTeen.sent.filter(s => s.to === m0.id && (s.meta.type === "probe" || s.meta.type === "proposal")).length;
      if (minorProbes > 0 || hTeen.meetings.length > 0) {
        invariants.teenSwitchOffContact += minorProbes + hTeen.meetings.length;
        invariants.teenAdultContact += minorProbes + hTeen.meetings.length;
        invariants.minorContacts += minorProbes + hTeen.meetings.length;
      }
      stoppedCityChecks++;

      // Verify MeetupCoordinator blocks arrival relays for every minor
      const minorRelaySent: string[] = [];
      const minorCoord = new MeetupCoordinator({
        venues: vm,
        ratesPhotos: false,
        party: (_mid, id) => {
          const person = id === m0.id ? m0 : cityAdult;
          return { id: person.id, firstName: person.firstName, age: person.age, optedOut: false, confirmed: true };
        },
        blocked: () => false,
        privateFacts: () => ({ forbidden: [], canaries: [] }),
        send: (_to, body) => minorRelaySent.push(body),
      });
      minorCoord.registerMeetup({
        meetupId: `teen-relay-${city}`,
        app: "friends",
        city,
        startMs,
        participants: [m0.id, cityAdult.id],
        primaryVenueId: vm.listVenues(city).find(v => v.ageMin === 0 && !v.isBarOnly)!.id,
      });
      minorCoord.tick(startMs - 75 * MINUTE);
      minorCoord.handleInbound(m0.id, "I'm here wearing a red jacket!", startMs - 5 * MINUTE);
      if (minorRelaySent.length > 0) {
        invariants.teenRelayContact += minorRelaySent.length;
        invariants.minorContacts += minorRelaySent.length;
      }

      for (const minor of cityMinors) {
        minorsTested++;
        if (canBeMatched(minor.age)) {
          invariants.minorContacts++;
          invariants.teenAdultContact++;
        }

        // Date lane with adult -> MUST be blocked by groupAgeAllowed & lane check
        const minDay = earliestDayKeyOf(startMs);
        const maxDay = latestDayKeyOf(startMs + 2 * HOUR);
        const minorBirth = minDay - minor.age * 10000;
        const adultBirth = minDay - cityAdult.age * 10000;
        const gapAdultBirth = minDay - (minor.age + 4) * 10000;
        if (
          groupAgeAllowed(true, false, minDay, maxDay, [
            { adult: false, ready: true, birthKey: minorBirth },
            { adult: true, ready: true, birthKey: adultBirth },
          ])
        ) {
          invariants.teenLaneContact++;
          invariants.teenAdultContact++;
          invariants.minorContacts++;
        }
        if (
          groupAgeAllowed(true, true, minDay, maxDay, [
            { adult: false, ready: true, birthKey: minorBirth },
            { adult: false, ready: true, birthKey: gapAdultBirth },
          ])
        ) {
          invariants.teenGapContact++;
          invariants.minorContacts++;
        }
        if (
          groupAgeAllowed(true, true, minDay, maxDay, [
            { adult: false, ready: false, birthKey: minorBirth },
            { adult: false, ready: true, birthKey: minorBirth },
          ])
        ) {
          invariants.teenUnreadyContact++;
          invariants.minorContacts++;
        }
        if (teenRosterSizeAllowed(true, 7)) {
          invariants.teenGroupContact++;
          invariants.minorContacts++;
        }
        if (teenPlaceAllowed(true, true, true, false)) {
          invariants.teenPlaceContact++;
          invariants.minorContacts++;
        }

        // Arrival relay with minor -> MUST be false
        const arrOk = evaluateArrivalRelay({
          senderAge: minor.age,
          recipientAge: cityAdult.age,
          senderConfirmed: true,
          recipientConfirmed: true,
          blocked: false,
          senderOptedOut: false,
          recipientOptedOut: false,
          nowMs: startMs - 10 * MINUTE,
          startMs,
          alreadyMet: false,
          passedSafetyAndLeakCheck: true,
        });
        if (arrOk) {
          invariants.teenRelayContact++;
          invariants.minorContacts++;
        }

        // Work intro with minor -> MUST be NoChannel
        const workChan = selectWorkIntroChannel({
          candAge: minor.age,
          mgrAge: cityAdult.age,
          candOptedIn: true,
          mgrOptedIn: true,
          candHasEmail: true,
          mgrHasEmail: true,
          mutualSlotConfirmed: true,
          wantsVideo: true,
        });
        if (workChan !== "NoChannel") {
          invariants.teenLaneContact++;
          invariants.minorContacts++;
        }

        // Multi-person venue pick with a minor is fail-closed when teenFriendAllowed is omitted
        const failClosedVenues = vm.pickForMatch(
          { city, memberAreas: [minor.neighborhood, cityAdult.neighborhood], members: [toVenuePrefs(minor), toVenuePrefs(cityAdult)], startMs, mode: "date" },
          startMs - HOUR
        ).candidates;
        if (failClosedVenues.length === 0) failClosedSoloChecks++;

        // Solo single-player venues for minor -> non-empty, all-ages, non-bar, non-alcohol-centric, ageMin <= 13
        const soloVenues = vm.pickForMatch(
          { city, memberAreas: [minor.neighborhood], members: [toVenuePrefs(minor)], startMs, mode: "solo" },
          startMs - HOUR
        ).candidates;
        soloMinorChecks++;
        if (soloVenues.length > 0) soloVenuesNonEmpty++;
        for (const c of soloVenues) {
          if (
            c.venue.isBarOnly ||
            c.venue.isAlcoholCentric ||
            c.venue.allAges !== true ||
            !c.venue.alcoholOptional ||
            (c.venue.ageMin ?? 0) > 13 ||
            !c.venue.public ||
            (namedBreweries as readonly string[]).includes(c.venue.id)
          ) {
            invariants.minorBarRecs++;
            invariants.teenPlaceContact++;
            breweryExcludedOk = false;
          }
        }
      }

      t.push({
        atMs: startMs,
        atLabel: formatLocalTime(startMs, city),
        from: "Eliza",
        to: `${cityMinors.length} minors`,
        app: "ntwrk",
        text: `Verified ${cityMinors.length} minors (ages ${cityMinors.map(m => m.age).join(",")}) in ${city.toUpperCase()}: 0 matches, 0 relays, 0 work intros, 0 bar/21+/brewery solo venues, teenStop=on -> 0 contacts and pre-feature parity.`,
        tag: `minor_guard_${city}`,
      });
    }

    const teenGateSum =
      invariants.teenAdultContact +
      invariants.teenGapContact +
      invariants.teenLaneContact +
      invariants.teenUnreadyContact +
      invariants.teenSwitchOffContact +
      invariants.teenRelayContact +
      invariants.teenGroupContact +
      invariants.teenPlaceContact;

    const checks: ScenarioCheck[] = [
      {
        name: "all 15 minors across 5 cities have 0 matches, 0 relays, 0 work intros, and 0 stopped-switch contacts",
        pass: minorsTested === 15 && stoppedCityChecks === 5 && invariants.minorContacts === 0 && teenGateSum === 0,
        detail: `tested=${minorsTested}, contacts=${invariants.minorContacts}, teenGateSum=${teenGateSum}`,
      },
      {
        name: "solo single-player suggestions for minors are non-empty (fail-closed by default) with 0 bar/21+/brewery venues",
        pass: soloMinorChecks === 15 && soloVenuesNonEmpty === 15 && failClosedSoloChecks === 15 && invariants.minorBarRecs === 0,
        detail: `soloChecks=${soloMinorChecks}, nonEmpty=${soloVenuesNonEmpty}, failClosed=${failClosedSoloChecks}, barRecs=${invariants.minorBarRecs}`,
      },
      {
        name: "named breweries (sf-biergarten-hayes, sf-cellarmaker-mission, nyc-threes-brewing) never admitted for minors",
        pass: breweryExcludedOk,
        detail: `breweryExcludedOk=${breweryExcludedOk}`,
      },
      {
        name: "5-city teenStop=false vs teenStop=true yields 0 minor contacts when stopped and matches pre-feature reference",
        pass: teenOnCleanCities === 5 && teenParityCities === 5,
        detail: `teenOnCleanCities=${teenOnCleanCities}/5, teenParityCities=${teenParityCities}/5`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S15",
        "Unhappy: Minor Safety (13-17 across all 5 cities)",
        "multi",
        "ntwrk",
        "unhappy",
        checks,
        t,
        `${minorsTested} minors across 5 cities: 0 contacts, 0 relays, 0 bar/21+ recs, all teen gates 0`
      )
    );
  }

  // ============================================================================================
  // S16. Unhappy: STOP & Per-App `leave slop.date` through real ConsentNetwork + consent parser
  // ============================================================================================
  {
    const tz = CITY_TZ.sf;
    const startMs = fromLocal(2026, 11, 28, 15, tz);
    const m: FiveCityMember = { ...members.find(x => x.city === "sf" && !x.isMinor)!, id: "sf-s16-u", stoppedAll: false, leftApps: [] };
    const peer: FiveCityMember = { ...members.filter(x => x.city === "sf" && !x.isMinor)[1]!, id: "sf-s16-peer" };
    const knownApps = ["slop", "friends", "peon", "ntwrk"];

    const hSlop = new LiveConsentHarness({
      app: "slop",
      city: "sf",
      startMs: fromLocal(2026, 11, 27, 10, tz),
      networkOptions: { app: "slop", city: "sf", seed: 1161, inlineJudge: simulatedReviewJudge({ exceptions: false }), maxNewPerDay: 0, plans: false, engine: { cities: ["sf"] } },
    });
    const hFriends = new LiveConsentHarness({
      app: "friends",
      city: "sf",
      startMs: fromLocal(2026, 11, 27, 10, tz),
      networkOptions: { app: "friends", city: "sf", seed: 1162, inlineJudge: simulatedReviewJudge({ exceptions: false }), maxNewPerDay: 0, plans: false, engine: { cities: ["sf"] } },
    });
    hSlop.addMember(m, { romanceOptIn: true, quietHours: [23, 7] });
    hSlop.addMember(peer, { romanceOptIn: true, quietHours: [23, 7] });
    hFriends.addMember(m, { quietHours: [23, 7] });
    hFriends.addMember(peer, { quietHours: [23, 7] });
    await hSlop.onboard(m.id, peer.id);
    await hFriends.onboard(m.id, peer.id);

    // Part A: "leave slop.date" -> halts slop only, keeps friends active
    const leaveReading = parseOptOut("leave slop.date", { apps: knownApps });
    const leaveApp = leaveTarget("leave slop.date");
    const leaveKeyword = detectKeyword("leave slop.date");
    if (leaveApp === "slop") {
      m.leftApps.push("slop");
      await hSlop.say(m.id, "leave slop.date", "per_app_leave_slop", "STOP");
    }
    const optedOutFor = (app: AppId) => m.stoppedAll || m.leftApps.includes(app);
    const slopOptedOutAfterLeave = hSlop.net.memberList().find(x => x.id === m.id)?.optedOut === true;
    const friendsOptedOutAfterLeave = hFriends.net.memberList().find(x => x.id === m.id)?.optedOut === true;

    const slopFuAfterLeave = evaluateFollowupSend({ optedOut: optedOutFor("slop"), isQuietHours: false, dailyProactiveCount: 0, remindersSent: 0 });
    const slopRelayAfterLeave = evaluateArrivalRelay({ senderAge: peer.age, recipientAge: m.age, senderConfirmed: true, recipientConfirmed: true, blocked: false, senderOptedOut: false, recipientOptedOut: optedOutFor("slop"), nowMs: startMs - 10 * MINUTE, startMs, alreadyMet: false, passedSafetyAndLeakCheck: true });
    const friendsFuAfterLeave = evaluateFollowupSend({ optedOut: optedOutFor("friends"), isQuietHours: false, dailyProactiveCount: 0, remindersSent: 0 });
    const friendsRelayAfterLeave = evaluateArrivalRelay({ senderAge: peer.age, recipientAge: m.age, senderConfirmed: true, recipientConfirmed: true, blocked: false, senderOptedOut: false, recipientOptedOut: optedOutFor("friends"), nowMs: startMs - 10 * MINUTE, startMs, alreadyMet: false, passedSafetyAndLeakCheck: true });

    // Part B: "STOP" -> halts ALL apps
    const stopReading = parseOptOut("STOP", { apps: knownApps });
    const stopKeyword = detectKeyword("STOP");
    if (stopReading.match !== "none" && stopReading.scope === "all") {
      m.stoppedAll = true;
      await hFriends.say(m.id, "STOP", "stop_all_apps", "STOP");
    }
    const friendsOptedOutAfterStop = hFriends.net.memberList().find(x => x.id === m.id)?.optedOut === true;
    const slopAfterStop = evaluateFollowupSend({ optedOut: optedOutFor("slop"), isQuietHours: false, dailyProactiveCount: 0, remindersSent: 0 });
    const friendsAfterStop = evaluateFollowupSend({ optedOut: optedOutFor("friends"), isQuietHours: false, dailyProactiveCount: 0, remindersSent: 0 });
    const friendsRelayAfterStop = evaluateArrivalRelay({ senderAge: peer.age, recipientAge: m.age, senderConfirmed: true, recipientConfirmed: true, blocked: false, senderOptedOut: false, recipientOptedOut: optedOutFor("friends"), nowMs: startMs - 10 * MINUTE, startMs, alreadyMet: false, passedSafetyAndLeakCheck: true });

    invariants.canaryLeaks += hSlop.scanCanaries([m, peer]) + hFriends.scanCanaries([m, peer]);

    const checks: ScenarioCheck[] = [
      {
        name: "leave slop.date halts slop ConsentNetwork & relays while keeping friends active",
        pass:
          leaveReading.scope === "app" &&
          leaveApp === "slop" &&
          leaveKeyword === undefined &&
          slopOptedOutAfterLeave &&
          !friendsOptedOutAfterLeave &&
          !slopFuAfterLeave &&
          !slopRelayAfterLeave &&
          friendsFuAfterLeave &&
          friendsRelayAfterLeave,
        detail: `slopOptedOut=${slopOptedOutAfterLeave}, friendsOptedOut=${friendsOptedOutAfterLeave}, leaveApp=${leaveApp}`,
      },
      {
        name: "STOP halts all apps (ConsentNetwork opted_out + follow-ups & relays blocked)",
        pass:
          stopReading.match === "exact" &&
          stopReading.scope === "all" &&
          stopKeyword === "stop" &&
          friendsOptedOutAfterStop &&
          !slopAfterStop &&
          !friendsAfterStop &&
          !friendsRelayAfterStop,
        detail: `friendsOptedOut=${friendsOptedOutAfterStop}, stopKeyword=${stopKeyword}`,
      },
    ];
    scenarios.push(
      makeScenario(
        "S16",
        "Unhappy: STOP & Per-App leave slop.date",
        "sf",
        "ntwrk",
        "unhappy",
        checks,
        [...hSlop.transcript, ...hFriends.transcript],
        `leave slop.date isolated; STOP halted all apps`
      )
    );
  }

  return {
    seed,
    population,
    scenarios,
    passedScenarios: scenarios.filter(s => s.pass).length,
    totalScenarios: scenarios.length,
    invariants,
  };
}

export { formatTranscripts };

const isMain = process.argv[1]?.endsWith("fiveCitySuite.ts");
if (isMain) {
  const argv = process.argv.slice(2);
  const seedIdx = argv.indexOf("--seed");
  const seed = seedIdx >= 0 ? Number(argv[seedIdx + 1] ?? 42) : 42;
  const res = await runFiveCitySuite({ seed });
  if (argv.includes("--json")) {
    console.log(JSON.stringify(res, null, 2));
  } else if (argv.includes("--transcripts")) {
    console.log(formatTranscripts(res));
  } else {
    console.log(
      `five-city suite (seed=${res.seed}): ${res.passedScenarios}/${res.totalScenarios} scenarios pass | ` +
        `members=${res.population.totalMembers}, venues=${res.population.curatedVenues}, events=${res.population.impromptuEvents}`
    );
    for (const s of res.scenarios) {
      console.log(`  ${s.pass ? "PASS" : "FAIL"} ${s.id} ${s.title} — ${s.summary}`);
    }
  }
  process.exit(res.passedScenarios === res.totalScenarios ? 0 : 1);
}
