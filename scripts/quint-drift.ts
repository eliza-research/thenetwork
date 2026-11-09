// The Quint drift check (AGENTS.md "Formal modeling requirement", quint/README.md "Drift").
// A Quint model is only useful while it says what the code does. docs/formal-coverage.md maps each
// source file to its Quint models. quint/drift.json keeps, for each model, a hash of the model and of
// each file that the ledger maps to it, as they were when a person or an agent last compared the model
// with the code. When one of those files changes, the formal block of `bun run sim` fails for that model
// until someone compares the model with the code again, fixes the model or the code, and records it:
//   bun run quint:drift                           # list the models whose code or model changed since the last comparison
//   bun run quint:drift --stamp quint/relay.qnt   # record a comparison of one model (repeatable)
//   bun run quint:drift --stamp quint/relay.qnt --drift "text"   # record the known drift that is not fixed yet (replaces the list)
//   bun run quint:drift --stamp quint/relay.qnt --clear-drift     # the known drift is fixed: empty the list
// A stamp without --drift or --clear-drift keeps the model's known drift.
// A stamp is a claim that the comparison was done. Do not stamp a model you did not compare.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { coverageRows } from "./sim/formal.ts";

const ROOT = join(import.meta.dir, "..");
export const DRIFT_FILE = join(ROOT, "quint", "drift.json");

export interface DriftEntry { files: Record<string, string>; drift?: string[] }
export type DriftLedger = Record<string, DriftEntry>;

const hash = (path: string) => createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex").slice(0, 16);

/** The files of each model: the model itself and every "covered" ledger row that names it. */
export function modelFiles(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of coverageRows()) {
    if (r.verdict !== "covered") continue;
    for (const m of r.quint.replace(/\[[^\]]*\]|\([^)]*\)/g, "").split(",").map(s => s.trim())) {
      if (!/^[a-z_]+$/.test(m) || m === "none") continue;
      if (!out.has(m)) out.set(m, [`quint/${m}.qnt`]);
      out.get(m)!.push(r.file);
    }
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}

export function readDrift(): DriftLedger {
  return existsSync(DRIFT_FILE) ? JSON.parse(readFileSync(DRIFT_FILE, "utf8")) as DriftLedger : {};
}

/** For each model: the files that are new, changed or no longer mapped since its last comparison. Empty when none. */
export function staleModels(ledger = readDrift()): Record<string, string[]> {
  const stale: Record<string, string[]> = {};
  for (const [model, files] of modelFiles()) {
    const seen = ledger[model]?.files ?? {};
    const changed = files.filter(f => !existsSync(join(ROOT, f)) || seen[f] !== hash(f));
    const dropped = Object.keys(seen).filter(f => !files.includes(f));
    if (!ledger[model]) stale[model] = ["never compared"];
    else if (changed.length || dropped.length) stale[model] = [...changed, ...dropped.map(f => `${f} (no longer mapped)`)];
  }
  for (const model of Object.keys(ledger)) if (!modelFiles().has(model)) stale[model] = ["model is not in the ledger"];
  return stale;
}

function stamp(models: string[], drift: string[], clear: boolean): void {
  const ledger = readDrift();
  const files = modelFiles();
  for (const m of models) {
    const list = files.get(m);
    if (!list) throw new Error(`${m}: no ledger row names this model (docs/formal-coverage.md)`);
    const keep = drift.length ? drift : clear ? [] : ledger[m]?.drift ?? [];
    ledger[m] = { files: Object.fromEntries(list.map(f => [f, hash(f)])), ...(keep.length ? { drift: keep } : {}) };
  }
  const sorted = Object.fromEntries(Object.entries(ledger).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(DRIFT_FILE, JSON.stringify(sorted, null, 2) + "\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const models: string[] = [];
  const drift: string[] = [];
  let clear = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--stamp") models.push(basename(args[++i] ?? "", ".qnt"));
    else if (args[i] === "--drift") drift.push(args[++i] ?? "");
    else if (args[i] === "--clear-drift") clear = true;
    else throw new Error(`unknown argument ${args[i]}`);
  }
  if (models.length) stamp(models, drift, clear);
  const stale = staleModels();
  for (const [m, files] of Object.entries(stale)) console.log(`${m}: compare quint/${m}.qnt with the code again: ${files.join(", ")}`);
  for (const [m, e] of Object.entries(readDrift())) for (const d of e.drift ?? []) console.log(`${m}: known drift: ${d}`);
  if (!models.length && Object.keys(stale).length) process.exit(1);
}
