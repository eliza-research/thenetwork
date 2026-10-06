import { describe, expect, test } from "bun:test";
import { resolveClient } from "../src/config.ts";
import { PROFILES, profileViolation, visibility } from "../src/profiles.ts";
import { CLIENTS, connect, key, principal, visible, world, type CallResult } from "./helpers.ts";

const TEEN_UNSAFE = /\b(romance|romantic|dating|bars?|nightlife|cocktail|21\+|sponsored|CANARY_ROMANCE|CANARY_SPONSORED)\b/i;

async function everyToolOutput(call: (n: string, a: Record<string, unknown>) => Promise<CallResult>) {
  const outs: CallResult[] = [];
  const updates = await call("get_network_updates", { limit: 10 });
  outs.push(updates);
  for (const q of ["anything new for me?", "any good bars or nightlife this week?", "find me a date", "what do you know about me", "is there trivia at a cocktail bar?", "any sponsored deals?"])
    outs.push(await call("ask_network_agent", { question: q }));
  for (const t of ["find me a date for Friday", "find me a bar for drinks tonight", "I'm looking for nightlife buddies", "I need help moving a couch on Saturday"])
    outs.push(await call("tell_network_agent", { instruction: t, idempotency_key: key() }));
  for (const i of updates.data.items) {
    outs.push(await call("respond_to_network_item", { item_id: i.item_id, response: "tell_me_more" }));
    outs.push(await call("ask_network_agent", { question: "why did you suggest this?", about_item_id: i.item_id }));
  }
  return outs;
}

describe("surface profiles are selected from the authenticated client", () => {
  test("ChatGPT → teen_safe_directory, Claude → general_assistant, Gemini Enterprise → enterprise_professional", () => {
    expect(resolveClient(CLIENTS.chatgpt)).toMatchObject({ hostKey: "chatgpt", profile: "teen_safe_directory", trustTier: "verified", scopeChallenge: "tool_meta" });
    expect(resolveClient("https://chatgpt.com/oauth/abc123/client.json").profile).toBe("teen_safe_directory");
    expect(resolveClient(CLIENTS.claude)).toMatchObject({ hostKey: "claude", profile: "general_assistant", trustTier: "verified", scopeChallenge: "http" });
    expect(resolveClient(CLIENTS.gemini_enterprise).profile).toBe("enterprise_professional");
  });

  test("DCR clients resolve by exact registered redirect host; unknown hosts are unverified general_assistant", () => {
    expect(resolveClient("dcr_1", ["https://chatgpt.com/connector_platform_oauth_redirect"]).profile).toBe("teen_safe_directory");
    expect(resolveClient("dcr_2", ["https://claude.ai/api/mcp/auth_callback"]).profile).toBe("general_assistant");
    expect(resolveClient("dcr_3", ["https://evil.test/chatgpt.com/connector_platform_oauth_redirect"])).toMatchObject({ trustTier: "unverified", hostKey: "unknown" });
    expect(resolveClient("dcr_4", ["https://chatgpt.com/connector_platform_oauth_redirect", "https://claude.ai/api/mcp/auth_callback"]).trustTier).toBe("unverified");
    expect(resolveClient("https://chatgpt.com.evil.test/client.json").trustTier).toBe("unverified");
    expect(resolveClient(CLIENTS.unknown)).toMatchObject({ profile: "general_assistant", trustTier: "unverified" });
  });

  test("the MCP clientInfo name never changes the profile", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }), { clientName: "claude-ai" });
    const titles = (await call("get_network_updates", { limit: 10 })).data.items.map((i: any) => i.title);
    expect(titles).not.toContain(w.trivia.title);
  });
});

describe("ChatGPT (teen_safe_directory) never sees romance, nightlife, bars or sponsored items", () => {
  test("updates exclude romance, 21+/alcohol venues and sponsored items; Claude still sees the 21+ event", async () => {
    const w = world();
    const gpt = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    const cl = await connect(w.net, principal(w, w.ava, { client: "claude" }));
    const gptTitles = (await gpt.call("get_network_updates", { limit: 10 })).data.items.map((i: any) => i.title);
    const clTitles = (await cl.call("get_network_updates", { limit: 10 })).data.items.map((i: any) => i.title);
    expect(gptTitles.sort()).toEqual([w.intro.title, w.question.title, w.contactSwap.title].sort());
    expect(clTitles).toContain(w.trivia.title);
    for (const hidden of [w.romance.title, w.sponsored.title]) {
      expect(gptTitles).not.toContain(hidden);
      expect(clTitles).not.toContain(hidden); // romance and sponsored are off every connector surface
    }
  });

  test("no tool output on ChatGPT contains romance/nightlife/sponsored vocabulary", async () => {
    const w = world();
    const { call } = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    const outs = await everyToolOutput(call);
    expect(outs.length).toBeGreaterThan(10);
    for (const o of outs) expect(visible(o)).not.toMatch(TEEN_UNSAFE);
  });

  test("dating and nightlife requests are politely not available on ChatGPT; dating is unavailable on every connector", async () => {
    const w = world();
    const gpt = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    const cl = await connect(w.net, principal(w, w.ava, { client: "claude" }));
    const bar = await gpt.call("tell_network_agent", { instruction: "find me a bar for drinks tonight" });
    expect(bar.data).toMatchObject({ status: "not_available_here", changes: [], pending_confirmation: null });
    expect(bar.data.reply).toBe("That's something I can only help with by text.");
    const clBar = await cl.call("tell_network_agent", { instruction: "find me a bar for drinks tonight" });
    expect(clBar.data.status).not.toBe("not_available_here");
    for (const c of [gpt, cl]) {
      const d = await c.call("tell_network_agent", { instruction: "find me a date for Friday" });
      expect(d.data.status).toBe("not_available_here");
    }
    expect(w.net.effects).toHaveLength(0);
  });

  test("answering a profile-excluded item by handle is politely refused and changes nothing", async () => {
    const w = world();
    const p = principal(w, w.ava, { client: "chatgpt" });
    const { call } = await connect(w.net, p);
    for (const it of [w.trivia, w.romance, w.sponsored]) {
      const r = await call("respond_to_network_item", { item_id: w.net.itemHandle(p.grantId, it), response: "interested" });
      expect(r.data).toMatchObject({ status: "not_available_here", message: "That isn't available." });
      expect(visible(r)).not.toMatch(TEEN_UNSAFE);
      expect(it.status).toBe("open");
    }
    expect(w.net.effects).toHaveLength(0);
  });

  test("the profile classifier blocks out-of-profile text even if the Network has a bug", async () => {
    const w = world();
    const original = w.net.ask.bind(w.net);
    w.net.ask = (p, input) => ({ result: { ...original(p, input).result, answer: "There's a great cocktail bar for a date night nearby." } });
    const gpt = await connect(w.net, principal(w, w.ava, { client: "chatgpt" }));
    const r = await gpt.call("ask_network_agent", { question: "ideas for friday?" });
    expect(r.isError).toBe(true);
    expect(r.meta["network/error"].code).toBe("not_available_on_this_assistant");
    expect(r.text).not.toMatch(TEEN_UNSAFE);
    expect(w.net.audit.some((e) => e.summary === "profile_block:teen_safe_directory")).toBe(true);
    // general_assistant allows bars but still blocks romance
    const cl = await connect(w.net, principal(w, w.ava, { client: "claude" }));
    expect((await cl.call("ask_network_agent", { question: "ideas for friday?" })).isError).toBe(true);
  });
});

describe("profile and eligibility rules", () => {
  test("visibility() table", () => {
    const base = { category: "events" as const, venueMinAge: 0 as const, alcoholCentric: false, sponsored: false, connection: null };
    const teen = PROFILES.teen_safe_directory, gen = PROFILES.general_assistant, ent = PROFILES.enterprise_professional;
    expect(visibility(base, 30, teen)).toBe("visible");
    expect(visibility({ ...base, venueMinAge: 21 }, 30, teen)).toBe("profile_excluded");
    expect(visibility({ ...base, venueMinAge: 21 }, 30, gen)).toBe("visible");
    expect(visibility({ ...base, venueMinAge: 21 }, 20, gen)).toBe("not_eligible");
    expect(visibility({ ...base, category: "nightlife" }, 30, teen)).toBe("profile_excluded");
    expect(visibility({ ...base, alcoholCentric: true }, 30, teen)).toBe("profile_excluded");
    expect(visibility({ ...base, sponsored: true }, 30, teen)).toBe("profile_excluded");
    expect(visibility({ ...base, category: "romance" }, 30, gen)).toBe("profile_excluded");
    expect(visibility({ ...base, category: "romance" }, 16, gen)).toBe("not_eligible");
    expect(visibility(base, 30, ent)).toBe("profile_excluded");
    for (const connection of ["intro", "group", "relay", "contact"] as const) {
      expect(visibility({ ...base, connection }, 17, gen)).toBe("not_eligible");
      expect(visibility({ ...base, connection }, 18, gen)).toBe("visible");
    }
  });

  test("teen-safe instructions and classifier", () => {
    expect(PROFILES.teen_safe_directory.instructions.length).toBeGreaterThan(100);
    expect(PROFILES.teen_safe_directory.instructions).not.toMatch(TEEN_UNSAFE);
    expect(profileViolation("Trivia at a cocktail bar", PROFILES.teen_safe_directory)).toBe("cocktail");
    expect(profileViolation("Trivia at a cocktail bar", PROFILES.general_assistant)).toBeNull();
    expect(profileViolation("Trivia at a cocktail bar", PROFILES.general_assistant, 16)).toBe("cocktail");
    expect(profileViolation("Bouldering on Thursday at the barbecue place", PROFILES.teen_safe_directory)).toBeNull();
  });
});
