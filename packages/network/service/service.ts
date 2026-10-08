// The production runtime of the Network for every app (README.md in this folder; platform plan 4.4, 6.1).
//  - One process holds one NetworkRuntime per row of platform.networks ('<app>:<city>'). Each runtime
//    ticks and handles units of work under its own PgStore advisory lock (runtime.ts).
//  - Inbound (Blooio webhooks, signed): /webhooks/blooio/:app is one app's line (its own secret,
//    <APP>_BLOOIO_WEBHOOK_SECRET). /webhooks/blooio is the shared line (BLOOIO_WEBHOOK_SECRET): a row in
//    platform.app_lines for the receiving line names the app; otherwise the first message routes by
//    keyword ("slop", "slop.date", ...), a known member's app, or The Network.
//  - Phone -> person -> membership -> member id. Someone who is not a member of the app: on an open app
//    the text starts that app's join (first name and age; nothing is stored until the age check
//    passes); on an invite-only app one short invite-only reply, nothing stored. Responses never say
//    whether the phone uses another app.
//  - STOP, STOP ALL, START and HELP go through the platform consent ledger (PLATFORM_STOP_SCOPE; on
//    the shared line STOP stops every app). "leave <app>" leaves that app only (the forget path).
//  - The platform public API (packages/platform createPublicApi) with hooks into the networks:
//    publicFetch, served on PLATFORM_API_PORT (main.ts).
//  - Staff API: role tokens per app ("reviewer@slop:<t>"; NETWORK_SERVICE_TOKENS), ?app= or
//    /apps/:app/..., each action audited. The review mode is never exposed: production is "human" only.
//  - Sends: each app's adapter (dry-run by default; Blooio needs the per-app live flag too) after a
//    person-level cap of proactive messages across apps (default 3 a day).
import { randomUUID, timingSafeEqual } from "node:crypto";
import { SQL } from "bun";
import { DAY, RealClock, type Clock, type MemberId } from "@thenetwork/core";
import type { ActionResult, NetworkOptions, ReviewDecision, ReviewOptions } from "../src/network.ts";
import { brandOf, copy as ntwrkCopy, copyFor, type Copy } from "../src/copy.ts";
import { ageAnswer, agesStated } from "../src/classify.ts";
import { NetworkRuntime, type RuntimeHost } from "./runtime.ts";
import type { ChannelAdapter, Outbound } from "./channel.ts";
import { APPS, isAppId, type AppId, type AppInfo } from "../../platform/src/apps.ts";
import { Accounts, type AccountHooks, type JoinHookContext, type MemberHookContext } from "../../platform/src/accounts.ts";
import { joinAgeCheck } from "../../platform/src/age.ts";
import { detectKeyword as platformKeyword, keywordEvent, resolveConsent, stopScope, type StopScope } from "../../platform/src/consent.ts";
import { devShortcutsAllowed, isProduction, platformEnv, type Env } from "../../platform/src/env.ts";
import { keyedHash, maskPhone, normalizePhone } from "../../platform/src/phone.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import type { Membership, PeopleStore, Person } from "../../platform/src/store.ts";
import { createPublicApi, type PublicApi, type PublicApiOptions } from "../../platform/src/api.ts";
import { otpProviderFromEnv } from "../../platform/src/otp.ts";
import { turnstileFromEnv } from "../../platform/src/turnstile.ts";
import type { PeerInfo } from "../../platform/src/api.ts";
import { parseBlooioWebhook, SIGNATURE_HEADER, verifyBlooioSignature } from "../../../prototypes/messaging-blooio/src/blooio/webhook.ts";
import { normalizeAddress } from "../../../prototypes/messaging-blooio/src/phone.ts";
import type { ChannelEvent } from "../../../prototypes/messaging-blooio/src/types.ts";
// The Observatory's staff auth (per-app role grants) and audit sink, so the console and the service agree.
import { allowed, authenticate, hasEverywhere, parseTokenGrants, PgAudit, type AuditSink } from "../../observatory/src/staff.ts";
import type { AuditEntry, RoleGrant, StaffRole, StaffUser } from "../../observatory/src/types.ts";

export { NetworkRuntime } from "./runtime.ts";
type Row = Record<string, unknown>;
const MAX_BODY_BYTES = 256 * 1024;
export const WEBHOOK_PATH = "/webhooks/blooio";
/** The tables the service needs (bun run db:migrate). */
const REQUIRED_TABLES = [
  ...["members", "channel_identities", "facets", "intents", "presence", "edges", "messages", "events", "matching_runs", "staff_audit", "network_state", "opportunities", "review_items", "requests"].map(t => `network.${t}`),
  ...["apps", "networks", "people", "phone_identities", "memberships", "consent_events", "person_blocks", "app_lines", "share_grants"].map(t => `platform.${t}`),
];
/** The dev-only key for keyed phone hashes (the platform's own default). Production needs PLATFORM_HASH_KEY. */
const DEV_HASH_KEY = "dev-only-platform-hash-key";
/** Proactive messages one person gets a day, across every app (PRD 40.3). */
export const PERSON_DAILY_CAP = 3;
/** A pending text join (asked for first name and age) is forgotten after a day. */
const PENDING_MS = DAY;

/** One network the service runs: platform.networks.id ('<app>:<city>') and whether matching may run. */
export interface NetworkSpec { id: string; matchingEnabled?: boolean }

export interface ServiceOptions {
  /** Postgres with the `network` and `platform` schemas (a login that can read and write them). */
  url: string;
  /** The networks to run (platform.networks rows; NetworkService.fromDatabase reads them). Default: one, `id`. */
  networks?: NetworkSpec[];
  /** One network when `networks` is not given (default "ntwrk:nyc"; a legacy id "nyc" is "ntwrk:nyc"). */
  id?: string;
  /** App policy (platform.apps rows). Default: the registry in packages/platform apps.ts. */
  apps?: Record<AppId, AppInfo>;
  clock?: Clock;
  /** Default: DryRunAdapter per network. A function is called once per network. */
  adapter?: ChannelAdapter | ((net: NetworkRuntime["net"], rt: NetworkRuntime) => ChannelAdapter);
  /** Names this instance in pg_stat_activity (the lock holder in /health). */
  instance?: string;
  /** ConsentNetwork options for every network. `review` must be "human". A new stored state starts with matching off unless `matchingEnabled` is set. */
  network?: Omit<NetworkOptions, "store" | "onEngineRun" | "app">;
  /** Staff tokens: "admin:<t>,reviewer@slop:<t>,..." (NETWORK_SERVICE_TOKENS). A role with no app is for every app. Without them every staff route answers 401. */
  tokens?: string;
  /**
   * The admin console's own token (NETWORK_SERVICE_CONSOLE_TOKEN; also one of `tokens`). Only a request
   * with it may name the signed-in person in X-Network-Staff-Id; that person is then the reviewer of
   * record in the audit and the review. The header from any other token is ignored.
   */
  consoleToken?: string;
  /** The shared line's webhook secret (BLOOIO_WEBHOOK_SECRET). Without it /webhooks/blooio answers 503. */
  webhookSecret?: string;
  /** One app's line: /webhooks/blooio/<app> with <APP>_BLOOIO_WEBHOOK_SECRET. Without a secret that path answers 503. */
  webhookSecrets?: Partial<Record<AppId, string>>;
  /** network.staff_audit sink. Default: PgAudit on `auditUrl` or `url`. */
  audit?: AuditSink;
  auditUrl?: string;
  /** People, phones, memberships and consent. Default: PgPeopleStore on `url`. */
  people?: PeopleStore;
  /** Proactive messages a person gets a day across all apps (default 3; 0 turns the cap off). */
  personDailyCap?: number;
  /** Options for the public API (publicFetch). OTP defaults to OTP_PROVIDER (dev console outside production). */
  publicApi?: Partial<Pick<PublicApiOptions, "otp" | "turnstile" | "hostMap" | "trustForwardedHost" | "minStartMs" | "minVerifyMs" | "otpLimits" | "demo" | "ipOf">>;
  /** PLATFORM_STOP_SCOPE, PLATFORM_HASH_KEY, NODE_ENV/PLATFORM_ENV. Default process.env. */
  env?: Env;
  log?: (line: string) => void;
}

export type InboundOutcome =
  | "handled" | "duplicate" | "unknown_sender" | "ignored" | "ignored_group" | "status" | "reaction" | "safety"
  | "invite_only" | "join_asked" | "joined" | "under_age" | "stopped" | "left" | "no_network" | "held";

interface Route { app: AppId; shared: boolean }
interface PendingJoin { app: AppId; at: number; age?: number; name?: string }

const lower = (s: string) => s.normalize("NFKC").toLowerCase();
/** Words that are never a first name in a join answer. */
const NOT_NAMES = new Set(["hi", "hey", "hello", "yo", "sup", "im", "i'm", "i", "am", "my", "name", "names", "name's", "is", "and", "age", "aged", "years", "year", "old", "yrs", "y", "o",
  "join", "start", "please", "pls", "the", "a", "in", "at", "from", "near", "live", "here", "there", "yes", "yeah", "no", "ok", "okay", "sure", "thanks", "thank", "you", "it's", "its",
  "this", "that", "what", "who", "so", "me", "call", "it", "network", "turning", "just", "turned"]);

/** Words that may stand next to a bare number in a join answer ("Hi, I'm Sam, 29"). Any other word makes the number not an age. */
const JOIN_FILLER = new Set(["hi", "hey", "hello", "yo", "im", "i'm", "i", "am", "my", "name", "names", "name's", "is", "and", "age", "aged", "years", "year", "old", "yrs", "y", "o",
  "it's", "its", "call", "me", "just", "turned", "turning", "join", "please", "pls"]);

/**
 * A join answer by text: an age ("29", "I'm 29", "Sam, 29") and, when `nameOk`, a first name. The
 * name is the first word that is not a filler word or the name of an app. A bare number is an age
 * only in a short answer: one name at most, and filler words ("Sam, 29", "Kim 16"). In a sentence
 * ("Sounds good, 7 works for me") it is not an age.
 */
export function parseJoinText(text: string, appWords: readonly string[], nameOk: boolean): { age?: number; name?: string } {
  const t = text.normalize("NFKC").trim();
  const stated = agesStated(t);
  let age = stated.explicit ?? stated.age ?? ageAnswer(t);
  if (age === undefined) {
    const nums = [...t.matchAll(/(?:^|[\s,.;:(])(\d{1,3})(?=$|[\s,.;:!)])/g)];
    const others = t.replace(/\d+/g, " ").replace(/[^\p{L}' ]+/gu, " ").split(/\s+/).filter(Boolean).map(lower)
      .filter(w => !JOIN_FILLER.has(w) && !appWords.includes(w));
    if (nums.length === 1 && others.length <= 1 && !/\d[^\d\s,.;:!)]|[^\d\s,.;:(]\d/.test(t)) age = Number(nums[0]![1]);
  }
  if (age !== undefined && !(age > 0 && age < 120)) age = undefined;
  if (!nameOk && age === undefined) return {};
  const words = t.replace(/[^\p{L}' -]+/gu, " ").split(/[\s-]+/).filter(Boolean);
  const name = words.find(w => /^\p{L}[\p{L}']{0,29}$/u.test(w) && !NOT_NAMES.has(lower(w)) && !appWords.includes(lower(w)));
  return { ...(age !== undefined ? { age } : {}), ...(name ? { name: name.charAt(0).toUpperCase() + name.slice(1).toLowerCase() } : {}) };
}

export class NetworkService implements RuntimeHost {
  readonly sql: SQL;
  readonly clock: Clock;
  readonly instance: string;
  readonly audit: AuditSink;
  readonly apps: Record<AppId, AppInfo>;
  readonly people: PeopleStore;
  readonly accounts: Accounts;
  /** One runtime per network, in platform.networks order (ntwrk first). */
  readonly runtimes = new Map<string, NetworkRuntime>();
  readonly log: (line: string) => void;
  private readonly env: Env;
  private readonly tokens: Map<string, RoleGrant[]>;
  private readonly consoleToken?: string;
  private readonly secret?: string;
  private readonly secrets: Partial<Record<AppId, string>>;
  private readonly hashKey: string;
  private readonly cap: number;
  private readonly apiOptions: ServiceOptions["publicApi"];
  private api?: PublicApi;
  private readonly copies = new Map<AppId, Copy>();
  /** Text joins waiting for a first name or an age, by keyed phone hash. In memory only: a restart asks again. */
  private pending = new Map<string, PendingJoin>();
  /** Members who got the link notice and may answer SHARE (keyed phone hash + app). */
  private linkOffers = new Set<string>();

  constructor(o: ServiceOptions) {
    if (o.network?.review && o.network.review !== "human") throw new Error(`review mode "${o.network.review}" is refused: production review is "human" only (runbook-real 7.4)`);
    this.clock = o.clock ?? new RealClock();
    this.instance = o.instance ?? `${process.pid}`;
    this.log = o.log ?? console.log;
    this.env = o.env ?? process.env;
    this.secret = o.webhookSecret;
    this.consoleToken = o.consoleToken || undefined;
    this.secrets = o.webhookSecrets ?? {};
    this.cap = o.personDailyCap ?? PERSON_DAILY_CAP;
    this.apiOptions = o.publicApi;
    this.apps = o.apps ?? APPS;
    const key = this.env.PLATFORM_HASH_KEY ?? (devShortcutsAllowed(this.env) ? DEV_HASH_KEY : undefined);
    if (!key) throw new Error("PLATFORM_HASH_KEY is required in production and outside PLATFORM_ENV=dev");
    this.hashKey = key;
    try { this.tokens = parseTokenGrants(o.tokens, { explicitApp: isProduction(this.env) }); } catch (e) { throw new Error(String((e as Error).message).replace("OBSERVATORY_TOKENS", "NETWORK_SERVICE_TOKENS")); }
    const specs = o.networks?.length ? o.networks : [{ id: o.id ?? "ntwrk:nyc" }];
    // Each network's tick holds one connection for its advisory lock and needs more inside it: size the pool from the network count.
    this.sql = new SQL({ url: o.url, max: Math.max(8, 2 * specs.length + 4), connection: { application_name: `network-service:${this.instance}` } });
    this.people = o.people ?? new PgPeopleStore(this.sql);
    this.accounts = new Accounts(this.people, { hashKey: this.hashKey, now: () => this.clock.now(), env: this.env, apps: id => this.apps[id], hooks: this.hooks() });
    for (const spec of specs) {
      const id = spec.id.includes(":") ? spec.id : `ntwrk:${spec.id}`;
      const [app, city] = id.split(":") as [string, string];
      if (!isAppId(app) || !this.apps[app]) throw new Error(`network ${id}: unknown app "${app}"`);
      this.runtimes.set(id, new NetworkRuntime(this, { id, app: this.apps[app], city, matchingAllowed: spec.matchingEnabled ?? true, network: o.network, adapter: o.adapter }));
    }
    this.audit = o.audit ?? new PgAudit(o.auditUrl ?? o.url);
  }

  /** The service for every row of platform.networks, with the platform.apps policy rows. */
  static async fromDatabase(o: Omit<ServiceOptions, "networks" | "apps" | "id">): Promise<NetworkService> {
    const sql = new SQL({ url: o.url, max: 1 });
    try {
      const nets = await sql`select id, matching_enabled from platform.networks order by (app_id = 'ntwrk') desc, id`;
      const rows = await sql`select id, name, domain, min_join_age, min_match_age, join_mode from platform.apps`;
      const apps = { ...APPS };
      for (const r of rows as any[]) if (isAppId(r.id)) apps[r.id as AppId] = { ...APPS[r.id as AppId], name: r.name, domain: r.domain, minJoinAge: r.min_join_age, minMatchAge: r.min_match_age, joinMode: r.join_mode };
      return new NetworkService({ ...o, apps, networks: (nets as any[]).map(r => ({ id: r.id, matchingEnabled: r.matching_enabled })) });
    } finally { await sql.close(); }
  }

  // ------------------------------------------------------------------ the networks
  /** The first network: The Network's (ntwrk) when it runs here. The single-network API below uses it. */
  get main(): NetworkRuntime {
    const all = [...this.runtimes.values()];
    return all.find(r => r.app.id === "ntwrk") ?? all[0]!;
  }
  get net() { return this.main.net; }
  get pg() { return this.main.pg; }
  get store() { return this.main.store; }
  get adapter() { return this.main.adapter; }
  get lastTick() { return this.main.lastTick; }
  /** Address to member of The Network (the first network). */
  memberOf = (address: string): MemberId | undefined => this.main.memberOf(address);
  /** The network of an app (and a city; default its first network here). */
  runtimeFor(app: AppId, city?: string): NetworkRuntime | undefined {
    for (const r of this.runtimes.values()) if (r.app.id === app && (city === undefined || r.city === city)) return r;
    return undefined;
  }
  private copyOf(app: AppInfo): Copy {
    if (app.id === "ntwrk") return ntwrkCopy;
    let c = this.copies.get(app.id);
    if (!c) { c = copyFor(brandOf(app)); this.copies.set(app.id, c); }
    return c;
  }
  private phoneKey(e164: string) { return keyedHash(this.hashKey, `phone:${e164}`); }

  /** Check the schema, then let each network deliver what a restart left waiting. */
  async start() {
    const missing: string[] = [];
    for (const t of REQUIRED_TABLES) {
      const [r] = await this.sql`select to_regclass(${t}) is not null as ok`;
      if (!r?.ok) missing.push(t);
    }
    if (missing.length) throw new Error(`the database is missing ${missing.join(", ")}: run bun run db:migrate (runbook-real 1.1, runbook-platform)`);
    // The database and the process must agree on the environment (the 555-01xx guard reads the database's).
    const declared = platformEnv(this.env);
    const [envRow] = await this.sql`select value from platform.settings where key = 'environment'`;
    if (declared && envRow && envRow.value !== declared) throw new Error(`PLATFORM_ENV is ${declared} but platform.settings.environment is ${envRow.value}: fix one of them`);
    for (const rt of this.runtimes.values()) await rt.start();
  }

  /** One tick on every network, each under its own lock. True when any network ran (one network: whether it ran). */
  async tick(): Promise<boolean> {
    let any = false;
    for (const rt of this.runtimes.values()) any = (await rt.tick()) || any;
    return any;
  }

  /** A unit of work on The Network (the first network). */
  unitOfWork<T>(fn: (n: NetworkRuntime["net"]) => Promise<T> | T): Promise<T> { return this.main.unitOfWork(fn); }

  // ------------------------------------------------------------------ the person cap (RuntimeHost)
  /**
   * The proactive sends of a batch that would take a person over the daily cap across every app
   * (PRD 40.3), counted at send time from network.messages of the last 24 hours. Members the platform
   * does not know (no person_id) have only their app's own limits. The read spans apps, so it goes
   * through platform.person_cap_counts (SECURITY DEFINER, migration 0006): under the network_service
   * role a direct query sees one app only and would count 0. It returns ids and counts only.
   */
  async capRefused(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>> {
    const out = new Set<string>();
    const pro = batch.filter(b => b.proactive || b.kind === "proactive");
    if (!this.cap || !pro.length) return out;
    const ids = [...new Set(pro.map(b => b.memberId))];
    const rows = await this.sql`select member_id, person_id, n from platform.person_cap_counts(${rt.app.id}, ${this.sql.array(ids, "TEXT")}, ${new Date(this.clock.now() - DAY)}, ${this.sql.array(batch.map(b => b.id), "TEXT")})`;
    if (!rows.length) return out;
    const personOf = new Map((rows as any[]).map(r => [r.member_id as string, r.person_id as string]));
    const n = new Map((rows as any[]).map(r => [r.person_id as string, r.n as number]));
    for (const b of pro) {
      const p = personOf.get(b.memberId);
      if (!p) continue;
      const k = n.get(p) ?? 0;
      if (k >= this.cap) { out.add(b.id); this.log(`[cap] person cap (${this.cap}/day) holds a proactive send to ${b.memberId} (${rt.id})`); }
      else n.set(p, k + 1);
    }
    return out;
  }

  /**
   * Sends to a number whose last consent event for this app (or for every app) is an opt-out
   * (platform.consent_events, PLATFORM_STOP_SCOPE). Compliance texts (the STOP confirmation, a decline)
   * still go. A number with no event at all (a member from before the platform) is not refused here:
   * the member's own opted_out flag covers it.
   */
  async consentRefused(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>> {
    const out = new Set<string>();
    const byPhone = new Map<string, Outbound[]>();
    for (const b of batch) {
      if (b.kind === "compliance") continue;
      const e164 = normalizePhone(b.to ?? rt.addressOf(b.memberId));
      if (e164) byPhone.set(e164, [...(byPhone.get(e164) ?? []), b]);
    }
    for (const [e164, sends] of byPhone) {
      if (resolveConsent(await this.people.lastConsent(e164, rt.app.id)) !== "opted_out") continue;
      for (const b of sends) out.add(b.id);
      this.log(`[consent] ${sends.length} send(s) to an opted-out number refused (${rt.id})`);
    }
    return out;
  }

  // ------------------------------------------------------------------ members from the platform
  /**
   * The network member for an active membership: a network.members row (app, member id, person id,
   * first name, age) and what the person gave at join (neighborhood, interests). The phone stays in
   * platform.phone_identities. Written with app.app_id set (migration 0004).
   */
  async createMember(rt: NetworkRuntime, m: Membership, info: { age: number; firstName: string; neighborhood?: string; interests?: string[] }) {
    const now = new Date(this.clock.now());
    const prefs = { categoriesOptIn: ["social", "hobby", "professional", "events", "growth", "help"], quietHours: [21, 9], romanceOptIn: false, formats: ["one_to_one", "small_group", "event"], maxTravelMinutes: 45, onlyWhenAsked: false };
    await this.sql.begin(async tx => {
      await tx`select set_config('app.app_id', ${rt.app.id}, true)`;
      await tx`insert into network.members (app_id, id, person_id, name, home_city, home_area, account_status, age, prefs, joined_at)
        values (${rt.app.id}, ${m.memberId}, ${m.personId}, ${info.firstName}, ${rt.city}, ${info.neighborhood ?? null}, 'active', ${info.age}, ${prefs}::jsonb, ${now})
        on conflict (id) do update set person_id = excluded.person_id, name = excluded.name, home_city = excluded.home_city, home_area = excluded.home_area,
          account_status = 'active', age = excluded.age, joined_at = excluded.joined_at, opted_out = false`;
      if (info.neighborhood) await tx`insert into network.presence (app_id, member_id, city, type, areas) values (${rt.app.id}, ${m.memberId}, ${rt.city}, 'home', ${tx.array([info.neighborhood], "TEXT")})`;
      for (const tag of info.interests ?? []) {
        await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
          values (${rt.app.id}, ${`${m.memberId}:join:${tag}`}, ${m.memberId}, 'interest', ${tag}, ${tx.array([tag], "TEXT")}, 'matchable', 'said', 'web_join', 0.8, 'confirmed', ${now})
          on conflict (id) do nothing`;
      }
    });
  }

  /** The platform hooks: a join creates the network member and sends the welcome; stop, forget and export reach the network. */
  private hooks(): AccountHooks {
    return {
      onJoin: (ctx: JoinHookContext) => this.joined(ctx),
      onStop: ctx => this.stopped(ctx.app, ctx.personId, ctx.scope),
      onForget: (ctx: MemberHookContext) => this.forget(ctx.app, ctx.memberId),
      onExport: (ctx: MemberHookContext) => this.exportMember(ctx.app, ctx.memberId),
    };
  }

  /** A web join (POST /api/join): the member row, then the welcome through the normal send path. */
  private async joined(ctx: JoinHookContext) {
    const rt = this.runtimeFor(ctx.app.id);
    if (!rt) throw new Error(`no network runs for ${ctx.app.id}`);
    if (ctx.membership.state !== "active") return; // waitlist or a recycled number: staff first
    await this.createMember(rt, ctx.membership, { age: ctx.age, firstName: ctx.input.firstName, neighborhood: ctx.input.neighborhood, interests: ctx.input.interests });
    await rt.unitOfWork(n => { n.welcomeJoined(ctx.membership.memberId); });
  }

  /**
   * Opt the person's members out (this app, or every app for a global stop): the membership reads
   * "paused" (GET /api/me shows it; START on the app's line makes it active again), and the Network
   * drops the member from open opportunities.
   */
  private async stopped(app: AppInfo, personId: string, scope: StopScope, skip?: { rt: NetworkRuntime; memberId: MemberId }) {
    const ms = (await this.people.memberships(personId)).filter(m => m.state !== "removed" && m.state !== "invited" && (scope === "global" || m.app === app.id));
    for (const m of ms) {
      if (m.state === "active") await this.people.putMembership({ ...m, state: "paused" });
      const rt = this.runtimeFor(m.app);
      if (!rt || (skip && skip.rt === rt && skip.memberId === m.memberId)) continue;
      await rt.unitOfWork(async n => {
        await n.onInbound({ id: `stop:${m.memberId}:${this.clock.now()}`, memberId: m.memberId, body: "STOP", ts: this.clock.now(), channel: "imessage", keyword: "STOP" });
        rt.unit.optOut.set(m.memberId, true);
      });
    }
  }

  /** Leave one app: the Network forgets the member, then the save deletes every row that names them (the forget path). */
  private async forget(app: AppInfo, memberId: MemberId) {
    const rt = this.runtimeFor(app.id);
    if (!rt) return;
    await rt.unitOfWork(n => { n.forgetMember(memberId); rt.unit.forget.add(memberId); });
  }

  /** This app's own data about the member: what they told it, their own messages, and their opportunities (kind and state only). */
  private async exportMember(app: AppInfo, memberId: MemberId) {
    const a = app.id;
    const [member, facets, intents, presence, messages, opps] = await Promise.all([
      this.sql`select id, name, home_city, home_area, age, account_status, opted_out, joined_at from network.members where app_id = ${a} and id = ${memberId}`,
      this.sql`select kind, value, tags, provenance, status, valid_from from network.facets where app_id = ${a} and member_id = ${memberId} and privacy_scope <> 'agent_private'`,
      this.sql`select objective, category, status, created_at from network.intents where app_id = ${a} and member_id = ${memberId}`,
      this.sql`select city, type, areas from network.presence where app_id = ${a} and member_id = ${memberId}`,
      this.sql`select direction, body, ts from network.messages where app_id = ${a} and member_id = ${memberId} order by ts`,
      this.sql`select o.id, o.kind, o.state, o.created_at, o.meeting_at, p.role from network.participations p join network.opportunities o on o.app_id = p.app_id and o.id = p.opportunity_id
        where p.app_id = ${a} and p.member_id = ${memberId} order by o.created_at`,
    ]);
    return { member: member[0] ?? null, facets: [...facets], intents: [...intents], presence: [...presence], messages: [...messages], opportunities: [...opps] };
  }

  /**
   * The public API the four sites call (/api/*). Built on first use: outside dev it needs an OTP
   * provider (OTP_PROVIDER=twilio) and Turnstile (TURNSTILE_SECRET_KEY); the dev shortcuts refuse.
   */
  get publicApi(): PublicApi {
    this.api ??= createPublicApi({
      store: this.people, otp: this.apiOptions?.otp ?? otpProviderFromEnv(this.env), turnstile: this.apiOptions?.turnstile ?? turnstileFromEnv(this.env),
      hashKey: this.hashKey, apps: this.apps, env: this.env,
      now: () => this.clock.now(), log: this.log, ...this.apiOptions, ...this.hooks(),
    });
    return this.api;
  }
  /** The public API handler for Bun.serve: /api/* or 404. */
  publicFetch = async (req: Request, server?: PeerInfo): Promise<Response> => (await this.publicApi.fetch(req, server)) ?? Response.json({ ok: false, error: "not_found" }, { status: 404 });

  // ------------------------------------------------------------------ inbound
  /** The app of an inbound message (platform plan 4.4, founder decision 2026-10-08 on one shared line). */
  /**
   * The app of an inbound message on the shared line (platform plan 4.4, founder decision 2026-10-08):
   *  1. a per-app webhook path or a line in platform.app_lines names the app;
   *  2. the whole message is an app's word ("slop", "slop.date", "join slop"): that app;
   *  3. a join the person started (they sent the app's word) takes the answer that follows, if the
   *     answer reads as a join answer or the person is not a member anywhere;
   *  4. a member: their app (several: the app that wrote to them last);
   *  5. otherwise The Network.
   * An app's name inside a sentence ("my ex is on slop.date") never routes a member's message.
   */
  private async route(ev: Extract<ChannelEvent, { kind: "message" }>, forced?: AppId): Promise<Route> {
    if (forced) return { app: forced, shared: false };
    if (ev.to) {
      const line = normalizeAddress(ev.to);
      const [r] = await this.sql`select app_id from platform.app_lines where line_e164 = ${line}`;
      if (r && isAppId(r.app_id)) return { app: r.app_id, shared: false };
    }
    const named = this.namedApp(ev.text);
    if (named) return { app: named, shared: true };
    const mine = (await this.memberApps(ev.from)).filter(x => this.runtimeFor(x.app));
    const e164 = normalizePhone(ev.from);
    const pending = e164 ? this.pending.get(this.phoneKey(e164)) : undefined;
    if (pending && this.clock.now() - pending.at < PENDING_MS && !mine.some(x => x.app === pending.app)
      && (!mine.length || parseJoinText(ev.text, this.appWords(), true).age !== undefined)) return { app: pending.app, shared: true };
    if (mine.length) {
      // Several apps: the reply goes to the app that wrote to this person last.
      const last = [...mine].sort((a, b) => (b.lastOut ?? 0) - (a.lastOut ?? 0))[0]!;
      return { app: last.app, shared: true };
    }
    return { app: "ntwrk", shared: true };
  }

  /** The apps this address is a joined member of, across apps (platform.member_apps, migration 0006: ids and times only). */
  async memberApps(address: string): Promise<{ app: AppId; memberId: MemberId; lastOut: number | null }[]> {
    const rows = await this.sql`select app_id, member_id, last_out from platform.member_apps(${normalizeAddress(address)})`;
    return (rows as any[]).filter(r => isAppId(r.app_id)).map(r => ({ app: r.app_id as AppId, memberId: r.member_id, lastOut: r.last_out ? new Date(r.last_out).getTime() : null }));
  }

  private appWords() { return Object.values(this.apps).flatMap(a => [a.id, ...a.domain.split(".")]); }

  /** "slop", "slop.date", "www.slop.date" or "join slop": the whole message names the app. Never a word inside a sentence. */
  namedApp(text: string): AppId | undefined {
    const t = lower(text).replace(/[^\p{L}\p{N}. ]+/gu, " ").replace(/\s+/g, " ").trim().replace(/\.$/, "");
    const bare = t.replace(/^join /, "");
    for (const a of Object.values(this.apps)) {
      if (bare === a.id || bare === a.domain || bare === `www.${a.domain}`) return a.id;
    }
    return undefined;
  }

  /** "leave slop", "leave slop.date": that app only. */
  private leaveTarget(text: string): AppInfo | undefined {
    const m = /^leave (.+)$/.exec(lower(text).replace(/[^\p{L}\p{N}. ]+/gu, " ").replace(/\s+/g, " ").trim().replace(/\.$/, ""));
    if (!m) return undefined;
    const x = m[1]!.replace(/^the /, "");
    return Object.values(this.apps).find(a => x === a.id || x === a.domain || x === lower(a.name).replace(/^the /, ""));
  }

  /** A verified, parsed channel event (Blooio webhook). `app`: the per-app webhook path. */
  async inbound(ev: ChannelEvent, o: { app?: AppId } = {}): Promise<InboundOutcome> {
    switch (ev.kind) {
      case "ignored": case "typing": return "ignored";
      case "status": {
        for (const rt of this.runtimes.values()) {
          const d = rt.adapter.status?.(ev);
          if (d) { await rt.storeStatuses([d]); break; }
        }
        return "status";
      }
      case "safety":
        for (const rt of this.runtimes.values()) rt.adapter.lineSafety?.(ev.line ?? "", ev.type === "safety.number_banned" ? "review" : ev.action);
        this.log(`[safety] ${ev.type} action=${ev.action ?? "-"}`);
        return "safety";
      case "reaction":
        for (const rt of this.runtimes.values()) rt.adapter.engaged?.(ev.from);
        return "reaction";
      case "message": break;
    }
    if (ev.isGroup) return "ignored_group";
    const route = await this.route(ev, o.app);
    const app = this.apps[route.app];
    const rt = this.runtimeFor(route.app);
    if (!rt) { this.log(`[inbound] no network runs for ${route.app}; not stored`); return "no_network"; }
    // Only the routed network's address book (each runtime refreshes its own inside its units of work).
    await rt.identities();
    const memberId = rt.memberOf(ev.from);
    const e164 = normalizePhone(ev.from);
    const t = this.clock.now();
    const rowId = `in:${ev.channel}:${ev.messageId}`;
    const kw = platformKeyword(ev.text);
    const line = ev.to ? normalizeAddress(ev.to) : undefined;

    // STOP / STOP ALL: the consent ledger first (with or without a membership), then every member it covers.
    if (kw === "stop" || kw === "stop_all") {
      const scope: StopScope = kw === "stop_all" || route.shared ? "global" : stopScope(this.env);
      const { event, reply } = keywordEvent(kw, e164 ?? ev.from, app, t, { line, scope });
      if (e164 && event) await this.accounts.recordConsent(event);
      // The adapters in the STOP's scope only (the send path also reads the consent ledger).
      for (const r of this.runtimes.values()) if (scope === "global" || r === rt) r.adapter.optedOut?.(ev.from, true);
      if (e164) this.pending.delete(this.phoneKey(e164));
      if (memberId) await this.memberMessage(rt, memberId, ev, rowId, kw, reply);
      else await this.direct(rt, ev.from, reply, `sys:${rowId}`);
      const person = e164 ? await this.accounts.personFor(e164) : undefined;
      if (person) await this.stopped(app, person.id, scope, memberId ? { rt, memberId } : undefined);
      else if (scope === "global") {
        // A member from before the platform (no person): every app where this address is a member.
        for (const other of this.runtimes.values()) {
          if (other !== rt) await other.identities();
          const id = other.memberOf(ev.from);
          if (other !== rt && id) await other.unitOfWork(async n => { await n.onInbound({ id: `${rowId}:${other.id}`, memberId: id, body: ev.text, ts: t, channel: "imessage", keyword: "STOP" }); other.unit.optOut.set(id, true); });
        }
      }
      return memberId ? "handled" : "stopped";
    }

    // A number not seen for 12 months may have a new owner: on hold for staff review. Nothing is
    // answered or stored until staff decide (STOP above always works; HELP still answers).
    if (e164 && (await this.accounts.seen(e164)) === "held") {
      this.log(`[inbound] a number on hold for review (${rt.id}): not handled`);
      if (kw === "help") await this.direct(rt, ev.from, app.brand.help, `sys:${rowId}`);
      return "held";
    }

    // "leave <app>": that app only, on any line.
    const leaving = this.leaveTarget(ev.text);
    if (leaving && e164) {
      const lrt = this.runtimeFor(leaving.id);
      if (lrt && lrt !== rt) await lrt.identities();
      const lid = lrt?.memberOf(ev.from);
      if (lrt && lid) {
        const person = await this.accounts.personFor(e164);
        if (person) await this.accounts.leave(leaving, { e164, personId: person.id });
        else { await this.accounts.recordConsent({ e164, app: leaving.id, line, state: "opted_out", source: "leave", at: t }); await this.forget(leaving, lid); }
        await this.direct(lrt, ev.from, this.copyOf(leaving).leftApp, `sys:${rowId}`);
        return "left";
      }
    }

    if (memberId) {
      rt.adapter.engaged?.(ev.from);
      if (kw === "start" && e164) {
        await this.accounts.recordConsent({ e164, app: app.id, line, state: "opted_in", source: "keyword:start", wording: "START keyword", at: t });
        const person = await this.accounts.personFor(e164);
        const m = person && (await this.people.getMembership(person.id, app.id));
        if (m?.state === "paused") await this.people.putMembership({ ...m, state: "active" });
      }
      const reply = kw === "help" ? app.brand.help : undefined;
      if (!kw && e164 && /^\s*share\W*$/i.test(ev.text) && this.linkOffers.has(`${app.id}:${this.phoneKey(e164)}`)) return this.share(rt, app, memberId, e164, ev, rowId);
      const out = await this.memberMessage(rt, memberId, ev, rowId, kw, reply);
      if (e164 && rt.net.isDeclined(memberId)) await this.declined(app, e164, ev.text);
      return out;
    }

    // Not a member of this app. Nothing is stored about them unless they join (open app, age check passed).
    if (!e164) { this.log(`[inbound] unknown sender (not a phone), ${ev.text.length} chars, not stored`); return "unknown_sender"; }
    if (kw === "help") { await this.direct(rt, ev.from, app.brand.help, `sys:${rowId}`); return "handled"; }
    return this.join(rt, app, e164, ev, rowId);
  }

  /** A member's message (or keyword) as one unit of work on their app's network. */
  private memberMessage(rt: NetworkRuntime, memberId: MemberId, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string, kw: ReturnType<typeof platformKeyword>, systemReply?: string): Promise<InboundOutcome> {
    const keyword = kw === "stop" || kw === "stop_all" ? "STOP" : kw === "start" ? "START" : kw === "help" ? "HELP" : undefined;
    return rt.unitOfWork(async n => {
      // Under the lock, so a provider retry or a second subscription is handled once.
      if ((await this.sql`select 1 from network.messages where id = ${rowId}`).length) return "duplicate" as const;
      if (n.isDeclined(memberId)) return "handled" as const; // declined at join: never answered, nothing stored
      const t = this.clock.now();
      const channel = ev.transport === "sms" ? "sms" : "imessage";
      rt.unit.inbound = { id: rowId, member_id: memberId, direction: "inbound", channel, body: ev.text, status: "received", type: null, opportunity_id: null, proactive: false, system: false, ts: new Date(t) };
      rt.replyingTo = memberId;
      try { await n.onInbound({ id: rowId, memberId, body: ev.text, ts: t, channel, ...(keyword ? { keyword } : {}) }); } finally { rt.replyingTo = undefined; }
      // Carrier keywords: the app's own confirmation (packages/platform apps.ts). START gets the Network's own welcome back.
      if (systemReply) rt.system(memberId, `sys:${rowId}`, systemReply);
      if (keyword === "STOP") { rt.unit.optOut.set(memberId, true); rt.adapter.optedOut?.(ev.from, true); }
      if (keyword === "START") { rt.unit.optOut.set(memberId, false); rt.adapter.optedOut?.(ev.from, false); }
      if (n.isDeclined(memberId)) {
        // Under the join age: nothing is kept. The one kind decline still goes out, as a policy notice the queue does not hold back.
        rt.unit.forget.add(memberId);
        for (const s of rt.unit.sends) if (s.memberId === memberId) s.kind = "compliance";
      }
      return "handled" as const;
    });
  }

  /**
   * The Network declined a member under the app's join age (they stated it after joining). The
   * platform follows: the person keeps the lowest age (on every app), and the membership is forgotten.
   */
  private async declined(app: AppInfo, e164: string, text: string) {
    const person = await this.accounts.personFor(e164);
    if (!person) return;
    const stated = agesStated(text);
    const age = stated.explicit ?? stated.age ?? ageAnswer(text);
    if (age !== undefined && age > 0 && age < 120) await this.accounts.recordAge(e164, person, age);
    await this.people.forgetMembership(person.id, app.id, this.clock.now());
    await this.accounts.recordConsent({ e164, app: app.id, state: "opted_out", source: "join_declined", at: this.clock.now() });
  }

  /** One fixed text to someone who is not a member here. Nothing is stored. */
  private async direct(rt: NetworkRuntime, to: string, body: string, id: string) {
    await rt.adapter.direct(to, body, id);
  }

  /**
   * Someone who is not a member of this app wrote to it. Invite-only app: one short reply a day,
   * nothing stored. Open app: ask for first name and age; when both came and the age check passes,
   * the person (if new), the membership, the consent event and the network member are created, and
   * the Network welcomes them. Under the join age: the kind decline, nothing stored for this app.
   */
  private async join(rt: NetworkRuntime, app: AppInfo, e164: string, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string): Promise<InboundOutcome> {
    const key = this.phoneKey(e164);
    const t = this.clock.now();
    const c = this.copyOf(app);
    const person = await this.accounts.personFor(e164);
    const existing = person ? await this.people.getMembership(person.id, app.id) : undefined;
    const invited = existing?.state === "invited";
    if (app.joinMode === "invite" && !invited) {
      // The same answer whether or not the number uses another app; at most once a day per number.
      const { count } = await this.people.hit(`invite_only:${app.id}:${key}`, DAY, t);
      if (count === 1) await this.direct(rt, ev.from, app.brand.inviteOnly, `sys:${rowId}`);
      this.log(`[inbound] not a member of invite-only ${app.id}: ${count === 1 ? "invite-only reply" : "no reply (sent today)"}, not stored`);
      return "invite_only";
    }
    let p = this.pending.get(key);
    if (p && (p.app !== app.id || t - p.at >= PENDING_MS)) p = undefined;
    const said = parseJoinText(ev.text, this.appWords(), !!p);
    const age = said.age ?? p?.age, name = said.name ?? p?.name;
    const ask = invited ? c.invited(app.minJoinAge) : c.joinAsk(app.minJoinAge);
    if (age === undefined) {
      this.pending.set(key, { app: app.id, at: t, ...(name ? { name } : {}) });
      const { count } = await this.people.hit(`join_ask:${app.id}:${key}`, DAY, t);
      if (count <= 3) await this.direct(rt, ev.from, ask, `sys:${rowId}`);
      return "join_asked";
    }
    const check = joinAgeCheck(age, await this.accounts.lowestAge(e164, person), app);
    if (!check.ok) {
      // Nothing is stored for this app: only the age, on the phone's age floor (and the person, if any),
      // so a second try with an older age is refused too.
      await this.accounts.recordAge(e164, person, age);
      this.pending.delete(key);
      await this.direct(rt, ev.from, app.brand.underAge, `sys:${rowId}`);
      this.log(`[inbound] under the join age for ${app.id}: declined, nothing stored`);
      return "under_age";
    }
    if (!name) {
      this.pending.set(key, { app: app.id, at: t, age });
      await this.direct(rt, ev.from, c.joinNeedName, `sys:${rowId}`);
      return "join_asked";
    }
    this.pending.delete(key);
    // Join: the person (new or known), the membership, the opt-in (with the words they answered), then the member and the welcome.
    const who: Person = person ?? (await this.people.createPerson({ id: randomUUID(), e164, method: "inbound_message", at: t, lowestAge: age }));
    await this.accounts.recordAge(e164, who, age);
    // Their answer is a new opt-in: a delete of everything no longer suppresses the number.
    await this.people.unsuppress(this.phoneKey(e164));
    const others = (await this.people.memberships(who.id)).filter(m => m.app !== app.id && m.state !== "removed" && m.state !== "invited");
    const membership: Membership = {
      app: app.id, personId: who.id, memberId: existing?.state === "invited" ? existing.memberId : `${app.id}_${randomUUID()}`,
      state: app.joinMode === "waitlist" ? "onboarding" : "active", review: null, firstName: name, profile: {}, joinedAt: t, leftAt: null,
    };
    await this.people.putMembership(membership);
    await this.accounts.recordConsent({ e164, app: app.id, line: ev.to ? normalizeAddress(ev.to) : null, state: "opted_in", source: "inbound_message", wording: ask, at: t });
    if (membership.state !== "active") return "joined";
    await this.createMember(rt, membership, { age, firstName: name });
    // Their answer is their first message: the Network welcomes them as a reply to it.
    await this.memberMessage(rt, membership.memberId, ev, rowId, undefined);
    // A person who uses another app with this number: the link notice (never names the other app).
    if (others.length) {
      await rt.unitOfWork(() => { rt.system(membership.memberId, `link:${rowId}`, c.linkNotice, "transactional", "info"); });
      this.linkOffers.add(`${app.id}:${key}`);
    }
    return "joined";
  }

  /** SHARE after the link notice: base-profile grants from the person's other apps (a grant copies nothing). */
  private async share(rt: NetworkRuntime, app: AppInfo, memberId: MemberId, e164: string, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string): Promise<InboundOutcome> {
    const person = await this.accounts.personFor(e164);
    this.linkOffers.delete(`${app.id}:${this.phoneKey(e164)}`);
    if (person) for (const m of await this.people.memberships(person.id)) {
      if (m.app !== app.id && m.state !== "removed" && m.state !== "invited") await this.accounts.share(app, { e164, personId: person.id }, m.app, ["first_name", "city", "interests"]);
    }
    return rt.unitOfWork(async () => {
      rt.unit.inbound = { id: rowId, member_id: memberId, direction: "inbound", channel: ev.transport === "sms" ? "sms" : "imessage", body: ev.text, status: "received", type: null, opportunity_id: null, proactive: false, system: false, ts: new Date(this.clock.now()) };
      rt.system(memberId, `sys:${rowId}`, this.copyOf(app).shareDone, "reply", "info");
      return "handled" as const;
    });
  }

  // ------------------------------------------------------------------ staff
  /** A staff action: an audit row first (no row, no action), the action in a unit of work, then a result row. */
  private async staffAction(rt: NetworkRuntime, user: StaffUser, action: string, target: { type: NonNullable<AuditEntry["targetType"]>; id: string }, detail: Row, fn: (n: NetworkRuntime["net"]) => ActionResult): Promise<ActionResult> {
    const base = { actor: user.id, roles: user.roles, action, targetType: target.type, targetId: target.id, mode: "real" as const, app: rt.app.id };
    await this.audit.write({ ...base, at: this.clock.now(), ok: true, detail: { ...detail, network: rt.id, phase: "requested" } });
    const r = await rt.unitOfWork(fn);
    await this.audit.write({ ...base, at: this.clock.now(), ok: r.ok, detail: { ...detail, network: rt.id, phase: "result", ...(r.ok ? {} : { reason: r.reason }) } })
      .catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    return r;
  }

  /** The review queue of a network (default The Network), oldest first, from the newest stored state. */
  reviewQueue(rt = this.main) { return rt.reviewQueue(); }

  review(user: StaffUser, oppId: string, decision: ReviewDecision, o: Omit<ReviewOptions, "reviewer">, rt = this.main) {
    const opts: ReviewOptions = { ...o, reviewer: user.id };
    const detail = { decision, reason: o.reason ?? null, ...(o.swapOut ? { swapOut: o.swapOut } : {}), ...(o.explanations || o.objective ? { edited: [...Object.keys(o.explanations ?? {}).map(k => `explanation:${k}`), ...(o.objective !== undefined ? ["objective"] : [])] } : {}) };
    return this.staffAction(rt, user, "review", { type: "opportunity", id: oppId }, detail, n => n.decide(oppId, decision, opts));
  }

  liftHold(user: StaffUser, memberId: MemberId, note?: string, rt = this.main) {
    return this.staffAction(rt, user, "safety", { type: "member", id: memberId }, { safety: "lift_hold" }, n => n.liftHold(memberId, user.id, note));
  }

  closeCase(user: StaffUser, caseId: string, note?: string, rt = this.main) {
    return this.staffAction(rt, user, "safety", { type: "case", id: caseId }, { safety: "close_case" }, n => n.closeCase(caseId, user.id, note));
  }

  /**
   * A staff invite: an 'invited' membership on this app, then one invitation text (dry-run unless the
   * live flags are set). The person's reply with name and age is the join. Refused for a number that
   * deleted everything or is on hold, and for someone who is already a member.
   */
  async invite(user: StaffUser, rt: NetworkRuntime, e164: string): Promise<ActionResult> {
    const key = this.phoneKey(e164);
    const target = { type: "member" as const, id: key.slice(0, 16) };
    await this.audit.write({ actor: user.id, roles: user.roles, action: "invite", targetType: target.type, targetId: target.id, mode: "real", app: rt.app.id, at: this.clock.now(), ok: true, detail: { network: rt.id, phase: "requested" } });
    const m = await this.accounts.invite(rt.app, e164);
    const r: ActionResult = !m ? { ok: false, reason: "not_invitable" } : m.state !== "invited" ? { ok: false, reason: "already_member" } : { ok: true };
    if (r.ok) await this.direct(rt, e164, this.copyOf(rt.app).invited(rt.app.minJoinAge), `invite:${rt.app.id}:${key.slice(0, 16)}:${this.clock.now()}`);
    await this.audit.write({ actor: user.id, roles: user.roles, action: "invite", targetType: target.type, targetId: target.id, mode: "real", app: rt.app.id, at: this.clock.now(), ok: r.ok, detail: { network: rt.id, phase: "result", ...(r.ok ? {} : { reason: r.reason }) } })
      .catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    return r;
  }

  /** The matching switch of one network. A network whose registry row does not allow matching (slop and peon until their packs ship) refuses "on". */
  setMatching(user: StaffUser, on: boolean, rt = this.main) {
    if (on && !rt.matchingAllowed) {
      // A refused attempt is audited too.
      return this.audit.write({ actor: user.id, roles: user.roles, action: "config", targetType: "config", targetId: `matching_${rt.id}`, mode: "real", app: rt.app.id, at: this.clock.now(), ok: false, detail: { matching: on, network: rt.id, phase: "refused", reason: "matching_not_allowed" } })
        .then(() => ({ ok: false, reason: "matching_not_allowed" }) as ActionResult);
    }
    return this.staffAction(rt, user, "config", { type: "config", id: `matching_${rt.id}` }, { matching: on }, n => { n.setMatchingEnabled(on, user.id); return { ok: true }; });
  }

  /** Health of one network (default The Network), plus a summary of every network the user holds a role for. */
  async health(rt = this.main, user?: StaffUser) {
    const h = await rt.health();
    if (this.runtimes.size < 2) return h;
    const networks = [];
    for (const r of this.runtimes.values()) {
      if (user && r !== rt && !allowed(user, ["admin", "reviewer", "safety", "analyst"], r.app.id, "real")) continue;
      const x = r === rt ? h : await r.health();
      networks.push({ network: x.network, app: x.app, matchingAllowed: x.matchingAllowed, matchingEnabled: x.matchingEnabled, lastTick: x.lastTick.thisInstance, lockHolder: x.lockHolder, backlog: x.backlog });
    }
    return { ...h, networks };
  }

  // ------------------------------------------------------------------ HTTP
  /** The HTTP handler: the inbound webhooks and the staff API. The public API is publicFetch (its own port). */
  fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    let path = url.pathname.replace(/\/+$/, "") || "/";
    try {
      if (path === WEBHOOK_PATH || path.startsWith(`${WEBHOOK_PATH}/`)) {
        if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        const appPart = path.slice(WEBHOOK_PATH.length + 1);
        if (!appPart) return this.webhook(req, this.secret);
        if (!isAppId(appPart)) return json({ ok: false, error: "not_found" }, 404);
        return this.webhook(req, this.secrets[appPart], appPart);
      }
      // Production review is "human" only (PRD 32.8). The mode is not exposed here.
      if (path === "/review-mode" || path.endsWith("/review-mode")) return json({ ok: false, error: "not_exposed" }, 404);
      // The network: /apps/:app/... or ?app= (and ?city=); default The Network.
      let app: AppId = "ntwrk";
      const scoped = path.match(/^\/apps\/([^/]+)(\/.*)?$/);
      const named = scoped ? scoped[1]! : url.searchParams.get("app");
      if (named !== null) {
        if (!isAppId(named)) return json({ ok: false, error: "unknown_app" }, 404);
        app = named;
      }
      if (scoped) path = scoped[2] ?? "/";
      const rt = this.runtimeFor(app, url.searchParams.get("city") ?? undefined) ?? (named === null ? this.main : undefined);
      if (!rt) return json({ ok: false, error: "no_network" }, 404);
      const auth = this.tokens.size ? authenticate(req, { tokens: this.tokens }) : { status: 401 as const, error: "no staff tokens configured (NETWORK_SERVICE_TOKENS)" };
      if (!("user" in auth)) return json({ ok: false, error: auth.error }, auth.status);
      const user = this.reviewerOfRecord(req, auth.user);
      // A role for this app (role@app or role@*); admin for the app passes every check.
      const need = (roles: StaffRole[]) => (allowed(user, roles, rt.app.id, "real") ? undefined : json({ ok: false, code: "forbidden", error: `needs role ${roles.map(r => `${r}@${rt.app.id}`).join(" or ")}` }, 403));
      if (req.method === "GET" && path === "/health") {
        const no = need(["admin", "reviewer", "safety", "analyst"]); if (no) return no;
        return json(await this.health(rt, user));
      }
      if (req.method === "GET" && path === "/review") {
        const no = need(["reviewer", "safety"]); if (no) return no;
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_review_queue", mode: "real", ok: true, app: rt.app.id });
        return json({ ok: true, network: rt.id, items: await this.reviewQueue(rt) });
      }
      if (path === "/holds") {
        // Numbers on hold (they may have a new owner): staff for every app decide (GET lists, POST decides).
        if (!hasEverywhere(user, "admin")) return json({ ok: false, code: "forbidden", error: "needs role admin@*" }, 403);
        if (req.method === "GET") return json({ ok: true, holds: (await this.accounts.heldPhones()).map(h => ({ phone: maskPhone(h.e164), hold: h.hold, lastSeenAt: h.lastSeenAt })) });
        if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        const b = await body(req) as Record<string, any> | undefined;
        const e164 = normalizePhone(b?.phone);
        if (!e164 || (b?.decision !== "same_owner" && b?.decision !== "new_owner")) return json({ ok: false, error: "phone_and_decision_required" }, 400);
        const target = this.phoneKey(e164).slice(0, 16);
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "safety", targetType: "member", targetId: target, mode: "real", ok: true, detail: { safety: "phone_hold", decision: b.decision, phase: "requested" } });
        const ok = await this.accounts.clearHold(e164, b.decision);
        return result(ok ? { ok: true } : { ok: false, reason: "not_held" });
      }
      if (req.method !== "POST") return json({ ok: false, error: "not_found" }, 404);
      const m = path.match(/^\/review\/([^/]+)$/);
      if (m) {
        const no = need(["reviewer"]); if (no) return no;
        const b = await body(req);
        if (!b) return json({ ok: false, error: "invalid_json" }, 400);
        const { decision, reason, note, secondsSpent, explanations, objective, swapOut } = b as Record<string, any>;
        return result(await this.review(user, decodeURIComponent(m[1]!), decision, { reason, note, secondsSpent, explanations, objective, swapOut }, rt));
      }
      if (path === "/safety/lift" || path === "/safety/close") {
        const no = need(["safety"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        if (!b) return json({ ok: false, error: "invalid_json" }, 400);
        if (path === "/safety/lift") return typeof b.memberId === "string" ? result(await this.liftHold(user, b.memberId, b.note, rt)) : json({ ok: false, error: "memberId_required" }, 400);
        return typeof b.caseId === "string" ? result(await this.closeCase(user, b.caseId, b.note, rt)) : json({ ok: false, error: "caseId_required" }, 400);
      }
      if (path === "/invite") {
        // A staff invite to this app (an invite-only app: the person's reply with name and age is the join).
        const no = need(["admin"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        const e164 = normalizePhone(b?.phone);
        if (!e164) return json({ ok: false, error: "phone_required" }, 400);
        return result(await this.invite(user, rt, e164));
      }
      if (path === "/matching") {
        const no = need(["admin"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        if (typeof b?.on !== "boolean") return json({ ok: false, error: "on_required" }, 400);
        return result(await this.setMatching(user, b.on, rt));
      }
      return json({ ok: false, error: "not_found" }, 404);
    } catch (e) {
      this.log(`[http] ${req.method} ${path} failed: ${(e as Error).message}`);
      return json({ ok: false, error: "internal_error" }, 503);
    }
  };

  /** The console's token may name the signed-in staff member (X-Network-Staff-Id); any other token may not. */
  private reviewerOfRecord(req: Request, user: StaffUser): StaffUser {
    const named = req.headers.get("x-network-staff-id")?.trim();
    if (!named || !this.consoleToken) return user;
    const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
    const a = Buffer.from(given), b = Buffer.from(this.consoleToken);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return user;
    if (named.length > 200 || !/^([^\s@]+@[^\s@]+\.[^\s@]+|token:[a-z_+]+#[0-9a-f]{8})$/i.test(named)) return user;
    return { ...user, id: named };
  }

  /** POST /webhooks/blooio[/:app]: verify the signature on the raw body (the prototype's rules), parse, handle. 401 never retries; 500 asks Blooio to retry. */
  private async webhook(req: Request, secret: string | undefined, app?: AppId): Promise<Response> {
    if (!secret) return json({ ok: false, error: "webhook_secret_missing" }, 503);
    if (Number(req.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json({ ok: false, error: "payload_too_large" }, 413);
    const sig = verifyBlooioSignature(secret, req.headers.get(SIGNATURE_HEADER), raw, Math.floor(this.clock.now() / 1000));
    if (!sig.ok) return json({ ok: false, error: `signature_${sig.reason}` }, 401);
    let ev: ChannelEvent;
    try { ev = parseBlooioWebhook(raw, this.clock.now()); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
    try {
      return json({ ok: true, result: await this.inbound(ev, app ? { app } : {}) });
    } catch (e) {
      this.log(`[inbound] processing failed: ${(e as Error).message}`);
      return json({ ok: false, error: "processing_failed" }, 500);
    }
  }

  async close() {
    await this.audit.close().catch(() => {});
    await this.sql.close();
  }
}

/** Per-app webhook secrets from the environment: <APP>_BLOOIO_WEBHOOK_SECRET. */
export function webhookSecretsFromEnv(env: Env = process.env): Partial<Record<AppId, string>> {
  const out: Partial<Record<AppId, string>> = {};
  for (const a of Object.keys(APPS) as AppId[]) { const s = env[`${a.toUpperCase()}_BLOOIO_WEBHOOK_SECRET`]; if (s) out[a] = s; }
  return out;
}

const json = (data: unknown, status = 200) => Response.json(data, { status });
const result = (r: ActionResult) => json(r, r.ok ? 200 : 409);
async function body(req: Request): Promise<unknown> {
  try { const b = await req.json(); return b && typeof b === "object" ? b : undefined; } catch { return undefined; }
}
