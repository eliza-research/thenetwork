// The staff review queue lists only the items the review judge held
// (spec/staffReview.md; spec/models/review_desk.md: "The page queue shows
// only held items"). An item that still waits for the judge (IN_REVIEW with
// no exception reason) cannot be approved or re-rolled by staff
// (spec/automatedReview.md: staff approve only a held item; the service
// refuses with not_held_for_staff), so it must not appear in the Pending
// list or offer review actions in its detail. It still belongs to the
// pipeline Review column, which groups by state.
import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { DAY } from "@thenetwork/core";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type { ObsMember, ObsOpportunity, OpportunityDetail } from "../src/types.ts";
import { installDom } from "./dom.ts";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const counters = () => ({ msgsIn: 0, msgsOut: 0, proactive: 0, proposals: 0, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 });
const member = (id: string, name: string): ObsMember => ({
  id, name, city: "nyc", area: "East Village", state: "normal", joined: true, joinedAt: NOW - 30 * DAY,
  minor: false, age: 30, counters: counters(),
});
const reviewOpp = (id: string, participants: string[], held: boolean): ObsOpportunity => ({
  id, kind: "intro", source: "network", origin: "engine", generator: "probe", city: "nyc",
  objective: "meet", score: 1, explanations: {}, exploration: false,
  participants, alternates: [], state: "IN_REVIEW", status: {}, enjoyment: {},
  createdAt: NOW - 3 * DAY, updatedAt: NOW - DAY,
  review: held
    ? { queuedAt: NOW - 3_600_000, deadline: NOW + 3_600_000, exceptionReason: "other_concern", judgeVerdict: "flag" }
    : { queuedAt: NOW - 3_600_000, deadline: NOW + 3_600_000 },
});

test("pending queue and detail actions cover only judge-held items; the pipeline still shows both", async () => {
  const awaiting = reviewOpp("oppAwaiting", ["m1", "m2"], false);
  const held = reviewOpp("oppHeld", ["m1", "m3"], true);
  const details: Record<string, OpportunityDetail> = {
    oppAwaiting: { opportunity: awaiting, members: [], messages: [], events: [] },
    oppHeld: { opportunity: held, members: [], messages: [], events: [] },
  };
  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    fetch: async (req) => {
      const u = new URL(req.url);
      const m = /^\/api\/opportunity\/([^/]+)$/.exec(u.pathname);
      if (m && details[m[1]]) return Response.json(details[m[1]]);
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
  const drawerBox = window.document.createElement("div");
  const inspectorBox = window.document.createElement("div");
  window.document.body.append(drawerBox, inspectorBox);
  const { createRoot } = await import("react-dom/client");
  const drawerRoot = createRoot(drawerBox as unknown as HTMLElement);
  const inspectorRoot = createRoot(inspectorBox as unknown as HTMLElement);
  const wait = async (check: () => boolean, label: string) => {
    for (let i = 0; i < 400; i++) { if (check()) return; await act(async () => { await sleep(5); }); }
    throw Error(`timed out: ${label}\nDRAWER: ${drawerBox.textContent}\nINSPECTOR: ${inspectorBox.textContent}`);
  };
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  const { Inspector } = await import("../web/panels.tsx");
  store.mode = "game";
  store.app = "ntwrk";
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  (store as unknown as { clock: unknown }).clock = { now: NOW, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false };
  (store as unknown as { env: unknown }).env = { mode: "game", app: "ntwrk", label: "SIMULATION", dataset: "synthetic", capabilities: { canStep: false, canIntervene: false, hiddenTruth: false, readOnly: false } };
  store.members.clear(); store.opps.clear(); store.feed = [];
  for (const m of [member("m1", "Maya Rao"), member("m2", "Jon Park"), member("m3", "Leo Diaz")]) store.members.set(m.id, m);
  store.opps.set(awaiting.id, awaiting); store.opps.set(held.id, held);
  const drawerText = () => drawerBox.textContent ?? "";
  const inspectorText = () => inspectorBox.textContent ?? "";
  const approveButton = () => [...inspectorBox.querySelectorAll("button")].find(b => (b.textContent ?? "").trim() === "Approve");
  try {
    await act(async () => {
      store.setUI({ drawer: "review", drawerOpen: true, reviewView: "pending", focus: null });
      drawerRoot.render(createElement(Drawer));
      inspectorRoot.render(createElement(Inspector));
    });
    await wait(() => drawerText().includes("Maya + Leo"), "held card in the pending queue");
    await act(async () => { await sleep(60); });
    expect(drawerText()).toContain("Maya + Leo");
    expect(drawerText()).not.toContain("Maya + Jon");
    // The awaiting item's detail offers no staff decision the service would refuse.
    await act(async () => { store.focus({ kind: "opportunity", id: "oppAwaiting" }); await sleep(20); });
    await wait(() => inspectorText().includes("In review"), "awaiting detail");
    await act(async () => { await sleep(60); });
    expect(approveButton()).toBeUndefined();
    // The held item's detail still offers the decision.
    await act(async () => { store.focus({ kind: "opportunity", id: "oppHeld" }); await sleep(20); });
    await wait(() => !!approveButton(), "held detail Approve");
    expect(approveButton()).toBeTruthy();
    // The pipeline groups by state, so both items stay in the Review column.
    await act(async () => { store.setUI({ drawer: "pipeline", drawerOpen: true }); await sleep(60); });
    await wait(() => drawerText().includes("Maya + Jon") && drawerText().includes("Maya + Leo"), "both pipeline cards");
    expect(drawerText()).toContain("Maya + Jon");
    expect(drawerText()).toContain("Maya + Leo");
  } finally {
    await act(async () => { drawerRoot.unmount(); inspectorRoot.unmount(); });
    globalThis.fetch = nativeFetch;
    await api.stop(true);
    await window.happyDOM.close();
    restoreDom();
  }
});
