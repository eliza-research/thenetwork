import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BlooioClient, ChannelSendError, parseBlooioWebhook, SIGNATURE_HEADER, verifyBlooioSignature } from "@thenetwork/blooio";
import { SimClock, verifyLumaWebhookSignature } from "@thenetwork/core";
import { serveHttp, type HttpServer } from "../../core/src/runtime/http.ts";
import { ObjectStore } from "../../core/src/runtime/object-store.ts";
import { signSvixPayload, startMockServices, type MockServicesServer } from "../src/index.ts";

describe("packages/mock-services external HTTP contracts", () => {
  let mock: MockServicesServer;
  let webhookReceiver: HttpServer;
  let clock: SimClock;
  const receivedWebhooks: Array<{ path: string; headers: Record<string, string>; rawBody: string }> = [];

  beforeAll(async () => {
    clock = new SimClock(Date.UTC(2026, 10, 1, 14, 0, 0));
    webhookReceiver = await serveHttp({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (req) => {
        const rawBody = await req.text();
        const headers: Record<string, string> = {};
        for (const [k, v] of req.headers.entries()) {
          headers[k.toLowerCase()] = v;
        }
        receivedWebhooks.push({ path: new URL(req.url).pathname, headers, rawBody });
        return Response.json({ ok: true });
      },
    });
    mock = await startMockServices({ port: 0, clock, seed: 42 });
  });

  afterAll(async () => {
    await mock.stop(true);
    await webhookReceiver.stop(true);
  });

  beforeEach(async () => {
    receivedWebhooks.length = 0;
    await fetch(`${mock.url}/_mock/reset`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seed: 42, startMs: Date.UTC(2026, 10, 1, 14, 0, 0) }),
    });
  });

  it("serves real BlooioClient v4 read/send, idempotency 200/409, streak limits, safety chaos, and HMAC webhooks", async () => {
    const webhookSecret = "blooio_test_secret_123";
    const receiverUrl = `${webhookReceiver.url.toString().replace(/\/$/, "")}/webhooks/blooio`;
    await fetch(`${mock.url}/_mock/webhooks/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "blooio", url: receiverUrl, secret: webhookSecret }),
    });

    const client = new BlooioClient({
      apiKey: "blooio_test_key",
      baseUrl: `${mock.url}/blooio/v4`,
    });

    const me = await client.getMe();
    expect(me.valid).toBe(true);
    expect(me.devices?.length).toBeGreaterThan(0);

    const numbers = await client.listNumbers();
    expect(numbers[0]?.phone_number).toBe("+14155550100");

    const receipt1 = await client.send({
      to: "+12125550101",
      text: "Hey, want to grab coffee?",
      idempotencyKey: "tn:msg-1",
    });
    expect(receipt1.replayed).toBe(false);
    expect(receipt1.providerMessageId).toBeTruthy();

    const replay = await client.send({
      to: "+12125550101",
      text: "Hey, want to grab coffee?",
      idempotencyKey: "tn:msg-1",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.providerMessageId).toBe(receipt1.providerMessageId);

    await expect(
      client.send({
        to: "+12125550101",
        text: "Different body with same key",
        idempotencyKey: "tn:msg-1",
      }),
    ).rejects.toMatchObject({ status: 409, failure: "invalid" });

    expect(receivedWebhooks.length).toBe(1);
    const deliveryHook = receivedWebhooks[0]!;
    const sigCheck = verifyBlooioSignature(
      webhookSecret,
      deliveryHook.headers[SIGNATURE_HEADER],
      deliveryHook.rawBody,
      mock.registry.clock.unixSec(),
    );
    expect(sigCheck.ok).toBe(true);
    const parsedDelivery = parseBlooioWebhook(deliveryHook.rawBody, mock.registry.clock.now());
    expect(parsedDelivery.kind).toBe("status");

    await client.send({ to: "+12125550101", text: "Ping 2", idempotencyKey: "tn:msg-2" });
    await client.send({ to: "+12125550101", text: "Ping 3", idempotencyKey: "tn:msg-3" });
    await expect(
      client.send({ to: "+12125550101", text: "Ping 4", idempotencyKey: "tn:msg-4" }),
    ).rejects.toSatisfy((err: unknown) => err instanceof ChannelSendError && err.failure === "await_recipient" && err.code === "conversation_streak_limit");

    await fetch(`${mock.url}/_mock/webhooks/trigger`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        service: "blooio",
        type: "message.received",
        from: "+12125550101",
        text: "Yes, Thursday works!",
      }),
    });
    const inboundHook = receivedWebhooks.at(-1)!;
    const inboundSig = verifyBlooioSignature(
      webhookSecret,
      inboundHook.headers[SIGNATURE_HEADER],
      inboundHook.rawBody,
      mock.registry.clock.unixSec(),
    );
    expect(inboundSig.ok).toBe(true);
    const parsedInbound = parseBlooioWebhook(inboundHook.rawBody, mock.registry.clock.now());
    expect(parsedInbound.kind).toBe("message");
    if (parsedInbound.kind === "message") {
      expect(parsedInbound.text).toBe("Yes, Thursday works!");
    }

    const afterReply = await client.send({ to: "+12125550101", text: "Booked for Thursday!", idempotencyKey: "tn:msg-5" });
    expect(afterReply.providerMessageId).toBeTruthy();

    await fetch(`${mock.url}/_mock/chaos`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "blooio-reply-only",
        service: "blooio",
        probability: 1,
        enabled: true,
        fault: { kind: "blooio_safety", action: "reply_only" },
      }),
    });
    await expect(
      client.send({ to: "+12125550199", text: "Cold first message", idempotencyKey: "tn:msg-cold" }),
    ).rejects.toMatchObject({ failure: "blocked", code: "safety_reply_only" });
  });

  it("is wire-compatible with ObjectStore S3 PUT/GET/ListObjectsV2/DELETE and >8MB Multipart Upload", async () => {
    const store = new ObjectStore({
      endpoint: `${mock.url}/s3`,
      bucket: "sim-trajectories",
      accessKeyId: "mock-access",
      secretAccessKey: "mock-secret",
      region: "auto",
    });

    await store.write("runs/s42/chunk-001.ndjson", '{"event":"join"}\n', { type: "application/x-ndjson" });
    await store.write("runs/s42/chunk-002.ndjson", '{"event":"match"}\n', { type: "application/x-ndjson" });

    const text = await store.file("runs/s42/chunk-001.ndjson").text();
    expect(text).toBe('{"event":"join"}\n');

    const listed = await store.list({ prefix: "runs/s42/" });
    expect(listed.contents.map((c) => c.key)).toEqual([
      "runs/s42/chunk-001.ndjson",
      "runs/s42/chunk-002.ndjson",
    ]);
    expect(listed.isTruncated).toBe(false);

    const listedAfter = await store.list({ prefix: "runs/s42/", startAfter: "runs/s42/chunk-001.ndjson" });
    expect(listedAfter.contents.map((c) => c.key)).toEqual(["runs/s42/chunk-002.ndjson"]);

    const bigBytes = new Uint8Array(9 * 1024 * 1024);
    bigBytes[0] = 0x54;
    bigBytes[bigBytes.length - 1] = 0x4e;
    await store.write("runs/s42/big.bin", new Blob([bigBytes]), { type: "application/octet-stream" });
    const roundTrip = new Uint8Array(await store.file("runs/s42/big.bin").arrayBuffer());
    expect(roundTrip.byteLength).toBe(bigBytes.byteLength);
    expect(roundTrip[0]).toBe(0x54);
    expect(roundTrip[roundTrip.length - 1]).toBe(0x4e);

    await store.delete("runs/s42/chunk-001.ndjson");
    const afterDelete = await store.list({ prefix: "runs/s42/" });
    expect(afterDelete.contents.map((c) => c.key)).toEqual([
      "runs/s42/big.bin",
      "runs/s42/chunk-002.ndjson",
    ]);
  });

  it("simulates all 6 social platforms with rate limits, 429 spikes, shadowban zero-reach, captcha, and account lock", async () => {
    const xRes = await fetch(`${mock.url}/social/x/2/tweets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mock-account": "chadwick_nyc" },
      body: JSON.stringify({ text: "NYC coffee intros this weekend" }),
    });
    expect(xRes.status).toBe(201);
    expect(Number(xRes.headers.get("x-rate-limit-remaining"))).toBe(49);
    const xJson = (await xRes.json()) as { data: { id: string } };

    const xGet = await fetch(`${mock.url}/social/x/2/tweets/${xJson.data.id}`);
    const xMetrics = ((await xGet.json()) as { data: { public_metrics: { impression_count: number } } }).data.public_metrics;
    expect(xMetrics.impression_count).toBeGreaterThan(0);

    await fetch(`${mock.url}/_mock/chaos`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "shadowban-x",
        service: "x",
        probability: 1,
        enabled: true,
        fault: { kind: "shadowban_wave", reachMultiplier: 0, accounts: ["chadwick_nyc"] },
      }),
    });
    const shadowPost = await fetch(`${mock.url}/social/x/2/tweets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mock-account": "chadwick_nyc" },
      body: JSON.stringify({ text: "Shadowbanned tweet" }),
    });
    expect(shadowPost.status).toBe(201);
    const shadowId = ((await shadowPost.json()) as { data: { id: string } }).data.id;
    const shadowMetrics = ((await (await fetch(`${mock.url}/social/x/2/tweets/${shadowId}`)).json()) as { data: { public_metrics: { impression_count: number } } }).data.public_metrics;
    expect(shadowMetrics.impression_count).toBe(0);

    await fetch(`${mock.url}/_mock/chaos`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "ig-captcha",
        service: "instagram",
        probability: 1,
        enabled: true,
        fault: { kind: "captcha_wave", probability: 1 },
      }),
    });
    const igCaptcha = await fetch(`${mock.url}/social/instagram/v21.0/ig_1/media`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ caption: "Reel drop" }),
    });
    expect(igCaptcha.status).toBe(400);
    expect((await igCaptcha.json()) as Record<string, unknown>).toMatchObject({ challenge_required: true });

    await fetch(`${mock.url}/_mock/chaos`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "discord-429",
        service: "discord",
        probability: 1,
        enabled: true,
        fault: { kind: "rate_limit_spike", multiplier: 50, retryAfterSec: 45 },
      }),
    });
    const d1 = await fetch(`${mock.url}/social/discord/api/v10/channels/ch1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "First msg" }),
    });
    expect(d1.status).toBe(200);
    expect(d1.headers.get("x-ratelimit-remaining")).toBe("0");
    const d2 = await fetch(`${mock.url}/social/discord/api/v10/channels/ch1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "Second msg hits 429" }),
    });
    expect(d2.status).toBe(429);
    expect(d2.headers.get("retry-after")).toBe("45");

    const redditRes = await fetch(`${mock.url}/social/reddit/api/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sr: "nycmeetups", title: "Sunday coffee circle" }),
    });
    expect(redditRes.status).toBe(200);
    expect(redditRes.headers.get("x-ratelimit-remaining")).toBeTruthy();

    const liRes = await fetch(`${mock.url}/social/linkedin/v2/rest/posts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ commentary: "Hiring founders in NYC" }),
    });
    expect(liRes.status).toBe(201);

    const ttRes = await fetch(`${mock.url}/social/tiktok/v2/post/publish/video/init/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ post_info: { title: "NYC street clip" } }),
    });
    expect(ttRes.status).toBe(200);
  });

  it("handles Resend Svix webhooks, bounce storms, Twilio Lookup VoIP detection, Ads auctions, Dub/Beacon, Luma HMAC, and session isolation", async () => {
    const resendSecret = "whsec_dGVzdHNlY3JldGtleQ==";
    const lumaSecret = "luma_hmac_secret";
    const receiverBase = webhookReceiver.url.toString().replace(/\/$/, "");

    await fetch(`${mock.url}/_mock/webhooks/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "resend", url: `${receiverBase}/webhooks/resend`, secret: resendSecret }),
    });
    await fetch(`${mock.url}/_mock/webhooks/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service: "luma", url: `${receiverBase}/webhooks/luma`, secret: lumaSecret }),
    });

    const emailRes = await fetch(`${mock.url}/email/resend/emails`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer re_secret_key", "idempotency-key": "em-1" },
      body: JSON.stringify({ from: "ops@ntwrk.party", to: ["founder@acme.io"], subject: "Invite", text: "Join NYC salon" }),
    });
    expect(emailRes.status).toBe(200);
    const svixHook = receivedWebhooks.find((w) => w.path === "/webhooks/resend")!;
    expect(svixHook).toBeDefined();
    const expectedSvix = signSvixPayload(
      resendSecret,
      svixHook.headers["svix-id"]!,
      Number(svixHook.headers["svix-timestamp"]!),
      svixHook.rawBody,
    );
    expect(svixHook.headers["svix-signature"]).toBe(expectedSvix);

    const voipLookup = await (await fetch(`${mock.url}/twilio/lookups/v2/PhoneNumbers/%2B14155550000`)).json() as {
      line_type_intelligence: { type: string };
      sms_pumping_risk: { number_blocked: boolean };
    };
    expect(voipLookup.line_type_intelligence.type).toBe("nonFixedVoip");
    expect(voipLookup.sms_pumping_risk.number_blocked).toBe(true);

    const metaCamp = await fetch(`${mock.url}/ads/meta/v21.0/act_101/campaigns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "NYC Launch", daily_budget: 10_000, city: "nyc" }),
    });
    expect(metaCamp.status).toBe(200);
    await fetch(`${mock.url}/_mock/tick`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hours: 4 }),
    });
    const insights = (await (await fetch(`${mock.url}/ads/meta/v21.0/act_101/insights`)).json()) as {
      data: Array<{ impressions: string; clicks: string }>;
    };
    expect(Number(insights.data[0]?.impressions)).toBeGreaterThan(0);

    const dubRes = await (await fetch(`${mock.url}/ops/dub/links`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://slop.date/?utm_campaign=nyc-launch&city=nyc", key: "nyc-qr-1" }),
    })).json() as { shortLink: string };
    const redirectRes = await fetch(dubRes.shortLink, { redirect: "manual" });
    expect(redirectRes.status).toBe(302);
    expect(redirectRes.headers.get("location")).toContain("slop.date");

    await fetch(`${mock.url}/beacon/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [
          { brand: "slop", city: "nyc", event: "page_view", utmCampaign: "nyc-launch" },
          { brand: "slop", city: "nyc", event: "page_view", minor: true },
        ],
      }),
    });
    const beaconQuery = (await (await fetch(`${mock.url}/beacon/v1/query?brand=slop`)).json()) as { total: number; byEvent: Record<string, number> };
    expect(beaconQuery.total).toBe(2);
    expect(beaconQuery.byEvent.qr_scan).toBe(1);
    expect(beaconQuery.byEvent.page_view).toBe(1);

    await fetch(`${mock.url}/ops/luma/public/v1/event/rsvp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event_api_id: "evt_1", email: "alice@example.test", name: "Alice" }),
    });
    const lumaHook = receivedWebhooks.find((w) => w.path === "/webhooks/luma")!;
    expect(lumaHook).toBeDefined();
    const lumaValid = await verifyLumaWebhookSignature(lumaSecret, lumaHook.rawBody, lumaHook.headers["x-luma-signature"], {
      timestampHeader: lumaHook.headers["x-luma-timestamp"],
      nowMs: mock.registry.clock.now(),
    });
    expect(lumaValid).toBe(true);

    await fetch(`${mock.url}/social/x/2/tweets`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-mock-session": "tenant-a" },
      body: JSON.stringify({ text: "Tenant A isolated tweet" }),
    });
    const stateA = (await (await fetch(`${mock.url}/_mock/state/x?session=tenant-a`)).json()) as { posts: unknown[] };
    const stateB = (await (await fetch(`${mock.url}/_mock/state/x?session=tenant-b`)).json()) as { posts: unknown[] };
    expect(stateA.posts.length).toBe(1);
    expect(stateB.posts.length).toBe(0);

    const trafficResp = (await (await fetch(`${mock.url}/_mock/traffic?service=resend`)).json()) as {
      entries: Array<{ requestSummary: { headers: Record<string, string> } }>;
    };
    expect(trafficResp.entries[0]?.requestSummary.headers.authorization).toBe("[redacted]");
  });

  it("supports email bounce storms, ops endpoints, discovery endpoints, and global HTTP chaos faults", async () => {
    await fetch(`${mock.url}/_mock/chaos`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "bounce-storm",
        service: "resend",
        probability: 1,
        enabled: true,
        fault: { kind: "email_bounce_storm", hardBounceRate: 1, spamComplaintRate: 0 },
      }),
    });
    const bounced = await fetch(`${mock.url}/email/resend/emails`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: "ops@storm.test", to: ["a@example.test"], subject: "Hi", text: "Test" }),
    });
    expect(bounced.status).toBe(200);
    const emailState = (await (await fetch(`${mock.url}/_mock/state/email`)).json()) as {
      domains: Array<{ domain: string; bouncedCount: number; reputationScore: number }>;
    };
    const stormDomain = emailState.domains.find((d) => d.domain === "storm.test");
    expect(stormDomain?.bouncedCount).toBe(1);
    expect(stormDomain?.reputationScore).toBeLessThan(100);

    const rahRes = (await (await fetch(`${mock.url}/ops/rentahuman/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "tools/call", params: { name: "create_bounty", arguments: { city: "nyc" } } }),
    })).json()) as { result: { bounty_id: string } };
    expect(rahRes.result.bounty_id).toMatch(/^rah_/);

    const audioRes = await fetch(`${mock.url}/ops/elevenlabs/v1/text-to-speech/voice1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "hello nyc" }),
    });
    expect(audioRes.headers.get("content-type")).toBe("audio/mpeg");
    expect((await audioRes.arrayBuffer()).byteLength).toBeGreaterThan(10);

    const turnstileOk = (await (await fetch(`${mock.url}/turnstile/v0/siteverify`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "secret=s&response=valid_tok",
    })).json()) as { success: boolean };
    expect(turnstileOk.success).toBe(true);

    const hnRes = (await (await fetch(`${mock.url}/discovery/hn?query=nyc`)).json()) as { hits: unknown[] };
    expect(hnRes.hits.length).toBeGreaterThan(0);

    await fetch(`${mock.url}/_mock/chaos`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "google-503",
        service: "google_ads",
        probability: 1,
        enabled: true,
        fault: { kind: "http_error", status: 503, retryAfterSec: 12 },
      }),
    });
    const g503 = await fetch(`${mock.url}/ads/google/v18/customers/123/googleAds:searchStream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(g503.status).toBe(503);
    expect(g503.headers.get("retry-after")).toBe("12");
  });

  it("contains s3Dir disk mirroring within baseDir and blocks traversal in sessionId, bucket, and key", async () => {
    const parent = mkdtempSync(join(tmpdir(), "mock-s3-guard-"));
    const s3Dir = join(parent, "root");
    const diskMock = await startMockServices({ port: 0, clock, seed: 7, s3Dir });
    try {
      const okPut = await fetch(`${diskMock.url}/s3/safe-bucket/nested/ok.txt`, {
        method: "PUT",
        headers: { "x-mock-session": "sess-1" },
        body: "hello",
      });
      expect(okPut.status).toBe(200);
      expect(readFileSync(join(s3Dir, "sess-1", "safe-bucket", "nested", "ok.txt"), "utf8")).toBe("hello");

      await fetch(`${diskMock.url}/s3/safe-bucket/escaped.txt`, {
        method: "PUT",
        headers: { "x-mock-session": "../../escape" },
        body: "bad",
      });
      await fetch(`${diskMock.url}/s3/safe-bucket/..%2F..%2Fescaped2.txt`, {
        method: "PUT",
        headers: { "x-mock-session": "sess-1" },
        body: "bad",
      });
      await fetch(`${diskMock.url}/s3/..%2Fescape-bucket/file.txt`, {
        method: "PUT",
        headers: { "x-mock-session": "sess-1" },
        body: "bad",
      });

      expect(existsSync(join(parent, "escape"))).toBe(false);
      expect(existsSync(join(parent, "escaped2.txt"))).toBe(false);
      expect(existsSync(join(parent, "escape-bucket"))).toBe(false);
      expect(existsSync(join(s3Dir, "sess-1", "escaped2.txt"))).toBe(false);
    } finally {
      await diskMock.stop(true);
      rmSync(parent, { recursive: true, force: true });
    }
  });
});
