import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vitest";
import { generateFriendsPersonas } from "../src/apps/friends/persona.ts";
import { generatePeonPopulation } from "../src/apps/peon/persona.ts";
import { createFriendsWorld } from "../src/apps/friends/world.ts";
import { createPeonWorld } from "../src/apps/peon/world.ts";
import { createSlopWorld } from "../src/apps/slop/world.ts";
import { generatePersonas } from "../src/generator.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { runWorld } from "../src/world.ts";

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

test.each([
  ["packages/sim/src/cli.ts", "--seed=NaN", "--mode=discrete", "--personas=0", "--no-log", "--json"],
  ["packages/network/harness/experiment.ts", "--seed=Infinity", "--only=push_baseline"],
])("the CLI %s rejects a malformed seed before emitting evidence", async (entry, ...args) => {
  await expect(cli(entry, ["--days", "1", ...args])).rejects.toMatchObject({
    code: 1, stderr: expect.stringContaining("--seed must be a finite number"), stdout: "",
  });
}, 100_000);

test.each([
  ["friends/cli.ts", "-3--1,1e-3", "-3,-2,-1,0.001", ["--only", "random", "--n", "8"], "1,,2"],
  ["peon/cli.ts", "1e-3", "0.001", ["--arms", "keyword", "--per-city", "8", "--jobs", "2"], "1-2-3"],
  ["slop/cli.ts", "-3--1", "-3,-2,-1", ["--only", "random", "--per-city", "8"], "3-1"],
  ["slop/packEval.ts", "1-2", "1,2", ["--arms", "random", "--per-city", "8"], "0-10000"],
] as const)("the app CLI %s emits exactly the selected seeds and refuses a malformed list", async (entry, input, seeds, settings, invalid) => {
  const script = `packages/sim/src/apps/${entry}`;
  const report = await cli(script, ["--weeks", "1", ...settings, "--seeds", input]);
  expect(report.stdout).toContain(`seeds ${seeds}`);
  await expect(cli(script, ["--weeks", "1", ...settings, "--seeds", invalid])).rejects.toMatchObject({
    code: 1, stderr: expect.stringContaining("--seeds"), stdout: "",
  });
}, 180_000);

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


test.each([
  { option: "--judge=0", reason: "--judge must be a positive safe integer" },
  { option: "--personas=", reason: "--personas must be a non-negative safe integer" },
  { option: "--adversarial-rate=NaN", reason: "adversarialRate must be a finite number" },
  { option: "--minor-share=", reason: "minorShare must be a finite number" },
  { option: "--days=0", reason: "world days must be a positive finite number" },
  { option: "--speed=0", reason: "accelerated speed must be a positive finite number" },
])("world CLI refuses $option before generating evidence", async ({ option, reason }) => {
  await expect(cli("packages/sim/src/cli.ts", ["--personas", "2", "--days", "1", "--mode", "accelerated", "--no-log", "--json", option]))
    .rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(reason), stdout: "" });
}, 100_000);

test("native simulation inputs reject invalid values and support intentional empty populations", async () => {
  const seed = 7;
  const network = new StubNetwork({ seed });
  for (const days of [0, -1, NaN, Infinity]) {
    await expect(runWorld({ seed, days, personas: [], network })).rejects.toThrow(/world days/);
  }
  for (const speed of [0, -1, NaN, Infinity]) {
    await expect(runWorld({ seed, speed, mode: "accelerated", days: 1, personas: [], network })).rejects.toThrow(/accelerated speed/);
  }
  expect(() => generatePersonas({ seed, n: 2.5 })).toThrow(/personas/);
  for (const field of ["adversarialRate", "minorShare", "disclosureRate"] as const) {
    expect(() => generatePersonas({ seed, n: 2, [field]: Infinity })).toThrow(field);
  }
  expect(generatePersonas({ seed, n: 0, adversarialRate: 0, minorShare: 1, disclosureRate: 1 })).toEqual([]);
  const control = await runWorld({ seed, days: 0.5, personas: [], network, writeLog: false });
  expect(control.records.filter(record => record.type === "persona")).toEqual([]);
});

test("all three weekly worlds reject partial or empty rounds before reading their populations", () => {
  for (const weeks of [0, -1, 1.5, NaN, Infinity]) {
    expect(() => createFriendsWorld({ seed: 7, weeks })).toThrow(/weeks must be a positive safe integer/);
    expect(() => createPeonWorld({ seed: 7, weeks })).toThrow(/weeks must be a positive safe integer/);
    expect(() => createSlopWorld({ seed: 7, weeks })).toThrow(/weeks must be a positive safe integer/);
  }
});
