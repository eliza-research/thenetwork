// The pipeline world (docs/mvp-gaps.md 4.1, PRD 34.2): the production message path end to end, on
// Postgres, in simulated time. What runs is what will run live:
//   phone -> signed POST /webhooks/blooio (the real HMAC, a test secret) -> NetworkService.fetch ->
//   verifyBlooioSignature -> parseBlooioWebhook -> inbound routing (keyword, membership, the platform
//   consent ledger) -> the app's NetworkRuntime and ConsentNetwork -> network.messages ->
//   the service's BlooioAdapter on the shared line (one OutboundQueue for every app: recipient policy,
//   leak guard, quiet hours, caps) -> the packages/blooio BlooioAdapter over the real BlooioClient ->
//   a fake fetch (FakeBlooio).
// Delivery receipts come back the same way (a signed message.delivered webhook).
//
// The service is built with NetworkService.fromDatabase, review mode "human", PLATFORM_ENV=dev and a
// SimClock. Nothing is sent: the fake provider answers inside the process and refuses any other host.
// The live flags are never set: the shared line runs in its queue dry run (mode "dry_run", every app
// let through as QUEUE_DRY_RUN_APPS does by default), and its only provider is the fake one.
import { randomUUID } from "node:crypto";
import { DAY, HOUR, MINUTE, SimClock, type Category, type MemberId, type Proposal } from "@thenetwork/core";
import { BlooioClient } from "../../../blooio/src/blooio/client.ts";
import { BlooioAdapter as ProviderAdapter } from "../../../blooio/src/adapters/blooio-adapter.ts";
import { signBlooioPayload } from "../../../blooio/src/blooio/webhook.ts";
import { PgQueueStore } from "../../../blooio/src/pg-queue-store.ts";
import { BlooioAdapter } from "../../../network/service/channel.ts";
import { SharedLine } from "../../../network/service/shared-line.ts";
import { NetworkService, type InboundOutcome, type NetworkRuntime } from "../../../network/service/service.ts";
import type { AppId } from "../../../platform/src/apps.ts";
import type { StaffUser } from "../../../observatory/src/types.ts";
import { FAKE_BLOOIO_BASE, FakeBlooio } from "./fakeBlooio.ts";

/** The shared line every app answers on (founder decision 2). A fictional 555-01xx number. */
export const SHARED_LINE = "+12125550100";
/** The webhook secret of the shared line, and of each per-app line, in this world only. */
export const TEST_WEBHOOK_SECRET = "pipeline-world-test-secret-0123456789";
/** Tue 2026-10-06 11:00 New York: inside every member's send window. */
export const PIPELINE_START = Date.UTC(2026, 9, 6, 15);
/** Staff in this world: admin, reviewer and safety on every app. */
export const STAFF: StaffUser = { id: "sim-staff@thenetwork.test", roles: ["admin", "reviewer", "safety"], grants: [{ role: "admin", app: "*" }, { role: "reviewer", app: "*" }, { role: "safety", app: "*" }], via: "token" };

export interface PipelineOptions {
  url: string;
  start?: number;
  /** Proactive messages a person gets a day across apps (default: the service's, 3). */
  personDailyCap?: number;
  /** PLATFORM_STOP_SCOPE=app makes a STOP on an app's own line stop that app only. */
  stopScope?: "app" | "global";
  /** Shared across restarts: the provider keeps what it took (and its idempotency keys). */
  provider?: FakeBlooio;
  clock?: SimClock;
  log?: (line: string) => void;
}

export interface WebhookResult { status: number; ok: boolean; result?: InboundOutcome; error?: string }

export class PipelineWorld {
  readonly clock: SimClock;
  readonly provider: FakeBlooio;
  private seq = 0;

  private constructor(readonly svc: NetworkService, readonly o: PipelineOptions, clock: SimClock, provider: FakeBlooio, readonly logs: string[]) {
    this.clock = clock; this.provider = provider;
  }

  /** Boot the service on a migrated database (pipelineDb) and let each network deliver what waits. */
  static async boot(o: PipelineOptions): Promise<PipelineWorld> {
    const clock = o.clock ?? new SimClock(o.start ?? PIPELINE_START);
    const provider = o.provider ?? new FakeBlooio(() => clock.now());
    const logs: string[] = [];
    const log = (line: string) => { logs.push(line); o.log?.(line); };
    const env = { PLATFORM_ENV: "dev", ...(o.stopScope === "app" ? { PLATFORM_STOP_SCOPE: "app" } : {}) };
    const secrets = { ntwrk: TEST_WEBHOOK_SECRET, slop: TEST_WEBHOOK_SECRET, peon: TEST_WEBHOOK_SECRET, friends: TEST_WEBHOOK_SECRET };
    // One line for every app, its state in Postgres (kept apart from live state) so a restart keeps it.
    let svcRef: NetworkService | undefined;
    const store = new PgQueueStore(() => { if (!svcRef) throw new Error("the line's store is not bound yet"); return svcRef.sql; }, { mode: "dry_run" });
    const line = new SharedLine({
      provider: new ProviderAdapter(new BlooioClient({ apiKey: "fake-key-pipeline-world", baseUrl: FAKE_BLOOIO_BASE, fetch: provider.fetch }), SHARED_LINE),
      clock, from: SHARED_LINE, mode: "dry_run", env: {}, log, store,
    });
    const svc = await NetworkService.fromDatabase({
      url: o.url, clock, env, log, instance: `pipeline-${randomUUID().slice(0, 6)}`,
      webhookSecret: TEST_WEBHOOK_SECRET, webhookSecrets: secrets, tokens: "admin:pipeline-admin-token", photoStorage: null, notify: false,
      ...(o.personDailyCap !== undefined ? { personDailyCap: o.personDailyCap } : {}),
      adapter: (net, rt) => new BlooioAdapter({ net, line, clock, memberOf: rt.memberOf, app: rt.app.id, city: rt.city, log }),
    });
    svcRef = svc;
    await line.start();
    await svc.start();
    return new PipelineWorld(svc, o, clock, provider, logs);
  }

  /** The same database, clock and provider, a new process: what a deploy or a crash does. */
  async restart(): Promise<PipelineWorld> {
    await this.svc.close();
    return PipelineWorld.boot({ ...this.o, clock: this.clock, provider: this.provider });
  }

  async close() { await this.svc.close(); }

  // ------------------------------------------------------------------ the phone side
  /** POST a signed webhook body to /webhooks/blooio (or an app's own line). */
  async post(body: unknown, o: { app?: AppId; secret?: string; signedAt?: number } = {}): Promise<WebhookResult> {
    const raw = JSON.stringify(body);
    const t = Math.floor((o.signedAt ?? this.clock.now()) / 1000);
    const req = new Request(`http://127.0.0.1:4848/webhooks/blooio${o.app ? `/${o.app}` : ""}`, {
      method: "POST", body: raw, headers: { "content-type": "application/json", "x-blooio-signature": signBlooioPayload(o.secret ?? TEST_WEBHOOK_SECRET, raw, t) },
    });
    const res = await this.svc.fetch(req);
    const j = await res.json() as { ok: boolean; result?: InboundOutcome; error?: string };
    return { status: res.status, ok: j.ok, ...(j.result ? { result: j.result } : {}), ...(j.error ? { error: j.error } : {}) };
  }

  /** A phone texts the shared line (Blooio message.received, api 2026-10-01). */
  text(from: string, text: string, o: { app?: AppId; messageId?: string } = {}): Promise<WebhookResult> {
    const id = o.messageId ?? `msg_in_${++this.seq}`;
    return this.post({
      id: `evt_${id}`, type: "message.received", api_version: "2026-10-01", created_at: this.clock.now(), organization_id: "org_pipeline",
      data: { message_id: id, sender: from, recipient: SHARED_LINE, chat_id: from, text, protocol: "imessage" },
    }, o.app ? { app: o.app } : {});
  }

  /** A delivery receipt for a provider message id (message.delivered or .read). */
  receipt(providerMessageId: string, status: "delivered" | "read" | "failed" = "delivered"): Promise<WebhookResult> {
    return this.post({
      id: `evt_st_${++this.seq}`, type: `message.${status}`, api_version: "2026-10-01", created_at: this.clock.now(), organization_id: "org_pipeline",
      data: { message_id: providerMessageId, protocol: "imessage" },
    });
  }

  /** The texts a phone got from the fake provider, oldest first. */
  got(phone: string): string[] { return this.provider.to(phone).map(s => s.text); }
  /** Texts a phone got since a mark (the provider's count before). */
  since(mark: number, phone?: string): string[] { return this.provider.sent.slice(mark).filter(s => !phone || s.to === phone).map(s => s.text); }
  get mark() { return this.provider.sent.length; }

  // ------------------------------------------------------------------ time
  /** Advance simulated time, ticking every network each `step` (default 15 minutes). */
  async advance(ms: number, step = 15 * MINUTE) {
    const end = this.clock.now() + ms;
    while (this.clock.now() < end) {
      this.clock.set(Math.min(end, this.clock.now() + step));
      await this.svc.tick();
    }
  }
  /** Advance (ticking each `step`) until `done()` is true or `max` has passed. Returns whether it became true. */
  async advanceUntil(done: () => boolean | Promise<boolean>, max: number, step = 15 * MINUTE): Promise<boolean> {
    const end = this.clock.now() + max;
    while (!(await done())) {
      if (this.clock.now() >= end) return false;
      await this.advance(Math.min(step, end - this.clock.now()), step);
    }
    return true;
  }
  /** Advance to the next time it is `hour`:00 in New York (at least a minute ahead). */
  async advanceToNyHour(hour: number, step = 15 * MINUTE) {
    let t = this.clock.now() + MINUTE;
    const ny = (x: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hourCycle: "h23", hour: "2-digit" }).format(x));
    t = Math.ceil(t / (15 * MINUTE)) * 15 * MINUTE;
    while (ny(t) !== hour) t += 15 * MINUTE;
    await this.advance(t - this.clock.now(), step);
  }

  // ------------------------------------------------------------------ the service side
  rt(app: AppId): NetworkRuntime { const r = this.svc.runtimeFor(app); if (!r) throw new Error(`no network for ${app}`); return r; }
  /** The member id of a phone on an app (fresh from the database). */
  async memberOf(app: AppId, phone: string): Promise<MemberId | undefined> { const r = this.rt(app); await r.identities(); return r.memberOf(phone); }
  /** The stored outbound rows of a member on an app (body, status, type), oldest first. */
  async outbound(app: AppId, memberId: MemberId) {
    return this.rt(app).scoped(tx => tx`select id, body, status, type, proactive, system, opportunity_id from network.messages
      where app_id = ${app} and member_id = ${memberId} and direction = 'outbound' order by ts, id`) as Promise<{ id: string; body: string; status: string; type: string | null; proactive: boolean; system: boolean; opportunity_id: string | null }[]>;
  }
  /** The person behind a phone, and their memberships. */
  async person(phone: string) {
    const p = await this.svc.accounts.personFor(phone);
    return p ? { person: p, memberships: await this.svc.people.memberships(p.id) } : undefined;
  }
  /**
   * Staff clear every open soft-approval flag on a network (POST /flags/:memberId "clear"). Every
   * number in this world is in the fictional 555-01xx block, so the number-block rule flags the third
   * join in an hour; a flagged member onboards but is never matched until staff clear it.
   */
  async clearFlags(app: AppId) {
    const r = this.rt(app);
    for (const f of await this.svc.openFlags(r)) {
      const res = await this.svc.decideFlag(STAFF, r, f.memberId as MemberId, "clear");
      if (!res.ok) throw new Error(`clear flag ${f.memberId}: ${res.reason}`);
    }
  }

  /** Turn matching on for one network (the registry row and the admin switch), after staff cleared the flags. */
  async matchingOn(app: AppId) {
    await this.clearFlags(app);
    const r = this.rt(app);
    await this.svc.sql`update platform.networks set matching_enabled = true where id = ${r.id}`;
    r.matchingAllowed = true;
    const res = await this.svc.setMatching(STAFF, true, r);
    if (!res.ok) throw new Error(`matching on ${r.id}: ${res.reason}`);
  }
  /** Approve every item in a network's review queue, as a human reviewer does (the reviewer of record is STAFF). */
  async approveAll(app: AppId): Promise<string[]> {
    const r = this.rt(app);
    const ids: string[] = [];
    for (const item of await this.svc.reviewQueue(r)) {
      const res = await this.svc.review(STAFF, item.oppId, "approve", { reason: "pipeline_world" }, r);
      if (res.ok) ids.push(item.oppId);
    }
    return ids;
  }

  /**
   * A proposal of two (or more) members into an app's daily run, approved by a human reviewer as soon
   * as it reaches the queue (the review SLA is 12 hours). Queued proposals go in at the network's next
   * daily run (9:00 New York, once a day): the next tick if today's run has not happened yet,
   * otherwise tomorrow's. Returns the opportunity id once approved; the probes then go out in the
   * members' send windows as the world advances.
   */
  async proposeAndApprove(app: AppId, participants: MemberId[], o: { id?: string; category?: Category; days?: number } = {}): Promise<string> {
    await this.matchingOn(app);
    const r = this.rt(app);
    const now = this.clock.now();
    const id = o.id ?? `pw-${app}-${++this.seq}`;
    const zero = { fit: 0, mutualBenefit: 0, warmPath: 0, novelty: 0, timingFit: 0, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0 };
    const p: Proposal = {
      id, kind: "intro", participants, alternates: [], objective: o.category === "romance" || (!o.category && app === "slop") ? "a first date" : "meet up", category: o.category ?? (app === "slop" ? "romance" : "social"),
      city: "nyc", window: { start: now + DAY, end: now + (o.days ?? 6) * DAY }, score: 1, components: zero, exploration: false, explanations: {}, generator: "pipeline", createdAt: now,
    };
    await r.unitOfWork(n => n.submitProposal(p));
    const queued = async () => (await this.svc.reviewQueue(r)).some(q => q.oppId === id);
    await this.advance(MINUTE, MINUTE);
    if (!(await queued())) await this.advanceToNyHour(9, HOUR);
    if (!(await queued())) {
      const why = await r.readState(n => participants.map(m => { const x = n.memberList().find(y => y.id === m); return { m, eligible: n.eligible(m), busy: n.busy(m), stage: x?.stage, outbound: x?.outbound, onlyWhenAsked: x?.onlyWhenAsked, minor: x?.minor }; }));
      throw new Error(`proposal ${id} did not reach the ${app} review queue: ${JSON.stringify(why)}`);
    }
    const res = await this.svc.review(STAFF, id, "approve", { reason: "pipeline_world" }, r);
    if (!res.ok) throw new Error(`review of ${id}: ${res.reason}`);
    return id;
  }

  /** The stored state of an opportunity on an app (stage, each participant's status). */
  async opp(app: AppId, id: string) {
    return this.rt(app).readState(n => { const o = n.opps.get(id); return o ? { stage: o.stage, status: Object.fromEntries(o.status) as Record<MemberId, string> } : undefined; });
  }
}
