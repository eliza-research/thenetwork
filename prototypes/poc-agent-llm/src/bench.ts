// Latency / tokens / cost per call type at concurrency 1 and 16 (fresh calls via a cache salt;
// reruns with the same RUN id replay from cache with the originally measured latency).
// Usage: bun run src/bench.ts   (env: RUN=r1 N1=30 N16=96)
import { calls, client, pool, readJsonl, structured, writeJson, type StructuredResult } from "./llm.ts";
import { Extraction, Routing, Turn } from "./spec.ts";
import { extractMessages, routeMessages, turnMessages } from "./prompts.ts";
import { sanitize } from "./authz.ts";
import { usageSummary } from "./eval.ts";

const RUN = process.env.RUN ?? "r1";
const N1 = Number(process.env.N1 ?? 30), N16 = Number(process.env.N16 ?? 96);
const ex = readJsonl<any>("data/extraction.raw.jsonl"), rt = readJsonl<any>("data/routing.raw.jsonl");

const types: Record<string, (i: number, llm: any) => Promise<StructuredResult<unknown>>> = {
  extract: (i: number, llm: any) => structured(llm, extractMessages(ex[i % ex.length].text), Extraction),
  route: (i: number, llm: any) => structured(llm, routeMessages(rt[i % rt.length].text, rt[i % rt.length].ctx), Routing, 2048),
  turn: (i: number, llm: any) => { const r = rt[(i * 7) % rt.length]; return structured(llm, turnMessages(sanitize(r.text), r.ctx, "hardened"), Turn); },
};

const out: Record<string, any> = {};
for (const conc of [1, 16]) {
  const n = conc === 1 ? N1 : N16;
  for (const [t, fn] of Object.entries(types)) {
    const callType = `${t}@c${conc}`;
    const llm = client({ callType, salt: `bench-${RUN}-c${conc}` });
    const t0 = performance.now();
    const res = await pool(Array.from({ length: n }, (_, i) => i), conc, i => fn(i + (conc === 1 ? 1000 : 0), llm));
    const wallS = (performance.now() - t0) / 1000;
    out[callType] = { n, wallS: Math.round(wallS * 10) / 10, throughputPerMin: Math.round((n / wallS) * 60), schemaValidAfterRepair: res.filter(r => r.validAfterRepair).length / n, repairs: res.filter(r => !r.validFirst).length };
    console.log(callType, out[callType]);
  }
}
const usage = usageSummary(calls);
// Monthly extrapolation: 300 members x 5 inbound/day x 30 days. Per inbound: 1 strict extract + 1 turn (router+actions),
// plus a reply-phrasing call estimated at the turn call's cost (not measured here).
const msgs = 300 * 5 * 30;
const c = (k: string) => (usage[`${k}@c16`]?.avgCostMicroUSD ?? 0) / 1e6;
const perMsgMeasured = c("extract") + c("turn");
const perMsgWithReply = perMsgMeasured + c("turn");
const monthly = { inboundPerMonth: msgs, perMessageUSD_extractPlusTurn: perMsgMeasured, perMessageUSD_withReplyPhrasing: perMsgWithReply,
  monthlyUSD_extractPlusTurn: Math.round(msgs * perMsgMeasured * 100) / 100, monthlyUSD_withReplyPhrasing: Math.round(msgs * perMsgWithReply * 100) / 100 };
console.log(JSON.stringify({ usage, monthly }, null, 1));
writeJson(`results/bench.${RUN}.json`, { runs: out, usage, monthly });
