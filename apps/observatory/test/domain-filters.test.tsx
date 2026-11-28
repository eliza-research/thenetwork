import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type { ClockInfo, ObsFeedItem, ObsMember, ObsOpportunity, UnifiedProfile360 } from "../src/types.ts";
import { byRole, installDom } from "./dom.ts";

const clock = (now: number): ClockInfo => ({ now, start: now - 86_400_000, day: 2, playing: false, speed: 0, waitingForPlayer: false });

const makeMember = (id: string, name: string, domains: ObsMember["domains"]): ObsMember => ({
  id, name, city: "nyc", area: "SoHo", state: "normal", joined: true, minor: false, age: 29,
  domains, sourceApp: "ntwrk",
  counters: { msgsIn: 1, msgsOut: 1, proactive: 0, proposals: 1, accepted: 0, meetings: 0, enjoymentSum: 0, enjoymentN: 0 },
});

const makeOpp = (id: string, domain: ObsOpportunity["domain"], category: ObsOpportunity["category"], participants: string[], now: number): ObsOpportunity => ({
  id, kind: "intro", source: "engine", generator: domain === "dating" ? "slop_match" : domain === "business" ? "peon_intro" : "friend_intro",
  category, domain, city: "nyc", objective: `${domain} intro`, score: 0.8, explanations: Object.fromEntries(participants.map(p => [p, "fit"])),
  exploration: false, participants, alternates: [], state: "IN_REVIEW", status: Object.fromEntries(participants.map(p => [p, "pending"])),
  enjoyment: {}, createdAt: now - 3_600_000, updatedAt: now - 60_000, review: { queuedAt: now - 3_600_000, deadline: now + 7_200_000, rerolls: 0, exceptionReason: "other_concern" },
});

test("unified workspace replaces AppSwitcher with Domains checkboxes, filters review/feed/members, and shows generic Member 360 sections", async () => {
  const now = Date.UTC(2026, 10, 20, 16);
  const members: ObsMember[] = [
    makeMember("m-date", "Maya Date", ["dating"]),
    makeMember("m-friend", "Sam Friend", ["friendship"]),
    makeMember("m-biz", "Alex Work", ["business"]),
    makeMember("m-both", "Jordan Both", ["dating", "business"]),
  ];
  const opps: ObsOpportunity[] = [
    makeOpp("o-date", "dating", "romance", ["m-date", "m-both"], now),
    makeOpp("o-friend", "friendship", "social", ["m-friend"], now),
    makeOpp("o-biz", "business", "professional", ["m-biz", "m-both"], now),
  ];
  const feed: ObsFeedItem[] = [
    { seq: 1, t: now - 300_000, kind: "review", text: "Dating intro queued", opportunityId: "o-date", domain: "dating", members: ["m-date"] },
    { seq: 2, t: now - 200_000, kind: "review", text: "Friendship intro queued", opportunityId: "o-friend", domain: "friendship", members: ["m-friend"] },
    { seq: 3, t: now - 100_000, kind: "review", text: "Business intro queued", opportunityId: "o-biz", domain: "business", members: ["m-biz"] },
  ];
  const unifiedProfile: UnifiedProfile360 = {
    app: "ntwrk",
    dating: { app: "ntwrk", adult: true, ageVerified: true, prefs: { hidden: true, count: 3 }, photos: "reason_required" },
    business: { app: "ntwrk", entity: "candidate", roles: [{ family: "engineering", mode: "hybrid" }], applications: [{ opportunityId: "o-biz", state: "IN_REVIEW", at: now }] },
  };

  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === "/api/mode") return Response.json({ mode: "game" });
      if (u.pathname === "/api/me") return Response.json({
        id: "admin", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token",
        apps: ["ntwrk", "slop", "peon", "friends"], domains: ["dating", "friendship", "business"], crossApp: false,
      });
      if (u.pathname === "/api/ws-ticket") return Response.json({ error: "no ws" }, { status: 403 });
      if (u.pathname === "/api/reveal") return Response.json([]);
      if (u.pathname === "/api/venues") return Response.json({ city: "all", venues: [] });
      if (u.pathname === "/api/state") {
        return Response.json({
          env: { mode: "game", app: "ntwrk", label: "SIMULATION · seed 1 · synthetic v1", dataset: "synthetic-v1", capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false } },
          clock: clock(now), version: 1, members, edges: [], opportunities: opps, feed, engineRuns: [], requests: [],
          stats: {
            members: members.length, joined: members.length, byCity: { nyc: members.length }, byState: { normal: members.length },
            messages: 0, inbound: 0, outbound: 0, proactive: 0, proposals: opps.length, proposalsBySource: { engine: opps.length },
            oppsByState: { IN_REVIEW: opps.length }, invites: 0, accepts: 0, declines: 0, meetingsScheduled: 0, meetingsHeld: 0,
            attended: 0, noShows: 0, cancelledWithNotice: 0, enjoymentSum: 0, enjoymentN: 0, blocks: 0, optOuts: 0,
            adversarialAttempts: 0, invariantViolations: 0, errors: 0, compatible: 0, unsafe: 0, oracleJudged: 0, edgesByType: {},
          },
          network: { kind: "consent", counters: {}, gateReasons: {}, review: { queued: opps.length, approved: 0, rejected: 0, expired: 0 }, requests: { total: 0, fulfilled: 0, probing: 0, waiting: 0, plans: 0 }, trust: { watch: 0, hold: 0 }, matchingEnabled: true },
        });
      }
      if (u.pathname === "/api/member/m-both") {
        return Response.json({ member: members[3], facets: [], intents: [], presence: [], edges: [], opportunities: [opps[0], opps[2]], messages: [] });
      }
      if (u.pathname === "/api/member/m-both/timeline") {
        return Response.json({ memberId: "m-both", entries: [], pending: [] });
      }
      if (u.pathname === "/api/member/m-both/app") {
        return Response.json(unifiedProfile);
      }
      return Response.json({ error: "not found" }, { status: 404 });
    },
  });

  const window = new Window({ url: api.url.href });
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator, location: window.location,
    history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  });
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(typeof input === "string" ? new URL(input, api.url) : input, init)) as typeof fetch;

  const box = window.document.createElement("div");
  window.document.body.append(box);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(box as unknown as HTMLElement);
  const { store } = await import("../web/store.ts");
  const { App } = await import("../web/main.tsx");

  const wait = async (check: () => boolean) => {
    for (let i = 0; i < 120; i++) {
      if (check()) return;
      await act(async () => { await sleep(10); });
    }
    throw new Error(`Timed out waiting for condition. Text: ${box.textContent?.slice(0, 400)}`);
  };

  try {
    store.ui = { ...store.ui, view: "graph", drawer: "feed", drawerOpen: true, focus: null, filters: { range: "7d", borough: "all", members: "all", origin: "all", stateGroup: "all", domains: { dating: true, friendship: true, business: true } } };
    await act(async () => { root.render(createElement(App)); });
    await wait(() => store.members.size === 4 && !store.loading);
    await act(async () => { await sleep(40); });

    // No AppSwitcher ("ntwrk" / "all" / "slop" / "peon" / "friends" buttons) in TopBar.
    const buttonTexts = [...box.querySelectorAll("button")].map(b => b.textContent?.trim());
    expect(buttonTexts).not.toContain("ntwrk");
    expect(buttonTexts).not.toContain("all");
    expect(buttonTexts).not.toContain("slop");
    expect(buttonTexts).not.toContain("peon");
    expect(buttonTexts).not.toContain("friends");
    expect(box.textContent).not.toContain("NTWRK ·");

    // Domains checkbox group has Dating, Friendship, Business all checked by default.
    const datingBox = byRole<HTMLButtonElement>(box, "checkbox", "Dating")!;
    const friendshipBox = byRole<HTMLButtonElement>(box, "checkbox", "Friendship")!;
    const businessBox = byRole<HTMLButtonElement>(box, "checkbox", "Business")!;
    expect(datingBox.getAttribute("aria-checked")).toBe("true");
    expect(friendshipBox.getAttribute("aria-checked")).toBe("true");
    expect(businessBox.getAttribute("aria-checked")).toBe("true");
    expect(store.reviewPending().length).toBe(3);

    // Uncheck Friendship and Business -> only Dating remains.
    await act(async () => { friendshipBox.click(); await sleep(40); });
    await act(async () => { businessBox.click(); await sleep(40); });
    expect(store.ui.filters.domains).toEqual({ dating: true, friendship: false, business: false });
    expect(store.reviewPending().map(o => o.id)).toEqual(["o-date"]);
    expect([...store.members.values()].filter(m => store.matchMember(m)).map(m => m.id).sort()).toEqual(["m-both", "m-date"]);
    expect(store.feed.filter(x => store.matchFeed(x)).map(x => x.seq)).toEqual([1]);
    expect(window.location.hash).toBe("#d=dating");

    // Review tab count badge reflects domain-filtered pending count (1, not 3).
    const reviewTab = [...box.querySelectorAll('[role="tab"]')].find(el => el.textContent?.includes("Review"));
    expect(reviewTab?.textContent).toContain("1");

    // Reset restores all 3 domains checked and clears hash.
    const resetBtn = [...box.querySelectorAll("button")].find(b => b.textContent?.trim() === "Reset")!;
    expect(resetBtn).toBeTruthy();
    await act(async () => { resetBtn.click(); await sleep(40); });
    expect(store.ui.filters.domains).toEqual({ dating: true, friendship: true, business: true });
    expect(store.reviewPending().length).toBe(3);
    expect(window.location.hash).toBe("");

    // Member 360 renders generic "Dating" and "Business" disclosures on unified ntwrk (no "slop"/"peon" labels).
    await act(async () => { store.focus({ kind: "member", id: "m-both" }); await sleep(40); });
    await wait(() => (box.textContent ?? "").includes("Business · 1 introductions"));
    expect(box.textContent).toContain("Dating");
    expect(box.textContent).toContain("Business · 1 introductions");
    expect(box.textContent).not.toContain("Dating (slop)");
    expect(box.textContent).not.toContain("Hiring (peon)");
  } finally {
    await act(async () => { root.unmount(); });
    store.disconnect();
    globalThis.fetch = nativeFetch;
    await api.stop(true);
    await window.happyDOM.close();
    restoreDom();
  }
}, 30_000);
