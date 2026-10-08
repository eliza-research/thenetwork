// End-to-end invariants of the consent-first Network on the NYC world, plus every NYC scenario.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import type { RunRecord } from "@thenetwork/judge";
import { PolicyPersonaAgent, World } from "@thenetwork/sim";
import { DATA_DIR } from "../../../scripts/synthetic/common.ts";
import { nycPersonas, runArm } from "../src/experiment.ts";
import { friendFactory } from "../src/growth.ts";
import { ConsentNetwork } from "../src/network.ts";
import { runScenario, SCENARIOS } from "../src/scenarios.ts";

const T = 300_000;
const nyHour = (t: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(t)) % 24;

async function world(days: number, seed = 3) {
  const personas = await nycPersonas();
  const start = (await Bun.file(`${DATA_DIR}/manifest.json`).json()).snapshotNow as number;
  const net = new ConsentNetwork({ seed });
  const records: RunRecord[] = [];
  const w = new World({ seed, personas, days, start, writeLog: false, network: net, agent: new PolicyPersonaAgent(start), spawnFriend: friendFactory({ seed }), onRecord: r => records.push(r) });
  await w.begin(); await w.advanceTo(w.end);
  return { w, net, records, personas: new Map(w.personaList().map(p => [p.id, p])) };
}

describe("ConsentNetwork invariants (NYC, 10 days)", () => {
  let run: Awaited<ReturnType<typeof world>>;
  test("runs", async () => { run = await world(10); expect(run.records.length).toBeGreaterThan(1000); }, T);

  test("probes never name anyone, and every reveal follows a yes from everyone (or their own ask)", () => {
    const names = [...run.personas.values()].map(p => p.name);
    const out = run.records.filter((r): r is Extract<RunRecord, { type: "message" }> => r.type === "message" && r.msg.direction === "outbound");
    for (const m of out.filter(m => m.msg.meta?.type === "probe")) for (const n of names) expect(m.msg.body.includes(n)).toBe(false);
    for (const o of run.net.opps.values()) {
      if (!o.recorded) continue;
      const started = run.records.find(r => r.type === "network_log" && r.kind === "probe_started" && (r.detail.proposal as { id: string }).id === o.id)!;
      for (const p of o.participants) {
        const said = run.records.some(r => r.type === "network_log" && r.kind === "probe_answer" && r.detail.oppId === o.id && r.detail.memberId === p && r.detail.yes === true);
        expect([o.id, p, said || o.primed.has(p)]).toEqual([o.id, p, true]);
      }
      expect(started).toBeDefined();
    }
  });

  test("never contacts a minor about another member; never proposes one", () => {
    const minors = new Set([...run.personas.values()].filter(p => p.public.claimedAge < 18 || p.hidden.trueAge < 18 && p.public.claimedAge < 18).map(p => p.id));
    for (const r of run.records) {
      if (r.type === "proposal") expect(r.proposal.participants.some(id => minors.has(id))).toBe(false);
      // Nor as an alternate (a possible backfill), whoever proposed the opportunity.
      if (r.type === "network_log" && r.kind === "probe_started") expect(((r.detail.proposal as { alternates?: string[] }).alternates ?? []).some(id => minors.has(id))).toBe(false);
      if (r.type === "message" && r.msg.direction === "outbound" && minors.has(r.msg.memberId)) expect(["probe", "proposal", "growth_ask"]).not.toContain(r.msg.meta?.type);
    }
  });

  test("proactive messages respect hours (9am-8pm NY) and weekly budgets", () => {
    const pro = run.records.filter((r): r is Extract<RunRecord, { type: "message" }> => r.type === "message" && r.msg.direction === "outbound" && !!r.msg.meta?.proactive);
    expect(pro.length).toBeGreaterThan(50);
    for (const m of pro) { const h = nyHour(m.msg.ts); expect(h >= 9 && h < 20).toBe(true); }
    const by = new Map<string, number[]>();
    for (const m of pro) { if (!by.has(m.msg.memberId)) by.set(m.msg.memberId, []); by.get(m.msg.memberId)!.push(m.msg.ts); }
    for (const [, ts] of by) for (const t of ts) expect(ts.filter(x => x > t - 7 * DAY && x <= t).length).toBeLessThanOrEqual(4);
  });

  test("meetings happen at real public NYC venues", () => {
    const sched = run.records.filter((r): r is Extract<RunRecord, { type: "message" }> => r.type === "message" && r.msg.meta?.type === "scheduling");
    expect(sched.length).toBeGreaterThan(0);
    for (const m of sched) expect(m.msg.body).toMatch(/Park|Library|Plaza|Market|Museum|Pier|High Line|Battery|Harbor|Island|Fields/);
  });

  test("no honest member is flagged; bad actors who acted are restricted", () => {
    for (const r of run.records) if (r.type === "network_log" && r.kind === "abuse") expect([r.detail.memberId, !!run.personas.get(String(r.detail.memberId))?.hidden.adversarial]).toEqual([r.detail.memberId, true]);
    const acted = new Set(run.records.filter(r => r.type === "adversarial_attempt" && ["spammer", "scammer", "harasser", "prompt_injector"].includes(r.kind)).map(r => (r as { memberId: string }).memberId));
    for (const id of acted) expect([id, run.net.trust.level(id)]).not.toEqual([id, "ok"]);
  });

  test("deterministic", async () => {
    const again = await world(10);
    expect(JSON.stringify(again.net.counters)).toBe(JSON.stringify(run.net.counters));
  }, T);
});

describe("consent-first beats push (21 days, NYC)", () => {
  test("higher all-yes rate, far fewer unsafe proposals, growth", async () => {
    const push = await runArm("push_baseline", { days: 21, seed: 1 });
    const consent = await runArm("consent", { days: 21, seed: 1 });
    expect(consent.proposalAllYesRate).toBeGreaterThan(0.75);
    expect(consent.inviteAcceptRate).toBeGreaterThan(0.75);
    expect(push.proposalAllYesRate).toBeLessThan(0.25);
    expect(consent.unsafe).toBeLessThan(push.unsafe / 4);
    expect(consent.meetingsHeld).toBeGreaterThan(push.meetingsHeld);
    expect(consent.newMembersJoined).toBeGreaterThan(5);
    expect(consent.falseFlags).toBe(0);
  }, T);
});

describe("NYC scenarios", () => {
  for (const s of SCENARIOS) {
    test(s.id, async () => {
      const r = await runScenario(s);
      const failed = r.checks.filter(c => !c.pass);
      expect(failed.map(c => `${c.name}: ${c.detail}`)).toEqual([]);
    }, T);
  }
});

void HOUR;
