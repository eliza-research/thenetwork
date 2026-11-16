// The generic, pack-free matching core.
export {
  buildProfiles, defaultTags, internTags, isEntityId, laneCategory, partnerSide,
  type EntityId, type EntityStanding, type EntityTags, type MatchEntity, type MatchProfile, type Membership,
  type PackTraits, type PackVectors, type TagInterner, type TagSet,
} from "./profile.ts";
export { eligiblePair, intersectCount, pairSideOf, pairValueOf, utilityTerms } from "./pair.ts";
export { buildCandidateIndex, partnerBlock, type CandidateBlock, type CandidateIndex, type Postings } from "./index.ts";
export {
  bruteForceCandidates, emptySearchTally, mutualEdges, searchCandidates, tallySearch,
  type MatchEdge, type RankedProfile, type SearchResult,
} from "./search.ts";
export { buildCircles, type Circle } from "./circles.ts";
export { existingFriendPlanPairValues, MatchRun } from "./run.ts";
export { standingEvidenceKey, standingKey } from "./standing.ts";
