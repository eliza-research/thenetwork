import { expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

test("the simulation CLI rejects invalid judge sample counts before running a world or calling a provider", async () => {
  let requests = 0;
  // A local tripwire, not a model: any request is a test failure.
  const trap = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch() {
    requests++;
    return new Response("No model is available in this test", { status: 400 });
  } });
  const env = { ...process.env, SURPLUS_API_KEY: "", OPENAI_API_KEY: "synthetic-no-provider-access",
    OPENAI_BASE_URL: `${trap.url}v1`, JUDGE_PROVIDER: "openai" };
  const run = async (args: string[]) => {
    const p = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "packages/sim/src/cli.ts",
      "--personas", "12", "--days", "1", "--seed", "1", "--no-log", "--json", ...args],
    { cwd: root, env, stdout: "pipe", stderr: "pipe" });
    const [out, err, exit] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    return { out, err, exit };
  };
  try {
    for (const value of ["0", "", " ", "-1", "0.5", "1.5", "NaN", "nope", "Infinity", "-Infinity", "9007199254740992"]) {
      const r = await run([`--judge=${value}`]);
      expect(r.exit).not.toBe(0);
      expect(r.err).toContain("--judge must be a positive safe integer");
      expect(r.out).toBe("");
    }
    // Validation precedes both dynamic engine loading and optional model-backed setup.
    const early = await run(["--judge", "0", "--engine", "missing-judge-count-engine.ts", "--llm", "--llm-personas"]);
    expect(early.err).toContain("--judge must be a positive safe integer");
    expect(early.out).toBe("");
    expect(requests).toBe(0);
    const ordinary = await run([]);
    expect(ordinary.exit).toBe(0);
    const metrics = JSON.parse(ordinary.out);
    expect(metrics.run.joined).toBeGreaterThan(0);
    expect(metrics.style.checked).toBeGreaterThan(0);
    expect(metrics).not.toHaveProperty("llmJudges");
    expect(requests).toBe(0);
  } finally { trap.stop(true); }
}, 60_000);
