// Real mode acts through the Network service's staff API (packages/network/service), never through its
// own database login: a simulated run is written to Postgres, the real service runs on that database,
// and the Observatory's real mode sends review, safety and matching-switch commands to it and reads the
// result back. Without the service, real mode stays read-only. Skipped without Postgres.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY, SimClock } from "@thenetwork/core";
import { NetworkService } from "../../network/service/service.ts";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { GameSource } from "../src/sources/game.ts";
import { RealSource } from "../src/sources/real.ts";
import { serviceAlerts, type ServiceHealth } from "../src/sources/service.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const SERVICE_TOKEN = "svc-console-7f2a";
const REVIEWER = "rev@example.org";

describe.skipIf(!pgAvailable)("real mode: staff actions through the Network service", () => {
  let url: string;
  let svc: NetworkService;
  let http: ReturnType<typeof Bun.serve>;
  let real: RealSource;
  const seen: { path: string; staff: string | null; body: unknown }[] = [];
  beforeAll(async () => {
    url = await testDb();
    // Two simulated days with a human reviewer: items wait in review, and the spam wave opens safety cases.
    const g = new GameSource({ pushMs: 3_600_000, tickMs: 3_600_000, seed: 1, review: "human", scenario: "spam_wave" });
    await g.init();
    await g.control({ type: "step", ms: 2 * DAY });
    const sql = new SQL(url);
    await writeRows(sql, rowsFromGame(g), { truncate: true });
    await sql.close();
    await g.dispose();
    // The console's own token: only it may name the reviewer of record (X-Network-Staff-Id).
    svc = new NetworkService({ url, clock: new SimClock(Date.now()), tokens: `admin:${SERVICE_TOKEN}`, consoleToken: SERVICE_TOKEN, log: () => {} });
    http = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      async fetch(req) {
        seen.push({ path: new URL(req.url).pathname, staff: req.headers.get("x-network-staff-id"), body: req.method === "POST" ? await req.clone().json() : undefined });
        return svc.fetch(req);
      },
    });
    real = new RealSource({ url, pollMs: 3_600_000, pushMs: 3_600_000, service: { url: http.url.href, token: SERVICE_TOKEN } });
    await real.init();
  }, T);
  afterAll(async () => { await real?.dispose(); http?.stop(true); await svc?.close(); await dropTestDb(); });

  test("review: the decision goes to the service with the staff id, is stored by the service, and real mode shows it; a refusal comes back with the Network's reason", async () => {
    const s = real.state();
    expect(s.env.capabilities).toMatchObject({ readOnly: true, staffActions: true });
    expect(s.env.service).toBe(http.url.href.replace(/\/$/, ""));
    const item = s.opportunities.find(o => o.state === "IN_REVIEW")!;
    expect(item).toBeDefined();
    const r = await real.control({ type: "review", oppId: item.id, decision: "reject", reason: "tone", note: "too vague", secondsSpent: 25 }, "rev@example.org");
    expect(r).toEqual({ ok: true });
    expect(seen.find(x => x.path.startsWith("/review/"))).toEqual({ path: `/review/${item.id}`, staff: "rev@example.org", body: { decision: "reject", reason: "tone", note: "too vague", secondsSpent: 25 } });
    // Read back from the database (the service wrote it; this connection did not).
    const after = real.state().opportunities.find(o => o.id === item.id)!;
    expect(after.state).not.toBe("IN_REVIEW");
    expect(after.review).toMatchObject({ decision: "reject", reason: "tone", secondsSpent: 25 });
    // OBS-10: the reviewer of record is the person, not the console's service token.
    expect(after.review!.reviewer).toBe(REVIEWER);
    // OBS-10: time on one item counts at most 30 minutes.
    const next = real.state().opportunities.find(o => o.state === "IN_REVIEW")!;
    expect(await real.control({ type: "review", oppId: next.id, decision: "reject", reason: "tone", secondsSpent: 99_999 }, REVIEWER)).toEqual({ ok: true });
    expect(real.state().opportunities.find(o => o.id === next.id)!.review).toMatchObject({ reviewer: REVIEWER, secondsSpent: 1800 });
    // Again: the item no longer waits.
    expect(await real.control({ type: "review", oppId: item.id, decision: "approve" }, "rev@example.org")).toMatchObject({ ok: false, code: "not_in_review", error: "that opportunity is not waiting for review" });
    // The connection itself still cannot write.
    const conn = (real as unknown as { sql: SQL }).sql;
    const err = await conn`update network.review_items set note = 'x'`.then(() => "changed", e => String((e as Error).message));
    expect(err).toMatch(/read-only/);
  }, T);

  test("safety and the matching switch go through the service; config history names who changed it", async () => {
    const sf = await real.safety();
    expect(sf.canAct).toBe(true);
    const open = sf.cases.find(c => c.status !== "closed");
    expect(open).toBeDefined();
    expect(await real.safetyAction({ action: "close", caseId: open!.id, note: "no further action" }, "safety@example.org")).toEqual({ ok: true });
    expect((await real.safety()).cases.find(c => c.id === open!.id)?.status).toBe("closed");
    expect(await real.safetyAction({ action: "close", caseId: open!.id }, "safety@example.org")).toMatchObject({ ok: false, code: "already_closed", error: "that case is already closed" });
    expect(await real.safetyAction({ action: "lift", memberId: "nobody" }, "safety@example.org")).toMatchObject({ ok: false, code: "not_on_hold" });

    const before = await real.config();
    expect(before.canChange).toBe(true);
    expect(await real.control({ type: "matching", on: false }, "admin@example.org")).toEqual({ ok: true });
    expect(real.state().network?.matchingEnabled).toBe(false);
    const cfg = await real.config();
    expect(cfg.matchingEnabled).toBe(false);
    expect(cfg.history.at(-1)).toMatchObject({ key: "matching", to: false });
    expect(seen.filter(x => x.path === "/matching").map(x => [x.staff, x.body])).toEqual([["admin@example.org", { on: false }]]);
    // Matching off: an approval is refused with the Network's reason.
    const item = real.state().opportunities.find(o => o.state === "IN_REVIEW");
    if (item) expect(await real.control({ type: "review", oppId: item.id, decision: "approve" }, "rev@example.org")).toMatchObject({ ok: false, code: "matching_paused" });
  }, T);

  test("health: the service's state is in the alerts strip; a service that does not answer is a bad alert and actions refuse", async () => {
    const keys = () => (real.state().stats.alerts ?? []).map(a => `${a.level}:${a.key}`);
    await svc.tick();
    await real.control({ type: "refresh" });
    expect(keys()).toContain("info:service_ok");
    expect(real.state().stats.alerts!.find(a => a.key === "service_ok")!.text).toMatch(/^Network service up: last tick \d+ s ago, channel dry_run/);
    // A late tick (the service ticks every minute): warn after 5 minutes, bad after 15.
    const h = await (await fetch(`${http.url.href}health`, { headers: { authorization: `Bearer ${SERVICE_TOKEN}` } })).json() as ServiceHealth;
    const at = (min: number) => serviceAlerts({ ...h, lastTick: { ...h.lastTick, stored: Date.now() - min * 60_000 } }, Date.now()).map(a => `${a.level}:${a.key}`);
    expect(at(7)).toContain("warn:service_tick");
    expect(at(20)).toContain("bad:service_tick");
    expect(at(20)).not.toContain("info:service_ok");
    http.stop(true);
    await real.control({ type: "refresh" });
    expect(keys()).toContain("bad:service_down");
    expect(await real.control({ type: "matching", on: true }, "admin@example.org")).toMatchObject({ ok: false, code: "service_unavailable" });
  }, T);

  test("without NETWORK_SERVICE_URL real mode is read-only", async () => {
    const ro = new RealSource({ url, pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    await ro.init();
    try {
      expect(ro.state().env.capabilities.staffActions).toBe(false);
      expect(await ro.control({ type: "matching", on: true }, "admin@example.org")).toMatchObject({ ok: false, code: "read_only" });
      expect(await ro.safetyAction({ action: "lift", memberId: "x" }, "s")).toMatchObject({ ok: false, code: "read_only" });
      expect((await ro.safety()).canAct).toBe(false);
      expect((await ro.config()).canChange).toBe(false);
    } finally { await ro.dispose(); }
  }, T);
});
