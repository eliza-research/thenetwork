import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../../../", import.meta.url));
async function run(args: string[]) {
  const p = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", "packages/observatory/src/report.ts",
    "--days", "7", "--seed", "1", "--personas", "80", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [exit, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { exit, stdout, stderr };
}

test("report CLI refuses unknown selectors and runs the selected simulated network, engine and reviewer", async () => {
  for (const [name, values] of Object.entries({ network: ["consens", "", " ", "CONSENT"], engine: ["engne-v1", "", " ", "ENGINE-V1"], review: ["manual", "", " ", "HUMAN"] })) {
    for (const value of values) {
      const r = await run([...(name === "network" ? ["--review", "human"] : name === "engine" ? ["--network", "stub"] : []), `--${name}`, value]);
      expect(r.exit).toBe(2);
      expect(r.stdout).toBe("");
      expect(r.stderr).toContain(`invalid --${name}: ${JSON.stringify(value)}; expected`);
    }
  }
  let explicitDefault: unknown;
  for (const engine of ["engine-v1", "random", "off"]) {
    for (const network of ["consent", "stub"]) {
      for (const review of ["auto", "human"]) {
        const r = await run(["--engine", engine, "--network", network, "--review", review]);
        expect(r.exit).toBe(0);
        const report = JSON.parse(r.stdout);
        expect(report.world.engine).toBe(engine);
        expect(report.world.network).toBe(network);
        if (network === "consent") {
          expect(report.review.mode).toBe(review);
          if (review === "human") expect(report.people.invites).toBe(0);
          else expect(report.people.invites).toBeGreaterThan(0);
        } else if (engine === "off") expect(report.people.invites).toBe(0);
        else expect(report.people.invites).toBeGreaterThan(0);
        delete report.world.wallMs;
        if (engine === "engine-v1" && network === "consent" && review === "auto") explicitDefault = report;
      }
    }
  }
  const defaults = await run([]);
  expect(defaults.exit).toBe(0);
  const report = JSON.parse(defaults.stdout);
  delete report.world.wallMs;
  expect(report).toEqual(explicitDefault);
}, 120_000);
