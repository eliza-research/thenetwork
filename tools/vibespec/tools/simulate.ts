import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { Model } from "./gen.ts";
import { SENDER } from "./gen/classify.ts";
import { run } from "./prove.ts";
import { digest } from "./util.ts";

export const SAMPLES = 10000;
export const WITNESS_SAMPLES = 20 * SAMPLES;
export const COMPARED_SAMPLES = 2000;
export const REPLAYED = 200;
export const STEPS = 20; // events per trace
/** Trace lengths a search for something reachable tries in turn, the longer ones only if the shorter found nothing. */
export const DEPTHS = [STEPS, 2 * STEPS, 5 * STEPS];

export interface Step {
  event?: { type: string };
  law?: { name: string; args: Record<string, unknown> };
  /** A definition the simulator evaluated: what was picked for its sampled parameters, and what Quint got. */
  evaluated?: { name: string; picks: Record<string, unknown>; result: unknown };
  state?: unknown;
  lawsHold?: boolean;
}

function readTrace(file: string, model: Model): Step[] {
  return JSON.parse(fs.readFileSync(file, "utf8")).states.map((st: any): Step => {
    // Values are decoded by their type, and sets put in a fixed order, so that they compare equal to TypeScript's.
    const read = (type: any, itf: any) => model.canon(type, model.decode(type, itf));
    const picked = (ps: { name: string; type: any }[]) => Object.fromEntries(ps.map((p) => [p.name, read(p.type, st["mbt::nondetPicks"][p.name].value)]));
    const taken: string = st["mbt::actionTaken"];
    const t = model.transitions.find((t) => t.name === taken);
    const v = model.evals.find((v) => `eval_${v.name}` === taken);
    const l = model.laws.find((l) => l.name === taken);
    return {
      event: t && { type: t.name, ...picked(t.params) },
      evaluated: v && { name: v.name, picks: picked(v.params.filter((p) => p.from === "pick")), result: read(v.result, st.out.value) },
      law: l && { name: l.name, args: picked(l.params) },
      state: model.stateType ? read(model.stateType, st.state) : undefined,
      lawsHold: st.lawsHold,
    };
  });
}

/**
 * The simulator's seed: SPEC_SEED if it is set, otherwise one derived from what is simulated, so that the same
 * harness always gives the same traces and a counterexample can be had again.
 */
const seedFor = (...what: string[]) => process.env.SPEC_SEED?.trim() || String(parseInt(digest(what.join("\0")).slice(0, 12), 16));

/**
 * Quint installs its evaluator the first time it simulates, and runs started together would race to. Until it is
 * installed, the first run in this process goes alone and the others wait for it; once it is, nothing waits.
 */
let evaluatorInstalled = false;
let firstRun: Promise<void> | undefined;
function evaluatorIsInstalled(root: string): boolean {
  if (evaluatorInstalled) return true;
  try {
    for (const from of [import.meta.url, pathToFileURL(path.join(root, "package.json")).href]) {
      let manager: string;
      try { manager = createRequire(from).resolve("@informalsystems/quint/dist/src/rust/binaryManager.js"); } catch { continue; }
      const version = fs.readFileSync(manager, "utf8").match(/QUINT_EVALUATOR_VERSION = '([^']+)'/)?.[1];
      const home = process.env.QUINT_HOME ?? path.join(os.homedir(), ".quint");
      const exe = process.platform === "win32" ? "quint_evaluator.exe" : "quint_evaluator";
      if (version && fs.existsSync(path.join(home, `rust-evaluator-${version}`, exe))) return (evaluatorInstalled = true);
    }
  } catch { /* not known to be installed */ }
  return false;
}
async function simulating<T>(root: string, go: () => Promise<T>): Promise<T> {
  if (evaluatorIsInstalled(root)) return go();
  if (firstRun) { await firstRun; return go(); }
  const run = go();
  firstRun = run.then(() => {}, () => {});
  return run;
}

/** Simulated traces per process, at least: below this, a run is not split, since each process costs about a second to start. */
const SHARD_SAMPLES = 1000;
const MAX_SHARDS = 4;

/**
 * Simulate the harness until `invariant` breaks; returns the traces Quint wrote, and the command that runs the same
 * simulation again. One run of Quint uses one core, so with `split` a large budget is split among up to four runs of a
 * single thread, each with a seed of its own; how it is split depends only on the budget, so the same harness always gives
 * the same traces. With SPEC_SEED set, nothing is split, and the seed is the one given. When a run breaks the
 * invariant, the command is the one for that run.
 */
export async function simulate(root: string, model: Model, invariant: string, traces: number, samples: number, step = "step", split = false, steps = STEPS): Promise<{ broken: boolean; traces: Step[][]; again: string }> {
  const dir = path.join(root, "gen/traces", `${model.name}.${invariant}.${step}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const shards = !split || process.env.SPEC_SEED?.trim() ? 1 : Math.max(1, Math.min(MAX_SHARDS, Math.floor(samples / SHARD_SAMPLES)));
  const runs = Array.from({ length: shards }, async (_, k) => {
    const out = shards === 1 ? dir : path.join(dir, String(k));
    fs.mkdirSync(out, { recursive: true });
    const seed = shards === 1 ? seedFor(model.harness, invariant, step, String(samples), String(steps)) : seedFor(model.harness, invariant, step, String(samples), String(steps), `${k} of ${shards}`);
    const args = ["run", `gen/${model.name}.run.qnt`, "--main", `${model.name}_run`, "--step", step, "--invariant", invariant,
      "--max-samples", String(Math.ceil(samples / shards)), "--max-steps", String(steps), "--mbt", "--seed", seed, ...(shards === 1 ? [] : ["--n-threads", "1"])];
    const r = await simulating(root, () => run("quint", [...args, "--n-traces", String(Math.ceil(traces / shards)), "--out-itf", path.join(out, "{seq}.itf.json")], root));
    const broken = r.out.includes("[violation]");
    // In the order Quint wrote them, so that the same simulation always gives the traces in the same order.
    const files = fs.readdirSync(out).filter((f) => f.endsWith(".itf.json")).sort((x, y) => parseInt(x, 10) - parseInt(y, 10) || x.localeCompare(y));
    const again = `seed ${seed}; to simulate again: npx quint ${args.join(" ")}`;
    // Anything other than "held" or "violated", each with a trace, is Quint failing to run.
    if ((!r.ok && !broken) || !files.length) throw new Error(`quint run did not complete (${again}):\n${r.out.trim()}`);
    return { broken, traces: files.map((f) => readTrace(path.join(out, f), model)), again };
  });
  // Every run finishes before anything is said, so that none is left writing into gen/.
  const settled = await Promise.allSettled(runs);
  const failure = settled.find((r) => r.status === "rejected");
  if (failure) throw failure.reason;
  const done = settled.map((r) => (r as PromiseFulfilledResult<Awaited<(typeof runs)[number]>>).value);
  return { broken: done.some((d) => d.broken), traces: done.flatMap((d) => d.traces), again: (done.find((d) => d.broken) ?? done[0]).again };
}

/**
 * Look for a state that breaks `invariant`, which is how a goal is shown reachable: in longer traces while none is
 * found, fewer of them as they lengthen, so each depth costs about as many events as the first.
 */
export async function search(root: string, model: Model, invariant: string, step = "step", depths = DEPTHS): ReturnType<typeof simulate> {
  let run!: Awaited<ReturnType<typeof simulate>>;
  for (const steps of depths) if ((run = await simulate(root, model, invariant, 1, Math.ceil(WITNESS_SAMPLES * STEPS / steps), step, false, steps)).broken) break;
  return run;
}
export const SEARCHED = () => `${WITNESS_SAMPLES} traces of ${STEPS} events and longer ones up to ${DEPTHS.at(-1)}`;

/**
 * Replay one Quint trace through the TypeScript domain; throws at the first difference. With the model, sets are
 * compared whatever their order and every definition the simulator evaluated is evaluated here too.
 */
export function replay(domain: any, trace: Step[], model?: Model) {
  const differ = (what: string) => new Error(`TypeScript and Quint disagree ${what}`);
  const canon = (type: any, value: unknown) => (model ? model.canon(type, value) : value);
  let s = domain.initial;
  let before = s;
  for (const { event, evaluated, law, state, lawsHold } of trace) {
    if (event) {
      // Who sent the event travels beside it, as the program passes it (gen/typescript.ts).
      const { [SENDER]: by, ...carried } = event as Record<string, unknown>;
      if (!domain.enabled(s, carried, by)) throw differ(`on whether ${JSON.stringify(event)} is allowed in ${JSON.stringify(s)}`);
      [before, s] = [s, domain.step(s, carried, by)];
    } else if (evaluated && model) {
      const v = model.evals.find((v) => v.name === evaluated.name)!;
      const args = v.params.map((p) => (p.from === "state" ? s : p.from === "prev" ? before : evaluated.picks[p.name]));
      const got = canon(v.result, domain[v.name](...args));
      if (!isDeepStrictEqual(got, evaluated.result)) throw differ(`on ${v.name}(${args.map((a) => JSON.stringify(a)).join(", ")}): TypeScript gives ${JSON.stringify(got)}, Quint gives ${JSON.stringify(evaluated.result)}`);
    } else if (law && domain[law.name](...Object.values(law.args)) !== lawsHold)
      throw differ(`on ${law.name}${JSON.stringify(law.args)}: Quint says ${lawsHold}`);
    if (state !== undefined && !isDeepStrictEqual(canon(model?.stateType, s), state)) throw differ(`after ${JSON.stringify(event ?? "init")}: TypeScript reached ${JSON.stringify(s)}, Quint reached ${JSON.stringify(state)}`);
  }
}

/** The first rule a trace breaks, in the spec's words, and how many steps it took; undefined if it breaks none. */
export function firstBreak(domain: any, model: Model, trace: Step[], cite: (def: string) => string): { why: string; steps: number } | undefined {
  let before: unknown;
  for (const [i, { event, law, evaluated, state, lawsHold }] of trace.entries()) {
    const found = (why: string) => ({ why, steps: i + 1 });
    if (law && lawsHold === false) return found(`the law ${cite(law.name)} is false for ${JSON.stringify(law.args)}`);
    if (evaluated?.result === false && lawsHold === false && model.laws.some((l) => l.name === evaluated.name))
      return found(`the law ${cite(evaluated.name)} is false in state ${JSON.stringify(state)} with sampled parameters ${JSON.stringify(evaluated.picks)}`);
    const always = model.always.filter((a) => !domain[a](state)).map(cite);
    if (always.length) return found(`a reachable state breaks ${always.join(", ")}`);
    const steps = event ? model.steps.filter((r) => !domain[r.name](before, ...(r.via ? [event.type] : []), state)).map((r) => cite(r.name)) : [];
    if (steps.length) return found(`a step breaks ${steps.join(", ")}`);
    before = state;
  }
}

/**
 * What differs between two values, as `path = value` for each part that changed. Records and maps are compared
 * entry by entry; a variant whose tag changed, a list or a scalar is shown whole.
 */
const changes = (a: any, b: any, at = ""): string[] =>
  isDeepStrictEqual(a, b) ? []
  : b === undefined ? [`${at} removed`]
  : [a, b].every((x) => x && typeof x === "object" && !Array.isArray(x)) && a.tag === b.tag
    ? [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => changes(a[k], b[k], at ? `${at}.${k}` : k))
    : [`${at || "state"} = ${JSON.stringify(b)}`];

/** A trace as the initial state, then each event with only what it changed. */
export const showTrace = (trace: Step[]) =>
  trace.filter((s, i) => i === 0 || s.event || s.lawsHold === false).map(({ event, law, evaluated, state, lawsHold }, i, shown) => {
    const { type, ...args } = event ?? { type: "" };
    const what = event ? type + (Object.keys(args).length ? JSON.stringify(args) : "") : law ? `${law.name}${JSON.stringify(law.args)}` : evaluated ? `${evaluated.name}${JSON.stringify(evaluated.picks)}` : "initial";
    const result = (law || evaluated) && !event ? String(lawsHold) : i ? changes(shown[i - 1].state, state).join(", ") || "no change" : JSON.stringify(state);
    return `      ${what.padEnd(30)} -> ${result}`;
  }).join("\n");
