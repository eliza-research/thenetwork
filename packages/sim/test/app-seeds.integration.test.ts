import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { ARMS } from "../src/apps/peon/arms.ts";
import { peonMetrics } from "../src/apps/peon/metrics.ts";
import { REALISM_V2, runPeonWorld } from "../src/apps/peon/world.ts";
import { friendsArms } from "../src/apps/friends/arms.ts";
import { friendsMetrics } from "../src/apps/friends/metrics.ts";
import { runFriendsWorld } from "../src/apps/friends/world.ts";
import { BASELINES } from "../src/apps/slop/baselines.ts";
import { slopMetrics } from "../src/apps/slop/metrics.ts";
import { runSlopWorld } from "../src/apps/slop/world.ts";
import { runArm } from "../src/apps/slop/packEval.ts";

const root = resolve(import.meta.dir, "../../..");
const specs = [
  { entry: "peon/cli.ts", args: ["--arms", "keyword", "--per-city", "20", "--jobs", "5", "--weeks", "1"],
    expected: async (seeds: number[]) => ({ keyword: await Promise.all(seeds.map(async seed => peonMetrics(await runPeonWorld({ seed, perCity: 20, jobsPerCity: 5, weeks: 1, matcher: ARMS.keyword!.matcher, realism: REALISM_V2 })))) }) },
  { entry: "friends/cli.ts", args: ["--only", "random", "--n", "20", "--weeks", "1"],
    expected: async (seeds: number[]) => ({ random: seeds.map(seed => friendsMetrics(runFriendsWorld({ seed, n: 20, weeks: 1, planCap: 1, matcher: friendsArms({}).random! }))) }) },
  { entry: "slop/cli.ts", args: ["--only", "random", "--per-city", "20", "--weeks", "1"],
    expected: async (seeds: number[]) => ({ random: seeds.map(seed => slopMetrics(runSlopWorld({ seed, perCity: 20, weeks: 1, matcher: BASELINES.random }))) }) },
  { entry: "slop/packEval.ts", args: ["--arms", "random", "--per-city", "20", "--weeks", "1"],
    expected: async (seeds: number[]) => [await runArm("random", seeds, 1, 20)] },
];

test("app simulation CLIs run the requested numeric seeds and reject malformed ranges before reporting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "app-seeds-integration-"));
  let sequence = 0;
  try {
    for (const s of specs) {
      const run = async (input: string) => {
        const file = join(dir, `${sequence++}.json`);
        const p = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", `packages/sim/src/apps/${s.entry}`, ...s.args, "--seeds", input, "--json", file],
          { cwd: root, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
        const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
        const report = await Bun.file(file).exists() ? await Bun.file(file).json() : null;
        return { stdout, stderr, code, report };
      };
      const valid: [string, number[]][] = [["-3", [-3]], ["1e-3", [.001]], ["-3--1", [-3, -2, -1]], ["1-2", [1, 2]]];
      if (s.entry === "friends/cli.ts") valid.push(["-2,1e-3,2-3", [-2, .001, 2, 3]]);
      for (const [input, seeds] of valid) {
        const r = await run(input);
        const metrics = Array.isArray(r.report) ? r.report[0]?.metrics : r.report?.keyword ?? r.report?.random;
        expect([r.code, metrics?.length]).toEqual([0, seeds.length]);
        expect(r.report).toEqual(JSON.parse(JSON.stringify(await s.expected(seeds))));
        if (s.entry !== "slop/packEval.ts") expect(r.stdout).toContain(`seeds ${seeds.join(",")};`);
      }
      const invalid = ["3-1", "nope", "1-2-3", "", "Infinity"];
      if (s.entry === "friends/cli.ts") invalid.push("1,3-1", "1,,2");
      for (const input of invalid) {
        const r = await run(input);
        expect([r.code === 0, r.report, r.stdout]).toEqual([false, null, ""]);
        expect(r.stderr).toContain("--seeds");
      }
    }
  } finally {
    const target = resolve(dir), parent = resolve(tmpdir());
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("app-seeds-integration-")) throw new Error("Unsafe cleanup path");
    await rm(target, { recursive: true, force: true });
  }
}, 120_000);
