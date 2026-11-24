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
import type { AuditEntry, ObsOpportunity } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("the real staff review card can read only the exact pending plan", async () => {
  // spec/staffReview.md, "A plan preview belongs to the open revision under review"
  const url = await testDb();
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 19, 17));
  const serviceToken = "fixture-plan-review-service-token", reviewer = "fixture-friends-reviewer",
    analyst = "fixture-friends-analyst", otherApp = "fixture-ntwrk-reviewer";
  const networkId = "friends:nyc";
  const network = new NetworkService({ url, clock, photoStorage: null, notify: false, log: () => {},
    env: { PLATFORM_ENV: "dev" }, networks: [{ id: networkId }, { id: "ntwrk:nyc", matchingEnabled: false }],
    devMatching: [networkId], network: { plans: false, growth: false, maxNewPerDay: 0 }, reviewJudge: holdEveryItem.judge,
    tokens: `reviewer@*:${serviceToken}`, consoleToken: serviceToken,
  });
  const audit: AuditEntry[] = [];
  const reads: Array<{ actor: string | null; logged: number }> = [];
  let reverseOptions = false;
  let server: Awaited<ReturnType<typeof serveHttp>> | undefined;
  let consoleServer: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await network.start();
    const app = APPS.friends;
    const names = ["Ari", "Blair", "Charlie", "Drew", "Elliot", "Frank", "Gina"];
    const members = [];
    for (const [index, firstName] of names.entries()) {
      const joined = await network.accounts.join(app, { e164: `+1212555048${index}`, personId: null }, {
        firstName, age: 32, homeCity: "nyc", neighborhood: "Inwood", interests: ["hiking"], consent: { sms: true, wording: app.consent.text },
      });
      if (!joined.ok) throw new Error(`Fixture join refused for ${firstName}`);
      members.push({ id: joined.membership.memberId, name: firstName, age: 32 });
    }
    const ids = members.map(member => member.id);
    const invited = ids.slice(0, 3), alternates = ids.slice(3, 5).reverse();
    const fixture = new Mini(members, { app: app.id, plans: false, growth: false });
    const now = clock.now();
    fixture.clock.set(now);
    await fixture.onboard(...ids);
    const plan: plans.Plan = {
      id: "preview_fixture", city: "nyc", activityId: "day_hike", venueId: "inwood-hill",
      place: { name: "Inwood Hill Park", area: "Inwood" }, window: { start: now + 5 * DAY, end: now + 5 * DAY + 4 * HOUR },
      invited, alternates, partner: false, size: { min: 3, target: 3, max: 4 }, quorum: 3,
      probeDeadline: now + 3 * DAY, score: 0.6, u: {}, familiar: {}, createdAt: now, category: "social",
    };
    const rt = network.runtimes.get(networkId)!;
    const offered = [plan.window, { start: plan.window.start + DAY, end: plan.window.end + DAY }];
    const [groupId, partnerId] = await rt.unitOfWork(net => {
      net.importState({ ...net.exportState(), members: fixture.net.exportState().members });
      const group = net["submitPlan"](plan, now);
      const partner = net["submitPlan"]({ ...plan, id: "preview_partner", window: offered[1]!, reviewedOptions: offered,
        invited: ids.slice(5), alternates: [], partner: true, size: { min: 2, target: 2, max: 2 }, quorum: 2, category: "hobby" }, now);
      return [group!.id, partner!.id];
    });
    await network.reviewJudgeTick();
    const item = (await rt.reviewQueue()).find(row => row.oppId === groupId);
    expect(item).toMatchObject({ origin: "planner", revision: 0, exception: { verdict: "flag", reason: "other_concern", revision: 0 } });
    const id = item!.oppId;

    server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: async req => {
      if (new URL(req.url).pathname.endsWith("/plan")) reads.push({ actor: req.headers.get("x-network-staff-id"), logged: audit.filter(row => row.action === "read_review_plan").length });
      const response = await network.fetch(req);
      if (!reverseOptions) return response;
      const data = await response.json();
      data.preview.options.reverse();
      return Response.json(data, { status: response.status });
    } });
    consoleServer = await createServer({ hostname: "127.0.0.1", port: 0, mode: "real", realOnly: true, platformEnv: "dev",
      tokens: `reviewer@friends:${reviewer},analyst@friends:${analyst},reviewer@ntwrk:${otherApp}`, minTokenLength: 10,
      staffRolesUrl: false, peopleUrl: false, real: { url, service: { url: server.url.href, token: serviceToken } },
      audit: { kind: "file", async write(entry) { audit.push(entry); }, async list() { return audit; }, async close() {} },
    });
    const request = (path: string, token: string | null, body?: object) => fetch(new URL(path, consoleServer!.url), {
      method: body ? "POST" : "GET", headers: { "x-observatory-mode": "real", ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const preview = (revision: number, token: string | null = reviewer, appId = "friends") => request(`/api/review/${encodeURIComponent(id)}/plan?app=${appId}&revision=${revision}`, token);
    expect((await preview(0, null)).status).toBe(401);
    expect((await preview(0, analyst)).status).toBe(403);
    expect((await preview(0, otherApp)).status).toBe(403);
    expect(reads).toEqual([]);
    const { id: actor } = await (await request("/api/me", reviewer)).json();
    const { opportunities } = await (await request("/api/state?app=friends", reviewer)).json() as { opportunities: ObsOpportunity[] };
    expect(opportunities.find(o => o.id === id)).toMatchObject({ origin: "planner", state: "IN_REVIEW" });
    const exact = await preview(0);
    expect(exact.status).toBe(200);
    expect(await exact.json()).toEqual({ ok: true, preview: {
      app: "friends", opportunityId: id, revision: 0, deadline: item!.deadline, activity: expect.any(String), place: plan.place,
      start: plan.window.start, end: plan.window.end, probeDeadline: plan.probeDeadline, quorum: 3, maxSeats: 4, alternates,
    } });
    expect(reads).toEqual([{ actor, logged: 1 }]);
    expect(await sql`select actor, app_id, target_id, detail from network.staff_audit where action='read_review_plan'`).toEqual([
      { actor, app_id: "friends", target_id: id, detail: { revision: 0 } },
    ]);
    const partnerPreview = () => request(`/api/review/${encodeURIComponent(partnerId)}/plan?app=friends&revision=0`, reviewer);
    const multiple = await partnerPreview();
    expect(multiple.status).toBe(200);
    expect(await multiple.json()).toMatchObject({ preview: { opportunityId: partnerId, place: plan.place, options: offered,
      start: offered[1]!.start, end: offered[1]!.end, probeDeadline: plan.probeDeadline, quorum: 2, alternates: [] } });
    reverseOptions = true;
    expect((await partnerPreview()).status).toBe(503);
    reverseOptions = false;
    expect((await preview(0, otherApp, "ntwrk")).status).toBe(404);
    expect((await preview(1)).status).toBe(404);

    clock.set(now + HOUR);
    const decide = (decision: string, revision: number, fields?: object) => request("/api/control?app=friends", reviewer, { type: "review", oppId: id, decision, revision, ...fields });
    expect((await decide("reroll", 0, { swapOut: invited[2] })).status).toBe(200);
    expect((await preview(0)).status).toBe(404);
    const later = await preview(1);
    expect(later.status).toBe(200);
    expect(await later.json()).toMatchObject({ preview: { revision: 1, deadline: item!.deadline + HOUR, alternates: alternates.slice(1) } });
    expect(await (await decide("approve", 0)).json()).toMatchObject({ ok: false, code: "review_stale" });
    clock.set(item!.deadline + HOUR);
    expect((await preview(1)).status).toBe(404);
    expect(await sql`select id from network.messages where app_id='friends' and opportunity_id=${id}`).toEqual([]);
    expect(await sql`select id from platform.outbound`).toEqual([]);
  } finally {
    await consoleServer?.stop();
    await server?.stop(true);
    await network.close();
    await sql.close();
    await dropTestDb();
  }
}, 60_000);
