import type { AppId, BrandAppId, PersonaId } from "./types.ts";

export type CoreDesireLaneId =
  | "money_work"
  | "ideal_friends"
  | "soulmate_dating"
  | "elite_serendipity";

export type ExtensibleDesireLaneId =
  | "cofounder_venture"
  | "investors_patrons"
  | "mentorship_mastery"
  | "creative_collab"
  | "sport_wellness_crew"
  | "shared_living_home"
  | "travel_expedition"
  | "bespoke_irl_experience";

export type DesireLaneId = CoreDesireLaneId | ExtensibleDesireLaneId | (string & {});

export type DesireAirGapGroup =
  | "romance"
  | "economic_work"
  | "social_general"
  | "high_trust_curated";

export type DesireLaneStatus = "launch_core" | "extensible_ready" | "experimental";

export type DesireOutcomeMetric =
  | "first_date_confirmed"
  | "friend_hangout_attended"
  | "warm_intro_or_hire_accepted"
  | "salon_seat_completed"
  | "collab_or_crew_formed";

export interface DesireLaneSpec {
  readonly id: DesireLaneId;
  readonly label: string;
  readonly humanPromise: string;
  readonly launchStatus: DesireLaneStatus;
  readonly defaultAppId: BrandAppId;
  readonly compatibleAppIds: readonly BrandAppId[];
  readonly airGapGroup: DesireAirGapGroup;
  readonly minMemberAge: 13 | 18;
  readonly minPaidMarketingAge: 18;
  readonly teenEligible: boolean;
  readonly outcomeMetric: DesireOutcomeMetric;
  readonly t3OutcomeWeight: number;
  readonly pitchHook: string;
  readonly discoveryKeywords: readonly string[];
  readonly preferredAgentPersonas: readonly PersonaId[];
}

export class UnknownDesireLaneError extends Error {
  readonly code = "UNKNOWN_DESIRE_LANE" as const;
  readonly laneId: string;

  constructor(laneId: string) {
    super(`Unknown desire lane: "${laneId}". Register it via registerDesireLane() first.`);
    this.name = "UnknownDesireLaneError";
    this.laneId = laneId;
  }
}

export const CORE_DESIRE_LANES: readonly CoreDesireLaneId[] = [
  "money_work",
  "ideal_friends",
  "soulmate_dating",
  "elite_serendipity",
] as const;

export const EXTENSIBLE_DESIRE_LANES: readonly ExtensibleDesireLaneId[] = [
  "cofounder_venture",
  "investors_patrons",
  "mentorship_mastery",
  "creative_collab",
  "sport_wellness_crew",
  "shared_living_home",
  "travel_expedition",
  "bespoke_irl_experience",
] as const;

const BUILTIN_DESIRE_LANES: readonly DesireLaneSpec[] = [
  {
    id: "money_work",
    label: "Money & Work",
    humanPromise: "Warm introductions to roles, clients, contracts, and income breakthroughs without job-board black holes.",
    launchStatus: "launch_core",
    defaultAppId: "peon",
    compatibleAppIds: ["peon", "ntwrk"],
    airGapGroup: "economic_work",
    minMemberAge: 18,
    minPaidMarketingAge: 18,
    teenEligible: false,
    outcomeMetric: "warm_intro_or_hire_accepted",
    t3OutcomeWeight: 3.0,
    pitchHook: "Skip 300 ATS black holes—get one double-opt-in intro to the team actually hiring.",
    discoveryKeywords: [
      "hiring",
      "job",
      "career",
      "engineer",
      "developer",
      "freelance",
      "contract",
      "salary",
      "layoff",
      "builder",
      "staff engineer",
      "product manager",
      "recruiter",
    ],
    preferredAgentPersonas: ["peon", "operator"],
  },
  {
    id: "ideal_friends",
    label: "Ideal Friends",
    humanPromise: "Real neighborhood friends and 3+3 crews who actually show up for dinner, walks, and weekends.",
    launchStatus: "launch_core",
    defaultAppId: "friends",
    compatibleAppIds: ["friends", "ntwrk"],
    airGapGroup: "social_general",
    minMemberAge: 13,
    minPaidMarketingAge: 18,
    teenEligible: true,
    outcomeMetric: "friend_hangout_attended",
    t3OutcomeWeight: 2.5,
    pitchHook: "Stop saying 'we should hang soon'—meet 3 locals who actually show up Thursday night.",
    discoveryKeywords: [
      "friend",
      "friends",
      "meetup",
      "social club",
      "supper club",
      "book club",
      "trivia",
      "board game",
      "new in town",
      "new to",
      "hangout",
      "community",
    ],
    preferredAgentPersonas: ["venn"],
  },
  {
    id: "soulmate_dating",
    label: "Soulmate & Dating",
    humanPromise: "One high-signal, double-opt-in real-life date with someone who fits your actual life—zero swipe fatigue.",
    launchStatus: "launch_core",
    defaultAppId: "slop",
    compatibleAppIds: ["slop"],
    airGapGroup: "romance",
    minMemberAge: 18,
    minPaidMarketingAge: 18,
    teenEligible: false,
    outcomeMetric: "first_date_confirmed",
    t3OutcomeWeight: 3.0,
    pitchHook: "Delete the swipe slot machine—show up to one real drink when both sides say yes.",
    discoveryKeywords: [
      "dating",
      "single",
      "singles",
      "hinge",
      "bumble",
      "tinder",
      "matchmaker",
      "romance",
      "soulmate",
      "date night",
      "cocktail bar",
      "wine bar",
      "speakeasy",
    ],
    preferredAgentPersonas: ["sloane", "chadwick"],
  },
  {
    id: "elite_serendipity",
    label: "Elite Serendipity",
    humanPromise: "Quiet 6-seat off-the-record tables and high-trust two-hop introductions across extraordinary worlds.",
    launchStatus: "launch_core",
    defaultAppId: "ntwrk",
    compatibleAppIds: ["ntwrk"],
    airGapGroup: "high_trust_curated",
    minMemberAge: 18,
    minPaidMarketingAge: 18,
    teenEligible: false,
    outcomeMetric: "salon_seat_completed",
    t3OutcomeWeight: 3.5,
    pitchHook: "Skip $5,000 networking clubs—one reviewed text opens the right room.",
    discoveryKeywords: [
      "salon",
      "founder dinner",
      "member club",
      "curated",
      "polymath",
      "fellowship",
      "researcher",
      "professor",
      "executive",
      "philanthrop",
      "museum",
      "nonprofit",
    ],
    preferredAgentPersonas: ["operator"],
  },
  {
    id: "cofounder_venture",
    label: "Co-Founders & Venture",
    humanPromise: "Find a complementary technical or commercial co-founder to build something real together.",
    launchStatus: "extensible_ready",
    defaultAppId: "peon",
    compatibleAppIds: ["peon", "ntwrk"],
    airGapGroup: "economic_work",
    minMemberAge: 18,
    minPaidMarketingAge: 18,
    teenEligible: false,
    outcomeMetric: "warm_intro_or_hire_accepted",
    t3OutcomeWeight: 3.5,
    pitchHook: "Find the co-founder who ships at your speed before raising a dime.",
    discoveryKeywords: [
      "cofounder",
      "co-founder",
      "show hn",
      "hackathon",
      "yc",
      "startup",
      "stealth",
      "founding engineer",
      "ai agent",
      "open source",
    ],
    preferredAgentPersonas: ["peon", "operator"],
  },
  {
    id: "investors_patrons",
    label: "Investors & Patrons",
    humanPromise: "High-conviction angels, LPs, grants, and creative patrons matched by thesis rather than cold decks.",
    launchStatus: "extensible_ready",
    defaultAppId: "ntwrk",
    compatibleAppIds: ["ntwrk", "peon"],
    airGapGroup: "economic_work",
    minMemberAge: 18,
    minPaidMarketingAge: 18,
    teenEligible: false,
    outcomeMetric: "warm_intro_or_hire_accepted",
    t3OutcomeWeight: 4.0,
    pitchHook: "Warm thesis-aligned intros to builders and backers—zero pitch-slap theater.",
    discoveryKeywords: [
      "form d",
      "seed round",
      "series a",
      "angel investor",
      "venture capital",
      "vc",
      "grant",
      "patron",
      "endowment",
      "fund",
    ],
    preferredAgentPersonas: ["operator", "peon"],
  },
  {
    id: "mentorship_mastery",
    label: "Mentorship & Mastery",
    humanPromise: "Direct counsel from craft masters, operators, and scientists who have solved the exact hard problem ahead of you.",
    launchStatus: "extensible_ready",
    defaultAppId: "ntwrk",
    compatibleAppIds: ["ntwrk", "peon"],
    airGapGroup: "economic_work",
    minMemberAge: 18,
    minPaidMarketingAge: 18,
    teenEligible: false,
    outcomeMetric: "warm_intro_or_hire_accepted",
    t3OutcomeWeight: 3.0,
    pitchHook: "Learn in one hour of real conversation what takes five years alone.",
    discoveryKeywords: [
      "mentor",
      "mentorship",
      "apprentice",
      "advisor",
      "office hours",
      "arxiv",
      "clinical trial",
      "principal engineer",
      "fellow",
    ],
    preferredAgentPersonas: ["operator", "peon"],
  },
  {
    id: "creative_collab",
    label: "Creative Collaborators",
    humanPromise: "Connect filmmakers, musicians, designers, writers, and photographers who want to make work together.",
    launchStatus: "extensible_ready",
    defaultAppId: "friends",
    compatibleAppIds: ["friends", "ntwrk"],
    airGapGroup: "social_general",
    minMemberAge: 18,
    minPaidMarketingAge: 18,
    teenEligible: false,
    outcomeMetric: "collab_or_crew_formed",
    t3OutcomeWeight: 2.8,
    pitchHook: "Meet the director, musician, or designer your next project has been missing.",
    discoveryKeywords: [
      "filmmaker",
      "indie film",
      "musician",
      "studio",
      "gallery",
      "design",
      "creative director",
      "writer",
      "photographer",
      "jazz",
      "screening",
    ],
    preferredAgentPersonas: ["venn", "operator"],
  },
  {
    id: "sport_wellness_crew",
    label: "Sport & Wellness Crews",
    humanPromise: "Find recurring run clubs, climbing partners, tennis doubles, cyclists, and cold-plunge crews in your neighborhood.",
    launchStatus: "extensible_ready",
    defaultAppId: "friends",
    compatibleAppIds: ["friends"],
    airGapGroup: "social_general",
    minMemberAge: 13,
    minPaidMarketingAge: 18,
    teenEligible: true,
    outcomeMetric: "collab_or_crew_formed",
    t3OutcomeWeight: 2.5,
    pitchHook: "Never run, climb, or train solo when your pace-matched crew is four blocks away.",
    discoveryKeywords: [
      "run club",
      "running club",
      "marathon",
      "climbing",
      "bouldering",
      "pickleball",
      "tennis",
      "cycling",
      "yoga",
      "wellness",
      "sauna",
    ],
    preferredAgentPersonas: ["venn"],
  },
  {
    id: "shared_living_home",
    label: "Shared Living & Home",
    humanPromise: "Find high-trust roommates, creative lofts, and housemates who share your rhythm and standards.",
    launchStatus: "extensible_ready",
    defaultAppId: "friends",
    compatibleAppIds: ["friends", "ntwrk"],
    airGapGroup: "social_general",
    minMemberAge: 18,
    minPaidMarketingAge: 18,
    teenEligible: false,
    outcomeMetric: "collab_or_crew_formed",
    t3OutcomeWeight: 3.0,
    pitchHook: "Skip sketchy roommate listings—live with people vouched for by people you trust.",
    discoveryKeywords: [
      "roommate",
      "coliving",
      "housemate",
      "hacker house",
      "sublet",
      "loft",
      "shared studio",
    ],
    preferredAgentPersonas: ["venn", "operator"],
  },
  {
    id: "travel_expedition",
    label: "Travel & Expeditions",
    humanPromise: "Join vetted small crews for surf trips, ski cabins, cultural city-swaps, and international expeditions.",
    launchStatus: "extensible_ready",
    defaultAppId: "ntwrk",
    compatibleAppIds: ["ntwrk", "friends"],
    airGapGroup: "social_general",
    minMemberAge: 18,
    minPaidMarketingAge: 18,
    teenEligible: false,
    outcomeMetric: "collab_or_crew_formed",
    t3OutcomeWeight: 3.0,
    pitchHook: "Travel with a vetted crew who moves at your curiosity level.",
    discoveryKeywords: [
      "expedition",
      "ski trip",
      "surf trip",
      "trekking",
      "retreat",
      "city swap",
      "adventure club",
    ],
    preferredAgentPersonas: ["operator", "venn"],
  },
  {
    id: "bespoke_irl_experience",
    label: "Bespoke IRL Experiences",
    humanPromise: "Off-menu chef tables, private listening rooms, museum after-hours, and unforgettable local nights.",
    launchStatus: "extensible_ready",
    defaultAppId: "ntwrk",
    compatibleAppIds: ["ntwrk", "friends"],
    airGapGroup: "high_trust_curated",
    minMemberAge: 18,
    minPaidMarketingAge: 18,
    teenEligible: false,
    outcomeMetric: "salon_seat_completed",
    t3OutcomeWeight: 3.5,
    pitchHook: "Step inside the rooms, kitchens, and nights you cannot buy on an event app.",
    discoveryKeywords: [
      "michelin",
      "chef",
      "tasting menu",
      "listening bar",
      "vinyl",
      "private dinner",
      "hospitality",
      "sommelier",
      "after hours",
    ],
    preferredAgentPersonas: ["operator", "venn"],
  },
] as const;

const LANE_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,47}$/;

const registry = new Map<string, DesireLaneSpec>(
  BUILTIN_DESIRE_LANES.map((spec) => [spec.id, spec]),
);

export const DESIRE_LANE_REGISTRY: Readonly<Record<string, DesireLaneSpec>> =
  Object.fromEntries(BUILTIN_DESIRE_LANES.map((spec) => [spec.id, spec]));

export function listDesireLanes(opts?: {
  readonly status?: DesireLaneStatus;
  readonly appId?: BrandAppId;
  readonly teenEligibleOnly?: boolean;
}): readonly DesireLaneSpec[] {
  let out = Array.from(registry.values());
  if (opts?.status) {
    out = out.filter((lane) => lane.launchStatus === opts.status);
  }
  if (opts?.appId) {
    out = out.filter(
      (lane) => lane.defaultAppId === opts.appId || lane.compatibleAppIds.includes(opts.appId!),
    );
  }
  if (opts?.teenEligibleOnly) {
    out = out.filter((lane) => lane.teenEligible);
  }
  return out;
}

export function getDesireLane(id: string | null | undefined): DesireLaneSpec | undefined {
  if (!id) return undefined;
  return registry.get(id.trim().toLowerCase());
}

export function requireDesireLane(id: string): DesireLaneSpec {
  const normalized = id.trim().toLowerCase();
  const found = registry.get(normalized);
  if (!found) {
    throw new UnknownDesireLaneError(id);
  }
  return found;
}

export function registerDesireLane(spec: DesireLaneSpec): DesireLaneSpec {
  const normalizedId = spec.id.trim().toLowerCase();
  if (!LANE_SLUG_PATTERN.test(normalizedId)) {
    throw new Error(`Invalid desire lane slug: "${spec.id}"`);
  }
  if (spec.minPaidMarketingAge !== 18) {
    throw new Error("Paid marketing floor must always be 18 (inv_adult_only_paid).");
  }
  if (spec.airGapGroup === "romance" && spec.compatibleAppIds.includes("peon")) {
    throw new Error("Romance desire lanes cannot share data or routing with peon.biz.");
  }
  if (spec.teenEligible && (spec.airGapGroup === "romance" || spec.airGapGroup === "economic_work")) {
    throw new Error("Teen-eligible lanes must be strictly platonic social/friendship lanes.");
  }
  const normalized: DesireLaneSpec = { ...spec, id: normalizedId };
  registry.set(normalizedId, normalized);
  return normalized;
}

export function isDesireLanePaidAllowed(
  id: string,
  opts?: { readonly allowExtensible?: boolean },
): boolean {
  const spec = getDesireLane(id);
  if (!spec) return false;
  if (spec.launchStatus === "launch_core") return true;
  return Boolean(opts?.allowExtensible && spec.launchStatus === "extensible_ready");
}

export function defaultDesireLaneForApp(appId: AppId): CoreDesireLaneId {
  if (appId === "slop") return "soulmate_dating";
  if (appId === "peon") return "money_work";
  if (appId === "friends") return "ideal_friends";
  return "elite_serendipity";
}

export function canShareDesireData(laneA: string, laneB: string): boolean {
  const a = getDesireLane(laneA);
  const b = getDesireLane(laneB);
  if (!a || !b) return false;
  if (
    (a.airGapGroup === "romance" && b.airGapGroup === "economic_work") ||
    (b.airGapGroup === "romance" && a.airGapGroup === "economic_work")
  ) {
    return false;
  }
  return true;
}

export interface InferredDesireResult {
  readonly primaryDesireLane: DesireLaneId;
  readonly desireLanes: readonly DesireLaneId[];
  readonly defaultAppId: BrandAppId;
}

export function inferDesireLanesFromText(
  text: string,
  fallbackLane: DesireLaneId = "elite_serendipity",
): InferredDesireResult {
  const hay = text.toLowerCase();
  const scored: Array<{ spec: DesireLaneSpec; hits: number; coreBoost: number }> = [];

  for (const spec of registry.values()) {
    let hits = 0;
    for (const kw of spec.discoveryKeywords) {
      if (hay.includes(kw)) hits += 1;
    }
    if (hits > 0) {
      scored.push({
        spec,
        hits,
        coreBoost: spec.launchStatus === "launch_core" ? 1 : 0,
      });
    }
  }

  if (scored.length === 0) {
    const fb = getDesireLane(fallbackLane) ?? requireDesireLane("elite_serendipity");
    return {
      primaryDesireLane: fb.id,
      desireLanes: [fb.id],
      defaultAppId: fb.defaultAppId,
    };
  }

  scored.sort((a, b) => {
    if (b.hits !== a.hits) return b.hits - a.hits;
    if (b.coreBoost !== a.coreBoost) return b.coreBoost - a.coreBoost;
    return a.spec.id.localeCompare(b.spec.id);
  });

  const primary = scored[0].spec;
  const desireLanes = scored.slice(0, 3).map((item) => item.spec.id);
  return {
    primaryDesireLane: primary.id,
    desireLanes,
    defaultAppId: primary.defaultAppId,
  };
}
