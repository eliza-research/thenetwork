// The 4-week friends table must not report a 0.0% repeat rate: no meetup can have a
// 30-day follow-up window yet, so the repeat base is structurally empty (n/a, not 0%).
// The 8-week control keeps the measured rate.
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { friendsArms } from "../src/apps/friends/arms.ts";
import { friendsMetrics } from "../src/apps/friends/metrics.ts";
import { runFriendsWorldAsync } from "../src/apps/friends/world.ts";

const run = (weeks: number) => {
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  const p = spawnSync(process.execPath, ["--conditions=eliza-source", "--import", "tsx", join(root, "packages/sim/src/apps/friends/cli.ts"),
    "--seeds", "1", "--n", "400", "--weeks", String(weeks), "--only", "pack"], { cwd: root, encoding: "utf8" });
  expect(p.status, p.stderr).toBe(0);
  return p.stdout;
};

test("friends table shows n/a for the repeat rows at 4 weeks", () => {
  const out = run(4);
  const meetupsRow = out.split("\n").find(l => l.startsWith("| Meetups held / seed |"));
  expect(meetupsRow).toBeDefined();
  const meetupsMatch = meetupsRow!.match(/\|\s*(\d+(?:\.\d+)?)\s*±/);
  expect(meetupsMatch).not.toBeNull();
  expect(Number(meetupsMatch![1])).toBeGreaterThan(40);
  for (const label of ["**Repeat-meetup rate (>= 2 again within 30 d)**", "Repeat, same group (>= 3 again)", "Repeat, counting crew handoffs"]) {
    const row = out.split("\n").find(l => l.startsWith(`| ${label} |`));
    expect(row).toBeDefined();
    expect(row).toContain("| n/a |");
    expect(row).not.toContain("0.0%");
  }
});

test("friends table keeps the measured repeat rates at 8 weeks", () => {
  const out = run(8);
  const rates: number[] = [];
  for (const label of ["**Repeat-meetup rate (>= 2 again within 30 d)**", "Repeat, same group (>= 3 again)", "Repeat, counting crew handoffs"]) {
    const row = out.split("\n").find(l => l.startsWith(`| ${label} |`));
    expect(row).toBeDefined();
    expect(row).not.toContain("| n/a |");
    const pctMatch = row!.match(/\|\s*(\d+(?:\.\d+)?)%\s*±/);
    expect(pctMatch).not.toBeNull();
    rates.push(Number(pctMatch![1]));
  }
  expect(rates[0]!).toBeGreaterThan(0);
  expect(rates[1]!).toBeGreaterThan(0);
  expect(rates[2]!).toBeGreaterThanOrEqual(rates[0]!);
}, 300_000);

test("a meetup with only 29 observed follow-up days stays out of the repeat base", async () => {
  const weeks = 5;
  const run = await runFriendsWorldAsync({ seed: 1, n: 150, weeks, planCap: 1, matcher: friendsArms().pack! });
  const lastDay = weeks * 7 - 1;
  const held = run.meetups.filter(m => m.kind !== "crew_self");
  expect(held.some(m => lastDay - m.day === 29)).toBe(true);
  const complete = held.filter(m => lastDay - m.day >= 30);
  expect(friendsMetrics(run).repeatBase).toBe(complete.length);
});
