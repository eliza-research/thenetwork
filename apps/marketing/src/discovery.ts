import {
  evaluateComplianceGate,
} from "../../../packages/core/src/pacing/compliance.ts";
import {
  isDeployedEnvironment,
  resolveMockBaseUrl,
  resolveRuntimeEnvironment,
} from "./compliance-runtime.ts";
import {
  listCityPacks,
  requireCityPack,
  type CityPack,
  type OpenDataConnectorSpec,
} from "./city-registry.ts";
import {
  defaultDesireLaneForApp,
  inferDesireLanesFromText,
  type DesireLaneId,
} from "./desire-lanes.ts";
import type { BrandAppId, Clock, DiscoveredLead as BaseDiscoveredLead } from "./types.ts";

export type MarketingVertical = BrandAppId;
export type LeadCategory = "venue" | "event" | "creator" | "vip" | "community";
export type DiscoveryCity = string;
export type DiscoverySource =
  | "city_open_data"
  | "nyc_open_data"
  | "nys_sla"
  | "nys_sla_pending"
  | "hn"
  | "github"
  | "arxiv"
  | "reddit"
  | "youtube_rss"
  | "luma"
  | "eventbrite"
  | "partiful"
  | "sec_form_d"
  | "openalex"
  | "irs_990"
  | "clinical_trials";

export type DiscoveryClock = Clock;

export type ClockInput = DiscoveryClock | (() => number);

export type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface DiscoveredLead extends BaseDiscoveredLead {
  neighborhood?: string;
  source: DiscoverySource;
  summary: string;
  handleOrContact?: string;
  desireLane: DesireLaneId;
  desireLanes: DesireLaneId[];
  tags: string[];
  rawMeta?: Record<string, unknown>;
}

export interface DiscoverySourceError {
  source: DiscoverySource;
  url: string;
  message: string;
}

export interface DiscoveryRunResult {
  city: string;
  discoveredAt: string;
  leads: DiscoveredLead[];
  errors: DiscoverySourceError[];
  sourceCounts: Partial<Record<DiscoverySource, number>>;
}

export interface DiscoveryOptions {
  fetchImpl?: FetchLike;
  clock: ClockInput;
  city?: string;
  limitPerSource?: number;
  timeoutMs?: number;
  concurrency?: number;
  userAgent?: string;
  redditSubreddits?: readonly string[];
  youtubeChannelIds?: readonly string[];
  partifulUrls?: readonly string[];
  hnQuery?: string;
  githubQuery?: string;
  arxivQuery?: string;
  includeSources?: readonly DiscoverySource[];
  includeVipBdSources?: boolean;
  env?: Record<string, string | undefined>;
}

export const PUBLIC_DISCOVERY_ENDPOINTS = {
  nycDohmhVenues:
    "https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit=40&$where=grade='A'&$order=inspection_date%20DESC",
  nysSlaLicenses:
    "https://data.ny.gov/resource/9s3h-dpkz.json?$limit=40&$where=county_name_desc='NEW%20YORK'%20OR%20county_name_desc='KINGS'",
  nysSlaNamedPrincipals:
    "https://data.ny.gov/resource/hrvs-fxs2.json?$limit=40&$where=county_name_desc='NEW%20YORK'%20OR%20county_name_desc='KINGS'",
  hnAlgoliaBase: "https://hn.algolia.com/api/v1/search",
  githubUsersBase: "https://api.github.com/search/users",
  arxivApiBase: "https://export.arxiv.org/api/query",
  redditBase: "https://www.reddit.com",
  youtubeRssBase: "https://www.youtube.com/feeds/videos.xml",
  lumaNycUrl: "https://lu.ma/nyc",
  eventbriteNycUrl: "https://www.eventbrite.com/d/ny--new-york/events/",
  partifulBase: "https://partiful.com",
  secFormDSearchBase: "https://efts.sec.gov/LATEST/search-index",
  openAlexAuthorsBase: "https://api.openalex.org/authors",
  proPublicaNonprofitsBase: "https://projects.propublica.org/nonprofits/api/v2/search.json",
  clinicalTrialsBase: "https://clinicaltrials.gov/api/v2/studies",
} as const;

export const DEFAULT_NYC_SUBREDDITS: readonly string[] = [
  "nyc",
  "AskNYC",
  "nycmeetups",
  "startups",
];

const DEFAULT_USER_AGENT = "thenetwork-marketing-discovery/1.0 (open-web-tier1)";
const DEFAULT_FETCH_TIMEOUT_MS = 8_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_LIMIT_PER_SOURCE = 50;
const MAX_SUBREDDITS_OR_CHANNELS = 10;

export interface CityDiscoveryProfile {
  readonly code: string;
  readonly displayName: string;
  readonly stateCode: string | null;
  readonly countryCode: string;
  readonly opsEmail: string;
  readonly subreddits: readonly string[];
  readonly hnQuery: string;
  readonly githubLocation: string;
  readonly lumaUrl: string;
  readonly eventbriteUrl: string;
  readonly clinicalLocation: string;
  readonly openAlexQuery: string;
  readonly openDataConnectors: readonly OpenDataConnectorSpec[];
  readonly neighborhoods: ReadonlyArray<{ label: string; patterns: readonly (string | RegExp)[] }>;
}

function packToDiscoveryProfile(pack: CityPack): CityDiscoveryProfile {
  return {
    code: pack.code,
    displayName: pack.label,
    stateCode: pack.stateCode,
    countryCode: pack.country,
    opsEmail: pack.opsEmail,
    subreddits: pack.discovery.subreddits,
    hnQuery: pack.discovery.hnQuery,
    githubLocation: pack.discovery.githubLocationQuery,
    lumaUrl: pack.discovery.lumaUrl,
    eventbriteUrl: pack.discovery.eventbriteUrl,
    clinicalLocation: pack.discovery.clinicalLocation,
    openAlexQuery: pack.discovery.openAlexQuery,
    openDataConnectors: pack.discovery.openDataConnectors,
    neighborhoods: pack.neighborhoodPatterns.map((entry) => ({
      label: entry.label,
      patterns: entry.patterns,
    })),
  };
}

function buildProfilesRecord(): Record<string, CityDiscoveryProfile> {
  const out: Record<string, CityDiscoveryProfile> = {};
  for (const pack of listCityPacks()) {
    out[pack.code] = packToDiscoveryProfile(pack);
  }
  return out;
}

export const CITY_DISCOVERY_PROFILES: Record<string, CityDiscoveryProfile> = buildProfilesRecord();

function resolveCityProfile(city?: string): CityDiscoveryProfile {
  const pack = requireCityPack(city && city.trim().length > 0 ? city : "nyc");
  return packToDiscoveryProfile(pack);
}

function resolveDesireTagging(
  text: string,
  vertical: MarketingVertical,
  fallbackLanes?: readonly DesireLaneId[],
): { readonly desireLane: DesireLaneId; readonly desireLanes: DesireLaneId[] } {
  const inferred = inferDesireLanesFromText(text, defaultDesireLaneForApp(vertical));
  const merged = new Set<DesireLaneId>(inferred.desireLanes);
  if (fallbackLanes) {
    for (const lane of fallbackLanes) merged.add(lane);
  }
  const desireLanes = Array.from(merged);
  return {
    desireLane: inferred.primaryDesireLane,
    desireLanes,
  };
}

function clampLimit(limit: number | undefined, fallback: number): number {
  if (limit === undefined || !Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(MAX_LIMIT_PER_SOURCE, Math.round(limit)));
}

function clampTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return DEFAULT_FETCH_TIMEOUT_MS;
  }
  return Math.max(500, Math.min(30_000, Math.round(timeoutMs)));
}

function sanitizeHttpUrl(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return fallback;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return fallback;
    return u.toString();
  } catch {
    return fallback;
  }
}

export function readClockIso(clock: ClockInput): string {
  const ms = typeof clock === "function" ? clock() : clock.now();
  if (typeof ms !== "number" || !Number.isFinite(ms)) {
    throw new Error(`discovery clock must return a finite epoch ms, got ${String(ms)}`);
  }
  return new Date(ms).toISOString();
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function slugPart(input: string): string {
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function cleanText(input: unknown, maxLen = 280): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLen);
}

function safeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

export function detectNeighborhood(text: string, city = "nyc"): string | undefined {
  const hay = text.toLowerCase();
  const profile = resolveCityProfile(city);
  for (const entry of profile.neighborhoods) {
    if (
      entry.patterns.some((p) =>
        typeof p === "string"
          ? p.length <= 3
            ? new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(hay)
            : hay.includes(p.toLowerCase())
          : p.test(hay),
      )
    ) {
      return entry.label;
    }
  }
  return undefined;
}

export function detectNycNeighborhood(text: string): string | undefined {
  return detectNeighborhood(text, "nyc");
}

export function inferVerticalFromText(
  text: string,
  fallback: MarketingVertical = "ntwrk",
): MarketingVertical {
  const hay = text.toLowerCase();
  if (/(dating|single|hinge|bumble|tinder|matchmaker|romance|date night|cocktail bar|wine bar|speakeasy)/.test(hay)) {
    return "slop";
  }
  if (/(founder|startup|engineer|developer|ai agent|machine learning|researcher|arxiv|github|hiring|freelance|saas|vc|pitch|hackathon|builder)/.test(hay)) {
    return "peon";
  }
  if (/(friend|meetup|run club|running club|social club|supper club|community|book club|pickleball|trivia|new to |hangout)/.test(hay)) {
    return "friends";
  }
  return fallback;
}

function decodeXmlEntities(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function extractXmlTag(block: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, "i");
  const m = re.exec(block);
  return m ? decodeXmlEntities(m[1] ?? "") : "";
}

function extractXmlAttr(block: string, tag: string, attr: string): string {
  const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`<${escapedTag}[^>]*\\s${escapedAttr}=["']([^"']+)["'][^>]*>`, "i");
  const m = re.exec(block);
  return m ? decodeXmlEntities(m[1] ?? "") : "";
}

function splitXmlEntries(xml: string): string[] {
  const entries: string[] = [];
  const re = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(xml)) !== null) {
    entries.push(match[1] ?? "");
  }
  return entries;
}

async function readResponseTextBounded(res: Response, maxBytes = MAX_RESPONSE_BYTES): Promise<string> {
  if (!res.body) {
    const text = await res.text();
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let out = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        await reader.cancel().catch(() => undefined);
        break;
      }
      const slice = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      out += decoder.decode(slice, { stream: true });
      total += slice.byteLength;
    }
    out += decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Lock already released.
    }
  }
  return out;
}

async function fetchText(
  fetchImpl: FetchLike,
  url: string,
  userAgent: string,
  accept: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<string> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      "User-Agent": userAgent,
      Accept: accept,
    },
    signal: AbortSignal.timeout(clampTimeout(timeoutMs)),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return readResponseTextBounded(res);
}

async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  userAgent: string,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<T> {
  const text = await fetchText(
    fetchImpl,
    url,
    userAgent,
    "application/json, text/plain;q=0.9",
    timeoutMs,
  );
  return JSON.parse(text) as T;
}

class SourceFetchError extends Error {
  readonly url: string;
  constructor(url: string, message: string) {
    super(message);
    this.name = "SourceFetchError";
    this.url = url;
  }
}

async function mapSettledWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<Array<PromiseSettledResult<R>>> {
  const limit = Math.max(1, Math.min(12, Math.round(concurrency)));
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      try {
        const value = await worker(items[idx]);
        results[idx] = { status: "fulfilled", value };
      } catch (reason) {
        results[idx] = { status: "rejected", reason };
      }
    }
  });

  await Promise.all(runners);
  return results;
}

export function parseGenericOpenDataVenues(
  rows: readonly Record<string, unknown>[],
  connector: OpenDataConnectorSpec,
  discoveredAt: string,
  city: string,
): DiscoveredLead[] {
  const profile = resolveCityProfile(city);
  const out: DiscoveredLead[] = [];
  const fm = connector.fieldMap;
  const source: DiscoverySource =
    connector.id === "nyc-dohmh-venues"
      ? "nyc_open_data"
      : connector.id === "nys-sla-active"
        ? "nys_sla"
        : connector.id === "nys-sla-principals"
          ? "nys_sla_pending"
          : "city_open_data";

  for (const row of rows) {
    const primaryName = cleanText(row[fm.nameField], 120);
    const fallbackName = fm.fallbackNameField ? cleanText(row[fm.fallbackNameField], 120) : "";
    const name = primaryName || fallbackName;
    if (!name) continue;

    const address = cleanText(
      fm.addressFields.map((field) => safeString(row[field])).filter(Boolean).join(" "),
      160,
    );
    const category = fm.categoryField ? cleanText(row[fm.categoryField], 80) : "";
    const principal = fm.principalField ? cleanText(row[fm.principalField], 100) : "";
    const gradeOrStatus = fm.gradeOrStatusField ? cleanText(row[fm.gradeOrStatusField], 40) : "";
    const phone = fm.phoneField ? cleanText(row[fm.phoneField], 32) : "";
    const zip = fm.zipField ? cleanText(row[fm.zipField], 20) : "";
    const boro = fm.countyOrBoroField ? cleanText(row[fm.countyOrBoroField], 40) : "";
    const rawId = safeString(row[fm.idField]).trim();

    const combined = `${name} ${principal} ${address} ${category}`;
    const neighborhood = detectNeighborhood(combined, profile.code) ?? (boro || undefined);
    const isSocialVenue = /(bar|lounge|wine|cocktail|coffee|cafe|bakery|bistro|tapas|tavern|restaurant|club)/i.test(
      `${name} ${category}`,
    );
    const vertical = inferVerticalFromText(
      combined,
      connector.kind === "liquor_licenses" || connector.kind === "liquor_principals" || isSocialVenue
        ? "slop"
        : "friends",
    );
    const desires = resolveDesireTagging(combined, vertical, connector.defaultDesireLanes);
    const keyId = rawId
      ? `${connector.id}:${rawId}`
      : `${connector.id}:${slugPart(name)}:${slugPart(zip || address)}`;

    let score = connector.kind === "liquor_principals" ? 68 : 58;
    if (gradeOrStatus === "A" || /pass/i.test(gradeOrStatus)) score += 14;
    if (isSocialVenue) score += 12;
    if (principal) score += 12;
    if (neighborhood) score += 8;

    const contactHint = principal || phone || null;
    const baseUrl = connector.urlTemplate.split("?")[0] ?? connector.urlTemplate;
    const sourceUrl = rawId
      ? `${baseUrl}?${encodeURIComponent(fm.idField)}=${encodeURIComponent(rawId)}`
      : connector.urlTemplate.replace("{limit}", "25");

    out.push({
      dedupeKey: `${source}:${keyId}`,
      city: profile.code,
      neighborhood,
      vertical,
      category: "venue",
      source,
      title: principal ? `${name} (Principal: ${principal})` : name,
      summary: cleanText(
        `${category || `${profile.displayName} Licensed Venue`} — ${address}${gradeOrStatus ? ` (${gradeOrStatus})` : ""}`,
      ),
      sourceUrl,
      contactHint,
      handleOrContact: contactHint ?? undefined,
      score: clampScore(score),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: [
        connector.id,
        "open-data",
        "venue",
        profile.code,
        ...(category ? [slugPart(category)] : []),
      ],
      rawMeta: {
        connectorId: connector.id,
        recordId: rawId || undefined,
        principal: principal || undefined,
        gradeOrStatus: gradeOrStatus || undefined,
        zip: zip || undefined,
      },
    });
  }

  return out;
}

export async function fetchCityOpenDataVenues(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "concurrency" | "userAgent">,
): Promise<{ leads: DiscoveredLead[]; errors: DiscoverySourceError[] }> {
  const profile = resolveCityProfile(opts.city);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = clampLimit(opts.limitPerSource, 25);
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;
  const leads: DiscoveredLead[] = [];
  const errors: DiscoverySourceError[] = [];

  if (profile.openDataConnectors.length === 0) {
    return { leads, errors };
  }

  const settled = await mapSettledWithConcurrency(
    profile.openDataConnectors,
    opts.concurrency ?? DEFAULT_CONCURRENCY,
    async (connector) => {
      const url = connector.urlTemplate.replace("{limit}", String(limit));
      try {
        const rows = await fetchJson<Array<Record<string, unknown>>>(fetchImpl, url, ua, opts.timeoutMs);
        return parseGenericOpenDataVenues(
          Array.isArray(rows) ? rows : [],
          connector,
          discoveredAt,
          profile.code,
        );
      } catch (err) {
        throw new SourceFetchError(url, err instanceof Error ? err.message : String(err));
      }
    },
  );

  for (let i = 0; i < settled.length; i += 1) {
    const r = settled[i];
    const connector = profile.openDataConnectors[i];
    if (r.status === "fulfilled") {
      leads.push(...r.value);
    } else {
      const reason: unknown = r.reason;
      const source: DiscoverySource =
        connector.id === "nyc-dohmh-venues"
          ? "nyc_open_data"
          : connector.id === "nys-sla-active"
            ? "nys_sla"
            : connector.id === "nys-sla-principals"
              ? "nys_sla_pending"
              : "city_open_data";
      errors.push({
        source,
        url: reason instanceof SourceFetchError ? reason.url : connector.urlTemplate,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }

  return { leads, errors };
}

export interface DohmhVenueRow {
  camis?: string;
  dba?: string;
  boro?: string;
  building?: string;
  street?: string;
  zipcode?: string;
  cuisine_description?: string;
  grade?: string;
  phone?: string;
}

export function parseNycOpenDataVenues(
  rows: readonly DohmhVenueRow[],
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  for (const row of rows) {
    const name = cleanText(row.dba, 120);
    if (!name) continue;
    const address = cleanText(
      [row.building, row.street, row.boro, row.zipcode].filter(Boolean).join(" "),
      160,
    );
    const cuisine = cleanText(row.cuisine_description, 80);
    const combined = `${name} ${address} ${cuisine}`;
    const neighborhood =
      detectNeighborhood(combined, city) ?? (row.boro ? cleanText(row.boro, 40) : undefined);
    const isSocialVenue = /(bar|lounge|wine|cocktail|coffee|cafe|bakery|bistro|tapas|italian|mexican|japanese)/i.test(
      `${name} ${cuisine}`,
    );
    const vertical = inferVerticalFromText(combined, isSocialVenue ? "slop" : "friends");
    const desires = resolveDesireTagging(combined, vertical, ["soulmate_dating", "ideal_friends"]);
    const keyId = row.camis ? `camis:${row.camis}` : `dba:${slugPart(name)}:${slugPart(row.zipcode ?? "")}`;
    let score = 55;
    if (row.grade === "A") score += 15;
    if (isSocialVenue) score += 15;
    if (neighborhood && neighborhood !== "Manhattan" && neighborhood !== "Brooklyn") score += 10;

    const contactHint = row.phone ? cleanText(row.phone, 32) : null;
    out.push({
      dedupeKey: `nyc_open_data:${keyId}`,
      city,
      neighborhood,
      vertical,
      category: "venue",
      source: "nyc_open_data",
      title: name,
      summary: cleanText(`${cuisine || "NYC Venue"} — ${address}${row.grade ? ` (Grade ${row.grade})` : ""}`),
      sourceUrl: row.camis
        ? `https://data.cityofnewyork.us/resource/43nn-pn8j.json?camis=${encodeURIComponent(row.camis)}`
        : PUBLIC_DISCOVERY_ENDPOINTS.nycDohmhVenues,
      contactHint,
      handleOrContact: contactHint ?? undefined,
      score: clampScore(score),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["nyc-open-data", "venue", ...(cuisine ? [slugPart(cuisine)] : []), ...(row.grade ? [`grade-${row.grade.toLowerCase()}`] : [])],
      rawMeta: { camis: row.camis, boro: row.boro, zipcode: row.zipcode, grade: row.grade },
    });
  }
  return out;
}

export interface NysSlaRow {
  license_serial_number?: string;
  dba_name?: string;
  premises_name?: string;
  actual_address_of_premises_address1?: string;
  city?: string;
  county_name_desc?: string;
  zip?: string;
  license_type_code?: string;
  method_of_operation?: string;
  principal_name?: string;
  license_status?: string;
  filing_date?: string;
}

export function parseNysSlaVenues(
  rows: readonly NysSlaRow[],
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  for (const row of rows) {
    const name = cleanText(row.dba_name || row.premises_name, 120);
    if (!name) continue;
    const addr = cleanText(
      [row.actual_address_of_premises_address1, row.city, row.zip].filter(Boolean).join(" "),
      160,
    );
    const method = cleanText(row.method_of_operation || row.license_type_code, 80);
    const combined = `${name} ${addr} ${method}`;
    const neighborhood = detectNeighborhood(combined, city);
    const isOnPremises = /(op|bar|tavern|lounge|restaurant|club|wine)/i.test(method);
    const vertical = inferVerticalFromText(combined, isOnPremises ? "slop" : "ntwrk");
    const desires = resolveDesireTagging(combined, vertical, ["soulmate_dating", "bespoke_irl_experience"]);
    const key = row.license_serial_number
      ? `sla:${row.license_serial_number}`
      : `sla:${slugPart(name)}:${slugPart(row.zip ?? "")}`;

    out.push({
      dedupeKey: `nys_sla:${key}`,
      city,
      neighborhood,
      vertical,
      category: "venue",
      source: "nys_sla",
      title: name,
      summary: cleanText(`NYS SLA Licensed Venue (${method || "On-Premises"}) — ${addr}`),
      sourceUrl: row.license_serial_number
        ? `https://data.ny.gov/resource/9s3h-dpkz.json?license_serial_number=${encodeURIComponent(row.license_serial_number)}`
        : PUBLIC_DISCOVERY_ENDPOINTS.nysSlaLicenses,
      contactHint: null,
      score: clampScore(60 + (isOnPremises ? 20 : 0) + (neighborhood ? 10 : 0)),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["nys-sla", "bar-venue", ...(row.license_type_code ? [slugPart(row.license_type_code)] : [])],
      rawMeta: { serial: row.license_serial_number, county: row.county_name_desc, zip: row.zip },
    });
  }
  return out;
}

export function parseNysSlaNamedPrincipals(
  rows: readonly NysSlaRow[],
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  for (const row of rows) {
    const name = cleanText(row.dba_name || row.premises_name, 120);
    if (!name) continue;
    const principal = cleanText(row.principal_name, 100);
    const addr = cleanText(
      [row.actual_address_of_premises_address1, row.city, row.zip].filter(Boolean).join(" "),
      160,
    );
    const status = cleanText(row.license_status, 40) || "Pending";
    const method = cleanText(row.method_of_operation || row.license_type_code, 80);
    const combined = `${name} ${principal} ${addr} ${method}`;
    const neighborhood = detectNeighborhood(combined, city);
    const vertical = inferVerticalFromText(combined, "slop");
    const desires = resolveDesireTagging(combined, vertical, ["soulmate_dating", "bespoke_irl_experience"]);
    const key = row.license_serial_number
      ? `sla_principal:${row.license_serial_number}`
      : `sla_principal:${slugPart(name)}:${slugPart(principal)}`;

    out.push({
      dedupeKey: `nys_sla_pending:${key}`,
      city,
      neighborhood,
      vertical,
      category: "venue",
      source: "nys_sla_pending",
      title: principal ? `${name} (Principal: ${principal})` : name,
      summary: cleanText(`NYS SLA ${status} Venue (${method || "On-Premises"}) — ${addr}`),
      sourceUrl: row.license_serial_number
        ? `https://data.ny.gov/resource/hrvs-fxs2.json?license_serial_number=${encodeURIComponent(row.license_serial_number)}`
        : PUBLIC_DISCOVERY_ENDPOINTS.nysSlaNamedPrincipals,
      contactHint: principal || null,
      handleOrContact: principal || undefined,
      score: clampScore(68 + (principal ? 14 : 0) + (neighborhood ? 10 : 0)),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["nys-sla", "named-principal", "bd-venue", slugPart(status) || "pending"],
      rawMeta: {
        serial: row.license_serial_number,
        principal,
        status,
        filingDate: row.filing_date,
        county: row.county_name_desc,
      },
    });
  }
  return out;
}

export async function fetchNycOpenDataVenues(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const city = (opts.city ?? "nyc").trim().toLowerCase();
  if (city !== "nyc") return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = clampLimit(opts.limitPerSource, 25);
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;
  const url = `https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit=${limit}&$where=grade='A'&$order=inspection_date%20DESC`;
  const rows = await fetchJson<DohmhVenueRow[]>(fetchImpl, url, ua, opts.timeoutMs);
  return parseNycOpenDataVenues(Array.isArray(rows) ? rows : [], discoveredAt, city);
}

export async function fetchNysSlaVenues(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const city = (opts.city ?? "nyc").trim().toLowerCase();
  if (city !== "nyc") return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = clampLimit(opts.limitPerSource, 25);
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;
  const url = `https://data.ny.gov/resource/9s3h-dpkz.json?$limit=${limit}&$where=county_name_desc='NEW%20YORK'%20OR%20county_name_desc='KINGS'`;
  const rows = await fetchJson<NysSlaRow[]>(fetchImpl, url, ua, opts.timeoutMs);
  return parseNysSlaVenues(Array.isArray(rows) ? rows : [], discoveredAt, city);
}

export async function fetchNysSlaNamedPrincipals(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const city = (opts.city ?? "nyc").trim().toLowerCase();
  if (city !== "nyc") return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = clampLimit(opts.limitPerSource, 25);
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;
  const url = `https://data.ny.gov/resource/hrvs-fxs2.json?$limit=${limit}&$where=county_name_desc='NEW%20YORK'%20OR%20county_name_desc='KINGS'`;
  const rows = await fetchJson<NysSlaRow[]>(fetchImpl, url, ua, opts.timeoutMs);
  return parseNysSlaNamedPrincipals(Array.isArray(rows) ? rows : [], discoveredAt, city);
}

export interface HnSearchResponse {
  hits?: Array<{
    objectID?: string;
    title?: string;
    url?: string;
    author?: string;
    points?: number;
    num_comments?: number;
    story_text?: string;
  }>;
}

export function parseHnStories(
  payload: HnSearchResponse,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  const profile = resolveCityProfile(city);
  const cityToken = profile.displayName.toLowerCase();
  for (const hit of payload.hits ?? []) {
    const title = cleanText(hit.title, 180);
    if (!title) continue;
    const id = hit.objectID ?? slugPart(title);
    const points = typeof hit.points === "number" ? hit.points : 0;
    const comments = typeof hit.num_comments === "number" ? hit.num_comments : 0;
    const combined = `${title} ${cleanText(hit.story_text, 200)}`;
    const isLocal =
      combined.toLowerCase().includes(cityToken) ||
      combined.toLowerCase().includes(profile.code) ||
      detectNeighborhood(combined, profile.code) !== undefined;
    const vertical = inferVerticalFromText(combined, "peon");
    const desires = resolveDesireTagging(combined, vertical, ["cofounder_venture", "money_work"]);
    const score =
      45 +
      Math.min(30, Math.floor(points / 5)) +
      Math.min(15, Math.floor(comments / 5)) +
      (isLocal ? 10 : 0);

    const hnContact = hit.author ? `hn:${hit.author}` : null;
    out.push({
      dedupeKey: `hn:${id}`,
      city: profile.code,
      neighborhood: detectNeighborhood(combined, profile.code),
      vertical,
      category: "vip",
      source: "hn",
      title,
      summary: cleanText(`HN story by ${hit.author ?? "unknown"} (${points} pts, ${comments} comments)`),
      sourceUrl: sanitizeHttpUrl(
        hit.url,
        `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`,
      ),
      contactHint: hnContact,
      handleOrContact: hnContact ?? undefined,
      score: clampScore(score),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["hacker-news", "builder", ...(isLocal ? [profile.code] : [])],
      rawMeta: { objectID: hit.objectID, author: hit.author, points, numComments: comments },
    });
  }
  return out;
}

export async function fetchHnBuilders(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "userAgent" | "hnQuery">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const profile = resolveCityProfile(opts.city);
  const limit = clampLimit(opts.limitPerSource, 20);
  const query = opts.hnQuery ?? profile.hnQuery;
  const url = `${PUBLIC_DISCOVERY_ENDPOINTS.hnAlgoliaBase}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
  const data = await fetchJson<HnSearchResponse>(
    fetchImpl,
    url,
    opts.userAgent ?? DEFAULT_USER_AGENT,
    opts.timeoutMs,
  );
  return parseHnStories(data, discoveredAt, profile.code);
}

export interface GithubUserSearchResponse {
  items?: Array<{
    id?: number;
    login?: string;
    html_url?: string;
    type?: string;
    score?: number;
    bio?: string;
    location?: string;
  }>;
}

export function parseGithubUsers(
  payload: GithubUserSearchResponse,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  const profile = resolveCityProfile(city);
  for (const item of payload.items ?? []) {
    const login = cleanText(item.login, 80);
    if (!login) continue;
    const combined = `${login} ${cleanText(item.bio, 180)} ${cleanText(item.location, 80)}`;
    const desires = resolveDesireTagging(combined, "peon", ["money_work", "cofounder_venture"]);
    out.push({
      dedupeKey: `github:${login.toLowerCase()}`,
      city: profile.code,
      neighborhood: detectNeighborhood(combined, profile.code),
      vertical: "peon",
      category: "vip",
      source: "github",
      title: `GitHub Builder @${login}`,
      summary: cleanText(
        item.bio || `Public ${profile.displayName} developer profile on GitHub (${item.location ?? profile.displayName})`,
      ),
      sourceUrl: sanitizeHttpUrl(
        item.html_url,
        `https://github.com/${encodeURIComponent(login)}`,
      ),
      contactHint: `github:${login}`,
      handleOrContact: `github:${login}`,
      score: clampScore(65 + Math.min(25, Math.round((item.score ?? 1) * 10))),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["github", "builder", profile.code],
      rawMeta: { id: item.id, login, type: item.type, location: item.location },
    });
  }
  return out;
}

export async function fetchGithubNycBuilders(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "userAgent" | "githubQuery">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const profile = resolveCityProfile(opts.city);
  const limit = clampLimit(opts.limitPerSource, 20);
  const q = opts.githubQuery ?? `location:${profile.githubLocation} followers:>25`;
  const url = `${PUBLIC_DISCOVERY_ENDPOINTS.githubUsersBase}?q=${encodeURIComponent(q)}&per_page=${limit}`;
  const data = await fetchJson<GithubUserSearchResponse>(
    fetchImpl,
    url,
    opts.userAgent ?? DEFAULT_USER_AGENT,
    opts.timeoutMs,
  );
  return parseGithubUsers(data, discoveredAt, profile.code);
}

export function parseArxivAtom(
  xml: string,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const profile = resolveCityProfile(city);
  const out: DiscoveredLead[] = [];
  for (const entry of splitXmlEntries(xml)) {
    const idUrl = extractXmlTag(entry, "id");
    const title = cleanText(extractXmlTag(entry, "title"), 180);
    if (!title) continue;
    const summary = cleanText(extractXmlTag(entry, "summary"), 240);
    const authorMatch = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i.exec(entry);
    const primaryAuthor = authorMatch ? decodeXmlEntities(authorMatch[1] ?? "") : undefined;
    const paperKey = slugPart(idUrl || title);
    const isAgentPaper = /(agent|social|matching|graph|llm|multi-agent|autonomous)/i.test(`${title} ${summary}`);
    const desires = resolveDesireTagging(`${title} ${summary}`, "peon", ["cofounder_venture", "mentorship_mastery"]);

    const arxivContact = primaryAuthor ? `arxiv:${primaryAuthor}` : null;
    out.push({
      dedupeKey: `arxiv:${paperKey}`,
      city: profile.code,
      vertical: "peon",
      category: "vip",
      source: "arxiv",
      title,
      summary: summary || `arXiv research paper by ${primaryAuthor ?? "researcher"}`,
      sourceUrl: sanitizeHttpUrl(idUrl, PUBLIC_DISCOVERY_ENDPOINTS.arxivApiBase),
      contactHint: arxivContact,
      handleOrContact: arxivContact ?? undefined,
      score: clampScore(58 + (isAgentPaper ? 22 : 0) + (primaryAuthor ? 5 : 0)),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["arxiv", "researcher", ...(isAgentPaper ? ["ai-agents"] : [])],
      rawMeta: { primaryAuthor, idUrl },
    });
  }
  return out;
}

export async function fetchArxivResearchers(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "userAgent" | "arxivQuery">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const profile = resolveCityProfile(opts.city);
  const limit = clampLimit(opts.limitPerSource, 15);
  const q = opts.arxivQuery ?? "all:autonomous agents OR all:social matching";
  const url = `${PUBLIC_DISCOVERY_ENDPOINTS.arxivApiBase}?search_query=${encodeURIComponent(q)}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
  const xml = await fetchText(
    fetchImpl,
    url,
    opts.userAgent ?? DEFAULT_USER_AGENT,
    "application/atom+xml, text/xml",
    opts.timeoutMs,
  );
  return parseArxivAtom(xml, discoveredAt, profile.code);
}

export interface RedditListingResponse {
  data?: {
    children?: Array<{
      data?: {
        id?: string;
        subreddit?: string;
        title?: string;
        selftext?: string;
        permalink?: string;
        url?: string;
        author?: string;
        score?: number;
        num_comments?: number;
      };
    }>;
  };
}

export function parseRedditFeed(
  payload: RedditListingResponse,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  const profile = resolveCityProfile(city);
  for (const child of payload.data?.children ?? []) {
    const post = child.data;
    if (!post?.title) continue;
    const title = cleanText(post.title, 180);
    const body = cleanText(post.selftext, 200);
    const sub = cleanText(post.subreddit, 40) || profile.code;
    const combined = `${sub} ${title} ${body}`;
    const postScore = typeof post.score === "number" ? post.score : 0;
    const comments = typeof post.num_comments === "number" ? post.num_comments : 0;
    const subFallback: MarketingVertical = /dating/i.test(sub)
      ? "slop"
      : /startup|founder|tech/i.test(sub)
        ? "peon"
        : /meetup|friend|social/i.test(sub)
          ? "friends"
          : "ntwrk";
    const vertical = inferVerticalFromText(combined, subFallback);
    const desires = resolveDesireTagging(combined, vertical);

    const fallbackUrl = `https://www.reddit.com/r/${encodeURIComponent(sub)}`;
    const permalink = post.permalink
      ? sanitizeHttpUrl(`https://www.reddit.com${post.permalink}`, fallbackUrl)
      : sanitizeHttpUrl(post.url, fallbackUrl);

    const redditContact = post.author && post.author !== "[deleted]" ? `u/${post.author}` : null;
    out.push({
      dedupeKey: `reddit:${post.id ?? slugPart(`${sub}-${title}`)}`,
      city: profile.code,
      neighborhood: detectNeighborhood(combined, profile.code),
      vertical,
      category: /meetup|event|mixer|party/i.test(combined) ? "event" : "community",
      source: "reddit",
      title,
      summary: body || `r/${sub} discussion (${postScore} upvotes, ${comments} comments)`,
      sourceUrl: permalink,
      contactHint: redditContact,
      handleOrContact: redditContact ?? undefined,
      score: clampScore(50 + Math.min(25, Math.floor(postScore / 4)) + Math.min(15, Math.floor(comments / 3))),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["reddit", `r-${slugPart(sub)}`, profile.code],
      rawMeta: { id: post.id, subreddit: sub, author: post.author, score: postScore, comments },
    });
  }
  return out;
}

export async function fetchRedditNycFeeds(
  opts: Pick<
    DiscoveryOptions,
    "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "concurrency" | "userAgent" | "redditSubreddits"
  >,
): Promise<{ leads: DiscoveredLead[]; errors: DiscoverySourceError[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const profile = resolveCityProfile(opts.city);
  const limit = clampLimit(opts.limitPerSource, 15);
  const subs = (opts.redditSubreddits ?? profile.subreddits)
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_]{2,32}$/.test(s))
    .slice(0, MAX_SUBREDDITS_OR_CHANNELS);
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;

  const leads: DiscoveredLead[] = [];
  const errors: DiscoverySourceError[] = [];

  const settled = await mapSettledWithConcurrency(
    subs,
    opts.concurrency ?? DEFAULT_CONCURRENCY,
    async (sub) => {
      const url = `${PUBLIC_DISCOVERY_ENDPOINTS.redditBase}/r/${encodeURIComponent(sub)}/new.json?limit=${limit}`;
      try {
        const json = await fetchJson<RedditListingResponse>(fetchImpl, url, ua, opts.timeoutMs);
        return { url, items: parseRedditFeed(json, discoveredAt, profile.code) };
      } catch (err) {
        throw new SourceFetchError(url, err instanceof Error ? err.message : String(err));
      }
    },
  );

  for (const r of settled) {
    if (r.status === "fulfilled") {
      leads.push(...r.value.items);
    } else {
      const reason: unknown = r.reason;
      errors.push({
        source: "reddit",
        url: reason instanceof SourceFetchError ? reason.url : PUBLIC_DISCOVERY_ENDPOINTS.redditBase,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }
  return { leads, errors };
}

export function parseYoutubeRss(
  xml: string,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const profile = resolveCityProfile(city);
  const channelTitle = cleanText(extractXmlTag(xml, "title"), 100);
  const channelIdFromFeed = extractXmlTag(xml, "yt:channelId");
  const out: DiscoveredLead[] = [];

  for (const entry of splitXmlEntries(xml)) {
    const videoId = extractXmlTag(entry, "yt:videoId");
    const channelId = extractXmlTag(entry, "yt:channelId") || channelIdFromFeed;
    const title = cleanText(extractXmlTag(entry, "title"), 180);
    if (!title) continue;

    const authorName = cleanText(
      /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/i.exec(entry)?.[1] ?? channelTitle,
      100,
    );
    const link = sanitizeHttpUrl(
      extractXmlAttr(entry, "link", "href"),
      videoId
        ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
        : PUBLIC_DISCOVERY_ENDPOINTS.youtubeRssBase,
    );
    const description = cleanText(extractXmlTag(entry, "media:description"), 220);
    const viewsRaw = extractXmlAttr(entry, "media:statistics", "views");
    const views = viewsRaw ? Number.parseInt(viewsRaw, 10) : 0;
    const combined = `${authorName} ${title} ${description}`;
    const isStreetInterview = /(street interview|vox pop|dating in|ask |sidetalk|on the street)/i.test(
      combined,
    );
    const vertical = inferVerticalFromText(combined, "slop");
    const desires = resolveDesireTagging(combined, vertical, ["creative_collab"]);
    const score = 60 + (isStreetInterview ? 25 : 0) + (views >= 5000 && views <= 150000 ? 15 : views > 0 ? 5 : 0);

    const ytContact = channelId ? `yt_channel:${channelId}` : (authorName || null);
    out.push({
      dedupeKey: `youtube_rss:${videoId || slugPart(`${channelId}-${title}`)}`,
      city: profile.code,
      neighborhood: detectNeighborhood(combined, profile.code),
      vertical,
      category: "creator",
      source: "youtube_rss",
      title: authorName ? `${authorName}: ${title}` : title,
      summary: description || `Creator video on YouTube${views > 0 ? ` (${views} views)` : ""}`,
      sourceUrl: link,
      contactHint: ytContact,
      handleOrContact: ytContact ?? undefined,
      score: clampScore(score),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["youtube-rss", "creator", ...(isStreetInterview ? ["street-interview"] : [])],
      rawMeta: { videoId, channelId, authorName, views },
    });
  }
  return out;
}

export async function fetchYoutubeChannelRss(
  channelIds: readonly string[],
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "timeoutMs" | "concurrency" | "userAgent">,
): Promise<{ leads: DiscoveredLead[]; errors: DiscoverySourceError[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const profile = resolveCityProfile(opts.city);
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;
  const validIds = channelIds
    .map((id) => id.trim())
    .filter((id) => /^[A-Za-z0-9_-]{4,64}$/.test(id))
    .slice(0, MAX_SUBREDDITS_OR_CHANNELS);

  const leads: DiscoveredLead[] = [];
  const errors: DiscoverySourceError[] = [];

  const settled = await mapSettledWithConcurrency(
    validIds,
    opts.concurrency ?? DEFAULT_CONCURRENCY,
    async (channelId) => {
      const url = `${PUBLIC_DISCOVERY_ENDPOINTS.youtubeRssBase}?channel_id=${encodeURIComponent(channelId)}`;
      try {
        const xml = await fetchText(
          fetchImpl,
          url,
          ua,
          "application/atom+xml, application/xml, text/xml",
          opts.timeoutMs,
        );
        return { url, items: parseYoutubeRss(xml, discoveredAt, profile.code) };
      } catch (err) {
        throw new SourceFetchError(url, err instanceof Error ? err.message : String(err));
      }
    },
  );

  for (const r of settled) {
    if (r.status === "fulfilled") {
      leads.push(...r.value.items);
    } else {
      const reason: unknown = r.reason;
      errors.push({
        source: "youtube_rss",
        url: reason instanceof SourceFetchError ? reason.url : PUBLIC_DISCOVERY_ENDPOINTS.youtubeRssBase,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }
  return { leads, errors };
}

function extractJsonLdEvents(html: string): Array<Record<string, unknown>> {
  const results: Array<Record<string, unknown>> = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const raw = (match[1] ?? "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const queue: unknown[] = Array.isArray(parsed) ? (parsed as unknown[]).slice() : [parsed];
      while (queue.length > 0) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        const obj = node as Record<string, unknown>;
        const graph = obj["@graph"];
        if (Array.isArray(graph)) {
          for (const g of graph as unknown[]) {
            queue.push(g);
          }
        }
        const itemList = obj.itemListElement;
        if (Array.isArray(itemList)) {
          for (const el of itemList as unknown[]) {
            if (el && typeof el === "object") {
              const rec = el as Record<string, unknown>;
              const item: unknown = rec.item ?? el;
              queue.push(item);
            }
          }
        }
        const typeVal = safeString(obj["@type"]);
        if (/Event$/i.test(typeVal) && typeof obj.name === "string") {
          results.push(obj);
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks on public pages.
    }
  }
  return results;
}

export function parseLumaEvents(
  body: string,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  const profile = resolveCityProfile(city);

  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as
        | { entries?: Array<Record<string, unknown>>; events?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>;
      const items = Array.isArray(parsed)
        ? parsed
        : (parsed.entries ?? parsed.events ?? []);
      for (const item of items) {
        const ev = (item.event && typeof item.event === "object"
          ? item.event
          : item) as Record<string, unknown>;
        const title = cleanText(ev.name ?? ev.title, 160);
        if (!title) continue;
        const slug = cleanText(ev.url ?? ev.slug ?? ev.api_id, 120);
        const sourceUrl = /^https?:\/\//i.test(slug)
          ? sanitizeHttpUrl(slug, profile.lumaUrl)
          : slug
            ? `https://lu.ma/${encodeURIComponent(slug.replace(/^\//, ""))}`
            : profile.lumaUrl;
        const geo = cleanText(
          typeof ev.geo_address_info === "object" && ev.geo_address_info
            ? (ev.geo_address_info as Record<string, unknown>).full_address ??
              (ev.geo_address_info as Record<string, unknown>).city_state
            : ev.location,
          160,
        );
        const combined = `${title} ${geo} ${cleanText(ev.description, 160)}`;
        const host = cleanText(
          Array.isArray(item.hosts) && item.hosts[0] && typeof item.hosts[0] === "object"
            ? (item.hosts[0] as Record<string, unknown>).name
            : ev.host,
          80,
        );
        const neighborhood = detectNeighborhood(combined, profile.code);
        const vertical = inferVerticalFromText(combined, "ntwrk");
        const desires = resolveDesireTagging(combined, vertical, ["bespoke_irl_experience"]);
        const startAtStr = safeString(ev.start_at);

        const lumaContact = host || null;
        out.push({
          dedupeKey: `luma:${slugPart(slug || title)}`,
          city: profile.code,
          neighborhood,
          vertical,
          category: "event",
          source: "luma",
          title,
          summary: cleanText(`${geo || `${profile.displayName} Luma Event`}${startAtStr ? ` @ ${startAtStr}` : ""}`),
          sourceUrl,
          contactHint: lumaContact,
          handleOrContact: lumaContact ?? undefined,
          score: clampScore(72 + (neighborhood ? 12 : 0) + (host ? 6 : 0)),
          discoveredAt,
          desireLane: desires.desireLane,
          desireLanes: desires.desireLanes,
          tags: ["luma", "event", profile.code],
          rawMeta: { startAt: ev.start_at, host, location: geo },
        });
      }
      return out;
    } catch {
      // Fall through to HTML parsing.
    }
  }

  for (const ev of extractJsonLdEvents(body)) {
    const title = cleanText(ev.name, 160);
    if (!title) continue;
    const url = sanitizeHttpUrl(ev.url, profile.lumaUrl);
    const locObj = ev.location && typeof ev.location === "object"
      ? (ev.location as Record<string, unknown>)
      : undefined;
    const locText = cleanText(
      locObj?.name ??
        (typeof locObj?.address === "object" && locObj.address
          ? (locObj.address as Record<string, unknown>).streetAddress
          : locObj?.address),
      140,
    );
    const combined = `${title} ${locText} ${cleanText(ev.description, 160)}`;
    const neighborhood = detectNeighborhood(combined, profile.code);
    const vertical = inferVerticalFromText(combined, "ntwrk");
    const desires = resolveDesireTagging(combined, vertical, ["bespoke_irl_experience"]);
    const startDateStr = safeString(ev.startDate);

    out.push({
      dedupeKey: `luma:${slugPart(url !== profile.lumaUrl ? url : title)}`,
      city: profile.code,
      neighborhood,
      vertical,
      category: "event",
      source: "luma",
      title,
      summary: cleanText(`${locText || `${profile.displayName} Luma Event`}${startDateStr ? ` (${startDateStr})` : ""}`),
      sourceUrl: url,
      contactHint: null,
      score: clampScore(70 + (neighborhood ? 12 : 0)),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["luma", "event", profile.code],
      rawMeta: { startDate: ev.startDate, location: locText },
    });
  }
  return out;
}

export function parseEventbriteEvents(
  body: string,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  const profile = resolveCityProfile(city);

  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as
        | { events?: Array<Record<string, unknown>> }
        | Array<Record<string, unknown>>;
      const items = Array.isArray(parsed) ? parsed : (parsed.events ?? []);
      for (const ev of items) {
        const title = cleanText(
          typeof ev.name === "object" && ev.name
            ? (ev.name as Record<string, unknown>).text
            : ev.name ?? ev.title,
          160,
        );
        if (!title) continue;
        const url = sanitizeHttpUrl(ev.url, profile.eventbriteUrl);
        const venue = cleanText(ev.venue ?? ev.location, 140);
        const combined = `${title} ${venue} ${cleanText(ev.summary, 160)}`;
        const neighborhood = detectNeighborhood(combined, profile.code);
        const vertical = inferVerticalFromText(combined, "friends");
        const desires = resolveDesireTagging(combined, vertical, ["ideal_friends", "bespoke_irl_experience"]);
        const idStr = safeString(ev.id) || url || title;
        const startStr = safeString(ev.start);
        out.push({
          dedupeKey: `eventbrite:${slugPart(idStr)}`,
          city: profile.code,
          neighborhood,
          vertical,
          category: "event",
          source: "eventbrite",
          title,
          summary: cleanText(`${venue || `${profile.displayName} Eventbrite Event`}${startStr ? ` (${startStr})` : ""}`),
          sourceUrl: url,
          contactHint: null,
          score: clampScore(68 + (neighborhood ? 12 : 0)),
          discoveredAt,
          desireLane: desires.desireLane,
          desireLanes: desires.desireLanes,
          tags: ["eventbrite", "event", profile.code],
          rawMeta: { id: ev.id, start: ev.start, venue },
        });
      }
      return out;
    } catch {
      // Fall through to HTML JSON-LD parser.
    }
  }

  for (const ev of extractJsonLdEvents(body)) {
    const title = cleanText(ev.name, 160);
    if (!title) continue;
    const url = sanitizeHttpUrl(ev.url, profile.eventbriteUrl);
    const locObj = ev.location && typeof ev.location === "object"
      ? (ev.location as Record<string, unknown>)
      : undefined;
    const locText = cleanText(locObj?.name, 140);
    const combined = `${title} ${locText} ${cleanText(ev.description, 160)}`;
    const neighborhood = detectNeighborhood(combined, profile.code);
    const vertical = inferVerticalFromText(combined, "friends");
    const desires = resolveDesireTagging(combined, vertical, ["ideal_friends", "bespoke_irl_experience"]);
    const startDateStr = safeString(ev.startDate);
    out.push({
      dedupeKey: `eventbrite:${slugPart(url !== profile.eventbriteUrl ? url : title)}`,
      city: profile.code,
      neighborhood,
      vertical,
      category: "event",
      source: "eventbrite",
      title,
      summary: cleanText(`${locText || `${profile.displayName} Eventbrite Event`}${startDateStr ? ` (${startDateStr})` : ""}`),
      sourceUrl: url,
      contactHint: null,
      score: clampScore(66 + (neighborhood ? 12 : 0)),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["eventbrite", "event", profile.code],
      rawMeta: { startDate: ev.startDate, location: locText },
    });
  }
  return out;
}

export function normalizePartifulUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    const host = parsed.hostname.toLowerCase();
    if (host !== "partiful.com" && host !== "www.partiful.com") return null;
    const match = /^\/e\/([A-Za-z0-9_-]{4,64})\/?$/.exec(parsed.pathname);
    if (!match) return null;
    return `https://partiful.com/e/${match[1]}`;
  } catch {
    return null;
  }
}

export function parsePartifulEvents(
  body: string,
  sourceUrl: string,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const normalizedUrl = normalizePartifulUrl(sourceUrl) ?? PUBLIC_DISCOVERY_ENDPOINTS.partifulBase;
  const profile = resolveCityProfile(city);
  const out: DiscoveredLead[] = [];

  for (const ev of extractJsonLdEvents(body)) {
    const title = cleanText(ev.name, 160);
    if (!title) continue;
    const locObj =
      ev.location && typeof ev.location === "object"
        ? (ev.location as Record<string, unknown>)
        : undefined;
    const locText = cleanText(locObj?.name, 140);
    const organizerObj =
      ev.organizer && typeof ev.organizer === "object"
        ? (ev.organizer as Record<string, unknown>)
        : undefined;
    const host = cleanText(organizerObj?.name, 80) || null;
    const combined = `${title} ${locText} ${cleanText(ev.description, 160)}`;
    const neighborhood = detectNeighborhood(combined, profile.code);
    const vertical = inferVerticalFromText(combined, "friends");
    const desires = resolveDesireTagging(combined, vertical, ["ideal_friends", "bespoke_irl_experience"]);
    out.push({
      dedupeKey: `partiful:${slugPart(normalizedUrl)}`,
      city: profile.code,
      neighborhood,
      vertical,
      category: "event",
      source: "partiful",
      title,
      summary: cleanText(`${locText || `${profile.displayName} Partiful Event`}${host ? ` hosted by ${host}` : ""}`),
      sourceUrl: normalizedUrl,
      contactHint: host,
      handleOrContact: host ?? undefined,
      score: clampScore(74 + (neighborhood ? 10 : 0) + (host ? 6 : 0)),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["partiful", "event", profile.code],
      rawMeta: { host, location: locText, startDate: ev.startDate },
    });
  }

  if (out.length === 0) {
    const ogTitle =
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i.exec(body)?.[1] ??
      /<title>([\s\S]*?)<\/title>/i.exec(body)?.[1];
    const ogDesc =
      /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i.exec(body)?.[1];
    const title = cleanText(ogTitle, 160);
    if (title) {
      const desc = cleanText(ogDesc, 200);
      const combined = `${title} ${desc}`;
      const neighborhood = detectNeighborhood(combined, profile.code);
      const vertical = inferVerticalFromText(combined, "friends");
      const desires = resolveDesireTagging(combined, vertical, ["ideal_friends"]);
      out.push({
        dedupeKey: `partiful:${slugPart(normalizedUrl)}`,
        city: profile.code,
        neighborhood,
        vertical,
        category: "event",
        source: "partiful",
        title,
        summary: desc || `${profile.displayName} public Partiful event`,
        sourceUrl: normalizedUrl,
        contactHint: null,
        score: clampScore(70 + (neighborhood ? 10 : 0)),
        discoveredAt,
        desireLane: desires.desireLane,
        desireLanes: desires.desireLanes,
        tags: ["partiful", "event", profile.code],
        rawMeta: { normalizedUrl },
      });
    }
  }

  return out;
}

export async function fetchLumaNycEvents(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "timeoutMs" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const profile = resolveCityProfile(opts.city);
  const body = await fetchText(
    fetchImpl,
    profile.lumaUrl,
    opts.userAgent ?? DEFAULT_USER_AGENT,
    "text/html, application/json;q=0.9",
    opts.timeoutMs,
  );
  return parseLumaEvents(body, discoveredAt, profile.code);
}

export async function fetchEventbriteNycEvents(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "timeoutMs" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const profile = resolveCityProfile(opts.city);
  const body = await fetchText(
    fetchImpl,
    profile.eventbriteUrl,
    opts.userAgent ?? DEFAULT_USER_AGENT,
    "text/html, application/json;q=0.9",
    opts.timeoutMs,
  );
  return parseEventbriteEvents(body, discoveredAt, profile.code);
}

export async function fetchPartifulEvents(
  partifulUrls: readonly string[],
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "timeoutMs" | "concurrency" | "userAgent">,
): Promise<{ leads: DiscoveredLead[]; errors: DiscoverySourceError[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const profile = resolveCityProfile(opts.city);
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;
  const normalizedUrls = partifulUrls
    .map((u) => normalizePartifulUrl(u))
    .filter((u): u is string => u !== null)
    .slice(0, MAX_SUBREDDITS_OR_CHANNELS);

  const leads: DiscoveredLead[] = [];
  const errors: DiscoverySourceError[] = [];

  const settled = await mapSettledWithConcurrency(
    normalizedUrls,
    opts.concurrency ?? DEFAULT_CONCURRENCY,
    async (url) => {
      try {
        const html = await fetchText(fetchImpl, url, ua, "text/html, application/json;q=0.9", opts.timeoutMs);
        return parsePartifulEvents(html, url, discoveredAt, profile.code);
      } catch (err) {
        throw new SourceFetchError(url, err instanceof Error ? err.message : String(err));
      }
    },
  );

  for (const r of settled) {
    if (r.status === "fulfilled") {
      leads.push(...r.value);
    } else {
      const reason: unknown = r.reason;
      errors.push({
        source: "partiful",
        url: reason instanceof SourceFetchError ? reason.url : PUBLIC_DISCOVERY_ENDPOINTS.partifulBase,
        message: reason instanceof Error ? reason.message : String(reason),
      });
    }
  }
  return { leads, errors };
}

export interface SecFormDSearchResponse {
  hits?: {
    hits?: Array<{
      _id?: string;
      _source?: {
        display_names?: string[];
        entity?: string;
        ciks?: string[];
        biz_locations?: string[];
        file_date?: string;
        form?: string;
        adsh?: string;
      };
    }>;
  };
}

export function parseSecFormDFilings(
  payload: SecFormDSearchResponse,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  const profile = resolveCityProfile(city);
  for (const hit of payload.hits?.hits ?? []) {
    const src = hit._source;
    if (!src) continue;
    const entityName = cleanText(src.display_names?.[0] ?? src.entity, 140);
    if (!entityName) continue;
    const loc = cleanText(src.biz_locations?.[0], 100);
    const adsh = cleanText(src.adsh ?? hit._id, 64);
    const cik = cleanText(src.ciks?.[0], 20);
    const sourceUrl = cik
      ? `https://www.sec.gov/edgar/browse/?CIK=${encodeURIComponent(cik)}`
      : PUBLIC_DISCOVERY_ENDPOINTS.secFormDSearchBase;
    const desires = resolveDesireTagging(`${entityName} ${loc}`, "peon", ["cofounder_venture", "investors_patrons"]);

    out.push({
      dedupeKey: `sec_form_d:${slugPart(adsh || entityName)}`,
      city: profile.code,
      neighborhood: detectNeighborhood(`${entityName} ${loc}`, profile.code),
      vertical: "peon",
      category: "vip",
      source: "sec_form_d",
      title: `${entityName} (SEC Form D)`,
      summary: cleanText(`Recent SEC Form D filing${loc ? ` in ${loc}` : ""}${src.file_date ? ` (${src.file_date})` : ""}`),
      sourceUrl,
      contactHint: cik ? `sec_cik:${cik}` : null,
      handleOrContact: cik ? `sec_cik:${cik}` : undefined,
      score: clampScore(82 + (loc ? 6 : 0)),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["sec-form-d", "funded-founder", "vip", profile.code],
      rawMeta: { adsh, cik, fileDate: src.file_date, location: loc },
    });
  }
  return out;
}

export async function fetchSecFormDVips(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const profile = resolveCityProfile(opts.city);
  if (profile.countryCode !== "US") return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = clampLimit(opts.limitPerSource, 15);
  const q = profile.stateCode ? `"${profile.displayName}" ${profile.stateCode}` : `"${profile.displayName}"`;
  const url = `${PUBLIC_DISCOVERY_ENDPOINTS.secFormDSearchBase}?forms=D&q=${encodeURIComponent(q)}&from=0&size=${limit}`;
  const data = await fetchJson<SecFormDSearchResponse>(
    fetchImpl,
    url,
    opts.userAgent ?? `${DEFAULT_USER_AGENT} ${profile.opsEmail}`,
    opts.timeoutMs,
  );
  return parseSecFormDFilings(data, discoveredAt, profile.code);
}

export interface OpenAlexAuthorsResponse {
  results?: Array<{
    id?: string;
    display_name?: string;
    orcid?: string | null;
    works_count?: number;
    cited_by_count?: number;
    last_known_institutions?: Array<{
      display_name?: string;
      country_code?: string;
    }>;
  }>;
}

export function parseOpenAlexResearchers(
  payload: OpenAlexAuthorsResponse,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  const profile = resolveCityProfile(city);
  for (const author of payload.results ?? []) {
    const name = cleanText(author.display_name, 120);
    if (!name) continue;
    const inst = cleanText(author.last_known_institutions?.[0]?.display_name, 120);
    const works = typeof author.works_count === "number" ? author.works_count : 0;
    const cites = typeof author.cited_by_count === "number" ? author.cited_by_count : 0;
    const key = slugPart(author.id ?? name);
    const contactHint = author.orcid ? cleanText(author.orcid, 80) : null;
    const desires = resolveDesireTagging(`${name} ${inst}`, "peon", ["mentorship_mastery", "cofounder_venture"]);

    out.push({
      dedupeKey: `openalex:${key}`,
      city: profile.code,
      vertical: "peon",
      category: "vip",
      source: "openalex",
      title: inst ? `${name} (${inst})` : name,
      summary: cleanText(`OpenAlex researcher (${works} works, ${cites} citations)${inst ? ` — ${inst}` : ""}`),
      sourceUrl: sanitizeHttpUrl(author.id, PUBLIC_DISCOVERY_ENDPOINTS.openAlexAuthorsBase),
      contactHint,
      handleOrContact: contactHint ?? undefined,
      score: clampScore(68 + Math.min(22, Math.floor(Math.log10(cites + 1) * 7))),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["openalex", "researcher", "vip", profile.code],
      rawMeta: { id: author.id, institution: inst, worksCount: works, citedByCount: cites },
    });
  }
  return out;
}

export async function fetchOpenAlexResearchers(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const profile = resolveCityProfile(opts.city);
  const limit = clampLimit(opts.limitPerSource, 15);
  const url = `${PUBLIC_DISCOVERY_ENDPOINTS.openAlexAuthorsBase}?search=${encodeURIComponent(profile.openAlexQuery)}&per-page=${limit}&sort=cited_by_count:desc`;
  const data = await fetchJson<OpenAlexAuthorsResponse>(
    fetchImpl,
    url,
    opts.userAgent ?? DEFAULT_USER_AGENT,
    opts.timeoutMs,
  );
  return parseOpenAlexResearchers(data, discoveredAt, profile.code);
}

export interface ProPublicaNonprofitsResponse {
  organizations?: Array<{
    ein?: number | string;
    name?: string;
    city?: string;
    state?: string;
    ntee_code?: string;
    subseccd?: number;
  }>;
}

export function parseProPublicaNonprofits(
  payload: ProPublicaNonprofitsResponse,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  const profile = resolveCityProfile(city);
  for (const org of payload.organizations ?? []) {
    const name = cleanText(org.name, 140);
    if (!name) continue;
    const ein = safeString(org.ein).trim();
    const loc = cleanText([org.city, org.state].filter(Boolean).join(", "), 80);
    const desires = resolveDesireTagging(`${name} ${loc}`, "ntwrk", ["investors_patrons", "elite_serendipity"]);
    out.push({
      dedupeKey: `irs_990:${ein || slugPart(name)}`,
      city: profile.code,
      vertical: "ntwrk",
      category: "vip",
      source: "irs_990",
      title: name,
      summary: cleanText(`IRS 990 Foundation / Nonprofit${loc ? ` — ${loc}` : ""}${org.ntee_code ? ` (NTEE ${org.ntee_code})` : ""}`),
      sourceUrl: ein
        ? `https://projects.propublica.org/nonprofits/organizations/${encodeURIComponent(ein)}`
        : PUBLIC_DISCOVERY_ENDPOINTS.proPublicaNonprofitsBase,
      contactHint: ein ? `ein:${ein}` : null,
      handleOrContact: ein ? `ein:${ein}` : undefined,
      score: clampScore(72 + (org.ntee_code?.startsWith("A") ? 10 : 0)),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["irs-990", "foundation", "vip", profile.code],
      rawMeta: { ein, city: org.city, state: org.state, nteeCode: org.ntee_code },
    });
  }
  return out;
}

export async function fetchIrs990Foundations(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const profile = resolveCityProfile(opts.city);
  if (profile.countryCode !== "US" || !profile.stateCode) return [];
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const url = `${PUBLIC_DISCOVERY_ENDPOINTS.proPublicaNonprofitsBase}?q=${encodeURIComponent(profile.displayName)}&state%5Bid%5D=${encodeURIComponent(profile.stateCode)}`;
  const data = await fetchJson<ProPublicaNonprofitsResponse>(
    fetchImpl,
    url,
    opts.userAgent ?? DEFAULT_USER_AGENT,
    opts.timeoutMs,
  );
  const limit = clampLimit(opts.limitPerSource, 15);
  return parseProPublicaNonprofits(data, discoveredAt, profile.code).slice(0, limit);
}

export interface ClinicalTrialsResponse {
  studies?: Array<{
    protocolSection?: {
      identificationModule?: {
        nctId?: string;
        briefTitle?: string;
        organization?: { fullName?: string };
      };
      contactsLocationsModule?: {
        overallOfficials?: Array<{
          name?: string;
          affiliation?: string;
          role?: string;
        }>;
      };
    };
  }>;
}

export function parseClinicalTrialsPis(
  payload: ClinicalTrialsResponse,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
  const out: DiscoveredLead[] = [];
  const profile = resolveCityProfile(city);
  for (const study of payload.studies ?? []) {
    const idMod = study.protocolSection?.identificationModule;
    const official = study.protocolSection?.contactsLocationsModule?.overallOfficials?.[0];
    const nctId = cleanText(idMod?.nctId, 32);
    const piName = cleanText(official?.name, 100);
    const title = cleanText(idMod?.briefTitle, 140);
    const org = cleanText(official?.affiliation ?? idMod?.organization?.fullName, 120);
    if (!piName && !title) continue;
    const desires = resolveDesireTagging(`${piName} ${title} ${org}`, "ntwrk", ["mentorship_mastery", "elite_serendipity"]);

    out.push({
      dedupeKey: `clinical_trials:${slugPart(nctId || `${piName}-${org}`)}`,
      city: profile.code,
      vertical: "ntwrk",
      category: "vip",
      source: "clinical_trials",
      title: piName ? `${piName}${org ? ` (${org})` : ""}` : title,
      summary: cleanText(`ClinicalTrials.gov PI${title ? ` — ${title}` : ""}${nctId ? ` (${nctId})` : ""}`),
      sourceUrl: nctId
        ? `https://clinicaltrials.gov/study/${encodeURIComponent(nctId)}`
        : PUBLIC_DISCOVERY_ENDPOINTS.clinicalTrialsBase,
      contactHint: piName || null,
      handleOrContact: piName || undefined,
      score: clampScore(74 + (piName ? 8 : 0)),
      discoveredAt,
      desireLane: desires.desireLane,
      desireLanes: desires.desireLanes,
      tags: ["clinical-trials", "physician-pi", "vip", profile.code],
      rawMeta: { nctId, piName, organization: org },
    });
  }
  return out;
}

export async function fetchClinicalTrialsPis(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "timeoutMs" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const profile = resolveCityProfile(opts.city);
  const limit = clampLimit(opts.limitPerSource, 15);
  const url = `${PUBLIC_DISCOVERY_ENDPOINTS.clinicalTrialsBase}?query.locn=${encodeURIComponent(profile.clinicalLocation)}&pageSize=${limit}`;
  const data = await fetchJson<ClinicalTrialsResponse>(
    fetchImpl,
    url,
    opts.userAgent ?? DEFAULT_USER_AGENT,
    opts.timeoutMs,
  );
  return parseClinicalTrialsPis(data, discoveredAt, profile.code);
}

export function deduplicateAndRankLeads(leads: readonly DiscoveredLead[]): DiscoveredLead[] {
  const byKey = new Map<string, DiscoveredLead>();
  for (const lead of leads) {
    const existing = byKey.get(lead.dedupeKey);
    if (!existing || lead.score > existing.score) {
      byKey.set(lead.dedupeKey, lead);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.dedupeKey.localeCompare(b.dedupeKey);
  });
}

const CORE_DISCOVERY_SOURCES: readonly DiscoverySource[] = [
  "city_open_data",
  "nyc_open_data",
  "nys_sla",
  "hn",
  "github",
  "arxiv",
  "reddit",
  "youtube_rss",
  "luma",
  "eventbrite",
];

const VIP_BD_DISCOVERY_SOURCES: readonly DiscoverySource[] = [
  "city_open_data",
  "nys_sla_pending",
  "partiful",
  "sec_form_d",
  "openalex",
  "irs_990",
  "clinical_trials",
];

function wrapFetchForMockDiscovery(
  baseFetch: FetchLike,
  env: Record<string, string | undefined>,
): FetchLike {
  const mockBase = resolveMockBaseUrl(env);
  if (!mockBase) return baseFetch;
  return (input, init) => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    try {
      const parsed = new URL(rawUrl);
      const host = parsed.hostname.toLowerCase();
      let mapped: string | null = null;
      if (host.includes("hn.algolia.com")) mapped = `${mockBase}/discovery/hn${parsed.search}`;
      else if (host.includes("api.github.com")) mapped = `${mockBase}/discovery/github${parsed.search}`;
      else if (host.includes("arxiv.org")) mapped = `${mockBase}/discovery/arxiv${parsed.search}`;
      else if (host.includes("openalex.org")) mapped = `${mockBase}/discovery/openalex${parsed.search}`;
      else if (host.includes("sec.gov")) mapped = `${mockBase}/discovery/sec${parsed.search}`;
      else if (host.includes("propublica.org")) mapped = `${mockBase}/discovery/propublica${parsed.search}`;
      else if (host.includes("clinicaltrials.gov")) mapped = `${mockBase}/discovery/clinicaltrials${parsed.search}`;
      if (mapped) {
        return baseFetch(mapped, init);
      }
    } catch {
      return baseFetch(input, init);
    }
    return baseFetch(input, init);
  };
}

export async function discoverCityLeads(options: DiscoveryOptions): Promise<DiscoveryRunResult> {
  const effectiveEnv = options.env ?? process.env;
  const effectiveFetch = wrapFetchForMockDiscovery(options.fetchImpl ?? fetch, effectiveEnv);
  const opts: DiscoveryOptions = { ...options, fetchImpl: effectiveFetch };
  const profile = resolveCityProfile(opts.city);
  const city = profile.code;
  const discoveredAt = readClockIso(opts.clock);
  const defaultSources = opts.includeVipBdSources
    ? [...CORE_DISCOVERY_SOURCES, ...VIP_BD_DISCOVERY_SOURCES]
    : CORE_DISCOVERY_SOURCES;
  const enabled = new Set<DiscoverySource>(opts.includeSources ?? defaultSources);

  if (isDeployedEnvironment(effectiveEnv)) {
    const scrapeGate = evaluateComplianceGate({
      mode: "unauthenticated_scraping",
      env: resolveRuntimeEnvironment(effectiveEnv),
    });
    if (!scrapeGate.allowed) {
      enabled.delete("partiful");
      enabled.delete("eventbrite");
      enabled.delete("luma");
    }
  }

  interface SourceJob {
    source: DiscoverySource;
    url: string;
    run: () => Promise<{ leads: DiscoveredLead[]; errors: DiscoverySourceError[] }>;
  }

  const jobs: SourceJob[] = [];
  const addSingle = (
    source: DiscoverySource,
    url: string,
    fn: () => Promise<DiscoveredLead[]>,
  ): void => {
    if (!enabled.has(source)) return;
    jobs.push({
      source,
      url,
      run: async () => ({ leads: await fn(), errors: [] }),
    });
  };

  if (city === "nyc") {
    addSingle("nyc_open_data", PUBLIC_DISCOVERY_ENDPOINTS.nycDohmhVenues, () =>
      fetchNycOpenDataVenues({ ...opts, city }),
    );
    addSingle("nys_sla", PUBLIC_DISCOVERY_ENDPOINTS.nysSlaLicenses, () =>
      fetchNysSlaVenues({ ...opts, city }),
    );
    addSingle("nys_sla_pending", PUBLIC_DISCOVERY_ENDPOINTS.nysSlaNamedPrincipals, () =>
      fetchNysSlaNamedPrincipals({ ...opts, city }),
    );
  } else if (enabled.has("city_open_data") && profile.openDataConnectors.length > 0) {
    jobs.push({
      source: "city_open_data",
      url: profile.openDataConnectors[0]?.urlTemplate ?? "",
      run: () => fetchCityOpenDataVenues({ ...opts, city }),
    });
  }

  addSingle("hn", PUBLIC_DISCOVERY_ENDPOINTS.hnAlgoliaBase, () =>
    fetchHnBuilders({ ...opts, city }),
  );
  addSingle("github", PUBLIC_DISCOVERY_ENDPOINTS.githubUsersBase, () =>
    fetchGithubNycBuilders({ ...opts, city }),
  );
  addSingle("arxiv", PUBLIC_DISCOVERY_ENDPOINTS.arxivApiBase, () =>
    fetchArxivResearchers({ ...opts, city }),
  );
  if (enabled.has("reddit")) {
    jobs.push({
      source: "reddit",
      url: PUBLIC_DISCOVERY_ENDPOINTS.redditBase,
      run: () => fetchRedditNycFeeds({ ...opts, city }),
    });
  }
  if (enabled.has("youtube_rss") && (opts.youtubeChannelIds?.length ?? 0) > 0) {
    jobs.push({
      source: "youtube_rss",
      url: PUBLIC_DISCOVERY_ENDPOINTS.youtubeRssBase,
      run: () => fetchYoutubeChannelRss(opts.youtubeChannelIds ?? [], { ...opts, city }),
    });
  }
  addSingle("luma", profile.lumaUrl, () => fetchLumaNycEvents({ ...opts, city }));
  addSingle("eventbrite", profile.eventbriteUrl, () => fetchEventbriteNycEvents({ ...opts, city }));
  if (enabled.has("partiful") && (opts.partifulUrls?.length ?? 0) > 0) {
    jobs.push({
      source: "partiful",
      url: PUBLIC_DISCOVERY_ENDPOINTS.partifulBase,
      run: () => fetchPartifulEvents(opts.partifulUrls ?? [], { ...opts, city }),
    });
  }
  addSingle("sec_form_d", PUBLIC_DISCOVERY_ENDPOINTS.secFormDSearchBase, () =>
    fetchSecFormDVips({ ...opts, city }),
  );
  addSingle("openalex", PUBLIC_DISCOVERY_ENDPOINTS.openAlexAuthorsBase, () =>
    fetchOpenAlexResearchers({ ...opts, city }),
  );
  addSingle("irs_990", PUBLIC_DISCOVERY_ENDPOINTS.proPublicaNonprofitsBase, () =>
    fetchIrs990Foundations({ ...opts, city }),
  );
  addSingle("clinical_trials", PUBLIC_DISCOVERY_ENDPOINTS.clinicalTrialsBase, () =>
    fetchClinicalTrialsPis({ ...opts, city }),
  );

  const collected: DiscoveredLead[] = [];
  const errors: DiscoverySourceError[] = [];

  const settled = await mapSettledWithConcurrency(
    jobs,
    options.concurrency ?? DEFAULT_CONCURRENCY,
    (job) => job.run(),
  );

  for (let i = 0; i < settled.length; i += 1) {
    const res = settled[i];
    const job = jobs[i];
    if (res.status === "fulfilled") {
      collected.push(...res.value.leads);
      errors.push(...res.value.errors);
    } else {
      errors.push({
        source: job.source,
        url: job.url,
        message: res.reason instanceof Error ? res.reason.message : String(res.reason),
      });
    }
  }

  const leads = deduplicateAndRankLeads(collected);
  const sourceCounts: Partial<Record<DiscoverySource, number>> = {};
  for (const lead of leads) {
    sourceCounts[lead.source] = (sourceCounts[lead.source] ?? 0) + 1;
  }

  return {
    city,
    discoveredAt,
    leads,
    errors,
    sourceCounts,
  };
}

export function discoverNycLeads(options: DiscoveryOptions): Promise<DiscoveryRunResult> {
  return discoverCityLeads(options);
}

export function discoverVipAndBdLeads(
  options: Omit<DiscoveryOptions, "includeVipBdSources">,
): Promise<DiscoveryRunResult> {
  return discoverCityLeads({
    ...options,
    includeSources: options.includeSources ?? VIP_BD_DISCOVERY_SOURCES,
    includeVipBdSources: true,
  });
}
