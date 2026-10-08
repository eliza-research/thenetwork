// The consent ledger per app (platform plan 4.3). STOP on an app's line stops that app only; STOP
// ALL stops every app (an event with app = null). PLATFORM_STOP_SCOPE=global makes every STOP a
// STOP ALL (for the FCC revoke-all rule, when counsel says it applies). START opts in to the app of
// the line only. The ledger reads the last event per (e164, app) and per (e164, null); a global
// opt-out wins over an older app opt-in, and a newer app opt-in (START on that line) wins over it.
import type { AppId, AppInfo } from "./apps.ts";

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
  at: number;
}

/** The last event for the app and the last global event (the two rows the ledger reads). */
export interface ConsentLast { app?: ConsentEvent; global?: ConsentEvent }

export function stopScope(env: Record<string, string | undefined> = process.env): StopScope {
  return env.PLATFORM_STOP_SCOPE === "global" ? "global" : "app";
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

// Keywords (CTIA conventions; same lists as prototypes/messaging-blooio/src/keywords.ts).
const STOP_ALL_WORDS = new Set(["STOP ALL", "STOPALL"]);
const STOP_WORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "OPT OUT"]);
const START_WORDS = new Set(["START", "UNSTOP", "SUBSCRIBE", "RESUME"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

export type Keyword = "stop" | "stop_all" | "start" | "help";

export function detectKeyword(text: string): Keyword | undefined {
  const k = text.normalize("NFKC").replace(/[​-‍﻿]/g, "").replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().toUpperCase();
  if (STOP_ALL_WORDS.has(k)) return "stop_all";
  if (STOP_WORDS.has(k)) return "stop";
  if (START_WORDS.has(k)) return "start";
  if (HELP_WORDS.has(k)) return "help";
  return undefined;
}

/** The consent event and the reply for a keyword received on an app's line. HELP writes no event. */
export function keywordEvent(kw: Keyword, e164: string, app: AppInfo, at: number, opts: { line?: string; scope?: StopScope } = {}): { event?: ConsentEvent; reply: string } {
  const scope = opts.scope ?? stopScope();
  const base = { e164, line: opts.line ?? null, at, source: `keyword:${kw}` };
  switch (kw) {
    case "stop":
      return scope === "global"
        ? { event: { ...base, app: null, state: "opted_out" }, reply: app.brand.stopAll }
        : { event: { ...base, app: app.id, state: "opted_out" }, reply: app.brand.stop };
    case "stop_all":
      return { event: { ...base, app: null, state: "opted_out" }, reply: app.brand.stopAll };
    case "start":
      return { event: { ...base, app: app.id, state: "opted_in", wording: "START keyword" }, reply: app.brand.start };
    case "help":
      return { reply: app.brand.help };
  }
}
