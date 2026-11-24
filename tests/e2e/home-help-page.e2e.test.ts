// spec/homeHelpPage.md, "The page reads the plan code and the revision from the fragment, and a bad link stops the page"
// spec/homeHelpPage.md, "Only an address that passes the check goes to the server"
// spec/homeHelpPage.md, "The server answer decides the result step"
// spec/homeHelpPage.md, "The helper asks for the address, and only the answer to that request shows it"
// spec/privateHomeHelpVenue.md, "The conversation points each participant to the private page"
// The home-help page against the real service: the link from the conversation, the page's own parse, address check,
// request body and answer map, and the generated page machine, on one NetworkService with PostgreSQL.
import { expect, test } from "vitest";
import type { SendRequest } from "../../packages/blooio/src/types.ts";
import { MINUTE, SimClock } from "../../packages/core/src/clock.ts";
import { enabled, type Event, type HomeHelpPage, initial, parseEvent, step } from "../../packages/core/src/generated/homeHelpPage.ts";
import type { StepSession } from "../../packages/core/src/generated/oneStepPage.ts";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { homeHelpPlanId } from "../../packages/network/service/bounded-home-help-consent-command.ts";
import { BlooioAdapter } from "../../packages/network/service/channel.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import type { OtpProvider } from "../../packages/platform/src/otp.ts";
import { dropDb, migratedDb, pgAvailable } from "../../packages/platform/test/pg.ts";
import { addressCheckOf, helpStatusOf, type HomeHelpLink, parseHomeHelpLink, type VenueAction, venueAnswerOf, venueBody } from "../../packages/ui/src/api/homeHelp.ts";
import type { StepAnswer } from "../../packages/ui/src/api/stepPages.ts";
import { startStack } from "./harness.ts";

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  sent = 0;
  async send(e164: string) { this.sent++; const code = String(300000 + this.sent * 7919); this.codes.set(e164, code); return { code }; }
}

const ADDRESS = "77 Canary Street Apt 4, Brooklyn NY 11222";
const NTWRK_HOST = "localhost:5101";

const run = (from: HomeHelpPage, ...events: Event[]): HomeHelpPage => events.reduce((page, event) => {
  expect(enabled(page, event), `${event.type} on ${page.screen}`).toBe(true);
  return step(page, event);
}, from);

async function homeHelpWorld(database: string) {
  const url = await migratedDb(database);
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 20, 17));
  const secret = "a-synthetic-home-help-page-flow-secret";
  const sent: SendRequest[] = [];
  const otp = new FakeOtp();
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, notify: false, instance: "home-help-page",
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    tokens: "safety@ntwrk:ntwrk-safety,reviewer@ntwrk:ntwrk-reviewer",
    networks: [{ id: "ntwrk:nyc", matchingEnabled: true }], devMatching: ["ntwrk:nyc"],
    network: { growth: false }, publicApi: { otp, minStartMs: 0, minVerifyMs: 0 },
    adapter: (_net, rt) => new BlooioAdapter({ app: rt.app.id, from: "+12125550100", clock, log: () => {}, liveGate: () => true,
      provider: { kind: "sim", async send(request) {
        sent.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent", acceptedAt: clock.now() };
      } },
    }),
  });
  let turnId = 0;
  const say = async (phone: string, text: string): Promise<string[]> => {
    clock.advance(MINUTE);
    const messageId = `home-help-page-${++turnId}`;
    const input: TurnRequest = { app: "ntwrk", from: phone, messageId, text, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
    const body = JSON.stringify(input);
    const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) });
    const res = await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body }));
    expect(res.status).toBe(200);
    return ((await res.json()) as { replies?: string[] }).replies ?? [];
  };
  const staff = async (path: string, body: object) => service.fetch(new Request(`http://localhost/apps/ntwrk/safety/home-help${path}`, {
    method: "POST", headers: { authorization: "Bearer ntwrk-safety", "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const jars = new Map<string, string>();
  const api = async (phone: string, method: "GET" | "POST", path: string, body?: object, host = NTWRK_HOST): Promise<Extract<StepAnswer, { reached: true }>> => {
    const jar = jars.get(`${host}|${phone}`);
    const res = await service.publicFetch(new Request(`http://127.0.0.1:8790${path}`, {
      method, headers: { host, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...(jar ? { cookie: jar } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }));
    const cookie = res.headers.get("set-cookie");
    if (cookie) jars.set(`${host}|${phone}`, cookie.split(";")[0]!);
    const data = (await res.json()) as Record<string, unknown>;
    return { reached: true, status: res.status, code: typeof data.error === "string" ? data.error : "", data, retryAfterSeconds: undefined };
  };
  const login = async (phone: string, host = NTWRK_HOST) => {
    clock.advance(31_000);
    expect((await api(phone, "POST", "/api/auth/otp/start", { phone }, host)).status).toBe(200);
    expect((await api(phone, "POST", "/api/auth/otp/verify", { phone, code: otp.codes.get(phone) }, host)).status).toBe(200);
  };
  const session = async (phone: string): Promise<StepSession> => {
    const me = await api(phone, "GET", "/api/me");
    if (!me.reached) return "SessionUnreadable";
    if (me.status === 401) return "SessionSignedOut";
    return me.status === 200 && typeof me.data.phoneMasked === "string" ? "SessionSignedIn" : "SessionUnreadable";
  };
  const close = async () => {
    await service.close();
    await sql.close();
    await dropDb(url);
  };
  const ready = async () => {
    await service.start();
    const people = [["+12125550251", "Rae"], ["+12125550252", "Ari"], ["+12125550253", "Bea"]] as const;
    const ids = new Map<string, string>();
    for (const [phone, firstName] of people) {
      const app = APPS.ntwrk;
      const invitation = await service.accounts.invite(app, phone);
      if (!invitation) throw new Error("Fixture invitation refused");
      const joined = await service.accounts.join(app, { e164: phone, personId: invitation.personId },
        { firstName, age: 30, homeCity: "nyc", consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused: ${joined.error}`);
      ids.set(firstName, joined.membership.memberId);
      for (const text of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) await say(phone, text);
      if (firstName !== "Rae") expect(await say(phone, "OFFER HOME HELP")).toEqual([expect.stringContaining("saved your offer")]);
    }
    const [rae, ari, bea] = [people[0][0], people[1][0], people[2][0]];
    const submitted = await say(rae, "SUBMIT HOME HELP | move furniture | Greenpoint | 2026-11-21T19:00Z | 2026-11-21T20:00Z | 30 | service unavailable");
    const code = /plan (hh_[a-p]+), revision 1/.exec(submitted.join("\n"))?.[1];
    if (!code) throw new Error("No plan code in the intake reply");
    const uuid = homeHelpPlanId(code);
    if (!uuid) throw new Error("The plan code does not decode");
    const helperIds = [ids.get("Ari")!, ids.get("Bea")!];
    expect((await staff(`/${uuid}`, { action: "nominate", revision: 1, helperIds })).status).toBe(200);
    expect((await staff(`/${uuid}`, { action: "approve", revision: 2, helperIds })).status).toBe(200);
    await service.tick();
    await say(rae, `YES HOME HELP ${code} 2`);
    for (let i = 0; i < 8 && sent.filter(s => s.text.includes(`YES HOME HELP ${code} 2`)).length < 3; i++) { clock.advance(30 * MINUTE); await service.tick(); }
    for (const helper of [ari, bea]) await say(helper, `YES HOME HELP ${code} 2`);
    return { rae, ari, bea, code, addressCommand: `HOME HELP ADDRESS ${code} 2` };
  };
  return { say, api, login, session, close, ready };
}

const linkIn = (reply: string): string => {
  const url = /https?:\/\/\S+\/home-help#\S+/.exec(reply)?.[0];
  if (!url) throw new Error(`No home-help link in: ${reply}`);
  return new URL(url).hash.slice(1);
};

test("the page refuses a link that the conversation cannot send, and keeps a good link for Cloud sign-in", () => {
  const code = `hh_${"abcdefghijklmnop".repeat(2)}`;
  const good = parseHomeHelpLink(`${code}-2`);
  expect(good).toEqual({ source: "LinkFromAddress", wellFormed: true, link: { id: code, revision: 2 }, text: `${code}-2` });
  expect(parseHomeHelpLink(good.text, true)).toMatchObject({ source: "LinkFromKept", wellFormed: true, link: { id: code, revision: 2 } });
  expect(parseHomeHelpLink("6f1d2c3b-0a9e-4d8c-b7a6-5e4f3d2c1b0a-7").link).toEqual({ id: "6f1d2c3b-0a9e-4d8c-b7a6-5e4f3d2c1b0a", revision: 7 });
  for (const bad of [code, `${code}-`, `${code}-0`, `${code}-2147483648`, `${code}-12345678901`, `${code.slice(0, -1)}-2`, `hh_${"q".repeat(32)}-2`, `${code}-2x`]) {
    const read = parseHomeHelpLink(bad);
    expect(read, bad).toEqual({ source: "LinkFromAddress", wellFormed: false, text: "" });
    expect(run(initial, { type: "openHomeHelpPage", source: read.source, wellFormed: read.wellFormed }).screen).toBe("HelpBadLink");
  }
  const missing = parseHomeHelpLink("", true);
  expect(missing.source).toBe("LinkMissing");
  const stopped = run(initial, { type: "openHomeHelpPage", source: missing.source, wellFormed: missing.wellFormed });
  expect(stopped.screen).toBe("HelpBadLink");
  expect(enabled(stopped, { type: "homeHelpLoaded", session: "SessionSignedIn", status: "StatusUnknown", cloudReturn: "CloudReturnNone" })).toBe(false);
  expect(parseEvent({ type: "helpSignedIn", status: "StatusUnknown" })).toBeUndefined();
  expect(addressCheckOf("  ")).toBe("AddressEmpty");
  expect(addressCheckOf("15 Fictional Street\nApt 2")).toBe("AddressBadChars");
  expect(addressCheckOf("15 Fictional Street Apt 2")).toBe("AddressBadChars");
  expect(addressCheckOf("15 Fictional Street​Apt 2")).toBe("AddressBadChars");
  expect(addressCheckOf("é".repeat(151))).toBe("AddressTooLong");
  expect(addressCheckOf(`  ${"a".repeat(300)}  `)).toBe("AddressOk");
  expect(venueBody("submit", { id: code, revision: 2 }, `  ${ADDRESS}  `)).toEqual({ action: "submit", id: code, revision: 2, address: ADDRESS });
  expect(venueBody("reveal", { id: code, revision: 2 }, ADDRESS)).toEqual({ action: "reveal", id: code, revision: 2 });
  expect(venueAnswerOf("reveal", { reached: false })).toEqual({ answer: "VenueUnreachable" });
  expect(venueAnswerOf("reveal", { reached: true, status: 200, code: "", data: { ok: true }, retryAfterSeconds: undefined })).toEqual({ answer: "VenueFailed" });
  expect(venueAnswerOf("submit", { reached: true, status: 503, code: "proxy_not_configured", data: {}, retryAfterSeconds: undefined })).toEqual({ answer: "VenueUnreachable" });
});

test.skipIf(!pgAvailable || !process.env.PLAYWRIGHT_MODULE)("a missing or invalid Home Help link sends no browser API request", async ({ onTestFinished }) => {
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!);
  const stack = await startStack();
  onTestFinished(() => stack.close());
  const browser = await chromium.launch({ headless: true });
  onTestFinished(() => browser.close());
  const context = await browser.newContext();
  await context.route("https://**/*", (route: { abort(): Promise<void> }) => route.abort());
  const origin = stack.sites.ntwrk.origin;
  const url = `${origin}/home-help`;
  const requests: string[] = [];
  context.on("request", (request: { url(): string }) => {
    const destination = new URL(request.url());
    if (destination.origin === origin && destination.pathname.startsWith("/api/")) requests.push(destination.pathname);
  });
  for (const suffix of ["", "#invalid-plan-1"]) {
    const page = await context.newPage();
    await page.goto(url + suffix);
    await page.getByRole("heading", { name: "This link does not work" }).waitFor();
    expect(page.url()).toBe(url);
    expect(requests).toEqual([]);
    await page.close();
  }
  const valid = await context.newPage();
  await valid.goto(`${url}#hh_${"abcdefghijklmnop".repeat(2)}-1`);
  await valid.getByRole("button", { name: "Text me a code" }).waitFor();
  expect(requests).toEqual(["/api/me", "/api/auth/mode"]);
}, 180_000);

test.skipIf(!pgAvailable)("the requester saves and removes the address and the helper reads it, through the link from the conversation", async () => {
  const world = await homeHelpWorld("home_help_page_flow");
  const { say, api, login, session } = world;
  try {
    const { rae, ari, addressCommand } = await world.ready();
    const [open] = await say(rae, addressCommand);
    expect(open).toContain("Everyone on this plan agreed.");
    const read = parseHomeHelpLink(linkIn(open!));
    expect(read.wellFormed).toBe(true);
    const link = read.link as HomeHelpLink;

    const act = async (page: HomeHelpPage, phone: string, action: VenueAction, event: Event, address?: string) => {
      const next = run(page, event);
      expect(next.pending).not.toBe("HelpIdle");
      const result = venueAnswerOf(action, await api(phone, "POST", "/api/home-help/venue", venueBody(action, link, address)));
      return { page: run(next, { type: "answerVenue", venueAnswer: result.answer }), result };
    };
    const opened = run(initial, { type: "openHomeHelpPage", source: read.source, wellFormed: read.wellFormed });
    const statusOf = async (phone: string) => helpStatusOf(await api(phone, "POST", "/api/home-help/venue", { action: "status", id: link.id, revision: link.revision }));
    const loaded = async (phone: string) => {
      const got = await statusOf(phone);
      return run(opened, { type: "homeHelpLoaded", session: got.signedOut ? "SessionSignedOut" : await session(phone), status: got.status, cloudReturn: "CloudReturnNone" });
    };

    expect(await session(rae)).toBe("SessionSignedOut");
    expect(await statusOf(rae)).toEqual({ status: "StatusUnknown", signedOut: true });
    expect(run(opened, { type: "homeHelpLoaded", session: await session(rae), status: "StatusUnknown", cloudReturn: "CloudReturnExpired" })).toMatchObject({ screen: "HelpSignIn", notice: "StepSignInExpired" });
    const stale = run(opened, { type: "homeHelpLoaded", session: "SessionSignedIn", status: "StatusUnknown", cloudReturn: "CloudReturnNone" });
    const signedOut = await act(stale, rae, "reveal", { type: "askReveal" });
    expect(signedOut.result.answer).toBe("VenueSignedOut");
    expect(signedOut.page).toMatchObject({ screen: "HelpSignIn", notice: "StepSessionEnded" });

    await login(rae);
    expect(await statusOf(rae)).toEqual({ status: "StatusRequester", signedOut: false });
    const form = await loaded(rae);
    expect(form).toMatchObject({ screen: "HelpAddress", role: "HelpRoleRequester" });
    const choose = run(opened, { type: "homeHelpLoaded", session: await session(rae), status: "StatusUnknown", cloudReturn: "CloudReturnNone" });
    expect(choose.screen).toBe("HelpChoose");
    const refused = run(form, { type: "submitAddress", addressCheck: addressCheckOf("77 Canary Street\nApt 4") });
    expect(refused).toMatchObject({ screen: "HelpAddress", pending: "HelpIdle", error: "HelpAddressBadChars" });
    expect((await api(rae, "POST", "/api/home-help/venue", { action: "submit", id: link.id, revision: link.revision, address: "77 Canary Street\nApt 4" })).status).toBe(409);

    const saved = await act(form, rae, "submit", { type: "submitAddress", addressCheck: addressCheckOf(ADDRESS) }, ADDRESS);
    expect(saved.result).toEqual({ answer: "VenueStored" });
    expect(saved.page.screen).toBe("HelpSaved");
    expect(await loaded(rae)).toMatchObject({ screen: "HelpSaved", role: "HelpRoleRequester" });
    expect((await say(rae, addressCommand))[0]).toContain("Your address is saved for this plan.");
    expect((await act(form, rae, "submit", { type: "submitAddress", addressCheck: addressCheckOf(ADDRESS) }, ADDRESS)).page.screen).toBe("HelpClosed");
    expect((await act(choose, rae, "reveal", { type: "askReveal" })).page.screen).toBe("HelpClosed");

    await login(ari);
    expect(await loaded(ari)).toMatchObject({ screen: "HelpChoose", role: "HelpRoleHelper" });
    const helperChoose = run(opened, { type: "homeHelpLoaded", session: await session(ari), status: "StatusUnknown", cloudReturn: "CloudReturnNone" });
    const revealed = await act(helperChoose, ari, "reveal", { type: "askReveal" });
    expect(revealed.result).toEqual({ answer: "VenueRevealed", address: ADDRESS });
    expect(revealed.page).toMatchObject({ screen: "HelpRevealed", addressHeld: true });
    expect((await act(helperChoose, ari, "revoke", { type: "askRevoke" })).page.screen).toBe("HelpClosed");

    const removed = await act(saved.page, rae, "revoke", { type: "askRevoke" });
    expect(removed.result).toEqual({ answer: "VenueRemoved" });
    expect(removed.page.screen).toBe("HelpRemoved");
    expect(await loaded(rae)).toMatchObject({ screen: "HelpClosed" });
    expect((await act(helperChoose, ari, "reveal", { type: "askReveal" })).page.screen).toBe("HelpClosed");
    expect((await act(form, rae, "submit", { type: "submitAddress", addressCheck: addressCheckOf(ADDRESS) }, ADDRESS)).page.screen).toBe("HelpClosed");
  } finally {
    await world.close();
  }
}, 120_000);
