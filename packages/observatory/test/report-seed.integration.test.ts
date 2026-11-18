import { expect, test } from "bun:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

test("the Observatory report rejects malformed seeds instead of reporting a different run", async () => {
  async function run(seed?: string) {
    const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "packages/observatory/src/report.ts",
      "--personas", "80", "--days", "2", ...(seed === undefined ? [] : [`--seed=${seed}`])], {
      cwd: ROOT, stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
      const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { out, err, exit };
    } finally { clearTimeout(timeout); }
  }
  for (const seed of ["", " ", "NaN", "Infinity", "-Infinity", "1e309", "-1e309", "not-a-seed", "1,2"]) {
    const r = await run(seed);
    expect({ seed, exit: r.exit, report: r.out.trim(), diagnostic: r.err.includes("--seed must be a finite number") })
      .toEqual({ seed, exit: 2, report: "", diagnostic: true });
  }
  for (const [seed, expected] of [[undefined, 1], ["1", 1], ["0", 0], ["-7", -7], ["1.5", 1.5], ["1e2", 100], ["0x10", 16], ["+9", 9], [" 3 ", 3]] as const) {
    const r = await run(seed), report = JSON.parse(r.out);
    expect({ exit: r.exit, seed: report.world.seed, members: report.world.members, days: report.world.days })
      .toEqual({ exit: 0, seed: expected, members: 80, days: 2 });
  }
}, 60_000);
