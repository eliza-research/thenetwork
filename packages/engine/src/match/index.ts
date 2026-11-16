// The candidate index: blocks of compatible partners, sorted by standing, cut into fixed buckets
// whose summaries bound every pair value inside them. Built in O(N log N).
import { blockKey, partnerSide, type MatchProfile, type TagSet } from "./profile.ts";

export const candidateBucketSize = 32;

export interface BucketSummary {
  readonly standingLow: number;
  readonly standingHigh: number;
  readonly unionOffers: TagSet;
  readonly unionSeeks: TagSet;
  readonly unionInterests: TagSet;
  /** Smallest non-empty seeks size in the bucket (0 when every seeks set is empty). */
  readonly leastSeeks: number;
  /** Smallest non-empty interests size in the bucket (0 when every interests set is empty). */
  readonly leastInterests: number;
  readonly traitLow: readonly number[];
  readonly traitHigh: readonly number[];
}

export interface CandidateBlock {
  /** Sorted by (standing asc, ordinal asc); bucket k holds positions [k * size, (k + 1) * size). */
  readonly profiles: readonly MatchProfile[];
  readonly buckets: readonly BucketSummary[];
  readonly byOrdinal: ReadonlyMap<number, MatchProfile>;
}

export interface CandidateIndex { readonly blocks: ReadonlyMap<string, CandidateBlock> }

const unionOf = (sets: readonly TagSet[]): TagSet => [...new Set(sets.flat())].sort((x, y) => x - y);
const leastNonEmpty = (sizes: readonly number[]): number => sizes.reduce((least, n) => (n > 0 && (least === 0 || n < least) ? n : least), 0);

function summarize(bucket: readonly MatchProfile[]): BucketSummary {
  const dims = bucket[0]?.traits.length ?? 0;
  const column = (d: number) => bucket.map(p => p.traits[d]);
  return {
    standingLow: Math.min(...bucket.map(p => p.standing)),
    standingHigh: Math.max(...bucket.map(p => p.standing)),
    unionOffers: unionOf(bucket.map(p => p.offers)),
    unionSeeks: unionOf(bucket.map(p => p.seeks)),
    unionInterests: unionOf(bucket.map(p => p.interests)),
    leastSeeks: leastNonEmpty(bucket.map(p => p.seeks.length)),
    leastInterests: leastNonEmpty(bucket.map(p => p.interests.length)),
    traitLow: Array.from({ length: dims }, (_, d) => Math.min(...column(d))),
    traitHigh: Array.from({ length: dims }, (_, d) => Math.max(...column(d))),
  };
}

export function buildCandidateIndex(profiles: readonly MatchProfile[]): CandidateIndex {
  const groups = new Map<string, MatchProfile[]>();
  for (const p of profiles) {
    const key = blockKey(p.lane, p.side, p.market);
    const group = groups.get(key);
    if (group) group.push(p); else groups.set(key, [p]);
  }
  const blocks = new Map<string, CandidateBlock>();
  for (const [key, group] of groups) {
    const sorted = [...group].sort((x, y) => x.standing - y.standing || x.ordinal - y.ordinal);
    const buckets: BucketSummary[] = [];
    for (let start = 0; start < sorted.length; start += candidateBucketSize) buckets.push(summarize(sorted.slice(start, start + candidateBucketSize)));
    blocks.set(key, { profiles: sorted, buckets, byOrdinal: new Map(sorted.map(p => [p.ordinal, p] as const)) });
  }
  return { blocks };
}

/** The block of compatible partners of `profile` in its market. */
export const partnerBlock = (index: CandidateIndex, profile: MatchProfile): CandidateBlock | undefined =>
  index.blocks.get(blockKey(profile.lane, partnerSide(profile.lane, profile.side), profile.market));
