// Plans v1.1 in the simulator (PolicyOptions.plans, WorldOptions.plans): persona answers to anonymous
// plan probes (with multi-item answers) and to the weekly check-in, window priming, crew offers,
// "Would you do this again?" and would_interact_again edges, the plan oracle, time-dependent
// attendance for plans, and the stub's availability tags without the old upper-casing workaround.
// The models must agree with the engine plans harness (same formulas and draws).
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type ChatMessage, type LLM, type MemberId, type Proposal, type ScoreComponents } from "@thenetwork/core";
import { ACTIVITIES, activityById } from "../../engine/src/activities.ts";
import { candidateSlots, standingFromFacets } from "../../engine/src/attention.ts";
import * as H from "../../engine/experiments/plansHarness.ts";
import {
  CITY_TZ, DEFAULT_CAPTURE, DEFAULT_START, LLMPersonaAgent, Oracle, Rng, World, checkInWindows, crewOptInDraw, decide, freeFor,
  generatePersonas, hiddenLike, localParts, newMemory, optsInToCheckIn, parsePlanPicks, parseYesNo, planAgainAnswer, planAgainEdges,
  planEnjoyment, planPicksText, planYesDraw, planYesProb, templateText, timeConflict,
  type InboundMessage, type NetworkContext, type PersonaMemory, type NetworkUnderTest, type Persona, type PersonaContext, type PlanMeta,
  type PolicyOptions, type SimMessage, type SimMeta,
} from "../src/index.ts";

const T0 = DEFAULT_START;
const NOW = T0 + 1 * DAY + 12 * HOUR;
const SEED = 7;
const ZERO: ScoreComponents = {
  fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
  interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
};
const ON: PolicyOptions = { plans: true };

const people = (n: number, seed = 5) => generatePersonas({ n, seed, adversarialRate: 0, minorShare: 0, cityWeights: { sf: 0, nyc: 1 } })
  .map(p => { const q = structuredClone(p); q.hidden.responsiveness.ignoreProb = 0; q.joinDay = 0; return q; });

function ctxFor(p: Persona, all: Persona[], salt: string, memory = { ...newMemory(), joined: true }, now = NOW): PersonaContext {
  const byId = new Map(all.map(x => [x.id, x]));
  return {
    persona: p, memory, now, seed: SEED, rng: new Rng(`t:${p.id}:${salt}`), oracle: new Oracle(all, SEED, T0), history: [],
    lookupProposal: () => undefined, personaById: id => byId.get(id), personasMentioned: () => [],
  };
}
let seq = 0;
const out = (to: MemberId, body: string, meta: SimMeta, ts = NOW): SimMessage =>
  ({ id: `o${++seq}`, ts, direction: "outbound", channel: "imessage", from: "network", to, memberId: to, body, status: "delivered", meta });

/** New York local time `h` on day `d` after T0 (T0 is Mon 00:00 in SF = 03:00 in NYC). */
const nyAt = (d: number, h: number) => T0 + d * DAY + (h - 3) * HOUR;

describe("models match the engine plans harness (same formulas, same draws)", () => {
  const all = people(40);
  const oracle = new Oracle(all, SEED, T0);

  test("planEnjoyment and planYesProb", () => {
    for (let k = 0; k < 30; k++) {
      const a = ACTIVITIES[k % ACTIVITIES.length]!;
      const group = [0, 1, 2, 3].map(i => all[(k * 3 + i * 7) % all.length]!.id);
      const area = all[k % all.length]!.routine.homeArea;
      const mine = planEnjoyment(oracle, SEED, { id: `pl${k}`, activity: a.id, area }, group);
      const theirs = H.planEnjoyment(oracle, SEED, { id: `pl${k}`, activityId: a.id, place: { area } } as never, group);
      expect(mine).toEqual(theirs);
      for (const id of group) {
        const p = oracle.persona(id)!;
        for (const primed of [false, true]) {
          expect(planYesProb(oracle, p, hiddenLike(p, a), 4, "nyc", nyAt(4, 19), k % 4, primed))
            .toBeCloseTo(H.planYesProb(oracle, id, a, 4, "nyc", nyAt(4, 19), k % 4, primed), 12);
        }
      }
    }
    // The activity can be named by its label too.
    const p = all[0]!, a = activityById.get("group_run")!;
    expect(planEnjoyment(oracle, SEED, { id: "x", activity: a.label }, [p.id, all[1]!.id])).toEqual(planEnjoyment(oracle, SEED, { id: "x", activity: a.id }, [p.id, all[1]!.id]));
  });

  test("check-in answers, the weekly opt-in and crew opt-ins", () => {
    for (const p of all) {
      const free = (t: number) => freeFor(p, t, "nyc", SEED, oracle);
      const slots = candidateSlots(CITY_TZ.nyc, NOW, { window: { start: NOW, end: NOW + 7 * DAY } });
      const harness = H.checkInAnswer(SEED, p.id, slots, (_id, t) => free(t), { ...H.DEFAULT_CAPTURE });
      expect(checkInWindows(p, NOW, "nyc", SEED, free)).toEqual(harness);
      expect(optsInToCheckIn(SEED, p)).toBe(H.optsInToCheckIn(oracle, SEED, p.id, H.DEFAULT_CAPTURE));
      // With no ignoring (ignoreProb 0), the persona's crew answer is the harness's.
      expect(crewOptInDraw(SEED, "crew1", p.id) < 0.7).toBe(H.crewOptIn(oracle, SEED, p.id, "crew1"));
    }
    expect(DEFAULT_CAPTURE).toMatchObject({ checkIn: H.DEFAULT_CAPTURE.checkIn, recall: H.DEFAULT_CAPTURE.recall, falsePositive: H.DEFAULT_CAPTURE.falsePositive });
  });
});

describe("plan probes (PolicyOptions.plans)", () => {
  const all = people(60);
  const plan = (k: number, options = true): PlanMeta => ({
    planId: `pp${k}`, activity: ACTIVITIES[k % ACTIVITIES.length]!.id, size: 4, area: "Williamsburg",
    window: { start: nyAt(4, 19), end: nyAt(5, 21) },
    ...(options ? { options: [{ key: "1", label: "Thursday 7pm", start: nyAt(4, 19) }, { key: "2", label: "Friday 7pm", start: nyAt(5, 19) }] } : {}),
  });

  test("off: a plan probe is not read as a plan (no plan memory, no plan intents)", () => {
    for (const p of all.slice(0, 20)) {
      const ctx = ctxFor(p, all, "off");
      const d = decide(ctx, out(p.id, "Bouldering Thursday or Friday 7pm, 4 people. Reply 1, 2 or both.", { type: "plan_probe", proactive: true, plan: plan(1) }), T0, {});
      expect(["ignore", "ack"]).toContain(d.intent);
      expect(ctx.memory.plans).toBeUndefined();
    }
  });

  test("on: picks are exactly the options the persona wants and is free for; the words parse back", () => {
    let picks = 0, cant = 0, none = 0;
    for (let k = 0; k < 6; k++) for (const p of all) {
      const ctx = ctxFor(p, all, `pp${k}`);
      const pm = plan(k);
      const d = decide(ctx, out(p.id, "plan", { type: "plan_probe", proactive: true, plan: pm }), T0, ON);
      const like = hiddenLike(p, activityById.get(pm.activity)!);
      const expected = pm.options!.filter(o => planYesDraw(SEED, pm.planId, o.key, p.id) < planYesProb(ctx.oracle, p, like, 4, "nyc", o.start!, 1, false));
      const free = expected.filter(o => freeFor(p, o.start!, "nyc", SEED, ctx.oracle)).map(o => o.key);
      expect(d.planAnswer!.picks).toEqual(free);
      expect(d.intent).toBe(free.length ? "plan_pick" : expected.length ? "plan_cant" : "plan_none");
      const text = templateText(ctx, d);
      if (d.intent === "plan_cant") { expect(text).toMatch(/can't make that time/); cant++; continue; }
      expect(parsePlanPicks(text, pm.options!)).toEqual(free);
      if (free.length) {
        picks++;
        expect(ctx.memory.plans![pm.planId]).toMatchObject({ picks: free, activity: pm.activity, area: "Williamsburg" });
        expect(ctx.memory.proposals[pm.planId]!.decision).toBe("accept");
      } else none++;
    }
    expect(picks).toBeGreaterThan(10);
    expect(cant).toBeGreaterThan(0);
    expect(none).toBeGreaterThan(10);
  });

  test("a single plan (no options) is a plain yes, no or can't make that time", () => {
    const seen = new Set<string>();
    for (let k = 0; k < 4; k++) for (const p of all) {
      const ctx = ctxFor(p, all, `single${k}`);
      const d = decide(ctx, out(p.id, "plan", { type: "plan_probe", proactive: true, plan: plan(k, false) }), T0, ON);
      seen.add(d.intent);
      const text = templateText(ctx, d);
      if (d.intent === "plan_pick") expect(parseYesNo(text)).toBe("yes");
      else expect(parseYesNo(text)).toBe("no");
    }
    expect([...seen].sort()).toEqual(["plan_cant", "plan_none", "plan_pick"]);
  });

  test("every phrasing of every pick set parses back to that set", () => {
    for (const n of [2, 3, 4]) {
      const options = Array.from({ length: n }, (_, i) => ({ key: String(i + 1), label: `option ${i + 1}` }));
      for (let mask = 0; mask < 1 << n; mask++) {
        const picks = options.filter((_, i) => mask & (1 << i)).map(o => o.key);
        for (let r = 0; r < 25; r++) expect(parsePlanPicks(planPicksText(picks, options, new Rng(`pk${n}:${mask}:${r}`)), options)).toEqual(picks);
      }
    }
    expect(parsePlanPicks("1 and 2", [{ key: "1" }, { key: "2" }, { key: "3" }])).toEqual(["1", "2"]);
    expect(parsePlanPicks("the first two", [{ key: "1" }, { key: "2" }, { key: "3" }])).toEqual(["1", "2"]);
  });

  test("window priming: a stated window covering the time primes the probe; the option turns it off", () => {
    let differs = 0;
    for (const p of all) for (const priming of [true, false]) {
      const mem = { ...newMemory(), joined: true, stated: { windows: [{ start: nyAt(4, 19), end: nyAt(4, 21) }], at: NOW, until: NOW + 7 * DAY } };
      const ctx = ctxFor(p, all, `prime`, mem);
      const pm = plan(3);
      const d = decide(ctx, out(p.id, "plan", { type: "plan_probe", proactive: true, plan: pm }), T0, { plans: { windowPriming: priming } });
      const like = hiddenLike(p, activityById.get(pm.activity)!);
      const yes1 = planYesDraw(SEED, pm.planId, "1", p.id) < planYesProb(ctx.oracle, p, like, 4, "nyc", nyAt(4, 19), 1, priming);
      const free1 = freeFor(p, nyAt(4, 19), "nyc", SEED, ctx.oracle);
      expect(d.planAnswer!.picks.includes("1")).toBe(yes1 && free1);
      if (priming && yes1 !== (planYesDraw(SEED, pm.planId, "1", p.id) < planYesProb(ctx.oracle, p, like, 4, "nyc", nyAt(4, 19), 1, false))) differs++;
      if (d.intent !== "plan_none") expect(ctx.memory.plans![pm.planId]!.primed).toBe(priming && yes1);
    }
    expect(differs).toBeGreaterThan(3);
  });
});

describe("the weekly check-in and its offer", () => {
  const all = people(40);
  const CHECKIN = "What's your week like? A couple of evenings or times you're free is plenty.";

  test("answered with the free windows in day-and-daypart words; the windows are remembered for a week", () => {
    let answered = 0;
    for (const p of all) {
      const ctx = ctxFor(p, all, "ci");
      // The Network sends it as a question (packages/network copy.weeklyCheckin) or as type "checkin".
      for (const type of ["question", "checkin"] as const) {
        const d = decide({ ...ctx, memory: { ...newMemory(), joined: true } }, out(p.id, CHECKIN, { type, proactive: false }), T0, ON);
        expect(d.intent).toBe("checkin_answer");
      }
      const d = decide(ctx, out(p.id, CHECKIN, { type: "question", proactive: false }), T0, ON);
      const windows = checkInWindows(p, NOW, "nyc", SEED, t => freeFor(p, t, "nyc", SEED, ctx.oracle));
      expect(d.checkIn!.windows).toEqual(windows);
      expect(ctx.memory.stated).toEqual({ windows, at: NOW, until: NOW + 7 * DAY });
      const text = templateText(ctx, d).toLowerCase();
      const names = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      for (const w of windows) expect(text).toContain(names[localParts(w.start, "nyc").weekday]!);
      if (windows.length) answered++;
      // Off: the same question is an ordinary onboarding-style question.
      expect(decide(ctxFor(p, all, "ci-off"), out(p.id, CHECKIN, { type: "question", proactive: false }), T0, {}).intent).toBe("answer_question");
    }
    expect(answered).toBeGreaterThan(20);
  });

  test("the one-time WEEKLY offer: personas opt in as the harness says, once", () => {
    const offer = "You're both in: meet Sam, Thu 7pm. Next time I can skip the time question: reply CALENDAR to share your calendar's free/busy, or WEEKLY for a short weekly check-in.";
    let on = 0;
    for (const p of all) {
      const ctx = ctxFor(p, all, "weekly");
      const d = decide(ctx, out(p.id, offer, { type: "info" }), T0, ON);
      const yes = optsInToCheckIn(SEED, p);
      expect(d.followUps?.map(f => f.text) ?? []).toEqual(yes ? ["WEEKLY"] : []);
      expect(ctx.memory.weekly).toEqual({ offeredAt: NOW, on: yes });
      expect(decide(ctx, out(p.id, offer, { type: "info" }), T0, ON).followUps).toBeUndefined();
      if (yes) on++;
    }
    expect(on).toBeGreaterThan(5);
    expect(on).toBeLessThan(35);
  });
});

describe("crew offers and \"Would you do this again?\"", () => {
  const all = people(40);

  test("crew offers: opt in with p = 0.7 (x answering), the answer parses as yes or no, and is stable", () => {
    let yes = 0;
    for (const p of all) {
      const ctx = ctxFor(p, all, "crew");
      const d = decide(ctx, out(p.id, "Want to make this a weekly thing?", { type: "crew_offer", crew: { crewId: "crew:pl1" } }), T0, ON);
      const want = crewOptInDraw(SEED, "crew:pl1", p.id) < 0.7;
      expect(d.intent).toBe(want ? "crew_yes" : "crew_no");
      expect(parseYesNo(templateText(ctx, d))).toBe(want ? "yes" : "no");
      expect(ctx.memory.crews).toEqual({ "crew:pl1": want });
      if (want) yes++;
    }
    expect(yes).toBeGreaterThan(15);
    expect(yes).toBeLessThan(40);
  });

  test("the answer follows how the plan went; the words parse with planAgainAnswer", () => {
    const p = all[0]!;
    const cases = [
      { m: { showed: true, enjoyment: 0.72, othersShowed: ["x"] }, want: "yes" },
      { m: { showed: true, enjoyment: 0.45, othersShowed: ["x"] }, want: "no" },
      { m: { showed: false, enjoyment: 0, othersShowed: ["x"] }, want: "unclear" },
      { m: { showed: true, enjoyment: 0.9, othersShowed: [] }, want: "unclear" },
    ];
    for (const [i, c] of cases.entries()) for (let r = 0; r < 10; r++) {
      const mem: PersonaMemory = { ...newMemory(), joined: true, plans: { pl1: { at: NOW - DAY, picks: ["1"], primed: false } } };
      mem.meetings.pl1 = { at: NOW - 6 * HOUR, others: ["x"], cancelledWithNotice: false, ...c.m };
      const ctx = ctxFor(p, all, `again${i}:${r}`, mem);
      const d = decide(ctx, out(p.id, "How was it? Would you do this again?", { type: "feedback_request", proposalId: "pl1" }), T0, ON);
      expect(d.feedback!.plan).toBe(true);
      expect(planAgainAnswer(templateText(ctx, d))).toBe(c.want as "yes");
      expect(mem.plans!.pl1!.again).toBe(c.want === "yes");
    }
  });

  test("the LLM persona agent sends the template words for plan answers (no model call)", async () => {
    const calls: ChatMessage[][] = [];
    const llm: LLM = { chat: async (m: ChatMessage[]) => { calls.push(m); return JSON.stringify({ text: "sure!" }); } };
    const agent = new LLMPersonaAgent(llm, T0, { policy: ON });
    for (const p of all.slice(0, 10)) {
      const r = await agent.respond(ctxFor(p, all, "llm"), out(p.id, "plan", { type: "plan_probe", proactive: true, plan: { planId: "lp", activity: "bouldering", options: [{ key: "1", label: "Thu 7pm", start: nyAt(4, 19) }, { key: "2", label: "Fri 7pm", start: nyAt(5, 19) }] } }));
      if (r.intent === "plan_pick" || r.intent === "plan_none") expect(parsePlanPicks(r.text!, [{ key: "1" }, { key: "2" }])).toEqual(r.planAnswer!.picks);
    }
    expect(calls.length).toBe(0);
  });
});

// ------------------------------------------------------------------------------------------------
// End to end: a minimal Network that runs one round of plans the way the plans contract describes.

interface TestPlan { meta: PlanMeta; members: MemberId[]; booked?: { at: number; going: MemberId[] }; askedAgain?: boolean; offered?: boolean }

class PlanNet implements NetworkUnderTest {
  readonly name = "plan-test";
  ctx!: NetworkContext;
  plans: TestPlan[] = [];
  inbox: InboundMessage[] = [];
  private did = new Set<string>();
  init(ctx: NetworkContext) { this.ctx = ctx; }
  onInbound(msg: InboundMessage) { this.inbox.push(msg); }
  private once(k: string) { if (this.did.has(k)) return false; this.did.add(k); return true; }
  tick(now: number) {
    const day = Math.floor((now - T0) / DAY), h = localParts(now, "nyc").hour;
    const members = this.ctx.snapshot().members.map(m => m.id).sort();
    if (day === 1 && h >= 10 && this.once("checkin"))
      for (const id of members) this.ctx.send(id, "What's your week like? A couple of evenings or times you're free is plenty.", { meta: { type: "question", proactive: false } });
    if (day === 2 && h >= 10 && this.once("probe")) {
      for (let g = 0; g + 4 <= members.length; g += 4) {
        const a = ACTIVITIES[(g / 4) % ACTIVITIES.length]!;
        const meta: PlanMeta = {
          planId: `pl${g / 4}`, activity: a.id, size: 4, area: "Williamsburg", window: { start: nyAt(4, 19), end: nyAt(5, 21) },
          options: [{ key: "1", label: "Thursday 7pm", start: nyAt(4, 19) }, { key: "2", label: "Friday 7pm", start: nyAt(5, 19) }],
        };
        const tp: TestPlan = { meta, members: members.slice(g, g + 4) };
        this.plans.push(tp);
        for (const id of tp.members) this.ctx.send(id, `${a.label} with 3 others near Williamsburg: Thursday 7pm (1) or Friday 7pm (2)? Reply 1, 2, both or none.`, { meta: { type: "plan_probe", proactive: true, plan: meta } });
      }
    }
    if (day === 3 && h >= 10 && this.once("book")) {
      for (const [idx, tp] of this.plans.entries()) {
        const picks = new Map<MemberId, string[]>();
        for (const m of this.inbox) if (tp.members.includes(m.memberId) && m.ts > T0 + 2 * DAY) picks.set(m.memberId, parsePlanPicks(m.body, tp.meta.options!));
        const going = tp.members.filter(id => (picks.get(id) ?? []).length);
        if (going.length < 2) continue;
        // Everyone who said yes to either time is booked at the more popular one (some at a time they did not pick).
        const n1 = going.filter(id => picks.get(id)!.includes("1")).length;
        const o = n1 * 2 >= going.length ? tp.meta.options![0]! : tp.meta.options![1]!;
        const p: Proposal = {
          id: tp.meta.planId, kind: "group", participants: going, alternates: [], objective: `plan: ${activityById.get(tp.meta.activity)!.label}`, city: "nyc",
          window: tp.meta.window, score: 0.5, components: ZERO, exploration: false, explanations: {}, generator: "plan", createdAt: now, category: "social",
        };
        this.ctx.recordProposal(p, "network");
        // Every third plan moves two days later (the venue changed its hours): some can't make the new time.
        const at = idx % 3 === 2 ? o.start! + 2 * DAY : o.start!;
        this.ctx.recordMeeting({ proposalId: p.id, participants: going, at, city: "nyc", kind: "plan" });
        if (at !== o.start) for (const id of going) this.ctx.send(id, "The venue moved it: same plan, two days later at 7pm. Does that work?", { meta: { type: "scheduling", proposalId: p.id, meetingAt: at } });
        tp.booked = { at, going };
      }
    }
    for (const tp of this.plans) {
      if (!tp.booked) continue;
      if (now > tp.booked.at + 14 * HOUR && h >= 10 && h < 20 && !tp.askedAgain) {
        tp.askedAgain = true;
        for (const id of tp.booked.going) this.ctx.send(id, "How was it? Would you do this again?", { meta: { type: "feedback_request", proposalId: tp.meta.planId, plan: tp.meta } });
      }
      if (tp.askedAgain && now > tp.booked.at + 2 * DAY && h >= 10 && h < 20 && !tp.offered) {
        tp.offered = true;
        for (const id of tp.booked.going) this.ctx.send(id, "Want to make this a weekly thing?", { meta: { type: "crew_offer", crew: { crewId: `crew:${tp.meta.planId}` } } });
      }
    }
  }
}

async function runPlans(opts: { plans: boolean; timeAware: boolean }, seed = SEED) {
  const personas = people(160, 9);
  const net = new PlanNet();
  const w = new World({ seed, personas, days: 9, network: net, writeLog: false, plans: opts.plans, timeAware: opts.timeAware });
  const res = await w.run();
  return { w, net, res, personas: new Map(personas.map(p => [p.id, p])) };
}

describe("plans end to end (WorldOptions.plans)", () => {
  test("plan meetings are scored by the plan oracle; time-dependent attendance applies; answers become edges; crews are answered", async () => {
    const { w, net, res, personas } = await runPlans({ plans: true, timeAware: true });
    const outcomes = res.records.filter(r => r.type === "outcome") as Extract<typeof res.records[number], { type: "outcome" }>[];
    expect(outcomes.length).toBeGreaterThan(3);
    let scored = 0, clashes = 0;
    for (const o of outcomes) {
      const tp = net.plans.find(x => x.meta.planId === o.proposalId)!;
      const showed = Object.entries(o.attendance).filter(([, a]) => a.showed).map(([id]) => id);
      // (f) A participant whose week clashes with the plan's time never comes.
      for (const id of Object.keys(o.attendance)) if (timeConflict(personas.get(id)!, o.proposalId, o.at, "nyc", SEED, w.oracle)) { clashes++; expect(o.attendance[id]!.showed).toBe(false); }
      if (showed.length < 2) continue;
      const e = planEnjoyment(w.oracle, SEED, { id: o.proposalId, activity: tp.meta.activity, area: "Williamsburg" }, showed);
      for (const id of showed) expect(o.attendance[id]!.enjoyment).toBe(e[id]!);
      scored++;
    }
    expect(scored).toBeGreaterThan(1);
    expect(clashes).toBeGreaterThan(0);

    // (d) would_interact_again edges: from each member who came and answered yes, to the others who came.
    const edges = w.snapshot().edges.filter(e => e.type === "would_interact_again");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges).toEqual(planAgainEdges(res.records, w.end).filter(() => true));
    for (const e of edges) {
      const o = outcomes.find(x => x.attendance[e.from]?.showed && x.attendance[e.to]?.showed)!;
      expect(o).toBeDefined();
      expect(res.memories.get(e.from)!.plans![o.proposalId]!.again).toBe(true);
      expect(res.memories.get(e.from)!.meetings[o.proposalId]!.enjoyment).toBeGreaterThanOrEqual(0.6);
    }
    // (e) crew offers were answered.
    const crewAnswers = [...res.memories.values()].filter(m => m.crews && Object.keys(m.crews).length).length;
    expect(crewAnswers).toBeGreaterThan(3);
    // (a) the check-in was answered with windows by most members.
    expect([...res.memories.values()].filter(m => m.stated?.windows.length).length).toBeGreaterThan(20);
  }, 60_000);

  test("off: the same Network's plan messages are not read as plans and no edges appear", async () => {
    const { w, res } = await runPlans({ plans: false, timeAware: false });
    expect(res.records.some(r => r.type === "outcome")).toBe(false); // nobody picks an option, so nothing is booked
    expect(w.snapshot().edges.some(e => e.type === "would_interact_again")).toBe(false);
    expect([...res.memories.values()].some(m => m.plans || m.stated || m.crews)).toBe(false);
  }, 60_000);

  test("deterministic: the same seed gives the same run", async () => {
    const strip = (rs: unknown[]) => JSON.stringify(rs.map(r => ((r as { type: string }).type === "run_end" ? { ...(r as object), wallMs: 0 } : (r as { type: string }).type === "run_start" ? { ...(r as object), runId: "" } : r)));
    const a = await runPlans({ plans: true, timeAware: true }), b = await runPlans({ plans: true, timeAware: true });
    expect(strip(a.res.records)).toBe(strip(b.res.records));
  }, 60_000);
});

describe("stub availability tags (engine parses day tags case-insensitively since ec15e5c)", () => {
  test("lowercase sim tags give the same standing windows as the old upper-cased ones", () => {
    const facets = [
      { kind: "availability_pattern", tags: ["evening:tue", "evening:thu"], observedAt: NOW },
      { kind: "availability_pattern", tags: ["evening:sat", "morning:sun", "wake:7"], observedAt: NOW, inferred: true },
    ];
    const upper = facets.map(f => ({ ...f, tags: f.tags.map(t => t.replace(/:([a-z])([a-z]{2})$/, (_, a: string, b: string) => `:${a.toUpperCase()}${b}`)) }));
    const lower = standingFromFacets(facets, NOW);
    expect(lower.length).toBe(3);
    expect(lower).toEqual(standingFromFacets(upper, NOW));
  });
});
