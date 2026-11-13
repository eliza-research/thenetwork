import { expect, test } from "bun:test";
import { mkdtemp, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Peon CLI rejects unavailable evaluation selectors before running and preserves valid profiles and gates", async () => {
  const root = resolve(import.meta.dir, "../../.."), dir = await mkdtemp(join(tmpdir(), "peon-selectors-test-"));
  const files: string[] = [];
  const run = async (arms: string, args: string[]) => {
    const file = join(dir, `${files.length}.json`); files.push(file);
    const p = Bun.spawn([process.execPath, join(root, "packages/sim/src/apps/peon/cli.ts"), "--seeds", "7", "--per-city", "80", "--jobs", "30", "--weeks", "8", "--arms", arms, "--json", file, ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [exit, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
    return { exit, stdout, stderr, file: Bun.file(file) };
  };
  try {
    for (const [arms, args] of [
      ["keyword,oracle,pack", ["--gate-arm", "pak"]],
      ["keyword,oracle", ["--gate-arm", "pack"]],
      ["pack", ["--gate-arm", "pack"]],
      ["keyword,pack", ["--gate-arm", ""]],
      ["keyword,pack", ["--gate-arm"]],
      ["keyword", ["--realism", "v3"]],
      ["keyword", ["--realism"]],
    ] as const) {
      const r = await run(arms, [...args]);
      expect(r.exit).not.toBe(0);
      expect(await r.file.exists()).toBe(false);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain(args[0]);
    }
    const profiles = [];
    for (const name of [undefined, "v1", "v2"]) {
      const r = await run("keyword", name ? ["--realism", name] : []);
      expect(r.exit).toBe(0);
      expect(r.stdout).toContain(`world ${name ?? "v2"}`);
      profiles.push(await r.file.json());
    }
    expect(profiles[0]).toEqual(profiles[2]);
    expect(profiles[1]).not.toEqual(profiles[2]);
    const gates = await run("keyword,oracle,no-pacing", ["--gate-arm", "no-pacing"]);
    expect(gates.stdout).toContain("Official gate (adopted");
    expect(await gates.file.exists()).toBe(true);
  } finally {
    for (const file of files) if (await Bun.file(file).exists()) await Bun.file(file).delete();
    await rmdir(dir);
  }
});
