// The Network service's launch gate, shadow switch and shadow rows in Postgres, migration 0017, and
// the console's shadow run cities from the app registry. A database of its own (dropped after);
// skipped without Postgres. Nothing is sent: the service runs with the dry-run adapter.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { PgStore, type ConsentNetwork } from "@thenetwork/network";
import type { EngineProposal } from "@thenetwork/engine";
import { NetworkService } from "../../network/service/service.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { migrate } from "../db/migrate.ts";
import { RealSource } from "../src/sources/real.ts";
import { staffUser, type AuditSink } from "../src/staff.ts";
import type { AuditEntry } from "../src/types.ts";
import { T0, testNetwork } from "./net.ts";

class MemAudit implements AuditSink {
  readonly kind = "postgres" as const;
  rows: AuditEntry[] = [];
  async write(e: AuditEntry) { this.rows.push(e); }
  async list() { return [...this.rows].reverse(); }
  async close() {}
}

const admin = staffUser("admin@x.com", [{ role: "admin", app: "*" }], "sso");

describe.skipIf(!pgAvailable)("service: launch gate, shadow switch, shadow rows", () => {
  let url: string;
  let svc: NetworkService;
  let audit: MemAudit;
  beforeAll(async () => {
    url = await migratedDb("console");
    audit = new MemAudit();
    svc = new NetworkService({ url, networks: [{ id: "slop:nyc" }, { id: "peon:nyc", matchingEnabled: false }], env: { PLATFORM_ENV: "dev" }, notify: false, audit, photoStorage: null, log: () => {} });
  });
  afterAll(async () => { await svc?.close(); if (url) await dropDb(url); });

  test("migration 0017 applied: the shadow and second-review columns exist, and migrating again changes nothing", async () => {
    const sql = new SQL({ url, max: 1 });
    try {
      const cols = (await sql`select column_name from information_schema.columns where table_schema = 'network' and table_name = 'review_items'`).map((r: any) => r.column_name);
      for (const c of ["shadow", "second_status", "second_decision", "second_reviewer", "second_reason", "second_decided_at"]) expect(cols).toContain(c);
      const [m] = await sql`select count(*)::int as n from public.__migrations where id = '0017_shadow_review'`;
      expect(m.n).toBe(1);
    } finally { await sql.close(); }
    const again = await migrate(url, { lockTimeout: "5s" });
    expect(again.applied.filter(x => !["0001_network_schema", "0002_network_state", "9001_oauth_schema", "9002_notify_schema"].includes(x))).toEqual([]);
  });

  test("matching on is refused below the launch gate; an override needs a typed reason and is audited", async () => {
    const rt = svc.runtimeFor("slop")!;
    const gate = await svc.launchGate(rt);
    expect(gate).toMatchObject({ committedAdults: 0, needAdults: 40, shadowDays: 0, needDays: 14, ok: false });
    expect(await svc.setMatching(admin, true, rt)).toEqual({ ok: false, reason: "launch_gate_adults" });
    expect(await svc.setMatching(admin, true, rt, { override: "pilot" })).toEqual({ ok: false, reason: "override_reason_required" });
    expect(await rt.readState(n => n.matchingEnabled())).toBe(false);
    expect(await svc.setMatching(admin, true, rt, { override: "founder approved: pilot with 35 adults" })).toEqual({ ok: true });
    expect(await rt.readState(n => n.matchingEnabled())).toBe(true);
    const over = audit.rows.find(r => r.detail?.phase === "override");
    expect(over).toMatchObject({ action: "config", reason: "founder approved: pilot with 35 adults", ok: true, app: "slop" });
    expect(audit.rows.filter(r => r.detail?.phase === "refused").length).toBe(2);
    // Off needs no gate; a network the registry does not allow (peon) refuses on, override or not.
    expect(await svc.setMatching(admin, false, rt)).toEqual({ ok: true });
    expect(await svc.setMatching(admin, true, svc.runtimeFor("peon")!, { override: "a long enough reason here" })).toEqual({ ok: false, reason: "matching_not_allowed" });
  });

  test("the HTTP routes: /launch-gate and /shadow are admin only", async () => {
    const tokens = `admin@slop:${"a".repeat(40)},reviewer@slop:${"r".repeat(40)}`;
    const http = new NetworkService({ url, networks: [{ id: "slop:nyc" }], env: { PLATFORM_ENV: "dev" }, notify: false, audit, photoStorage: null, tokens, log: () => {} });
    try {
      const call = (path: string, t: string, body?: object) => http.fetch(new Request(`http://svc${path}`, { method: body ? "POST" : "GET", headers: { authorization: `Bearer ${t}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
      expect((await call("/apps/slop/launch-gate", "r".repeat(40))).status).toBe(403);
      const g = await (await call("/apps/slop/launch-gate", "a".repeat(40))).json();
      expect(g.gate).toMatchObject({ needAdults: 40, needDays: 14 });
      expect((await call("/apps/slop/shadow", "r".repeat(40), { on: true })).status).toBe(403);
      expect((await call("/apps/slop/shadow", "a".repeat(40), { on: true })).status).toBe(200);
      expect(await http.runtimeFor("slop")!.readState(n => n.shadowEnabled())).toBe(true);
      // A compose naming members this network does not have is refused by the Network, not the route.
      const c = await call("/apps/slop/compose", "r".repeat(40), { participants: ["x1", "x2"], objective: "coffee" });
      expect(c.status).toBe(409);
      expect((await c.json()).reason).toBe("matching_paused");
      expect((await call("/apps/slop/compose", "r".repeat(40), { participants: ["x1"], objective: "coffee" })).status).toBe(400);
    } finally { await http.close(); }
  });

  test("shadow items are stored with their flag and label; the console reads them", async () => {
    // A network in memory with two shadow items, one labelled, saved through the store the service uses.
    const h = testNetwork({ app: "slop", members: [{ id: "ana", age: 29, tags: ["romance:is:woman", "romance:seeks:man"] }, { id: "ben", age: 31, tags: ["romance:is:man", "romance:seeks:woman"] }], network: { matchingEnabled: false, shadow: true } });
    const p = { id: "p1", kind: "intro", participants: ["ana", "ben"], alternates: [], objective: "a date", category: "romance", city: "nyc", window: { start: T0 + DAY, end: T0 + 3 * DAY }, score: 0.7,
      components: { fit: 0.7, mutualBenefit: 0.5, warmPath: 0, novelty: 0.5, timingFit: 0.5, activationCost: 0.1, interruptionCost: 0.1, load: 0, repetition: 0, socialRisk: 0, confidence: 0.8 },
      exploration: false, explanations: {}, generator: "test", createdAt: T0, roles: { ana: "seeker", ben: "peer" } } as unknown as EngineProposal;
    expect((h.net as ConsentNetwork).queueShadow([p])).toBe(1);
    const id = h.net.reviewQueue()[0]!.oppId;
    h.net.decide(id, "reject", { reason: "weak_reason", reviewer: "r1@x.com" });
    const store = new PgStore(url, "slop:nyc");
    try { await store.save(h.net.exportState()); } finally { await store.sql.close(); }
    const sql = new SQL({ url, max: 1 });
    try {
      const [r] = await sql`select shadow, decision, reviewer from network.review_items where opportunity_id = ${id}`;
      expect(r).toMatchObject({ shadow: true, decision: "reject", reviewer: "r1@x.com" });
    } finally { await sql.close(); }
    const src = new RealSource({ url, app: "slop", service: false, pollMs: 3_600_000, pushMs: 3_600_000 });
    try {
      await src.init();
      const o = src.state().opportunities.find(x => x.id === id);
      expect(o?.review?.shadow).toBe(true);
      expect(o?.review?.decision).toBe("reject");
      expect(src.state().stats.scorecard?.find(m => m.key === "shadow_precision")?.n).toBe(1);
      // The console's shadow run: the app's cities come from platform.networks (slop runs in nyc only).
      expect(await (src as unknown as { appCities(): Promise<string[]> }).appCities()).toEqual(["nyc"]);
      const r = await src.control({ type: "shadow_run", city: "sf" });
      expect(r).toMatchObject({ ok: false, code: "unknown_city" });
    } finally { await src.dispose(); }
  });
});
