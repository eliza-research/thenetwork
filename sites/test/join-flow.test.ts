// The real peon.biz join.html and shared/join.ts in a DOM, against the real platform API in the same
// process. A fake OTP provider keeps each code in memory (nothing is sent).
//   bun test --conditions eliza-source sites/test/join-flow.test.ts
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Window } from "../../packages/observatory/node_modules/happy-dom";
import { parseJoin } from "../../packages/platform/src/accounts.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { createPublicApi, type PublicApi } from "../../packages/platform/src/api.ts";
import type { OtpProvider } from "../../packages/platform/src/otp.ts";
import { MemoryPeopleStore } from "../../packages/platform/src/store.ts";
import { formPasses, parseJoinTakes, type JoinForm } from "../shared/join-core.ts";

const HOST = "peon.biz";
const html = readFileSync(join(import.meta.dir, "../peon.biz/public/join.html"), "utf8");
const body = html.slice(html.indexOf("<body"), html.indexOf("</body>")).replace(/^<body[^>]*>/, "");

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  async send(e164: string) {
    this.codes.set(e164, "246810");
    return { code: "246810" };
  }
}

let mountJoin: (root: HTMLElement) => Promise<void>;
let platform: PublicApi;
let otp: FakeOtp;
let jar = "";
let calls: { method: string; path: string; body: string }[] = [];
let unreachable: string[] = [];
let window: Window;
const realFetch = globalThis.fetch;

function dom(url: string): void {
  window = new Window({ url });
  const globals = { window, document: window.document, location: window.location, history: window.history, HTMLElement: window.HTMLElement, FormData: window.FormData };
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
}

beforeAll(async () => {
  dom(`https://${HOST}/`);
  ({ mountJoin } = await import("../shared/join.ts"));
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function fresh(): void {
  otp = new FakeOtp();
  jar = "";
  calls = [];
  unreachable = [];
  platform = createPublicApi({ store: new MemoryPeopleStore(), otp, env: { PLATFORM_ENV: "dev" }, hostMap: { [HOST]: "peon" }, minStartMs: 0, minVerifyMs: 0, log: () => {} });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const path = String(input);
    calls.push({ method: init.method ?? "GET", path, body: init.body ? String(init.body) : "" });
    if (unreachable.includes(path)) throw new TypeError("network down");
    const headers = new Headers(init.headers);
    headers.set("host", HOST);
    if (jar) headers.set("cookie", jar);
    if (init.method === "POST") headers.set("origin", `https://${HOST}`);
    const res = (await platform.fetch(new Request(`https://${HOST}${path}`, { ...init, headers }))) ?? new Response("not found", { status: 404 });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const [name, value] = pair!.split("=");
      jar = value ? `${name}=${value}` : "";
    }
    return res;
  }) as typeof fetch;
}

const root = () => window.document.querySelector("[data-join]") as unknown as HTMLElement;
const step = () => root().querySelector("[data-step]:not([hidden])")?.getAttribute("data-step");
const input = (name: string) => root().querySelector(`[name="${name}"]`) as unknown as HTMLInputElement;
const formOf = (name: string) => root().querySelector(`form[data-form="${name}"]`) as unknown as HTMLFormElement;
const errorOf = (name: string) => formOf(name).querySelector("[data-error]")!;
const banner = () => root().querySelector("[data-flow-error]") as unknown as HTMLElement;

async function until(check: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (check()) return;
    await Bun.sleep(5);
  }
  throw new Error(`timed out: ${what} (step ${step()}, ${root().textContent?.slice(0, 200)})`);
}

async function mount(url: string): Promise<void> {
  dom(url);
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

async function typeCode(next: string): Promise<void> {
  input("code").value = "246810";
  submit("code");
  await until(() => step() === next, `${next} step`);
}

function typeName(name: string, age: string): void {
  input("firstName").value = name;
  input("firstName").dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
  input("age").value = age;
  input("age").dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
}

const tick = () => input("consent").click();
const joinCalls = () => calls.filter((c) => c.path === "/api/join");

describe("Join on peon.biz", () => {
  test("the name and age from the link survive phone, change number and code (B2)", async () => {
    fresh();
    await mount(`https://${HOST}/join?via=agent#firstName=Alex&age=28`);
    expect(step()).toBe("phone");
    await typePhone("(212) 555-0142");
    (root().querySelector('[data-action="change-number"]') as unknown as HTMLButtonElement).click();
    expect(step()).toBe("phone");
    await typePhone("(212) 555-0143");
    expect(root().querySelector('[data-slot="phoneShown"]')!.textContent).toContain("0143");
    await typeCode("profile");
    expect(input("firstName").value).toBe("Alex");
    expect(input("age").value).toBe("28");
    expect(calls.some((c) => c.path === "/api/auth/otp/verify" && c.body.includes("+12125550143"))).toBe(true);
    tick();
    submit("profile");
    await until(() => step() === "done", "done");
    expect(joinCalls()).toHaveLength(1);
    expect(root().querySelector('[data-step="done"] [data-slot="firstName"]')!.textContent).toBe("Alex");
  });

  test("a person signed in as another account does not see the fields, and the tick does not carry over", async () => {
    fresh();
    await mount(`https://${HOST}/join`);
    await typePhone("212 555 0144");
    await typeCode("profile");
    typeName("Ana", "30");
    tick();
    // The session ends on the server. The page finds out at Join.
    jar = "";
    submit("profile");
    await until(() => step() === "phone", "phone step");
    expect(banner().hidden).toBe(false);
    await typePhone("212 555 0145");
    await typeCode("profile");
    expect(input("firstName").value).toBe("");
    expect(input("age").value).toBe("");
    expect(input("consent").checked).toBe(false);
    expect(banner().hidden).toBe(true);
  });

  test("a foreign number never reaches the API: the client refuses what the server refuses (B1)", async () => {
    fresh();
    await mount(`https://${HOST}/join`);
    input("phone").value = "+65 9234 5678";
    submit("phone");
    await until(() => errorOf("phone").textContent !== "", "phone error");
    expect(step()).toBe("phone");
    expect(calls.filter((c) => c.path === "/api/auth/otp/start")).toHaveLength(0);
    expect(otp.codes.size).toBe(0);
  });

  test("a 51-letter name stays on the form with the name message, and 50 letters join (B7)", async () => {
    fresh();
    await mount(`https://${HOST}/join`);
    await typePhone("212 555 0146");
    await typeCode("profile");
    expect(input("firstName").getAttribute("maxlength")).toBe("50");
    typeName("a".repeat(51), "30");
    tick();
    submit("profile");
    await until(() => errorOf("profile").textContent !== "", "profile error");
    expect(errorOf("profile").textContent).toBe("Enter your first name.");
    expect(joinCalls()).toHaveLength(0);
    typeName("a".repeat(50), "30");
    submit("profile");
    await until(() => step() === "done", "done");
    expect(joinCalls()).toHaveLength(1);
  });

  test("the Done step shows no error after a load that could not read /api/app (B8)", async () => {
    fresh();
    await mount(`https://${HOST}/join`);
    await typePhone("212 555 0147");
    await typeCode("profile");
    unreachable = ["/api/app"];
    await mount(`https://${HOST}/join`);
    expect(step()).toBe("profile");
    expect(banner().hidden).toBe(false);
    typeName("Bo", "31");
    tick();
    submit("profile");
    await until(() => step() === "done", "done");
    expect(banner().hidden).toBe(true);
  });

  test("the form rule agrees with the real parseJoin at each limit", () => {
    const wording = APPS.peon.consent.text;
    const forms: JoinForm[] = [];
    for (const firstName of ["", "a", "a".repeat(50), "a".repeat(51)]) {
      for (const age of [-1, 0, 1, 13, 120, 121, 18.5]) {
        for (const zip of ["", "11201", "1120", "112011", "1120a"]) forms.push({ firstName, age, wholeAge: Number.isInteger(age), zip, ticked: true });
      }
    }
    for (const form of forms) {
      const parsed = parseJoin({ firstName: form.firstName, age: form.age, ...(form.zip ? { zip: form.zip } : {}), consent: { sms: true, wording } });
      expect(parseJoinTakes(form), JSON.stringify(form)).toBe(parsed !== undefined);
      if (formPasses(form)) expect(parsed, JSON.stringify(form)).toBeDefined();
    }
  });
});
