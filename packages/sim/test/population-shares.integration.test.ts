import { expect, test } from "bun:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

test("the sim CLI refuses invalid population shares before producing a world report", async () => {
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "packages/sim/src/cli.ts",
      "--personas", "80", "--days", "1", "--seed", "7", "--no-log", "--json", ...args], {
      cwd: ROOT, stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
      const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      return { out, err, exit };
    } finally { clearTimeout(timeout); }
  }
  for (const option of ["adversarial-rate", "minor-share"]) for (const value of ["NaN", "Infinity", "-Infinity", "-0.01", "1.01", "", " "]) {
    const r = await run([`--${option}=${value}`]);
    expect({ option, value, exit: r.exit, report: r.out.trim(), error: r.err.includes("must be a finite number between 0 and 1") })
      .toEqual({ option, value, exit: 1, report: "", error: true });
  }
  for (const args of [[], ["--adversarial-rate=0", "--minor-share=0"], ["--adversarial-rate=1"], ["--adversarial-rate=0", "--minor-share=1"]]) {
    const r = await run(args), m = JSON.parse(r.out);
    expect({ exit: r.exit, personas: m.run.personas, invariants: m.invariants.total, leaks: m.privacy.canaryLeaks, minorContacts: m.safety.minorContacts })
      .toEqual({ exit: 0, personas: 80, invariants: 0, leaks: 0, minorContacts: 0 });
  }
}, 60_000);
