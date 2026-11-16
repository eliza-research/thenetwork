import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { scanSpec } from "../tools/vibestack/vibestack/scan.ts";

export const root = resolve(import.meta.dirname, "..");
const toolkit = join(root, "tools/vibestack");
const cli = join(toolkit, "vibestack/spec.ts");
const excludedTrees = new Set(["models", "product"]);

export function formalFiles(): Map<string, string> {
  const entries = new Map<string, string>();
  const walk = (folder: string) => {
    for (const entry of readdirSync(join(root, folder), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (folder === "spec" && excludedTrees.has(entry.name)) continue;
      const file = `${folder}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`${file}: formal specs cannot be symbolic links`);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && (file.endsWith(".md") || file.endsWith(".proof.dfy") || file === "spec/lock.json")) {
        entries.set(file, readFileSync(join(root, file), "utf8"));
      }
    }
  };
  walk("spec");
  return entries;
}

/** Keep source line numbers. Historical models and product prose stay linked in the source tree. */
function projectedSpec(file: string, contents: string): string {
  return scanSpec(contents).map(({ text, kind }) => {
    if (kind !== "prose") return text;
    return text.replace(/(?<!!)\[([^\]]+)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g, (markup, title, quoted, bare) => {
      const target = quoted ?? bare;
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return markup;
      const path = resolve(root, dirname(file), target.split(/[?#]/, 1)[0]);
      for (const tree of excludedTrees) {
        const archive = join(root, "spec", tree);
        if (path === archive || path.startsWith(`${archive}/`)) return `${title} (\`${path.slice(root.length + 1)}\`)`;
      }
      return markup;
    });
  }).join("\n");
}

function writeProjectedSpec(project: string, file: string, contents: string): void {
  const target = join(project, file);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, file.endsWith(".md") ? projectedSpec(file, contents) : contents);
}

export function prepareProject(project: string, files: Map<string, string>, appTypes = false): void {
  mkdirSync(project, { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  writeFileSync(join(project, "package.json"), JSON.stringify({ name: manifest.name, private: true, type: "module" }) + "\n");
  if (appTypes) writeFileSync(join(project, "tsconfig.json"), JSON.stringify({
    extends: join(root, "tsconfig.json"),
    compilerOptions: { typeRoots: [join(root, "node_modules/@types")] },
  }) + "\n");
  for (const [file, contents] of files) writeProjectedSpec(project, file, contents);
}

export function assertUnchanged(files: Map<string, string>): void {
  const current = formalFiles();
  if (current.size !== files.size || [...files].some(([file, contents]) => current.get(file) !== contents)) {
    throw new Error("The formal specs changed while the command ran. Rerun it with the current sources.");
  }
}

export async function runSpec(project: string, args: string[]): Promise<number> {
  return await new Promise((done, fail) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: project, stdio: "inherit" });
    child.once("error", fail);
    child.once("exit", (code) => done(code ?? 1));
  });
}

async function main([command, ...args]: string[]) {
  const patterns: Record<string, string[][]> = {
    gen: [[]],
    check: [[], ["--json"], ["--nightly"], ["--json", "--nightly"], ["--nightly", "--json"]],
    accept: [[], ["unproved"]],
    new: [[], ["*"]],
    studio: [[], ["--port", "*"]],
    watch: [[]],
  };
  const valid = Object.hasOwn(patterns, command) && patterns[command].some((pattern) =>
    args.length === pattern.length && pattern.every((part, index) => part === "*" || part === args[index]));
  if (!valid) throw new Error(`Unsupported Vibestack command or arguments: ${[command, ...args].join(" ")}`);
  const files = formalFiles();
  const studio = command === "studio";
  if (studio && !existsSync(join(toolkit, "vibestack/studio/gen/index.ts"))) {
    const generated = await runSpec(join(toolkit, "vibestack/studio"), ["gen"]);
    if (generated !== 0) return generated;
  }
  const parent = studio ? join(root, "runs/vibestack") : tmpdir();
  mkdirSync(parent, { recursive: true });
  const project = mkdtempSync(join(parent, "thenetwork-vibestack-"));
  try {
    prepareProject(project, files, !["gen", "new"].includes(command));
    if (studio) console.log(`Studio is editing a copy at ${join(project, "spec")}. The repository’s spec/ remains authoritative.`);
    let previous = files;
    const watcher = command === "watch" ? watch(join(root, "spec"), { recursive: true }, () => {
      try {
        const current = formalFiles();
        for (const [file, contents] of current) if (previous.get(file) !== contents) writeProjectedSpec(project, file, contents);
        for (const file of previous.keys()) if (!current.has(file)) rmSync(join(project, file), { force: true });
        previous = current;
      } catch (error) {
        console.error(error instanceof Error ? error.message : error);
      }
    }) : undefined;
    let code: number;
    try {
      code = await runSpec(project, [command, ...args]);
    } finally {
      watcher?.close();
    }
    if (code !== 0 || studio || command === "watch") return code;
    assertUnchanged(files);
    if (command === "gen" && existsSync(join(project, "gen"))) {
      rmSync(join(root, "gen"), { recursive: true, force: true });
      cpSync(join(project, "gen"), join(root, "gen"), { recursive: true });
    }
    if (command === "accept") {
      const ledger = join(project, "spec/lock.json");
      if (existsSync(ledger)) cpSync(ledger, join(root, "spec/lock.json"));
    }
    if (command === "new") {
      const spec = !args[0] || args[0] === "index" ? "spec/index.md" : `spec/${args[0]}/index.md`;
      const target = join(root, spec);
      const fillEmptyIndex = spec === "spec/index.md" && files.get(spec) === "";
      if ((!fillEmptyIndex && existsSync(target)) || excludedTrees.has(spec.split("/")[1])) {
        throw new Error(`${spec}: the destination is already reserved`);
      }
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, readFileSync(join(project, spec)), { flag: fillEmptyIndex ? "w" : "wx" });
    }
    return 0;
  } finally {
    if (!studio) rmSync(project, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
