// The real console (main.tsx with its panels and drawer) against controlled localhost HTTP, driven
// by DOM events. Each case is a bug in the views. The decisions run in web/logic/views.ts and
// web/logic/filters.ts; these cases check that the shell calls them. Leaflet is a fake, and happy-dom
// is not a browser: layout and image bytes are outside this file.
import { afterAll, beforeAll, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

const chain = (): any => new Proxy(function () {}, { get: (t: any, k: string) => (k === "then" ? undefined : k === "getZoom" ? () => 12 : (t[k] ??= () => chain())) });
mock.module("leaflet", () => ({ default: new Proxy({}, { get: () => () => chain() }) }));
mock.module("leaflet/dist/leaflet.css", () => ({}));

const T = 1_800_000_000_000, H = 3_600_000;
const member = (id: string, o: object = {}) => ({ id, name: `Maya ${id}`, area: "Astoria", city: "nyc", state: "active", joined: true, minor: false, trust: "ok", counters: { msgsIn: 0, msgsOut: 0, proposals: 0, meetings: 0, accepted: 0 }, ...o });
const stateOf = (members: any[], extra: object = {}) => ({
  version: 1, env: { label: "LOCAL", world: "real", capabilities: { readOnly: true, staffActions: false, canIntervene: false, canStep: false, hiddenTruth: false } },
  clock: { now: T, start: T - 30 * 24 * H, playing: true },
  stats: { joined: members.length, messages: 0, proactive: 0, attended: 0, noShows: 0, cancelledWithNotice: 0, enjoymentN: 0, enjoymentSum: 0, invites: 0, accepts: 0, optOuts: 0, blocks: 0, invariantViolations: 0, edgesByType: {}, alerts: [] },
  engineRuns: [], network: { kind: "consent", counters: {}, gateReasons: {}, requests: { total: 0, fulfilled: 0, plans: 0, waiting: 0, probing: 0 } }, requests: [], members, edges: [], opportunities: [], feed: [], ...extra,
});
const ADULT = { app: "slop", adult: true, ageVerified: true, photos: "reason_required", prefs: { hidden: true, count: 2 } };
const MINOR = { ...ADULT, adult: false, ageVerified: false, photos: "never_minor" };

let roles = ["safety"], state: any = stateOf([member("m1")]), appRule: any = ADULT;
/** With `holdApp` every member app read waits here, with the rule it would answer. */
let holdApp = false, appReads: { rule: any; go(): void }[] = [];
const searches: Record<string, () => void> = {};
const api: { url: URL; stop(force: boolean): unknown } = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: async (req): Promise<Response> => {
  const u = new URL(req.url), p = u.pathname;
  if (p === "/api/mode") return Response.json({ mode: "real" });
  if (p === "/api/me") return Response.json({ id: "s", roles, grants: roles.map(role => ({ role, app: "*" })), via: "token" });
  if (p === "/api/state") return Response.json(state);
  if (p === "/api/ws-ticket") return Response.json({ error: "No live socket in this fixture" }, { status: 403 });
  if (p === "/api/reveal") return Response.json([]);
  if (p === "/api/member/m1") return Response.json({ member: state.members[0], profile: {}, facets: [], intents: [], presence: [], edges: [], opportunities: [], messages: [] });
  if (p === "/api/member/m1/timeline") return Response.json({ entries: [], pending: [] });
  if (p === "/api/member/m1/app") {
    const rule = appRule;
    if (holdApp) await new Promise<void>(go => appReads.push({ rule, go }));
    return Response.json(rule);
  }
  if (p === "/api/member/m1/photos") return Response.json({ ok: true, photos: [{ id: "ph1", url: `${api.url.href}ph1.jpg` }] });
  if (p === "/api/search") {
    const q = u.searchParams.get("q")!;
    await new Promise<void>(go => { searches[q] = go; });
    return Response.json([{ memberId: "m1", memberName: "Maya m1", t: T, kind: "message", snippet: `hit for ${q}` }]);
  }
  return Response.json({});
} });

const window = new Window({ url: api.url.href }), nativeFetch = globalThis.fetch, nativeNow = Date.now, prior = new Map<string, PropertyDescriptor | undefined>();
const dropWebModules = () => { for (const k of Object.keys(require.cache)) if (k.includes("/observatory/web/")) delete require.cache[k]; };
let store: any, app: any;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (check: () => unknown, what: string) => { for (let i = 0; i < 200; i++) { if (check()) return; await sleep(5); } throw Error(`timed out: ${what}. Page: ${app.textContent?.slice(0, 400)}`); };
const all = (sel: string) => [...app.querySelectorAll(sel)] as any[];
const texts = (sel: string) => all(sel).map(e => e.textContent.trim());
const kpi = (label: string) => all(".kpi").find(e => e.textContent.includes(label));
const typeInto = (el: any, v: string) => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, v); el.dispatchEvent(new window.Event("input", { bubbles: true })); };
const search = () => app.querySelector("#obs-search");
const enter = (shiftKey: boolean) => search().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", shiftKey, bubbles: true }));
const notified = async () => { store.notify(); await sleep(40); };
const photoReason = () => all("input").find(i => i.getAttribute("aria-label") === "Reason to see photos");
const ageLine = () => texts(".inspector .small").find(x => x.startsWith("Under 18") || x.startsWith("Adult"));

async function open(r: string[], s: any) {
  roles = r; state = s; store.me = undefined;
  await store.load();
  await sleep(40);
}
async function openMember() {
  store.focus({ kind: "member", id: "m1" });
}
async function showPhotos() {
  await until(photoReason, "the photo form");
  typeInto(photoReason(), "safety check");
  await sleep(20);
  photoReason().closest("form").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await until(() => app.querySelector(".photos img"), "the gallery");
}

beforeAll(async () => {
  window.document.body.innerHTML = '<div id="root"></div>';
  for (const [name, value] of Object.entries({ window, document: window.document, navigator: window.navigator, location: window.location, history: window.history, localStorage: window.localStorage, sessionStorage: window.sessionStorage, HTMLElement: window.HTMLElement, Element: window.Element, Node: window.Node, requestAnimationFrame: (): number => 0, cancelAnimationFrame: (): void => {} })) {
    prior.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  }
  window.sessionStorage.setItem("obs.token", "fixture-safety-token");
  window.localStorage.setItem("obs.disclosure.app-slop", "1");
  globalThis.fetch = ((input: any, init?: RequestInit) => nativeFetch(typeof input === "string" ? new URL(input, api.url) : input, init)) as typeof fetch;
  dropWebModules();
  ({ store } = await import("../web/store.ts"));
  store.app = "slop";
  await import("../web/main.tsx");
  app = window.document.getElementById("root");
  await until(() => app.querySelector("#obs-search"), "the console");
});
afterAll(async () => {
  dropWebModules();
  globalThis.fetch = nativeFetch; Date.now = nativeNow;
  app.remove();
  await sleep(40);
  api.stop(true);
  await window.happyDOM.close();
  for (const [name, d] of prior) { if (d) Object.defineProperty(globalThis, name, d); else delete (globalThis as any)[name]; }
});
beforeEach(async () => {
  Date.now = nativeNow; holdApp = false; appReads = []; appRule = ADULT;
  store.clearFocus();
  store.setFilters({ range: "all", borough: "all", members: "all", origin: "all", stateGroup: "all" });
  store.setUI({ query: "", drawer: "feed", drawerOpen: false, picks: [] });
  await sleep(10);
});

test("a person who becomes a minor loses a loaded photo at once, and it does not come back", async () => {
  await open(["safety"], stateOf([member("m1", { age: 30 })]));
  await openMember();
  await showPhotos();
  // The store knows first: the rule on the panel is an older detail read, and it still allows photos.
  store.members.get("m1").minor = true;
  await notified();
  expect(app.querySelector(".photos img")).toBeNull();
  expect(photoReason()).toBeUndefined();
  // The state is gone, not only hidden: a later adult record asks for a new logged reason.
  store.members.get("m1").minor = false;
  await notified();
  expect(app.querySelector(".photos img")).toBeNull();
  await until(photoReason, "the form again");
});

test("a rule that refuses also drops a loaded photo", async () => {
  await open(["safety"], stateOf([member("m1", { age: 30 })]));
  await openMember();
  await showPhotos();
  appRule = MINOR;
  Date.now = () => nativeNow() + 10_000;
  store.members.get("m1").counters.msgsIn = 7;
  await notified();
  await until(() => ageLine()?.startsWith("Under 18"), "the new rule");
  expect(app.querySelector(".photos img")).toBeNull();
  store.members.get("m1").counters.msgsIn = 0;
});

test("a role that goes also drops a loaded photo", async () => {
  await open(["safety"], stateOf([member("m1", { age: 30 })]));
  await openMember();
  await showPhotos();
  store.me = { ...store.me, roles: ["reviewer"], grants: [{ role: "reviewer", app: "*" }] };
  await notified();
  expect(app.querySelector(".photos img")).toBeNull();
});

test("an older detail read cannot replace a newer one", async () => {
  await open(["safety"], stateOf([member("m1", { age: 30 })]));
  holdApp = true;
  store.focus({ kind: "member", id: "m1" });
  await until(() => appReads.length === 1, "the first read");
  // The member turns under 18 while the first read waits. The key changes, and the gap of 3 s has passed.
  appRule = MINOR;
  Date.now = () => nativeNow() + 10_000;
  store.members.get("m1").counters.msgsIn = 9;
  await notified();
  await until(() => appReads.length === 2, "the second read");
  appReads[1]!.go();
  await until(() => ageLine()?.startsWith("Under 18"), "the newer read");
  appReads[0]!.go();
  await sleep(60);
  expect(ageLine()).toStartWith("Under 18");
  expect(photoReason()).toBeUndefined();
});

test("a late search answer does not show under a new query, and Enter does not open it", async () => {
  await open(["safety"], stateOf([member("m1")]));
  typeInto(search(), "ab");
  await sleep(60);
  enter(true);
  await until(() => searches.ab, "the search for ab");
  typeInto(search(), "abc");
  await sleep(60);
  searches.ab!();
  await sleep(60);
  expect(texts(".snippet")).toEqual([]);
  enter(false);
  await sleep(20);
  expect(store.ui.focus).toBeFalsy();
  // The answer for the query on screen still lands.
  await until(() => searches.abc, "the search for abc");
  searches.abc!();
  await until(() => texts(".snippet").length, "the abc answer");
  expect(texts(".snippet")).toEqual(["hit for abc"]);
});

test("back during a search stops the late answer", async () => {
  await open(["safety"], stateOf([member("m1")]));
  delete searches.back;
  typeInto(search(), "back");
  await sleep(60);
  enter(true);
  await until(() => searches.back, "the search");
  all(".search-head button")[0].click();
  await sleep(20);
  searches.back!();
  await sleep(60);
  expect(texts(".search-head")).toEqual([]);
});

test("the filter bar dims for the tab on screen, not for a saved tab that this viewer cannot open", async () => {
  await open(["reviewer"], stateOf([member("m1")]));
  store.setUI({ drawer: "game", drawerOpen: true });
  await until(() => texts(".drawer-tabs .tab.active").length, "the active tab");
  expect(texts(".drawer-tabs .tab.active")).toEqual(["Feed"]);
  expect(all(".fb-item.na").map(e => e.getAttribute("title"))).toEqual(["Does not apply to Feed"]);
  store.setUI({ drawer: "engine" });
  await sleep(40);
  expect(all(".fb-item.na").length).toBe(4);
});

test("guard events show on the Safety tab and in the Safety segment, and the origin filter does not hide them", async () => {
  const guard = { seq: 1, t: T - 1000, kind: "guard", text: "Leak guard stopped a message to Maya m1", members: ["m1"], severity: "warn" };
  await open(["reviewer"], stateOf([member("m1")], { feed: [guard] }));
  store.setUI({ drawer: "safety", drawerOpen: true });
  await until(() => app.querySelector(".safety"), "the Safety tab");
  await until(() => texts(".safety .feed-kind").length, "the guard event");
  expect(texts(".safety .feed-kind")).toEqual(["guard"]);
  store.setFilters({ origin: "engine" });
  await sleep(40);
  expect(texts(".safety .feed-kind")).toEqual(["guard"]);
  store.setFilters({ origin: "all" });
  store.setUI({ drawer: "feed" });
  await until(() => app.querySelector(".feed"), "the Feed tab");
  all(".feed .seg button").find(b => b.textContent === "Safety").click();
  await sleep(40);
  expect(texts(".feed-item .feed-kind")).toEqual(["guard"]);
});

test("the Meetings tile follows the origin filter, and Everyone-yes counts from the shared tables", async () => {
  const opp = (id: string, origin: string, o: object) => ({ id, kind: "intro", state: "COMPLETED", source: "network", origin, category: "social", city: "nyc", participants: ["m1", "m2"], createdAt: T - 24 * H, updatedAt: T - H, meetingAt: T - H, score: 0, explanations: {}, objective: "", ...o });
  await open(["reviewer"], stateOf([member("m1"), member("m2")], { opportunities: [
    opp("o1", "request", { status: { m1: "attended", m2: "no_show" } }),
    opp("o2", "engine", { status: { m1: "accepted", m2: "declined" } }),
    opp("o3", "engine", { state: "IN_REVIEW", status: { m1: "pending", m2: "pending" } }),
  ] }));
  await until(() => kpi("Meetings"), "the tiles");
  expect(kpi("Meetings").textContent).toContain("2");
  expect(kpi("Everyone-yes").textContent).toContain("50%");
  expect(kpi("Everyone-yes").title).toStartWith("Of 2 ");
  store.setFilters({ origin: "engine" });
  await sleep(40);
  expect(kpi("Meetings").textContent).toContain("1");
  expect(kpi("Meetings").textContent).not.toContain("2");
  expect(kpi("Everyone-yes").textContent).toContain("0%");
  expect(kpi("Everyone-yes").title).toStartWith("Of 1 ");
});

test("the consent ladder never shows a rate above 100%, and a pair with no base shows a dash", async () => {
  await open(["reviewer"], stateOf([member("m1")], {
    stats: { ...stateOf([]).stats, meetingsHeld: 3 },
    network: { kind: "consent", counters: { scheduled: 2, revealYes: 2, reveals: 3 }, gateReasons: {}, requests: { total: 0, fulfilled: 0, plans: 0, waiting: 0, probing: 0 } },
  }));
  store.setUI({ drawer: "pipeline", drawerOpen: true });
  await until(() => app.querySelector(".ladder"), "the ladder");
  const title = (k: string) => all(".ladder > span").find(e => e.textContent.includes(k)).title;
  expect(title("met")).toBe("100% of scheduled");
  expect(title("revealed")).toStartWith("Invite yes rate 67%");
  expect(title("passed gate")).toStartWith("– passed");
});

test("a booked plan reads per member", async () => {
  const booked = { at: T + 72 * H, optOutHours: 48, told: { m1: T - H, m2: T - 49 * H, m3: T - H }, cancelled: { m3: { at: T - H, told: true } } };
  const o = { id: "o1", kind: "intro", state: "SCHEDULED", source: "network", origin: "engine", category: "social", city: "nyc", participants: ["m1", "m2", "m3", "m4"], status: { m1: "accepted", m2: "accepted", m3: "accepted", m4: "accepted" }, createdAt: T - 24 * H, updatedAt: T - H, score: 0, explanations: {}, enjoyment: {}, alternates: [], objective: "", booked };
  await open(["reviewer"], stateOf(["m1", "m2", "m3", "m4"].map(id => member(id)), { opportunities: [o] }));
  store.focus({ kind: "opportunity", id: "o1" });
  const rows = () => all(".participant").map(e => e.textContent as string).filter(x => /opt-out closes|confirmed|called off|not told yet/.test(x));
  await until(() => rows().length === 4, "the plan rows");
  const [open1, confirmed, off, notTold] = rows();
  expect(open1).toContain("opt-out closes in 1d 23h");
  expect(confirmed).toContain("confirmed");
  expect(off).toContain("called off");
  expect(notTold).toContain("not told yet");
});

test("a minor or a pick that the store does not know cannot be proposed", async () => {
  const game = { sparksLeft: 2, sparksPerDay: 3, strikes: 0, maxStrikes: 3, over: false, prompts: [], controlled: [], scores: [] };
  const base = stateOf([member("m1"), member("m2"), member("m3", { minor: true })], { game });
  await open(["reviewer"], { ...base, env: { ...base.env, capabilities: { ...base.env.capabilities, canIntervene: true } } });
  const propose = () => all(".tray-form button").find(b => b.textContent.startsWith("Propose"));
  store.setUI({ picks: ["m1", "m2"] });
  await until(propose, "the propose button");
  expect(propose().disabled).toBe(false);
  store.setUI({ picks: ["m1", "m3"] });
  await sleep(40);
  expect(propose().disabled).toBe(true);
  store.setUI({ picks: ["m1", "ghost"] });
  await sleep(40);
  expect(propose().disabled).toBe(true);
});
