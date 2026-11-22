import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { generateFriendsPersonas } from "../src/apps/friends/persona.ts";
import { generatePeonPopulation } from "../src/apps/peon/persona.ts";

const run = promisify(execFile);
const cli = (path: string, args: string[]) => run(process.execPath,
  ["--conditions=eliza-source", "--import", "tsx", path, ...args], { timeout: 90_000 });

test("the simulation CLI validates all selected blocks and counts a repeated block once", async () => {
  const script = "scripts/sim.ts";
  await expect(cli(script, ["--only=evals,"])).rejects.toMatchObject({ code: 2,
    stderr: expect.stringContaining("unknown block: <empty>"), stdout: "" });
  const result = await cli(script, ["--only", "evals", "--only=evals, evals"]);
  expect(result.stdout.match(/^== evals$/gm)).toEqual(["== evals"]);
  expect(result.stdout).toMatch(/PASS: [1-9][0-9]*\/[1-9][0-9]* blocking gates/);
}, 180_000);

test.each(["", "consent,unknown", "consent,"])("the experiment refuses the complete malformed arm list %j", async selector => {
  await expect(cli("packages/network/harness/experiment.ts", ["--days", "1", `--only=${selector}`])).rejects.toMatchObject({
    code: 2, stderr: expect.stringContaining("unknown experiment arm:"), stdout: "",
  });
}, 100_000);

test("the native population generators reject malformed counts and preserve explicit zero", () => {
  for (const count of [NaN, -1, 2.5, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => generateFriendsPersonas({ seed: 7, n: count })).toThrow(/non-negative safe integer/);
    expect(() => generatePeonPopulation({ seed: 7, perCity: count, jobsPerCity: 0 })).toThrow(/candidates per city/);
    expect(() => generatePeonPopulation({ seed: 7, perCity: 0, jobsPerCity: count })).toThrow(/jobs per city/);
  }
  expect(generateFriendsPersonas({ seed: 7, n: 0 })).toEqual([]);
  expect(generatePeonPopulation({ seed: 7, perCity: 0, jobsPerCity: 0 })).toMatchObject({ candidates: [], jobs: [] });
  expect(generatePeonPopulation({ seed: 7, perCity: 2, jobsPerCity: 2 })).toMatchObject({
    candidates: expect.arrayContaining([expect.objectContaining({ id: "c-nyc-0000" })]),
    jobs: expect.any(Array),
  });
});

test.each([
  ["friends", ["--n", " ", "--only", "pack"]],
  ["peon", ["--per-city", "", "--arms", "pack"]],
  ["peon", ["--per-city", "0", "--jobs"]],
] as const)("a blank or missing %s CLI population is invalid", async (app, args) => {
  await expect(cli(`packages/sim/src/apps/${app}/cli.ts`, ["--seeds", "1", "--weeks", "1", ...args])).rejects.toMatchObject({
    code: 1, stderr: expect.stringContaining("non-negative safe integer"),
  });
}, 100_000);


test.each([
  { args: ["--arms", "pack", "--realism", "v3"], reason: "invalid Peon realism" },
  { args: ["--arms", "keyword,pack", "--gate-arm", "pak"], reason: "invalid Peon gate arm" },
  { args: ["--arms", "pack", "--gate-arm", "pack"], reason: "invalid Peon gate arm" },
])("Peon rejects an invalid selector before emitting a result", async ({ args, reason }) => {
  await expect(cli("packages/sim/src/apps/peon/cli.ts", ["--seeds", "1", "--weeks", "1", "--per-city", "2", "--jobs", "2", ...args]))
    .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(reason), stdout: "" });
}, 100_000);

test.each([["--preset", "missing"], ["--preset=constructor"], ["--preset="]])("Slop refuses an invalid preset before emitting a result", async (...args) => {
  await expect(cli("packages/sim/src/apps/slop/packEval.ts", ["--seeds", "1", "--weeks", "1", "--per-city", "2", "--arms", "slop", ...args]))
    .rejects.toMatchObject({ code: 2, stderr: expect.stringContaining("unknown Slop preset:"), stdout: "" });
}, 100_000);
