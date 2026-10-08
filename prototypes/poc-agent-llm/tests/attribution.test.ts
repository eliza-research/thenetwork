// Offline tests for deterministic thread attribution (no LLM, no network).
import { describe, expect, test } from "bun:test";
import { attribute, checkTarget, mentionedItems, parseItems } from "../src/attribution.ts";
import { CONTEXTS, withTimeline, type CtxV2 } from "../src/contexts.ts";
import type { ProposedAction } from "../src/spec.ts";

// Same three items as the injection probes (src/probes.ts BASE_ITEMS); inlined so tests do not import the LLM layer.
const BASE_ITEMS = [
  "ACCEPTED intro thread_88 with Marcus (climbing partner intro). Relay open. No meetup time set yet.",
  "PENDING INVITE opp_311: 1:1 intro to Priya (ceramicist, Mission) for coffee Thu 6pm. Awaiting member's answer.",
  "COMPLETED intro thread_19 with Sarah K. (coffee last week). Contacts not swapped.",
];
const RELAY = "From Marcus: hey! stoked to climb sometime";
// Priya's invite went out 3h ago, Marcus's relay 2 min ago (only the relay is inside the 60-min window)
const spread = (extra: Partial<CtxV2> = {}) => withTimeline({ kind: "probe", active_items: BASE_ITEMS, last_relayed_message: RELAY },
  { extra: [{ item: "opp_311", agoMin: 180, kind: "agent" }], ...extra });
// Priya's invite 20 min ago, Marcus's relay 2 min ago (both open in the window)
const busy = (o: Parameters<typeof withTimeline>[1] = {}) => withTimeline({ kind: "probe", active_items: BASE_ITEMS, last_relayed_message: RELAY },
  { extra: [{ item: "opp_311", agoMin: 20, kind: "agent" }], ...o });

const accept311: ProposedAction = { type: "RESPOND_TO_OPPORTUNITY", evidence: "nice, saturday?", opportunity_id: "opp_311", response: "counter" };
const relay88: ProposedAction = { type: "RELAY_MESSAGE", evidence: "nice, saturday?", thread_id: "thread_88", text: "nice, saturday?" };

describe("parseItems", () => {
  test("ids, names and anchors come from trusted descriptions", () => {
    const it = parseItems(CONTEXTS.multi[0]);
    expect(it.map(i => i.id)).toEqual(["thread_88", "opp_311", "thread_19"]);
    expect(it[0].anchors).toContain("marcus");
    expect(it[0].anchors).toContain("day:sat");
    expect(it[1].anchors).toEqual(expect.arrayContaining(["priya", "coffee", "day:thu"]));
    expect(it[1].anchors).not.toContain("mission"); // places are not anchors
  });
  test("group items get every name", () => {
    expect(parseItems(CONTEXTS.feedback_ask[0])[0].names).toEqual(expect.arrayContaining(["sam", "lee", "ana"]));
  });
});

describe("attribute: short ambiguous replies", () => {
  for (const msg of ["nice, saturday?", "haha sounds good, see u there", "sure", "sounds good!", "lol ok", "yeah dogpatch works for me!"]) {
    test(`"${msg}" binds to the most recent outbound item (Marcus relay)`, () => {
      const a = attribute(msg, spread());
      expect(a.mode).toBe("bound");
      expect(a.allowed).toEqual(["thread_88"]);
    });
    test(`"${msg}" with two items open in the window -> ambiguous (ask)`, () => {
      const a = attribute(msg, busy());
      expect(a.mode).toBe("ambiguous");
      expect(a.allowed).toEqual([]);
      expect(a.candidates.sort()).toEqual(["opp_311", "thread_88"]);
    });
  }
  test("the 28/300 failure: RESPOND_TO_OPPORTUNITY opp_311 for a reply to Marcus is rejected", () => {
    const ctx = spread();
    const c = checkTarget(accept311, attribute("nice, saturday?", ctx), ctx);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.ask).toContain("Marcus");
    expect(checkTarget(relay88, attribute("nice, saturday?", ctx), ctx).ok).toBe(true);
  });
  test("busy window: even the right target is held (ask), never executed on a guess", () => {
    const ctx = busy();
    const c = checkTarget(relay88, attribute("nice, saturday?", ctx), ctx);
    expect(c.ok).toBe(false);
    if (!c.ok) expect(c.ask).toMatch(/Marcus.*Priya|Priya.*Marcus/);
  });
  test("outside the window the most recent outbound still wins", () => {
    const ctx = withTimeline({ kind: "probe", active_items: BASE_ITEMS, last_relayed_message: RELAY },
      { relayAgoMin: 300, extra: [{ item: "opp_311", agoMin: 900, kind: "agent" }] });
    expect(attribute("sure", ctx)).toMatchObject({ mode: "bound", allowed: ["thread_88"] });
  });
  test("non-item last message (concierge results) binds to nothing actionable", () => {
    const ctx = withTimeline({ kind: "probe", active_items: BASE_ITEMS, last_agent_message: "Here are 3 things this weekend:\n1. picnic\n2. ceramics open studio" },
      { extra: [{ item: "opp_311", agoMin: 180, kind: "agent" }] });
    const a = attribute("nice, any of these near the mission?", ctx);
    expect(a).toMatchObject({ mode: "bound", allowed: [] });
    expect(checkTarget(accept311, a, ctx).ok).toBe(false);
  });
});

describe("attribute: explicit signals", () => {
  test("channel reply_to wins even in a busy window", () => {
    const ctx = busy({ channel: { reply_to: "thread_88" } });
    const a = attribute("sure", ctx);
    expect(a).toMatchObject({ mode: "reply_to", allowed: ["thread_88"] });
    expect(checkTarget(accept311, a, ctx).ok).toBe(false);
    expect(checkTarget(relay88, a, ctx).ok).toBe(true);
  });
  test("reply_to an unknown item is ignored", () => {
    expect(attribute("sure", busy({ channel: { reply_to: "thread_999" } })).mode).toBe("ambiguous");
  });
  test("channel last_seen counts as the newest outbound", () => {
    const ctx = withTimeline({ kind: "probe", active_items: BASE_ITEMS }, { extra: [{ item: "opp_311", agoMin: 200, kind: "agent" }], channel: { last_seen: "thread_88" } });
    expect(attribute("ok", ctx)).toMatchObject({ mode: "bound", allowed: ["thread_88"] });
  });
  test("mentioning the item by name binds to it in a busy window", () => {
    const ctx = busy();
    const a = attribute("yes to coffee with priya!", ctx);
    expect(a.mode).toBe("mention");
    expect(a.allowed).toContain("opp_311");
    expect(checkTarget({ ...accept311, evidence: "yes to coffee with priya", response: "accept" }, a, ctx).ok).toBe(true);
  });
  test("day anchors: 'saturday' references Marcus's Sat climb in the multi context", () => {
    expect(mentionedItems("nice, saturday?", parseItems(CONTEXTS.multi[0]))).toEqual(["thread_88"]);
  });
  test("places are not anchors", () => {
    expect(mentionedItems("anything near the mission?", parseItems(CONTEXTS.multi[0]))).toEqual([]);
  });
  test("single active item, no timeline -> bound", () => {
    expect(attribute("yes!", { ...CONTEXTS.pending_invite[1] })).toMatchObject({ mode: "bound", allowed: ["opp_402"] });
  });
  test("non-item actions are never affected", () => {
    const ctx = busy();
    const a: ProposedAction = { type: "SET_STATE", evidence: "sure", state: "quiet" };
    expect(checkTarget(a, attribute("sure", ctx), ctx).ok).toBe(true);
  });
});

describe("read-only exception", () => {
  test("a question about the newest item is answered in a busy window; state changes still ask", () => {
    const ctx = withTimeline({ kind: "probe", active_items: BASE_ITEMS, last_agent_message: "Priya (ceramicist) is up for coffee Thu 6pm. Want me to connect you?" },
      { agentAgoMin: 2, extra: [{ item: "thread_88", agoMin: 30, kind: "relay" }] });
    const a = attribute("tell me more about her?", ctx);
    expect(a.mode).toBe("ambiguous");
    const q: ProposedAction = { type: "RESPOND_TO_OPPORTUNITY", evidence: "tell me more about her?", opportunity_id: "opp_311", response: "question" };
    expect(checkTarget(q, a, ctx).ok).toBe(true);
    expect(checkTarget({ ...q, response: "accept" }, a, ctx).ok).toBe(false);
    expect(checkTarget(relay88, a, ctx).ok).toBe(false);
  });
  test("a question about an older item in a busy window still asks", () => {
    const ctx = busy(); // newest is Marcus's relay
    expect(checkTarget({ ...accept311, response: "question" }, attribute("hm?", ctx), ctx).ok).toBe(false);
  });
});

describe("day anchors tolerate typos", () => {
  test("satruday / saturdat / thrusday", () => {
    const items = parseItems(CONTEXTS.multi[0]);
    expect(mentionedItems("can we do satruday at 1pm instead", items)).toEqual(["thread_88"]);
    expect(mentionedItems("noon on saturdat?", items)).toEqual(["thread_88"]);
    expect(mentionedItems("thrusday works", items)).toEqual(["opp_311"]);
    expect(mentionedItems("i was sitting there", items)).toEqual([]);
  });
});
