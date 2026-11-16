import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { SQL } from "bun";
import { HOUR, SimClock } from "../../packages/core/src/index.ts";
import type { ConsentUpdate, Event, LineConsent } from "../../packages/core/src/generated/sharedLineConsentJourney.ts";
import { TURN_PATH, type TurnRequest, type TurnResponse } from "../../packages/core/src/svc/contract.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { DryRunAdapter } from "../../packages/network/service/channel.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { applySchema, DEV_PG_PORT } from "../../packages/observatory/db/dev-pg.ts";
import { APPS } from "../../packages/platform/src/apps.ts";

type App = "slop" | "friends";
type FixtureMember = { phone: string; lastStopAt?: number; output: ConsentUpdate[] };
type Command =
  | { method: "reset" }
  | { method: "observe" | "observeOutput"; key: string }
  | { method: "dispatch"; key: string; event: Event };

const database = `network_consent_${randomUUID().replaceAll("-", "")}`;
const address = `postgres://${encodeURIComponent(process.env.USER || "postgres")}@127.0.0.1:${DEV_PG_PORT}`;
const url = `${address}/${database}`;
const secret = "synthetic-shared-line-consent-fixture-secret";
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
const members = new Map<string, FixtureMember>();
const hosts = { slop: "localhost:5102", friends: "localhost:5104" };
let phoneCounter = 0;
let messageCounter = 0;
let adapterCalls = 0;

async function run() {
  const admin = new SQL({ url: `${address}/postgres`, max: 1 });
  let created = false;
  let service: NetworkService | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  try {
    await admin.unsafe(`create database ${database}`);
    created = true;
    await applySchema(url, { lockTimeout: "5s" });
    service = new NetworkService({
      url, clock, instance: "consent-conformance", photoStorage: null,
      env: {
        PLATFORM_ENV: "dev", PLATFORM_STOP_SCOPE: "app", CLEF_RATINGS: "off",
        PLATFORM_HASH_KEY: "synthetic-consent-conformance-key", SERVICE_TURN_SECRET: secret,
      },
      networks: [
        { id: "ntwrk:nyc", matchingEnabled: false },
        { id: "slop:nyc", matchingEnabled: false },
        { id: "friends:nyc", matchingEnabled: false },
      ],
      network: { seed: 1 },
      publicApi: { minStartMs: 0, minVerifyMs: 0, otp: { name: "fixture", send: async () => ({ code: "314159" }) } },
      adapter: () => new DryRunAdapter(() => { adapterCalls++; }),
      log: () => {},
    });
    const app = service;
    await app.start();
    const http = Bun.serve({
      hostname: "127.0.0.1", port: 0,
      fetch: request => new URL(request.url).pathname.startsWith("/api/") ? app.publicFetch(request) : app.fetch(request),
    });
    server = http;

    async function call(appId: App, path: string, body: object, cookie?: string) {
      const response = await fetch(new URL(path, http.url), {
        method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { host: hosts[appId], "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${appId} ${path} returned ${response.status}: ${await response.text()}`);
      return response;
    }

    async function memberFor(key: string): Promise<FixtureMember> {
      const current = members.get(key);
      if (current) return current;
      if (phoneCounter >= 100) throw new Error("Consent fixture ran out of reserved fictional phone numbers");
      const phone = `+1212555${String(100 + phoneCounter++).padStart(4, "0")}`;
      for (const appId of ["slop", "friends"] as const) {
        clock.advance(HOUR); // Give each signup its own normal OTP send window.
        await call(appId, "/api/auth/otp/start", { phone });
        const login = await call(appId, "/api/auth/otp/verify", { phone, code: "314159" });
        const cookie = login.headers.get("set-cookie")?.split(";")[0];
        if (!cookie) throw new Error("Phone verification did not establish a session");
        await call(appId, "/api/join", { firstName: "Ari", age: 29, consent: { sms: true, wording: APPS[appId].consent.text } }, cookie);
      }
      const member = { phone, output: [] };
      members.set(key, member);
      return member;
    }

    async function dispatch(member: FixtureMember, event: Event): Promise<"accepted"> {
      clock.advance(1000);
      const sendingStop = event.type === "textStop";
      const input: TurnRequest = {
        messageId: `consent-${++messageCounter}`, from: member.phone, text: sendingStop ? "STOP" : "START",
        channel: "blooio", to: null, transport: "imessage",
        receivedAt: !sendingStop && event.sentWithLastStop ? member.lastStopAt ?? clock.now() : clock.now(),
        ...(!sendingStop ? { app: event.app === "Slop" ? "slop" : "friends" } : {}),
      };
      const body = JSON.stringify(input);
      const sent = adapterCalls;
      const response = await fetch(new URL(TURN_PATH, http.url), {
        method: "POST", body, signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          ...await svcSign(secret, {
            method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000),
          }),
        },
      });
      if (!response.ok) throw new Error(`Signed turn returned ${response.status}: ${await response.text()}`);
      const turn = await response.json() as TurnResponse;
      if (turn.outcome !== "handled" || turn.delivery !== "collected" || adapterCalls !== sent)
        throw new Error("The signed turn must collect its reply without a delivery adapter call");
      if (sendingStop) member.lastStopAt = input.receivedAt;
      member.output = [];
      if (turn.consent) {
        const { scope, state, app, at } = turn.consent;
        if (at !== input.receivedAt) throw new Error("The consent update lost the gateway receipt time");
        if (scope === "all" && state === "opted_out" && app === null) member.output = ["AllOptedOut"];
        else if (scope === "app" && state === "opted_in" && app === "slop") member.output = ["SlopOptedIn"];
        else if (scope === "app" && state === "opted_in" && app === "friends") member.output = ["FriendsOptedIn"];
        else throw new Error(`Unexpected consent update ${JSON.stringify(turn.consent)}`);
      }
      return "accepted";
    }

    async function handle(command: Command): Promise<null | LineConsent | ConsentUpdate[] | "accepted"> {
      if (command.method === "reset") {
        members.clear();
        return null;
      }
      const member = await memberFor(command.key);
      if (command.method === "dispatch") return dispatch(member, command.event);
      if (command.method === "observeOutput") return member.output;
      return {
        slopMayText: await app.accounts.optedIn("slop", member.phone),
        friendsMayText: await app.accounts.optedIn("friends", member.phone),
      };
    }

    for await (const line of createInterface({ input: process.stdin })) {
      try {
        const value = await handle(JSON.parse(line));
        process.stdout.write(JSON.stringify({ value }) + "\n");
      } catch (error) {
        process.stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + "\n");
      }
    }
  } finally {
    server?.stop(true);
    try {
      await service?.close();
      if (created) await admin.unsafe(`drop database ${database}`);
    } finally {
      await admin.close();
    }
  }
}

await run();
