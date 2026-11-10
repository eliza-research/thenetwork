import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { DEFAULT_START, generatePersonas, StubNetwork, World } from "../src/index.ts";

test("accelerated worlds reject invalid speeds before running and preserve valid modes", async () => {
  const root = resolve(import.meta.dir, "../../..");
  for (const speed of ["NaN", "Infinity", "-Infinity", "0", "-1", "bad", "", " ", "86400", "1e6"]) {
    const valid = speed === "86400" || speed === "1e6";
    const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "packages/sim/src/cli.ts",
      "--personas", "80", "--days", "1", "--seed", "7", "--mode", "accelerated", `--speed=${speed}`, "--json", "--no-log"],
      { cwd: root, stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => child.kill(), 10000);
    try {
      const [out, err, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(valid ? { exit, joined: JSON.parse(out).run.joined > 0 } : {
        exit, empty: out.trim() === "", diagnostic: err.includes("accelerated speed must be a positive finite number"),
      }, `speed=${JSON.stringify(speed)}`).toEqual(valid ? { exit: 0, joined: true } : { exit: 1, empty: true, diagnostic: true });
    } finally { clearTimeout(timer); }
  }
  const personas = generatePersonas({ n: 12, seed: 7 });
  const options = { seed: 7, personas, days: 100 / 86400000, writeLog: false,
    actions: [{ at: DEFAULT_START + 80, action: { do: "join" as const, persona: personas[0]!.id } }] };
  for (const speed of [NaN, Infinity, -Infinity, 0, -1]) {
    expect(() => new World({ ...options, network: new StubNetwork(), mode: "accelerated", speed }))
      .toThrow("accelerated speed must be a positive finite number");
  }
  for (const config of [{ mode: "accelerated" as const }, { mode: "accelerated" as const, speed: 0.5 },
    { mode: "discrete" as const, speed: NaN }, { mode: "realtime" as const, speed: NaN }]) {
    const result = await new World({ ...options, network: new StubNetwork(), ...config }).run();
    expect({ joined: result.metrics.run.joined, messages: result.channel.all().length > 0 }).toEqual({ joined: 1, messages: true });
  }
}, 20000);
