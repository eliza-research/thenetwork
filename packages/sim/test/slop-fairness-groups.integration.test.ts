// PR #457: the slop CLI fairness summary lists the groups of every seed, not only of the first seed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import type { SlopMetrics } from "../src/apps/slop/metrics.ts";

test("Slop CLI fairness summaries include groups observed after the first seed", () => {
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  const dir = mkdtempSync(join(tmpdir(), "slop-fairness-test-"));
  try {
    for (const perCity of [3, 10]) {
      const file = join(dir, `${perCity}.json`);
      const p = spawnSync(process.execPath, ["--conditions=eliza-source", "--import", "tsx", join(root, "packages/sim/src/apps/slop/cli.ts"),
        "--seeds", "1-4", "--per-city", String(perCity), "--weeks", "4", "--only", "random,greedy,oracle", "--json", file], { cwd: root, encoding: "utf8" });
      expect(p.status, p.stderr).toBe(0);
      const data = JSON.parse(readFileSync(file, "utf8")) as Record<string, SlopMetrics[]>;
      for (const [arm, metrics] of Object.entries(data)) {
        const labels = (title: string) => p.stdout.split(title)[1]!.split("\n").find(l => l.startsWith(`  ${arm}: `))!
          .slice(`  ${arm}: `.length).split("; ").map(row => row.split(" ")[0]);
        expect(labels("Fairness by matching gender")).toEqual([...new Set(metrics.flatMap(m => Object.keys(m.fairness.byGender)))].sort());
        expect(labels("Fairness by group")).toEqual([...new Set(metrics.flatMap(m => Object.keys(m.fairness.byGroup)))].sort());
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
