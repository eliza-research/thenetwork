// Browser integration of the real phone form, Turnstile adapter and public API.
// Only the SDK callbacks are controlled. This does not solve or bypass a challenge.
// Set PLAYWRIGHT_MODULE to an existing Playwright installation to run this case.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createPublicApi } from "../../packages/platform/src/api.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";

const browserTest = process.env.PLAYWRIGHT_MODULE ? test : test.skip;

browserTest("failed security checks give recovery feedback and a later SDK success clears only that feedback", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
  const out = mkdtempSync(join(tmpdir(), "auth-feedback-build-"));
  const entrypoints = ["auth.ts", "join-core.ts"].map(file => join(import.meta.dir, "../../sites/shared", file));
  const bundle = await Bun.build({ entrypoints, target: "browser", outdir: out });
  expect(bundle.success).toBe(true);
  const scripts = new Map(bundle.outputs.map(output => [`/${basename(output.path)}`, output]));
  let otpSends = 0;
  let otpRequests = 0;
  const platform = createPublicApi({
    store: new MemoryPeopleStore(), env: { PLATFORM_ENV: "dev" }, hostMap: { "127.0.0.1": "friends" },
    otp: { name: "unused-browser-test", async send() { otpSends++; return { code: "246810" }; } },
    log: () => {},
  });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      const script = scripts.get(path);
      if (script) return new Response(script, { headers: { "content-type": "text/javascript" } });
      if (path.startsWith("/api/")) {
        if (path === "/api/auth/otp/start") otpRequests++;
        return (await platform.fetch(req)) ?? new Response("Not found", { status: 404 });
      }
      return new Response(`<!doctype html><meta name="turnstile-sitekey" content="sdk-callback-fixture">
        <title>Local security-check feedback regression</title><main id="flow">
        <section data-step="phone"><form data-form="phone"><label>Phone <input name="phone" value="2125550142"></label>
        <div data-turnstile></div><p data-error role="alert"></p><button type="submit">Send code</button></form></section>
        <section data-step="code" hidden><form data-form="code"><input name="code"><p data-error></p></form></section></main>
        <script type="module">
          import {mountAuth} from '/auth.js';
          import {flowNext, initialFlow, NO_FIELDS} from '/join-core.js';
          let flow = flowNext(initialFlow(NO_FIELDS), {tag:'loaded',signedInAs:'',canJoin:false,member:false,inviteOnly:false,notice:''});
          mountAuth(document.querySelector('#flow'), {current: () => flow, dispatch: event => flow = flowNext(flow, event), onSignedIn: () => {}});
        </script>`,
        { headers: { "content-type": "text/html" } });
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
      body: "window.turnstile={render(_el,opts){window.sdkCallbacks=opts;return 'fixture-widget'},reset(){window.sdkResetCalls=(window.sdkResetCalls||0)+1}};",
    }));
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.waitForFunction(() => (window as any).sdkCallbacks);
    const error = page.locator('form[data-form="phone"] [data-error]');
    await page.getByRole("button", { name: "Send code" }).click();
    expect(await error.textContent()).toContain("Wait for the check");
    await page.evaluate(() => (window as any).sdkCallbacks["error-callback"]("300030"));
    expect(await error.textContent()).toBe("The security check failed. Refresh the page and try again.");
    await page.getByRole("button", { name: "Send code" }).click();
    expect(await error.textContent()).toContain("security check failed");
    expect(otpRequests).toBe(0);
    expect(otpSends).toBe(0);
    // A simulated SDK success tests feedback only; its inert token is never submitted.
    await page.evaluate(() => (window as any).sdkCallbacks.callback("inert-ui-fixture-token"));
    expect(await error.textContent()).toBe("");
    await page.locator('[name="phone"]').fill("invalid");
    await page.getByRole("button", { name: "Send code" }).click();
    expect(await error.textContent()).toContain("Enter a 10-digit");
    await page.evaluate(() => (window as any).sdkCallbacks["error-callback"]("300030"));
    expect(await error.textContent()).toContain("Enter a 10-digit");
    await page.evaluate(() => (window as any).sdkCallbacks.callback("inert-ui-fixture-token"));
    expect(await error.textContent()).toContain("Enter a 10-digit");
    expect(await page.evaluate(() => (window as any).sdkResetCalls ?? 0)).toBe(0);
    expect(otpRequests).toBe(0);
    expect(otpSends).toBe(0);
    // A failed SDK script load must also show failure, rather than wait forever.
    await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit", (route: any) => route.abort());
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-error]')?.textContent?.includes("security check failed"));
    expect(await error.textContent()).toBe("The security check failed. Refresh the page and try again.");
    expect(otpRequests).toBe(0);
    expect(otpSends).toBe(0);
  } finally {
    await context.close();
    await browser.close();
    server.stop(true);
    rmSync(out, { recursive: true, force: true });
  }
}, 30_000);
