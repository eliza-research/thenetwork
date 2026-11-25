// R23-TA: a report against a member must show on that member's timeline.
//
// Journey: staff open the reported member's panel -> the Timeline section
// must show the report that put the member under safety review, next to
// the hold it caused.
//
// Fixture: the stored report_received row, exactly as the writer stores it
// (service-safety.test.ts: a report by Ana against Ben; object member Ana,
// payload.memberId Ana, payload.target Ben). Correct: the row belongs on
// Ben's timeline (he is the one it is about) and on Ana's (she filed it),
// and on nobody else's. Wrong (base): Ben's timeline never shows it --
// onTimeline lets the row's single subject (Ana) decide, so the other
// member the row names (Ben, payload.target) is dropped. The same shape
// already works for member_blocked, whose target sees the block.
//
// The unit tests are the repro: they call the real onTimeline the game
// and real sources both use (sources/game.ts, sources/real.ts). The DOM
// test is panel-render evidence only -- its fixture stands in for the
// server, so it passes on base too -- and proves the panel shows the row
// once the server includes it.
import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { DAY } from "@thenetwork/core";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import { describe as describeEvent, onTimeline, type EventRow } from "../src/events.ts";
import type { MemberDetail, MemberTimeline, ObsMember } from "../src/types.ts";
import { installDom } from "./dom.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const ANA = "m-ana";
const BEN = "m-ben";
const CID = "m-cid";

const reportRow = (): EventRow => ({
  at: new Date("2026-11-20T10:00:00Z"),
  actor_type: "agent",
  actor_id: null,
  type: "report_received",
  object_type: "member",
  object_id: ANA,
  payload: { reportId: "r1", kind: "harassment", memberId: ANA, target: BEN, source: "message", met: false },
});

test("report_received shows on the reported member's timeline", () => {
  expect(onTimeline(reportRow(), BEN, new Set())).toBe(true);
});

test("report_received still shows on the reporter's timeline", () => {
  expect(onTimeline(reportRow(), ANA, new Set())).toBe(true);
});

test("report_received shows on nobody else's timeline", () => {
  expect(onTimeline(reportRow(), CID, new Set())).toBe(false);
});

test("report_received still reads reporter and target, with its severity", () => {
  const name = (id: string) => (id === ANA ? "Ana" : id === BEN ? "Ben" : id);
  expect(describeEvent(reportRow(), name).text).toBe("Ana reported Ben: harassment (by text, never met through us)");
  expect(describeEvent(reportRow(), name).severity).toBe("bad");
});

test("member_blocked still shows on the blocked member's timeline", () => {
  const row: EventRow = {
    at: new Date("2026-11-20T10:00:00Z"), actor_type: "member", actor_id: ANA,
    type: "member_blocked", object_type: "member", object_id: BEN, payload: {},
  };
  expect(onTimeline(row, BEN, new Set())).toBe(true);
});

const counters = () => ({ msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 });
const member = (id: string, name: string): ObsMember => ({
  id, name, city: "nyc", area: "East Village", state: "normal", joined: true, joinedAt: NOW - 30 * DAY,
  minor: false, age: 30, counters: counters(),
});

test("member panel renders the report line once the timeline carries it", async () => {
  const name = (id: string) => (id === ANA ? "Ana Rao" : id === BEN ? "Ben Park" : id);
  const detail: MemberDetail = {
    member: member(BEN, "Ben Park"), facets: [], intents: [], presence: [], edges: [],
    opportunities: [], messages: [],
  };
  const timeline: MemberTimeline = {
    memberId: BEN,
    entries: [{ t: Date.UTC(2026, 10, 20, 10, 0, 0), kind: "event", event: describeEvent(reportRow(), name) }],
    pending: [],
  };
  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    fetch: async (req) => {
      const u = new URL(req.url);
      if (u.pathname === "/api/member/m-ben") return Response.json(detail);
      if (u.pathname === "/api/member/m-ben/timeline") return Response.json(timeline);
      return Response.json({ error: "unexpected" }, { status: 404 });
    },
  });
  const window = new Window({ url: api.url.href });
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(typeof input === "string" ? new URL(input, api.url) : input, init)) as typeof fetch;
  const inspectorBox = window.document.createElement("div");
  window.document.body.append(inspectorBox);
  const { createRoot } = await import("react-dom/client");
  const inspectorRoot = createRoot(inspectorBox as unknown as HTMLElement);
  const wait = async (check: () => boolean, label: string) => {
    for (let i = 0; i < 400; i++) { if (check()) return; await act(async () => { await sleep(5); }); }
    throw Error(`timed out waiting for: ${label}\nINSPECTOR: ${inspectorBox.textContent ?? ""}`);
  };
  try {
    const { store } = await import("../web/store.ts");
    const { Inspector } = await import("../web/panels.tsx");
    store.mode = "game";
    store.app = "ntwrk";
    store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
    (store as unknown as { clock: unknown }).clock = { now: NOW, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false };
    store.members.clear(); store.opps.clear(); store.feed = [];
    for (const m of [member(ANA, "Ana Rao"), member(BEN, "Ben Park")]) store.members.set(m.id, m);
    await act(async () => { inspectorRoot.render(createElement(Inspector)); });
    await act(async () => { store.focus({ kind: "member", id: BEN }); });
    await wait(() => (inspectorBox.querySelector("h2")?.textContent?.trim() ?? "") === "Ben Park", "member panel");
    await wait(() => (inspectorBox.textContent ?? "").includes("Timeline"), "member detail loaded");
    expect(inspectorBox.textContent ?? "").toContain("Ana Rao reported Ben Park: harassment");
  } finally {
    await act(async () => { inspectorRoot.unmount(); });
    globalThis.fetch = nativeFetch;
    await api.stop(true);
    await window.happyDOM.close();
    restoreDom();
  }
});
