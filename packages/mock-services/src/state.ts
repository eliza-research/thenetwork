import { hash32, Rng, SimClock, type Clock } from "@thenetwork/core";

export type MockServiceName =
  | "x"
  | "instagram"
  | "tiktok"
  | "reddit"
  | "linkedin"
  | "discord"
  | "blooio"
  | "twilio"
  | "resend"
  | "sendgrid"
  | "postmark"
  | "agentmail"
  | "smtp"
  | "meta_ads"
  | "google_ads"
  | "tiktok_ads"
  | "s3"
  | "beacon"
  | "dub"
  | "luma"
  | "ops"
  | "discovery"
  | "turnstile";

export type SocialPlatform = "x" | "instagram" | "tiktok" | "reddit" | "linkedin" | "discord";

export interface SocialAccountState {
  platform: SocialPlatform;
  handle: string;
  userId: string;
  warmupDays: number;
  reputation: number;
  shadowbanned: boolean;
  locked: boolean;
  captchaRequired: boolean;
  spamReports: number;
}

export interface SocialPostRecord {
  id: string;
  platform: SocialPlatform;
  authorHandle: string;
  text: string;
  channelOrSubreddit?: string;
  createdAtMs: number;
  shadowbanned: boolean;
  impressions: number;
  likes: number;
  replies: number;
  clicks: number;
  shares: number;
  status: "published" | "under_review" | "removed";
  comments: Array<{ id: string; author: string; text: string; createdAtMs: number }>;
}

export interface SocialDmRecord {
  id: string;
  platform: SocialPlatform;
  fromHandle: string;
  toHandle: string;
  text: string;
  createdAtMs: number;
  delivered: boolean;
}

export interface BlooioLineState {
  phoneNumber: string;
  isActive: boolean;
  suspended: boolean;
  status: "active" | "reply_only" | "new_conversations_paused" | "account_review";
  planKind: "shared" | "dedicated" | "inbound" | "trial" | "2fa";
  dailyOutboundCount: number;
  dailyNewConversations: number;
}

export interface BlooioMessageRecord {
  id: string;
  chatId: string;
  from: string;
  to: string;
  text: string;
  attachments: string[];
  protocol: "imessage" | "sms" | "rcs";
  status: "queued" | "sent" | "delivered" | "read" | "failed";
  idempotencyKey?: string;
  bodyHash?: string;
  createdAtMs: number;
  direction: "outbound" | "inbound";
}

export interface BlooioConversationState {
  chatId: string;
  recipient: string;
  unansweredOutbound: number;
  optedOut: boolean;
  lastOutboundAtMs?: number;
  lastInboundAtMs?: number;
}

export interface EmailDomainState {
  domain: string;
  sentCount: number;
  deliveredCount: number;
  bouncedCount: number;
  complaintCount: number;
  unsubscribeCount: number;
  reputationScore: number;
}

export interface EmailMessageRecord {
  id: string;
  provider: "resend" | "sendgrid" | "postmark" | "agentmail" | "smtp";
  from: string;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  idempotencyKey?: string;
  status: "sent" | "delivered" | "bounced" | "complained" | "unsubscribed";
  opened: boolean;
  clicked: boolean;
  createdAtMs: number;
}

export interface AdCampaignState {
  id: string;
  platform: "meta_ads" | "google_ads" | "tiktok_ads";
  accountId: string;
  name: string;
  city: string;
  desireLane: string;
  dailyBudgetCents: number;
  spentCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  frequency: number;
  creativeRotations: number;
  destinationUrl: string;
  status: "ACTIVE" | "PAUSED";
  createdAtMs: number;
}

export interface S3StoredObject {
  key: string;
  body: Uint8Array;
  etag: string;
  contentType: string;
  lastModifiedIso: string;
}

export interface S3MultipartUpload {
  uploadId: string;
  bucket: string;
  key: string;
  contentType: string;
  parts: Map<number, { etag: string; body: Uint8Array }>;
  initiatedAtMs: number;
}

export interface DubLinkRecord {
  id: string;
  domain: string;
  key: string;
  shortLink: string;
  destinationUrl: string;
  externalId?: string;
  tags: string[];
  clicks: number;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface BeaconEventRecord {
  id: string;
  atMs: number;
  brand: string;
  city: string;
  event: string;
  path: string;
  referrer: string;
  utmSource: string;
  utmCampaign: string;
  armId: string;
  qrBatchCode: string;
  desireLane: string;
  sessionHash: string;
  referrerCode?: string;
}

export interface WebhookSubscription {
  id: string;
  service: "blooio" | "resend" | "sendgrid" | "postmark" | "luma" | "twilio";
  url: string;
  secret: string;
  events: string[];
  active: boolean;
}

export interface OpsRecord {
  id: string;
  provider: string;
  kind: string;
  idempotencyKey?: string;
  payload: Record<string, unknown>;
  createdAtMs: number;
}

export interface MockSessionState {
  sessionId: string;
  seed: number;
  startMs: number;
  seq: number;
  rng: Rng;
  socialAccounts: Map<string, SocialAccountState>;
  socialPosts: Map<string, SocialPostRecord>;
  socialDms: SocialDmRecord[];
  blooioLines: Map<string, BlooioLineState>;
  blooioMessages: Map<string, BlooioMessageRecord>;
  blooioIdempotency: Map<string, { bodyHash: string; receipt: Record<string, unknown> }>;
  blooioConversations: Map<string, BlooioConversationState>;
  twilioMessages: Array<Record<string, unknown>>;
  twilioCalls: Array<Record<string, unknown>>;
  emailDomains: Map<string, EmailDomainState>;
  emailMessages: Map<string, EmailMessageRecord>;
  emailIdempotency: Map<string, { bodyHash: string; response: Record<string, unknown> }>;
  adCampaigns: Map<string, AdCampaignState>;
  adConversions: Array<Record<string, unknown>>;
  s3Buckets: Map<string, Map<string, S3StoredObject>>;
  s3Multiparts: Map<string, S3MultipartUpload>;
  dubLinks: Map<string, DubLinkRecord>;
  dubBySlug: Map<string, string>;
  beaconEvents: BeaconEventRecord[];
  opsRecords: Map<string, OpsRecord>;
  opsIdempotency: Map<string, Record<string, unknown>>;
  webhooks: Map<string, WebhookSubscription>;
}

export const DEFAULT_MOCK_EPOCH_MS = Date.UTC(2026, 10, 1, 14, 0, 0);

export function createSessionState(sessionId: string, seed: number, startMs: number): MockSessionState {
  const rng = new Rng(hash32("mock-session", sessionId, seed));
  const blooioLines = new Map<string, BlooioLineState>();
  blooioLines.set("+14155550100", {
    phoneNumber: "+14155550100",
    isActive: true,
    suspended: false,
    status: "active",
    planKind: "dedicated",
    dailyOutboundCount: 0,
    dailyNewConversations: 0,
  });
  return {
    sessionId,
    seed,
    startMs,
    seq: 0,
    rng,
    socialAccounts: new Map(),
    socialPosts: new Map(),
    socialDms: [],
    blooioLines,
    blooioMessages: new Map(),
    blooioIdempotency: new Map(),
    blooioConversations: new Map(),
    twilioMessages: [],
    twilioCalls: [],
    emailDomains: new Map(),
    emailMessages: new Map(),
    emailIdempotency: new Map(),
    adCampaigns: new Map(),
    adConversions: [],
    s3Buckets: new Map(),
    s3Multiparts: new Map(),
    dubLinks: new Map(),
    dubBySlug: new Map(),
    beaconEvents: [],
    opsRecords: new Map(),
    opsIdempotency: new Map(),
    webhooks: new Map(),
  };
}

export class MockClockAdapter implements Clock {
  private readonly sim: SimClock;
  private external?: Clock;

  constructor(startMs = DEFAULT_MOCK_EPOCH_MS, external?: Clock) {
    this.sim = new SimClock(startMs);
    this.external = external;
  }

  now(): number {
    return this.external ? this.external.now() : this.sim.now();
  }

  set(ms: number): void {
    this.external = undefined;
    this.sim.set(ms);
  }

  advance(ms: number): void {
    this.external = undefined;
    this.sim.advance(ms);
  }

  iso(): string {
    return new Date(this.now()).toISOString();
  }

  unixSec(): number {
    return Math.floor(this.now() / 1000);
  }
}

export class MockStateRegistry {
  readonly clock: MockClockAdapter;
  readonly s3Dir?: string;
  private defaultSeed: number;
  private readonly sessions = new Map<string, MockSessionState>();

  constructor(opts: { seed?: number; startMs?: number; clock?: Clock; s3Dir?: string } = {}) {
    this.defaultSeed = Math.floor(opts.seed ?? 1);
    const startMs = opts.clock ? opts.clock.now() : (opts.startMs ?? DEFAULT_MOCK_EPOCH_MS);
    this.clock = new MockClockAdapter(startMs, opts.clock);
    this.s3Dir = opts.s3Dir;
  }

  session(sessionId?: string | null): MockSessionState {
    const id = sessionId?.trim() || "default";
    let state = this.sessions.get(id);
    if (!state) {
      state = createSessionState(id, this.defaultSeed, this.clock.now());
      this.sessions.set(id, state);
    }
    return state;
  }

  nextId(state: MockSessionState, prefix: string): string {
    state.seq += 1;
    return `${prefix}_${state.seed}_${state.seq.toString(36).padStart(6, "0")}`;
  }

  forkRng(state: MockSessionState, ...parts: Array<string | number>): Rng {
    return new Rng(hash32("mock", state.sessionId, state.seed, ...parts));
  }

  reset(opts: { seed?: number; startMs?: number; sessionId?: string } = {}): MockSessionState {
    if (opts.seed !== undefined && Number.isFinite(opts.seed)) {
      this.defaultSeed = Math.floor(opts.seed);
    }
    if (opts.startMs !== undefined && Number.isFinite(opts.startMs)) {
      this.clock.set(opts.startMs);
    }
    if (opts.sessionId) {
      const fresh = createSessionState(opts.sessionId, this.defaultSeed, this.clock.now());
      this.sessions.set(opts.sessionId, fresh);
      return fresh;
    }
    this.sessions.clear();
    const fresh = createSessionState("default", this.defaultSeed, this.clock.now());
    this.sessions.set("default", fresh);
    return fresh;
  }
}
