// The candidate index: blocks of compatible partners sorted by (segment, standing, ordinal), with one
// posting list per tag for offers, seeks and interests. Each segment is one range of block positions,
// so a standing window inside a segment is one binary-search range. A posting holds block positions
// in ascending order, so the window of a segment is one binary-search range in every posting too.
// Memory is O(total tags); the build is one sort per block, O(T log T).
import { blockKey, compareText, partnerSide, type MatchProfile } from "./profile.ts";

/** Tag id -> positions in `CandidateBlock.profiles`, ascending. */
export type Postings = ReadonlyMap<number, readonly number[]>;

/** Block positions [start, end). */
export interface Span { readonly start: number; readonly end: number }
/** The positions of one segment; `segment` undefined holds the profiles without a segment. */
export interface SegmentSpan extends Span { readonly segment: string | undefined }

export interface CandidateBlock {
  /** Sorted by (segment asc, profiles without a segment first; standing asc; ordinal asc). */
  readonly profiles: readonly MatchProfile[];
  /** One entry per segment present, in block order. */
  readonly segments: readonly SegmentSpan[];
  reachableSegments(partners: ReadonlySet<string> | undefined): readonly SegmentSpan[];
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

function segmentsOf(sorted: readonly MatchProfile[]): SegmentSpan[] {
  const spans: SegmentSpan[] = [];
  let start = 0;
  for (let i = 1; i <= sorted.length; i++) {
    if (i < sorted.length && compareSegment(sorted[i - 1], sorted[i]) === 0) continue;
    spans.push({ segment: sorted[start].segment?.own, start, end: i });
    start = i;
  }
  return spans;
}

function segmentLookup(segments: readonly SegmentSpan[]): CandidateBlock["reachableSegments"] {
  const bySegment = new Map(segments.map(span => [span.segment, span]));
  const unsegmented = bySegment.get(undefined);
  const cached = new WeakMap<ReadonlySet<string>, readonly SegmentSpan[]>();
  return partners => {
    if (!partners) return segments;
    const found = cached.get(partners);
    if (found) return found;
    let reachable: SegmentSpan[];
    if (partners.size < segments.length) {
      reachable = unsegmented ? [unsegmented] : [];
      for (const name of partners) {
        const span = bySegment.get(name);
        if (span) reachable.push(span);
      }
      reachable.sort((a, b) => a.start - b.start);
    } else {
      reachable = segments.filter(span => span.segment === undefined || partners.has(span.segment));
    }
    cached.set(partners, reachable);
    return reachable;
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
    const sorted = [...group].sort((x, y) => compareSegment(x, y) || x.standing - y.standing || x.ordinal - y.ordinal);
    const segments = segmentsOf(sorted);
    blocks.set(key, {
      profiles: sorted,
      segments,
      reachableSegments: segmentLookup(segments),
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
