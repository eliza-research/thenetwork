// Apollo.io Enrichment & Prospecting Engine for @thenetwork/marketing (Node 26).
//
// Design & formal safety guarantees:
// - 2-stage search -> enrich architecture:
//   Stage 1: POST /mixed_people/api_search (0 Apollo credits, 24h cached) + deterministic pre-scoring
//            into the 28 VIP archetypes from ./vip-engine.ts.
//   Stage 2: POST /people/match or /people/bulk_match (1 credit/match, 30d cached) with
//            `reveal_personal_emails: false` and `reveal_phone_number: false` hard-enforced.
// - Verified work emails only: unverified, consumer/free, or role-based addresses are rejected.
// - Strict safety gates BEFORE any credit is spent AND AFTER an email is returned:
//   1. Minor / high-school cue filter -> immediate block + contact_suppression(isMinor=true)
//   2. store.isContactSuppressed + bridge.checkContactFence (platform bans/stops/minors/external)
//   3. Dafny-backed evaluateApolloCredits (daily/monthly credit caps, billingArmed, lockdown)
//   4. Post-enrichment re-check on returned email hash + immediate cache purge on suppression
// - Deterministic dry-run mode whenever APOLLO_API_KEY is absent, MARKETING_LIVE_BILLING !== "1",
//   or forceDryRun is set: returns reproducible synthetic candidates with 0 credits & 0 HTTP calls.

import { createHash } from "node:crypto";
import { RealClock } from "../../../../packages/core/src/clock.ts";
import { requireCityPack } from "../city-registry.ts";
import {
  DEFAULT_APOLLO_CENTS_PER_CREDIT,
  DEFAULT_APOLLO_DAILY_CREDIT_CAP,
  DEFAULT_APOLLO_DAILY_SEARCH_CAP,
  DEFAULT_APOLLO_MONTHLY_CREDIT_CAP,
} from "../constants.ts";
import type { NetworkCoreBridge } from "../network-bridge.ts";
import {
  evaluateApolloCredits,
  keyedContactHash,
} from "../policy.ts";
import type { MarketingStore } from "../store.ts";
import type {
  ApolloCreditUsageSummary,
  Clock,
  EnrichmentCacheEntry,
  FetchFn,
  VipProspect,
} from "../types.ts";
import {
  classifyVipArchetypeOrNull,
  getVipArchetype,
  inferSourceAuthority,
  scoreVipProspect,
  VipDiscoveryEngine,
  type VipOfferMode,
} from "../vip-engine.ts";

export const APOLLO_API_BASE = "https://api.apollo.io/api/v1";
export const APOLLO_SEARCH_CACHE_TTL_MS = 24 * 60 * 60_000;
export const APOLLO_ENRICH_CACHE_TTL_MS = 30 * 24 * 60 * 60_000;
export const APOLLO_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const APOLLO_HTTP_TIMEOUT_MS = 15_000;
const APOLLO_MAX_429_RETRIES = 2;
const APOLLO_LRU_MAX_ENTRIES = 512;

const MINOR_CUE_RE =
  /\b(high\s*school(?:er)?s?|middle\s*school|under\s*18|1[0-7]\s*(?:y\/?o|yr|year[\s-]old)|teenager|minor|freshman\s+at\s+\w+\s+high|prom)\b/i;

const FREE_OR_CONSUMER_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "ymail.com",
]);

const ROLE_EMAIL_PREFIXES: ReadonlySet<string> = new Set([
  "info",
  "support",
  "sales",
  "admin",
  "hello",
  "contact",
  "noreply",
  "no-reply",
  "help",
  "team",
  "press",
  "jobs",
  "careers",
  "privacy",
  "legal",
  "billing",
]);

export interface ApolloSearchInput {
  readonly city: string;
  readonly campaignId?: string;
  readonly archetypeSlugs?: readonly string[];
  readonly titles?: readonly string[];
  readonly keywords?: readonly string[];
  readonly perPage?: number;
  readonly page?: number;
  readonly forceDryRun?: boolean;
}

export interface ApolloSearchCandidate {
  readonly apolloPersonId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly fullName: string;
  readonly title: string;
  readonly organizationName: string;
  readonly domain: string | null;
  readonly linkedinUrl: string | null;
  readonly city: string;
  readonly archetypeSlug: string | null;
  readonly prestigeScore: number;
  readonly hasEmailHint: boolean;
  readonly minorRejected: boolean;
}

export interface ApolloSearchResult {
  readonly ok: boolean;
  readonly city: string;
  readonly dryRun: boolean;
  readonly cacheHit: boolean;
  readonly creditsSpent: number;
  readonly candidates: ApolloSearchCandidate[];
  readonly filteredMinorCount: number;
  readonly blockedReason?: string;
}

export interface ApolloEnrichInput {
  readonly campaignId?: string;
  readonly city?: string;
  readonly apolloPersonId?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly organizationName?: string;
  readonly domain?: string;
  readonly linkedinUrl?: string;
  readonly email?: string;
  readonly title?: string;
  readonly headline?: string;
  readonly statedAge?: number | null;
  readonly enrichOrg?: boolean;
  readonly prestigeScore?: number;
  readonly forceDryRun?: boolean;
}

export interface ApolloEnrichedOrg {
  readonly name: string;
  readonly domain: string;
  readonly industry: string | null;
  readonly employeeCount: number | null;
  readonly city: string | null;
  readonly foundedYear: number | null;
  readonly shortDescription: string | null;
}

export interface ApolloEnrichedPerson {
  readonly apolloPersonId: string | null;
  readonly fullName: string;
  readonly title: string | null;
  readonly organizationName: string | null;
  readonly domain: string | null;
  readonly linkedinUrl: string | null;
  readonly workEmail: string | null;
  readonly emailStatus: string | null;
  readonly verifiedWorkEmail: boolean;
  readonly archetypeSlug: string | null;
  readonly city: string | null;
  readonly organization: ApolloEnrichedOrg | null;
}

export interface ApolloEnrichResult {
  readonly ok: boolean;
  readonly dryRun: boolean;
  readonly cacheHit: boolean;
  readonly creditsSpent: number;
  readonly costCents: number;
  readonly person: ApolloEnrichedPerson | null;
  readonly contactHash: string | null;
  readonly blockedReason?: string;
}

export interface ApolloBulkEnrichResult {
  readonly results: ApolloEnrichResult[];
  readonly totalCreditsSpent: number;
  readonly totalCacheHits: number;
  readonly blockedCount: number;
}

export interface ApolloVipPipelineInput {
  readonly campaignId: string;
  readonly city?: string;
  readonly archetypeSlugs?: readonly string[];
  readonly titles?: readonly string[];
  readonly keywords?: readonly string[];
  readonly maxEnrich?: number;
  readonly minPrestigeScore?: number;
  readonly offerMode?: VipOfferMode;
  readonly bilateralPeerSummary?: string;
  readonly sharedExactProblem?: string;
  readonly forceDryRun?: boolean;
}

export interface ApolloVipPipelineCandidateResult {
  readonly prospect: VipProspect | null;
  readonly searchCandidate: ApolloSearchCandidate;
  readonly enrichResult: ApolloEnrichResult | null;
  readonly draftSubject: string | null;
  readonly draftBody: string | null;
  readonly skippedReason?: string;
}

export interface ApolloVipPipelineResult {
  readonly ok: boolean;
  readonly campaignId: string;
  readonly city: string;
  readonly dryRun: boolean;
  readonly searchedCount: number;
  readonly qualifiedCount: number;
  readonly enrichedCount: number;
  readonly persistedCount: number;
  readonly creditsSpent: number;
  readonly items: ApolloVipPipelineCandidateResult[];
  readonly usage: ApolloCreditUsageSummary;
}

export interface ApolloAdapterOptions {
  readonly store: MarketingStore;
  readonly bridge?: NetworkCoreBridge;
  readonly clock?: Clock;
  readonly fetchFn?: FetchFn;
  readonly env?: Record<string, string | undefined>;
  readonly dailyCreditCap?: number;
  readonly monthlyCreditCap?: number;
  readonly dailySearchCap?: number;
  readonly centsPerCredit?: number;
  readonly forceDryRun?: boolean;
  readonly sleepFn?: (ms: number) => Promise<void>;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function isVerifiedWorkEmail(email: string | null | undefined, emailStatus: string | null | undefined): boolean {
  if (!email) return false;
  const trimmed = email.trim().toLowerCase();
  const atIdx = trimmed.indexOf("@");
  if (atIdx <= 0 || atIdx === trimmed.length - 1) return false;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  if (!domain.includes(".") || domain.length < 4) return false;
  if (FREE_OR_CONSUMER_EMAIL_DOMAINS.has(domain)) return false;
  if (ROLE_EMAIL_PREFIXES.has(local)) return false;
  if (emailStatus && emailStatus.trim().toLowerCase() !== "verified") return false;
  return true;
}

function hasMinorCue(parts: ReadonlyArray<string | null | undefined>, statedAge?: number | null): boolean {
  if (statedAge !== undefined && statedAge !== null && statedAge < 18) return true;
  const joined = parts.filter((p): p is string => typeof p === "string" && p.length > 0).join(" ");
  return MINOR_CUE_RE.test(joined);
}

async function readBoundedJson(res: Response): Promise<Record<string, unknown>> {
  const reader = res.body?.getReader();
  if (!reader) {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > APOLLO_MAX_RESPONSE_BYTES) {
      throw new Error(`Apollo response exceeded ${APOLLO_MAX_RESPONSE_BYTES} byte limit`);
    }
    if (!text.trim()) return {};
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > APOLLO_MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`Apollo response exceeded ${APOLLO_MAX_RESPONSE_BYTES} byte limit`);
    }
    chunks.push(value);
  }
  const merged = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const text = merged.toString("utf8");
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.min(10_000, ms)));
  });
}

function defaultTitlesForArchetypes(archetypeSlugs?: readonly string[]): string[] {
  if (!archetypeSlugs || archetypeSlugs.length === 0) {
    return ["Founder", "Co-Founder", "General Partner", "Creative Director", "Principal Engineer"];
  }
  const map: Record<string, readonly string[]> = {
    startup_founder: ["Founder", "Co-Founder", "Chief Executive Officer"],
    vc_lp: ["General Partner", "Managing Partner", "Angel Investor"],
    ai_biotech_researcher: ["Research Scientist", "Principal Researcher", "Staff Research Engineer"],
    michelin_chef_hospitality: ["Executive Chef", "Culinary Director", "Restaurateur"],
    creative_director_tastemaker: ["Creative Director", "Editorial Director", "Head of Brand"],
    super_connector_host: ["Community Director", "Salon Host", "Head of Community"],
    senior_staff_engineer: ["Staff Software Engineer", "Principal Engineer", "Distinguished Engineer"],
    indie_maker_shipper: ["Independent Founder", "Product Builder", "Indie Maker"],
    executive_operator: ["Chief Operating Officer", "VP of Operations", "Chief of Staff"],
    music_producer_programmer: ["Music Director", "Record Producer", "Artistic Director"],
    gallery_collector: ["Gallery Director", "Curator", "Art Advisor"],
    civic_urbanist_leader: ["Urban Planner", "Civic Innovation Director", "Policy Director"],
    performance_coach_captain: ["Head Coach", "Run Club Captain", "Performance Director"],
    family_office_patron: ["Managing Director", "Chief Investment Officer", "Patron"],
    podcaster_curator: ["Podcast Host", "Executive Producer", "Newsletter Editor"],
    leading_physician: ["Attending Physician", "Chief of Surgery", "Principal Investigator"],
  };
  const out = new Set<string>();
  for (const slug of archetypeSlugs) {
    const titles = map[slug];
    if (titles) {
      for (const t of titles) out.add(t);
    } else {
      const def = getVipArchetype(slug);
      out.add(def.matchKeywords[0] ?? def.slug);
    }
  }
  return [...out].slice(0, 15);
}

interface SyntheticFixture {
  readonly firstName: string;
  readonly lastName: string;
  readonly title: string;
  readonly organizationName: string;
  readonly domain: string;
  readonly archetypeSlug: string;
}

const SYNTHETIC_FIXTURES: readonly SyntheticFixture[] = [
  {
    firstName: "Elena",
    lastName: "Vance",
    title: "Co-Founder & CTO",
    organizationName: "Helios Systems",
    domain: "heliossystems.io",
    archetypeSlug: "startup_founder",
  },
  {
    firstName: "Marcus",
    lastName: "Keller",
    title: "General Partner",
    organizationName: "Foundry Row Ventures",
    domain: "foundryrow.vc",
    archetypeSlug: "vc_lp",
  },
  {
    firstName: "Sora",
    lastName: "Takahashi",
    title: "Creative Director",
    organizationName: "Atelier Mercer",
    domain: "ateliermercer.studio",
    archetypeSlug: "creative_director_tastemaker",
  },
  {
    firstName: "Devon",
    lastName: "Okafor",
    title: "Staff Distributed Systems Engineer",
    organizationName: "Lattice Compute",
    domain: "latticecompute.dev",
    archetypeSlug: "senior_staff_engineer",
  },
  {
    firstName: "Nadia",
    lastName: "Benchekroun",
    title: "Executive Chef & Owner",
    organizationName: "Bistro Marigold",
    domain: "bistromarigold.com",
    archetypeSlug: "michelin_chef_hospitality",
  },
  {
    firstName: "Julian",
    lastName: "Reyes",
    title: "Principal AI Research Scientist",
    organizationName: "Northstar Labs",
    domain: "northstarlabs.ai",
    archetypeSlug: "ai_biotech_researcher",
  },
];

export class ApolloEnrichmentAdapter {
  private readonly store: MarketingStore;
  private readonly bridge?: NetworkCoreBridge;
  private readonly clock: Clock;
  private readonly fetchFn: FetchFn;
  private readonly env: Record<string, string | undefined>;
  private readonly dailyCreditCap: number;
  private readonly monthlyCreditCap: number;
  private readonly dailySearchCap: number;
  private readonly centsPerCredit: number;
  private readonly forceDryRun: boolean;
  private readonly sleepFn: (ms: number) => Promise<void>;
  private readonly memoryLru = new Map<string, EnrichmentCacheEntry>();

  constructor(opts: ApolloAdapterOptions) {
    this.store = opts.store;
    this.bridge = opts.bridge;
    this.clock = opts.clock ?? opts.store.clock ?? new RealClock();
    this.fetchFn = opts.fetchFn ?? fetch;
    this.env = opts.env ?? process.env;
    this.dailyCreditCap = Math.max(1, Math.round(opts.dailyCreditCap ?? DEFAULT_APOLLO_DAILY_CREDIT_CAP));
    this.monthlyCreditCap = Math.max(1, Math.round(opts.monthlyCreditCap ?? DEFAULT_APOLLO_MONTHLY_CREDIT_CAP));
    this.dailySearchCap = Math.max(1, Math.round(opts.dailySearchCap ?? DEFAULT_APOLLO_DAILY_SEARCH_CAP));
    this.centsPerCredit = Math.max(1, Math.round(opts.centsPerCredit ?? DEFAULT_APOLLO_CENTS_PER_CREDIT));
    this.forceDryRun = Boolean(opts.forceDryRun);
    this.sleepFn = opts.sleepFn ?? defaultSleep;
  }

  private hasLiveCredentials(): boolean {
    const key = this.env["APOLLO_API_KEY"]?.trim();
    return Boolean(key && key.length > 0 && this.env["MARKETING_LIVE_BILLING"] === "1");
  }

  isLiveMode(forceDryRun?: boolean): boolean {
    return !this.forceDryRun && !forceDryRun && this.hasLiveCredentials();
  }

  private lruGet(cacheKey: string, nowMs: number): EnrichmentCacheEntry | null {
    const found = this.memoryLru.get(cacheKey);
    if (!found) return null;
    const expMs = Date.parse(found.expiresAt);
    if (Number.isFinite(expMs) && expMs <= nowMs) {
      this.memoryLru.delete(cacheKey);
      return null;
    }
    this.memoryLru.delete(cacheKey);
    this.memoryLru.set(cacheKey, found);
    return found;
  }

  private lruSet(entry: EnrichmentCacheEntry): void {
    this.memoryLru.delete(entry.cacheKey);
    this.memoryLru.set(entry.cacheKey, entry);
    while (this.memoryLru.size > APOLLO_LRU_MAX_ENTRIES) {
      const oldest = this.memoryLru.keys().next().value;
      if (oldest === undefined) break;
      this.memoryLru.delete(oldest);
    }
  }

  private lruPurgeContactHash(contactHash: string): void {
    for (const [k, v] of this.memoryLru) {
      if (v.contactHash === contactHash) {
        this.memoryLru.delete(k);
      }
    }
  }

  private async getCached(cacheKey: string, nowMs: number): Promise<EnrichmentCacheEntry | null> {
    const mem = this.lruGet(cacheKey, nowMs);
    if (mem) return mem;
    const persisted = await this.store.getEnrichmentCache(cacheKey, nowMs);
    if (persisted) {
      this.lruSet(persisted);
      return persisted;
    }
    return null;
  }

  private async putCached(entry: EnrichmentCacheEntry): Promise<void> {
    this.lruSet(entry);
    await this.store.upsertEnrichmentCache(entry);
  }

  private async requestApollo(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
    const apiKey = this.env["APOLLO_API_KEY"]?.trim() ?? "";
    const url = `${APOLLO_API_BASE}${path}`;

    for (let attempt = 0; attempt <= APOLLO_MAX_429_RETRIES; attempt += 1) {
      const res = await this.fetchFn(url, {
        method,
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
          "cache-control": "no-cache",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(APOLLO_HTTP_TIMEOUT_MS),
      });
      if (res.status === 429 && attempt < APOLLO_MAX_429_RETRIES) {
        const retryAfterRaw = res.headers?.get?.("retry-after");
        const retrySec = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : NaN;
        const delayMs = Number.isFinite(retrySec) && retrySec > 0 ? Math.min(10_000, retrySec * 1_000) : 1_000 * (attempt + 1);
        await this.sleepFn(delayMs);
        continue;
      }
      const json = await readBoundedJson(res);
      return { ok: res.ok, status: res.status, json };
    }

    return { ok: false, status: 429, json: { error: "apollo_rate_limited" } };
  }

  async getCreditUsage(): Promise<
    ApolloCreditUsageSummary & {
      readonly dailyCreditCap: number;
      readonly monthlyCreditCap: number;
      readonly dailySearchCap: number;
      readonly liveConfigured: boolean;
      readonly liveBillingEnabled: boolean;
    }
  > {
    const usage = await this.store.getApolloCreditUsage(this.clock.now());
    return {
      ...usage,
      dailyCreditCap: this.dailyCreditCap,
      monthlyCreditCap: this.monthlyCreditCap,
      dailySearchCap: this.dailySearchCap,
      liveConfigured: Boolean(this.env["APOLLO_API_KEY"]?.trim()),
      liveBillingEnabled: this.env["MARKETING_LIVE_BILLING"] === "1",
    };
  }

  async searchPeople(input: ApolloSearchInput): Promise<ApolloSearchResult> {
    const nowMs = this.clock.now();
    const pack = requireCityPack(input.city);
    const city = pack.code;
    const perPage = Math.max(1, Math.min(25, Math.round(input.perPage ?? 10)));
    const page = Math.max(1, Math.min(20, Math.round(input.page ?? 1)));
    const titles =
      input.titles && input.titles.length > 0
        ? [...input.titles]
        : defaultTitlesForArchetypes(input.archetypeSlugs);
    const keywords = input.keywords ? [...input.keywords] : [];

    const cacheKey = `apollo:search:${sha256Hex(
      JSON.stringify({
        city,
        archetypeSlugs: input.archetypeSlugs ?? [],
        titles,
        keywords,
        perPage,
        page,
      }),
    )}`;

    const cached = await this.getCached(cacheKey, nowMs);
    if (cached) {
      const candidates = Array.isArray(cached.payload["candidates"])
        ? (cached.payload["candidates"] as ApolloSearchCandidate[])
        : [];
      await this.store.recordApolloCredit({
        campaignId: input.campaignId ?? null,
        operation: "people_search",
        credits: 0,
        costCents: 0,
        cacheHit: true,
        dryRun: !this.isLiveMode(input.forceDryRun),
        idempotencyKey: `apollo:search:hit:${cacheKey}:${nowMs}`,
      });
      return {
        ok: true,
        city,
        dryRun: !this.isLiveMode(input.forceDryRun),
        cacheHit: true,
        creditsSpent: 0,
        candidates,
        filteredMinorCount: Number(cached.payload["filteredMinorCount"] ?? 0),
      };
    }

    const usage = await this.store.getApolloCreditUsage(nowMs);
    if (usage.searchCallsToday >= this.dailySearchCap) {
      return {
        ok: false,
        city,
        dryRun: !this.isLiveMode(input.forceDryRun),
        cacheHit: false,
        creditsSpent: 0,
        candidates: [],
        filteredMinorCount: 0,
        blockedReason: "apollo_daily_search_cap_reached",
      };
    }

    const live = this.isLiveMode(input.forceDryRun);
    let rawPeople: Array<Record<string, unknown>>;

    if (!live) {
      const requestedSlugs =
        input.archetypeSlugs && input.archetypeSlugs.length > 0
          ? new Set(input.archetypeSlugs)
          : null;
      const pool = requestedSlugs
        ? SYNTHETIC_FIXTURES.filter((f) => requestedSlugs.has(f.archetypeSlug))
        : SYNTHETIC_FIXTURES;
      const chosen = pool.length > 0 ? pool : SYNTHETIC_FIXTURES;
      rawPeople = chosen.slice(0, perPage).map((f, idx) => ({
        id: `dry-${city}-${f.archetypeSlug}-${idx + 1}`,
        first_name: f.firstName,
        last_name: f.lastName,
        title: f.title,
        organization: { name: f.organizationName, primary_domain: f.domain },
        linkedin_url: `https://www.linkedin.com/in/${f.firstName.toLowerCase()}-${f.lastName.toLowerCase()}-${city}`,
        city: pack.label,
        has_email: true,
      }));
    } else {
      const res = await this.requestApollo("POST", "/mixed_people/api_search", {
        person_titles: titles,
        person_locations: [pack.label],
        q_keywords: keywords.length > 0 ? keywords.join(" ") : undefined,
        per_page: perPage,
        page,
      });
      if (!res.ok) {
        return {
          ok: false,
          city,
          dryRun: false,
          cacheHit: false,
          creditsSpent: 0,
          candidates: [],
          filteredMinorCount: 0,
          blockedReason: `apollo_search_http_${res.status}`,
        };
      }
      rawPeople = Array.isArray(res.json["people"])
        ? (res.json["people"] as Array<Record<string, unknown>>)
        : [];
    }

    const candidates: ApolloSearchCandidate[] = [];
    let filteredMinorCount = 0;

    for (const p of rawPeople) {
      const firstName = typeof p["first_name"] === "string" ? p["first_name"].trim() : "";
      const lastName = typeof p["last_name"] === "string" ? p["last_name"].trim() : "";
      const fullName = `${firstName} ${lastName}`.trim() || (typeof p["name"] === "string" ? p["name"].trim() : "");
      if (!fullName) continue;
      const title = typeof p["title"] === "string" ? p["title"].trim() : "";
      const headline = typeof p["headline"] === "string" ? p["headline"].trim() : "";
      const orgObj =
        p["organization"] && typeof p["organization"] === "object"
          ? (p["organization"] as Record<string, unknown>)
          : null;
      const organizationName =
        typeof orgObj?.["name"] === "string"
          ? orgObj["name"].trim()
          : typeof p["organization_name"] === "string"
            ? p["organization_name"].trim()
            : "";
      const domain =
        typeof orgObj?.["primary_domain"] === "string"
          ? orgObj["primary_domain"].trim().toLowerCase()
          : null;
      const linkedinUrl =
        typeof p["linkedin_url"] === "string" && p["linkedin_url"].trim().length > 0
          ? p["linkedin_url"].trim()
          : null;

      if (hasMinorCue([fullName, title, headline, organizationName])) {
        filteredMinorCount += 1;
        continue;
      }

      const archetypeSpec = classifyVipArchetypeOrNull(
        `${title} ${headline} ${organizationName} ${keywords.join(" ")}`,
      );
      const archetypeSlug = archetypeSpec?.slug ?? null;
      const prestigeScore = scoreVipProspect({
        archetypeSlug: archetypeSlug ?? "startup_founder",
        bioOrSummary: `${fullName} ${title} ${headline} ${organizationName}`,
        primarySourceAuthority: inferSourceAuthority("apollo_search"),
        recentWithin18Months: true,
        inTargetCity: true,
        proofOfWorkHook: `${title} at ${organizationName}`.trim(),
      }).score;

      candidates.push({
        apolloPersonId: typeof p["id"] === "string" ? p["id"] : sha256Hex(`${fullName}:${domain ?? city}`).slice(0, 16),
        firstName,
        lastName,
        fullName,
        title,
        organizationName,
        domain,
        linkedinUrl,
        city,
        archetypeSlug,
        prestigeScore,
        hasEmailHint: Boolean(p["has_email"] ?? true),
        minorRejected: false,
      });
    }

    candidates.sort((a, b) => b.prestigeScore - a.prestigeScore || a.fullName.localeCompare(b.fullName));

    await this.putCached({
      cacheKey,
      provider: "apollo",
      operation: "people_search",
      contactHash: null,
      payload: { candidates, filteredMinorCount },
      verifiedEmail: false,
      creditsSpent: 0,
      fetchedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + APOLLO_SEARCH_CACHE_TTL_MS).toISOString(),
    });
    await this.store.recordApolloCredit({
      campaignId: input.campaignId ?? null,
      operation: "people_search",
      credits: 0,
      costCents: 0,
      cacheHit: false,
      dryRun: !live,
      idempotencyKey: `apollo:search:${cacheKey}:${nowMs}`,
    });

    return {
      ok: true,
      city,
      dryRun: !live,
      cacheHit: false,
      creditsSpent: 0,
      candidates,
      filteredMinorCount,
    };
  }

  async enrichOrganization(
    domain: string,
    opts: { readonly campaignId?: string; readonly forceDryRun?: boolean } = {},
  ): Promise<ApolloEnrichedOrg | null> {
    const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, "").split("/")[0] ?? "";
    if (!cleanDomain || !cleanDomain.includes(".")) return null;

    const nowMs = this.clock.now();
    const cacheKey = `apollo:org:${cleanDomain}`;
    const cached = await this.getCached(cacheKey, nowMs);
    if (cached) {
      return cached.payload as unknown as ApolloEnrichedOrg;
    }

    const live = this.isLiveMode(opts.forceDryRun);
    let org: ApolloEnrichedOrg;
    if (!live) {
      org = {
        name: cleanDomain.split(".")[0]?.replace(/[-_]/g, " ").toUpperCase() || cleanDomain,
        domain: cleanDomain,
        industry: "Technology",
        employeeCount: 42,
        city: "New York",
        foundedYear: 2021,
        shortDescription: `Synthetic dry-run organization profile for ${cleanDomain}`,
      };
    } else {
      const res = await this.requestApollo(
        "GET",
        `/organizations/enrich?domain=${encodeURIComponent(cleanDomain)}`,
      );
      if (!res.ok) return null;
      const o =
        res.json["organization"] && typeof res.json["organization"] === "object"
          ? (res.json["organization"] as Record<string, unknown>)
          : null;
      if (!o) return null;
      org = {
        name: typeof o["name"] === "string" ? o["name"] : cleanDomain,
        domain: cleanDomain,
        industry: typeof o["industry"] === "string" ? o["industry"] : null,
        employeeCount: typeof o["estimated_num_employees"] === "number" ? o["estimated_num_employees"] : null,
        city: typeof o["city"] === "string" ? o["city"] : null,
        foundedYear: typeof o["founded_year"] === "number" ? o["founded_year"] : null,
        shortDescription: typeof o["short_description"] === "string" ? o["short_description"].slice(0, 400) : null,
      };
    }

    await this.putCached({
      cacheKey,
      provider: "apollo",
      operation: "org_enrich",
      contactHash: null,
      payload: org as unknown as Record<string, unknown>,
      verifiedEmail: false,
      creditsSpent: 0,
      fetchedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + APOLLO_ENRICH_CACHE_TTL_MS).toISOString(),
    });
    await this.store.recordApolloCredit({
      campaignId: opts.campaignId ?? null,
      operation: "org_enrich",
      credits: 0,
      costCents: 0,
      cacheHit: false,
      dryRun: !live,
      idempotencyKey: `apollo:org:${cleanDomain}:${nowMs}`,
    });
    return org;
  }

  async enrichPerson(input: ApolloEnrichInput): Promise<ApolloEnrichResult> {
    const nowMs = this.clock.now();
    const live = this.isLiveMode(input.forceDryRun);
    const lookupIdentifier =
      input.email?.trim().toLowerCase() ||
      input.linkedinUrl?.trim().toLowerCase() ||
      input.apolloPersonId?.trim() ||
      `${(input.firstName ?? "").trim().toLowerCase()}|${(input.lastName ?? "").trim().toLowerCase()}|${(input.domain ?? input.organizationName ?? "").trim().toLowerCase()}`;

    const preContactHash =
      (input.email
        ? keyedContactHash("email", input.email, this.env)
        : keyedContactHash("handle", lookupIdentifier, this.env)) ??
      sha256Hex(`apollo:${lookupIdentifier}`);

    if (
      hasMinorCue(
        [input.firstName, input.lastName, input.title, input.headline, input.organizationName],
        input.statedAge,
      )
    ) {
      await this.store.recordContactSuppression({
        contactHash: preContactHash,
        reason: "apollo_minor_cue_blocked",
        sourceChannel: "apollo",
        isMinor: true,
      });
      this.lruPurgeContactHash(preContactHash);
      return {
        ok: false,
        dryRun: !live,
        cacheHit: false,
        creditsSpent: 0,
        costCents: 0,
        person: null,
        contactHash: preContactHash,
        blockedReason: "apollo_minor_blocked",
      };
    }

    const preSuppressed = await this.store.isContactSuppressed(preContactHash);
    if (preSuppressed) {
      return {
        ok: false,
        dryRun: !live,
        cacheHit: false,
        creditsSpent: 0,
        costCents: 0,
        person: null,
        contactHash: preContactHash,
        blockedReason: preSuppressed.isMinor ? "apollo_minor_suppressed" : "apollo_contact_suppressed",
      };
    }

    if (this.bridge) {
      const preFence = await this.bridge.checkContactFence({
        email: input.email ?? null,
        handleHash: preContactHash,
      });
      if (!preFence.allowed) {
        await this.store.recordContactSuppression({
          contactHash: preContactHash,
          reason: preFence.reason ?? "contact_fence_blocked",
          sourceChannel: "apollo",
          isMinor: preFence.knownMinor,
        });
        this.lruPurgeContactHash(preContactHash);
        return {
          ok: false,
          dryRun: !live,
          cacheHit: false,
          creditsSpent: 0,
          costCents: 0,
          person: null,
          contactHash: preContactHash,
          blockedReason: preFence.reason ?? "contact_fence_blocked",
        };
      }
    }

    const cacheKey = `apollo:match:${sha256Hex(lookupIdentifier)}`;
    const cached = await this.getCached(cacheKey, nowMs);
    if (cached) {
      const person = cached.payload["person"] as ApolloEnrichedPerson | null;
      const cachedHash = cached.contactHash ?? preContactHash;
      if (cachedHash) {
        const suppressedNow = await this.store.isContactSuppressed(cachedHash);
        if (suppressedNow) {
          this.lruPurgeContactHash(cachedHash);
          await this.store.purgeEnrichmentCacheByContactHash(cachedHash);
          return {
            ok: false,
            dryRun: !live,
            cacheHit: true,
            creditsSpent: 0,
            costCents: 0,
            person: null,
            contactHash: cachedHash,
            blockedReason: "apollo_contact_suppressed",
          };
        }
      }
      await this.store.recordApolloCredit({
        campaignId: input.campaignId ?? null,
        operation: "people_match",
        credits: 0,
        costCents: 0,
        cacheHit: true,
        dryRun: !live,
        idempotencyKey: `apollo:match:hit:${cacheKey}:${nowMs}`,
      });
      return {
        ok: true,
        dryRun: !live,
        cacheHit: true,
        creditsSpent: 0,
        costCents: 0,
        person,
        contactHash: cachedHash,
      };
    }

    const campaign = input.campaignId ? await this.store.getCampaign(input.campaignId) : null;
    const usage = await this.store.getApolloCreditUsage(nowMs);
    const creditGate = evaluateApolloCredits({
      creditsUsedToday: usage.creditsUsedToday,
      requestedCredits: 1,
      dailyCreditCap: this.dailyCreditCap,
      creditsUsedMonth: usage.creditsUsedMonth,
      monthlyCreditCap: this.monthlyCreditCap,
      billingArmed: live ? (campaign ? campaign.billingArmed : true) : true,
      lockdown: campaign?.riskDial === "lockdown" || campaign?.status === "paused",
      isSuppressed: false,
      isKnownMinor: false,
    });
    if (!creditGate.allowed) {
      return {
        ok: false,
        dryRun: !live,
        cacheHit: false,
        creditsSpent: 0,
        costCents: 0,
        person: null,
        contactHash: preContactHash,
        blockedReason: creditGate.reason ?? "apollo_credits_blocked",
      };
    }

    let rawPerson: Record<string, unknown> | null;
    if (!live) {
      const first = input.firstName?.trim() || "Elena";
      const last = input.lastName?.trim() || "Vance";
      const domain =
        input.domain?.trim().toLowerCase() ||
        `${(input.organizationName ?? "heliossystems").toLowerCase().replace(/[^a-z0-9]+/g, "")}.io`;
      const workEmail = input.email?.trim().toLowerCase() || `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`;
      rawPerson = {
        id: input.apolloPersonId ?? `dry-match-${sha256Hex(lookupIdentifier).slice(0, 12)}`,
        first_name: first,
        last_name: last,
        name: `${first} ${last}`.trim(),
        title: input.title ?? "Co-Founder",
        headline: input.headline ?? input.title ?? "Co-Founder",
        organization: { name: input.organizationName ?? "Helios Systems", primary_domain: domain },
        linkedin_url: input.linkedinUrl ?? `https://www.linkedin.com/in/${first.toLowerCase()}-${last.toLowerCase()}`,
        email: workEmail,
        email_status: "verified",
        city: input.city ?? "nyc",
      };
    } else {
      const res = await this.requestApollo("POST", "/people/match", {
        id: input.apolloPersonId,
        first_name: input.firstName,
        last_name: input.lastName,
        organization_name: input.organizationName,
        domain: input.domain,
        linkedin_url: input.linkedinUrl,
        email: input.email,
        reveal_personal_emails: false,
        reveal_phone_number: false,
      });
      if (!res.ok) {
        return {
          ok: false,
          dryRun: false,
          cacheHit: false,
          creditsSpent: 0,
          costCents: 0,
          person: null,
          contactHash: preContactHash,
          blockedReason: `apollo_match_http_${res.status}`,
        };
      }
      rawPerson =
        res.json["person"] && typeof res.json["person"] === "object"
          ? (res.json["person"] as Record<string, unknown>)
          : null;
    }

    const creditsSpent = live ? 1 : 0;
    const costCents = creditsSpent * this.centsPerCredit;
    const idempotencyKey = `apollo:match:${cacheKey}:${nowMs}`;

    await this.store.recordApolloCredit({
      campaignId: input.campaignId ?? null,
      operation: "people_match",
      credits: creditsSpent,
      costCents,
      cacheHit: false,
      dryRun: !live,
      idempotencyKey,
    });
    if (live && costCents > 0 && this.bridge) {
      await this.bridge.recordOperationalCost({
        kind: "other",
        provider: "apollo",
        appId: campaign && campaign.appId !== "all" ? campaign.appId : "ntwrk",
        quantity: creditsSpent,
        unitCostUsd: this.centsPerCredit / 100,
        costUsd: costCents / 100,
        estimated: true,
        detail: {
          campaignId: input.campaignId ?? null,
          operation: "people_match",
          cacheKeyPrefix: cacheKey.slice(0, 24),
        },
      });
    }

    if (!rawPerson) {
      return {
        ok: true,
        dryRun: !live,
        cacheHit: false,
        creditsSpent,
        costCents,
        person: null,
        contactHash: preContactHash,
      };
    }

    const fullName =
      (typeof rawPerson["name"] === "string" && rawPerson["name"].trim()) ||
      `${typeof rawPerson["first_name"] === "string" ? rawPerson["first_name"] : ""} ${typeof rawPerson["last_name"] === "string" ? rawPerson["last_name"] : ""}`.trim();
    const title = typeof rawPerson["title"] === "string" ? rawPerson["title"].trim() : null;
    const headline = typeof rawPerson["headline"] === "string" ? rawPerson["headline"].trim() : null;
    const orgObj =
      rawPerson["organization"] && typeof rawPerson["organization"] === "object"
        ? (rawPerson["organization"] as Record<string, unknown>)
        : null;
    const organizationName =
      typeof orgObj?.["name"] === "string"
        ? orgObj["name"].trim()
        : typeof rawPerson["organization_name"] === "string"
          ? rawPerson["organization_name"].trim()
          : input.organizationName ?? null;
    const domain =
      typeof orgObj?.["primary_domain"] === "string"
        ? orgObj["primary_domain"].trim().toLowerCase()
        : input.domain?.trim().toLowerCase() ?? null;
    const linkedinUrl =
      typeof rawPerson["linkedin_url"] === "string" ? rawPerson["linkedin_url"].trim() : input.linkedinUrl ?? null;

    const rawEmail = typeof rawPerson["email"] === "string" ? rawPerson["email"].trim().toLowerCase() : null;
    const emailStatus = typeof rawPerson["email_status"] === "string" ? rawPerson["email_status"].trim().toLowerCase() : null;
    const verifiedWorkEmail = isVerifiedWorkEmail(rawEmail, emailStatus);
    const workEmail = verifiedWorkEmail ? rawEmail : null;
    const finalContactHash =
      (workEmail ? keyedContactHash("email", workEmail, this.env) : null) ?? preContactHash;

    if (hasMinorCue([fullName, title, headline, organizationName])) {
      await this.store.recordContactSuppression({
        contactHash: finalContactHash,
        reason: "apollo_post_enrich_minor_cue",
        sourceChannel: "apollo",
        isMinor: true,
      });
      this.lruPurgeContactHash(finalContactHash);
      await this.store.purgeEnrichmentCacheByContactHash(finalContactHash);
      return {
        ok: false,
        dryRun: !live,
        cacheHit: false,
        creditsSpent,
        costCents,
        person: null,
        contactHash: finalContactHash,
        blockedReason: "apollo_minor_blocked",
      };
    }

    if (workEmail) {
      const postSuppressed = await this.store.isContactSuppressed(finalContactHash);
      if (postSuppressed) {
        this.lruPurgeContactHash(finalContactHash);
        await this.store.purgeEnrichmentCacheByContactHash(finalContactHash);
        return {
          ok: false,
          dryRun: !live,
          cacheHit: false,
          creditsSpent,
          costCents,
          person: null,
          contactHash: finalContactHash,
          blockedReason: postSuppressed.isMinor ? "apollo_minor_suppressed" : "apollo_contact_suppressed",
        };
      }
      if (this.bridge) {
        const postFence = await this.bridge.checkContactFence({
          email: workEmail,
          handleHash: finalContactHash,
        });
        if (!postFence.allowed) {
          await this.store.recordContactSuppression({
            contactHash: finalContactHash,
            reason: postFence.reason ?? "contact_fence_blocked",
            sourceChannel: "apollo",
            isMinor: postFence.knownMinor,
          });
          this.lruPurgeContactHash(finalContactHash);
          await this.store.purgeEnrichmentCacheByContactHash(finalContactHash);
          return {
            ok: false,
            dryRun: !live,
            cacheHit: false,
            creditsSpent,
            costCents,
            person: null,
            contactHash: finalContactHash,
            blockedReason: postFence.reason ?? "contact_fence_blocked",
          };
        }
      }
    }

    const organization =
      input.enrichOrg && domain
        ? await this.enrichOrganization(domain, {
            campaignId: input.campaignId,
            forceDryRun: input.forceDryRun,
          })
        : null;

    const archetypeSlug =
      classifyVipArchetypeOrNull(
        `${title ?? ""} ${headline ?? ""} ${organizationName ?? ""} ${organization?.industry ?? ""}`,
      )?.slug ?? null;

    const person: ApolloEnrichedPerson = {
      apolloPersonId: typeof rawPerson["id"] === "string" ? rawPerson["id"] : input.apolloPersonId ?? null,
      fullName,
      title,
      organizationName,
      domain,
      linkedinUrl,
      workEmail,
      emailStatus,
      verifiedWorkEmail,
      archetypeSlug,
      city: typeof rawPerson["city"] === "string" ? rawPerson["city"] : input.city ?? null,
      organization,
    };

    await this.putCached({
      cacheKey,
      provider: "apollo",
      operation: "people_match",
      contactHash: finalContactHash,
      payload: { person },
      verifiedEmail: verifiedWorkEmail,
      creditsSpent,
      fetchedAt: new Date(nowMs).toISOString(),
      expiresAt: new Date(nowMs + APOLLO_ENRICH_CACHE_TTL_MS).toISOString(),
    });

    return {
      ok: true,
      dryRun: !live,
      cacheHit: false,
      creditsSpent,
      costCents,
      person,
      contactHash: finalContactHash,
    };
  }

  async bulkEnrichPeople(inputs: readonly ApolloEnrichInput[]): Promise<ApolloBulkEnrichResult> {
    const batch = inputs.slice(0, 10);
    const results: ApolloEnrichResult[] = [];
    let totalCreditsSpent = 0;
    let totalCacheHits = 0;
    let blockedCount = 0;

    for (const item of batch) {
      const res = await this.enrichPerson(item);
      results.push(res);
      totalCreditsSpent += res.creditsSpent;
      if (res.cacheHit) totalCacheHits += 1;
      if (!res.ok) blockedCount += 1;
    }

    return { results, totalCreditsSpent, totalCacheHits, blockedCount };
  }

  async runApolloVipPipeline(input: ApolloVipPipelineInput): Promise<ApolloVipPipelineResult> {
    const campaign = await this.store.getCampaign(input.campaignId);
    if (!campaign) {
      throw new Error(`Campaign not found: ${input.campaignId}`);
    }
    const city = input.city ?? campaign.city;
    const maxEnrich = Math.max(0, Math.min(25, Math.round(input.maxEnrich ?? 5)));
    const minPrestigeScore = Math.max(0, Math.min(100, Math.round(input.minPrestigeScore ?? 65)));
    const live = this.isLiveMode(input.forceDryRun);

    const search = await this.searchPeople({
      city,
      campaignId: campaign.id,
      archetypeSlugs: input.archetypeSlugs,
      titles: input.titles,
      keywords: input.keywords,
      perPage: Math.min(25, Math.max(10, maxEnrich * 2)),
      forceDryRun: input.forceDryRun,
    });

    const qualified = search.candidates.filter((c) => c.prestigeScore >= minPrestigeScore);
    const items: ApolloVipPipelineCandidateResult[] = [];
    let enrichedCount = 0;
    let persistedCount = 0;
    let creditsSpent = search.creditsSpent;

    const vipEngine = new VipDiscoveryEngine({ clock: this.clock });

    for (const candidate of qualified) {
      if (enrichedCount >= maxEnrich) {
        items.push({
          prospect: null,
          searchCandidate: candidate,
          enrichResult: null,
          draftSubject: null,
          draftBody: null,
          skippedReason: "max_enrich_cap_reached",
        });
        continue;
      }

      const enrichResult = await this.enrichPerson({
        campaignId: campaign.id,
        city,
        apolloPersonId: candidate.apolloPersonId,
        firstName: candidate.firstName,
        lastName: candidate.lastName,
        organizationName: candidate.organizationName,
        domain: candidate.domain ?? undefined,
        linkedinUrl: candidate.linkedinUrl ?? undefined,
        title: candidate.title,
        prestigeScore: candidate.prestigeScore,
        forceDryRun: input.forceDryRun,
      });
      creditsSpent += enrichResult.creditsSpent;

      if (!enrichResult.ok || !enrichResult.person) {
        items.push({
          prospect: null,
          searchCandidate: candidate,
          enrichResult,
          draftSubject: null,
          draftBody: null,
          skippedReason: enrichResult.blockedReason ?? "enrichment_no_match",
        });
        continue;
      }

      enrichedCount += 1;
      const archetypeSlug =
        enrichResult.person.archetypeSlug ?? candidate.archetypeSlug ?? "startup_founder";
      const publicProof = `${enrichResult.person.title ?? candidate.title} at ${enrichResult.person.organizationName ?? candidate.organizationName}`;
      const firstName = enrichResult.person.fullName.split(/\s+/)[0] ?? enrichResult.person.fullName;
      const draft = vipEngine.buildAndValidateVipInvite({
        firstName,
        archetypeSlug,
        city,
        proofOfWork1Line: publicProof,
        senderName: "The Operator",
        offerMode: input.offerMode,
        bilateralPeerSummary: input.bilateralPeerSummary,
        sharedExactProblem: input.sharedExactProblem,
      });

      const prospect = await this.store.createVipProspect({
        campaignId: campaign.id,
        city,
        name: enrichResult.person.fullName,
        archetype: archetypeSlug,
        organization: enrichResult.person.organizationName,
        publicSource: "apollo_enrichment",
        sourceUrl: enrichResult.person.linkedinUrl,
        prestigeScore: candidate.prestigeScore,
        contactEmail: enrichResult.person.workEmail,
        inviteDraft: draft.body,
        status: enrichResult.person.verifiedWorkEmail ? "drafted" : "discovered",
      });
      persistedCount += 1;

      items.push({
        prospect,
        searchCandidate: candidate,
        enrichResult,
        draftSubject: draft.subject,
        draftBody: draft.body,
      });
    }

    const usage = await this.store.getApolloCreditUsage(this.clock.now());
    return {
      ok: search.ok,
      campaignId: campaign.id,
      city,
      dryRun: !live,
      searchedCount: search.candidates.length,
      qualifiedCount: qualified.length,
      enrichedCount,
      persistedCount,
      creditsSpent,
      items,
      usage,
    };
  }
}

export function createApolloEnrichmentAdapter(
  opts: ApolloAdapterOptions,
): ApolloEnrichmentAdapter {
  return new ApolloEnrichmentAdapter(opts);
}
