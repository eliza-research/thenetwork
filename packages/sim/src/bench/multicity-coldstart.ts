import { parseArgs } from "node:util";
import {
  CITY_IDS,
  DAY,
  HOUR,
  Rng,
  canBeMatched,
  checkPublishExternalEvent,
  chooseFairMidpoint,
  computeExternalApprovalCap,
  estimateTravelMinutes,
  evaluateDensityTier,
  evaluateExternalSourcingTrigger,
  getCity,
  isMinor,
  registerCity,
  seedVenuesForCity,
  timeZoneOf,
  type City,
  type CitySpec,
  type VenueRecord,
} from "@thenetwork/core";
import { generatePersonas } from "../generator.ts";
import { Oracle } from "../oracle.ts";
import { ensurePersonaStrata } from "../persona.ts";
import { safeDiv } from "../stats.ts";

export interface CitySummary {
  city: string;
  tz: string;
  members: number;
  densityFriends: string;
  densitySlop: string;
  seedVenues: number;
  midpointArea: string;
  midpointMaxTravelMin: number;
}

export interface VenueSafetyReport {
  checkedProposals: number;
  redLineViolationsDetected: number;
  budgetViolationsDetected: number;
  backupPivotSuccesses: number;
  unbackedCancellations: number;
}

export interface ColdStartArmReport {
  arm: "direct_only" | "external_bridged";
  members: number;
  days: number;
  membersWithMeetup: number;
  meetupCoverage: number;
  day30Retained: number;
  day30RetentionRate: number;
  externalEventsPublished: number;
  externalAttendeesApproved: number;
  sourcingTriggered: number;
  convertedMembers: number;
  minorOrRedLineViolations: number;
}

export interface MulticityColdStartReport {
  seed: number;
  cities: CitySummary[];
  relocators: number;
  travelers: number;
  venueSafety: VenueSafetyReport;
  coldStart: {
    city: string;
    directOnly: ColdStartArmReport;
    externalBridged: ColdStartArmReport;
    retentionLift: number;
    coverageLift: number;
  };
}

function registerDynamicCities(): void {
  const extraCities: CitySpec[] = [
    {
      id: "london" as City,
      name: "London",
      shortName: "LDN",
      tz: "Europe/London",
      primaryMode: "transit",
      anchorZip: "W1D",
      aliases: ["london", "ldn"],
      center: { lat: 51.5074, lng: -0.1278 },
      dateMaxMinutes: 30,
      groupMaxMinutes: 40,
      kmPerMinute: 0.28,
      baseMinutes: 10,
      zones: [
        { id: "central", name: "Central London" },
        { id: "east", name: "East London" },
        { id: "south", name: "South London" },
      ],
      neighborhoods: [
        { name: "Soho", zone: "central", lat: 51.5136, lng: -0.1365, aliases: ["soho"], hubSupply: 10 },
        { name: "Shoreditch", zone: "east", lat: 51.5229, lng: -0.0777, aliases: ["shoreditch"], hubSupply: 9 },
        { name: "Clapham", zone: "south", lat: 51.4618, lng: -0.1384, aliases: ["clapham"], hubSupply: 7 },
        { name: "Kensington", zone: "central", lat: 51.4991, lng: -0.1938, aliases: ["kensington"], hubSupply: 8 },
      ],
      barriers: [],
      seedVenues: [],
    },
    {
      id: "austin" as City,
      name: "Austin",
      shortName: "ATX",
      tz: "America/Chicago",
      primaryMode: "car",
      anchorZip: "78701",
      aliases: ["austin", "atx"],
      center: { lat: 30.2672, lng: -97.7431 },
      dateMaxMinutes: 25,
      groupMaxMinutes: 35,
      kmPerMinute: 0.52,
      baseMinutes: 8,
      zones: [
        { id: "central", name: "Central Austin" },
        { id: "east", name: "East Austin" },
        { id: "south", name: "South Austin" },
      ],
      neighborhoods: [
        { name: "Downtown Austin", zone: "central", lat: 30.2672, lng: -97.7431, aliases: ["downtown"], hubSupply: 9 },
        { name: "East Austin", zone: "east", lat: 30.2633, lng: -97.7176, aliases: ["east"], hubSupply: 9 },
        { name: "South Congress", zone: "south", lat: 30.2494, lng: -97.7498, aliases: ["soco"], hubSupply: 8 },
        { name: "Zilker", zone: "south", lat: 30.2586, lng: -97.7729, aliases: ["zilker"], hubSupply: 7 },
      ],
      barriers: [],
      seedVenues: [],
    },
    {
      id: "sparse_launch" as City,
      name: "Sparse Launch City",
      shortName: "SLC",
      tz: "America/Denver",
      primaryMode: "car",
      anchorZip: "80202",
      aliases: ["sparse", "sparse_launch"],
      center: { lat: 39.7392, lng: -104.9903 },
      dateMaxMinutes: 25,
      groupMaxMinutes: 35,
      kmPerMinute: 0.45,
      baseMinutes: 8,
      zones: [
        { id: "core", name: "Core" },
        { id: "north", name: "North" },
      ],
      neighborhoods: [
        { name: "LoDo", zone: "core", lat: 39.7531, lng: -104.9994, aliases: ["lodo"], hubSupply: 8 },
        { name: "RiNo", zone: "north", lat: 39.7662, lng: -104.9822, aliases: ["rino"], hubSupply: 7 },
        { name: "Capitol Hill", zone: "core", lat: 39.7312, lng: -104.9828, aliases: ["cap hill"], hubSupply: 6 },
      ],
      barriers: [],
      seedVenues: [],
    },
  ];
  for (const spec of extraCities) {
    if (!getCity(spec.id)) registerCity(spec);
  }
}

function evaluateVenueSafety(seed: number): VenueSafetyReport {
  const worldStart = Date.UTC(2026, 10, 1, 18, 0, 0);
  const personas = generatePersonas({ n: 60, seed: seed + 101, cities: [...CITY_IDS] });
  const oracle = new Oracle(personas, seed + 101, worldStart, { logistics: true });
  let checkedProposals = 0;
  let redLineViolationsDetected = 0;
  let budgetViolationsDetected = 0;
  let backupPivotSuccesses = 0;
  let unbackedCancellations = 0;

  for (const city of CITY_IDS) {
    const venues = seedVenuesForCity(city);
    const locals = personas.filter(p => p.homeCity === city && canBeMatched(p.hidden.trueAge));
    if (locals.length < 2 || venues.length < 2) continue;
    const barVenue: VenueRecord = venues.find(v => v.isBarOnly || v.isAlcoholCentric) ?? {
      ...venues[0]!,
      id: `${city}-bar-probe`,
      isBarOnly: true,
      isAlcoholCentric: true,
      alcoholOptional: false,
      allAges: false,
      ageMin: 21,
    };
    const safeVenue = venues.find(v => !v.isBarOnly && !v.isAlcoholCentric && v.priceTier <= 1) ?? venues[0]!;
    const priceyVenue: VenueRecord = { ...safeVenue, id: `${city}-pricey-probe`, priceTier: 4 };

    const a = locals[0]!;
    const b = locals[1]!;
    const soberA = {
      ...a,
      id: `${a.id}-sober`,
      hidden: {
        ...a.hidden,
        boundaries: [...a.hidden.boundaries, "strict_sober"],
      },
    };
    oracle.addPersona(soberA);
    const vRed = oracle.evaluate({
      id: `rl-${city}`,
      kind: "intro",
      participants: [soberA.id, b.id],
      city,
      window: { start: worldStart + 2 * DAY, end: worldStart + 2 * DAY + 2 * HOUR },
      category: "social",
      venue: barVenue,
    });
    checkedProposals++;
    if (vRed.flags.includes("venue_red_line_violation")) redLineViolationsDetected++;

    const lowBudgetA = { ...a, id: `${a.id}-free` };
    const strataFree = ensurePersonaStrata(lowBudgetA, seed + 101);
    lowBudgetA.hidden = { ...lowBudgetA.hidden, ...strataFree, spendComfortTier: "free" };
    oracle.addPersona(lowBudgetA);
    const vBudget = oracle.evaluate({
      id: `bud-${city}`,
      kind: "intro",
      participants: [lowBudgetA.id, b.id],
      city,
      window: { start: worldStart + 3 * DAY, end: worldStart + 3 * DAY + 2 * HOUR },
      category: "social",
      venue: priceyVenue,
      venuePriceTier: 4,
    });
    checkedProposals++;
    if (vBudget.flags.includes("venue_budget_exceeded")) budgetViolationsDetected++;

    const vPivot = oracle.evaluate({
      id: `piv-${city}`,
      kind: "intro",
      participants: [a.id, b.id],
      city,
      window: { start: worldStart + 4 * DAY, end: worldStart + 4 * DAY + 2 * HOUR },
      category: "social",
      venue: venues[0]!,
      venueUnavailable: true,
      backupVenue: safeVenue,
    });
    checkedProposals++;
    if (vPivot.flags.includes("venue_backup_pivot")) backupPivotSuccesses++;

    const vCancel = oracle.evaluate({
      id: `can-${city}`,
      kind: "intro",
      participants: [a.id, b.id],
      city,
      window: { start: worldStart + 5 * DAY, end: worldStart + 5 * DAY + 2 * HOUR },
      category: "social",
      venue: venues[0]!,
      venueUnavailable: true,
    });
    checkedProposals++;
    if (vCancel.flags.includes("venue_cancelled") && vCancel.participants[a.id]!.showProb === 0) unbackedCancellations++;
  }

  return {
    checkedProposals,
    redLineViolationsDetected,
    budgetViolationsDetected,
    backupPivotSuccesses,
    unbackedCancellations,
  };
}

function simulateSparseColdStart(seed: number, bridged: boolean): ColdStartArmReport {
  const days = 30;
  const n = 30;
  const rng = new Rng(seed * 7919 + (bridged ? 17 : 3));
  const city = "sparse_launch" as City;
  const personas = generatePersonas({ n, seed: seed + 503, cities: [city], joinSpreadDays: 10 });
  const adults = personas.filter(p => canBeMatched(p.hidden.trueAge));
  const oracle = new Oracle(personas, seed + 503, Date.UTC(2026, 10, 1, 18, 0, 0), { logistics: true });
  const metSet = new Set<string>();
  const retained = new Set<string>(adults.map(p => p.id));
  let externalEventsPublished = 0;
  let externalAttendeesApproved = 0;
  let sourcingTriggered = 0;
  let convertedMembers = 0;
  let minorOrRedLineViolations = 0;

  for (let week = 0; week < 4; week++) {
    const active = adults.filter(p => p.joinDay <= week * 7 && retained.has(p.id));
    const matchedThisWeek = new Set<string>();

    for (let i = 0; i < active.length; i++) {
      const a = active[i]!;
      if (matchedThisWeek.has(a.id)) continue;
      let bestIdx = -1;
      let bestScore = 0;
      let eligiblePairs = 0;
      for (let j = i + 1; j < active.length; j++) {
        const b = active[j]!;
        if (matchedThisWeek.has(b.id)) continue;
        const pe = oracle.pairEnjoyment(a, b, "social");
        if (pe.e >= 0.58) {
          eligiblePairs++;
          if (pe.e > bestScore) {
            bestScore = pe.e;
            bestIdx = j;
          }
        }
      }
      if (bestIdx >= 0) {
        const b = active[bestIdx]!;
        matchedThisWeek.add(a.id);
        matchedThisWeek.add(b.id);
        if (rng.bool(0.65)) {
          metSet.add(a.id);
          metSet.add(b.id);
        }
      } else if (bridged) {
        const trigger = evaluateExternalSourcingTrigger({
          eligibleLocalPairs: eligiblePairs,
          topScoreScaled: Math.round(bestScore * 100),
          strongThresholdScaled: 65,
          memberAge: a.hidden.trueAge,
          memberOptedInRomance: a.hidden.romance.optIn,
          memberPaused: false,
          memberOptedOut: false,
          memberTrustOk: !a.hidden.adversarial,
          memberStageReady: true,
          memberExternalScoutOptIn: true,
          activeSourcingTickets: 0,
        });
        if (trigger && rng.bool(0.55)) {
          sourcingTriggered++;
          if (isMinor(a.hidden.trueAge)) minorOrRedLineViolations++;
          matchedThisWeek.add(a.id);
          if (rng.bool(0.68)) {
            metSet.add(a.id);
            if (rng.bool(0.32)) convertedMembers++;
          }
        }
      }
    }

    if (bridged && active.length >= 2) {
      const unmatched = active.filter(p => !matchedThisWeek.has(p.id));
      if (unmatched.length >= 2) {
        const anchors = unmatched.slice(0, Math.min(3, unmatched.length));
        const publish = checkPublishExternalEvent({
          id: `ext-w${week}`,
          city,
          platform: "luma",
          source: "host_native",
          title: "LoDo Coffee & Makers Table",
          interest: "coffee",
          description: "Small local table at a public cafe.",
          venueName: "LoDo Public Roasters",
          venueAddress: "1600 Wynkoop St, Denver",
          arrivalLandmark: "front patio",
          isPublicVenue: true,
          venueWalkInCapacity: 12,
          startIso: "2026-11-10T18:00:00Z",
          endIso: "2026-11-10T20:00:00Z",
          timezone: "America/Denver",
          anchorFirstName: anchors[0]!.name,
          confirmedNetworkAnchors: 1,
          confirmedNetworkTotal: anchors.length,
          targetRoomSize: 6,
          reviewApproved: true,
          allParticipantsAdult: anchors.every(x => canBeMatched(x.hidden.trueAge)),
          hideGuestList: true,
          approvalRequired: true,
          externalCrowdDisclosed: true,
        });
        if (publish.allowed) {
          externalEventsPublished++;
          const cap = computeExternalApprovalCap(anchors.length, 12, 6);
          const approved = Math.min(cap, rng.int(2, Math.max(2, cap)));
          externalAttendeesApproved += approved;
          for (const anc of anchors) {
            metSet.add(anc.id);
            matchedThisWeek.add(anc.id);
          }
          for (let k = 0; k < approved; k++) {
            if (rng.bool(0.28)) convertedMembers++;
          }
        }
      }
    }

    for (const p of active) {
      const churnProb = metSet.has(p.id) ? 0.05 : 0.28;
      if (rng.bool(churnProb)) retained.delete(p.id);
    }
  }

  return {
    arm: bridged ? "external_bridged" : "direct_only",
    members: adults.length,
    days,
    membersWithMeetup: metSet.size,
    meetupCoverage: Number(safeDiv(metSet.size, adults.length).toFixed(3)),
    day30Retained: retained.size,
    day30RetentionRate: Number(safeDiv(retained.size, adults.length).toFixed(3)),
    externalEventsPublished,
    externalAttendeesApproved,
    sourcingTriggered,
    convertedMembers,
    minorOrRedLineViolations,
  };
}

export function runMulticityColdStartBenchmark(seed = 1): MulticityColdStartReport {
  registerDynamicCities();
  const allCities: City[] = [...CITY_IDS, "london" as City, "austin" as City, "sparse_launch" as City];
  const personas = generatePersonas({ n: 320, seed, cities: allCities });

  const cities: CitySummary[] = allCities.map(city => {
    const locals = personas.filter(p => p.homeCity === city);
    const spec = getCity(city);
    const areas = locals.slice(0, 6).map(p => p.routine.homeArea);
    const midpoint = areas.length > 0 && spec ? chooseFairMidpoint(city, areas, "group") : undefined;
    const sampleTravel = spec && spec.neighborhoods.length >= 2
      ? estimateTravelMinutes(city, spec.neighborhoods[0]!.name, spec.neighborhoods[1]!.name)
      : 0;
    return {
      city,
      tz: timeZoneOf(city),
      members: locals.length,
      densityFriends: evaluateDensityTier("friends", locals.length),
      densitySlop: evaluateDensityTier("slop", locals.length),
      seedVenues: spec ? spec.seedVenues.length : 0,
      midpointArea: midpoint?.neighborhood.name ?? spec?.neighborhoods[0]?.name ?? "unknown",
      midpointMaxTravelMin: midpoint?.maxMinutes ?? sampleTravel,
    };
  });

  let relocators = 0;
  let travelers = 0;
  for (const p of personas) {
    const strata = ensurePersonaStrata(p, seed);
    if (strata.activeTransitions.includes("relocated") || p.archetype === "newcomer") relocators++;
    if (p.hidden.trips.length > 0 || p.archetype === "traveler") travelers++;
  }

  const venueSafety = evaluateVenueSafety(seed);
  const directOnly = simulateSparseColdStart(seed, false);
  const externalBridged = simulateSparseColdStart(seed, true);

  return {
    seed,
    cities,
    relocators,
    travelers,
    venueSafety,
    coldStart: {
      city: "sparse_launch",
      directOnly,
      externalBridged,
      retentionLift: Number((externalBridged.day30RetentionRate - directOnly.day30RetentionRate).toFixed(3)),
      coverageLift: Number((externalBridged.meetupCoverage - directOnly.meetupCoverage).toFixed(3)),
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      seed: { type: "string", default: "1" },
      json: { type: "boolean", default: false },
    },
  });
  const report = runMulticityColdStartBenchmark(Number(values.seed));
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Multi-City & Cold-Start Benchmark (seed=${report.seed})`);
    for (const c of report.cities) {
      console.log(
        `  ${c.city.padEnd(14)} tz=${c.tz.padEnd(20)} n=${String(c.members).padStart(2)} `
        + `friends=${c.densityFriends.padEnd(6)} slop=${c.densitySlop.padEnd(6)} `
        + `venues=${String(c.seedVenues).padStart(2)} mid=${c.midpointArea} (${c.midpointMaxTravelMin}m)`,
      );
    }
    console.log(
      `  Venue safety: checked=${report.venueSafety.checkedProposals} `
      + `redLines=${report.venueSafety.redLineViolationsDetected} `
      + `budget=${report.venueSafety.budgetViolationsDetected} `
      + `pivots=${report.venueSafety.backupPivotSuccesses} `
      + `cancels=${report.venueSafety.unbackedCancellations}`,
    );
    const cs = report.coldStart;
    console.log(
      `  Cold-start (${cs.city}, n=${cs.directOnly.members}): `
      + `direct retention=${(cs.directOnly.day30RetentionRate * 100).toFixed(1)}% coverage=${(cs.directOnly.meetupCoverage * 100).toFixed(1)}% | `
      + `bridged retention=${(cs.externalBridged.day30RetentionRate * 100).toFixed(1)}% coverage=${(cs.externalBridged.meetupCoverage * 100).toFixed(1)}% `
      + `(lift +${(cs.retentionLift * 100).toFixed(1)}pp ret, +${(cs.coverageLift * 100).toFixed(1)}pp cov, `
      + `extEvents=${cs.externalBridged.externalEventsPublished}, converted=${cs.externalBridged.convertedMembers}, violations=${cs.externalBridged.minorOrRedLineViolations})`,
    );
  }
}
