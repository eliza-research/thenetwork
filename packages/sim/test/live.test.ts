// LIVE tests: call the default LLM (defaultLLM(): DEFAULT_LLM_PROVIDER / DEFAULT_LLM_MODEL, Surplus gpt-6-luna).
// Skipped unless that provider's API key is set. Kept few and bounded.
import { describe, expect, test } from "bun:test";
import { defaultLLM } from "@thenetwork/core";
import { DEFAULT_START, LLMPersonaAgent, StubNetwork, generateLLMPersonas, generatePersonas, runWorld } from "../src/index.ts";

const PROVIDER_KEY: Record<string, string> = { surplus: "SURPLUS_API_KEY", cerebras: "CEREBRAS_API_KEY", openai: "OPENAI_API_KEY" };
const live = !!process.env[PROVIDER_KEY[process.env.DEFAULT_LLM_PROVIDER ?? "surplus"] ?? "SURPLUS_API_KEY"];

describe.skipIf(!live)("live (default LLM)", () => {
  test("generates 3 LLM-enriched personas consistent with hidden truth", async () => {
    const llm = defaultLLM();
    const ps = await generateLLMPersonas({ n: 3, seed: 101, llm, adversarialRate: 0, disclosureRate: 1, concurrency: 3 });
    expect(ps).toHaveLength(3);
    for (const p of ps) {
      expect(p.enriched).toBe(true);
      expect(p.public.bio.length).toBeGreaterThan(40);
      expect(p.public.bio).toContain(p.name.split(" ")[0]!);
      expect(JSON.stringify(p.public)).not.toContain(p.hidden.privateDisclosure!.canary);
      console.log(`  ${p.name}: ${p.public.bio}\n    voice: ${p.public.voiceSample}`);
    }
  }, 90_000);

  test("2-persona exchange through LLM persona agents and the stub Network", async () => {
    const llm = defaultLLM();
    const personas = generatePersonas({ n: 2, seed: 5, adversarialRate: 0, cityWeights: { sf: 1, nyc: 0 }, archetypeMix: { very_active: 1, regular: 0, busy_parent: 0, newcomer: 0, connector: 0, introvert: 0, never_replies: 0, traveler: 0 }, joinSpreadDays: 1 });
    for (const p of personas) { p.hidden.interests = ["climbing", "coffee"]; p.public.statedInterests = ["climbing", "coffee"]; p.hidden.responsiveness.ignoreProb = 0; p.joinDay = 0; }
    const agent = new LLMPersonaAgent(llm, DEFAULT_START);
    const r = await runWorld({ seed: 5, personas, days: 3, network: new StubNetwork({ seed: 5, introRate: 1 }), agent, writeLog: false, runId: "live-2p" });
    const inbound = r.records.filter(x => x.type === "message" && x.msg.direction === "inbound");
    for (const x of r.records) if (x.type === "message" && !x.msg.system) console.log(`  ${x.msg.memberId} ${x.msg.direction === "inbound" ? "<-" : "->"} ${x.msg.body}`);
    expect(agent.calls).toBeGreaterThan(2);
    expect(agent.failures).toBeLessThan(agent.calls);
    expect(inbound.length).toBeGreaterThanOrEqual(4);
    expect(r.records.some(x => x.type === "decision" && x.messageType === "proposal")).toBe(true);
    expect(r.metrics.privacy.canaryLeaks).toBe(0);
  }, 180_000);
});
