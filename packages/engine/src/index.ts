export { runEngine, type EngineDeps, type EngineResult } from "./engine.ts";
export { DEFAULT_CONFIG, ENGINE_VERSION, GENERATOR_NAMES, configHash, resolveConfig, type EngineConfig, type EngineConfigInput, type GeneratorName } from "./config.ts";
export * from "./types.ts";
export { localEmbed, cosine, tokenize, type EmbedFn } from "./embed.ts";
export { JudgeCache, judgeCacheKey, parseVerdict, buildJudgeMessages, judgeOne } from "./judge.ts";
export { candidateReason, memberReason, pairReason, type FilterReason } from "./filters.ts";
export { composeGroup } from "./group.ts";
export { gini, lorenz } from "./policy.ts";
export { harmonic, mutualBenefit, netValue } from "./scoring.ts";
export { World, buildWorld } from "./world.ts";
export { EngineRng as Rng } from "@thenetwork/core";
export * as attention from "./attention.ts";
export { DEFAULT_ATTENTION, resolveAttention, attentionConfigHash, type AttentionConfig, type AttentionConfigInput } from "./config.ts";
export * as plans from "./plans.ts";
export { DEFAULT_PLANS, resolvePlans, plansConfigHash, type PlansConfig, type PlansConfigInput } from "./config.ts";
// App packs (docs/results/2026-10-08-app-packs-core.md): the contract, the core geo model and networkPack.
export * from "./pack.ts";
export { cityBucketGeo } from "./geo.ts";
export { networkPack, NETWORK_PACK_VERSION } from "./packs/network/index.ts";
// slopPack (docs/results/2026-10-08-slop-pack.md): slop.date on the shared engine.
export { slopPack, makeSlopPack, SLOP_PACK_VERSION, probePhotoRefs, slopProbeMessage, SLOP_PROBE_PHOTO_LINE, type ProbePhotoRef, type ProbePhotoSubject, SLOP_ENGINE_CONFIG, SLOP_ENGINE_DEFAULTS, slopOptions, SLOP_DEFAULT_OPTIONS, planFirstDate, planFromInput, slopProfiles, distanceBand, canRatePhotos, adultsOnly, rateMember, appearanceFacet, ClipAppearanceRater, VisionLlmAppearanceRater, type AppearanceRater, type AppearanceScore, type RatingSubject, type SlopPackOptions, type DatePlan, type SlopProfile } from "./packs/slop/index.ts";
// friendsPack (docs/results/2026-10-08-friends-pack.md): friends.help on the shared engine.
export { friendsPack, friendsGeo, FRIENDS_PACK_VERSION, FRIENDS_PLANS, DEFAULT_FRIENDS_POLICY, planFriendsWeek, nextSameSlot, friendsProbeText, ROMANCE_FRAMING, attendedGroup, type FriendsPolicy, type FriendsPlan, type FriendsWeek, type FriendsWeekInput } from "./packs/friends/index.ts";
export * as friendsKit from "./packs/friends/index.ts";
// peonPack (docs/results/2026-10-08-peon-pack.md): peon.biz on the shared engine.
export { peonPack, PEON_PACK_VERSION, PEON_ENGINE_CONFIG } from "./packs/peon/index.ts";
export * as peonKit from "./packs/peon/index.ts";
// Relay through the agent after a match (docs/results/2026-10-09-relay.md).
export { relayItem, relayItemAsync, relayGuard, classifyRelayText, parseRelayRequest, pastContacts, threadMessage, isOpaquePhotoId, RELAY_POLICY_VERSION, RELAY_LIMITS, RELAY_RULES, RELAY_REASON_FAMILIES, RELAY_WORDING, MINOR_SIGNAL, type RelayKind, type RelayDecision, type RelayParty, type RelayOpportunity, type RelayConsent, type RelayItem, type RelayLimits, type RelayRecord, type RelayContext, type RelayResult, type RelayClassifierHook, type RelayRequest, type RelayThreadMessage } from "./relay.ts";
