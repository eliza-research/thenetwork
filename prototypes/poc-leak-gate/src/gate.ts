// The outbound leak gate: deterministic layer first (free), then the LLM inference classifier.
// pass -> a LeakCheckedMessage (the only thing send() accepts); hold -> reasons for review.
import { mintLeakChecked, type LeakCheckedMessage } from "./brand.ts";
import { classifyLeak, CURRENT_CONTEXT, CURRENT_PROMPT, type ClassifierOptions, type ClassifierResult } from "./classifier.ts";
import { deterministicCheck, REVIEW_TOPICS, romanceOptInMissing, romanceWithoutOptIn, sensitiveMentionsAboutOthers } from "./deterministic.ts";
import type { Finding, GateInput, GateVerdict } from "./types.ts";

export const GATE_VERSION = `leak-gate/0.1 prompt:${CURRENT_PROMPT}`;
export const PIPELINE_VERSION = `leak-gate/0.2 prompt:${CURRENT_PROMPT} ctx:${CURRENT_CONTEXT}`;

export interface GateOptions extends ClassifierOptions {
  /** Include the lexicon sub-layer in the hold decision (default true). */
  useLexicon?: boolean;
  /** Skip the LLM when deterministic checks already hold (production default true; evals set false to measure layers). */
  shortCircuit?: boolean;
  /** Clock for the checkedAt stamp (Network code never calls Date.now directly). */
  now?: () => number;
}

export type GateOutcome =
  | { decision: "pass"; message: LeakCheckedMessage; verdict: GateVerdict }
  | { decision: "hold"; verdict: GateVerdict };

export async function runGate(input: GateInput, o: GateOptions = {}): Promise<GateOutcome> {
  const det = deterministicCheck(input);
  const useLex = o.useLexicon ?? true;
  const findings = det.findings.filter(f => useLex || f.layer !== "lexicon");
  let llm: GateVerdict["llm"];
  if (!(o.shortCircuit ?? true) || findings.length === 0) {
    const r = await classifyLeak(input, o);
    llm = { leak: r.leak, reasoning: r.reasoning, quote: r.quote, category: r.category, latencyMs: r.latencyMs, costMicro: r.costMicro, error: r.error };
    if (r.leak) findings.push({ layer: "llm", rule: `llm_${r.category ?? "leak"}`, detail: r.quote ? `"${r.quote}": ${r.reasoning}` : r.reasoning });
  }
  const verdict: GateVerdict = { decision: findings.length ? "hold" : "pass", findings, reason: findings[0] ? `${findings[0].rule}: ${findings[0].detail}` : "ok", llm };
  if (verdict.decision === "hold") return { decision: "hold", verdict };
  return { decision: "pass", verdict, message: mintLeakChecked(input.recipientId, input.draft, (o.now ?? (() => 0))(), GATE_VERSION) };
}

// ---------------------------------------------------------------------------------------------
// Production pipeline (fix 3): decide() -> SEND | HOLD_REVIEW | BLOCK, with reasons.
//   deterministic core hit                                  -> BLOCK (no LLM call)
//   LLM says leak                                           -> HOLD_REVIEW
//   LLM error / unparseable / timeout (async 15 s; live 8 s with a hedge at 4 s)         -> HOLD_REVIEW (fail closed, never SEND)
//   sensitive-word lexicon                                  -> HOLD_REVIEW only (never BLOCK)
//   dating / sexuality / legal / addiction about a non-recipient (lexicon or LLM topic tag)
//                                                           -> HOLD_REVIEW, even when shareable
//   romance framing (regex or LLM tag) without a recipient-visible opt-in from every co-participant
//                                                           -> HOLD_REVIEW
//   otherwise                                               -> SEND with a minted LeakCheckedMessage
// ---------------------------------------------------------------------------------------------

export type Decision = "SEND" | "HOLD_REVIEW" | "BLOCK";
export type ReasonCode = "deterministic" | "llm_leak" | "llm_error" | "llm_timeout" | "lexicon" | "sensitive_topic_other" | "romance_no_optin";

export interface DecideReason { code: ReasonCode; detail: string }

interface DecideBase {
  /** First reason by precedence, as one line ("ok" for SEND). */
  reason: string;
  /** Every signal that fired (also those that did not decide the outcome). */
  reasons: DecideReason[];
  findings: Finding[];
  llm?: Omit<ClassifierResult, "promptTokens" | "completionTokens"> & { timedOut?: boolean };
  pipelineVersion: string;
}
export type DecideResult =
  | (DecideBase & { decision: "SEND"; message: LeakCheckedMessage })
  | (DecideBase & { decision: "HOLD_REVIEW" | "BLOCK" });

export interface DecideOptions extends ClassifierOptions {
  /**
   * "async" (proactive outreach, default): 15 s deadline; nobody is waiting on the send.
   * "live" (reply inside a conversation): 8 s deadline plus a hedged second classifier request at 4 s,
   * first answer wins. Measured: 8 s alone held 4.3% of clean traffic on timeouts; 15 s held ~0%.
   */
  mode?: "async" | "live";
  /** LLM deadline override; on expiry the message is held for review. */
  timeoutMs?: number;
  /** Live mode: when to fire the hedged second request (default 4000 ms). */
  hedgeAfterMs?: number;
  /** Clock for the checkedAt stamp. */
  now?: () => number;
  /** Eval only: also run the LLM when the deterministic layer already blocks (to measure layers). */
  alwaysRunLLM?: boolean;
}

export const ASYNC_LLM_TIMEOUT_MS = 15000;
export const LIVE_LLM_TIMEOUT_MS = 8000;
export const LIVE_HEDGE_AFTER_MS = 4000;
/** Back-compat alias: the default (async) deadline. */
export const DEFAULT_LLM_TIMEOUT_MS = ASYNC_LLM_TIMEOUT_MS;

export const timeoutFor = (o: DecideOptions) => o.timeoutMs ?? (o.mode === "live" ? LIVE_LLM_TIMEOUT_MS : ASYNC_LLM_TIMEOUT_MS);

async function classifyWithDeadline(input: GateInput, o: DecideOptions): Promise<{ r?: ClassifierResult; timedOut: boolean }> {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const call = () => classifyLeak(input, o).catch((e): ClassifierResult => ({ leak: true, reasoning: "classifier threw; failing closed", error: String((e as Error)?.message ?? e).slice(0, 200), latencyMs: 0, costMicro: 0, promptTokens: 0, completionTokens: 0 }));
  const deadline = new Promise<"timeout">(res => { timers.push(setTimeout(() => res("timeout"), timeoutFor(o))); });
  const racers: Promise<ClassifierResult | "timeout">[] = [call(), deadline];
  // Live mode: hedge slow tails with a second request. A fast error still wins the race and fails closed (HOLD_REVIEW).
  if (o.mode === "live") racers.push(new Promise<ClassifierResult>(res => { timers.push(setTimeout(() => call().then(res), o.hedgeAfterMs ?? LIVE_HEDGE_AFTER_MS)); }));
  try {
    const r = await Promise.race(racers);
    return r === "timeout" ? { timedOut: true } : { r, timedOut: false };
  } finally { for (const t of timers) clearTimeout(t); }
}

export async function decide(input: GateInput, o: DecideOptions = {}): Promise<DecideResult> {
  const det = deterministicCheck(input);
  const reasons: DecideReason[] = [];
  for (const f of det.findings.filter(f => f.layer === "deterministic")) reasons.push({ code: "deterministic", detail: `${f.rule}: ${f.detail}` });
  for (const f of det.findings.filter(f => f.layer === "lexicon")) reasons.push({ code: "lexicon", detail: `${f.rule}: ${f.detail}` });
  for (const m of sensitiveMentionsAboutOthers(input)) reasons.push({ code: "sensitive_topic_other", detail: `${m.topic}: "${m.term}"` });
  const romance = romanceWithoutOptIn(input);
  if (romance) reasons.push({ code: "romance_no_optin", detail: `"${romance.framing}"; no visible opt-in from ${romance.missingOptIn.join(", ")}` });

  let llm: DecideBase["llm"];
  if (!det.core || o.alwaysRunLLM) {
    const { r, timedOut } = await classifyWithDeadline(input, o);
    if (timedOut) {
      reasons.push({ code: "llm_timeout", detail: `classifier exceeded ${timeoutFor(o)} ms` });
      llm = { leak: true, reasoning: "timeout; failing closed", latencyMs: timeoutFor(o), costMicro: 0, timedOut: true };
    } else if (r) {
      const { promptTokens: _p, completionTokens: _c, ...rest } = r;
      llm = rest;
      if (r.error) reasons.push({ code: "llm_error", detail: r.error });
      else if (r.leak) reasons.push({ code: "llm_leak", detail: r.quote ? `"${r.quote}" (${r.category ?? "leak"}): ${r.reasoning}` : r.reasoning });
      if (!r.error) {
        const t = (r.sensitiveTopicsAboutOthers ?? []).filter(x => (REVIEW_TOPICS as string[]).includes(x));
        if (t.length && !reasons.some(x => x.code === "sensitive_topic_other")) reasons.push({ code: "sensitive_topic_other", detail: `llm topics: ${t.join(", ")}` });
        if (r.romanceFraming && !romance) { const missing = romanceOptInMissing(input); if (missing.length) reasons.push({ code: "romance_no_optin", detail: `llm romance framing; no visible opt-in from ${missing.join(", ")}` }); }
      }
    }
  }

  const PRECEDENCE: ReasonCode[] = ["deterministic", "llm_leak", "llm_error", "llm_timeout", "romance_no_optin", "sensitive_topic_other", "lexicon"];
  reasons.sort((a, b) => PRECEDENCE.indexOf(a.code) - PRECEDENCE.indexOf(b.code));
  const base: DecideBase = { reason: reasons[0] ? `${reasons[0].code}: ${reasons[0].detail}` : "ok", reasons, findings: det.findings, llm, pipelineVersion: PIPELINE_VERSION };
  if (det.core) return { ...base, decision: "BLOCK" };
  if (reasons.length) return { ...base, decision: "HOLD_REVIEW" };
  return { ...base, decision: "SEND", message: mintLeakChecked(input.recipientId, input.draft, (o.now ?? (() => 0))(), PIPELINE_VERSION) };
}
