/**
 * Polite HTTP client: honest UA, <=1 req/s per host, robots.txt respected.
 * Every fetch is recorded in a log so RESULTS.md can cite status codes.
 */
export const USER_AGENT =
  "TheNetworkEventsPOC/0.1 (The Network concierge research prototype; low-rate; respects robots.txt)";

const lastHit = new Map<string, number>();
const robotsCache = new Map<string, RobotsRules | null>();
export const fetchLog: { url: string; status: number | string; ms: number; note?: string }[] = [];

export interface RobotsRules {
  allow: string[];
  disallow: string[];
  crawlDelay?: number;
  raw: string;
}

/** Parse robots.txt, returning the group that applies to our UA (falls back to "*"). */
export function parseRobots(txt: string, uaToken = "thenetworkeventspoc"): RobotsRules {
  const groups: { agents: string[]; allow: string[]; disallow: string[]; delay?: number }[] = [];
  let cur: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], allow: [], disallow: [] };
        groups.push(cur);
      }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!cur) continue;
    if (key === "allow" && val) cur.allow.push(val);
    else if (key === "disallow" && val) cur.disallow.push(val);
    else if (key === "crawl-delay") cur.delay = Number(val);
  }
  // RFC 9309: all groups naming our token are merged; otherwise all "*" groups are merged.
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && uaToken.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return {
    allow: chosen.flatMap((g) => g.allow),
    disallow: chosen.flatMap((g) => g.disallow),
    crawlDelay: chosen.find((g) => g.delay !== undefined)?.delay,
    raw: txt,
  };
}

function patternToRegex(p: string): RegExp {
  const anchored = p.endsWith("$");
  const body = (anchored ? p.slice(0, -1) : p)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

/** Longest-match wins; Allow wins ties (Google semantics). */
export function isAllowed(rules: RobotsRules | null, pathAndQuery: string): boolean {
  if (!rules) return true;
  let best = { len: -1, allow: true };
  for (const a of rules.allow) if (patternToRegex(a).test(pathAndQuery) && a.length >= best.len) best = { len: a.length, allow: true };
  for (const d of rules.disallow) if (patternToRegex(d).test(pathAndQuery) && d.length > best.len) best = { len: d.length, allow: false };
  return best.allow;
}

async function throttle(host: string, minGapMs: number) {
  const prev = lastHit.get(host) ?? 0;
  const wait = prev + minGapMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

export async function getRobots(origin: string): Promise<RobotsRules | null> {
  if (robotsCache.has(origin)) return robotsCache.get(origin)!;
  const host = new URL(origin).host;
  await throttle(host, 1000);
  let rules: RobotsRules | null = null;
  try {
    const r = await fetch(origin + "/robots.txt", { headers: { "User-Agent": USER_AGENT }, redirect: "follow" });
    fetchLog.push({ url: origin + "/robots.txt", status: r.status, ms: 0 });
    if (r.ok) rules = parseRobots(await r.text());
    // 4xx => no restrictions (RFC 9309); 5xx => treat as full disallow
    else if (r.status >= 500) rules = { allow: [], disallow: ["/"], raw: "" };
  } catch (e) {
    fetchLog.push({ url: origin + "/robots.txt", status: "ERR " + String(e), ms: 0 });
  }
  robotsCache.set(origin, rules);
  return rules;
}

export class RobotsDisallowed extends Error {}

export async function politeFetch(url: string, init: RequestInit = {}, opts: { skipRobots?: boolean } = {}): Promise<Response> {
  const u = new URL(url);
  const rules = await getRobots(u.origin);
  if (!opts.skipRobots && !isAllowed(rules, u.pathname + u.search)) {
    fetchLog.push({ url, status: "ROBOTS_DISALLOWED", ms: 0 });
    throw new RobotsDisallowed(`robots.txt disallows ${u.pathname}${u.search}`);
  }
  const gap = Math.max(1000, (rules?.crawlDelay ?? 0) * 1000);
  await throttle(u.host, gap);
  const t0 = Date.now();
  const headers = { "User-Agent": USER_AGENT, Accept: "*/*", ...(init.headers as Record<string, string>) };
  const r = await fetch(url, { ...init, headers, redirect: "follow" });
  fetchLog.push({ url, status: r.status, ms: Date.now() - t0 });
  return r;
}
