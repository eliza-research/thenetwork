// Profile richness tiers + simulated connected sources (sources.ts): distribution, determinism,
// the known/hidden split, sensitive and minor rules, and that sparse profiles really are harder
// for the engine while hidden truth (and so the oracle) is untouched.
import { describe, expect, test } from "bun:test";
import { DAY, type WorldSnapshot } from "@thenetwork/core";
import { runEngine } from "../../engine/src/index.ts";
import { createEngine } from "../engines/engine-v1.ts";
import { readdirSync } from "node:fs";
import {
  loadScenario, runScenario, DEFAULT_RICHNESS_MIX, DEFAULT_START, MINOR_ALLOWED_SOURCES, Oracle, RICHNESS_TIERS, StubNetwork, buildSnapshot,
  canariesOf, generatePersonas, runWorld, type Persona,
} from "../src/index.ts";

const ACTIVE = new Set(["connected", "confirmed"]);
const snapOf = (ps: Persona[]): WorldSnapshot => buildSnapshot(ps, {
  now: DEFAULT_START + 3 * DAY, worldStart: DEFAULT_START, joined: new Map(ps.map(p => [p.id, DEFAULT_START])),
  optedOut: new Set(), blocks: [], unanswered: new Map(), recentProposals: [],
});
const strip = (ps: Persona[]) => ps.map(p => { const { knowledge: _k, ...rest } = p; const { richness: _r, ...hidden } = p.hidden; return { ...rest, hidden }; });

describe("richness tiers (generator option)", () => {
  const ps = generatePersonas({ n: 400, seed: 21, richness: true, minorShare: 0.1 });

  test("exact quota mix, every persona tiered, hidden.richness matches knowledge", () => {
    const c: Record<string, number> = {};
    for (const p of ps) { expect(p.knowledge!.richness).toBe(p.hidden.richness!); c[p.hidden.richness!] = (c[p.hidden.richness!] ?? 0) + 1; }
    for (const t of RICHNESS_TIERS) expect(c[t]).toBe(Math.round(DEFAULT_RICHNESS_MIX[t] * 400));
  });

  test("deterministic; off by default; on/off leaves every other draw (and hidden truth) identical", () => {
    expect(JSON.stringify(generatePersonas({ n: 120, seed: 4, richness: true }))).toBe(JSON.stringify(generatePersonas({ n: 120, seed: 4, richness: true })));
    const off = generatePersonas({ n: 120, seed: 4 });
    expect(off.every(p => !p.knowledge && !p.hidden.richness)).toBe(true);
    expect(JSON.stringify(strip(generatePersonas({ n: 120, seed: 4, richness: true })))).toBe(JSON.stringify(off));
  });

  test("custom mix is honored", () => {
    const all = generatePersonas({ n: 50, seed: 2, richness: { minimal: 1, light: 0, medium: 0, rich: 0, very_rich: 0 } });
    expect(all.every(p => p.hidden.richness === "minimal")).toBe(true);
  });

  test("connection rates track richness: minimal none, very_rich 3-6; members who connected nothing exist", () => {
    for (const p of ps) {
      const active = p.knowledge!.sources.filter(s => ACTIVE.has(s.status));
      if (p.hidden.richness === "minimal") expect(p.knowledge!.sources.length).toBe(0);
      if (p.hidden.richness === "very_rich" && p.public.claimedAge >= 18) { expect(active.length).toBeGreaterThanOrEqual(3); expect(active.length).toBeLessThanOrEqual(6); }
      for (const s of p.knowledge!.sources) {
        expect(s.subject).toBe("self");
        if (!ACTIVE.has(s.status)) expect(s.observations).toBe(0);
        else expect(s.observations).toBe(p.knowledge!.observations.filter(o => o.facet.source === s.source).length);
      }
      for (const o of p.knowledge!.observations) expect(active.some(s => s.source === o.facet.source)).toBe(true);
    }
    const none = ps.filter(p => p.hidden.richness !== "minimal" && !p.knowledge!.sources.some(s => ACTIVE.has(s.status)));
    expect(none.length).toBeGreaterThan(0);
    const mean = (t: string) => { const xs = ps.filter(p => p.hidden.richness === t); return xs.reduce((s, p) => s + p.knowledge!.sources.filter(x => ACTIVE.has(x.status)).length, 0) / xs.length; };
    for (let i = 1; i < RICHNESS_TIERS.length; i++) expect(mean(RICHNESS_TIERS[i]!)).toBeGreaterThan(mean(RICHNESS_TIERS[i - 1]!));
  });

  test("realistic noise: stale facts, wrong inferences, found profiles pending/rejected", () => {
    const truths = ps.flatMap(p => p.knowledge!.observations.map(o => o.truth));
    expect(truths.filter(t => t === "stale").length).toBeGreaterThan(0);
    expect(truths.filter(t => t === "wrong_inference").length).toBeGreaterThan(0);
    expect(truths.filter(t => t === "correct").length).toBeGreaterThan(truths.length / 2);
    const statuses = new Set(ps.flatMap(p => p.knowledge!.sources.map(s => s.status)));
    for (const s of ["connected", "confirmed", "pending_confirmation", "rejected"]) expect(statuses.has(s as any)).toBe(true);
    // Wrong/stale facets are never member-confirmed.
    for (const p of ps) for (const o of p.knowledge!.observations) if (o.truth !== "correct") expect(o.facet.confirmedByMember).toBe(false);
  });

  test("sensitive inferences are agent_private and never confirmed; unconfirmed inferences never shareable", () => {
    const obs = ps.flatMap(p => p.knowledge!.observations);
    expect(obs.some(o => o.facet.sensitive)).toBe(true);
    for (const o of obs) {
      if (o.facet.sensitive) { expect(o.facet.scope).toBe("agent_private"); expect(o.facet.tags).toContain("sensitive"); expect(o.facet.confirmedByMember).toBe(false); }
      if (o.facet.inferred && !o.facet.confirmedByMember) expect(o.facet.scope).not.toBe("shareable");
    }
  });

  test("minors: only single-player-safe sources, no profile discovery, every snapshot facet agent_private", () => {
    const minors = ps.filter(p => p.public.claimedAge < 18);
    expect(minors.length).toBe(40);
    for (const p of minors) for (const s of p.knowledge!.sources) { expect(MINOR_ALLOWED_SOURCES.has(s.source)).toBe(true); expect(s.link).not.toBe("found_profile"); }
    const snap = snapOf(ps);
    const ids = new Set(minors.map(p => p.id));
    for (const f of snap.facets.filter(f => ids.has(f.memberId))) expect(f.scope).toBe("agent_private");
    for (const m of snap.members.filter(m => ids.has(m.id))) expect(m.prefs.romanceOptIn).toBe(false);
  });
});

describe("snapshot exposes only what is known", () => {
  const ps = generatePersonas({ n: 300, seed: 33, richness: true });
  const snap = snapOf(ps);
  const byId = new Map(ps.map(p => [p.id, p]));

  test("minimal members: no facets, at most one vague intent; nothing carries a truth label", () => {
    for (const p of ps.filter(p => p.hidden.richness === "minimal")) {
      expect(snap.facets.filter(f => f.memberId === p.id).length).toBe(0);
      const its = snap.intents.filter(i => i.memberId === p.id);
      expect(its.length).toBeLessThanOrEqual(1);
      for (const i of its) { expect(i.details).toBeUndefined(); expect(p.public.statedIntents.some(s => s.text === i.objective)).toBe(false); }
    }
    expect(JSON.stringify(snap)).not.toMatch(/"truth"|wrong_inference|"richness"/);
  });

  test("every facet has a channel: chat coverage or an active source", () => {
    for (const f of snap.facets) {
      const k = byId.get(f.memberId)!.knowledge!;
      expect(f.source).toBeDefined();
      if (f.source === "chat") {
        if (f.kind === "interest") expect(k.chat.interests).toContain(f.tags[0]!);
        if (f.kind === "skill") expect(k.chat.skills).toContain(f.tags[0]!);
      } else expect(k.sources.some(s => s.source === f.source && ACTIVE.has(s.status))).toBe(true);
    }
    for (const m of snap.members) expect(m.connectedSources).toEqual(byId.get(m.id)!.knowledge!.sources);
  });

  test("canaries appear only for members who disclosed in chat, once, agent_private", () => {
    const text = JSON.stringify(snap.facets);
    for (const c of canariesOf(ps)) {
      const disclosed = byId.get(c.memberId)!.knowledge!.chat.disclosure;
      const fs = snap.facets.filter(f => f.value.includes(c.canary));
      expect(fs.length).toBe(disclosed ? 1 : 0);
      for (const f of fs) expect(f.scope).toBe("agent_private");
      if (!disclosed) expect(text.includes(c.canary)).toBe(false);
    }
  });

  test("known facets per member and coverage of TRUE interests grow with tier", () => {
    const stat = (t: string) => {
      const xs = ps.filter(p => p.hidden.richness === t);
      const facets = xs.reduce((s, p) => s + snap.facets.filter(f => f.memberId === p.id).length, 0) / xs.length;
      const cover = xs.reduce((s, p) => { const known = new Set(snap.facets.filter(f => f.memberId === p.id && f.kind === "interest").map(f => f.tags[0])); return s + p.hidden.interests.filter(t => known.has(t)).length / p.hidden.interests.length; }, 0) / xs.length;
      return { facets, cover };
    };
    for (let i = 1; i < RICHNESS_TIERS.length; i++) {
      expect(stat(RICHNESS_TIERS[i]!).facets).toBeGreaterThan(stat(RICHNESS_TIERS[i - 1]!).facets);
      expect(stat(RICHNESS_TIERS[i]!).cover).toBeGreaterThan(stat(RICHNESS_TIERS[i - 1]!).cover);
    }
  });

  test("hidden truth stays complete: the oracle verdict does not depend on richness", () => {
    const off = generatePersonas({ n: 300, seed: 33 });
    const a = new Oracle(ps, 1, DEFAULT_START), b = new Oracle(off, 1, DEFAULT_START);
    const sf = ps.filter(p => p.homeCity === "sf").slice(0, 30).map(p => p.id);
    expect(JSON.stringify(a.latentPairs(sf, DEFAULT_START))).toBe(JSON.stringify(b.latentPairs(sf, DEFAULT_START)));
  });

  test("sparse profiles are genuinely harder: engine proposals per member rise with tier", async () => {
    const { proposals } = await runEngine(snap, { seed: 1 });
    const per = (t: string) => {
      const ids = new Set(ps.filter(p => p.hidden.richness === t && p.public.claimedAge >= 18).map(p => p.id));
      return proposals.reduce((n, p) => n + p.participants.filter(x => ids.has(x)).length, 0) / ids.size;
    };
    expect(per("minimal")).toBeLessThan(per("medium"));
    expect(per("medium")).toBeLessThan(per("very_rich"));
  }, 60_000);
});

describe("worlds with richness: safety invariants hold", () => {
  test("engine v1 through the stub with minors + richness: minorContacts == 0, canaryLeaks == 0", async () => {
    const personas = generatePersonas({ n: 80, seed: 12, minorShare: 0.15, joinSpreadDays: 3, richness: true });
    const r = await runWorld({ seed: 12, personas, days: 8, network: new StubNetwork({ seed: 12, randomIntros: false }), engine: createEngine(), writeLog: false, runId: "richness-engine" });
    expect(r.metrics.proposals.bySource.engine ?? 0).toBeGreaterThan(0);
    expect(r.metrics.safety.minorContacts).toBe(0);
    expect(r.metrics.privacy.canaryLeaks).toBe(0);
  }, 90_000);

  // Every shipped scenario with a tiered background population (and minors in it): applicable
  // expectations still pass, and minorContacts / canaryLeaks stay 0, for the stub and engine v1.
  const dir = `${import.meta.dir}/../scenarios`;
  for (const f of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    test(`scenario with richness background: ${f}`, async () => {
      const s0 = await loadScenario(`${dir}/${f}`);
      const s = { ...s0, background: { ...(s0.background ?? { personas: 0 }), personas: Math.max(20, s0.background?.personas ?? 0), minorShare: 0.1, richness: true } };
      for (const engine of [undefined, createEngine()]) {
        const r = await runScenario(s, { network: sc => new StubNetwork({ seed: s.seed, ...sc.stub, ...(engine ? { randomIntros: false } : {}) }), engine });
        expect(r.world.personas.filter(p => p.id.startsWith("bg")).every(p => !!p.hidden.richness)).toBe(true);
        expect(r.world.metrics.safety.minorContacts).toBe(0);
        expect(r.world.metrics.privacy.canaryLeaks).toBe(0);
        if (!engine) expect(r.results.filter(x => x.status === "fail")).toEqual([]);
      }
    }, 90_000);
  }
});
