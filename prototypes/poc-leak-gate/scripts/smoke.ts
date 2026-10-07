// Smoke-test Surplus models used by this POC (prints latency/usage/cost, never the key).
import { llmFor } from "@thenetwork/core";
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["gpt-6-luna", "claude-sonnet-4.5"];
for (const m of models) {
  const llm = llmFor("surplus", m, { maxRetries: 0, timeoutMs: 60_000, onResponse: i => console.log(m, i.status, Math.round(i.latencyMs), "ms", i.usage, i.costMicro, i.error?.slice(0, 120) ?? "") });
  try { console.log(m, (await llm.chat([{ role: "user", content: 'Return only JSON {"ok":true}' }], { json: true, maxTokens: 800 })).slice(0, 80)); } catch (e) { console.log(m, "FAILED", String(e).slice(0, 160)); }
}
