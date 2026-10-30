// Live reader run for a probe answer that names a time nobody offered (issue #134). Not part of
// `test:integration`: it makes real model calls and is skipped unless LIVE_LLM=1, with
// OPENAI_API_KEY set. The mergeConsent guard matters only when a real reader answers the same
// words; this drives that reader through llmUnderstand() and the real ConsentNetwork.
//
//   LIVE_LLM=1 OPENAI_BASE_URL=https://api.openai.com/v1 \
//     bun test --conditions eliza-source packages/network/test/probe-unoffered-time.live.test.ts
import { describe, expect, test } from "bun:test";
import { DAY, defaultLLM } from "@thenetwork/core";
import { llmUnderstand, type Understand } from "../src/extract.ts";
import type { TimeOption } from "../src/classify.ts";
import { Mini } from "./mini.ts";

const live = process.env.LIVE_LLM === "1";
const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const reply = process.env.LIVE_REPLY ?? "Friday night works";

describe.skipIf(!live)("a live LLM reader on an unoffered time", () => {
  test(`"${reply}" against an offered weekend probe`, async () => {
    const base = defaultLLM();
    let calls = 0;
    const seen: unknown[] = [];
    const understand: Understand = llmUnderstand({
      ...base,
      chat: async (messages, options) => {
        calls += 1;
        try {
          const raw = await base.chat(messages, options);
          seen.push({ attempt: calls, ok: true, raw });
          return raw;
        } catch (error) {
          seen.push({ attempt: calls, ok: false, error: String(error) });
          throw error;
        }
      },
    });
    const recording: Understand = async (msg) => {
      try {
        const u = await understand(msg, {});
        seen.push({ parsed: u });
        return u;
      } catch (error) {
        seen.push({ failed: String(error) });
        throw error;
      }
    };
    const w = new Mini([climber("a", "Ana Diaz"), climber("b", "Ben Ito")], { review: "auto", understand: recording });
    await w.onboard("a", "b");
    w.propose(["a", "b"]);
    await w.runUntil(() => w.probed("a") || w.probed("b"), 4 * DAY);
    const first = w.probed("a") ? "a" : "b";
    expect(w.probed(first)).toBe(true);
    const o = [...(w.net as any).opps.values()][0];
    const offered = o.offered[first].map((x: TimeOption) => x.key);
    const from = w.sent.length;
    const callsBefore = calls;
    const readsBefore = seen.length;
    await w.say(first, reply);
    await w.run(DAY);
    const picks = o.picks?.[first] ?? [];
    const declined = (o.declinedTimes ?? []).filter((t: number) => o.offered[first].some((x: TimeOption) => x.start === t));
    const log = w.log("probe_answer").filter(l => l.detail.memberId === first).at(-1)?.detail;
    const fresh = w.to(first, from).filter(s => (s.meta as { timeOptions?: unknown[] }).timeOptions?.length);
    const result = { reply, offered, picks, declined, log, fresh: fresh.length, stage: o.stage, calls: calls - callsBefore, reader: seen.slice(readsBefore) };
    console.log(`LIVE_RESULT ${JSON.stringify(result)}`);
    expect(calls - callsBefore).toBeGreaterThan(0);
    expect(picks).toEqual([]);
    expect(declined).toEqual([]);
    expect(o.stage).toBe("probing");
  }, 180_000);
});
