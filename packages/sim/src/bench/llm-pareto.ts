import { parseArgs } from "node:util";
import { performance } from "node:perf_hooks";
import { Rng, hash32, type ChatMessage, type ChatOptions, type LLM, type ResponseInfo } from "@thenetwork/core";
import { canonicalInput, runEngine } from "@thenetwork/engine/src/engine.ts";
import { resolveConfig } from "@thenetwork/engine/src/config.ts";
import { localEmbed } from "@thenetwork/engine/src/embed.ts";
import { networkPack } from "@thenetwork/engine/src/packs/network/index.ts";
import { plantedEngineInput, plantedPairTruth } from "../planted.ts";
import { safeDiv } from "../stats.ts";

export interface ParetoArmMetrics {
  n: number;
  seed: number;
  mode: "pre_selection" | "post_selection";
  calls: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costMicro: number;
  wallMs: number;
  selectedProposals: number;
  trueGoodPairs: number;
  pairPrecision: number;
}

export interface ParetoComparison {
  n: number;
  seed: number;
  pre: ParetoArmMetrics;
  post: ParetoArmMetrics;
  callSavingsPct: number;
  tokenSavingsPct: number;
  costSavingsPct: number;
  precisionDelta: number;
}

export interface LlmParetoReport {
  model: string;
  comparisons: ParetoComparison[];
  meanCallSavingsPct: number;
  meanTokenSavingsPct: number;
  meanPrecisionDelta: number;
}

class InstrumentedOfflineJudgeLLM implements LLM {
  calls = 0;
  promptTokens = 0;
  completionTokens = 0;
  reasoningTokens = 0;
  costMicro = 0;
  readonly responses: ResponseInfo[] = [];

  constructor(private readonly seed: number) {}

  async chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string> {
    const t0 = performance.now();
    const userMsg = messages.map(m => m.content).join("\n");
    const refMatches = [...userMsg.matchAll(/\b(P[0-9]+|M[0-9]+|member_[a-zA-Z0-9_-]+)\b/g)].map(m => m[1]!);
    const refs = [...new Set(refMatches.filter(r => /^P\d+$/.test(r)))];
    const usedRefs = refs.length >= 2 ? refs : ["P1", "P2"];
    const h = hash32(this.seed, userMsg.slice(0, 512));
    const rng = new Rng(h);
    const sharedHint = (userMsg.match(/shared|overlap|both|common/gi) ?? []).length;
    const baseScore = Math.min(5, Math.max(2, Math.round(2.8 + Math.min(1.5, sharedHint * 0.35) + rng.normal(0, 0.55))));
    const dealbreaker = /red_flag|blocked|minor|ex_partner/i.test(userMsg);
    const verdict = !dealbreaker && baseScore >= 3 ? "yes" : "no";
    const matchProb = Number(Math.max(0.05, Math.min(0.95, (baseScore - 1) / 4 + rng.normal(0, 0.06))).toFixed(3));
    const why: Record<string, string> = {};
    for (const ref of usedRefs) {
      why[ref] = "Shared local interests and aligned timing.";
    }
    const payload = {
      reasoning: `Evaluated ${usedRefs.length} participants with ${sharedHint} shared cues; fit=${baseScore}, dealbreaker=${dealbreaker}.`,
      fit: baseScore,
      mutual_value: baseScore,
      capacity_realism: Math.min(5, Math.max(2, baseScore)),
      timing: 4,
      social_comfort: dealbreaker ? 1 : Math.min(5, Math.max(2, baseScore)),
      red_flags: dealbreaker ? 1 : 5,
      certainty: 4,
      dealbreaker,
      verdict,
      match_probability: matchProb,
      why,
    };
    const reply = JSON.stringify(payload);
    const pTok = Math.max(64, Math.ceil(userMsg.length / 4));
    const cTok = Math.max(32, Math.ceil(reply.length / 4));
    const rTok = 96;
    const cost = Math.round(pTok * 0.25 + (cTok + rTok) * 1.0);
    const latencyMs = Math.max(1, Math.round(performance.now() - t0));

    this.calls++;
    this.promptTokens += pTok;
    this.completionTokens += cTok;
    this.reasoningTokens += rTok;
    this.costMicro += cost;

    this.responses.push({
      model: "gpt-6-luna-offline-sim",
      baseUrl: "offline://sim",
      status: 200,
      ok: true,
      latencyMs,
      attempt: 0,
      regrows: 0,
      request: { max_tokens: opts?.maxTokens ?? 400 },
      usage: { promptTokens: pTok, completionTokens: cTok, reasoningTokens: rTok },
      costMicro: cost,
      costKnown: true,
      finishReason: "stop",
    });
    return reply;
  }
}

async function runArm(n: number, seed: number, postSelection: boolean): Promise<ParetoArmMetrics> {
  const { input, truth } = plantedEngineInput({ seed: `llm-pareto-${seed}`, n, lanes: ["Friend"], app: "ntwrk" });
  const canon = canonicalInput(input);
  const cfg = resolveConfig({
    seed,
    selection: { maxProposalsPerCity: 40 },
    judge: {
      enabled: true,
      topK: 200,
      groupTopK: 60,
      postSelection: postSelection ? true : false,
    },
  });
  const llm = new InstrumentedOfflineJudgeLLM(seed * 97 + n);
  const t0 = performance.now();
  const out = await runEngine(canon, cfg, { llm, embed: localEmbed, pack: networkPack });
  const wallMs = Number((performance.now() - t0).toFixed(1));

  let totalPairs = 0;
  let trueGoodPairs = 0;
  for (const prop of out.proposals) {
    const ids = prop.participants;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        totalPairs++;
        if (plantedPairTruth(truth, "Friend", ids[i]!, ids[j]!) >= 400) trueGoodPairs++;
      }
    }
  }

  return {
    n,
    seed,
    mode: postSelection ? "post_selection" : "pre_selection",
    calls: llm.calls,
    promptTokens: llm.promptTokens,
    completionTokens: llm.completionTokens,
    reasoningTokens: llm.reasoningTokens,
    totalTokens: llm.promptTokens + llm.completionTokens + llm.reasoningTokens,
    costMicro: llm.costMicro,
    wallMs,
    selectedProposals: out.proposals.length,
    trueGoodPairs,
    pairPrecision: Number(safeDiv(trueGoodPairs, totalPairs).toFixed(3)),
  };
}

export async function runLlmParetoBenchmark(
  sizes: readonly number[] = [150, 300],
  seeds: readonly number[] = [1, 2],
): Promise<LlmParetoReport> {
  const comparisons: ParetoComparison[] = [];
  for (const n of sizes) {
    for (const seed of seeds) {
      const pre = await runArm(n, seed, false);
      const post = await runArm(n, seed, true);
      const callSavingsPct = Number((safeDiv(pre.calls - post.calls, Math.max(1, pre.calls)) * 100).toFixed(1));
      const tokenSavingsPct = Number((safeDiv(pre.totalTokens - post.totalTokens, Math.max(1, pre.totalTokens)) * 100).toFixed(1));
      const costSavingsPct = Number((safeDiv(pre.costMicro - post.costMicro, Math.max(1, pre.costMicro)) * 100).toFixed(1));
      const precisionDelta = Number((post.pairPrecision - pre.pairPrecision).toFixed(3));
      comparisons.push({ n, seed, pre, post, callSavingsPct, tokenSavingsPct, costSavingsPct, precisionDelta });
    }
  }
  const meanCallSavingsPct = Number(safeDiv(comparisons.reduce((s, c) => s + c.callSavingsPct, 0), comparisons.length).toFixed(1));
  const meanTokenSavingsPct = Number(safeDiv(comparisons.reduce((s, c) => s + c.tokenSavingsPct, 0), comparisons.length).toFixed(1));
  const meanPrecisionDelta = Number(safeDiv(comparisons.reduce((s, c) => s + c.precisionDelta, 0), comparisons.length).toFixed(3));
  return {
    model: "gpt-6-luna-offline-sim",
    comparisons,
    meanCallSavingsPct,
    meanTokenSavingsPct,
    meanPrecisionDelta,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({
    options: {
      sizes: { type: "string", default: "150,300" },
      seeds: { type: "string", default: "1,2" },
      json: { type: "boolean", default: false },
    },
  });
  const sizes = values.sizes.split(",").map(Number).filter(x => Number.isFinite(x) && x > 0);
  const seeds = values.seeds.split(",").map(Number).filter(x => Number.isFinite(x) && x > 0);
  const report = await runLlmParetoBenchmark(sizes, seeds);
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`LLM Judge Token-Quality Pareto Benchmark (${report.model})`);
    for (const c of report.comparisons) {
      console.log(
        `  N=${String(c.n).padStart(3)} seed=${c.seed}: `
        + `pre(calls=${c.pre.calls}, tok=${c.pre.totalTokens}, prec=${(c.pre.pairPrecision * 100).toFixed(1)}%) -> `
        + `post(calls=${c.post.calls}, tok=${c.post.totalTokens}, prec=${(c.post.pairPrecision * 100).toFixed(1)}%) | `
        + `savings calls=${c.callSavingsPct}% tok=${c.tokenSavingsPct}% precDelta=${c.precisionDelta >= 0 ? "+" : ""}${(c.precisionDelta * 100).toFixed(1)}pp`,
      );
    }
    console.log(
      `  Mean savings: calls=${report.meanCallSavingsPct}% tokens=${report.meanTokenSavingsPct}% precisionDelta=${report.meanPrecisionDelta >= 0 ? "+" : ""}${(report.meanPrecisionDelta * 100).toFixed(1)}pp`,
    );
  }
}
