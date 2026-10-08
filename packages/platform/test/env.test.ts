// PLAT-05 and the production boot check: dev shortcuts need a declared dev environment, and a
// production process refuses to start without real providers and every secret.
import { describe, expect, test } from "bun:test";
import { createPublicApi } from "../src/api.ts";
import { assertBootConfig, bootConfigProblems, devShortcutsAllowed } from "../src/env.ts";
import { DevConsoleProvider, otpProviderFromEnv } from "../src/otp.ts";
import { MemoryPeopleStore } from "../src/store.ts";
import { DevTurnstileBypass, turnstileFromEnv } from "../src/turnstile.ts";

const SECRET = "s".repeat(40);
export const PROD_OK = {
  PLATFORM_ENV: "production", OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t", TWILIO_VERIFY_SERVICE_SID: "VA1",
  TURNSTILE_SECRET_KEY: "0x4AAA", PLATFORM_PROXY_SECRET: SECRET, PLATFORM_HASH_KEY: SECRET, PLATFORM_SESSION_SECRET: SECRET,
  DATABASE_URL: "postgres://svc@db.internal:5432/network", NETWORK_REVIEW_MODE: "human",
};

describe("dev shortcuts need PLATFORM_ENV=dev", () => {
  test("an empty environment, NODE_ENV=production and NODE_ENV=development get no dev provider, bypass or hash key", () => {
    for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "development" }, { PLATFORM_ENV: "prod" }, { PLATFORM_ENV: "dev", NODE_ENV: "production" }]) {
      expect(devShortcutsAllowed(env)).toBe(false);
      expect(() => new DevConsoleProvider(env)).toThrow("refused");
      expect(() => new DevTurnstileBypass(env)).toThrow("refused");
      expect(() => otpProviderFromEnv(env)).toThrow();
      expect(() => turnstileFromEnv(env)).toThrow("refused");
      expect(() => createPublicApi({ store: new MemoryPeopleStore(), otp: { name: "x", send: async () => ({}) }, env })).toThrow("PLATFORM_HASH_KEY");
    }
    expect(devShortcutsAllowed({ PLATFORM_ENV: "dev" })).toBe(true);
  });
});

describe("production boot check", () => {
  test("the full production configuration passes", () => {
    expect(bootConfigProblems(PROD_OK)).toEqual([]);
    expect(assertBootConfig(PROD_OK)).toBe("production");
  });

  test("each missing or dev setting refuses the start, and names what is missing", () => {
    const cases: [Record<string, string | undefined>, string][] = [
      [{ OTP_PROVIDER: undefined }, "OTP_PROVIDER=twilio"],
      [{ OTP_PROVIDER: "dev" }, "OTP_PROVIDER=twilio"],
      [{ TWILIO_AUTH_TOKEN: undefined }, "TWILIO_AUTH_TOKEN"],
      [{ TURNSTILE_SECRET_KEY: undefined }, "TURNSTILE_SECRET_KEY"],
      [{ PLATFORM_PROXY_SECRET: undefined }, "PLATFORM_PROXY_SECRET"],
      [{ PLATFORM_PROXY_SECRET: "short" }, "PLATFORM_PROXY_SECRET (at least 32"],
      [{ PLATFORM_SESSION_SECRET: undefined }, "PLATFORM_SESSION_SECRET"],
      [{ PLATFORM_HASH_KEY: undefined }, "PLATFORM_HASH_KEY"],
      [{ DATABASE_URL: undefined }, "NETWORK_DATABASE_URL or DATABASE_URL"],
      [{ NETWORK_REVIEW_MODE: "auto" }, "NETWORK_REVIEW_MODE=human"],
      [{ PLATFORM_DEV_BYPASS: "1" }, "unset PLATFORM_DEV_BYPASS"],
    ];
    for (const [change, says] of cases) {
      const env = { ...PROD_OK, ...change };
      expect(() => assertBootConfig(env)).toThrow(says);
    }
    expect(() => assertBootConfig({})).toThrow("PLATFORM_ENV");
    expect(bootConfigProblems({ PLATFORM_ENV: "dev" })).toEqual([]);
    expect(bootConfigProblems({ PLATFORM_ENV: "staging" }).length).toBeGreaterThan(5);
  });
});
