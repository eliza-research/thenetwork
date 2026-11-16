// Browser integration of the built peon.biz join page (the one site that keeps the browser join), its
// security check adapter (packages/ui/src/api/turnstile.ts) and the public API. Only the SDK callbacks are
// controlled. This does not solve or bypass a challenge.
// Set PLAYWRIGHT_MODULE to an existing Playwright installation to run this case.
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { createPublicApi } from "../../packages/platform/src/api.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";
import { buildSite, site } from "../../sites/sites.ts";

const browserTest = process.env.PLAYWRIGHT_MODULE ? test : test.skip;

browserTest("failed security checks give recovery feedback, a passed check clears only that feedback, and no code is sent without a passed check", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
  const out = mkdtempSync(join(tmpdir(), "auth-feedback-build-"));
  const built = await buildSite(site("peon"), out, { ...process.env, TURNSTILE_SITE_KEY: "sdk-callback-fixture" });
  expect(built).toMatchObject({ ok: true });
  let otpSends = 0;
  let otpRequests = 0;
  const platform = createPublicApi({
    store: new MemoryPeopleStore(), env: { PLATFORM_ENV: "dev" }, hostMap: { "127.0.0.1": "peon" },
    otp: { name: "unused-browser-test", async send() { otpSends++; return { code: "246810" }; } },
    log: () => {},
  });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      if (path.startsWith("/api/")) {
        if (path === "/api/auth/otp/start") otpRequests++;
        return (await platform.fetch(req)) ?? new Response("Not found", { status: 404 });
      }
      const file = join(out, normalize(path === "/join" ? "/join.html" : path));
      return file.startsWith(out) && existsSync(file) ? new Response(Bun.file(file)) : new Response("Not found", { status: 404 });
    },
  });
  const browser = await chromium.launch({ headless: true });
  const evidence = process.env.AUTH_FEEDBACK_VIDEO_DIR;
  const context = await browser.newContext(evidence ? { recordVideo: { dir: evidence, size: { width: 900, height: 600 } }, viewport: { width: 900, height: 600 } } : {});
  try {
    // No real SDK, challenge, remote site, provider or personal browser profile is used.
    await context.route("https://**/*", (route: any) => route.abort());
    await context.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route: any) => route.fulfill({
      contentType: "text/javascript",
      body: "window.turnstile={render(_el,opts){window.sdkCallbacks=opts;window.sdkRenders=(window.sdkRenders||0)+1;return 'fixture-widget'},remove(){}};",
    }));
    const page = await context.newPage();
    const open = async () => {
      await page.goto(`http://127.0.0.1:${server.port}/join`);
      await page.waitForFunction(() => (window as any).sdkCallbacks);
    };
    const error = async () => (await page.locator('form [role="alert"]').count()) ? await page.locator('form [role="alert"]').textContent() : "";
    const send = () => page.getByRole("button", { name: "Text me a code" }).click();
    const phone = page.getByLabel("Mobile number");

    await open();
    await phone.fill("2125550142");
    await send();
    expect(await error()).toContain("Wait for the check");
    await page.evaluate(() => (window as any).sdkCallbacks["error-callback"]("300030"));
    expect(await error()).toBe("The security check failed. Refresh the page and try again.");
    await send();
    expect(await error()).toContain("security check failed");
    expect(otpRequests).toBe(0);

    await open();
    await phone.fill("2125550142");
    await send();
    expect(await error()).toContain("Wait for the check");
    // A simulated SDK success tests feedback only; its inert token is never submitted.
    await page.evaluate(() => (window as any).sdkCallbacks.callback("inert-ui-fixture-token"));
    expect(await error()).toBe("");

    await open();
    await phone.fill("invalid");
    await send();
    expect(await error()).toContain("Enter a 10-digit");
    await page.evaluate(() => (window as any).sdkCallbacks["error-callback"]("300030"));
    expect(await error()).toContain("Enter a 10-digit");

    await open();
    await phone.fill("invalid");
    await send();
    await page.evaluate(() => (window as any).sdkCallbacks.callback("inert-ui-fixture-token"));
    expect(await error()).toContain("Enter a 10-digit");
    expect(otpRequests).toBe(0);
    expect(otpSends).toBe(0);

    // A failed SDK script load must also show failure, rather than wait forever.
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route: any) => route.abort());
    await page.goto(`http://127.0.0.1:${server.port}/join`);
    await page.waitForFunction(() => document.querySelector('form [role="alert"]')?.textContent?.includes("security check failed"));
    expect(await error()).toBe("The security check failed. Refresh the page and try again.");
    expect(otpRequests).toBe(0);
    expect(otpSends).toBe(0);
  } finally {
    await context.close();
    await browser.close();
    server.stop(true);
    rmSync(out, { recursive: true, force: true });
  }
}, 60_000);
