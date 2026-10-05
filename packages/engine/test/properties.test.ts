// Property-based tests: ME-001..ME-012 asserted across many seeded random worlds. The oracle
// below re-implements the hard constraints independently of src/filters.ts.
import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { runEngine } from "../src/engine.ts";
import { randomWorld } from "../src/testkit.ts";
import type { EngineInput, EngineProposal, MatchingRunLog } from "../src/types.ts";
import { resolver } from "./helpers.ts";

const WORLDS = Array.from({ length: 24 }, (_, i) => ({ seed: 1000 + i * 7, members: 30 + ((i * 37) % 120) }));

function oracleViolations(inp: EngineInput, proposals: EngineProposal[]): string[] {
  const C = resolver(inp);
  const v: string[] = [];
  const mem = new Map(inp.members.map(m => [m.id, m]));
  const now = inp.now;
  const blocked = new Set<string>();
  for (const e of inp.edges) if (e.type === "blocked" || e.type === "avoid") blocked.add([C(e.from), C(e.to)].sort().join("|"));
  const neg = new Set<string>();
  for (const f of inp.feedback ?? []) if (f.sentiment === "negative" && now - f.at < 90 * DAY) neg.add([C(f.from), C(f.about)].sort().join("|"));
  const held = new Set((inp.safetyHolds ?? []).filter(h => h.from <= now && (h.to === undefined || h.to > now)).map(h => C(h.memberId)));
  const recentCount = new Map<string, number>();
  for (const p of inp.recentProposals) for (const id of p.participants) {
    const m = mem.get(C(id));
    if (!m) continue;
    if (now - p.createdAt < DEFAULT_CONFIG.budgets[m.state].periodDays * DAY) recentCount.set(m.id, (recentCount.get(m.id) ?? 0) + 1);
  }
  const newCount = new Map<string, number>();
  for (const p of proposals) for (const id of p.participants) newCount.set(id, (newCount.get(id) ?? 0) + 1);
  for (const [id, n] of newCount) {
    const m = mem.get(id)!;
    if ((recentCount.get(id) ?? 0) + n > DEFAULT_CONFIG.budgets[m.state].limit) v.push(`ME-002 budget exceeded for ${id} (${m.state})`);
  }
  for (const p of proposals) {
    const tag = `${p.id}/${p.generator}`;
    const text = `${p.objective} ${p.anchor?.label ?? ""}`.toLowerCase();
    const ev = p.anchor?.type === "event" ? inp.events?.find(e => e.id === p.anchor!.id) : undefined;
    if (ev?.riskTags?.length || ev?.tags.includes("home_hosted")) v.push(`${tag}: high-risk event`);
    if (/childcare|babysit/.test(text)) v.push(`${tag}: high-risk text`);
    if ((p.kind === "group" || p.kind === "newcomer_welcome") && (p.participants.length < 3 || p.participants.length > 6)) v.push(`${tag}: group size`);
    if (new Set(p.participants).size !== p.participants.length) v.push(`${tag}: duplicate participant`);
    for (const id of p.participants) {
      const m = mem.get(id);
      if (!m) { v.push(`${tag}: unknown or non-canonical id ${id}`); continue; }
      if (m.age < 18) v.push(`${tag}: minor ${id}`);
      if (m.state === "paused") v.push(`${tag}: paused ${id}`);
      if (held.has(id)) v.push(`${tag}: safety hold ${id}`);
      if (!m.prefs.categoriesOptIn.includes(p.category)) v.push(`${tag}: category opt-out ${id} ${p.category}`);
      if (p.category === "romance" && !m.prefs.romanceOptIn) v.push(`${tag}: romance without opt-in ${id}`);
      if (m.state === "receiving" && ["provider", "helper", "host", "connector"].includes(p.roles[id] ?? "")) v.push(`${tag}: receiving member as contributor ${id}`);
      if (m.prefs.onlyWhenAsked || m.unansweredProactive >= 2) {
        const it = p.anchor?.type === "intent" ? inp.intents.find(i => i.id === p.anchor!.id) : undefined;
        if (!it || C(it.memberId) !== id || now - it.createdAt > DEFAULT_CONFIG.askedRecencyDays * DAY) v.push(`${tag}: only-when-asked member ${id} contacted proactively`);
      }
      // Presence: member must have some presence in the proposal city during the window.
      const w = p.window!;
      const pres = inp.presence.filter(x => C(x.memberId) === id && x.city === p.city && (x.from ?? -Infinity) < w.end && (x.to ?? Infinity) > w.start);
      if (m.homeCity !== p.city && pres.length === 0) v.push(`${tag}: ${id} not present in ${p.city}`);
      const away = inp.presence.filter(x => C(x.memberId) === id && x.type === "temporary" && x.city !== p.city && (x.from ?? 0) <= w.start && (x.to ?? 0) >= w.end);
      if (away.length) v.push(`${tag}: ${id} travelling away for the whole window`);
    }
    for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) {
      const k = [p.participants[i], p.participants[j]].sort().join("|");
      if (blocked.has(k)) v.push(`${tag}: blocked pair ${k}`);
      if (neg.has(k)) v.push(`${tag}: negative-feedback pair ${k}`);
    }
  }
  return v;
}

function leakViolations(inp: EngineInput, proposals: EngineProposal[], log: MatchingRunLog): string[] {
  const v: string[] = [];
  const out = JSON.stringify(proposals) + JSON.stringify(log);
  if (/canary/i.test(out)) v.push("ME-003 canary token in output");
  const C = resolver(inp);
  for (const p of proposals) {
    const ps = new Set(p.participants);
    const mine = inp.facets.filter(f => ps.has(C(f.memberId)));
    const shareable = new Set(mine.filter(f => f.scope === "shareable").map(f => f.value));
    const nonShareable = mine.filter(f => f.scope !== "shareable" && ![...shareable].some(sv => sv.includes(f.value))).map(f => f.value);
    for (const text of [...Object.values(p.explanations), p.objective]) {
      for (const val of nonShareable) if (val.length > 8 && text.includes(val)) v.push(`ME-003 non-shareable facet value quoted in ${p.id}: ${val}`);
    }
  }
  return v;
}

describe("property: random worlds", () => {
  const results: { seed: number; inp: EngineInput; proposals: EngineProposal[]; runLog: MatchingRunLog }[] = [];
  test("engine runs on all worlds", async () => {
    for (const w of WORLDS) {
      const inp = randomWorld({ members: w.members, seed: w.seed });
      const before = JSON.stringify(inp);
      const { proposals, runLog } = await runEngine(inp, { seed: w.seed });
      expect(JSON.stringify(inp)).toBe(before); // input is never mutated (ME-007 spirit: engine never erases state)
      results.push({ seed: w.seed, inp, proposals, runLog });
    }
    expect(results.reduce((s, r) => s + r.proposals.length, 0)).toBeGreaterThan(100);
  }, 60_000);

  test("ME-001/ME-002/ME-006/ME-011: every proposal satisfies all hard constraints (independent oracle)", () => {
    const all = results.flatMap(r => oracleViolations(r.inp, r.proposals));
    expect(all).toEqual([]);
  });

  test("ME-003: no canaries or non-shareable facts in any output", () => {
    expect(results.flatMap(r => leakViolations(r.inp, r.proposals, r.runLog))).toEqual([]);
  });

  test("ME-004: same inputs + seed => identical proposals and run log (minus timings)", async () => {
    for (const r of results.slice(0, 6)) {
      const again = await runEngine(r.inp, { seed: r.seed });
      expect(again.proposals).toEqual(r.proposals);
      expect({ ...again.runLog, timingsMs: {} }).toEqual({ ...r.runLog, timingsMs: {} });
      expect(again.runLog.configHash).toBe(r.runLog.configHash);
      expect(again.runLog.inputHash).toBe(r.runLog.inputHash);
    }
  });

  test("ME-004: run log carries seed, config hash, counts per filter and components", () => {
    for (const r of results) {
      const l = r.runLog;
      expect(l.seed).toBe(r.seed);
      expect(l.configHash).toMatch(/^[0-9a-f]{16}$/);
      expect(l.funnel.generated).toBe(Object.values(l.funnel.byGenerator).reduce((a, b) => a + b, 0));
      expect(l.funnel.generated).toBe(l.funnel.passedHardFilters + Object.values(l.funnel.rejectedBy).reduce((a, b) => a + b, 0));
      expect(l.funnel.selected).toBe(r.proposals.length);
      expect(l.funnel.memberFunnel.total).toBe(r.inp.members.length);
      for (const s of l.scored) for (const v of Object.values(s.components)) expect(Number.isFinite(v)).toBe(true);
    }
  });

  test("ME-009: every non-exploration proposal clears its configured threshold; exploration clears the exploration bar", () => {
    for (const r of results) for (const p of r.proposals) {
      expect(p.score).toBeGreaterThanOrEqual(p.exploration ? Math.min(p.threshold, DEFAULT_CONFIG.thresholds.exploration) - 1e-9 : p.threshold - 1e-9);
      expect(p.threshold).toBeGreaterThan(0);
    }
  });

  test("33.8: exploration picks are 10-15% at most of proposals and are marked", () => {
    let total = 0, expl = 0;
    for (const r of results) {
      const e = r.proposals.filter(p => p.exploration).length;
      expect(e).toBeLessThanOrEqual(Math.max(1, Math.floor(r.proposals.length * DEFAULT_CONFIG.exploration.maxShare)) );
      total += r.proposals.length; expl += e;
      for (const p of r.proposals.filter(q => q.generator === "expansion")) expect(p.exploration).toBe(true);
    }
    expect(expl / total).toBeGreaterThan(0.05);
    expect(expl / total).toBeLessThanOrEqual(DEFAULT_CONFIG.exploration.maxShare);
  });

  test("ME-012: fairness metrics produced for every run", () => {
    for (const r of results) {
      const f = r.runLog.fairness;
      for (const k of ["gini", "top10Share", "zeroExposureShare", "newcomerShare", "viableCoverage"] as const) {
        expect(f[k]).toBeGreaterThanOrEqual(0); expect(f[k]).toBeLessThanOrEqual(1);
      }
      expect(f.lorenz.length).toBe(10);
      expect(f.lorenz[9]).toBeCloseTo(r.proposals.length ? 1 : 0, 5);
    }
  });

  test("explanations exist for every participant and proposals carry off-policy logging fields", () => {
    for (const r of results) for (const p of r.proposals) {
      for (const id of p.participants) expect(p.explanations[id]?.length).toBeGreaterThan(5);
      expect(p.selectionProbability).toBeGreaterThan(0);
      expect(p.selectionProbability).toBeLessThanOrEqual(1);
      expect(p.expiresAt).toBeGreaterThan(p.createdAt);
    }
  });

  test("no member appears twice with the same partner in one run; fixed-time proposals do not overlap per member", () => {
    for (const r of results) {
      const pairs = new Set<string>();
      const slots = new Map<string, [number, number][]>();
      for (const p of r.proposals) {
        for (let i = 0; i < p.participants.length; i++) for (let j = i + 1; j < p.participants.length; j++) {
          const k = [p.participants[i], p.participants[j]].sort().join("|");
          expect(pairs.has(k)).toBe(false);
          pairs.add(k);
        }
        if (p.kind === "event_coattend" && p.window) for (const id of p.participants) {
          for (const [s, e] of slots.get(id) ?? []) expect(p.window.start < e && s < p.window.end).toBe(false);
          slots.set(id, [...(slots.get(id) ?? []), [p.window.start, p.window.end]]);
        }
      }
    }
  });

  test("different seeds can change exploration picks but never constraint satisfaction", async () => {
    const inp = randomWorld({ members: 120, seed: 99 });
    for (const seed of [1, 2, 3]) {
      const { proposals } = await runEngine(inp, { seed });
      expect(oracleViolations(inp, proposals)).toEqual([]);
    }
  });
});
