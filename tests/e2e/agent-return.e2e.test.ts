// Real built Join page in an isolated browser. Only post-verification API replies
// are controlled: this is UI-only evidence, not genuine verification or signup.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSite, site } from "../../sites/sites.ts";

const browserTest = process.env.PLAYWRIGHT_MODULE ? test : test.skip;

browserTest("agent-origin Join returns the person to the same conversation; direct Join stays unchanged", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
  const out = mkdtempSync(join(tmpdir(), "agent-return-build-"));
  const built = await buildSite(site("friends"), out, {});
  expect(built.ok).toBe(true);
  let joins = 0;
  let unexpectedApiCalls = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname;
      // The fixture begins at the already-verified profile step. It has no OTP endpoint.
      if (path === "/api/app") return Response.json({ id: "friends", joinMode: "open", minJoinAge: 13 });
      if (path === "/api/me") return Response.json({ canJoin: true, membership: null, phoneMasked: "(•••) •••-0142" });
      if (path === "/api/auth/mode") return Response.json({ mode: "otp" });
      if (path === "/api/join" && req.method === "POST") {
        joins++;
        const body = await req.json() as { firstName: string };
        return Response.json({ ok: true, membership: { firstName: body.firstName } });
      }
      if (path.startsWith("/api/")) { unexpectedApiCalls++; return new Response("Not found", { status: 404 }); }
      const file = Bun.file(join(out, path === "/join" ? "join.html" : path.slice(1)));
      return await file.exists() ? new Response(file) : new Response("Not found", { status: 404 });
    },
  });
  const browser = await chromium.launch({ headless: true });
  const video = process.env.AGENT_RETURN_VIDEO_DIR;
  const context = await browser.newContext(video ? { recordVideo: { dir: video, size: { width: 1000, height: 800 } }, viewport: { width: 1000, height: 800 } } : {});
  try {
    await context.route("https://**/*", (route: any) => route.abort());
    const page = await context.newPage();
    for (const suffix of ["?via=agent", ""]) {
      const url = `http://127.0.0.1:${server.port}/join${suffix}`;
      await page.goto(url);
      const profile = page.locator('form[data-form="profile"]');
      await profile.waitFor({ state: "visible" });
      expect(await page.locator("[data-agent-return]").count()).toBe(0);
      await profile.locator('[name="firstName"]').fill("TestMember");
      await profile.locator('[name="age"]').fill("21");
      expect(await profile.locator('[name="homeCity"]').count()).toBe(0);
      await profile.locator('[name="consent"]').check();
      await profile.getByRole("button", { name: "Join", exact: true }).click();
      const done = page.locator('[data-step="done"]');
      await done.waitFor({ state: "visible" });
      await done.scrollIntoViewIfNeeded();
      // Give reviewers a readable view in the optional native video recording.
      if (video) await page.waitForTimeout(1200);
      expect(await done.locator('[data-slot="firstName"]').textContent()).toBe("TestMember");
      const handoff = done.locator("[data-agent-return]");
      if (suffix) {
        expect(await handoff.count()).toBe(1);
        expect(await handoff.textContent()).toBe("Go back to the same chat to finish setting up your profile.");
        expect(await handoff.locator("a").count()).toBe(0);
      } else {
        expect(await handoff.count()).toBe(0);
      }
      expect(page.url()).toBe(url);
    }
    expect(joins).toBe(2);
    expect(unexpectedApiCalls).toBe(0);
  } finally {
    await context.close();
    await browser.close();
    server.stop(true);
    rmSync(out, { recursive: true, force: true });
  }
}, 30_000);
