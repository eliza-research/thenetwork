// The relay classifier chosen from the environment (relay-endpoint.ts relayClassifierFromEnv). No network:
// without Workers AI credentials no Clef client is built.
import { expect, test } from "bun:test";
import { relayClassifierFromEnv } from "../service/relay-endpoint.ts";

test("dev and staging without Clef run on the rules alone", () => {
  const logs: string[] = [];
  expect(relayClassifierFromEnv({ PLATFORM_ENV: "dev" }, l => logs.push(l))).toBeUndefined();
  expect(relayClassifierFromEnv({ PLATFORM_ENV: "staging" }, l => logs.push(l))).toBeUndefined();
  expect(logs).toEqual(["relay classifier: rules only", "relay classifier: rules only"]);
});

test("production without Clef fails closed: the hook errors, so a text the rules pass is held", async () => {
  const logs: string[] = [];
  const hookFor = relayClassifierFromEnv({ PLATFORM_ENV: "production" }, l => logs.push(l));
  expect(hookFor).toBeDefined();
  expect(logs[0]).toContain("held for staff");
  await expect(hookFor!("slop")({ text: "see you at 7", kind: "text", context: [], met: false })).rejects.toThrow();
});


test("RELAY_CLEF_WEIGHTS_PATH loads the fitted weights; a bad file stops the start", () => {
  const logs: string[] = [];
  const env = { PLATFORM_ENV: "production", CLOUDFLARE_AI_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" };
  expect(relayClassifierFromEnv({ ...env, RELAY_CLEF_WEIGHTS_PATH: `${import.meta.dir}/../../../evals/relay/clef-relay-weights.json` }, l => logs.push(l))).toBeDefined();
  expect(logs.at(-1)).toBe("relay classifier: rules + Clef (clef-flash, weights relay-clef-bank-2026-10-11)");
  expect(relayClassifierFromEnv(env, l => logs.push(l))).toBeDefined();
  expect(logs.at(-1)).toContain("weights relay-clef-0-placeholder");
  expect(() => relayClassifierFromEnv({ ...env, RELAY_CLEF_WEIGHTS_PATH: `${import.meta.dir}/../../../package.json` }, () => {})).toThrow();
});
