import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sha } from "./util.ts";

/**
 * What a remembered result of one stage was produced by: a different Quint, Node or version of these tools must not
 * reuse a model or a simulation, and a proof also depends on LemmaScript, Dafny and the prover's own code. Each stage
 * has its own, so that a change that matters only to the proof (prove.ts, Dafny, LemmaScript) does not simulate
 * everything again. The proof library is part of the key of each unit that has a proof file, the only ones it is
 * offered to.
 */
const toolchains = new Map<string, Promise<string>>();
function toolchainId(stage: "model" | "simulate" | "prove"): Promise<string> {
  let id = toolchains.get(stage);
  if (!id) toolchains.set(stage, (id = (async () => {
    const version = (dep: string) => {
      for (let dir = import.meta.dirname; dir !== path.dirname(dir); dir = path.dirname(dir)) {
        const file = path.join(dir, "node_modules", dep, "package.json");
        if (fs.existsSync(file)) return `${dep}@${JSON.parse(fs.readFileSync(file, "utf8")).version}`;
      }
      return dep;
    };
    // Every file of the tools themselves, as source or as built; the self-test and its fixtures are not part of them.
    // Only the prover's own file is left out of what a model or simulation depends on: anything else may be used by both.
    const ext = path.extname(import.meta.filename);
    const own = (f: string) => f.endsWith(ext) && !f.startsWith("selftest") && !f.startsWith("fixtures") && (stage === "prove" || f !== `prove${ext}`);
    const tools = (fs.readdirSync(import.meta.dirname, { recursive: true }) as string[]).filter(own).sort().map((f) => `${f}\0${fs.readFileSync(path.join(import.meta.dirname, f), "utf8")}`);
    const parts = [stage, version("@informalsystems/quint"), `node@${process.versions.node}`, sha(...tools).slice(0, 12)];
    if (stage === "prove") parts.push(version("lemmascript"), `dafny@${(await dafnyVersion()).version ?? "none"}`);
    return parts.join(" ");
  })()));
  return id;
}

/** The version of Dafny on the PATH, read once and without blocking, or why it could not be read. */
let dafny: Promise<{ version?: string; problem?: string }> | undefined;
export function dafnyVersion(): Promise<{ version?: string; problem?: string }> {
  return (dafny ??= new Promise((resolve) => {
    execFile("dafny", ["--version"], { encoding: "utf8", timeout: 60_000 }, (error, stdout, stderr) => {
      const version = !error ? (stdout ?? "").match(/\d+\.\d+\.\d+/)?.[0] : undefined;
      const problem = !version ? `Dafny could not be run (${(error && !stdout && !stderr ? error.message : undefined) ?? (`${stdout ?? ""}${stderr ?? ""}`.trim().split("\n")[0] || error?.message || "it printed no version")})`
        : !version.startsWith("4.11.") ? `this is Dafny ${version}, and LemmaScript targets Dafny 4.11.x` : undefined;
      resolve({ version, problem: problem && `${problem}: the proof stage needs Dafny 4.11 on the PATH (see README, "Run it")` });
    });
  }));
}

/** The remembered results of one check: whether it may read them, and every entry it read or wrote. */
export interface Memory { root: string; fresh: boolean; used: Set<string> }
/** An entry of `.spec-cache`. A simulation's entry names its budget, so that a check with another budget leaves it alone. */
interface Entry { name: string; file: string }
const cacheDir = (root: string) => path.join(root, ".spec-cache");
export async function entry(root: string, stage: "model" | "simulate" | "prove", key: string[], profile = ""): Promise<Entry> {
  const name = `${stage}-${profile ? `${profile}-` : ""}${sha(await toolchainId(stage), ...key).slice(0, 24)}.json`;
  return { name, file: path.join(cacheDir(root), name) };
}
/** What an entry holds, or undefined. An entry that cannot be read, cut short by a kill or a full disk, is deleted and is a miss. */
export function recall<T>(memory: Memory, { name, file }: Entry): T | undefined {
  memory.used.add(name);
  if (memory.fresh || process.env.SPEC_NO_CACHE) return undefined;
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
  try {
    const value = JSON.parse(text) as T;
    // Entries are deleted when unused for a while (see collectGarbage), so a hit says the entry is in use.
    try { const now = new Date(); fs.utimesSync(file, now, now); } catch { /* still a hit */ }
    return value;
  } catch {
    fs.rmSync(file, { force: true });
    return undefined;
  }
}
/** Write an entry whole or not at all: to a file of its own, then renamed into place. */
export function store(memory: Memory, { name, file }: Entry, value: unknown) {
  memory.used.add(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(value));
    fs.renameSync(temporary, file);
  } catch (e) {
    fs.rmSync(temporary, { force: true });
    throw e;
  }
}

/**
 * `produce()`, or what it returned the last time for the same key, if that was
 * worth keeping. This is what keeps a check proportional to what changed. The
 * cache is a convenience: `accept` never reads it, nor does a check with
 * SPEC_NO_CACHE set. Every entry read or written is recorded as used, so that a
 * full check can delete the ones no longer used.
 */
export async function remembered<T>(memory: Memory, at: Entry | Promise<Entry>, produce: () => T | Promise<T>, keep: (result: T) => boolean): Promise<T> {
  const e = await at;
  const known = recall<T>(memory, e);
  if (known !== undefined) return known;
  const result = await produce();
  if (keep(result)) store(memory, e, result);
  return result;
}

/** Drop entries no stage of this completed check used. */
export function collectGarbage(memory: Memory) {
  for (const name of fs.readdirSync(cacheDir(memory.root)))
    if (name !== "lock" && !memory.used.has(name)) fs.rmSync(path.join(cacheDir(memory.root), name), { recursive: true, force: true });
}
