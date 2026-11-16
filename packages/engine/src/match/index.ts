// The candidate index: blocks of compatible partners sorted by (standing, ordinal), with one posting
// list per tag for offers, seeks and interests. A posting holds block positions in ascending order,
// so it is sorted by (standing, ordinal) too, and a standing window is one binary-search range in
// every posting. Memory is O(total tags); the build is one sort per block, O(T log T).
import { blockKey, partnerSide, type MatchProfile } from "./profile.ts";

/** Tag id -> positions in `CandidateBlock.profiles`, ascending. */
export type Postings = ReadonlyMap<number, readonly number[]>;

export interface CandidateBlock {
  /** Sorted by (standing asc, ordinal asc). */
  readonly profiles: readonly MatchProfile[];
  readonly byOrdinal: ReadonlyMap<number, MatchProfile>;
  readonly offers: Postings;
  readonly seeks: Postings;
  readonly interests: Postings;
}

export interface CandidateIndex { readonly blocks: ReadonlyMap<string, CandidateBlock> }

function postingsOf(profiles: readonly MatchProfile[], tags: (p: MatchProfile) => readonly number[]): Postings {
  const postings = new Map<number, number[]>();
  profiles.forEach((p, position) => {
    for (const tag of tags(p)) {
      const posting = postings.get(tag);
      if (posting) posting.push(position); else postings.set(tag, [position]);
    }
  });
  return postings;
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
    blocks.set(key, {
      profiles: sorted,
      byOrdinal: new Map(sorted.map(p => [p.ordinal, p] as const)),
      offers: postingsOf(sorted, p => p.offers),
      seeks: postingsOf(sorted, p => p.seeks),
      interests: postingsOf(sorted, p => p.interests),
    });
  }
  return { blocks };
}

/** The block of compatible partners of `profile` in its market. */
export const partnerBlock = (index: CandidateIndex, profile: MatchProfile): CandidateBlock | undefined =>
  index.blocks.get(blockKey(profile.lane, partnerSide(profile.lane, profile.side), profile.market));
