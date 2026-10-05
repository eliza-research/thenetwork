// runEngine: the v1 matching and opportunity pipeline (Sections 14.1, 33). Pure function of
// (snapshot, config, deps): no clock reads, no Math.random, deterministic ordering; the run log
// carries everything needed to replay it (ME-004). Nothing is emitted unless the whole run
// completes (ME-010: no partial proposals).
import type { LLM, MemberId, WorldSnapshot } from "@thenetwork/core";
import { configHash, ENGINE_VERSION, resolveConfig, type EngineConfigInput } from "./config.ts";
import { localEmbed, type EmbedFn } from "./embed.ts";
import { explain } from "./explain.ts";
import { candidateReason, memberReason } from "./filters.ts";
import { GENERATORS, type GenCtx } from "./generators.ts";
import { JudgeCache, judgeCandidates } from "./judge.ts";
import { blockingPairs, fairnessMetrics, selectProposals, updateExposureDebt } from "./policy.ts";
import { Rng, sha256, stableStringify } from "./rng.ts";
import { scoreCandidate, type Scored } from "./scoring.ts";
import type { Candidate, EngineInput, EngineProposal, JudgeVerdict, MatchingRunLog } from "./types.ts";
import { World } from "./world.ts";

export interface EngineDeps {
  llm?: LLM;
  embed?: EmbedFn;
  /** Judge verdict cache shared across runs (ME-008). A fresh one is used if omitted. */
  judgeCache?: JudgeCache;
  /** Identifier of the embedding model for the run log (ME-004). */
  embedModel?: string;
  judgeModel?: string;
}

export interface EngineResult { proposals: EngineProposal[]; runLog: MatchingRunLog }

function hashInput(input: EngineInput): string {
  const strip = (x: unknown) => JSON.parse(JSON.stringify(x, (k, v) => (k === "embedding" ? undefined : v)));
  return sha256(stableStringify(strip(input))).slice(0, 16);
}

export async function runEngine(snapshot: WorldSnapshot | EngineInput, cfgIn: EngineConfigInput = {}, deps: EngineDeps = {}): Promise<EngineResult> {
  const t0 = performance.now();
  const timings: Record<string, number> = {};
  const lap = (name: string, since: number) => { timings[name] = Math.round((performance.now() - since) * 100) / 100; return performance.now(); };
  const input = snapshot as EngineInput;
  const cfg = resolveConfig(cfgIn);
  const rng = new Rng(cfg.seed);
  const embed = deps.embed ?? localEmbed;
  const w = new World(input, cfg, embed);
  let t = lap("index", t0);

  const runLog: MatchingRunLog = {
    runId: sha256(`${hashInput(input)}|${configHash(cfg)}|${cfg.seed}`).slice(0, 16),
    seed: cfg.seed, configHash: configHash(cfg), inputHash: hashInput(input), now: w.now,
    engineVersion: ENGINE_VERSION, embedModel: deps.embedModel ?? (deps.embed ? "custom" : "local-hash-v1"),
    judgeModel: deps.llm && cfg.judge.enabled ? (deps.judgeModel ?? process.env.CEREBRAS_MODEL ?? "qwen-3.8-27b") : undefined,
    funnel: {
      generated: 0, byGenerator: {}, memberFunnel: {}, memberExclusions: {}, rejectedBy: {}, passedHardFilters: 0, deduped: 0,
      floorViolations: {}, dealbreakers: 0, belowThreshold: 0, eligible: 0, budgetSkips: 0, selected: 0, exploration: 0,
    },
    scored: [], judge: { calls: 0, cacheHits: 0, failures: 0, verdicts: [] }, proposalsByGenerator: {},
    fairness: undefined as any, emptyStates: [], timingsMs: timings, blockingPairs: 0, exposureDebt: {},
  };
  const f = runLog.funnel;

  // 0. Member funnel (one generic check per member, for the run report).
  f.memberFunnel.total = w.ids.length;
  for (const id of w.ids) {
    const r = memberReason(w, id, { category: "social", role: "peer", format: "one_to_one", timeSensitive: false });
    const k = r ?? "available";
    f.memberFunnel[k] = (f.memberFunnel[k] ?? 0) + 1;
  }

  // 1. Generators (retrieval + member-level hard filters inside).
  const ctx: GenCtx = { w, memberExclusions: f.memberExclusions, rng: rng.fork("gen"), unmatchedIntents: new Set() };
  const cands: Candidate[] = [];
  for (const g of GENERATORS) {
    if (!cfg.generators[g.name]) continue;
    const ts = performance.now();
    const got = g.run(ctx);
    f.byGenerator[g.name] = got.length;
    cands.push(...got);
    timings[`gen:${g.name}`] = Math.round((performance.now() - ts) * 100) / 100;
  }
  f.generated = cands.length;
  t = lap("generate", t);

  // 2. Full hard-filter check on every configuration (defense in depth; resolves city/window).
  const anchorReasons = new Map<string, Map<string, number>>();
  const passed: Candidate[] = [];
  for (const c of cands) {
    const r = candidateReason(w, c);
    if (r) {
      f.rejectedBy[r] = (f.rejectedBy[r] ?? 0) + 1;
      if (c.anchor?.type === "intent") {
        if (!anchorReasons.has(c.anchor.id)) anchorReasons.set(c.anchor.id, new Map());
        const m = anchorReasons.get(c.anchor.id)!;
        m.set(r, (m.get(r) ?? 0) + 1);
      }
      continue;
    }
    if (!cfg.cities.includes(c.city!)) { f.rejectedBy.city_not_in_run = (f.rejectedBy.city_not_in_run ?? 0) + 1; continue; }
    passed.push(c);
  }
  f.passedHardFilters = passed.length;
  t = lap("filter", t);

  // 3. Score; dedupe by participant set (keep best).
  let scored: Scored[] = passed.map(c => scoreCandidate(w, c));
  const bySet = new Map<string, Scored>();
  for (const s of scored) {
    const k = [...s.c.participants].sort().join(",");
    const cur = bySet.get(k);
    if (!cur || s.score > cur.score || (s.score === cur.score && s.c.key < cur.c.key)) bySet.set(k, s);
  }
  f.deduped = scored.length - bySet.size;
  scored = [...bySet.values()].sort((a, b) => (a.c.key < b.c.key ? -1 : 1));
  t = lap("score", t);

  // 4. Optional LLM judge on the top configurations (one input, never the whole score).
  if (deps.llm && cfg.judge.enabled && cfg.judge.topK > 0) {
    const cache = deps.judgeCache ?? new JudgeCache(cfg.judge.ttlMs);
    const ranked = scored.filter(s => !s.reason || s.reason === "below_threshold").sort((a, b) => (b.score - a.score) || (a.c.key < b.c.key ? -1 : 1));
    const top = ranked.filter(s => s.c.participants.length <= 2).slice(0, cfg.judge.topK);
    const groups = ranked.filter(s => s.c.participants.length > 2).slice(0, cfg.judge.groupTopK);
    const toJudge = [...top, ...groups].map(s => s.c);
    const verdicts = await judgeCandidates(w, toJudge, deps.llm, cache, runLog.judge, runLog.judge.verdicts);
    scored = scored.map(s => (verdicts.has(s.c.key) && verdicts.get(s.c.key) ? scoreCandidate(w, s.c, verdicts.get(s.c.key)) : s));
    t = lap("judge", t);
  }
  for (const s of scored) {
    if (s.reason === "below_threshold") f.belowThreshold++;
    else if (s.reason === "dealbreaker") f.dealbreakers++;
    else if (s.reason) f.floorViolations[s.reason] = (f.floorViolations[s.reason] ?? 0) + 1;
    if (s.eligible) f.eligible++;
  }

  // 5. Global selection: exposure floor, greedy with load balancing + exposure debt, exploration.
  const priorDebt: Record<MemberId, number> = {};
  for (const [k, v] of Object.entries(input.exposureDebt ?? {})) priorDebt[w.canonical(k)] = (priorDebt[w.canonical(k)] ?? 0) + v;
  const { selected, budgetSkips } = selectProposals(w, scored, rng.fork("select"), priorDebt);
  f.budgetSkips = budgetSkips;
  f.selected = selected.length;
  f.exploration = selected.filter(s => s.exploration).length;
  t = lap("select", t);

  // 6. Proposals with shareable-only explanations.
  const proposals: EngineProposal[] = selected.map(sel => {
    const { c, components, score, threshold, verdict } = sel.s;
    const { explanations, objective } = explain(w, c, verdict as JudgeVerdict | null | undefined);
    const sameDay = c.window ? c.window.start - w.now < 24 * 3_600_000 : false;
    return {
      id: `p_${sha256(`${c.key}|${w.now}`).slice(0, 16)}`,
      kind: c.kind, participants: [...c.participants], alternates: [...c.alternates], objective,
      city: c.city!, window: c.window ? { ...c.window } : undefined, score: round(score), components: roundAll(components),
      exploration: sel.exploration || c.exploration, explanations, generator: c.generator, createdAt: w.now,
      category: c.category, roles: { ...c.roles }, expiresAt: w.now + (sameDay ? cfg.sameDayInviteTtlMs : cfg.inviteTtlMs),
      anchor: c.anchor ? { ...c.anchor } : undefined, via: c.via, safetyClass: c.safetyClass, threshold,
      channels: [...c.channels].sort(), judged: !!verdict, selectorRank: sel.rank, selectionProbability: round(sel.probability),
    };
  });
  for (const p of proposals) runLog.proposalsByGenerator[p.generator] = (runLog.proposalsByGenerator[p.generator] ?? 0) + 1;

  // 7. Logs: components for every scored configuration, fairness, empty states, debt.
  runLog.scored = scored.map(s => ({
    key: s.c.key, generator: s.c.generator, participants: s.c.participants, components: roundAll(s.components),
    score: round(s.score), eligible: s.eligible, reason: s.reason, judged: !!s.verdict,
  }));
  runLog.fairness = fairnessMetrics(w, selected, scored);
  runLog.blockingPairs = blockingPairs(selected, scored);
  runLog.exposureDebt = updateExposureDebt(w, priorDebt, scored, selected);
  const inProposal = new Set(proposals.flatMap(p => p.participants));
  const eligibleByIntent = new Map<string, boolean>();
  for (const s of scored) if (s.c.anchor?.type === "intent") eligibleByIntent.set(s.c.anchor.id, (eligibleByIntent.get(s.c.anchor.id) ?? false) || s.eligible);
  for (const id of w.ids) for (const it of w.get(id)!.intents) {
    if (w.now - it.createdAt < cfg.emptyStateDays * 86_400_000 || inProposal.has(id)) continue;
    let reason = "no_candidates";
    const own = memberReason(w, id, { category: it.category, role: "seeker", format: "one_to_one", timeSensitive: false, ownIntentCreatedAt: it.createdAt });
    if (own) continue; // the owner is not currently matchable (paused, held, over budget...): not an empty state
    if (ctx.unmatchedIntents.has(it.id)) reason = "density_gap";
    else if (eligibleByIntent.get(it.id)) reason = "budget_or_selection";
    else if (eligibleByIntent.has(it.id)) reason = "below_threshold";
    else if (anchorReasons.has(it.id)) reason = `filtered:${[...anchorReasons.get(it.id)!.entries()].sort((a, b) => b[1] - a[1])[0]![0]}`;
    runLog.emptyStates.push({ intentId: it.id, memberId: id, reason });
  }
  lap("finalize", t);
  timings.total = Math.round((performance.now() - t0) * 100) / 100;
  return { proposals, runLog };
}

const round = (x: number) => Math.round(x * 1e6) / 1e6;
function roundAll<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, round(v as number)])) as T;
}
