import { expect, test } from "bun:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

test("experiment CLI rejects invalid seeds and preserves finite seed inputs", async () => {
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source",
      "packages/network/harness/experiment.ts", "--days", "2", "--only", "consent", ...args], {
      cwd: ROOT, stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 30_000);
    try {
      const [exit, stdout, stderr] = await Promise.all([
        child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
      ]);
      return { exit, stdout, stderr };
    } finally { clearTimeout(timeout); }
  }

  for (const args of [
    ["--seed", "not-a-seed"], ["--seed=NaN"], ["--seed=Infinity"], ["--seed=-Infinity"],
    ["--seed", "1e999"], ["--seed", ""], ["--seed="], ["--seed", "   "], ["--seed", "1oops"],
  ]) {
    const { exit, stdout, stderr } = await run(args);
    expect({ args, exit, stdout, error: stderr.includes("--seed must be a finite number"),
      ran: /consent: \d+ms/.test(stderr) })
      .toEqual({ args, exit: 2, stdout: "", error: true, ran: false });
  }

  const implicit = await run([]);
  const explicit = await run(["--seed=1"]);
  expect({ implicit: implicit.exit, explicit: explicit.exit, same: implicit.stdout === explicit.stdout })
    .toEqual({ implicit: 0, explicit: 0, same: true });
  for (const seed of ["0", "-7", "1.5", "0x10", "1e2", " 23 "]) {
    const { exit, stdout } = await run([`--seed=${seed}`]);
    expect({ seed, exit, arms: JSON.parse(stdout).results.map((r: { arm: string }) => r.arm) })
      .toEqual({ seed, exit: 0, arms: ["consent"] });
  }
}, 120_000);
