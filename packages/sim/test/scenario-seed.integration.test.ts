import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { parseRunLog, type RunRecord } from "@thenetwork/core";
import { loadScenario, runScenarioPassK } from "../src/scenario.ts";
import { StubNetwork } from "../src/stubNetwork.ts";

test("scenario CLI seeds control saved worlds and pass-k progression while omitted seeds retain fixture defaults", async () => {
  const root = resolve(import.meta.dir, "../../.."), runs = join(root, "runs");
  const temp = await mkdtemp(join(tmpdir(), "scenario-seed-")), logs: string[] = [];
  const actual = [], expected = [];
  const digest = (records: RunRecord[]) => createHash("sha256").update(JSON.stringify(records.map(r => {
    if (r.type !== "run_end") return r;
    const { wallMs, ...rest } = r;
    return rest;
  }))).digest("hex");
  try {
    for (const fixture of ["stop-keyword", "group-flake-morning-of"]) {
      for (const seed of [undefined, 73, 0]) {
        const scenario = await loadScenario(join(root, `packages/sim/scenarios/${fixture}.json`));
        scenario.name = `${basename(temp)}-${fixture}-${seed ?? "default"}`;
        const file = join(temp, "scenario.json");
        await writeFile(file, JSON.stringify(scenario));
        const result = Bun.spawnSync([process.execPath, "run", "--conditions", "eliza-source", "packages/sim/src/cli.ts",
          "--scenario", file, "--k", "2", ...(seed === undefined ? [] : seed === 0 ? ["--seed=0"] : ["--seed", String(seed)])],
          { cwd: root, stdout: "pipe", stderr: "pipe" });
        const reference = await runScenarioPassK(scenario, 2, { seed, writeLog: false,
          network: sc => new StubNetwork({ seed: seed ?? 1, randomIntros: true, ...sc.stub }) });
        const saved = [...result.stdout.toString().matchAll(/\[(?:PASS|FAIL)\].*? seed=(\d+)\s+log=([^\r\n]+)/g)];
        for (const [, , path] of saved) {
          const dir = resolve(path!);
          if (dirname(dir) !== runs || !basename(dir).startsWith(`scenario-${basename(temp)}-`)) throw new Error("unexpected run directory");
          logs.push(dir);
        }
        actual.push({ fixture, seed, exit: result.exitCode, runs: saved.length });
        expected.push({ fixture, seed, exit: reference.passK ? 0 : 1, runs: 2 });
        for (let i = 0; i < saved.length; i++) {
          const [, reportedSeed, dir] = saved[i]!;
          const records = parseRunLog(await readFile(join(dir!, "events.jsonl"), "utf8"));
          const metrics = JSON.parse(await readFile(join(dir!, "metrics.json"), "utf8"));
          const ref = reference.runs[i]!;
          actual.push({ fixture, seed, i, reportedSeed: Number(reportedSeed), recordedSeed: metrics.run.seed,
            recordsMatch: digest(records) === digest(ref.world.records), metricsMatch: JSON.stringify(metrics) === JSON.stringify(ref.world.metrics) });
          expected.push({ fixture, seed, i, reportedSeed: (seed ?? scenario.seed) + i, recordedSeed: (seed ?? scenario.seed) + i,
            recordsMatch: true, metricsMatch: true });
        }
      }
    }
    expect(actual).toEqual(expected);
  } finally {
    for (const dir of logs) await rm(dir, { recursive: true, force: true });
    await rm(temp, { recursive: true, force: true });
  }
}, 30_000);
