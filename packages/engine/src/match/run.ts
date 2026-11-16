// One matching run over a World: the profiles, the index, and memoized searches, edges and circles.
// Every candidate path reads pairs from here, so one pair gate and one search decide them all.
import type { MemberId } from "@thenetwork/core";
import { laneLimits, type MatchLane } from "../../../core/src/generated/matchLane.ts";
import { noPairValue } from "../../../core/src/generated/pairValue.ts";
import type { MemberStandingRow, SearchTally } from "../types.ts";
import type { World } from "../world.ts";
import { buildCircles, type Circle } from "./circles.ts";
import { buildCandidateIndex, type CandidateIndex } from "./index.ts";
import { pairValueOf } from "./pair.ts";
import { buildProfiles, compareText, type EntityId, type MatchProfile } from "./profile.ts";
import { emptySearchTally, mutualEdges, searchCandidates, tallySearch, type MatchEdge, type SearchResult } from "./search.ts";
import { standingKey } from "./standing.ts";

const existingFriendPlanProfiles = new WeakMap<World, ReadonlyMap<MemberId, MatchProfile>>();

/** Pair values for a reviewed plan. Build all profiles with one interner and no discovery index. */
export function existingFriendPlanPairValues(w: World, memberId: MemberId, peers: readonly MemberId[]): number[] | undefined {
  let profiles = existingFriendPlanProfiles.get(w);
  if (!profiles) {
    profiles = new Map(buildProfiles(w, undefined, "existingFriendPlan").map(profile => [profile.memberId, profile]));
    existingFriendPlanProfiles.set(w, profiles);
  }
  const profile = profiles.get(memberId);
  if (!profile) return undefined;
  return peers.map(id => {
    const peer = profiles.get(id);
    return peer ? pairValueOf(w, profile, peer) : noPairValue;
  });
}

export class MatchRun {
  readonly profiles: readonly MatchProfile[];
  readonly index: CandidateIndex;
  readonly memberStanding?: readonly MemberStandingRow[];
  private readonly byId = new Map<EntityId, MatchProfile>();
  private readonly byMember = new Map<MemberId, MatchProfile[]>();
  private readonly searches = new Map<EntityId, SearchResult>();
  private readonly laneEdges = new Map<MatchLane, readonly MatchEdge[]>();
  private readonly laneCircles = new Map<MatchLane, readonly Circle[]>();

  constructor(private readonly w: World) {
    const updates: MemberStandingRow[] | undefined = w.input.memberStanding === undefined ? undefined : [];
    this.profiles = buildProfiles(w, updates);
    this.memberStanding = updates?.sort((a, b) => compareText(standingKey(a), standingKey(b)));
    this.index = buildCandidateIndex(this.profiles);
    for (const profile of this.profiles) {
      this.byId.set(profile.id, profile);
      const own = this.byMember.get(profile.memberId);
      if (own) own.push(profile); else this.byMember.set(profile.memberId, [profile]);
    }
  }

  profile(id: EntityId): MatchProfile | undefined { return this.byId.get(id); }

  /** A member's profiles, one per lane membership (and per owned entity, such as a job seat). */
  profilesOf(memberId: MemberId): readonly MatchProfile[] { return this.byMember.get(memberId) ?? []; }

  /** The member's profile in a lane, when the member has exactly that membership. */
  profileIn(memberId: MemberId, lane: MatchLane): MatchProfile | undefined {
    return this.profilesOf(memberId).find(profile => profile.lane === lane && profile.id === memberId)
      ?? this.profilesOf(memberId).find(profile => profile.lane === lane);
  }

  // spec/candidateSearch.md, "Story: Keep the best candidates within a fixed number of pair checks"
  candidates(profile: MatchProfile): SearchResult {
    const done = this.searches.get(profile.id);
    if (done) return done;
    const result = searchCandidates(this.w, this.index, profile);
    this.searches.set(profile.id, result);
    return result;
  }

  /** The pair value of two profiles through the one pair gate (noPairValue when there is none). */
  value(a: MatchProfile, b: MatchProfile): number { return pairValueOf(this.w, a, b); }

  /** Every edge of a lane: one search per profile, at most the lane's search budget of pair checks each. */
  edges(lane: MatchLane): readonly MatchEdge[] {
    const done = this.laneEdges.get(lane);
    if (done) return done;
    const edges = mutualEdges(this.profiles.filter(profile => profile.lane === lane).map(profile => ({ profile, result: this.candidates(profile) })));
    this.laneEdges.set(lane, edges);
    return edges;
  }

  /** The lane's circles from its edges; a lane whose circle maximum is below 3 forms none. */
  circles(lane: MatchLane): readonly Circle[] {
    const done = this.laneCircles.get(lane);
    if (done) return done;
    const circles = buildCircles(this.edges(lane), this.byId, laneLimits(lane), profile => profile.capacity);
    this.laneCircles.set(lane, circles);
    return circles;
  }

  /** The cost of every search this run made (MatchingRunLog.search). */
  tally(): SearchTally {
    let tally = emptySearchTally;
    for (const result of this.searches.values()) tally = tallySearch(tally, result);
    return tally;
  }
}
