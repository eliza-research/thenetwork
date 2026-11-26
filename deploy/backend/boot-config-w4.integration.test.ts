// Integration: the boot gates of the process entries (Wave 4 boot_config hardening).
// Each case starts the real entry (deploy/backend/server.ts or packages/network/service/main.ts)
// against an isolated database on dev Postgres (:54339). Sends are dry-run. Skipped without Postgres.
import { resolve } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { spawnProcess } from "../../packages/core/src/runtime/process.ts";
import { dropDb, migratedDb, pgAvailable } from "../../packages/platform/test/pg.ts";

const REPO = resolve(import.meta.dirname, "../..");
const OTP = { OTP_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "ACfake", TWILIO_AUTH_TOKEN: "fake", TWILIO_VERIFY_SERVICE_SID: "VAfake" };
const CLEARED = {
  NODE_ENV: "", NETWORK_CHANNEL: "", BLOOIO_ALLOW_SEND: "", NTWRK_LIVE_APPROVED: "", SERVICE_TURN_SECRET: "", NETWORK_REVIEW_MODE: undefined,
  PLATFORM_SESSION_SECRET: undefined, LEAK_LABEL_KEY: undefined, NETWORK_DATABASE_URL: undefined, MIGRATION_DATABASE_URL: undefined, NETWORK_SERVICE_TOKENS: undefined,
};
const urls: string[] = [];
const PRODUCTION = {
  ...OTP, PLATFORM_ENV: "production", TURNSTILE_SECRET_KEY: "fake", PLATFORM_PROXY_SECRET: "s".repeat(40),
  PLATFORM_HASH_KEY: "h".repeat(40), PLATFORM_SESSION_SECRET: "e".repeat(40),
  SERVICE_TURN_SECRET: "t".repeat(40), NETWORK_SERVICE_TOKENS: `admin@*:${"a".repeat(40)}`, PHOTO_STORAGE: "r2",
  CLOUDFLARE_AI_TOKEN: "synthetic-ai-token", CLOUDFLARE_ACCOUNT_ID: "synthetic-account", SURPLUS_API_KEY: "synthetic-surplus-key",
  TURNSTILE_SITE_KEY: "fake-site",
};

async function run(entry: string[], extra: Record<string, string | undefined>, ms = 60_000) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries({ ...process.env, ...CLEARED, ...extra })) if (v !== undefined) env[k] = v;
  const proc = spawnProcess([process.execPath, "--import", "tsx", ...entry], { cwd: REPO, env, stdout: "pipe", stderr: "pipe" });
  let killed = false;
  const timer = setTimeout(() => { killed = true; proc.kill("SIGKILL"); }, ms);
  const [code, out, err] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  return { code: killed ? null : code, logs: out + err };
}

describe.skipIf(!pgAvailable)("boot gates of the process entries", () => {
  afterAll(async () => { for (const u of urls) await dropDb(u); });

  test("Q-boot_config-W4-1: server.ts refuses PLATFORM_ENV=dev with NODE_ENV=production", async () => {
    const url = await migratedDb("bootw4_devprod");
    urls.push(url);
    const r = await run(["deploy/backend/server.ts"], {
      ...OTP, PLATFORM_ENV: "dev", NODE_ENV: "production", DATABASE_URL: url, PLATFORM_HASH_KEY: "h".repeat(40), TURNSTILE_SECRET_KEY: "fake",
      PORT: "0", BACKEND_STAFF: "off", TICK_MS: "3600000",
    });
    expect(r.code).toBe(1);
    expect(r.logs).toMatch(/start failed.*a NODE_ENV other than production when PLATFORM_ENV=dev/);
  }, 120_000);

  test("Q-boot_config-W4-3: main.ts refuses production with a superuser service login", async () => {
    const url = await migratedDb("bootw4_main");
    urls.push(url);
    const sql = new SQL({ url, max: 1 });
    try { await sql`update platform.settings set value = 'production' where key = 'environment'`; } finally { await sql.close(); }
    const superuser = await run(["packages/network/service/main.ts", "--once", "--dry-run"], { ...PRODUCTION, DATABASE_URL: url });
    expect(superuser.code).toBe(1);
    expect(superuser.logs).toMatch(/refusing to start.*superuser/);
  }, 120_000);

  test("W3-458: main.ts takes DATABASE_URL when NETWORK_DATABASE_URL is empty, as the gate does", async () => {
    const url = await migratedDb("bootw4_blankurl");
    urls.push(url);
    const r = await run(["packages/network/service/main.ts", "--once", "--dry-run"], { PLATFORM_ENV: "dev", NETWORK_DATABASE_URL: "", DATABASE_URL: url });
    expect(r.logs).not.toMatch(/set NETWORK_DATABASE_URL/);
    expect(r.code).toBe(0);
  }, 120_000);
});
