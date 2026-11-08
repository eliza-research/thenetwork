// The console's start guard (deployGuard, docs/deploy.md 2.6) on a server that starts with real data.
// SD-290: a deployed console (staging or production) must not start with the file audit log, which a
// redeploy of the container loses.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server.ts";

const T = 120_000;
const LOCAL = "postgres://u@localhost:54339/x";
const ENV = ["PLATFORM_ENV", "NETWORK_DATABASE_URL", "DATABASE_URL", "OBSERVATORY_AUDIT_DATABASE_URL", "NETWORK_SERVICE_URL", "NETWORK_SERVICE_TOKEN"] as const;
let dir: string;
const keep: Record<string, string | undefined> = {};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "obs-start-guard-"));
  for (const k of ENV) { keep[k] = process.env[k]; delete process.env[k]; }
});
afterAll(async () => {
  for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (dir) await rm(dir, { recursive: true, force: true });
});

const start = (o: Parameters<typeof createServer>[0]) => createServer({ port: 0, development: false, lab: { dir: join(dir, "lab") }, staffRolesUrl: false, peopleUrl: false, ...o })
  .then(async s => { await s.stop(); return "started"; }, e => String((e as Error).message));
const real = { url: LOCAL, pollMs: 3_600_000, service: false as const };
const sso = { trustCfAccess: true, cfAccess: { team: "guard-team", aud: "guard-aud" } };

describe("the start guard and the audit log", () => {
  test("staging and production refuse the file audit log; the Postgres audit log starts", async () => {
    for (const platformEnv of ["staging", "production"]) {
      expect(await start({ realOnly: true, platformEnv, ...sso, real, audit: { dir: join(dir, "audit") } })).toMatch(/refusing to start: .*OBSERVATORY_AUDIT_DATABASE_URL/);
      expect(await start({ realOnly: true, platformEnv, ...sso, real, audit: { url: LOCAL } })).toBe("started");
    }
    // PLATFORM_ENV=dev on this machine may keep the file audit log.
    expect(await start({ realOnly: true, platformEnv: "dev", token: "guard-admin".padEnd(32, "-0123456789abcdef"), real, audit: { dir: join(dir, "audit") } })).toBe("started");
  }, T);
});
