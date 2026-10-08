// Adversarial review (2026-10-05): one test per bypass attempt against the safety rules. Each test
// names the hole it closes. These run against the in-memory Network through a real MCP client.
import { describe, expect, test } from "bun:test";
import { DAY, MINUTE } from "@thenetwork/core";
import { normalizeResource, resolveClient } from "../src/config.ts";
import { NetworkError } from "../src/fake-network.ts";
import { ClientRegistry, looksLikeBrand } from "../src/oauth.ts";
import { findLeaks } from "../src/policy.ts";
import { PROFILES, profileViolation } from "../src/profiles.ts";
import { DEFAULT_SCOPES, SCOPES } from "../src/schemas.ts";
import { cfg, connect, key, principal, visible, world } from "./helpers.ts";

const WITH_P2 = [...DEFAULT_SCOPES, SCOPES.writeRelay, SCOPES.writeInvites, SCOPES.sensitiveSafety];
const PRIVACY_FALLBACK = "I can't share that here; text me and I'll explain.";
const plain = { venueMinAge: 0 as const, alcoholCentric: false, sponsored: false };

// ------------------------------------------------------------------------------------------------
describe("surface-profile bypasses", () => {
  test("client identity: look-alike CIMD URLs and off-path chatgpt.com documents are not ChatGPT", () => {
    for (const id of [
      "https://chatgpt.com.evil.test/oauth/client.json",
      "https://evil.test/chatgpt.com/oauth/client.json",
      "https://chatgpt.com@evil.test/oauth/client.json",
      "https://chatgpt.com/share/abc123", // user content on the host, not OpenAI's client document
      "https://chatgpt.com:8443/oauth/client.json",
      "https://chatgpt.com/oauth/client.json?x=1",
      "http://chatgpt.com/oauth/client.json",
    ]) expect(resolveClient(id)).toMatchObject({ hostKey: "unknown", trustTier: "unverified" });
    // Both forms OpenAI documents resolve to the teen-safe profile.
    for (const id of ["https://chatgpt.com/oauth/client.json", "https://chatgpt.com/oauth/cb_9f8e7d/client.json", "https://CHATGPT.com/oauth/client.json"])
      expect(resolveClient(id)).toMatchObject({ hostKey: "chatgpt", profile: "teen_safe_directory", trustTier: "verified" });
  });

  test("client identity: only Claude's /oauth/ documents are Claude, not any claude.ai path (plugin-prototypes-24)", () => {
    for (const id of ["https://claude.ai/public/artifacts/abc/client.json", "https://claude.com/u/attacker.json", "https://claude.ai/oauth/x/../../share/y.json"])
      expect(resolveClient(id)).toMatchObject({ hostKey: "unknown", trustTier: "unverified" });
    for (const id of ["https://claude.ai/oauth/mcp-client-metadata.json", "https://claude.ai/oauth/claude-code-client-metadata"])
      expect(resolveClient(id)).toMatchObject({ hostKey: "claude", trustTier: "verified" });
  });

  test("DCR: Claude's claude.ai + claude.com callbacks stay verified Claude; mixing hosts is unverified", () => {
    expect(resolveClient("dcr_x", ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]))
      .toMatchObject({ hostKey: "claude", trustTier: "verified" });
    expect(resolveClient("dcr_x", ["https://claude.ai/api/mcp/auth_callback", "https://chatgpt.com/connector_platform_oauth_redirect"]))
      .toMatchObject({ hostKey: "unknown", trustTier: "unverified" });
    expect(resolveClient("dcr_x", ["https://claude.ai/api/mcp/auth_callback", "http://localhost:3000/callback"]))
      .toMatchObject({ hostKey: "unknown", trustTier: "unverified" });
  });

  test("self-reported client names: homoglyph, fullwidth, zero-width and spaced brand names are refused for unverified DCR", () => {
    for (const name of ["ChatGРТ", "Ｃｌａｕｄｅ helper", "The​Network", "N e t w o r k Pro", "0fficial assistant", "Ch@tGPT", "Gemini Tools", "Anthropic Labs"])
      expect(looksLikeBrand(name)).toBe(true);
    expect(looksLikeBrand("Acme Notes")).toBe(false);
    const reg = new ClientRegistry();
    const r = reg.register({ redirect_uris: ["https://evil.test/cb"], client_name: "ChatGРТ Plus" });
    expect(r.status).toBe(400);
    // a verified host may use its own name
    expect(reg.register({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" }).status).toBe(201);
  });

  test("clientInfo.name never changes the profile, in either direction", async () => {
    const w = world();
    const claudeCallingItselfChatGPT = await connect(w.net, principal(w, w.ava, { client: "claude" }), { clientName: "ChatGPT" });
    const titles = (await claudeCallingItselfChatGPT.call("get_network_updates", { limit: 10 })).data.items.map((i: any) => i.title);
    expect(titles).toContain(w.trivia.title); // still Claude's general profile
    const gptCallingItselfClaude = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }), { clientName: "claude-ai" });
    const gptTitles = (await gptCallingItselfClaude.call("get_network_updates", { limit: 10 })).data.items.map((i: any) => i.title);
    expect(gptTitles).not.toContain(w.trivia.title);
  });

  test("blocked vocabulary can't be disguised by case, Unicode, spacing, leetspeak or line breaks", () => {
    const teen = PROFILES.teen_safe_directory;
    for (const s of [
      "COCKTAIL hour", "ｂａｒ crawl", "night​club tonight", "Сocktails at 8", "meet at the b.a.r", "n i g h t l i f e",
      "21+ only", "Trivia (21+)", "ages 21 and over", "18+ event", "alc0hol-free? no", "c0cktail mixer", "sp0nsored offer",
      "Meet at the\nbar", "wine­bar", "café then a pub", "over 21", "adults-only lounge", "Ｄａｔｉｎｇ",
    ]) expect(profileViolation(s, teen)).not.toBeNull();
    for (const s of ["Bouldering at the barbecue place", "Updating your profile", "Barcelona trip planning", "Robotics lab, ages 10 to 17", "Sat 1–4pm, all ages"])
      expect(profileViolation(s, teen)).toBeNull();
    // Claude's profile still blocks disguised romance
    expect(profileViolation("d a t i n g night", PROFILES.general_assistant)).not.toBeNull();
  });

  test("an item whose category is clean but whose TEXT is out of profile is hidden on ChatGPT (and the list still works)", async () => {
    const w = world();
    const smuggled = w.net.addItem(w.ava.id, {
      kind: "opportunity", title: "Thursday social", summary: "A friendly happy hour at a neighborhood brewery.",
      expiresAt: w.clock.now() + 2 * DAY, allowedResponses: ["interested", "not_for_me", "tell_me_more"],
      facts: { category: "events", connection: null, ...plain },
    });
    const fullwidth = w.net.addItem(w.ava.id, {
      kind: "opportunity", title: "Ｂａｒ trivia", summary: "Weekly quiz.", expiresAt: null, allowedResponses: ["interested"],
      facts: { category: "events", connection: null, ...plain },
    });
    const gp = principal(w, w.ava, { client: "chatgpt" });
    const gpt = await connect(w.net, gp);
    const r = await gpt.call("get_network_updates", { limit: 10 });
    expect(r.isError).toBe(false); // one mislabeled item doesn't brick the list
    expect(r.data.items.length).toBeGreaterThan(0);
    expect(visible(r)).not.toMatch(/brewery|happy hour|trivia|Thursday social/i);
    const ask = await gpt.call("ask_network_agent", { question: "anything new for me?" });
    expect(visible(ask)).not.toMatch(/Thursday social|Ｂａｒ/);
    // a handle for it (even computed for this grant) can't be answered or asked about on ChatGPT
    for (const it of [smuggled, fullwidth]) {
      const h = w.net.itemHandle(gp.grantId, it);
      expect((await gpt.call("respond_to_network_item", { item_id: h, response: "interested" })).data.status).toBe("not_available_here");
      expect((await gpt.call("ask_network_agent", { question: "tell me about it", about_item_id: h })).data.answer).toMatch(/can't find/);
    }
    expect(smuggled.status).toBe("open");
    // Claude still sees it
    const cl = await connect(w.net, principal(w, w.ava, { client: "claude" }));
    expect((await cl.call("get_network_updates", { limit: 10 })).data.items.map((i: any) => i.title)).toContain("Thursday social");
  });

  test("out-of-profile requests are caught after Unicode folding (ChatGPT)", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    for (const instruction of ["find me a ｂａｒ for friday", "any n i g h t c l u b s open late?", "I want a c0cktail spot", "set me up on a ｄａｔｅ"]) {
      const r = await call("tell_network_agent", { instruction, idempotency_key: key() });
      expect(r.data.status).toBe("not_available_here");
      expect(r.data.pending_confirmation).toBeNull();
    }
    expect(w.net.channelMessages).toHaveLength(0);
  });

  test("tool error text is guarded too: an echoed property name can't carry blocked words or contact details", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    const r1 = await call("get_network_updates", { cocktail_bar_21_plus: true } as any);
    expect(r1.isError).toBe(true);
    expect(r1.meta["network/error"].code).toBe("invalid_input");
    expect(r1.text).toBe("Invalid input for get_network_updates.");
    const r2 = await call("get_network_updates", { "call_+1 415 555 0102": true } as any);
    expect(r2.text).not.toMatch(/415/);
    const r3 = await call("get_network_updates", { verbose: true } as any); // harmless echo stays actionable
    expect(r3.text).toContain("unexpected property verbose");
  });
});

// ------------------------------------------------------------------------------------------------
describe("minors: no tool or argument connects an under-18 member to people", () => {
  test("tell: disguised and indirect people requests are not available, and nothing is drafted or proposed", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai, { client: "claude" }));
    for (const instruction of [
      "ＩＮＴＲＯＤＵＣＥ me to someone who skates", "intr0duce me to a skater", "i n t r o me to a robotics kid",
      "I want more mentors", "I'm into joining a team", "I'd like to hang out with people who code",
      "message maya that I'm in", "Let Maya know I'm free", "I'm interested in a pen pal", "find me a tutor",
    ]) {
      const r = await call("tell_network_agent", { instruction, idempotency_key: key() });
      expect(r.data.status).toBe("not_available_here");
      expect(r.data.pending_confirmation).toBeNull();
      expect(r.data.changes).toEqual([]);
    }
    expect(w.net.channelMessages).toHaveLength(0);
    expect(w.net.effects).toHaveLength(0);
  });

  test("share_profile: people-seeking interests and goals are rejected for minors; plain hobbies are accepted", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.kai));
    const r = await call("share_profile_with_network", {
      interests: ["robotics", "meeting new people", "skateboarding"], goals: ["find a mentor", "make friends at school"], member_approved: true,
    });
    expect(r.data.accepted_count).toBe(2);
    expect(r.data.rejected).toEqual([
      { field: "interests", index: 1, reason: "not_available_here" },
      { field: "goals", index: 0, reason: "not_available_here" },
      { field: "goals", index: 1, reason: "not_available_here" },
    ]);
    expect(w.net.proposals.filter((x) => x.memberId === w.kai.id).map((x) => x.value).sort()).toEqual(["robotics", "skateboarding"]);
  });

  test("a leaked or computed handle for a connection item: ask, tell and respond reveal and do nothing", async () => {
    const w = world();
    const p = principal(w, w.kai, { client: "chatgpt" });
    const { call } = await connect(w.net, p);
    for (const it of [w.kaiIntro, w.kaiGroup, w.kaiRelay, w.kaiContact]) {
      const h = w.net.itemHandle(p.grantId, it);
      const a = await call("ask_network_agent", { question: "what is this?", about_item_id: h });
      expect(visible(a)).not.toMatch(/CANARY_/);
      const t = await call("tell_network_agent", { instruction: "go ahead with this one", about_item_id: h, idempotency_key: key() });
      expect(t.data.pending_confirmation).toBeNull();
      for (const response of ["interested", "confirm", "not_for_me", "maybe_later"] as const) {
        const r = await call("respond_to_network_item", { item_id: h, response, idempotency_key: key() });
        expect(r.data?.status ?? r.meta["network/error"].code).toMatch(/not_available_here|item_not_found/);
        expect(visible(r)).not.toMatch(/CANARY_/);
      }
      expect(it.status).toBe("open");
    }
    expect(w.net.effects).toHaveLength(0);
    expect(w.net.channelMessages).toHaveLength(0);
  });

  test("the Network channel won't execute a connection for a member who isn't eligible, even with a pending row", async () => {
    const w = world();
    // An adult on a new grant says yes to an intro: tier 2, waiting on the channel.
    const p = principal(w, w.ava, { grantAgeMs: MINUTE });
    const { call } = await connect(w.net, p);
    const h = w.net.itemHandle(p.grantId, w.intro);
    const r = await call("respond_to_network_item", { item_id: h, response: "interested" });
    expect(r.data.status).toBe("confirm_in_network_app");
    // Eligibility changes before the reply (e.g. a corrected birth date).
    w.ava.age = 16;
    expect(w.net.confirmOnNetworkChannel(r.data.pending_confirmation.confirmation_id, w.ava.id)).toBe(false);
    expect(w.net.effects).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------
describe("confirmation-tier bypasses", () => {
  test("replaying an idempotency key never upgrades a tier-3 host confirm into an execution", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { scopes: WITH_P2 }));
    const cnf = (await call("tell_network_agent", { instruction: "Please invite my friend Sam" })).data.pending_confirmation.confirmation_id;
    const k = key();
    for (let i = 0; i < 3; i++) {
      const r = await call("respond_to_network_item", { item_id: cnf, response: "confirm", idempotency_key: k });
      expect(r.data.status).toBe("confirm_in_network_app");
    }
    // fresh keys don't help either
    for (let i = 0; i < 3; i++) expect((await call("respond_to_network_item", { item_id: cnf, response: "confirm", idempotency_key: key() })).data.status).toBe("confirm_in_network_app");
    expect(w.net.effects).toHaveLength(0);
    expect(w.net.channelMessages.filter((m) => m.confirmationId === cnf)).toHaveLength(1);
    expect(w.net.confirmOnNetworkChannel(cnf, w.ava.id)).toBe(true);
    expect((await call("respond_to_network_item", { item_id: cnf, response: "confirm", idempotency_key: k })).data.status).toBe("confirm_in_network_app"); // stale replay, no second run
    expect(w.net.effects).toHaveLength(1);
  });

  test("the same idempotency key on another grant is a different action: no replay of the first grant's result", async () => {
    const w = world();
    const a = await connect(w.net, principal(w, w.ava, { client: "claude" }));
    const b = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    const k = key();
    const ra = await a.call("tell_network_agent", { instruction: "I need help with my resume", idempotency_key: k });
    const rb = await b.call("tell_network_agent", { instruction: "pause for a week", idempotency_key: k });
    expect(rb.isError).toBe(false);
    expect(rb.meta["network/receipt"].replayed).toBe(false);
    expect(rb.data.pending_confirmation.confirmation_id).not.toBe(ra.data.pending_confirmation.confirmation_id);
  });

  test("the server fallback key doesn't hand back a finished confirmation (pause → resume → pause)", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava));
    const first = (await call("tell_network_agent", { instruction: "pause for a while" })).data.pending_confirmation;
    expect((await call("respond_to_network_item", { item_id: first.confirmation_id, response: "confirm" })).data.status).toBe("done");
    const resume = (await call("tell_network_agent", { instruction: "resume" })).data.pending_confirmation;
    await call("respond_to_network_item", { item_id: resume.confirmation_id, response: "confirm" });
    expect(w.ava.state).toBe("normal");
    const again = await call("tell_network_agent", { instruction: "pause for a while" });
    expect(again.meta["network/receipt"].replayed).toBe(false);
    expect(again.data.pending_confirmation.confirmation_id).not.toBe(first.confirmation_id);
    expect((await call("respond_to_network_item", { item_id: again.data.pending_confirmation.confirmation_id, response: "confirm" })).data.status).toBe("done");
    expect(w.ava.state).toBe("quiet");
  });

  test("item handles are bound to their grant: another grant's handle is unknown on ask, tell and respond", async () => {
    const w = world();
    const claude = principal(w, w.ava, { client: "claude" });
    const gpt = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    const foreign = w.net.itemHandle(claude.grantId, w.question);
    const r = await gpt.call("respond_to_network_item", { item_id: foreign, response: "not_for_me" });
    expect(r.meta["network/error"].code).toBe("item_not_found");
    expect((await gpt.call("ask_network_agent", { question: "what's this?", about_item_id: foreign })).data.answer).toMatch(/can't find/);
    expect(w.question.status).toBe("open");
  });

  test("re-asking for the same tier-2 action reuses one pending confirmation (no stacked 'Reply YES' texts)", async () => {
    const w = world();
    const p = principal(w, w.ava, { grantAgeMs: MINUTE });
    const { call } = await connect(w.net, p);
    const h = w.net.itemHandle(p.grantId, w.intro);
    const ids = new Set<string>();
    for (let i = 0; i < 4; i++) ids.add((await call("respond_to_network_item", { item_id: h, response: "interested", idempotency_key: key() })).data.pending_confirmation.confirmation_id);
    expect(ids.size).toBe(1);
    expect(w.net.channelMessages).toHaveLength(1);
    const [id] = [...ids];
    expect((await call("respond_to_network_item", { item_id: id!, response: "confirm" })).data.status).toBe("confirm_in_network_app"); // host can't confirm tier 2
    expect(w.net.effects).toHaveLength(0);
    expect(w.net.confirmOnNetworkChannel(id!, w.ava.id)).toBe(true);
    expect(w.net.effects).toHaveLength(1);
  });

  test("a channel YES for an item that was answered elsewhere in the meantime does nothing", async () => {
    const w = world();
    const fresh = principal(w, w.ava, { client: "chatgpt", grantAgeMs: MINUTE });
    const gpt = await connect(w.net, fresh);
    const pending = (await gpt.call("respond_to_network_item", { item_id: w.net.itemHandle(fresh.grantId, w.intro), response: "interested" })).data.pending_confirmation;
    const claude = principal(w, w.ava, { client: "claude" });
    const cl = await connect(w.net, claude);
    expect((await cl.call("respond_to_network_item", { item_id: w.net.itemHandle(claude.grantId, w.intro), response: "not_for_me" })).data.status).toBe("done");
    expect(w.net.confirmOnNetworkChannel(pending.confirmation_id, w.ava.id)).toBe(false);
    expect(w.net.effects.map((e) => e.payload.response)).toEqual(["not_for_me"]);
  });

  test("saying yes to a relayed-message item is tier 3, like a contact swap", async () => {
    const w = world();
    const relay = w.net.addItem(w.ava.id, {
      kind: "notice", title: "A note from your climbing partner", summary: "Your climbing partner sent you a short note about Thursday.",
      expiresAt: w.clock.now() + DAY, allowedResponses: ["interested", "not_for_me", "tell_me_more"],
      facts: { category: "activity_partners", connection: "relay", ...plain },
    });
    const p = principal(w, w.ava);
    const { call } = await connect(w.net, p);
    const r = await call("respond_to_network_item", { item_id: w.net.itemHandle(p.grantId, relay), response: "interested" });
    expect(r.data.status).toBe("confirm_in_network_app");
    expect(w.net.effects).toHaveLength(0);
  });

  test("a tier-3 relay shows the member the exact message in the Network's channel", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { scopes: WITH_P2 }));
    const r = await call("tell_network_agent", { instruction: "message Maya that Thursday at 6 works and to bring chalk" });
    expect(r.data.pending_confirmation.summary).toContain("Thursday at 6 works and to bring chalk");
    expect(w.net.channelMessages.at(-1)!.text).toContain("Thursday at 6 works and to bring chalk");
  });

  test("contact details can't ride along in tell instructions or respond notes", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { scopes: WITH_P2 }));
    for (const instruction of ["message Maya my number is (415) 555-0199", "I need help, email me at ava.r [at] example [dot] test"]) {
      const r = await call("tell_network_agent", { instruction, idempotency_key: key() });
      expect(r.data.status).toBe("not_available_here");
      expect(r.data.pending_confirmation).toBeNull();
    }
    const items = (await call("get_network_updates", {})).data.items;
    const n = await call("respond_to_network_item", { item_id: items[0].item_id, response: "interested", note: "text me at 415.555.0199" });
    expect(n.meta["network/error"].code).toBe("invalid_input");
    expect(w.net.effects).toHaveLength(0);
    expect(w.net.channelMessages).toHaveLength(0);
  });
});

// ------------------------------------------------------------------------------------------------
describe("leak-guard gaps", () => {
  const leakyAnswer = async (answer: string, opts: { client?: "claude" | "chatgpt"; question?: string } = {}) => {
    const w = world();
    const original = w.net.ask.bind(w.net);
    w.net.ask = (p, input) => ({ result: { ...original(p, input).result, answer } });
    const { call } = await connect(w.net, principal(w, w.ava, { client: opts.client ?? "claude" }));
    return { w, r: await call("ask_network_agent", { question: opts.question ?? "hi" }) };
  };

  test("phone and email formats the old patterns missed", async () => {
    for (const answer of [
      "Maya's number is (415) 555-0102", "call +1 415 555 0102", "415‑555‑0102", "４１５５５５０１０２",
      "maya [at] example [dot] test", "maya at example dot test", "MAYA@EXAMPLE.TEST", "maya@exam​ple.test",
    ]) {
      const { r } = await leakyAnswer(`Sure: ${answer}`);
      expect(r.isError).toBe(true);
      expect(r.text).toBe(PRIVACY_FALLBACK);
    }
  });

  test("forbidden strings match regardless of case, Unicode form, punctuation or JSON-escaped characters", async () => {
    const w0 = world();
    // Maya is the other person in Ava's intro, so her private facets are guarded for Ava.
    const mayaPrivate = w0.maya.facets.find((f) => f.scope === "agent_private")!.value;
    for (const v of [mayaPrivate.toUpperCase(), mayaPrivate.replace(/_/g, " "), mayaPrivate.replace("search", "ｓｅａｒｃｈ")]) {
      const { r } = await leakyAnswer(`FYI ${v}`);
      expect(r.text).toBe(PRIVACY_FALLBACK);
    }
    // a facet with quotes and a newline (JSON would escape both and the old check missed it)
    const w = world();
    w.maya.facets.push({ value: 'Told me "I\'m leaving"\nnext month', scope: "agent_private" });
    const original = w.net.ask.bind(w.net);
    w.net.ask = (p, input) => ({ result: { ...original(p, input).result, answer: 'Maya: Told me "I\'m leaving"\nnext month' } });
    const { call } = await connect(w.net, principal(w, w.ava));
    expect((await call("ask_network_agent", { question: "hi" })).text).toBe(PRIVACY_FALLBACK);
  });

  test("no oracle: the guard's verdict does not depend on whether the caller guessed a private fact (plugin-prototypes-21)", async () => {
    const w0 = world();
    const fact = w0.maya.facets.find((f) => f.scope === "matchable")!.value;
    // The Network echoes the member's own words: a real fact and a wrong guess get the same answer.
    const tellEcho = async (probe: string) => {
      const w = world();
      const { call } = await connect(w.net, principal(w, w.ava));
      const r = await call("tell_network_agent", { instruction: `I'm looking for someone whose ${probe}`, idempotency_key: key() });
      return { isError: r.isError, status: r.data?.status };
    };
    expect(await tellEcho(fact)).toEqual(await tellEcho("CANARY_MAYA_MATCHABLE_recently married"));
    expect(await tellEcho("job search is secret")).toEqual(await tellEcho("job search is public"));
    expect((await tellEcho("job search is secret")).isError).toBe(false);
    // A leak the Network adds itself (words the caller did not send) is still blocked.
    expect((await leakyAnswer(`FYI ${fact}.`, { question: "anything about Maya?" })).r.text).toBe(PRIVACY_FALLBACK);
    expect((await leakyAnswer(`Yes: divorced, recently.`, { question: `Is it true that ${fact}?` })).r.text).toBe(PRIVACY_FALLBACK);
    // the member's OWN private note may be echoed when the member supplied it (§8.2 step 3)
    const own = w0.ava.facets.find((f) => f.scope === "agent_private")!.value;
    const mine = await leakyAnswer(`Noted: ${own}`, { question: `remember ${own}` });
    expect(mine.r.isError).toBe(false);
    // ...but not when they didn't
    expect((await leakyAnswer(`Noted: ${own}`)).r.text).toBe(PRIVACY_FALLBACK);
  });

  test("a member who is not my counterpart cannot break my connector with a private facet (plugin-prototypes-21)", async () => {
    const w = world();
    w.theo.facets.push({ value: "Thursday evenings", scope: "agent_private" }, { value: "the network", scope: "agent_private" });
    const { call } = await connect(w.net, principal(w, w.ava));
    expect((await call("get_network_updates", {})).isError).toBe(false);
    expect((await call("ask_network_agent", { question: "anything new?" })).isError).toBe(false);
  });

  test("internal ids in any case, and ISO timestamps, are blocked", async () => {
    for (const answer of ["ref OPP_00001", "see Mem_maya_91c2", "at 2026-10-05t16:00"]) expect((await leakyAnswer(answer)).r.text).toBe(PRIVACY_FALLBACK);
  });

  test("a Network error message that leaks is replaced before it reaches the host", async () => {
    const w = world();
    w.net.ask = () => { throw new NetworkError("item_not_found", `Not found; try Maya at ${w.maya.email}`); };
    const { call } = await connect(w.net, principal(w, w.ava));
    const r = await call("ask_network_agent", { question: "hi" });
    expect(r.isError).toBe(true);
    expect(r.text).toBe(PRIVACY_FALLBACK);
    expect(JSON.stringify(r.raw)).not.toContain(w.maya.email);
    expect(w.net.audit.some((e) => e.summary.startsWith("leak_block_error"))).toBe(true);
  });

  test("the output classifier sees raw strings: a newline before a blocked word no longer hides it (ChatGPT)", async () => {
    for (const answer of ["Meet at the\nbar on Friday", "Plan:\t21+ trivia", 'He said "cocktails" are on'])  {
      const { r } = await leakyAnswer(answer, { client: "chatgpt" });
      expect(r.isError).toBe(true);
      expect(r.meta["network/error"].code).toBe("not_available_on_this_assistant");
    }
  });

  test("findLeaks unit cases", () => {
    expect(findLeaks("nothing to see", [])).toEqual([]);
    expect(findLeaks("Sat 1–4pm, expires in 2 days, itm_AbCdEf1234", [])).toEqual([]);
    expect(findLeaks("x", ["", "y"])).toEqual([]);
  });
});

// ------------------------------------------------------------------------------------------------
describe("RFC 8707 resource matching", () => {
  test("canonical resource accepts trailing slash and uppercase scheme/host only", () => {
    for (const ok of ["https://mcp.ntwrk.love/mcp", "https://mcp.ntwrk.love/mcp/", "HTTPS://MCP.NTWRK.LOVE/mcp"]) expect(normalizeResource(ok, cfg)).toBe(cfg.resource);
    for (const bad of [
      "https://mcp.ntwrk.love", "https://mcp.ntwrk.love/", "https://mcp.ntwrk.love/MCP", "https://mcp.ntwrk.love/mcp?x=1",
      "https://mcp.ntwrk.love/mcp#f", "https://mcp.ntwrk.love:444/mcp", "http://mcp.ntwrk.love/mcp", "https://evil@mcp.ntwrk.love/mcp",
      "https://mcp.ntwrk.love.evil.test/mcp", "mcp.ntwrk.love/mcp", "",
    ]) expect(normalizeResource(bad, cfg)).toBeNull();
  });
});
