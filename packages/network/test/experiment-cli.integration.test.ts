import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import type { ArmResult } from "../harness/experiment.ts";

const cwd = fileURLToPath(new URL("../../../", import.meta.url));
async function run(args: string[]) {
  const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source",
    "packages/network/harness/experiment.ts", "--days", "2", "--seed", "1", ...args],
  { cwd, stdout: "pipe", stderr: "pipe", timeout: 45_000 });
  const [exit, stdout, stderr] = await Promise.all([
    child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
  ]);
  return { exit, stdout, stderr };
}

test("experiment CLI rejects malformed arm lists before running and preserves valid comparisons", async () => {
  for (const args of [
    ["--only", "consnet"], ["--only", "push-baseline"], ["--only", "constructor"],
    ["--only", "consent,missing"], ["--only", "missing,consent"],
    ["--only", ""], ["--only="], ["--only", ","],
    ["--only", "consent,"], ["--only", ",consent"], ["--only", " "],
  ]) {
    const result = await run(args);
    expect({ args, ...result, started: /^.*: \d+ms$/m.test(result.stderr) }).toEqual({
      args, exit: 2, stdout: "", started: false,
      stderr: expect.stringMatching(/^unknown arm: .+; known: push_baseline, push_v2, consent\r?$/m),
    });
  }
  const all = await run([]);
  expect(all.exit).toBe(0);
  const results = (JSON.parse(all.stdout) as { results: ArmResult[] }).results;
  expect(results.map(r => r.arm)).toEqual(["push_baseline", "push_v2", "consent"]);
  expect(results.every(r => r.days === 2 && r.members >= 250)).toBe(true);
  expect(results.reduce((sum, r) => sum + r.proposals, 0)).toBeGreaterThan(0);
  const selected = await run(["--only", "consent,push_baseline"]);
  expect(selected.exit).toBe(0);
  expect(JSON.parse(selected.stdout).results).toEqual([results[2], results[0]]);
}, 60_000);
