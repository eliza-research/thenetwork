// spec/privateHomeHelpVenue.md, "The conversation points each participant to the private page"
// spec/privateHomeHelpVenue.md, "The requester supplies one address after everyone accepts this revision"
// spec/privateHomeHelpVenue.md, "A helper reads the address in a directly verified private request"
// spec/boundedHelp.md, "Fix the roster before review and recheck it at approval"
// Signed text turns, the staff API and the site API on one NetworkService with PostgreSQL.
import { expect, test } from "vitest";
import type { SendRequest } from "../../blooio/src/types.ts";
import { MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { homeHelpPlanId } from "../service/bounded-home-help-consent-command.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

class FakeOtp implements OtpProvider {
  readonly name = "fake";
  readonly codes = new Map<string, string>();
  sent = 0;
  async send(e164: string) { this.sent++; const code = String(300000 + this.sent * 7919); this.codes.set(e164, code); return { code }; }
}

const ADDRESS = "77 Canary Street Apt 4, Brooklyn NY 11222";
const CLOSED = "The private address step for that home-help plan is not open. It opens only when everyone on the current plan agrees.";

test.skipIf(!pgAvailable)("the address step opens only for the approved roster after everyone agrees, and a changed roster closes it", async () => {
  const url = await migratedDb("home_help_address_flow");
  const sql = new SQL(url);
  // Friday 12:00 in New York; the task is on Saturday afternoon.
  const clock = new SimClock(Date.UTC(2026, 10, 20, 17));
  const secret = "a-synthetic-home-help-address-flow-secret";
  const sent: SendRequest[] = [];
  const otp = new FakeOtp();
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, notify: false, instance: "home-help-address",
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    tokens: "safety@ntwrk:ntwrk-safety,reviewer@ntwrk:ntwrk-reviewer",
    networks: [{ id: "ntwrk:nyc", matchingEnabled: true }], devMatching: ["ntwrk:nyc"],
    network: { growth: false }, publicApi: { otp, minStartMs: 0, minVerifyMs: 0 },
    adapter: (_net, rt) => new BlooioAdapter({ app: rt.app.id, from: "+12125550100", clock, liveGate: () => true, log: () => {},
      provider: { kind: "sim", async send(request) {
        sent.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent", acceptedAt: clock.now() };
      } },
    }),
  });
  let turnId = 0;
  const say = async (phone: string, text: string): Promise<string[]> => {
    clock.advance(MINUTE);
    const messageId = `home-help-address-${++turnId}`;
    const input: TurnRequest = { app: "ntwrk", from: phone, messageId, text, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
    const body = JSON.stringify(input);
    const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) });
    const res = await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body }));
    expect(res.status).toBe(200);
    const out = await res.json() as { outcome: string; replies?: string[] };
    return out.replies ?? [];
  };
  const staff = async (path: string, body?: object) => service.fetch(new Request(`http://localhost/apps/ntwrk/safety/home-help${path}`, {
    method: body ? "POST" : "GET", headers: { authorization: "Bearer ntwrk-safety", "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  }));
  const jars = new Map<string, string>();
  const site = async (phone: string, path: string, body: object) => {
    const res = await service.publicFetch(new Request(`http://127.0.0.1:8790${path}`, {
      method: "POST", headers: { host: "localhost:5101", "content-type": "application/json", ...(jars.get(phone) ? { cookie: jars.get(phone)! } : {}) },
      body: JSON.stringify(body),
    }));
    const cookie = res.headers.get("set-cookie");
    if (cookie) jars.set(phone, cookie.split(";")[0]!);
    return { status: res.status, body: await res.json() as Record<string, unknown> };
  };
  const login = async (phone: string) => {
    clock.advance(31_000);
    expect((await site(phone, "/api/auth/otp/start", { phone })).status).toBe(200);
    expect((await site(phone, "/api/auth/otp/verify", { phone, code: otp.codes.get(phone) })).status).toBe(200);
  };

  try {
    await service.start();
    const people = [["+12125550241", "Rae"], ["+12125550242", "Ari"], ["+12125550243", "Bea"], ["+12125550244", "Cy"]] as const;
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
    expect(code).toBeDefined();
    const planId = homeHelpPlanId(code!)!;
    const helperIds = [ids.get("Ari")!, ids.get("Bea")!];
    expect((await staff(`/${planId}`, { action: "nominate", revision: 1, helperIds })).status).toBe(200);
    expect((await staff(`/${planId}`, { action: "approve", revision: 2, helperIds })).status).toBe(200);
    const addressCommand = `HOME HELP ADDRESS ${code} 2`;

    // Approved, but nobody has agreed yet: the step is closed and the site refuses the address.
    expect(await say(rae, addressCommand)).toEqual([CLOSED]);
    await login(rae);
    const submit = { action: "submit", id: code, revision: 2, address: ADDRESS };
    expect((await site(rae, "/api/home-help/venue", submit)).status).toBe(409);

    await service.tick();
    expect(sent.filter(s => s.to === rae && s.text.includes(`YES HOME HELP ${code} 2`))).toHaveLength(1);
    const raeYes = await say(rae, `YES HOME HELP ${code} 2`);
    expect(raeYes).toEqual([`I've recorded your yes. The address stays private until everyone agrees. To check the private address step, send:\n${addressCommand}`]);
    // The requester's yes alone does not open the step.
    expect(await say(rae, addressCommand)).toEqual([CLOSED]);
    expect((await site(rae, "/api/home-help/venue", submit)).status).toBe(409);

    // Helper cards are proactive outreach and wait for the ordinary pacing after the helpers' last messages.
    for (let i = 0; i < 8 && sent.filter(s => s.text.includes(`YES HOME HELP ${code} 2`)).length < 3; i++) { clock.advance(30 * MINUTE); await service.tick(); }
    for (const helper of [ari, bea]) {
      expect(sent.filter(s => s.to === helper && s.text.includes(`YES HOME HELP ${code} 2`))).toHaveLength(1);
      expect(await say(helper, `YES HOME HELP ${code} 2`)).toEqual([expect.stringContaining(addressCommand)]);
    }
    // A helper waits for the saved address; a person outside the roster never gets a link.
    expect(await say(ari, addressCommand)).toEqual([CLOSED]);
    expect(await say(people[3][0], addressCommand)).toEqual([CLOSED]);

    const [open] = await say(rae, addressCommand);
    expect(open).toContain("Everyone on this plan agreed.");
    expect(open).toContain(`/home-help#${code}-2`);
    expect((await site(rae, "/api/home-help/venue", submit))).toEqual({ status: 200, body: { ok: true } });
    expect((await say(rae, addressCommand))[0]).toContain("Your address is saved for this plan.");

    const [ready] = await say(ari, addressCommand);
    expect(ready).toContain(`/home-help#${code}-2`);
    await login(ari);
    expect(await site(ari, "/api/home-help/venue", { action: "reveal", id: code, revision: 2 })).toEqual({ status: 200, body: { ok: true, address: ADDRESS } });

    // A changed roster is a new revision: approval, the step and the read all end.
    expect((await staff(`/${planId}`, { action: "nominate", revision: 2, helperIds: [ids.get("Ari")!, ids.get("Cy")!] })).status).toBe(200);
    expect(await say(rae, addressCommand)).toEqual([CLOSED]);
    expect(await say(ari, addressCommand)).toEqual([CLOSED]);
    expect((await site(ari, "/api/home-help/venue", { action: "reveal", id: code, revision: 2 })).status).toBe(409);
    expect(await say(rae, `HOME HELP ADDRESS ${code} 3`)).toEqual([CLOSED]);

    // The address left only through the private reveal response.
    const stored = JSON.stringify([
      await sql`select response, replies from platform.inbound`,
      await sql`select body from network.messages`,
      await sql`select payload from network.events`,
      await sql`select detail, reason from network.staff_audit`,
    ]);
    expect(stored).not.toContain("Canary Street");
    expect(JSON.stringify(sent)).not.toContain("Canary Street");
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
