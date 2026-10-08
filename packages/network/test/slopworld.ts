// The slop world (packages/worlds, src/slop) behind a real ConsentNetwork with the slop wiring
// (service/packs.ts): the personas' agent-visible snapshot is the Network's snapshot. Members join on
// the web (welcomeJoined), the engine runs with slopPack, and every send is recorded. Test helper only.
import { DAY, HOUR, SimClock, type Member, type MemberId } from "@thenetwork/core";
import type { NetworkContext, SimMeta } from "@thenetwork/sim";
import { buildSlopSnapshot, generateSlopPersonas, SLOP_WORLD_START, VERIFICATION_DEFAULTS, type SlopPersona } from "../../worlds/src/slop/index.ts";
import { ConsentNetwork, type NetworkOptions } from "../src/index.ts";
import { APPS } from "../../platform/src/apps.ts";
import { appWiring } from "../service/packs.ts";

export class SlopWorldNet {
  /** Monday 9:00 New York, the slop world's first week. */
  readonly clock = new SimClock(SLOP_WORLD_START + 13 * HOUR);
  readonly sent: { t: number; to: MemberId; body: string; meta: SimMeta }[] = [];
  readonly logs: { t: number; kind: string; detail: Record<string, unknown> }[] = [];
  readonly personas: SlopPersona[];
  readonly snap: ReturnType<typeof buildSlopSnapshot>;
  readonly net: ConsentNetwork;
  private seq = 0;

  constructor(o: { seed?: number; perCity?: number; minorShare?: number; network?: Partial<NetworkOptions> } = {}) {
    this.personas = generateSlopPersonas({ seed: o.seed ?? 1, perCity: o.perCity ?? 60, cities: ["nyc"], minorShare: o.minorShare ?? 0.1 });
    this.snap = buildSlopSnapshot(this.personas, {
      now: SLOP_WORLD_START, week: 0, interactions: [], feedback: [], safetyHolds: [], inboundAsks: [], edges: [], paused: new Set(), asks: [], learned: new Map(),
      verification: VERIFICATION_DEFAULTS,
    });
    const w = appWiring("slop");
    this.net = new ConsentNetwork({ app: APPS.slop, seed: 1, review: "human", matchingEnabled: true, maxNewPerDay: 20, pack: w.pack, hooks: w.hooks, engine: w.engine, plans: w.plans, ...o.network });
    this.net.init(this.ctx());
  }

  get members(): Member[] { return this.snap.members; }
  persona(id: MemberId) { return this.personas.find(p => p.id === id)!; }

  ctx(): NetworkContext {
    return {
      clock: this.clock,
      send: (memberId, body, o) => {
        const t = this.clock.now();
        this.sent.push({ t, to: memberId, body, meta: o?.meta ?? {} });
        return { id: `o${++this.seq}`, ts: t, direction: "outbound", channel: "sms", from: "network", to: memberId, memberId, body, status: "delivered", meta: o?.meta };
      },
      snapshot: () => ({ ...this.snap, now: this.clock.now() }),
      recordProposal: () => {},
      recordMeeting: () => `mt${++this.seq}`,
      recordBlock: () => {},
      log: (kind, detail) => { this.logs.push({ t: this.clock.now(), kind, detail }); },
    };
  }

  /** Every member joins on the web (the welcome goes out) and answers the onboarding questions. */
  async joinAll() {
    for (const m of this.members) this.net.welcomeJoined(m.id);
    for (const m of this.members) for (const a of ["More dates, honestly.", "Weeknights mostly.", "One-on-one."]) await this.say(m.id, a);
  }
  async say(id: MemberId, body: string) { await this.net.onInbound({ id: `i${++this.seq}`, memberId: id, body, ts: this.clock.now(), channel: "sms" }); }
  async run(ms: number) {
    const end = this.clock.now() + ms;
    while (this.clock.now() + HOUR <= end) { this.clock.advance(HOUR); await this.net.tick(this.clock.now()); }
  }
  to(id: MemberId, from = 0) { return this.sent.slice(from).filter(s => s.to === id); }
  log(kind: string) { return this.logs.filter(l => l.kind === kind); }
  awaiting(id: MemberId) { return this.net.memberList().find(m => m.id === id)?.awaiting?.kind; }
}
export { DAY, HOUR };
