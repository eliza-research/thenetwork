import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gen, readSpecs } from "../tools/vibespec/tools/spec.ts";
import type { Model } from "../tools/vibespec/tools/gen.ts";

const args = process.argv.slice(2);
const check = args[0] === "--check";
if (args.length !== Number(check)) throw new Error("Usage: node scripts/spec-snapshots.ts [--check]");

const root = resolve(import.meta.dirname, "..");
const destination = join(root, "packages/core/src/generated");
const specs = readSpecs(root);
const expected = new Set(specs.map(({ name }) => `${name}.ts`));
const staging = mkdtempSync(join(tmpdir(), "thenetwork-spec-"));

try {
  const models = new Map<string, Model>();
  for (const spec of specs) await gen(staging, spec, models);

  const changed = [...expected].filter((file) => {
    const current = join(destination, file);
    return !existsSync(current) || !readFileSync(current).equals(readFileSync(join(staging, "gen", file)));
  });
  const stale = existsSync(destination)
    ? readdirSync(destination).filter((file) => file.endsWith(".ts") && !expected.has(file))
    : [];

  if (check) {
    if (changed.length || stale.length) {
      console.error(`Generated snapshots are out of date. Run bun run spec:sync.\n${[...changed, ...stale].join("\n")}`);
      process.exitCode = 1;
    } else {
      console.log(`Checked ${expected.size} generated TypeScript snapshots.`);
    }
  } else {
    mkdirSync(destination, { recursive: true });
    for (const file of changed) copyFileSync(join(staging, "gen", file), join(destination, file));
    for (const file of stale) rmSync(join(destination, file));
    console.log(`Updated ${changed.length} and removed ${stale.length} generated TypeScript snapshots.`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
