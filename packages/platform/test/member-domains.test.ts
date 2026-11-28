import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  APPS, availableDomainsForAge, defaultDomainsForBrand, lookingForDomains, parseDomainCommand,
  type AppId,
} from "../src/apps.ts";
import { updateMemberDomains } from "../src/accounts.ts";
import { createPublicApi, type PublicApi } from "../src/api.ts";
import type { OtpProvider } from "../src/otp.ts";
import { PgPeopleStore } from "../src/pg-store.ts";
import { MemoryPhotoStore, PhotoService, type PhotoStorage } from "../src/photos.ts";
import { MemoryPeopleStore, type PeopleStore } from "../src/store.ts";
import { addMember, call as mcpCall, connect as mcpConnect, origin as mcpOrigin, PHONE_A, rpc as mcpRpc, setup as mcpSetup } from "../../mcp/test/harness.ts";
import { dropDb, migratedDb, pgAvailable } from "./pg.ts";

const HOSTS: Record<AppId, string> = {
  ntwrk: "localhost:5101",
  slop: "localhost:5102",
  peon: "localhost:5103",
  friends: "localhost:5104",
};

const consentOf = (app: AppId) => ({ sms: true, wording: APPS[app].consent.text });

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  sent = 0;
  async send(e164: string) {
    this.sent++;
    const code = String(100000 + Math.floor(this.sent * 7919) % 900000);
    this.codes.set(e164, code);
    return { code };
  }
}

let phoneSeq = 500;
let ipSeq = 50;
const newPhone = () => {
  phoneSeq++;
  return `+1${String(212 + Math.floor(phoneSeq / 100))}55501${String(phoneSeq % 100).padStart(2, "0")}`;
};

interface Ctx {
  ip: string;
  api: PublicApi;
  store: PeopleStore;
  otp: FakeOtp;
  clock: { t: number };
}

function makeCtx(store: PeopleStore): Ctx {
  const clock = { t: Date.UTC(2026, 10, 28, 12) };
  const otp = new FakeOtp();
  const api = createPublicApi({
    store,
    otp,
    now: () => clock.t,
    env: { PLATFORM_ENV: "dev" },
    ipOf: req => req.headers.get("x-real-ip") ?? "unknown",
    minStartMs: 0,
    minVerifyMs: 0,
    log: () => {},
  });
  return { ip: `198.51.100.${++ipSeq}`, api, store, otp, clock };
}

async function callApi(c: Ctx, app: AppId, method: string, path: string, body?: unknown, cookie?: string) {
  const res = (await c.api.fetch(new Request(`http://${HOSTS[app]}${path}`, {
    method,
    headers: {
      host: HOSTS[app],
      "x-real-ip": c.ip,
      ...(body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })))!;
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: res.headers.get("set-cookie") ?? "" };
}

async function login(c: Ctx, app: AppId, phone: string): Promise<string> {
  expect((await callApi(c, app, "POST", "/api/auth/otp/start", { phone })).status).toBe(200);
  const v = await callApi(c, app, "POST", "/api/auth/otp/verify", { phone, code: c.otp.codes.get(phone) });
  expect(v.status).toBe(200);
  c.clock.t += 31_000;
  return v.setCookie.split(";")[0]!;
}

describe("domain brand defaults, age rules, and natural command parsing", () => {
  test("defaultDomainsForBrand maps each lander brand and enforces age gating", () => {
    expect(defaultDomainsForBrand("slop", 25)).toEqual(["dating"]);
    expect(defaultDomainsForBrand("peon", 25)).toEqual(["business"]);
    expect(defaultDomainsForBrand("friends", 25)).toEqual(["friendship"]);
    expect(defaultDomainsForBrand("ntwrk", 25)).toEqual(["dating", "friendship", "business"]);

    expect(defaultDomainsForBrand("slop", 16)).toEqual([]);
    expect(defaultDomainsForBrand("peon", 16)).toEqual([]);
    expect(defaultDomainsForBrand("friends", 16)).toEqual(["friendship"]);
    expect(defaultDomainsForBrand("ntwrk", 16)).toEqual(["friendship"]);

    expect(defaultDomainsForBrand("slop", 12)).toEqual([]);
    expect(defaultDomainsForBrand("peon", 12)).toEqual([]);
    expect(defaultDomainsForBrand("friends", 12)).toEqual([]);
    expect(defaultDomainsForBrand("ntwrk", 12)).toEqual([]);

    expect(defaultDomainsForBrand("slop")).toEqual(["dating"]);
    expect(defaultDomainsForBrand("ntwrk")).toEqual(["dating", "friendship", "business"]);
  });

  test("availableDomainsForAge enforces adult, teen, under-13, and unknown age rules", () => {
    expect(availableDomainsForAge(28)).toEqual(["dating", "friendship", "business"]);
    expect(availableDomainsForAge(18)).toEqual(["dating", "friendship", "business"]);
    expect(availableDomainsForAge(17)).toEqual(["friendship"]);
    expect(availableDomainsForAge(13)).toEqual(["friendship"]);
    expect(availableDomainsForAge(12)).toEqual([]);
    expect(availableDomainsForAge(null)).toEqual([]);
    expect(availableDomainsForAge(undefined)).toEqual([]);
  });

  test("parseDomainCommand recognizes enable, disable, list, and aliases while ignoring prose", () => {
    expect(parseDomainCommand("enable dating")).toEqual({ action: "enable", domains: ["dating"] });
    expect(parseDomainCommand("turn on business")).toEqual({ action: "enable", domains: ["business"] });
    expect(parseDomainCommand("also match me for dating and business")).toEqual({ action: "enable", domains: ["dating", "business"] });
    expect(parseDomainCommand("add friendship")).toEqual({ action: "enable", domains: ["friendship"] });
    expect(parseDomainCommand("opt in to hiring and romance")).toEqual({ action: "enable", domains: ["business", "dating"] });
    expect(parseDomainCommand("disable dating")).toEqual({ action: "disable", domains: ["dating"] });
    expect(parseDomainCommand("turn off business")).toEqual({ action: "disable", domains: ["business"] });
    expect(parseDomainCommand("stop slop")).toEqual({ action: "disable", domains: ["dating"] });
    expect(parseDomainCommand("my domains")).toEqual({ action: "list", domains: [] });
    expect(parseDomainCommand("what domains am i in?")).toEqual({ action: "list", domains: [] });
    expect(parseDomainCommand("I work at a bank")).toBeNull();
    expect(parseDomainCommand("hello there")).toBeNull();
  });

  test("lookingForDomains maps natural preferences to DomainIds", () => {
    expect(lookingForDomains("friends and dating")).toEqual(["friendship", "dating"]);
    expect(lookingForDomains("looking for business and hiring")).toEqual(["business"]);
    expect(lookingForDomains("everything")).toEqual(["friendship", "dating", "business"]);
    expect(lookingForDomains("I work at a bank")).toEqual([]);
  });
});

const pgUrls: string[] = [];
afterAll(async () => {
  for (const url of pgUrls) await dropDb(url);
});

const stores: Array<{ name: string; make: () => Promise<PeopleStore>; skip: boolean }> = [
  { name: "memory", make: async () => new MemoryPeopleStore(), skip: false },
  {
    name: "postgres",
    make: async () => {
      const url = await migratedDb("member_domains");
      pgUrls.push(url);
      return new PgPeopleStore(url);
    },
    skip: !pgAvailable,
  },
];

for (const s of stores) {
  describe.skipIf(s.skip)(`member domains lifecycle (${s.name} store)`, () => {
    let store: PeopleStore;
    beforeAll(async () => { store = await s.make(); }, 120_000);
    afterAll(async () => { await (store as PgPeopleStore).close?.(); });

    test("join initializes brand default domains and GET /api/me surfaces enabledDomains & availableDomains", async () => {
      const c = makeCtx(store);
      const phone = newPhone();
      const cookie = await login(c, "friends", phone);
      const j = await callApi(c, "friends", "POST", "/api/join", {
        firstName: "Maya", age: 27, consent: consentOf("friends"),
      }, cookie);
      expect(j.status).toBe(200);

      const me = await callApi(c, "friends", "GET", "/api/me", undefined, cookie);
      expect(me.status).toBe(200);
      expect(me.body.enabledDomains).toEqual(["friendship"]);
      expect(me.body.availableDomains).toEqual(["dating", "friendship", "business"]);

      const ntwrkPhone = newPhone();
      await c.api.accounts.invite(APPS.ntwrk, ntwrkPhone);
      const ntwrkCookie = await login(c, "ntwrk", ntwrkPhone);
      expect((await callApi(c, "ntwrk", "POST", "/api/join", {
        firstName: "Alex", age: 30, consent: consentOf("ntwrk"),
      }, ntwrkCookie)).status).toBe(200);
      const ntwrkMe = await callApi(c, "ntwrk", "GET", "/api/me", undefined, ntwrkCookie);
      expect(ntwrkMe.body.enabledDomains).toEqual(["dating", "friendship", "business"]);
    });

    test("mid-lifecycle domain expansion and disabling via POST /api/me/domains provisions/pauses backing memberships", async () => {
      const c = makeCtx(store);
      const phone = newPhone();
      const cookie = await login(c, "friends", phone);
      expect((await callApi(c, "friends", "POST", "/api/join", {
        firstName: "Sam", age: 29, consent: consentOf("friends"),
      }, cookie)).status).toBe(200);
      const person = (await c.api.accounts.personFor(phone))!;

      const bad = await callApi(c, "friends", "POST", "/api/me/domains", { enable: ["invalid_domain"] }, cookie);
      expect(bad.status).toBe(400);

      const expand = await callApi(c, "friends", "POST", "/api/me/domains", { enable: ["dating", "business"] }, cookie);
      expect(expand.status).toBe(200);
      expect(expand.body).toEqual({
        ok: true,
        enabledDomains: ["dating", "friendship", "business"],
        availableDomains: ["dating", "friendship", "business"],
        blocked: [],
      });
      expect((await store.getMembership(person.id, "slop"))?.state).toBe("active");
      expect((await store.getMembership(person.id, "peon"))?.state).toBe("active");

      const disable = await callApi(c, "friends", "POST", "/api/me/domains", { disable: ["dating"] }, cookie);
      expect(disable.status).toBe(200);
      expect(disable.body).toEqual({
        ok: true,
        enabledDomains: ["friendship", "business"],
        availableDomains: ["dating", "friendship", "business"],
        blocked: [],
      });
      expect((await store.getMembership(person.id, "slop"))?.state).toBe("paused");
      expect((await store.getMembership(person.id, "peon"))?.state).toBe("active");
    });

    test("minors are hard-refused on dating/business expansion and ageLowered immediately revokes dating & business", async () => {
      const c = makeCtx(store);
      const teenPhone = newPhone();
      const teenCookie = await login(c, "friends", teenPhone);
      expect((await callApi(c, "friends", "POST", "/api/join", {
        firstName: "Riley", age: 16, consent: consentOf("friends"),
      }, teenCookie)).status).toBe(200);
      const teen = (await c.api.accounts.personFor(teenPhone))!;

      const teenMe = await callApi(c, "friends", "GET", "/api/me", undefined, teenCookie);
      expect(teenMe.body.enabledDomains).toEqual(["friendship"]);
      expect(teenMe.body.availableDomains).toEqual(["friendship"]);

      const refused = await callApi(c, "friends", "POST", "/api/me/domains", { enable: ["dating", "business"] }, teenCookie);
      expect(refused.status).toBe(403);
      expect(refused.body).toEqual({
        ok: false,
        error: "domain_not_allowed",
        blocked: [
          { domain: "dating", reason: "minor_restricted" },
          { domain: "business", reason: "minor_restricted" },
        ],
        enabledDomains: ["friendship"],
        availableDomains: ["friendship"],
      });
      expect(await store.getMembership(teen.id, "slop")).toBeUndefined();
      expect(await store.getMembership(teen.id, "peon")).toBeUndefined();

      const adultToTeenPhone = newPhone();
      const adultCookie = await login(c, "slop", adultToTeenPhone);
      expect((await callApi(c, "slop", "POST", "/api/join", {
        firstName: "Jordan", age: 24, consent: consentOf("slop"),
      }, adultCookie)).status).toBe(200);
      const person = (await c.api.accounts.personFor(adultToTeenPhone))!;
      const expanded = await updateMemberDomains({
        store,
        personId: person.id,
        enable: ["friendship", "business"],
        originBrand: "slop",
        now: c.clock.t,
      });
      expect(expanded.enabledDomains).toEqual(["dating", "friendship", "business"]);

      await c.api.accounts.recordAge(adultToTeenPhone, person, 16);
      const afterRows = await store.listMemberDomains(person.id);
      const enabledAfter = afterRows.filter(r => r.enabled).map(r => r.domain);
      expect(enabledAfter).toEqual(["friendship"]);
      const datingRow = afterRows.find(r => r.domain === "dating");
      const businessRow = afterRows.find(r => r.domain === "business");
      expect(datingRow?.enabled).toBe(false);
      expect(datingRow?.source).toBe("age_lowered");
      expect(businessRow?.enabled).toBe(false);
      expect(businessRow?.source).toBe("age_lowered");
    });

    test("photos gate allows slop and adult ntwrk with dating enabled, while refusing friends, peon, and minors", async () => {
      const c = makeCtx(store);
      const memBytes = new Map<string, Uint8Array>();
      const storage: PhotoStorage = {
        kind: "local",
        async put(k, b) { memBytes.set(k, b); },
        async get(k) { return memBytes.get(k); },
        async delete(k) { memBytes.delete(k); },
      };
      const photos = new PhotoService({
        people: store,
        meta: new MemoryPhotoStore(),
        storage,
        signingKey: "test-key",
        now: () => c.clock.t,
        eligible: async () => true,
      });

      const phone = newPhone();
      await c.api.accounts.invite(APPS.ntwrk, phone);
      const cookie = await login(c, "ntwrk", phone);
      expect((await callApi(c, "ntwrk", "POST", "/api/join", {
        firstName: "Casey", age: 26, consent: consentOf("ntwrk"),
      }, cookie)).status).toBe(200);
      const person = (await c.api.accounts.personFor(phone))!;

      expect(await photos.mayTake(person.id, "slop")).toBeUndefined();
      expect(await photos.mayTake(person.id, "ntwrk")).toBeUndefined();
      expect(await photos.mayTake(person.id, "friends")).toBe("app_not_allowed");
      expect(await photos.mayTake(person.id, "peon")).toBe("app_not_allowed");

      await updateMemberDomains({ store, personId: person.id, disable: ["dating"], now: c.clock.t });
      expect(await photos.mayTake(person.id, "ntwrk")).toBe("app_not_allowed");
    });
  });
}

describe("MCP domain surfacing, manage_domains tool, and OpenAI surface gating", () => {
  test("check_status and get_context surface enabled_domains/available_domains and hide dating on non-dating OpenAI surfaces", async () => {
    const env = mcpSetup();
    const personId = await addMember(env, PHONE_A, [{ app: "ntwrk", state: "active" }], 28);
    await env.people.setMemberDomain({ personId, domain: "dating", enabled: true, originBrand: "ntwrk", source: "onboarding", at: env.clock.t });
    await env.people.setMemberDomain({ personId, domain: "friendship", enabled: true, originBrand: "ntwrk", source: "onboarding", at: env.clock.t });
    await env.people.setMemberDomain({ personId, domain: "business", enabled: true, originBrand: "ntwrk", source: "onboarding", at: env.clock.t });
    await env.accounts.recordConsent({ e164: PHONE_A, app: "ntwrk", state: "opted_in", source: "keyword:start", at: env.clock.t });

    const fullConn = await mcpConnect(env, "ntwrk.party", PHONE_A, { scope: "membership:read profile:write" });
    const fullStatus = await mcpCall(env, `${mcpOrigin("ntwrk.party")}/mcp`, "check_status", {}, { token: fullConn.token.access_token });
    expect(fullStatus.body!.result.structuredContent).toMatchObject({
      enabled_domains: ["dating", "friendship", "business"],
      available_domains: ["dating", "friendship", "business"],
    });

    const openAiUrl = `${mcpOrigin("ntwrk.party")}/mcp/openai`;
    const openAiList = await mcpRpc(env, openAiUrl, "tools/list");
    const manageTool = openAiList.body!.result.tools.find((t: any) => t.name === "manage_domains");
    expect(manageTool.inputSchema.properties.enable.items.enum).toEqual(["friendship", "business"]);
    expect(JSON.stringify(manageTool)).not.toMatch(/dating|slop/i);

    const openAiConn = await mcpConnect(env, "ntwrk.party", PHONE_A, { resource: openAiUrl, scope: "membership:read profile:write" });
    const openAiStatus = await mcpCall(env, openAiUrl, "check_status", {}, { token: openAiConn.token.access_token });
    expect(openAiStatus.body!.result.structuredContent).toMatchObject({
      enabled_domains: ["friendship", "business"],
      available_domains: ["friendship", "business"],
    });
    const openAiDatingAttempt = await mcpCall(env, openAiUrl, "manage_domains", { enable: ["dating"] }, { token: openAiConn.token.access_token });
    expect(openAiDatingAttempt.body!.result.isError).toBe(true);
  });

  test("manage_domains requires profile:write and enforces minor restrictions", async () => {
    const env = mcpSetup();
    const teenPhone = "+12125550199";
    await addMember(env, teenPhone, [{ app: "friends", state: "active" }], 16);
    await env.accounts.recordConsent({ e164: teenPhone, app: "friends", state: "opted_in", source: "keyword:start", at: env.clock.t });

    const readOnly = await mcpConnect(env, "friends.help", teenPhone, { scope: "membership:read" });
    const noScope = await mcpCall(env, `${mcpOrigin("friends.help")}/mcp`, "manage_domains", { enable: ["business"] }, { token: readOnly.token.access_token });
    expect(noScope.res.status).toBe(403);

    const writeConn = await mcpConnect(env, "friends.help", teenPhone, { scope: "membership:read profile:write" });
    const blocked = await mcpCall(env, `${mcpOrigin("friends.help")}/mcp`, "manage_domains", { enable: ["dating", "business"] }, { token: writeConn.token.access_token });
    expect(blocked.res.status).toBe(200);
    expect(blocked.body!.result.structuredContent).toMatchObject({
      updated: false,
      enabled_domains: ["friendship"],
      available_domains: ["friendship"],
      blocked: [
        { domain: "dating", reason: "minor_restricted" },
        { domain: "business", reason: "minor_restricted" },
      ],
    });
  });
});
