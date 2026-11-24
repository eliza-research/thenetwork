import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const preview = (...args: string[]) => spawnSync(process.execPath,
  ["--import=tsx", "--conditions", "eliza-source", "apps/observatory/src/report.ts", "--personas", "12", "--days", "1", ...args],
  { cwd: root, encoding: "utf8", timeout: 15_000 });

test.each([
  ["--engine", "unsupported"],
  ["--network", "unsupported"],
  ["--review", "unsupported"],
  ["--seed", "not-a-number"],
  ["--seed", ""],
])("the report refuses %s with invalid value %j", (option, value) => {
  const run = preview(`${option}=${value}`);
  expect(run.status).toBe(2);
  expect(run.stderr).toContain(option);
  expect(run.stdout.trim()).toBe("");
}, 20_000);

test("the report accepts the engine-disabled selector and preserves the exact seed", () => {
  const run = preview("--engine", "off", "--seed", "7");
  expect(run.status).toBe(0);
  expect(JSON.parse(run.stdout)).toMatchObject({ world: { engine: "off", seed: 7, days: 1 } });
}, 20_000);
