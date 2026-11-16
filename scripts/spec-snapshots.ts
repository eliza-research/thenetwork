import { execFileSync } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertUnchanged, formalFiles, prepareProject, root, runSpec } from "./vibestack.ts";

const args = process.argv.slice(2);
const check = args[0] === "--check";
if (args.length !== Number(check)) throw new Error("Usage: node scripts/spec-snapshots.ts [--check]");

const generatedPath = "packages/core/src/generated";
const vibePath = "packages/core/src/vibe";
const healthShell = "backendHealthShell.vibe";
const healthModule = "backendHealth";
const vendorModules = join(root, "tools/vibestack/node_modules");
const compiler = join(vendorModules, "vibelang/bin/vibelang");
const files = formalFiles();
const staging = mkdtempSync(join(tmpdir(), "thenetwork-spec-"));

function existingFiles(directory: string): string[] {
  const path = join(root, directory);
  return existsSync(path) ? readdirSync(path).map(file => `${directory}/${file}`) : [];
}

/** Compile the serving shell and its generated Effect adapter with the vendored compiler. */
function compileHealthShell(generated: string): Map<string, string> {
  if (!existsSync(compiler)) throw new Error("VibeLang is missing. Run bun run spec:setup.");
  const sourcePath = join(root, vibePath, healthShell);
  const source = readFileSync(sourcePath);
  const project = join(staging, "vibe");
  const output = join(project, "emit");
  mkdirSync(join(project, "generated"), { recursive: true });
  symlinkSync(vendorModules, join(project, "node_modules"), "junction");
  for (const suffix of [".ts", ".effect.vibe"]) {
    const file = healthModule + suffix;
    copyFileSync(join(generated, file), join(project, "generated", file));
  }
  writeFileSync(join(project, healthShell), source);
  const config = join(project, "tsconfig.json");
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
      skipLibCheck: true, declaration: true, rootDir: ".", outDir: "emit",
      rewriteRelativeImportExtensions: true, noEmitOnError: true,
    },
    files: [healthShell],
  }));
  execFileSync(process.execPath, [compiler, "-p", config], { stdio: "inherit" });
  if (!source.equals(readFileSync(sourcePath))) throw new Error(`${sourcePath} changed during compilation. Run spec:sync again.`);

  const emitted = [
    "backendHealthShell.js", "backendHealthShell.d.ts",
    ...readdirSync(join(output, "generated")).map(file => `generated/${file}`),
  ];
  for (const file of emitted) {
    const path = join(output, file);
    const source = file.startsWith("generated/") ? `spec/${healthModule}.md via Vibestack and VibeLang` : `${vibePath}/${healthShell}`;
    writeFileSync(path, `// Generated from ${source}. Run bun run spec:sync.\n${readFileSync(path, "utf8")}`);
  }
  return new Map(emitted.map(file => [`${vibePath}/${file}`, join(output, file)]));
}

try {
  prepareProject(staging, files);
  if (await runSpec(staging, ["gen"]) !== 0) throw new Error("Vibestack generation failed.");
  const generated = join(staging, "gen");
  const expected = new Map(readdirSync(generated).filter(file => /^[a-z]\w*\.ts$/.test(file))
    .map(file => [`${generatedPath}/${file}`, join(generated, file)]));
  for (const [file, source] of compileHealthShell(generated)) expected.set(file, source);
  assertUnchanged(files);

  const changed = [...expected].filter(([file, source]) => {
    const current = join(root, file);
    return !existsSync(current) || !readFileSync(current).equals(readFileSync(source));
  });
  const stale = [
    ...existingFiles(generatedPath).filter(file => file.endsWith(".ts")),
    ...existingFiles(`${vibePath}/generated`).filter(file => /(?:\.js|\.d\.ts)$/.test(file)),
  ].filter(file => !expected.has(file));

  if (check) {
    if (changed.length || stale.length) {
      console.error(`Generated snapshots are out of date. Run bun run spec:sync.\n${[...changed.map(([file]) => file), ...stale].join("\n")}`);
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
