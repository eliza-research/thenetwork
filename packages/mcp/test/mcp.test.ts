import { describe, expect, test } from "vitest";
import { defaultApps } from "../src/apps.ts";
import type { MinorNotice } from "../../core/src/generated/textEnrollment.ts";
import { addMember, call, connect, MODERN, origin, PHONE_A, PHONE_B, register, rpc, setup } from "./harness.ts";

const NTWRK = `${origin("ntwrk.party")}/mcp`;
const OPENAI = `${origin("ntwrk.party")}/mcp/openai`;

describe("Streamable HTTP, 2026-07-28", () => {
  test("server/discover, tools/list and tools/call with the request headers", async () => {
    const env = setup();
    const d = await rpc(env, NTWRK, "server/discover");
    expect(d.res.status).toBe(200);
    expect(d.res.headers.get("content-type")).toContain("application/json");
    expect(d.res.headers.get("mcp-session-id")).toBeNull();
    expect(d.body!.result).toMatchObject({ resultType: "complete", supportedVersions: expect.arrayContaining([MODERN, "2025-11-25"]), capabilities: { tools: {} } });
    expect(d.body!.result.instructions.slice(0, 512)).toContain("Never ask for, accept or relay a phone number or a verification code");
    for (const tool of ["app_info", "start_signup", "check_status", "read_profile", "submit_profile", "get_updates", "prepare_signup"]) expect(d.body!.result.instructions).toContain(tool);
    expect(d.body!.result.instructions).toContain("ticks the text consent in the browser");
    expect(d.body!.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("the-network");

    const l = await rpc(env, NTWRK, "tools/list");
    expect(l.body!.result.tools.map((t: any) => t.name)).toEqual(["app_info", "start_signup", "prepare_signup", "check_status", "get_context", "read_profile", "submit_profile", "set_availability", "set_red_lines", "manage_domains", "list_looking_for", "pause_looking_for", "resume_looking_for", "get_updates"]);
    const described = (name: string) => l.body!.result.tools.find((t: any) => t.name === name).description as string;
    expect(described("prepare_signup")).toContain("ticks the text consent");
    expect(described("prepare_signup")).not.toMatch(/approves? their details and text consent there/i);
    for (const name of ["check_status", "get_updates", "prepare_signup"]) expect(described(name)).toContain("allows access on ntwrk.party");
    const site = await rpc(env, `${origin("peon.biz")}/mcp`, "tools/list");
    expect(site.body!.result.tools.find((t: any) => t.name === "check_status").description).toContain("allows access on peon.biz");
    for (const t of l.body!.result.tools) {
      const ro = !["get_context", "submit_profile", "set_availability", "set_red_lines", "manage_domains", "get_updates", "prepare_signup", "pause_looking_for", "resume_looking_for"].includes(t.name);
      const idempotent = ro || ["set_availability", "set_red_lines", "manage_domains", "pause_looking_for", "resume_looking_for"].includes(t.name);
      expect(t.annotations).toEqual({ title: expect.any(String), readOnlyHint: ro, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false });
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
    const info = await call(env, NTWRK, "app_info", { app: "peon" });
    expect(info.body!.result.isError).toBe(false);
    expect(info.body!.result.structuredContent).toMatchObject({ id: "peon", site: "https://peon.biz", ages: { join: 13, matching: 18 } });
    const signup = await call(env, NTWRK, "start_signup", { app: "friends" });
    expect(signup.body!.result.structuredContent).toMatchObject({ app: "friends", url: "https://friends.help/SKILL.md", keyword: "friends" });
    expect(signup.body!.result.structuredContent.instructions_for_person).toContain("Keep the verification code on that page");
    expect((await rpc(env, NTWRK, "ping")).body!.result).toMatchObject({ resultType: "complete" });
  });

  test("header rules: mismatch -32020, unsupported version -32022, missing capabilities -32602", async () => {
    const env = setup();
    const noName = await rpc(env, NTWRK, "tools/call", { name: "app_info", arguments: {} }, { headers: { "mcp-name": "start_signup" } });
    expect(noName.res.status).toBe(400);
    expect(noName.body!.error.code).toBe(-32020);
    const b64 = await rpc(env, NTWRK, "tools/call", { name: "app_info", arguments: {} }, { headers: { "mcp-name": `=?base64?${Buffer.from("app_info").toString("base64")}?=` } });
    expect(b64.res.status).toBe(200);
    expect((await rpc(env, NTWRK, "tools/list", {}, { headers: { "mcp-method": "tools/call" } })).body!.error.code).toBe(-32020);
    expect((await rpc(env, NTWRK, "tools/list", {}, { headers: { "mcp-protocol-version": "2025-11-25" } })).body!.error.code).toBe(-32020);
    const res = await env.fetch(new Request(NTWRK, {
      method: "POST", headers: { "content-type": "application/json", "mcp-protocol-version": "2099-01-01", "mcp-method": "tools/list" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2099-01-01", "io.modelcontextprotocol/clientCapabilities": {} } } }),
    }));
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error).toMatchObject({ code: -32022, data: { requested: "2099-01-01", supported: expect.arrayContaining([MODERN]) } });
    const noCaps = await env.fetch(new Request(NTWRK, {
      method: "POST", headers: { "content-type": "application/json", "mcp-protocol-version": MODERN, "mcp-method": "tools/list" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "tools/list", params: { _meta: { "io.modelcontextprotocol/protocolVersion": MODERN } } }),
    }));
    expect(noCaps.status).toBe(400);
    expect(((await noCaps.json()) as any).error.code).toBe(-32602);
    const unknown = await rpc(env, NTWRK, "resources/list");
    expect(unknown.res.status).toBe(404);
    expect(unknown.body!.error.code).toBe(-32601);
  });

  test("POST only; notifications get 202; batches and bad JSON are refused; a foreign Origin gets 403", async () => {
    const env = setup();
    for (const method of ["GET", "DELETE"]) expect((await env.fetch(new Request(NTWRK, { method }))).status).toBe(405);
    expect((await rpc(env, NTWRK, "notifications/initialized", {}, { id: null, modern: false })).res.status).toBe(202);
    const batch = await env.fetch(new Request(NTWRK, { method: "POST", headers: { "content-type": "application/json" }, body: "[]" }));
    expect(batch.status).toBe(400);
    expect((await env.fetch(new Request(NTWRK, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }))).status).toBe(400);
    expect((await rpc(env, NTWRK, "tools/list", {}, { headers: { origin: "https://evil.example" } })).res.status).toBe(403);
    const own = await rpc(env, NTWRK, "tools/list", {}, { headers: { origin: "https://ntwrk.party" } });
    expect(own.res.status).toBe(200);
    expect(own.res.headers.get("access-control-allow-origin")).toBe("https://ntwrk.party");
  });

  test("legacy clients: initialize, then tools/list and tools/call without _meta", async () => {
    const env = setup();
    const init = await rpc(env, NTWRK, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "old", version: "1" } }, { modern: false });
    expect(init.body!.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name: "the-network" } });
    expect(init.body!.result.resultType).toBeUndefined();
    expect(init.res.headers.get("mcp-session-id")).toBeNull();
    const future = await rpc(env, NTWRK, "initialize", { protocolVersion: "2030-01-01", capabilities: {} }, { modern: false });
    expect(future.body!.result.protocolVersion).toBe("2025-11-25");
    const list = await rpc(env, NTWRK, "tools/list", {}, { modern: false, headers: { "mcp-protocol-version": "2025-06-18" } });
    expect(list.body!.result.tools).toHaveLength(14);
    const tool = await call(env, NTWRK, "app_info", {}, { modern: false });
    expect(tool.body!.result.structuredContent.apps.map((a: any) => a.id)).toEqual(["ntwrk", "slop", "peon", "friends"]);
  });

  test("check_status without a token: 401 with the protected resource metadata", async () => {
    const env = setup();
    const r = await call(env, `${origin("slop.date")}/mcp`, "check_status");
    expect(r.res.status).toBe(401);
    expect(r.res.headers.get("www-authenticate")).toBe('Bearer resource_metadata="https://slop.date/.well-known/oauth-protected-resource/mcp", scope="membership:read"');
    // A bad token on any call is 401, never served as anonymous.
    expect((await call(env, NTWRK, "app_info", {}, { token: "ntwa_forged" })).res.status).toBe(401);
  });

  for (const [app, domain] of [["friends", "friends.help"], ["ntwrk", "ntwrk.party"]] as const) {
    test(`check_status takes the ${domain} text for a member under 18 from the network's notice, promises nothing without it, and an adult gets the plain text`, async () => {
      const single = "You are signed up. Since you're under 18, I won't introduce you to other members, but I can suggest public places and events.";
      const bare = setup();
      await addMember(bare, PHONE_A, [{ app, state: "active" }], 16);
      const bareConnection = await connect(bare, domain, PHONE_A, { scope: "membership:read" });
      expect((await call(bare, `${origin(domain)}/mcp`, "check_status", {}, { token: bareConnection.token.access_token })).body!.result.structuredContent)
        .toMatchObject({ status: "active", next_step: single });

      let answer: MinorNotice | undefined = "MinorTeenFriendNotice";
      const asked: string[] = [];
      const env = setup({ minorNotice: async (personId, id) => { asked.push(`${personId}:${id}`); return answer; } });
      const teen = await addMember(env, PHONE_A, [{ app, state: "active" }], 16);
      await addMember(env, PHONE_B, [{ app, state: "active" }], 30);
      const status = async (phone: string) => {
        env.clock.t += 3_600_000;
        const connection = await connect(env, domain, phone, { scope: "membership:read" });
        return (await call(env, `${origin(domain)}/mcp`, "check_status", {}, { token: connection.token.access_token })).body!.result.structuredContent;
      };
      expect(await status(PHONE_A)).toMatchObject({ status: "active", next_step: "You are signed up. People under 18 are introduced only for friendship, to people close to their age." });
      answer = "MinorSinglePlayerNotice";
      expect(await status(PHONE_A)).toMatchObject({ status: "active", next_step: single });
      answer = "MinorBirthdayNotice";
      expect(await status(PHONE_A)).toMatchObject({
        status: "active",
        next_step: `${single} If you tell me your birthday (month, day and year), I can look for friends close to your age.`,
      });
      answer = undefined;
      expect(await status(PHONE_A)).toMatchObject({ status: "active", next_step: single });
      expect(asked).toEqual([`${teen}:${app}`, `${teen}:${app}`, `${teen}:${app}`, `${teen}:${app}`]);
      expect(await status(PHONE_B)).toMatchObject({ status: "active", next_step: "You are signed up." });
      expect(asked).toHaveLength(4);
    });
  }

  test("check_status tells a peon.biz member under 18 that there is no work matching and where friendship introductions happen", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }], 16);
    await addMember(env, PHONE_B, [{ app: "peon", state: "active" }], 30);
    const status = async (phone: string) => {
      const connection = await connect(env, "peon.biz", phone, { scope: "membership:read" });
      return (await call(env, `${origin("peon.biz")}/mcp`, "check_status", {}, { token: connection.token.access_token })).body!.result.structuredContent;
    };
    expect(await status(PHONE_A)).toMatchObject({
      status: "active",
      next_step: "You are signed up. peon.biz doesn't match anyone under 18 for work. I can still help you myself. Friendship introductions for people under 18 happen on friends.help and ntwrk.party.",
    });
    expect(await status(PHONE_B)).toMatchObject({ status: "active", next_step: "You are signed up." });
  });

  test("check_status tells a slop.date member under 18 that there are no dates and that friendship introductions happen on friends.help and ntwrk.party", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "slop", state: "active" }], 16);
    await addMember(env, PHONE_B, [{ app: "slop", state: "active" }], 30);
    const status = async (phone: string) => {
      const connection = await connect(env, "slop.date", phone, { scope: "membership:read" });
      return (await call(env, `${origin("slop.date")}/mcp`, "check_status", {}, { token: connection.token.access_token })).body!.result.structuredContent;
    };
    expect(await status(PHONE_A)).toMatchObject({
      status: "active",
      next_step: "You are signed up. slop.date doesn't match anyone under 18 for dates. Friendship introductions for people under 18 happen on friends.help and ntwrk.party.",
    });
    expect(await status(PHONE_B)).toMatchObject({ status: "active", next_step: "You are signed up." });
  });

  test("active membership status stays read-only and does not promise matching or delivery", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "friends", state: "active" }]);
    const connection = await connect(env, "friends.help", PHONE_A, { scope: "membership:read" });
    const person = (await env.accounts.personFor(PHONE_A))!;
    const before = await env.people.getMembership(person.id, "friends");
    const sends = env.provider.sent.length;
    const r = await call(env, `${origin("friends.help")}/mcp`, "check_status", {}, { token: connection.token.access_token });
    expect(r.res.status).toBe(200);
    expect(r.body!.result.isError).toBe(false);
    const status = r.body!.result.structuredContent;
    expect(status).toMatchObject({ app: "friends", status: "active", manage_url: "mailto:help@ntwrk.party" });
    // Membership is confirmed; no delivery or matching capability was supplied to this handler.
    expect(status.next_step).not.toMatch(/\b(texts?|messages?|matching|introductions?|ready)\b/i);
    expect(status.next_step).toMatch(/signed up/i);
    expect(await env.people.getMembership(person.id, "friends")).toEqual(before);
    expect(env.provider.sent.length).toBe(sends);
  });
});

describe("surface=openai serves every app endpoint", () => {
  test("the OpenAI surface respects an app's registry opt-out on both connector paths", async () => {
    // spec/connectorTools.md, "A connection binds to one host on one surface"
    const apps = defaultApps();
    apps.friends.openai = false;
    const host = origin("friends.help");
    const openAi = setup({ apps, surface: "openai" });
    expect((await rpc(openAi, `${host}/mcp/openai`, "tools/list")).res.status).toBe(404);
    expect((await rpc(openAi, `${host}/mcp`, "tools/list")).res.status).toBe(404);
    expect((await rpc(setup({ apps }), `${host}/mcp`, "tools/list")).res.status).toBe(200);
  });

  test("the OpenAI plugin server names no slop or dating; only the slop endpoint of the OpenAI surface offers slop; slop.date's own site keeps no OpenAI endpoint", async () => {
    const env = setup();
    const l = await rpc(env, OPENAI, "tools/list");
    expect(l.body!.result.tools.find((t: any) => t.name === "app_info").inputSchema.properties.app.enum).toEqual(["ntwrk", "peon", "friends"]);
    expect(l.text).not.toMatch(/slop|dating/i);
    expect((await rpc(env, OPENAI, "server/discover")).text).not.toMatch(/slop|dating/i);
    const all = await call(env, OPENAI, "app_info");
    expect(all.body!.result.structuredContent.apps.map((a: any) => a.id)).toEqual(["ntwrk", "peon", "friends"]);
    expect(all.text).not.toMatch(/slop|dating/i);
    for (const [name, args] of [["app_info", { app: "slop" }], ["start_signup", { app: "slop" }]] as const) {
      const r = await call(env, OPENAI, name, args);
      expect(r.body!.result.isError).toBe(true);
      expect(r.text).not.toMatch(/slop\.date|dating|matchmaker/i);
      const none = await call(env, OPENAI, name, { app: "zzzz" });
      expect(r.body!.result.content).toEqual(none.body!.result.content);
    }
    for (const app of ["peon", "friends"]) {
      const other = await rpc(env, `${origin("ntwrk.party")}/mcp/${app}/openai`, "tools/list");
      expect(other.res.status).toBe(200);
      expect(other.text).not.toMatch(/slop|dating/i);
    }
    const SLOP_OPENAI = `${origin("ntwrk.party")}/mcp/slop/openai`;
    const slop = await rpc(env, SLOP_OPENAI, "tools/list");
    expect(slop.res.status).toBe(200);
    expect(slop.body!.result.tools.find((t: any) => t.name === "app_info").inputSchema.properties.app.enum).toEqual(["ntwrk", "slop", "peon", "friends"]);
    for (const [name, args] of [["app_info", { app: "slop" }], ["start_signup", { app: "slop" }]] as const) {
      const r = await call(env, SLOP_OPENAI, name, args);
      expect(r.body!.result.isError).toBe(false);
      expect(r.body!.result.structuredContent).toMatchObject(name === "app_info" ? { id: "slop" } : { app: "slop" });
    }
    expect((await call(env, SLOP_OPENAI, "app_info", { app: "slop" })).body!.result.structuredContent.adults_only.join(" ")).toContain("Photos");
    expect((await rpc(env, `${origin("slop.date")}/mcp/openai`, "tools/list")).res.status).toBe(404);
    expect((await call(env, NTWRK, "app_info", { app: "slop" })).body!.result.structuredContent.adults_only.join(" ")).toContain("Photos");
  });

  test("app_info names teen friendship introductions on friends.help and ntwrk.party, and none on slop.date or peon.biz", async () => {
    const env = setup();
    const rule = async (app: string) => (await call(env, NTWRK, "app_info", { app })).body!.result.structuredContent.adults_only[0];
    const teen = "Matching is for adults 18 or older, except friendship introductions between people aged 13 to 18 born at most 2 years apart, after an automatic check approves each one.";
    const adult = "Nobody under 18 is matched for dates or work on this app. Friendship introductions for people under 18 happen on friends.help and ntwrk.party.";
    expect([await rule("ntwrk"), await rule("friends"), await rule("slop"), await rule("peon")]).toEqual([teen, teen, adult, adult]);
  });

  test("a public tool answers that an app is not available when the agent names an app that is not in the registry", async () => {
    const env = setup();
    for (const endpoint of [NTWRK, OPENAI]) {
      for (const name of ["app_info", "start_signup"] as const) {
        const r = await call(env, endpoint, name, { app: "buddies" });
        expect(r.res.status).toBe(200);
        expect(r.body!.result.isError).toBe(true);
        expect(r.body!.result.content[0].text).toBe("That app is not available here.");
      }
    }
  });

  test("an OpenAI client is put on the OpenAI surface even at /mcp, except the slop.date ChatGPT connector, which registers on the full surface for everyone", async () => {
    const env = setup();
    const chatgpt = { redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] };
    expect((await register(env, "slop.date", chatgpt)).res.status).toBe(201);
    expect((await register(env, "slop.date", { redirect_uris: ["https://platform.openai.com/callback"] })).res.status).toBe(400);
    const c = await connect(env, "ntwrk.party", PHONE_A, { register: chatgpt, redirectUri: chatgpt.redirect_uris[0] });
    // Its token is for /mcp/openai only.
    expect((await rpc(env, NTWRK, "tools/list", {}, { token: c.token.access_token })).res.status).toBe(401);
    const l = await rpc(env, OPENAI, "tools/list", {}, { token: c.token.access_token });
    expect(l.res.status).toBe(200);
    expect(l.text).not.toMatch(/slop/i);
  });

  test("on the OpenAI surface a missing sign-in comes back in the tool result (mcp/www_authenticate)", async () => {
    const env = setup();
    const r = await call(env, OPENAI, "check_status");
    expect(r.res.status).toBe(200);
    expect(r.body!.result.isError).toBe(true);
    expect(r.body!.result._meta["mcp/www_authenticate"][0]).toContain("/.well-known/oauth-protected-resource/mcp/openai");
  });
});

describe("no tool accepts a phone number or a code", () => {
  test("only the authenticated draft accepts a first name/home city; all unlisted fields are refused", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    for (const url of [NTWRK, OPENAI, `${origin("slop.date")}/mcp`]) {
      for (const t of (await rpc(env, url, "tools/list")).body!.result.tools) {
        expect(Object.keys(t.inputSchema.properties)).toEqual(
          t.name === "submit_profile" ? ["app", "about"]
            : t.name === "get_updates" ? ["app", "update_token"]
            : t.name === "get_context" ? ["app", "include", "update_token"]
            : t.name === "set_availability" ? ["app", "days", "windows", "quietHours", "timezone", "notes"]
            : t.name === "set_red_lines" ? ["app", "redLines", "mode"]
            : t.name === "manage_domains" ? ["app", "enable", "disable"]
            : t.name === "prepare_signup" ? ["app", "firstName", "homeCity"]
            : t.name === "pause_looking_for" || t.name === "resume_looking_for" ? ["app", "ref"]
            : t.name === "photo_request" ? ["app", "words"]
            : ["app"]);
        expect(JSON.stringify(t.inputSchema)).not.toMatch(t.name === "prepare_signup" ? /phone|code|otp|age|birth|orientation|gender/i : /phone|code|otp|name|age|birth/i);
      }
    }
    const sends = env.provider.sent.length;
    for (const [name, args] of [
      ["start_signup", { app: "peon", phone: "+12125550142" }],
      ["start_signup", { app: "peon", code: "123456" }],
      ["app_info", { app: "peon", first_name: "Rae", age: 30 }],
      ["check_status", { phone: "+12125550142" }],
    ] as const) {
      const r = await call(env, `${origin("peon.biz")}/mcp`, name, args);
      if (name === "check_status") { expect(r.res.status).toBe(401); continue; }
      expect(r.body!.result.isError).toBe(true);
      expect(r.text).toContain("never takes phone numbers, codes or personal details");
      expect(r.text).not.toContain("5550142");
    }
    expect(env.provider.sent.length).toBe(sends);
    // With a token, check_status still refuses a phone argument (no lookup of another person).
    const c = await connect(env, "peon.biz", PHONE_A);
    const r = await call(env, `${origin("peon.biz")}/mcp`, "check_status", { phone: "+12125550143" }, { token: c.token.access_token });
    expect(r.body!.result.isError).toBe(true);
  });

  test("the authorize page never reads a phone or a code from the client's URL", async () => {
    const env = setup();
    const reg = await register(env, "peon.biz");
    const flow = await (await import("./harness.ts")).browserFlow(env, "peon.biz", reg.body.client_id, PHONE_A, { extraQuery: { login_hint: "+12125550143", phone: "+12125550143", code: "123456" } });
    expect(flow.html).not.toContain("5550143");
    expect(env.provider.sent.every(s => s.e164 === PHONE_A)).toBe(true);
    expect(flow.location).toContain("code=");
  });
});

describe("submit_profile (founder decision 10: the profile comes from the person's own agent)", () => {
  const PEON_MCP = `${origin("peon.biz")}/mcp`;
  test("needs profile:write; refuses phone numbers, codes and emails; never creates a member; delivers the person's own words", async () => {
    const got: { personId: string; app: string; text: string }[] = [];
    const env = setup({ submitProfile: async (personId, app, _e164, text) => { got.push({ personId, app, text }); return "accepted"; } });
    // Not signed in: 401 with the scope challenge.
    expect((await call(env, PEON_MCP, "submit_profile", { about: "Looking for a backend role, Brooklyn, weekday mornings." })).res.status).toBe(401);
    const c = await connect(env, "peon.biz", PHONE_A);
    expect(c.token.scope).toContain("profile:write");
    // Signed in but not a member yet: nothing is delivered, and the next step is the join link.
    let r = await call(env, PEON_MCP, "submit_profile", { about: "Looking for a backend role, Brooklyn, weekday mornings." }, { token: c.token.access_token });
    expect(r.body!.result.structuredContent).toMatchObject({ submitted: false, status: "not_joined" });
    expect(got).toEqual([]);
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    // A grant made before the number had a person never follows the person made later: connect again.
    expect((await call(env, PEON_MCP, "submit_profile", { about: "Backend roles." }, { token: c.token.access_token })).res.status).toBe(401);
    const c2 = await connect(env, "peon.biz", PHONE_A);
    // Contact details and codes are refused, never stored or relayed.
    for (const about of ["Call me at 212 555 0142 about roles", "my code is 482913 thanks", "email rae@example.org for my CV", "My number is (415) 555-0102 if needed.",
      "call +1 415 555 0102 anytime ok", "reach me at 4155550102 please", "my cell 555 0102 for the job", "the code was 4821 and I like jazz", "verification 1234567890 here",
      "my cell4155550102 thanks", "call 4155550102ok", "text me at tel4155550102", "_4155550102_ here", "my number 41555 50102 ok", "number is 212 55501 42 ok"]) {
      r = await call(env, PEON_MCP, "submit_profile", { about }, { token: c2.token.access_token });
      expect([about, r.body!.result.isError]).toEqual([about, true]);
    }
    // Another field (a phone, an age) is refused too.
    r = await call(env, PEON_MCP, "submit_profile", { about: "Looking for a backend role in Brooklyn.", phone: "+12125550142" }, { token: c2.token.access_token });
    expect(r.body!.result.isError).toBe(true);
    expect(got).toEqual([]);
    // A standalone 5-digit zip is part of a profile (slop's distance question needs it), next to ranges and miles too.
    const about = "Looking for a backend role near 11211 (Brooklyn), within 5 miles, 20-30 hours a week. I like small teams.";
    env.clock.t += 61_000; // past the per-grant call limit of one minute
    r = await call(env, PEON_MCP, "submit_profile", { about }, { token: c2.token.access_token });
    expect(r.body!.result.structuredContent).toMatchObject({ app: "peon", submitted: true });
    expect(got).toEqual([{ personId: (await env.accounts.personFor(PHONE_A))!.id, app: "peon", text: about }]);
    // A grant without profile:write gets 403 insufficient_scope.
    const narrow = await connect(env, "peon.biz", PHONE_A, { scope: "membership:read" });
    expect((await call(env, PEON_MCP, "submit_profile", { about }, { token: narrow.token.access_token })).res.status).toBe(403);
  });

  test("a stopped or held member gets nothing delivered, and a grant can send at most 5 profiles a day", async () => {
    let n = 0;
    const env = setup({ submitProfile: async () => { n++; return "accepted"; } });
    await addMember(env, PHONE_A, [{ app: "peon", state: "paused" }]);
    const c = await connect(env, "peon.biz", PHONE_A);
    const about = "Looking for a backend role, Brooklyn, weekday mornings.";
    expect((await call(env, PEON_MCP, "submit_profile", { about }, { token: c.token.access_token })).body!.result.structuredContent).toMatchObject({ submitted: false, status: "stopped" });
    expect(n).toBe(0);
    await addMember(env, PHONE_B, [{ app: "peon", state: "active" }]);
    const d = await connect(env, "peon.biz", PHONE_B);
    for (const schedule of ["weekday mornings", "weekday evenings", "Saturday mornings", "Sunday afternoons", "weekday afternoons"]) {
      const profile = `Looking for a backend role in Brooklyn. I am free on ${schedule}.`;
      expect((await call(env, PEON_MCP, "submit_profile", { about: profile }, { token: d.token.access_token })).res.status).toBe(200);
    }
    expect((await call(env, PEON_MCP, "submit_profile", { about }, { token: d.token.access_token })).res.status).toBe(429);
    expect(n).toBe(5);
  });

  test("refuses disguised phones, codes and emails on submit_profile and withholds disguised codes on read_profile", async () => {
    const got: string[] = [];
    const env = setup({
      submitProfile: async (_personId, _app, _e164, text) => { got.push(text); return "accepted"; },
    });
    const person = await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    const saved = (await env.people.getMembership(person, "peon"))!;
    await env.people.putMembership({
      ...saved,
      profile: {
        about: "my code is 482\u200B913 thanks",
        neighborhood: "near ٤٨٢٩١ brooklyn",
        interests: [
          "climbing",
          "code 482/913",
          "code four eight two nine one three",
          "pin 1\u20E3 2\u20E3 3\u20E3 4\u20E3 5\u20E3 6\u20E3",
          "born in the 1990s",
        ],
        homeCity: "nyc",
      },
    });
    await env.accounts.recordConsent({ e164: PHONE_A, app: "peon", state: "opted_in", source: "keyword:start", at: env.clock.t });
    const c = await connect(env, "peon.biz", PHONE_A, { scope: "membership:read profile:write profile:read" });
    for (const about of [
      "my code is 482\u200B913 thanks",
      "my code is 48\u200B291 thanks",
      "my code is ４８２９１３ thanks",
      "my code is ٤٨٢٩١٣ thanks",
      "my code is ٤٨٢٩١ thanks",
      "my code is 482/913 thanks",
      "my code is 482_913 thanks",
      "my code is four eight two nine one three thanks",
      "text me at 1\u20E3 2\u20E3 3\u20E3 4\u20E3 5\u20E3 6\u20E3",
      "call me at 415\u200B555\u200B01\u200B02 please",
      "call me at ４１５－５５５－０１０２ please",
      "call me at ٢١٢-٥٥٥-٠١٠٢ please",
      "call me at 415_555_0102 anytime",
      "call me at two one two five five five zero one zero two",
      "my cell is (415) 555-ol02 thanks",
      "email rae\u200B@example.org for my CV",
      "reach me at rae[@]example[.]org for my CV",
      "reach me at rae<at>example<dot>org for my CV",
      "reach me at rae at example[.]org for my CV",
      "reach me at rae_at_example_dot_org for my CV",
      "reach me at rae . lee @ example . org for my CV",
      "reach me at rae at gmail.",
    ]) {
      const r = await call(env, PEON_MCP, "submit_profile", { about }, { token: c.token.access_token });
      expect([about, r.body!.result.isError]).toEqual([about, true]);
    }
    expect(got).toEqual([]);
    const read = await call(env, PEON_MCP, "read_profile", { app: "peon" }, { token: c.token.access_token });
    expect(read.res.status).toBe(200);
    expect(read.body!.result.structuredContent).toEqual({
      app: "peon",
      profile: {
        first_name: "Rae",
        about: null,
        neighborhood: null,
        interests: ["climbing", "born in the 1990s"],
        home_region: "nyc",
      },
    });
    const clean = "Backend engineer, previously worked at stripe.com, near 11211 two blocks from park, 100-120 team, free 11/24, project_2025.";
    env.clock.t += 61_000;
    const ok = await call(env, PEON_MCP, "submit_profile", { about: clean }, { token: c.token.access_token });
    expect(ok.body!.result.structuredContent).toMatchObject({ app: "peon", submitted: true });
    expect(got).toEqual([clean]);
  });
});
