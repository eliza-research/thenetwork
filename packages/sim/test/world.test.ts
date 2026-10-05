import { describe, expect, test } from "bun:test";
import type { RunRecord } from "@thenetwork/judge";
import { StubNetwork, World, generatePersonas, runWorld, type NetworkContext, type NetworkUnderTest } from "../src/index.ts";

const strip = (rs: RunRecord[]) => JSON.stringify(rs.map(r => (r.type === "run_end" ? { ...r, wallMs: 0 } : r)));

async function small(seed: number, opts: Partial<ConstructorParameters<typeof StubNetwork>[0]> = {}) {
  const personas = generatePersonas({ n: 30, seed, joinSpreadDays: 4 });
  return runWorld({ seed, personas, days: 7, network: new StubNetwork({ seed, ...opts }), writeLog: false, runId: `t${seed}` });
}

describe("world runner", () => {
  test("seeded runs are exactly replayable", async () => {
    const a = await small(3), b = await small(3);
    expect(strip(a.records)).toBe(strip(b.records));
    expect(a.metrics).toEqual(b.metrics);
    const c = await small(4);
    expect(strip(c.records)).not.toBe(strip(a.records));
  });

  test("stub network run: everyone joins, proposals scored, no invariant violations or leaks", async () => {
    const r = await small(5);
    const m = r.metrics;
    expect(m.run.joined).toBe(30);
    expect(m.proposals.total).toBeGreaterThan(0);
    expect(m.responses.invitesDelivered).toBeGreaterThan(0);
    expect(m.privacy.canaryLeaks).toBe(0);
    expect(m.invariants.total).toBe(0);
    expect(m.style.failing).toBe(0);
    expect(m.errors).toBe(0);
    // event timestamps are monotonic
    for (let i = 1; i < r.records.length; i++) expect(r.records[i]!.t).toBeGreaterThanOrEqual(r.records[i - 1]!.t);
  });

  test("negative control: a leaky network is caught by canary scanning", async () => {
    const personas = generatePersonas({ n: 40, seed: 8, disclosureRate: 0.9, adversarialRate: 0 });
    const r = await runWorld({ seed: 8, personas, days: 10, network: new StubNetwork({ seed: 8, leakyExplanations: true, introRate: 0.3 }), writeLog: false, runId: "leaky" });
    expect(r.metrics.privacy.canaryLeaks).toBeGreaterThan(0);
    expect(r.metrics.invariants.byRule.canary_leak).toBeGreaterThan(0);
  });

  test("the Network only ever sees public data (no hidden-truth fields in the snapshot)", async () => {
    let ctx!: NetworkContext;
    const spy: NetworkUnderTest = { name: "spy", init: c => { ctx = c; }, onInbound: () => {}, tick: () => {} };
    const personas = generatePersonas({ n: 40, seed: 12 });
    const w = new World({ seed: 12, personas, days: 3, network: spy, writeLog: false });
    await w.run();
    const snap = JSON.stringify(ctx.snapshot());
    for (const k of ["trueAge", "flakiness", "honesty", "responsiveness", "socialEnergy", "adversarial", "ignoreProb"]) expect(snap.includes(k)).toBe(false);
    for (const p of personas.filter(p => p.hidden.adversarial === "minor")) expect(snap).not.toContain(`"age":${p.hidden.trueAge},`);
    // hidden-only interests (dishonest omissions) are not exposed as facets
    const s = ctx.snapshot();
    for (const p of personas) {
      const tags = new Set(s.facets.filter(f => f.memberId === p.id && f.kind === "interest").flatMap(f => f.tags));
      for (const t of tags) expect(p.public.statedInterests).toContain(t);
    }
  });

  test("injected Engine proposals are logged with oracle scores and dispatched", async () => {
    const personas = generatePersonas({ n: 24, seed: 2, adversarialRate: 0, cityWeights: { sf: 1, nyc: 0 }, joinSpreadDays: 1 });
    let calls = 0;
    const engine = {
      name: "pairs-first-two",
      propose(snap: any, o?: { city?: string }) {
        const ms = snap.members.filter((m: any) => m.homeCity === o?.city).slice(0, 2);
        if (ms.length < 2 || calls >= 2) return [];
        calls++;
        return [{ id: `e${calls}`, kind: "intro", participants: ms.map((m: any) => m.id), alternates: [], objective: "coffee", city: o!.city,
          score: 1, components: {} as any, exploration: false, explanations: {}, generator: "test", createdAt: snap.now }];
      },
    };
    const r = await runWorld({ seed: 2, personas, days: 3, network: new StubNetwork({ seed: 2, randomIntros: false }), engine: engine as any, writeLog: false });
    const props = r.records.filter(x => x.type === "proposal");
    expect(props.length).toBeGreaterThan(0);
    expect(props.every(p => p.type === "proposal" && p.source === "engine" && typeof p.oracle.compatible === "boolean")).toBe(true);
    expect(r.records.some(x => x.type === "message" && x.msg.meta?.type === "proposal")).toBe(true);
  });

  test("writes runs/<runId>/ with events.jsonl, personas.json, metrics.json", async () => {
    const dir = `${import.meta.dir}/../../../runs`;
    const personas = generatePersonas({ n: 10, seed: 1 });
    const r = await runWorld({ seed: 1, personas, days: 2, network: new StubNetwork(), runId: "unit-test-run", runsDir: dir });
    const lines = (await Bun.file(`${r.dir}/events.jsonl`).text()).trim().split("\n");
    expect(lines.length).toBe(r.records.length);
    expect((await Bun.file(`${r.dir}/metrics.json`).json()).run.runId).toBe("unit-test-run");
    expect(await Bun.file(`${r.dir}/personas.json`).exists()).toBe(true);
  });
});
