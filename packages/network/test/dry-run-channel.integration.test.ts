import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import { serveHttp, type HttpServer } from "../../core/src/runtime/http.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

const secret = "synthetic-dry-run-channel-turn-secret-20261118";
const clock = new SimClock(Date.UTC(2026, 10, 18, 16));
const env = { PLATFORM_ENV: "dev", PLATFORM_HASH_KEY: "synthetic-dry-run-channel-hash-key", SERVICE_TURN_SECRET: secret };
let url: string;
let service: NetworkService, server: HttpServer;
let queued = 0;

const post = async (input: TurnRequest) => {
  const body = JSON.stringify(input);
  return fetch(new URL(TURN_PATH, server.url), {
    method: "POST",
    headers: { "content-type": "application/json", ...await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) }) },
    body,
  });
};

describe.skipIf(!pgAvailable)("a service with no channel configured (Postgres)", () => {
  beforeAll(async () => {
    url = await migratedDb("dry_run_channel");
    service = new NetworkService({
      url, clock, photoStorage: null, instance: "dry-run-channel", env, network: { seed: 1 }, log: () => {},
      networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }],
      adapter: () => {
        const a = new DryRunAdapter(() => {});
        a.direct = async () => { queued++; return "dry_run"; };
        a.deliver = async rows => { queued += rows.length; return rows.map(r => ({ id: r.id, status: "dry_run" })); };
        return a;
      },
    });
    await service.start();
    server = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: req => service.fetch(req) });
  }, 120_000);

  afterAll(async () => {
    await server?.stop(true);
    await service?.close();
    await dropDb(url);
  });

  test("with no channel configured, friends and peon queue nothing, and signed-turn replies of every app go back to the gateway", async () => {
    for (const [app, from] of [["friends", "+12125550171"], ["peon", "+12125550172"]] as const) {
      const r = await post({ messageId: `dry-run-${app}`, from, text: app, channel: "blooio", to: null, transport: "imessage", receivedAt: clock.now() });
      expect(r.status).toBe(200);
      const answer = await r.json() as { outcome: string; app: string; delivery: string; replies: string[] };
      expect(answer).toMatchObject({ outcome: "handled", app, delivery: "collected" });
      expect(answer.replies.length).toBeGreaterThan(0);
    }
    expect(queued).toBe(0);
  }, 60_000);
});
