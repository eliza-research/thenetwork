import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { assertUnchanged, formalFiles, prepareProject, root, runSpec } from "./vibestack.ts";

const args = process.argv.slice(2);
const check = args[0] === "--check";
if (args.length !== Number(check)) throw new Error("Usage: node scripts/spec-snapshots.ts [--check]");

const generatedPath = "packages/core/src/generated";
const vibePath = "packages/core/src/vibe";
const vendorModules = join(root, "tools/vibestack/node_modules");
const compiler = join(vendorModules, "vibelang/bin/vibelang");
const files = formalFiles();
const staging = mkdtempSync(join(tmpdir(), "thenetwork-spec-"));

function existingFiles(directory: string): string[] {
  const path = join(root, directory);
  return existsSync(path)
    ? readdirSync(path, { withFileTypes: true })
      .filter(entry => entry.isFile()).map(entry => `${directory}/${entry.name}`)
    : [];
}

/** Compile the serving .vibe entry points and the generated Effect adapters they import. */
function compileVibeShells(generated: string): Map<string, string> {
  const shells = new Map(existingFiles(vibePath).filter(file => file.endsWith(".vibe"))
    .map(file => [file, readFileSync(join(root, file))]));
  if (!shells.size) return new Map();
  if (!existsSync(compiler)) throw new Error("VibeLang is missing. Run pnpm run spec:setup.");
  const project = join(staging, "vibe");
  const output = join(project, "emit");
  mkdirSync(join(project, "generated"), { recursive: true });
  symlinkSync(vendorModules, join(project, "node_modules"), "junction");
  for (const file of readdirSync(generated).filter(file => /^[a-z]\w*\.(?:ts|effect\.vibe)$/.test(file))) {
    copyFileSync(join(generated, file), join(project, "generated", file));
  }
  for (const [file, source] of shells) writeFileSync(join(project, basename(file)), source);
  const config = join(project, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
      skipLibCheck: true, declaration: true, rootDir: ".", outDir: "emit",
      rewriteRelativeImportExtensions: true, noEmitOnError: true,
    },
    files: [...shells.keys()].map(file => basename(file)),
  }));
  execFileSync(process.execPath, [compiler, "-p", config], { stdio: "inherit" });
  const currentShells = existingFiles(vibePath).filter(file => file.endsWith(".vibe"));
  if (currentShells.length !== shells.size || currentShells.some(file => !shells.get(file)?.equals(readFileSync(join(root, file))))) {
    throw new Error("The serving VibeLang sources changed during compilation. Run spec:sync again.");
  }

  const emitted = new Map<string, string>();
  const emit = (file: string, source: string) => {
    const path = join(output, file);
    writeFileSync(path, `// Generated from ${source}. Run pnpm run spec:sync.\n${readFileSync(path, "utf8")}`);
    emitted.set(`${vibePath}/${file}`, path);
  };
  const directOutput = readdirSync(output);
  for (const source of shells.keys()) {
    const prefix = `${basename(source, ".vibe")}.`;
    for (const file of directOutput.filter(file => file.startsWith(prefix))) emit(file, source);
  }
  if (existsSync(join(output, "generated"))) {
    for (const file of readdirSync(join(output, "generated"))) {
      emit(`generated/${file}`, `spec/${file.split(".")[0]}.md via Vibestack and VibeLang`);
    }
  }
  return emitted;
}

try {
  prepareProject(staging, files);
  if (await runSpec(staging, ["gen"]) !== 0) throw new Error("Vibestack generation failed.");
  const generated = join(staging, "gen");
  const expected = new Map(readdirSync(generated).filter(file => /^[a-z]\w*\.ts$/.test(file))
    .map(file => [`${generatedPath}/${file}`, join(generated, file)]));
  for (const [file, source] of compileVibeShells(generated)) expected.set(file, source);
  assertUnchanged(files);

  const changed = [...expected].filter(([file, source]) => {
    const current = join(root, file);
    return !existsSync(current) || !readFileSync(current).equals(readFileSync(source));
  });
  const stale = [
    ...existingFiles(generatedPath).filter(file => file.endsWith(".ts")),
    ...existingFiles(vibePath).filter(file => /(?:\.js|\.d\.ts)$/.test(file)),
    ...existingFiles(`${vibePath}/generated`).filter(file => /(?:\.js|\.d\.ts)$/.test(file)),
  ].filter(file => !expected.has(file));

  if (check) {
    if (changed.length || stale.length) {
      console.error(`Generated snapshots are out of date. Run pnpm run spec:sync.\n${[...changed.map(([file]) => file), ...stale].join("\n")}`);
      process.exitCode = 1;
    } else {
      console.log(`Checked ${expected.size} generated TypeScript and VibeLang artifacts.`);
    }
  } else {
    for (const [file, source] of changed) {
      const destination = join(root, file);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    }
    for (const file of stale) rmSync(join(root, file));
    console.log(`Updated ${changed.length} and removed ${stale.length} generated TypeScript and VibeLang artifacts.`);
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}
