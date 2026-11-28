import { setTimeout as sleep } from "node:timers/promises";
import { act, createElement } from "react";
import { Window } from "happy-dom";
import { expect, test, vi } from "vitest";
import { serveHttp } from "../../../packages/core/src/runtime/http.ts";
import { installDom } from "./dom.ts";

type CheckResult = { ok: true; data: { pass: boolean; checks: { name: string; pass: boolean; detail: string }[] } };
const checkResult = (name: string): CheckResult => ({ ok: true, data: { pass: true, checks: [{ name, pass: true, detail: "" }] } });

test("reset invalidates a pending level check and clears a completed check when the world resets elsewhere", async () => {
  const oldCheck = Promise.withResolvers<CheckResult>();
  const newCheck = Promise.withResolvers<CheckResult>();
  const controls: { type: string; scenario?: string | null; network?: string }[] = [];
  let checkCalls = 0;
  const scenario = { id: "test-level", title: "Test level", description: "Simulation fixture", days: 1 };
  const api = await serveHttp({
    hostname: "127.0.0.1", port: 0,
    fetch: async req => {
      const u = new URL(req.url);
      if (u.pathname === "/api/levels") return Response.json([scenario]);
      if (u.pathname === "/api/control") {
        const body = await req.json() as { type: string; scenario?: string | null; network?: string };
        controls.push(body);
        if (body.type === "reset") return Response.json({ ok: true });
        if (body.type === "check_scenario") {
          checkCalls++;
          return Response.json(await (checkCalls === 1 ? oldCheck.promise : newCheck.promise));
        }
      }
      return Response.json({ error: "unexpected" }, { status: 404 });
    },
  });
  const window = new Window({ url: api.url.href });
  const nativeFetch = globalThis.fetch;
  const restoreDom = installDom(window, {
    window, document: window.document, navigator: window.navigator,
    location: window.location, history: window.history,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage,
    CustomEvent: window.CustomEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    nativeFetch(typeof input === "string" ? new URL(input, api.url) : input, init)) as typeof fetch;
  const box = window.document.createElement("div");
  window.document.body.appendChild(box);
  const { createRoot } = await import("react-dom/client");
  const root = createRoot(box as unknown as HTMLElement);
  const wait = async (check: () => boolean, label: string) => {
    for (let i = 0; i < 400; i++) { if (check()) return; await act(async () => { await sleep(5); }); }
    throw Error(`timed out waiting for ${label}\nBOX: ${box.textContent ?? ""}`);
  };
  const { store } = await import("../web/store.ts");
  const { Levels } = await import("../web/network.tsx");
  store.mode = "game";
  store.app = "ntwrk";
  store.env = {
    mode: "game", app: "ntwrk", label: "SIM", dataset: "sim",
    capabilities: { canStep: true, canIntervene: true, hiddenTruth: false, readOnly: false },
  };
  store.me = { id: "staff", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token" } as typeof store.me;
  store.game = {
    score: 0, over: false, missions: [], prompts: [], sparksLeft: 0, lensUsed: false, peeks: 0,
  } as unknown as typeof store.game;
  store.network = {
    scenario: { id: scenario.id, title: scenario.title, description: scenario.description },
  } as unknown as typeof store.network;
  const button = (label: string) => {
    const found = [...box.querySelectorAll("button")].find(node => node.textContent?.startsWith(label));
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
  };
  try {
    await act(async () => { root.render(createElement(Levels)); });
    await wait(() => [...box.querySelectorAll("button")].some(b => b.textContent?.startsWith("Test level")), "levels loaded");
    await act(async () => { button("Check level").click(); });
    await wait(() => checkCalls === 1, "first check request sent");
    await act(async () => { button("Test level").click(); });
    await wait(() => controls.some(c => c.type === "reset"), "reset request sent");
    expect(controls[1]).toEqual({ type: "reset", scenario: "test-level", network: "consent" });

    await act(async () => { oldCheck.resolve(checkResult("Old world result")); await sleep(20); });
    expect(box.textContent).not.toContain("Old world result");

    await act(async () => { button("Check level").click(); });
    await wait(() => checkCalls === 2, "second check request sent");
    await act(async () => { newCheck.resolve(checkResult("Fresh world result")); });
    await wait(() => (box.textContent ?? "").includes("Fresh world result"), "fresh result rendered");

    const reload = vi.spyOn(store, "load").mockImplementation(async () => { store.notify(); });
    try {
      await act(async () => {
        store["applyDelta"]({ version: 0, clock: { now: 0, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false } });
        await sleep(40);
      });
      expect(reload).toHaveBeenCalledOnce();
      expect(box.textContent).toContain("Fresh world result");
      await act(async () => {
        store["applyDelta"]({ reset: true, version: 0, clock: { now: 0, start: 0, day: 1, playing: false, speed: 0, waitingForPlayer: false } });
        await sleep(40);
      });
      expect(reload).toHaveBeenCalledTimes(2);
      expect(box.textContent).not.toContain("Fresh world result");
    } finally {
      reload.mockRestore();
    }
  } finally {
    await act(async () => { root.unmount(); await sleep(40); });
    globalThis.fetch = nativeFetch;
    await api.stop(true);
    await window.happyDOM.close();
    restoreDom();
  }
});
