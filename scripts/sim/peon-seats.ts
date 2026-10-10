// The peon-seats block (#9): job postings to job seats to hiring managers, through the real
// ConsentNetwork with peonPack and the peon hooks (packages/network/service/packs.ts), a SimClock and a
// recording channel. A small hand-built NYC world: one verified adult hiring manager, a 16-year-old who
// tries to post, an adult who never opted in to work matching, four adult candidates, a 15-year-old
// candidate and a held one. The "database" is the world's rows: a confirmed posting is written to them
// (onPosting -> postingFacts) and the snapshot makes it a seat (engine peonSeats), as in production.
// Review is "human": a gate approves items one at a time, so nothing reaches anyone before review.
// Gates (all blocking):
//   intake      the text is read back and saved only on the manager's yes; minors and members not
//               opted in to work cannot post (text and staff path); never from an open turn
//   routing     every seat item is the manager's (the seat stands in the engine's views only);
//               candidate first, the manager's blind review only after the candidate's yes, the
//               intro (names) only after both yeses; no score or name in a probe
//   exclusions  minors and held candidates are never in an item; the seat never takes more
//               candidates than openings
//   restart     the state survives an export and import between the two yeses
//   close       closing a posting by text ends its open items (a candidate who said yes is told), and
//               no new item is proposed for it
import { DAY, HOUR, SimClock, type Facet, type Intent, type Member, type MemberId, type NetworkContext, type Presence, type SimMessage, type SimMeta } from "../../packages/core/src/index.ts";
import { peonPack, PEON_ENGINE_CONFIG } from "../../packages/engine/src/packs/peon/index.ts";
import { peonSeats, seatIdOf } from "../../packages/engine/src/packs/peon/seats.ts";
import { ConsentNetwork, type NetworkOptions } from "../../packages/network/src/network.ts";
import { parsePosting, postingFacts, POSTING_COPY, readPostingText, SEAT_COPY, type JobPosting } from "../../packages/network/src/jobs.ts";
import { appWiring } from "../../packages/network/service/packs.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { Block, expect } from "./gate.ts";

/** 2026-10-05 13:00 New York (a Monday). */
const START = Date.UTC(2026, 9, 5, 17);
const prefs = (work = true) => ({ categoriesOptIn: work ? ["professional" as const] : ["social" as const], quietHours: [22, 8] as [number, number], romanceOptIn: false, formats: ["one_to_one" as const], maxTravelMinutes: 45, onlyWhenAsked: false });

/** The world: rows the snapshot reads, the channel log, and the Network under test. */
class SeatWorld {
  readonly clock = new SimClock(START);
  readonly sent: { t: number; to: MemberId; body: string; meta: SimMeta }[] = [];
  readonly logs: { kind: string; detail: Record<string, unknown> }[] = [];
  readonly meetings: { proposalId: string; participants: MemberId[] }[] = [];
  readonly members: Member[] = [];
  readonly facets: Facet[] = [];
  readonly intents: Intent[] = [];
  readonly presence: Presence[] = [];
  readonly saved: JobPosting[] = [];
  net: ConsentNetwork;
  private seq = 0;
  private readonly opts: NetworkOptions;

  constructor() {
    const w = appWiring("peon");
    this.opts = {
      app: APPS.peon, seed: 7, review: "human", reviewSlaHours: 120, maxNewPerDay: 20, matchingEnabled: true, plans: false,
      pack: w.pack!, hooks: w.hooks!, engine: { ...PEON_ENGINE_CONFIG, cities: ["nyc"] },
      onPosting: p => this.write(p),
    };
    this.net = new ConsentNetwork(this.opts);
    this.net.init(this.ctx());
  }

  /** A process restart: the state as JSON into a new Network (the rows stay, as in Postgres). */
  restart() {
    const json = JSON.stringify(this.net.exportState());
    this.net = new ConsentNetwork(this.opts);
    this.net.init(this.ctx());
    this.net.importState(JSON.parse(json));
  }

  /** A confirmed posting's rows replace its old ones (service/postings.ts savePosting does the same in SQL). */
  private write(p: JobPosting) {
    this.saved.push(p);
    const { intent, facets } = postingFacts(p);
    const tag = `peon:posting:${p.id}`;
    for (let i = this.intents.length - 1; i >= 0; i--) if (this.intents[i]!.id === p.id) this.intents.splice(i, 1);
    for (let i = this.facets.length - 1; i >= 0; i--) if (this.facets[i]!.memberId === p.managerId && this.facets[i]!.tags.includes(tag)) this.facets.splice(i, 1);
    this.intents.push(intent); this.facets.push(...facets);
  }

  add(id: MemberId, name: string, age: number, o: { work?: boolean; candidate?: boolean; verified?: string } = {}) {
    const now = this.clock.now();
    this.members.push({ id, name, homeCity: "nyc", state: "normal", joinedAt: now - 10 * DAY, age, unansweredProactive: 0, prefs: prefs(o.work ?? true) });
    this.presence.push({ memberId: id, city: "nyc", type: "home", areas: ["Williamsburg"] });
    const f = (fid: string, kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"] = "matchable") =>
      this.facets.push({ id: `${id}-${fid}`, memberId: id, kind, value, tags, scope, provenance: "said", confidence: 0.9, validFrom: now - 10 * DAY, source: "chat", confirmedByMember: true });
    if (o.verified) { f("co", "fact", `Company: ${o.verified}`, [`peon:company:${o.verified.toLowerCase()}`], "shareable"); f("ver", "fact", "Employer verified", ["peon:verified"]); }
    if (o.candidate) {
      f("e", "fact", "Looking for work", ["peon:entity:candidate"]);
      f("g", "goal", "Wants data analyst work", ["peon:family:data_analyst", "peon:seniority:2"]);
      f("s", "skill", "sql level 3", ["peon:skill:sql:3"]);
      f("p", "preference", "Pay floor", ["peon:pay_floor:85"]);
      f("m", "preference", "Work models", ["peon:mode:hybrid", "peon:area:brooklyn"]);
      f("a", "fact", "Work authorization", ["peon:auth:yes", "peon:sponsorship:no", "peon:start_weeks:2"]);
      this.intents.push({ id: `${id}-search`, memberId: id, objective: "Find a data analyst role", category: "professional", details: "peon:search", horizonDays: 90, status: "active", createdAt: now - 10 * DAY });
    }
  }

  ctx(): NetworkContext {
    return {
      clock: this.clock,
      send: (memberId, body, o) => {
        const t = this.clock.now();
        this.sent.push({ t, to: memberId, body, meta: o?.meta ?? {} });
        return { id: `o${++this.seq}`, ts: t, direction: "outbound", channel: "sms", from: "network", to: memberId, memberId, body, status: "delivered", meta: o?.meta } satisfies SimMessage;
      },
      // As service/snapshot.ts: the rows, then each posting as a job seat.
      snapshot: () => peonSeats({ now: this.clock.now(), members: [...this.members], facets: [...this.facets], intents: [...this.intents], presence: [...this.presence], edges: [], recentProposals: [] }),
      recordProposal: () => {},
      recordMeeting: m => { this.meetings.push({ proposalId: m.proposalId, participants: [...m.participants] }); return `mt${this.meetings.length}`; },
      recordBlock: () => {},
      log: (kind, detail) => { this.logs.push({ kind, detail }); },
    };
  }

  async say(id: MemberId, body: string) { await this.net.onInbound({ id: `i${++this.seq}`, memberId: id, body, ts: this.clock.now(), channel: "sms" }); this.clock.advance(60_000); }
  async run(ms: number) { const end = this.clock.now() + ms; while (this.clock.now() + HOUR <= end) { this.clock.advance(HOUR); await this.net.tick(this.clock.now()); } }
  async runUntil(done: () => boolean, max = 3 * DAY) { const end = this.clock.now() + max; while (!done() && this.clock.now() + HOUR <= end) await this.run(HOUR); return done(); }
  mark() { return this.sent.length; }
  to(id: MemberId, from = 0) { return this.sent.slice(from).filter(s => s.to === id); }
  last(id: MemberId) { return this.to(id).at(-1)?.body ?? ""; }
  opp(id: string) { return this.net.exportState().opps.find(o => o.id === id); }
  probedFor(id: MemberId, oppId: string) { const m = this.net.memberList().find(x => x.id === id); return m?.awaiting?.kind === "probe" && m.awaiting.oppId === oppId; }
  /** Messages about one item (probes name it in meta.probe, the rest in meta.proposalId). */
  about(oppId: string, from = 0) { return this.sent.slice(from).filter(s => s.meta.proposalId === oppId || s.meta.probe?.key === oppId); }
}

const CANDIDATES = ["c1", "c2", "c3", "c4"];
/** A pending short acknowledgement ("Got it, thanks.", "Great, thanks.") may ride in front of the next send (network.ts). */
const ACK = /^(?:Got it|Thanks|Great|No problem)[^.!?]*[.!?] /i;
const isCopy = (body: string, copy: string) => body === copy || (ACK.test(body) && body.endsWith(` ${copy}`));
const startsWith = (body: string, re: RegExp) => re.test(body.replace(ACK, ""));
const POST = "We're hiring a data analyst (level 2), 2 openings, $90k-$120k, hybrid in Brooklyn, must have SQL";

export async function peonSeatsBlock(b: Block): Promise<void> {
  await b.run("intake rules: a job post is read from text, read back, and needs a title and a pay range", () => {
    const d = parsePosting(POST);
    expect(d).toMatchObject({ title: "data analyst", openings: 2, payMin: 90, payMax: 120, mode: "hybrid", area: "brooklyn", seniority: 2, must: [{ skill: "sql", level: 2 }] });
    const step = readPostingText(POST, { postings: [], newId: "p-new" })!;
    expect(step.ready).toBe(true);
    expect(step.text).toMatch(/Reply yes to post it/);
    const noPay = readPostingText("We're hiring a barista, 1 opening", { postings: [], newId: "p-2" })!;
    expect(noPay.ready).toBe(false);
    expect(noPay.text).toBe(POSTING_COPY.askPay);
    const fixed = readPostingText("$40k-$50k", { draft: noPay.draft!, postings: [], newId: "p-3" })!;
    expect(fixed.ready).toBe(true);
    expect(fixed.draft).toMatchObject({ id: "p-2", title: "barista", payMin: 40, payMax: 50 });
    // Not a posting command, no draft waiting: not about a posting (the turn goes on as usual).
    expect(readPostingText("Any jobs for me this week?", { postings: [], newId: "p-4" })).toBeUndefined();
  });

  const w = new SeatWorld();
  w.add("hm1", "Rowan Abbott", 34, { verified: "Acme" });
  w.add("hm2", "Kai Lee", 16, { verified: "Kidco" });
  w.add("hm3", "Jo Park", 30, { work: false, verified: "Joco" });
  for (const c of CANDIDATES) w.add(c, `Cand ${c.toUpperCase()}`, 29, { candidate: true });
  w.add("c5", "Teen Five", 15, { candidate: true });
  w.add("c6", "Held Six", 31, { candidate: true });
  for (const id of ["hm1", "hm2", "hm3", ...CANDIDATES, "c5", "c6"]) for (const a of ["hi!", "Work, mostly.", "Weekday evenings.", "One-on-one is good."]) await w.say(id, a);
  w.net.holdMember("c6", "sim_staff", "held for the gate");

  await b.run("intake: read back first, saved only on the manager's yes", async () => {
    const m = w.mark();
    await w.say("hm1", POST);
    expect(w.to("hm1", m).at(-1)?.body).toMatch(/^Here's your job post: Data analyst, 2 openings, \$90k-\$120k a year, hybrid in Brooklyn\. Must-haves: sql\..*Reply yes/);
    expect(w.saved.length).toBe(0);
    await w.say("hm1", "yes");
    expect(w.saved.length).toBe(1);
    expect(w.saved[0]).toMatchObject({ managerId: "hm1", title: "data analyst", openings: 2, payMin: 90, payMax: 120, status: "active" });
    expect(w.last("hm1")).toMatch(/^Posted: data analyst\./);
    expect(w.net.packInput(w.clock.now()).members.some(x => x.id === seatIdOf(w.saved[0]!.id))).toBe(true);
  });
  const postingId = w.saved[0]?.id ?? "none", seat = seatIdOf(postingId);

  await b.run("intake: a minor and a member not opted in to work cannot post (text and staff path)", async () => {
    await w.say("hm2", "We're hiring a cashier, 1 opening, $30k-$35k, onsite in Queens");
    expect(w.last("hm2")).toBe(POSTING_COPY.adultsOnly);
    await w.say("hm3", "We're hiring a cook, 1 opening, $40k-$50k, onsite in Queens");
    expect(w.last("hm3")).toBe(POSTING_COPY.optIn);
    const base: JobPosting = { id: "staff-1", managerId: "hm2", title: "cashier", family: "cashier", openings: 1, payMin: 30, payMax: 35, mode: "onsite", must: [], nice: [], status: "active", createdAt: w.clock.now(), updatedAt: w.clock.now() };
    expect(w.net.applyPosting(base, "staff")).toEqual({ ok: false, reason: "adults_only" });
    expect(w.net.applyPosting({ ...base, managerId: "hm3" }, "staff")).toEqual({ ok: false, reason: "opt_in" });
    expect(w.net.applyPosting({ ...base, payMax: 20 }, "staff")).toEqual({ ok: false, reason: "pay_range_required" });
    expect(w.saved.length).toBe(1);
  });

  const queue = () => w.net.reviewQueue().filter(i => i.proposal.participants.includes("hm1"));
  let A = "";
  await b.run("routing: seat items wait in review as the manager's; no minor or held candidate; never more than the openings; nobody hears before review", async () => {
    const m = w.mark();
    expect(await w.runUntil(() => queue().length > 0, 2 * DAY)).toBe(true);
    const items = queue();
    expect(items.length).toBeLessThanOrEqual(2);
    for (const i of items) {
      expect(i.proposal.participants.length).toBe(2);
      expect(i.proposal.participants.some(p => p.startsWith("job:"))).toBe(false);
      const cand = i.proposal.participants.find(p => p !== "hm1")!;
      expect(CANDIDATES).toContain(cand);
      expect(w.opp(i.oppId)?.seat).toEqual({ id: seat, manager: "hm1" });
      expect(w.about(i.oppId, m).length).toBe(0);
    }
    A = items[0]!.oppId;
  });
  const candOf = (oppId: string) => w.opp(oppId)?.participants.find(p => p !== "hm1") ?? "none";

  await b.run("routing: candidate first; the manager's blind review only after the candidate's yes; no score and no name", async () => {
    expect(w.net.review(A, "approve", { reviewer: "sim_staff" })).toBe(true);
    const c = candOf(A);
    expect(await w.runUntil(() => w.probedFor(c, A))).toBe(true);
    const probe = w.about(A).filter(s => s.to === c).at(-1)!.body;
    // The probe is the seat copy; a pending short acknowledgement ("Got it, thanks.") may ride in front of it (network.ts send).
    expect(isCopy(probe, SEAT_COPY.candidateProbe({ title: "data analyst", pay: "$90k-$120k", where: "hybrid in Brooklyn", must: [] }))).toBe(true);
    expect(probe).not.toMatch(/Rowan|Abbott|Acme|score|%/);
    expect(w.about(A).some(s => s.to === "hm1")).toBe(false);
    await w.say(c, "yes");
    expect(await w.runUntil(() => w.probedFor("hm1", A))).toBe(true);
    const review = w.about(A).filter(s => s.to === "hm1").at(-1)!.body;
    expect(review).toMatch(/^A candidate said yes to your data analyst post\. Meets 1 of 1 must-haves \(sql yes\)\. Can start in 2 weeks\./);
    expect(review).not.toMatch(new RegExp(`Cand ${c.toUpperCase()}|\\b${c}\\b|score|%|\\brank`));
  });

  await b.run("restart: the item, the seat and the manager's pending review survive an export and import", async () => {
    w.restart();
    expect(w.opp(A)?.seat).toEqual({ id: seat, manager: "hm1" });
    expect(w.probedFor("hm1", A)).toBe(true);
  });

  await b.run("double opt-in: the intro names each side only after the manager's yes too", async () => {
    const c = candOf(A);
    expect(w.meetings.some(x => x.proposalId === A)).toBe(false);
    await w.say("hm1", "yes");
    expect(w.opp(A)?.stage).toBe("scheduled");
    // The intro is logistics: it waits only for quiet hours.
    const intro = (id: MemberId, re: RegExp) => w.about(A).some(s => s.to === id && startsWith(s.body, re));
    expect(await w.runUntil(() => intro("hm1", /^Intro: Cand C\. said yes to your data analyst post\./) && intro(c, /^Good news: Rowan A\., who is hiring for data analyst, said yes too\./), DAY)).toBe(true);
    // The engine sees the seat hold one of its two openings.
    const input = w.net.packInput(w.clock.now());
    expect(input.interactions?.some(x => x.id === `${A}:seat` && x.participants.includes(seat) && x.outcome === "accepted")).toBe(true);
    // Two openings: this intro holds one, and every other seat item still in flight (review or probes) is
    // about to hold one (engine seatFills), so the seat has 2 - 1 - inFlight left.
    const inFlight = w.net.exportState().opps.filter(o => o.seat?.id === seat && o.id !== A && o.stage !== "closed").length;
    expect(input.facets.find(f => f.id === `${seat}:openings`)?.tags).toContain(`peon:openings:${Math.max(0, 1 - inFlight)}`);
  });

  let B = "";
  await b.run("close: closing the posting by text ends its open items; a candidate who said yes is told; no new item for it", async () => {
    // The manager answers the intro (a reply resets their conversation streak, as in any thread).
    await w.say("hm1", "Thanks!");
    if (!queue().some(i => i.oppId !== A)) expect(await w.runUntil(() => queue().some(i => i.oppId !== A), 3 * DAY)).toBe(true);
    B = queue().find(i => i.oppId !== A)!.oppId;
    const c = candOf(B);
    expect(c).not.toBe(candOf(A));
    expect(w.net.review(B, "approve", { reviewer: "sim_staff" })).toBe(true);
    expect(await w.runUntil(() => w.probedFor(c, B))).toBe(true);
    await w.say(c, "yes");
    expect(await w.runUntil(() => w.probedFor("hm1", B))).toBe(true);
    await w.say("hm1", "Close my data analyst post");
    expect(w.last("hm1")).toBe(POSTING_COPY.readBackClose("data analyst"));
    await w.say("hm1", "yes");
    expect(w.last("hm1")).toBe(POSTING_COPY.closed("data analyst"));
    expect(w.saved.at(-1)).toMatchObject({ id: postingId, status: "closed" });
    expect(w.opp(B)).toMatchObject({ stage: "closed", closedReason: "posting closed" });
    expect(await w.runUntil(() => isCopy(w.last(c), SEAT_COPY.postingClosed), DAY)).toBe(true);
    expect(w.opp(A)?.stage).toBe("scheduled");
    await w.run(3 * DAY);
    expect(queue().filter(i => i.oppId !== A && i.oppId !== B).length).toBe(0);
  });

  await b.run("exclusions: no minor or held member was in any item or got any seat message", () => {
    for (const o of w.net.exportState().opps) for (const p of o.participants) expect(["c5", "c6", "hm2", "hm3"]).not.toContain(p);
    for (const id of ["c5", "c6"]) expect(w.to(id).some(s => s.meta.probe || s.meta.proposalId)).toBe(false);
  });
}
