// networkPack: The Network (ntwrk) as an AppPack. Matching runs on the generic match core
// (packages/engine/src/match): `vectors` gives ntwrk's lane memberships, tags and private standing,
// and the generators read pairs and circles from it.
//
// Import-cycle safety: this module is imported by world.ts, engine.ts, attention.ts and plans.ts
// for their default `pack` argument (evaluated at call time). Its top level therefore reads only
// leaf data; function values from non-leaf modules are wrapped in arrows, and `generators` and
// `vectors` are getters.
import { canBeMatched } from "@thenetwork/core";
import { DEFAULT_ATTENTION } from "../../config.ts";
import { cityBucketGeo } from "../../geo.ts";
import type { PackVectors } from "../../match/profile.ts";
import type { AppPack, EligibilityPolicy, GeneratorSpec } from "../../pack.ts";
import { buildPassContext } from "./judgeContext.ts";
import { ACTIVITIES } from "./activities.ts";
import { ASK_QUESTIONS, GENERIC_ACTIVITY, KIND_PHRASE, NETWORK_SAFE_FALLBACK, networkKindBits, networkLeadBits, networkProbeText } from "./copy.ts";
import { NETWORK_GENERATORS } from "./generators.ts";
import { networkOntology } from "./ontology.ts";
import {
  DEEP_PROMPT_VERSION, DEEP_SYSTEM, JUDGE_PROMPT_VERSION, JUDGE_PROMPT_VERSION_V3, JUDGE_SYSTEM, JUDGE_SYSTEM_V3, SCREEN_PROMPT_VERSION, SCREEN_SYSTEM,
} from "./prompts.ts";
import { NETWORK_CANDIDATE_POST_RULES, NETWORK_CANDIDATE_PRE_RULES, NETWORK_MEMBER_RULES, NETWORK_PAIR_RULES, networkHardGate } from "./rules.ts";
import { networkVectors } from "./vectors.ts";

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

export const networkPack: AppPack = {
  id: "ntwrk",
  version: NETWORK_PACK_VERSION,
  ontology: networkOntology,
  // A getter: rules.ts sits in the filters / world import cycle.
  get eligibility(): EligibilityPolicy { return eligibility(); },
  geo: cityBucketGeo,
  get generators(): readonly GeneratorSpec[] { return NETWORK_GENERATORS; },
  get vectors(): PackVectors { return networkVectors; },
  scoring: {
    novelty: (c, v) => (c.kind === "second_encounter" ? 0.4 : v),
    socialRisk: (c, v) => (c.category === "romance" ? v + 0.1 : v),
  },
  selection: {
    // No pack asks: ntwrk offers no Date lane (laneOffered), so a romance preference question would ask for nothing it can use.
    askQuestions: ASK_QUESTIONS,
  },
  consent: {
    // Attention v1.2 iteration 4: wanter first, the reveal is the booked plan with an easy opt-out.
    default: { kind: "probe_first", order: "wanter_first", reveal: "opt_out", anonymousProbe: true },
    byKind: { group: { kind: "group_rsvp", quorum: 3, lateJoinHours: 6 }, event_coattend: { kind: "group_rsvp", quorum: 2, lateJoinHours: 6 } },
  },
  attention: {
    config: DEFAULT_ATTENTION,
    shipsAloneLane: "romance",
    noWarmMentionLanes: ["romance"],
    itemGate: (m, it) => (it.category === "romance" && (!canBeMatched(m.age) || !(m.categoriesOptIn ?? []).includes("romance")) ? "romance_not_allowed" : null),
    probeAllowed: (lane, othersCount) => !(lane === "romance" && othersCount !== 1),
    laneActivity: GENERIC_ACTIVITY,
    probeText: (ctx, activity, a, ar) => networkProbeText(ctx, activity, a, ar),
  },
  judge: {
    screen: { version: SCREEN_PROMPT_VERSION, system: SCREEN_SYSTEM },
    rubric: { compact: { version: JUDGE_PROMPT_VERSION, system: JUDGE_SYSTEM }, matchable: { version: JUDGE_PROMPT_VERSION_V3, system: JUDGE_SYSTEM_V3 } },
    deep: { version: DEEP_PROMPT_VERSION, system: DEEP_SYSTEM },
    buildContext: (w, c, visibility) => buildPassContext(w, c, visibility),
    hardGate: (w, c) => networkHardGate(w, c),
  },
  explain: {
    facetPhrase: KIND_PHRASE,
    leadBits: (_w, c) => networkLeadBits(c),
    kindBits: (_w, c, me) => networkKindBits(c, me),
    safeFallback: NETWORK_SAFE_FALLBACK,
  },
  plans: { lane: "social", activities: ACTIVITIES },
};
