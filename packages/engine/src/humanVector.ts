import type { AppId, Facet, Intent, MemberId, PrivacyScope, Provenance, SourceKind } from "@thenetwork/core";
import { ADULT_AGE, canBeMatched, findNeighborhood, getCity, isBusinessDomain, isDatingDomain } from "@thenetwork/core";
import { centroid } from "./embed.ts";
import { hood } from "./packs/friendship/geo.ts";
import { parseOntologyTags } from "./packs/network/ontology.ts";
import { connectionTypeForIntent, detailTags, isHypePitchIntent, objectivesFor } from "./packs/network/taxonomy.ts";
import {
  CONNECTION_ONTOLOGY_SPECS,
  interestClusterByTag,
  LANGUAGE_CODES,
  skillDefByTag,
  type ConnectionOntologyType,
  type HumorRegister,
  type LifeStage,
  type SpendComfortTier,
} from "./packs/network/vocabulary.ts";
import { isBusinessProxyTag, stripBusinessTag } from "./packs/business/schema.ts";
import { parseAppearance, type BodyType } from "./packs/dating/appearance.ts";
import { latLonToHex } from "./spatialIndex.ts";
import type { MemberIndex, World } from "./world.ts";

export type { ConnectionOntologyType, HumorRegister, LifeStage, SpendComfortTier };

export function vectorEligible(age: number, adultMin = ADULT_AGE): boolean {
  if (!canBeMatched(age)) return false;
  if (!(age >= ADULT_AGE)) return false;
  if (!(age >= adultMin)) return false;
  return true;
}

export function aestheticReadAllowed(isDating: boolean, age: number, adultMin = ADULT_AGE): boolean {
  if (!isDating) return false;
  return vectorEligible(age, adultMin);
}

export function businessCapitalAllowed(dimKind: string): boolean {
  return dimKind === "domain_craft" || dimKind === "verified_skill" || dimKind === "seniority" || dimKind === "work_style";
}
export const peonCapitalAllowed = businessCapitalAllowed;

export function discretionGateOk(
  targetPublicity: number,
  targetEcon: number,
  candidateDiscretion: number,
  candidateExtractionRisk: number,
  sharedGuildOptIn: boolean,
): boolean {
  if (!(candidateExtractionRisk <= 65)) return false;
  if (targetEcon >= 90 || targetPublicity >= 65) {
    if (!(candidateExtractionRisk <= 20)) return false;
    const minDiscretion = sharedGuildOptIn ? 65 : 85;
    if (!(candidateDiscretion >= minDiscretion)) return false;
  }
  return true;
}

export function stepAheadDeltaOk(
  seekerRung: number,
  mentorRung: number,
  minDelta = 1.0,
  maxDelta = 2.5,
): boolean {
  if (!(minDelta > 0)) return false;
  if (!(maxDelta >= minDelta)) return false;
  if (!(maxDelta <= 3)) return false;
  const delta = mentorRung - seekerRung;
  if (!(delta >= minDelta)) return false;
  if (!(delta <= maxDelta)) return false;
  return true;
}

export function spendTierRank(tier: SpendComfortTier): number {
  if (tier === "free") return 0;
  if (tier === "low") return 1;
  if (tier === "moderate") return 2;
  if (tier === "high") return 3;
  return 4;
}

export function spendTierCompatible(
  tierA: SpendComfortTier,
  tierB: SpendComfortTier,
  isFreeAnchor: boolean,
): boolean {
  if (isFreeAnchor) return true;
  const rA = spendTierRank(tierA);
  const rB = spendTierRank(tierB);
  const diff = rA >= rB ? rA - rB : rB - rA;
  if (rA <= 1 || rB <= 1) return diff <= 1;
  return diff <= 2;
}

export function venueCostFitsTier(tier: SpendComfortTier, costTier: number): boolean {
  if (!(costTier >= 0)) return false;
  if (tier === "free") return costTier <= 0;
  if (tier === "low") return costTier <= 1;
  if (tier === "moderate") return costTier <= 3;
  return true;
}

export function parentSupportSafe(
  ageA: number,
  ageB: number,
  adultMin: number,
  involvesMinorChild: boolean,
): boolean {
  if (involvesMinorChild) return false;
  return vectorEligible(ageA, adultMin) && vectorEligible(ageB, adultMin);
}

export type CrossCapitalOpenness =
  | "patronage"
  | "step_ahead_mentoring"
  | "mixed_ses_craft_guild"
  | "local_mutual_aid";

export interface ScoredCoordinate {
  value: number;
  confidence: number;
  provenance: Provenance;
  sources: SourceKind[];
  observedAt: number;
  scope: PrivacyScope;
  appWall?: AppId;
}

export interface CapitalProfile {
  economic: ScoredCoordinate;
  cultural: {
    embodied: ScoredCoordinate;
    institutionalized: ScoredCoordinate;
    omnivorousness: ScoredCoordinate;
  };
  social: {
    vouchQuality: ScoredCoordinate;
    brokerage: ScoredCoordinate;
    warmGraphDegree: number;
  };
  symbolic: {
    publicityTier: ScoredCoordinate;
    peerPrestige: ScoredCoordinate;
  };
  domainRungs: Record<string, ScoredCoordinate>;
  aestheticSlopOnly?: {
    face: ScoredCoordinate;
    body: ScoredCoordinate;
    overall: ScoredCoordinate;
    bodyType?: BodyType;
    appWall: "slop";
    scope: "agent_private";
  };
}

export interface HorizontalProfile {
  embeddings: {
    interestsAndTaste: number[];
    worldviewAndValues: number[];
    conversationalStyle: number[];
  };
  lifeStage: LifeStage;
  activeTransitions: string[];
  communication: {
    depthPreference: ScoredCoordinate;
    humorRegister: HumorRegister[];
    extroversion: ScoredCoordinate;
    initiatorScore: ScoredCoordinate;
    attachmentSecurity?: ScoredCoordinate;
  };
  lifestyle: {
    spendComfortTier: SpendComfortTier;
    fitnessIntensity: ScoredCoordinate;
    substanceProfile: { alcohol: "none" | "light" | "social" | "heavy"; soberProtected?: boolean };
    spontaneity: ScoredCoordinate;
    workIntensity?: ScoredCoordinate;
  };
  geoAndTime: {
    homeH3: string;
    maxTravelMinutes: number;
    transitMode: "walk" | "transit" | "car" | "flexible_flight";
    weeklySlotBitmap: number[];
  };
}

export interface ExchangeSlot {
  id: string;
  connectionType: ConnectionOntologyType;
  direction: "seeks" | "offers" | "mutual_pool";
  roleTag: string;
  domain: string;
  targetRungDelta: [number, number];
  urgency: "now" | "this_month" | "evergreen";
  format: "one_to_one" | "small_group" | "recurring_pod" | "event_anchor";
  cadence: "one_off" | "weekly" | "biweekly" | "monthly";
  scope: PrivacyScope;
}

export interface ExchangeProfile {
  slots: ExchangeSlot[];
  crossCapitalOpenness: CrossCapitalOpenness[];
  nativeLanguages: string[];
  learningLanguages: string[];
  guilds: string[];
}

export interface BehavioralProfile {
  showUpRate: number;
  responseLatencyMedianHrs: number;
  reciprocalApprovalRate: number;
  discretionVouchScore: number;
  extractionRiskScore: number;
  dunbarSaturation: {
    inner5Open: boolean;
    sympathy15Open: boolean;
    affinity50Open: boolean;
  };
  revealedTasteVector?: number[];
}

export interface ExplicitSignalFlags {
  readonly lifeStage: boolean;
  readonly spendTier: boolean;
  readonly humor: boolean;
  readonly depth: boolean;
  readonly transitions: boolean;
  readonly guilds: boolean;
  readonly languages: boolean;
  readonly domainRungs: boolean;
  readonly hypeOrExtraction: boolean;
  readonly reliabilityPenalty: boolean;
}

export interface HumanVector {
  memberId: MemberId;
  age: number;
  capital: CapitalProfile;
  horizontal: HorizontalProfile;
  exchange: ExchangeProfile;
  behavioral: BehavioralProfile;
  facetRefs: Facet["id"][];
  explicitSignals: ExplicitSignalFlags;
}

export type EmptyStateStage =
  | "single_player_concierge"
  | "readiness_coaching"
  | "widen_constraints"
  | "shared_purpose_guild";

export type EmptyStateRemedyKind =
  | "local_public_events"
  | "clarify_intent"
  | "enrich_facets"
  | "widen_radius_or_schedule"
  | "step_ahead_recalibrate"
  | "free_local_guild_bridge"
  | "wait_budget_cooldown";

export interface EmptyStateRemedy {
  readonly intentId: string;
  readonly memberId: MemberId;
  readonly engineReason: string;
  readonly stage: EmptyStateStage;
  readonly remedyKind: EmptyStateRemedyKind;
  readonly connectionType: ConnectionOntologyType;
  readonly diagnosticCodes: readonly string[];
  readonly involvesOtherMembers: false;
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const clampRung = (x: number) => Math.max(0, Math.min(10, Number.isFinite(x) ? x : 0));

function makeCoord(
  value: number,
  confidence: number,
  now: number,
  provenance: Provenance = "inferred",
  scope: PrivacyScope = "agent_private",
  sources: SourceKind[] = [],
  appWall?: AppId,
): ScoredCoordinate {
  return {
    value,
    confidence: clamp01(confidence),
    provenance,
    sources,
    observedAt: now,
    scope,
    ...(appWall ? { appWall } : {}),
  };
}

interface WorldVectorCache {
  readonly w: World;
  readonly adultMin: number;
  readonly isDating: boolean;
  readonly isBusiness: boolean;
  readonly allFacetsBy: Map<MemberId, Facet[]>;
  readonly fbStats: Map<MemberId, { pos: number; neg: number; explicitNeg: number; total: number }>;
  readonly attStats: Map<MemberId, { completed: number; noShow: number; resolved: number }>;
  readonly brokerage: Map<MemberId, number>;
  readonly vouchQuality: Map<MemberId, number>;
  readonly byMember: Map<MemberId, HumanVector | null>;
  adultsOnly?: Map<MemberId, HumanVector>;
}

const worldCache = new WeakMap<World, WorldVectorCache>();

function getOrCompileMember(cache: WorldVectorCache, id: MemberId): HumanVector | null {
  if (cache.byMember.has(id)) return cache.byMember.get(id) ?? null;
  const mi = cache.w.get(id);
  if (!mi || cache.w.minors.has(id) || !vectorEligible(mi.m.age, cache.adultMin)) {
    cache.byMember.set(id, null);
    return null;
  }
  const vec = compileAdultVector(
    cache.w,
    mi,
    cache.allFacetsBy.get(id) ?? [],
    cache.fbStats.get(id),
    cache.attStats.get(id),
    cache.brokerage.get(id) ?? 0.2,
    cache.vouchQuality.get(id) ?? 0.35,
    cache.adultMin,
    cache.isDating,
    cache.isBusiness,
  );
  cache.byMember.set(id, vec);
  return vec;
}

export function humanVectorOf(w: World, id: MemberId): HumanVector | null {
  return getOrCompileMember(ensureWorldVectors(w), id);
}

export function humanVectorsForWorld(w: World): ReadonlyMap<MemberId, HumanVector> {
  const cache = ensureWorldVectors(w);
  if (!cache.adultsOnly) {
    const adultsOnly = new Map<MemberId, HumanVector>();
    for (const id of w.ids) {
      const vec = getOrCompileMember(cache, id);
      if (vec) adultsOnly.set(id, vec);
    }
    cache.adultsOnly = adultsOnly;
  }
  return cache.adultsOnly;
}

function ensureWorldVectors(w: World): WorldVectorCache {
  let cached = worldCache.get(w);
  if (cached) return cached;
  cached = buildWorldVectorCache(w);
  worldCache.set(w, cached);
  return cached;
}

const DAYS3 = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const PARTS3 = ["morning", "afternoon", "evening"];

function buildWeeklyBitmap(facets: readonly Facet[]): number[] {
  const bits = new Array<number>(21).fill(0);
  let anyExplicit = false;
  for (const f of facets) {
    for (const raw of f.tags) {
      const t = raw.toLowerCase();
      for (let p = 0; p < 3; p++) {
        const prefix = `${PARTS3[p]}:`;
        if (t.startsWith(prefix)) {
          const dIdx = DAYS3.indexOf(t.slice(prefix.length, prefix.length + 3));
          if (dIdx >= 0) { bits[dIdx * 3 + p] = 1; anyExplicit = true; }
        }
      }
      if (t.startsWith("friendship:free:") || t.startsWith("friends:free:")) {
        const slot = t.startsWith("friendship:free:") ? t.slice(16) : t.slice(13);
        const [dStr, pStr] = slot.split("_");
        const dIdx = DAYS3.indexOf(dStr ?? "");
        const pIdx = pStr === "am" ? 0 : pStr === "pm" ? 1 : pStr === "eve" ? 2 : -1;
        if (dIdx >= 0 && pIdx >= 0) { bits[dIdx * 3 + pIdx] = 1; anyExplicit = true; }
      }
    }
  }
  if (!anyExplicit) {
    for (let d = 1; d <= 5; d++) bits[d * 3 + 2] = 1;
    bits[0 * 3 + 1] = 1; bits[0 * 3 + 2] = 1;
    bits[6 * 3 + 0] = 1; bits[6 * 3 + 1] = 1; bits[6 * 3 + 2] = 1;
  }
  return bits;
}

function computeSocialGraphSignals(w: World, adultMin: number): {
  brokerage: Map<MemberId, number>;
  vouchQuality: Map<MemberId, number>;
} {
  const brokerage = new Map<MemberId, number>();
  const vouchQuality = new Map<MemberId, number>();
  if (w.positive.size === 0) return { brokerage, vouchQuality };
  const worldBrokerage = w.brokerage;

  for (const id of w.ids) {
    const mi = w.get(id);
    if (!mi || w.minors.has(id) || !vectorEligible(mi.m.age, adultMin)) continue;
    const nbrs = w.positive.get(id);
    if (!nbrs || nbrs.size === 0) {
      brokerage.set(id, 0.2);
      vouchQuality.set(id, 0.35);
      continue;
    }
    if (nbrs.size === 1) {
      brokerage.set(id, 0.25);
    } else {
      brokerage.set(id, clamp01(worldBrokerage.get(id) ?? 0));
    }
    let vouchSeed = Math.min(0.75, 0.35 + 0.08 * nbrs.size);
    for (const j of nbrs.keys()) {
      if (w.edgeHas(id, j, "vouched_for")) vouchSeed += 0.12;
      else if (w.edgeHas(id, j, "invited_by")) vouchSeed += 0.06;
    }
    vouchQuality.set(id, clamp01(vouchSeed));
  }

  for (let iter = 0; iter < 2; iter++) {
    const next = new Map<MemberId, number>();
    for (const [id, cur] of vouchQuality) {
      const nbrs = w.positive.get(id);
      if (!nbrs || nbrs.size === 0) { next.set(id, cur); continue; }
      let wSum = 0;
      let weightedVouch = 0;
      for (const [j, s] of nbrs) {
        const bonus = w.edgeHas(id, j, "vouched_for") ? 1.4 : w.edgeHas(id, j, "would_interact_again") ? 1.2 : 1.0;
        const wgt = s * bonus;
        wSum += wgt;
        weightedVouch += wgt * (vouchQuality.get(j) ?? 0.35);
      }
      const propagated = wSum > 0 ? weightedVouch / wSum : cur;
      next.set(id, clamp01(0.45 * cur + 0.55 * propagated));
    }
    for (const [id, v] of next) vouchQuality.set(id, v);
  }
  return { brokerage, vouchQuality };
}

function buildWorldVectorCache(w: World): WorldVectorCache {
  const now = w.now;
  const adultMin = Math.max(ADULT_AGE, w.pack.eligibility.minMatchAge);
  const isDating = isDatingDomain(w.pack.id);
  const isBusiness = isBusinessDomain(w.pack.id);

  const allFacetsBy = new Map<MemberId, Facet[]>();
  for (const f of w.input.facets) {
    if (f.validTo !== undefined && f.validTo < now) continue;
    if (f.validFrom !== undefined && f.validFrom > now) continue;
    if (isBusiness && f.tags.some(t => isBusinessProxyTag(t) || t.startsWith("appearance:") || t.startsWith("dating:") || t.startsWith("slop:"))) continue;
    const id = w.canonical(f.memberId);
    let list = allFacetsBy.get(id);
    if (!list) { list = []; allFacetsBy.set(id, list); }
    list.push(f);
  }

  const fbStats = new Map<MemberId, { pos: number; neg: number; explicitNeg: number; total: number }>();
  for (const f of w.feedback) {
    if (f.at > now) continue;
    const st = fbStats.get(f.about) ?? { pos: 0, neg: 0, explicitNeg: 0, total: 0 };
    st.total++;
    if (f.sentiment === "negative") {
      st.neg += 1.0;
      st.explicitNeg += 1;
    } else if (f.wouldMeetAgain === true || f.sentiment === "positive") {
      st.pos += 1.0;
    } else if (f.wouldMeetAgain === false) {
      st.neg += 0.25;
    }
    fbStats.set(f.about, st);
  }

  const attStats = new Map<MemberId, { completed: number; noShow: number; resolved: number }>();
  const bumpAtt = (id: MemberId, field: "completed" | "noShow" | "resolved") => {
    const s = attStats.get(id) ?? { completed: 0, noShow: 0, resolved: 0 };
    s[field]++;
    attStats.set(id, s);
  };
  for (const r of w.interactions) {
    if (r.at > now) continue;
    for (const id of r.participants) {
      if (r.outcome === "completed") bumpAtt(id, "completed");
      else if (r.outcome === "no_show") bumpAtt(id, "noShow");
      if (r.outcome !== "pending") bumpAtt(id, "resolved");
    }
  }

  const { brokerage, vouchQuality } = computeSocialGraphSignals(w, adultMin);
  return {
    w,
    adultMin,
    isDating,
    isBusiness,
    allFacetsBy,
    fbStats,
    attStats,
    brokerage,
    vouchQuality,
    byMember: new Map(),
  };
}

const LANG_HINT_RE = /\b(native|fluent|mother tongue|learn|practic|study)/i;
const POSITIVE_TAG_PREFIXES = [
  "hv:",
  "spend:",
  "stage:",
  "transition:",
  "humor:",
  "guild:",
  "lang_native:",
  "lang_learn:",
  "rung:",
  "econ_tier:",
] as const;

export function memberMayHavePositiveVectorBonus(w: World, id: MemberId, includeLanguages: boolean): boolean {
  const cache = ensureWorldVectors(w);
  const mi = w.get(id);
  if (!mi || w.minors.has(id) || !vectorEligible(mi.m.age, cache.adultMin)) return false;
  const facets = cache.allFacetsBy.get(id) ?? [];
  for (let i = 0; i < facets.length; i++) {
    const f = facets[i]!;
    const tags = f.tags;
    for (let j = 0; j < tags.length; j++) {
      const t = tags[j]!.trim().toLowerCase();
      for (let k = 0; k < POSITIVE_TAG_PREFIXES.length; k++) {
        if (t.startsWith(POSITIVE_TAG_PREFIXES[k]!)) return true;
      }
      if (includeLanguages && t.endsWith("_native") && t.length > 7) return true;
    }
    if (includeLanguages && LANG_HINT_RE.test(f.value)) return true;
  }
  if (includeLanguages) {
    for (let i = 0; i < mi.intents.length; i++) {
      const it = mi.intents[i]!;
      if (LANG_HINT_RE.test(it.objective) || (it.details && LANG_HINT_RE.test(it.details))) return true;
    }
  }
  return false;
}
const LANGUAGE_PATTERNS = LANGUAGE_CODES.map(lang => ({
  lang,
  nativeRx: new RegExp(`\\b(native|fluent)\\s+${lang}\\b|\\b${lang}\\s+(native|mother tongue)\\b`),
  learnRx: new RegExp(`\\b(learn(ing)?|practic(e|ing)|study(ing)?)\\s+${lang}\\b`),
}));

function inferLanguagesFromText(text: string): { native: string[]; learning: string[] } {
  if (!LANG_HINT_RE.test(text)) return { native: [], learning: [] };
  const low = text.toLowerCase();
  const native: string[] = [];
  const learning: string[] = [];
  for (const { lang, nativeRx, learnRx } of LANGUAGE_PATTERNS) {
    if (nativeRx.test(low)) native.push(lang);
    if (learnRx.test(low)) learning.push(lang);
  }
  return { native, learning };
}

function compileAdultVector(
  w: World,
  mi: MemberIndex,
  allFacets: readonly Facet[],
  fb: { pos: number; neg: number; explicitNeg: number; total: number } | undefined,
  att: { completed: number; noShow: number; resolved: number } | undefined,
  brokerageVal: number,
  vouchVal: number,
  adultMin: number,
  isDating: boolean,
  isBusiness: boolean,
): HumanVector {
  const now = w.now;
  const id = mi.m.id;
  const age = mi.m.age;
  const allowAesthetic = aestheticReadAllowed(isDating, age, adultMin);
  const nonAppearanceFacets = allFacets.filter(f => !f.tags.some(t => t.startsWith("appearance:")));
  const parsedTags = parseOntologyTags(nonAppearanceFacets);

  const rel = w.reliability[id];
  const completed = Math.max(att?.completed ?? 0, rel?.completedSinceLastNoShow ?? 0);
  const noShows = Math.max(att?.noShow ?? 0, rel?.noShows ?? 0);
  const showUpRate = clamp01((completed + 4.25) / (completed + noShows + 5));
  const posFb = fb?.pos ?? 0;
  const negFb = fb?.neg ?? 0;
  const explicitNeg = fb?.explicitNeg ?? 0;
  const reciprocalApprovalRate = clamp01((posFb + 3.0) / (posFb + negFb + 4.0));

  const hasSafetyCue = nonAppearanceFacets.some(f => f.tags.some(t => t.startsWith("business:safety:") || t.startsWith("peon:safety:")));
  const hasHypeIntent = mi.intents.some(i => isHypePitchIntent(i));
  const hasUnverifiedHype = !parsedTags.verifiedCraft && (parsedTags.hypeClaimCount > 0 || hasHypeIntent);
  const hypeExtractionBoost = hasUnverifiedHype
    ? Math.min(0.68, 0.36 + 0.14 * parsedTags.hypeClaimCount + (hasHypeIntent ? 0.16 : 0))
    : 0;
  const askToOfferRatio = mi.intents.length / Math.max(1, mi.caps.length + 1);
  const inferredExtraction = clamp01(
    0.05
    + (explicitNeg > 0 ? Math.min(0.45, 0.16 * explicitNeg) : 0)
    + (askToOfferRatio > 2.5 && mi.degree === 0 ? 0.12 : 0)
    + (hasSafetyCue ? 0.65 : 0)
    + (w.holds.has(id) ? 0.65 : 0)
    + hypeExtractionBoost,
  );
  let extractionRiskScore = parsedTags.extractionHint !== undefined ? clamp01(parsedTags.extractionHint) : inferredExtraction;
  let discretionVouchScore = parsedTags.discretionHint !== undefined
    ? clamp01(parsedTags.discretionHint)
    : clamp01(
      0.52
      + 0.30 * vouchVal
      + 0.22 * reciprocalApprovalRate
      - 0.45 * extractionRiskScore
      + (mi.degree >= 2 ? 0.06 : 0)
      + (nonAppearanceFacets.some(f => f.provenance === "vouched") ? 0.08 : (parsedTags.hvVerifiedCraftTag ? 0.12 : 0)),
    );
  if (hasUnverifiedHype) {
    discretionVouchScore = Math.min(discretionVouchScore, 0.32);
  }
  if (hasSafetyCue || w.holds.has(id)) {
    discretionVouchScore = Math.min(discretionVouchScore, 0.25);
    extractionRiskScore = Math.max(extractionRiskScore, 0.75);
  }

  const dunbarSaturation = {
    inner5Open: mi.m.state !== "quiet" && mi.m.state !== "paused" && (mi.newcomer || mi.degree < 4 || mi.m.state === "open"),
    sympathy15Open: mi.m.state !== "quiet" && mi.m.state !== "paused" && (mi.degree < 10 || mi.intents.some(i => i.category === "social")),
    affinity50Open: mi.m.state !== "paused",
  };

  const behavioral: BehavioralProfile = {
    showUpRate,
    responseLatencyMedianHrs: mi.acceptance >= 0.7 ? 1.2 : mi.acceptance >= 0.4 ? 3.5 : 10.0,
    reciprocalApprovalRate,
    discretionVouchScore,
    extractionRiskScore,
    dunbarSaturation,
  };

  const tasteFacets = mi.match.filter(f => f.kind === "interest" || f.kind === "desire");
  const valueFacets = mi.match.filter(f => f.kind === "goal" || f.kind === "trait" || f.kind === "fact");
  const styleFacets = mi.match.filter(f => f.kind === "trait");
  const embOf = (fs: Facet[], fallback: number[]) => {
    const vs = fs.map(f => mi.facetEmb.get(f.id)).filter((v): v is number[] => !!v);
    return vs.length ? centroid(vs, w.dim) : fallback;
  };

  const clusters = new Set<string>();
  for (const t of mi.tags) {
    const cl = interestClusterByTag.get(t);
    if (cl) clusters.add(cl);
  }

  const lifeStage: LifeStage = parsedTags.lifeStage ?? (
    mi.tags.has("parenting") || mi.intents.some(i => /\bparent/i.test(i.objective))
      ? (age < 36 ? "young_family" : "established_family")
      : age < 23 ? "student"
      : age < 29 ? "early_career"
      : age >= 62 ? "retired"
      : "established_single"
  );
  const transitions = [...parsedTags.transitions];
  if (mi.newcomer && !transitions.includes("relocated_city")) transitions.push("relocated_city");
  if (lifeStage === "post_exit" && !transitions.includes("post_exit")) transitions.push("post_exit");

  let spendComfortTier: SpendComfortTier = parsedTags.spendTier ?? "moderate";
  if (!parsedTags.spendTier) {
    const matchText = mi.match.map(f => f.value).join(" ");
    if (/\b(free only|zero budget|tight budget|no cover)\b/i.test(matchText)) spendComfortTier = "free";
    else if (/\b(budget[- ]friendly|low[- ]cost|cheap eats)\b/i.test(matchText)) spendComfortTier = "low";
    else if (parsedTags.economicHint !== undefined) {
      spendComfortTier = parsedTags.economicHint >= 0.9 ? "unconstrained"
        : parsedTags.economicHint >= 0.72 ? "high"
        : parsedTags.economicHint <= 0.18 ? "free"
        : parsedTags.economicHint <= 0.35 ? "low"
        : "moderate";
    }
  }

  const fitnessTags = ["climbing", "running", "hiking", "cycling", "tennis", "pickleball", "basketball", "yoga"];
  const fitHits = fitnessTags.filter(t => mi.tags.has(t)).length;
  const fitnessVal = clamp01(0.25 + 0.22 * fitHits);
  const deepHits = ["philosophy", "books", "writing", "ai", "biotech", "physics_math", "history_economics"].filter(t => mi.tags.has(t)).length;
  const depthVal = parsedTags.depthHint !== undefined ? clamp01(parsedTags.depthHint) : clamp01(0.4 + 0.18 * deepHits);
  const depthConf = parsedTags.depthHint !== undefined ? 0.78 : (deepHits > 0 ? 0.7 : 0.3);
  const groupFmt = mi.m.prefs.formats.includes("small_group") || mi.m.prefs.formats.includes("event");
  const extroVal = clamp01(0.35 + (groupFmt ? 0.2 : -0.1) + Math.min(0.3, mi.degree * 0.05) + (mi.isHost ? 0.15 : 0));
  const initVal = clamp01(0.35 + (mi.isHost ? 0.45 : 0) + (mi.tags.has("hosting") ? 0.2 : 0) + Math.min(0.2, mi.recentContribution * 0.08));

  const homePresence = mi.presence.find(p => p.type === "home");
  const homeCity = homePresence?.city ?? mi.m.homeCity;
  const rawHomeArea = homePresence?.areas[0];
  const citySpec = getCity(homeCity);
  const homeNeighborhood = rawHomeArea
    ? (homeCity === "nyc"
      ? (hood(rawHomeArea) ?? findNeighborhood("nyc", rawHomeArea))
      : findNeighborhood(homeCity, rawHomeArea))
    : undefined;
  const homeCoord = homeNeighborhood
    ? { lat: homeNeighborhood.lat, lon: homeNeighborhood.lng }
    : citySpec
      ? { lat: citySpec.center.lat, lon: citySpec.center.lng }
      : undefined;
  const homeH3 = homeCoord
    ? latLonToHex(homeCoord.lat, homeCoord.lon, 6).key
    : `${homeCity}:${(rawHomeArea ?? "core").toLowerCase()}`;
  const maxTravel = mi.m.prefs.maxTravelMinutes;
  const primaryMode = citySpec?.primaryMode;
  const transitMode: HorizontalProfile["geoAndTime"]["transitMode"] =
    primaryMode === "car"
      ? "car"
      : primaryMode === "transit" || primaryMode === "hybrid"
        ? "transit"
        : maxTravel <= 20
          ? "walk"
          : maxTravel >= 50
            ? "car"
            : "transit";

  let cachedTasteEmb: number[] | undefined;
  let cachedValueEmb: number[] | undefined;
  let cachedStyleEmb: number[] | undefined;
  const horizontal: HorizontalProfile = {
    embeddings: {
      get interestsAndTaste() {
        return cachedTasteEmb ??= embOf(tasteFacets, mi.desireEmb);
      },
      get worldviewAndValues() {
        return cachedValueEmb ??= embOf(valueFacets, mi.profileEmb);
      },
      get conversationalStyle() {
        return cachedStyleEmb ??= embOf(styleFacets, mi.profileEmb);
      },
    },
    lifeStage,
    activeTransitions: transitions,
    communication: {
      depthPreference: makeCoord(depthVal, depthConf, now, parsedTags.depthHint !== undefined ? "said" : "inferred", "agent_private"),
      humorRegister: parsedTags.humor.length ? parsedTags.humor : ["warm_earnest"],
      extroversion: makeCoord(extroVal, 0.55, now, "inferred", "agent_private"),
      initiatorScore: makeCoord(initVal, 0.65, now, "inferred", "agent_private"),
    },
    lifestyle: {
      spendComfortTier,
      fitnessIntensity: makeCoord(fitnessVal, fitHits > 0 ? 0.75 : 0.3, now, "inferred", "agent_private"),
      substanceProfile: {
        alcohol: parsedTags.soberProtected ? "none" : mi.tags.has("wine") ? "social" : "light",
        ...(parsedTags.soberProtected ? { soberProtected: true } : {}),
      },
      spontaneity: makeCoord(mi.m.state === "open" ? 0.65 : 0.45, 0.4, now, "inferred", "agent_private"),
    },
    geoAndTime: {
      homeH3,
      maxTravelMinutes: maxTravel,
      transitMode,
      weeklySlotBitmap: buildWeeklyBitmap(nonAppearanceFacets),
    },
  };

  const domainRungs: Record<string, ScoredCoordinate> = {};
  for (const [dom, rung] of Object.entries(parsedTags.domainRungs)) {
    const adjusted = hasUnverifiedHype ? Math.min(rung, 3.5) : rung;
    const rungConf = parsedTags.verifiedCraft ? 0.85 : hasUnverifiedHype ? 0.25 : 0.62;
    domainRungs[dom] = makeCoord(clampRung(adjusted), rungConf, now, parsedTags.verifiedCraft ? "vouched" : "said", "agent_private");
  }
  for (const f of mi.caps) {
    const isVerifiedCap = f.provenance === "vouched" || f.provenance === "connected_source";
    for (const raw of f.tags) {
      const t = raw.toLowerCase();
      const sdef = skillDefByTag.get(t);
      const dom = sdef?.teaches ? (interestClusterByTag.get(sdef.teaches) ?? sdef.teaches) : undefined;
      if (dom) {
        const baseRung = isVerifiedCap ? 6.5 : 5.0;
        const cur = domainRungs[dom]?.value ?? 0;
        if (baseRung > cur) {
          domainRungs[dom] = makeCoord(baseRung, isVerifiedCap ? 0.78 : 0.55, now, f.provenance, "agent_private");
        }
      }
      const seniorityVal = stripBusinessTag(t, "seniority");
      if (seniorityVal !== undefined) {
        const lvl = Number(seniorityVal);
        if (Number.isFinite(lvl) && businessCapitalAllowed("seniority")) {
          const rung = clampRung(lvl * 2);
          domainRungs.career = makeCoord(rung, isVerifiedCap ? 0.8 : 0.6, now, f.provenance, "agent_private");
        }
      }
    }
  }
  const topDomainRung = Math.max(0, ...Object.values(domainRungs).map(c => c.value));

  const econFromSpend: Record<SpendComfortTier, number> = {
    free: 0.14,
    low: 0.28,
    moderate: 0.50,
    high: 0.78,
    unconstrained: 0.94,
  };
  const hasHighEconTag = mi.tags.has("angel_patron") || mi.tags.has("non_dilutive_patron") || lifeStage === "post_exit";
  const inferredEcon = parsedTags.economicHint !== undefined
    ? parsedTags.economicHint
    : parsedTags.spendTier !== undefined
      ? Math.max(econFromSpend[parsedTags.spendTier], hasHighEconTag && !hasUnverifiedHype ? 0.91 : 0)
      : hasHighEconTag && !hasUnverifiedHype
        ? 0.91
        : clamp01(0.42 + (mi.tags.has("fundraising") && !hasUnverifiedHype ? 0.22 : 0) + (topDomainRung >= 8 && parsedTags.verifiedCraft ? 0.18 : 0));

  const inferredPublicity = parsedTags.publicityHint !== undefined
    ? parsedTags.publicityHint
    : clamp01(
      0.15
      + (topDomainRung >= 9 && parsedTags.verifiedCraft ? 0.55 : topDomainRung >= 8 && parsedTags.verifiedCraft ? 0.25 : 0)
      + (mi.tags.has("angel_patron") || mi.tags.has("non_dilutive_patron") ? 0.22 : 0)
      + (lifeStage === "post_exit" && !hasUnverifiedHype ? 0.30 : 0)
      + (mi.isHost && mi.degree >= 6 ? 0.15 : 0),
    );

  const omnivorousVal = clamp01(clusters.size / 6);
  const embodiedVal = clamp01(0.35 + 0.35 * omnivorousVal + 0.30 * depthVal);
  const instVal = clamp01(0.35 + (topDomainRung / 10) * 0.55);
  const peerPrestigeVal = clamp01(0.45 * vouchVal + 0.35 * (topDomainRung / 10) + 0.20 * reciprocalApprovalRate);

  let aestheticSlopOnly: CapitalProfile["aestheticSlopOnly"];
  if (allowAesthetic && !isBusiness) {
    for (const f of allFacets) {
      const parsed = parseAppearance(f.tags);
      if (parsed && parsed.confidence > 0) {
        const normZ = (z: number) => clamp01((z + 3) / 6);
        aestheticSlopOnly = {
          face: makeCoord(normZ(parsed.face), parsed.confidence, now, "inferred", "agent_private", [], "slop"),
          body: makeCoord(normZ(parsed.body), parsed.confidence, now, "inferred", "agent_private", [], "slop"),
          overall: makeCoord(normZ(parsed.overall), parsed.confidence, now, "inferred", "agent_private", [], "slop"),
          ...(parsed.bodyType ? { bodyType: parsed.bodyType } : {}),
          appWall: "slop",
          scope: "agent_private",
        };
        break;
      }
    }
  }

  const capital: CapitalProfile = {
    economic: makeCoord(isBusiness ? 0.5 : inferredEcon, isBusiness ? 0 : (parsedTags.economicHint !== undefined || parsedTags.spendTier !== undefined ? 0.72 : 0.35), now, "inferred", "agent_private"),
    cultural: {
      embodied: makeCoord(isBusiness ? 0.5 : embodiedVal, isBusiness ? 0 : 0.5, now, "inferred", "agent_private"),
      institutionalized: makeCoord(isBusiness ? 0.5 : instVal, isBusiness ? 0 : 0.45, now, "inferred", "agent_private"),
      omnivorousness: makeCoord(isBusiness ? 0.5 : omnivorousVal, isBusiness ? 0 : 0.65, now, "inferred", "agent_private"),
    },
    social: {
      vouchQuality: makeCoord(vouchVal, mi.degree > 0 ? 0.75 : 0.3, now, "inferred", "agent_private"),
      brokerage: makeCoord(brokerageVal, mi.degree > 1 ? 0.75 : 0.25, now, "inferred", "agent_private"),
      warmGraphDegree: mi.degree,
    },
    symbolic: {
      publicityTier: makeCoord(isBusiness ? 0.15 : inferredPublicity, isBusiness ? 0 : (parsedTags.publicityHint !== undefined ? 0.75 : 0.35), now, "inferred", "agent_private"),
      peerPrestige: makeCoord(peerPrestigeVal, 0.55, now, "inferred", "agent_private"),
    },
    domainRungs,
    ...(aestheticSlopOnly ? { aestheticSlopOnly } : {}),
  };

  const slots: ExchangeSlot[] = [];
  const nativeLanguages = new Set<string>(parsedTags.nativeLanguages);
  const learningLanguages = new Set<string>(parsedTags.learningLanguages);

  for (const f of nonAppearanceFacets) {
    const inferred = inferLanguagesFromText(f.value);
    for (const l of inferred.native) nativeLanguages.add(l);
    for (const l of inferred.learning) learningLanguages.add(l);
  }

  for (const it of mi.intents) {
    const inferred = inferLanguagesFromText(`${it.objective} ${it.details ?? ""}`);
    for (const l of inferred.native) nativeLanguages.add(l);
    for (const l of inferred.learning) learningLanguages.add(l);

    const defs = objectivesFor(it.objective, it.details, it.category);
    const cType = connectionTypeForIntent(it);
    const spec = CONNECTION_ONTOLOGY_SPECS[cType];
    const dTags = detailTags(it.details);
    const roleTag = defs[0]?.needs[0] ?? dTags[0] ?? defs[0]?.pool ?? cType;
    const domain = defs[0]?.domain ?? cType;
    const [loDelta, hiDelta] = defs[0]?.targetRungDelta ?? spec.targetRungDelta;
    const urgency: ExchangeSlot["urgency"] =
      it.horizonDays <= 7 ? "now" : it.horizonDays <= 35 ? "this_month" : "evergreen";
    const format: ExchangeSlot["format"] =
      spec.defaultFormat === "event" ? "event_anchor" : spec.defaultFormat === "small_group" ? "small_group" : "one_to_one";
    slots.push({
      id: `intent:${it.id}`,
      connectionType: cType,
      direction: defs[0]?.pool ? "mutual_pool" : "seeks",
      roleTag,
      domain,
      targetRungDelta: [loDelta, hiDelta],
      urgency,
      format,
      cadence: cType === "habit_accountability" || cType === "language_tandem" ? "weekly" : "one_off",
      scope: "matchable",
    });
  }

  for (let idx = 0; idx < parsedTags.statedConnections.length; idx++) {
    const sc = parsedTags.statedConnections[idx]!;
    const spec = CONNECTION_ONTOLOGY_SPECS[sc.connectionType];
    slots.push({
      id: `hvconn:${idx}:${sc.connectionType}:${sc.role}`,
      connectionType: sc.connectionType,
      direction: sc.direction,
      roleTag: sc.role,
      domain: sc.domain,
      targetRungDelta: [spec.targetRungDelta[0], spec.targetRungDelta[1]],
      urgency: "this_month",
      format: spec.defaultFormat === "event" ? "event_anchor" : spec.defaultFormat === "small_group" ? "small_group" : "one_to_one",
      cadence: sc.connectionType === "habit_accountability" || sc.connectionType === "language_tandem" ? "weekly" : "monthly",
      scope: sc.scope,
    });
  }

  for (const f of mi.caps) {
    for (const raw of f.tags) {
      const t = raw.toLowerCase();
      const sdef = skillDefByTag.get(t);
      if (!sdef) continue;
      const dom = sdef.teaches ? (interestClusterByTag.get(sdef.teaches) ?? sdef.teaches) : "general";
      const cType: ConnectionOntologyType =
        t === "angel_patron" || t === "non_dilutive_patron" ? "patronage_sponsorship"
        : t.endsWith("_native") ? "language_tandem"
        : t === "moving_help" || t === "home_repair_hvac" || t === "bike_mechanic" ? "local_mutual_aid"
        : dom === "music" || dom === "arts" || dom === "creative" ? "creative_cocreation"
        : dom === "craft" ? "craft_maker_guild"
        : "step_ahead_mentorship";
      const spec = CONNECTION_ONTOLOGY_SPECS[cType];
      slots.push({
        id: `offer:${f.id}:${t}`,
        connectionType: cType,
        direction: "offers",
        roleTag: t,
        domain: dom,
        targetRungDelta: [spec.targetRungDelta[0], spec.targetRungDelta[1]],
        urgency: "evergreen",
        format: spec.defaultFormat === "event" ? "event_anchor" : spec.defaultFormat === "small_group" ? "small_group" : "one_to_one",
        cadence: "monthly",
        scope: f.scope,
      });
    }
  }

  const crossCapitalOpenness: CrossCapitalOpenness[] = [];
  if (mi.tags.has("angel_patron") || mi.tags.has("non_dilutive_patron") || slots.some(s => s.connectionType === "patronage_sponsorship")) {
    crossCapitalOpenness.push("patronage");
  }
  if (mi.caps.length > 0 || topDomainRung >= 5) {
    crossCapitalOpenness.push("step_ahead_mentoring");
  }
  if (parsedTags.guilds.length > 0 || slots.some(s => CONNECTION_ONTOLOGY_SPECS[s.connectionType].chettyMixedSesContainer)) {
    crossCapitalOpenness.push("mixed_ses_craft_guild");
  }
  if (mi.m.prefs.categoriesOptIn.includes("help") || slots.some(s => s.connectionType === "local_mutual_aid")) {
    crossCapitalOpenness.push("local_mutual_aid");
  }

  const explicitSignals: ExplicitSignalFlags = {
    lifeStage: parsedTags.lifeStage !== undefined,
    spendTier: parsedTags.spendTier !== undefined || parsedTags.economicHint !== undefined,
    humor: parsedTags.humor.length > 0,
    depth: parsedTags.depthHint !== undefined,
    transitions: parsedTags.transitions.length > 0,
    guilds: parsedTags.guilds.length > 0 || parsedTags.statedConnections.some(sc => CONNECTION_ONTOLOGY_SPECS[sc.connectionType].chettyMixedSesContainer),
    languages: nativeLanguages.size > 0 || learningLanguages.size > 0,
    domainRungs: Object.keys(parsedTags.domainRungs).length > 0,
    hypeOrExtraction: hasUnverifiedHype || hasSafetyCue || w.holds.has(id) || parsedTags.extractionHint !== undefined || parsedTags.discretionHint !== undefined || parsedTags.publicityHint !== undefined,
    reliabilityPenalty: noShows > 0 || explicitNeg > 0,
  };

  return {
    memberId: id,
    age,
    capital,
    horizontal,
    exchange: {
      slots,
      crossCapitalOpenness,
      nativeLanguages: [...nativeLanguages].sort(),
      learningLanguages: [...learningLanguages].sort(),
      guilds: [...parsedTags.guilds].sort(),
    },
    behavioral,
    facetRefs: mi.match.map(f => f.id),
    explicitSignals,
  };
}

export function classifyEmptyStateRemedy(
  w: World,
  empty: { intentId: string; memberId: MemberId; reason: string },
): EmptyStateRemedy | null {
  const id = w.canonical(empty.memberId);
  const mi = w.get(id);
  if (!mi) return null;
  const intent = w.intentById.get(empty.intentId);
  const cType: ConnectionOntologyType = intent ? connectionTypeForIntent(intent) : "friendship";
  const adultMin = Math.max(ADULT_AGE, w.pack.eligibility.minMatchAge);

  if (w.minors.has(id) || !vectorEligible(mi.m.age, adultMin)) {
    return {
      intentId: empty.intentId,
      memberId: id,
      engineReason: empty.reason,
      stage: "single_player_concierge",
      remedyKind: "local_public_events",
      connectionType: "event_travel_companion",
      diagnosticCodes: ["minor_single_player_only"],
      involvesOtherMembers: false,
    };
  }

  const vec = humanVectorOf(w, id);
  const codes: string[] = [];
  if (mi.lowData) codes.push("low_facet_count");
  if (intent && !w.pack.ontology.objectivesFor(intent.objective, intent.details, intent.category).length) {
    codes.push("unstructured_want");
  }
  if (mi.m.prefs.maxTravelMinutes < 20) codes.push("narrow_travel_radius");
  if (vec && (vec.horizontal.lifestyle.spendComfortTier === "free" || vec.horizontal.lifestyle.spendComfortTier === "low")) {
    codes.push("spend_floor_protected");
  }

  if (empty.reason === "budget_or_selection" || empty.reason.startsWith("filtered:interruption_budget")) {
    return {
      intentId: empty.intentId,
      memberId: id,
      engineReason: empty.reason,
      stage: "single_player_concierge",
      remedyKind: "wait_budget_cooldown",
      connectionType: cType,
      diagnosticCodes: [...codes, "attention_cap_active"],
      involvesOtherMembers: false,
    };
  }

  if (codes.includes("unstructured_want")) {
    return {
      intentId: empty.intentId,
      memberId: id,
      engineReason: empty.reason,
      stage: "readiness_coaching",
      remedyKind: "clarify_intent",
      connectionType: cType,
      diagnosticCodes: codes,
      involvesOtherMembers: false,
    };
  }

  if (mi.lowData) {
    return {
      intentId: empty.intentId,
      memberId: id,
      engineReason: empty.reason,
      stage: "readiness_coaching",
      remedyKind: "enrich_facets",
      connectionType: cType,
      diagnosticCodes: codes,
      involvesOtherMembers: false,
    };
  }

  if (cType === "step_ahead_mentorship") {
    codes.push("step_ahead_supply_scarce");
    return {
      intentId: empty.intentId,
      memberId: id,
      engineReason: empty.reason,
      stage: "readiness_coaching",
      remedyKind: "step_ahead_recalibrate",
      connectionType: cType,
      diagnosticCodes: codes,
      involvesOtherMembers: false,
    };
  }

  if (empty.reason === "density_gap" || empty.reason === "no_candidates") {
    if (CONNECTION_ONTOLOGY_SPECS[cType].chettyMixedSesContainer || codes.includes("spend_floor_protected")) {
      return {
        intentId: empty.intentId,
        memberId: id,
        engineReason: empty.reason,
        stage: "shared_purpose_guild",
        remedyKind: "free_local_guild_bridge",
        connectionType: cType,
        diagnosticCodes: [...codes, "sparse_local_pool"],
        involvesOtherMembers: false,
      };
    }
    return {
      intentId: empty.intentId,
      memberId: id,
      engineReason: empty.reason,
      stage: "widen_constraints",
      remedyKind: "widen_radius_or_schedule",
      connectionType: cType,
      diagnosticCodes: [...codes, "sparse_local_pool"],
      involvesOtherMembers: false,
    };
  }

  return {
    intentId: empty.intentId,
    memberId: id,
    engineReason: empty.reason,
    stage: "single_player_concierge",
    remedyKind: "local_public_events",
    connectionType: cType,
    diagnosticCodes: codes.length ? codes : ["threshold_not_cleared"],
    involvesOtherMembers: false,
  };
}
