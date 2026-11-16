import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertUnchanged, formalFiles, prepareProject, root, runSpec } from "./vibestack.ts";

const args = process.argv.slice(2);
const check = args[0] === "--check";
if (args.length !== Number(check)) throw new Error("Usage: node scripts/spec-snapshots.ts [--check]");

const destination = join(root, "packages/core/src/generated");
const files = formalFiles();
const staging = mkdtempSync(join(tmpdir(), "thenetwork-spec-"));

try {
  prepareProject(staging, files);
  if (await runSpec(staging, ["gen"]) !== 0) throw new Error("Vibestack generation failed.");
  assertUnchanged(files);

  const generated = join(staging, "gen");
  const expected = new Set(readdirSync(generated).filter(file => /^[a-z]\w*\.ts$/.test(file)));
  const changed = [...expected].filter((file) => {
    const current = join(destination, file);
    return !existsSync(current) || !readFileSync(current).equals(readFileSync(join(generated, file)));
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
    for (const file of changed) copyFileSync(join(generated, file), join(destination, file));
    for (const file of stale) rmSync(join(destination, file));
    console.log(`Updated ${changed.length} and removed ${stale.length} generated TypeScript snapshots.`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
