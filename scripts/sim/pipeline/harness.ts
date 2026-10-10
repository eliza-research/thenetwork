// The message-pipeline world (mvp-plan "Still missing in sim"): the real NetworkService on a throwaway
// Postgres database on the dev cluster (:54339), a signed Blooio webhook in, the persisted queue
// (platform.outbound) and the Blooio adapter out to a fake provider that records every request, on a
// simulated clock. Nothing leaves the machine: the fake has kind "sim", the only provider kind the
// adapter accepts a live gate for; the real live flags are never set. Phones are +1 212 555 01xx.
import { existsSync } from "node:fs";
import { SQL } from "bun";
import { MINUTE, SimClock } from "../../../packages/core/src/index.ts";
import { signBlooioPayload } from "../../../packages/blooio/src/blooio/webhook.ts";
import { ChannelSendError, type ChannelAdapter, type SendReceipt, type SendRequest } from "../../../packages/blooio/src/types.ts";
import { BlooioAdapter } from "../../../packages/network/service/channel.ts";
import { NetworkService, WEBHOOK_PATH } from "../../../packages/network/service/service.ts";
import { DEV_PG_PORT, devPgUp } from "../../../packages/observatory/db/dev-pg.ts";
import { migrate } from "../../../packages/observatory/db/migrate.ts";

/** 2026-10-05 13:00 New York (a Monday afternoon: every send window is open). */
export const START = Date.UTC(2026, 9, 5, 17);
export const LINE = "+12125550100";
export const SECRET = "whsec_pipeline_sim";
export const TOKENS = "admin:sim-admin-token-000000000000000000,reviewer:sim-review-token-00000000000000000,safety:sim-safety-token-0000000000000000,analyst:sim-analyst-token-000000000000000";
export const REVIEWER = "sim-review-token-00000000000000000";
export const ADMIN = "sim-admin-token-000000000000000000";
const USER = process.env.USER ?? "postgres";
const ADMIN_URL = `postgres://${USER}@localhost:${DEV_PG_PORT}/postgres`;

/** Whether a dev Postgres can run here (the binaries are installed). */
export const pgInstalled = () => ["16", "17", "18"].some(v => existsSync(`/opt/homebrew/opt/postgresql@${v}/bin/pg_ctl`)) || !!Bun.which("pg_ctl");

async function admin(q: string) {
  const sql = new SQL({ url: ADMIN_URL, max: 1 });
  try { await sql.unsafe("set lock_timeout = '5s'"); await sql.unsafe(q); } finally { await sql.close(); }
}

/** A fresh migrated database of its own (pipeline_sim_<pid>), never the dev `network` database. */
export async function throwawayDb(): Promise<string> {
  await devPgUp();
  const db = `pipeline_sim_${process.pid}`;
  await admin(`drop database if exists ${db} with (force)`);
  await admin(`create database ${db}`);
  const url = `postgres://${USER}@localhost:${DEV_PG_PORT}/${db}`;
  await migrate(url, { lockTimeout: "5s" });
  return url;
}
export async function dropDb(url: string) { await admin(`drop database if exists ${new URL(url).pathname.slice(1)} with (force)`).catch(() => {}); }

/** One request the fake provider got, and whether it made a new message (a replayed key does not). */
export interface ProviderCall { at: number; req: SendRequest; outcome: "delivered" | "replayed" | "outage" }
export interface Delivered { at: number; key: string; to: string; text: string; media: string[]; providerId: string }

/**
 * A fake Blooio that records every request. Like Blooio, a replayed Idempotency-Key returns the original
 * message and sends nothing. It can be down (503, retryable), and it can "crash" the worker: it takes the
 * message, then never answers (the process died during the provider call).
 */
export class FakeBlooio implements ChannelAdapter {
  readonly kind = "sim" as const;
  readonly calls: ProviderCall[] = [];
  readonly delivered = new Map<string, Delivered>();
  /** Provider ids with no receipt yet (receipts() sends them as signed webhooks). */
  readonly unreceipted: string[] = [];
  /** Numbers whose messages fail after acceptance (a message.failed receipt). */
  readonly failing = new Set<string>();
  downUntil = 0;
  private crash?: () => void;
  private n = 0;
  /** `prefix`: the provider message ids (a second fake on the same database needs its own). */
  constructor(private clock: SimClock, private prefix = "sim_msg") {}

  /** The next new message is taken, then the provider call never returns; `onCrash` runs at that moment. */
  crashOnNext(onCrash: (() => void) | undefined) { this.crash = onCrash; }

  async send(req: SendRequest): Promise<SendReceipt> {
    const at = this.clock.now();
    if (at < this.downUntil) {
      this.calls.push({ at, req, outcome: "outage" });
      throw new ChannelSendError("Blooio is down (503)", "retryable", 503, "service_unavailable");
    }
    const old = this.delivered.get(req.idempotencyKey);
    if (old) { this.calls.push({ at, req, outcome: "replayed" }); return { providerMessageId: old.providerId, status: "queued", replayed: true }; }
    const providerId = `${this.prefix}_${++this.n}`;
    this.delivered.set(req.idempotencyKey, { at, key: req.idempotencyKey, to: req.to, text: req.text, media: req.mediaUrls ?? [], providerId });
    this.unreceipted.push(providerId);
    this.calls.push({ at, req, outcome: "delivered" });
    if (this.crash) { const c = this.crash; this.crash = undefined; c(); return new Promise<SendReceipt>(() => {}); }
    return { providerMessageId: providerId, chatId: `chat_${req.to}`, status: "queued", transport: "imessage" };
  }

  /** What one phone received, oldest first. */
  to(phone: string) { return [...this.delivered.values()].filter(d => d.to === phone).sort((a, b) => a.at - b.at); }
}

let evt = 0;
/** A signed Blooio webhook body (payload version 2026-10-01). */
export function messageBody(clock: SimClock, from: string, text: string, o: { id?: string; media?: string[]; at?: number } = {}) {
  const n = ++evt;
  return JSON.stringify({
    id: `evt_${n}`, type: "message.received", api_version: "2026-10-01", created_at: o.at ?? clock.now(), organization_id: "org_sim",
    data: { message_id: o.id ?? `msg_${n}`, sender: from, recipient: LINE, chat_id: from, text, protocol: "imessage", ...(o.media ? { attachments: o.media } : {}) },
  });
}
export function receiptBody(clock: SimClock, providerId: string, status: "delivered" | "failed" | "read") {
  return JSON.stringify({
    id: `evt_${++evt}`, type: `message.${status}`, api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_sim",
    data: { message_id: providerId, protocol: "imessage", ...(status === "failed" ? { error: { code: "undeliverable", message: "not reachable" } } : {}) },
  });
}
export function safetyBody(clock: SimClock, action: string) {
  return JSON.stringify({ id: `evt_${++evt}`, type: "safety.state_changed", api_version: "2026-10-01", created_at: clock.now(), organization_id: "org_sim", data: { action, phone_number: LINE } });
}
export const signedRequest = (clock: SimClock, body: string, path = WEBHOOK_PATH, secret = SECRET, header = "x-blooio-signature") =>
  new Request(`http://127.0.0.1${path}`, { method: "POST", headers: { "content-type": "application/json", [header]: signBlooioPayload(secret, body, Math.floor(clock.now() / 1000)) }, body });

/** The service as production builds it, with the fake provider behind the Blooio adapter. */
export function pipelineService(url: string, clock: SimClock, fake: FakeBlooio, instance: string, env: Record<string, string> = {}, log: (s: string) => void = () => {}) {
  return new NetworkService({
    url, clock, instance, tokens: TOKENS, webhookSecret: SECRET, log,
    env: { PLATFORM_ENV: "dev", ...env },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: true }, { id: "slop:nyc", matchingEnabled: true }, { id: "peon:nyc", matchingEnabled: true }, { id: "friends:nyc", matchingEnabled: true }],
    network: { seed: 1 }, photoStorage: null, notify: false,
    adapter: (_net, rt) => new BlooioAdapter({ provider: fake, clock, from: LINE, app: rt.app.id, city: rt.city, liveGate: () => true, log, limits: { baseBackoffMs: 30_000 } }),
  });
}

/** Post a webhook and return the JSON result (and the status code). */
export async function post(svc: NetworkService, req: Request): Promise<{ status: number; result: string; body: any }> {
  const res = await svc.fetch(req);
  const body = await res.json().catch(() => ({}));
  return { status: res.status, result: body.result ?? body.error, body };
}

/** Advance the clock in steps, ticking the service (the tick loop of serve.ts) and sending receipts. */
export async function run(svc: NetworkService, clock: SimClock, fake: FakeBlooio, ms: number, step = 5 * MINUTE) {
  for (let t = 0; t < ms; t += step) {
    clock.advance(Math.min(step, ms - t));
    await svc.inboxTick();
    for (const rt of svc.runtimes.values()) await rt.tick();
    await svc.purge();
    await receipts(svc, clock, fake);
  }
}

/** Blooio's receipts for what it accepted: delivered, or failed for a failing number. */
export async function receipts(svc: NetworkService, clock: SimClock, fake: FakeBlooio) {
  while (fake.unreceipted.length) {
    const id = fake.unreceipted.shift()!;
    const d = [...fake.delivered.values()].find(x => x.providerId === id)!;
    await post(svc, signedRequest(clock, receiptBody(clock, id, fake.failing.has(d.to) ? "failed" : "delivered")));
  }
}

export const staff = (svc: NetworkService, token: string, method: string, path: string, body?: unknown) =>
  svc.fetch(new Request(`http://127.0.0.1${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }));
