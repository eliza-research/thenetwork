// A small slop.date world for the relay and dates tests: a fake channel (every send is recorded), a
// settable clock, a snapshot the test edits, and the ConsentNetwork with the slop wiring
// (service/packs.ts). bookDate() walks one pair through the real consent flow: a staff proposal,
// human review, the probe, both yeses and the reveal.
import type { Facet, InboundMessage, Member, MemberId, NetworkContext, Presence, SimMessage, SimMeta, WorldSnapshot } from "@thenetwork/core";
import { ConsentNetwork, type NetworkOptions } from "../src/network.ts";
import { appWiring } from "../service/packs.ts";
import { APPS } from "../../platform/src/apps.ts";

/** Tuesday 13 October 2026, 12:30 in New York: inside the default send window. */
export const T0 = Date.UTC(2026, 9, 13, 16, 30);
export const HOUR = 3_600_000, DAY = 24 * HOUR;

export interface Sent { to: MemberId; body: string; meta?: SimMeta; reply?: boolean; at: number }

export class World implements NetworkContext {
  t = T0;
  readonly clock = { now: () => this.t };
  readonly sent: Sent[] = [];
  readonly logs: { type: string; detail: Record<string, unknown> }[] = [];
  members: Member[] = [];
  facets: Facet[] = [];
  presence: Presence[] = [];
  private seq = 0;

  snapshot(): WorldSnapshot {
    return { now: this.t, members: this.members.map(m => ({ ...m })), facets: [...this.facets], intents: [], presence: [...this.presence], edges: [], recentProposals: [] };
  }
  send(memberId: MemberId, body: string, opts: { meta?: SimMeta; idempotencyKey?: string; reply?: boolean } = {}): SimMessage {
    this.sent.push({ to: memberId, body, meta: opts.meta, reply: opts.reply, at: this.t });
    return { id: `out${++this.seq}`, ts: this.t, direction: "outbound", channel: "imessage", from: "network", to: memberId, memberId, body, status: "delivered", meta: opts.meta };
  }
  recordProposal() {}
  recordMeeting() { return "meeting"; }
  recordBlock() {}
  log(type: string, detail: Record<string, unknown>) { this.logs.push({ type, detail }); }

  add(id: MemberId, name: string, age: number, area = "Chelsea") {
    this.members.push({
      id, name, homeCity: "nyc", state: "normal", joinedAt: this.t - 30 * DAY, age, unansweredProactive: 0, apps: ["slop"],
      prefs: { categoriesOptIn: age >= 18 ? ["romance"] : [], quietHours: [23, 8], romanceOptIn: age >= 18, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false },
    });
    this.presence.push({ memberId: id, city: "nyc", type: "home", areas: [area] });
  }
  /** Texts sent to one member since `from` (an index into `sent`). */
  to(id: MemberId, from = 0): Sent[] { return this.sent.slice(from).filter(s => s.to === id); }
  last(id: MemberId): Sent | undefined { return this.sent.filter(s => s.to === id).at(-1); }
  logged(type: string) { return this.logs.filter(l => l.type === type); }
}

/** The slop ConsentNetwork in a World, with phone numbers for the contact swap. */
export function slopNet(w: World, o: Partial<NetworkOptions> = {}): ConsentNetwork {
  const wiring = appWiring("slop");
  const phones: Record<string, string> = { ana: "+16465550101", ben: "+16465550102", cara: "+16465550103", dan: "+16465550104" };
  const net = new ConsentNetwork({
    app: APPS.slop, pack: wiring.pack, hooks: wiring.hooks, engine: wiring.engine, plans: false, review: "human", seed: 7,
    contactOf: id => phones[id], ...o,
  });
  net.init(w);
  return net;
}

let inSeq = 0;
export async function say(net: ConsentNetwork, w: World, id: MemberId, body: string, keyword?: InboundMessage["keyword"]) {
  await net.onInbound({ id: `in${++inSeq}`, memberId: id, body, ts: w.t, channel: "imessage", ...(keyword ? { keyword } : {}) });
}

/**
 * One booked date between two adults through the real flow. Returns the opportunity id. The first
 * member is probed first and picks the first time; the second says yes.
 */
export async function bookDate(net: ConsentNetwork, w: World, a: MemberId, b: MemberId): Promise<string> {
  for (const id of [a, b]) if (!w.sent.some(s => s.to === id)) await say(net, w, id, "hi");
  net.submitProposal({
    id: `p-${a}-${b}-${w.t}`, kind: "intro", participants: [a, b], alternates: [], objective: "a first date", category: "romance", city: "nyc",
    score: 0.9, exploration: false, explanations: {}, generator: "player", createdAt: w.t,
    components: { fit: 0.9, mutualBenefit: 0.9, warmPath: 0, novelty: 0.5, timingFit: 0.5, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0.8 },
  });
  await net.tick(w.t);
  const item = net.reviewQueue().find(i => i.proposal.participants.includes(a) && i.proposal.participants.includes(b));
  if (!item) throw new Error(`no review item: ${JSON.stringify(w.logs.filter(l => /skipped|gate|closed/.test(l.type)).slice(-5))}`);
  const r = net.decide(item.oppId, "approve", { reviewer: "staff@example.com" });
  if (!r.ok) throw new Error(`approve refused: ${r.reason}`);
  const o = net.opps.get(item.oppId)!;
  const first = o.first!;
  const second = first === a ? b : a;
  // A probe waits for the member's send window: tick until it went out.
  const reach = async (id: MemberId) => { for (let i = 0; i < 96 && !o.contacted.has(id) && o.stage === "probing"; i++) { w.t += 15 * 60_000; await net.tick(w.t); } };
  await reach(first);
  await say(net, w, first, "yes, the first one works");
  await reach(second);
  await say(net, w, second, "yes");
  if (o.stage !== "scheduled") throw new Error(`not booked: ${o.stage} ${o.closedReason ?? ""} ${JSON.stringify([...o.status])}`);
  return item.oppId;
}
