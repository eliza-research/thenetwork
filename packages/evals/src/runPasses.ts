// Judgment-passes suite: runs pass 1 (screen), pass 2 (rubric judge) and pass 3 (deep review) on
// EVERY recommender item (so each pass can be scored on its own), then derives the production
// pipeline (hard filters -> pass 1 -> pass 2 -> pass 3) from the same responses.
//
// Prompts come from the engine (packages/engine/src/judgeScreen.ts, judge.ts, judgeDeep.ts); the
// eval only adapts each item into the engine's inputs (World + Candidate). Labels (item.truth),
// item ids, sources and persona hidden truth never reach a prompt (see test/passes.test.ts).
import { parseJson, type MemberId } from "../../core/src/index.ts";
import { resolveConfig } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";
import { leaks as engineLeaks, privateVocabulary } from "../../engine/src/explain.ts";
import { intentFormat } from "../../engine/src/generators.ts";
import { buildJudgeMessages, parseVerdict } from "../../engine/src/judge.ts";
import { checkMemberFacing } from "../../engine/src/judgeCommon.ts";
import { buildDeepMessages, deepDecision, gateMemberFacing, hardGate, parseDeepVerdict, type DeepVerdict } from "../../engine/src/judgeDeep.ts";
import { buildPublicView, parseScreenVerdict, screenDecision, screenMessages, type ScreenVerdict } from "../../engine/src/judgeScreen.ts";
import type { Candidate, JudgeVerdict, Role } from "../../engine/src/types.ts";
import { World } from "../../engine/src/world.ts";
import { findCanaries } from "../../judge/src/rules.ts";
import { canariesOf } from "../../sim/src/persona.ts";
import type { RecDataset } from "./recDataset.ts";
import { itemTier, proxyBucket } from "./richness.ts";
import { leakChecks, type RecResult } from "./runRec.ts";
import { pmap, withScope, type HttpRecord, type RequestSettings } from "./transport.ts";
import type { RecItem } from "./types.ts";

export type PassName = "pass1" | "pass2" | "pass3";
export const PASSES: PassName[] = ["pass1", "pass2", "pass3"];

/** Fresh-spend guard shared by every call in a run (USD micro). Calls stop once it is exceeded. */
export class SpendGuard {
  fresh = 0;
  constructor(public limitMicro: number) {}
  add(records: HttpRecord[]) { for (const r of records) if (!r.cached) this.fresh += r.costMicro; }
  check() { if (this.fresh >= this.limitMicro) throw new Error(`spend limit reached ($${(this.fresh / 1e6).toFixed(2)})`); }
}

export interface PassRun<V> {
  ok: boolean; error?: string; verdict: V | null; attempts: number; records: HttpRecord[];
  /** Exactly what the model saw in the user message (parsed JSON), for error analysis. */
  visible: unknown;
}

export interface LeakSummary { canary: number; sensitive: number; scope: number; rules: number; gateRejected: number; afterGateCanary: number; afterGateSensitive: number }

export interface PassItemResult {
  itemId: string; world: string; model: string;
  /** Ground truth (results file only; never in a prompt). */
  label: { good: boolean; unsafe: boolean; unsafeReason?: string; hiddenRisk?: string; oracleFlags: string[]; quality: number; minEnjoyment: number };
  meta: { group: boolean; source: string; kind: string; category: string; objective: string; tier?: string; proxyBucket: string };
  refs: Record<string, MemberId>;
  hardGate: string | null;
  pass1: PassRun<ScreenVerdict>; pass2: PassRun<JudgeVerdict>; pass3: PassRun<DeepVerdict>;
  /** Member-facing text that survived each pass's leak gate. */
  memberFacing: { pass1: string; pass2: Record<string, string>; pass3: Record<string, string> };
  leaks: Record<PassName, LeakSummary>;
  /**
   * HIDDEN truth for error analysis only (never in any prompt): each person's richness tier and the
   * correct / stale / wrong_inference label of every connected-source fact the Network holds.
   */
  hidden: { byRef: Record<string, { tier?: string; sourceTruth: { kind: string; value: string; source?: string; truth: string; note?: string }[] }> };
  /** Canary tokens found in INTERNAL reasoning (must be 0: canaries are redacted before any prompt). */
  internalCanaries: number;
}

export interface PassRunOptions {
  cacheDir: string; settings: RequestSettings; concurrency: number;
  maxTokens: { pass1: number; pass2: number; pass3: number };
  offline?: boolean; fetch?: (url: string, init: RequestInit) => Promise<Response>;
  guard?: SpendGuard; onProgress?: (done: number, total: number) => void;
  passes?: PassName[];
}

/** One engine World per eval world (built from the FINAL snapshot, incl. adversarial blocks). */
export function engineWorlds(ds: RecDataset): Map<string, World> {
  const out = new Map<string, World>();
  for (const [id, w] of ds.worlds) out.set(id, new World(w.snapshot(), resolveConfig({ seed: 1 }), localEmbed));
  return out;
}

/** Adapt an eval item into the engine's Candidate (no labels; anchor = the intent the objective quotes). */
export function candidateOf(w: World, item: RecItem): Candidate {
  const cfg = item.config;
  let anchor: Candidate["anchor"];
  let anchorIntent: Parameters<typeof intentFormat>[0] | undefined;
  for (const id of cfg.participants) {
    const it = w.get(id)?.intents.find(i => cfg.objective.endsWith(i.objective));
    if (it) { anchor = { type: "intent", id: it.id }; anchorIntent = it; break; }
  }
  // Format as the engine's generators would set it: groups meet as a small group; a pair anchored
  // on an intent uses that intent's format (engine intentFormat); other pairs are one-to-one.
  return {
    key: `eval:${cfg.participants.join(",")}`, kind: cfg.kind, generator: "eval", category: cfg.category,
    participants: [...cfg.participants], roles: Object.fromEntries(Object.entries(cfg.roles).map(([k, v]) => [k, v as Role])),
    format: cfg.participants.length > 2 ? "small_group" : anchorIntent ? intentFormat(anchorIntent) : "one_to_one", objective: cfg.objective, anchor, via: cfg.via,
    preferredCity: cfg.city, city: cfg.city, window: { ...cfg.window }, channels: new Set(), evidence: {}, fit: 0, benefit: {},
    warm: 0, alternates: [], exploration: false, safetyClass: "low", timeSensitive: false, riskText: cfg.objective,
  };
}

async function call<V>(model: string, o: PassRunOptions, maxTokens: number, messages: { role: "system" | "user" | "assistant"; content: string }[],
  parse: (raw: unknown) => V): Promise<PassRun<V>> {
  const records: HttpRecord[] = [];
  const visible = JSON.parse(messages[messages.length - 1]!.content);
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try { o.guard?.check(); } catch (e) { return { ok: false, error: String((e as Error).message), verdict: null, attempts: attempt, records, visible }; }
    const r = await withScope(model, { attempt, cacheDir: o.cacheDir, settings: o.settings, offline: o.offline, fetch: o.fetch }, async llm => {
      const out = await llm.chat(messages, { maxTokens, json: true });
      return parse(parseJson(out));
    });
    records.push(...r.records);
    o.guard?.add(r.records);
    if (r.value !== undefined) return { ok: true, verdict: r.value, attempts: attempt + 1, records, visible };
    lastErr = r.error ?? "unknown";
  }
  return { ok: false, error: lastErr, verdict: null, attempts: 2, records, visible };
}

const SKIPPED = <V>(): PassRun<V> => ({ ok: false, error: "skipped", verdict: null, attempts: 0, records: [], visible: null });

export async function runPasses(model: string, ds: RecDataset, o: PassRunOptions): Promise<PassItemResult[]> {
  const worlds = engineWorlds(ds);
  const want = new Set(o.passes ?? PASSES);
  return pmap(ds.items, o.concurrency, async (item): Promise<PassItemResult> => {
    const ew = ds.worlds.get(item.world)!;
    const snap = ew.snapshot();
    const w = worlds.get(item.world)!;
    const c = candidateOf(w, item);
    const view = buildPublicView(snap, item.config);
    const attending = Object.entries(view.refs).filter(([, id]) => item.config.participants.includes(id)).map(([r]) => r);
    const j = buildJudgeMessages(w, c);
    const d = buildDeepMessages(w, c);
    const [p1, p2, p3] = await Promise.all([
      want.has("pass1") ? call(model, o, o.maxTokens.pass1, screenMessages(view), raw => parseScreenVerdict(raw, attending)) : SKIPPED<ScreenVerdict>(),
      want.has("pass2") ? call(model, o, o.maxTokens.pass2, j.messages, raw => parseVerdict(raw, j.refs)) : SKIPPED<JudgeVerdict>(),
      want.has("pass3") ? call(model, o, o.maxTokens.pass3, d.messages, raw => parseDeepVerdict(raw, attending)) : SKIPPED<DeepVerdict>(),
    ]);

    // Member-facing text and leak checks per pass (raw model text, then after the deterministic gate).
    const ids = [...item.config.participants, ...(item.config.via ? [item.config.via] : [])];
    const vocab = privateVocabulary(w, ids);
    const canaries = canariesOf(ew.personas).map(x => x.canary);
    const rawLeaks = (text: string) => leakChecks(ds, item, view, text);
    const summary = (raw: string, kept: string, rejected: number): LeakSummary => {
      const a = rawLeaks(raw), b = rawLeaks(kept);
      return {
        canary: a.canary.length ? 1 : 0, sensitive: a.sensitive.length ? 1 : 0, scope: a.scope.length ? 1 : 0, rules: a.rules.length ? 1 : 0,
        gateRejected: rejected, afterGateCanary: b.canary.length ? 1 : 0, afterGateSensitive: b.sensitive.length ? 1 : 0,
      };
    };
    const why1 = p1.verdict && screenDecision(p1.verdict) ? p1.verdict.memberWhy : "";
    const why1ok = why1 && checkMemberFacing(why1, vocab).ok ? why1 : "";
    const why2raw: Record<string, string> = {}, why2: Record<string, string> = {};
    let rej2 = 0;
    if (p2.verdict && p2.verdict.verdict === "yes") for (const [ref, id] of Object.entries(j.refs)) {
      const t = p2.verdict.why[id];
      if (!t) continue;
      why2raw[ref] = t;
      if (!engineLeaks(t, vocab) && checkMemberFacing(t, vocab).ok) why2[ref] = t; else rej2++;
    }
    const g3 = p3.verdict ? gateMemberFacing(w, c, p3.verdict, d.refs) : { why: {}, rejected: [] };
    const why3raw = p3.verdict && p3.verdict.verdict === "yes" ? Object.values(p3.verdict.memberWhy).join(" ") : "";
    const why3: Record<string, string> = {};
    for (const [ref, id] of Object.entries(d.refs)) if (g3.why[id]) why3[ref] = g3.why[id]!;
    const internal = [
      p1.verdict?.reasoning, p2.verdict?.reasoning, p3.verdict?.evidenceReview, p3.verdict?.steelmanFor, p3.verdict?.steelmanAgainst, p3.verdict?.reasoning,
      ...(p1.verdict?.citedFacts ?? []).map(f => f.fact), ...(p2.verdict?.citedFacts ?? []).map(f => f.fact), ...(p3.verdict?.citedFacts ?? []).map(f => f.fact),
    ].filter(Boolean).join("\n");

    const t = item.truth;
    const hidden: PassItemResult["hidden"] = { byRef: {} };
    for (const [ref, id] of Object.entries(view.refs)) {
      const p = ew.byId.get(id);
      const k = p?.knowledge;
      const sourceTruth: PassItemResult["hidden"]["byRef"][string]["sourceTruth"] = [];
      if (k) for (const f of snap.facets) {
        if (f.memberId !== id) continue;
        const m = /:s\d+:(\d+)$/.exec(f.id);
        const o = m ? k.observations[Number(m[1])] : undefined;
        if (o) sourceTruth.push({ kind: f.kind, value: f.value, source: f.source, truth: o.truth, ...(o.note ? { note: o.note } : {}) });
      }
      hidden.byRef[ref] = { tier: p?.hidden.richness, sourceTruth };
    }
    return {
      itemId: item.id, world: item.world, model,
      label: { good: t.good, unsafe: t.unsafe, unsafeReason: t.unsafeReason, hiddenRisk: t.hiddenRisk, oracleFlags: t.oracleFlags, quality: t.quality, minEnjoyment: t.minEnjoyment },
      meta: {
        group: item.group, source: item.source, kind: item.config.kind, category: item.config.category, objective: item.config.objective,
        tier: itemTier(ew, snap, item.config.participants), proxyBucket: proxyBucket(snap, item.config.participants),
      },
      refs: view.refs, hardGate: hardGate(w, c),
      pass1: p1, pass2: p2, pass3: p3,
      memberFacing: { pass1: why1ok, pass2: why2, pass3: why3 },
      leaks: {
        pass1: summary(why1, why1ok, why1 && !why1ok ? 1 : 0),
        pass2: summary(Object.values(why2raw).join(" "), Object.values(why2).join(" "), rej2),
        pass3: summary(why3raw, Object.values(why3).join(" "), g3.rejected.length),
      },
      internalCanaries: findCanaries(internal, canaries).length,
      hidden,
    };
  }, done => o.onProgress?.(done, ds.items.length));
}

// ---- decisions ---------------------------------------------------------------------------------

export type D3 = "yes" | "no" | "abstain";

/** Model-only decision for one pass (null = the call failed). */
export function passDecision(r: PassItemResult, p: PassName): D3 | null {
  if (p === "pass1") { const v = r.pass1.verdict; return v ? (screenDecision(v) ? "yes" : "no") : null; }
  if (p === "pass2") { const v = r.pass2.verdict; return v ? (pass2Yes(v) ? "yes" : "no") : null; }
  const v = r.pass3.verdict;
  return v ? (v.verdict === "insufficient_information" ? "abstain" : deepDecision(v) ? "yes" : "no") : null;
}

/** Pass-2 "yes" mirrors the engine: verdict yes, no dealbreaker, every dimension at or above the judge floor. */
export const PASS2_FLOOR = resolveConfig({}).floors.judgeDimension;
export function pass2Yes(v: JudgeVerdict): boolean {
  return v.verdict === "yes" && !v.dealbreaker && Math.min(v.fit, v.mutualValue, v.capacityRealism, v.timing, v.socialComfort) >= PASS2_FLOOR;
}

export function passProb(r: PassItemResult, p: PassName): number | null {
  const v = r[p].verdict as { matchProbability?: number } | null;
  return v && typeof v.matchProbability === "number" ? v.matchProbability : null;
}

/**
 * Production pipeline from the same responses: hard gate, then pass 1, pass 2, pass 3 in order,
 * stopping at the first "no" (abstain at pass 3 = not proposed). A failed call is skipped (fails
 * open to the previous stage, as the engine does). Returns the decision, the stage it stopped at,
 * and a ranking score (min probability over the stages reached).
 */
export function pipeline(r: PassItemResult, stages: PassName[] = PASSES): { decision: D3; stoppedAt: string; prob: number; reached: PassName[] } {
  if (r.hardGate) return { decision: "no", stoppedAt: `hard_gate:${r.hardGate}`, prob: 0, reached: [] };
  let prob = 1;
  const reached: PassName[] = [];
  for (const p of stages) {
    reached.push(p);
    const d = passDecision(r, p);
    const pr = passProb(r, p);
    if (pr !== null) prob = Math.min(prob, pr);
    if (d === null) continue;
    if (d !== "yes") return { decision: d, stoppedAt: p, prob, reached };
  }
  return { decision: "yes", stoppedAt: "proposed", prob, reached };
}

// ---- per-item export for error analysis -------------------------------------------------------

/** Compact per-item record: {itemId, label, perPassVerdicts, explanations, confidence, visibleProfiles, ...}. */
export function itemRecord(r: PassItemResult, baseline?: RecResult) {
  const p1 = r.pass1.verdict, p2 = r.pass2.verdict, p3 = r.pass3.verdict;
  const pipe = pipeline(r);
  const correct = (d: D3 | null) => (d === null ? false : (d === "yes") === r.label.good);
  return {
    itemId: r.itemId, world: r.world, model: r.model,
    label: { good: r.label.good, unsafe: r.label.unsafe, unsafeReason: r.label.unsafeReason ?? null, hiddenRisk: r.label.hiddenRisk ?? null, oracleFlags: r.label.oracleFlags, quality: r.label.quality, minEnjoyment: r.label.minEnjoyment },
    meta: r.meta,
    hardGate: r.hardGate,
    perPassVerdicts: {
      baseline: baseline ? (baseline.prediction ? (baseline.prediction.goodMatch && !baseline.prediction.dealbreaker ? "yes" : "no") : "error") : null,
      pass1: p1 ? passDecision(r, "pass1") : `error: ${r.pass1.error}`,
      pass2: p2 ? passDecision(r, "pass2") : `error: ${r.pass2.error}`,
      pass3: p3 ? passDecision(r, "pass3") : `error: ${r.pass3.error}`,
      pipeline: pipe.decision, pipelineStoppedAt: pipe.stoppedAt,
    },
    correct: {
      baseline: baseline?.prediction ? (baseline.prediction.goodMatch && !baseline.prediction.dealbreaker) === r.label.good : false,
      pass1: correct(passDecision(r, "pass1")), pass2: correct(passDecision(r, "pass2")), pass3: correct(passDecision(r, "pass3")),
      pipeline: (pipe.decision === "yes") === r.label.good,
    },
    confidence: {
      baseline: baseline?.prediction?.matchProbability ?? null,
      pass1: p1?.matchProbability ?? null, pass2: p2?.matchProbability ?? null, pass2Certainty: p2 ? Math.round((p2.certainty * 4 + 1) * 10) / 10 : null,
      pass3: p3?.matchProbability ?? null,
    },
    explanations: {
      baseline: baseline?.prediction?.why ?? null,
      pass1: p1 ? { reasoning: p1.reasoning, citedFacts: p1.citedFacts, dealbreaker: p1.dealbreaker, dealbreakerReason: p1.dealbreakerReason ?? null, memberWhy: p1.memberWhy, reasoningFirst: p1.reasoningFirst } : null,
      pass2: p2 ? {
        reasoning: p2.reasoning, citedFacts: p2.citedFacts, reasoningFirst: p2.reasoningFirst,
        dimensions: { fit: d5(p2.fit), mutual_value: d5(p2.mutualValue), capacity_realism: d5(p2.capacityRealism), timing: d5(p2.timing), social_comfort: d5(p2.socialComfort), red_flags: d5(p2.redFlags) },
        dealbreaker: p2.dealbreaker, dealbreakerReason: p2.dealbreakerReason ?? null, why: p2.why,
      } : null,
      pass3: p3 ? {
        evidenceReview: p3.evidenceReview, steelmanFor: p3.steelmanFor, steelmanAgainst: p3.steelmanAgainst, rubric: p3.rubric,
        wouldThankUs: p3.wouldThankUs, reasoning: p3.reasoning, citedFacts: p3.citedFacts, question: p3.question ?? null,
        memberWhy: p3.memberWhy, reasoningFirst: p3.reasoningFirst,
      } : null,
    },
    memberFacingAfterGate: r.memberFacing,
    leaks: r.leaks,
    refs: r.refs,
    /** Hidden truth (tier, source-fact truth labels). Never shown to any model. */
    hidden: r.hidden,
    visibleProfiles: { pass1: r.pass1.visible, pass2: r.pass2.visible, pass3: r.pass3.visible },
  };
}
const d5 = (x: number) => Math.round(x * 4 + 1);
