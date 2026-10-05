import { describe, expect, test } from "bun:test";
import { jsonSchemas, TOOL_NAMES } from "../src/schemas.ts";
import { UPDATES_WIDGET_URI, WIDGET_MIME } from "../src/widget.ts";
import { connect, rid, world } from "./helpers.ts";

describe("tool schemas", () => {
  test("exactly four tools, host-safe names, titles and explicit annotations", async () => {
    const w = world();
    const { client } = await connect(w.net, w.ava.id);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(Object.values(TOOL_NAMES).sort());
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/); // OpenAI + Anthropic function-name rules
      expect(t.title).toMatch(/^network\./);
      expect(t.description!.length).toBeGreaterThan(40);
      expect(typeof t.annotations?.readOnlyHint).toBe("boolean");
      expect(typeof t.annotations?.destructiveHint).toBe("boolean");
      expect(typeof t.annotations?.openWorldHint).toBe("boolean");
      expect(t.outputSchema).toBeDefined();
      expect((t.inputSchema as any).additionalProperties).toBe(false);
      expect((t._meta as any)?.securitySchemes?.[0]?.type).toBe("oauth2");
    }
    const by = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(by.network_get_updates!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(by.network_respond!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, openWorldHint: true });
    expect(by.network_talk!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
  });

  test("published JSON Schemas carry the exact required fields", () => {
    const s = jsonSchemas();
    expect((s.network_talk.input as any).required.sort()).toEqual(["client_request_id", "message"]);
    expect((s.network_share_context.input as any).required.sort()).toEqual(["client_request_id", "facts", "member_reviewed"]);
    expect((s.network_get_updates.input as any).required ?? []).toEqual([]);
    expect((s.network_respond.input as any).required.sort()).toEqual(["client_request_id", "decision", "item_id"]);
    expect((s.network_respond.input as any).properties.decision.enum).toEqual(["accept", "decline", "tell_me_more", "confirm", "cancel"]);
    expect((s.network_talk.output as any).required).toContain("pending_confirmation");
    expect((s.network_get_updates.output as any).properties.items.items.required).toContain("item_id");
  });

  test("invalid inputs are rejected before reaching the Network", async () => {
    const w = world();
    const { call } = await connect(w.net, w.ava.id);
    const bad = [
      ["network_talk", { message: "hi" }], // no idempotency key
      ["network_talk", { message: "hi", client_request_id: rid(), member_id: w.maya.id }], // cannot pick a member
      ["network_share_context", { facts: [{ kind: "interest", text: "jazz", source: "host_memory" }], member_reviewed: false, client_request_id: rid() }],
      ["network_get_updates", { limit: 500 }],
      ["network_respond", { item_id: w.intro.item_id, decision: "approve_all", client_request_id: rid() }],
    ] as const;
    for (const [name, args] of bad) {
      const r = await call(name, args as any).catch((e) => ({ isError: true, text: String(e) }));
      expect(r.isError).toBe(true);
    }
    expect(w.net.audit.length).toBe(0);
  });

  test("get_updates links an MCP Apps widget that the host can read", async () => {
    const w = world();
    const { client } = await connect(w.net, w.ava.id);
    const { tools } = await client.listTools();
    const meta = tools.find((t) => t.name === "network_get_updates")!._meta as any;
    expect(meta.ui.resourceUri).toBe(UPDATES_WIDGET_URI);
    expect(meta["openai/outputTemplate"]).toBe(UPDATES_WIDGET_URI);
    const res = await client.readResource({ uri: UPDATES_WIDGET_URI });
    expect(res.contents[0]!.mimeType).toBe(WIDGET_MIME);
    expect(String((res.contents[0] as any).text)).toContain("network_respond");
    expect(String((res.contents[0] as any).text)).not.toContain("innerHTML");
  });
});
