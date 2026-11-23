import { expect, test } from "vitest";
import { relayClassifierFromEnv } from "../service/relay-endpoint.ts";

test("without Workers AI credentials every environment gets a classifier that cannot run, so a text the rules pass is blocked (owner decision 2026-11-22, D18)", async () => {
  for (const env of [{ PLATFORM_ENV: "dev" }, { PLATFORM_ENV: "staging" }, { PLATFORM_ENV: "production" }, { PLATFORM_ENV: "staging", CLOUDFLARE_ACCOUNT_ID: "a" }, { PLATFORM_ENV: "dev", CLOUDFLARE_AI_TOKEN: "t" }]) {
    const logs: string[] = [];
    const hookFor = relayClassifierFromEnv(env, l => logs.push(l));
    expect(hookFor).toBeTypeOf("function");
    expect(logs).toEqual(["relay classifier: Workers AI not configured; every relayed text is blocked"]);
    await expect(hookFor("slop")({ text: "see you at 7", kind: "text", context: [], met: false })).rejects.toThrow("relay classifier not configured");
  }
});

test("RELAY_CLEF_WEIGHTS_PATH loads the fitted weights; a bad file stops the start", () => {
  const logs: string[] = [];
  const env = { PLATFORM_ENV: "production", CLOUDFLARE_AI_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" };
  expect(relayClassifierFromEnv({ ...env, RELAY_CLEF_WEIGHTS_PATH: `${import.meta.dirname}/../../../evals/relay/clef-relay-weights.json` }, l => logs.push(l))).toBeDefined();
  expect(logs.at(-1)).toBe("relay classifier: rules + Clef (clef-flash, weights relay-clef-bank-2026-10-11)");
  expect(relayClassifierFromEnv(env, l => logs.push(l))).toBeDefined();
  expect(logs.at(-1)).toContain("weights relay-clef-0-placeholder");
  expect(() => relayClassifierFromEnv({ ...env, RELAY_CLEF_WEIGHTS_PATH: `${import.meta.dirname}/../../../package.json` }, () => {})).toThrow();
});
