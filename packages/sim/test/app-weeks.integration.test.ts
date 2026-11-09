import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { runPeonWorld } from "../src/apps/peon/world.ts";
import { ARMS } from "../src/apps/peon/arms.ts";
import { runFriendsWorld } from "../src/apps/friends/world.ts";
import { friendsArms } from "../src/apps/friends/arms.ts";
import { runSlopWorld, runSlopWorldAsync } from "../src/apps/slop/world.ts";
import { BASELINES } from "../src/apps/slop/baselines.ts";

test("app worlds reject invalid week counts through native runners and real CLIs", async () => {
  const runs = [
    (weeks: number) => runPeonWorld({ seed: 1, weeks, perCity: 20, jobsPerCity: 5, matcher: ARMS.keyword!.matcher }),
    (weeks: number) => runFriendsWorld({ seed: 1, weeks, n: 40, matcher: friendsArms({}).random! }),
    (weeks: number) => runSlopWorld({ seed: 1, weeks, perCity: 20, matcher: BASELINES.random }),
    (weeks: number) => runSlopWorldAsync({ seed: 1, weeks, perCity: 20, matcher: BASELINES.random }),
  ];
  for (const run of runs) {
    for (const weeks of [0, -1, NaN, Infinity, -Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect((async () => await run(weeks))()).rejects.toThrow(/weeks.*positive safe integer/);
    }
    for (const weeks of [1, 2]) {
      const r = await run(weeks);
      expect([r.world.weeks, r.world.state.week]).toEqual([weeks, weeks - 1]);
      expect(r.flows.length).toBeGreaterThan(0);
    }
  }
  const dir = await mkdtemp(join(tmpdir(), "app-weeks-integration-"));
  try {
    let id = 0;
    const specs = [
      ["peon/cli.ts", "--arms", "keyword", "--per-city", "20", "--jobs", "5"],
      ["friends/cli.ts", "--only", "random", "--n", "40"],
      ["slop/cli.ts", "--only", "random", "--per-city", "20"],
      ["slop/packEval.ts", "--arms", "random", "--per-city", "20"],
    ];
    for (const [entry, ...args] of specs) for (const weeks of ["0", "nope", "1.5", "1"]) {
      const file = join(dir, `${id++}.json`);
      const p = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", `packages/sim/src/apps/${entry}`, ...args,
        "--seeds", "1", "--weeks", weeks, "--json", file], { cwd: resolve(import.meta.dir, "../../.."), stdout: "pipe", stderr: "pipe", timeout: 30_000 });
      const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      const exists = await Bun.file(file).exists();
      if (weeks === "1") {
        expect([code, exists]).toEqual([0, true]);
        const report = await Bun.file(file).json();
        const metrics = Array.isArray(report) ? report[0].metrics : report.keyword ?? report.random;
        expect(metrics.length).toBe(1);
      } else {
        expect([code === 0, exists, stdout]).toEqual([false, false, ""]);
        expect(stderr).toMatch(/weeks.*positive safe integer/);
      }
    }
  } finally {
    const target = resolve(dir), parent = resolve(tmpdir());
    if (!target.startsWith(parent + sep) || !target.slice(parent.length + 1).startsWith("app-weeks-integration-")) throw new Error("Unsafe cleanup path");
    await rm(target, { recursive: true, force: true });
  }
}, 120_000);
