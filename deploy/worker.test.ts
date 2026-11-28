import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import * as Alchemy from "alchemy";
import * as Effect from "effect/Effect";
import * as HttpClient from "effect/http/HttpClient";
import { verifyProxyHeaders } from "../packages/platform/src/proxy.ts";
import { hashAssetDirectory } from "../tools/vibestack/vibestack/alchemy.ts";
import {
  dnsStageSlug,
  PAGES_SITES,
  provisionPagesSites,
  resolveDeployPolicy,
  resolveStateBackendConfig,
  validateBackendOrigin,
} from "./alchemy-sites.ts";
import { RUN_WORKER_FIRST } from "./router.ts";

const SITE_DIST = path.resolve(import.meta.dirname, "../sites/ntwrk.party/dist");
const WORKER_MAIN = path.join(SITE_DIST, "_worker.js");
const TEST_PROXY_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef";

interface CapturedRequest {
  readonly method: string;
  readonly path: string;
  readonly verified: Awaited<ReturnType<typeof verifyProxyHeaders>>;
  readonly forwardedFor: string | undefined;
  readonly spoofedHost: string | undefined;
}

let captured: CapturedRequest[] = [];
let mockServer: Server | undefined;
let mockOrigin = "http://127.0.0.1:1";

async function startMockBackend(): Promise<string> {
  captured = [];
  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const reqPath = req.url ?? "/";
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === "string") headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(", "));
    }
    const verified = await verifyProxyHeaders(
      new Request(`http://127.0.0.1${reqPath}`, { method, headers }),
      TEST_PROXY_SECRET,
      Math.floor(Date.now() / 1000),
    );
    captured.push({
      method,
      path: reqPath,
      verified,
      forwardedFor: headers.get("x-forwarded-for") ?? undefined,
      spoofedHost: headers.get("x-ntwrk-proxy-host") ?? undefined,
    });
    if (reqPath.startsWith("/cal/")) {
      res.writeHead(200, { "content-type": "text/calendar; charset=utf-8" });
      res.end("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n");
      return;
    }
    res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ id: "ntwrk", verified: verified !== undefined }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  mockServer = server;
  const addr = server.address() as AddressInfo;
  mockOrigin = `http://127.0.0.1:${String(addr.port)}`;
  return mockOrigin;
}

const assets = hashAssetDirectory(SITE_DIST);

const EdgeRouterStack = Alchemy.Stack(
  "TheNetworkEdgeRouterTest",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    const unconfigured = yield* Cloudflare.Worker("EdgeRouterUnconfigured", {
      main: WORKER_MAIN,
      bundle: false,
      workersDev: true,
      assets: {
        directory: assets.directory,
        hash: assets.hash,
        runWorkerFirst: [...RUN_WORKER_FIRST],
      },
      env: {
        APP_ID: "ntwrk",
        SITE_HOST: "ntwrk.party",
        BACKEND_ORIGIN: mockOrigin,
      },
    });
    const signed = yield* Cloudflare.Worker("EdgeRouterSigned", {
      main: WORKER_MAIN,
      bundle: false,
      workersDev: true,
      assets: {
        directory: assets.directory,
        hash: assets.hash,
        runWorkerFirst: [...RUN_WORKER_FIRST],
      },
      env: {
        APP_ID: "ntwrk",
        SITE_HOST: "ntwrk.party",
        BACKEND_ORIGIN: mockOrigin,
        PLATFORM_PROXY_SECRET: TEST_PROXY_SECRET,
      },
    });
    return {
      unconfiguredUrl: unconfigured.url.as<string>(),
      signedUrl: signed.url.as<string>(),
    };
  }),
);

const { test, beforeAll, afterAll, deploy, destroy } = Test.make({
  providers: Cloudflare.providers(),
  dev: true,
});

const stack = beforeAll(
  Effect.gen(function* () {
    yield* Effect.promise(() => startMockBackend());
    return yield* deploy(EdgeRouterStack);
  }),
);

afterAll(
  Effect.gen(function* () {
    yield* destroy(EdgeRouterStack);
    yield* Effect.promise(
      () =>
        new Promise<void>((resolve) => {
          if (!mockServer) {
            resolve();
            return;
          }
          mockServer.close(() => resolve());
        }),
    );
  }),
);

test(
  "serves built static assets, skill files, retired paths, and fails closed without proxy secret in workerd",
  Effect.gen(function* () {
    const { unconfiguredUrl } = yield* stack;
    const base = unconfiguredUrl.replace(/\/$/, "");

    const home = yield* HttpClient.get(`${base}/`);
    expect(home.status).toBe(200);
    expect(home.headers["content-type"]).toContain("text/html");

    const skill = yield* HttpClient.get(`${base}/SKILL.md`);
    expect(skill.status).toBe(200);
    expect(yield* skill.text).toContain("name: ntwrk-party");

    const index = yield* HttpClient.get(`${base}/.well-known/agent-skills/index.json`);
    expect(index.status).toBe(200);
    expect(yield* index.text).toContain("ntwrk-party");

    const joinRes = yield* Effect.promise(() => fetch(`${base}/join`, { redirect: "manual" }));
    expect(joinRes.status).toBe(302);
    expect(joinRes.headers.get("location")).toBe("/");

    const retiredSettings = yield* HttpClient.get(`${base}/settings`);
    expect(retiredSettings.status).toBe(404);

    const apiUnconfigured = yield* HttpClient.get(`${base}/api/app`);
    expect(apiUnconfigured.status).toBe(503);
    expect(yield* apiUnconfigured.json).toEqual({ ok: false, error: "proxy_not_configured" });

    const missing = yield* HttpClient.get(`${base}/no-such-page-workerd`);
    expect(missing.status).toBe(404);
  }),
);

test(
  "signs forwarded /api/* and /cal/*.ics requests, strips spoofed headers, and injects security headers in workerd",
  Effect.gen(function* () {
    const { signedUrl } = yield* stack;
    const base = signedUrl.replace(/\/$/, "");
    captured = [];

    const apiRes = yield* Effect.promise(() =>
      fetch(`${base}/api/app?probe=1`, {
        headers: {
          "x-network-proxy-host": "evil.example",
          "x-ntwrk-proxy-host": "evil.example",
          "x-forwarded-for": "1.2.3.4",
        },
      }),
    );
    expect(apiRes.status).toBe(200);
    expect(yield* Effect.promise(() => apiRes.json())).toEqual({ id: "ntwrk", verified: true });
    expect(apiRes.headers.get("x-content-type-options")).toBe("nosniff");
    expect(apiRes.headers.get("referrer-policy")).toBe("no-referrer");
    expect(apiRes.headers.get("strict-transport-security")).toContain("max-age=31536000");

    expect(captured.length).toBe(1);
    expect(captured[0].path).toBe("/api/app?probe=1");
    expect(captured[0].verified).toMatchObject({ host: "ntwrk.party" });
    expect(captured[0].forwardedFor).toBeUndefined();
    expect(captured[0].spoofedHost).toBeUndefined();

    const calRes = yield* Effect.promise(() => fetch(`${base}/cal/meeting-123.ics`));
    expect(calRes.status).toBe(200);
    expect(yield* Effect.promise(() => calRes.text())).toContain("BEGIN:VCALENDAR");
    expect(captured.length).toBe(2);
    expect(captured[1].path).toBe("/cal/meeting-123.ics");
    expect(captured[1].verified).toMatchObject({ host: "ntwrk.party" });
  }),
);

test(
  "enforces fail-closed Alchemy deploy policy, DNS-safe stage slugs, and HTTPS backend origin validation",
  Effect.sync(() => {
    expect(PAGES_SITES.map((s) => s.project)).toEqual([
      "ntwrk-party",
      "slop-date",
      "peon-biz",
      "friends-help",
    ]);
    expect(() => resolveDeployPolicy("pr-42")).toThrow(/preview deployments are disabled/i);
    expect(dnsStageSlug("dev_shawwalters_thenetwork")).toMatch(/^[a-z0-9-]+$/);
    expect(dnsStageSlug("dev_shawwalters_thenetwork")).not.toContain("_");
    expect(validateBackendOrigin("https://api.ntwrk.party")).toBe("https://api.ntwrk.party");
    expect(() => validateBackendOrigin("http://api.ntwrk.party")).toThrow();
    expect(() => validateBackendOrigin("https://api.ntwrk.party/sub")).toThrow();
    const devPolicy = resolveDeployPolicy("dev_alice_work");
    expect(devPolicy.stageTarget.kind).toBe("dev");
    expect(devPolicy.stageSlug).toMatch(/^[a-z0-9-]+$/);

    const r2Env = {
      CLOUDFLARE_ACCOUNT_ID: " acc-123 ",
      R2_STATE_BUCKET: " alchemy-state ",
      R2_STATE_ACCESS_KEY_ID: " key-id ",
      R2_STATE_SECRET_ACCESS_KEY: " secret-key ",
      R2_STATE_PREFIX: "",
    };
    expect(resolveStateBackendConfig("dev_alice_work", "alchemy/thenetwork-sites/", r2Env)).toEqual({
      kind: "local",
    });
    expect(resolveStateBackendConfig("test_alice_work", "alchemy/thenetwork-sites/", r2Env)).toEqual({
      kind: "local",
    });
    expect(resolveStateBackendConfig("production", "alchemy/thenetwork-sites/", r2Env)).toEqual({
      kind: "r2",
      accountId: "acc-123",
      bucket: "alchemy-state",
      accessKeyId: "key-id",
      secretAccessKey: "secret-key",
      prefix: "alchemy/thenetwork-sites/",
    });
    expect(
      resolveStateBackendConfig("production", "alchemy/thenetwork-sites/", {
        ...r2Env,
        R2_STATE_PREFIX: " custom/prefix/ ",
      }),
    ).toMatchObject({ kind: "r2", prefix: "custom/prefix/" });
    expect(
      resolveStateBackendConfig("production", "alchemy/thenetwork-sites/", {
        ALCHEMY_STATE_STORE: " cloudflare ",
        CLOUDFLARE_ACCOUNT_ID: " acc-123 ",
      }),
    ).toEqual({ kind: "cloudflare", accountId: "acc-123" });
    expect(
      resolveStateBackendConfig("production", "alchemy/thenetwork-sites/", {
        CLOUDFLARE_ACCOUNT_ID: "acc-123",
        R2_STATE_BUCKET: "",
        R2_STATE_ACCESS_KEY_ID: "",
        R2_STATE_SECRET_ACCESS_KEY: "",
      }),
    ).toEqual({ kind: "local" });
  }),
);

const PagesGraphStack = Alchemy.Stack(
  "TheNetworkPagesGraphTest",
  {
    providers: Cloudflare.providers(),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    const policy = resolveDeployPolicy("production");
    return yield* provisionPagesSites({
      stageTarget: policy.stageTarget,
      stageSlug: policy.stageSlug,
      commitSha: "a".repeat(40),
    });
  }),
);

test(
  "registers four distinct Pages projects, deploy actions, and smoke verification actions without LogicalId collision",
  Effect.gen(function* () {
    const compiled = yield* PagesGraphStack.pipe(
      Effect.provideService(Alchemy.Stage, "production"),
    );
    expect(Object.keys(compiled.resources).sort()).toEqual([
      "Pages_friends",
      "Pages_ntwrk",
      "Pages_peon",
      "Pages_slop",
    ]);
    expect(Object.keys(compiled.actions).sort()).toEqual([
      "Deploy_friends",
      "Deploy_ntwrk",
      "Deploy_peon",
      "Deploy_slop",
      "Verify_friends",
      "Verify_ntwrk",
      "Verify_peon",
      "Verify_slop",
    ]);
    for (const site of PAGES_SITES) {
      const verifyAction = compiled.actions[`Verify_${site.app}`];
      expect(verifyAction?.LogicalId).toBe(`Verify_${site.app}`);
      expect(verifyAction?.Input).toMatchObject({ app: site.app });
      expect("commitSha" in (verifyAction?.Input as Record<string, unknown>)).toBe(true);
    }
  }),
);
