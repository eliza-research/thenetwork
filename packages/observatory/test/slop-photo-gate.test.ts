// SD-283: the console's slop photo gate against founder decision 9 (no ID check; a stated age of 18+ is
// enough). The Network service (service.ts verifiedAdult) refuses an adult only when the last age check
// staff recorded failed (verify:age:fail). The console must not ask for a verify:age:pass tag that
// nothing writes. Real mode on Postgres with a local fake of the service's staff API. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { SlopProfile360 } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");

describe.skipIf(!pgAvailable)("slop photo gate in the console (Postgres)", () => {
  let url: string;
  let sql: SQL;
  let dir: string;
  let obs: ObservatoryServer;
  let fake: ReturnType<typeof Bun.serve>;
  const photoCalls: string[] = [];
  const TOK = { safety: long("safety-slop-photo") };
  const post = (path: string, body: unknown) => fetch(obs.url + path, { method: "POST", body: JSON.stringify(body), headers: { authorization: `Bearer ${TOK.safety}`, "content-type": "application/json" } });
  const panel = async (id: string) => (await (await fetch(`${obs.url}/api/member/${id}/app?app=slop`, { headers: { authorization: `Bearer ${TOK.safety}` } })).json()) as SlopProfile360;

  beforeAll(async () => {
    url = await testDb();
    sql = new SQL(url);
    // g1: an adult with a stated age and no age check (the usual slop member). g2: an adult whose age check failed.
    await sql.begin(async tx => {
      await tx`set local app.app_id = 'slop'`;
      await tx`insert into network.members (id, name, home_city, account_status, age, joined_at) values
        ('g1', 'Gia Stated', 'nyc', 'active', 27, now()), ('g2', 'Gus Failed', 'nyc', 'active', 30, now())`;
      await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance) values
        ('slop', 'gf1', 'g2', 'fact', 'age check failed', '{verify:age:fail}'::text[], 'agent_private', 'said')`;
    });
    fake = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/health") return Response.json({ ok: false, error: "fake" });
        if (/^\/members\/[^/]+\/photos$/.test(u.pathname)) { photoCalls.push(u.pathname); return Response.json({ ok: true, photos: [{ id: "ph1", url: "https://photos.example.org/ph1.jpg", expiresAt: Date.now() + 60_000 }] }); }
        return Response.json({ error: "no route" }, { status: 404 });
      },
    });
    dir = await mkdtemp(join(tmpdir(), "obs-photo-gate-"));
    obs = await createServer({
      port: 0, development: false, mode: "real", audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") }, peopleUrl: false,
      tokens: `safety@slop:${TOK.safety}`,
      real: { url, pollMs: 3_600_000, pushMs: 3_600_000, service: { url: fake.url.href, token: long("console-svc-photo") } },
    });
  }, T);

  afterAll(async () => {
    await obs?.stop(); fake?.stop(true);
    await sql?.close(); await dropTestDb();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("an adult with a stated age and no age check: safety staff with a reason get the photos", async () => {
    expect((await panel("g1")).photos).toBe("reason_required");
    const r = await post("/api/member/g1/photos?app=slop", { reason: "report r1 check" });
    expect(r.status).toBe(200);
    expect(photoCalls).toEqual(["/members/g1/photos"]);
  }, T);

  test("an adult whose age check failed: refused before the service is asked", async () => {
    expect((await panel("g2")).photos).toBe("needs_verification");
    const r = await post("/api/member/g2/photos?app=slop", { reason: "report r2 check" });
    expect([r.status, (await r.json()).code]).toEqual([403, "needs_verification"]);
    expect(photoCalls).not.toContain("/members/g2/photos");
  }, T);
});
