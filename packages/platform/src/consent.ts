// The consent ledger per app (platform plan 4.3; PRD 40.3; founder decision 7). One line serves every
// app, and carriers see one sender, so STOP stops every app (an event with app = null): on the shared
// line, on the site's stop button, and as STOP ALL. Only an app's own line with
// PLATFORM_STOP_SCOPE=app stops that app alone. "leave <app>" (and the site's leave button) leaves one
// app. START opts in to one app. The ledger reads the last event per (e164, app) and per (e164, null);
// a global opt-out wins over an older app opt-in, and a newer app opt-in (START, a new join) wins over it.
import { foldKeywordText as fold, KEYWORDS, keywordKey, optOutPhrase as coreOptOutPhrase } from "../../core/src/replies.ts";
import { type AppId, type AppInfo, APPS } from "./apps.ts";

export type ConsentState = "opted_in" | "opted_out";
export type StopScope = "app" | "global";

export interface ConsentEvent {
  e164: string;
  /** null = every app. */
  app: AppId | null;
  line?: string | null;
  state: ConsentState;
  source: string;
  wording?: string | null;
  /** The version of the canonical opt-in wording (apps.ts ConsentText), when the event is a web opt-in. */
  wordingVersion?: string | null;
  /** The inbound message (or request) that caused it: a retry of the same message writes no second event. */
  ref?: string | null;
  at: number;
}

/** The last event for the app and the last global event (the two rows the ledger reads). */
export interface ConsentLast { app?: ConsentEvent; global?: ConsentEvent }

/** STOP stops every app unless an app's own line is set to PLATFORM_STOP_SCOPE=app. */
export function stopScope(env: Record<string, string | undefined> = process.env): StopScope {
  return env.PLATFORM_STOP_SCOPE === "app" ? "app" : "global";
}

/** The consent state for one app from the two last events. No event = not opted in. */
export function resolveConsent(last: ConsentLast): ConsentState | undefined {
  const { app, global } = last;
  if (!app) return global?.state === "opted_out" ? "opted_out" : undefined;
  if (!global || global.state === "opted_in") return app.state;
  // A global opt-out. Only a newer opt-in for this app (START on its line, a new join) beats it.
  return app.state === "opted_in" && app.at > global.at ? "opted_in" : "opted_out";
}

/** Pick the two last events from a list (the memory store and tests). Ties go to the later entry. */
export function lastEvents(events: readonly ConsentEvent[], e164: string, app: AppId): ConsentLast {
  const out: ConsentLast = {};
  for (const e of events) {
    if (e.e164 !== e164) continue;
    if (e.app === app && (!out.app || e.at >= out.app.at)) out.app = e;
    if (e.app === null && (!out.global || e.at >= out.global.at)) out.global = e;
  }
  return out;
}

// Keywords: the one table and the free-text opt-out reading live in packages/core/src/replies.ts.
const STOP_ALL_WORDS = new Set<string>(KEYWORDS.stopAll);
const STOP_WORDS = new Set<string>([...KEYWORDS.stop, ...KEYWORDS.stopPolite]);
const START_WORDS = new Set<string>(KEYWORDS.start);
const HELP_WORDS = new Set<string>(KEYWORDS.help);
const SPANISH_STOP_WORDS = new Set<string>(KEYWORDS.stopEs);

export type Keyword = "stop" | "stop_all" | "start" | "help";

export function detectKeyword(text: string): Keyword | undefined {
  const k = keywordKey(text);
  if (STOP_ALL_WORDS.has(k)) return "stop_all";
  // "STOPP", "STOOOP": a misspelt STOP is still a STOP.
  if (STOP_WORDS.has(k) || SPANISH_STOP_WORDS.has(k) || /^S+T+O+P+$/.test(k) || optOutPhrase(text)) return "stop";
  if (START_WORDS.has(k)) return "start";
  if (HELP_WORDS.has(k)) return "help";
  return undefined;
}

/** True when a short message asks, in the person's own words, to stop getting texts (core optOutPhrase; a per-app leave is not one). */
export function optOutPhrase(text: string): boolean {
  return coreOptOutPhrase(text, t => leaveTarget(t) !== undefined);
}

/** "leave slop", "leave slop.date", "stop slop", "quit peon", "leave the network": the app to leave (that app only), or undefined. */
export function leaveTarget(text: string, apps: Record<AppId, Pick<AppInfo, "id" | "domain" | "name">> = APPS): AppId | undefined {
  const t = fold(text).toLowerCase().replace(/[^\p{L}\p{N}. ]+/gu, " ").replace(/\s+/g, " ").trim().replace(/\.$/, "");
  // "leave slop", and the same with stop, quit, cancel, unsubscribe (from) or exit: that app only.
  const m = /^(?:please )?(?:leave|quit|exit|stop|cancel|unsubscribe(?: from| me from)?) (.+)$/.exec(t);
  if (!m) return undefined;
  const x = m[1]!.replace(/^the /, "").replace(/ please$/, "");
  return Object.values(apps).find(a => x === a.id || x === a.domain || x === `www.${a.domain}` || x === a.name.toLowerCase().replace(/^the /, ""))?.id;
}

/** The consent event and the reply for a keyword received on an app's line. HELP writes no event. */
export function keywordEvent(kw: Keyword, e164: string, app: AppInfo, at: number, opts: { line?: string; scope?: StopScope; ref?: string } = {}): { event?: ConsentEvent; reply: string } {
  const scope = opts.scope ?? stopScope();
  const base = { e164, line: opts.line ?? null, at, source: `keyword:${kw}`, ref: opts.ref ?? null };
  switch (kw) {
    case "stop":
      return scope === "global"
        ? { event: { ...base, app: null, state: "opted_out" }, reply: app.brand.stop }
        : { event: { ...base, app: app.id, state: "opted_out" }, reply: app.brand.stopApp };
    case "stop_all":
      return { event: { ...base, app: null, state: "opted_out" }, reply: app.brand.stop };
    case "start":
      return { event: { ...base, app: app.id, state: "opted_in", wording: "START keyword" }, reply: app.brand.start };
    case "help":
      return { reply: app.brand.help };
  }
}
