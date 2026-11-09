import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

test("Slop evaluation rejects invalid presets before running arms and preserves valid selections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "slop-presets-"));
  let sequence = 0;
  async function run(args: string[]) {
    const output = join(dir, `${sequence++}.json`);
    const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source",
      "packages/sim/src/apps/slop/packEval.ts", "--arms", "random", "--seeds", "1", "--weeks", "1",
      "--per-city", "20", "--json", output, ...args], { cwd: ROOT, stdout: "pipe", stderr: "pipe", timeout: 30_000 });
    const [stdout, stderr, exit] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    const file = Bun.file(output);
    return { stdout, stderr, exit, result: await file.exists() ? await file.json() : null };
  }
  try {
    for (const args of [
      ["--preset", "it5biass"], ["--preset", ""], ["--preset", " "], ["--preset"],
      ["--preset", "--groups"], ["--preset", "constructor"], ["--preset", "toString"],
      ["--preset", "hasOwnProperty"], ["--preset", "__proto__"],
      ["--preset", "it5bias", "--preset", "it5biass"],
      ["--preset", "it5biass", "--preset", "it5bias"],
    ]) {
      const r = await run(args);
      expect({ args, exit: r.exit, output: r.stdout, wrote: r.result !== null,
        diagnostic: r.stderr.includes("unknown preset:") && r.stderr.includes("known:") && r.stderr.includes("it5bias"),
        ran: /random: \d/.test(r.stderr),
      }).toEqual({ args, exit: 2, output: "", wrote: false, diagnostic: true, ran: false });
    }
    const control = await run([]);
    expect(control.exit).toBe(0);
    expect(control.result.map((r: { arm: string }) => r.arm)).toEqual(["random"]);
    const selected = await run(["--preset", "it5bias"]);
    expect(selected.exit).toBe(0);
    expect(selected.result.map((r: { arm: string }) => r.arm)).toEqual([
      "random", "d+b (DEFAULT), bias 0.5", "d+b (DEFAULT), bias 1", "no photos + DEFAULT",
    ]);
    expect(selected.result[0]).toEqual(control.result[0]);
    const repeated = await run(["--preset", "it5bias", "--preset", "it5bias"]);
    expect(repeated.exit).toBe(0);
    expect(repeated.result).toEqual([...selected.result, ...selected.result.slice(1)]);
    const explicit = await run(["--variant", "{}", "--variant-name", "manual", "--preset", "it5bias"]);
    expect(explicit.exit).toBe(0);
    expect(explicit.result.map((r: { arm: string }) => r.arm)).toEqual(["random", "manual", ...selected.result.slice(1).map((r: { arm: string }) => r.arm)]);
    expect(explicit.result.slice(2)).toEqual(selected.result.slice(1));
  } finally {
    if (dirname(resolve(dir)) !== resolve(tmpdir()) || !basename(dir).startsWith("slop-presets-")) throw new Error("Unexpected temporary directory");
    rmSync(dir, { recursive: true, force: true });
  }
}, 120_000);
