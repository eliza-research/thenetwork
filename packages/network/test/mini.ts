// A small hand-built NYC world for focused ConsentNetwork flow tests: the real Network, the real
// engine, a SimClock and a recording channel. Members only say what a test makes them say, so one
// flow (a meeting, a request retry, a decline) can be driven step by step in a second. The full
// simulated world (network.test.ts) stays the end-to-end check.
import { DAY, HOUR, SimClock, type Category, type Facet, type Intent, type Member, type MemberId, type ParticipationState, type Presence, type Proposal } from "@thenetwork/core";
import type { MeetingReport, NetworkContext, SimMessage, SimMeta } from "@thenetwork/sim";
import { ConsentNetwork, type NetworkOptions } from "../src/index.ts";

/** 2026-10-05 13:00 New York. */
export const START = Date.UTC(2026, 9, 5, 17);

export interface Spec {
  id: MemberId; name: string; age?: number; area?: string; interests?: string[]; skills?: string[];
  /** Live wants (objective = a DESIRES text). */
  wants?: { objective: string; category: Category }[];
  state?: ParticipationState; quietHours?: [number, number];
  /** Interest and skill facets the member allowed others to see (scope "shareable"); default "matchable". */
  shareable?: boolean;
  /** Opted in to romance, with stated preferences (romance:is / seeks tags, agent_private, as the sim does). */
  romance?: { is: string; seeks: string[] };
}

export class Mini {
  readonly clock = new SimClock(START);
  /** `reply`: the Network sent it as a direct answer (NetworkContext.send), which a delivery queue sends past quiet hours and caps. */
  readonly sent: { t: number; to: MemberId; body: string; meta: SimMeta; reply?: boolean }[] = [];
  readonly logs: { t: number; kind: string; detail: Record<string, unknown> }[] = [];
  readonly meetings: MeetingReport[] = [];
  readonly members: Member[] = [];
  readonly facets: Facet[] = [];
  readonly intents: Intent[] = [];
  readonly presence: Presence[] = [];
  net: ConsentNetwork;
  private seq = 0;
  private readonly opts: NetworkOptions;

  constructor(specs: Spec[], opts: NetworkOptions = {}) {
    for (const s of specs) this.add(s);
    // No engine opportunities unless a test asks for them: flows here are driven explicitly.
    this.opts = { seed: 1, review: "auto", maxNewPerDay: 0, ...opts };
    this.net = new ConsentNetwork(this.opts);
    this.net.init(this.ctx());
  }

  /** A process restart: export the state as JSON, then continue on a new ConsentNetwork that imports it. */
  restart() {
    const json = JSON.stringify(this.net.exportState());
    this.net = new ConsentNetwork(this.opts);
    this.net.init(this.ctx());
    this.net.importState(JSON.parse(json));
  }

  add(s: Spec) {
    const now = this.clock.now();
    this.members.push({
      id: s.id, name: s.name, homeCity: "nyc", state: s.state ?? "normal", joinedAt: now, age: s.age as number, unansweredProactive: 0, // a missing age is allowed here (6.3)
      prefs: { categoriesOptIn: ["social", "hobby", "professional", "events", "growth", "help", ...(s.romance ? ["romance" as const] : [])], quietHours: s.quietHours ?? [21, 9], romanceOptIn: !!s.romance, formats: ["one_to_one", "small_group", "event"], maxTravelMinutes: 45, onlyWhenAsked: false },
    });
    this.presence.push({ memberId: s.id, city: "nyc", type: "home", areas: [s.area ?? "Williamsburg"] });
    const facet = (kind: Facet["kind"], tag: string): Facet => ({
      id: `${s.id}:${kind}:${tag}`, memberId: s.id, kind, value: tag.replace(/_/g, " "), tags: [tag], scope: s.shareable ? "shareable" : "matchable", provenance: "said", confidence: 0.9,
      validFrom: now, source: "chat", observedAt: now, inferred: false, confirmedByMember: true,
    });
    for (const t of s.interests ?? []) this.facets.push(facet("interest", t));
    for (const t of s.skills ?? []) this.facets.push(facet("skill", t));
    if (s.romance) this.facets.push({ ...facet("boundary", "romance"), value: "romance preferences", scope: "agent_private", tags: [`romance:is:${s.romance.is}`, ...s.romance.seeks.map(g => `romance:seeks:${g}`), "romance:age:18-99"] });
    for (const [i, w] of (s.wants ?? []).entries()) this.intents.push({ id: `${s.id}:want:${i}`, memberId: s.id, objective: w.objective, category: w.category, horizonDays: 60, status: "active", createdAt: now });
  }

  ctx(): NetworkContext {
    return {
      clock: this.clock,
      send: (memberId, body, o) => {
        const t = this.clock.now();
        this.sent.push({ t, to: memberId, body, meta: o?.meta ?? {}, ...(o?.reply ? { reply: true } : {}) });
        return { id: `o${++this.seq}`, ts: t, direction: "outbound", channel: "sms", from: "network", to: memberId, memberId, body, status: "delivered", meta: o?.meta } satisfies SimMessage;
      },
      snapshot: () => ({ now: this.clock.now(), members: this.members, facets: this.facets, intents: this.intents, presence: this.presence, edges: [], recentProposals: [] }),
      recordProposal: () => {},
      recordMeeting: m => { this.meetings.push(m); return `mt${this.meetings.length}`; },
      recordBlock: () => {},
      log: (kind, detail) => { this.logs.push({ t: this.clock.now(), kind, detail }); },
    };
  }

  /** The member writes to the Network now. */
  async say(id: MemberId, body: string) {
    await this.net.onInbound({ id: `i${++this.seq}`, memberId: id, body, ts: this.clock.now(), channel: "sms" });
  }

  /** Join and finish onboarding (the welcome question, then availability and format). */
  async onboard(...ids: MemberId[]) {
    for (const id of ids) for (const a of ["hi!", "More time outdoors.", "Weekends, mostly.", "One-on-one is good."]) await this.say(id, a);
  }

  /** Advance time in hourly ticks (the world's job tick). */
  async run(ms: number) {
    const end = this.clock.now() + ms;
    while (this.clock.now() + HOUR <= end) { this.clock.advance(HOUR); await this.net.tick(this.clock.now()); }
    if (this.clock.now() < end) this.clock.set(end);
  }

  /** Run in hourly ticks until `done()` holds (at most `max`). Returns whether it holds. */
  async runUntil(done: () => boolean, max = 3 * DAY) {
    const end = this.clock.now() + max;
    while (!done() && this.clock.now() + HOUR <= end) await this.run(HOUR);
    return done();
  }

  /** Is the member's next message read as the answer to a probe? */
  probed(id: MemberId) { return this.net.memberList().find(m => m.id === id)?.awaiting?.kind === "probe"; }

  /**
   * Drive the sequential consent flow to a booked plan: whenever one of `ids` has a probe waiting,
   * they answer `answer` ("yes", "Thursday", ...). Stops once a meeting is booked or nobody is probed.
   */
  async answerProbes(ids: MemberId[], answer: (id: MemberId) => string = () => "yes", max = 4 * DAY) {
    const booked = this.meetings.length;
    for (let i = 0; i < 6 && this.meetings.length === booked; i++) {
      if (!(await this.runUntil(() => ids.some(id => this.probed(id)), max))) return;
      for (const id of ids) if (this.probed(id)) await this.say(id, answer(id));
    }
  }

  /** Run until the next New York hour `h` (at least a minute ahead). */
  async until(h: number) {
    for (let i = 0; i < 25; i++) {
      await this.run(HOUR);
      const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(this.clock.now()));
      if (hour === h) return;
    }
  }

  /** A position in the sent log (for "sent since"). */
  mark() { return this.sent.length; }
  /** What a member got, from a mark on. */
  to(id: MemberId, from = 0) { return this.sent.slice(from).filter(s => s.to === id); }
  log(kind: string) { return this.logs.filter(l => l.kind === kind); }

  /** A staff-composed intro (it waits for the next morning batch and for review, like any other). */
  propose(participants: MemberId[], o: { category?: Category; objective?: string; alternates?: MemberId[]; explanations?: Record<MemberId, string> } = {}): string {
    const now = this.clock.now();
    const id = `player-${++this.seq}`;
    const p: Proposal = {
      id, kind: participants.length > 2 ? "group" : "intro", participants, alternates: o.alternates ?? [], objective: o.objective ?? "a climbing session", category: o.category ?? "hobby", city: "nyc",
      window: { start: now + DAY, end: now + 5 * DAY }, score: 0.5, exploration: false, explanations: o.explanations ?? {}, generator: "player", createdAt: now,
      components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
    };
    this.net.submitProposal(p);
    return id;
  }
}
