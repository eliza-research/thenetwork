#!/usr/bin/env node
// The spec pipeline and command line. Parsing, review, generation, simulation and proof each have one implementation.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Model } from "./gen.ts";
import { LIB_FILE, prove, run, type Proof } from "./prove.ts";
import { readSpecs, badSpecName, type Spec } from "./parse.ts";
import { contracts, pending, pendingContracts, acceptReviews, acceptContracts, moved, showPending, ledgerFile, readLedger, writeLedger, type Pending, type Accepted } from "./review.ts";
import { entry, remembered, collectGarbage, dafnyVersion, type Memory } from "./cache.ts";
import { gen, generated, typecheckAll, proofUnits, strayProofFiles } from "./units.ts";
import { SAMPLES, WITNESS_SAMPLES, COMPARED_SAMPLES, REPLAYED, STEPS, DEPTHS, SEARCHED, simulate, search, firstBreak, showTrace, replay, type Step } from "./simulate.ts";
import { sha, indent, tests, readSrc, type SrcFile } from "./util.ts";

export { readSpecs, badSpecName, parseSpec, scanSpec, expandListHelpers, type Spec, type Rule, type Story } from "./parse.ts";
export { pending, pendingContracts, acceptReviews, acceptContracts, fingerprint, dependencies, type Pending } from "./review.ts";
export { gen, checkVerifiedSource } from "./units.ts";
export { replay, type Step } from "./simulate.ts";
export { danglingCitations } from "./util.ts";

export interface Result { ok: boolean; stage: "model" | "always" | "sometimes" | "replay" | "types" | "proof" | "tests" | "review" | "skipped"; summary: string; detail: string; where?: string }
export const show = ({ ok, stage, summary, detail }: Result) => `${stage === "skipped" ? "-" : ok ? "✓" : "✗"} ${stage.padEnd(9)} ${summary}${detail ? "\n" + detail.trimEnd() : ""}`;

/** The one most useful thing to do after a check, given what it found. */
export function nextStep(results: Result[]): string {
  const first = results.find((r) => !r.ok && r.stage !== "review");
  const about = first?.where ? ` (${first.where})` : "";
  if (first) {
    const what: Record<string, string> = {
      model: "fix the spec where the model stage points",
      always: "read the trace: fix the model, or add the rule that forbids it",
      sometimes: "make the goal reachable: loosen the guard, add the transition, or define <param>Values",
      replay: "the generated TypeScript disagrees with Quint, a bug in the tools: report it",
      types: "update src/ and test/ to the generated contract",
      proof: "prove what is listed in the unit's proof file, or fix what Dafny could not check",
      tests: "fix the application or its tests",
    };
    return `${first.stage}${about} is the first ✗: ${what[first.stage]}, then run \`npm run check\` again`;
  }
  const reviews = results.filter((r) => !r.ok);
  if (!reviews.length) return "all green";
  if (reviews.some((r) => /story has no rules|not formalized/.test(r.detail))) return "write the rules and Quint the review items ask for, then run `npm run check` again";
  return "read each review item above; when prose and Quint agree, the user runs `npm run accept`";
}

/** Take the project's lock for one check or accept at a time; returns what releases it. A lock left by a process that has ended is taken over. */
function lockProject(root: string): () => void {
  const file = path.join(root, ".spec-cache", "lock");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const alive = (pid: number) => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return (e as NodeJS.ErrnoException).code === "EPERM";
    }
  };
  for (let attempt = 0; ; attempt++) {
    try {
      fs.writeFileSync(file, `${process.pid}\n`, { flag: "wx" });
      return () => fs.rmSync(file, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    let holder = NaN;
    try { holder = parseInt(fs.readFileSync(file, "utf8"), 10); } catch { /* removed in the meantime */ }
    if (alive(holder) || attempt) throw new Error(`another check or accept is running in this project (process ${holder}); wait for it to finish. If no such process is running, delete ${path.relative(root, file)}`);
    fs.rmSync(file, { force: true });
  }
}

/**
 * Run every check, cheapest first, and return what each found and the next
 * thing to do; `log` hears of each result as it arrives. Stages after a broken
 * model are skipped, and said to be, because their failures would only restate
 * the first one. `accept` is "reviews" to record reconciled stories, rules and
 * contracts, or "unproved" to record the obligations that are simulated but not
 * proved; either way nothing remembered from an earlier run is used. Only one
 * check or accept runs in a project at a time; another is refused.
 */
export async function check(root: string, accept: false | "reviews" | "unproved" = false, log: (result: Result) => void = () => {}): Promise<{ ok: boolean; results: Result[]; next: string }> {
  if (process.env.SPEC_TESTS) throw new Error("a test script cannot run spec check or accept: the check already runs the tests");
  const release = lockProject(root);
  try {
    const results: Result[] = [];
    const ok = await checkLocked(root, accept, (r) => { results.push(r); log(r); });
    return { ok, results, next: nextStep(results) };
  } finally {
    release();
  }
}

async function checkLocked(root: string, accept: false | "reviews" | "unproved", log: (result: Result) => void): Promise<boolean> {
  let allOk = true;
  const report = (ok: boolean, stage: Result["stage"], summary: string, detail = "", where?: string, keepDetail = false) => {
    allOk &&= ok;
    log({ ok, stage, summary, detail: ok && !keepDetail ? "" : detail, ...(where ? { where } : {}) });
  };
  const skip = (stages: string, why: string) => report(true, "skipped", `${stages}: ${why}`);
  /** The cache entries this run read or wrote; after a run in which every stage ran, the others are deleted. */
  const memory: Memory = { root, fresh: !!accept, used: new Set() };
  let specs: Spec[];
  let srcFiles: SrcFile[];
  const proofInputs = () => strayProofFiles(root, []).sort().map((file) => [file, fs.readFileSync(path.join(root, file), "utf8")]);
  let proofFiles: string[][];
  let pendingLedger: { ledger: Record<string, Accepted>; accepted: Record<string, Accepted | undefined> } | undefined;
  try {
    srcFiles = readSrc(root);
    proofFiles = proofInputs();
    specs = readSpecs(root);
  } catch (e) {
    report(false, "model", (e as Error).message);
    return false;
  }
  fs.rmSync(path.join(root, "gen"), { recursive: true, force: true }); // nothing stale survives a rename
  const valid: Spec[] = [];
  const models = new Map<string, Model>();
  const typed = typecheckAll(memory, specs);
  // Node caches imported modules by path, so each run loads its generated code from a directory of its own.
  const loaded = path.join(root, "gen", `run-${Date.now()}`);

  for (const spec of specs) {
    const cite = (def: string) => {
      const rule = spec.rules.find((r) => r.defs.includes(def));
      return rule ? `"${rule.key}" (${spec.file}:${rule.line})` : def;
    };
    let model: Model;
    let domain: any;
    try {
      const missing = spec.imports.find((i) => !models.has(i));
      if (missing) throw new Error(`it imports ${missing}, which is not a valid model`);
      model = generated(root, spec, await typed.get(spec.name)!, models);
      fs.mkdirSync(loaded, { recursive: true });
      fs.copyFileSync(path.join(root, `gen/${spec.name}.ts`), path.join(loaded, `${spec.name}.ts`));
      domain = await import(pathToFileURL(path.join(loaded, `${spec.name}.ts`)).href);
    } catch (e) {
      report(false, "model", `${spec.file} is not a valid model`, indent((e as Error).message.trim()), spec.file);
      skip(`always, sometimes and replay of ${spec.file}`, "it is not a valid model");
      continue;
    }
    valid.push(spec);
    const parts = [[model.transitions.length, "transitions"], [model.always.length, "always"], [model.steps.length, "step"], [model.sometimes.length, "sometimes"], [model.laws.length, "laws"]];
    report(true, "model", `${spec.file}: ${parts.filter(([n]) => n).map((p) => p.join(" ")).join(", ") || "definitions only"}`, "", spec.file);
    if (!model.stateType && !model.laws.length && !model.evals.length) continue;

    // A spec whose model and harness are unchanged, and that passed, is not simulated again.
    const closure = (names: string[]): string => names.map((n) => { const dep = specs.find((x) => x.name === n)!; return closure(dep.imports) + dep.meaning; }).join("");
    const found = await remembered<Result[]>(memory, entry(root, "simulate", [closure(spec.imports), spec.meaning, model.harness, String([SAMPLES, WITNESS_SAMPLES, COMPARED_SAMPLES, REPLAYED, STEPS, ...DEPTHS]), process.env.SPEC_SEED ?? ""]), async () => {
      const said: Result[] = [];
      const say = (ok: boolean, stage: Result["stage"], summary: string, detail = "") => said.push({ ok, stage, summary, detail });
      try {
        type Run = Awaited<ReturnType<typeof simulate>>;
        /**
         * Report the shortest trace of these runs that breaks a rule, cut at the break, with the command that runs
         * the simulation it came from again; false if none breaks one.
         */
        const broke = (runs: Run[]): boolean => {
          const bad = runs.flatMap((run) => run.traces.flatMap((t) => { const b = firstBreak(domain, model, t, cite); return b ? [{ t: t.slice(0, b.steps), why: b.why, again: run.again }] : []; }))
            .sort((x, y) => x.t.length - y.t.length)[0];
          if (!bad) return false;
          const lastEvent = bad.t.findLast((s) => s.event)?.event?.type;
          const guard = model.transitions.find((t) => t.name === lastEvent)?.guard;
          // One repair is always available: refuse the event when its result would break the rule. A reason is better.
          const brokenRule = lastEvent ? model.always.find((a) => !domain[a](bad.t[bad.t.length - 1].state)) : undefined;
          const hint = lastEvent && !bad.why.startsWith("the law") ? `\n      the last event is ${cite(lastEvent)}${guard ? `; its guard ${guard} let it through` : "; it has no guard"}`
            + (brokenRule ? `\n      if no better reason can be found: refuse ${lastEvent} when its result would break ${brokenRule}` : "") : "";
          say(false, "always", `${bad.why}: fix the model, or add the rule that forbids this trace`, `${showTrace(bad.t)}${hint}\n      ${bad.again}`);
          return true;
        };
        // The first run goes alone: Quint installs its evaluator on first use, and runs started together would race to.
        // The rest are independent and overlap. The probe, in which the simulator also evaluates every definition it
        // can, supplies more traces to replay. Each witness search stops at its goal or at a broken rule, whichever
        // comes first (see the harness). All of them finish before anything is reported, failures included.
        const sim = await simulate(root, model, "inv", REPLAYED, SAMPLES, "step", true);
        const settled = await Promise.allSettled([
          simulate(root, model, "inv", REPLAYED, COMPARED_SAMPLES, "probe", true),
          ...model.sometimes.map((w) => search(root, model, `never_${w}`)),
        ]);
        const failure = settled.find((r) => r.status === "rejected");
        if (failure) throw failure.reason;
        const [probe, ...searches] = settled.map((r) => (r as PromiseFulfilledResult<Awaited<ReturnType<typeof simulate>>>).value);
        const witnesses = model.sometimes.map((w, i) => ({ w, run: searches[i] }));
        const runs = [sim, probe, ...searches.filter((run) => run.broken)];
        if (broke(runs)) return said;
        if (sim.broken || probe.broken) throw new Error(`the simulator reports a broken rule that no trace shows (${sim.again})`);
        const traces = runs.flatMap((run) => run.traces);
        // Each guard should allow its event in some reachable state and refuse it in another. One that never allows it
        // makes the event impossible, and every rule then holds of it trivially, so nothing else would notice: that
        // fails, as an unreached `sometimes` goal does. One that never refuses it may restate a rule, guard against
        // input from outside, or refuse only beyond the simulator's reach: that is reported, not failed.
        // The traces so far usually show both sides; the simulator searches only for what they do not, and each such
        // search also stops at a broken rule (see the harness), which is then reported as any other.
        const guarded = model.transitions.filter((t) => t.guard);
        const seen = new Map(guarded.map((t) => [t.guard!, { allows: false, refuses: false }]));
        for (const { event, evaluated } of traces.flat()) {
          const fired = event && guarded.find((g) => g.name === event.type);
          if (fired) seen.get(fired.guard!)!.allows = true;
          if (evaluated && seen.has(evaluated.name)) seen.get(evaluated.name)![evaluated.result ? "allows" : "refuses"] = true;
        }
        const neverAllowed: { t: (typeof guarded)[number]; again?: string }[] = [];
        const neverRefused: string[] = [];
        for (const t of guarded) {
          const g = t.guard!;
          // The harness has a witness invariant for every guard whose arguments the simulator can supply. Only a
          // guard that never allows its event fails the check, so only that search goes deeper.
          const searchable = model.evals.some((v) => v.name === g);
          for (const side of ["allows", "refuses"] as const) {
            if (seen.get(g)![side]) continue;
            const found = searchable ? await search(root, model, `never_${side}_${g}`, "probe", side === "allows" ? DEPTHS : [STEPS]) : undefined;
            if (found?.broken) {
              if (broke([found])) return said;
              seen.get(g)![side] = true;
              traces.push(...found.traces);
            } else if (side === "refuses") neverRefused.push(g);
            else neverAllowed.push({ t, again: found?.again });
          }
        }
        say(true, "always", `no rule broken in ${SAMPLES + COMPARED_SAMPLES} simulated traces`);
        for (const { w, run } of witnesses) {
          const reached = run.broken && run.traces.some((t) => domain[w](t.at(-1)?.state));
          say(reached, "sometimes", reached ? `${w} is reachable`
            : `${cite(w)} was not reached in ${SEARCHED()}: a guard is too strict, a transition is missing, or the goal needs values the simulator does not try`, reached ? "" : `      ${run.again}`);
        }
        for (const { t, again } of neverAllowed) {
          const causes = ["the guard is too strict", "a transition that leads to the states it needs is missing", `the event becomes possible only after more than ${DEPTHS.at(-1)} events`,
            ...(t.guardParams.length ? [`it needs values the simulator does not try (define ${t.guardParams.map((p) => `${p}Values`).join(" or ")})`] : [])];
          say(false, "sometimes", `${t.name} in ${cite(t.name)} never happened: its guard ${t.guard} refused it in every state reached${again ? ` in ${SEARCHED()}` : ""}, so every rule holds of it trivially. Either ${causes.slice(0, -1).join(", ")} or ${causes.at(-1)}`, again ? `      ${again}` : "");
        }
        if (guarded.some((t) => seen.get(t.guard!)!.allows))
          say(true, "sometimes", `${guarded.filter((t) => seen.get(t.guard!)!.allows).length} of ${guarded.length} guards allow their event in some reachable state`
            + (neverRefused.length ? `; never seen to refuse it within ${STEPS} events or for any value tried, so check that each restricts what its rule says: ${neverRefused.join(", ")}` : ", and refuse it in another"));
        for (const t of traces) replay(domain, t, model);
        const compared = new Set(traces.flatMap((t) => t.flatMap((s) => (s.evaluated ? [s.evaluated.name] : []))));
        const missed = [...model.evals.map((v) => v.name).filter((n) => !compared.has(n)), ...model.uncompared];
        say(true, "replay", `generated TypeScript agrees with Quint on ${traces.length} traces: every state${model.laws.length ? ", every law" : ""}, and ${compared.size} definitions evaluated on them`
          + (missed.length ? `; not compared on their own, because the simulator had no arguments for them: ${missed.join(", ")}` : ""));
      } catch (e) {
        const mismatch = (e as Error).message.startsWith("TypeScript and Quint disagree");
        say(false, mismatch ? "replay" : "always", mismatch ? "this is a bug in the generator (tools/gen.ts, tools/gen/), not in the spec" : "the simulator could not run", indent((e as Error).message));
      }
      return said;
    }, (said) => said.every((r) => r.ok));
    for (const r of found) report(r.ok, r.stage, r.summary, r.detail, spec.file);
    const ran = new Set(found.map((r) => r.stage));
    const notRun = (["sometimes", "replay"] as const).filter((s) => !ran.has(s) && (s !== "sometimes" || model.sometimes.length));
    if (notRun.length && found.some((r) => !r.ok)) skip(`${notRun.join(" and ")} of ${spec.file}`, "simulation stopped at the failure above");
  }

  const complete = allOk;
  if (!allOk) skip("types, proof and tests", "a stage above failed, and their failures would only restate it");
  if (allOk) {
    let proofsRan = false;
    /** The proof stage, run while the typecheck does; what it would report, in order. */
    async function provingAll(): Promise<Parameters<typeof report>[]> {
      const out: Parameters<typeof report>[] = [];
      const said = (...args: Parameters<typeof report>) => { out.push(args); };
    try {
      const dafnyProblem = (await dafnyVersion()).problem;
      if (dafnyProblem) throw new Error(dafnyProblem);
      const accepted = readLedger(root);
      const ledger: Record<string, Accepted> = {};
      let recordable = true;
      fs.rmSync(path.join(root, "gen/proof"), { recursive: true, force: true });
      const units = await proofUnits(root, [...models.values()], srcFiles);
      for (const f of strayProofFiles(root, units))
        said(false, "proof", `${f} belongs to no proof unit: spec/<name>.proof.dfy belongs to spec/<name>.md, and src/<path>.proof.dfy to src/<path>.ts if that file contains //@`, "", f);
      const lib = fs.readFileSync(LIB_FILE, "utf8");
      const proved = new Map<string, Proof>();
      // Units are proved at the same time, each as soon as the units it may take laws from are done; they are
      // reported in order.
      const running = new Map<string, Promise<Proof>>();
      const proofTexts = new Map<string, string | undefined>();
      for (const u of units) {
        const proofPath = path.join(root, u.proofFile);
        const proofText = fs.existsSync(proofPath) ? fs.readFileSync(proofPath, "utf8") : undefined;
        proofTexts.set(u.unit, proofText);
        running.set(u.unit, (async () => {
          if (proofText !== undefined) await Promise.allSettled(u.laws.map((l) => running.get(l.from)));
          // A law of an imported module is offered only if its own unit proved it, in this run.
          const laws = u.laws.filter(({ law, from }) => {
            const p = proved.get(from);
            return p && !p.errors.length && !p.unproved.some((x) => x.startsWith(`${law}: `));
          }).map((l) => l.fn);
          const offered = { proof: proofText === undefined ? undefined : { file: u.proofFile, text: proofText }, lib, laws };
          const proof = await remembered(memory, entry(root, "prove", [u.unit, u.meaning, proofText ?? "", proofText === undefined ? "" : lib, proofText === undefined ? "" : laws.join(" ")]), () => prove(root, u, offered), (p) => !p.errors.length);
          proved.set(u.unit, proof);
          return proof;
        })());
      }
      // Every unit finishes, whatever another one does, before anything is reported.
      const settledProofs = await Promise.allSettled(units.map((u) => running.get(u.unit)!));
      const thrown = settledProofs.find((r) => r.status === "rejected");
      if (thrown) throw thrown.reason;
      for (const u of units) {
        const proofText = proofTexts.get(u.unit);
        const proof = proved.get(u.unit)!;
        const base = u.unit.replace(/\.ts$/, "");
        const logFile = `gen/proof/${base}.log`;
        // The final Dafny stays on disk even when the result was remembered, so that it can be read.
        const dfyFile = path.join(root, "gen/proof", base, `${base}.dfy`);
        fs.mkdirSync(path.dirname(dfyFile), { recursive: true });
        fs.writeFileSync(path.join(root, logFile), proof.log);
        if (proof.dfy && !fs.existsSync(dfyFile)) fs.writeFileSync(dfyFile, proof.dfy);
        // What was accepted is tied to the text it was accepted for.
        const meaning = sha(u.text, proofText ?? "").slice(0, 12);
        const was = accepted[u.unit];
        const valid = was?.text === meaning ? was.unproved : [];
        const outdated = was && was.text !== meaning ? `; the ${was.unproved.length} accepted earlier were accepted for another text of this unit or its proof file, and no longer count` : "";
        const fresh = proof.unproved.filter((x) => !valid.includes(x));
        const stale = valid.filter((x) => !proof.unproved.includes(x));
        if (proof.unproved.length) ledger[u.unit] = { text: meaning, unproved: proof.unproved };
        const listed = (xs: string[]) => indent(xs.map((x) => (proof.exhausted.includes(x) ? `${x}   [the prover ran out of resources]` : x)).join("\n"));
        // Hand-written code proved against a module that is only partly proved rests on what is not.
        const assumed = u.rests.flatMap((r) => (proved.get(r)?.unproved.length ? [`${proved.get(r)!.unproved.length} of ${r}`] : []));
        const assuming = (assumed.length ? `, assuming the obligations that are simulated only (${assumed.join(", ")})` : "")
          // A precondition is assumed by the proof and checked by no one: callers outside verified code must meet it.
          + (u.requires ? `, under ${u.requires} //@ requires that its unverified callers must meet` : "");
        if (proof.errors.length) {
          recordable = false;
          said(false, "proof", `${u.unit}: Dafny could not check it (full output in ${logFile}, final Dafny in gen/proof/${base}/${base}.dfy)`, indent(proof.errors.join("\n")), u.unit);
        } else if (fresh.length && accept !== "unproved") {
          said(false, "proof", `${u.unit}: ${fresh.length} of ${proof.total} obligations not proved${outdated}. Prove them in ${u.proofFile}, or add the rule that makes them provable; if simulation is enough for them, that is the user's decision (\`npm run accept -- unproved\`). Full output in ${logFile}, final Dafny in gen/proof/${base}/${base}.dfy`, listed(fresh), u.unit);
        } else {
          said(true, "proof", `${u.unit}: ${proof.unproved.length ? `${proof.total} obligations, of which ${proof.unproved.length} are simulated only (accepted) and the rest proved` : `all ${proof.total} obligations proved`} for all states and inputs${assuming}`
            + (stale.length && accept !== "unproved" ? `; ${stale.length} accepted earlier now prove, run \`npm run accept -- unproved\` to tighten the ledger` : ""), "", u.unit);
        }
      }
      if (accept === "unproved" && recordable) pendingLedger = { ledger, accepted };
      proofsRan = true;
    } catch (e) {
      said(false, "proof", (e as Error).message);
    }
      return out;
    }
    // The typecheck runs while the proofs do; it is reported first.
    const typecheck = fs.existsSync(path.join(root, "tsconfig.json")) ? run("tsc", ["--noEmit", "-p", "."], root) : undefined;
    const proofsDone = provingAll();
    // A missing or unexecutable compiler must not release the project lock while proofs still write into gen/.
    const [typesResult, proofsResult] = await Promise.allSettled([typecheck, proofsDone]);
    if (typecheck) {
      if (typesResult.status === "rejected") report(false, "types", "the TypeScript checker could not run", indent(String(typesResult.reason)));
      else {
        const tsc = typesResult.value!;
        report(tsc.ok, "types", tsc.ok ? "application typechecks against the generated contract" : "application does not fit the generated contract", indent(tsc.out.trim()), "src/ and test/");
      }
    } else {
      const code = ["src", "test"].filter((d) => fs.existsSync(path.join(root, d)));
      report(!code.length, "types", code.length ? `${code.join(" and ")} exist but there is no tsconfig.json, so nothing checks them against the generated contract; run \`spec init\` to add one` : "skipped: there is no tsconfig.json and no src/ or test/");
    }
    if (proofsResult.status === "rejected") report(false, "proof", "the prover could not run", indent(String(proofsResult.reason)));
    else for (const r of proofsResult.value) report(...r);
    for (const r of await tests(root, specs)) report(...r);
    if (complete && proofsRan) collectGarbage(memory);
  }
  fs.rmSync(loaded, { recursive: true, force: true });

  // A spec that is not a valid model has nothing to reconcile yet. Everything is recorded at once, or nothing is.
  const todos = valid.map((spec) => ({ spec, todo: pending(root, spec, specs) }));
  const contractsToDo = pendingContracts(root, srcFiles);
  if (accept) {
    try {
      if (JSON.stringify(readSpecs(root)) !== JSON.stringify(specs) || JSON.stringify(readSrc(root)) !== JSON.stringify(srcFiles)
        || JSON.stringify(proofInputs()) !== JSON.stringify(proofFiles))
        report(false, "review", "sources changed while the check ran; nothing was accepted", "      Run `npm run check` again on the files now on disk.");
    } catch (e) {
      report(false, "review", "sources changed while the check ran; nothing was accepted", indent((e as Error).message));
    }
  }
  if (accept === "unproved" && allOk && pendingLedger) {
    const { ledger, accepted } = pendingLedger;
    writeLedger(root, ledger);
    const entries = (l: Record<string, Accepted | undefined>) => Object.entries(l).flatMap(([unit, a]) => (a?.unproved ?? []).map((x) => `${unit}: ${x}  [${a!.text}]`));
    const [before, after] = [entries(accepted), entries(ledger)];
    const added = after.filter((x) => !before.includes(x));
    const removed = before.filter((x) => !after.includes(x));
    const line = (sign: string) => (x: string) => `    ${sign} ${x.replace(/  \[[^\]]*\]$/, "")}`;
    report(true, "proof", `${path.relative(root, ledgerFile(root))}: ${added.length} added, ${removed.length} removed`,
      [...added.map(line("+")), ...removed.map(line("-"))].join("\n"), undefined, true);
  }
  const formal = todos.every(({ todo }) => !todo.some((t) => t.status === "story has no rules" || t.status === "not formalized"));
  const record = accept === "reviews" && allOk && formal;
  const why = accept !== "reviews" ? "then run `npm run accept`" : !allOk ? "nothing was accepted: fix the stages above first" : "every story needs rules and every rule a quint block before anything can be accepted";
  const items = (todo: Pending[], heading: string) => {
    const shown = moved(todo);
    return todo.map((t) => "    " + showPending(t)).join("\n") + (shown.length ? `\n\n    ${heading}:\n${shown.join("\n")}` : "");
  };
  for (const { spec, todo } of todos) {
    if (record && todo.length) {
      acceptReviews(root, spec, specs);
      report(true, "review", `${spec.file}: recorded as reconciled: ${todo.map((t) => t.rule?.key ?? t.story?.title ?? t.where.slice(t.where.indexOf("  ") + 2)).join("; ")}`, "", spec.file);
    } else report(!todo.length, "review", todo.length ? `${spec.file}: ${todo.length} item(s) to reconcile, ${why}` : `${spec.file}: prose and model reconciled for all ${spec.rules.length} rules and ${spec.stories.length} stories`,
      items(todo, "What moved, in full"), spec.file);
  }
  const proved = contracts(root, srcFiles).size;
  if (record && contractsToDo.length) {
    acceptContracts(root, srcFiles);
    report(true, "review", `src/: recorded as reconciled: ${contractsToDo.map((t) => t.where).join("; ")}`, "", "src/");
  } else if (contractsToDo.length) report(false, "review", `src/: ${contractsToDo.length} contract(s) to reconcile, ${why}`, items(contractsToDo, "The contracts, in full"), "src/");
  else if (proved) report(true, "review", `src/: the //@ contracts of all ${proved} proved files reconciled`, "", "src/");
  return allOk;
}

// --- init ----------------------------------------------------------------------------

/** Set up a project, preserving its content outside the marked Vibespec instructions. */
export function init(root: string): string[] {
  const pkg = path.join(import.meta.dirname, "..");
  const done: string[] = [];
  const add = (file: string, content: () => string) => {
    if (fs.existsSync(path.join(root, file))) return;
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content());
    done.push(file);
  };
  for (const doc of [".claude/skills/sync/SKILL.md", ".claude/skills/design/SKILL.md", "CONTRIBUTING.md"]) add(doc, () => fs.readFileSync(path.join(pkg, doc), "utf8"));
  const agents = path.join(root, "AGENTS.md");
  const procedure = fs.readFileSync(path.join(pkg, "AGENTS.md"), "utf8").trim();
  const previous = fs.existsSync(agents) ? fs.readFileSync(agents, "utf8") : "";
  const eol = previous.includes("\r\n") ? "\r\n" : "\n";
  const section = `<!-- vibespec:start -->${eol}${procedure.replace(/\r?\n/g, eol)}${eol}<!-- vibespec:end -->`;
  const starts = [...previous.matchAll(/<!-- (vibespec|onespec):start\b[^>]*-->/g)];
  const ends = [...previous.matchAll(/<!-- (vibespec|onespec):end -->/g)];
  if (starts.length !== ends.length || starts.length > 1 || (starts.length === 1 && (starts[0][1] !== ends[0][1] || starts[0].index! > ends[0].index!)))
    throw new Error("AGENTS.md: repair the duplicated or incomplete Vibespec markers before running spec init");
  const updated = starts.length ? previous.slice(0, starts[0].index) + section + previous.slice(ends[0].index! + ends[0][0].length)
    : previous.trim() === procedure ? `${section}${eol}`
    : `${previous.trimEnd()}${previous.trim() ? eol + eol : ""}${section}${eol}`;
  if (updated !== previous) {
    fs.writeFileSync(agents, updated);
    done.push("AGENTS.md (Vibespec instructions)");
  }
  const claude = path.join(root, "CLAUDE.md");
  const own = fs.existsSync(claude) ? fs.readFileSync(claude, "utf8") : "";
  if (!/^@AGENTS\.md\s*$/m.test(own)) {
    const eol = own.includes("\r\n") ? "\r\n" : "\n";
    fs.writeFileSync(claude, `${own.trimEnd()}${own.trim() ? eol + eol : ""}@AGENTS.md${eol}`);
    done.push("CLAUDE.md (imports AGENTS.md)");
  }
  add("tsconfig.json", () => JSON.stringify({ compilerOptions: { target: "es2023", module: "nodenext", strict: true, noEmit: true, allowImportingTsExtensions: true, erasableSyntaxOnly: true, skipLibCheck: true, types: ["node"] }, include: ["src", "test", "gen/*.ts"] }, null, 2) + "\n");
  if (!fs.existsSync(path.join(root, "spec"))) { fs.mkdirSync(path.join(root, "spec")); done.push("spec/"); }
  const ignore = path.join(root, ".gitignore");
  const ignored = fs.existsSync(ignore) ? fs.readFileSync(ignore, "utf8") : "";
  const missing = ["gen/", ".spec-cache/", ".studio/"].filter((l) => !ignored.split("\n").includes(l));
  if (missing.length) { fs.writeFileSync(ignore, ignored + (ignored && !ignored.endsWith("\n") ? "\n" : "") + missing.join("\n") + "\n"); done.push(".gitignore"); }
  const manifest = path.join(root, "package.json");
  if (fs.existsSync(manifest)) {
    const json = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const scripts = { dev: "spec studio", check: "spec check", gen: "spec gen", accept: "spec accept" };
    const added = Object.entries(scripts).filter(([name]) => !json.scripts?.[name]);
    if (added.length) {
      json.scripts = { ...json.scripts, ...Object.fromEntries(added) };
      fs.writeFileSync(manifest, JSON.stringify(json, null, 2) + "\n");
      done.push(`package.json scripts: ${added.map(([n]) => n).join(", ")}`);
    }
  }
  return done;
}


// --- new -----------------------------------------------------------------------------

/** A spec that passes every check as it is: one story, the state, one guarded transition, an `always` and a `sometimes` rule. */
const starter = (name: string, fence = "`".repeat(3)) => `# ${name}

What the application is for, in a sentence or two. Replace the story and its
rules with your own; CONTRIBUTING.md says how to write them.

## Story: Keep a tally

> As a user, I want to add to a tally, never past its limit, so that I can
> count things up to a known number.

### A new tally is empty

${fence}quint
type Tally = { count: int }
pure val initial: Tally = { count: 0 }
${fence}

### Only a positive amount that keeps the tally within its limit can be added

The limit is ten, and the tally never passes it.

${fence}quint
pure val limit = 10
pure def canAdd(t: Tally, n: int): bool = n > 0 and t.count + n <= limit
pure def add(t: Tally, n: int): Tally = { count: t.count + n }
pure def alwaysWithinLimit(t: Tally): bool = 0 <= t.count and t.count <= limit
${fence}

### A tally can reach its limit

${fence}quint
pure def sometimesFull(t: Tally): bool = t.count == limit
${fence}
`;

/** Write spec/<name>.md, a starter spec; returns its path. Nothing is overwritten. */
export function newSpec(root: string, name: string): string {
  const bad = badSpecName(name);
  if (bad) throw new Error(`spec new ${name}: ${bad}`);
  const file = `spec/${name}.md`;
  fs.mkdirSync(path.join(root, "spec"), { recursive: true });
  try {
    fs.writeFileSync(path.join(root, file), starter(name), { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${file} already exists; nothing was written`);
    throw e;
  }
  return file;
}

// --- CLI -----------------------------------------------------------------------------

/** Run as a command, not imported? `import.meta.main` says so from Node 24.2; before that, compare the paths. */
const isMain = (): boolean => {
  if (typeof import.meta.main === "boolean") return import.meta.main;
  try {
    return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

const USAGE = "usage: spec check [--json] | watch | gen | accept | accept unproved | new <name> | init | studio [<example>] [--port <n>]";

/**
 * Check, then check again whenever spec/, src/, test/ or tsconfig.json changes. One process stays warm between runs
 * (the compiler, the toolchain's fingerprint and the cache are already loaded), edits that arrive during a run start
 * one more run after it, and what is unchanged comes from the cache as in any check.
 */
async function watch(root: string) {
  let running = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const once = async () => {
    if (running) { again = true; return; }
    running = true;
    do {
      again = false;
      const started = Date.now();
      console.log(`\n--- ${new Date().toLocaleTimeString()} ---`);
      try {
        const { next } = await check(root, false, (r) => console.log(show(r)));
        console.log(`\nnext: ${next}\n(${((Date.now() - started) / 1000).toFixed(1)}s; watching spec/, src/, test/ and tsconfig.json; Ctrl-C to stop)`);
      } catch (e) {
        console.error((e as Error).message);
      }
    } while (again);
    running = false;
  };
  const changed = (file?: string | null) => {
    // Editors write temporary files beside the real one; only sources matter.
    if (file && !/\.(md|ts|dfy|json)$/.test(file)) return;
    clearTimeout(timer);
    timer = setTimeout(once, 200);
  };
  for (const dir of ["spec", "src", "test"]) if (fs.existsSync(path.join(root, dir))) fs.watch(path.join(root, dir), { recursive: true }, (_, f) => changed(f));
  if (fs.existsSync(path.join(root, "tsconfig.json"))) fs.watch(path.join(root, "tsconfig.json"), () => changed());
  await once();
}

if (isMain()) {
  const root = process.cwd();
  const [command, ...args] = process.argv.slice(2);
  const takes = (...allowed: string[][]) => allowed.some((a) => a.length === args.length && a.every((x, i) => x === "*" || x === args[i]));
  try {
    if (Number(process.versions.node.split(".")[0]) < 24) throw new Error(`spec needs Node 24 or later; this is Node ${process.versions.node}`);
    if (command === "gen" && takes([], ["--if-valid"])) {
      // --if-valid is for `npm install`: a spec in the middle of an edit must not make installing fail.
      try {
        const models = new Map<string, Model>();
        for (const s of readSpecs(root)) await gen(root, s, models);
      } catch (e) {
        if (!args.length) throw e;
        console.log(`note: gen/ was not generated, because a spec is not valid yet (${(e as Error).message.split("\n")[0]}); \`npm run check\` says why`);
      }
    } else if ((command === "check" && takes([], ["--json"])) || (command === "accept" && takes([], ["unproved"]))) {
      const json = args[0] === "--json";
      const accept = command === "check" ? false : args[0] === "unproved" ? "unproved" : "reviews";
      const { ok, results, next } = await check(root, accept, json ? undefined : (r) => console.log(show(r)));
      console.log(json ? JSON.stringify({ ok, results, next }, null, 2) : `\nnext: ${next}`);
      process.exitCode = ok ? 0 : 1;
    } else if (command === "init" && takes([])) {
      const done = init(root);
      console.log(done.length ? `added: ${done.join(", ")}` : "nothing to add: everything is already there");
    } else if (command === "watch" && takes([])) {
      await watch(root);
    } else if (command === "studio" && takes([], ["*"], ["--port", "*"], ["*", "--port", "*"])) {
      // The studio imports this module; defer loading it until the command module has finished evaluating.
      import("./studio/server.ts").then(({ serve }) => serve(root, args)).catch((e: Error) => {
        console.error(e.message);
        process.exitCode = 1;
      });
    } else if (command === "new" && takes(["*"])) {
      console.log(`wrote ${newSpec(root, args[0])}; run \`npm run check\``);
    } else {
      console.error(command === "accept" ? `accept takes no argument, or \`unproved\`; not ${args.join(" ")}\n${USAGE}` : USAGE);
      process.exitCode = 2;
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exitCode = 1;
  }
}
