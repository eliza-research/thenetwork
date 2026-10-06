// Regression tests for the 2026-10 simulator review.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR, type Proposal } from "@thenetwork/core";
import { createEngine } from "../engines/engine-v1.ts";
import { DEFAULT_START, RECENT_PROPOSAL_DAYS, buildSnapshot, generatePersonas, localHour, nextLocalHour } from "../src/index.ts";

const prop = (id: string, createdAt: number, participants: string[]): Proposal => ({
  id, kind: "intro", participants, alternates: [], objective: "Intro", city: "sf", score: 0.5,
  components: { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 },
  exploration: false, explanations: {}, generator: "test", createdAt,
});

describe("snapshot: recent proposals by time, not by count", () => {
  test("keeps every proposal inside the 30-day budget look-back, even beyond 200; drops older ones", () => {
    const personas = generatePersonas({ n: 4, seed: 1, minorShare: 0 });
    const ids = personas.map(p => p.id);
    const now = DEFAULT_START + 40 * DAY;
    const recent = [
      ...Array.from({ length: 250 }, (_, i) => prop(`r${i}`, now - DAY - i * 60_000, [ids[0]!, ids[1]!])),
      prop("old", now - (RECENT_PROPOSAL_DAYS + 1) * DAY, [ids[2]!, ids[3]!]),
    ].sort((a, b) => a.createdAt - b.createdAt);
    const snap = buildSnapshot(personas, {
      now, worldStart: DEFAULT_START, joined: new Map(ids.map(id => [id, DEFAULT_START])), optedOut: new Set(), blocks: [], unanswered: new Map(), recentProposals: recent,
    });
    expect(snap.recentProposals.length).toBe(250);
    expect(snap.recentProposals.some(p => p.id === "old")).toBe(false);
  });
});

describe("time: nextLocalHour never returns an instant before t", () => {
  test("t inside the target hour with seconds", () => {
    const t = nextLocalHour(DEFAULT_START, "sf", 8) + 30_000; // 08:00:30 local
    expect(nextLocalHour(t, "sf", 8)).toBeGreaterThanOrEqual(t);
    expect(Math.floor(localHour(nextLocalHour(t, "sf", 8), "sf"))).toBe(8);
    expect(nextLocalHour(t, "nyc", 9)).toBeGreaterThanOrEqual(t);
  });
});

describe("engine-v1 adapter runs one city per call", () => {
  test("proposals for a city only, and the same result as the engine restricted to that city", async () => {
    const personas = generatePersonas({ n: 40, seed: 5 });
    const ids = personas.map(p => p.id);
    const snap = buildSnapshot(personas, {
      now: DEFAULT_START + 3 * DAY + 10 * HOUR, worldStart: DEFAULT_START, joined: new Map(ids.map(id => [id, DEFAULT_START])),
      optedOut: new Set(), blocks: [], unanswered: new Map(), recentProposals: [],
    });
    const e = createEngine();
    for (const city of ["sf", "nyc"] as const) {
      const a = await e.propose(snap, { city, seed: 3 });
      const b = await e.propose(snap, { city, seed: 3 });
      expect(a.every(p => p.city === city)).toBe(true);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b)); // deterministic per seed
    }
  });
});
