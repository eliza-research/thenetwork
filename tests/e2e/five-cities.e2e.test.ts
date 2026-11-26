import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { LAUNCH_CITIES, type City } from "../../packages/core/src/index.ts";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { APP_IDS, type AppId } from "../../packages/platform/src/apps.ts";
import { pkceS256 } from "../../packages/mcp/src/util.ts";
import { Browser, newPhone, pgAvailable, rpc, startStack, toolData, VERIFIER, webJoin, type Stack } from "./harness.ts";

const T = 180_000;
const CLAUDE = "https://claude.ai/api/mcp/auth_callback";

const hidden = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1];

const CITY_NEIGHBORHOOD: Record<City, string> = {
  sf: "Hayes Valley",
  nyc: "East Village",
  la: "Silver Lake",
  chicago: "West Loop",
  miami: "Wynwood",
};

describe.skipIf(!pgAvailable)("five cities end to end (HTTP join routing and MCP prepare_signup)", () => {
  let st: Stack;
  let sql: SQL;

  beforeAll(async () => {
    st = await startStack({ allFiveCities: true });
    sql = new SQL({ url: st.url, max: 2 });
  }, T);

  afterAll(async () => {
    await sql?.close();
    await st?.close();
  }, T);

  test("all 20 <app>:<city> networks are seeded and mounted in NetworkService", async () => {
    const dbNets = (await sql`select id from platform.networks order by id`).map((r: any) => String(r.id));
    expect(dbNets).toHaveLength(APP_IDS.length * LAUNCH_CITIES.length);
    for (const app of APP_IDS) {
      for (const city of LAUNCH_CITIES) {
        const id = `${app}:${city}`;
        expect(dbNets).toContain(id);
        expect(st.svc.runtimes.has(id)).toBe(true);
      }
    }
  }, T);

  test("HTTP join routes members into the matching city runtime for all 5 launch cities", async () => {
    for (const city of LAUNCH_CITIES) {
      const phone = newPhone();
      const j = await webJoin(st, "friends", phone, {
        age: 28,
        firstName: `Ari${city}`,
        homeCity: city,
        neighborhood: CITY_NEIGHBORHOOD[city],
      });
      expect(j.res.status, JSON.stringify(j.body)).toBe(200);
      expect(j.body.membership.state).toBe("active");

      const [member] = await sql`
        select m.id, m.home_city, m.home_area, ms.profile
        from network.members m
        join platform.phone_identities ph on ph.person_id = m.person_id
        join platform.memberships ms on ms.member_id = m.id and ms.app_id = m.app_id
        where m.app_id = 'friends' and ph.e164 = ${phone}
      `;
      expect(member?.home_city).toBe(city);
      const profile = typeof member.profile === "string" ? JSON.parse(member.profile) : member.profile;
      expect(profile.homeCity).toBe(city);

      const rt = await st.svc.runtimeOfMember("friends", String(member.id));
      expect(rt?.id).toBe(`friends:${city}`);
      expect(rt?.city).toBe(city);
    }
  }, T);

  async function authorizeAndConfirm(app: AppId, phone: string, b: Browser) {
    const reg = await st.site(app, "/oauth/register", {
      json: { client_name: "Five-City Assistant", redirect_uris: [CLAUDE], token_endpoint_auth_method: "none" },
    });
    expect(reg.status).toBe(201);
    const client = (await reg.json()) as { client_id: string };
    const resource = `${st.sites[app].origin}/mcp`;
    const q = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: CLAUDE,
      code_challenge: pkceS256(VERIFIER),
      code_challenge_method: "S256",
      state: "e2e-5c",
      resource,
    });
    const page = await st.site(app, `/oauth/authorize?${q}`, { browser: b });
    const rid = hidden(await page.text(), "rid")!;
    expect(rid).toBeTruthy();
    st.clock.advance(31_000);
    expect((await st.site(app, "/oauth/authorize/phone", { browser: b, form: { rid, phone } })).status).toBe(200);
    const verified = await st.site(app, "/oauth/authorize/code", { browser: b, form: { rid, code: st.otp.last(phone) ?? "000000" } });
    expect(verified.status).toBe(200);
    return { client: client.client_id, resource, rid, html: await verified.text() };
  }

  for (const city of ["chicago", "miami"] as const) {
    test(`MCP prepare_signup accepts ${city} and prefills the browser signup form`, async () => {
      const phone = newPhone();
      const b = new Browser();
      const c1 = await authorizeAndConfirm("friends", phone, b);
      const done = await st.site("friends", "/oauth/authorize/consent", { browser: b, form: { rid: c1.rid, decision: "approve" } });
      expect(done.status).toBe(303);
      const code = new URL(done.headers.get("location")!).searchParams.get("code")!;
      const tok = await st.site("friends", "/oauth/token", {
        form: { grant_type: "authorization_code", code, redirect_uri: CLAUDE, client_id: c1.client, code_verifier: VERIFIER, resource: c1.resource },
      });
      expect(tok.status).toBe(200);
      const token = ((await tok.json()) as { access_token: string }).access_token;

      const prepared = toolData(await rpc(st, "friends", "/mcp", "tools/call", {
        name: "prepare_signup",
        arguments: { firstName: "Maya", homeCity: city },
      }, token));
      expect(prepared).toMatchObject({ prepared: true, app: "friends" });

      const q2 = new URLSearchParams({
        response_type: "code",
        client_id: c1.client,
        redirect_uri: CLAUDE,
        code_challenge: pkceS256(VERIFIER),
        code_challenge_method: "S256",
        state: "e2e-5c-2",
        resource: c1.resource,
      });
      const p2 = await st.site("friends", `/oauth/authorize?${q2}`, { browser: b });
      const rid2 = hidden(await p2.text(), "rid")!;
      const opened = await st.site("friends", "/oauth/authorize/signup", { browser: b, form: { rid: rid2, decision: "open" } });
      expect(opened.status).toBe(200);
      const formHtml = await opened.text();
      expect(formHtml).toContain(`value="${city}" selected`);
      expect(formHtml).toContain('<option value="chicago"');
      expect(formHtml).toContain('<option value="miami"');

      const joined = await st.site("friends", "/oauth/authorize/signup", {
        browser: b,
        form: {
          rid: rid2,
          decision: "join",
          signupView: hidden(formHtml, "signupView")!,
          consentVersion: hidden(formHtml, "consentVersion")!,
          smsConsent: "yes",
          firstName: "Maya",
          birthdate: "1996-05-12",
          homeCity: city,
        },
      });
      expect(joined.status, (await joined.clone().text()).slice(0, 300)).toBe(200);

      const [member] = await sql`
        select m.home_city from network.members m
        join platform.phone_identities ph on ph.person_id = m.person_id
        where m.app_id = 'friends' and ph.e164 = ${phone}
      `;
      expect(member?.home_city).toBe(city);
    }, T);
  }
});
