// Shared by the relay sim block (scripts/sim/relay.ts) and the Clef relay CLI (scripts/relay-eval.ts):
// the relay corpora, the recorded Clef answers (evals/relay/clef-answers.jsonl) and the rows the
// decision layer is fitted and scored on. Nothing here calls Clef.
import { join } from "node:path";
import { relayItem, type RelayContext, type RelayItem } from "../packages/engine/src/relay.ts";
import { clefFeatureRow, type ClefModel, type ClefResult } from "../packages/engine/src/packs/slop/clef.ts";
import { RELAY_CLEF_BANK_VERSION, RELAY_CLEF_QUESTIONS, relayClefKey, type RelayClefCacheRow } from "../packages/engine/src/relayClef.ts";
import { reasonCategories, type RelayClass, type RelayFitRow } from "../packages/engine/src/relayClefFit.ts";

export const EVALS = join(import.meta.dir, "..", "evals");
/** The recorded Clef answers for the corpora (one row per model x text; no text, keyed by hash). */
export const CLEF_CACHE = `${EVALS}/relay/clef-answers.jsonl`;
/** Fitted decision-layer weights (written by `bun run relay-eval fit --live`). */
export const CLEF_WEIGHTS = `${EVALS}/relay/clef-relay-weights.json`;
/** The files the rules were tuned on: the Clef decision layer may be fitted on these. */
export const TUNING_FILES = ["relay/relay.jsonl", "relay/relay-paraphrases.jsonl", "relay/relay-heldout-1.jsonl"] as const;
/** Written after the rules' tuning: scored, NEVER fitted on. */
export const HELDOUT_FILE = "relay/relay-heldout-2.jsonl";
export const BENIGN_FILE = "network/benign-adult.txt";

export type CorpusRow = { text: string; class: RelayClass; want: "pass" | "stop" };
export async function loadCorpus(file: string): Promise<CorpusRow[]> {
  const raw = (await Bun.file(`${EVALS}/${file}`).text()).trim();
  if (file.endsWith(".txt")) return raw.split("\n").filter(Boolean).map(text => ({ text, class: "honest", want: "pass" }));
  return raw.split("\n").filter(Boolean).map(l => JSON.parse(l) as CorpusRow);
}

const NOW = Date.UTC(2026, 9, 9, 18);
/** A mutual opportunity between Sam (a) and Riley (b), both adults, nothing held or blocked. */
export function baseCtx(over: Partial<RelayContext> = {}): RelayContext {
  return {
    now: NOW,
    opportunity: { id: "op1", app: "slop", participants: ["a", "b"], acceptedBy: ["a", "b"], status: "mutual" },
    sender: { id: "a", firstName: "Sam", age: 29, photoIds: ["ph_abcdefgh"], photoConsent: true },
    recipient: { id: "b", firstName: "Riley", age: 31, photoIds: ["ph_ijklmnop"], photoConsent: true },
    blocked: false, history: [], ...over,
  };
}
export const textItem = (t: string, id = "i1", at = NOW): RelayItem => ({ id, kind: "text", from: "a", to: "b", at, text: t });

/** Read the cache (rows for the current question bank only). Missing file -> null. */
export async function loadClefCache(path = CLEF_CACHE): Promise<Map<string, RelayClefCacheRow> | null> {
  const f = Bun.file(path);
  if (!(await f.exists())) return null;
  const out = new Map<string, RelayClefCacheRow>();
  for (const l of (await f.text()).split("\n")) {
    if (!l.trim()) continue;
    try { const r = JSON.parse(l) as RelayClefCacheRow; if (r?.key && r.bank === RELAY_CLEF_BANK_VERSION && r.answers) out.set(r.key, r); } catch { /* skip a torn line */ }
  }
  return out;
}
export const cacheLookup = (cache: ReadonlyMap<string, RelayClefCacheRow>) => (key: string): ClefResult | undefined => {
  const r = cache.get(key);
  return r ? { answers: r.answers, ...(r.inputTokens ? { usage: { input_tokens: r.inputTokens } } : {}) } : undefined;
};

/** Corpus rows joined with their cached answers and the rules' decision. Rows without an answer are counted. */
export function fitRows(rows: readonly CorpusRow[], cache: ReadonlyMap<string, RelayClefCacheRow>, model: ClefModel): { rows: RelayFitRow[]; missing: number; tokens: number } {
  const out: RelayFitRow[] = [];
  let missing = 0, tokens = 0;
  for (const r of rows) {
    const c = cache.get(relayClefKey(model, r.text.trim()));
    if (!c) { missing++; continue; }
    tokens += c.inputTokens ?? 0;
    const { x, confidence } = clefFeatureRow(RELAY_CLEF_QUESTIONS, c.answers);
    const rules = relayItem(textItem(r.text), baseCtx());
    out.push({ cls: r.class, x, confidence, rulesStopped: rules.decision !== "pass", rulesCategories: [...reasonCategories(rules.reasons)] });
  }
  return { rows: out, missing, tokens };
}
