// The console's store against a scripted API and a fake socket: load races, deltas, app switches,
// filters, reveals and roles. Each case drives the real ObsStore through fetch and socket messages.
// The decisions run in web/logic/sync.ts and web/logic/filters.ts. No browser and no real server;
// the feed overlap case uses the real server Store. Each case makes a new ObsStore.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { allowed } from "../src/staff.ts";
import { Store } from "../src/store.ts";

const window = new Window({ url: "http://obs.test/" });
const prior = new Map<string, PropertyDescriptor | undefined>();
const nativeFetch = globalThis.fetch, nativeSetTimeout = globalThis.setTimeout;
const put = (name: string, value: unknown) => {
  if (!prior.has(name)) prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
};

class FakeSocket {
  static all: FakeSocket[] = [];
  onopen?: () => void; onclose?: (ev: { code: number }) => void; onmessage?: (ev: { data: string }) => void;
  closed = false;
  constructor(public url: string) { FakeSocket.all.push(this); }
  close() { this.closed = true; this.onclose?.({ code: 1000 }); }
}

/** The test files share one process: the next file's first import must make its own store (it reads the token then). */
const dropWebModules = () => { for (const k of Object.keys(require.cache)) if (k.includes("/observatory/web/")) delete require.cache[k]; };

let ObsStore: new () => any;
beforeAll(async () => {
  for (const [name, value] of Object.entries({ window, document: window.document, navigator: window.navigator, location: window.location, history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage, HTMLElement: window.HTMLElement, WebSocket: FakeSocket })) put(name, value);
  // The reconnect delays are 1.5 s and 3 s: the same order, 20 times faster.
  globalThis.setTimeout = ((f: () => void, ms?: number) => nativeSetTimeout(f, (ms ?? 0) / 20)) as typeof setTimeout;
  ObsStore = (await import("../web/store.ts")).store.constructor as new () => any;
});
afterAll(async () => {
  dropWebModules();
  globalThis.fetch = nativeFetch; globalThis.setTimeout = nativeSetTimeout;
  await window.happyDOM.close();
  for (const [name, d] of prior) { if (d) Object.defineProperty(globalThis, name, d); else delete (globalThis as Record<string, unknown>)[name]; }
});

const J = (body: unknown, status = 200) => Response.json(body, { status });
const defer = <T,>() => { let open!: (v: T) => void; const p = new Promise<T>(r => { open = r; }); return { p, open }; };
const tick = () => Bun.sleep(4);
const opp = (id: string, state: string, over: object = {}) => ({ id, state, participants: ["a", "b"], source: "engine", origin: "engine", status: {}, updatedAt: 1, createdAt: 1, ...over });
const member = (id: string, over: object = {}) => ({ id, name: id, area: "Astoria", joined: true, state: "active", trust: "ok", minor: false, community: "c", counters: { meetings: 0, accepted: 0, proposals: 0 }, ...over });
const stateAt = (version: number, over: object = {}) => ({ env: { capabilities: { staffActions: true } }, clock: { now: 1000 }, stats: {}, engineRuns: [], members: [], edges: [], opportunities: [], feed: [], version, ...over });
const ME = { id: "r", roles: ["admin"], grants: [{ role: "admin", app: "*" }], via: "token", apps: ["ntwrk", "slop"], appInfo: [{ id: "ntwrk" }, { id: "slop" }] };

/** A store with the default API. `route` answers first: a Response, a promise of one, an Error to throw, or undefined for the default. */
function open(route: (path: string, url: URL, init?: RequestInit) => unknown = () => undefined, href = "http://obs.test/") {
  window.happyDOM.setURL(href); window.localStorage.clear(); window.sessionStorage.clear();
  const calls: string[] = [];
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input, "http://obs.test"), path = url.pathname;
    calls.push(`${init?.method ?? "GET"} ${path}`);
    const r = await route(path, url, init);
    if (r instanceof Error) throw r;
    if (r instanceof Response) return r;
    if (path === "/api/mode") return J({ mode: "real" });
    if (path === "/api/me") return J(ME);
    if (path === "/api/reveal") return J([]);
    if (path === "/api/ws-ticket") return J({ ticket: "t" });
    if (path === "/api/state") return J(stateAt(1));
    return J({ error: "unexpected" }, 404);
  }) as typeof fetch;
  FakeSocket.all = [];
  const store = new ObsStore();
  const socket = async () => { await store.connect(); const ws = FakeSocket.all.at(-1)!; ws.onopen?.(); return ws; };
  const send = (ws: FakeSocket, delta: object) => ws.onmessage?.({ data: JSON.stringify({ type: "delta", mode: "real", app: store.app, delta }) });
  const count = (call: string) => calls.filter(c => c === call).length;
  return { store, socket, send, calls, count };
}

test("a slow load of the old app cannot overwrite the new app", async () => {
  const slow = defer<Response>();
  const t = open((path, url) => path === "/api/state" ? (url.searchParams.get("app") === "ntwrk" ? slow.p : J(stateAt(1, { opportunities: [opp("slop-opp", "IN_REVIEW")] }))) : undefined);
  const first = t.store.load(); await tick();
  t.store.setApp("slop"); await tick(); await tick();
  slow.open(J(stateAt(9, { opportunities: [opp("ntwrk-opp", "IN_REVIEW")], stats: { old: 1 } })));
  await first; await tick();
  expect(t.store.app).toBe("slop");
  expect([...t.store.opps.keys()]).toEqual(["slop-opp"]);
  expect(t.store.version).toBe(1);
});

test("an older load does not end the buffer of a newer load", async () => {
  const a = defer<Response>(), b = defer<Response>();
  let reads = 0;
  const t = open(path => path === "/api/state" ? (++reads === 1 ? a.p : b.p) : undefined);
  const ws = await t.socket();
  const first = t.store.load(); await tick();
  const second = t.store.load(); await tick();
  const inReview = () => J(stateAt(5, { opportunities: [opp("o1", "IN_REVIEW")] }));
  a.open(inReview()); await first; await tick();
  t.send(ws, { version: 6, clock: { now: 2 }, opportunities: [opp("o1", "INVITING")] });
  b.open(inReview()); await second; await tick();
  expect([t.store.opps.get("o1").state, t.store.version]).toEqual(["INVITING", 6]);
});

test("an old delta does not rewind an item or the version", async () => {
  const t = open(path => path === "/api/state" ? J(stateAt(10, { opportunities: [opp("o1", "INVITING")] })) : undefined);
  const ws = await t.socket(); await t.store.load();
  t.send(ws, { version: 8, clock: { now: 2 }, opportunities: [opp("o1", "IN_REVIEW")] });
  expect([t.store.opps.get("o1").state, t.store.version]).toEqual(["INVITING", 10]);
});

test("a delta at the state's version is not applied twice, and it still updates the clock and game", async () => {
  const gate = defer<Response>();
  const t = open(path => path === "/api/state" ? gate.p : undefined);
  const ws = await t.socket();
  const load = t.store.load(); await tick();
  t.send(ws, { version: 5, clock: { now: 2000 }, game: { day: 2 }, feed: [{ seq: 7, t: 1, kind: "block", text: "x" }] });
  gate.open(J(stateAt(5, { feed: [{ seq: 7, t: 1, kind: "block", text: "x" }] }))); await load;
  expect(t.store.feed.map((x: { seq: number }) => x.seq)).toEqual([7]);
  expect([t.store.game.day, t.store.clock.now]).toEqual([2, 2000]);
});

test("a same-version push from the real server store still moves the game and the clock, and no data", async () => {
  const srv = new Store({ capabilities: {} } as never, { now: 1000, start: 0, day: 1, playing: true, speed: 1 } as never);
  srv.pushFeed({ t: 1, kind: "block", text: "x" } as never);
  const snap = JSON.parse(JSON.stringify({ ...srv.snapshot(), engineRuns: [] }));
  const d1 = srv.takeDelta({ day: 1 } as never);
  srv.clock.now = 2000;
  const d2 = JSON.parse(JSON.stringify(srv.takeDelta({ day: 2 } as never)));
  expect(d2.version).toBe(d1.version);
  const t = open(path => path === "/api/state" ? J({ ...snap, version: d1.version }) : undefined);
  const ws = await t.socket(); await t.store.load();
  t.send(ws, { ...d2, opportunities: [opp("late", "INVITING")] });
  expect([t.store.game.day, t.store.clock.now, t.store.opps.size]).toEqual([2, 2000, 0]);
});

test("a state that already holds part of the next delta shows each feed item once", async () => {
  const srv = new Store({ capabilities: {} } as never, { now: 1000, start: 0, day: 1, playing: true, speed: 1 } as never);
  srv.pushFeed({ t: 1, kind: "block", text: "a" } as never); srv.takeDelta();
  srv.pushFeed({ t: 2, kind: "block", text: "b" } as never);
  const snap = JSON.parse(JSON.stringify({ ...srv.snapshot(), engineRuns: [] }));
  const d = JSON.parse(JSON.stringify(srv.takeDelta()));
  const t = open(path => path === "/api/state" ? J(snap) : undefined);
  const ws = await t.socket(); await t.store.load();
  t.send(ws, d);
  expect(t.store.feed.map((x: { seq: number }) => x.seq)).toEqual([1, 2]);
});

test("a reconnect through the ticket retry reads the full state, and a failed read reloads on the next delta", async () => {
  let down = true, reads = 0;
  const t = open(path => {
    if (path === "/api/state") { reads++; return down ? new Error("server down") : J(stateAt(1, { feed: [{ seq: 1, t: 1, kind: "block", text: "new" }] })); }
    if (path === "/api/ws-ticket" && down) return J({ error: "down" }, 503);
  });
  await t.store.connect();
  down = false;
  for (let i = 0; i < 40 && !t.store.feed.length; i++) await Bun.sleep(10);
  expect(reads).toBe(1);
  expect(t.store.feed.length).toBe(1);

  // The server restarted while a read failed: the version here is too high, so the next delta must reload.
  let restarted = false;
  const r = open(path => path === "/api/state" ? (restarted ? J(stateAt(2, { opportunities: [opp("fresh", "INVITING")] })) : restarted === false && r.count("GET /api/state") === 1 ? J(stateAt(50)) : new Error("down")) : undefined);
  const ws = await r.socket(); await r.store.load();
  await r.store.load();
  restarted = true;
  r.send(ws, { version: 2, clock: { now: 2 } });
  for (let i = 0; i < 40 && !r.store.opps.size; i++) await Bun.sleep(10);
  expect([...r.store.opps.keys()]).toEqual(["fresh"]);
});

test("the live indicator goes off when a reconnect cannot get a ticket", async () => {
  let refuse = false;
  const t = open(path => path === "/api/ws-ticket" && refuse ? J({ error: "no" }, 403) : undefined);
  await t.socket();
  expect(t.store.connected).toBe(true);
  refuse = true;
  await t.store.connect();
  expect(t.store.connected).toBe(false);
});

test("an error from /api/state leaves the good state and the buttons in place", async () => {
  let fail = false;
  const t = open(path => path === "/api/state" ? (fail ? J({ error: "state failed" }, 500) : J(stateAt(3, { members: [member("a")] }))) : undefined);
  await t.store.load();
  expect(t.store.canReview()).toBe(true);
  fail = true;
  await t.store.load();
  expect(t.store.env).toBeDefined();
  expect(t.store.runs).toEqual([]);
  expect(t.store.canReview()).toBe(true);
  expect(t.store.ui.toast.text).toBe("Could not load: state failed");
});

test("a failed /api/me grants no role", async () => {
  const t = open(path => path === "/api/me" ? J({ error: "boom" }, 500) : undefined);
  await t.store.load();
  expect(t.store.me).toBeUndefined();
  expect(t.store.isAdmin()).toBe(false);
  expect(t.store.can("reviewer")).toBe(false);
  expect(t.store.loading).toBe(false);
});

test("an /api/me answer with no role list grants nothing and does not throw", async () => {
  const t = open(path => path === "/api/me" ? J({ id: "x", via: "token" }) : undefined);
  await t.store.load();
  expect(t.store.can("reviewer")).toBe(false);
  expect(t.store.isAdmin()).toBe(false);
});

test("a feed item with a bad seq in the state does not stop later items", async () => {
  const t = open(path => path === "/api/state" ? J(stateAt(1, { feed: [{ seq: "9", t: 1, kind: "block", text: "bad" }] })) : undefined);
  const ws = await t.socket();
  await t.store.load();
  t.send(ws, { version: 2, clock: { now: 2 }, feed: [{ seq: 1, t: 2, kind: "block", text: "new" }] });
  await tick();
  expect(t.store.feed.map((x: { text: string }) => x.text)).toEqual(["new"]);
});

test("a person with no apps leaves no buffer behind", async () => {
  const t = open(path => path === "/api/me" ? J({ ...ME, apps: [] }) : undefined);
  const ws = await t.socket();
  await t.store.load();
  const reads = t.count("GET /api/mode");
  t.send(ws, { version: 1, clock: { now: 2 } });
  await tick();
  expect(t.count("GET /api/mode")).toBe(reads + 1); // not held in a buffer that no load will read
});

test("a failed load after an app switch keeps nothing of the old app, on any panel", async () => {
  const t = open((path, url) => {
    if (path === "/api/reveal") return J(url.searchParams.get("app") === "ntwrk" ? [{ memberId: "a", until: 9e15, reason: "x" }] : []);
    if (path !== "/api/state") return undefined;
    if (url.searchParams.get("app") === "slop") return J({ error: "bad gateway" }, 502);
    return J(stateAt(4, { stats: { blocks: 42 }, network: { review: { queued: 7 } }, requests: [{ id: "r1" }], engineRuns: [{ id: "run" }], game: { day: 3 }, truth: { a: {} }, members: [member("a")], edges: [{ id: "e", from: "a", to: "b", type: "knows" }], opportunities: [opp("o", "IN_REVIEW")] }));
  });
  await t.store.load(); await tick();
  expect(t.store.revealFor("a")).toBeDefined();
  const graph = t.store.graphTick;
  t.store.setApp("slop"); await tick(); await tick();
  const s = t.store;
  expect([s.stats, s.network, s.game, s.truth]).toEqual([undefined, undefined, undefined, undefined]);
  expect([s.requests, s.runs, s.feed]).toEqual([[], [], []]);
  expect([s.members.size, s.edges.size, s.opps.size]).toEqual([0, 0, 0]);
  expect(s.graphTick).toBeGreaterThan(graph);
  expect(s.revealFor("a")).toBeUndefined(); // the old app's PII badge goes with its data
});

test("ending a reveal keeps the badge until the server confirms", async () => {
  const grant = { memberId: "m1", until: 9e15, reason: "x" };
  let answer: unknown = J({ ok: false }, 500);
  const t = open((path, _u, init) => path === "/api/reveal" ? (init?.method === "DELETE" ? answer : J([grant])) : undefined);
  await t.store.loadReveals();
  await t.store.unreveal("m1");
  expect(t.store.reveals.length).toBe(1);
  answer = new Error("network");
  await t.store.unreveal("m1");
  expect(t.store.reveals.length).toBe(1);
  answer = J({ ok: false }, 404); // nothing to end on the server
  await t.store.unreveal("m1");
  expect(t.store.reveals.length).toBe(0);
});

const GRANT = { memberId: "m1", until: 9e15, reason: "x", at: 1 };

test("a failed reveal list read keeps the badge", async () => {
  let list: unknown = J([GRANT]);
  const t = open(path => path === "/api/reveal" ? list : undefined);
  await t.store.loadReveals();
  expect(t.store.revealFor("m1")).toBeDefined();
  list = J({ error: "boom" }, 500);
  await t.store.loadReveals();
  expect(t.store.revealFor("m1")).toBeDefined();
  list = new Error("network");
  await t.store.loadReveals();
  expect(t.store.revealFor("m1")).toBeDefined();
});

test("a reveal list read made before the grant does not remove the badge", async () => {
  const old = defer<Response>();
  const t = open((path, _u, init) => path === "/api/reveal" ? (init?.method === "POST" ? J({ ok: true, ...GRANT }) : old.p) : undefined);
  const read = t.store.loadReveals(); await tick();
  expect(await t.store.reveal("m1", "a reason", 15)).toBe(true);
  old.open(J([])); await read;
  expect(t.store.revealFor("m1")).toBeDefined();
});

test("a reveal list read made before the grant of another member is read again, so the first grant keeps its badge", async () => {
  const old = defer<Response>();
  const G2 = { ...GRANT, memberId: "m2" };
  let reads = 0;
  const t = open((path, _u, init) => path !== "/api/reveal" ? undefined
    : init?.method === "POST" ? J({ ok: true, ...G2 }) : ++reads === 1 ? old.p : J([GRANT, G2]));
  const read = t.store.loadReveals(); await tick();
  expect(await t.store.reveal("m2", "a reason", 15)).toBe(true);
  old.open(J([GRANT])); await read;
  for (let i = 0; i < 20 && !t.store.revealFor("m1"); i++) await tick();
  expect(t.store.revealFor("m1")).toBeDefined();
  expect(t.store.revealFor("m2")).toBeDefined();
});

test("a lost reveal answer reads the list again, so the badge shows the grant that the server made", async () => {
  const t = open((path, _u, init) => path === "/api/reveal" ? (init?.method === "POST" ? new Error("lost") : J([GRANT])) : undefined);
  expect(await t.store.reveal("m1", "a reason", 15)).toBe(false);
  for (let i = 0; i < 20 && !t.store.revealFor("m1"); i++) await tick();
  expect(t.store.revealFor("m1")).toBeDefined();
});

const decided = (id: string, over: object) => opp(id, "APPROVED", { review: { decision: "approve", decidedAt: 0 }, ...over });
const DAY = 86_400_000;

test("the Origin filter cannot hide a Safety event, and Feed still applies it", async () => {
  const t = open(path => path === "/api/state" ? J(stateAt(1, { clock: { now: 2 * DAY } })) : undefined);
  await t.store.load();
  const block = { seq: 1, t: 2 * DAY, kind: "block", text: "x" };
  t.store.setFilters({ origin: "engine" });
  t.store.setUI({ drawer: "safety" });
  expect(t.store.matchFeed(block)).toBe(true);
  t.store.setUI({ drawer: "feed" });
  expect(t.store.matchFeed(block)).toBe(false);
});

test("the Range filter cannot cut the Decided list", async () => {
  const t = open(path => path === "/api/state" ? J(stateAt(1, { clock: { now: 30 * DAY }, opportunities: [decided("old", { updatedAt: 5 * DAY })] })) : undefined);
  await t.store.load();
  t.store.setFilters({ range: "7d" });
  expect(t.store.reviewDecided().map((o: { id: string }) => o.id)).toEqual(["old"]);
});

test("filters keep their meaning on the panels that apply them", async () => {
  const t = open(path => path === "/api/state" ? J(stateAt(1, {
    clock: { now: 30 * DAY }, members: [member("a"), member("b", { area: "Harlem", trust: "hold" })],
    opportunities: [opp("open", "INVITING", { updatedAt: 0, participants: ["b"] }), opp("closed", "DECLINED", { updatedAt: 0, participants: ["b"], origin: "request" })],
  })) : undefined);
  await t.store.load();
  const s = t.store, o = (id: string) => s.opps.get(id);
  s.setFilters({ range: "7d", members: "all" });
  expect([s.matchOpp(o("open")), s.matchOpp(o("closed")), s.matchOpp(o("closed"), { range: true })]).toEqual([true, false, true]);
  s.setFilters({ range: "all", members: "hold" });
  expect([s.matchOpp(o("open")), s.matchFeed({ seq: 1, t: 0, kind: "block", text: "", members: ["a"] }), s.matchFeed({ seq: 2, t: 0, kind: "block", text: "", members: ["b"] })]).toEqual([true, false, true]);
  s.setFilters({ members: "all", origin: "request", stateGroup: "closed" });
  expect([s.matchOpp(o("open")), s.matchOpp(o("closed")), s.matchOpp(o("open"), { origin: true, stateGroup: true })]).toEqual([false, true, true]);
});

test("Today starts at NYC midnight on daylight-saving days", async () => {
  for (const [now, start] of [["2026-11-01T17:00:00Z", "2026-11-01T04:00:00Z"], ["2026-03-08T16:00:00Z", "2026-03-08T05:00:00Z"], ["2026-06-01T16:00:00Z", "2026-06-01T04:00:00Z"]] as const) {
    const t = open(path => path === "/api/state" ? J(stateAt(1, { clock: { now: Date.parse(now) } })) : undefined);
    await t.store.load();
    t.store.setFilters({ range: "today" });
    expect(new Date(t.store.rangeStart()).toISOString()).toBe(new Date(start).toISOString());
    expect(t.store.inRange(Date.parse(start))).toBe(true);
    expect(t.store.inRange(Date.parse(start) - 1000)).toBe(false);
  }
});

test("a mode_changed refusal keeps the review timer", async () => {
  const bodies: { secondsSpent?: number }[] = [];
  const t = open(async (path, _u, init) => {
    if (path !== "/api/control") return undefined;
    bodies.push(JSON.parse(String(init?.body)));
    return J({ ok: false, code: "mode_changed", error: "mode changed" }, 409);
  });
  t.store.reviewOpen("o1");
  const item = opp("o1", "IN_REVIEW");
  await t.store.decide(item, "approve", {}, true);
  await t.store.decide(item, "approve", {}, true);
  expect(bodies.map(b => b.secondsSpent)).toEqual([0, 0]);
});

test("an empty fragment token does not leave a query token in the address bar", () => {
  open(undefined, "http://obs.test/?token=abc#token=");
  expect(window.location.href).not.toContain("abc");
});

test("the client role check agrees with the server rule", async () => {
  const roles = ["admin", "reviewer", "safety", "engineer", "analyst", "cross_app_safety"] as const;
  const users = [
    { grants: [{ role: "reviewer", app: "ntwrk" }] }, { grants: [{ role: "engineer", app: "*" }] }, { grants: [{ role: "cross_app_safety", app: "*" }] },
    { grants: [{ role: "admin", app: "slop" }, { role: "safety", app: "*" }] }, { roles: ["engineer"] }, { roles: ["reviewer", "cross_app_safety"] }, { grants: [] },
  ];
  for (const u of users) for (const mode of ["real", "game"] as const) for (const app of ["ntwrk", "slop"]) {
    const t = open();
    t.store.me = { id: "x", roles: [], via: "token", ...u }; t.store.mode = mode; t.store.app = app;
    for (const role of roles) expect([u, mode, app, role, t.store.can(role)]).toEqual([u, mode, app, role, allowed(t.store.me, [role], app as never, mode)]);
  }
});
