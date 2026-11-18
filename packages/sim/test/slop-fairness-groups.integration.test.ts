import { expect, test } from "bun:test";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SlopMetrics } from "../src/apps/slop/metrics.ts";

test("Slop CLI fairness summaries include groups observed after the first seed", async () => {
  const root = resolve(import.meta.dir, "../../.."), dir = await mkdtemp(join(tmpdir(), "slop-fairness-test-"));
  const files: string[] = [];
  try {
    for (const perCity of [3, 10]) {
      const file = join(dir, `${perCity}.json`); files.push(file);
      const p = Bun.spawn([process.execPath, join(root, "packages/sim/src/apps/slop/cli.ts"), "--seeds", "1-4", "--per-city", String(perCity), "--weeks", "4", "--only", "random,greedy,oracle", "--json", file], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [exit, stdout] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
      expect(exit).toBe(0);
      const data = await Bun.file(file).json() as Record<string, SlopMetrics[]>;
      for (const [arm, metrics] of Object.entries(data)) {
        const labels = (title: string) => stdout.split(title)[1]!.split("\n").find(l => l.startsWith(`  ${arm}: `))!
          .slice(`  ${arm}: `.length).split("; ").map(row => row.split(" ")[0]);
        expect(labels("Fairness by matching gender")).toEqual([...new Set(metrics.flatMap(m => Object.keys(m.fairness.byGender)))].sort());
        expect(labels("Fairness by group")).toEqual([...new Set(metrics.flatMap(m => Object.keys(m.fairness.byGroup)))].sort());
      }
    }
  } finally {
    for (const file of files) if (await Bun.file(file).exists()) await Bun.file(file).delete();
    await rmdir(dir);
  }
});
