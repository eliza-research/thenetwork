import { describe, expect, test } from "vitest";
import { ARMS } from "../src/apps/peon/arms";
import { officialGates as peonGates } from "../src/apps/peon/gates";
import { peonMetrics } from "../src/apps/peon/metrics";
import { runPeonWorld } from "../src/apps/peon/world";

const noIntros = { name: "no intros", propose: () => [] };

describe("Retention gate with no hires", () => {
  test("a run where neither arm hires anyone fails the retention gate", async () => {
    const emptyPack = peonMetrics(await runPeonWorld({ seed: 13, perCity: 100, jobsPerCity: 20, weeks: 8, matcher: noIntros }));
    const emptyKeyword = peonMetrics(await runPeonWorld({ seed: 13, perCity: 100, jobsPerCity: 20, weeks: 8, matcher: noIntros }));
    expect(emptyPack.hires).toBe(0);
    expect(emptyKeyword.hires).toBe(0);
    expect(emptyPack.retention90).toBe(0);
    expect(emptyKeyword.retention90).toBe(0);
    const gates = peonGates([emptyPack], [emptyKeyword]);
    const retention = gates.find((gate) => gate.id === "retention_90d");
    expect(retention?.value).toContain("0.0 pt");
    expect(retention?.pass).toBe(false);
  });

  test("a run where the pack hires and the keyword hires none passes the retention gate", async () => {
    const pack = peonMetrics(await runPeonWorld({ seed: 13, perCity: 100, jobsPerCity: 20, weeks: 8, matcher: ARMS["pack"]!.matcher }));
    const emptyKeyword = peonMetrics(await runPeonWorld({ seed: 13, perCity: 100, jobsPerCity: 20, weeks: 8, matcher: noIntros }));
    expect(pack.hires).toBeGreaterThan(0);
    expect(emptyKeyword.hires).toBe(0);
    const gates = peonGates([pack], [emptyKeyword]);
    const retention = gates.find((gate) => gate.id === "retention_90d");
    expect(retention?.pass).toBe(true);
  });
}, 30_000);
