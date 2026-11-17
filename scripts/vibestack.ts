import { spawn } from "node:child_process";
import { copyFileSync, cpSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Model } from "../tools/vibestack/vibestack/gen.ts";
import { scanSpec } from "../tools/vibestack/vibestack/scan.ts";

export const root = resolve(import.meta.dirname, "..");
const toolkit = join(root, "tools/vibestack");
const cli = join(toolkit, "vibestack/spec.ts");
const excludedTrees = new Set(["models", "product"]);
const conformanceTrees = ["test/drivers", "test/traces", "test/counterexamples"];
const counterexamples = "test/counterexamples";

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
    vibe: { sidecarDir: ".vibe/declarations" },
  }) + "\n");
  for (const [file, contents] of files) writeProjectedSpec(project, file, contents);
}

function isProjectDirectory(project: string, folder: string): boolean {
  let directory = project;
  for (const part of folder.split("/")) {
    directory = join(directory, part);
    const entry = lstatSync(directory, { throwIfNoEntry: false });
    if (!entry) return false;
    if (!entry.isDirectory()) throw new Error(`${directory}: expected a regular directory`);
  }
  return true;
}

function conformanceFiles(project: string, folder: string): string[] {
  if (!isProjectDirectory(project, folder)) return [];
  const walk = (directory: string): string[] => readdirSync(join(project, directory), { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith(".")) return [];
    const file = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`${file}: conformance inputs cannot be symbolic links`);
    if (entry.isDirectory()) return walk(file);
    return entry.isFile() ? [file] : [];
  });
  return walk(folder).sort();
}

function projectConformance(project: string, module?: string): Set<string> {
  const files = conformanceTrees.flatMap(folder => conformanceFiles(root, folder));
  const selected = module === undefined ? files : files.filter(file => {
    const [group, name, subfile] = file.split("/").slice(1);
    if (group === "drivers") return subfile !== undefined || name === `${module}.ts`;
    if (group === "traces") return subfile === undefined && name.endsWith(".jsonl") && name.split(".")[0] === module;
    return name === module;
  });
  if (!selected.length) return new Set();
  for (const file of selected) {
    const destination = join(project, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, file), destination);
  }

  // Vibestack starts each driver in a Node child of this projection. Its loader resolves here.
  symlinkSync(join(toolkit, "node_modules"), join(project, "node_modules"), "junction");
  if (module === undefined) {
    const packageFile = join(project, "package.json");
    const manifest = JSON.parse(readFileSync(packageFile, "utf8"));
    // Drivers run in the traces stage. Preserve the existing application test entry points.
    manifest.scripts = { test: "vitest run --passWithNoTests" };
    writeFileSync(packageFile, `${JSON.stringify(manifest)}\n`);
    const drivers = selected.filter(file => /^test\/drivers\/\w+\.ts$/.test(file));
    if (drivers.length) {
      const tsconfigFile = join(project, "tsconfig.json");
      const tsconfig = JSON.parse(readFileSync(tsconfigFile, "utf8"));
      tsconfig.files = drivers;
      // The Node conformance runner uses Array.toSpliced while Network builds target ES2022.
      tsconfig.compilerOptions.target = "ES2023";
      writeFileSync(tsconfigFile, `${JSON.stringify(tsconfig)}\n`);
    }
  }
  return new Set(selected.filter(file => file.startsWith(`${counterexamples}/`)));
}

function saveCounterexamples(project: string, previous: ReadonlySet<string>): void {
  for (const file of conformanceFiles(project, counterexamples)) {
    if (previous.has(file) || !/^test\/counterexamples\/[a-z]\w*\/[a-f0-9]{12}\.json$/.test(file)) continue;
    const folder = dirname(file);
    if (!isProjectDirectory(root, folder)) mkdirSync(join(root, folder), { recursive: true });
    const target = join(root, file);
    const publication = mkdtempSync(join(root, folder, ".publish-"));
    try {
      const complete = join(publication, "counterexample.json");
      copyFileSync(join(project, file), complete);
      // Link only the complete result, and leave an existing counterexample in place.
      try { linkSync(complete, target); } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        continue;
      }
      console.error(`Saved conformance counterexample in ${file}`);
    } finally {
      rmSync(publication, { recursive: true, force: true });
    }
  }
}

async function checkConformance(project: string, module: string, nightly: boolean): Promise<number> {
  const { conformance } = await import("../tools/vibestack/vibestack/conform.ts");
  const { show, readSpecs, generated, typecheckAll } = await import("../tools/vibestack/vibestack/pipeline.ts");
  const { simulation } = await import("../tools/vibestack/vibestack/simulate.ts");
  const { profile } = await import("../tools/vibestack/vibestack/testing/profile.ts");
  const specs = readSpecs(project);
  const byName = new Map(specs.map(spec => [spec.name, spec]));
  const spec = byName.get(module);
  if (!spec) throw new Error(`No spec module named ${module}`);
  if (!existsSync(join(project, `test/drivers/${module}.ts`))
      && !conformanceFiles(project, "test/traces").some(file => file.endsWith(".jsonl"))) {
    throw new Error(`No conformance driver or recorded trace for ${module}`);
  }

  const names = new Set<string>();
  const add = (name: string) => {
    if (names.has(name)) return;
    names.add(name);
    byName.get(name)!.imports.forEach(add);
  };
  add(module);
  const selected = specs.filter(input => names.has(input.name));
  const memory = { root: project, fresh: nightly, used: new Set<string>() };
  const typed = typecheckAll(memory, selected);
  const models = new Map<string, Model>();
  try {
    for (const input of selected) generated(project, input, await typed.get(input.name), models);
  } finally {
    await Promise.allSettled(typed.values());
  }
  const model = models.get(module)!;
  if (!model.stateType || !model.transitions.length) throw new Error(`${spec.file}: conformance requires a state machine`);
  const domain = await import(pathToFileURL(join(project, "gen", `${module}.ts`)).href);
  const mode = nightly ? "nightly" : "normal";
  const { said, tested } = await simulation(memory, spec, selected, model, domain, profile(mode).seed);
  for (const result of said) console.log(show(result));
  if (!tested || said.some(result => !result.ok)) return 1;
  const results = await conformance(project, new Map([[module, { model, domain, found: tested }]]), {},
    async (_fingerprint, run) => run(), new Map(), mode);
  for (const [ok, stage, summary, detail = "", where] of results) console.log(show({ ok, stage, summary, detail, where }));
  return results.length && results.every(([ok]) => ok) ? 0 : 1;
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

async function checkBrowser(nightly: boolean): Promise<number> {
  const { explore } = await import("../tools/vibestack/vibestack/explore.ts");
  const { show } = await import("../tools/vibestack/vibestack/pipeline.ts");
  const project = mkdtempSync(join(tmpdir(), "thenetwork-browser-"));
  const saved = "test/__traces__/bombadil";
  const retained = join(root, saved);
  const projected = join(project, saved);
  try {
    const packageManager = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).packageManager;
    writeFileSync(join(project, "package.json"), JSON.stringify({
      name: "thenetwork-browser", private: true, type: "module", packageManager,
      scripts: { start: "node --import tsx start-browser.mjs" },
    }));
    writeFileSync(join(project, "tsconfig.json"), JSON.stringify({ extends: join(root, "tsconfig.json") }));
    const fixture = pathToFileURL(join(root, "test/fixtures/browserSignup.ts")).href;
    writeFileSync(join(project, "start-browser.mjs"), `import ${JSON.stringify(fixture)};\n`);
    // The explorer discovers the site's HTML shell. The fixture builds and serves the Peon join page.
    copyFileSync(join(root, "apps/site/index.html"), join(project, "index.html"));
    mkdirSync(join(project, "test"));
    copyFileSync(join(root, "test/bombadil.ts"), join(project, "test/bombadil.ts"));
    mkdirSync(join(project, "node_modules/@antithesishq"), { recursive: true });
    symlinkSync(join(root, "node_modules/tsx"), join(project, "node_modules/tsx"), "junction");
    symlinkSync(join(toolkit, "node_modules/@antithesishq/bombadil"), join(project, "node_modules/@antithesishq/bombadil"), "junction");
    if (existsSync(retained)) cpSync(retained, projected, { recursive: true });
    // The checked page uses source outside the projection, so do not cache a pass.
    const results = await explore(project, async (_fingerprint, run) => run(), nightly ? "nightly" : "normal", root);
    for (const [ok, stage, summary, detail = "", where] of results) console.log(show({ ok, stage, summary, detail, where }));
    rmSync(retained, { recursive: true, force: true });
    if (existsSync(projected)) cpSync(projected, retained, { recursive: true });
    return results.length && results.every(([ok]) => ok) ? 0 : 1;
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

async function main([command, ...args]: string[]) {
  const patterns: Record<string, string[][]> = {
    gen: [[]],
    check: [[], ["--json"], ["--nightly"], ["--json", "--nightly"], ["--nightly", "--json"]],
    conformance: [["*"], ["*", "--nightly"]],
    explore: [[], ["--nightly"]],
    accept: [[], ["unproved"]],
    new: [[], ["*"]],
    studio: [[], ["--port", "*"]],
    watch: [[]],
  };
  const valid = Object.hasOwn(patterns, command) && patterns[command].some((pattern) =>
    args.length === pattern.length && pattern.every((part, index) => part === "*" || part === args[index]));
  if (!valid) throw new Error(`Unsupported Vibestack command or arguments: ${[command, ...args].join(" ")}`);
  if (command === "explore") return await checkBrowser(args[0] === "--nightly");
  const module = command === "conformance" ? args[0] : undefined;
  if (module !== undefined && !/^[a-z]\w*$/.test(module)) throw new Error(`Invalid Vibestack module name: ${module}`);
  const files = formalFiles();
  const studio = command === "studio";
  if (studio && !existsSync(join(toolkit, "vibestack/studio/gen/index.ts"))) {
    const generated = await runSpec(join(toolkit, "vibestack/studio"), ["gen"]);
    if (generated !== 0) return generated;
  }
  const parent = studio ? join(root, "runs/vibestack") : tmpdir();
  mkdirSync(parent, { recursive: true });
  const project = mkdtempSync(join(parent, "thenetwork-vibestack-"));
  let earlierCounterexamples: Set<string> | undefined;
  try {
    prepareProject(project, files, !["gen", "new", "conformance"].includes(command));
    if (["check", "accept", "conformance"].includes(command)) earlierCounterexamples = projectConformance(project, module);
    if (module !== undefined) return await checkConformance(project, module, args[1] === "--nightly");
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
    if (earlierCounterexamples) {
      try {
        saveCounterexamples(project, earlierCounterexamples);
      } catch (error) {
        throw new Error(`Could not save conformance counterexamples. The copy remains in ${project}.`, { cause: error });
      }
    }
    if (!studio) rmSync(project, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    process.env.THENETWORK_VIBESTACK_REPO = root;
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
