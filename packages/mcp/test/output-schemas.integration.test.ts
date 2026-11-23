// Real MCP HTTP handler and platform/OAuth stores; synthetic phones and fake OTP only.
// Ajv validates advertised contracts independently of the tool implementation.
import { expect, test } from "vitest";
import Ajv from "ajv";
import { addMember, call, connect, origin, PHONE_A, rpc, setup } from "./harness.ts";

for (const [host, surface] of [["friends.help", "full"], ["ntwrk.party", "openai"]] as const) {
  test(`advertised ${surface} output schemas validate actual ${host} tool results`, async () => {
    const app = host === "friends.help" ? "friends" : "ntwrk";
    const url = `${origin(host)}/mcp${surface === "openai" ? "/openai" : ""}`;
    let acceptProfile = true;
    const entry = { ref: "INT-AAAAAAAAAAAA", number: 1, kind: "request" as const, summary: "A climbing partner", status: "active" as const, inProgress: false, endsAt: Date.UTC(2026, 10, 8) };
    const env = setup({
      submitProfile: async () => acceptProfile ? "accepted" : "not_member",
      updates: async (_person, _app, _assistant, token) => token === "T-ZZZZZZ" ? [] : [
        { summary: "Board games on Saturday.", at: "2026-10-08T12:00:00.000Z", kind: "plan_probe" },
      ],
      lookingFor: async () => ({
        entries: [entry],
        closedRecently: [{ ref: "INT-BBBBBBBBBBBB", summary: "A running partner", closedAt: Date.UTC(2026, 9, 1) }],
        checkWithPerson: [{ ref: "INT-AAAAAAAAAAAA", summary: "A climbing partner", reason: "said_not_wanted" }],
      }),
      changeLookingFor: async (_person, _app, _e164, _grant, ref, change) => ref !== entry.ref ? { kind: "refused", reason: "unknown_ref" }
        : change === "pause" ? { kind: "applied", entry: { ...entry, status: "paused" }, notice: "Paused." } : { kind: "unchanged", entry },
    });
    const listed = await rpc(env, url, "tools/list");
    expect(listed.res.status).toBe(200);
    const ajv = new Ajv({ strict: true, allErrors: true });
    const validators = new Map<string, ReturnType<typeof ajv.compile>>();
    for (const tool of listed.body!.result.tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.outputSchema.type).toBe("object");
      validators.set(tool.name, ajv.compile(tool.outputSchema));
    }
    expect([...validators.keys()].sort()).toEqual(["app_info", "check_status", "get_updates", "list_looking_for", "pause_looking_for", "prepare_signup", "read_profile", "resume_looking_for", "start_signup", "submit_profile"]);
    const invoke = async (name: string, args: Record<string, unknown> = {}, token?: string) => {
      const response = await call(env, url, name, args, { token });
      expect(response.res.status).toBe(200);
      const result = response.body!.result;
      expect(result.isError).toBe(false);
      const valid = validators.get(name)!;
      expect(valid(result.structuredContent), JSON.stringify(valid.errors)).toBe(true);
      expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
      expect(valid(null)).toBe(false);
      expect(valid({ ...result.structuredContent, unexpected_field: "not in the contract" })).toBe(false);
      return result.structuredContent;
    };
    // Both app_info variants, nullable keyword/legal links, and every listed public app.
    const all = await invoke("app_info");
    expect(all.apps.length).toBe(surface === "openai" ? 3 : 4);
    for (const item of all.apps) {
      await invoke("app_info", { app: item.id });
      await invoke("start_signup", { app: item.id });
    }
    const connection = await connect(env, host, PHONE_A, { resource: url });
    let token = connection.token.access_token;
    // spec/connectorTools.md, "Read saved profile fields only for this app's active member"
    const missingReadScope = await call(env, url, "read_profile", {}, { token });
    expect(connection.token.scope).not.toContain("profile:read");
    const challenge = surface === "openai" ? missingReadScope.body?.result?._meta?.["mcp/www_authenticate"]?.[0]
      : missingReadScope.res.headers.get("www-authenticate");
    expect(challenge).toContain('scope="profile:read"');
    expect((await invoke("check_status", {}, token)).status).toBe("not_joined");
    expect((await invoke("submit_profile", { about: "I enjoy climbing and board games." }, token)).submitted).toBe(false);
    expect((await invoke("get_updates", {}, token)).updates).toEqual([]);
    const missingListScope = await call(env, url, "list_looking_for", {}, { token });
    const listChallenge = surface === "openai" ? missingListScope.body?.result?._meta?.["mcp/www_authenticate"]?.[0]
      : missingListScope.res.headers.get("www-authenticate");
    expect(listChallenge).toContain('scope="profile:read"');
    expect(connection.token.scope).toContain("profile:write");
    expect(await invoke("pause_looking_for", { ref: entry.ref }, token)).toEqual({ app, changed: false, item: null, reason: "not_member", next_step: expect.any(String) });
    expect((await invoke("prepare_signup", { firstName: "Ari", homeCity: "sf" }, token)).prepared).toBe(true);
    // Schema errors must not be hidden by a generic string/object contract.
    expect(validators.get("prepare_signup")!({ prepared: "true", app, next_step: "Review it." })).toBe(false);
    const repeated = await call(env, url, "prepare_signup", { firstName: "Ari" }, { token });
    expect(repeated.body!.result.isError).toBe(true);
    expect(repeated.body!.result.structuredContent).toBeUndefined();
    expect(validators.get("check_status")!({ app, status: "joined", next_step: "Review it.", manage_url: "mailto:help@ntwrk.party" })).toBe(false);

    const otherApp = app === "friends" ? "ntwrk" : "friends";
    const person = await addMember(env, PHONE_A, [{ app, state: "active" }, { app: otherApp, state: "active" }]);
    // A grant made before this fixture person existed cannot gain that new identity.
    token = (await connect(env, host, PHONE_A, { resource: url, scope: "membership:read profile:write profile:read" })).token.access_token;
    const membership = {
      ...(await env.people.getMembership(person, app))!,
      profile: { about: "I enjoy board games.", interests: ["Climbing", "code 12345"], neighborhood: "Queens", homeCity: "nyc", privateNote: "Private fact" },
    };
    const otherMembership = (await env.people.getMembership(person, otherApp))!;
    await env.people.putMembership({ ...otherMembership, profile: { about: "Different app's private text." } });
    await env.accounts.recordConsent({ e164: PHONE_A, app, state: "opted_in", source: "keyword:start", at: env.clock.t });
    for (const [state, status] of [["invited", "invited"], ["onboarding", "onboarding"], ["active", "active"], ["paused", "stopped"], ["restricted", "on_hold"]] as const) {
      await env.people.putMembership({ ...membership, state });
      expect((await invoke("check_status", {}, token)).status).toBe(status);
      const profile = await invoke("read_profile", { app }, token);
      if (state === "active") {
        expect(profile).toEqual({ app, profile: { first_name: "Rae", about: "I enjoy board games.", interests: ["Climbing"], neighborhood: "Queens", home_region: "nyc" } });
      } else expect(profile).toEqual({ app, profile: null });
    }
    await env.people.putMembership(membership);
    const crossApp = await call(env, url, "read_profile", { app: otherApp }, { token });
    expect(crossApp.body?.result).toMatchObject({ isError: true });
    expect(crossApp.body?.result?.structuredContent).toBeUndefined();
    expect(await env.people.getMembership(person, app)).toEqual(membership);
    const submitted = await invoke("submit_profile", { about: "I enjoy climbing and board games." }, token);
    expect(submitted).toMatchObject({ app, submitted: true, check_with_person: [{ ref: "INT-AAAAAAAAAAAA", summary: "A climbing partner", reason: "said_not_wanted" }] });
    const listedNow = await invoke("list_looking_for", { app }, token);
    expect(listedNow.looking_for).toEqual([{ ref: entry.ref, number: 1, kind: "request", summary: "A climbing partner", status: "active", in_progress: false, ends_on: "2026-11-08" }]);
    expect(listedNow.closed_recently).toEqual([{ ref: "INT-BBBBBBBBBBBB", summary: "A running partner", closed_on: "2026-10-01" }]);
    expect(validators.get("list_looking_for")!({ ...listedNow, looking_for: [{ ...listedNow.looking_for[0], status: "closed" }] })).toBe(false);
    const readOnly = await connect(env, host, PHONE_A, { resource: url, scope: "membership:read profile:read" });
    expect(readOnly.token.scope).not.toContain("profile:write");
    for (const tool of ["pause_looking_for", "resume_looking_for"]) {
      const refused = await call(env, url, tool, { ref: entry.ref }, { token: readOnly.token.access_token });
      const writeChallenge = surface === "openai" ? refused.body?.result?._meta?.["mcp/www_authenticate"]?.[0]
        : refused.res.headers.get("www-authenticate");
      expect(writeChallenge, tool).toContain('scope="profile:write"');
      expect(refused.body?.result?.structuredContent, tool).toBeUndefined();
    }
    expect((await invoke("list_looking_for", { app }, token)).looking_for).toEqual(listedNow.looking_for);
    const paused = await invoke("pause_looking_for", { ref: entry.ref }, token);
    expect(paused).toMatchObject({ app, changed: true, reason: null, item: { ref: entry.ref, status: "paused" } });
    expect(await invoke("resume_looking_for", { ref: entry.ref }, token)).toMatchObject({ app, changed: false, reason: null, next_step: "No change: it was already in that state." });
    expect(await invoke("resume_looking_for", { ref: "INT-CCCCCCCCCCCC" }, token)).toMatchObject({ app, changed: false, item: null, reason: "unknown_ref" });
    expect(validators.get("pause_looking_for")!({ ...paused, reason: "something_else" })).toBe(false);
    acceptProfile = false;
    expect((await invoke("submit_profile", { about: "I enjoy climbing and board games." }, token)).submitted).toBe(true);
    const correctedProfile = { about: "I enjoy climbing and photography." };
    expect((await invoke("submit_profile", correctedProfile, token)).submitted).toBe(false);
    acceptProfile = true;
    expect((await invoke("submit_profile", correctedProfile, token)).submitted).toBe(true);
    const updates = await invoke("get_updates", {}, token);
    expect(updates.updates).toEqual([{ summary: "Board games on Saturday.", at: "2026-10-08T12:00:00.000Z", kind: "plan_probe" }]);
    expect(validators.get("get_updates")!({ ...updates, updates: [{ summary: "Missing fields" }] })).toBe(false);
    expect((await invoke("get_updates", { update_token: "T-ZZZZZZ" }, token)).updates).toEqual([]);
    expect(validators.get("check_status")!({ app: app === "friends" ? "ntwrk" : "friends", status: "active", next_step: "Signed up", manage_url: "https://example.test/settings" })).toBe(false);
  });
}
