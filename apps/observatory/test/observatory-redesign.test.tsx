import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { DAY } from "@thenetwork/core";
import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "vitest";
import { Window } from "happy-dom";
import { act, createElement } from "react";
import type { ObsMember, ObsOpportunity } from "../src/types.ts";
import { installDom } from "./dom.ts";

const NOW = Date.UTC(2026, 10, 25, 12, 0, 0);
const counters = () => ({ msgsIn: 2, msgsOut: 3, proactive: 1, proposals: 2, accepted: 1, meetings: 1, enjoymentSum: 0.9, enjoymentN: 1 });

function makeMember(id: string, name: string, age: number, minor: boolean): ObsMember {
  return {
    id, name, city: "nyc", area: "East Village", state: "normal", joined: true, joinedAt: NOW - 10 * DAY,
    minor, age, counters: counters(),
  };
}

function makeOpp(id: string, participants: string[], category: ObsOpportunity["category"]): ObsOpportunity {
  return {
    id, kind: "intro", source: "network", generator: "activity_partner", category, city: "nyc",
    objective: "Weekend climbing session", score: 0.81, explanations: {}, exploration: false,
    participants, alternates: [], state: "IN_REVIEW", status: {}, enjoyment: {},
    createdAt: NOW - 3_600_000, updatedAt: NOW - 1_800_000,
    review: {
      queuedAt: NOW - 3_600_000,
      deadline: NOW + 7_200_000,
      judgeVerdict: "flag",
      exceptionReason: "minor_strict_rubric",
      judgeExplanation: "Held for staff confirmation of teen public activity.",
    },
  };
}

test("teen review approval follows teenFriendAgeRule and surfaces review judge explanation", async () => {
  const window = new Window({ url: "http://127.0.0.1" });
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { store } = await import("../web/store.ts");
  const { approveBlock, ReviewQueue } = await import("../web/review.tsx");
  const { createRoot } = await import("react-dom/client");
  const before = { app: store.app, mode: store.mode, me: store.me, env: store.env, clock: store.clock, members: new Map(store.members), opps: new Map(store.opps), ui: store.ui };
  const box = window.document.createElement("div");
  window.document.body.append(box);
  const root = createRoot(box as unknown as HTMLElement);
  try {
    const setupApp = (app: string) => {
      store.app = app;
      store.me = { id: "rev", roles: ["reviewer"], grants: [{ role: "reviewer", app: "*" }], via: "token" };
      store.env = { mode: "game", app, label: "SIM", dataset: "sim", capabilities: { canStep: true, canIntervene: true, hiddenTruth: false, readOnly: false, staffActions: true } };
      store.clock = { now: NOW, start: NOW - 10 * DAY, day: 10, playing: false, speed: 0, waitingForPlayer: false };
      store.members = new Map([
        ["t16", makeMember("t16", "Sam Teen", 16, true)],
        ["t17", makeMember("t17", "Alex Teen", 17, true)],
        ["a19", makeMember("a19", "Jordan Adult", 19, false)],
        ["t13", makeMember("t13", "Casey Young", 13, true)],
      ]);
    };
    store.mode = "game";
    setupApp("friends");
    const okTeen = makeOpp("opp-teen-ok", ["t16", "t17"], "social");
    const badAdult = makeOpp("opp-teen-adult", ["t16", "a19"], "social");
    const badGap = makeOpp("opp-teen-gap", ["t13", "t17"], "social");
    const badLane = makeOpp("opp-teen-romance", ["t16", "t17"], "romance");
    expect(approveBlock(okTeen)).toBeUndefined();
    expect(approveBlock(badAdult)).toContain("19");
    expect(approveBlock(badGap)).toContain("2 years");
    expect(approveBlock(badLane)).toContain("friendship");

    setupApp("slop");
    expect(approveBlock(okTeen)).toContain("never introduced");

    setupApp("friends");
    store.opps = new Map([[okTeen.id, okTeen]]);
    store.setUI({ focus: null, reviewView: "pending" });
    await act(async () => { root.render(createElement(ReviewQueue)); });
    expect(box.textContent).toContain("Held for staff confirmation of teen public activity.");
    expect(box.textContent).toContain("minor strict rubric");
    const approveBtn = [...box.querySelectorAll("button")].find(b => b.textContent === "Approve");
    expect(approveBtn).toBeTruthy();
    expect(approveBtn!.disabled).toBe(false);
  } finally {
    await act(async () => { root.unmount(); });
    Object.assign(store, before);
    restore();
    await window.happyDOM.close();
  }
});

test("drawer resize modes, visual analytics sub-tabs, and mock traffic panel render cleanly", async () => {
  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    fetch: async req => {
      const u = new URL(req.url);
      if (u.pathname === "/api/analytics/funnel") {
        return Response.json({
          steps: [
            { stage: "outreach_sent", count: 120, suppressed: false, conversionFromPrev: 1, conversionFromStart: 1, medianTimeFromPrevMs: null },
            { stage: "signup_verified", count: 48, suppressed: false, conversionFromPrev: 0.4, conversionFromStart: 0.4, medianTimeFromPrevMs: 3_600_000 },
            { stage: "first_irl_meeting", count: 18, suppressed: false, conversionFromPrev: 0.375, conversionFromStart: 0.15, medianTimeFromPrevMs: 86_400_000 },
          ],
          dropOffReasons: [{ reason: "drop_pre_verify", count: 32, share: 0.44, suppressed: false }],
          totalActors: 120,
          kFloor: 5,
        });
      }
      if (u.pathname === "/api/analytics/timeseries") {
        return Response.json({
          granularity: "day",
          labels: ["Nov 23", "Nov 24", "Nov 25"],
          series: {
            visits: [{ ts: 1, label: "Nov 23", value: 40 }, { ts: 2, label: "Nov 24", value: 55 }, { ts: 3, label: "Nov 25", value: 70 }],
            signups: [{ ts: 1, label: "Nov 23", value: 12 }, { ts: 2, label: "Nov 24", value: 18 }, { ts: 3, label: "Nov 25", value: 24 }],
            proposals: [{ ts: 1, label: "Nov 23", value: 8 }, { ts: 2, label: "Nov 24", value: 10 }, { ts: 3, label: "Nov 25", value: 14 }],
            meetings: [{ ts: 1, label: "Nov 23", value: 3 }, { ts: 2, label: "Nov 24", value: 5 }, { ts: 3, label: "Nov 25", value: 7 }],
            messages: [{ ts: 1, label: "Nov 23", value: 60 }, { ts: 2, label: "Nov 24", value: 80 }, { ts: 3, label: "Nov 25", value: 95 }],
            stops: [{ ts: 1, label: "Nov 23", value: 1 }, { ts: 2, label: "Nov 24", value: 0 }, { ts: 3, label: "Nov 25", value: 1 }],
          },
        });
      }
      if (u.pathname === "/api/analytics/anomalies") {
        return Response.json({
          alerts: [],
          safety: { canaryLeaks: 0, teenViolationContacts: 0, crossAppLeaks: 0, unverifiedAdultPayouts: 0 },
          intentDemand: [{ appId: "ntwrk", city: "nyc", desireLane: "climbing", openRequests7d: 14, fulfilledProposals7d: 8, unfulfilledDemandRatio: 0.43, teenEligible: true }],
        });
      }
      if (u.pathname === "/api/analytics/cohorts") {
        return Response.json({
          horizons: [1, 3, 7, 14, 30],
          rows: [{ cohortWeek: "2026-W46", cohortSize: 24, suppressed: false, retention: { 1: 0.8, 3: 0.65, 7: 0.5, 14: 0.42, 30: 0.35 } }],
          drivers: [{ driverId: "met_week1", label: "Met in week 1", exposedCount: 14, baselineCount: 10, exposedD30Rate: 0.6, baselineD30Rate: 0.2, lift: 0.4, suppressed: false }],
          kFloor: 5,
        });
      }
      if (u.pathname === "/api/analytics/heatmap") {
        return Response.json({
          cells: [{ dayOfWeek: 2, hour: 18, sent: 30, delivered: 30, clicked: 12, replied: 9, converted: 4, stopped: 1, bounced: 0, rateLimited429: 0, replyRate: 0.3, clickRate: 0.4, conversionRate: 0.13, stopRate: 0.03, bounceRate: 0, rateLimit429Rate: 0 }],
          templateLift: [{ templateId: "warm_v2", personaId: "p1", channel: "sms", sent: 30, replyRate: 0.3, conversionRate: 0.13, stopRate: 0.03, stopGuardrailBreached: false }],
          totalSent: 30,
        });
      }
      if (u.pathname === "/api/trajectories") {
        return Response.json({
          traces: [{ traceId: "tr_demo_001", appId: "ntwrk", city: "nyc", kind: "llm", entityType: "member", entityId: "m1", personId: null, status: "ok", model: "gpt-6-luna", spanCount: 1, inputTokens: 120, outputTokens: 45, costMicros: 400, durationMs: 220, flags: [], storageDriver: "memory", objectKey: "k", byteOffset: 0, byteLength: 10, startedAt: NOW }],
          hotTail: [],
          driver: "memory",
        });
      }
      if (u.pathname === "/api/trajectories/tr_demo_001") {
        return Response.json({
          traceId: "tr_demo_001",
          manifest: null,
          spans: [{ schemaVersion: 1, traceId: "tr_demo_001", spanId: "sp_1", app: "ntwrk", kind: "llm", name: "review_judge", startedAt: NOW, durationMs: 220, status: "ok", payloadState: "shredded", metrics: { model: "gpt-6-luna", inputTokens: 120, outputTokens: 45, costMicros: 400 } }],
        });
      }
      if (u.pathname === "/api/analytics/slice") {
        const body = await req.json() as { sql?: string };
        if (body.sql) return Response.json({ columns: ["day", "actors"], rows: [{ day: "2026-11-25", actors: 24 }], truncated: false });
        return Response.json({ metric: "verified_signups", granularity: "day", groupBy: ["city"], rows: [{ bucket: "2026-11-25", dimensions: { city: "nyc" }, value: 24, sampleCount: 24, suppressed: false }], kFloor: 5 });
      }
      if (u.pathname === "/api/mocks/traffic") {
        return Response.json({
          entries: [{ id: "req1", ts: NOW, service: "blooio", method: "POST", path: "/v1/messages", status: 429, latencyMs: 42 }],
          stats: { total: 1, byService: { blooio: 1 }, byStatus: { "429": 1 } },
          baseUrl: "http://127.0.0.1:4999",
        });
      }
      if (u.pathname === "/api/mocks/chaos") {
        return Response.json({ rules: [{ id: "blooio_429", service: "blooio", probability: 1, fault: { kind: "rate_limit_spike" }, enabled: true }] });
      }
      if (u.pathname === "/api/levels") {
        return Response.json([{ id: "city_launch", title: "City Launch", description: "Launch NYC", days: 14, kind: "unified" }]);
      }
      return Response.json({ error: "unexpected" }, { status: 404 });
    },
  });
  const window = new Window({ url: api.url.href });
  const nativeFetch = globalThis.fetch;
  const restore = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(typeof input === "string" ? new URL(input, api.url) : input, init)) as typeof fetch;
  const box = window.document.createElement("div");
  window.document.body.append(box);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(box as unknown as HTMLElement);
  const { store } = await import("../web/store.ts");
  const { Drawer } = await import("../web/drawer.tsx");
  const wait = async (check: () => boolean, label: string) => {
    for (let i = 0; i < 300; i++) { if (check()) return; await act(async () => { await sleep(5); }); }
    throw Error(`Timed out waiting for ${label}\nBOX: ${box.textContent ?? ""}`);
  };
  const before = { app: store.app, mode: store.mode, me: store.me, env: store.env, clock: store.clock, stats: store.stats, game: store.game, ui: store.ui };
  try {
    store.mode = "game";
    store.app = "ntwrk";
    store.me = { id: "staff", roles: ["admin", "analyst", "engineer"], grants: [{ role: "admin", app: "*" }], via: "token" };
    store.env = { mode: "game", app: "ntwrk", label: "SIM", dataset: "sim", capabilities: { canStep: true, canIntervene: true, hiddenTruth: true, readOnly: false } };
    store.clock = { now: NOW, start: NOW - 7 * DAY, day: 7, playing: false, speed: 3_600_000, waitingForPlayer: false };
    store.stats = {
      members: 50, joined: 48, byCity: { nyc: 50 }, byState: { normal: 48 }, messages: 200, inbound: 90, outbound: 110, proactive: 12,
      proposals: 20, proposalsBySource: { engine: 20 }, oppsByState: { SCHEDULED: 5 }, invites: 18, accepts: 14, declines: 4,
      meetingsScheduled: 10, meetingsHeld: 8, attended: 16, noShows: 0, cancelledWithNotice: 1, enjoymentSum: 14.4, enjoymentN: 16,
      blocks: 0, optOuts: 1, adversarialAttempts: 0, invariantViolations: 0, errors: 0, compatible: 18, unsafe: 0, oracleJudged: 20, edgesByType: { met: 8 },
    };
    store.game = {
      sparksLeft: 3, sparksPerDay: 3, strikes: 0, maxStrikes: 3, over: false, lensUsed: false, peeks: 0,
      engine: "engine-v1", scores: [{ source: "player", label: "You", points: 240, proposals: 2, accepted: 2, declined: 0, meetings: 1, showRate: 1, meanEnjoyment: 0.9, precision: 1, unsafe: 0, perProposal: 120 }],
      missions: [], prompts: [], controlled: [],
      unified: {
        responseMode: "hybrid",
        speedPreset: "60x",
        activeChaos: [],
        mockBaseUrl: "http://127.0.0.1:4999",
        teenStop: false,
        responseStats: {
          configuredMode: "hybrid",
          effectiveMode: "hybrid",
          llmAvailable: true,
          spentUsd: 0.12,
          budgetCapUsd: 5,
          requests: 4,
          maxRequests: 100,
          budgetUtilization: 0.024,
          llmCalls: 4,
          cannedCalls: 20,
          exactGuardCalls: 2,
          cacheHits: 1,
          cassetteHits: 0,
          cacheHitRate: 0.25,
          cannedFallbackCount: 0,
          leakBlockedCount: 0,
          errorCount: 0,
          avgLatencyMs: 80,
          inFlight: 0,
        },
      },
    };
    store.setUI({ drawer: "metrics", drawerOpen: true, drawerSize: "compact" });

    await act(async () => { root.render(createElement(Drawer)); });
    const fullBtn = [...box.querySelectorAll("button")].find(b => b.getAttribute("aria-label") === "Full screen drawer")!;
    expect(fullBtn).toBeTruthy();
    await act(async () => { fullBtn.click(); });
    expect(store.ui.drawerSize).toBe("full");

    await wait(() => (box.textContent ?? "").includes("Activity & outcome trends"), "overview trends");
    const clickText = async (label: string) => {
      const btn = [...box.querySelectorAll("button")].find(b => b.textContent?.includes(label));
      expect(btn, `button ${label}`).toBeTruthy();
      await act(async () => { btn!.click(); });
    };
    await clickText("Cohorts");
    await wait(() => (box.textContent ?? "").includes("2026-W46"), "cohort matrix");

    await clickText("Demand & Heatmap");
    await wait(() => (box.textContent ?? "").includes("warm_v2") && (box.textContent ?? "").includes("climbing"), "heatmap & demand");

    await clickText("Trajectories");
    await wait(() => (box.textContent ?? "").includes("tr_demo_001") && (box.textContent ?? "").includes("review_judge"), "trajectories waterfall");

    await clickText("Explorer");
    await wait(() => (box.textContent ?? "").includes("Verified signups") && (box.textContent ?? "").includes("SQL"), "slice explorer with SQL");

    await act(async () => { store.setUI({ drawer: "game", drawerOpen: true }); });
    await wait(() => (box.textContent ?? "").includes("Mock HTTP Traffic & Chaos"), "game sub-tab");
    await clickText("Mock HTTP Traffic & Chaos");
    await wait(() => (box.textContent ?? "").includes("/v1/messages") && (box.textContent ?? "").includes("429"), "mock traffic table");

    const controls: Record<string, unknown>[] = [];
    const origControlRaw = store.controlRaw.bind(store);
    store.controlRaw = async cmd => { controls.push(cmd); return { ok: true }; };
    try {
      await act(async () => { store.setUI({ drawer: "safety", drawerOpen: true }); });
      await wait(() => (box.textContent ?? "").includes("Stop teen introductions"), "teen switch");
      await clickText("Stop teen introductions");
      await wait(() => (box.textContent ?? "").includes("Confirm stop"), "confirm stop");
      await clickText("Confirm stop");
      await wait(() => controls.some(c => c.type === "teen_stop"), "teen_stop sent");
      expect(controls.find(c => c.type === "teen_stop")).toMatchObject({ type: "teen_stop", stop: true });
    } finally {
      store.controlRaw = origControlRaw;
    }
  } finally {
    await act(async () => { root.unmount(); await sleep(30); });
    Object.assign(store, before);
    globalThis.fetch = nativeFetch;
    await api.stop(true);
    await window.happyDOM.close();
    restore();
  }
});
