import { expect, test } from "bun:test";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

test("sim CLI rejects unregistered blocks before running gates", async () => {
  for (const only of ["constructor", "toString", "hasOwnProperty", "no-such-block", "evals,constructor"]) {
    const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "scripts/sim.ts", "--only", only], {
      cwd: ROOT, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ only, exit, error: stderr.includes("unknown block:"), ran: stdout.includes("blocking gates") })
      .toEqual({ only, exit: 2, error: true, ran: false });
  }

  const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "scripts/sim.ts", "--only=evals"], {
    cwd: ROOT, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, , exit] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect(exit).toBe(0);
  expect(stdout).toMatch(/PASS: [1-9]\d*\/[1-9]\d* blocking gates/);
}, 30_000);
