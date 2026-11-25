import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const run = (weeks: number) => {
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  const p = spawnSync(process.execPath, ["--conditions=eliza-source", "--import", "tsx", join(root, "packages/sim/src/apps/friends/cli.ts"),
    "--seeds", "1", "--n", "400", "--weeks", String(weeks), "--only", "pack"], { cwd: root, encoding: "utf8" });
  expect(p.status, p.stderr).toBe(0);
  return p.stdout;
};

const v14Rows = (out: string) => {
  const rows = ["**V14**", "V14, Network-arranged only"].map(label => out.split("\n").find(l => l.startsWith(`| ${label} |`)));
  for (const row of rows) expect(row).toBeDefined();
  return rows as string[];
};

test("friends table shows n/a for the V14 rows at 1 week", () => {
  const out = run(1);
  for (const row of v14Rows(out)) {
    expect(row).toContain("| n/a |");
    expect(row).not.toContain("NaN");
  }
  const boroughs = out.split("\n").find(l => l.startsWith("  pack: "));
  expect(boroughs).toBeDefined();
  expect(boroughs).toContain("n/a");
  expect(boroughs).not.toContain("NaN%");
  expect(out).not.toContain("NaN%");
}, 300_000);

test("friends table keeps the measured V14 at 8 weeks", () => {
  const out = run(8);
  for (const row of v14Rows(out)) {
    expect(row).toContain("%");
    expect(row).not.toContain("n/a");
    expect(row).not.toContain("NaN");
  }
}, 300_000);
