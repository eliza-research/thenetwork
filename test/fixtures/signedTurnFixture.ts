import { fetchWithHost } from "../../packages/core/src/runtime/fetch.ts";
import { serveHttp, type HttpServer } from "../../packages/core/src/runtime/http.ts";
import { HOUR, SimClock } from "../../packages/core/src/index.ts";
import { TURN_PATH, TURN_RECEIPT_PATH, type TurnReceiptRequest, type TurnRequest, type TurnResponse } from "../../packages/core/src/svc/contract.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { DryRunAdapter } from "../../packages/network/service/channel.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { holdEveryItem, type ReviewJudge } from "../../packages/engine/src/reviewJudge.ts";
import { APPS } from "../../packages/platform/src/apps.ts";
import { withConformanceDatabaseUrl } from "./conformanceDatabase.ts";

export type FixtureApp = "slop" | "friends";
export type FixtureMember = { phone: string; personId: string };
type FixtureTurn = Pick<TurnRequest, "app" | "receivedAt"> & { observeDryRunSideEffects?: boolean };
type FixtureOptions = { friendsReview?: boolean; reviewJudge?: ReviewJudge; env?: Record<string, string> };
type FixtureSignup = { firstName?: string; age?: number; apps?: readonly FixtureApp[]; interests?: string[]; neighborhood?: string };

export type SignedTurnFixture = {
  clock: SimClock;
  service: NetworkService;
  createMember(about?: Partial<Record<FixtureApp, string>>, signup?: FixtureSignup): Promise<FixtureMember>;
  verifyFriendsAdult(member: FixtureMember): Promise<void>;
  sendTurn(phone: string, text: string, options?: Partial<FixtureTurn>): Promise<{ response: TurnResponse; receivedAt: number; messageId: string; request: TurnRequest }>;
  replayTurn(request: TurnRequest): Promise<Response>;
  sendReceipt(input: TurnReceiptRequest): Promise<Response>;
  reviewQueue(): Promise<Response>;
  decideReview(item: { oppId: string; revision: number }, decision: "approve" | "reject", reason?: string): Promise<Response>;
  openPeer(reviewJudge: ReviewJudge): Promise<NetworkService>;
};

export async function withSignedTurnFixture(run: (fixture: SignedTurnFixture) => Promise<void>, options: FixtureOptions = {}) {
  await withConformanceDatabaseUrl("network_journey", url => serveFixture(url, run, options));
}

async function serveFixture(url: string, run: (fixture: SignedTurnFixture) => Promise<void>, options: FixtureOptions) {
  const secret = "synthetic-signed-turn-journey-secret";
  const reviewer = "synthetic-friends-review-journey-token";
  const safety = "synthetic-friends-safety-journey-token";
  const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
  const hosts = { slop: "localhost:5102", friends: "localhost:5104" };
  let phoneCounter = 0;
  let messageCounter = 0;
  let adapterCalls = 0;
  const build = (instance: string, reviewJudge: ReviewJudge) => new NetworkService({
    url, clock, instance, photoStorage: null, reviewJudge,
    env: {
      PLATFORM_ENV: "dev",
      PLATFORM_HASH_KEY: "synthetic-signed-turn-conformance-key", SERVICE_TURN_SECRET: secret,
      ...options.env,
    },
    networks: [
      { id: "ntwrk:nyc", matchingEnabled: false },
      { id: "slop:nyc", matchingEnabled: false },
      { id: "friends:nyc", matchingEnabled: options.friendsReview === true },
    ],
    ...(options.friendsReview ? { devMatching: ["friends:nyc"], tokens: `reviewer@friends:${reviewer},safety@friends:${safety}` } : {}),
    network: { seed: 1, ...(options.friendsReview ? { maxNewPerDay: 0, plans: false, growth: false } : {}) },
    publicApi: { minStartMs: 0, minVerifyMs: 0, otp: { name: "fixture", send: async () => ({ code: "314159" }) } },
    adapter: () => new DryRunAdapter(() => { adapterCalls++; }),
    log: () => {},
  });
  const app = build("signed-turn-conformance", options.reviewJudge ?? holdEveryItem.judge);
  const peers: NetworkService[] = [];
  let server: HttpServer | undefined;
  try {
    await app.start();
    const http = await serveHttp({
      hostname: "127.0.0.1", port: 0,
      fetch: request => new URL(request.url).pathname.startsWith("/api/") ? app.publicFetch(request) : app.fetch(request),
    });
    server = http;

    async function call(appId: FixtureApp, path: string, body: object, cookie?: string) {
      const response = await fetchWithHost(new URL(path, http.url), {
        method: "POST", signal: AbortSignal.timeout(10_000),
        headers: { host: hosts[appId], "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(`${appId} ${path} returned ${response.status}: ${await response.text()}`);
      return response;
    }

    async function createMember(about: Partial<Record<FixtureApp, string>> = {}, signup: FixtureSignup = {}): Promise<FixtureMember> {
      if (phoneCounter >= 100) throw new Error("Fixture ran out of reserved fictional phone numbers");
      const phone = `+1212555${String(100 + phoneCounter++).padStart(4, "0")}`;
      for (const appId of signup.apps ?? ["slop", "friends"]) {
        clock.advance(HOUR); // Give each signup its own normal OTP send window.
        await call(appId, "/api/auth/otp/start", { phone });
        const login = await call(appId, "/api/auth/otp/verify", { phone, code: "314159" });
        const cookie = login.headers.get("set-cookie")?.split(";")[0];
        if (!cookie) throw new Error("Phone verification did not establish a session");
        await call(appId, "/api/join", {
          firstName: signup.firstName ?? "Ari", age: signup.age ?? 29, about: about[appId], interests: signup.interests, neighborhood: signup.neighborhood,
          consent: { sms: true, wording: APPS[appId].consent.text },
        }, cookie);
      }
      const person = await app.accounts.personFor(phone);
      if (!person) throw new Error("Fixture signup did not retain a person");
      return { phone, personId: person.id };
    }

    async function verifyFriendsAdult({ personId }: FixtureMember) {
      const member = await app.people.getMembership(personId, "friends");
      if (!member) throw new Error("The fixture member did not join Friends");
      for (const check of ["age", "liveness"]) {
        const response = await fetch(new URL(`/apps/friends/members/${encodeURIComponent(member.memberId)}/verify`, http.url), {
          method: "POST", signal: AbortSignal.timeout(10_000),
          headers: { authorization: `Bearer ${safety}`, "content-type": "application/json" },
          body: JSON.stringify({ check, result: "pass", note: "Adult Friends conformance fixture" }),
        });
        if (!response.ok || !(await response.json() as { ok: boolean }).ok) {
          throw new Error(`Friends ${check} verification failed (${response.status})`);
        }
      }
    }

    async function sendTurn(phone: string, text: string, options: Partial<FixtureTurn> = {}) {
      clock.advance(1000);
      const input: TurnRequest = {
        messageId: `journey-${++messageCounter}`, from: phone, text,
        channel: "blooio", to: null, transport: "imessage",
        receivedAt: options.receivedAt ?? clock.now(),
        ...(options.app ? { app: options.app } : {}),
      };
      const response = await postSigned(TURN_PATH, input.messageId, input, options.observeDryRunSideEffects);
      if (!response.ok) throw new Error(`Signed turn returned ${response.status}: ${await response.text()}`);
      return { response: await response.json() as TurnResponse, receivedAt: input.receivedAt, messageId: input.messageId, request: input };
    }

    async function postSigned(path: string, id: string, input: TurnRequest | TurnReceiptRequest, observeDryRunSideEffects = false) {
      const body = JSON.stringify(input);
      const sent = adapterCalls;
      const response = await fetch(new URL(path, http.url), {
        method: "POST", body, signal: AbortSignal.timeout(10_000),
        headers: {
          "content-type": "application/json",
          ...await svcSign(secret, {
            method: "POST", path, id, body, nowS: Math.floor(clock.now() / 1000),
          }),
        },
      });
      if (!observeDryRunSideEffects && adapterCalls !== sent) throw new Error(`${path} called the delivery adapter`);
      return response;
    }

    function review(path: string, body?: { decision: "approve" | "reject"; reason?: string; revision: number }) {
      return fetch(new URL(`/apps/friends/review${path}`, http.url), {
        signal: AbortSignal.timeout(10_000),
        headers: { authorization: `Bearer ${reviewer}`, "content-type": "application/json" },
        ...(body ? { method: "POST", body: JSON.stringify(body) } : {}),
      });
    }

    await run({
      clock, service: app, createMember, verifyFriendsAdult, sendTurn,
      replayTurn: input => postSigned(TURN_PATH, input.messageId, input),
      sendReceipt: input => postSigned(TURN_RECEIPT_PATH, `${input.messageId}:receipt`, input),
      reviewQueue: () => review(""), decideReview: ({ oppId, revision }, decision, reason) => review(`/${encodeURIComponent(oppId)}`, { decision, reason, revision }),
      async openPeer(reviewJudge) {
        const peer = build(`signed-turn-peer-${peers.length + 1}`, reviewJudge);
        peers.push(peer);
        await peer.start();
        return peer;
      },
    });
  } finally {
    await server?.stop(true);
    for (const peer of peers) await peer.close();
    await app.close();
  }
}
