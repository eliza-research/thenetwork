import { canBeMatched } from "@thenetwork/core";
import {
  compatibilityQuestionDue, compatibilityTypeQuestionDue, requiredQuestionDue, slopQuestionSubject, slopQuestionTrack, widerRadiusQuestion, wideningPoolEligible,
} from "../../../../core/src/generated/engineAsks.ts";
import { DEFAULT_ATTENTION, GENERATOR_NAMES, resolveConfig, type AttentionConfig, type EngineConfig, type EngineConfigInput } from "../../config.ts";
import type { AppPack, EligibilityPolicy } from "../../pack.ts";
import type { World } from "../../world.ts";
import { slopAssign } from "./assign.ts";
import { ageBand, distancePhrase, SLOP_ASK_QUESTIONS, SLOP_FACET_PHRASE, SLOP_LANE_ACTIVITY, SLOP_SAFE_FALLBACK, slopProbeText } from "./copy.ts";
import { makeRadiusGeo, mutualMarkets } from "./geo.ts";
import { dateCandidateCount, slopGenerators, slopVectors } from "./generators.ts";
import { limitMiles } from "./geo.ts";
import { slopOptions, type DeepPartial, type SlopPackOptions } from "./options.ts";
import { slopProfiles } from "./profile.ts";
import { missingFields, needsBasics, reviewReason, SLOP_CANDIDATE_PRE_RULES, SLOP_LANE, slopMemberRules, slopPairRules } from "./rules.ts";
import { slopJudge } from "./judge.ts";
import { distanceBand } from "./zips.ts";

const SLOP_PACK_VERSION = "slop-pack-2.0.0";

export const SLOP_ENGINE_CONFIG: EngineConfigInput = {
  cities: ["sf", "nyc", "la"],
  timezones: { sf: "America/Los_Angeles", nyc: "America/New_York", la: "America/Los_Angeles" },
  windowDays: 7, minOverlapHours: 3, ageMin: 18,
  budgets: { normal: { limit: 2, periodDays: 7 }, open: { limit: 2, periodDays: 7 }, receiving: { limit: 2, periodDays: 7 } },
  thresholds: { byState: { open: 0, normal: 0, quiet: 0, receiving: 0 }, byCategory: { romance: 0, help: 0, growth: 0 }, useByGenerator: false, exploration: 0 },
  floors: { fit: 0, mutualBenefit: 0, confidence: 0, maxSocialRisk: 1, judgeDimension: 0 },
  weights: { fit: 0, mutualBenefit: 1, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0 },
  generators: Object.fromEntries(GENERATOR_NAMES.map(g => [g, false])) as Record<(typeof GENERATOR_NAMES)[number], boolean>,
  exploration: { rate: 0, maxShare: 0.15 },
  romance: { requireStatedPrefs: true },
  dispatch: { skipOpenOpportunities: true, billOnlySent: true },
  personalGrowthAsHobby: false,
};
export const SLOP_ENGINE_DEFAULTS: EngineConfig = resolveConfig(SLOP_ENGINE_CONFIG);
const SLOP_ATTENTION: AttentionConfig = { ...DEFAULT_ATTENTION, romanceInDigest: false };

export function makeSlopPack(over: DeepPartial<SlopPackOptions> = {}): AppPack & { options: SlopPackOptions } {
  const o = slopOptions(over);
  const eligibility: EligibilityPolicy = {
    minMatchAge: 18,
    accountTiers: [{ minAge: 13, maxAge: 17, matchable: false, label: "member under 18 (never matched)" }],
    memberRules: slopMemberRules(o),
    pairRules: slopPairRules(o),
    candidatePreRules: SLOP_CANDIDATE_PRE_RULES,
    candidatePostRules: [],
  };
  const prof = (w: World) => slopProfiles(w.input, w.canonical);
  return {
    id: "slop",
    version: SLOP_PACK_VERSION,
    options: o,
    ontology: {
      lanes: [{ id: SLOP_LANE, minors: "never", neverInPlans: true }],
      contributorRoles: new Set(),
      warmEdges: new Set(),
      funnelProbe: { lane: SLOP_LANE, role: "peer" },
      objectives: [{ id: "date", pattern: /\bdate|dating|romance\b/i, needs: [], interests: [], romance: true }],
      objectivesFor: () => [],
      constraints: fs => {
        const tags = fs.flatMap(f => f.tags);
        const dealbreakers = tags.filter(t => t.startsWith("slop:dealbreaker:")).map(t => t.slice(17));
        const rt = tags.filter(t => t.startsWith("romance:"));
        if (!rt.length) return { dealbreakers };
        const romance = { is: [] as string[], seeks: [] as string[], ageMin: 18, ageMax: 120 };
        for (const t of rt) {
          const [, k, v] = t.split(":");
          if (k === "is" && v) romance.is.push(v);
          if (k === "seeks" && v) romance.seeks.push(v);
          if (k === "age" && v) { const [lo, hi] = v.split("-").map(Number); romance.ageMin = lo ?? 18; romance.ageMax = hi ?? 120; }
        }
        return { dealbreakers, romance };
      },
      isHost: () => false,
    },
    eligibility,
    geo: makeRadiusGeo(o),
    generators: slopGenerators(o),
    vectors: slopVectors(o),
    scoring: {
      socialRisk: (_c, v) => v + 0.1,
    },
    selection: {
      assign: (w, scored, ctx) => slopAssign(o, w, scored, ctx),
      askQuestions: SLOP_ASK_QUESTIONS,
      extraAsksEnabled: () => o.asks || o.compatAsks,
      extraAsks: (w, id, _mi, lastAsk, add) => {
        const p = slopProfiles(w.input, w.canonical).get(id);
        if (!p || !slopQuestionSubject(p.adult, p.optedIn, p.paused, w.holds.has(id)) || reviewReason(p, o)) return;
        const intent = w.get(id)!.intents.find(i => i.category === SLOP_LANE);
        const fs = missingFields(p, o);
        if (slopQuestionTrack(fs.length > 0) === "RequiredQuestions") {
          for (const f of fs) {
            const reason = `slop_${f}`;
            if (requiredQuestionDue(w.now - lastAsk([reason]), p.askCounts[reason] ?? 0, o.maxAsksPerField)) add(reason, intent?.id);
          }
          return;
        }
        if (wideningPoolEligible(o.widen.enabled, dateCandidateCount(w, id), o.widen.maxDegree)
          && widerRadiusQuestion(limitMiles(p, o) ?? Infinity, o.widen.miles, !!p.askCounts.slop_widen)) add("slop_widen", intent?.id);
        if (!o.compatAsks) return;
        if (needsBasics(p) && compatibilityQuestionDue(w.now - lastAsk(["slop_basics"]))) add("slop_basics", intent?.id);
        if (compatibilityTypeQuestionDue(o.typeAsk, !p.wants || !p.self, w.now - lastAsk(["slop_type"]))) add("slop_type", intent?.id);
      },
    },
    consent: {
      default: { kind: "probe_first", order: "wanter_first", reveal: "opt_out", anonymousProbe: true },
      byKind: {},
    },
    attention: {
      config: SLOP_ATTENTION,
      shipsAloneLane: SLOP_LANE,
      noWarmMentionLanes: [SLOP_LANE],
      itemGate: (m, it) => (it.category === SLOP_LANE && (!canBeMatched(m.age) || !(m.categoriesOptIn ?? [SLOP_LANE]).includes(SLOP_LANE)) ? "romance_not_allowed" : null),
      probeAllowed: (lane, n) => lane === SLOP_LANE && n === 1,
      laneActivity: SLOP_LANE_ACTIVITY,
      probeText: (ctx, activity, attribute) => slopProbeText(ctx, activity, attribute),
    },
    explain: {
      facetPhrase: SLOP_FACET_PHRASE,
      leadBits: (w, c, me) => {
        const P = prof(w);
        const other = c.participants.find(x => x !== me)!;
        const mo = w.get(other)!, pm = P.get(me), po = P.get(other);
        const bits: string[] = [];
        const byId = (x: { id: string }, y: { id: string }) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
        const shared = (c.evidence[other] ?? []).map(fid => mo.share.find(f => f.id === fid)).filter(f => !!f).sort(byId)[0];
        const first = mo.m.name.split(/\s+/)[0] ?? mo.m.name;
        if (shared) bits.push(`You both like ${shared.value.replace(/[.\s]+$/, "")}.`);
        else { const f = mo.share.filter(x => x.kind === "interest").sort(byId)[0]; if (f) bits.push(`${first} is into ${f.value.replace(/[.\s]+$/, "")}.`); }
        if (pm && po) {
          const mm = mutualMarkets(pm, po, o, w.pack.geo.markets(w.cfg));
          if (mm.length) bits.push(`${first} (${ageBand(po.age)}) is ${distancePhrase(distanceBand(mm[0]!.miles))}.`);
        }
        if (!bits.length) bits.push(SLOP_SAFE_FALLBACK);
        return bits;
      },
      safeFallback: SLOP_SAFE_FALLBACK,
      publicWords: ["date", "dates", "dating", "first", "they", "their", "they're", "theyre"],
    },
    judge: slopJudge(o),
  };
}

export const slopPack = makeSlopPack();

export { slopOptions, SLOP_DEFAULT_OPTIONS, type SlopPackOptions } from "./options.ts";
export { slopProfiles, SLOTS, type SlopProfile, type Slot } from "./profile.ts";
export { planFirstDate, planFromInput, probePhotoRefs, PROBE_PHOTO_MAX, PUBLIC_VENUE, type DatePlan, type ProbePhotoRef, type ProbePhotoSubject } from "./plan.ts";
export { distanceBand, cellOfZip, ZIPS as SLOP_ZIPS, type DistanceBand } from "./zips.ts";
export { ageBand, distancePhrase, SLOP_ASK_QUESTIONS, SLOP_PROBE_PHOTO_LINE, slopBookedText, slopCheckInText, slopProbeMessage, slopProbeText } from "./copy.ts";
export { mutualMarkets } from "./geo.ts";
export { adultsOnly, appearanceFacet, appearanceLeak, APPEARANCE_LEAK_PATTERNS, BODY_TYPES, canRatePhotos, ClipAppearanceRater, parseAppearance, rateMember, VisionLlmAppearanceRater, VISION_RATER_SYSTEM, type AppearanceRater, type AppearanceScore, type BodyType, type PhotoRef, type RatingSubject, type VisionChat } from "./appearance.ts";
export { CLEF_FEATURES, CLEF_MODEL_IDS, CLEF_PRICE_PER_M_INPUT, CLEF_QUESTIONS, ClefError, clefFeatures, clefFeatureRow, clefFeatureNames, clefRun, applyHead, makeClefRater, makeClefRaterFromEnv, WorkersAIClefRater, type ClefModel, type ClefRaterOptions, type ClefCallOptions, type ClefRequest, type ClefFetch } from "./clef.ts";
export { DEFAULT_CLEF_WEIGHTS, loadClefWeights, validateClefWeights, type ClefWeights } from "./clefWeights.ts";
export { biasMonitor, ratingQuintiles, type BiasReport, type MemberOutcome } from "./biasMonitor.ts";
export { dateTags, firstOf, SLOP_GENERATOR, slopVectors } from "./generators.ts";
export { extractSlopProfile, extractSlopProfileLLM, llmSlopReader, slopReaderPrompt, validateSlopReading, slopOnboardTags, seeksAnswerOf, transAnswerOf, transStatusOf, readMessage, emptyOnboarding, hardFilled, hasField, coarsePlace, HARD_FIELDS, DEALBREAKER_IDS, DATE_ACTIVITY_IDS, LLM_FILL_BELOW, type SlopOnboarding, type OnboardField, type HardField, type Field, type Evidence, type Distance, type Location, type ExtractOptions, type SlopReader, type SlopTag, type Dealbreaker, type DateActivity } from "./extract.ts";
export { readBack, readBackFacts, applyCorrection, nextQuestion, markAsked, hardComplete, SLOP_ONBOARD_QUESTIONS, READBACK_FIELDS, MAX_ASKS_PER_QUESTION, type ReadBackFact } from "./onboard.ts";
export { slopJudge, slopJudgeContext, SLOP_JUDGE_SYSTEM, SLOP_JUDGE_VERSION } from "./judge.ts";
