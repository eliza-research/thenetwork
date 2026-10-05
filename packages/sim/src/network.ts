// Pluggable "Network under test". The world runner drives any implementation of this
// interface: the StubNetwork here, and later the real Eliza agent + engine. The Network
// may only reach members through ctx.send (the simulated channel) and may only read the
// public snapshot; it never sees personas' hidden truth.
import type { Clock, MemberId, Proposal, WorldSnapshot, City } from "@thenetwork/core";
import type { ChannelKind, Keyword, SimMessage, SimMeta } from "./channel.ts";

/** An inbound webhook payload as the Network sees it. */
export interface InboundMessage {
  id: string; memberId: MemberId; body: string; ts: number; channel: ChannelKind; keyword?: Keyword;
}

export interface MeetingReport {
  proposalId: string; participants: MemberId[]; at: number; city: City; kind?: string;
}

export interface NetworkContext {
  clock: Clock;
  /** Send an outbound message to a member through the simulated channel. */
  send(memberId: MemberId, body: string, opts?: { meta?: SimMeta; idempotencyKey?: string }): SimMessage;
  /**
   * Public view of joined members in core types, as a perfect onboarding/extraction would
   * capture it (stated interests, intents, presence, boundaries and private disclosures
   * as agent_private facets). Hidden truth is never included.
   */
  snapshot(): WorldSnapshot;
  /** Sim hook: the Network created a proposal (logged and scored against the oracle). */
  recordProposal(p: Proposal, source?: "network" | "engine" | "scenario"): void;
  /** Sim hook: a meeting was confirmed; the world will decide attendance and outcomes. */
  recordMeeting(m: MeetingReport): string;
  /** Sim hook: a member blocked another (also visible in later snapshots as an edge). */
  recordBlock(from: MemberId, to: MemberId): void;
  /** Free-form structured log line. */
  log(type: string, detail: Record<string, unknown>): void;
}

export interface NetworkUnderTest {
  readonly name: string;
  init(ctx: NetworkContext): void | Promise<void>;
  /** Called for every inbound member message (including STOP/HELP keyword messages). */
  onInbound(msg: InboundMessage): void | Promise<void>;
  /** Called on every engine/job tick (default hourly sim time). Drain due jobs here. */
  tick(now: number): void | Promise<void>;
  /** Hand the Network proposals from an external Engine or a scenario script for dispatch. */
  submitProposal?(p: Proposal): void | Promise<void>;
}

/**
 * Matching engine contract (implemented by packages/engine; injected, never imported here).
 * Pure function of the snapshot: same snapshot + config + seed => same proposals (ME-004).
 */
export interface Engine {
  readonly name: string;
  propose(snapshot: WorldSnapshot, opts?: { city?: City; seed?: number | string }): Proposal[] | Promise<Proposal[]>;
}
