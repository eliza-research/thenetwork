// In-memory observatory state with change tracking. Both data sources write into a Store; the
// server sends the full state once and then deltas (only what changed since the last take).
import type { MemberId } from "@thenetwork/core";
import type {
  ClockInfo, EngineRunSummary, EnvInfo, GameState, MemberTruth, ObsDelta, ObsEdge, ObsFeedItem, ObsMember,
  ObsOpportunity, ObsState, ObsStats,
} from "./types.ts";

export const FEED_LIMIT = 400;
const SYMMETRIC = new Set(["knows", "met", "introduced", "enjoyed", "would_interact_again", "group_only", "avoid"]);

/** Stable edge id: symmetric types are keyed on the sorted pair, directed ones on (from, to). */
export function edgeId(type: string, from: MemberId, to: MemberId): string {
  if (SYMMETRIC.has(type)) return from < to ? `${type}:${from}|${to}` : `${type}:${to}|${from}`;
  return `${type}:${from}>${to}`;
}

export function emptyCounters(): ObsMember["counters"] {
  return { msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 };
}

/** Counters that are incremented as records arrive (the rest of ObsStats is derived on demand). */
export interface RunningCounts {
  messages: number; inbound: number; outbound: number; proactive: number; invites: number; accepts: number; declines: number;
  meetingsScheduled: number; meetingsHeld: number; attended: number; noShows: number; cancelledWithNotice: number;
  enjoymentSum: number; enjoymentN: number; blocks: number; optOuts: number; adversarialAttempts: number;
  invariantViolations: number; errors: number;
}
export const zeroCounts = (): RunningCounts => ({
  messages: 0, inbound: 0, outbound: 0, proactive: 0, invites: 0, accepts: 0, declines: 0, meetingsScheduled: 0,
  meetingsHeld: 0, attended: 0, noShows: 0, cancelledWithNotice: 0, enjoymentSum: 0, enjoymentN: 0, blocks: 0,
  optOuts: 0, adversarialAttempts: 0, invariantViolations: 0, errors: 0,
});

export class Store {
  readonly members = new Map<MemberId, ObsMember>();
  readonly edges = new Map<string, ObsEdge>();
  readonly opps = new Map<string, ObsOpportunity>();
  readonly runs: EngineRunSummary[] = [];
  feed: ObsFeedItem[] = [];
  truth?: Record<MemberId, MemberTruth>;
  counts: RunningCounts = zeroCounts();
  version = 0;
  private feedSeq = 0;
  private dirtyMembers = new Set<MemberId>();
  private dirtyEdges = new Set<string>();
  private dirtyOpps = new Set<string>();
  private removedOpps = new Set<string>();
  private newFeed: ObsFeedItem[] = [];
  private runsDirty = false;
  private envDirty = false;

  constructor(public env: EnvInfo, public clock: ClockInfo) {}

  setEnv(env: EnvInfo) { this.env = env; this.envDirty = true; }

  upsertMember(m: ObsMember) { this.members.set(m.id, m); this.dirtyMembers.add(m.id); }
  touchMember(id: MemberId) { if (this.members.has(id)) this.dirtyMembers.add(id); }
  member(id: MemberId) { return this.members.get(id); }

  /** Add or strengthen an edge. Returns true if it is new. */
  addEdge(e: Omit<ObsEdge, "id">): boolean {
    const id = edgeId(e.type, e.from, e.to);
    const cur = this.edges.get(id);
    if (cur) {
      if (e.strength > cur.strength) { cur.strength = e.strength; this.dirtyEdges.add(id); }
      return false;
    }
    this.edges.set(id, { id, ...e });
    this.dirtyEdges.add(id);
    return true;
  }

  upsertOpp(o: ObsOpportunity) { this.opps.set(o.id, o); this.dirtyOpps.add(o.id); this.removedOpps.delete(o.id); }
  removeOpp(id: string) { if (this.opps.delete(id)) { this.dirtyOpps.delete(id); this.removedOpps.add(id); } }
  touchOpp(id: string) { if (this.opps.has(id)) this.dirtyOpps.add(id); }

  pushFeed(item: Omit<ObsFeedItem, "seq">) {
    const full = { seq: ++this.feedSeq, ...item };
    this.feed.push(full);
    if (this.feed.length > FEED_LIMIT * 1.25) this.feed = this.feed.slice(-FEED_LIMIT);
    this.newFeed.push(full);
  }

  addRun(r: EngineRunSummary) { this.runs.push(r); if (this.runs.length > 60) this.runs.shift(); this.runsDirty = true; }

  stats(): ObsStats {
    const c = this.counts;
    const byCity: Record<string, number> = {}, byState: Record<string, number> = {};
    let joined = 0;
    for (const m of this.members.values()) {
      byState[m.state] = (byState[m.state] ?? 0) + 1;
      if (!m.joined) continue;
      joined++;
      byCity[m.city] = (byCity[m.city] ?? 0) + 1;
    }
    const proposalsBySource: Record<string, number> = {}, oppsByState: Record<string, number> = {};
    let compatible = 0, unsafe = 0, oracleJudged = 0, proposals = 0;
    for (const o of this.opps.values()) {
      if (o.source === "shadow") continue;
      proposals++;
      proposalsBySource[o.source] = (proposalsBySource[o.source] ?? 0) + 1;
      oppsByState[o.state] = (oppsByState[o.state] ?? 0) + 1;
      if (o.oracle) { oracleJudged++; if (o.oracle.compatible) compatible++; if (o.oracle.unsafe) unsafe++; }
    }
    const edgesByType: Record<string, number> = {};
    for (const e of this.edges.values()) edgesByType[e.type] = (edgesByType[e.type] ?? 0) + 1;
    return {
      members: this.members.size, joined, byCity, byState,
      messages: c.messages, inbound: c.inbound, outbound: c.outbound, proactive: c.proactive,
      proposals, proposalsBySource, oppsByState, invites: c.invites, accepts: c.accepts, declines: c.declines,
      meetingsScheduled: c.meetingsScheduled, meetingsHeld: c.meetingsHeld, attended: c.attended, noShows: c.noShows,
      cancelledWithNotice: c.cancelledWithNotice, enjoymentSum: c.enjoymentSum, enjoymentN: c.enjoymentN,
      blocks: c.blocks, optOuts: c.optOuts, adversarialAttempts: c.adversarialAttempts,
      invariantViolations: c.invariantViolations, errors: c.errors, compatible, unsafe, oracleJudged, edgesByType,
    };
  }

  snapshot(game?: GameState): ObsState {
    return {
      env: this.env, clock: this.clock, members: [...this.members.values()], edges: [...this.edges.values()],
      opportunities: [...this.opps.values()], feed: this.feed.slice(-FEED_LIMIT), stats: this.stats(),
      engineRuns: this.runs, game, truth: this.truth, version: this.version,
    };
  }

  hasChanges() {
    return this.dirtyMembers.size + this.dirtyEdges.size + this.dirtyOpps.size + this.removedOpps.size + this.newFeed.length > 0 || this.runsDirty || this.envDirty;
  }

  /** Everything that changed since the last call (and bump the version). */
  takeDelta(game?: GameState): ObsDelta {
    const changed = this.hasChanges();
    if (changed) this.version++;
    const d: ObsDelta = { version: this.version, clock: this.clock, game };
    if (this.envDirty) d.env = this.env;
    if (this.dirtyMembers.size) d.members = [...this.dirtyMembers].map(id => this.members.get(id)!).filter(Boolean);
    if (this.dirtyEdges.size) d.edges = [...this.dirtyEdges].map(id => this.edges.get(id)!).filter(Boolean);
    if (this.dirtyOpps.size) d.opportunities = [...this.dirtyOpps].map(id => this.opps.get(id)!).filter(Boolean);
    if (this.removedOpps.size) d.removedOpportunities = [...this.removedOpps];
    if (this.newFeed.length) d.feed = this.newFeed;
    if (this.runsDirty) d.engineRuns = this.runs;
    if (changed) d.stats = this.stats();
    this.dirtyMembers.clear(); this.dirtyEdges.clear(); this.dirtyOpps.clear(); this.removedOpps.clear(); this.newFeed = [];
    this.runsDirty = false; this.envDirty = false;
    return d;
  }
}
