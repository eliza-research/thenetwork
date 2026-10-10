// Joint end-to-end check (issue #10): the request fixtures of the upstream gateway test
// (elizaOS/eliza develop, packages/cloud/services/gateway-webhook/__tests__/network-takeover.test.ts),
// replayed against the real service's signed /internal/turn and /internal/turn-receipt.
//
// The upstream test runs the real gateway handler against a fake service. This runs the real service
// against requests built exactly the way the gateway builds them (gateway-webhook/src/network-service.ts
// turnRequestFor: Twilio channel, to = null, transport "unknown", no `app` field, signed with id = messageId),
// and checks every response with the gateway's own acceptance rules (consent validation in
// runNetworkServiceTurn, the receipt it posts after a Cloud-owned delivery). Both sides use the same contract:
// packages/core/src/svc/{contract,svc-auth}.ts are byte-identical to upstream (contract-mirror.test.ts).
// Sends are dry-run; nothing may reach the provider or the Cloud deliver endpoint.
import {afterAll, beforeAll, expect, test} from "bun:test";
import {randomUUID} from "node:crypto";
import {SQL} from "bun";
import {SimClock, MINUTE} from "@thenetwork/core";
import {applySchema} from "../../observatory/db/dev-pg.ts";
import {svcSign} from "../../core/src/svc/svc-auth.ts";
import {DELIVER_PATH, TURN_PATH, TURN_RECEIPT_PATH, type TurnReceiptRequest, type TurnRequest, type TurnResponse} from "../../core/src/svc/contract.ts";
import {DryRunAdapter} from "../service/channel.ts";
import {NetworkService} from "../service/service.ts";

const db = `network_gateway_fixtures_${randomUUID().replaceAll("-", "")}`;
const admin = new SQL({url: `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/postgres`, max: 1});
const url = `postgres://${process.env.USER ?? "postgres"}@127.0.0.1:54339/${db}`;
const secret = "synthetic-gateway-fixtures-test-secret-20261009";
const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
const ONBOARDING = ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"];
let service: NetworkService, server: ReturnType<typeof Bun.serve>, cloud: ReturnType<typeof Bun.serve>;
let escaped = 0, sequence = 0;
const cloudCalls: string[] = [];

beforeAll(async () => {
  await admin.unsafe(`create database ${db}`);
  console.info(`[owned-db] ${db}`);
  await applySchema(url, {lockTimeout: "5s"});
  cloud = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => { cloudCalls.push(new URL(req.url).pathname); return Response.json({ok: false, error: "rejected", retryable: false}); }});
  service = new NetworkService({url, clock, photoStorage: null, instance: "gateway-fixtures-integration",
    env: {PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret, NETWORK_CLOUD_DELIVERY_ORIGIN: cloud.url.origin},
    networks: [{id: "ntwrk:nyc", matchingEnabled: false}, {id: "slop:nyc", matchingEnabled: false}, {id: "friends:nyc", matchingEnabled: false}],
    network: {seed: 1}, notify: false, log: () => {},
    adapter: () => { const a = new DryRunAdapter(() => {}); a.direct = async () => { escaped++; return "dry_run"; }; a.deliver = async rows => { escaped += rows.length; return rows.map(r => ({id: r.id, status: "dry_run"})); }; return a; },
  });
  await service.start();
  server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req)});
}, 120_000);
afterAll(async () => { server?.stop(true); cloud?.stop(true); await service?.close(); await admin.close(); });

/** The gateway's turnRequestFor() for the upstream test's ChatEvent fixture: {platform: "twilio", messageId: "SMtk<n>", senderId, text, no protocol, no channelId}. */
const gatewayTurn = (from: string, text: string): TurnRequest =>
  ({messageId: `SMtk${++sequence}`, channel: "twilio", from, to: null, text, transport: "unknown", receivedAt: clock.now()});

/** NetworkServiceClient.#post: JSON body, content-type, svcSign headers with the given id. */
const signedPost = async (path: string, id: string, payload: unknown) => {
  const body = JSON.stringify(payload);
  const headers = await svcSign(secret, {method: "POST", path, id, body, nowS: Math.floor(clock.now() / 1000)});
  return fetch(new URL(path, server.url), {method: "POST", redirect: "manual", headers: {"content-type": "application/json", ...headers}, body});
};

/** The gateway's checks on a turn response (runNetworkServiceTurn): it throws on anything else and reopens the webhook. */
function gatewayAccepts(res: TurnResponse): void {
  expect(["handled", "open", "ignored"]).toContain(res.outcome);
  if (res.outcome === "handled") {
    expect(Array.isArray(res.replies) && res.replies.every(r => typeof r === "string")).toBe(true);
    expect(res.replyIds.length).toBe(res.replies.length);
    expect(typeof res.accountEligible).toBe("boolean");
    expect(["reply", "compliance"]).toContain(res.replyKind);
    const c = res.consent;
    if (c) {
      const invalid = (c.scope !== "all" && c.scope !== "app") || (c.state !== "opted_in" && c.state !== "opted_out")
        || !Number.isSafeInteger(c.at) || c.at <= 0
        || (c.scope === "all" && (c.app !== null || c.state !== "opted_out"))
        || (c.scope === "app" && !["ntwrk", "slop", "peon", "friends"].includes(String(c.app)));
      expect(invalid).toBe(false);
    }
  }
  if (res.outcome === "open") {
    expect(typeof res.memberId).toBe("string");
    for (const k of ["firstName", "city", "state", "stateFrom", "stateUntil", "facets", "activeItems", "singlePlayer"]) expect(res.context).toHaveProperty(k);
  }
}

/** One gateway turn: signed /internal/turn, the gateway's checks, then for a handled turn the receipt the gateway posts after Cloud accepted it. */
async function gateway(from: string, text: string): Promise<TurnResponse> {
  const req = gatewayTurn(from, text);
  const r = await signedPost(TURN_PATH, req.messageId, req);
  expect(r.status).toBe(200);
  const res = await r.json() as TurnResponse;
  gatewayAccepts(res);
  if (res.outcome === "handled") {
    const delivered = res.replies.length > 0;
    const receipt: TurnReceiptRequest = {channel: req.channel, messageId: req.messageId, replyIds: res.replyIds, outcome: "accepted",
      providerMessageIds: delivered ? ["cloud-owned-receipt"] : [], historyRecorded: delivered};
    const ack = await signedPost(TURN_RECEIPT_PATH, `${req.messageId}:receipt`, receipt);
    if (delivered) {
      expect(ack.status).toBe(200);
      expect(await ack.json()).toEqual({ok: true, replayed: false});
      // A gateway retry of the same receipt is a replay, not a second acceptance.
      expect(await (await signedPost(TURN_RECEIPT_PATH, `${req.messageId}:receipt`, receipt)).json()).toEqual({ok: true, replayed: true});
    }
  }
  clock.advance(MINUTE);
  return res;
}

test("fixture 1 (hi): a handled turn with replies and replyIds, and the gateway's accepted receipt is taken", async () => {
  const res = await gateway("+14155550701", "hi");
  expect(res.outcome).toBe("handled");
  if (res.outcome !== "handled") return;
  expect(res.replies.length).toBeGreaterThan(0);
  expect(res.delivery).toBe("collected");
}, 60_000);

test("fixture 2 (STOP): line-wide opt-out the gateway mirrors into its consent ledger", async () => {
  const res = await gateway("+14155550702", "STOP");
  expect(res.outcome).toBe("handled");
  if (res.outcome !== "handled") return;
  expect(res.consent).toMatchObject({state: "opted_out", scope: "all", app: null});
}, 60_000);

test("fixture 3 (leave slop): an app-scoped leave the gateway must not apply to the shared line", async () => {
  const phone = "+14155550703";
  // Joining over the gateway path: no `app` on the request, the app comes from the keyword.
  expect((await gateway(phone, "slop.date")).outcome).toBe("handled");
  expect(await gateway(phone, "Ada, 29")).toMatchObject({outcome: "handled", reason: "joined", app: "slop"});
  const leave = await gateway(phone, "leave slop");
  expect(leave).toMatchObject({outcome: "handled", reason: "left"});
  if (leave.outcome !== "handled") return;
  expect(leave.consent).toMatchObject({state: "opted_out", scope: "app", app: "slop"});
}, 60_000);

test("fixture 4 (an open turn): a member's free question reaches the agent with the service's member context", async () => {
  const phone = "+14155550704";
  expect((await gateway(phone, "friends.help")).outcome).toBe("handled");
  const joined = await gateway(phone, "Ada, 29");
  expect(joined).toMatchObject({outcome: "handled", reason: "joined", app: "friends"});
  for (const text of ONBOARDING) await gateway(phone, text);
  const turn = await gateway(phone, "what's a good first date spot?");
  expect(turn.outcome).toBe("open");
  if (turn.outcome !== "open") return;
  // The gateway forwards exactly these as networkTurn {app, memberId, messageId, context}.
  expect(turn).toMatchObject({channel: "twilio", app: "friends", memberId: (joined as {memberId: string}).memberId});
  expect(turn.context.firstName).toBe("Ada");
  expect(turn.context.singlePlayer).toBe(false);
}, 60_000);

test("fixture 7 (hello, allowlisted sender): a plain first message is handled and acknowledged", async () => {
  expect((await gateway("+14155550707", "hello")).outcome).toBe("handled");
}, 60_000);

test("a gateway retry of the same webhook replays the stored response; a changed body under the same messageId is refused", async () => {
  const req = gatewayTurn("+14155550709", "HELP");
  const first = await (await signedPost(TURN_PATH, req.messageId, req)).json();
  expect(await (await signedPost(TURN_PATH, req.messageId, req)).json()).toEqual(first);
  expect((await signedPost(TURN_PATH, req.messageId, {...req, text: "STOP"})).status).toBe(409);
}, 60_000);

test("nothing reached the provider or the Cloud deliver endpoint", () => {
  expect(escaped).toBe(0);
  expect(cloudCalls.filter(p => p === DELIVER_PATH)).toEqual([]);
});
