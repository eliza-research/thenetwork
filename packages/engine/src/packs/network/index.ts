// networkPack: The Network (ntwrk) as an AppPack. Every value here is the pre-refactor behaviour,
// moved verbatim behind the contract (docs/results/2026-10-08-app-packs-core.md lists what moved).
// The goldens (test/golden.test.ts) prove the engine, attention, plans, judge and sim outputs are
// byte-identical with this pack.
//
// Import-cycle safety: this module is imported by world.ts, engine.ts, attention.ts and plans.ts
// for their default `pack` argument (evaluated at call time). Its top level therefore reads only
// leaf data; function values from non-leaf modules are wrapped in arrows, and `generators` is a
// getter.
import { DEFAULT_ATTENTION, DEFAULT_CONFIG, DEFAULT_PLANS } from "../../config.ts";
import { cityBucketGeo } from "../../geo.ts";
import { mutualBenefit } from "../../scoring.ts";
import type { AppPack, EligibilityPolicy, GeneratorSpec } from "../../pack.ts";
import { buildPassContext } from "./judgeContext.ts";
import { ACTIVITIES } from "./activities.ts";
import { DEFAULT_ENJOY_BY_CATEGORY, DEFAULT_ENJOY_KNOTS } from "./calibrator.ts";
import { ASK_QUESTIONS, CATEGORY_LABEL, GENERIC_ACTIVITY, KIND_PHRASE, NETWORK_SAFE_FALLBACK, networkKindBits, networkLeadBits, networkProbeText } from "./copy.ts";
import { NETWORK_GENERATORS } from "./generators.ts";
import { networkOntology } from "./ontology.ts";
import {
  DEEP_PROMPT_VERSION, DEEP_SYSTEM, JUDGE_PROMPT_VERSION, JUDGE_PROMPT_VERSION_V3, JUDGE_SYSTEM, JUDGE_SYSTEM_V3, SCREEN_PROMPT_VERSION, SCREEN_SYSTEM,
} from "./prompts.ts";
import { NETWORK_CANDIDATE_POST_RULES, NETWORK_CANDIDATE_PRE_RULES, NETWORK_MEMBER_RULES, NETWORK_PAIR_RULES, networkHardGate } from "./rules.ts";
import { memberReason } from "../../filters.ts";

let elig: EligibilityPolicy | undefined;
const eligibility = (): EligibilityPolicy => (elig ??= {
  minMatchAge: 18,
  // Founder decision 2026-10-05: 13-17 may join and use the agent alone; never matched or connected.
  accountTiers: [{ minAge: 13, maxAge: 17, matchable: false, label: "personal agent (13-17)" }],
  memberRules: NETWORK_MEMBER_RULES,
  pairRules: NETWORK_PAIR_RULES,
  candidatePreRules: NETWORK_CANDIDATE_PRE_RULES,
  candidatePostRules: NETWORK_CANDIDATE_POST_RULES,
});

/** Pack version. Not written to run logs for networkPack (byte-identity rule 2). */
export const NETWORK_PACK_VERSION = "network-pack-1.0.0";

/** Rubric keys of pass 3 (was judgeDeep.ts RUBRIC_KEYS; that module still exports them). */
const RUBRIC_KEYS = ["mutual_benefit", "reciprocity", "intent_timing", "logistics", "stage_fit", "values_energy", "novelty", "evidence_quality", "risk_safety"] as const;

export const networkPack: AppPack = {
  id: "ntwrk",
  version: NETWORK_PACK_VERSION,
  ontology: networkOntology,
  // A getter: rules.ts sits in the filters / world import cycle.
  get eligibility(): EligibilityPolicy { return eligibility(); },
  geo: cityBucketGeo,
  get generators(): readonly GeneratorSpec[] { return NETWORK_GENERATORS; },
  retrieval: {
    channels: ["semantic", "tag", "graph", "need", "exposure_floor"],
    directions: [{ from: "intent", to: "member" }],
  },
  scoring: {
    objective: "reciprocal",
    aggregate: benefits => mutualBenefit(benefits),
    novelty: (c, v) => {
      let novelty = v;
      if (c.kind === "expansion") novelty = Math.max(novelty, 0.9);
      if (c.kind === "second_encounter") novelty = 0.4;
      return novelty;
    },
    socialRisk: (c, v) => (c.category === "romance" ? v + 0.1 : v),
  },
  selection: {
    askQuestions: ASK_QUESTIONS,
    extraAsksEnabled: cfg => cfg.romance.requireStatedPrefs,
    // v1.2: a member with a live romance intent but no stated preferences is asked for them (was policy.ts planAsks).
    extraAsks: (w, id, mi, lastAsk, add) => {
      if (!mi.romance?.seeks.length) {
        const it = mi.intents.find(i => i.category === "romance");
        if (it && lastAsk(["romance_prefs"]) === -Infinity && !memberReason(w, id, { category: "romance", role: "peer", format: "one_to_one", timeSensitive: false, ownIntentCreatedAt: it.createdAt })) add("romance_prefs", it.id);
      }
    },
  },
  consent: {
    // Attention v1.2 iteration 4: wanter first, the reveal is the booked plan with an easy opt-out.
    default: { kind: "probe_first", order: "wanter_first", reveal: "opt_out", anonymousProbe: true },
    byKind: { group: { kind: "group_rsvp", quorum: 3, lateJoinHours: 6 }, event_coattend: { kind: "group_rsvp", quorum: 2, lateJoinHours: 6 } },
  },
  attention: {
    config: DEFAULT_ATTENTION,
    calibrator: { knots: DEFAULT_ENJOY_KNOTS, byLane: DEFAULT_ENJOY_BY_CATEGORY },
    shipsAloneLane: "romance",
    noWarmMentionLanes: ["romance"],
    // Was attention.ts itemGate: romance items only for opted-in adults. A view without
    // categoriesOptIn has no romance consent: fail closed (engine-attention-plans-7).
    itemGate: (m, it) => (it.category === "romance" && (!(typeof m.age === "number" && Number.isFinite(m.age) && m.age >= 18) || !(m.categoriesOptIn ?? []).includes("romance")) ? "romance_not_allowed" : null),
    probeAllowed: (lane, othersCount) => !(lane === "romance" && othersCount !== 1),
    laneActivity: GENERIC_ACTIVITY,
    probeText: (ctx, activity, a, ar) => networkProbeText(ctx, activity, a, ar),
    cadenceDefaults: cfg => ({ romanceInDigest: cfg.romanceInDigest }),
  },
  judge: {
    screen: { version: SCREEN_PROMPT_VERSION, system: SCREEN_SYSTEM },
    rubric: { compact: { version: JUDGE_PROMPT_VERSION, system: JUDGE_SYSTEM }, matchable: { version: JUDGE_PROMPT_VERSION_V3, system: JUDGE_SYSTEM_V3 } },
    deep: { version: DEEP_PROMPT_VERSION, system: DEEP_SYSTEM },
    rubricKeys: RUBRIC_KEYS,
    buildContext: (w, c, visibility) => buildPassContext(w, c, visibility),
    hardGate: (w, c) => networkHardGate(w, c),
  },
  explain: {
    laneLabel: CATEGORY_LABEL,
    facetPhrase: KIND_PHRASE,
    leadBits: (_w, c) => networkLeadBits(c),
    kindBits: (_w, c, me) => networkKindBits(c, me),
    safeFallback: NETWORK_SAFE_FALLBACK,
  },
  plans: { config: DEFAULT_PLANS, lane: "social", activities: ACTIVITIES },
  capital: {
    earn: ["vouch", "attendance", "help", "organizing", "needs_answered", "review", "feedback"],
    lose: ["vouch_stake", "no_show", "ghosting", "abuse", "clawback", "fraud"],
    minorsExcluded: true,
  },
  sim: { module: "packages/sim/src/pack.ts", export: "networkSimPack" },
  metrics: {
    primary: ["met_worthwhile_per_seed", "precision", "worthwhile_rate", "v14"],
    gates: [
      { metric: "unsafe.minor", op: "==", value: 0, seeds: 8, blocking: true },
      { metric: "privacy.canaryLeaks", op: "==", value: 0, seeds: 8, blocking: true },
      { metric: "invariants.violations", op: "==", value: 0, seeds: 8, blocking: true },
      { metric: "safety.minorContacts", op: "==", value: 0, seeds: 8, blocking: true },
    ],
    unsafeClasses: ["minor", "adversarial", "cityMismatch", "romanceMismatch", "exPartners"],
  },
  defaults: { engine: DEFAULT_CONFIG, attention: DEFAULT_ATTENTION, plans: DEFAULT_PLANS },
};
