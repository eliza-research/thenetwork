// Golden artifacts for the app-pack refactor (docs/research/2026-10-08-engine-generalization.md
// P0, 3.2). Every artifact is a pure function of the code: no LLM calls (the judge run uses a
// deterministic fake model), no keys, no clock reads that reach the output.
//
// Hashes use plain JSON.stringify (insertion order kept), not stableStringify: byte-identity rule 3
// says funnel keys (byGenerator, rejectedBy...) must serialize in today's order, and a sorted-key
// hash would hide a reorder. Wall-clock fields (timingsMs, wallMs, runId timestamps) are removed.
//
// Two tiers: FAST (every `bun test`, about 30 s with the subprocesses run in parallel) and FULL
// (capture.ts --full / GOLDEN_FULL=1: more seeds and the published experiment tables).
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { ChatMessage, LLM, Proposal, WorldSnapshot } from "@thenetwork/core";
import { runEngine, type EngineResult } from "../../src/engine.ts";
import { configHash, resolveConfig } from "../../src/config.ts";
import { loadSnapshot } from "../../../../scripts/synthetic/load.ts";
import { generatePersonas } from "../../../sim/src/generator.ts";
import { StubNetwork } from "../../../sim/src/stubNetwork.ts";
import { World as SimWorld } from "../../../sim/src/world.ts";

export const REPO = resolve(import.meta.dir, "../../../..");
export const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** JSON with insertion order kept, wall-clock fields dropped, Infinity spelled out. */
export function canonical(v: unknown): string {
  return JSON.stringify(v, (k, x) => (k === "timingsMs" || k === "wallMs" || k === "wall" ? undefined : x === Infinity ? "Infinity" : x === -Infinity ? "-Infinity" : x));
}

export type Artifact = Record<string, unknown>;

/** A compact, diffable summary of one runEngine result plus the hash of the full result. */
export function engineSummary(r: EngineResult, cfgHash: string): Artifact {
  const f = r.runLog.funnel;
  return {
    configHash: cfgHash, runLogConfigHash: r.runLog.configHash, runId: r.runLog.runId, inputHash: r.runLog.inputHash,
    proposals: r.proposals.length, asks: r.asks.length, scored: r.runLog.scored.length,
    funnel: { generated: f.generated, byGenerator: f.byGenerator, rejectedBy: f.rejectedBy, passedHardFilters: f.passedHardFilters, deduped: f.deduped, eligible: f.eligible, selected: f.selected, exploration: f.exploration, budgetSkips: f.budgetSkips, memberFunnel: f.memberFunnel },
    proposalIds: r.proposals.map(p => p.id),
    sha: { proposals: sha(canonical(r.proposals)), asks: sha(canonical(r.asks)), runLog: sha(canonical(r.runLog)) },
  };
}

// ---------------------------------------------------------------------------------- engine
export async function engineSynthetic(seeds: number[]): Promise<Artifact> {
  const snap = await loadSnapshot();
  const out: Artifact = {};
  for (const seed of seeds) {
    const cfg = { seed };
    const r = await runEngine(snap, cfg);
    out[`seed${seed}`] = engineSummary(r, configHash(resolveConfig(cfg)));
  }
  return out;
}

/** runEngine inside the simulator: every nightly per-city call is recorded (as sim/engines/engine-v1.ts calls it). */
export async function engineSim(seeds: number[], personas = 80, days = 10): Promise<Artifact> {
  const out: Artifact = {};
  for (const seed of seeds) {
    const calls: unknown[] = [];
    const engine = {
      name: "engine-v1-golden",
      async propose(snapshot: WorldSnapshot, opts?: { city?: string; seed?: number | string }): Promise<Proposal[]> {
        const s = typeof opts?.seed === "number" ? opts.seed : 1;
        const cfg = opts?.city ? { seed: s, cities: [opts.city as "sf" | "nyc"] } : { seed: s };
        const r = await runEngine(snapshot, cfg);
        calls.push([opts?.city ?? "", snapshot.now, r.runLog.configHash, r.runLog.runId, r.proposals.length, sha(canonical(r)).slice(0, 16)]);
        return opts?.city ? r.proposals.filter(p => p.city === opts.city) : r.proposals;
      },
    };
    const ps = generatePersonas({ n: personas, seed, joinSpreadDays: Math.min(7, days) } as any);
    const world = new SimWorld({ seed, personas: ps, days, mode: "discrete", network: new StubNetwork({ seed, randomIntros: false }), engine: engine as any, writeLog: false, runId: `golden-${seed}` });
    const res = await world.run();
    const { run: _run, ...metrics } = res.metrics as any;
    out[`seed${seed}`] = { calls: calls.length, callsSha: sha(canonical(calls)), callsList: calls, metricsSha: sha(canonical(metrics)), proposals: (metrics as any).proposals?.total, precision: (metrics as any).proposals?.precision };
  }
  return out;
}

// ---------------------------------------------------------------------------------- judge
/** Deterministic fake model: answers each pass by its system prompt; the verdict depends on the message hash. */
export class GoldenLLM implements LLM {
  readonly seen: string[] = [];
  async chat(messages: ChatMessage[]): Promise<string> {
    const h = sha(JSON.stringify(messages));
    this.seen.push(h);
    const sys = messages[0]?.content ?? "";
    const yes = parseInt(h.slice(0, 2), 16) % 4 !== 0;
    const refs = ["P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8"];
    const by = <T>(v: T) => Object.fromEntries(refs.map(r => [r, v]));
    const why = "You both like getting out and trying new things.";
    if (/first-pass screen/.test(sys)) {
      return JSON.stringify({ reasoning: "P1.intents[0] and P2 overlap.", cited_facts: [], dealbreaker: false, dealbreaker_reason: "", verdict: yes ? "yes" : "no", match_probability: yes ? 0.7 : 0.3, accept_probability: by(0.6), member_why: yes ? why : "" });
    }
    if (/deep review|steelman/i.test(sys)) {
      const v = parseInt(h.slice(2, 4), 16) % 5 === 0 ? "insufficient_information" : yes ? "yes" : "no";
      return JSON.stringify({
        evidence_review: "P1.facts[0] stated.", steelman_for: "Shared want.", steelman_against: "Cold intro.",
        rubric: { mutual_benefit: 4, reciprocity: 4, intent_timing: 4, logistics: 4, stage_fit: 3, values_energy: 4, novelty: 3, evidence_quality: 4, risk_safety: 5 },
        would_thank_us: by("yes"), reasoning: "For outweighs against.", cited_facts: [], verdict: v,
        question_to_ask: v === "insufficient_information" ? { ref: "P1", question: "Are you free this weekend?" } : null,
        match_probability: yes ? 0.7 : 0.3, member_why: by(why),
      });
    }
    const s = (k: number) => 1 + (parseInt(h.slice(4 + k, 5 + k), 16) % 5);
    return JSON.stringify({
      reasoning: "P1.own_request fits P2.shareable.", cited_facts: [], fit: s(0), mutual_value: s(1), capacity_realism: s(2), timing: s(3), social_comfort: s(4), red_flags: 1, certainty: s(5),
      dealbreaker: false, dealbreaker_reason: "", verdict: yes ? "yes" : "no", match_probability: yes ? 0.7 : 0.3, why: by(why),
    });
  }
}

/** runEngine with all three judge passes on, a deterministic fake model, prompt and context bytes pinned. */
export async function engineJudged(seeds: number[]): Promise<Artifact> {
  const snap = await loadSnapshot();
  const out: Artifact = {};
  for (const seed of seeds) {
    const llm = new GoldenLLM();
    const cfg = { seed, judge: { screen: { enabled: true }, deep: { enabled: true } } };
    const r = await runEngine(snap, cfg, { llm, judgeModel: "golden-fake" });
    const j = r.runLog.judge;
    out[`seed${seed}`] = {
      ...engineSummary(r, configHash(resolveConfig(cfg))),
      llmCalls: llm.seen.length, messagesSha: sha([...llm.seen].sort().join(",")),
      judge: { calls: j.calls, failures: j.failures, screen: j.screen && { calls: j.screen.calls, failures: j.screen.failures }, deep: j.deep && { calls: j.deep.calls, failures: j.deep.failures } },
    };
  }
  return out;
}

// ---------------------------------------------------------------------------------- CLIs (subprocesses)
async function runCli(args: string[], jsonFile?: string): Promise<{ stdout: string; json?: unknown }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !/API_KEY|LIVE_TESTS/.test(k)) env[k] = v;
  const p = Bun.spawn(["bun", ...args], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`bun ${args.join(" ")} exited ${code}: ${stderr.slice(-2000)}`);
  return { stdout, json: jsonFile ? await Bun.file(jsonFile).json() : undefined };
}
const tmp = (name: string) => `${process.env.TMPDIR ?? "/tmp"}/golden-${process.pid}-${name}.json`;

/** Per-variant, per-seed rows, rounded to 9 significant digits (still byte-sensitive in practice) plus a hash of the raw JSON. */
function experimentArtifact(json: unknown): Artifact {
  const rows = json as { name: string; seeds: Record<string, unknown>[] }[];
  const out: Artifact = { sha: sha(canonical(json)) };
  for (const v of rows) out[v.name] = v.seeds.map(s => ({ ...s, stats: undefined, byRule: s.byRule }));
  return out;
}

export async function attentionSubset(seeds: number[]): Promise<Artifact> {
  const f = tmp("attention");
  const { json } = await runCli(["packages/engine/experiments/attention.ts", "--seeds", seeds.join(","), "--only", "^HQ-c ", "--json", f], f);
  return experimentArtifact(json);
}

export async function plansSubset(seeds: number[], days = 30): Promise<Artifact> {
  const f = tmp("plans");
  const { json } = await runCli(["packages/engine/experiments/plans.ts", "--seeds", seeds.join(","), "--only", "^(B|P) HQ-c", "--days", String(days), "--json", f], f);
  return experimentArtifact(json);
}

export async function capitalSubset(seeds: number, days: number): Promise<Artifact> {
  const f = tmp("capital");
  const { json } = await runCli(["run", "packages/capital/experiments/run.ts", "--seeds", String(seeds), "--days", String(days), "--json", f], f);
  const arms = json as Record<string, { gates: unknown }>;
  return { sha: sha(canonical(json)), gates: Object.fromEntries(Object.entries(arms).map(([k, v]) => [k, v.gates])) };
}

/** The simulator CLI's summary metrics (`--json`), with and without the engine adapter. */
export async function simCli(seeds: number[]): Promise<Artifact> {
  const out: Artifact = {};
  await Promise.all(seeds.flatMap(seed => [false, true].map(async eng => {
    const { stdout } = await runCli(["run", "packages/sim/src/cli.ts", "--seed", String(seed), "--json", "--no-log", ...(eng ? ["--engine", "packages/sim/engines/engine-v1.ts"] : [])]);
    const m = JSON.parse(stdout.slice(stdout.indexOf("{")));
    delete m.run.runId;
    out[`seed${seed}${eng ? ":engine-v1" : ":stub"}`] = { sha: sha(canonical(m)), proposals: m.proposals, experience: m.experience, safety: m.safety, invariants: m.invariants?.violations };
  })));
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

// ---------------------------------------------------------------------------------- tiers
export const FAST = {
  engine_synthetic: () => engineSynthetic([1, 2, 3]),
  engine_sim: () => engineSim([1, 2, 3]),
  engine_judged: () => engineJudged([1]),
  attention_v12: () => attentionSubset([1]),
  plans_v11: () => plansSubset([1], 21),
  capital: () => capitalSubset(1, 30),
  sim_cli: () => simCli([1, 2, 3]),
} as const;

export const FULL = {
  engine_synthetic_full: () => engineSynthetic([1, 2, 3, 4, 5, 6, 7, 8]),
  engine_sim_full: () => engineSim([1, 2, 3, 4, 5, 6, 7, 8], 150, 30),
  engine_judged_full: () => engineJudged([1, 2, 3]),
  attention_v12_full: () => attentionSubset([1, 2, 3, 4, 5, 6, 7, 8]),
  plans_v11_full: () => plansSubset([1, 2, 3, 4, 5, 6, 7, 8], 30),
  capital_full: () => capitalSubset(8, 90),
} as const;

export type Tier = typeof FAST | typeof FULL;

/** Compute every artifact of a tier; subprocess artifacts run concurrently with the in-process ones. */
export async function computeTier(tier: Record<string, () => Promise<Artifact>>): Promise<Record<string, Artifact>> {
  const names = Object.keys(tier);
  const vals = await Promise.all(names.map(n => tier[n]!()));
  return Object.fromEntries(names.map((n, i) => [n, vals[i]!]));
}

/** First differing JSON path between two values (for readable golden failures). */
export function firstDiff(a: unknown, b: unknown, path = "$"): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return `${path}: expected ${JSON.stringify(b)?.slice(0, 200)} got ${JSON.stringify(a)?.slice(0, 200)}`;
  if (Array.isArray(a) !== Array.isArray(b)) return `${path}: array vs object`;
  const ka = Object.keys(a as object), kb = Object.keys(b as object);
  for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
    if (ka[i] !== kb[i]) return `${path}: key order/set differs at index ${i}: expected ${kb[i]} got ${ka[i]}`;
  }
  for (const k of kb) {
    const d = firstDiff((a as any)[k], (b as any)[k], `${path}.${k}`);
    if (d) return d;
  }
  return null;
}
