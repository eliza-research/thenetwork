import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { BASELINES } from "../src/apps/friends/baselines.ts";
import { runFriendsWorld } from "../src/apps/friends/world.ts";
import { keywordMatcher } from "../src/apps/peon/baselines.ts";
import { runPeonWorld } from "../src/apps/peon/world.ts";

test("Friends and Peon reject invalid generated population counts without producing successful CLI reports", async () => {
  const root = resolve(import.meta.dir, "../../.."), dir = await mkdtemp(join(tmpdir(), "app-population-counts-"));
  try {
    for (const field of ["friends", "candidates", "jobs"] as const) {
      for (const raw of ["NaN", "-Infinity", "-1", "2.5", "", " "]) {
        const output = join(dir, `${field}-${raw.trim() || "blank"}.json`);
        const args = field === "friends" ? ["friends/cli.ts", "--only", "random", "--n", raw]
          : ["peon/cli.ts", "--arms", "keyword", "--per-city", field === "candidates" ? raw : "12", "--jobs", field === "jobs" ? raw : "4"];
        const p = Bun.spawnSync([process.execPath, join(root, "packages/sim/src/apps", args[0]!), ...args.slice(1), "--seeds", "5", "--weeks", "2", "--json", output], { cwd: root, stdout: "ignore", stderr: "pipe" });
        expect(p.exitCode, `${field}=${JSON.stringify(raw)}`).not.toBe(0);
        expect(p.stderr.toString()).toContain("non-negative safe integer");
        expect(await Bun.file(output).exists()).toBe(false);
      }
      for (const value of [NaN, -Infinity, -1, 2.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        if (field === "friends") expect(() => runFriendsWorld({ seed: 5, weeks: 2, n: value, matcher: BASELINES.random })).toThrow("non-negative safe integer");
        else await expect(runPeonWorld({ seed: 5, weeks: 2, perCity: field === "candidates" ? value : 12,
          jobsPerCity: field === "jobs" ? value : 4, matcher: keywordMatcher })).rejects.toThrow("non-negative safe integer");
      }
    }
    for (const n of [0, 12]) {
      expect(runFriendsWorld({ seed: 5, weeks: 2, n, matcher: BASELINES.random }).world.personas.length).toBe(n);
      const r = await runPeonWorld({ seed: 5, weeks: 2, perCity: n, jobsPerCity: n, matcher: keywordMatcher });
      expect(r.world.pop.candidates.length).toBe(2 * n);
      expect(r.world.pop.jobs.length).toBe(2 * n);
    }
  } finally {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep) || !dir.includes("app-population-counts-")) throw new Error("Unexpected temporary directory");
    await rm(dir, { recursive: true, force: true });
  }
}, 30000);
