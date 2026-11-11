// The Join page joins and signs in only the account that it shows (join_flow.qnt defects JF-1, JF-2, JF-3).
// The real peon.biz join.html and shared/join.ts in a DOM, against the real platform API in the same
// process. A fake OTP provider keeps each code in memory (nothing is sent). "Another tab" is a change
// of the cookie jar that this page does not see.
//   bun test --conditions eliza-source sites/test/join-account.test.ts
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "../../packages/observatory/node_modules/happy-dom";
import { createPublicApi, type PublicApi } from "../../packages/platform/src/api.ts";
import type { OtpProvider } from "../../packages/platform/src/otp.ts";
import { keyedHash } from "../../packages/platform/src/phone.ts";
import { signupAccountView } from "../../packages/platform/src/sessions.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";

const html = readFileSync(join(import.meta.dir, "../peon.biz/public/join.html"), "utf8");
const body = html.slice(html.indexOf("<body"), html.indexOf("</body>")).replace(/^<body[^>]*>/, "");
const HASH_KEY = "join-account-test-key";

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  async send() {
    return { code: "246810" };
  }
}

let mountJoin: (root: HTMLElement) => Promise<void>;
let platform: PublicApi;
let host = "";
let jar = "";
const owners = new Map<string, string>(); // cookie -> E.164
let calls: { method: string; path: string; body: string }[] = [];
// A test can hold the next answer of one path, and run a step when a path answers.
let hold: { path: string; release?: () => void; waiting?: boolean } | undefined;
let after: { path: string; run: () => void } | undefined;
let markerFor: string | undefined; // simulates /api/me giving a signupView on this app
let window: Window;
const realFetch = globalThis.fetch;

function dom(url: string): void {
  window = new Window({ url });
  const globals = { window, document: window.document, location: window.location, history: window.history, HTMLElement: window.HTMLElement, FormData: window.FormData };
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

beforeAll(async () => {
  dom("https://peon.biz/");
  ({ mountJoin } = await import("../shared/join.ts"));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function fresh(siteHost: string, app: "peon" | "friends"): void {
  host = siteHost;
  jar = "";
  owners.clear();
  calls = [];
  hold = undefined;
  after = undefined;
  markerFor = undefined;
  platform = createPublicApi({ store: new MemoryPeopleStore(), otp: new FakeOtp(), hashKey: HASH_KEY, otpLimits: { minGapMs: 0 }, env: { PLATFORM_ENV: "dev" }, hostMap: { [host]: app }, minStartMs: 0, minVerifyMs: 0, log: () => {} });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    calls.push({ method: init.method ?? "GET", path, body: init.body ? String(init.body) : "" });
    if (hold?.path === path && !hold.release) {
      hold.waiting = true;
      await new Promise<void>(resolve => { hold!.release = resolve; });
    }
    const headers = new Headers(init.headers);
    headers.set("host", host);
    if (jar) headers.set("cookie", jar);
    if (init.method === "POST") headers.set("origin", `https://${host}`);
    let res = (await platform.fetch(new Request(`https://${host}${path}`, { ...init, headers }))) ?? new Response("not found", { status: 404 });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [name, value] = pair!.split("=");
      if (!value || !name!.startsWith("sid_")) continue;
      jar = `${name}=${value}`;
      if (path === "/api/auth/otp/verify") owners.set(jar, JSON.parse(String(init.body)).phone);
    }
    if (markerFor && path === "/api/me" && res.ok) {
      const me = await res.json() as Record<string, unknown>;
      res = Response.json({ ...me, signupView: signupAccountView(markerFor, keyedHash(HASH_KEY, `phone:${owners.get(jar)}`)) });
    }
    if (after?.path === path) { const run = after.run; after = undefined; run(); }
    return res;
  }) as typeof fetch;
}

const root = () => window.document.querySelector("[data-join]") as unknown as HTMLElement;
const step = () => root().querySelector("[data-step]:not([hidden])")?.getAttribute("data-step");
const input = (name: string) => root().querySelector(`[name="${name}"]`) as unknown as HTMLInputElement;
const formOf = (name: string) => root().querySelector(`form[data-form="${name}"]`) as unknown as HTMLFormElement;
const banner = () => root().querySelector("[data-flow-error]") as unknown as HTMLElement;
const joinCalls = () => calls.filter((c) => c.path === "/api/join");

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await Bun.sleep(5);
  }
  throw new Error(`timed out: ${what} (step ${step()}, errors ${[...root().querySelectorAll("[data-error]")].map(e => e.textContent).join("|")})`);
}

async function mount(): Promise<void> {
  dom(`https://${host}/join`);
  window.document.body.innerHTML = body;
  await mountJoin(root());
  const button = formOf("phone").querySelector("button[type=submit]") as unknown as HTMLButtonElement;
  await until(() => !button.disabled, "auth mode");
  await Bun.sleep(1);
}

function submit(name: string): void {
  formOf(name).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }) as unknown as Event);
}

async function typePhone(number: string): Promise<void> {
  input("phone").value = number;
  submit("phone");
  await until(() => step() === "code", "code step");
}

async function signIn(number: string): Promise<void> {
  await typePhone(number);
  input("code").value = "246810";
  submit("code");
  await until(() => step() === "profile", "profile step");
}

function typeName(name: string, age: string): void {
  for (const [field, value] of [["firstName", name], ["age", age]] as const) {
    input(field).value = value;
    input(field).dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  }
}

const tick = () => input("consent").click();

/** Signs a person in on a fresh page, and returns the cookie of that session. */
async function sessionOf(number: string): Promise<string> {
  jar = "";
  await mount();
  await signIn(number);
  return jar;
}

describe("Join signs in and joins only the shown account", () => {
  test("JF-1: a sign-in takes the account that /api/me reads, not the number on screen", async () => {
    fresh("peon.biz", "peon");
    const cookieA = await sessionOf("212 555 0162");
    // B signs in on this page and types; the session then ends.
    jar = "";
    await mount();
    await signIn("212 555 0161");
    typeName("Bea", "30");
    jar = "";
    tick();
    submit("profile");
    await until(() => step() === "phone", "phone step");
    // B signs in again, but another tab signs in as A between verify and /api/me.
    after = { path: "/api/auth/otp/verify", run: () => { jar = cookieA; } };
    await signIn("212 555 0161");
    expect(owners.get(jar)).toBe("+12125550162");
    // The page is A's session: B's fields must not be on the form.
    expect(input("firstName").value).toBe("");
    expect(input("age").value).toBe("");
  });

  test("JF-1: change number stays off until the /api/me answer of a verify lands", async () => {
    fresh("peon.biz", "peon");
    jar = "";
    await mount();
    await typePhone("212 555 0163");
    hold = { path: "/api/me" };
    input("code").value = "246810";
    submit("code");
    await until(() => hold?.waiting === true, "me in flight");
    const change = root().querySelector('[data-action="change-number"]') as unknown as HTMLButtonElement;
    change.click();
    expect(step()).toBe("code");
    expect(change.disabled).toBe(true);
    hold.release!();
    await until(() => step() === "profile", "profile step");
  });

  test("JF-2: when /api/me gives a marker, every site sends it, so a cookie change is refused", async () => {
    // peon's /api/me does not give signupView today (server need). This test adds it to the answer.
    fresh("peon.biz", "peon");
    markerFor = "peon";
    const cookieA = await sessionOf("212 555 0172");
    jar = "";
    await mount();
    await signIn("212 555 0171");
    jar = cookieA; // another tab signs in as A
    typeName("Bea", "30");
    tick();
    submit("profile");
    await until(() => step() === "profile" && !banner().hidden, "account_changed reroute");
    expect(joinCalls()).toHaveLength(1);
    expect(JSON.parse(joinCalls()[0]!.body).signupView).toMatch(/^[a-f0-9]{64}$/);
  });

  test("JF-3: after account_changed the profile form stays busy, and no join leaves without the marker", async () => {
    fresh("friends.help", "friends");
    const cookieA = await sessionOf("212 555 0182");
    jar = "";
    await mount();
    await signIn("212 555 0181");
    jar = cookieA; // another tab signs in as A
    typeName("Bea", "30");
    tick();
    submit("profile");
    await until(() => joinCalls().length === 1, "first join");
    hold = { path: "/api/me" };
    await until(() => hold?.waiting === true, "reroute me in flight");
    submit("profile");
    await Bun.sleep(20);
    expect(joinCalls()).toHaveLength(1);
    hold.release!();
    await until(() => step() === "profile" && !banner().hidden, "account_changed reroute");
    for (const call of joinCalls()) expect(JSON.parse(call.body).signupView).toMatch(/^[a-f0-9]{64}$/);
    expect(joinCalls()).toHaveLength(1);
  });
});
