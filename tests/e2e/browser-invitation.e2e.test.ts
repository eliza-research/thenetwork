// spec/browserJoin.md, "A Peon invitation stays in memory until the verified account agrees to join"
// Set PLAYWRIGHT_MODULE to the same local Playwright installation as auth-feedback.e2e.test.ts.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { expect, test } from "vitest";
import { fileAt } from "../../packages/core/src/runtime/files.ts";
import { serveHttp } from "../../packages/core/src/runtime/http.ts";
import { createPublicApi } from "../../packages/platform/src/api.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";
import { buildSite, site } from "../../sites/sites.ts";

const browserTest = process.env.PLAYWRIGHT_MODULE ? test : test.skip;

browserTest("the built Peon join page keeps an invitation in the same verified account's consent request", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
  const out = mkdtempSync(join(tmpdir(), "peon-invitation-"));
  const built = await buildSite(site("peon"), out, { PLATFORM_ENV: "dev" });
  expect(built).toMatchObject({ ok: true });
  const store = new MemoryPeopleStore();
  const first = "+12125550141", second = "+12125550142", third = "+12125550143", fourth = "+12125550144", fifth = "+12125550145";
  const retryPhone = "+12125550146";
  const reassigned = "+12125550147";
  let now = Date.UTC(2026, 10, 16, 15);
  const directToken = Buffer.alloc(32, 1).toString("base64url");
  const verifiedToken = Buffer.alloc(32, 2).toString("base64url");
  const expiredToken = Buffer.alloc(32, 3).toString("base64url");
  const retryToken = Buffer.alloc(32, 4).toString("base64url");
  const tokenByPhone = new Map([[first, directToken], [second, verifiedToken], [retryPhone, retryToken]]);
  let releaseRetryAttempt!: () => void;
  const retryAttemptHeld = new Promise<void>(resolve => { releaseRetryAttempt = resolve; });
  let interceptedRetry = false;
  const referredPhones: string[] = [];
  const joins: Record<string, unknown>[] = [];
  const platformFor = (host: string) => createPublicApi({
    store, now: () => now, env: { PLATFORM_ENV: "dev" }, hostMap: { [host]: "peon" },
    otp: { name: "browser-invitation-fixture", async send() { return { code: "246810" }; } },
    async findInvitation(app, token, _at, phone) {
      if (app === "peon" && tokenByPhone.get(phone) === token) return { inviterMemberId: "fixture-inviter", tokenHash: "fixture-hash" };
    },
    async commitReferredJoin({ membership, e164, app, session }) {
      await store.putMembership(membership);
      await store.addConsent({ e164, app: app.id, state: "opted_in", source: "web_form", wording: app.consent.text, wordingVersion: app.consent.version, at: membership.joinedAt! });
      await store.attachPerson(e164, membership.personId, session ?? null, membership.joinedAt!);
      referredPhones.push(e164);
    },
    minStartMs: 0, minVerifyMs: 0, log: () => {},
  });
  let platform: ReturnType<typeof createPublicApi>;
  const server = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const { pathname } = new URL(req.url);
      if (pathname.startsWith("/api/")) {
        if (pathname === "/api/join" && req.method === "POST") {
          const payload = await req.clone().json() as Record<string, unknown>;
          joins.push(payload);
          if (payload.inviteToken === retryToken && !interceptedRetry) {
            interceptedRetry = true;
            await retryAttemptHeld;
            return Response.json({ ok: false, error: "server" }, { status: 503 });
          }
        }
        return (await platform.fetch(req)) ?? new Response("Not found", { status: 404 });
      }
      const file = join(out, normalize(pathname === "/join" ? "/join.html" : pathname));
      return file.startsWith(out) && existsSync(file) ? new Response(await fileAt(file).blob()) : new Response("Not found", { status: 404 });
    },
  });
  const origin = server.url.origin;
  platform = platformFor(server.url.host);
  const browser = await chromium.launch({ headless: true });
  const withPage = async (run: (page: any) => Promise<void>) => {
    const context = await browser.newContext();
    try {
      await context.route("https://**/*", (route: any) => route.abort());
      const page = await context.newPage();
      page.setDefaultTimeout(7_000);
      await run(page);
    } finally {
      await context.close();
    }
  };
  const verifyInSession = async (page: any, phone: string) => {
    const post = (path: string, data: Record<string, string>) => page.request.post(origin + path, { headers: { origin }, data });
    expect((await post("/api/auth/otp/start", { phone })).ok()).toBe(true);
    expect((await post("/api/auth/otp/verify", { phone, code: "246810" })).ok()).toBe(true);
  };
  const step = async (page: any, name: string) => {
    try {
      await page.locator(`[data-join-step="${name}"]`).waitFor({ state: "visible" });
    } catch (error) {
      throw new Error(`Expected join step ${name}. The built page shows ${await page.locator("[data-join-step]").innerText()}`, { cause: error });
    }
  };
  const profile = async (page: any) => {
    await step(page, "Profile");
    await page.getByLabel("First name").fill("Ari");
    await page.getByLabel("Birthday", { exact: true }).fill("1996-03-14");
  };
  const agree = (page: any) => page.getByRole("checkbox").click();
  const submit = (page: any) => page.getByRole("button", { name: "Join", exact: true }).click();
  const inviteUrl = (token: string) => `${origin}/join#invite=${token}`;
  try {
    await withPage(async page => {
      await page.goto(inviteUrl(directToken));
      await step(page, "Phone");
      expect(page.url()).toBe(`${origin}/join`);
      await page.getByLabel("Mobile number").fill(first.slice(2));
      await page.getByRole("button", { name: "Text me a code" }).click();
      await step(page, "Code");
      await page.getByLabel("Code").fill("246810");
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await profile(page);
      await submit(page);
      expect(joins).toHaveLength(0);
      await agree(page);
      await page.getByLabel("Birthday", { exact: true }).fill("2999-01-01");
      await submit(page);
      await page.getByText("Enter your birthday. It must be a real date, not after today.").waitFor();
      expect(await page.getByLabel("Birthday", { exact: true }).getAttribute("aria-invalid")).toBe("true");
      expect(joins).toHaveLength(0);
      await page.getByLabel("Birthday", { exact: true }).fill("1996-03-14");
      await submit(page);
      await step(page, "Done");
      expect(page.url()).toBe(`${origin}/join`);
      expect(joins[0]).toMatchObject({ inviteToken: directToken, firstName: "Ari", birthdate: "1996-03-14", consent: { sms: true, wording: APPS.peon.consent.text } });
      expect(joins[0]).not.toHaveProperty("age");
      expect(await page.evaluate((token: string) => Object.values(localStorage).concat(Object.values(sessionStorage)).some(value => value.includes(token)), directToken)).toBe(false);
    });

    await withPage(async page => {
      await verifyInSession(page, second);
      await page.goto(inviteUrl(verifiedToken));
      await profile(page);
      await agree(page);
      await submit(page);
      await step(page, "Done");
      expect(joins[1]).toMatchObject({ inviteToken: verifiedToken });
    });
    expect(referredPhones).toEqual([first, second]);
    expect(joins[0]?.signupView).not.toEqual(joins[1]?.signupView);

    await withPage(async page => {
      await verifyInSession(page, third);
      await page.goto(inviteUrl(expiredToken));
      await profile(page);
      await agree(page);
      await submit(page);
      await step(page, "Blocked");
      expect(joins[2]).toMatchObject({ inviteToken: expiredToken });
      expect(await store.findPhone(third)).toBeUndefined();
    });

    await withPage(async page => {
      await verifyInSession(page, fourth);
      await page.goto(inviteUrl(directToken));
      await profile(page);
      await agree(page);
      await verifyInSession(page, fifth);
      await submit(page);
      await page.getByText("Your account changed. Please check your details again.").waitFor();
      expect(await page.getByLabel("First name").inputValue()).toBe("");
      await profile(page);
      await agree(page);
      await submit(page);
      await step(page, "Done");
      expect(joins[3]).toMatchObject({ inviteToken: directToken });
      expect(joins[4]).not.toHaveProperty("inviteToken");
      expect(referredPhones).toEqual([first, second]);
    });

    await withPage(async page => {
      await verifyInSession(page, retryPhone);
      await page.goto(inviteUrl(retryToken));
      await profile(page);
      await agree(page);
      const from = joins.length;
      // spec/browserJoin.md, "A form that waits for an answer refuses a second submit"
      const firstPost = page.waitForRequest(`${origin}/api/join`);
      await submit(page);
      await firstPost;
      await page.getByRole("button", { name: "Saving…" }).waitFor();
      expect(await page.getByLabel("First name").evaluate((input: HTMLInputElement) => input.readOnly)).toBe(true);
      await page.locator('[data-join-step="Profile"] form').evaluate((form: HTMLFormElement) => form.requestSubmit());
      releaseRetryAttempt();
      // spec/browserJoin.md, "The server answer decides between done, blocked and a new sign-in"
      await page.getByText("Something went wrong on our side. Please try again in a minute.").waitFor();
      expect(joins).toHaveLength(from + 1);
      expect(await page.getByLabel("First name").inputValue()).toBe("Ari");
      expect(await page.getByRole("checkbox").getAttribute("aria-checked")).toBe("true");
      await submit(page);
      await step(page, "Done");
      expect(joins.slice(from)).toHaveLength(2);
      expect(joins[from + 1]).toEqual(joins[from]);
      expect(referredPhones).toEqual([first, second, retryPhone]);
    });

    // spec/siteEnrollment.md, "A submitted account marker must match the authenticated account"
    await withPage(async page => {
      const original = await platform.accounts.createPerson(reassigned, "otp_sms", 40);
      await verifyInSession(page, reassigned);
      await page.goto(`${origin}/join`);
      await profile(page);
      await agree(page);

      await store.setPhoneHold(reassigned, "recycled_number");
      expect(await platform.accounts.clearHold(reassigned, "new_owner")).toBe(true);
      const current = await platform.accounts.createPerson(reassigned, "otp_sms", 35);
      expect(current.id).not.toBe(original.id);
      now += 60_000;
      await verifyInSession(page, reassigned);

      const prior = joins.length;
      const staleResponse = page.waitForResponse(`${origin}/api/join`);
      await submit(page);
      expect((await staleResponse).status()).toBe(409);
      await page.getByText("Your account changed. Please check your details again.").waitFor();
      expect(await page.getByLabel("First name").inputValue()).toBe("");
      expect(await page.getByLabel("Birthday", { exact: true }).inputValue()).toBe("");
      expect(await page.getByRole("checkbox").getAttribute("aria-checked")).toBe("false");
      expect(await store.getMembership(current.id, "peon")).toBeUndefined();
      expect(await store.consentEvents(reassigned, "peon")).toHaveLength(0);
      expect((await store.getPerson(current.id))?.lowestAge).toBe(35);

      await page.getByLabel("First name").fill("Rae");
      await page.getByLabel("Birthday", { exact: true }).fill("1991-03-14");
      await agree(page);
      await submit(page);
      await step(page, "Done");
      expect(joins[prior]?.signupView).not.toEqual(joins[prior + 1]?.signupView);
      expect(await store.getMembership(current.id, "peon")).toMatchObject({ firstName: "Rae" });
      expect(await store.consentEvents(reassigned, "peon")).toHaveLength(1);
    });
  } finally {
    releaseRetryAttempt();
    await browser.close();
    await server.stop(true);
    rmSync(out, { recursive: true, force: true });
  }
}, 60_000);
