// The 4-week friends table must not report a 0.0% repeat rate: no meetup can have a
// 30-day follow-up window yet, so the repeat base is structurally empty (n/a, not 0%).
// The 8-week control keeps the measured rate.
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

test("friends table shows n/a for the repeat rows at 4 weeks", () => {
  const out = run(4);
  expect(out).toContain("| Meetups held / seed | 94.0 ± 0.0 |");
  for (const label of ["**Repeat-meetup rate (>= 2 again within 30 d)**", "Repeat, same group (>= 3 again)", "Repeat, counting crew handoffs"]) {
    const row = out.split("\n").find(l => l.startsWith(`| ${label} |`));
    expect(row).toBeDefined();
    expect(row).toContain("| n/a |");
    expect(row).not.toContain("0.0%");
  }
});

test("friends table keeps the measured repeat rates at 8 weeks", () => {
  const out = run(8);
  expect(out).toContain("| **Repeat-meetup rate (>= 2 again within 30 d)** | 18.8% ± 0.0 |");
  expect(out).toContain("| Repeat, same group (>= 3 again) | 5.0% ± 0.0 |");
  expect(out).toContain("| Repeat, counting crew handoffs | 18.8% ± 0.0 |");
}, 300_000);
