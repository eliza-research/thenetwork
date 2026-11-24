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
  accountTiers: [{ minAge: 13, maxAge: 17, matchable: false, label: "personal agent (13-17)" }],
  memberRules: NETWORK_MEMBER_RULES,
  pairRules: NETWORK_PAIR_RULES,
  candidatePreRules: NETWORK_CANDIDATE_PRE_RULES,
  candidatePostRules: NETWORK_CANDIDATE_POST_RULES,
});

export const NETWORK_PACK_VERSION = "network-pack-1.0.0";

export const networkPack: AppPack = {
  id: "ntwrk",
  version: NETWORK_PACK_VERSION,
  ontology: networkOntology,
  get eligibility(): EligibilityPolicy { return eligibility(); },
  geo: cityBucketGeo,
  get generators(): readonly GeneratorSpec[] { return NETWORK_GENERATORS; },
  get vectors(): PackVectors { return networkVectors; },
  scoring: {
    novelty: (c, v) => (c.kind === "second_encounter" ? 0.4 : v),
    socialRisk: (c, v) => (c.category === "romance" ? v + 0.1 : v),
  },
  selection: {
    askQuestions: ASK_QUESTIONS,
  },
  consent: {
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
