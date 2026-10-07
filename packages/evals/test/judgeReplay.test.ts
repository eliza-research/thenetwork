// Replay of RECORDED model responses through the current pass code (no LLM calls, no keys).
//
// fixtures/judge-v2-replay.json was cut from the judge-v2 run (runs/evals/results/judge-v2-{dev,test}
// .items.jsonl, responses from runs/evals/cache, gpt-6-luna): 15 items x {old, new} prompt arms x
// passes 1-3, chosen to cover every outcome (yes / no / abstain, retry after a schema failure, a
// pass that failed twice, hard-gate rejections, groups). Each entry holds the raw reply of every
// attempt the run made, the cache keys of those requests, and the verdicts the run recorded.
// This test feeds the replies through core tryChatJson + the engine parsers and decision rules and
// checks that the per-pass decisions, confidences, explanations, error texts and pipeline decision
// are identical to what was recorded. datasetV2.test.ts checks the cache keys (prompt bytes).
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { tryChatJson, type ChatMessage, type LLM } from "../../core/src/index.ts";
import { parseVerdict } from "../../engine/src/judge.ts";
import { parseDeepVerdict } from "../../engine/src/judgeDeep.ts";
import { parseScreenVerdict } from "../../engine/src/judgeScreen.ts";
import { itemRecord, type PassItemResult, type PassName, type PassRun } from "../src/runPasses.ts";
import { errorText } from "../src/transport.ts";
import fixture from "./fixtures/judge-v2-replay.json";

interface ReplayFixture {
  maxTokens: Record<PassName, number>;
  items: {
    itemId: string; world: string; attendingRefs: Record<string, string>;
    arms: Record<"old" | "new", {
      passes: Record<PassName, { variant: string; keys: string[]; replies: string[] }>;
      expected: { hardGate: string | null; perPassVerdicts: Record<string, unknown>; confidence: Record<string, unknown>; explanationsSha256: string };
    }>;
  }[];
}
const REPLAY = fixture as unknown as ReplayFixture;

const PASSES: PassName[] = ["pass1", "pass2", "pass3"];
const sha = (x: unknown) => createHash("sha256").update(JSON.stringify(x)).digest("hex");
/** Serves the recorded replies in order (attempt n gets reply n), like the cache did. */
const recorded = (replies: string[]): LLM => { let i = 0; return { chat: async () => replies[i++] ?? "" }; };
const DUMMY: ChatMessage[] = [{ role: "system", content: "" }, { role: "user", content: "{}" }];
/** itemRecord fields carry a `baseline` slot the judge-v2 run filled for the old arm only. */
const noBase = (x: Record<string, unknown>) => ({ ...x, baseline: undefined });

async function replayPass(p: PassName, replies: string[], refs: Record<string, string>): Promise<PassRun<any>> {
  const attending = Object.keys(refs);
  const parse: (raw: unknown) => unknown = p === "pass1" ? (raw: unknown) => parseScreenVerdict(raw, attending)
    : p === "pass2" ? (raw: unknown) => parseVerdict(raw, refs) : (raw: unknown) => parseDeepVerdict(raw, attending);
  const r = await tryChatJson(recorded(replies), DUMMY, parse, { attempts: 2, maxTokens: REPLAY.maxTokens[p] });
  return r.ok ? { ok: true, verdict: r.value, attempts: r.attempts, records: [], visible: null }
    : { ok: false, error: errorText(r.error), verdict: null, attempts: r.attempts, records: [], visible: null };
}

describe("recorded judge-v2 responses replay to identical verdicts", () => {
  test("fixture covers every outcome", () => {
    const seen = new Set<string>();
    for (const it of REPLAY.items) for (const a of Object.values(it.arms)) {
      for (const p of PASSES) { seen.add(String(a.expected.perPassVerdicts[p]).split(":")[0]!); if (a.passes[p].replies.length > 1) seen.add("retry"); }
      if (a.expected.hardGate) seen.add("gate");
    }
    for (const k of ["yes", "no", "abstain", "error", "retry", "gate"]) expect(seen.has(k)).toBe(true);
  });

  for (const it of REPLAY.items) for (const arm of ["old", "new"] as const) {
    test(`${it.itemId} (${arm} prompts)`, async () => {
      const a = it.arms[arm];
      const runs = {} as Record<PassName, PassRun<any>>;
      for (const p of PASSES) {
        runs[p] = await replayPass(p, a.passes[p].replies, it.attendingRefs);
        expect(runs[p].attempts).toBe(a.passes[p].replies.length);
      }
      const r = {
        itemId: it.itemId, world: it.world, model: "gpt-6-luna", hardGate: a.expected.hardGate, refs: it.attendingRefs,
        label: { good: false, unsafe: false, oracleFlags: [], quality: 0, minEnjoyment: 0 }, meta: {}, memberFacing: {}, leaks: {}, hidden: { byRef: {} },
        pass1: runs.pass1, pass2: runs.pass2, pass3: runs.pass3,
      } as unknown as PassItemResult;
      const rec = JSON.parse(JSON.stringify(itemRecord(r)));
      expect(noBase(rec.perPassVerdicts)).toEqual(noBase(a.expected.perPassVerdicts));
      expect(noBase(rec.confidence)).toEqual(noBase(a.expected.confidence));
      expect(sha(noBase(rec.explanations))).toBe(a.expected.explanationsSha256);
    });
  }
});
