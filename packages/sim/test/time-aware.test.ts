// Time awareness (PolicyOptions.timeAware, WorldOptions.timeAware, StubOptions.timeAware): personas answer
// offered times from a hidden weekly availability, booked-plan reveals use opt-out semantics, attendance
// drops at a time that clashes, and the stub books meetings from availability instead of 19:00 two days out.
// Everything is opt-in, so runs without the flags do not move.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type ChatMessage, type Facet, type LLM, type Member, type MemberId, type Proposal, type ScoreComponents, type WorldSnapshot } from "@thenetwork/core";
import { hiddenAvailability } from "../../engine/experiments/attention.ts";
import {
  DEFAULT_START, LLMPersonaAgent, Oracle, Rng, StubNetwork, World, decide, freeFor, generatePersonas, hiddenFree, localParts,
  newMemory, templateText, timeAnswerText, timeConflict, type NetworkContext, type NetworkUnderTest, type Persona,
  type PersonaContext, type PolicyOptions, type SimMessage, type SimMeta, type TimeOption,
} from "../src/index.ts";

const T0 = DEFAULT_START;
const NOW = T0 + 1 * DAY + 12 * HOUR;
const SEED = 11;
const ZERO: ScoreComponents = {
  fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
  interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
};

const people = (n: number, seed = 5) => generatePersonas({ n, seed, adversarialRate: 0, minorShare: 0, cityWeights: { sf: 0, nyc: 1 } })
  .map(p => { const q = structuredClone(p); q.hidden.responsiveness.ignoreProb = 0; return q; });

function ctxFor(p: Persona, all: Persona[], salt: string, props: Proposal[] = [], memory = { ...newMemory(), joined: true }): PersonaContext {
  const byId = new Map(all.map(x => [x.id, x]));
  const pm = new Map(props.map(x => [x.id, x]));
  return {
    persona: p, memory, now: NOW, seed: SEED, rng: new Rng(`t:${p.id}:${salt}`), oracle: new Oracle(all, SEED, T0), history: [],
    lookupProposal: id => pm.get(id), personaById: id => byId.get(id), personasMentioned: () => [],
  };
}
let seq = 0;
const out = (to: MemberId, body: string, meta: SimMeta): SimMessage =>
  ({ id: `o${++seq}`, ts: NOW, direction: "outbound", channel: "imessage", from: "network", to, memberId: to, body, status: "delivered", meta });

/** 2-3 options over the next week: weekday 19:00, weekend 10:00 / 14:00 (New York). */
function optionsAt(k: number): TimeOption[] {
  const base = T0 + (2 + (k % 4)) * DAY; // Wed..Sat 00:00 PDT = 03:00 NYC
  const at = (d: number, h: number) => base + d * DAY + (h - 3) * HOUR;
  const raw = [at(0, 19), at(1, k % 2 ? 10 : 19), at(2, 14)].slice(0, 2 + (k % 2));
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return raw.map((start, i) => {
    const lp = localParts(start, "nyc");
    const h = lp.hour % 12 === 0 ? 12 : lp.hour % 12;
    return { key: "abc"[i]!, start, end: start + 2 * HOUR, label: `${names[lp.weekday]} ${h}${lp.hour < 12 ? "am" : "pm"}` };
  });
}

/** Reference parser for the time-answer contract (what a Network must understand). */
function parsePicks(text: string, options: TimeOption[]): string[] {
  const t = text.toLowerCase();
  if (/\b(neither|none)\b/.test(t)) return [];
  if (/\b(either|any of)\b/.test(t)) return options.map(o => o.key);
  const ord = ["first", "second", "third"].findIndex(w => new RegExp(`\\b${w}\\b`).test(t));
  if (ord >= 0) return [options[ord]!.key];
  const byKey = options.filter(o => new RegExp(`(^|\\s)${o.key}(\\s|$)`).test(t.replace(/[.,!]/g, " ")) && /\bor\b|works/.test(t));
  const byLabel = options.filter(o => t.includes(o.label.toLowerCase()) || t.includes(o.label.split(" ")[0]!.toLowerCase()));
  return (byLabel.length ? byLabel : byKey).map(o => o.key);
}

describe("hidden weekly availability", () => {
  test("is the attention harness's hiddenAvailability (same draws), plus presence", () => {
    const all = people(40);
    const oracle = new Oracle(all, SEED, T0);
    const harness = hiddenAvailability(() => ({ oracle }) as never, SEED);
    let n = 0, free = 0;
    for (const p of all) for (let h = 0; h < 14 * 24; h += 3) {
      const t = T0 + h * HOUR;
      expect(hiddenFree(p, t, SEED)).toBe(harness(p.id, t));
      n++; if (hiddenFree(p, t, SEED)) free++;
    }
    expect(free / n).toBeGreaterThan(0.1);
    expect(free / n).toBeLessThan(0.6);
    // Away on a trip: never free for a meeting at home.
    const p = structuredClone(all[0]!);
    p.hidden.trips = [{ city: "sf", fromDay: 0, toDay: 20 }];
    for (let h = 0; h < 7 * 24; h += 2) expect(freeFor(p, T0 + h * HOUR, "nyc", SEED, oracle)).toBe(false);
  });
});

describe("answers to offered times (PolicyOptions.timeAware)", () => {
  const all = people(30);
  const probe = (p: Persona, k: number, timeOptions?: TimeOption[]) => out(p.id, "Up for a run club this week?", {
    type: "probe", proactive: true, probe: { key: `pk${k}`, category: "hobby" }, ...(timeOptions ? { timeOptions } : {}),
  });

  test("off: a probe with time options is answered exactly as one without", () => {
    for (const [i, p] of all.entries()) {
      const a = decide(ctxFor(p, all, `x${i}`), probe(p, i, optionsAt(i)), T0, {});
      const b = decide(ctxFor(p, all, `x${i}`), probe(p, i), T0, {});
      expect(a).toEqual(b);
      expect(a.timeAnswer).toBeUndefined();
    }
  });

  test("on: a yes picks exactly the options the persona is free for, in words the Network can parse back", () => {
    const opts: PolicyOptions = { timeAware: true };
    let yes = 0, none = 0, some = 0;
    for (let k = 0; k < 6; k++) for (const [i, p] of all.entries()) {
      const options = optionsAt(k + i);
      const ctx = ctxFor(p, all, `y${k}:${i}`);
      const d = decide(ctx, probe(p, k * 100 + i, options), T0, opts);
      if (d.intent !== "probe_yes") { expect(d.timeAnswer).toBeUndefined(); continue; }
      yes++;
      const free = options.filter(o => freeFor(p, o.start, "nyc", SEED, ctx.oracle)).map(o => o.key);
      expect(d.timeAnswer!.picks).toEqual(free);
      if (!free.length) none++; else if (free.length < options.length) some++;
      const text = templateText(ctx, d);
      expect(parsePicks(text, options)).toEqual(free);
    }
    expect(yes).toBeGreaterThan(20);
    expect(none).toBeGreaterThan(0);
    expect(some).toBeGreaterThan(0);
  });

  test("every phrasing of every pick set parses back to that set", () => {
    for (let k = 0; k < 2; k++) {
      const options = optionsAt(k);
      const sets = options.length === 2 ? [[], ["a"], ["b"], ["a", "b"]] : [[], ["a"], ["b"], ["c"], ["a", "c"], ["b", "c"], ["a", "b", "c"]];
      for (const picks of sets) for (let r = 0; r < 12; r++)
        expect(parsePicks(timeAnswerText({ picks, options }, new Rng(`ph:${k}:${picks}:${r}`)), options)).toEqual(picks);
    }
  });
});

describe("booked-plan reveals (SimMeta.booked)", () => {
  const all = people(40);
  const prop = (id: string, a: MemberId, b: MemberId): Proposal => ({
    id, kind: "intro", participants: [a, b], alternates: [], objective: "Go for a run", category: "hobby", city: "nyc",
    window: { start: NOW + DAY, end: NOW + 3 * DAY }, score: 0.5, components: ZERO, exploration: false, explanations: {}, generator: "test", createdAt: NOW,
  });
  const reveal = (p: Persona, pr: Proposal, at: number) => out(p.id, "You're both in: meet Sam, Thu 7pm near the park. Reply if you can't make it.", {
    type: "proposal", proposalId: pr.id, participants: pr.participants, proactive: false, booked: { proposalId: pr.id, at, optOutHours: 48 },
  });

  test("on: silent (or a short ack) when it fits; \"can't make it\" when the persona would decline or the time clashes", () => {
    const counts = { silent: 0, cancel: 0, clash: 0 };
    for (let k = 0; k < 4; k++) for (let i = 0; i + 1 < all.length; i += 2) {
      const [p, q] = [all[i]!, all[i + 1]!];
      const pr = prop(`bk${k}:${i}`, p.id, q.id);
      const at = optionsAt(k + i)[0]!.start;
      const ctx = ctxFor(p, all, `b${k}:${i}`, [pr]);
      const d = decide(ctx, reveal(p, pr, at), T0, { timeAware: true });
      const mem = ctx.memory.proposals[pr.id]!;
      const clash = timeConflict(p, pr.id, at, "nyc", SEED, ctx.oracle);
      expect(mem.at).toBe(at);
      if (clash) { counts.clash++; expect(d.intent).toBe("booked_cancel"); expect(mem.plannedShow).toBe(false); }
      if (mem.decision === "decline") expect(d.intent).toBe("booked_cancel");
      if (d.intent === "booked_cancel") { counts.cancel++; expect(templateText(ctx, d)).toMatch(/can't make it/); }
      else { counts.silent++; expect(["ignore", "ack"]).toContain(d.intent); expect(mem.decision).not.toBe("decline"); }
    }
    expect(counts.clash).toBeGreaterThan(0);
    expect(counts.silent).toBeGreaterThan(0);
  });

  test("off: the reveal is judged as a named proposal, as before", () => {
    const [p, q] = [all[0]!, all[1]!];
    const pr = prop("bk-off", p.id, q.id);
    const d = decide(ctxFor(p, all, "off", [pr]), reveal(p, pr, optionsAt(0)[0]!.start), T0, {});
    expect(["accept", "decline", "counter"]).toContain(d.intent);
  });
});

/** A network that books every pair of members at one fixed time, without asking. */
function booker(pairs: [MemberId, MemberId][], at: number): NetworkUnderTest & { ids: string[] } {
  const ids: string[] = [];
  return {
    name: "booker", ids,
    init(ctx: NetworkContext) {
      pairs.forEach(([a, b], i) => {
        const p: Proposal = { id: `fx${i}`, kind: "intro", participants: [a, b], alternates: [], objective: "coffee", city: "nyc",
          window: { start: at, end: at }, score: 0.5, components: ZERO, exploration: false, explanations: {}, generator: "test", createdAt: T0 };
        ctx.recordProposal(p, "scenario");
        ids.push(ctx.recordMeeting({ proposalId: p.id, participants: [a, b], at, city: "nyc" }));
      });
    },
    onInbound() {}, tick() {},
  };
}

describe("time-dependent attendance (WorldOptions.timeAware)", () => {
  test("a clashing time drops attendance; a fitting time changes nothing", async () => {
    const all = people(40, 9);
    const pairs = Array.from({ length: 20 }, (_, i) => [all[2 * i]!.id, all[2 * i + 1]!.id] as [MemberId, MemberId]);
    const at = T0 + 3 * DAY + 16 * HOUR; // Thu 19:00 New York
    const run = async (timeAware: boolean) => {
      const w = new World({ seed: SEED, personas: all.map(p => ({ ...p, joinDay: 99 })), days: 5, network: booker(pairs, at), writeLog: false, timeAware });
      await w.begin();
      // Everyone already said yes and plans to come: only the time can keep them away.
      pairs.forEach(([a, b], i) => {
        w.memories.get(a)!.proposals[`fx${i}`] = { decision: "accept", plannedShow: true, enjoyment: 0.6, others: [b] };
        w.memories.get(b)!.proposals[`fx${i}`] = { decision: "accept", plannedShow: true, enjoyment: 0.6, others: [a] };
      });
      await w.advanceTo(w.end);
      return { w, outcomes: w.records.filter(r => r.type === "outcome") as { attendance: Record<string, { showed: boolean; cancelledWithNotice: boolean }>; proposalId: string }[] };
    };
    const off = await run(false), on = await run(true);
    let seats = 0, clashes = 0, notices = 0;
    for (const o of off.outcomes) for (const s of Object.values(o.attendance)) expect(s.showed).toBe(true);
    for (const o of on.outcomes) for (const [id, s] of Object.entries(o.attendance)) {
      const p = all.find(x => x.id === id)!;
      const clash = timeConflict(p, o.proposalId, at, "nyc", SEED, on.w.oracle);
      expect(s.showed).toBe(!clash);
      seats++; if (clash) { clashes++; if (s.cancelledWithNotice) notices++; }
    }
    expect(seats).toBe(40);
    expect(clashes).toBeGreaterThan(5);
    expect(notices / clashes).toBeGreaterThan(0.5);
  });
});

describe("stub meeting times (StubOptions.timeAware)", () => {
  test("default: every meeting at 19:00 local two days after the last yes (unchanged)", async () => {
    const personas = people(120, 2).map(p => ({ ...p, joinDay: 0 }));
    const r = await new World({ seed: 2, personas, days: 14, network: new StubNetwork({ seed: 2, introRate: 1 }), writeLog: false }).run();
    const meet = r.records.filter(x => x.type === "meeting_scheduled") as { at: number; t: number }[];
    expect(meet.length).toBeGreaterThan(3);
    for (const m of meet) { expect(localParts(m.at, "nyc").hour).toBe(19); expect(m.at - m.t).toBeGreaterThan(2 * DAY - HOUR); }
  });

  /** A stub on a hand-made snapshot: two NYC members, `facets` what they told the Network. */
  function stubWith(facets: { memberId: string; tags: string[] }[], presence: WorldSnapshot["presence"] = []) {
    const member = (id: string): Member => ({ id, name: `${id} X`, homeCity: "nyc", state: "normal", prefs: { quietHours: [22, 8] } as Member["prefs"], joinedAt: T0, age: 30, unansweredProactive: 0 });
    const snap: WorldSnapshot = {
      now: NOW, members: [member("a"), member("b")], intents: [], edges: [], recentProposals: [], presence,
      facets: facets.map((f, i) => ({ id: `f${i}`, memberId: f.memberId, kind: "availability_pattern", value: "calendar usually free", tags: f.tags,
        scope: "agent_private", provenance: "inferred", confidence: 0.8, observedAt: NOW - DAY, inferred: false }) as Facet),
    };
    const stub = new StubNetwork({ seed: 1, timeAware: true });
    stub.init({ snapshot: () => snap } as unknown as NetworkContext);
    // Window Wed 10/7 to Sun 10/11 (New York).
    const p: Proposal = { id: "sp1", kind: "intro", participants: ["a", "b"], alternates: [], objective: "coffee", city: "nyc",
      window: { start: T0 + 2 * DAY, end: T0 + 6 * DAY }, score: 0.5, components: ZERO, exploration: false, explanations: {}, generator: "test", createdAt: NOW };
    return (stub as unknown as { pickSlot(p: Proposal, going: MemberId[], now: number): number }).pickSlot(p, ["a", "b"], NOW);
  }

  test("on: the slot follows what both members said (Thursday evenings), from 24 hours ahead, inside the window", () => {
    const at = stubWith([{ memberId: "a", tags: ["evening:thu"] }, { memberId: "b", tags: ["evening:mon", "evening:thu"] }]);
    const lp = localParts(at, "nyc");
    expect([lp.weekday, lp.hour]).toEqual([4, 19]);
  });

  test("on: no stated availability gives a weekend-daytime or weekday-evening slot; a trip away rules its days out", () => {
    const plain = localParts(stubWith([]), "nyc");
    expect(plain.weekday === 0 || plain.weekday === 6 ? [10, 14, 19] : [19]).toContain(plain.hour);
    const thuAway = stubWith([{ memberId: "a", tags: ["evening:thu"] }, { memberId: "b", tags: ["evening:thu"] }],
      [{ memberId: "b", city: "sf", type: "temporary", areas: [], from: T0 + 3 * DAY, to: T0 + 4 * DAY + 12 * HOUR }]);
    expect(localParts(thuAway, "nyc").weekday).not.toBe(4);
  });
});

describe("LLM persona agent", () => {
  const all = people(6);
  const fake = (reply: string) => {
    const calls: ChatMessage[][] = [];
    const llm: LLM = { chat: async (m: ChatMessage[]) => { calls.push(m); return reply; } };
    return { llm, calls };
  };

  test("menu answers and tapbacks use the template text without a model call", async () => {
    const { llm, calls } = fake(JSON.stringify({ text: "the climbing one sounds fun!" }));
    const agent = new LLMPersonaAgent(llm, T0, { policy: { reactions: true } });
    const p = all[0]!;
    const menu = out(p.id, "Two things this week, reply 1, 2 or none", {
      type: "info", menu: { options: [{ key: "1", label: "climbing night", category: "hobby" }, { key: "2", label: "book swap", category: "social" }] },
    });
    for (let k = 0; k < 10; k++) {
      const r = await agent.respond(ctxFor(p, all, `m${k}`), { ...menu, id: `menu${k}` });
      if (r.intent === "menu_pick") expect(r.text).toBe(r.menuChoice!);
      if (r.intent === "menu_none") expect(r.text).toBe("none");
      if (r.intent === "react") expect(["👍", "❤️"]).toContain(r.text!);
    }
    expect(calls.length).toBe(0);
  });

  test("time answers: the model is told which offered times fit; with no model the template answers", async () => {
    const { llm, calls } = fake(JSON.stringify({ text: "Thursday works", decision: "none", worthwhile: true }));
    const agent = new LLMPersonaAgent(llm, T0, { policy: { timeAware: true } });
    const broken = new LLMPersonaAgent({ chat: async () => { throw new Error("offline"); } }, T0, { policy: { timeAware: true } });
    let checked = 0;
    for (let k = 0; k < 40 && checked < 3; k++) for (const p of all) {
      const options = optionsAt(k);
      const msg = out(p.id, "Up for a run club?", { type: "probe", proactive: true, probe: { key: `lk${k}`, category: "hobby" }, timeOptions: options });
      const r = await agent.respond(ctxFor(p, all, `l${k}`), msg);
      if (r.intent !== "probe_yes") continue;
      const prompt = calls.at(-1)!.map(m => m.content).join("\n");
      expect(prompt).toContain(options[0]!.label);
      expect(prompt).toMatch(r.timeAnswer!.picks.length ? /work/ : /neither|none/);
      const fb = await broken.respond(ctxFor(p, all, `l${k}`), msg);
      expect(parsePicks(fb.text!, options)).toEqual(fb.timeAnswer!.picks);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
