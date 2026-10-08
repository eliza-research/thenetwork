// Judgment-passes suite: runs pass 1 (screen), pass 2 (rubric judge) and pass 3 (deep review) on
// EVERY recommender item (so each pass can be scored on its own), then derives the production
// pipeline (hard filters -> pass 1 -> pass 2 -> pass 3) from the same responses.
//
// Prompts, parsers and decision rules come from the engine (packages/engine/src/judgeContext.ts,
// judgeScreen.ts, judge.ts, judgeDeep.ts); the eval only adapts each item into the engine's inputs
// (World + Candidate). The two historical v3 prompts for passes 1 and 3, which the engine no longer
// ships, come from historicalPrompts.ts (judge-v2 replay). Labels (item.truth), item ids, sources and
// persona hidden truth never reach a prompt (see test/passes.test.ts).
import { tryChatJson, type ChatMessage, type MemberId, type WorldSnapshot } from "../../core/src/index.ts";
import { resolveConfig } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";
import { leaks as engineLeaks, privateVocabulary } from "../../engine/src/explain.ts";
import { intentFormat } from "../../engine/src/generators.ts";
import { buildJudgeMessages, parseVerdict, passOutcome, pipelineDecision, type PassName, type PassOutcome } from "../../engine/src/judge.ts";
import { attendingRefs, checkMemberFacing, passMessages } from "../../engine/src/judgeCommon.ts";
import { buildDeepContext, buildPublicView, type PublicView, type ScreenConfig } from "../../engine/src/judgeContext.ts";
import { buildDeepMessages, gateMemberFacing, hardGate, parseDeepVerdict, type DeepVerdict } from "../../engine/src/judgeDeep.ts";
import { parseScreenVerdict, SCREEN_SYSTEM, screenMessages, type ScreenVerdict } from "../../engine/src/judgeScreen.ts";
import type { Candidate, JudgeVerdict, Role } from "../../engine/src/types.ts";
import { World } from "../../engine/src/world.ts";
import { findCanaries } from "../../judge/src/rules.ts";
import { canariesOf } from "../../sim/src/persona.ts";
import type { RecDataset } from "./recDataset.ts";
import { itemTier, proxyBucket } from "./richness.ts";
import { leakChecks, type RecResult } from "./runRec.ts";
import { DEEP_SYSTEM_V3, SCREEN_SYSTEM_V3 } from "./historicalPrompts.ts";
import { attemptScopes, errorText, pmap, type HttpRecord, type RequestSettings } from "./transport.ts";
import type { RecItem } from "./types.ts";

export type { PassName };
export const PASSES: PassName[] = ["pass1", "pass2", "pass3"];

/**
 * Fresh-spend guard shared by every call in a run (USD micro). A call may start only if the spend
 * so far plus every call already in flight (each priced at the most expensive call seen) stays
 * within the limit, so concurrent workers cannot overshoot by a whole batch. `check` starts a call,
 * `settle` ends it; `add` books records from elsewhere (a baseline run).
 */
export class SpendGuard {
  fresh = 0;
  inFlight = 0;
  maxCallMicro = 0;
  constructor(public limitMicro: number) {}
  add(records: HttpRecord[]) { for (const r of records) if (!r.cached) this.fresh += r.costMicro; }
  check() {
    if (this.fresh + (this.inFlight + 1) * this.maxCallMicro > this.limitMicro || this.fresh >= this.limitMicro)
      throw new Error(`spend limit reached ($${(this.fresh / 1e6).toFixed(2)} spent, ${this.inFlight} calls in flight)`);
    this.inFlight++;
  }
  settle(records: HttpRecord[]) {
    const cost = records.filter(r => !r.cached).reduce((s, r) => s + r.costMicro, 0);
    this.fresh += cost;
    this.maxCallMicro = Math.max(this.maxCallMicro, cost);
    this.inFlight = Math.max(0, this.inFlight - 1);
  }
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
  label: { good: boolean; unsafe: boolean; unsafeReason?: string; hiddenRisk?: string; oracleFlags: string[]; quality: number; minEnjoyment: number; pGood?: number; drawnGood?: boolean };
  split?: string;
  variants?: PassVariants;
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
  /** Prompt version per pass (default: NEW_VARIANTS, the judge-v2 "new" arm; ENGINE_VARIANTS = what the engine ships). */
  variants?: PassVariants;
  /** Added to the eval attempt number: a non-zero offset re-samples the same prompt (new cache key). */
  attemptOffset?: number;
}

/** Prompt versions: pass 1 pass1-screen-v2|v3, pass 2 judge-v2.1|v3, pass 3 pass3-deep-v2|v3. */
export interface PassVariants { pass1: "v2" | "v3"; pass2: "v2.1" | "v3"; pass3: "v2" | "v3" }
export const OLD_VARIANTS: PassVariants = { pass1: "v2", pass2: "v2.1", pass3: "v2" };
export const NEW_VARIANTS: PassVariants = { pass1: "v3", pass2: "v3", pass3: "v3" };
/** The prompts the engine ships (pass1-screen-v2, judge-v3 under the default pass2Context, pass3-deep-v2). */
export const ENGINE_VARIANTS: PassVariants = { pass1: "v2", pass2: "v3", pass3: "v2" };

/** Pass-1 messages for a variant (v2 = the engine's prompt; v3 = historical). */
export function screenVariantMessages(view: PublicView, v: PassVariants["pass1"]): ChatMessage[] {
  return screenMessages(view, v === "v3" ? SCREEN_SYSTEM_V3 : SCREEN_SYSTEM);
}
/** Pass-3 messages for a variant (v2 = the engine's prompt; v3 = historical, on the v3 context). */
export function deepVariantMessages(w: World, c: Candidate, v: PassVariants["pass3"]): { messages: ChatMessage[]; refs: Record<string, MemberId> } {
  if (v === "v2") return buildDeepMessages(w, c);
  const { context, refs } = buildDeepContext(w, c, { version: "v3" });
  return { refs, messages: passMessages(DEEP_SYSTEM_V3, context) };
}
/** The exact messages one pass sends for an item under a prompt variant. */
export function variantMessages(pass: PassName, v: string, snap: WorldSnapshot, cfg: ScreenConfig, w: World, c: Candidate): ChatMessage[] {
  if (pass === "pass1") return screenVariantMessages(buildPublicView(snap, cfg, { version: v as PassVariants["pass1"] }), v as PassVariants["pass1"]);
  if (pass === "pass2") return buildJudgeMessages(w, c, v as PassVariants["pass2"]).messages;
  return deepVariantMessages(w, c, v as PassVariants["pass3"]).messages;
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

async function call<V>(model: string, o: PassRunOptions, maxTokens: number, messages: ChatMessage[], parse: (raw: unknown) => V): Promise<PassRun<V>> {
  const records: HttpRecord[] = [];
  const visible = JSON.parse(messages[messages.length - 1]!.content);
  const scopes = attemptScopes(model, { cacheDir: o.cacheDir, settings: o.settings, offline: o.offline, fetch: o.fetch }, o.attemptOffset ?? 0);
  const r = await tryChatJson(scopes.llm, messages, parse, {
    attempts: 2, maxTokens,
    beforeAttempt: () => o.guard?.check(),
    afterAttempt: () => { const rs = scopes.records(); records.push(...rs); o.guard?.settle(rs); },
  });
  if (r.ok) return { ok: true, verdict: r.value, attempts: r.attempts, records, visible };
  return { ok: false, error: r.stopped ? String((r.error as Error).message) : errorText(r.error), verdict: null, attempts: r.attempts, records, visible };
}

const SKIPPED = <V>(): PassRun<V> => ({ ok: false, error: "skipped", verdict: null, attempts: 0, records: [], visible: null });

export async function runPasses(model: string, ds: RecDataset, o: PassRunOptions): Promise<PassItemResult[]> {
  const worlds = engineWorlds(ds);
  const want = new Set(o.passes ?? PASSES);
  const vv = o.variants ?? NEW_VARIANTS;
  return pmap(ds.items, o.concurrency, async (item): Promise<PassItemResult> => {
    const ew = ds.worlds.get(item.world)!;
    const snap = ew.snapshot();
    const w = worlds.get(item.world)!;
    const c = candidateOf(w, item);
    const view = buildPublicView(snap, item.config, { version: vv.pass1 });
    const attending = attendingRefs(view.refs, item.config);
    const j = buildJudgeMessages(w, c, vv.pass2);
    const d = deepVariantMessages(w, c, vv.pass3);
    const [p1, p2, p3] = await Promise.all([
      want.has("pass1") ? call(model, o, o.maxTokens.pass1, screenVariantMessages(view, vv.pass1), raw => parseScreenVerdict(raw, attending)) : SKIPPED<ScreenVerdict>(),
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
    const why1 = p1.verdict && passOutcome("pass1", p1.verdict) === "yes" ? p1.verdict.memberWhy : "";
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
      label: { good: t.good, unsafe: t.unsafe, unsafeReason: t.unsafeReason, hiddenRisk: t.hiddenRisk, oracleFlags: t.oracleFlags, quality: t.quality, minEnjoyment: t.minEnjoyment, ...(t.pGood !== undefined ? { pGood: t.pGood, drawnGood: t.drawnGood } : {}) },
      ...(item.split ? { split: item.split } : {}), variants: vv,
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

export type D3 = PassOutcome;

/** Model-only decision for one pass (null = the call failed). The rules are the engine's (judge.ts passOutcome). */
export function passDecision(r: PassItemResult, p: PassName): D3 | null {
  if (p === "pass1") return r.pass1.verdict ? passOutcome("pass1", r.pass1.verdict) : null;
  if (p === "pass2") return r.pass2.verdict ? passOutcome("pass2", r.pass2.verdict) : null;
  return r.pass3.verdict ? passOutcome("pass3", r.pass3.verdict) : null;
}

export function passProb(r: PassItemResult, p: PassName): number | null {
  const v = r[p].verdict as { matchProbability?: number } | null;
  return v && typeof v.matchProbability === "number" ? v.matchProbability : null;
}

/**
 * Production pipeline from the same responses (the engine's judge.ts pipelineDecision): hard gate,
 * then the passes in order, stopping at the first "no" (abstain at pass 3 = not proposed); a failed
 * call fails open to the previous stage. Adds a ranking score: min probability over the stages reached.
 */
export function pipeline(r: PassItemResult, stages: PassName[] = PASSES): { decision: D3 | null; stoppedAt: string; prob: number | null; reached: PassName[]; failed: PassName[] } {
  const outcomes = stages.map(p => ({ pass: p, outcome: passDecision(r, p) }));
  const res = pipelineDecision(r.hardGate, outcomes);
  const failed = res.reached.filter(p => passDecision(r, p) === null);
  // No stage answered: there is no decision to score. Never report "yes" with prob 1 for a run
  // where every call failed (the production pipeline fails open per stage; the eval must not).
  if (!r.hardGate && res.reached.length && failed.length === res.reached.length) return { decision: null, stoppedAt: "all_failed", prob: null, reached: res.reached, failed };
  let prob = r.hardGate ? 0 : 1;
  for (const p of res.reached) { const pr = passProb(r, p); if (pr !== null) prob = Math.min(prob, pr); }
  return { decision: res.decision, stoppedAt: res.stoppedAt, prob, reached: res.reached, failed };
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
