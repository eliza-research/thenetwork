import { describe, expect, test } from "bun:test";
import { validate } from "../src/json-schema.ts";
import { renderTools, TOOL_DEFINITIONS, TOOL_NAMES, TOOL_SCOPES, toolDefinition, WRITE_TOOLS } from "../src/schemas.ts";
import { ITEM_CARD_URI, WIDGET_MIME } from "../src/widget.ts";
import { connect, designJsonBlocks, key, principal, visible, world, type ClientName } from "./helpers.ts";

const designTools = () => {
  const blocks = designJsonBlocks().filter((b) => typeof b.name === "string");
  const tell = blocks.find((b) => b.name === "tell_network_agent");
  for (const b of blocks) {
    // The design abbreviates respond's $defs as "same as tell_network_agent".
    if (b.outputSchema?.$defs?.PendingConfirmation === "same as tell_network_agent") b.outputSchema.$defs = tell.outputSchema.$defs;
  }
  return Object.fromEntries(blocks.map((b) => [b.name, b]));
};

describe("tool contracts match the approved design exactly", () => {
  test("the design doc defines exactly the five approved tools", () => {
    expect(Object.keys(designTools()).sort()).toEqual(Object.values(TOOL_NAMES).sort());
    expect(TOOL_DEFINITIONS).toHaveLength(5);
  });

  for (const name of Object.values(TOOL_NAMES)) {
    test(`${name}: name, title, description, inputSchema, outputSchema, annotations and _meta equal §5`, () => {
      const doc = designTools()[name];
      const ours = toolDefinition(name);
      expect(ours.title).toBe(doc.title);
      expect(ours.description).toBe(doc.description);
      expect(ours.inputSchema).toEqual(doc.inputSchema);
      expect(ours.outputSchema).toEqual(doc.outputSchema);
      expect(ours.annotations).toEqual(doc.annotations);
      expect(ours._meta).toEqual(doc._meta);
    });
  }

  for (const client of ["chatgpt", "claude"] as ClientName[]) {
    test(`tools/list served to ${client} is the design text verbatim`, async () => {
      const w = world();
      const { tools } = await connect(w.net, principal(w, w.ava, { client }));
      const doc = designTools();
      expect(tools.map((t) => t.name)).toEqual(Object.values(TOOL_NAMES));
      for (const t of tools) {
        expect(t.inputSchema).toEqual(doc[t.name].inputSchema);
        expect(t.outputSchema).toEqual(doc[t.name].outputSchema);
        expect(t.annotations).toEqual(doc[t.name].annotations);
        expect(t.description).toBe(doc[t.name].description);
      }
    });
  }
});

describe("annotations, names and scopes", () => {
  test("host-safe names; every hint is an explicit boolean; title on tool and annotations", () => {
    for (const t of TOOL_DEFINITIONS) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.annotations.title).toBe(t.title);
      for (const h of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) expect(typeof t.annotations[h]).toBe("boolean");
      expect(t._meta.securitySchemes).toEqual([{ type: "oauth2", scopes: [TOOL_SCOPES[t.name]] }]);
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.outputSchema.additionalProperties).toBe(false);
    }
  });

  test("read tools are read-only; respond is the only destructive tool; nothing is open-world", () => {
    const a = Object.fromEntries(TOOL_DEFINITIONS.map((t) => [t.name, t.annotations]));
    expect(a.ask_network_agent).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(a.get_network_updates).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(a.tell_network_agent).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(a.share_profile_with_network).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(a.respond_to_network_item).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
    expect(TOOL_DEFINITIONS.filter((t) => t.annotations.destructiveHint).map((t) => t.name)).toEqual(["respond_to_network_item"]);
    expect([...WRITE_TOOLS].sort()).toEqual(["respond_to_network_item", "share_profile_with_network", "tell_network_agent"]);
  });

  test("respond_to_network_item is the only accept/decline path", () => {
    for (const t of TOOL_DEFINITIONS) {
      const props = Object.keys((t.inputSchema as any).properties);
      if (t.name === TOOL_NAMES.respond) expect((t.inputSchema as any).properties.response.enum).toEqual(["interested", "not_for_me", "maybe_later", "tell_me_more", "confirm", "cancel"]);
      else expect(props).not.toContain("response");
    }
  });

  test("share_profile_with_network has only narrow typed fields: no history, summary, catch-all or romance", () => {
    const s = toolDefinition(TOOL_NAMES.share).inputSchema as any;
    expect(Object.keys(s.properties).sort()).toEqual(
      ["availability_note", "goals", "home_area", "idempotency_key", "interests", "languages", "looking_for", "member_approved", "skills_offered"]);
    expect(s.additionalProperties).toBe(false);
    for (const banned of ["summary", "history", "chat_history", "conversation", "notes", "facts", "text", "context", "romance", "dating"]) expect(s.properties[banned]).toBeUndefined();
    for (const profile of ["teen_safe_directory", "general_assistant", "enterprise_professional"] as const) {
      const lf = (renderTools(profile).find((t) => t.name === TOOL_NAMES.share)!.inputSchema as any).properties.looking_for.items.enum as string[];
      expect(lf.join(" ")).not.toMatch(/romance|dating|date|partner_romantic|relationship/);
    }
    expect(s.properties.member_approved).toMatchObject({ const: true });
    expect(s.minProperties).toBe(2);
  });

  test("enterprise profile narrows looking_for to work-context values", () => {
    const lf = (renderTools("enterprise_professional").find((t) => t.name === TOOL_NAMES.share)!.inputSchema as any).properties.looking_for.items.enum;
    expect(lf).toEqual(["professional_connections", "mentoring_others", "being_mentored", "local_help", "collaborators"]);
  });
});

describe("input validation happens before the Network is touched", () => {
  test("invalid inputs are tool errors with code invalid_input and no audit/effects", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const bad: [string, Record<string, unknown>][] = [
      ["ask_network_agent", {}],
      ["ask_network_agent", { question: "" }],
      ["ask_network_agent", { question: "hi", about_item_id: "opp_00001" }],
      ["ask_network_agent", { question: "hi", member_id: w.maya.id }],
      ["tell_network_agent", { instruction: "x".repeat(2001) }],
      ["tell_network_agent", { instruction: "hi", idempotency_key: "short" }],
      ["share_profile_with_network", { member_approved: true }], // minProperties 2
      ["share_profile_with_network", { interests: ["jazz"], member_approved: false }],
      ["share_profile_with_network", { interests: ["jazz"] }],
      ["share_profile_with_network", { chat_history: "everything we discussed", member_approved: true }],
      ["share_profile_with_network", { summary: "Ava is lonely", member_approved: true }],
      ["share_profile_with_network", { looking_for: ["dating"], member_approved: true }],
      ["share_profile_with_network", { looking_for: ["new_friends", "new_friends"], member_approved: true }],
      ["share_profile_with_network", { home_area: { city: "SF", street: "1 Main St" }, member_approved: true }],
      ["get_network_updates", { limit: 11 }],
      ["get_network_updates", { kinds: ["romance"] }],
      ["respond_to_network_item", { item_id: w.intro.internalId, response: "interested" }],
      ["respond_to_network_item", { item_id: "itm_abcdef", response: "accept" }],
      ["respond_to_network_item", { item_id: "itm_abcdef" }],
    ];
    for (const [name, args] of bad) {
      const r = await call(name, args);
      expect(r.isError).toBe(true);
      expect(r.meta["network/error"].code).toBe("invalid_input");
    }
    expect(w.net.audit).toHaveLength(0);
    expect(w.net.effects).toHaveLength(0);
  });

  test("the Worker-safe validator agrees with the design schemas on sample outputs", () => {
    const tell = toolDefinition(TOOL_NAMES.tell).outputSchema;
    expect(validate(tell, { reply: "ok", status: "done", changes: [], pending_confirmation: null }).valid).toBe(true);
    expect(validate(tell, { reply: "ok", status: "done", changes: [], pending_confirmation: { confirmation_id: "cnf_abc123", summary: "x", how_to_confirm: "ask_member_then_respond" } }).valid).toBe(true);
    expect(validate(tell, { reply: "ok", status: "done", changes: [], pending_confirmation: { confirmation_id: "act_1", summary: "x", how_to_confirm: "ask_member_then_respond" } }).valid).toBe(false);
    expect(validate(tell, { reply: "ok", status: "sent", changes: [], pending_confirmation: null }).valid).toBe(false);
    const upd = toolDefinition(TOOL_NAMES.updates).outputSchema;
    expect(validate(upd, { items: [], next_cursor: null, participation_state: "open" }).valid).toBe(true);
    expect(validate(upd, { items: [], next_cursor: 3, participation_state: "open" }).valid).toBe(false);
  });
});

describe("results: structuredContent + text + _meta (§5.1)", () => {
  test("internal ids and timestamps live only in _meta; writes carry a receipt", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const results = {
      ask: await call("ask_network_agent", { question: "anything new for me?" }),
      updates: await call("get_network_updates", {}),
      tell: await call("tell_network_agent", { instruction: "I need help with my resume", idempotency_key: key() }),
      share: await call("share_profile_with_network", { interests: ["bouldering"], member_approved: true }),
      respond: await call("respond_to_network_item", { item_id: (await call("get_network_updates", {})).data.items[0].item_id, response: "tell_me_more" }),
    };
    for (const [k, r] of Object.entries(results)) {
      expect(r.isError).toBe(false);
      expect(r.text.length).toBeGreaterThan(0); // hosts that ignore structuredContent still work
      const v = visible(r);
      expect(v).not.toMatch(/\b(mem|opp|act|rcp|grt|prp)_[A-Za-z0-9]+/);
      expect(v).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      if (k === "tell" || k === "share" || k === "respond") {
        expect(r.meta["network/receipt"]).toMatchObject({ receipt_id: expect.stringMatching(/^rcp_/), action_id: expect.stringMatching(/^act_/), at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), replayed: false });
        expect(Object.keys(r.meta["network/receipt"]).sort()).toEqual(["action_id", "at", "receipt_id", "replayed"]);
      } else {
        expect(r.meta?.["network/receipt"]).toBeUndefined();
      }
    }
    for (const i of results.updates.data.items) expect(i.item_id).toMatch(/^itm_[A-Za-z0-9]{6,12}$/);
    expect(results.tell.data.pending_confirmation.confirmation_id).toMatch(/^cnf_[A-Za-z0-9]{6,12}$/);
  });

  test("get_network_updates defaults to 5 items, pages by opaque cursor and filters kinds", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const all = (await call("get_network_updates", {})).data;
    expect(all.items.length).toBeLessThanOrEqual(5);
    const p1 = (await call("get_network_updates", { limit: 1 })).data;
    expect(p1.items).toHaveLength(1);
    const p2 = (await call("get_network_updates", { limit: 1, cursor: p1.next_cursor })).data;
    expect(p2.items[0].item_id).not.toBe(p1.items[0].item_id);
    const q = (await call("get_network_updates", { kinds: ["question"] })).data.items;
    expect(q.length).toBeGreaterThan(0);
    expect(q.every((i: any) => i.kind === "question")).toBe(true);
    expect(all.participation_state).toBe("normal");
  });

  test("item handles are per grant: the same item has different ids on two hosts", async () => {
    const w = world();
    const a = await connect(w.net, principal(w, w.ava, { client: "claude" }));
    const b = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    const ida = (await a.call("get_network_updates", {})).data.items.find((i: any) => i.title === w.intro.title).item_id;
    const idb = (await b.call("get_network_updates", {})).data.items.find((i: any) => i.title === w.intro.title).item_id;
    expect(ida).not.toBe(idb);
    const cross = await b.call("respond_to_network_item", { item_id: ida, response: "interested" });
    expect(cross.isError).toBe(true);
    expect(cross.meta["network/error"].code).toBe("item_not_found");
    expect(w.intro.status).toBe("open");
  });
});

describe("prompts and the MCP Apps card", () => {
  test("two user-invoked prompts; no graph or directory resources", async () => {
    const w = world();
    const { client } = await connect(w.net, principal(w, w.ava));
    expect((await client.listPrompts()).prompts.map((p) => p.name)).toEqual(["network_checkin", "network_help_request"]);
    const help = await client.getPrompt({ name: "network_help_request", arguments: { need: "a plumber" } });
    expect(JSON.stringify(help)).toContain("a plumber");
    expect((await client.listResources()).resources.map((r) => r.uri)).toEqual([ITEM_CARD_URI]);
  });

  test("the item card is linked only for clients that declare the UI extension", async () => {
    const w = world();
    const plain = await connect(w.net, principal(w, w.ava));
    expect((plain.tools.find((t) => t.name === "get_network_updates")!._meta as any).ui).toBeUndefined();
    const ui = await connect(w.net, principal(w, w.ava), { ui: true });
    const meta = ui.tools.find((t) => t.name === "get_network_updates")!._meta as any;
    expect(meta.ui.resourceUri).toBe(ITEM_CARD_URI);
    const res = await ui.client.readResource({ uri: ITEM_CARD_URI });
    expect(res.contents[0]!.mimeType).toBe(WIDGET_MIME);
    const html = String((res.contents[0] as any).text);
    expect(html).toContain("respond_to_network_item");
    expect(html).not.toContain("innerHTML");
  });
});
