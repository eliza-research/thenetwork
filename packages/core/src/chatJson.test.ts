import { describe, expect, test } from "bun:test";
import { chatJson, tryChatJson } from "./chatJson.ts";
import type { ChatMessage, ChatOptions, LLM } from "./llm.ts";

const M: ChatMessage[] = [{ role: "user", content: "hi" }];
/** Replies in order and records the options of every call. */
function scripted(replies: (string | Error)[]) {
  const opts: ChatOptions[] = [];
  const llm: LLM = { chat: async (_m, o) => { opts.push(o!); const r = replies[opts.length - 1] ?? ""; if (r instanceof Error) throw r; return r; } };
  return { llm, opts };
}
const needsOk = (raw: unknown) => { if ((raw as { ok?: unknown }).ok !== true) throw new Error("schema: ok"); return raw as { ok: true }; };

describe("chatJson", () => {
  test("first valid reply wins; options are exactly { maxTokens, temperature?, json }", async () => {
    const a = scripted(['```json\n{"ok":true}\n```']);
    expect(await chatJson(a.llm, M, needsOk, { maxTokens: 100 })).toEqual({ ok: true });
    expect(a.opts).toEqual([{ maxTokens: 100, json: true }]);
    expect(Object.keys(a.opts[0]!)).toEqual(["maxTokens", "json"]);
    const b = scripted(['{"ok":true}']);
    await chatJson(b.llm, M, needsOk, { maxTokens: 100, temperature: 0.2 });
    expect(Object.keys(b.opts[0]!)).toEqual(["maxTokens", "temperature", "json"]);
  });
  test("no JSON, invalid JSON, a failed call and a failed validation each use one attempt; default 2 attempts", async () => {
    const a = scripted(["no json here", '{"ok":true}']);
    expect(await tryChatJson(a.llm, M, needsOk)).toEqual({ ok: true, value: { ok: true }, attempts: 2 });
    const b = scripted(['{"ok":false}', new Error("503")]);
    const r = await tryChatJson(b.llm, M, needsOk);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(String(r.error)).toContain("503"); expect(r.attempts).toBe(2); expect(r.stopped).toBe(false); }
    await expect(chatJson(scripted(['{"ok":false}', '{"ok":false}']).llm, M, needsOk)).rejects.toThrow("schema: ok");
  });
  test("grow changes the budget after each failure only", async () => {
    const a = scripted(["x", "y", '{"ok":true}']);
    await chatJson(a.llm, M, needsOk, { attempts: 3, maxTokens: 3000, grow: t => Math.min(8000, t * 2) });
    expect(a.opts.map(o => o.maxTokens)).toEqual([3000, 6000, 8000]);
  });
  test("per-attempt clients, beforeAttempt can stop the loop, afterAttempt sees every attempt", async () => {
    const used: number[] = [], after: [number, boolean][] = [];
    const r = await tryChatJson(n => { used.push(n); return scripted([n === 0 ? "bad" : '{"ok":true}']).llm; }, M, needsOk, { afterAttempt: (n, ok) => after.push([n, ok]) });
    expect(r.ok).toBe(true);
    expect(used).toEqual([0, 1]);
    expect(after).toEqual([[0, false], [1, true]]);
    const stop = await tryChatJson(scripted(["bad"]).llm, M, needsOk, { beforeAttempt: n => { if (n === 1) throw new Error("spend limit"); } });
    expect(stop).toMatchObject({ ok: false, attempts: 1, stopped: true });
    // A client factory that throws counts as a failed attempt.
    const boom = await tryChatJson(() => { throw new Error("no key"); }, M, needsOk);
    expect(boom).toMatchObject({ ok: false, attempts: 2, stopped: false });
  });
});

describe("tryChatJson never rejects and never discards a valid reply (core-8)", () => {
  test("afterAttempt throwing on success keeps ok:true with one call; throwing hooks never reject", async () => {
    const a = scripted(['{"ok":true}']);
    const r = await tryChatJson(a.llm, M, needsOk, { afterAttempt: () => { throw new Error("observer boom"); } });
    expect(r).toEqual({ ok: true, value: { ok: true }, attempts: 1 });
    expect(a.opts.length).toBe(1);
    const b = scripted(["bad", '{"ok":true}']);
    expect(await tryChatJson(b.llm, M, needsOk, { maxTokens: 10, grow: () => { throw new Error("grow boom"); }, afterAttempt: () => { throw new Error("x"); } }))
      .toEqual({ ok: true, value: { ok: true }, attempts: 2 });
    expect(b.opts.map(o => o.maxTokens)).toEqual([10, 10]);
    // Property: with hooks that throw at random, the promise always resolves.
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed / 2 ** 31; };
    for (let i = 0; i < 200; i++) {
      const s = scripted([rnd() < 0.5 ? '{"ok":true}' : "nope", rnd() < 0.5 ? '{"ok":true}' : new Error("503")]);
      const boom = () => { if (rnd() < 0.5) throw new Error("hook"); };
      const res = await tryChatJson(s.llm, M, needsOk, { maxTokens: 5, afterAttempt: boom, grow: t => { boom(); return t; } });
      expect(typeof res.ok).toBe("boolean");
    }
  });
  test("a deadline, abort or spent budget stops the loop instead of making another attempt", async () => {
    const { LLMError } = await import("./llm.ts");
    for (const code of ["aborted", "deadline", "budget"] as const) {
      const s = scripted([new LLMError(code, code), '{"ok":true}']);
      expect(await tryChatJson(s.llm, M, needsOk)).toMatchObject({ ok: false, attempts: 1, stopped: true });
      expect(s.opts.length).toBe(1);
    }
    const ctrl = new AbortController();
    ctrl.abort();
    const s = scripted(['{"ok":true}']);
    expect(await tryChatJson(s.llm, M, needsOk, { signal: ctrl.signal })).toMatchObject({ ok: false, attempts: 0, stopped: true });
    expect(s.opts.length).toBe(0);
    // The remaining deadline and the signal are passed to each attempt.
    const c2 = new AbortController();
    const d = scripted(['{"ok":true}']);
    await tryChatJson(d.llm, M, needsOk, { maxTokens: 5, deadlineMs: 10_000, signal: c2.signal });
    expect(d.opts[0]!.deadlineMs).toBeGreaterThan(9_000);
    expect(d.opts[0]!.signal).toBe(c2.signal);
  });
});
