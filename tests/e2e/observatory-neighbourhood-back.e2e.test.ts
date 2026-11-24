import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../../apps/observatory/src/server.ts";

const browserTest = process.env.PLAYWRIGHT_MODULE ? test : test.skip;

browserTest("Back after an app switch reopens the neighbourhood detail from the hash", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
  const dir = await mkdtemp(join(tmpdir(), "obs-neighbourhood-back-"));
  const token = "neighbourhood-back-local-test-0123456789abcdef";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, peopleUrl: false, staffRolesUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 1, personas: 24, pushMs: 3_600_000, tickMs: 3_600_000 } });
  const browser = await chromium.launch({ headless: true });
  const evidence = process.env.OBSERVATORY_BACK_VIDEO_DIR;
  const context = await browser.newContext(evidence
    ? { recordVideo: { dir: evidence, size: { width: 1280, height: 720 } }, viewport: { width: 1280, height: 720 } }
    : { viewport: { width: 1280, height: 720 } });
  try {
    const page = await context.newPage();
    await page.goto(`${server.url}/#token=${token}`, { waitUntil: "domcontentloaded" });
    await page.locator("#obs-search").waitFor({ timeout: 60_000 });
    const openNeighbourhood = async (name: string) => {
      await page.locator("#obs-search").click();
      await page.locator("#obs-search").fill(name);
      await page.locator(`text=${name}`).first().click();
      await expect.poll(() => page.url(), { timeout: 10_000 }).toContain(`#n=${name}`);
      await page.locator("h2", { hasText: name }).waitFor({ state: "visible", timeout: 10_000 });
    };
    await openNeighbourhood("Williamsburg");
    await openNeighbourhood("Greenpoint");
    await page.locator('nav[aria-label="App"] >> text=slop').click();
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("#a=slop");
    await page.goBack();
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("#n=Williamsburg");
    await page.locator("h2", { hasText: "Williamsburg" }).waitFor({ state: "visible", timeout: 10_000 });
  } finally {
    await context.close();
    await browser.close();
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 180_000);

browserTest("Back within one app reopens the earlier neighbourhood from the hash", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
  const dir = await mkdtemp(join(tmpdir(), "obs-neighbourhood-back-same-app-"));
  const token = "neighbourhood-back-same-app-local-test-0123456789abcdef";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, peopleUrl: false, staffRolesUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 1, personas: 24, pushMs: 3_600_000, tickMs: 3_600_000 } });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const page = await context.newPage();
    await page.goto(`${server.url}/#token=${token}`, { waitUntil: "domcontentloaded" });
    await page.locator("#obs-search").waitFor({ timeout: 60_000 });
    const openNeighbourhood = async (name: string) => {
      await page.locator("#obs-search").click();
      await page.locator("#obs-search").fill(name);
      await page.locator(`text=${name}`).first().click();
      await expect.poll(() => page.url(), { timeout: 10_000 }).toContain(`#n=${name}`);
      await page.locator("h2", { hasText: name }).waitFor({ state: "visible", timeout: 10_000 });
    };
    await openNeighbourhood("Williamsburg");
    await openNeighbourhood("Greenpoint");
    await page.goBack();
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("#n=Williamsburg");
    await page.locator("h2", { hasText: "Williamsburg" }).waitFor({ state: "visible", timeout: 10_000 });
  } finally {
    await context.close();
    await browser.close();
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 180_000);

browserTest("Back after an app switch drops a member focus from the URL", async () => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
  const dir = await mkdtemp(join(tmpdir(), "obs-member-back-"));
  const token = "member-back-local-test-0123456789abcdef";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token, peopleUrl: false, staffRolesUrl: false,
    audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
    game: { seed: 1, personas: 24, pushMs: 3_600_000, tickMs: 3_600_000 } });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  try {
    const page = await context.newPage();
    await page.goto(`${server.url}/#token=${token}`, { waitUntil: "domcontentloaded" });
    await page.locator("#obs-search").waitFor({ timeout: 60_000 });
    await page.locator("#obs-search").click();
    await page.locator("#obs-search").fill("Ravi Sato");
    await page.locator("text=Ravi Sato").first().click();
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("#m=m0001");
    await page.locator("h2", { hasText: "Ravi Sato" }).waitFor({ state: "visible", timeout: 10_000 });
    await page.locator('nav[aria-label="App"] >> text=slop').click();
    await expect.poll(() => page.url(), { timeout: 10_000 }).toContain("#a=slop");
    await page.goBack();
    await expect.poll(() => page.url(), { timeout: 10_000 }).not.toContain("#m=");
    await expect.poll(() => page.locator("h2", { hasText: "Ravi Sato" }).count(), { timeout: 10_000 }).toBe(0);
  } finally {
    await context.close();
    await browser.close();
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 180_000);
