// Regression tests for the 2026-10-08 adversarial audit (packages/sim findings).
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type Proposal } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { decide, DEFAULT_START, evaluateExpectations, factLeaked, generatePersonas, networkStateFromRecords, newMemory, nextLocalHour, Oracle, PRIMED_MODEL, replyDelay, Rng, runScenario, runWorld, StubNetwork, World, type Expectation, type NetworkContext, type NetworkUnderTest, type Scenario, type WorldResult } from "../src/index.ts";

const T0 = DEFAULT_START + 2 * DAY;
const prop = (id: string, participants: string[]): Proposal => ({
  id, kind: "intro", participants, alternates: [], objective: "Intro", city: "sf", score: 0.5,
  components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
  exploration: false, explanations: {}, generator: "test", createdAt: T0,
});
const oracle = { compatible: true, quality: 0.7, minEnjoyment: 0.7, flags: [], participants: {} };
let seq = 0;
const out = (t: number, memberId: string, type: string, proposalId?: string): RunRecord =>
  ({ t, type: "message", msg: { id: `o${++seq}`, ts: t, direction: "outbound", memberId, body: "…", status: "delivered", meta: { type, proposalId } } });
const inbound = (t: number, memberId: string, body: string): RunRecord =>
  ({ t, type: "message", msg: { id: `i${++seq}`, ts: t, direction: "inbound", memberId, body, status: "delivered" } });
const decision = (t: number, memberId: string, d: string, intent: string, proposalId: string): RunRecord =>
  ({ t, type: "decision", memberId, messageId: "x", messageType: "proposal", intent, decision: d, proposalId, delayMs: 0 });

describe("sim-worlds-1: the Network's own state carries no hidden decisions", () => {
  test("an ignored invite is no response, not a decline; meeting enjoyment without an answered feedback request is not feedback", () => {
    const records: RunRecord[] = [
      { t: T0, type: "proposal", source: "engine", proposal: prop("p1", ["a", "b"]), oracle },
      out(T0, "a", "proposal", "p1"), out(T0, "b", "proposal", "p1"),
      // a privately declines but never replies; b says yes.
      decision(T0 + HOUR, "a", "decline", "ignore", "p1"),
      decision(T0 + HOUR, "b", "accept", "accept", "p1"),
      inbound(T0 + 2 * HOUR, "b", "Yes, I'd like that!"),
      { t: T0 + 3 * HOUR, type: "meeting_scheduled", meetingId: "m1", proposalId: "p1", participants: ["a", "b"], at: T0 + DAY, city: "sf" },
      { t: T0 + DAY, type: "outcome", meetingId: "m1", proposalId: "p1", at: T0 + DAY, attendance: { a: { showed: true, cancelledWithNotice: false, enjoyment: 0.1 }, b: { showed: true, cancelledWithNotice: false, enjoyment: 0.9 } } },
      // A feedback request a never answers.
      out(T0 + DAY + 3 * HOUR, "a", "feedback_request", "p1"),
    ];
    const s = networkStateFromRecords(records, T0 + 3 * DAY);
    const i = s.interactions.find(x => x.id === "p1")!;
    expect(i.declinedBy).toBeUndefined();
    expect(i.acceptedBy).toEqual(["b"]);
    expect(i.noResponse).toEqual(["a"]);
    expect(i.outcome).toBe("completed");
    expect(s.feedback).toEqual([]);
  });

  test("feedback comes from the member's answer, read from their words", () => {
    const records: RunRecord[] = [
      { t: T0, type: "proposal", source: "engine", proposal: prop("p1", ["a", "b"]), oracle },
      { t: T0 + 3 * HOUR, type: "meeting_scheduled", meetingId: "m1", proposalId: "p1", participants: ["a", "b"], at: T0 + DAY, city: "sf" },
      { t: T0 + DAY, type: "outcome", meetingId: "m1", proposalId: "p1", at: T0 + DAY, attendance: { a: { showed: true, cancelledWithNotice: false, enjoyment: 0.9 }, b: { showed: true, cancelledWithNotice: false, enjoyment: 0.9 } } },
      { t: T0 + DAY + 4 * HOUR, type: "feedback", memberId: "a", proposalId: "p1", text: "Honestly not great, we didn't have much to talk about." },
    ];
    const s = networkStateFromRecords(records, T0 + 3 * DAY);
    expect(s.feedback.map(f => [f.from, f.about, f.sentiment, f.wouldMeetAgain])).toEqual([["a", "b", "negative", false]]);
  });
});

describe("matching-e2e-4: a probe-primed yes still depends on who the others are", () => {
  test("with identityFit set, primed accept is PRIMED_MODEL.identity for a good fit and much lower for a poor fit", () => {
    const ps = generatePersonas({ n: 60, seed: 3, minorShare: 0 }).filter(p => !p.hidden.adversarial && p.homeCity === "sf");
    const o = new Oracle(ps, 3, DEFAULT_START);
    const a = ps[0]!;
    const at = DEFAULT_START + DAY;
    const prop = (b: string) => ({ id: `p:${b}`, kind: "intro" as const, participants: [a.id, b], city: "sf" as const, window: { start: at, end: at }, category: "social" as const });
    const others = ps.slice(1).filter(b => !a.relationships.some(r => r.to === b.id))
      .map(b => ({ b, acc: o.evaluate(prop(b.id)).participants[a.id]!.acceptProb })).sort((x, y) => x.acc - y.acc);
    PRIMED_MODEL.identityFit = 0.55;
    const poor = o.evaluatePrimed(prop(others[0]!.b.id), { [a.id]: "probe" }).participants[a.id]!.acceptProb;
    const good = o.evaluatePrimed(prop(others.at(-1)!.b.id), { [a.id]: "probe" }).participants[a.id]!.acceptProb;
    delete PRIMED_MODEL.identityFit;
    expect(good).toBeCloseTo(PRIMED_MODEL.identity, 2);
    expect(poor).toBeLessThan(0.6 * PRIMED_MODEL.identity);
  });
});

describe("sim-worlds-11: the world's oracle sees the proposal category", () => {
  test("a romance-category proposal with a neutral objective between incompatible members is flagged unsafe", async () => {
    const personas = generatePersonas({ n: 24, seed: 2, adversarialRate: 0, minorShare: 0, cityWeights: { sf: 1, nyc: 0 }, joinSpreadDays: 1 });
    const [a, b] = personas.filter(p => !p.hidden.romance.optIn);
    let sent = false;
    const engine = {
      name: "one-romance-proposal",
      propose(snap: any, o?: { city?: string }) {
        if (sent || o?.city !== "sf") return [];
        sent = true;
        return [{ id: "r1", kind: "intro", category: "romance", participants: [a!.id, b!.id], alternates: [], objective: "coffee", city: "sf",
          score: 1, components: {} as any, exploration: false, explanations: {}, generator: "test", createdAt: snap.now }];
      },
    };
    const r = await runWorld({ seed: 2, personas, days: 2, network: new StubNetwork({ seed: 2, randomIntros: false }), engine: engine as any, writeLog: false });
    const rec = r.records.find(x => x.type === "proposal" && x.proposal.id === "r1");
    expect(rec?.type === "proposal" && rec.oracle.flags).toContain("romance_mismatch");
    expect(rec?.type === "proposal" && rec.oracle.unsafe).toBe(true);
  });
});

describe("matching-e2e-8: stable decisions and decline memory (OracleOptions.stableDecisions)", () => {
  const ps = generatePersonas({ n: 80, seed: 4, minorShare: 0, adversarialRate: 0, cityWeights: { sf: 1, nyc: 0 } });
  const at = DEFAULT_START + DAY;
  const ask = (o: Oracle, id: string, a: string, b: string, t = at) =>
    o.evaluate({ id, kind: "intro", participants: [a, b], city: "sf", window: { start: t, end: t + 3 * DAY }, category: "social" });

  test("re-asking the same people for the same thing in the same week is the same answer, not a fresh draw", () => {
    const flat = new Oracle(ps, 4, DEFAULT_START), stable = new Oracle(ps, 4, DEFAULT_START, { stableDecisions: true });
    let flips = 0;
    for (let i = 0; i + 1 < ps.length; i += 2) {
      const [a, b] = [ps[i]!.id, ps[i + 1]!.id];
      const s1 = ask(stable, "x1", a, b).participants[a]!, s2 = ask(stable, "x2", a, b, at + HOUR).participants[a]!;
      expect(s2.wouldAccept).toBe(s1.wouldAccept);
      if (ask(flat, "x1", a, b).participants[a]!.wouldAccept !== ask(flat, "x2", a, b).participants[a]!.wouldAccept) flips++;
    }
    expect(flips).toBeGreaterThan(0); // the default model does re-draw per proposal id
  });

  test("a persona who declined the same people and category declines a new ask a week later", () => {
    const o = new Oracle(ps, 4, DEFAULT_START, { stableDecisions: true });
    // A pair whose first ask is a no and whose fresh ask next week would be a yes.
    let pair: [string, string] | undefined;
    for (let i = 0; i < ps.length && !pair; i++) for (let j = 0; j < ps.length && !pair; j++) {
      if (i === j) continue;
      const [a, b] = [ps[i]!.id, ps[j]!.id];
      if (!ask(o, "w1", a, b).participants[a]!.wouldAccept && ask(o, "w2", a, b, at + 7 * DAY).participants[a]!.wouldAccept) pair = [a, b];
    }
    expect(pair).toBeDefined();
    const [a, b] = pair!;
    const persona = ps.find(p => p.id === a)!;
    const memory = newMemory();
    const props = new Map<string, Proposal>([["w1", { ...prop("w1", [a, b]), category: "social", window: { start: at, end: at + 3 * DAY } }], ["w2", { ...prop("w2", [a, b]), category: "social", window: { start: at + 7 * DAY, end: at + 10 * DAY } }]]);
    const ctx = (now: number) => ({ persona, memory, now, rng: new Rng(1), oracle: o, history: [], lookupProposal: (id: string) => props.get(id), personaById: (id: string) => ps.find(p => p.id === id), personasMentioned: () => [] });
    const msg = (pid: string, ts: number) => ({ id: pid, ts, direction: "outbound" as const, channel: "sms" as const, from: "network", to: a, memberId: a, body: "Want to meet?", status: "delivered" as const, meta: { type: "proposal" as const, proposalId: pid } });
    expect(decide(ctx(at), msg("w1", at), DEFAULT_START).decision).toBe("decline");
    expect(decide(ctx(at + 7 * DAY), msg("w2", at + 7 * DAY), DEFAULT_START).decision).toBe("decline");
  });
});

describe("matching-e2e-9: travel and meeting time change show-up (OracleOptions.logistics)", () => {
  test("a 3am slot or a slot in a weekday busy block lowers showProb; the default model ignores time", () => {
    const ps = generatePersonas({ n: 40, seed: 6, minorShare: 0, adversarialRate: 0, cityWeights: { sf: 1, nyc: 0 } });
    const a = ps.find(p => p.routine.busyBlocks.length && p.hidden.flakiness < 0.5)!, b = ps.find(p => p !== a)!;
    const slot = (hour: number) => nextLocalHour(DEFAULT_START + 2 * DAY, "sf", hour); // Wednesday
    const show = (o: Oracle, t: number) => o.evaluate({ id: "t", kind: "intro", participants: [a.id, b.id], city: "sf", window: { start: t, end: t + HOUR } }).participants[a.id]!.showProb;
    const on = new Oracle(ps, 6, DEFAULT_START, { logistics: true }), off = new Oracle(ps, 6, DEFAULT_START);
    const busy = a.routine.busyBlocks[0]![0];
    expect(show(on, slot(3))).toBeLessThan(0.5 * show(on, slot(busy)));
    expect(show(on, slot(busy))).toBeLessThan(show(off, slot(busy)));
    expect(show(off, slot(3))).toBe(show(off, slot(busy)));
  });
});

describe("scenario grading (sim-worlds-10, sim-worlds-12, sim-worlds-M3)", () => {
  const fact = "is going through a divorce and doesn't want anyone to know yet";
  const persona = (id: string, name: string, disclosure?: { fact: string; canary: string }) => {
    const p = structuredClone(generatePersonas({ n: 1, seed: id, minorShare: 0, adversarialRate: 0 })[0]!);
    p.id = id; p.name = name; if (disclosure) p.hidden.privateDisclosure = disclosure;
    return p;
  };
  const world = (records: RunRecord[], personas: ReturnType<typeof persona>[]) => ({ records, personas, metrics: {} } as unknown as WorldResult);
  const scenario = (expectations: Expectation[]): Scenario => ({ name: "t", description: "", seed: 1, days: 1, personas: [], actions: [], expectations });

  test("a paraphrased private fact without the canary token is a leak", () => {
    expect(factLeaked(fact, "Heads up: Leila is going through a divorce right now, so be kind.")).toBe(true);
    expect(factLeaked(fact, "Leila loves film and coffee in Hayes Valley.")).toBe(false);
    const w = world([out(T0, "other", "proposal", "p1")].map(r => ({ ...r, msg: { ...(r as any).msg, body: "You'd like Leila. She's going through a divorce, so go easy." } }) as RunRecord),
      [persona("discloser", "Leila Fischer", { fact, canary: "QX-1" })]);
    expect(evaluateExpectations(scenario([{ check: "canary_not_leaked", persona: "discloser" }]), w, "stub")[0]!.status).toBe("fail");
  });

  test("a block followed by a new proposal of the same pair fails blocked_pair_kept_apart; no block at all fails too", () => {
    const e: Expectation[] = [{ check: "blocked_pair_kept_apart", personas: ["ana", "hal"] }];
    const ps = [persona("ana", "Ana Lindqvist"), persona("hal", "Hal Brennan")];
    const after: RunRecord[] = [
      { t: T0, type: "block", from: "ana", to: "hal" },
      { t: T0 + DAY, type: "proposal", source: "network", proposal: prop("p2", ["ana", "hal"]), oracle },
    ];
    expect(evaluateExpectations(scenario(e), world(after, ps), "stub")[0]!.status).toBe("fail");
    expect(evaluateExpectations(scenario(e), world([], ps), "stub")[0]!.status).toBe("fail");
  });

  test("a scenario whose expectations are all skipped does not pass", async () => {
    const s = scenario([{ check: "metric", path: "errors", op: "==", value: 0, appliesTo: ["nobody"] }]);
    const r = await runScenario({ ...s, days: 1, background: { personas: 2 } }, { network: () => new StubNetwork({ seed: 1 }) });
    expect(r.vacuous).toBe(true);
    expect(r.pass).toBe(false);
  });
});

describe("sim-worlds-13: unsafe intros cost trust and members churn (PolicyOptions.qualityChurn)", () => {
  test("after two intros to their ex, a member opts out on a later proactive message; without the option they stay", () => {
    const ps = generatePersonas({ n: 120, seed: 9, minorShare: 0, adversarialRate: 0 });
    const a = ps.find(p => p.relationships.some(r => r.type === "ex") && p.archetype !== "never_replies")!;
    const ex = a.relationships.find(r => r.type === "ex")!.to;
    const o = new Oracle(ps, 9, DEFAULT_START);
    const run = (qualityChurn: boolean) => {
      const memory = newMemory();
      const props = new Map<string, Proposal>([1, 2].map(i => [`x${i}`, { ...prop(`x${i}`, [a.id, ex]), city: a.homeCity }]));
      const ctx = (now: number, salt: number) => ({ persona: a, memory, now, rng: new Rng(salt), oracle: o, history: [], lookupProposal: (id: string) => props.get(id), personaById: (id: string) => ps.find(p => p.id === id), personasMentioned: () => [] });
      const msg = (id: string, ts: number, type: "proposal" | "question", proposalId?: string) => ({ id, ts, direction: "outbound" as const, channel: "sms" as const, from: "network", to: a.id, memberId: a.id, body: "Hi", status: "delivered" as const, meta: { type, proposalId, proactive: true } });
      decide(ctx(T0, 1), msg("m1", T0, "proposal", "x1"), DEFAULT_START, { qualityChurn });
      decide(ctx(T0 + 8 * DAY, 2), msg("m2", T0 + 8 * DAY, "proposal", "x2"), DEFAULT_START, { qualityChurn });
      let optOuts = 0;
      for (let i = 0; i < 6; i++) if (decide(ctx(T0 + (16 + 3 * i) * DAY, 10 + i), msg(`q${i}`, T0 + (16 + 3 * i) * DAY, "question"), DEFAULT_START, { qualityChurn }).intent === "opt_out") optOuts++;
      return optOuts;
    };
    expect(run(true)).toBeGreaterThan(0);
    expect(run(false)).toBe(0);
  });
});

describe("P3 persona fixes", () => {
  test("sim-worlds-17: no member under 18 is an adult's ex, coworker or roommate", () => {
    const ps = generatePersonas({ n: 400, seed: 11, minorShare: 0.1 });
    const age = new Map(ps.map(p => [p.id, p.hidden.trueAge]));
    const bad = ps.flatMap(p => p.relationships.filter(r => ["ex", "coworker", "roommate"].includes(r.type) && (p.hidden.trueAge < 18) !== (age.get(r.to)! < 18)));
    expect(ps.some(p => p.hidden.trueAge < 18 && p.relationships.length)).toBe(true);
    expect(bad).toEqual([]);
  });

  test("sim-worlds-19: a traveller replies on the trip city's clock", () => {
    const p = structuredClone(generatePersonas({ n: 1, seed: 12, minorShare: 0, adversarialRate: 0, cityWeights: { sf: 1, nyc: 0 } })[0]!);
    p.routine.wake = 7; p.routine.sleep = 23; p.routine.busyBlocks = [];
    p.hidden.responsiveness = { ...p.hidden.responsiveness, latencyMedianMin: 2, latencySigma: 0.1 };
    p.hidden.trips = [{ city: "nyc", fromDay: 0, toDay: 5 }];
    const now = nextLocalHour(DEFAULT_START + DAY, "nyc", 8); // 8am in New York, 5am at home in SF
    expect(replyDelay(p, now, new Rng(1), 1, DEFAULT_START)).toBeLessThan(HOUR);
    expect(replyDelay(p, now, new Rng(1))).toBeGreaterThan(HOUR); // home-city clock: still asleep
  });

  test("sim-worlds-21: a spawned persona is found by a unique first name", () => {
    const ps = generatePersonas({ n: 10, seed: 13, minorShare: 0, adversarialRate: 0 });
    const w = new World({ seed: 13, personas: ps, days: 1, network: new StubNetwork({ seed: 13 }), writeLog: false });
    const friend = structuredClone(ps[0]!);
    friend.id = "spawned1"; friend.name = "Zebulon Quist"; friend.relationships = [];
    w.spawn(friend, DEFAULT_START + HOUR);
    const ctx = (w as any).personaCtx(ps[1]!, "t");
    expect(ctx.personasMentioned("you should meet Zebulon this week").map((p: { id: string }) => p.id)).toEqual(["spawned1"]);
  });
});

describe("judge-evals-M4: duplicate sends are logged", () => {
  test("a second send with the same idempotency key leaves a duplicate_send record", async () => {
    const ps = generatePersonas({ n: 2, seed: 14, minorShare: 0, adversarialRate: 0 });
    const net: NetworkUnderTest = { name: "dup", init: c => { (net as any).ctx = c; }, onInbound: () => {}, tick: () => {} };
    const w = new World({ seed: 14, personas: ps, days: 1, network: net, writeLog: false });
    await w.begin();
    await w.advanceTo(DEFAULT_START + 23 * HOUR);
    const ctx = (net as any).ctx as NetworkContext;
    ctx.send(ps[0]!.id, "Hi there", { idempotencyKey: "k1" });
    ctx.send(ps[0]!.id, "Hi there", { idempotencyKey: "k1" });
    expect(w.records.filter(r => r.type === "network_log" && r.kind === "duplicate_send").length).toBe(1);
  });
});

describe("judge-evals-20: the CLI audit fails loudly when the judge errors", () => {
  test("--judge with an unreachable judge endpoint exits non-zero", async () => {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/API_KEY|LIVE_TESTS|BASE_URL/.test(k)) env[k] = v;
    // A dummy key and a closed local port: every judge call fails fast, nothing leaves the machine.
    Object.assign(env, { SURPLUS_API_KEY: "dummy-not-a-key", SURPLUS_BASE_URL: "http://127.0.0.1:9/v1", JUDGE_PROVIDER: "surplus", LLM_MAX_RETRIES: "0", LLM_TIMEOUT_MS: "2000" });
    const p = Bun.spawn(["bun", `${import.meta.dir}/../src/cli.ts`, "--personas", "8", "--days", "2", "--no-log", "--judge", "2"], { env, stdout: "pipe", stderr: "pipe" });
    const [stdout, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
    expect(stdout).toContain("privacyLeaks=n/a");
    expect(code).not.toBe(0);
  }, 60_000);
});
