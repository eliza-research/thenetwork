// get_updates (the person's own inbox in one app) and the assistant connect/disconnect signals
// (packages/notify; entry-flows doc 5). The platform hooks are stubs that record their calls.
import { describe, expect, test } from "bun:test";
import { assistantOf } from "../src/handler.ts";
import type { AssistantKind, PublicUpdate } from "../src/hooks.ts";
import { addMember, call, connect, origin, PHONE_A, PHONE_B, rpc, setup } from "./harness.ts";

function env() {
  const asked: Array<{ personId: string; app: string; assistant: AssistantKind; token?: string }> = [];
  const linked: Array<{ personId: string; assistant: AssistantKind; active: boolean }> = [];
  const e = setup({
    updates: async (personId, app, assistant, token): Promise<PublicUpdate[]> => {
      asked.push({ personId, app, assistant, ...(token ? { token } : {}) });
      return token === "T-ZZZZZZ" ? [] : [{ summary: "Dev is free Thursday.", at: "2026-10-08T12:00:00.000Z", kind: "plan_probe" }];
    },
    assistantLinked: async (personId, assistant, active) => { linked.push({ personId, assistant, active }); },
  });
  return { e, asked, linked };
}

const CLAUDE_CB = "https://claude.ai/api/mcp/auth_callback";

describe("assistantOf", () => {
  test("by redirect host; OpenAI surface is ChatGPT; anything else is web", () => {
    expect(assistantOf({ surface: "full", redirectUris: [CLAUDE_CB] })).toBe("claude");
    expect(assistantOf({ surface: "full", redirectUris: ["https://grok.com/connectors-oauth-exchange-code"] })).toBe("grok");
    expect(assistantOf({ surface: "openai", redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"] })).toBe("chatgpt");
    expect(assistantOf({ surface: "full", redirectUris: ["https://evilclaude.ai/cb", "not a url"] })).toBe("web");
  });
});

describe("get_updates", () => {
  test("the person's own updates in the grant's app, with the assistant and the reference", async () => {
    const { e, asked, linked } = env();
    await addMember(e, PHONE_A, [{ app: "peon", state: "active" }]);
    const c = await connect(e, "peon.biz", PHONE_A, { register: { redirect_uris: [CLAUDE_CB] }, redirectUri: CLAUDE_CB });
    const personId = (await e.accounts.personFor(PHONE_A))!.id;
    expect(linked).toEqual([{ personId, assistant: "claude", active: true }]);

    const r = await call(e, `${origin("peon.biz")}/mcp`, "get_updates", { update_token: "t-7f3k9q" }, { token: c.token.access_token });
    expect(r.body!.result.isError).toBe(false);
    expect(r.body!.result.structuredContent).toMatchObject({ app: "peon", updates: [{ summary: "Dev is free Thursday." }] });
    expect(asked).toEqual([{ personId, app: "peon", assistant: "claude", token: "T-7F3K9Q" }]);

    const none = await call(e, `${origin("peon.biz")}/mcp`, "get_updates", { update_token: "T-ZZZZZZ" }, { token: c.token.access_token });
    expect(none.body!.result.structuredContent).toMatchObject({ updates: [], next_step: "Nothing new from peon.biz." });
  });

  test("refuses another app, a malformed reference and extra fields; needs sign-in", async () => {
    const { e, asked } = env();
    await addMember(e, PHONE_A, [{ app: "peon", state: "active" }]);
    const c = await connect(e, "peon.biz", PHONE_A);
    const url = `${origin("peon.biz")}/mcp`;
    for (const args of [{ app: "slop" }, { update_token: "123456" }, { update_token: "T-7F3K9Q", phone: PHONE_B }])
      expect((await call(e, url, "get_updates", args, { token: c.token.access_token })).body!.result.isError).toBe(true);
    expect((await call(e, url, "get_updates", {})).res.status).toBe(401);
    expect(asked).toEqual([]);
  });

  test("revoking the grant tells the inbox the assistant is gone", async () => {
    const { e, linked } = env();
    await addMember(e, PHONE_A, [{ app: "peon", state: "active" }]);
    await connect(e, "peon.biz", PHONE_A, { register: { redirect_uris: [CLAUDE_CB] }, redirectUri: CLAUDE_CB });
    expect(await e.handler.revokeAllFor(PHONE_A, "peon")).toBe(1);
    expect(linked.map(l => l.active)).toEqual([true, false]);
  });

  test("listed with only app and update_token, read-only", async () => {
    const { e } = env();
    const t = (await rpc(e, `${origin("ntwrk.love")}/mcp`, "tools/list")).body!.result.tools.find((x: any) => x.name === "get_updates");
    expect(Object.keys(t.inputSchema.properties)).toEqual(["app", "update_token"]);
    expect(t.annotations.readOnlyHint).toBe(true);
  });
});
