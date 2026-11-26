// A rate whose base is empty is 0/0, not a measured 0%: the table prints n/a for
// probe-yes, quorum, attendance, good-meetup and seat-tolerance rates when their
// denominators are 0, and the per-seed summary prints "repeat n/a" while the
// repeat base is empty. Measured rates, including a measured 0.0%, keep their values.
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const run = (n: number, weeks: number, only: string) => {
  const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
  const p = spawnSync(process.execPath, ["--conditions=eliza-source", "--import", "tsx", join(root, "packages/sim/src/apps/friends/cli.ts"),
    "--seeds", "1", "--n", String(n), "--weeks", String(weeks), "--only", only], { cwd: root, encoding: "utf8" });
  expect(p.status, p.stderr).toBe(0);
  return p;
};

const row = (out: string, label: string) => {
  const found = out.split("\n").find(l => l.startsWith(`| ${label} |`));
  expect(found).toBeDefined();
  return found!;
};

test("friends table shows n/a for rates with an empty base and keeps a measured 0.0%", () => {
  const p = run(20, 1, "pack");
  expect(row(p.stdout, "Probe yes rate")).toContain("| 42.9% ± 0.0 |");
  expect(row(p.stdout, "Quorum rate (reached / probed)")).toContain("| 0.0% ± 0.0 |");
  for (const label of ["Attendance (came / booked)", "Good meetups (least misery >= 0.45)", "Seats over the member's tolerance"]) {
    expect(row(p.stdout, label)).toContain("| n/a |");
  }
  expect(p.stderr).toContain("repeat n/a");
  expect(p.stderr).not.toContain("repeat 0%");
}, 300_000);

test("friends table shows n/a for probe-yes and quorum when nothing was probed", () => {
  const p = run(10, 1, "random");
  for (const label of ["Probe yes rate", "Quorum rate (reached / probed)"]) {
    expect(row(p.stdout, label)).toContain("| n/a |");
  }
}, 300_000);

test("friends table keeps the measured rates at 400 personas, 1 week", () => {
  const p = run(400, 1, "pack");
  expect(row(p.stdout, "Probe yes rate")).toContain("| 40.4% ± 0.0 |");
  expect(row(p.stdout, "Quorum rate (reached / probed)")).toContain("| 52.8% ± 0.0 |");
  expect(row(p.stdout, "Attendance (came / booked)")).toContain("| 89.6% ± 0.0 |");
  expect(row(p.stdout, "Good meetups (least misery >= 0.45)")).toContain("| 55.6% ± 0.0 |");
  expect(row(p.stdout, "Seats over the member's tolerance")).toContain("| 6.9% ± 0.0 |");
  expect(p.stderr).toContain("repeat n/a");
}, 300_000);

test("friends summary keeps the measured repeat rate at 8 weeks", () => {
  const p = run(400, 8, "pack");
  expect(row(p.stdout, "**Repeat-meetup rate (>= 2 again within 30 d)**")).toContain("| 18.8% ± 0.0 |");
  expect(p.stderr).toContain("repeat 19%");
}, 300_000);
