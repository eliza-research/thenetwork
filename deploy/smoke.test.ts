// deploy/smoke.ts against a built site served by the dev server (the same files Cloudflare serves),
// and against a broken site, so a bad deploy cannot pass the post-deploy check.
//   bun test deploy
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveSite } from "../scripts/sites-dev.ts";
import { buildSite, site } from "../sites/sites.ts";
import { smoke } from "./smoke.ts";

const tmp = mkdtempSync(join(tmpdir(), "smoke-"));
const slop = site("slop");
const api = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => Response.json({ id: "slop", name: "slop" }) });
let server: ReturnType<typeof serveSite>;

beforeAll(async () => {
  const r = await buildSite(slop, join(tmp, "slop"));
  if (!r.ok) throw new Error(r.logs.join("\n"));
  server = serveSite(slop, { port: 0, apiOrigin: `http://127.0.0.1:${api.port}`, outdir: join(tmp, "slop") });
});
afterAll(() => {
  server.stop(true);
  api.stop(true);
  rmSync(tmp, { recursive: true, force: true });
});

test("a good build passes every check, with the API", async () => {
  const checks = await smoke(`http://127.0.0.1:${server.port}`, "slop", { api: true });
  expect(checks.filter((c) => !c.ok)).toEqual([]);
  expect(checks.length).toBeGreaterThan(8);
});

test("the wrong app fails, and a broken SKILL.md fails", async () => {
  const wrong = await smoke(`http://127.0.0.1:${server.port}`, "peon", { api: true });
  expect(wrong.some((c) => !c.ok && c.name.includes("/api/app"))).toBe(true);
  writeFileSync(join(tmp, "slop", "SKILL.md"), "---\nname: {{placeholder}}\n---\n");
  const broken = await smoke(`http://127.0.0.1:${server.port}`, "slop");
  expect(broken.filter((c) => !c.ok).map((c) => c.name)).toEqual(["/SKILL.md names this site's skill", "/SKILL.md equals the canonical copy"]);
});

test("nothing listening fails closed", async () => {
  const checks = await smoke("http://127.0.0.1:9", "slop");
  expect(checks.every((c) => !c.ok)).toBe(true);
});
