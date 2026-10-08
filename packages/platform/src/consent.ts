// The consent ledger per app (platform plan 4.3; PRD 40.3; founder decision 7). One line serves every
// app, and carriers see one sender, so STOP stops every app (an event with app = null): on the shared
// line, on the site's stop button, and as STOP ALL. Only an app's own line with
// PLATFORM_STOP_SCOPE=app stops that app alone. "leave <app>" (and the site's leave button) leaves one
// app. START opts in to one app. The ledger reads the last event per (e164, app) and per (e164, null);
// a global opt-out wins over an older app opt-in, and a newer app opt-in (START, a new join) wins over it.
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

// Keywords (CTIA conventions; same lists as prototypes/messaging-blooio/src/keywords.ts).
const STOP_ALL_WORDS = new Set(["STOP ALL", "STOPALL"]);
const STOP_WORDS = new Set(["STOP", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "REVOKE", "OPTOUT", "OPT OUT", "STOP PLEASE", "PLEASE STOP"]);
const START_WORDS = new Set(["START", "UNSTOP", "SUBSCRIBE", "RESUME"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);
// Spanish whole-message opt-outs (accents folded).
const SPANISH_STOP_WORDS = new Set(["PARA", "PARAR", "ALTO", "BASTA", "BAJA", "CANCELAR", "DETENER", "NO MAS", "NO MAS MENSAJES"]);

export type Keyword = "stop" | "stop_all" | "start" | "help";

/** NFKC, no zero-width characters, no accents, straight apostrophes. */
const fold = (text: string) =>
  text.normalize("NFKC").replace(/[​-‍﻿]/g, "").normalize("NFD").replace(/\p{M}+/gu, "").replace(/[‘’ʼ]/g, "'");

export function detectKeyword(text: string): Keyword | undefined {
  const k = fold(text).replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim().toUpperCase();
  if (STOP_ALL_WORDS.has(k)) return "stop_all";
  // "STOPP", "STOOOP": a misspelt STOP is still a STOP.
  if (STOP_WORDS.has(k) || SPANISH_STOP_WORDS.has(k) || /^S+T+O+P+$/.test(k) || optOutPhrase(text)) return "stop";
  if (START_WORDS.has(k)) return "start";
  if (HELP_WORDS.has(k)) return "help";
  return undefined;
}

// Reasonable means (TCPA): a person may opt out in their own words, in English or Spanish. A short
// message that clearly asks the sender to stop texting is a STOP. A sentence about something else
// ("cancel the date", "can you stop by at 7", "don't stop texting me") is not. The STOP reply is the
// confirmation, and START undoes it.
const ME = "(?:me|us|this number|my number)";
const MSGS = "(?:texts?|texting|messages?|messaging|msgs?|sms|notifications?|spam)";
const OPT_OUT_EN: RegExp[] = [
  new RegExp(`\\b(?:stop|quit|cease) (?:texting|messaging|contacting|sending|bothering|spamming|writing to|emailing|calling) ${ME}\\b`),
  new RegExp(`\\bstop (?:sending (?:me |us |these |the |your |all )?|the |these |your |all |all the |all these |all of these )${MSGS}\\b`),
  new RegExp(`\\b(?:stop|no more|enough) ${MSGS}\\b`),
  /\bunsubscribe\b/,
  /\bopt (?:me )?out\b/,
  new RegExp(`\\b(?:remove|take) ${ME} (?:off|from) (?:your|this|the|all|every|ur) (?:list|lists|texts?|messages|contacts)\\b`),
  /\b(?:remove|delete|lose) my (?:number|phone number|info|contact)\b/,
  new RegExp(`\\b(?:don't|do not|dont|pls don't|please don't|never) (?:text|message|contact|msg|sms|write to|email) ${ME}\\b`),
  new RegExp(`\\bi (?:don't|do not|dont) want (?:these|your|any|any more|anymore|more|the) ${MSGS}\\b`),
  /\bleave me alone\b/,
  /\bwrong number\b/,
  // "remove me", "take me off", "take me off the list" on their own.
  /^(?:please |pls )?(?:remove|take) me(?: off| out)?(?: (?:the|your|this) list)?(?: please| pls)?$/,
];
const OPT_OUT_ES: RegExp[] = [
  /\b(?:deja|dejen|deje) de (?:enviarme|mandarme|escribirme|textearme|contactarme)\b/,
  /\bno (?:me )?(?:envies|envien|mandes|manden|escribas|escriban|contactes) mas\b/,
  /\bno (?:me )?(?:envies|envien|mandes|manden) (?:mas )?mensajes\b/,
  /\bno quiero (?:recibir )?(?:mas )?mensajes\b/,
  /\b(?:darme|dame|dar|denme) de baja\b/,
  /\b(?:eliminame|borrame|sacame|quitame|eliminen mi numero|borren mi numero)\b/,
  /\bya no me (?:escribas|escriban|envies|mandes)\b/,
  /\bno mas mensajes\b/,
  /\bnumero equivocado\b/,
];
const NOT_OPT_OUT = /\b(?:don't|do not|dont|never|please don't) (?:stop|unsubscribe|remove|opt)\b|\bstop by\b|\bcan'?t stop\b|\bstop (?:at|on) \d/;

/** True when a short message asks, in the person's own words, to stop getting texts. */
export function optOutPhrase(text: string): boolean {
  const t = fold(text).toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  if (!t || t.length > 160 || NOT_OPT_OUT.test(t)) return false;
  // "unsubscribe from peon", "stop slop": a leave of that app only (leaveTarget), never a stop of every app.
  if (leaveTarget(text)) return false;
  return OPT_OUT_EN.some(r => r.test(t)) || OPT_OUT_ES.some(r => r.test(t));
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
