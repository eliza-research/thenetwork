import { blockKey, compareText, partnerSide, type MatchProfile } from "./profile.ts";

export type Postings = ReadonlyMap<number, readonly number[]>;

export interface Span { readonly start: number; readonly end: number }
export interface SegmentSpan extends Span { readonly segment: string | undefined; readonly packClasses: readonly number[] }

export interface CandidateBlock {
  readonly profiles: readonly MatchProfile[];
  readonly segments: readonly SegmentSpan[];
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

function compareSegment(x: MatchProfile, y: MatchProfile): number {
  const a = x.segment?.own, b = y.segment?.own;
  if (a === b) return 0;
  if (a === undefined) return -1;
  if (b === undefined) return 1;
  return compareText(a, b);
}

function packClassesOf(profiles: readonly MatchProfile[]): number[] {
  const classes = new Set<number>();
  for (const p of profiles) if (p.packClass !== undefined) classes.add(p.packClass);
  return [...classes].sort((x, y) => x - y);
}

function segmentsOf(sorted: readonly MatchProfile[]): SegmentSpan[] {
  const spans: SegmentSpan[] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && compareSegment(sorted[i - 1], sorted[i]) === 0) continue;
    spans.push({ segment: sorted[start].segment?.own, start, end: i, packClasses: packClassesOf(sorted.slice(start, i)) });
    start = i;
  }
  return spans;
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
    const sorted = [...group].sort((x, y) => compareSegment(x, y) || x.standing - y.standing || x.ordinal - y.ordinal);
    blocks.set(key, {
      profiles: sorted,
      segments: segmentsOf(sorted),
      byOrdinal: new Map(sorted.map(p => [p.ordinal, p] as const)),
      offers: postingsOf(sorted, p => p.offers),
      seeks: postingsOf(sorted, p => p.seeks),
      interests: postingsOf(sorted, p => p.interests),
    });
  }
  return { blocks };
}

export const partnerBlock = (index: CandidateIndex, profile: MatchProfile): CandidateBlock | undefined =>
  index.blocks.get(blockKey(profile.lane, partnerSide(profile.lane, profile.side), profile.market));
