// Integration: the deployed backend process (server.ts) refuses to start in staging or production
// without PLATFORM_SESSION_SECRET (32+ characters), as packages/platform/src/env.ts bootConfigProblems
// requires. Without it the public API keys the session token hashes and the Cloud seal with
// PLATFORM_HASH_KEY (packages/platform/src/api.ts), so one key serves two uses. SD-164.
import { expect, test } from "bun:test";

const DEPLOYED = {
  PLATFORM_ENV: "staging", DATABASE_URL: "postgres://svc@127.0.0.1:1/x", MIGRATION_DATABASE_URL: "postgres://owner@127.0.0.1:1/x", PLATFORM_HASH_KEY: "h".repeat(40), LEAK_LABEL_KEY: "l".repeat(40), PLATFORM_PROXY_SECRET: "s".repeat(40),
  TURNSTILE_SECRET_KEY: "fake", OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "ACfake", TWILIO_AUTH_TOKEN: "fake", TWILIO_VERIFY_SERVICE_SID: "VAfake",
  PORT: "0", BACKEND_STAFF: "off", NODE_ENV: "", NETWORK_CHANNEL: "", BLOOIO_ALLOW_SEND: "", NTWRK_LIVE_APPROVED: "",
};

async function boot(extra: Record<string, string>) {
  const env: Record<string, string> = { ...process.env as Record<string, string>, ...DEPLOYED, ...extra };
  if (!("PLATFORM_SESSION_SECRET" in extra)) delete env.PLATFORM_SESSION_SECRET;
  const proc = Bun.spawn(["bun", "run", `${import.meta.dir}/server.ts`], { env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill("SIGKILL"), 20_000);
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  return { code, logs: out + err };
}

test("a deployed backend without PLATFORM_SESSION_SECRET, or with a short one, refuses to start (SD-164)", async () => {
  const none = await boot({});
  expect(none.code).toBe(1);
  expect(none.logs).toMatch(/start failed.*PLATFORM_SESSION_SECRET/);
  const short = await boot({ PLATFORM_SESSION_SECRET: "short" });
  expect(short.code).toBe(1);
  expect(short.logs).toMatch(/start failed.*PLATFORM_SESSION_SECRET/);
}, 60_000);
