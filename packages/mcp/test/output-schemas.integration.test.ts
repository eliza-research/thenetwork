// Real MCP HTTP handler and platform/OAuth stores; synthetic phones and fake OTP only.
// Ajv validates advertised contracts independently of the tool implementation.
import { expect, test } from "bun:test";
import Ajv from "ajv";
import { addMember, call, connect, origin, PHONE_A, rpc, setup } from "./harness.ts";

for (const [host, surface] of [["friends.help", "full"], ["ntwrk.party", "openai"]] as const) {
  test(`advertised ${surface} output schemas validate actual ${host} tool results`, async () => {
    const app = host === "friends.help" ? "friends" : "ntwrk";
    const url = `${origin(host)}/mcp${surface === "openai" ? "/openai" : ""}`;
    let acceptProfile = true;
    const env = setup({
      submitProfile: async () => acceptProfile ? "accepted" : "not_member",
      updates: async (_person, _app, _assistant, token) => token === "T-ZZZZZZ" ? [] : [
        { summary: "Board games on Saturday.", at: "2026-10-08T12:00:00.000Z", kind: "plan_probe" },
      ],
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
    expect([...validators.keys()].sort()).toEqual(["app_info", "check_status", "get_updates", "prepare_signup", "start_signup", "submit_profile"]);
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
    expect((await invoke("check_status", {}, token)).status).toBe("not_joined");
    expect((await invoke("submit_profile", { about: "I enjoy climbing and board games." }, token)).submitted).toBe(false);
    expect((await invoke("get_updates", {}, token)).updates).toEqual([]);
    expect((await invoke("prepare_signup", { firstName: "Ari", homeCity: "sf" }, token)).prepared).toBe(true);
    // Schema errors must not be hidden by a generic string/object contract.
    expect(validators.get("prepare_signup")!({ prepared: "true", app, url: "https://example.test/join", next_step: "Review it." })).toBe(false);
    const repeated = await call(env, url, "prepare_signup", { firstName: "Ari" }, { token });
    expect(repeated.body!.result.isError).toBe(true);
    expect(repeated.body!.result.structuredContent).toBeUndefined();

    const person = await addMember(env, PHONE_A, [{ app, state: "active" }]);
    // A grant made before this fixture person existed cannot gain that new identity.
    token = (await connect(env, host, PHONE_A, { resource: url })).token.access_token;
    const membership = (await env.people.getMembership(person, app))!;
    for (const [state, status] of [["invited", "invited"], ["onboarding", "onboarding"], ["active", "active"], ["paused", "stopped"], ["restricted", "on_hold"]] as const) {
      await env.people.putMembership({ ...membership, state });
      expect((await invoke("check_status", {}, token)).status).toBe(status);
    }
    await env.people.putMembership(membership);
    expect((await invoke("submit_profile", { about: "I enjoy climbing and board games." }, token)).submitted).toBe(true);
    acceptProfile = false;
    expect((await invoke("submit_profile", { about: "I enjoy climbing and board games." }, token)).submitted).toBe(false);
    const updates = await invoke("get_updates", {}, token);
    expect(updates.updates).toEqual([{ summary: "Board games on Saturday.", at: "2026-10-08T12:00:00.000Z", kind: "plan_probe" }]);
    expect(validators.get("get_updates")!({ ...updates, updates: [{ summary: "Missing fields" }] })).toBe(false);
    expect((await invoke("get_updates", { update_token: "T-ZZZZZZ" }, token)).updates).toEqual([]);
    expect(validators.get("check_status")!({ app: app === "friends" ? "ntwrk" : "friends", status: "active", next_step: "Signed up", manage_url: "https://example.test/settings" })).toBe(false);
  });
}
