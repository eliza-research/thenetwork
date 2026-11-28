import type { AppId, Category } from "../types.ts";

export const CORE_INTENT_LANES = [
  "money_work",
  "ideal_friends",
  "soulmate_dating",
  "elite_serendipity",
] as const;

export const EXTENSIBLE_INTENT_LANES = [
  "cofounder_venture",
  "investors_patrons",
  "mentorship_mastery",
  "creative_collab",
  "sport_wellness_crew",
  "shared_living_home",
  "travel_expedition",
  "bespoke_irl_experience",
] as const;

export type CoreIntentLaneId = (typeof CORE_INTENT_LANES)[number];
export type ExtensibleIntentLaneId = (typeof EXTENSIBLE_INTENT_LANES)[number];
export type AnalyticsDesireLaneId = CoreIntentLaneId | ExtensibleIntentLaneId;

export interface IntentTaxonomyEntry {
  readonly id: AnalyticsDesireLaneId;
  readonly label: string;
  readonly defaultAppId: AppId;
  readonly compatibleApps: readonly AppId[];
  readonly networkCategories: readonly Category[];
  readonly teenEligible: boolean;
  readonly minPaidMarketingAge: 18;
  readonly subTags: readonly string[];
  readonly keywords: readonly string[];
}

export const INTENT_TAXONOMY: readonly IntentTaxonomyEntry[] = [
  {
    id: "money_work",
    label: "Money & Work",
    defaultAppId: "peon",
    compatibleApps: ["peon", "ntwrk"],
    networkCategories: ["professional", "growth"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["job_search", "hiring_talent", "freelance_clients", "contract_work", "career_switch"],
    keywords: ["job", "hiring", "career", "engineer", "freelance", "contract", "salary", "recruiter", "client"],
  },
  {
    id: "ideal_friends",
    label: "Ideal Friends",
    defaultAppId: "friends",
    compatibleApps: ["friends", "ntwrk"],
    networkCategories: ["social", "hobby", "events", "help"],
    teenEligible: true,
    minPaidMarketingAge: 18,
    subTags: ["new_in_city", "dinner_crew_3x3", "weekend_hangout", "board_games", "quiet_1on1"],
    keywords: ["friend", "friends", "hangout", "meetup", "new in town", "supper club", "trivia", "board game"],
  },
  {
    id: "soulmate_dating",
    label: "Soulmate & Dating",
    defaultAppId: "slop",
    compatibleApps: ["slop"],
    networkCategories: ["romance"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["serious_relationship", "casual_dates", "shared_values_match", "first_drink"],
    keywords: ["dating", "date", "romance", "soulmate", "single", "partner", "relationship"],
  },
  {
    id: "elite_serendipity",
    label: "Elite Serendipity",
    defaultAppId: "ntwrk",
    compatibleApps: ["ntwrk"],
    networkCategories: ["social", "events", "professional"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["salon_6_seat", "founder_dinner", "polymath_exchange", "curated_room"],
    keywords: ["salon", "founder dinner", "curated", "polymath", "fellowship", "executive", "serendipity"],
  },
  {
    id: "cofounder_venture",
    label: "Co-Founders & Venture",
    defaultAppId: "peon",
    compatibleApps: ["peon", "ntwrk"],
    networkCategories: ["professional", "growth"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["technical_cofounder", "commercial_cofounder", "founding_engineer", "hackathon_team"],
    keywords: ["cofounder", "co-founder", "startup", "stealth", "founding engineer", "venture", "hackathon"],
  },
  {
    id: "investors_patrons",
    label: "Investors & Patrons",
    defaultAppId: "ntwrk",
    compatibleApps: ["ntwrk", "peon"],
    networkCategories: ["professional"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["angel_investor", "seed_round", "grant_patron", "lp_intro"],
    keywords: ["investor", "angel", "seed", "fundraise", "lp", "grant", "patron", "capital"],
  },
  {
    id: "mentorship_mastery",
    label: "Mentorship & Mastery",
    defaultAppId: "ntwrk",
    compatibleApps: ["ntwrk", "peon", "friends"],
    networkCategories: ["growth", "help", "professional"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["domain_mentor", "peer_study_group", "skill_exchange", "career_advisor"],
    keywords: ["mentor", "mentorship", "coach", "advisor", "learn", "mastery", "study"],
  },
  {
    id: "creative_collab",
    label: "Creative Collaboration",
    defaultAppId: "friends",
    compatibleApps: ["friends", "ntwrk", "peon"],
    networkCategories: ["hobby", "social", "professional"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["film_video_crew", "music_jam", "writing_circle", "design_collab"],
    keywords: ["film", "music", "art", "design", "podcast", "writer", "creative", "studio", "collab"],
  },
  {
    id: "sport_wellness_crew",
    label: "Sport & Wellness Crew",
    defaultAppId: "friends",
    compatibleApps: ["friends", "ntwrk"],
    networkCategories: ["hobby", "social"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["running_club", "climbing_partner", "tennis_pickleball", "cycling_group"],
    keywords: ["run", "running", "climbing", "bouldering", "tennis", "pickleball", "cycling", "gym", "yoga", "hike"],
  },
  {
    id: "shared_living_home",
    label: "Shared Living & Home",
    defaultAppId: "friends",
    compatibleApps: ["friends", "ntwrk"],
    networkCategories: ["help", "social"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["roommate_match", "coliving_house", "sublet_trust"],
    keywords: ["roommate", "apartment", "lease", "coliving", "housing", "sublet"],
  },
  {
    id: "travel_expedition",
    label: "Travel & Expeditions",
    defaultAppId: "friends",
    compatibleApps: ["friends", "ntwrk"],
    networkCategories: ["events", "social", "hobby"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["weekend_trip", "ski_surf_crew", "remote_work_trip"],
    keywords: ["travel", "trip", "expedition", "ski", "surf", "camp", "backpacking"],
  },
  {
    id: "bespoke_irl_experience",
    label: "Bespoke IRL Experiences",
    defaultAppId: "ntwrk",
    compatibleApps: ["ntwrk", "friends"],
    networkCategories: ["events", "social"],
    teenEligible: false,
    minPaidMarketingAge: 18,
    subTags: ["private_tasting", "gallery_night", "secret_supper"],
    keywords: ["tasting", "gallery", "concert", "theatre", "museum", "experience", "private event"],
  },
] as const;

const TAXONOMY_BY_ID = new Map<string, IntentTaxonomyEntry>(INTENT_TAXONOMY.map(entry => [entry.id, entry]));

export function getIntentTaxonomy(laneId: string): IntentTaxonomyEntry | undefined {
  return TAXONOMY_BY_ID.get(laneId);
}

export function isKnownDesireLane(laneId: string): laneId is AnalyticsDesireLaneId {
  return TAXONOMY_BY_ID.has(laneId);
}

export function resolveDesireLane(input: {
  appId?: AppId;
  category?: Category | string;
  desireId?: string;
  objective?: string;
}): AnalyticsDesireLaneId {
  if (input.desireId && TAXONOMY_BY_ID.has(input.desireId)) {
    return input.desireId as AnalyticsDesireLaneId;
  }
  const text = `${input.objective ?? ""} ${input.desireId ?? ""}`.toLowerCase();
  if (text.trim().length > 0) {
    let best: { id: AnalyticsDesireLaneId; score: number } | undefined;
    for (const entry of INTENT_TAXONOMY) {
      let score = 0;
      for (const kw of entry.keywords) {
        if (text.includes(kw)) score += kw.includes(" ") ? 3 : 2;
      }
      if (input.appId && entry.compatibleApps.includes(input.appId)) score += 0.5;
      if (score >= 2 && (!best || score > best.score)) {
        best = { id: entry.id, score };
      }
    }
    if (best) return best.id;
  }
  if (input.category === "romance" || input.appId === "slop") return "soulmate_dating";
  if (input.category === "professional" || input.appId === "peon") return "money_work";
  if (input.appId === "friends") return "ideal_friends";
  if (input.category === "events" || input.appId === "ntwrk") return "elite_serendipity";
  return "ideal_friends";
}

export function computeUnfulfilledDemandRatio(openRequests7d: number, fulfilledProposals7d: number): number {
  const open = Math.max(0, openRequests7d);
  const fulfilled = Math.max(1, fulfilledProposals7d);
  return Number((open / fulfilled).toFixed(3));
}

export interface IntentDemandSignal {
  appId: AppId;
  city: string;
  desireLane: AnalyticsDesireLaneId;
  openRequests7d: number;
  fulfilledProposals7d: number;
  unfulfilledDemandRatio: number;
  teenEligible: boolean;
}

export function summarizeIntentDemand(
  requests: readonly { appId: AppId; city: string; category?: Category | string; desireId?: string; objective?: string; fulfilled: boolean }[],
): IntentDemandSignal[] {
  const buckets = new Map<string, { appId: AppId; city: string; desireLane: AnalyticsDesireLaneId; open: number; fulfilled: number }>();
  for (const req of requests) {
    const desireLane = resolveDesireLane(req);
    const key = `${req.appId}:${req.city}:${desireLane}`;
    const bucket = buckets.get(key) ?? { appId: req.appId, city: req.city, desireLane, open: 0, fulfilled: 0 };
    if (req.fulfilled) bucket.fulfilled += 1;
    else bucket.open += 1;
    buckets.set(key, bucket);
  }
  return [...buckets.values()]
    .map(b => ({
      appId: b.appId,
      city: b.city,
      desireLane: b.desireLane,
      openRequests7d: b.open,
      fulfilledProposals7d: b.fulfilled,
      unfulfilledDemandRatio: computeUnfulfilledDemandRatio(b.open, b.fulfilled),
      teenEligible: TAXONOMY_BY_ID.get(b.desireLane)?.teenEligible ?? false,
    }))
    .sort((a, b) => b.unfulfilledDemandRatio - a.unfulfilledDemandRatio || a.city.localeCompare(b.city));
}
