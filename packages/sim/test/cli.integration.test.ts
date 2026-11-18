import { expect, test } from "bun:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

test("sim CLI validates block selections and runs each selected block once", async () => {
  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "scripts/sim.ts", ...args], {
      cwd: ROOT, stdout: "pipe", stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 10_000);
    try {
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
      ]);
      return { stdout, stderr, exit };
    } finally { clearTimeout(timeout); }
  }

  for (const args of [
    ...["constructor", "toString", "hasOwnProperty", "no-such-block", "evals,constructor", "evals,", "", ",", " "]
      .map(only => ["--only", only]),
    ["--only="], ["--only"], ["--only", "--quick"], ["--only=evals", "--only="],
  ]) {
    const { stdout, stderr, exit } = await run(args);
    expect({ args, exit, error: stderr.includes("unknown block:"), ran: stdout.includes("== ") })
      .toEqual({ args, exit: 2, error: true, ran: false });
  }

  const control = await run(["--only=evals"]);
  const gates = control.stdout.match(/PASS: ([1-9]\d*)\/([1-9]\d*) blocking gates/);
  expect(control.exit).toBe(0);
  expect(gates).not.toBeNull();
  for (const args of [
    ["--only", "evals,evals"], ["--only", "evals", "--only", "evals"],
    ["--only=evals", "--only=evals"], ["--only", " evals , evals "],
  ]) {
    const { stdout, exit } = await run(args);
    expect({ args, exit, blocks: stdout.match(/^== \S+/gm), gates: stdout.match(/PASS: \d+\/\d+ blocking gates/)?.[0] })
      .toEqual({ args, exit: 0, blocks: ["== evals"], gates: gates![0] });
  }
}, 60_000);
