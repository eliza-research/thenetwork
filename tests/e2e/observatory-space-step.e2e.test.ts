import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOUR } from "../../packages/core/src/clock.ts";
import { createServer } from "../../apps/observatory/src/server.ts";
import type { ObsState } from "../../apps/observatory/src/types.ts";

const browserTest = process.env.PLAYWRIGHT_MODULE ? test : test.skip;

browserTest("Space on the focused +1h button steps one hour and leaves play alone", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
  const dir = await mkdtemp(join(tmpdir(), "obs-space-step-"));
  const token = "space-step-local-test-0123456789abcdef";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, peopleUrl: false, staffRolesUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 1, personas: 24, pushMs: 3_600_000, tickMs: 3_600_000 } });
  const browser = await chromium.launch({ headless: true });
  const evidence = process.env.OBSERVATORY_SPACE_VIDEO_DIR;
  const context = await browser.newContext(evidence
    ? { recordVideo: { dir: evidence, size: { width: 1280, height: 720 } }, viewport: { width: 1280, height: 720 } }
    : { viewport: { width: 1280, height: 720 } });
  try {
    const state = () => fetch(`${server.url}/api/state`, { headers }).then(r => r.json() as Promise<ObsState>);
    const page = await context.newPage();
    await page.goto(`${server.url}/#token=${token}`, { waitUntil: "domcontentloaded" });
    const step = page.locator('button[title="Step one hour (n)"]');
    await step.waitFor({ timeout: 60_000 });
    const before = await state();
    expect(before.clock.playing).toBe(false);
    await step.click();
    await expect.poll(async () => (await state()).clock.now, { timeout: 10_000 }).toBe(before.clock.now + HOUR);
    expect(await page.evaluate(() => document.activeElement?.getAttribute("title"))).toBe("Step one hour (n)");
    await page.keyboard.press(" ");
    await expect.poll(async () => {
      const s = await state();
      return { now: s.clock.now, playing: s.clock.playing };
    }, { timeout: 10_000 }).toEqual({ now: before.clock.now + 2 * HOUR, playing: false });
    expect(await page.locator('button[aria-label="Play"]').count()).toBe(1);
    const speed = page.locator('button[aria-label="Speed"]');
    await speed.focus();
    await page.keyboard.press(" ");
    await expect.poll(async () => (await state()).clock.playing, { timeout: 10_000 }).toBe(false);
    await page.keyboard.press("Escape");
    await page.locator("body").click();
    await page.keyboard.press(" ");
    await expect.poll(async () => (await state()).clock.playing, { timeout: 10_000 }).toBe(true);
    await page.locator('button[aria-label="Pause"]').waitFor({ timeout: 10_000 });
    await page.keyboard.press(" ");
    await expect.poll(async () => (await state()).clock.playing, { timeout: 10_000 }).toBe(false);
  } finally {
    await context.close();
    await browser.close();
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 180_000);
