// LIVE: judge calibration against the labeled golden set (Cerebras). Skipped without a key.
import { describe, expect, test } from "bun:test";
import { CerebrasLLM } from "@thenetwork/core";
import { CALIBRATION_SET, runCalibration } from "../src/index.ts";

describe.skipIf(!process.env.CEREBRAS_API_KEY)("live judge calibration", () => {
  test(`LLM judges agree with >= 80% of ${CALIBRATION_SET.length} labels`, async () => {
    const res = await runCalibration(new CerebrasLLM(), { concurrency: 4 });
    for (const i of res.items) console.log(`  ${i.agree ? "ok  " : "MISS"} ${i.id} label=${i.label} predicted=${i.predicted}${i.error ? ` error=${i.error.slice(0, 120)}` : ""}`);
    console.log(`  agreement=${(res.agreement * 100).toFixed(0)}%`);
    expect(res.agreement).toBeGreaterThanOrEqual(0.8);
  }, 180_000);
});
