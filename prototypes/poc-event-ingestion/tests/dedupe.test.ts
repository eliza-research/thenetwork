import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_THRESHOLD, scorePair, titleSim, cluster, candidatePairs, mergeClusters } from "../src/dedupe";
import type { NormalizedEvent } from "../src/types";

const events: NormalizedEvent[] = JSON.parse(readFileSync(`${import.meta.dir}/../fixtures/dedupe-events.json`, "utf8"));
const labels: { key: string; dup: boolean; round: number }[] = JSON.parse(readFileSync(`${import.meta.dir}/../fixtures/dedupe-labels.json`, "utf8"));
const byId = new Map(events.map((e) => [e.id, e]));

const base = (o: Partial<NormalizedEvent>): NormalizedEvent => ({
  id: "x:" + Math.random(), source: "cerebral-valley", sourceId: "x", url: "https://e.com/" + Math.random(), altUrls: [], title: "", startsAt: null,
  startDate: "2026-10-08", hasTime: false, endsAt: null, timezone: "America/Los_Angeles", city: "sf", venueName: null, address: "San Francisco, CA",
  lat: null, lng: null, price: null, categories: [], online: null, tos: "green", fetchedAt: "", ...o,
});

describe("dedupe", () => {
  test("hand-labelled pairs: precision >= 0.95 and recall >= 0.9 (P14 exit criterion)", () => {
    let tp = 0, fp = 0, fn = 0;
    for (const l of labels) {
      const [a, b] = l.key.split("||");
      const pred = scorePair(byId.get(a)!, byId.get(b)!).score >= DEFAULT_THRESHOLD;
      if (pred && l.dup) tp++; else if (pred && !l.dup) fp++; else if (!pred && l.dup) fn++;
    }
    expect(labels.length).toBeGreaterThanOrEqual(30);
    expect(tp / (tp + fp)).toBeGreaterThanOrEqual(0.95);
    expect(tp / (tp + fn)).toBeGreaterThanOrEqual(0.9);
  });
  test("subtitle variants merge; host-prefixed generic titles do not", () => {
    expect(scorePair(base({ title: "Matched by NEXA" }), base({ title: "Matched by NEXA - Quest Week" })).score).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
    expect(scorePair(base({ title: "COLM Happy Hour" }), base({ title: "Goodfire COLM Happy Hour" })).score).toBeLessThan(DEFAULT_THRESHOLD);
    expect(scorePair(base({ title: "The Founder Reset: What Your Company Data is Worth" }), base({ title: "The Founder Reset: Zero to Unicorn" })).score).toBeLessThan(DEFAULT_THRESHOLD);
    expect(titleSim("Techonomy26 - #SFTechWeek", "Techonomy 2026")).toBeGreaterThanOrEqual(0.8);
  });
  test("same club, same hour, different venues (>1.2km) is not a duplicate", () => {
    const t = { startsAt: "2026-10-07T23:00:00.000Z", hasTime: true, startDate: "2026-10-07", city: "nyc" as const, source: "luma-discover" as const };
    const a = base({ ...t, sourceId: "evt-a", title: "The New York Philosophy Club: Williamsburg", lat: 40.72, lng: -73.95 });
    const b = base({ ...t, source: "luma-ics", sourceId: "evt-b", title: "The New York Philosophy Club: Midtown East", lat: 40.756, lng: -73.969 });
    expect(scorePair(a, b).score).toBeLessThan(DEFAULT_THRESHOLD);
  });
  test("different days never merge; URL links always merge", () => {
    expect(scorePair(base({ title: "Agent Night" }), base({ title: "Agent Night", startDate: "2026-10-09" })).score).toBe(0);
    const a = base({ title: "Claude Build Day | Mental Health", url: "https://luma.com/claude-r5w5" });
    const b = base({ title: "Claude Impact Lab | Mental Health", source: "luma-discover", url: "https://lu.ma/claude-r5w5?utm=x" });
    expect(scorePair(a, b).score).toBe(1);
  });
  test("clusters merge into one canonical row keeping all links", () => {
    const evs = [base({ id: "a", title: "Agentic Zero" }), base({ id: "b", source: "luma-discover", title: "Agentic Zero: The Agentic Finance Summit", hasTime: true, startsAt: "2026-10-08T16:00:00.000Z", lat: 37.78, lng: -122.42 })];
    const merged = mergeClusters(evs, cluster(evs, candidatePairs(evs)));
    expect(merged.length).toBe(1);
    expect(merged[0].hasTime).toBe(true);
    expect(merged[0].altUrls.length).toBe(1);
    expect(merged[0].sources.sort()).toEqual(["cerebral-valley", "luma-discover"]);
  });
});
