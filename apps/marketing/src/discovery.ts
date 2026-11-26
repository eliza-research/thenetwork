// Tier 1 ($0 cost) open-web NYC discovery engine for @thenetwork/marketing (Node 26).
// Uses standard fetch with injectable fetchImpl and Clock for offline deterministic testing,
// and real unauthenticated public open-web endpoints when run live.
// Clock discipline: never calls Date.now() or Math.random() directly.

import type { BrandAppId, Clock, DiscoveredLead as BaseDiscoveredLead } from "./types.ts";

export type MarketingVertical = BrandAppId;
export type LeadCategory = "venue" | "event" | "creator" | "vip" | "community";
export type DiscoverySource =
  | "nyc_open_data"
  | "nys_sla"
  | "hn"
  | "github"
  | "arxiv"
  | "reddit"
  | "youtube_rss"
  | "luma"
  | "eventbrite";

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
  userAgent?: string;
  redditSubreddits?: readonly string[];
  youtubeChannelIds?: readonly string[];
  hnQuery?: string;
  githubQuery?: string;
  arxivQuery?: string;
  includeSources?: readonly DiscoverySource[];
}

export const PUBLIC_DISCOVERY_ENDPOINTS = {
  nycDohmhVenues:
    "https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit=40&$where=grade='A'&$order=inspection_date%20DESC",
  nysSlaLicenses:
    "https://data.ny.gov/resource/9s3h-dpkz.json?$limit=40&$where=county_name_desc='NEW%20YORK'%20OR%20county_name_desc='KINGS'",
  hnAlgoliaBase: "https://hn.algolia.com/api/v1/search",
  githubUsersBase: "https://api.github.com/search/users",
  arxivApiBase: "https://export.arxiv.org/api/query",
  redditBase: "https://www.reddit.com",
  youtubeRssBase: "https://www.youtube.com/feeds/videos.xml",
  lumaNycUrl: "https://lu.ma/nyc",
  eventbriteNycUrl: "https://www.eventbrite.com/d/ny--new-york/events/",
} as const;

export const DEFAULT_NYC_SUBREDDITS: readonly string[] = [
  "nyc",
  "AskNYC",
  "nycmeetups",
  "startups",
];

const DEFAULT_USER_AGENT = "thenetwork-marketing-discovery/1.0 (open-web-tier1)";

const NYC_NEIGHBORHOOD_PATTERNS: ReadonlyArray<{ label: string; patterns: readonly string[] }> = [
  { label: "West Village", patterns: ["west village", "washington square", "bleecker", "w 4th", "greenwich village"] },
  { label: "East Village", patterns: ["east village", "astor place", "st marks", "st. marks", "alphabet city"] },
  { label: "SoHo / Nolita", patterns: ["soho", "nolita", "prince st", "spring st", "w broadway"] },
  { label: "Flatiron / Union Square", patterns: ["flatiron", "union square", "gramercy", "14th st", "23rd st"] },
  { label: "Williamsburg", patterns: ["williamsburg", "bedford ave", "domino park", "greenpoint", "bushwick"] },
  { label: "Midtown West", patterns: ["midtown", "bryant park", "hudson yards", "hell's kitchen", "times square"] },
  { label: "Lower East Side", patterns: ["lower east side", "les", "ludlow", "orchard st", "bowery"] },
  { label: "Brooklyn", patterns: ["brooklyn", "kings", "dumbo", "park slope", "cobble hill"] },
  { label: "Manhattan", patterns: ["manhattan", "new york", "tribeca", "chelsea", "upper west", "upper east"] },
];

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

export function detectNycNeighborhood(text: string): string | undefined {
  const hay = text.toLowerCase();
  for (const entry of NYC_NEIGHBORHOOD_PATTERNS) {
    if (entry.patterns.some((p) => hay.includes(p))) {
      return entry.label;
    }
  }
  return undefined;
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
  if (/(friend|meetup|run club|running club|social club|supper club|community|book club|pickleball|trivia|new to nyc|hangout)/.test(hay)) {
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

async function fetchText(
  fetchImpl: FetchLike,
  url: string,
  userAgent: string,
  accept: string,
): Promise<string> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: {
      "User-Agent": userAgent,
      Accept: accept,
    },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  userAgent: string,
): Promise<T> {
  const text = await fetchText(fetchImpl, url, userAgent, "application/json, text/plain;q=0.9");
  return JSON.parse(text) as T;
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
    const neighborhood = detectNycNeighborhood(combined) ?? (row.boro ? cleanText(row.boro, 40) : undefined);
    const isSocialVenue = /(bar|lounge|wine|cocktail|coffee|cafe|bakery|bistro|tapas|italian|mexican|japanese)/i.test(
      `${name} ${cuisine}`,
    );
    const vertical = inferVerticalFromText(
      combined,
      isSocialVenue ? "slop" : "friends",
    );
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
    const neighborhood = detectNycNeighborhood(combined);
    const isOnPremises = /(op|bar|tavern|lounge|restaurant|club|wine)/i.test(method);
    const key = row.license_serial_number
      ? `sla:${row.license_serial_number}`
      : `sla:${slugPart(name)}:${slugPart(row.zip ?? "")}`;

    out.push({
      dedupeKey: `nys_sla:${key}`,
      city,
      neighborhood,
      vertical: inferVerticalFromText(combined, isOnPremises ? "slop" : "ntwrk"),
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
      tags: ["nys-sla", "bar-venue", ...(row.license_type_code ? [slugPart(row.license_type_code)] : [])],
      rawMeta: { serial: row.license_serial_number, county: row.county_name_desc, zip: row.zip },
    });
  }
  return out;
}

export async function fetchNycOpenDataVenues(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = opts.limitPerSource ?? 25;
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;
  const url = `https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit=${limit}&$where=grade='A'`;
  const rows = await fetchJson<DohmhVenueRow[]>(fetchImpl, url, ua);
  return parseNycOpenDataVenues(Array.isArray(rows) ? rows : [], discoveredAt, opts.city ?? "nyc");
}

export async function fetchNysSlaVenues(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = opts.limitPerSource ?? 25;
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;
  const url = `https://data.ny.gov/resource/9s3h-dpkz.json?$limit=${limit}&$where=county_name_desc='NEW%20YORK'%20OR%20county_name_desc='KINGS'`;
  const rows = await fetchJson<NysSlaRow[]>(fetchImpl, url, ua);
  return parseNysSlaVenues(Array.isArray(rows) ? rows : [], discoveredAt, opts.city ?? "nyc");
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
  for (const hit of payload.hits ?? []) {
    const title = cleanText(hit.title, 180);
    if (!title) continue;
    const id = hit.objectID ?? slugPart(title);
    const points = typeof hit.points === "number" ? hit.points : 0;
    const comments = typeof hit.num_comments === "number" ? hit.num_comments : 0;
    const combined = `${title} ${cleanText(hit.story_text, 200)}`;
    const isNyc = /\b(nyc|new york|manhattan|brooklyn|soho|williamsburg)\b/i.test(combined);
    const score = 45 + Math.min(30, Math.floor(points / 5)) + Math.min(15, Math.floor(comments / 5)) + (isNyc ? 10 : 0);

    const hnContact = hit.author ? `hn:${hit.author}` : null;
    out.push({
      dedupeKey: `hn:${id}`,
      city,
      neighborhood: detectNycNeighborhood(combined),
      vertical: inferVerticalFromText(combined, "peon"),
      category: "vip",
      source: "hn",
      title,
      summary: cleanText(`HN story by ${hit.author ?? "unknown"} (${points} pts, ${comments} comments)`),
      sourceUrl: hit.url && /^https?:\/\//i.test(hit.url)
        ? hit.url
        : `https://news.ycombinator.com/item?id=${encodeURIComponent(id)}`,
      contactHint: hnContact,
      handleOrContact: hnContact ?? undefined,
      score: clampScore(score),
      discoveredAt,
      tags: ["hacker-news", "builder", ...(isNyc ? ["nyc"] : [])],
      rawMeta: { objectID: hit.objectID, author: hit.author, points, numComments: comments },
    });
  }
  return out;
}

export async function fetchHnBuilders(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "userAgent" | "hnQuery">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = opts.limitPerSource ?? 20;
  const query = opts.hnQuery ?? "NYC OR Show HN AI agent";
  const url = `${PUBLIC_DISCOVERY_ENDPOINTS.hnAlgoliaBase}?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=${limit}`;
  const data = await fetchJson<HnSearchResponse>(fetchImpl, url, opts.userAgent ?? DEFAULT_USER_AGENT);
  return parseHnStories(data, discoveredAt, opts.city ?? "nyc");
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
  for (const item of payload.items ?? []) {
    const login = cleanText(item.login, 80);
    if (!login) continue;
    const combined = `${login} ${cleanText(item.bio, 180)} ${cleanText(item.location, 80)}`;
    out.push({
      dedupeKey: `github:${login.toLowerCase()}`,
      city,
      neighborhood: detectNycNeighborhood(combined),
      vertical: "peon",
      category: "vip",
      source: "github",
      title: `GitHub Builder @${login}`,
      summary: cleanText(item.bio || `Public NYC developer profile on GitHub (${item.location ?? "NYC"})`),
      sourceUrl: item.html_url || `https://github.com/${encodeURIComponent(login)}`,
      contactHint: `github:${login}`,
      handleOrContact: `github:${login}`,
      score: clampScore(65 + Math.min(25, Math.round((item.score ?? 1) * 10))),
      discoveredAt,
      tags: ["github", "builder", "nyc"],
      rawMeta: { id: item.id, login, type: item.type, location: item.location },
    });
  }
  return out;
}

export async function fetchGithubNycBuilders(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "userAgent" | "githubQuery">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = opts.limitPerSource ?? 20;
  const q = opts.githubQuery ?? "location:NYC followers:>25";
  const url = `${PUBLIC_DISCOVERY_ENDPOINTS.githubUsersBase}?q=${encodeURIComponent(q)}&per_page=${limit}`;
  const data = await fetchJson<GithubUserSearchResponse>(fetchImpl, url, opts.userAgent ?? DEFAULT_USER_AGENT);
  return parseGithubUsers(data, discoveredAt, opts.city ?? "nyc");
}

export function parseArxivAtom(
  xml: string,
  discoveredAt: string,
  city = "nyc",
): DiscoveredLead[] {
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

    const arxivContact = primaryAuthor ? `arxiv:${primaryAuthor}` : null;
    out.push({
      dedupeKey: `arxiv:${paperKey}`,
      city,
      vertical: "peon",
      category: "vip",
      source: "arxiv",
      title,
      summary: summary || `arXiv research paper by ${primaryAuthor ?? "researcher"}`,
      sourceUrl: /^https?:\/\//i.test(idUrl) ? idUrl : PUBLIC_DISCOVERY_ENDPOINTS.arxivApiBase,
      contactHint: arxivContact,
      handleOrContact: arxivContact ?? undefined,
      score: clampScore(58 + (isAgentPaper ? 22 : 0) + (primaryAuthor ? 5 : 0)),
      discoveredAt,
      tags: ["arxiv", "researcher", ...(isAgentPaper ? ["ai-agents"] : [])],
      rawMeta: { primaryAuthor, idUrl },
    });
  }
  return out;
}

export async function fetchArxivResearchers(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "userAgent" | "arxivQuery">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = opts.limitPerSource ?? 15;
  const q = opts.arxivQuery ?? "all:autonomous+agents+OR+all:social+matching";
  const url = `${PUBLIC_DISCOVERY_ENDPOINTS.arxivApiBase}?search_query=${q}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
  const xml = await fetchText(fetchImpl, url, opts.userAgent ?? DEFAULT_USER_AGENT, "application/atom+xml, text/xml");
  return parseArxivAtom(xml, discoveredAt, opts.city ?? "nyc");
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
  for (const child of payload.data?.children ?? []) {
    const post = child.data;
    if (!post?.title) continue;
    const title = cleanText(post.title, 180);
    const body = cleanText(post.selftext, 200);
    const sub = cleanText(post.subreddit, 40) || "nyc";
    const combined = `${sub} ${title} ${body}`;
    const postScore = typeof post.score === "number" ? post.score : 0;
    const comments = typeof post.num_comments === "number" ? post.num_comments : 0;
    const subFallback: MarketingVertical = /dating/i.test(sub)
      ? "slop"
      : /startup|founder|tech/i.test(sub)
        ? "peon"
        : /meetup|friend/i.test(sub)
          ? "friends"
          : "ntwrk";

    const permalink = post.permalink
      ? `https://www.reddit.com${post.permalink}`
      : post.url || `https://www.reddit.com/r/${encodeURIComponent(sub)}`;

    const redditContact = post.author && post.author !== "[deleted]" ? `u/${post.author}` : null;
    out.push({
      dedupeKey: `reddit:${post.id ?? slugPart(`${sub}-${title}`)}`,
      city,
      neighborhood: detectNycNeighborhood(combined),
      vertical: inferVerticalFromText(combined, subFallback),
      category: /meetup|event|mixer|party/i.test(combined) ? "event" : "community",
      source: "reddit",
      title,
      summary: body || `r/${sub} discussion (${postScore} upvotes, ${comments} comments)`,
      sourceUrl: permalink,
      contactHint: redditContact,
      handleOrContact: redditContact ?? undefined,
      score: clampScore(50 + Math.min(25, Math.floor(postScore / 4)) + Math.min(15, Math.floor(comments / 3))),
      discoveredAt,
      tags: ["reddit", `r-${slugPart(sub)}`, "nyc"],
      rawMeta: { id: post.id, subreddit: sub, author: post.author, score: postScore, comments },
    });
  }
  return out;
}

export async function fetchRedditNycFeeds(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "limitPerSource" | "userAgent" | "redditSubreddits">,
): Promise<{ leads: DiscoveredLead[]; errors: DiscoverySourceError[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const limit = opts.limitPerSource ?? 15;
  const subs = opts.redditSubreddits ?? DEFAULT_NYC_SUBREDDITS;
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;

  const leads: DiscoveredLead[] = [];
  const errors: DiscoverySourceError[] = [];

  for (const sub of subs) {
    const url = `${PUBLIC_DISCOVERY_ENDPOINTS.redditBase}/r/${encodeURIComponent(sub)}/new.json?limit=${limit}`;
    try {
      const json = await fetchJson<RedditListingResponse>(fetchImpl, url, ua);
      leads.push(...parseRedditFeed(json, discoveredAt, opts.city ?? "nyc"));
    } catch (err) {
      errors.push({
        source: "reddit",
        url,
        message: err instanceof Error ? err.message : String(err),
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
    const link = extractXmlAttr(entry, "link", "href") ||
      (videoId ? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}` : PUBLIC_DISCOVERY_ENDPOINTS.youtubeRssBase);
    const description = cleanText(extractXmlTag(entry, "media:description"), 220);
    const viewsRaw = extractXmlAttr(entry, "media:statistics", "views");
    const views = viewsRaw ? Number.parseInt(viewsRaw, 10) : 0;
    const combined = `${authorName} ${title} ${description}`;
    const isStreetInterview = /(street interview|washington square|nyc|new york|vox pop|dating in nyc|ask new yorkers|sidetalk)/i.test(
      combined,
    );
    const score = 60 + (isStreetInterview ? 25 : 0) + (views >= 5000 && views <= 150000 ? 15 : views > 0 ? 5 : 0);

    const ytContact = channelId ? `yt_channel:${channelId}` : (authorName || null);
    out.push({
      dedupeKey: `youtube_rss:${videoId || slugPart(`${channelId}-${title}`)}`,
      city,
      neighborhood: detectNycNeighborhood(combined),
      vertical: inferVerticalFromText(combined, "slop"),
      category: "creator",
      source: "youtube_rss",
      title: authorName ? `${authorName}: ${title}` : title,
      summary: description || `NYC creator video on YouTube${views > 0 ? ` (${views} views)` : ""}`,
      sourceUrl: link,
      contactHint: ytContact,
      handleOrContact: ytContact ?? undefined,
      score: clampScore(score),
      discoveredAt,
      tags: ["youtube-rss", "creator", ...(isStreetInterview ? ["street-interview"] : [])],
      rawMeta: { videoId, channelId, authorName, views },
    });
  }
  return out;
}

export async function fetchYoutubeChannelRss(
  channelIds: readonly string[],
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "userAgent">,
): Promise<{ leads: DiscoveredLead[]; errors: DiscoverySourceError[] }> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const ua = opts.userAgent ?? DEFAULT_USER_AGENT;

  const leads: DiscoveredLead[] = [];
  const errors: DiscoverySourceError[] = [];

  for (const channelId of channelIds) {
    const trimmed = channelId.trim();
    if (!trimmed) continue;
    const url = `${PUBLIC_DISCOVERY_ENDPOINTS.youtubeRssBase}?channel_id=${encodeURIComponent(trimmed)}`;
    try {
      const xml = await fetchText(fetchImpl, url, ua, "application/atom+xml, application/xml, text/xml");
      leads.push(...parseYoutubeRss(xml, discoveredAt, opts.city ?? "nyc"));
    } catch (err) {
      errors.push({
        source: "youtube_rss",
        url,
        message: err instanceof Error ? err.message : String(err),
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
      const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length > 0) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        const obj = node as Record<string, unknown>;
        if (Array.isArray(obj["@graph"])) {
          queue.push(...obj["@graph"]);
        }
        if (Array.isArray(obj.itemListElement)) {
          for (const el of obj.itemListElement) {
            if (el && typeof el === "object") {
              const item = (el as Record<string, unknown>).item ?? el;
              queue.push(item);
            }
          }
        }
        const typeVal = String(obj["@type"] ?? "");
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
          ? slug
          : slug
            ? `https://lu.ma/${slug.replace(/^\//, "")}`
            : PUBLIC_DISCOVERY_ENDPOINTS.lumaNycUrl;
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

        const lumaContact = host || null;
        out.push({
          dedupeKey: `luma:${slugPart(slug || title)}`,
          city,
          neighborhood: detectNycNeighborhood(combined),
          vertical: inferVerticalFromText(combined, "ntwrk"),
          category: "event",
          source: "luma",
          title,
          summary: cleanText(`${geo || "NYC Luma Event"}${ev.start_at ? ` @ ${String(ev.start_at)}` : ""}`),
          sourceUrl,
          contactHint: lumaContact,
          handleOrContact: lumaContact ?? undefined,
          score: clampScore(72 + (detectNycNeighborhood(combined) ? 12 : 0) + (host ? 6 : 0)),
          discoveredAt,
          tags: ["luma", "event", "nyc"],
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
    const url = cleanText(ev.url, 240) || PUBLIC_DISCOVERY_ENDPOINTS.lumaNycUrl;
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

    out.push({
      dedupeKey: `luma:${slugPart(url !== PUBLIC_DISCOVERY_ENDPOINTS.lumaNycUrl ? url : title)}`,
      city,
      neighborhood: detectNycNeighborhood(combined),
      vertical: inferVerticalFromText(combined, "ntwrk"),
      category: "event",
      source: "luma",
      title,
      summary: cleanText(`${locText || "NYC Luma Event"}${ev.startDate ? ` (${String(ev.startDate)})` : ""}`),
      sourceUrl: url,
      contactHint: null,
      score: clampScore(70 + (detectNycNeighborhood(combined) ? 12 : 0)),
      discoveredAt,
      tags: ["luma", "event", "nyc"],
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
        const url = cleanText(ev.url, 240) || PUBLIC_DISCOVERY_ENDPOINTS.eventbriteNycUrl;
        const venue = cleanText(ev.venue ?? ev.location, 140);
        const combined = `${title} ${venue} ${cleanText(ev.summary, 160)}`;
        out.push({
          dedupeKey: `eventbrite:${slugPart(String(ev.id ?? url ?? title))}`,
          city,
          neighborhood: detectNycNeighborhood(combined),
          vertical: inferVerticalFromText(combined, "friends"),
          category: "event",
          source: "eventbrite",
          title,
          summary: cleanText(`${venue || "NYC Eventbrite Event"}${ev.start ? ` (${String(ev.start)})` : ""}`),
          sourceUrl: url,
          contactHint: null,
          score: clampScore(68 + (detectNycNeighborhood(combined) ? 12 : 0)),
          discoveredAt,
          tags: ["eventbrite", "event", "nyc"],
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
    const url = cleanText(ev.url, 240) || PUBLIC_DISCOVERY_ENDPOINTS.eventbriteNycUrl;
    const locObj = ev.location && typeof ev.location === "object"
      ? (ev.location as Record<string, unknown>)
      : undefined;
    const locText = cleanText(locObj?.name, 140);
    const combined = `${title} ${locText} ${cleanText(ev.description, 160)}`;
    out.push({
      dedupeKey: `eventbrite:${slugPart(url !== PUBLIC_DISCOVERY_ENDPOINTS.eventbriteNycUrl ? url : title)}`,
      city,
      neighborhood: detectNycNeighborhood(combined),
      vertical: inferVerticalFromText(combined, "friends"),
      category: "event",
      source: "eventbrite",
      title,
      summary: cleanText(`${locText || "NYC Eventbrite Event"}${ev.startDate ? ` (${String(ev.startDate)})` : ""}`),
      sourceUrl: url,
      contactHint: null,
      score: clampScore(66 + (detectNycNeighborhood(combined) ? 12 : 0)),
      discoveredAt,
      tags: ["eventbrite", "event", "nyc"],
      rawMeta: { startDate: ev.startDate, location: locText },
    });
  }
  return out;
}

export async function fetchLumaNycEvents(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const body = await fetchText(
    fetchImpl,
    PUBLIC_DISCOVERY_ENDPOINTS.lumaNycUrl,
    opts.userAgent ?? DEFAULT_USER_AGENT,
    "text/html, application/json;q=0.9",
  );
  return parseLumaEvents(body, discoveredAt, opts.city ?? "nyc");
}

export async function fetchEventbriteNycEvents(
  opts: Pick<DiscoveryOptions, "fetchImpl" | "clock" | "city" | "userAgent">,
): Promise<DiscoveredLead[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const discoveredAt = readClockIso(opts.clock);
  const body = await fetchText(
    fetchImpl,
    PUBLIC_DISCOVERY_ENDPOINTS.eventbriteNycUrl,
    opts.userAgent ?? DEFAULT_USER_AGENT,
    "text/html, application/json;q=0.9",
  );
  return parseEventbriteEvents(body, discoveredAt, opts.city ?? "nyc");
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

const ALL_DISCOVERY_SOURCES: readonly DiscoverySource[] = [
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

export async function discoverNycLeads(options: DiscoveryOptions): Promise<DiscoveryRunResult> {
  const city = options.city ?? "nyc";
  const discoveredAt = readClockIso(options.clock);
  const enabled = new Set<DiscoverySource>(options.includeSources ?? ALL_DISCOVERY_SOURCES);
  const collected: DiscoveredLead[] = [];
  const errors: DiscoverySourceError[] = [];

  const runSingle = async (
    source: DiscoverySource,
    url: string,
    fn: () => Promise<DiscoveredLead[]>,
  ) => {
    if (!enabled.has(source)) return;
    try {
      const items = await fn();
      collected.push(...items);
    } catch (err) {
      errors.push({
        source,
        url,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  await Promise.all([
    runSingle("nyc_open_data", PUBLIC_DISCOVERY_ENDPOINTS.nycDohmhVenues, () =>
      fetchNycOpenDataVenues(options),
    ),
    runSingle("nys_sla", PUBLIC_DISCOVERY_ENDPOINTS.nysSlaLicenses, () =>
      fetchNysSlaVenues(options),
    ),
    runSingle("hn", PUBLIC_DISCOVERY_ENDPOINTS.hnAlgoliaBase, () =>
      fetchHnBuilders(options),
    ),
    runSingle("github", PUBLIC_DISCOVERY_ENDPOINTS.githubUsersBase, () =>
      fetchGithubNycBuilders(options),
    ),
    runSingle("arxiv", PUBLIC_DISCOVERY_ENDPOINTS.arxivApiBase, () =>
      fetchArxivResearchers(options),
    ),
    (async () => {
      if (!enabled.has("reddit")) return;
      const r = await fetchRedditNycFeeds(options);
      collected.push(...r.leads);
      errors.push(...r.errors);
    })(),
    (async () => {
      if (!enabled.has("youtube_rss")) return;
      const ids = options.youtubeChannelIds ?? [];
      if (ids.length === 0) return;
      const r = await fetchYoutubeChannelRss(ids, options);
      collected.push(...r.leads);
      errors.push(...r.errors);
    })(),
    runSingle("luma", PUBLIC_DISCOVERY_ENDPOINTS.lumaNycUrl, () =>
      fetchLumaNycEvents(options),
    ),
    runSingle("eventbrite", PUBLIC_DISCOVERY_ENDPOINTS.eventbriteNycUrl, () =>
      fetchEventbriteNycEvents(options),
    ),
  ]);

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
