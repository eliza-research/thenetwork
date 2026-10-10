// MCP over Streamable HTTP: 2026-07-28 (per-request _meta and headers) and the legacy initialize
// handshake, the OpenAI surface that hides slop, and tool inputs that never take a phone or a code.
import { describe, expect, test } from "bun:test";
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
    expect(d.body!.result._meta["io.modelcontextprotocol/serverInfo"].name).toBe("the-network");

    const l = await rpc(env, NTWRK, "tools/list");
    expect(l.body!.result.tools.map((t: any) => t.name)).toEqual(["app_info", "start_signup", "check_status", "submit_profile", "get_updates"]);
    for (const t of l.body!.result.tools) {
      // Every tool but submit_profile only reads; submit_profile adds to the person's own profile (never destructive).
      const ro = t.name !== "submit_profile";
      expect(t.annotations).toEqual({ title: expect.any(String), readOnlyHint: ro, destructiveHint: false, idempotentHint: ro, openWorldHint: false });
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
    const info = await call(env, NTWRK, "app_info", { app: "peon" });
    expect(info.body!.result.isError).toBe(false);
    expect(info.body!.result.structuredContent).toMatchObject({ id: "peon", site: "https://peon.biz", ages: { join: 13, matching: 18 } });
    const signup = await call(env, NTWRK, "start_signup", { app: "friends" });
    expect(signup.body!.result.structuredContent).toMatchObject({ app: "friends", url: "https://friends.help/join?via=agent", keyword: "friends" });
    expect(signup.body!.result.structuredContent.instructions_for_person).toContain("Never share the code with anyone, including this assistant");
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
    expect(list.body!.result.tools).toHaveLength(5);
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
});

describe("surface=openai hides slop", () => {
  test("no slop in tools/list, app_info or start_signup; slop.date has no OpenAI endpoint", async () => {
    const env = setup();
    const l = await rpc(env, OPENAI, "tools/list");
    const tools = l.body!.result.tools;
    expect(tools.find((t: any) => t.name === "app_info").inputSchema.properties.app.enum).toEqual(["ntwrk", "peon", "friends"]);
    expect(l.text).not.toMatch(/slop/i);
    const all = await call(env, OPENAI, "app_info");
    expect(all.body!.result.structuredContent.apps.map((a: any) => a.id)).toEqual(["ntwrk", "peon", "friends"]);
    expect(all.text).not.toMatch(/slop|dating/i);
    for (const [name, args] of [["app_info", { app: "slop" }], ["start_signup", { app: "slop" }]] as const) {
      const r = await call(env, OPENAI, name, args);
      expect(r.body!.result.isError).toBe(true);
      expect(r.text).not.toMatch(/slop\.date|dating|matchmaker/i);
      // The same answer as for an app that does not exist: nothing tells that slop exists.
      const none = await call(env, OPENAI, name, { app: "zzzz" });
      expect(r.body!.result.content).toEqual(none.body!.result.content);
    }
    expect((await rpc(env, `${origin("slop.date")}/mcp/openai`, "tools/list")).res.status).toBe(404);
    // The full surface still lists it.
    expect((await call(env, NTWRK, "app_info", { app: "slop" })).body!.result.structuredContent.adults_only.join(" ")).toContain("Photos");
  });

  test("an OpenAI client is put on the OpenAI surface even at /mcp, and cannot register on slop.date", async () => {
    const env = setup();
    const chatgpt = { redirect_uris: ["https://chatgpt.com/connector_platform_oauth_redirect"] };
    expect((await register(env, "slop.date", chatgpt)).res.status).toBe(400);
    const c = await connect(env, "ntwrk.party", PHONE_A, { register: chatgpt, redirectUri: chatgpt.redirect_uris[0] });
    // Its token is for /mcp/openai only.
    expect((await rpc(env, NTWRK, "tools/list", {}, { token: c.token.access_token })).res.status).toBe(401);
    const l = await rpc(env, OPENAI, "tools/list", {}, { token: c.token.access_token });
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
  test("every input schema has only `app` (and submit_profile's `about`, get_updates' `update_token`), and extra fields are refused, not ignored", async () => {
    const env = setup();
    await addMember(env, PHONE_A, [{ app: "peon", state: "active" }]);
    for (const url of [NTWRK, OPENAI, `${origin("slop.date")}/mcp`]) {
      for (const t of (await rpc(env, url, "tools/list")).body!.result.tools) {
        expect(Object.keys(t.inputSchema.properties)).toEqual(t.name === "submit_profile" ? ["app", "about"] : t.name === "get_updates" ? ["app", "update_token"] : ["app"]);
        expect(JSON.stringify(t.inputSchema)).not.toMatch(/phone|code|otp|name|age|birth/i);
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
    for (let i = 0; i < 5; i++) expect((await call(env, PEON_MCP, "submit_profile", { about }, { token: d.token.access_token })).res.status).toBe(200);
    expect((await call(env, PEON_MCP, "submit_profile", { about }, { token: d.token.access_token })).res.status).toBe(429);
    expect(n).toBe(5);
  });
});
