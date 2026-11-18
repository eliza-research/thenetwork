// The world simulator's population size (packages/sim/src/generator.ts; the CLI is packages/sim/src/cli.ts).
//
// A population size is a count. Before this fix the generator used its `n` without checking it:
//   - `--personas=2.5`, `-1`, `NaN`, `Infinity` and any non-numeric text died inside allocation with
//     "RangeError: Array length must be a positive integer of safe magnitude", before the CLI read any
//     other option, so an operator saw a stack trace rather than a diagnostic;
//   - a blank `--personas=` (or spaces) became 0 through Number(""), so the CLI exited 0 and printed a
//     complete "successful" report for a world with no members at all (personas 0, joined 0, every
//     rate 0).
// The generator now requires a non-negative safe integer, and the CLI hands a blank value to that check
// instead of turning it into 0. A real count of 0 stays valid: an explicitly empty world is a
// legitimate control, a blank option is not.
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { generatePersonas } from "../src/generator.ts";

const CLI = resolve(import.meta.dir, "../src/cli.ts");

function invoke(personas: string | undefined, extra: string[] = []) {
  const args = [process.execPath, "run", "--conditions", "eliza-source", CLI, "--days=1", "--seed=1", "--no-log", "--json", ...extra];
  if (personas !== undefined) args.push(`--personas=${personas}`);
  const p = Bun.spawnSync(args, { timeout: 120_000 });
  const stdout = p.stdout.toString();
  const stderr = p.stderr.toString();
  let report: { run: { personas: number; days: number } } | undefined;
  try { report = JSON.parse(stdout); } catch {}
  return { exit: p.exitCode, stdout, stderr, report };
}

describe("world CLI population size", () => {
  // Every malformed value is refused with the count diagnostic, before a world is built or a report is
  // printed. A blank value is the interesting one: it used to be a silent zero.
  test("a malformed --personas is refused with a count diagnostic and no report", () => {
    for (const value of ["", "   ", "2.5", "-1", "NaN", "Infinity", "-Infinity", "abc"]) {
      const r = invoke(value);
      expect({ value, exit: r.exit !== 0, report: r.report === undefined, diagnostic: r.stderr.includes("non-negative safe integer") })
        .toEqual({ value, exit: true, report: true, diagnostic: true });
    }
  }, 180_000);

  // The supported spellings keep working, including an explicit empty world.
  test("valid counts and an explicit zero still run", () => {
    for (const [value, expected] of [[undefined, 40], ["0", 0], ["1", 1], ["12", 12], ["1e1", 10], ["0x10", 16], [" 12 ", 12]] as const) {
      const r = invoke(value);
      expect({ value: value ?? "(default)", exit: r.exit, personas: r.report?.run.personas }).toEqual({ value: value ?? "(default)", exit: 0, personas: expected });
    }
  }, 180_000);

  // Native callers (the LLM persona generator, the observatory's game source, scripts) get the same
  // rule: the old failures were inside the generator, not the CLI.
  test("the generator itself rejects a count that is not a non-negative safe integer", () => {
    for (const n of [NaN, -1, 2.5, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => generatePersonas({ n, seed: 1 })).toThrow("non-negative safe integer");
    }
    expect(generatePersonas({ n: 0, seed: 1 })).toEqual([]);
    expect(generatePersonas({ n: 3, seed: 1 }).map(p => p.id)).toEqual(["m0001", "m0002", "m0003"]);
  });
});
