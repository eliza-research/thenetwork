// slopPack: slop.date (dating) on The Network's shared engine (docs/results/2026-10-08-slop-pack.md).
//
//   geo        radius / zip / multi-city, mutual radius d <= min(rA, rB) on coarse cells, distance bands
//   filters    mutual gender & orientation inclusion, age ranges both ways, stated dealbreakers,
//              safety cues and records -> review hold; no race filter (no such field)
//   retrieval  reciprocal candidates within geo and filters; stated preferences only filter
//   scoring    compatibility signals + learned / revealed component, reciprocal (harmonic or min);
//              appearance (iteration 4, ON): soft similarity on face / body / overall ratings and
//              body type against stated / revealed preferences; ratings are NEVER shared (appearance.ts)
//   selection  global assignment per tick (greedy or stable roommates), congestion caps, exposure
//              fairness (selection.adjust), receptivity pacing, "your turn" limit
//   consent    probe first (wanter first), then a booked first date the agent plans; romance ships alone
//   asks       unknown age range, distance or orientation -> ask instead of proposing
// Core invariants (minors never matched, blocks win, hard filters before scoring, LeakGuard,
// determinism, consent before reveal) are the engine's and cannot be loosened here.
import { DAY } from "@thenetwork/core";
import { DEFAULT_ATTENTION, DEFAULT_PLANS, GENERATOR_NAMES, resolveConfig, type AttentionConfig, type EngineConfig, type EngineConfigInput } from "../../config.ts";
import type { AppPack, EligibilityPolicy } from "../../pack.ts";
import type { World } from "../../world.ts";
import { slopAdjust, slopAssign } from "./assign.ts";
import { ageBand, distancePhrase, SLOP_ASK_QUESTIONS, SLOP_FACET_PHRASE, SLOP_LANE_ACTIVITY, SLOP_LANE_LABEL, SLOP_SAFE_FALLBACK, slopProbeText } from "./copy.ts";
import { makeRadiusGeo, mutualMarkets } from "./geo.ts";
import { runDegree, slopGenerators } from "./generators.ts";
import { limitMiles } from "./geo.ts";
import { slopOptions, type DeepPartial, type SlopPackOptions } from "./options.ts";
import { slopProfiles } from "./profile.ts";
import { missingFields, needsBasics, reviewReason, SLOP_CANDIDATE_PRE_RULES, SLOP_LANE, slopMemberRules, slopPairRules } from "./rules.ts";
import { aggregate } from "./score.ts";
import { slopJudge } from "./judge.ts";
import { distanceBand } from "./zips.ts";

export const SLOP_PACK_VERSION = "slop-pack-1.4.0";

/**
 * Engine config for slop.date runs (pass as runEngine's config; the pack travels in deps.pack).
 * The weights make the score the reciprocal value itself: NetValue = mutualBenefit x confidence.
 */
export const SLOP_ENGINE_CONFIG: EngineConfigInput = {
  cities: ["sf", "nyc", "la"],
  timezones: { sf: "America/Los_Angeles", nyc: "America/New_York", la: "America/Los_Angeles" },
  windowDays: 7, minOverlapHours: 3, ageMin: 18,
  budgets: { normal: { limit: 2, periodDays: 7 }, open: { limit: 2, periodDays: 7 }, receiving: { limit: 2, periodDays: 7 } },
  thresholds: { byState: { open: 0, normal: 0, quiet: 0, receiving: 0 }, byCategory: { romance: 0, help: 0, growth: 0 }, useByGenerator: false, exploration: 0 },
  floors: { fit: 0, mutualBenefit: 0, confidence: 0, maxSocialRisk: 1, judgeDimension: 0 },
  weights: { fit: 0, mutualBenefit: 1, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0 },
  complementarity: { weight: 0 },
  generators: Object.fromEntries(GENERATOR_NAMES.map(g => [g, false])) as Record<(typeof GENERATOR_NAMES)[number], boolean>,
  exploration: { rate: 0, maxShare: 0.15 },
  romance: { requireStatedPrefs: true },
  dispatch: { skipOpenOpportunities: true, billOnlySent: true },
  personalGrowthAsHobby: false,
};
export const SLOP_ENGINE_DEFAULTS: EngineConfig = resolveConfig(SLOP_ENGINE_CONFIG);
/** Attention: romance always ships alone (never in a digest); otherwise the shared v1.2 defaults. */
export const SLOP_ATTENTION: AttentionConfig = { ...DEFAULT_ATTENTION, romanceInDigest: false };

export function makeSlopPack(over: DeepPartial<SlopPackOptions> = {}): AppPack & { options: SlopPackOptions } {
  const o = slopOptions(over);
  const eligibility: EligibilityPolicy = {
    minMatchAge: 18,
    // Founder decision: 13-17 may join slop.date but are never matched (the core rule stands).
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
      lanes: [{ id: SLOP_LANE, label: "dating", optIn: "explicit_mutual", adultOnly: true, shipsAlone: true, neverInPlans: true }],
      roles: [{ id: "seeker", contributor: false }, { id: "peer", contributor: false }],
      kinds: [{ id: "intro", format: "one_to_one", size: [2, 2] }],
      contributorRoles: new Set(),
      // Dating has no warm graph: a "friend of" never routes a date (and a minor never could).
      warmEdges: new Set(),
      funnelProbe: { lane: SLOP_LANE, role: "peer" },
      objectives: [{ id: "date", pattern: /\bdate|dating|romance\b/i, needs: [], interests: [], romance: true }],
      objectivesFor: () => [],
      mutualPreferenceMatch: (w, a, b) => {
        const P = slopProfiles(w.input, w.canonical), pa = P.get(a), pb = P.get(b);
        return !!pa?.is && !!pb?.is && pa.seeks.includes(pb.is) && pb.seeks.includes(pa.is);
      },
      // Constraints are read from typed profiles (profile.ts); this view feeds the core's romance shape.
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
    retrieval: { channels: ["geo", "tag"], directions: [{ from: "member", to: "member" }] },
    scoring: {
      objective: "reciprocal",
      aggregate: xs => aggregate(xs, o.aggregate),
      // Dating carries social risk for both people; the score stays the reciprocal value (weight 0).
      socialRisk: (_c, v) => v + 0.1,
    },
    selection: {
      adjust: (w, c, value) => slopAdjust(o, w, c, value, w.input.exposureDebt ?? {}),
      assign: (w, scored, ctx) => slopAssign(o, w, scored, ctx),
      askQuestions: SLOP_ASK_QUESTIONS,
      extraAsksEnabled: () => o.asks || o.compatAsks,
      // Ask instead of proposing: unknown orientation, age range or distance (holds the member back
      // until answered, via the needs_answer rule); goal / dealbreakers / basics (does not hold back).
      extraAsks: (w, id, _mi, lastAsk, add) => {
        const p = slopProfiles(w.input, w.canonical).get(id);
        if (!p || !p.adult || !p.optedIn || p.paused || w.holds.has(id) || reviewReason(p, o)) return;
        const intent = w.get(id)!.intents.find(i => i.category === SLOP_LANE);
        const fs = missingFields(p, o);
        // Iteration 2: each question at most `maxAsksPerField` times (0 = no cap), then wait for the member.
        const capped = (reason: string) => o.maxAsksPerField > 0 && (p.askCounts[reason] ?? 0) >= o.maxAsksPerField;
        if (fs.length) {
          // One message asks every missing hard-filter field; re-asked at most weekly until answered.
          for (const f of fs) if (w.now - lastAsk([`slop_${f}`]) >= 7 * DAY && !capped(`slop_${f}`)) add(`slop_${f}`, intent?.id);
          return;
        }
        // Iteration 2: a small pool -> ask once whether they would consider a wider radius.
        if (o.widen.enabled && (runDegree.get(w)?.get(id) ?? Infinity) <= o.widen.maxDegree && (limitMiles(p, o) ?? Infinity) < o.widen.miles && !(p.askCounts.slop_widen ?? 0)) add("slop_widen", intent?.id);
        // Compatibility questions (one message; never re-asked within 3 weeks): basics, then type.
        if (!o.compatAsks) return;
        if (needsBasics(p) && w.now - lastAsk(["slop_basics"]) >= 21 * DAY) add("slop_basics", intent?.id);
        if (o.typeAsk && (!p.wants || !p.self) && w.now - lastAsk(["slop_type"]) >= 21 * DAY) add("slop_type", intent?.id);
      },
    },
    consent: {
      // Founder decision: probe first (the member with the live want first, then the other on a yes),
      // then the reveal is the booked first date the agent planned, with an easy opt-out.
      default: { kind: "probe_first", order: "wanter_first", reveal: "opt_out", anonymousProbe: true },
      byKind: {},
    },
    attention: {
      config: SLOP_ATTENTION,
      // Placeholder knots (score -> P(enjoy)); not fitted yet: refit on slop pilot labels.
      calibrator: { knots: [[0, 0.05], [0.3, 0.25], [0.6, 0.5], [1, 0.75]], byLane: {} },
      shipsAloneLane: SLOP_LANE,
      noWarmMentionLanes: [SLOP_LANE],
      itemGate: (m, it) => (it.category === SLOP_LANE && (!(typeof m.age === "number" && Number.isFinite(m.age) && m.age >= 18) || !(m.categoriesOptIn ?? [SLOP_LANE]).includes(SLOP_LANE)) ? "romance_not_allowed" : null),
      probeAllowed: (lane, n) => lane === SLOP_LANE && n === 1,
      laneActivity: SLOP_LANE_ACTIVITY,
      probeText: (ctx, activity, attribute) => slopProbeText(ctx, activity, attribute),
      cadenceDefaults: () => ({ romanceInDigest: false }),
    },
    explain: {
      laneLabel: SLOP_LANE_LABEL,
      facetPhrase: SLOP_FACET_PHRASE,
      // One or two sentences from shareable facts only, framed as a guess; the distance as a band.
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
      // Lane words from slop's facet templates that say nothing about anyone (everyone here is dating).
      publicWords: ["date", "dates", "dating", "first", "they", "their", "they're", "theyre"],
    },
    // Pass 2 dating rubric (judge.ts): runs only when the engine has an LLM; the no-LLM path is unchanged.
    judge: slopJudge(o),
    capital: {
      earn: ["attendance", "review"],
      lose: ["no_show", "ghosting", "abuse", "fraud"],
      minorsExcluded: true,
    },
    metrics: {
      primary: ["secondDateRate", "secondDatesPerSeed", "datesPerMemberMonth", "mutualYesRate"],
      gates: [
        { metric: "safety.minorContacts", op: "==", value: 0, seeds: 4, blocking: true },
        { metric: "safety.adversaryContactCut", op: ">=", value: 0.9, seeds: 4, blocking: true },
        { metric: "safety.harmCut", op: ">=", value: 0.9, seeds: 4, blocking: true },
        { metric: "secondDateRateVsRandom", op: ">=", value: 2.5, seeds: 4, blocking: true },
        { metric: "congestion.top10ProposalShare", op: "<=", value: 0.2, seeds: 4, blocking: true },
        { metric: "fairness.minGroupRatio", op: ">=", value: 0.7, seeds: 4, blocking: true },
        { metric: "backoutRate", op: "<=", value: 0.099, seeds: 4, blocking: true },
      ],
      unsafeClasses: ["minor", "hiddenMinor", "adversary"],
    },
    defaults: { engine: SLOP_ENGINE_DEFAULTS, attention: SLOP_ATTENTION, plans: DEFAULT_PLANS },
  };
}

/** slop.date's pack with the tuned defaults. */
export const slopPack = makeSlopPack();

export { slopOptions, SLOP_DEFAULT_OPTIONS, type SlopPackOptions } from "./options.ts";
export { slopProfiles, SLOTS, type SlopProfile, type Slot } from "./profile.ts";
export { planFirstDate, planFromInput, probePhotoRefs, PROBE_PHOTO_MAX, PUBLIC_VENUE, type DatePlan, type ProbePhotoRef, type ProbePhotoSubject } from "./plan.ts";
export { distanceBand, cellOfZip, ZIPS as SLOP_ZIPS, type DistanceBand } from "./zips.ts";
export { ageBand, SLOP_ASK_QUESTIONS, SLOP_PROBE_PHOTO_LINE, slopProbeMessage, slopProbeText } from "./copy.ts";
export { mutualMarkets } from "./geo.ts";
export { adultsOnly, appearanceFacet, appearanceLeak, APPEARANCE_LEAK_PATTERNS, BODY_TYPES, canRatePhotos, ClipAppearanceRater, parseAppearance, rateMember, VisionLlmAppearanceRater, VISION_RATER_SYSTEM, type AppearanceRater, type AppearanceScore, type BodyType, type PhotoRef, type RatingSubject, type VisionChat } from "./appearance.ts";
export { CLEF_FEATURES, CLEF_MODEL_IDS, CLEF_QUESTIONS, ClefError, clefFeatures, applyHead, makeClefRater, makeClefRaterFromEnv, WorkersAIClefRater, type ClefModel, type ClefRaterOptions } from "./clef.ts";
export { DEFAULT_CLEF_WEIGHTS, loadClefWeights, validateClefWeights, type ClefWeights } from "./clefWeights.ts";
export { biasMonitor, ratingQuintiles, type BiasReport, type MemberOutcome } from "./biasMonitor.ts";
export { pairValue, firstOf, SLOP_GENERATOR } from "./generators.ts";
export { extractSlopProfile, extractSlopProfileLLM, llmSlopReader, slopReaderPrompt, validateSlopReading, slopOnboardTags, readMessage, emptyOnboarding, hardFilled, hasField, coarsePlace, HARD_FIELDS, DEALBREAKER_IDS, DATE_ACTIVITY_IDS, LLM_FILL_BELOW, type SlopOnboarding, type OnboardField, type HardField, type Field, type Evidence, type Distance, type Location, type ExtractOptions, type SlopReader, type SlopTag, type Dealbreaker, type DateActivity } from "./extract.ts";
export { readBack, readBackFacts, applyCorrection, nextQuestion, markAsked, hardComplete, SLOP_ONBOARD_QUESTIONS, READBACK_FIELDS, MAX_ASKS_PER_QUESTION, type ReadBackFact } from "./onboard.ts";
export { slopJudge, slopJudgeContext, SLOP_JUDGE_SYSTEM, SLOP_JUDGE_VERSION } from "./judge.ts";
