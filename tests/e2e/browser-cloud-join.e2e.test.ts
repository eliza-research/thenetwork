// spec/browserJoin.md, "Profile values never pass from one account to another"
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { expect, test } from "vitest";
import { fileAt } from "../../packages/core/src/runtime/files.ts";
import { serveHttp } from "../../packages/core/src/runtime/http.ts";
import { createPublicApi } from "../../packages/platform/src/api.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";
import { buildSite, site } from "../../sites/sites.ts";

const browserTest = process.env.PLAYWRIGHT_MODULE ? test : test.skip;

browserTest("Peon keeps the approved name, and no birthday or age, through the exact first Cloud sign-in", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
  const out = mkdtempSync(join(tmpdir(), "peon-cloud-join-"));
  const built = await buildSite(site("peon"), out, { PLATFORM_ENV: "dev" });
  expect(built).toMatchObject({ ok: true });
  const now = Date.UTC(2026, 10, 16, 15);
  const phone = "+12125550170";
  const code = `enso_${"a".repeat(64)}`;
  const invite = Buffer.alloc(32, 5).toString("base64url");
  const store = new MemoryPeopleStore();
  const joins: unknown[] = [];
  let challenge: string | null = null;
  let exchangeCount = 0;
  let platform: ReturnType<typeof createPublicApi>;
  const server = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname.startsWith("/api/")) {
        if (pathname === "/api/join" && req.method === "POST") joins.push(await req.clone().json());
        return (await platform.fetch(req)) ?? new Response("Not found", { status: 404 });
      }
      const file = join(out, normalize(pathname === "/join" ? "/join.html" : pathname));
      return file.startsWith(out) && existsSync(file) ? new Response(await fileAt(file).blob()) : new Response("Not found", { status: 404 });
    },
  });
  const origin = server.url.origin;
  platform = createPublicApi({
    store, now: () => now, hostMap: { [server.url.host]: "peon" },
    env: {
      PLATFORM_ENV: "dev", NETWORK_CLOUD_AUTH_MODE: "staging-local", NETWORK_CLOUD_AUTH_LOGIN_ORIGIN: "https://cloud-staging.eliza.app",
      NETWORK_CLOUD_AUTH_API_ORIGIN: "https://api-staging.eliza.app", NETWORK_CLOUD_AUTH_SITE_ORIGIN: origin,
      NETWORK_CLOUD_AUTH_SERVER_TOKEN: "local-peon-cloud-fixture".repeat(2),
    },
    otp: { name: "unused", async send() { throw new Error("a Cloud sign-in must not send a site code"); } },
    cloudAuthFetch: async input => {
      const request = input instanceof Request ? input : new Request(input);
      expect(request.headers.get("origin")).toBe(origin);
      expect(new URL(request.url).pathname).toBe("/api/auth/sso-bridge/network-exchange");
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || !("codeVerifier" in body) || typeof body.codeVerifier !== "string") throw new Error("missing verifier");
      expect(body).toEqual({ code, codeVerifier: body.codeVerifier });
      expect(Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.codeVerifier))).toString("hex")).toBe(challenge);
      exchangeCount++;
      return Response.json({ userId: "fixture-user", organizationId: "fixture-org", stewardUserId: "fixture-steward", e164: phone,
        issuedAt: Math.floor(now / 1000), expiresAt: now + 300_000 });
    },
    log: () => {},
  });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  try {
    await context.route("https://**/*", (route: any) => route.abort());
    await context.route("https://cloud-staging.eliza.app/network/sign-in?*", async (route: any) => {
      const target = new URL(route.request().url());
      expect([...target.searchParams.keys()].sort()).toEqual(["challenge", "networkSite", "state"]);
      expect(target.searchParams.get("networkSite")).toBe(origin);
      challenge = target.searchParams.get("challenge");
      const callback = new URL("/api/auth/cloud/callback", origin);
      callback.search = new URLSearchParams({ code, state: target.searchParams.get("state")! }).toString();
      await route.fulfill({ status: 303, headers: { location: callback.href } });
    });
    const page = await context.newPage();
    let restoredReceipt: string | undefined;
    await page.route(`${origin}/api/me`, async (route: any) => {
      const receipt = route.request().headers()["x-ntwrk-join-receipt"];
      if (typeof receipt === "string") {
        restoredReceipt = receipt;
        const refused = await context.request.get(`${origin}/api/me`, { headers: { "x-ntwrk-join-receipt": "0".repeat(32) } });
        expect(refused.ok()).toBe(true);
        expect(await refused.json()).not.toHaveProperty("joinPrefill");
      }
      await route.continue();
    });
    const cloudStarts: unknown[] = [];
    page.on("request", (request: any) => {
      if (request.url() === `${origin}/api/auth/cloud/start`) cloudStarts.push(request.postDataJSON());
    });
    await page.goto(`${origin}/join?via=agent#firstName=Ari&age=31&birthdate=1995-03-14&invite=${invite}`);
    await page.getByRole("button", { name: "Continue with your phone" }).click();
    const name = page.getByLabel("First name");
    await name.waitFor();
    expect(page.url()).toBe(`${origin}/join`);
    expect(exchangeCount).toBe(1);
    expect(await name.inputValue()).toBe("Ari");
    expect(await page.getByLabel("Birthday", { exact: true }).inputValue()).toBe("");
    expect(await page.getByLabel("Birthday", { exact: true }).getAttribute("type")).toBe("date");
    expect(cloudStarts).toHaveLength(1);
    expect((cloudStarts[0] as { prefill?: unknown }).prefill).toEqual({ firstName: "Ari", viaAgent: true });
    expect(await page.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    expect(joins).toHaveLength(0);
    expect(await store.findPhone(phone)).toBeUndefined();
    expect(await page.evaluate(() => Object.values(sessionStorage).concat(Object.values(localStorage)))).toEqual([]);
    expect(restoredReceipt).toMatch(/^[0-9a-f]{32}$/);
    const replay = await context.request.get(`${origin}/api/me`, { headers: { "x-ntwrk-join-receipt": restoredReceipt! } });
    expect(await replay.json()).not.toHaveProperty("joinPrefill");

    const secondTab = await context.newPage();
    await secondTab.goto(`${origin}/join`);
    await secondTab.getByLabel("First name").waitFor();
    expect(await secondTab.getByLabel("First name").inputValue()).toBe("");

    const presented: string[] = [];
    await secondTab.route(`${origin}/api/me`, async (route: any) => {
      const receipt = route.request().headers()["x-ntwrk-join-receipt"];
      if (receipt) presented.push(receipt);
      await route.continue();
    });
    await secondTab.evaluate((receipt: string) => sessionStorage.setItem("peon-cloud-join-receipt", receipt), restoredReceipt!);
    const freshName = "Ari".repeat(16) + "Bo";
    await secondTab.goto(`${origin}/join?via=agent#firstName=${freshName}Overflow&age=32&birthdate=1994-03-14`);
    expect(await secondTab.getByLabel("First name").inputValue()).toBe(freshName);
    expect(await secondTab.getByLabel("Birthday", { exact: true }).inputValue()).toBe("");
    expect(await secondTab.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
    expect(presented).toEqual([]);
    expect(secondTab.url()).toBe(`${origin}/join?via=agent`);
    expect(await secondTab.evaluate(() => sessionStorage.getItem("peon-cloud-join-receipt"))).toBeNull();

    await page.getByRole("checkbox").click();
    await page.getByLabel("Birthday", { exact: true }).fill("1995-03-14");
    await page.getByRole("button", { name: "Join", exact: true }).click();
    await page.getByText("Go back to the same chat to finish setting up your profile.").waitFor();
    expect(joins).toHaveLength(1);
    expect(joins[0]).toMatchObject({ firstName: "Ari", birthdate: "1995-03-14", consent: { sms: true } });
    expect(joins[0]).not.toHaveProperty("age");
    expect(joins[0]).not.toHaveProperty("inviteToken");
  } finally {
    await context.close();
    await browser.close();
    await server.stop(true);
    rmSync(out, { recursive: true, force: true });
  }
}, 45_000);
