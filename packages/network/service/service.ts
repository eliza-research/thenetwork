// The production runtime of the Network for every app (README.md in this folder; platform plan 4.4, 6.1).
//  - One process holds one NetworkRuntime per row of platform.networks ('<app>:<city>'). Each runtime
//    ticks and handles units of work under its own PgStore advisory lock (runtime.ts).
//  - Inbound (Blooio webhooks, signed): /webhooks/blooio is the one line for every app
//    (BLOOIO_WEBHOOK_SECRET; founder decision 2): a row in platform.app_lines for the receiving line
//    names the app; otherwise the whole first message routes by keyword ("slop", "slop.date",
//    "friends.help", ...), then a member's open item, then the app that wrote last. With no keyword a
//    stranger joins The Network: first name and age, then "what are you looking for?" (friends,
//    dating, work), which enrolls them in the matching apps, each age-checked.
//    /webhooks/blooio/:app is an app's own line, if one ever gets one (<APP>_BLOOIO_WEBHOOK_SECRET).
//  - Phone -> person -> membership -> member id. Joins are 13+ on every app; minors are never matched.
//    Nothing is stored until the age check passes (a refused age goes to the phone's age floor only).
//    Responses never say whether the phone uses another app.
//  - Text flows that wait for the person's next message (a join, "what are you looking for?", the
//    SHARE offer) are in platform.pending_texts, so a restart or a second instance keeps them.
//  - STOP (and the reasonable-means phrasings) stops every app on the line; "leave <app>" leaves that
//    app only (the forget path). Both go through the platform consent ledger, once per message.
//  - An age the person states in chat lowers the person's age on every app: a minor anywhere is a
//    minor everywhere, and under 13 removes every membership.
//  - The platform public API (packages/platform createPublicApi) with hooks into the networks:
//    publicFetch, served on PLATFORM_API_PORT (main.ts).
//  - Staff API: role tokens per app ("reviewer@slop:<t>"; NETWORK_SERVICE_TOKENS), ?app= or
//    /apps/:app/..., each action audited. The review mode is never exposed: production is "human" only.
//  - Sends: each app's adapter (dry-run by default; Blooio needs the per-app live flag too) after a
//    person-level cap of proactive messages across apps (default 3 a day).
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { SQL } from "bun";
import { isDeepStrictEqual } from "node:util";
import { DAY, RealClock, type Clock, type MemberId } from "@thenetwork/core";
import type { ActionResult, NetworkOptions, ReviewDecision, ReviewOptions } from "../src/network.ts";
import { brandOf, copy as ntwrkCopy, copyFor, ELIZA_NOTICE, type Copy } from "../src/copy.ts";
import { isMinor } from "@thenetwork/core";
import { ageAnswer, agesStated } from "../src/classify.ts";
import { NetworkRuntime, type RuntimeHost } from "./runtime.ts";
import { effectiveParticipation } from "./snapshot.ts";
import { Inbox, type CollectedReply } from "./inbox.ts";
import { TURN_PATH, TURN_RECEIPT_PATH, SET_STATE_PATH, SIGNALS_PATH, UPDATES_PATH, type SetStateRequest, type TurnRequest, type TurnResponse } from "../../core/src/svc/contract.ts";
import { SVC_MIN_SECRET, svcVerify } from "../../core/src/svc/svc-auth.ts";
import { readCapped } from "../../platform/src/body.ts";
import { canJoin } from "../../core/src/policy.ts";
import { CostLedger, costRatesFromEnv, PgCostSink } from "./cost.ts";
import type { ChannelAdapter, DirectKind, Outbound } from "./channel.ts";
import { APPS, isAppId, keywordApp, lookingFor, POWERED_BY, type AppId, type AppInfo } from "../../platform/src/apps.ts";
import { Accounts, type AccountHooks, type JoinHookContext, type MemberHookContext } from "../../platform/src/accounts.ts";
import { joinAgeCheck } from "../../platform/src/age.ts";
import { detectKeyword as platformKeyword, keywordEvent, leaveTarget, resolveConsent, stopScope, type StopScope } from "../../platform/src/consent.ts";
import { devShortcutsAllowed, isProduction, platformEnv, type Env } from "../../platform/src/env.ts";
import { keyedHash, maskPhone, normalizePhone } from "../../platform/src/phone.ts";
import { PgPeopleStore } from "../../platform/src/pg-store.ts";
import type { Membership, PeopleStore, PendingText, Person } from "../../platform/src/store.ts";
import { createPublicApi, type MemberParticipation, type PublicApi, type PublicApiOptions } from "../../platform/src/api.ts";
import { otpProviderFromEnv } from "../../platform/src/otp.ts";
import { turnstileFromEnv } from "../../platform/src/turnstile.ts";
import type { PeerInfo } from "../../platform/src/api.ts";
import { PHOTO_APPS, PgPhotoStore, PhotoService, photoStorageFromEnv, type PhotoRater, type PhotoStorage } from "../../platform/src/photos.ts";
import { appearanceFacet, type AppearanceScore, type RatingSubject } from "../../engine/src/packs/slop/appearance.ts";
import { fetchMediaCapped, PhotoIntake, type PhotoIntakeDeps } from "./photoIntake.ts";
import { BIAS_EVERY_MS, biasAlerts, biasReport, type BiasMember, type StoredBiasReport } from "./bias.ts";
import { DEFAULT_SLA_HOURS } from "../../observatory/src/apps.ts";
import type { Ban } from "../../platform/src/store.ts";
import { parseBlooioWebhook, SIGNATURE_HEADER, verifyBlooioSignature } from "../../blooio/src/blooio/webhook.ts";
import { normalizeAddress } from "../../blooio/src/phone.ts";
import { resolveTimeZone } from "../../blooio/src/quiet-hours.ts";
import { Notifier, type InboxItem, type NotifyStore, type OutboundSink, type Recipient, type Surface } from "../../notify/src/index.ts";
import { PgNotifyStore } from "../../notify/src/pg-store.ts";
import { RELAY_PATH, relayClassifierFromEnv, relayEndpoint } from "./relay-endpoint.ts";
import type { RelayClassifierHook } from "../../engine/src/relay.ts";
import type { ChannelEvent } from "../../blooio/src/types.ts";
// The Observatory's staff auth (per-app role grants) and audit sink, so the console and the service agree.
import { allowed, authenticate, hasEverywhere, parseTokenGrants, PgAudit, type AuditSink } from "../../observatory/src/staff.ts";
import type { AuditEntry, RoleGrant, StaffRole, StaffUser } from "../../observatory/src/types.ts";

export { NetworkRuntime } from "./runtime.ts";
type Row = Record<string, unknown>;
const MAX_BODY_BYTES = 256 * 1024;
export const WEBHOOK_PATH = "/webhooks/blooio";
/**
 * STOP, START, HELP and "leave <app>" have one owner: this service, inside the signed turn
 * (POST /internal/turn) or the legacy webhook. The handled turn reports the change as `consent`, and the
 * Eliza gateway mirrors it into its send-time fence. STOP_HELP_OWNER and POST /consent/gateway are
 * retired (the upstream gateway never called that route); a value left in the environment is ignored.
 */
export const RETIRED_ENV = ["STOP_HELP_OWNER", "STOP_HELP_GATEWAY_SECRET"] as const;
/**
 * The turn secret (SERVICE_TURN_SECRET) is checked at start: the turn path is on when the secret is set
 * or the Cloud channel is asked for, and then the secret must have at least SVC_MIN_SECRET characters.
 * Returns the problem, or undefined.
 */
export function turnSecretProblem(env: Record<string, string | undefined> = process.env): string | undefined {
  const secret = env.SERVICE_TURN_SECRET;
  const on = !!secret || env.NETWORK_CHANNEL === "eliza_cloud";
  if (!on) return undefined;
  if (!secret || secret.length < SVC_MIN_SECRET) return `SERVICE_TURN_SECRET must have at least ${SVC_MIN_SECRET} characters when the turn path is on`;
  return undefined;
}
/** The tables the service needs (bun run db:migrate). */
const REQUIRED_TABLES = [
  ...["members", "channel_identities", "facets", "intents", "presence", "edges", "messages", "events", "matching_runs", "staff_audit", "network_state", "opportunities", "review_items", "requests"].map(t => `network.${t}`),
  ...["apps", "networks", "people", "phone_identities", "memberships", "consent_events", "person_blocks", "app_lines", "share_grants", "eliza_notices"].map(t => `platform.${t}`),
];
/** The dev-only key for keyed phone hashes (the platform's own default). Production needs PLATFORM_HASH_KEY. */
const DEV_HASH_KEY = "dev-only-platform-hash-key";
/** Proactive messages one person gets a day, across every app (PRD 40.3). */
export const PERSON_DAILY_CAP = 3;
/** A pending text flow (a join, "what are you looking for?", a SHARE offer) is forgotten after a day. */
const PENDING_MS = DAY;
/**
 * The SMS disclosure in the question whose answer opts the person in to more apps (audit: the
 * looking-for consent stored a question with no frequency, rates or STOP; the web join needs them).
 */
const LOOKING_FOR_DISCLOSURE = "Each app you pick will text you about it. Message frequency varies. Message and data rates may apply. Reply STOP to stop, HELP for help.";
/** The Network's question after a join with no keyword (founder decision 2). */
export const LOOKING_FOR_ASK = `What are you looking for: friends, dating, work, or all of these? You can pick more than one. ${LOOKING_FOR_DISCLOSURE} ${POWERED_BY}`;
/** The same question to a member aged 13-17: dating is never offered (slop is never enrolled from it). */
export const LOOKING_FOR_ASK_MINOR = `What are you looking for: friends, work, or both? ${LOOKING_FOR_DISCLOSURE} ${POWERED_BY}`;
/** The question for an age: minors never see dating. */
export const lookingForAsk = (age: number | undefined) => (age === undefined || age < 18 ? LOOKING_FOR_ASK_MINOR : LOOKING_FOR_ASK);
const listApps = (apps: AppInfo[]) => apps.map(a => a.domain).join(apps.length === 2 ? " and " : ", ");
/** The Network's answer after it enrolled the person in the apps they named. */
export const enrolledText = (apps: AppInfo[]) =>
  `Done: you're in ${listApps(apps)}. Text an app's name (like ${apps[0]!.domain}) to talk to it, or "leave ${apps[0]!.domain}" to leave one. ${POWERED_BY}`;
/** Safety on every app (safety@* or admin@*): what a hold on other apps and a ban need. */
const crossAppSafety = (u: StaffUser) => hasEverywhere(u, "safety") || hasEverywhere(u, "admin");
/** Staff review actions the API takes, and the reason codes (PRD 32.8 and the per-app lists). */
const DECISIONS = new Set(["approve", "reject", "edit", "reroll"]);
/** A reviewer's time on one item is clamped to an hour (audit observatory-10). */
const MAX_REVIEW_SECONDS = 3600;

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
  publicApi?: Partial<Pick<PublicApiOptions, "otp" | "turnstile" | "hostMap" | "trustForwardedHost" | "minStartMs" | "minVerifyMs" | "otpLimits" | "demo" | "ipOf" | "cloudAuthFetch">>;
  /** PLATFORM_STOP_SCOPE, PLATFORM_HASH_KEY, NODE_ENV/PLATFORM_ENV. Default process.env. */
  env?: Env;
  /** Photo storage (platform photos.ts). Default: PHOTO_STORAGE from the environment; null turns photos off. */
  photoStorage?: PhotoStorage | null;
  /** The appearance rater (server.ts: makeClefRaterFromEnv behind withRetry). Undefined: ratings are off; photos still work. */
  photoRater?: PhotoRater;
  /** Fetch one attachment of a photo sent by text (default: https only, capped; photoIntake.ts). The simulation passes a fake. */
  fetchMedia?: PhotoIntakeDeps["fetchMedia"];
  /** The origin staff photo links use (PHOTO_VIEW_BASE_URL). Default: https://<the app's domain>, which the site router forwards to /api/*. */
  photoBaseUrl?: string;
  /**
   * Networks whose stored matching switch starts ON when no state is stored yet (dev only; refused
   * outside PLATFORM_ENV=dev). Production starts every network off: an admin turns it on in the console.
   */
  devMatching?: string[];
  /**
   * The single inbox (packages/notify; entry-flows doc 5). Default: PgNotifyStore on `url` (schema
   * `notify`, migration 9002). false turns it off. Every member-facing send that went out is recorded
   * (already delivered, never texted again); assistants read it through the MCP get_updates tool.
   */
  notify?: NotifyStore | false;
  log?: (line: string) => void;
}

/** Member-facing Network sends that become inbox items (meta.type of ConsentNetwork.send). */
const NOTIFY_TYPES = new Set(["probe", "plan_probe", "proposal", "reminder", "feedback_request", "cancellation", "scheduling"]);
const NOTIFY_SUMMARY_MAX = 500;

export type InboundOutcome =
  | "open" | "handled" | "duplicate" | "unknown_sender" | "ignored" | "ignored_group" | "status" | "reaction" | "safety"
  | "invite_only" | "join_asked" | "joined" | "under_age" | "stopped" | "left" | "no_network" | "held";

interface Route { app: AppId; shared: boolean }

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
  /** The relay classifier (relay-endpoint.ts): Clef when the Workers AI token and account are set, else rules only. Set at start. */
  private relayHook?: RelayClassifierHook;
  readonly apps: Record<AppId, AppInfo>;
  readonly people: PeopleStore;
  readonly accounts: Accounts;
  /** The single inbox and notification scheduler; undefined when turned off. */
  readonly notify?: Notifier;
  /** Address to (runtime, member) for the notify sink, filled by the notify directory. */
  private readonly notifyTargets = new Map<string, { rt: NetworkRuntime; memberId: MemberId }>();
  /** One runtime per network, in platform.networks order (ntwrk first). */
  readonly runtimes = new Map<string, NetworkRuntime>();
  readonly log: (line: string) => void;
  private readonly env: Env;
  private readonly tokens: Map<string, RoleGrant[]>;
  private readonly consoleToken?: string;
  private readonly secret?: string;
  private readonly secrets: Partial<Record<AppId, string>>;
  private readonly hashKey: string;
  /** The inbound inbox: one row per provider message, handled once and in order per sender (inbox.ts). */
  readonly inbox: Inbox;
  private readonly cap: number;
  private readonly apiOptions: ServiceOptions["publicApi"];
  private api?: PublicApi;
  private readonly copies = new Map<AppId, Copy>();
  private readonly forgetListeners: Array<(ctx: MemberHookContext) => Promise<unknown> | unknown> = [];
  /** Private member photos (slop; verified adults only). */
  readonly photos: PhotoService;
  /** Photos sent by text (photoIntake.ts). */
  readonly photoIntake: PhotoIntake;
  /** Review items already alerted for passing their app's SLA (this instance). */
  private readonly slaAlerted = new Set<string>();
  private readonly photoBaseUrl?: string;
  /** Estimated cost per event, per app and per day (cost.ts, network.cost_ledger): OTP codes, photo ratings, LLM calls. */
  readonly cost: CostLedger;

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
    const turnProblem = turnSecretProblem(this.env);
    if (turnProblem) throw new Error(turnProblem);
    for (const v of RETIRED_ENV) if (this.env[v]) this.log(`${v} is retired and ignored: STOP, START and HELP are answered inside the signed turn (README "The Eliza seam")`);
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
    this.cost = new CostLedger({ sink: new PgCostSink(this.sql), clock: this.clock, rates: costRatesFromEnv(this.env), log: this.log });
    this.accounts = new Accounts(this.people, { hashKey: this.hashKey, now: () => this.clock.now(), env: this.env, apps: id => this.apps[id], hooks: this.hooks() });
    if (o.notify !== false) this.notify = new Notifier(o.notify ?? new PgNotifyStore(this.sql), { get: personId => this.notifyRecipient(personId) });
    for (const spec of specs) {
      const id = spec.id.includes(":") ? spec.id : `ntwrk:${spec.id}`;
      const [app, city] = id.split(":") as [string, string];
      if (!isAppId(app) || !this.apps[app]) throw new Error(`network ${id}: unknown app "${app}"`);
      // Dev only: the stored switch of these networks starts on (a new state); production always starts off.
      const devOn = (o.devMatching ?? []).includes(id);
      if (devOn && !devShortcutsAllowed(this.env)) throw new Error("devMatching is for PLATFORM_ENV=dev only: production matching is turned on by an admin in the console");
      this.runtimes.set(id, new NetworkRuntime(this, { id, app: this.apps[app], city, matchingAllowed: spec.matchingEnabled ?? true, network: devOn ? { ...o.network, matchingEnabled: true } : o.network, adapter: o.adapter }));
    }
    this.photoBaseUrl = o.photoBaseUrl ?? this.env.PHOTO_VIEW_BASE_URL ?? undefined;
    this.photos = new PhotoService({
      people: this.people, meta: new PgPhotoStore(this.sql), storage: o.photoStorage === null ? undefined : o.photoStorage ?? photoStorageFromEnv(this.env),
      signingKey: key, now: () => this.clock.now(), rater: o.photoRater && this.cost.meterRater(o.photoRater), log: this.log,
      eligible: (personId, app) => this.verifiedAdult(personId, app),
      banned: personId => this.personBanned(personId),
      onRating: (personId, app, score, subject) => this.writeRating(personId, app, score, subject),
      onRemoved: (personId, app) => this.dropRatings(personId, app),
    });
    this.photoIntake = new PhotoIntake({
      people: this.people, accounts: this.accounts, photos: this.photos, phoneKey: e164 => this.phoneKey(e164), now: () => this.clock.now(),
      fetchMedia: o.fetchMedia ?? fetchMediaCapped, log: this.log,
      reply: async (e164, text, key) => { const rt = this.runtimeFor("slop"); if (rt) await this.direct(rt, e164, text, key, "reply"); },
    });
    this.audit = o.audit ?? new PgAudit(o.auditUrl ?? o.url);
    this.inbox = new Inbox({ sql: this.sql, clock: this.clock, log: this.log, senderKey: sender => this.phoneKey(sender), handle: (ev, app) => this.inbound(ev, app && isAppId(app) ? { app } : {}) });
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
    this.relayHook = relayClassifierFromEnv(this.env, this.log);
    for (const rt of this.runtimes.values()) await rt.start();
  }

  /** One tick on every network, each under its own lock. True when any network ran (one network: whether it ran). */
  async tick(): Promise<boolean> {
    let any = false;
    await this.inboxTick();
    for (const rt of this.runtimes.values()) any = (await rt.tick()) || any;
    await this.purge();
    return any;
  }

  /**
   * RuntimeHost.afterTick: after a tick that ran on this instance, the review SLA alerts and, once a
   * week, the bias monitor of a network whose app takes photos. Each logs "[alert] ..." lines that the
   * host's log alerts pick up (docs/deploy.md); a failure is logged and never stops the tick.
   */
  async afterTick(rt: NetworkRuntime): Promise<void> {
    for (const line of slaAlerts(rt.id, rt.net.reviewQueue(), this.clock.now(), DEFAULT_SLA_HOURS[rt.app.id], this.slaAlerted)) this.log(line);
    if (PHOTO_APPS.includes(rt.app.id)) await this.weeklyBias(rt);
  }

  /** The bias monitor of one network when its last stored report is a week old (or there is none). Returns the new report, if one was made. */
  async weeklyBias(rt: NetworkRuntime, force = false): Promise<StoredBiasReport | undefined> {
    const now = this.clock.now();
    const [last] = await rt.scoped(tx => tx`select max(at) as at from network.bias_reports where app_id = ${rt.app.id} and network_id = ${rt.id}`);
    if (!force && last?.at && now - new Date(last.at as string).getTime() < BIAS_EVERY_MS) return undefined;
    const rows = await rt.scoped(tx => tx`select m.id, m.age, m.joined_at, coalesce(array_agg(t) filter (where t like 'appearance:%'), '{}') as tags
      from network.members m left join network.facets f on f.app_id = m.app_id and f.member_id = m.id and f.status <> 'rejected' left join lateral unnest(f.tags) t on true
      where m.app_id = ${rt.app.id} and m.account_status in ('active', 'paused', 'restricted') group by m.id, m.age, m.joined_at order by m.id`) as any[];
    const members: BiasMember[] = rows.map(r => ({ id: r.id, age: r.age, joinedAt: r.joined_at ? new Date(r.joined_at).getTime() : null, tags: r.tags ?? [] }));
    const r = biasReport(rt.id, rt.app.id, members, [...rt.net.opps.values()], now);
    await rt.scoped(tx => tx`insert into network.bias_reports (app_id, id, network_id, at, members, alerts, report)
      values (${rt.app.id}, ${`bias_${rt.id}_${now}`}, ${rt.id}, ${new Date(now)}, ${r.members}, ${r.report.alerts.length}, ${r.report as unknown as Row}::jsonb)`);
    this.log(`[bias] ${rt.id}: ${r.members} adult member(s), ${r.report.alerts.length} alert(s)`);
    for (const line of biasAlerts(r)) this.log(line);
    return r;
  }

  /** The newest stored bias reports of a network (the console's bias panel). */
  async biasReports(rt: NetworkRuntime, limit = 8): Promise<StoredBiasReport[]> {
    const rows = await rt.scoped(tx => tx`select network_id, app_id, at, members, report from network.bias_reports where app_id = ${rt.app.id} and network_id = ${rt.id} order by at desc limit ${limit}`) as any[];
    return rows.map(r => ({ network: r.network_id, app: r.app_id, at: new Date(r.at).getTime(), members: r.members, report: typeof r.report === "string" ? JSON.parse(r.report) : r.report }));
  }

  /** Inbound messages a crash or an error left waiting (platform.inbound): handled once, in order per sender. */
  async inboxTick(): Promise<void> {
    const n = await this.inbox.drain().catch(e => { this.log(`[inbound] inbox drain failed: ${(e as Error).message}`); return 0; });
    if (n) this.log(`[inbound] ${n} waiting inbound message(s) handled`);
  }

  /** Retention (audit platform-18): expired OTP challenges and sessions, old rate windows and stale text flows. */
  async purge() {
    const n = await this.people.purge(this.clock.now() - 2 * DAY).catch(e => { this.log(`[purge] failed: ${(e as Error).message}`); return 0; });
    // The inbox keeps handled ids a week (dedupe); the line keeps no counters for an address that is nobody's phone.
    await this.inbox.purge(this.clock.now() - 7 * DAY).catch(e => this.log(`[purge] inbox failed: ${(e as Error).message}`));
    await this.lineAdapter()?.purge?.().catch(e => { this.log(`[purge] line counters failed: ${(e as Error).message}`); return 0; });
    if (n) this.log(`[purge] removed ${n} expired platform row(s)`);
    return n;
  }

  /** A unit of work on The Network (the first network). */
  unitOfWork<T>(fn: (n: NetworkRuntime["net"]) => Promise<T> | T): Promise<T> { return this.main.unitOfWork(fn); }

  // ------------------------------------------------------------------ the person cap (RuntimeHost)
  /**
   * The proactive sends of a batch that would take a person over the daily cap across every app
   * (PRD 40.3), checked at send time. The count is a platform counter (platform.person_sends) taken by
   * platform.person_cap_take (SECURITY DEFINER, migration 0007) under one lock for every app: two
   * networks that deliver at once cannot both pass the cap, and the network_service role (one app per
   * transaction) still counts every app. It returns the refused ids only. Members the platform does
   * not know (no person_id) have only their app's own limits.
   */
  async capRefused(rt: NetworkRuntime, batch: Outbound[]): Promise<Set<string>> {
    const pro = batch.filter(b => b.proactive || b.kind === "proactive");
    if (!this.cap || !pro.length) return new Set();
    const now = this.clock.now();
    const sends = pro.map(b => ({ id: b.id, member: b.memberId }));
    const rows = await this.sql`select * from platform.person_cap_take(${rt.app.id}, ${sends}::jsonb, ${new Date(now - DAY)}, ${new Date(now)}, ${this.cap}) as id`;
    const out = new Set((rows as any[]).map(r => r.id as string));
    for (const id of out) this.log(`[cap] person cap (${this.cap}/day) holds a proactive send ${id} (${rt.id})`);
    return out;
  }

  /** Release the cap slots of sends the adapter refused (migration 0012). */
  async capRelease(ids: string[]): Promise<void> {
    if (!this.cap || !ids.length) return;
    await this.sql`select platform.person_cap_release(${this.sql.array(ids, "TEXT")})`.catch(e => this.log(`[cap] release failed: ${(e as Error).message}`));
  }

  // ------------------------------------------------------------------ the single inbox (packages/notify)
  /**
   * RuntimeHost.delivered: the member-facing sends that went out become inbox items, already
   * delivered, so the person's assistant can show them (MCP get_updates) and nothing texts them again.
   * Members with no person (from before the platform) are skipped.
   */
  async delivered(rt: NetworkRuntime, sent: Outbound[]): Promise<void> {
    if (!this.notify) return;
    const items = sent.filter(b => !b.system && b.type && NOTIFY_TYPES.has(b.type));
    if (!items.length) return;
    const ids = [...new Set(items.map(b => b.memberId))];
    const rows = await rt.scoped(tx => tx`select id, person_id from network.members where app_id = ${rt.app.id} and person_id is not null and id in ${tx(ids)}`);
    const person = new Map((rows as any[]).map(r => [r.id as string, r.person_id as string]));
    for (const b of items) {
      const personId = person.get(b.memberId);
      if (!personId) continue;
      await this.notify.recordSent(
        { personId, app: rt.app.id, eventType: b.type!, subjectId: b.oppId ?? b.id, urgency: b.proactive ? "normal" : "requested", summary: b.body.trim().slice(0, NOTIFY_SUMMARY_MAX) || "An update from the Network." },
        { deliveryId: `net:${b.id}`, channel: "imessage", countsTowardCap: b.proactive || b.kind === "proactive", sentAt: b.acceptedAt ?? b.ts },
      );
    }
  }

  /**
   * The person's own unseen updates in one app, for their assistant (MCP get_updates). Reading them
   * marks them seen on every surface. An update code limits the result to that text's items; someone
   * else's code, an unknown one or an expired one returns nothing.
   */
  async updatesFor(personId: string, app: AppId, surface: Surface, token?: string): Promise<Array<{ summary: string; at: string; kind: string }>> {
    if (!this.notify) return [];
    const items: InboxItem[] = await this.notify.readUpdates(personId, surface, this.clock.now(), token, { app });
    return items.map(i => ({ summary: i.summary, at: new Date(i.createdAt).toISOString(), kind: i.eventType }));
  }

  /** An assistant connected (OAuth grant) or disconnected (revoked) for a person: the surface signal. */
  async assistantLinked(personId: string, surface: Surface, active: boolean): Promise<void> {
    await this.notify?.setActive(personId, surface, active);
  }

  /** The notify recipient of a person: their first live member with an address on a running network (The Network first). */
  private async notifyRecipient(personId: string): Promise<Recipient | undefined> {
    const rts = [...this.runtimes.values()].sort((a, b) => Number(b.app.id === "ntwrk") - Number(a.app.id === "ntwrk"));
    for (const rt of rts) {
      const rows = await rt.scoped(tx => tx`select id from network.members where app_id = ${rt.app.id} and person_id = ${personId} and not opted_out`);
      for (const r of rows as any[]) {
        const to = rt.addressOf(r.id);
        if (!to) continue;
        this.notifyTargets.set(normalizeAddress(to), { rt, memberId: r.id });
        return { personId, to, timeZone: resolveTimeZone(undefined, rt.city) ?? "America/New_York", prefs: { channel: "imessage" }, proactiveAllowed: true };
      }
    }
    return undefined;
  }

  /**
   * The notify scheduler's own texts go out as a unit of work on the member's network, so delivery
   * applies the platform consent ledger, the member's opt-out and the person cap like every other send.
   */
  private notifySink(): OutboundSink {
    return {
      enqueue: async x => {
        const target = this.notifyTargets.get(normalizeAddress(x.to));
        if (!target) { this.log(`[notify] no network member for a delivery (${x.idempotencyKey}): not sent`); return; }
        await target.rt.unitOfWork(() => target.rt.system(target.memberId, x.idempotencyKey, x.text, x.kind, "notify"));
      },
    };
  }

  /** Once per tick: close stale delivery outcomes, then send what the inbox has due. */
  async notifyTick(): Promise<void> {
    if (!this.notify) return;
    const now = this.clock.now();
    await this.notify.sweep(now);
    await this.notify.dispatch(now, this.notifySink());
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
      // A number that deleted everything stays suppressed until the person opts in again (platform-15).
      const suppressed = await this.people.isSuppressed(this.phoneKey(e164));
      // A banned number or person gets nothing but compliance texts, on every app (PRD 40.5).
      const banned = !suppressed && (await this.people.isBanned(this.phoneKey(e164), (await this.people.findPhone(e164))?.personId ?? null));
      if (banned) { for (const b of sends) out.add(b.id); this.log(`[ban] ${sends.length} send(s) to a banned number refused (${rt.id})`); continue; }
      if (!suppressed && resolveConsent(await this.people.lastConsent(e164, rt.app.id)) !== "opted_out") continue;
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
  async createMember(rt: NetworkRuntime, m: Membership, info: { age: number; firstName: string; neighborhood?: string; interests?: string[]; zip?: string }) {
    const now = new Date(this.clock.now());
    // The app's categories (packs.ts): slop is dating and only for adults; peon is work; friends is social and hobby.
    const prefs = { ...rt.wiring.prefs(info.age), quietHours: [21, 9], formats: ["one_to_one", "small_group", "event"], maxTravelMinutes: 45, onlyWhenAsked: false };
    await this.sql.begin(async tx => {
      await tx`select set_config('app.app_id', ${rt.app.id}, true)`;
      await tx`insert into network.members (app_id, id, person_id, name, home_city, home_area, account_status, age, prefs, joined_at)
        values (${rt.app.id}, ${m.memberId}, ${m.personId}, ${info.firstName}, ${rt.city}, ${info.neighborhood ?? null}, 'active', ${info.age}, ${prefs}::jsonb, ${now})
        on conflict (id) do update set person_id = excluded.person_id, name = excluded.name, home_city = excluded.home_city, home_area = excluded.home_area,
          account_status = 'active', age = excluded.age, joined_at = excluded.joined_at, opted_out = false`;
      if (info.neighborhood) await tx`insert into network.presence (app_id, member_id, city, type, areas) values (${rt.app.id}, ${m.memberId}, ${rt.city}, 'home', ${tx.array([info.neighborhood], "TEXT")})`;
      // slop dates by distance from a zip (a coarse cell; agent_private, never shown).
      if (info.zip && rt.app.id === "slop") {
        await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
          values (${rt.app.id}, ${`${m.memberId}:join:zip`}, ${m.memberId}, 'fact', ${info.zip}, ${tx.array([`slop:zip:${info.zip}`], "TEXT")}, 'agent_private', 'said', 'web_join', 0.9, 'confirmed', ${now})
          on conflict (id) do nothing`;
      }
      for (const tag of info.interests ?? []) {
        await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
          values (${rt.app.id}, ${`${m.memberId}:join:${tag}`}, ${m.memberId}, 'interest', ${tag}, ${tx.array([tag], "TEXT")}, 'matchable', 'said', 'web_join', 0.8, 'confirmed', ${now})
          on conflict (id) do nothing`;
      }
    });
    const turn = this.inboundTurn();
    if (turn && (await this.accounts.personFor(turn.from))?.id === m.personId) {
      turn.app = rt.app.id; turn.memberId = m.memberId;
    }
  }

  /** The platform hooks: a join creates the network member and sends the welcome; stop, forget and export reach the network. */
  private hooks(): AccountHooks {
    return {
      onJoin: (ctx: JoinHookContext) => this.joined(ctx),
      onStop: ctx => this.stopped(ctx.app, ctx.personId, ctx.scope),
      onForget: async (ctx: MemberHookContext) => {
        // The app's photos go first (leave, delete everything, a new owner of the number).
        await this.photos.deleteFor(ctx.personId, ctx.app.id);
        await this.forget(ctx.app, ctx.memberId);
        // Other parts of the backend that hold data about the person in this app (the MCP server's OAuth grants).
        for (const f of this.forgetListeners) {
          try { await f(ctx); } catch (e) { this.log(`[forget] listener failed for ${ctx.app.id}: ${(e as Error).message}`); }
        }
      },
      onExport: (ctx: MemberHookContext) => this.exportMember(ctx.app, ctx.memberId),
      onAgeLowered: ctx => this.ageLowered(ctx.personId, ctx.age),
    };
  }

  /**
   * The person's lowest age went down (an age stated on any app, in chat or on a web form): every app's
   * member follows, so a minor anywhere is single-player everywhere (founder decision 1).
   */
  private async ageLowered(personId: string, age: number) {
    // Photos and any rating of looks are for adults only: a person who is now under 18 on any app loses
    // every photo and every rating, on every app (also ratings whose photo is already gone).
    if (age < 18) { await this.photos.deleteFor(personId); await this.dropRatings(personId); }
    for (const m of await this.people.memberships(personId)) {
      const rt = this.runtimeFor(m.app);
      if (!rt || m.state === "removed") continue;
      await rt.scoped(tx => tx`update network.members set age = least(coalesce(age, ${age}), ${age}) where app_id = ${m.app} and id = ${m.memberId}`);
    }
  }

  /** A web join (POST /api/join): the member row, then the welcome through the normal send path. */
  private async joined(ctx: JoinHookContext) {
    const rt = this.runtimeFor(ctx.app.id);
    if (!rt) throw new Error(`no network runs for ${ctx.app.id}`);
    if (ctx.membership.state !== "active") return; // waitlist or a recycled number: staff first
    await this.createMember(rt, ctx.membership, { age: ctx.age, firstName: ctx.input.firstName, neighborhood: ctx.input.neighborhood, interests: ctx.input.interests, zip: ctx.input.zip });
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

  /**
   * Run `fn` after a person leaves an app or deletes everything (once per app), with the person's phone.
   * The backend uses it to revoke the MCP server's OAuth grants of that app (packages/mcp revokeAllFor).
   */
  onForget(fn: (ctx: MemberHookContext) => Promise<unknown> | unknown) { this.forgetListeners.push(fn); }

  /** Leave one app: the Network forgets the member, then the save deletes every row that names them (the forget path). */
  private async forget(app: AppInfo, memberId: MemberId) {
    const rt = this.runtimeFor(app.id);
    if (!rt) return;
    await rt.unitOfWork(n => { n.forgetMember(memberId); rt.unit.forget.add(memberId); });
  }

  /** This app's own data about the member: what they told it, their own messages, and their opportunities (kind and state only). */
  private async exportMember(app: AppInfo, memberId: MemberId) {
    const a = app.id;
    const rt = this.runtimeFor(a);
    if (!rt) return null;
    const [member, facets, intents, presence, messages, opps] = await rt.scoped(async tx => [
      await tx`select id, name, home_city, home_area, age, account_status, opted_out, joined_at from network.members where app_id = ${a} and id = ${memberId}`,
      await tx`select kind, value, tags, provenance, status, valid_from from network.facets where app_id = ${a} and member_id = ${memberId} and privacy_scope <> 'agent_private' order by id`,
      await tx`select objective, category, status, created_at from network.intents where app_id = ${a} and member_id = ${memberId} order by created_at, id`,
      await tx`select city, type, areas from network.presence where app_id = ${a} and member_id = ${memberId}`,
      await tx`select direction, body, ts from network.messages where app_id = ${a} and member_id = ${memberId} order by ts, id`,
      await tx`select o.id, o.kind, o.state, o.created_at, o.meeting_at, p.role from network.participations p join network.opportunities o on o.app_id = p.app_id and o.id = p.opportunity_id
        where p.app_id = ${a} and p.member_id = ${memberId} order by o.created_at, o.id`,
    ]);
    return { member: member[0] ?? null, facets: [...facets], intents: [...intents], presence: [...presence], messages: [...messages], opportunities: [...opps] };
  }

  /**
   * The member's availability for the site's Settings (GET /api/me), read from the member record the
   * Network uses (participation_state and participation_window, written by /internal/set-state when the
   * member pauses by text). Nothing is copied: the site reads it on every request. A window that has
   * ended reads as no window. The opt-out (STOP) is not part of it: /api/me shows that in smsOptedIn.
   */
  private async memberParticipation(app: AppInfo, memberId: MemberId): Promise<MemberParticipation | null> {
    const rt = this.runtimeFor(app.id);
    if (!rt) return null;
    const [row] = await rt.scoped(tx => tx`select participation_state, participation_window, prefs from network.members where app_id = ${app.id} and id = ${memberId}`);
    if (!row) return null;
    const now = this.clock.now();
    const p = effectiveParticipation({ participation_state: row.participation_state, participation_window: row.participation_window }, now);
    const w = p.window && (p.window.until === null || Date.parse(p.window.until) > now) ? p.window : null;
    const q = row.prefs?.quietHours;
    const quietHours: [number, number] | undefined = Array.isArray(q) && q.length === 2 && q.every((h: unknown) => Number.isInteger(h) && (h as number) >= 0 && (h as number) < 24) ? [q[0], q[1]] : undefined;
    const base = row.participation_state === "paused" ? "paused" : row.participation_state === "quiet" ? "busy" : "open";
    return { state: w ? w.state : base, from: w?.from ?? null, until: w?.until ?? null, ...(quietHours ? { quietHours } : {}) };
  }

  /**
   * Resume from the site's Settings: the availability pause ends now (the window is cleared, and a
   * paused participation state goes back to normal). Messaging consent does not change: a member who
   * texted STOP stays stopped until they text START. The request is an event, like the agent's.
   */
  private async resumeMember(app: AppInfo, memberId: MemberId): Promise<void> {
    const rt = this.runtimeFor(app.id);
    if (!rt) return;
    await rt.scoped(async tx => {
      const [row] = await tx`select participation_state, participation_window from network.members where app_id = ${app.id} and id = ${memberId} for update`;
      if (!row || (row.participation_window === null && row.participation_state !== "paused")) return;
      await tx`update network.members set participation_window = null,
        participation_state = case when participation_state = 'paused' then 'normal' else participation_state end where app_id = ${app.id} and id = ${memberId}`;
      await tx`insert into network.events(app_id, at, actor_type, actor_id, type, object_type, object_id, payload)
        values (${app.id}, ${new Date(this.clock.now())}, 'member', ${memberId}, 'member_state_requested', 'member', ${memberId}, ${{ state: "open", from: null, until: null, source: "site" }}::jsonb)`;
    });
  }

  /**
   * The public API the four sites call (/api/*). Built on first use: outside dev it needs an OTP
   * provider (OTP_PROVIDER=twilio) and Turnstile (TURNSTILE_SECRET_KEY); the dev shortcuts refuse.
   */
  get publicApi(): PublicApi {
    this.api ??= createPublicApi({
      store: this.people, turnstile: this.apiOptions?.turnstile ?? turnstileFromEnv(this.env),
      hashKey: this.hashKey, apps: this.apps, env: this.env,
      now: () => this.clock.now(), log: this.log, ...this.apiOptions, ...this.hooks(), photos: this.photos,
      participation: ctx => this.memberParticipation(ctx.app, ctx.memberId),
      onResume: ctx => this.resumeMember(ctx.app, ctx.memberId),
      // Each code Twilio Verify sends is a cost row (cost.ts).
      otp: this.cost.meterOtp(this.apiOptions?.otp ?? otpProviderFromEnv(this.env)),
    });
    return this.api;
  }
  /** The public API handler for Bun.serve: /api/* or 404. */
  publicFetch = async (req: Request, server?: PeerInfo): Promise<Response> => (await this.publicApi.fetch(req, server)) ?? Response.json({ ok: false, error: "not_found" }, { status: 404 });

  // ------------------------------------------------------------------ inbound
  /**
   * The app of an inbound message on the shared line (platform plan 4.4, founder decision 2):
   *  1. a per-app webhook path or a line in platform.app_lines names the app;
   *  2. the whole message is an app's word ("slop", "slop.date", "join friends.help"): that app;
   *  3. a join the person started (they sent the app's word) takes the answer that follows, if the
   *     answer reads as a join answer or the person is not a member anywhere;
   *  4. a member: the app with the newest open item (a probe, a plan they have not answered), else the
   *     app that wrote to them last;
   *  5. otherwise The Network (a stranger joins it).
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
    const pending = e164 ? await this.pendingOf(e164, "join") : undefined;
    if (pending && !mine.some(x => x.app === pending.app)
      && (!mine.length || parseJoinText(ev.text, this.appWords(), true).age !== undefined)) return { app: pending.app, shared: true };
    if (mine.length) {
      const open = mine.filter(x => x.lastItem !== null).sort((a, b) => b.lastItem! - a.lastItem!)[0];
      if (open) return { app: open.app, shared: true };
      // Several apps: the reply goes to the app that wrote to this person last.
      const last = [...mine].sort((a, b) => (b.lastOut ?? 0) - (a.lastOut ?? 0))[0]!;
      return { app: last.app, shared: true };
    }
    return { app: "ntwrk", shared: true };
  }

  /** The apps this address is a joined member of, across apps (platform.member_apps: ids and times only). */
  async memberApps(address: string): Promise<{ app: AppId; memberId: MemberId; lastOut: number | null; lastItem: number | null }[]> {
    const rows = await this.sql`select app_id, member_id, last_out, last_item from platform.member_apps(${normalizeAddress(address)})`;
    return (rows as any[]).filter(r => isAppId(r.app_id)).map(r => ({
      app: r.app_id as AppId, memberId: r.member_id, lastOut: r.last_out ? new Date(r.last_out).getTime() : null, lastItem: r.last_item ? new Date(r.last_item).getTime() : null,
    }));
  }

  private appWords() { return Object.values(this.apps).flatMap(a => [a.id, ...a.domain.split(".")]); }

  /** "slop", "slop.date", "www.slop.date" or "join slop": the whole message names the app. Never a word inside a sentence. */
  namedApp(text: string): AppId | undefined { return keywordApp(text, this.apps); }

  /** A pending text flow of this phone that is not older than a day. */
  private async pendingOf(e164: string, kind: PendingText["kind"], app?: AppId): Promise<PendingText | undefined> {
    const p = await this.people.getPending(this.phoneKey(e164), kind, app);
    return p && this.clock.now() - p.at < PENDING_MS ? p : undefined;
  }

  /** A verified, parsed channel event (Blooio webhook). `app`: the per-app webhook path. */
  inboundTurn = () => this.inbox.currentTurn();
  collectReplies = (tx: SQL, replies: CollectedReply[]) => this.inbox.collect(tx, replies);

  async inbound(ev: ChannelEvent, o: { app?: AppId } = {}): Promise<InboundOutcome> {
    switch (ev.kind) {
      case "ignored": case "typing": return "ignored";
      case "status": {
        // A receipt for any app's message on the line (the queue is shared): the row's own network stores it.
        const d = await this.lineAdapter()?.status?.(ev);
        const rt = d?.memberId && d.app && isAppId(d.app) ? this.runtimeFor(d.app) : undefined;
        if (d && rt) await rt.storeStatuses([d]);
        return "status";
      }
      case "safety":
        await this.lineAdapter()?.lineSafety?.(ev.type === "safety.number_banned" ? "review" : ev.action, ev.type);
        this.log(`[safety] ${ev.type} action=${ev.action ?? "-"}`);
        return "safety";
      case "reaction":
        await this.lineAdapter()?.engaged?.(ev.from);
        return "reaction";
      case "message": break;
    }
    if (ev.isGroup) return "ignored_group";
    // Legacy webhooks own transport engagement. A signed turn admits its canonical member after policy processing.
    if (!this.inboundTurn()) await this.lineAdapter()?.engaged?.(ev.from);
    const route = await this.route(ev, o.app);
    const app = this.apps[route.app];
    const rt = this.runtimeFor(route.app);
    if (!rt) { this.log(`[inbound] no network runs for ${route.app}; not stored`); return "no_network"; }
    // Only the routed network's address book (each runtime refreshes its own inside its units of work).
    await rt.identities();
    const memberId = rt.memberOf(ev.from);
    const turn = this.inboundTurn();
    if (turn) { turn.app = app.id; turn.memberId = memberId; }
    const e164 = normalizePhone(ev.from);
    const t = this.clock.now();
    const rowId = `in:${ev.channel}:${ev.messageId}`;
    const kw = platformKeyword(ev.text);
    const line = ev.to ? normalizeAddress(ev.to) : undefined;

    // STOP / STOP ALL: the consent ledger first (with or without a membership; once per message), then every member it covers.
    if (kw === "stop" || kw === "stop_all") {
      const scope: StopScope = kw === "stop_all" || route.shared ? "global" : stopScope(this.env);
      return this.stop(kw, ev.from, app, rt, scope, rowId, line, ev);
    }

    // A number not seen for 12 months may have a new owner: on hold for staff review. Nothing is
    // answered or stored until staff decide (STOP above always works; HELP still answers).
    if (e164 && (await this.accounts.seen(e164)) === "held") {
      this.log(`[inbound] a number on hold for review (${rt.id}): not handled`);
      if (kw === "help") await this.direct(rt, ev.from, app.brand.help, `sys:${rowId}`, "compliance");
      return "held";
    }

    // Photos by text (photoIntake.ts): the answer to the photo consent ask, then any attachment. A photo
    // from a minor, an unknown age, a banned person or a non-member of slop is dropped before it is fetched.
    if (e164 && !kw && (await this.photoIntake.consentAnswer(e164, ev.text, rowId))) return "handled";
    if (e164 && ev.mediaUrls?.length) {
      // A provider retry of the same message takes no photo twice.
      const first = (await this.people.hit(`photo_msg:${rowId}`, DAY, t)).count === 1;
      const r = first ? await this.photoIntake.photosIn(e164, ev.mediaUrls, rowId) : { outcome: "duplicate" as const };
      if (r.outcome !== "not_member" && !ev.text.trim()) return "handled";
    }

    // "leave <app>": that app only, on any line.
    const leavingId = leaveTarget(ev.text, this.apps);
    const leaving = leavingId ? this.apps[leavingId] : undefined;
    if (leaving && e164) {
      const lrt = this.runtimeFor(leaving.id);
      if (lrt && lrt !== rt) await lrt.identities();
      const lid = lrt?.memberOf(ev.from);
      if (lrt && lid) {
        const person = await this.accounts.personFor(e164);
        if (person) await this.accounts.leave(leaving, { e164, personId: person.id });
        else { await this.accounts.recordConsent({ e164, app: leaving.id, line, state: "opted_out", source: "leave", ref: rowId, at: this.consentAt(ev) }); await this.forget(leaving, lid); }
        if (turn) { turn.app = leaving.id; turn.memberId = lid; turn.consent = {state: "opted_out", scope: "app", app: leaving.id, at: t}; }
        await this.direct(lrt, ev.from, this.copyOf(leaving).leftApp, `sys:${rowId}`, "compliance");
        return "left";
      }
    }

    if (memberId) {
      if (kw === "start" && e164) {
        // The recycled-number hold is checked above (seen). A banned number or person is never opted back in.
        const person = await this.accounts.personFor(e164);
        if (await this.accounts.banned(e164, person)) { this.log(`[inbound] START from a banned number (${rt.id}): not opted in`); return "held"; }
        const at = this.consentAt(ev);
        await this.accounts.recordConsent({ e164, app: app.id, line, state: "opted_in", source: "keyword:start", wording: "START keyword", ref: rowId, at });
        // The ledger orders events by their time: an older START (a late gateway retry) never undoes a newer STOP.
        if (!(await this.accounts.optedIn(app.id, e164))) { this.log(`[inbound] START older than the last STOP (${rt.id}): not opted in`); return "handled"; }
        if (turn) turn.consent = {state: "opted_in", scope: "app", app: app.id, at};
        const m = person && (await this.people.getMembership(person.id, app.id));
        if (m?.state === "paused") await this.people.putMembership({ ...m, state: "active" });
      }
      const reply = kw === "help" ? app.brand.help : undefined;
      if (!kw && e164 && /^\s*share\W*$/i.test(ev.text) && (await this.pendingOf(e164, "share", app.id))) return this.share(rt, app, memberId, e164, ev, rowId);
      // The answer to The Network's "what are you looking for?": enroll in the apps they named.
      if (!kw && e164 && app.id === "ntwrk" && (await this.pendingOf(e164, "looking_for"))) {
        const wants = lookingFor(ev.text).filter(a => a !== "ntwrk" && this.runtimeFor(a));
        if (wants.length) return this.enroll(rt, memberId, e164, wants, ev, rowId);
      }
      const out = await this.memberMessage(rt, memberId, ev, rowId, kw, reply);
      if (e164) await this.statedAge(app, rt, memberId, e164);
      return out;
    }

    // Not a member of this app. Nothing is stored about them unless they join (age check passed).
    if (!e164) { this.log(`[inbound] unknown sender (not a phone), ${ev.text.length} chars, not stored`); return "unknown_sender"; }
    if (kw === "help") { await this.direct(rt, ev.from, app.brand.help, `sys:${rowId}`, "compliance"); return "handled"; }
    // One text join per phone at a time (the same lock as a web join). In a signed turn, a person who is not a
    // member of any app first gets the one-time Eliza notice, then the normal join flow.
    return this.people.withLock(`join:${e164}`, async () => {
      await this.elizaNotice(app, e164, ev, rowId);
      const out = await this.join(rt, app, e164, ev, rowId, route);
      // Under the join age: nothing is kept, the notice row included (the phone's age floor keeps a later notice away).
      if (out === "under_age" && this.inboundTurn()) await this.sql`delete from platform.eliza_notices where phone_hash = ${this.noticeKey(e164)}`;
      return out;
    });
  }

  private noticeKey(e164: string) { return keyedHash(this.hashKey, `eliza_notice:${e164}`); }

  /**
   * The one-time notice on the eliza.app line (README "The Eliza seam"; copy ELIZA_NOTICE, a DRAFT until
   * the founder approves it). Only in a signed turn, only for a number that is not a member of any app,
   * once per number: a keyed hash of the number and the time go in platform.eliza_notices in the same
   * transaction as the collected reply, so a failed turn sends nothing and stores nothing. A banned number
   * and an age under the join age (stated now, pending, or on the phone's age floor) get no notice: the
   * join flow answers them as before. The TurnRequest has no "known eliza.app user" flag, so every such
   * first contact gets it. It enrolls nobody: joining still needs the age check and the opt-in.
   */
  private async elizaNotice(app: AppInfo, e164: string, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string): Promise<boolean> {
    if (!this.inboundTurn()) return false;
    if ((await this.memberApps(e164)).length) return false;
    for (const other of this.runtimes.values()) { await other.identities(); if (other.memberOf(e164)) return false; }
    const person = await this.accounts.personFor(e164);
    if (await this.accounts.banned(e164, person)) return false;
    let pending = await this.pendingOf(e164, "join");
    if (pending && pending.app !== app.id) pending = undefined;
    const age = parseJoinText(ev.text, this.appWords(), !!pending).age ?? pending?.age ?? undefined;
    const floor = await this.accounts.lowestAge(e164, person);
    if ((age !== undefined && !joinAgeCheck(age, floor, app).ok) || (floor !== undefined && !canJoin(floor))) return false;
    const key = this.noticeKey(e164);
    return this.sql.begin(async tx => {
      const rows = await tx`insert into platform.eliza_notices (phone_hash, sent_at) values (${key}, ${new Date(this.clock.now())}) on conflict (phone_hash) do nothing returning phone_hash`;
      if (rows.length) await this.inbox.collect(tx, [{ id: `notice:${rowId}`, body: ELIZA_NOTICE, kind: "compliance" }]);
      return rows.length > 0;
    });
  }

  /**
   * The profile a person gave their own AI agent, sent through the MCP server's submit_profile
   * (founder decision 10): delivered to their member on this app as if they had texted it, so the
   * Network reads it with the same rules (wants, interests, availability, an age that can only lower,
   * minors and abuse). Only for a live membership; it never creates a member. The text is the member's.
   */
  async submitProfile(personId: string, appId: AppId, e164: string, text: string): Promise<"accepted" | "not_member"> {
    const m = await this.people.getMembership(personId, appId);
    const rt = this.runtimeFor(appId);
    if (!m || !rt || !["active", "onboarding"].includes(m.state)) return "not_member";
    if (await this.accounts.banned(e164)) return "not_member";
    const t = this.clock.now(), rowId = `agent_${randomUUID()}`;
    const ev: Extract<ChannelEvent, { kind: "message" }> = {
      kind: "message", channel: "imessage" as never, messageId: rowId, from: e164, to: null, chatId: e164, isGroup: false, text, mediaUrls: [], transport: "imessage" as never, receivedAt: t,
    };
    await this.memberMessage(rt, m.memberId as MemberId, ev, rowId, undefined, undefined, false);
    await this.statedAge(this.apps[appId], rt, m.memberId as MemberId, e164);
    return "accepted";
  }

  /** A member's message (or keyword) as one unit of work on their app's network. */
  private async memberMessage(rt: NetworkRuntime, memberId: MemberId, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string, kw: ReturnType<typeof platformKeyword>, systemReply?: string, fromThread = true): Promise<InboundOutcome> {
    const out = await this.memberUnit(rt, memberId, ev, rowId, kw, systemReply);
    // The member wrote in the thread: pending notify deliveries count as acted on (an assistant's submit_profile does not).
    if (out === "handled" && fromThread && this.notify && kw !== "stop" && kw !== "stop_all") {
      const personId = await this.personOfMember(rt, memberId);
      if (personId) await this.notify.threadReply(personId, ev.transport === "sms" ? "sms" : "imessage", this.clock.now()).catch(e => this.log(`[notify] thread reply not recorded: ${(e as Error).message}`));
    }
    return out;
  }

  private memberUnit(rt: NetworkRuntime, memberId: MemberId, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string, kw: ReturnType<typeof platformKeyword>, systemReply?: string): Promise<InboundOutcome> {
    const keyword = kw === "stop" || kw === "stop_all" ? "STOP" : kw === "start" ? "START" : kw === "help" ? "HELP" : undefined;
    return rt.unitOfWork(async n => {
      // Under the lock, so a provider retry or a second subscription is handled once.
      if ((await rt.scoped(tx => tx`select 1 from network.messages where app_id = ${rt.app.id} and id = ${rowId}`)).length) return "duplicate" as const;
      if (n.isDeclined(memberId)) return "handled" as const; // declined at join: never answered, nothing stored
      const t = this.clock.now();
      const channel = ev.transport === "sms" ? "sms" : "imessage";
      rt.unit.inbound = { id: rowId, member_id: memberId, direction: "inbound", channel, body: ev.text, status: "received", type: null, opportunity_id: null, proactive: false, system: false, ts: new Date(t) };
      rt.replyingTo = memberId;
      let disposition: "handled" | "open";
      try { disposition = await n.onInbound({ id: rowId, memberId, body: ev.text, ts: t, channel, ...(keyword ? { keyword } : {}) }); } finally { rt.replyingTo = undefined; }
      // Carrier keywords: the app's own confirmation (packages/platform apps.ts). START gets the Network's own welcome back.
      if (systemReply) rt.system(memberId, `sys:${rowId}`, systemReply);
      if (keyword === "STOP") rt.unit.optOut.set(memberId, true);
      if (keyword === "START") rt.unit.optOut.set(memberId, false);
      if (n.isDeclined(memberId)) {
        // Under the join age: nothing is kept. The one kind decline still goes out, as a policy notice the queue does not hold back.
        rt.unit.forget.add(memberId);
        for (const s of rt.unit.sends) if (s.memberId === memberId) s.kind = "compliance";
      }
      return keyword || systemReply ? "handled" as const : disposition;
    });
  }

  /**
   * An age the member stated in chat (the Network's classifier: first person, present tense; it calls
   * onAgeStated, runtime.ts). The person keeps the lowest age on every app (Accounts.recordAge ->
   * ageLowered): an explicit age, a minor's age, or the age the Network declined them for. The phone's
   * age floor too, so a member from before the platform (no person) cannot join again older. When the
   * Network declined them (under 13), every membership goes: under 13 cannot use any app.
   */
  private async statedAge(app: AppInfo, rt: NetworkRuntime, memberId: MemberId, e164: string) {
    const ages = rt.takeAges(memberId).filter(a => a.explicit || a.declined || isMinor(a.age));
    if (!ages.length) return;
    const person = await this.accounts.personFor(e164);
    // An under-13 statement the Network did not decline for (an attested adult: it holds them for
    // staff, audit network-service-1) is recorded as 13: a minor on every app, never matched, but no
    // other app deletes the person's data before staff decide.
    const recorded = ages.map(a => (a.declined ? a.age : Math.max(a.age, app.minJoinAge)));
    await this.accounts.recordAge(e164, person, Math.min(...recorded));
    if (!person || !ages.some(a => a.declined)) return;
    const at = this.clock.now();
    for (const m of await this.people.memberships(person.id)) {
      if (m.state === "removed") continue;
      if (m.app !== app.id) await this.forget(this.apps[m.app], m.memberId as MemberId);
      await this.people.forgetMembership(person.id, m.app, at);
      await this.accounts.recordConsent({ e164, app: m.app, state: "opted_out", source: "join_declined", at });
    }
  }

  /**
   * STOP or STOP ALL from a number (a signed turn or the legacy webhook): the consent event once per
   * `ref` at the message's time (consentAt), then every member it covers stops (one app, or every app on
   * the shared line), and the confirmation. `ev`: the inbound message (the member's own unit stores it).
   */
  private async stop(kw: "stop" | "stop_all", from: string, app: AppInfo, rt: NetworkRuntime, scope: StopScope, ref: string, line: string | undefined,
    ev?: Extract<ChannelEvent, { kind: "message" }>): Promise<InboundOutcome> {
    const e164 = normalizePhone(from), t = this.clock.now();
    await rt.identities();
    const memberId = rt.memberOf(from);
    const { event, reply } = keywordEvent(kw, e164 ?? from, app, this.consentAt(ev), { line, scope, ref });
    if (e164 && event) await this.accounts.recordConsent(event);
    const turn = this.inboundTurn();
    if (turn && event) turn.consent = {state: "opted_out", scope: scope === "global" ? "all" : "app", app: scope === "global" ? null : app.id, at: event.at};
    if (e164) await this.people.deletePending(this.phoneKey(e164));
    if (memberId && ev) await this.memberMessage(rt, memberId, ev, ref, kw, reply);
    else if (memberId) await rt.unitOfWork(async n => { await n.onInbound({ id: ref, memberId, body: "STOP", ts: t, channel: "imessage", keyword: "STOP" }); rt.unit.optOut.set(memberId, true); });
    else if (reply) await this.direct(rt, from, reply, `sys:${ref}`, "compliance");
    const person = e164 ? await this.accounts.personFor(e164) : undefined;
    if (person) await this.stopped(app, person.id, scope, memberId ? { rt, memberId } : undefined);
    else if (scope === "global") {
      // A member from before the platform (no person): every app where this address is a member.
      for (const other of this.runtimes.values()) {
        if (other === rt) continue;
        await other.identities();
        const id = other.memberOf(from);
        if (id) await other.unitOfWork(async n => { await n.onInbound({ id: `${ref}:${other.id}`, memberId: id, body: "STOP", ts: t, channel: "imessage", keyword: "STOP" }); other.unit.optOut.set(id, true); });
      }
    }
    return memberId ? "handled" : "stopped";
  }

  /** The adapter that speaks for the shared line (receipts, line safety, engagement): the queue tables are one per line. */
  private lineAdapter(): ChannelAdapter | undefined {
    for (const rt of this.runtimes.values()) if (rt.adapter.enqueue) return rt.adapter;
    return undefined;
  }

  /**
   * The time of a consent event that an inbound message causes. In a signed turn it is the gateway's
   * receipt time (never later than now), so the ledger orders STOP, START, leave and joins by when the
   * person sent them, not by when a retry arrived. On the legacy webhook (handled in order per sender) it is now.
   */
  private consentAt(ev?: { receivedAt: number }): number {
    const now = this.clock.now();
    return this.inboundTurn() && ev && Number.isSafeInteger(ev.receivedAt) && ev.receivedAt > 0 ? Math.min(ev.receivedAt, now) : now;
  }

  /**
   * One fixed text to someone who is not a member here. Nothing is stored. `kind`: "compliance" only for
   * a keyword or leave confirmation and the under-age decline; "reply" for an answer to their own message; "transactional" for a
   * text the Network starts (README "Direct texts" lists every caller).
   */
  private async direct(rt: NetworkRuntime, to: string, body: string, id: string, kind: DirectKind) {
    const turn = this.inboundTurn();
    if (turn && normalizeAddress(to) === normalizeAddress(turn.from)) {
      await this.sql.begin(tx => this.inbox.collect(tx, [{id, body, kind: kind === "compliance" ? "compliance" : "reply"}]));
      return;
    }
    await rt.adapter.direct(to, body, id, kind);
  }

  /**
   * Someone who is not a member of this app wrote to it. An invite-only app on its own site or line:
   * one short reply a day, nothing stored. Otherwise (every app on the shared line, The Network
   * included when no keyword named an app): ask for first name and age; when both came and the age
   * check passes, the person (if new), the membership, the consent event and the network member are
   * created, and the Network welcomes them. A join to The Network with no keyword then asks what they
   * are looking for. Under the join age: the kind decline, nothing stored for this app.
   */
  private async join(rt: NetworkRuntime, app: AppInfo, e164: string, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string, route: Route): Promise<InboundOutcome> {
    const key = this.phoneKey(e164);
    const t = this.clock.now();
    const c = this.copyOf(app);
    const person = await this.accounts.personFor(e164);
    // A banned number or person never joins any app; nothing is stored and nothing is answered.
    if (await this.accounts.banned(e164, person)) { this.log(`[inbound] a banned number wrote to ${app.id}: not joined, not stored`); return "held"; }
    const existing = person ? await this.people.getMembership(person.id, app.id) : undefined;
    const invited = existing?.state === "invited";
    if (app.joinMode === "invite" && !invited && !(route.shared && app.id === "ntwrk")) {
      // The same answer whether or not the number uses another app; at most once a day per number.
      const { count } = await this.people.hit(`invite_only:${app.id}:${key}`, DAY, t);
      if (count === 1) await this.direct(rt, ev.from, app.brand.inviteOnly, `sys:${rowId}`, "reply");
      this.log(`[inbound] not a member of invite-only ${app.id}: ${count === 1 ? "invite-only reply" : "no reply (sent today)"}, not stored`);
      return "invite_only";
    }
    let p = await this.pendingOf(e164, "join");
    if (p && p.app !== app.id) p = undefined;
    const said = parseJoinText(ev.text, this.appWords(), !!p);
    const age = said.age ?? p?.age ?? undefined, name = said.name ?? p?.name ?? undefined;
    const ask = invited ? c.invited(app.minJoinAge) : c.joinAsk(app.minJoinAge);
    if (age === undefined) {
      await this.people.putPending({ phoneHash: key, kind: "join", app: app.id, name: name ?? null, age: null, at: t });
      const { count } = await this.people.hit(`join_ask:${app.id}:${key}`, DAY, t);
      if (count <= 3) await this.direct(rt, ev.from, ask, `sys:${rowId}`, "reply");
      return "join_asked";
    }
    const check = joinAgeCheck(age, await this.accounts.lowestAge(e164, person), app);
    if (!check.ok) {
      // Nothing is stored for this app: only the age, on the phone's age floor (and the person, if any),
      // so a second try with an older age is refused too.
      await this.accounts.recordAge(e164, person, age);
      await this.people.deletePending(key, "join");
      await this.direct(rt, ev.from, app.brand.underAge, `sys:${rowId}`, "compliance");
      this.log(`[inbound] under the join age for ${app.id}: declined, nothing stored`);
      return "under_age";
    }
    if (!name) {
      await this.people.putPending({ phoneHash: key, kind: "join", app: app.id, name: null, age, at: t });
      await this.direct(rt, ev.from, c.joinNeedName, `sys:${rowId}`, "reply");
      return "join_asked";
    }
    await this.people.deletePending(key, "join");
    // Join: the person (new or known), the membership, the opt-in (with the words they answered), then the member and the welcome.
    const who: Person = person ?? (await this.accounts.createPerson(e164, "inbound_message", check.effective ?? age));
    await this.accounts.recordAge(e164, who, age);
    // Their answer is a new opt-in: a delete of everything no longer suppresses the number.
    await this.people.unsuppress(key);
    const others = (await this.people.memberships(who.id)).filter(m => m.app !== app.id && m.state !== "removed" && m.state !== "invited");
    const membership: Membership = {
      app: app.id, personId: who.id, memberId: existing?.state === "invited" ? existing.memberId : `${app.id}_${randomUUID()}`,
      state: app.joinMode === "waitlist" ? "onboarding" : "active", review: null, firstName: name, profile: {}, joinedAt: t, leftAt: null,
    };
    await this.people.putMembership(membership);
    await this.accounts.recordConsent({ e164, app: app.id, line: ev.to ? normalizeAddress(ev.to) : null, state: "opted_in", source: "inbound_message", wording: ask, ref: rowId, at: this.consentAt(ev) });
    if (membership.state !== "active") return "joined";
    await this.createMember(rt, membership, { age: Math.min(age, check.effective ?? age), firstName: name });
    // Their answer is their first message: the Network welcomes them as a reply to it.
    await this.memberMessage(rt, membership.memberId, ev, rowId, undefined);
    // A person who uses another app with this number: the link notice (never names the other app).
    if (others.length) {
      await rt.unitOfWork(() => { rt.system(membership.memberId, `link:${rowId}`, c.linkNotice, "transactional", "info"); });
      await this.people.putPending({ phoneHash: key, kind: "share", app: app.id, name: null, age: null, at: t });
    } else if (app.id === "ntwrk" && route.shared && !invited) {
      // No keyword: The Network asks what they are looking for, then enrolls them (founder decision 2).
      const askText = lookingForAsk(Math.min(age, check.effective ?? age));
      await rt.unitOfWork(() => { rt.system(membership.memberId, `ask:${rowId}`, askText, "transactional", "info"); });
      await this.people.putPending({ phoneHash: key, kind: "looking_for", app: "ntwrk", name: null, age: null, at: t });
    }
    return "joined";
  }

  /**
   * The answer to "what are you looking for?": a membership in each app they named, each with the
   * app's own join age check (13+ everywhere today), its own opt-in and its own member. The Network
   * confirms in one text. Apps the age check refuses are left out without saying why.
   */
  private async enroll(rt: NetworkRuntime, memberId: MemberId, e164: string, wants: AppId[], ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string): Promise<InboundOutcome> {
    const key = this.phoneKey(e164), t = this.clock.now();
    const person = await this.accounts.personFor(e164);
    const ntwrk = person && (await this.people.getMembership(person.id, "ntwrk"));
    const joined: AppInfo[] = [];
    if (person && ntwrk && !(await this.accounts.banned(e164, person))) {
      const lowest = await this.accounts.lowestAge(e164, person);
      const asked = lookingForAsk(lowest);
      // A member under 18 (or of unknown age) is never enrolled in slop.date from this question; they may
      // still join it on its own site (founder decision 1), where matching and photos stay 18+.
      for (const id of wants.filter(a => a !== "slop" || (lowest !== undefined && lowest >= 18))) {
        const app = this.apps[id], art = this.runtimeFor(id)!;
        const existing = await this.people.getMembership(person.id, id);
        if (existing && existing.state !== "removed" && existing.state !== "invited") { joined.push(app); continue; }
        if (lowest === undefined || !joinAgeCheck(lowest, lowest, app).ok) continue;
        const m: Membership = {
          app: id, personId: person.id, memberId: existing?.state === "invited" ? existing.memberId : `${id}_${randomUUID()}`,
          state: app.joinMode === "waitlist" ? "onboarding" : "active", review: null, firstName: ntwrk.firstName, profile: {}, joinedAt: t, leftAt: null,
        };
        await this.people.putMembership(m);
        await this.accounts.recordConsent({ e164, app: id, state: "opted_in", source: "looking_for", wording: asked, ref: `${rowId}:${id}`, at: this.consentAt(ev) });
        if (m.state === "active") await this.createMember(art, m, { age: lowest, firstName: ntwrk.firstName ?? "there" });
        joined.push(app);
      }
    }
    await this.people.deletePending(key, "looking_for");
    return rt.unitOfWork(async () => {
      rt.unit.inbound = { id: rowId, member_id: memberId, direction: "inbound", channel: ev.transport === "sms" ? "sms" : "imessage", body: ev.text, status: "received", type: null, opportunity_id: null, proactive: false, system: false, ts: new Date(t) };
      if (joined.length) rt.system(memberId, `sys:${rowId}`, enrolledText(joined), "reply", "info");
      return "handled" as const;
    });
  }

  /** SHARE after the link notice: base-profile grants from the person's other apps (a grant copies nothing). */
  private async share(rt: NetworkRuntime, app: AppInfo, memberId: MemberId, e164: string, ev: Extract<ChannelEvent, { kind: "message" }>, rowId: string): Promise<InboundOutcome> {
    const person = await this.accounts.personFor(e164);
    await this.people.deletePending(this.phoneKey(e164), "share", app.id);
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
    // The reviewer of record is the signed-in person (reviewerOfRecord), never a body field; time on the item is clamped.
    const secondsSpent = typeof o.secondsSpent === "number" && Number.isFinite(o.secondsSpent) ? Math.min(Math.max(0, o.secondsSpent), MAX_REVIEW_SECONDS) : undefined;
    const opts: ReviewOptions = { ...o, secondsSpent, reviewer: user.id };
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
    if (r.ok) await this.direct(rt, e164, this.copyOf(rt.app).invited(rt.app.minJoinAge), `invite:${rt.app.id}:${key.slice(0, 16)}:${this.clock.now()}`, "transactional");
    await this.audit.write({ actor: user.id, roles: user.roles, action: "invite", targetType: target.type, targetId: target.id, mode: "real", app: rt.app.id, at: this.clock.now(), ok: r.ok, detail: { network: rt.id, phase: "result", ...(r.ok ? {} : { reason: r.reason }) } })
      .catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    return r;
  }

  // ------------------------------------------------------------------ verification, photos, reports, holds and bans
  /** The person of a member of this app (network.members.person_id), if the member came through the platform. */
  async personOfMember(rt: NetworkRuntime, memberId: MemberId): Promise<string | undefined> {
    const [r] = await rt.scoped(tx => tx`select person_id from network.members where app_id = ${rt.app.id} and id = ${memberId}`);
    return (r?.person_id as string | null) ?? undefined;
  }

  /**
   * An adult on this app, for photos and ratings: a live membership, a member age of 18 or more (the
   * person's lowest age is checked by PhotoService), and no failed age check recorded by staff
   * (verify:age:fail). Founder decision 9: no ID check, a stated age is enough.
   */
  private async verifiedAdult(personId: string, app: AppId): Promise<boolean> {
    const m = await this.people.getMembership(personId, app);
    const rt = this.runtimeFor(app);
    if (!m || !rt || !["active", "paused", "onboarding"].includes(m.state)) return false;
    const rows = await rt.scoped(tx => tx`select m.age, f.tags, f.valid_from from network.members m left join network.facets f on f.app_id = m.app_id and f.member_id = m.id and f.status <> 'rejected'
      and exists (select 1 from unnest(f.tags) t where t like 'verify:age:%') where m.app_id = ${app} and m.id = ${m.memberId} order by f.valid_from desc nulls last, f.id desc`) as any[];
    if (!rows.length || !(rows[0].age >= 18)) return false;
    // Founder decision 9 (AGENTS.md): no ID check; the stated age (18+ on the person and the member) is
    // enough. A staff-recorded failed age check still refuses.
    const last = rows.find(r => r.tags)?.tags as string[] | undefined;
    return !last?.includes("verify:age:fail");
  }

  /**
   * Delete the member's photo rating (the appearanceFacet row, and rows an older build wrote per photo):
   * on one app, or on every app of the person (an age under 18, a ban).
   */
  private async dropRatings(personId: string, app?: AppId) {
    for (const m of await this.people.memberships(personId)) {
      if (app && m.app !== app) continue;
      const rt = this.runtimeFor(m.app);
      if (!rt) continue;
      await rt.scoped(tx => tx`delete from network.facets where app_id = ${m.app} and member_id = ${m.memberId}
        and (id = ${`${m.memberId}:appearance`} or (source = 'photo_rater' and privacy_scope = 'agent_private'))`);
    }
  }

  /**
   * The rater's score for the member: the engine's appearanceFacet (it throws for anyone who is not a
   * verified adult), stored agent_private. The slop pack reads it from the snapshot inside matching only;
   * it is never shown to anyone and is not in the member's export.
   */
  private async writeRating(personId: string, app: AppId, s: AppearanceScore, subject: RatingSubject) {
    const m = await this.people.getMembership(personId, app);
    const rt = this.runtimeFor(app);
    if (!m || !rt) return;
    const f = appearanceFacet(m.memberId as MemberId, subject, s, this.clock.now());
    const at = new Date(this.clock.now());
    await rt.scoped(tx => tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
      values (${app}, ${f.id}, ${m.memberId}, ${f.kind}, ${f.value}, ${tx.array([...f.tags], "TEXT")}, 'agent_private', 'inferred', 'photo_rater', ${f.confidence}, 'confirmed', ${at})
      on conflict (id) do update set tags = excluded.tags, confidence = excluded.confidence, valid_from = excluded.valid_from`);
  }

  /** A ban on the person, or on any phone they have (platform.bans). */
  async personBanned(personId: string): Promise<boolean> {
    const hashes = await this.people.phoneHashesOf(personId);
    if (await this.people.isBanned(hashes[0] ?? "", personId)) return true;
    for (const h of hashes.slice(1)) if (await this.people.isBanned(h)) return true;
    return false;
  }

  /**
   * Staff record a verification result (PRD 40.5: liveness and age, until a vendor writes them):
   * verify:<check>:<pass|fail> on the member, agent_private, provenance "vouched". Audited before and after.
   */
  async verify(user: StaffUser, rt: NetworkRuntime, memberId: MemberId, check: "age" | "liveness", result: "pass" | "fail", note: string): Promise<ActionResult> {
    const base = { actor: user.id, roles: user.roles, action: "safety", targetType: "member" as const, targetId: memberId, mode: "real" as const, app: rt.app.id };
    await this.audit.write({ ...base, at: this.clock.now(), ok: true, detail: { safety: "verify", check, result, note, phase: "requested" } });
    const now = new Date(this.clock.now());
    const n = await rt.scoped(async tx => {
      const [m] = await tx`select age from network.members where app_id = ${rt.app.id} and id = ${memberId} and account_status not in ('invited', 'removed')`;
      if (!m) return 0;
      await tx`insert into network.facets (app_id, id, member_id, kind, value, tags, privacy_scope, provenance, source, confidence, status, valid_from)
        values (${rt.app.id}, ${`${memberId}:verify:${check}`}, ${memberId}, 'fact', ${`${check} check ${result === "pass" ? "passed" : "failed"}`}, ${tx.array([`verify:${check}:${result}`], "TEXT")},
          'agent_private', 'vouched', 'staff', 0.95, 'confirmed', ${now})
        on conflict (id) do update set tags = excluded.tags, value = excluded.value, valid_from = excluded.valid_from`;
      return 1;
    });
    const r: ActionResult = n ? { ok: true } : { ok: false, reason: "unknown_member" };
    // A failed age check: no rating of looks may stay on this app (adults only, decision 9).
    if (n && check === "age" && result === "fail") { const pid = await this.personOfMember(rt, memberId); if (pid) await this.dropRatings(pid, rt.app.id); }
    await this.audit.write({ ...base, at: this.clock.now(), ok: r.ok, detail: { safety: "verify", check, result, phase: "result", ...(r.ok ? {} : { reason: r.reason }) } }).catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    return r;
  }

  /** Reports about this app's members (the console's "Reports after a date"), newest first. Never the reporter's words. */
  safetyReports(rt: NetworkRuntime) { return rt.readState(n => n.safetyReports()); }

  /** The runtimes and member ids of a person, on every app (live memberships). A member from before the platform: this app only. */
  private async membersOfPerson(rt: NetworkRuntime, memberId: MemberId): Promise<{ personId?: string; members: { rt: NetworkRuntime; memberId: MemberId }[] }> {
    const personId = await this.personOfMember(rt, memberId);
    if (!personId) return { members: [{ rt, memberId }] };
    const members: { rt: NetworkRuntime; memberId: MemberId }[] = [];
    for (const m of await this.people.memberships(personId)) {
      const r = this.runtimeFor(m.app);
      if (r && m.state !== "removed" && m.state !== "invited") members.push({ rt: r, memberId: m.memberId as MemberId });
    }
    if (!members.some(x => x.rt === rt && x.memberId === memberId)) members.push({ rt, memberId });
    return { personId, members };
  }

  /**
   * Hold a person on every app until a review (docs/admin-console.md 3.7.1): each app's Network holds
   * the member (nothing new starts, open items stop, one hold notice). Audited before and after.
   */
  async hold(user: StaffUser, rt: NetworkRuntime, memberId: MemberId, note: string, reportId?: string): Promise<ActionResult> {
    // Staff with safety on this app only hold here; the hold on every other app needs safety@* (or admin@*),
    // and the audit row never says how many apps the person uses (a slop membership never shows across apps).
    const all = await this.membersOfPerson(rt, memberId);
    const members = crossAppSafety(user) ? all.members : all.members.filter(x => x.rt === rt);
    return this.audited(rt, user, { type: "member", id: memberId }, { safety: "hold", reportId: reportId ?? null, scope: members.length > 1 ? "every_app" : "this_app" }, async () => {
      const r = await rt.unitOfWork(n => n.holdMember(memberId, user.id, note, reportId));
      if (!r.ok) return r;
      // One network at a time (never one unit inside another: no lock order to get wrong).
      for (const x of members) if (!(x.rt === rt && x.memberId === memberId)) await x.rt.unitOfWork(o => o.holdMember(x.memberId, user.id, note));
      return r;
    });
  }

  /**
   * Clear a minor signal for the person behind this member, on every app (docs/runbook-real.md, the minor
   * clear): after the person's record says adult, each app's Network runs clearMinorSignal (it refuses when
   * the member's record or stated age is under 18) and dismisses that member's open "minor" reports. One
   * staff action instead of one per app. Staff with safety on this app only clear it here; every app needs
   * safety@* (or admin@*). Audited before and after (the audit row never says how many apps the person uses).
   * Ok when every app cleared or had no signal; `apps` says what each app did.
   */
  async clearMinor(user: StaffUser, rt: NetworkRuntime, memberId: MemberId, note: string): Promise<ActionResult & { apps?: { app: AppId; result: string }[] }> {
    const all = await this.membersOfPerson(rt, memberId);
    const members = crossAppSafety(user) ? all.members : all.members.filter(x => x.rt === rt);
    const apps: { app: AppId; result: string }[] = [];
    const r = await this.audited(rt, user, { type: "member", id: memberId }, { safety: "clear_minor", scope: members.length > 1 ? "every_app" : "this_app" }, async () => {
      let refusal: string | undefined;
      // One network at a time (never one unit inside another).
      for (const x of members) {
        const one = await x.rt.unitOfWork(n => {
          const c = n.clearMinorSignal(x.memberId, user.id, note);
          if (!c.ok && c.reason !== "no_signal") return c;
          let dismissed = 0;
          for (const rep of n.safetyReports()) {
            if (rep.kind === "minor" && rep.subjectId === x.memberId && rep.status === "open" && n.dismissReport(rep.id, user.id, note).ok) dismissed++;
          }
          return c.ok || dismissed ? { ok: true as const } : c;
        });
        apps.push({ app: x.rt.app.id, result: one.ok ? "cleared" : one.reason });
        if (!one.ok && one.reason !== "no_signal") refusal ??= one.reason;
      }
      return refusal ? { ok: false, reason: refusal } : apps.some(a => a.result === "cleared") ? { ok: true } : { ok: false, reason: "no_signal" };
    });
    return { ...r, apps };
  }

  /** Dismiss a report: it no longer keeps the member out of matching. */
  dismissReport(user: StaffUser, rt: NetworkRuntime, reportId: string, note: string) {
    return this.staffAction(rt, user, "safety", { type: "case", id: reportId }, { safety: "dismiss_report" }, n => n.dismissReport(reportId, user.id, note));
  }

  /**
   * Ban by phone or by person (PRD 40.5 "ban by person, not by account"):
   *  - phone: the person's number(s) (keyed hashes) can never join any app again;
   *  - person: the person, on every app, and every phone they have now.
   * Then every live membership is restricted, every app's Network holds the member (never matched or
   * texted again but for safety notices), and the numbers are suppressed. Audited before and after.
   */
  async ban(user: StaffUser, rt: NetworkRuntime, memberId: MemberId, by: "phone" | "person", note: string, reportId?: string): Promise<ActionResult> {
    const { personId, members } = await this.membersOfPerson(rt, memberId);
    const target = { type: "member" as const, id: memberId };
    // A ban stops the number on every app: only safety@* (or admin@*) may do it. Staff of one app hold.
    if (!crossAppSafety(user)) return this.refused(user, rt, "ban", target, "needs_safety_everywhere");
    if (!personId) return this.refused(user, rt, "ban", target, "no_person");
    const hashes = await this.people.phoneHashesOf(personId);
    if (by === "phone" && !hashes.length) return this.refused(user, rt, "ban", target, "no_phone");
    const already = by === "person" ? await this.people.isBanned("", personId) : (await Promise.all(hashes.map(h => this.people.isBanned(h)))).every(Boolean);
    if (already) return this.refused(user, rt, "ban", target, "already_banned");
    return this.audited(rt, user, target, { safety: "ban", by, reportId: reportId ?? null }, async () => {
      const at = this.clock.now();
      const rows: Ban[] = by === "person"
        ? [{ id: `ban_${randomUUID()}`, scope: "person", personId, phoneHash: hashes[0] ?? null, reason: note, reportId: reportId ?? null, bannedBy: user.id, at },
          ...hashes.slice(1).map(h => ({ id: `ban_${randomUUID()}`, scope: "person" as const, personId, phoneHash: h, reason: note, reportId: reportId ?? null, bannedBy: user.id, at }))]
        : hashes.map(h => ({ id: `ban_${randomUUID()}`, scope: "phone" as const, personId, phoneHash: h, reason: note, reportId: reportId ?? null, bannedBy: user.id, at }));
      for (const b of rows) await this.people.ban(b);
      for (const h of hashes) await this.people.suppress(h, "banned", at);
      // No rating of looks is kept for a banned person (they are never matched again). The photos stay for the safety team.
      await this.dropRatings(personId);
      for (const m of await this.people.memberships(personId)) if (m.state !== "removed" && m.state !== "invited") await this.people.putMembership({ ...m, state: "restricted" });
      let out: ActionResult = { ok: true };
      for (const x of members) {
        await x.rt.scoped(tx => tx`update network.members set account_status = 'restricted' where app_id = ${x.rt.app.id} and id = ${x.memberId}`);
        const mine = x.rt === rt && x.memberId === memberId;
        const r = await x.rt.unitOfWork(o => o.markBanned(x.memberId, user.id, note, mine ? reportId : undefined));
        if (mine) out = r;
      }
      return out;
    });
  }

  /** A safety action that spans networks: the audit row first (no row, no action), then `fn`, then a result row. */
  private async audited(rt: NetworkRuntime, user: StaffUser, target: { type: NonNullable<AuditEntry["targetType"]>; id: string }, detail: Row, fn: () => Promise<ActionResult>): Promise<ActionResult> {
    const base = { actor: user.id, roles: user.roles, action: "safety", targetType: target.type, targetId: target.id, mode: "real" as const, app: rt.app.id };
    await this.audit.write({ ...base, at: this.clock.now(), ok: true, detail: { ...detail, network: rt.id, phase: "requested" } });
    const r = await fn();
    await this.audit.write({ ...base, at: this.clock.now(), ok: r.ok, detail: { ...detail, network: rt.id, phase: "result", ...(r.ok ? {} : { reason: r.reason }) } })
      .catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    return r;
  }

  /** A refused staff action, audited (requested and result rows) without running anything. */
  private async refused(user: StaffUser, rt: NetworkRuntime, safety: string, target: { type: NonNullable<AuditEntry["targetType"]>; id: string }, reason: string): Promise<ActionResult> {
    const base = { actor: user.id, roles: user.roles, action: "safety", targetType: target.type, targetId: target.id, mode: "real" as const, app: rt.app.id };
    await this.audit.write({ ...base, at: this.clock.now(), ok: false, detail: { safety, network: rt.id, phase: "refused", reason } });
    return { ok: false, reason };
  }

  /**
   * Staff read a member's photos (GET /members/:id/photos, X-Network-Reason): admin or safety, a typed
   * reason, verified adults only (checked again here and in PhotoService). The audit row is written
   * before any link is made; refusals are audited too. Links work for 5 minutes and go through the backend.
   */
  async staffPhotos(user: StaffUser, rt: NetworkRuntime, memberId: MemberId, reason: string): Promise<{ ok: true; photos: { id: string; url: string; expiresAt: number }[] } | { ok: false; reason: string }> {
    const base = { actor: user.id, roles: user.roles, action: "read_photos", targetType: "member" as const, targetId: memberId, mode: "real" as const, app: rt.app.id };
    await this.audit.write({ ...base, at: this.clock.now(), ok: true, detail: { reason, phase: "requested" } });
    const personId = await this.personOfMember(rt, memberId);
    const r = personId ? await this.photos.staffLinks(personId, rt.app.id, this.photoBaseUrl ?? `https://${rt.app.domain}`) : { ok: false as const, reason: "adults_only" as const };
    await this.audit.write({ ...base, at: this.clock.now(), ok: r.ok, detail: { phase: "result", ...(r.ok ? { photos: r.value.length } : { reason: r.reason }) } }).catch(e => this.log(`[audit] result row failed: ${(e as Error).message}`));
    return r.ok ? { ok: true, photos: r.value } : { ok: false, reason: r.reason };
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

  /** Proposed opt_out and safety_concern signals for staff, newest first (agent_private; staff with reviewer or safety roles only). */
  private async reviewSignals(app: AppId): Promise<{id: string; memberId: string; kind: string; evidence: string; at: number}[]> {
    const rows = await this.sql.begin(async tx => {
      await tx`select set_config('app.app_id',${app},true)`;
      return tx`select id,member_id,tags,value,valid_from from network.facets where app_id=${app} and status='proposed'
        and tags && ${tx.array(["signal:opt_out","signal:safety_concern"],"TEXT")} order by valid_from desc, id limit 200`;
    });
    return (rows as any[]).map(r => ({id: r.id, memberId: r.member_id, kind: String((r.tags as string[]).find(t => t.startsWith("signal:"))).slice(7),
      evidence: r.value, at: new Date(r.valid_from).getTime()}));
  }

  /** Agent actions inherit one completed open turn; receipts stay on that original inbound owner. */
  private async sharedAction(path: string, b: Row, signedId: string, raw: string): Promise<Response> {
    const stateAction = path === SET_STATE_PATH;
    const keys = stateAction ? ["channel","messageId","app","memberId","idempotencyKey","state","from","until","note"]
      : path === SIGNALS_PATH ? ["channel","messageId","app","memberId","signals"] : ["channel","messageId","app","memberId"];
    const key = stateAction ? b.idempotencyKey : `${b.messageId}:${path === SIGNALS_PATH ? "signals" : "updates"}`;
    if (!isAppId(b.app) || typeof b.memberId !== "string" || !b.memberId.trim() || b.memberId.length > 256
      || typeof key !== "string" || !key.trim() || key.length > 512 || /[\r\n\u0000]/.test(key) || signedId !== key
      || Object.keys(b).length !== keys.length || Object.keys(b).some(name => !keys.includes(name))) return json({error:"invalid_request"},400);
    const app = b.app, memberId = b.memberId;
    let window: {state: SetStateRequest["state"]; from: string|null; until: string|null; note: string|null} | undefined;
    if (stateAction) {
      const date = (value: unknown) => value === null || (typeof value === "string" && value.length <= 64
        && /T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/u.test(value) && Number.isFinite(Date.parse(value)));
      if (!["open","busy","traveling","paused"].includes(b.state as string) || !date(b.from) || !date(b.until)
        || (b.note !== null && (typeof b.note !== "string" || b.note.length > 300))
        || (b.from !== null && b.until !== null && Date.parse(b.until as string) <= Date.parse(b.from as string))) return json({error:"invalid_state_window"},400);
      window = {state:b.state as SetStateRequest["state"], from:b.from === null ? null : new Date(b.from as string).toISOString(),
        until:b.until === null ? null : new Date(b.until as string).toISOString(), note:b.note as string|null};
    } else if (path === SIGNALS_PATH && (!Array.isArray(b.signals) || b.signals.length > 20 || b.signals.some(signal => !signal || typeof signal !== "object"
      || Array.isArray(signal) || !["opt_out","travel","safety_concern"].includes(signal.kind) || typeof signal.evidence !== "string"
      || !signal.evidence.trim() || signal.evidence.length > 500 || Object.keys(signal).length !== 2))) return json({error:"invalid_signals"},400);
    const turnId = `msg:${b.channel}:${b.messageId}`;
    const [original] = await this.sql`select sender_hash,response from platform.inbound where id=${turnId} and status='done'`;
    if (!original || original.response?.outcome !== "open" || original.response.app !== app || original.response.memberId !== memberId) return json({error:"turn_scope_invalid",retryable:false},403);
    const who = await this.accounts.byPhoneHash(original.sender_hash), rt = this.runtimeFor(app);
    if (!who || !rt) return json({error:"membership_unavailable",retryable:false},403);
    const authorized = async () => (await this.accounts.activeMembership(rt.app,{e164:who.e164,personId:who.person.id}))?.membership.memberId === memberId;
    if (!await authorized()) return json({error:"membership_unavailable",retryable:false},403);
    if (path === UPDATES_PATH && !this.notify) return json({error:"canonical_updates_unavailable",retryable:false},503);
    const id = createHash("sha256").update(JSON.stringify([turnId,path,key])).digest("hex"), digest = createHash("sha256").update(raw).digest("hex");
    const lock = async (tx: SQL) => {
      await tx`select id from platform.people where id=${who.person.id} and deleted_at is null for update`;
      await tx`select set_config('app.app_id',${app},true)`;
      await tx`select member_id from platform.memberships where person_id=${who.person.id} and app_id=${app} for update`;
      await tx`select id from network.members where app_id=${app} and id=${memberId} for update`;
      const [turn] = await tx`select status,response,sender_hash,action_receipts from platform.inbound where id=${turnId} for update`;
      if (!turn || turn.status !== "done" || turn.sender_hash !== original.sender_hash || turn.response?.outcome !== "open"
        || turn.response.app !== app || turn.response.memberId !== memberId || !await authorized()) throw new Error("Original turn authority changed");
      return turn;
    };
    try {
      const claim = await this.sql.begin(async tx => {
        const turn = await lock(tx), prior = turn.action_receipts[id];
        if (prior) {
          if (prior.requestHash !== digest) return {response:json({error:"action_conflict",retryable:false},409)};
          if (prior.state !== "completed") return {response:json({error:"action_unresolved",retryable:false},409)};
          return {response:json(stateAction ? {...prior.response,replayed:true} : prior.response)};
        }
        if (Object.keys(turn.action_receipts).length >= 16) return {response:json({error:"action_limit",retryable:false},429)};
        if (window?.until && Date.parse(window.until) <= this.clock.now()) return {response:json({error:"expired_state_window"},400)};
        await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${id}],${{requestHash:digest,state:"processing"}}::jsonb) where id=${turnId}`;
        return {response:null};
      });
      if (claim.response) return claim.response;
      const complete = async (tx: SQL, result: Row) => {
        const saved = await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${id}],${{requestHash:digest,state:"completed",response:result}}::jsonb)
          where id=${turnId} and status='done' and action_receipts->${id}->>'requestHash'=${digest} and action_receipts->${id}->>'state'='processing' returning id`;
        if (!saved.length) throw new Error("Action ownership changed before completion");
      };
      if (path === UPDATES_PATH) {
        if (!await authorized()) throw new Error("Membership revoked before updates");
        const result = {items:(await this.updatesFor(who.person.id,app,"web")).map(item=>({summary:item.summary}))};
        await this.sql.begin(async tx=>{await lock(tx);await complete(tx,result);});
        return json(result);
      }
      const result = await this.sql.begin(async tx => {
        await lock(tx);
        let result: Row;
        if (window) {
          const [member] = await tx`select participation_state,participation_window from network.members where app_id=${app} and id=${memberId}`;
          const participation = effectiveParticipation(member,this.clock.now()), prior = participation.window;
          const previous = participation.active ? prior!.state : participation.state === "quiet" ? "busy" : participation.state === "paused" ? "paused" : "open";
          const scheduled = window.state === "traveling" || window.from !== null || window.until !== null || window.note !== null;
          const nextWindow = scheduled ? window : null;
          const base = scheduled ? member.participation_state : effectiveParticipation({...member,participation_window:window},this.clock.now()).state;
          const unchanged = base === member.participation_state && (nextWindow === null ? prior === null : !!prior
            && nextWindow.state === prior.state && nextWindow.from === prior.from && nextWindow.until === prior.until && nextWindow.note === prior.note);
          result = {eventId:null,previous,current:window.state,from:window.from,until:window.until,committedAt:new Date(this.clock.now()).toISOString(),replayed:false,unchanged};
          if (!unchanged) {
            await tx`update network.members set participation_state=${base},participation_window=${nextWindow}::jsonb where app_id=${app} and id=${memberId}`;
            const [event] = await tx`insert into network.events(app_id,at,actor_type,actor_id,type,object_type,object_id,payload)
              values(${app},${new Date(this.clock.now())},'member',${memberId},'member_state_requested','member',${memberId},${{state:window.state,from:window.from,until:window.until}}::jsonb) returning id`;
            result.eventId = String(event.id);
          }
        } else {
          const signals = b.signals as Array<{kind:string;evidence:string}>;
          for (const [index,signal] of signals.entries()) await tx`insert into network.facets(app_id,id,member_id,kind,value,tags,privacy_scope,provenance,source,status,valid_from)
            values(${app},${`service-signal:${id}:${index}`},${memberId},'fact',${signal.evidence},${tx.array([`signal:${signal.kind}`],"TEXT")},'agent_private','inferred','chat','proposed',${new Date(this.clock.now())})`;
          if (signals.length) await tx`insert into network.events(app_id,at,actor_type,actor_id,type,object_type,object_id,payload)
            values(${app},${new Date(this.clock.now())},'agent',${memberId},'network_signals_proposed','member',${memberId},${{kinds:signals.map(signal=>signal.kind),count:signals.length}}::jsonb)`;
          // opt_out and safety_concern never act on their own: they wait for a person in GET /signals.
          // STOP and "leave <app>" in the member's own words stay the only automatic consent changes.
          const review = signals.filter(signal => signal.kind === "opt_out" || signal.kind === "safety_concern");
          if (review.length) this.log(`[alert] ${app}: ${review.length} agent signal(s) (${[...new Set(review.map(signal => signal.kind))].join(", ")}) wait for staff review (GET /signals)`);
          result = {recorded:signals.length};
        }
        await complete(tx,result);
        return result;
      });
      return json(result);
    } catch {
      await this.sql`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${id}],${{requestHash:digest,state:"unresolved"}}::jsonb)
        where id=${turnId} and status='done' and action_receipts->${id}->>'requestHash'=${digest} and action_receipts->${id}->>'state'='processing'`;
      return json({error:"action_unresolved",retryable:false},409);
    }
  }

  /** Signed Shared turns use the existing durable inbox; collection is not provider acceptance. */
  private async sharedTurn(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method !== "POST") return json({error: "method_not_allowed"}, 405);
    if (url.search) return json({error: "invalid_request"}, 400);
    const bytes = await readCapped(req, MAX_BODY_BYTES);
    if (bytes === "too_large") return json({error: "payload_too_large"}, 413);
    let raw: string;
    try { raw = new TextDecoder("utf-8", {fatal: true}).decode(bytes); }
    catch { return json({error: "invalid_request"}, 400); }
    const auth = await svcVerify(this.env.SERVICE_TURN_SECRET, {method: req.method, path: url.pathname, headers: req.headers, body: raw, nowS: Math.floor(this.clock.now()/1000)});
    if (!auth.ok) return json({error: auth.reason}, auth.reason === "no_secret" ? 503 : 401);
    let b: Row;
    try { b = JSON.parse(raw); } catch { return json({error: "invalid_request"}, 400); }
    if (!b || typeof b !== "object" || Array.isArray(b) || (b.channel !== "blooio" && b.channel !== "twilio")
      || typeof b.messageId !== "string" || !b.messageId.trim() || b.messageId.length > 512 || /[\r\n\u0000]/.test(b.messageId)) return json({error: "invalid_request"}, 400);
    if ([SET_STATE_PATH,SIGNALS_PATH,UPDATES_PATH].includes(url.pathname)) return this.sharedAction(url.pathname,b,auth.id,raw);
    const digest = createHash("sha256").update(raw).digest("hex");
    const id = `msg:${b.channel}:${b.messageId}`;
    if (url.pathname === TURN_RECEIPT_PATH) {
      if (auth.id !== `${b.messageId}:receipt` || Object.keys(b).length !== 6
        || !Array.isArray(b.replyIds) || !b.replyIds.every(x => typeof x === "string")
        || !Array.isArray(b.providerMessageIds) || !b.providerMessageIds.every(x => typeof x === "string" && x.trim())
        || typeof b.historyRecorded !== "boolean" || !["accepted", "unknown", "rejected"].includes(b.outcome as string)) return json({error: "invalid_request"}, 400);
      const result = await this.sql.begin(async tx => {
        const [claim] = await tx`select status,response,receipt_hash,receipt,replies from platform.inbound where id=${id} for update`;
        if (!claim || claim.status !== "done" || claim.response?.outcome !== "handled") return json({error: "turn_unavailable", retryable: false}, 409);
        if (claim.receipt_hash === digest) return json({ok: true, replayed: true});
        if (claim.receipt_hash && !(claim.receipt?.outcome === "unknown" && ["accepted", "rejected"].includes(b.outcome as string))) return json({error: "receipt_conflict", retryable: false}, 409);
        const collected = claim.replies as CollectedReply[];
        // A handled turn with no reply (a quiet acknowledgement, an under-13 decline) takes an empty receipt and is done.
        if (!collected.length) {
          if ((b.replyIds as string[]).length || (b.providerMessageIds as string[]).length || b.historyRecorded) return json({error: "receipt_scope_invalid", retryable: false}, 409);
          await tx`update platform.inbound set receipt_hash=${digest},receipt=${b}::jsonb where id=${id}`;
          return json({ok: true, replayed: false});
        }
        if (JSON.stringify(collected.map(r => r.id)) !== JSON.stringify(b.replyIds)) return json({error: "receipt_scope_invalid", retryable: false}, 409);
        // historyRecorded may be false on an accepted send: Cloud has no history for a recipient without an Eliza account yet.
        if ((b.outcome === "accepted" && !(b.providerMessageIds as string[]).length)
          || (b.outcome !== "accepted" && b.historyRecorded)) return json({error: "invalid_receipt", retryable: false}, 400);
        const status = b.outcome === "accepted" ? "sent" : b.outcome === "unknown" ? "send_unknown" : "refused_gateway";
        if (isAppId(claim.response.app)) {
          await tx`select set_config('app.app_id', ${claim.response.app}, true)`;
          await tx`update network.messages set status=${status} where app_id=${claim.response.app} and inbound_id=${id} and id in ${tx(b.replyIds as string[])} and status in ('collected','send_unknown')`;
        }
        await tx`update platform.inbound set receipt_hash=${digest},receipt=${b}::jsonb where id=${id}`;
        return json({ok: true, replayed: false});
      });
      if (result.status===200 && b.outcome==="accepted") {
        const [claim]=await this.sql`select response from platform.inbound where id=${id}`;
        if (isAppId(claim?.response?.app)) await this.runtimeFor(claim.response.app)?.projectNotifications();
      }
      return result;
    }
    if (auth.id !== b.messageId || Object.keys(b).some(k => !["messageId","channel","from","to","text","transport","receivedAt","app"].includes(k))
      || typeof b.from !== "string" || normalizePhone(b.from) !== b.from
      || (b.to !== null && (typeof b.to !== "string" || normalizePhone(b.to) !== b.to))
      || typeof b.text !== "string" || !b.text.trim() || !["imessage","sms","rcs","unknown"].includes(b.transport as string)
      || typeof b.receivedAt !== "number" || !Number.isSafeInteger(b.receivedAt) || b.receivedAt < 0 || b.receivedAt > 8_640_000_000_000_000 || (b.app !== undefined && !isAppId(b.app))) return json({error: "invalid_request"}, 400);
    const input = b as unknown as TurnRequest;
    const result = await this.inbox.signed(input, digest, async turn => {
      const outcome = await this.inbound({kind: "message", channel: input.channel, messageId: input.messageId, from: input.from, to: input.to,
        chatId: input.from, isGroup: false, text: input.text, mediaUrls: [], transport: input.transport, receivedAt: input.receivedAt}, {app: input.app});
      if (outcome === "duplicate") throw new Error("Unresolved turn effects");
      const [row] = await this.sql`select replies from platform.inbound where id=${turn.id}`;
      const collected = row.replies as CollectedReply[];
      const person = await this.accounts.personFor(input.from);
      const age = await this.accounts.lowestAge(input.from, person);
      if (outcome === "left" || (age !== undefined && !canJoin(age))) turn.memberId = undefined;
      const accountEligible = !(await this.accounts.held(input.from)) && !(await this.accounts.banned(input.from, person))
        // An unknown age fails closed (core/policy.ts): Cloud account eligibility never runs ahead of the Network's join age check.
        && !(await this.people.isSuppressed(this.phoneKey(input.from))) && age !== undefined && canJoin(age) && turn.consent?.state !== "opted_out";
      const rt = turn.app ? this.runtimeFor(turn.app) : undefined;
      const binding = rt && turn.memberId ? await this.accounts.activeMembership(rt.app, {e164: input.from, personId: person?.id ?? null}) : undefined;
      // activeMembership owns the known join-age check; first contact, STOP, leave and policy denials create no service counter.
      if (accountEligible && binding && binding.membership.memberId === turn.memberId) await this.lineAdapter()?.engaged?.(input.from);
      if (outcome === "open" && !collected.length && turn.app && turn.memberId) {
        const context = binding?.membership.memberId === turn.memberId ? await rt!.sharedContext(turn.memberId) : null;
        if (context) return {outcome: "open", channel: input.channel, app: turn.app, memberId: turn.memberId, context};
      }
      if (outcome === "no_network" || outcome === "unknown_sender") return {outcome: "ignored", reason: outcome};
      return {outcome: "handled", replies: collected.map(r => r.body), replyIds: collected.map(r => r.id), delivery: "collected",
        replyKind: collected.length && collected.every(r => r.kind === "compliance") ? "compliance" : "reply", accountEligible,
        app: turn.app ?? null, memberId: turn.memberId ?? null, reason: outcome === "open" ? "context_unavailable" : outcome, ...(turn.consent ? {consent: turn.consent} : {})} satisfies TurnResponse;
    });
    if (result.status === 200 && result.body && typeof result.body === "object" && "outcome" in result.body && result.body.outcome === "open") {
      const cached = result.body as Extract<TurnResponse, {outcome: "open"}>;
      const rt = this.runtimeFor(cached.app);
      const binding = rt && await this.accounts.activeMembership(rt.app, {e164: input.from, personId: null});
      const current = binding?.membership.memberId === cached.memberId ? await rt!.sharedContext(cached.memberId) : null;
      if (!current || !isDeepStrictEqual(current, cached.context)) return json({error: "turn_context_changed", retryable: false}, 409);
    }
    if (result.status===200 && result.body && typeof result.body==="object" && "outcome" in result.body && result.body.outcome==="handled") {
      const handled=result.body as Extract<TurnResponse,{outcome:"handled"}>;
      if (handled.app) await this.runtimeFor(handled.app)?.projectNotifications();
    }
    return json(result.body, result.status);
  }

  // ------------------------------------------------------------------ HTTP
  /** The HTTP handler: the inbound webhooks and the staff API. The public API is publicFetch (its own port). */
  fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    if ([TURN_PATH, TURN_RECEIPT_PATH, SET_STATE_PATH, SIGNALS_PATH, UPDATES_PATH].includes(url.pathname)) return this.sharedTurn(req);
    if (url.pathname === RELAY_PATH) return relayEndpoint({ sql: this.sql, clock: this.clock, secret: this.env.SERVICE_TURN_SECRET, accounts: this.accounts, photos: this.photos, runtimeFor: app => this.runtimeFor(app), ...(this.relayHook ? { hook: this.relayHook } : {}) }, req);
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
      if (req.method === "GET" && path === "/safety/reports") {
        const no = need(["safety"]); if (no) return no;
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_safety_reports", mode: "real", ok: true, app: rt.app.id });
        return json({ ok: true, network: rt.id, reports: await this.safetyReports(rt) });
      }
      if (req.method === "GET" && path === "/signals") {
        // Agent signals that need a person: opt_out and safety_concern proposed from /internal/signals.
        const no = need(["reviewer", "safety"]); if (no) return no;
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_agent_signals", mode: "real", ok: true, app: rt.app.id });
        return json({ ok: true, network: rt.id, signals: await this.reviewSignals(rt.app.id) });
      }
      if (req.method === "GET" && (path === "/staff/relay/held" || path === "/relay/held")) {
        // Relayed items held for a person (relay.ts): ids, reasons and times; an adult's held text; never a minor's words, never a score.
        const no = need(["reviewer", "safety"]); if (no) return no;
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_relay_held", mode: "real", ok: true, app: rt.app.id });
        const held = await rt.readState(n => n.relayHeld());
        return json({ ok: true, network: rt.id, items: held.map(h => ({ itemId: h.itemId, app: h.app, kind: h.kind, from: h.from, to: h.to, reasons: h.reasons, createdAt: h.at, ...(h.text ? { text: h.text } : {}) })) });
      }
      if (path === "/inbound/resolve") {
        // A signed turn that did not finish: staff release the sender (the turn itself stays unresolved).
        if (!hasEverywhere(user, "admin")) return json({ ok: false, code: "forbidden", error: "needs role admin@*" }, 403);
        if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
        const b = await body(req) as Record<string, any> | undefined;
        if (typeof b?.id !== "string" || !b.id.startsWith("msg:") || b.id.length > 600) return json({ ok: false, error: "id_required" }, 400);
        const ok = await this.inbox.resolve(b.id);
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "resolve_inbound_turn", mode: "real", ok, app: rt.app.id });
        return result(ok ? { ok: true } : { ok: false, reason: "not_stuck" });
      }
      if (req.method === "GET" && path === "/bias") {
        // The weekly bias monitor (aggregates only): admin or analyst for this app.
        const no = need(["admin", "analyst"]); if (no) return no;
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: "read_bias_reports", mode: "real", ok: true, app: rt.app.id });
        return json({ ok: true, network: rt.id, reports: await this.biasReports(rt) });
      }
      const photoPath = path.match(/^\/members\/([^/]+)\/photos$/);
      if (req.method === "GET" && photoPath) {
        const no = need(["safety"]); if (no) return no;
        let id: string;
        try { id = decodeURIComponent(photoPath[1]!); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
        const reason = req.headers.get("x-network-reason")?.trim() ?? "";
        if (reason.length < 5 || reason.length > 500 || id.length > 200) return json({ ok: false, reason: "reason_required" }, 400);
        const r = await this.staffPhotos(user, rt, id, reason);
        return r.ok ? json(r) : json({ ok: false, reason: r.reason }, r.reason === "photos_off" ? 503 : 403);
      }
      if (req.method !== "POST") return json({ ok: false, error: "not_found" }, 404);
      const m = path.match(/^\/review\/([^/]+)$/);
      if (m) {
        const no = need(["reviewer"]); if (no) return no;
        let oppId: string;
        try { oppId = decodeURIComponent(m[1]!); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
        const b = await body(req);
        if (!b) return json({ ok: false, error: "invalid_json" }, 400);
        const { decision, reason, note, secondsSpent, explanations, objective, swapOut } = b as Record<string, any>;
        const str = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);
        if (!DECISIONS.has(decision) || oppId.length > 200 || !str(reason, 64) || !str(note, 2000) || !str(objective, 500) || !str(swapOut, 200)
          || (secondsSpent !== undefined && typeof secondsSpent !== "number")
          || (explanations !== undefined && (typeof explanations !== "object" || explanations === null || Array.isArray(explanations) || Object.values(explanations).some(v => typeof v !== "string" || v.length > 500)))) {
          return json({ ok: false, error: "invalid_review" }, 400);
        }
        return result(await this.review(user, oppId, decision, { reason, note, secondsSpent, explanations, objective, swapOut }, rt));
      }
      if (path === "/safety/lift" || path === "/safety/close") {
        const no = need(["safety"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        if (!b) return json({ ok: false, error: "invalid_json" }, 400);
        if (b.note !== undefined && (typeof b.note !== "string" || b.note.length > 2000)) return json({ ok: false, error: "invalid_note" }, 400);
        if (path === "/safety/lift") return typeof b.memberId === "string" && b.memberId.length <= 200 ? result(await this.liftHold(user, b.memberId, b.note, rt)) : json({ ok: false, error: "memberId_required" }, 400);
        return typeof b.caseId === "string" && b.caseId.length <= 200 ? result(await this.closeCase(user, b.caseId, b.note, rt)) : json({ ok: false, error: "caseId_required" }, 400);
      }
      if (path === "/safety/clear-minor") {
        const no = need(["safety"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        if (!b) return json({ ok: false, error: "invalid_json" }, 400);
        if (typeof b.note !== "string" || b.note.trim().length < 5 || b.note.length > 2000) return json({ ok: false, error: "note_required" }, 400);
        if (typeof b.memberId !== "string" || !b.memberId || b.memberId.length > 200) return json({ ok: false, error: "memberId_required" }, 400);
        const r = await this.clearMinor(user, rt, b.memberId, b.note);
        return json(r, r.ok ? 200 : 409);
      }
      if (path === "/safety/hold" || path === "/safety/ban" || path === "/safety/dismiss") {
        const no = need(["safety"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        if (!b) return json({ ok: false, error: "invalid_json" }, 400);
        // A decision note of 5 or more characters (docs/admin-console.md 3.7.1).
        if (typeof b.note !== "string" || b.note.trim().length < 5 || b.note.length > 2000) return json({ ok: false, error: "note_required" }, 400);
        if (b.reportId !== undefined && (typeof b.reportId !== "string" || b.reportId.length > 200)) return json({ ok: false, error: "invalid_report" }, 400);
        if (path === "/safety/dismiss") return typeof b.reportId === "string" ? result(await this.dismissReport(user, rt, b.reportId, b.note)) : json({ ok: false, error: "reportId_required" }, 400);
        if (typeof b.memberId !== "string" || !b.memberId || b.memberId.length > 200) return json({ ok: false, error: "memberId_required" }, 400);
        if (path === "/safety/hold") return result(await this.hold(user, rt, b.memberId, b.note, b.reportId));
        if (b.by !== "phone" && b.by !== "person") return json({ ok: false, error: "by_required" }, 400);
        return result(await this.ban(user, rt, b.memberId, b.by, b.note, b.reportId));
      }
      const relayPath = path.match(/^\/(?:staff\/)?relay\/([^/]+)\/(release|reject)$/);
      if (relayPath) {
        // Release or reject a held relay item (safety role for this app); audited either way.
        const no = need(["safety"]); if (no) return no;
        let itemId: string;
        try { itemId = decodeURIComponent(relayPath[1]!); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
        const b = (await body(req) ?? {}) as Record<string, any>;
        if (itemId.length > 200 || (b.note !== undefined && (typeof b.note !== "string" || b.note.length > 2000))) return json({ ok: false, error: "invalid_relay_decision" }, 400);
        const release = relayPath[2] === "release";
        const r = await rt.unitOfWork(n => release ? n.releaseRelay(itemId, user.id) : n.rejectRelay(itemId, user.id));
        await this.audit.write({ at: this.clock.now(), actor: user.id, roles: user.roles, action: release ? "relay_release" : "relay_reject", targetId: itemId,
          mode: "real", ok: r.ok, app: rt.app.id, ...(typeof b.note === "string" ? { reason: b.note } : {}), ...("delivered" in r ? { detail: { delivered: r.delivered } } : {}) });
        return result(r);
      }
      const verifyPath = path.match(/^\/members\/([^/]+)\/verify$/);
      if (verifyPath) {
        const no = need(["safety"]); if (no) return no;
        const b = await body(req) as Record<string, any> | undefined;
        let id: string;
        try { id = decodeURIComponent(verifyPath[1]!); } catch { return json({ ok: false, error: "invalid_id" }, 400); }
        if (!b || (b.check !== "age" && b.check !== "liveness") || (b.result !== "pass" && b.result !== "fail") || typeof b.note !== "string" || b.note.trim().length < 5 || b.note.length > 2000 || id.length > 200) {
          return json({ ok: false, error: "invalid_verify" }, 400);
        }
        return result(await this.verify(user, rt, id, b.check, b.result, b.note));
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
  private reviewerOfRecord(req: Request, user: StaffUser): StaffUser { return reviewerOfRecord(req, user, this.consoleToken); }

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
      // A message goes through the inbox (stored first: once per provider id, in order per sender); 200 once it is stored.
      if (ev.kind === "message" && !ev.isGroup) return json({ ok: true, result: await this.inbox.receive(ev, app) });
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

/**
 * The reviewer of record (critical path item 6; docs/admin-console.md 4.6): the signed-in person the
 * console names in X-Network-Staff-Id, taken only from a request that carries the console's own token
 * (NETWORK_SERVICE_CONSOLE_TOKEN). From any other token the header is ignored and the token is the actor.
 */
export function reviewerOfRecord(req: Request, user: StaffUser, consoleToken: string | undefined): StaffUser {
  const named = req.headers.get("x-network-staff-id")?.trim();
  if (!named || !consoleToken) return user;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const a = Buffer.from(given), b = Buffer.from(consoleToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return user;
  if (named.length > 200 || !/^([^\s@]+@[^\s@]+\.[^\s@]+|token:[a-z_+]+#[0-9a-f]{8})$/i.test(named)) return user;
  return { ...user, id: named };
}

/**
 * Review items waiting longer than the app's SLA (slop 6 h, peon 24 h, the others 12 h;
 * observatory apps.ts DEFAULT_SLA_HOURS): one "[alert] review SLA" line per item, once (`seen`).
 */
export function slaAlerts(network: string, queue: readonly { oppId: string; queuedAt: number; deadline: number }[], now: number, hours: number, seen: Set<string>): string[] {
  const out: string[] = [];
  const key = (id: string) => `${network}|${id}`;
  // Items that left the queue are forgotten (the set holds only waiting items).
  for (const k of seen) if (k.startsWith(`${network}|`) && !queue.some(q => key(q.oppId) === k)) seen.delete(k);
  for (const q of queue) {
    if (seen.has(key(q.oppId)) || now - q.queuedAt <= hours * 3_600_000) continue;
    seen.add(key(q.oppId));
    out.push(`[alert] review SLA ${network}: item ${q.oppId} waited ${Math.round((now - q.queuedAt) / 60_000)} min (SLA ${hours} h, expires unsent in ${Math.max(0, Math.round((q.deadline - now) / 60_000))} min)`);
  }
  return out;
}

/** Per-app webhook secrets from the environment: <APP>_BLOOIO_WEBHOOK_SECRET. */
export function webhookSecretsFromEnv(env: Env = process.env): Partial<Record<AppId, string>> {
  const out: Partial<Record<AppId, string>> = {};
  for (const a of Object.keys(APPS) as AppId[]) { const s = env[`${a.toUpperCase()}_BLOOIO_WEBHOOK_SECRET`]; if (s) out[a] = s; }
  return out;
}

const json = (data: unknown, status = 200) => Response.json(data, {status,headers:{"cache-control":"no-store"}});
const result = (r: ActionResult) => json(r, r.ok ? 200 : 409);
async function body(req: Request): Promise<unknown> {
  try { const b = await req.json(); return b && typeof b === "object" ? b : undefined; } catch { return undefined; }
}
