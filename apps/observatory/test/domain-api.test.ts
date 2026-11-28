import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { serveHttp, type HttpServer } from "../../../packages/core/src/runtime/http.ts";
import { SQL } from "../../../packages/core/src/runtime/postgres.ts";
import { inferDomain } from "../src/apps.ts";
import { createServer, type ObservatoryServer } from "../src/server.ts";
import type { ObsCitySummary, ObsState, SafetyInfo, SearchHit, UnifiedProfile360 } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const T = 300_000;
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");

describe("inferDomain helper", () => {
  test("maps brand apps, categories, generators, and workIntroChannel deterministically", () => {
    expect(inferDomain({ app: "slop" })).toBe("dating");
    expect(inferDomain({ category: "romance" })).toBe("dating");
    expect(inferDomain({ generator: "slop_pack_v1" })).toBe("dating");
    expect(inferDomain({ generator: "dating_pair" })).toBe("dating");
    expect(inferDomain({ app: "peon" })).toBe("business");
    expect(inferDomain({ category: "professional" })).toBe("business");
    expect(inferDomain({ workIntroChannel: "WarmEmail" })).toBe("business");
    expect(inferDomain({ generator: "peon_role_match" })).toBe("business");
    expect(inferDomain({ generator: "work_intro" })).toBe("business");
    expect(inferDomain({ generator: "business_circle" })).toBe("business");
    expect(inferDomain({ app: "friends", category: "social" })).toBe("friendship");
    expect(inferDomain({ app: "ntwrk", category: "hobby" })).toBe("friendship");
    expect(inferDomain({})).toBe("friendship");
  });
});

describe("Observatory ?domains= RBAC and filtering (game mode)", () => {
  let dir: string;
  let obs: ObservatoryServer;
  const TOK = {
    admin: long("dom-admin"),
    slopRev: long("dom-rev-slop"),
    peonSaf: long("dom-saf-peon"),
    ntwrkAna: long("dom-ana-ntwrk"),
  };
  const as = (tok: string, path: string, init: RequestInit = {}) =>
    fetch(obs.url + path, { ...init, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) } });

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "obs-domains-game-"));
    obs = await createServer({
      port: 0, development: false,
      tokens: `admin:${TOK.admin},reviewer@slop:${TOK.slopRev},safety@peon:${TOK.peonSaf},analyst@ntwrk:${TOK.ntwrkAna}`,
      audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
      game: { seed: 1, personas: 24, days: 3, pushMs: 3_600_000, tickMs: 3_600_000 },
    });
    expect((await as(TOK.admin, "/api/control", { method: "POST", body: JSON.stringify({ type: "step", ms: DAY }) })).status).toBe(200);
  }, T);

  afterAll(async () => {
    await obs?.stop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("/api/me reports permitted domains per grant", async () => {
    expect((await (await as(TOK.admin, "/api/me")).json()).domains).toEqual(["dating", "friendship", "business"]);
    expect((await (await as(TOK.slopRev, "/api/me")).json()).domains).toEqual(["dating"]);
    expect((await (await as(TOK.peonSaf, "/api/me")).json()).domains).toEqual(["business"]);
    expect((await (await as(TOK.ntwrkAna, "/api/me")).json()).domains).toEqual(["friendship"]);
  }, T);

  test("?domains= enforces RBAC 403 for unauthorized domains and 400 for unknown domains", async () => {
    expect((await as(TOK.admin, "/api/state?domains=dating,friendship,business")).status).toBe(200);
    expect((await as(TOK.slopRev, "/api/state?domains=dating")).status).toBe(200);
    expect((await as(TOK.peonSaf, "/api/state?domains=business")).status).toBe(200);
    expect((await as(TOK.ntwrkAna, "/api/state?domains=friendship")).status).toBe(200);

    for (const [tok, path] of [
      [TOK.slopRev, "/api/state?domains=business"],
      [TOK.slopRev, "/api/state?domains=dating,friendship"],
      [TOK.peonSaf, "/api/state?domains=dating"],
      [TOK.ntwrkAna, "/api/state?domains=dating"],
      [TOK.ntwrkAna, "/api/state?domains=friendship,business"],
      [TOK.peonSaf, "/api/safety?domains=dating"],
      [TOK.peonSaf, "/api/search?q=hello&domains=dating"],
      [TOK.slopRev, "/api/cities?domains=business"],
    ] as const) {
      const r = await as(tok, path);
      expect([path, r.status, (await r.json()).code]).toEqual([path, 403, "forbidden"]);
    }

    const bad = await as(TOK.admin, "/api/state?domains=crypto");
    expect([bad.status, (await bad.json()).code]).toEqual([400, "unknown_domain"]);
    const empty = await as(TOK.admin, "/api/state?domains=");
    expect([empty.status, (await empty.json()).code]).toEqual([400, "unknown_domain"]);
  }, T);

  test("analyst PII scrubbing still holds under ?domains=friendship", async () => {
    const ana = await (await as(TOK.ntwrkAna, "/api/state?domains=friendship")).json() as ObsState;
    expect(ana.members.length).toBeGreaterThan(0);
    expect(ana.members.every(m => m.name.startsWith("Member ") && !("age" in m) && !("minor" in m))).toBe(true);
    expect(ana.env.label).not.toContain("NTWRK ·");
  }, T);
});

describe.skipIf(!pgAvailable)("Observatory unified multi-partition ?domains= & photo gate (Postgres)", () => {
  let url: string;
  let sql: SQL;
  let dir: string;
  let obs: ObservatoryServer;
  let fake: HttpServer;
  const photoCalls: string[] = [];
  const TOK = {
    admin: long("pg-dom-admin"),
    slopSaf: long("pg-dom-saf-slop"),
    ntwrkSaf: long("pg-dom-saf-ntwrk"),
  };
  const as = (tok: string, path: string, init: RequestInit = {}) =>
    fetch(obs.url + path, { ...init, headers: { authorization: `Bearer ${tok}`, "content-type": "application/json", ...(init.headers as Record<string, string> ?? {}) } });
  const post = (tok: string, path: string, body: unknown) => as(tok, path, { method: "POST", body: JSON.stringify(body) });

  beforeAll(async () => {
    url = await testDb();
    sql = new SQL(url);
    await sql.begin(async tx => {
      await tx`set local app.app_id = 'ntwrk'`;
      await tx`insert into network.members (id, name, home_city, account_status, age, joined_at) values
        ('n-friend', 'Nora Friend', 'nyc', 'active', 26, now()),
        ('n-dating', 'Nina Unified', 'nyc', 'active', 28, now()),
        ('n-minor', 'Niko Teen', 'nyc', 'active', 16, now())`;
      await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance) values
        ('ntwrk', 'nf1', 'n-dating', 'preference', 'seeks women', '{romance:seeks:woman}'::text[], 'matchable', 'said'),
        ('ntwrk', 'nf2', 'n-dating', 'fact', 'engineer', '{peon:entity:candidate,peon:family:engineering}'::text[], 'matchable', 'said'),
        ('ntwrk', 'nf3', 'n-minor', 'preference', 'seeks', '{romance:seeks:man}'::text[], 'matchable', 'said')`;
      await tx`insert into network.messages (id, member_id, direction, body, ts) values
        ('nm1', 'n-friend', 'outbound', 'unified friendship hello', now())`;
    });
    await sql.begin(async tx => {
      await tx`set local app.app_id = 'slop'`;
      await tx`insert into network.members (id, name, home_city, account_status, age, joined_at) values
        ('s-date', 'Sasha Date', 'sf', 'active', 30, now())`;
      await tx`insert into network.messages (id, member_id, direction, body, ts) values
        ('sm1', 's-date', 'outbound', 'unified dating hello', now())`;
    });
    await sql.begin(async tx => {
      await tx`set local app.app_id = 'peon'`;
      await tx`insert into network.members (id, name, home_city, account_status, age, joined_at) values
        ('p-biz', 'Pat Biz', 'chicago', 'active', 34, now())`;
      await tx`insert into network.messages (id, member_id, direction, body, ts) values
        ('pm1', 'p-biz', 'outbound', 'unified business hello', now())`;
    });
    fake = await serveHttp({
      port: 0, hostname: "127.0.0.1",
      fetch(req) {
        const u = new URL(req.url);
        if (u.pathname === "/health") return Response.json({ ok: false, error: "fake" });
        if (/^\/members\/[^/]+\/photos$/.test(u.pathname)) {
          photoCalls.push(`${u.searchParams.get("app")}:${u.pathname}`);
          return Response.json({ ok: true, photos: [{ id: "p1", url: "https://photos.example.org/p1.jpg", expiresAt: Date.now() + 60_000 }] });
        }
        return Response.json({ error: "no route" }, { status: 404 });
      },
    });
    dir = await mkdtemp(join(tmpdir(), "obs-domains-pg-"));
    obs = await createServer({
      port: 0, development: false, mode: "real", peopleUrl: false, staffRolesUrl: false,
      audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab") },
      tokens: `admin:${TOK.admin},safety@slop:${TOK.slopSaf},safety@ntwrk:${TOK.ntwrkSaf}`,
      real: { url, pollMs: 3_600_000, pushMs: 3_600_000, service: { url: fake.url.href, token: long("pg-dom-svc") } },
    });
  }, T);

  afterAll(async () => {
    await obs?.stop(); await fake?.stop(true);
    await sql?.close(); await dropTestDb();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  test("unified ?domains= merges permitted partitions and filters state, cities, safety, and search", async () => {
    const all = await (await as(TOK.admin, "/api/state?domains=dating,friendship,business")).json() as ObsState;
    expect(all.members.map(m => m.id).sort()).toEqual(["n-dating", "n-friend", "n-minor", "p-biz", "s-date"]);

    const dating = await (await as(TOK.admin, "/api/state?domains=dating")).json() as ObsState;
    expect(dating.members.map(m => m.id)).toContain("s-date");
    expect(dating.members.map(m => m.id)).not.toContain("p-biz");
    expect(dating.members.map(m => m.id)).not.toContain("n-friend");

    const business = await (await as(TOK.admin, "/api/state?domains=business")).json() as ObsState;
    expect(business.members.map(m => m.id)).toEqual(["p-biz"]);

    // Legacy ?app=ntwrk without ?domains= stays strictly single-app isolated.
    const legacy = await (await as(TOK.admin, "/api/state?app=ntwrk")).json() as ObsState;
    expect(legacy.members.map(m => m.id).sort()).toEqual(["n-dating", "n-friend", "n-minor"]);

    // /api/cities?domains= reflects domain-filtered member counts.
    const bizCities = (await (await as(TOK.admin, "/api/cities?domains=business")).json() as { cities: ObsCitySummary[] }).cities;
    expect(bizCities.find(c => c.id === "chicago")?.memberCount).toBe(1);
    expect(bizCities.find(c => c.id === "sf")?.memberCount).toBe(0);

    // /api/search?q=...&domains= filters search results to requested domains.
    const dateHits = await (await as(TOK.admin, "/api/search?q=unified&domains=dating")).json() as SearchHit[];
    expect(dateHits.map(h => h.memberId)).toEqual(["s-date"]);
    const bizHits = await (await as(TOK.admin, "/api/search?q=unified&domains=business")).json() as SearchHit[];
    expect(bizHits.map(h => h.memberId)).toEqual(["p-biz"]);

    // /api/safety?domains= enforces RBAC and filters by domain.
    expect((await as(TOK.slopSaf, "/api/safety?domains=business")).status).toBe(403);
    const sf = await (await as(TOK.slopSaf, "/api/safety?domains=dating")).json() as SafetyInfo;
    expect(sf.minors.members).not.toContain("n-minor");
  }, T);

  test("unified Member 360 and photo gate work on ntwrk for dating-enabled verified adults only", async () => {
    const prof = await (await as(TOK.ntwrkSaf, "/api/member/n-dating/app?app=ntwrk")).json() as UnifiedProfile360;
    expect(prof.app).toBe("ntwrk");
    expect(prof.dating?.photos).toBe("reason_required");
    expect(prof.business?.entity).toBe("candidate");

    // Non-dating member on ntwrk -> 404 no_photos.
    const nonDating = await post(TOK.ntwrkSaf, "/api/member/n-friend/photos?app=ntwrk", { reason: "safety check 1" });
    expect([nonDating.status, (await nonDating.json()).code]).toEqual([404, "no_photos"]);

    // Minor on ntwrk with dating facet -> 403 never_minor.
    const minor = await post(TOK.ntwrkSaf, "/api/member/n-minor/photos?app=ntwrk", { reason: "safety check 2" });
    expect([minor.status, (await minor.json()).code]).toEqual([403, "never_minor"]);

    // Verified dating-enabled adult on ntwrk -> 200 after audit.
    const ok = await post(TOK.ntwrkSaf, "/api/member/n-dating/photos?app=ntwrk", { reason: "safety check 3" });
    expect(ok.status).toBe(200);
    expect(photoCalls).toContain("ntwrk:/members/n-dating/photos");

    // peon / friends still rejected with 404.
    const peonRes = await post(TOK.admin, "/api/member/p-biz/photos?app=peon", { reason: "safety check 4" });
    expect([peonRes.status, (await peonRes.json()).code]).toEqual([404, "no_photos"]);
  }, T);
});
