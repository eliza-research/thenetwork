import { expect, test } from "vitest";
import { HOUR, SimClock } from "@thenetwork/core";
import { serveHttp } from "../../core/src/runtime/http.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { NetworkService } from "../../network/service/service.ts";
import { createServer } from "../src/server.ts";
import type { AuditEntry } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("the real Network workspace authors and reviews the exact public gathering", async () => {
  // spec/monthlyGathering.md, "The real staff console authors and reviews the exact gathering"
  const url = await testDb();
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
  const serviceToken = "fixture-console-service-token";
  const admin = "fixture-ntwrk-admin", reviewer = "fixture-ntwrk-reviewer", friends = "fixture-friends-admin";
  const network = new NetworkService({ url, clock, photoStorage: null, notify: false, log: () => {},
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" }, networks: [{ id: "ntwrk:nyc", matchingEnabled: false }],
    tokens: `admin@ntwrk:${serviceToken}`, consoleToken: serviceToken,
  });
  const delegated: Array<{ path: string; actor: string | null }> = [];
  const audit: AuditEntry[] = [];
  let http: Awaited<ReturnType<typeof serveHttp>> | undefined;
  let workspaceServer: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await network.start();
    http = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: req => {
      delegated.push({ path: new URL(req.url).pathname, actor: req.headers.get("x-network-staff-id") });
      return network.fetch(req);
    } });
    const observatory = workspaceServer = await createServer({ hostname: "127.0.0.1", port: 0, mode: "real", realOnly: true, platformEnv: "dev",
      tokens: `admin@ntwrk:${admin},reviewer@ntwrk:${reviewer},admin@friends:${friends}`, minTokenLength: 10,
      staffRolesUrl: false, peopleUrl: false,
      real: { url, service: { url: http.url.href, token: serviceToken } },
      audit: { kind: "file", async write(entry) { audit.push(entry); }, async list() { return audit; }, async close() {} },
    });
    const api = (path: string, token: string | null = admin, body?: object) => fetch(new URL(path, observatory.url), {
      method: body ? "POST" : "GET",
      headers: { "x-observatory-mode": "real", ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const list = "/api/gatherings?app=ntwrk";
    expect((await api(list, null)).status).toBe(401);
    expect((await api(list, reviewer)).status).toBe(403);
    expect((await api("/api/gatherings?app=friends", friends)).status).toBe(403);
    const { id: staff } = await (await api("/api/me")).json();
    expect(await (await api(list)).json()).toEqual({ ok: true, gatherings: [] });

    const startsAt = Date.UTC(2026, 9, 10, 16);
    const draft = { month: "2026-10", venue: { kind: "curated", id: "prospect-long-meadow" }, startsAt, endsAt: startsAt + 2 * HOUR, capacity: 24 };
    expect((await api(list, reviewer, draft)).status).toBe(403);
    const created = await api(list, admin, draft);
    expect(created.status).toBe(201);
    const { gathering } = await created.json();
    expect(gathering).toMatchObject({ ...draft, status: "draft", revision: 0 });
    expect(gathering).not.toHaveProperty("createdBy");
    const review = `/api/gatherings/${gathering.id}/review?app=ntwrk`;
    expect((await api(review, admin, { revision: 1, decision: "approve" })).status).toBe(409);
    const reviewed = await api(review, admin, { revision: 0, decision: "approve" });
    expect(reviewed.status).toBe(200);
    const approved = { ...gathering, status: "approved", revision: 1 };
    expect(await reviewed.json()).toEqual({ ok: true, gathering: approved });
    expect(await (await api(list)).json()).toEqual({ ok: true, gatherings: [approved] });
    expect((await api(review, admin, { revision: 0, decision: "reject" })).status).toBe(409);
    expect(delegated.filter(row => row.path.includes("/gatherings")).every(row => row.actor === staff)).toBe(true);
    expect(await sql`select created_by,reviewed_by from network.monthly_gatherings`).toEqual([{ created_by: staff, reviewed_by: staff }]);
    expect(audit.filter(row => row.action === "review_monthly_gathering" && row.detail?.phase === "result").map(row => row.ok)).toEqual([false, true, false]);
    expect(await sql`select count(*)::int as count from network.monthly_gathering_invitees`).toEqual([{ count: 0 }]);
    expect(await sql`select count(*)::int as count from platform.outbound`).toEqual([{ count: 0 }]);
  } finally {
    await workspaceServer?.stop();
    await http?.stop(true);
    await network.close();
    await sql.close();
    await dropTestDb();
  }
}, 60_000);
