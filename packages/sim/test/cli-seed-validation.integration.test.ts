import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("the world CLI rejects invalid seeds and preserves finite seeds", () => {
  const run = (args: string[]) => Bun.spawnSync([
    process.execPath, "run", "--conditions", "eliza-source", "packages/sim/src/cli.ts",
    "--personas", "4", "--days", "1", "--no-log", "--json", ...args,
  ], { cwd: resolve(import.meta.dir, "../../.."), timeout: 15_000 });
  const invalid = ["not-a-number", "NaN", "Infinity", "-Infinity", "1e309", "", "   "];
  const rejected: boolean[] = [];
  for (const seed of invalid) for (const scenario of [false, true]) {
    const result = run([`--seed=${seed}`, ...(scenario
      ? ["--scenario", "packages/sim/scenarios/band-week-apart.json"] : [])]);
    rejected.push(result.exitCode !== 0 && result.stderr.toString().includes("--seed must be a finite number")
      && result.stdout.toString().trim() === "");
  }
  expect(rejected).toEqual(invalid.flatMap(() => [true, true]));

  for (const seed of [undefined, "0", "7", "-3", "1.25", "2e2", "0xff"]) {
    const result = run(seed === undefined ? [] : [`--seed=${seed}`]);
    expect(result.exitCode).toBe(0);
    const metrics = JSON.parse(result.stdout.toString());
    expect(metrics.run.seed).toBe(seed === undefined ? 1 : Number(seed));
    expect(metrics.run.joined).toBeGreaterThan(0);
  }
}, 30_000);
