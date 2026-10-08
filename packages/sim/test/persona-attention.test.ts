// Persona behaviours ported from the attention-budget experiment (docs/results/2026-10-07-attention-budget.md):
// ask priming for probes, tapbacks as answers, and menus. All three are opt-in or keyed on SimMeta fields
// no existing Network sends, so baselines do not move.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type MemberId, type Proposal, type ScoreComponents } from "@thenetwork/core";
import {
  DEFAULT_START, Oracle, PolicyPersonaAgent, Rng, SimChannel, World, decide, generatePersonas, newMemory,
  type InboundMessage, type NetworkContext, type NetworkUnderTest, type Persona, type PersonaContext,
  type PolicyOptions, type Reaction, type SimMessage, type SimMeta,
} from "../src/index.ts";
import { SimClock } from "@thenetwork/core";

const T0 = DEFAULT_START;
const NOW = T0 + 2 * DAY + 12 * HOUR;
const ZERO: ScoreComponents = {
  fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0,
  interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0,
};

/** a wants a climbing partner; b is an experienced climber who wants one too; c is a's ex. */
function cast(over: (a: Persona, b: Persona, c: Persona) => void = () => {}) {
  const [a, b, c] = generatePersonas({ n: 3, seed: 42, adversarialRate: 0, minorShare: 0, cityWeights: { sf: 1, nyc: 0 } }).map(p => structuredClone(p));
  for (const p of [a!, b!, c!]) {
    p.archetype = "regular"; p.hidden.trips = []; p.secondaryCity = undefined; p.hidden.boundaries = []; p.relationships = [];
    p.hidden.capacity = 0.05; p.hidden.responsiveness.ignoreProb = 0; p.hidden.flakiness = 0;
    p.hidden.desires = [{ id: "climbing_partner", text: "find a regular climbing partner", category: "hobby", strength: 1 }];
    p.hidden.interests = ["climbing"];
  }
  b!.hidden.skills = ["climbing_belay"];
  a!.relationships = [{ to: c!.id, type: "ex" } as Persona["relationships"][number]];
  c!.relationships = [{ to: a!.id, type: "ex" } as Persona["relationships"][number]];
  over(a!, b!, c!);
  return [a!, b!, c!] as const;
}

const proposal = (id: string, participants: MemberId[]): Proposal => ({
  id, kind: "intro", participants, alternates: [], objective: "Climb together", category: "hobby", city: "sf",
  window: { start: NOW + DAY, end: NOW + 2 * DAY }, score: 0.5, components: ZERO, exploration: false, explanations: {}, generator: "test", createdAt: NOW,
});

function ctxFor(p: Persona, all: Persona[], salt: string, props: Proposal[] = [], memory = newMemory()): PersonaContext {
  const byId = new Map(all.map(x => [x.id, x]));
  const pm = new Map(props.map(x => [x.id, x]));
  return {
    persona: p, memory, now: NOW, rng: new Rng(`t:${p.id}:${salt}`), oracle: new Oracle(all, 7, T0), history: [],
    lookupProposal: id => pm.get(id), personaById: id => byId.get(id), personasMentioned: () => [],
  };
}

let seq = 0;
const out = (to: MemberId, body: string, meta: SimMeta): SimMessage =>
  ({ id: `o${++seq}`, ts: NOW, direction: "outbound", channel: "imessage", from: "network", to, memberId: to, body, status: "delivered", meta });

const asked = (category: "hobby", at = NOW - DAY) => ({ ...newMemory(), joined: true, signals: [{ category, at, source: "ask" as const }] });

describe("ask priming for probes (PolicyOptions.primeProbes)", () => {
  const [a, b, c] = cast();
  const all = [a, b, c];
  const probeMsg = (k: number) => out(a.id, "Would you be up for a climbing session this weekend?", {
    type: "probe", proactive: true, probe: { key: `pk${k}`, category: "hobby", participants: [a.id, b.id], kind: "intro", window: { start: NOW + DAY, end: NOW + DAY } },
  });
  const yesRate = (opts: PolicyOptions, mem: () => ReturnType<typeof newMemory>) => {
    let yes = 0;
    for (let k = 0; k < 60; k++) if (decide(ctxFor(a, all, `p${k}`, [], mem()), probeMsg(k), T0, opts).intent === "probe_yes") yes++;
    return yes / 60;
  };

  test("a member who asked this week answers a specific probe like a primed named invite, not with the cold model", () => {
    const cold = yesRate({}, () => asked("hobby"));
    const primed = yesRate({ primeProbes: true }, () => asked("hobby"));
    // Spare capacity 0.05: the cold probe model rests on this week's capacity; a met want, primed, says yes ~0.96.
    expect(primed).toBeGreaterThan(0.85);
    expect(primed - cold).toBeGreaterThan(0.3);
  });

  test("no recent ask (none, or older than 7 days): primeProbes changes nothing", () => {
    const off = (opts: PolicyOptions, mem: () => ReturnType<typeof newMemory>) =>
      Array.from({ length: 30 }, (_, k) => decide(ctxFor(a, all, `q${k}`, [], mem()), probeMsg(k), T0, opts).intent);
    expect(off({ primeProbes: true }, () => ({ ...newMemory(), joined: true }))).toEqual(off({}, () => ({ ...newMemory(), joined: true })));
    expect(off({ primeProbes: true }, () => asked("hobby", NOW - 8 * DAY))).toEqual(off({}, () => asked("hobby", NOW - 8 * DAY)));
  });

  test("priming keeps the truth: an ex is still a no", () => {
    const msg = (k: number) => out(a.id, "Up for a climb?", { type: "probe", proactive: true, probe: { key: `ex${k}`, category: "hobby", participants: [a.id, c.id] } });
    let yes = 0;
    for (let k = 0; k < 40; k++) if (decide(ctxFor(a, all, `x${k}`, [], asked("hobby")), msg(k), T0, { primeProbes: true }).intent === "probe_yes") yes++;
    expect(yes).toBeLessThan(10);
  });
});

describe("tapbacks (PolicyOptions.reactions)", () => {
  const [a, b, c] = cast(x => { x.hidden.capacity = 0.8; });
  const all = [a, b, c];
  const itemsMsg = (k: number, tags: string[]) => out(a.id, "Two things this week: a bouldering meetup Sat, and a gallery night Thu.", {
    type: "concierge", proactive: true, items: [{ key: `ev${k}`, label: "event", category: "events", tags }],
  });
  const answers = (opts: PolicyOptions, tags: string[]) => Array.from({ length: 80 }, (_, k) => {
    const m = itemsMsg(k, tags);
    return { m, d: decide(ctxFor(a, all, `i${k}`), m, T0, opts) };
  });

  test("off by default: an items message gets today's 8% acknowledgement and never a tapback", () => {
    const res = answers({}, ["climbing"]);
    expect(res.every(r => r.d.intent === "ack" || r.d.intent === "ignore")).toBe(true);
    expect(res.filter(r => r.d.intent === "ack").length).toBeLessThan(20);
  });

  test("on: interest in the item drives answers, and many answers are tapbacks on that message", () => {
    const liked = answers({ reactions: true }, ["climbing"]);
    const unliked = answers({ reactions: true }, ["opera"]);
    const answered = (rs: typeof liked) => rs.filter(r => r.d.intent !== "ignore").length;
    expect(answered(liked)).toBeGreaterThan(25);
    expect(answered(unliked)).toBeLessThan(answered(liked) / 2);
    const taps = liked.filter(r => r.d.intent === "react");
    expect(taps.length).toBeGreaterThan(10);
    for (const r of taps) expect(r.d.reaction).toEqual({ kind: "love", to: r.m.id });
    expect(liked.every(r => r.d.worthwhile === true)).toBe(true);
  });

  test("responsiveness still applies: a member who ignores everything never taps", () => {
    const [x] = cast(p => { p.hidden.capacity = 0.8; p.hidden.responsiveness.ignoreProb = 1; });
    const ds = Array.from({ length: 30 }, (_, k) => decide(ctxFor(x, [x, b, c], `n${k}`), itemsMsg(k, ["climbing"]), T0, { reactions: true }));
    expect(ds.every(d => d.intent === "ignore")).toBe(true);
  });

  test("the channel delivers a tapback as an inbound message with SimMeta.reaction and no keyword", () => {
    const ch = new SimChannel(new SimClock(T0));
    const r: Reaction = { kind: "like", to: "o000001" };
    const m = ch.receive("m1", "👍", { reaction: r });
    expect(m.meta?.reaction).toEqual(r);
    expect(m.keyword).toBeUndefined();
    expect(ch.receive("m1", "thanks").meta).toBeUndefined();
  });

  test("in a world: the Network sees each tapback on its inbound message, and it answers the open message", async () => {
    // A Network that sends one outside-world message to every member after they join, and records inbound.
    const run = async (policy?: PolicyOptions) => {
      let ctx!: NetworkContext;
      const sent = new Map<string, MemberId>();
      const inbound: (InboundMessage & { reaction?: Reaction })[] = [];
      const told = new Set<MemberId>();
      const net: NetworkUnderTest = {
        name: "items", init: c => { ctx = c; }, onInbound: m => { inbound.push(m); },
        tick: () => {
          for (const mem of ctx.snapshot().members) if (!told.has(mem.id)) {
            told.add(mem.id);
            const m = ctx.send(mem.id, "A climbing meetup and a jazz night this week, want links?", {
              meta: { type: "concierge", proactive: true, items: [{ key: "e1", tags: ["climbing"], category: "events" }, { key: "e2", tags: ["jazz"], category: "events" }] },
            });
            sent.set(m.id, mem.id);
          }
        },
      };
      const personas = generatePersonas({ n: 40, seed: 3, adversarialRate: 0, cityWeights: { sf: 1, nyc: 0 }, joinSpreadDays: 1 });
      const w = new World({ seed: 3, personas, days: 4, network: net, writeLog: false, policy });
      await w.run();
      const unanswered = new Map(ctx.snapshot().members.map(m => [m.id, m.unansweredProactive]));
      return { inbound, sent, unanswered };
    };
    const off = await run();
    expect(off.inbound.some(m => m.reaction)).toBe(false);
    const on = await run({ reactions: true });
    const taps = on.inbound.filter(m => m.reaction);
    expect(taps.length).toBeGreaterThan(0);
    for (const t of taps) {
      expect(on.sent.get(t.reaction!.to)).toBe(t.memberId); // a tapback on the message that member got
      expect(["👍", "❤️"]).toContain(t.body);
      expect(t.keyword).toBeUndefined();
      expect(on.unanswered.get(t.memberId)).toBe(0); // the tapback answered the one proactive message
    }
  });
});

describe("menus (SimMeta.menu)", () => {
  const [a, b, c] = cast(x => { x.hidden.capacity = 0.9; });
  const all = [a, b, c];
  const good = proposal("good", [a.id, b.id]);
  const bad = proposal("bad", [a.id, c.id]);
  const menuMsg = (options: NonNullable<SimMeta["menu"]>["options"]) =>
    out(a.id, "This week: 1) a climb with someone new 2) another climb. Reply 1, 2 or none.", { type: "proposal", proactive: true, menu: { options } });

  test("picks the option the oracle likes, answers with its key, and records a yes to that proposal", async () => {
    const agent = new PolicyPersonaAgent(T0);
    let picks = 0;
    for (let k = 0; k < 20; k++) {
      const ctx = ctxFor(a, all, `m${k}`, [good, bad], { ...newMemory(), joined: true });
      const r = await agent.respond(ctx, menuMsg([{ key: "1", label: "a climb", proposalId: "bad" }, { key: "2", label: "a climb", proposalId: "good" }]));
      expect(r.intent === "menu_pick" || r.intent === "menu_none").toBe(true);
      expect(r.text).not.toBe("1"); // never the ex
      if (r.intent === "menu_pick") {
        picks++;
        expect(r.text).toBe("2");
        expect(r.menuChoice).toBe("2");
        expect(r.proposalId).toBe("good");
        expect(ctx.memory.proposals.good?.decision).toBe("accept");
        expect(ctx.memory.proposals.bad).toBeUndefined();
      } else expect(r.text).toBe("none");
    }
    expect(picks).toBeGreaterThan(10);
  });

  test("answers \"none\" when no option is a yes (an ex, a blocked person)", async () => {
    const agent = new PolicyPersonaAgent(T0);
    for (let k = 0; k < 10; k++) {
      const mem = { ...newMemory(), joined: true, blocked: [b.id] };
      const ctx = ctxFor(a, all, `n${k}`, [good, bad], mem);
      const r = await agent.respond(ctx, menuMsg([{ key: "1", label: "a climb", proposalId: "good" }]));
      expect(r.intent).toBe("menu_none");
      expect(r.text).toBe("none");
      expect(mem.proposals.good).toBeUndefined();
    }
  });

  test("options without a proposal: hidden interest decides", () => {
    let climb = 0, opera = 0;
    for (let k = 0; k < 60; k++) {
      const d = decide(ctxFor(a, all, `h${k}`), menuMsg([{ key: "A", label: "opera night", category: "events" }, { key: "B", label: "bouldering and climbing meetup", category: "events" }]), T0);
      if (d.menuChoice === "B") climb++;
      if (d.menuChoice === "A") opera++;
    }
    expect(climb).toBeGreaterThan(opera);
  });

  test("responsiveness: a member who ignores messages ignores the menu and commits to nothing", () => {
    const [x] = cast(p => { p.hidden.capacity = 0.9; p.hidden.responsiveness.ignoreProb = 1; });
    const mem = { ...newMemory(), joined: true };
    const d = decide(ctxFor(x, [x, b, c], "z", [proposal("g2", [x.id, b.id])], mem), menuMsg([{ key: "1", label: "a climb", proposalId: "g2" }]), T0);
    expect(d.intent).toBe("ignore");
    expect(mem.proposals.g2).toBeUndefined();
  });
});
