import { expect, test } from "vitest";
import { DAY, HOUR, SimClock } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { serveHttp } from "../../core/src/runtime/http.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { NetworkService } from "../../network/service/service.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";
import { Mini } from "../../network/test/mini.ts";
import { APPS } from "../../platform/src/apps.ts";
import { createServer } from "../src/server.ts";
import type { AuditEntry, StaffProbePreview } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("a named reviewer reads the probe and reveal copy of the open revision through the console", async () => {
  const url = await testDb();
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 19, 17));
  const serviceToken = "fixture-probe-review-service-token", reviewer = "fixture-probe-friends-reviewer",
    analyst = "fixture-probe-friends-analyst", otherApp = "fixture-probe-ntwrk-reviewer";
  const networkId = "friends:nyc";
  const network = new NetworkService({ url, clock, photoStorage: null, notify: false, log: () => {},
    env: { PLATFORM_ENV: "dev" }, networks: [{ id: networkId }, { id: "ntwrk:nyc", matchingEnabled: false }],
    devMatching: [networkId], network: { plans: false, growth: false, maxNewPerDay: 0 }, reviewJudge: holdEveryItem.judge,
    tokens: `reviewer@*:${serviceToken}`, consoleToken: serviceToken,
  });
  const audit: AuditEntry[] = [];
  const reads: Array<{ actor: string | null; logged: number }> = [];
  let server: Awaited<ReturnType<typeof serveHttp>> | undefined;
  let consoleServer: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await network.start();
    const app = APPS.friends;
    const names = ["Ari", "Blair", "Charlie", "Drew", "Elliot"];
    const members = [];
    for (const [index, firstName] of names.entries()) {
      const joined = await network.accounts.join(app, { e164: `+1212555049${index}`, personId: null }, {
        firstName, age: 32, homeCity: "nyc", neighborhood: "Inwood", interests: ["hiking"], consent: { sms: true, wording: app.consent.text },
      });
      if (!joined.ok) throw new Error(`Fixture join refused for ${firstName}`);
      members.push({ id: joined.membership.memberId, name: firstName, age: 32 });
    }
    const ids = members.map(member => member.id);
    const invited = ids.slice(0, 3), alternates = ids.slice(3, 5);
    const fixture = new Mini(members, { app: app.id, plans: false, growth: false });
    const now = clock.now();
    fixture.clock.set(now);
    await fixture.onboard(...ids);
    const plan: plans.Plan = {
      id: "probe_preview_fixture", city: "nyc", activityId: "day_hike", venueId: "inwood-hill",
      place: { name: "Inwood Hill Park", area: "Inwood" }, window: { start: now + 5 * DAY, end: now + 5 * DAY + 4 * HOUR },
      invited, alternates, partner: false, size: { min: 3, target: 3, max: 4 }, quorum: 3,
      probeDeadline: now + 3 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "social",
    };
    const rt = network.runtimes.get(networkId)!;
    const id = await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: fixture.net.exportState().members });
      return net["submitPlan"](plan, now)!.id;
    });
    await network.reviewJudgeTick();
    const item = (await rt.reviewQueue()).find(row => row.oppId === id);
    expect(item).toMatchObject({ revision: 0, exception: { verdict: "flag", reason: "other_concern", revision: 0 } });

    server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: async req => {
      if (new URL(req.url).pathname.endsWith("/probes")) reads.push({ actor: req.headers.get("x-network-staff-id"), logged: audit.filter(row => row.action === "read_review_probes").length });
      return network.fetch(req);
    } });
    consoleServer = await createServer({ hostname: "127.0.0.1", port: 0, mode: "real", realOnly: true, platformEnv: "dev",
      tokens: `reviewer@friends:${reviewer},analyst@friends:${analyst},reviewer@ntwrk:${otherApp}`, minTokenLength: 10,
      staffRolesUrl: false, peopleUrl: false, real: { url, service: { url: server.url.href, token: serviceToken } },
      audit: { kind: "file", async write(entry) { audit.push(entry); }, async list() { return audit; }, async close() {} },
    });
    const request = (path: string, token: string | null) => fetch(new URL(path, consoleServer!.url), {
      headers: { "x-observatory-mode": "real", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    });
    const preview = (revision: number, token: string | null = reviewer, appId = "friends") =>
      request(`/api/review/${encodeURIComponent(id)}/probes?app=${appId}&revision=${revision}`, token);
    expect((await preview(0, null)).status).toBe(401);
    expect((await preview(0, analyst)).status).toBe(403);
    expect((await preview(0, otherApp)).status).toBe(403);
    expect(reads).toEqual([]);

    const { id: actor } = await (await request("/api/me", reviewer)).json();
    const exact = await preview(0);
    expect(exact.status).toBe(200);
    const body = await exact.json() as { ok: boolean; preview: StaffProbePreview };
    expect(body).toMatchObject({ ok: true, preview: { app: "friends", opportunityId: id, revision: 0, deadline: item!.deadline } });
    expect(body.preview.probes.map(p => p.memberId).sort()).toEqual([...invited].sort());
    for (const probe of [...body.preview.probes, ...body.preview.replacements.flatMap(r => r.probes)]) {
      expect(typeof probe.text === "string" && probe.text.length > 0).toBe(true);
      expect(probe.reveal.text.length).toBeGreaterThan(0);
    }
    expect(body.preview.replacements.length).toBeGreaterThan(0);
    expect(body.preview.replacements.every(r => alternates.includes(r.alternate) && invited.includes(r.replaces))).toBe(true);
    expect(reads).toEqual([{ actor, logged: 1 }]);
    expect(audit.filter(row => row.action === "read_review_probes")).toEqual([
      expect.objectContaining({ actor, app: "friends", targetType: "opportunity", targetId: id, ok: true, detail: { revision: 0 } }),
    ]);
    expect(await sql`select actor, app_id, target_id, detail from network.staff_audit where action = 'read_review_probes'`).toEqual([
      { actor, app_id: "friends", target_id: id, detail: { revision: 0 } },
    ]);

    expect((await preview(1)).status).toBe(404);
    expect((await preview(0, otherApp, "ntwrk")).status).toBe(404);
    expect(await sql`select id from network.messages where app_id = 'friends' and opportunity_id = ${id}`).toEqual([]);
  } finally {
    await consoleServer?.stop();
    await server?.stop(true);
    await network.close();
    await sql.close();
    await dropTestDb();
  }
}, 60_000);
