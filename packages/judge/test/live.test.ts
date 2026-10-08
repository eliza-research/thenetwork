// LIVE: judge calibration against the labeled golden set, using the configured judge model
// (`judgeLLM()`: JUDGE_PROVIDER / JUDGE_MODEL, default Surplus Intelligence gpt-6-luna, chosen for all uses 2026-10-05).
// Skipped unless LIVE_TESTS=1 and the judge provider has a key (SURPLUS_API_KEY by default).
import { describe, expect, test } from "bun:test";
import { endpointsFor, judgeLLM, liveTestsEnabled, type Provider } from "@thenetwork/core";
import { CALIBRATION_FLOOR, CALIBRATION_SET, runCalibration } from "../src/index.ts";

const provider = process.env.JUDGE_PROVIDER ?? "surplus";
const model = process.env.JUDGE_MODEL ?? "gpt-6-luna";

// Opt-in only: LIVE_TESTS=1 as well as a key (Bun loads the root .env, so a key alone is not consent).
describe.skipIf(!liveTestsEnabled() || !endpointsFor(provider as Provider).length)(`live judge calibration (${provider} ${model})`, () => {
  test(`LLM judges agree with >= 80% of ${CALIBRATION_SET.length} labels`, async () => {
    const res = await runCalibration(judgeLLM(), { concurrency: 4 });
    for (const i of res.items) console.log(`  ${i.agree ? "ok  " : "MISS"} ${i.id} label=${i.label} predicted=${i.predicted}${i.error ? ` error=${i.error.slice(0, 120)}` : ""}`);
    console.log(`  judge=${provider}/${model} agreement=${(res.agreement * 100).toFixed(0)}% (${res.items.filter(i => i.agree).length}/${res.n})`);
    expect(res.items.filter(i => i.error)).toEqual([]);
    expect(res.agreement).toBeGreaterThanOrEqual(0.8);
    for (const [judge, b] of Object.entries(res.byJudge)) expect([judge, b.agreement >= CALIBRATION_FLOOR]).toEqual([judge, true]);
  }, 300_000);

  test("judges default to judgeLLM() when no LLM is passed", async () => {
    const res = await runCalibration(undefined, { items: CALIBRATION_SET.filter(i => i.id === "q-bad-1"), concurrency: 1 });
    expect(res.items[0]!.error).toBeUndefined();
    expect(res.items[0]!.predicted).toBe(false);
  }, 120_000);
});
