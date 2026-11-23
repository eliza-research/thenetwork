import { classifyYesNo, DAY } from "@thenetwork/core";
import { appearanceLeak } from "../../engine/src/packs/slop/appearance.ts";
import { parseRelayRequest, relayPhotoReferenceAllowed } from "../../engine/src/relay.ts";
import { photoPickFor, photoSlotsMax, type PhotoPickResult } from "../../core/src/generated/photoRelayItem.ts";
import { maskOf as numbersMask, numbersOf as maskNumbers } from "../../platform/src/photo-relay.ts";

export interface PhotoSlot { n: number; id: string; addedAt: number; batch: string; label: string | null; sharedWith: string[] }
export interface ReaderThread { threadId: string; recipientMemberId: string; firstName: string }
export interface ReaderDraft { recipientMemberId: string | null; shown: number[]; proposed: number[]; wantsSet: boolean; listed: boolean }
export interface ReaderContext { photos: PhotoSlot[]; now: number; timeZone: string; threads: ReaderThread[]; currentThreadId: string | null; draft: ReaderDraft | null }
export type Target = { kind: "one"; thread: ReaderThread } | { kind: "ask"; recipients: number };
type PickWhy = "list" | "ordinal" | "recency" | "date" | "label" | "content" | "has" | "other" | "all" | "this" | "and";
export type PhotoReading =
  | { kind: "none" }
  | { kind: "send"; target: Target; result: PhotoPickResult; numbers: number[]; wantsSet: boolean; why: PickWhy; alsoText: boolean }
  | { kind: "draft"; hasReference: boolean; yes: boolean; no: boolean; result: PhotoPickResult | null; numbers: number[]; wantsSet: boolean; why: PickWhy }
  | { kind: "holdings"; firstName: string | null }
  | { kind: "name"; n: number; label: string }
  | { kind: "name_refused"; reason: "format" | "taken" | "looks" | "which" }
  | { kind: "delete"; result: PhotoPickResult; numbers: number[] }
  | { kind: "take_back"; threadId: string | null; numbers: number[] | null }
  | { kind: "photos_ok" }
  | { kind: "no_more_photos" };

const NONE: PhotoReading = { kind: "none" };
const THIS_BATCH_MS = 15 * 60_000;
const LABEL_MAX = 24;

const NOUNS = new Set(["photo", "pic", "picture", "selfie", "image", "shot"]);
const PLURALS = new Set(["photos", "pics", "pix", "pictures", "selfies", "images", "shots"]);
const STOP = new Set([
  "a", "an", "the", "but", "my", "mine", "me", "i", "one", "ones", "of", "with", "in", "on", "at", "from", "to", "for", "where", "which",
  "that", "this", "it", "is", "was", "am", "are", "please", "now", "just", "again", "also", "too",
  "these", "those", "some", "any", "he", "she", "they", "her", "him", "them", "we", "us", "you", "your", "our", "his", "their", "and", "or",
  ...NOUNS, ...PLURALS,
]);
const FILLER = new Set(["ok", "okay", "sure", "yes", "yeah", "yep", "no", "nope", "actually", "wait", "sorry", "pls", "thanks", "thx", "lol", "haha", "hey", "hi", "oh"]);
const LEADING = new Set(["no", "nope", "actually", "wait", "sorry", "ok", "okay", "sure", "yes", "yeah", "yep", ","]);
const VERBS = new Set(["send", "share", "show", "give", "forward", "pass", "text"]);
const TO_VERBS = new Set(["send", "share", "show", "forward"]);
const RECIPIENT_PREPS = new Set(["to", "with", "for"]);
const AUX = new Set(["can", "could", "would", "will", "you", "u"]);
const WITHDRAW = new Set(["don't", "dont", "do", "not", "never", "stop", "cancel", "hold", "off", "withdraw", "take", "back", "unsend", "changed", "mind", "scratch"]);
const ORDINALS = new Map([["first", 1], ["second", 2], ["third", 3], ["fourth", 4], ["fifth", 5], ["sixth", 6], ["seventh", 7], ["eighth", 8], ["ninth", 9], ["tenth", 10]]);
const WEEKDAYS = new Map([
  ["sunday", 0], ["monday", 1], ["mon", 1], ["tuesday", 2], ["tue", 2], ["tues", 2], ["wednesday", 3], ["wed", 3],
  ["thursday", 4], ["thu", 4], ["thur", 4], ["thurs", 4], ["friday", 5], ["fri", 5], ["saturday", 6], ["sat", 6],
]);
const MONTHS = new Map([
  ["january", 1], ["jan", 1], ["february", 2], ["feb", 2], ["march", 3], ["mar", 3], ["april", 4], ["apr", 4], ["may", 5], ["june", 6], ["jun", 6],
  ["july", 7], ["jul", 7], ["august", 8], ["aug", 8], ["september", 9], ["sep", 9], ["sept", 9], ["october", 10], ["oct", 10],
  ["november", 11], ["nov", 11], ["december", 12], ["dec", 12],
]);
const DAY_WORDS = new Set(["today", "tonight", "yesterday", "week", "weekend", "night", "morning", "month", "year", ...WEEKDAYS.keys()]);
const NOT_OWNERS = new Set([...DAY_WORDS, "it", "that", "there", "here", "what", "who", "where", "when", "how", "let", "she", "he", "one"]);
const RECENT_VERBS = new Set(["uploaded", "added", "sent", "took", "taken", "put"]);
const HAS_WORDS = new Set(["has", "got", "saw", "seen", "had"]);
const NUM_PREFIX = new Set(["photo", "photos", "pic", "pics", "picture", "pictures", "number", "numbers", "no", "#"]);
const NUMERAL = /^#?(\d{1,2})$/;
const LOOKS = /\b(?:hot|hotter|hottest|sexy|sexier|sexiest|cute|cuter|cutest|pretty|prettier|prettiest|attractive|best|rated|rating|ratings|score|scored|scores)\b|\b(?:good|best)[- ]looking\b/;
const CODES = [/\bp(?:h|ri|of|dr)_[a-z0-9]+/, /\b[0-9a-f]{16,}\b/, /https?:\/\//, /\bwww\./];
const NO_MORE = /^(?:no more (?:photos|pics)|(?:don't|dont|do not) send me (?:any )?(?:more )?(?:photos|pics)|stop sending me (?:photos|pics)|no (?:photos|pics) from matches|i (?:don't|dont|do not) want (?:any )?(?:more )?(?:photos|pics)(?: from matches)?)$/;
const HEDGE_START = /^(?:should i|do you think|is it ok (?:to|if)|would it be|what if|maybe|if)\b/;
const HEDGE_WORDS = /\b(?:later|eventually|at some point|one day|tomorrow|after (?:the date|we meet)|or not)\b/;
const HEDGE_QUESTION = /^(?:should|would|could i|is it|do you|can i)\b/;

type Tok = { w: string; nums?: number[] };

interface Scope {
  ctx: ReaderContext;
  slots: PhotoSlot[];
  count: number;
  own: number;
  target: string | null;
  draftMode: boolean;
}

interface Flags { otherOwner: boolean; codeTyped: boolean; byLooks: boolean }

interface PartReading {
  masks: number[];
  base: number | null;
  excluded: number;
  exact: number;
  wantsSet: boolean;
  why: PickWhy | null;
  content: string[];
  contentMatched: boolean;
  marker: boolean;
}

interface Resolved { result: PhotoPickResult; wantsSet: boolean; why: PickWhy; hadFeature: boolean }

function photoWithdrawRequest(text: string): boolean {
  const t = text.replace(/[’‘`´]/g, "'").toLowerCase();
  return /\b(?:don'?t|dont|do not|never|stop|cancel|hold off|withdraw|take back|unsend|changed my mind|scratch)\b/.test(t)
    && /\b(?:photos?|pics?|pictures?|selfies?)\b/.test(t);
}

function normalized(text: string): string {
  return text.normalize("NFKC").toLowerCase()
    .replace(/[‘’‛`´]/g, "'").replace(/[“”]/g, "\"")
    .replace(/\s+/g, " ").trim().replace(/[.!\s]+$/, "");
}

function wordsOf(t: string): string[] {
  return t.replace(/,/g, " , ").replace(/&/g, " & ").split(" ")
    .map(w => w.replace(/^["'(\[]+/, "").replace(/["')\]?:;.!]+$/, ""))
    .filter(Boolean);
}

const bit = (n: number, count: number): number => (n >= 1 && n <= count ? 2 ** (n - 1) : 0);
const plain = (w: string): string => (w.endsWith("'s") ? w.slice(0, -2) : w);

const numbersOf = (mask: number): number[] => maskNumbers(mask, photoSlotsMax);

function maskOf(s: Scope, keep: (p: PhotoSlot) => boolean): number {
  return numbersMask(s.slots.filter(p => keep(p) && bit(p.n, s.count) > 0).map(p => p.n));
}

function stableMask(s: Scope, nums: number[]): number {
  if (nums.some(n => n < 1 || n > s.count)) return 0;
  return [...new Set(nums)].reduce((m, n) => m + bit(n, s.count), 0);
}

function sharedWith(s: Scope, memberId: string | null): number {
  return memberId === null ? 0 : maskOf(s, p => p.sharedWith.includes(memberId));
}

function numberLists(words: string[]): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const glued = /^#(\d{1,2})$/.exec(w);
    const next = NUMERAL.exec(words[i + 1] ?? "");
    let j: number;
    const nums: number[] = [];
    if (glued) { nums.push(Number(glued[1])); j = i + 1; }
    else if (NUM_PREFIX.has(w) && next) { nums.push(Number(next[1])); j = i + 2; }
    else { out.push({ w }); continue; }
    for (;;) {
      const joined = [",", "and", "&"].includes(words[j] ?? "");
      const more = NUMERAL.exec(words[joined ? j + 1 : j] ?? "");
      if (!more) break;
      nums.push(Number(more[1]));
      j += joined ? 2 : 1;
    }
    out.push({ w: "#", nums });
    i = j - 1;
  }
  return out;
}

export function localDay(ms: number, timeZone: string): { y: number; m: number; d: number; n: number } {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms)).split("-").map(Number) as [number, number, number];
  return { y, m, d, n: Math.floor(Date.UTC(y, m - 1, d) / DAY) };
}

function dateNumber(y: number, m: number, d: number): number | null {
  const at = new Date(Date.UTC(y, m - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === m - 1 && at.getUTCDate() === d ? Math.floor(at.getTime() / DAY) : null;
}

const weekdayOf = (n: number): number => (((n + 4) % 7) + 7) % 7;
const span = (from: number, to: number): number[] => Array.from({ length: Math.max(0, to - from + 1) }, (_, k) => from + k);

function dayAt(t: Tok[], i: number, s: Scope): { days: number[]; len: number } | null {
  const word = (k: number) => (t[i + k]?.nums ? "" : plain(t[i + k]?.w ?? ""));
  const today = localDay(s.ctx.now, s.ctx.timeZone);
  const wd = weekdayOf(today.n);
  const onOrBefore = (day: number) => today.n - ((wd - day + 7) % 7);
  const saturday = onOrBefore(6);
  const weekend = (sat: number) => (sat + 1 <= today.n ? [sat, sat + 1] : [sat]);
  const monday = today.n - ((wd + 6) % 7);
  const dayToken = (w: string, suffix: boolean) => {
    const m = (suffix ? /^(\d{1,2})(?:st|nd|rd|th)$/ : /^(\d{1,2})(?:st|nd|rd|th)?$/).exec(w);
    return m && Number(m[1]) >= 1 && Number(m[1]) <= 31 ? Number(m[1]) : null;
  };
  const dated = (m: number, d: number) => {
    const here = dateNumber(today.y, m, d);
    const day = here !== null && here <= today.n ? here : dateNumber(today.y - 1, m, d);
    return day === null ? [] : [day];
  };
  const a = word(0), b = word(1);
  if (a === "today" || a === "tonight") return { days: [today.n], len: 1 };
  if (a === "yesterday") return { days: [today.n - 1], len: 1 };
  if ((a === "this" || a === "last") && b === "week") return { days: a === "this" ? span(monday, today.n) : span(monday - 7, monday - 1), len: 2 };
  if ((a === "this" || a === "last") && b === "weekend")
    return { days: a === "last" && (wd === 6 || wd === 0) ? [saturday - 7, saturday - 6] : weekend(saturday), len: 2 };
  if (a === "weekend") return { days: weekend(saturday), len: 1 };
  if (a === "last" && WEEKDAYS.has(b)) {
    const recent = today.n - (((wd - WEEKDAYS.get(b)! + 7) % 7) || 7);
    return { days: [recent, recent - 7], len: 2 };
  }
  if (a === "this" && WEEKDAYS.has(b)) return { days: [onOrBefore(WEEKDAYS.get(b)!)], len: 2 };
  if (WEEKDAYS.has(a)) return { days: [onOrBefore(WEEKDAYS.get(a)!)], len: 1 };
  if (MONTHS.has(a)) {
    const d = dayToken(b, false);
    if (d !== null) return { days: dated(MONTHS.get(a)!, d), len: 2 };
  }
  const first = dayToken(a, false);
  if (first !== null) {
    const k = b === "of" ? 2 : 1;
    const month = MONTHS.get(word(k));
    if (month !== undefined) return { days: dated(month, first), len: k + 1 };
  }
  if ((a === "from" || a === "on") && b === "the") {
    const d = dayToken(word(2), true);
    if (d !== null) {
      const here = dateNumber(today.y, today.m, d);
      const back = today.m === 1 ? dateNumber(today.y - 1, 12, d) : dateNumber(today.y, today.m - 1, d);
      const day = d <= today.d ? here : back;
      return { days: day === null ? [] : [day], len: 3 };
    }
  }
  const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(a);
  if (slash) {
    const x = Number(slash[1]), y = Number(slash[2]);
    const [m, d] = x > 12 ? [y, x] : [x, y];
    return { days: m >= 1 && m <= 12 ? dated(m, d) : [], len: 1 };
  }
  return null;
}

function threadNamed(s: Scope, w: string): ReaderThread | undefined {
  return s.ctx.threads.find(th => normalized(th.firstName).split(" ")[0] === w);
}

function labelWords(label: string): string[] {
  return label.toLowerCase().split(/[ -]+/).filter(Boolean);
}

function editsAtMostOne(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function wordMatches(said: string, named: string): boolean {
  return said === named || (said.endsWith("s") && said.slice(0, -1) === named) || (said.length >= 5 && editsAtMostOne(said, named));
}

function labelMasks(s: Scope, content: string[]): { mask: number; exact: number } {
  let mask = 0, exact = 0;
  for (const p of s.slots) {
    if (!p.label) continue;
    const named = labelWords(p.label);
    if (!content.every(c => named.some(l => wordMatches(c, l)))) continue;
    mask += bit(p.n, s.count);
    if (named.every(l => content.some(c => wordMatches(c, l)))) exact += bit(p.n, s.count);
  }
  return { mask, exact };
}

function batchMask(s: Scope, newest: boolean): { mask: number; at: number } {
  if (!s.slots.length) return { mask: 0, at: 0 };
  const pick = s.slots.reduce((x, p) => ((newest ? p.addedAt >= x.addedAt : p.addedAt < x.addedAt) ? p : x));
  return { mask: maskOf(s, p => p.batch === pick.batch), at: Math.max(...s.slots.filter(p => p.batch === pick.batch).map(p => p.addedAt)) };
}

function positionMask(s: Scope, position: number): number {
  const draft = s.ctx.draft;
  if (draft?.listed) {
    const at = position > 0 ? position - 1 : draft.shown.length + position;
    const n = draft.shown[at];
    return n === undefined ? 0 : bit(n, s.count);
  }
  return bit(position > 0 ? position : s.count + 1 + position, s.count);
}

function middleMask(s: Scope): number {
  const draft = s.ctx.draft;
  const list = draft?.listed ? draft.shown : Array.from({ length: s.count }, (_, k) => k + 1);
  if (!list.length) return 0;
  const half = Math.floor(list.length / 2);
  const picks = list.length % 2 === 1 ? [list[half]!] : [list[half - 1]!, list[half]!];
  return picks.reduce((m, n) => m + bit(n, s.count), 0);
}

function draftMask(s: Scope, nums: number[]): number {
  return [...new Set(nums)].reduce((m, n) => m + bit(n, s.count), 0);
}

function readPart(t: Tok[], s: Scope, negation = true): PartReading {
  const r: PartReading = { masks: [], base: null, excluded: 0, exact: 0, wantsSet: false, why: null, content: [], contentMatched: false, marker: false };
  const note = (why: PickWhy) => { r.why ??= why; };
  const draft = s.ctx.draft;
  const word = (k: number) => (t[k]?.nums ? "" : (t[k]?.w ?? ""));
  const other = (another: boolean) => {
    r.base = draft?.shown.length ? draftMask(s, draft.shown) : s.own;
    r.excluded = r.excluded | (draft ? draftMask(s, draft.proposed) : 0) | (another ? sharedWith(s, s.target) : 0);
    note("other");
  };
  const everything = () => {
    r.base = draft?.shown.length ? draftMask(s, draft.shown) : s.own;
    r.wantsSet = true;
    note("all");
  };
  for (let i = 0; i < t.length;) {
    const tok = t[i]!;
    if (tok.nums) {
      r.masks.push(stableMask(s, tok.nums));
      if (tok.nums.length > 1) r.wantsSet = true;
      r.marker = true;
      note("ordinal");
      i++;
      continue;
    }
    const day = dayAt(t, i, s);
    if (day) {
      r.masks.push(maskOf(s, p => day.days.includes(localDay(p.addedAt, s.ctx.timeZone).n)));
      note("date");
      i += day.len;
      continue;
    }
    const w = tok.w, w1 = word(i + 1), w2 = word(i + 2);
    if (s.draftMode && /^\d{1,2}$/.test(w)) { r.masks.push(stableMask(s, [Number(w)])); note("ordinal"); i++; continue; }
    if ((w === "second" || w === "next") && w1 === "to" && w2 === "last") { r.masks.push(positionMask(s, -2)); note("ordinal"); i += 3; continue; }
    if (w === "second" && w1 === "last") { r.masks.push(positionMask(s, -2)); note("ordinal"); i += 2; continue; }
    const ordinal = ORDINALS.get(w) ?? (/^(\d{1,2})(?:st|nd|rd|th)$/.exec(w) ? Number(/^(\d{1,2})/.exec(w)![1]) : undefined);
    if (ordinal !== undefined) { r.masks.push(positionMask(s, ordinal)); note("ordinal"); i++; continue; }
    if (w === "last" || w === "final") { r.masks.push(positionMask(s, -1)); note("ordinal"); i++; continue; }
    if (w === "middle") { r.masks.push(middleMask(s)); note("ordinal"); i++; continue; }
    if (w === "just" && RECENT_VERBS.has(w1)) { r.masks.push(batchMask(s, true).mask); note("recency"); i += 2; continue; }
    if (w === "most" && w1 === "recent") { r.masks.push(batchMask(s, true).mask); note("recency"); i += 2; continue; }
    if (w === "newest" || w === "latest" || w === "recent") { r.masks.push(batchMask(s, true).mask); note("recency"); i++; continue; }
    if (w === "oldest" || w === "earliest") { r.masks.push(batchMask(s, false).mask); note("recency"); i++; continue; }
    if (!draft && (w === "this" || (w === "that" && (w1 === "one" || NOUNS.has(w1))))) {
      const newest = batchMask(s, true);
      if (newest.mask && s.ctx.now - newest.at < THIS_BATCH_MS) { r.masks.push(newest.mask); note("this"); }
      i++;
      continue;
    }
    const holder = w === "her" || w === "him" || w === "them" ? s.ctx.threads.find(th => th.recipientMemberId === s.target) : threadNamed(s, w);
    if (holder && (HAS_WORDS.has(w1) || (w1 === "already" && HAS_WORDS.has(w2)))) {
      r.masks.push(sharedWith(s, holder.recipientMemberId));
      note("has");
      i += w1 === "already" ? 3 : 2;
      continue;
    }
    const sentTo = w === "sent" ? threadNamed(s, w1) : undefined;
    if (sentTo) { r.masks.push(sharedWith(s, sentTo.recipientMemberId)); note("has"); i += 2; continue; }
    if (w === "not" && (w1 === "that" || w1 === "this") && (w2 === "one" || NOUNS.has(w2))) { other(false); i += 3; continue; }
    if (w === "another") { other(true); i += w1 === "one" ? 2 : 1; continue; }
    if ((w === "different" || w === "other") && (w1 === "one" || NOUNS.has(w1))) { other(false); i += 2; continue; }
    if (negation && (w === "not" || w === "without" || w === "except")) {
      const ref = readPart(t.slice(i + 1), s, false);
      const named = refMask(ref, s);
      if (named !== null) {
        r.excluded = r.excluded | named;
        r.base = draft?.proposed.length ? draftMask(s, draft.proposed) : draft?.shown.length ? draftMask(s, draft.shown) : s.own;
        if (draft) r.wantsSet = draft.wantsSet;
        r.marker = r.marker || ref.marker;
        note("other");
        i = t.length;
        continue;
      }
      i++;
      continue;
    }
    if (w === "all" && w1 === "of" && w2 === "them") { everything(); i += 3; continue; }
    if (w === "all" || w === "every" || w === "everything" || w === "each") { everything(); i++; continue; }
    if (w === "both") {
      const pair = draft?.shown.length === 2 ? draft.shown : draft?.proposed.length === 2 ? draft.proposed : s.count === 2 ? [1, 2] : null;
      r.wantsSet = true;
      if (pair) { r.base = draftMask(s, pair); note("all"); }
      i += w1 === "of" && w2 === "them" ? 3 : 1;
      continue;
    }
    if (PLURALS.has(w) || w === "ones") { r.wantsSet = true; r.marker = true; i++; continue; }
    if (NOUNS.has(w) || w === "one") { r.marker = true; i++; continue; }
    const content = plain(w);
    if (/^[a-z0-9][a-z0-9'-]*$/.test(content) && !STOP.has(content) && !FILLER.has(content) && !VERBS.has(content) && !AUX.has(content) && !/^\d+$/.test(content)) r.content.push(content);
    i++;
  }
  if (r.content.length) {
    const named = labelMasks(s, r.content);
    r.contentMatched = named.mask !== 0;
    if (s.draftMode && !r.contentMatched && !r.marker && r.masks.length === 0 && r.base === null) r.content = [];
    else {
      r.masks.push(named.mask);
      r.exact = named.exact;
      if (r.contentMatched) note("label");
      else r.why = "content";
    }
  }
  return r;
}

function refMask(r: PartReading, s: Scope): number | null {
  if (!r.masks.length) return null;
  return r.masks.reduce((m, x) => m & x, s.own);
}

function featured(r: PartReading): boolean {
  return r.masks.length > 0 || r.base !== null;
}

function candidatesOf(r: PartReading, s: Scope): number {
  return r.masks.reduce((m, x) => m & x, s.own) & (r.base ?? s.own);
}

function flagsOf(phrase: string, original: string, s: Scope): Flags {
  const possessive = [...phrase.matchAll(/\b([a-z]+)'s\b/g)].some(m => !NOT_OWNERS.has(m[1]!) && !MONTHS.has(m[1]!));
  const otherPossessive = /\b(?:his|her|their|your)\s+(?:photos?|pics?|pictures?|selfies?|images?)\b/.test(phrase);
  const sentMe = [...phrase.matchAll(/\b([a-z]+) sent me\b/g)].some(m => m[1] !== "i" && m[1] !== "you");
  const ofName = [...phrase.matchAll(/\bof ([a-z]+)\b/g)].some(m => ["her", "him", "them"].includes(m[1]!) || threadNamed(s, m[1]!) !== undefined)
    || [...original.normalize("NFKC").matchAll(/\bof ([A-Z][a-z]+)\b(?! [A-Z])/g)].some(m => {
      const w = m[1]!.toLowerCase();
      return !["me", "myself", "us"].includes(w) && !WEEKDAYS.has(w) && !MONTHS.has(w) && phrase.includes(w)
        && !s.ctx.photos.some(p => p.label !== null && labelWords(p.label).includes(w));
    });
  return {
    otherOwner: possessive || otherPossessive || sentMe || ofName,
    codeTyped: CODES.some(re => re.test(phrase)),
    byLooks: LOOKS.test(phrase),
  };
}

function resolve(words: string[], s: Scope, flags: Flags, recipients: number): Resolved {
  const toks = numberLists(words);
  const groups: Tok[][] = [[]];
  let alternatives = false;
  for (const tok of toks) {
    if (!tok.nums && (tok.w === "and" || tok.w === "," || tok.w === "&" || tok.w === "or")) {
      if (tok.w === "or") alternatives = true;
      groups.push([]);
    } else groups[groups.length - 1]!.push(tok);
  }
  const read = groups.map(g => readPart(g, s));
  const parts = read.filter(featured);
  const wantsSet = read.some(r => r.wantsSet);
  const shared = sharedWith(s, s.target);
  const pick = (hadFeature: boolean, wants: boolean, candidates: number, exact: number, excluded: number) =>
    photoPickFor(true, flags.otherOwner, flags.codeTyped, flags.byLooks, recipients, s.count, hadFeature, wants, candidates, exact, excluded, shared);
  if (parts.length <= 1) {
    const r = parts[0];
    if (!r) return { result: pick(false, wantsSet, 0, 0, 0), wantsSet, why: "list", hadFeature: false };
    return { result: pick(true, r.wantsSet, candidatesOf(r, s), r.exact, r.excluded), wantsSet: r.wantsSet, why: r.why ?? "list", hadFeature: true };
  }
  const each = parts.map(r => ({ r, result: pick(true, false, candidatesOf(r, s), r.exact, r.excluded) }));
  const excluded = parts.reduce((m, r) => m | r.excluded, 0);
  if (!alternatives && each.every(e => e.result.pick === "ProposePhotos")) {
    const union = each.reduce((m, e) => m | e.result.chosen, 0);
    return { result: pick(true, true, union, 0, excluded), wantsSet: true, why: "and", hadFeature: true };
  }
  const open = each.reduce((m, e) => m | (candidatesOf(e.r, s) & ~e.r.excluded), 0);
  return { result: pick(true, false, open, 0, excluded), wantsSet: false, why: "and", hadFeature: true };
}

function scopeOf(ctx: ReaderContext, target: string | null, draftMode: boolean): Scope {
  const slots = ctx.photos.filter(p => p.n >= 1 && p.n <= photoSlotsMax).sort((a, b) => a.n - b.n);
  const count = Math.min(ctx.photos.length, photoSlotsMax);
  return { ctx, slots, count, own: count <= 0 ? 0 : 2 ** count - 1, target, draftMode };
}

function liveTarget(ctx: ReaderContext): Target {
  const current = ctx.threads.find(th => th.threadId === ctx.currentThreadId);
  if (current) return { kind: "one", thread: current };
  if (ctx.threads.length === 1) return { kind: "one", thread: ctx.threads[0]! };
  return { kind: "ask", recipients: ctx.threads.length };
}

function nameish(w: string, ctx: ReaderContext): boolean {
  return /^[a-z][a-z'-]+$/.test(w) && !STOP.has(w) && !FILLER.has(w) && !VERBS.has(w) && !AUX.has(w) && !NUM_PREFIX.has(w) && !ORDINALS.has(w)
    && !DAY_WORDS.has(w) && !MONTHS.has(w) && !w.endsWith("'s")
    && !["all", "both", "every", "everything", "another", "last", "final", "middle", "newest", "latest", "oldest", "earliest", "recent", "most", "next", "other", "different", "not", "without", "except", "over", "back", "out", "again", "something"].includes(w)
    && !ctx.photos.some(p => p.label !== null && labelWords(p.label).includes(w));
}

function targetAt(words: string[], i: number, ctx: ReaderContext, unknown: boolean): { target: Target; len: number } | null {
  const a = words[i] ?? "", b = words[i + 1] ?? "", c = words[i + 2] ?? "";
  if (a === "her" || a === "him" || a === "them") return { target: liveTarget(ctx), len: 1 };
  if (a === "my" && (b === "match" || b === "date")) return { target: liveTarget(ctx), len: 2 };
  if (a === "everyone" || a === "everybody") return { target: { kind: "ask", recipients: 2 }, len: 1 };
  if (a === "all" && b === "my" && c === "matches") return { target: { kind: "ask", recipients: 2 }, len: 3 };
  if ((a === "both" || a === "all") && b === "of" && c === "them") return { target: { kind: "ask", recipients: 2 }, len: 3 };
  const s = scopeOf(ctx, null, false);
  const known = threadNamed(s, a);
  const isName = known !== undefined || (unknown && nameish(a, ctx));
  if (!isName) return null;
  if ((b === "and" || b === "&") && (threadNamed(s, c) !== undefined || nameish(c, ctx))) return { target: { kind: "ask", recipients: 2 }, len: 3 };
  return { target: known ? { kind: "one", thread: known } : { kind: "ask", recipients: 0 }, len: 1 };
}

function contentWords(phrase: string[]): string[] {
  return phrase.map(plain).filter(w => /^[a-z0-9][a-z0-9'-]*$/.test(w) && !STOP.has(w) && !FILLER.has(w) && !VERBS.has(w) && !AUX.has(w) && !/^\d+$/.test(w));
}

function namesOneLabel(phrase: string[], ctx: ReaderContext): boolean {
  const content = contentWords(phrase);
  return content.length > 0 && ctx.photos.some(p => {
    if (p.label === null) return false;
    const named = labelWords(p.label);
    return content.every(c => named.some(l => wordMatches(c, l))) && named.every(l => content.some(c => wordMatches(c, l)));
  });
}

function hasMarker(phrase: string[], ctx: ReaderContext): boolean {
  return phrase.some(w => NOUNS.has(w) || PLURALS.has(w) || w === "one" || w === "ones" || /^#\d/.test(w)) || CODES.some(re => re.test(phrase.join(" ")))
    || namesOneLabel(phrase, ctx);
}

function cutAlsoText(phrase: string[]): { phrase: string[]; alsoText: boolean } {
  const k = phrase.findIndex((w, i) => w === "and" && ["tell", "ask", "say", "let"].includes(phrase[i + 1] ?? ""));
  return k < 0 ? { phrase, alsoText: false } : { phrase: phrase.slice(0, k), alsoText: true };
}

const PHOTO_REQUEST = "send them this photo";
function markedLength(phrase: string[]): number {
  const first = phrase.findIndex(w => NOUNS.has(w) || PLURALS.has(w) || w === "one" || w === "ones" || /^#\d/.test(w) || CODES.some(re => re.test(w)));
  return first < 0 ? phrase.length : first + 1;
}
function asPhotoRequest(t: string, region: string[]): string {
  const span = new RegExp(region.map(w => w.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")).join(String.raw`[\s,;:'"()\[\]?.!]*`)).exec(t);
  return span ? t.slice(0, span.index) + PHOTO_REQUEST + t.slice(span.index + span[0].length) : t;
}

function sendOf(t: string, original: string, ctx: ReaderContext): PhotoReading | null {
  const words = wordsOf(t);
  for (let v = 0; v < words.length; v++) {
    if (!VERBS.has(words[v]!)) continue;
    const options: { target: Target; phrase: string[]; alsoText: boolean; end: number }[] = [];
    const after = (at: number, target: Target) => { const cut = cutAlsoText(words.slice(at)); return { target, ...cut, end: at + markedLength(cut.phrase) }; };
    const direct = targetAt(words, v + 1, ctx, false);
    if (direct) options.push(after(v + 1 + direct.len, direct.target));
    if (TO_VERBS.has(words[v]!)) {
      for (let w = words.length - 2; w > v; w--) {
        if (words[w] !== "to" && words[w] !== "with") continue;
        const to = targetAt(words, w + 1, ctx, true);
        if (!to) continue;
        const rest = words.slice(w + 1 + to.len);
        if (rest.length && !cutAlsoText(rest).alsoText && rest[0] !== "please" && rest[0] !== "now") continue;
        options.push({ target: to.target, phrase: cutAlsoText(words.slice(v + 1, w)).phrase, alsoText: cutAlsoText(rest).alsoText || cutAlsoText(words.slice(v + 1, w)).alsoText, end: w + 1 + to.len });
        break;
      }
    }
    const loose = direct ? null : targetAt(words, v + 1, ctx, true);
    if (loose) options.push(after(v + 1 + loose.len, loose.target));
    const chosen = options.find(o => hasMarker(o.phrase, ctx));
    if (!chosen) continue;
    if (!relayPhotoReferenceAllowed(asPhotoRequest(t, words.slice(v, chosen.end)))) return NONE;
    const target = chosen.target.kind === "one" ? chosen.target.thread.recipientMemberId : null;
    const s = scopeOf(ctx, target, false);
    const phraseText = chosen.phrase.join(" ");
    const recipients = chosen.target.kind === "one" ? 1 : chosen.target.recipients;
    const r = resolve(chosen.phrase, s, flagsOf(phraseText, original, s), recipients);
    return { kind: "send", target: chosen.target, result: r.result, numbers: numbersOf(r.result.chosen), wantsSet: r.wantsSet, why: r.why, alsoText: chosen.alsoText };
  }
  return null;
}

function otherRecipient(words: string[], ctx: ReaderContext, draft: ReaderDraft): { target: Target; at: number; len: number } | null {
  const verb = words.some(w => VERBS.has(w));
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!, next = words[i + 1] ?? "";
    if (w === "her" || w === "him" || w === "them" || (w === "my" && (next === "match" || next === "date"))) continue;
    if ((w === "both" || w === "all") && next === "of") { i += 2; continue; }
    if (HAS_WORDS.has(next) || (next === "already" && HAS_WORDS.has(words[i + 2] ?? "")) || words[i - 1] === "sent") continue;
    const after = RECIPIENT_PREPS.has(words[i - 1] ?? "");
    const found = targetAt(words, i, ctx, after && verb);
    if (!found) continue;
    if (found.target.kind === "one" && found.target.thread.recipientMemberId === draft.recipientMemberId) continue;
    const target: Target = found.target.kind === "one" && !after && !verb ? { kind: "ask", recipients: 2 } : found.target;
    return { target, at: i, len: found.len };
  }
  return null;
}

function redirectOf(words: string[], original: string, ctx: ReaderContext, draft: ReaderDraft): PhotoReading | null {
  const found = otherRecipient(words, ctx, draft);
  if (!found) return null;
  const from = RECIPIENT_PREPS.has(words[found.at - 1] ?? "") ? found.at - 1 : found.at;
  const phrase = [...words.slice(0, from), ...words.slice(found.at + found.len)].filter(w => !VERBS.has(w) && !AUX.has(w));
  const target = found.target;
  const recipients = target.kind === "one" ? 1 : target.recipients;
  const s = scopeOf(ctx, target.kind === "one" ? target.thread.recipientMemberId : null, true);
  const said = flagsOf(phrase.join(" "), original, s);
  const marked = hasMarker(phrase, ctx);
  const flags: Flags = { otherOwner: said.otherOwner && marked, codeTyped: said.codeTyped, byLooks: said.byLooks && marked };
  const r = resolve(phrase, s, flags, recipients);
  const result = r.hadFeature || !draft.proposed.length || draft.recipientMemberId === null ? r.result
    : photoPickFor(true, flags.otherOwner, flags.codeTyped, flags.byLooks, recipients, s.count, true, draft.wantsSet, draftMask(s, draft.proposed), 0, 0, sharedWith(s, s.target));
  return { kind: "send", target, result, numbers: numbersOf(result.chosen), wantsSet: r.hadFeature ? r.wantsSet : draft.wantsSet, why: r.hadFeature ? r.why : "this", alsoText: false };
}

function draftOf(t: string, original: string, ctx: ReaderContext, draft: ReaderDraft): PhotoReading {
  const words = wordsOf(t);
  let k = 0;
  while (k < words.length && LEADING.has(words[k]!)) k++;
  const redirected = redirectOf(words.slice(k), original, ctx, draft);
  if (redirected) return redirected;
  const phrase = words.slice(k).filter(w => !VERBS.has(w) && !AUX.has(w));
  const s = scopeOf(ctx, draft.recipientMemberId, true);
  const said = flagsOf(phrase.join(" "), original, s);
  const marked = hasMarker(phrase, ctx);
  const flags: Flags = { otherOwner: said.otherOwner && marked, codeTyped: said.codeTyped, byLooks: said.byLooks && marked };
  const r = resolve(phrase, s, flags, 1);
  const hasReference = r.hadFeature || flags.otherOwner || flags.codeTyped || flags.byLooks;
  const answer = classifyYesNo(original);
  const yes = !hasReference && answer === "yes";
  const no = answer === "no" || /^(?:no|nope|never ?mind|cancel)$/.test(t);
  if (!hasReference && !yes && !no) return NONE;
  return { kind: "draft", hasReference, yes, no, result: hasReference ? r.result : null, numbers: hasReference ? numbersOf(r.result.chosen) : [], wantsSet: r.wantsSet, why: r.why };
}

function holdingsOf(t: string, ctx: ReaderContext): PhotoReading | null {
  const h = t.replace(/\?+$/, "").replace(/ please$/, "").trim();
  if (/^(?:(?:show|list|see)(?: me)? )?my (?:photos|pics|pictures)$/.test(h)
    || /^(?:what|which) (?:photos|pics|pictures) (?:do you have|have you got)(?: of me)?$/.test(h)
    || /^who (?:has|can see|has seen) my (?:photos|pics|pictures)$/.test(h)) return { kind: "holdings", firstName: null };
  const named = /^which (?:photos|pics|pictures) (?:has|did) ([a-z]+) (?:seen|see|got|get)$/.exec(h);
  if (!named) return null;
  return { kind: "holdings", firstName: threadNamed(scopeOf(ctx, null, false), named[1]!)?.firstName ?? null };
}

function refEnds(ref: string[]): boolean {
  const last = ref[ref.length - 1] ?? "";
  const before = ref[ref.length - 2] ?? "";
  return NOUNS.has(last) || last === "one" || /^#\d{1,2}$/.test(last) || (NUMERAL.test(last) && NUM_PREFIX.has(before));
}

function labelRefusal(label: string, n: number, ctx: ReaderContext): "format" | "taken" | "looks" | null {
  const parts = label.split(/[ -]/);
  const reserved = (w: string) => STOP.has(w) || FILLER.has(w) || ORDINALS.has(w) || WEEKDAYS.has(w) || MONTHS.has(w) || w === "sun"
    || w === "today" || w === "yesterday" || w === "tonight" || w === "last" || w === "final" || w === "middle" || w === "newest"
    || w === "latest" || w === "oldest" || w === "earliest" || /^\d{1,2}(?:st|nd|rd|th)$/.test(w);
  if (!/^[a-z0-9]+(?:[ -][a-z0-9]+){0,2}$/.test(label) || label.length > LABEL_MAX || /^[0-9 -]+$/.test(label) || parts.some(reserved)) return "format";
  if (LOOKS.test(label) || appearanceLeak(label) !== null) return "looks";
  if (ctx.photos.some(p => p.n !== n && p.label !== null && p.label.toLowerCase() === label)) return "taken";
  return null;
}

function nameOf(t: string, original: string, ctx: ReaderContext): PhotoReading | null {
  const m = /^(?:call|name|label|rename) (.+)$/.exec(t);
  if (!m) return null;
  const words = wordsOf(m[1]!);
  let shaped = false;
  for (let j = 1; j < words.length; j++) {
    const ref = words.slice(0, j);
    if (!refEnds(ref)) continue;
    shaped = true;
    const s = scopeOf(ctx, null, false);
    const r = resolve(ref, s, flagsOf(ref.join(" "), original, s), 1);
    const n = numbersOf(r.result.chosen);
    if (r.wantsSet || n.length !== 1 || (r.result.pick !== "ProposePhotos" && r.result.pick !== "AlreadyShared")) continue;
    const label = words.slice(j).join(" ");
    const refused = labelRefusal(label, n[0]!, ctx);
    return refused ? { kind: "name_refused", reason: refused } : { kind: "name", n: n[0]!, label };
  }
  return shaped ? { kind: "name_refused", reason: "which" } : null;
}

function deleteOf(t: string, original: string, ctx: ReaderContext): PhotoReading | null {
  const m = /^(?:delete|remove) (.+)$/.exec(t);
  if (!m) return null;
  const words = wordsOf(m[1]!);
  const toks = numberLists(words);
  const listed = toks.length === 1 && toks[0]!.nums !== undefined;
  const described = words.length >= 3 && words[0] === "the" && (NOUNS.has(words[words.length - 1]!) || words[words.length - 1] === "one");
  if (!listed && !described) return null;
  const s = scopeOf(ctx, null, false);
  const r = resolve(words, s, flagsOf(words.join(" "), original, s), 1);
  return { kind: "delete", result: r.result, numbers: numbersOf(r.result.chosen) };
}

function takeBackRef(ref: string[], ctx: ReaderContext): boolean {
  return NUMERAL.test(ref[0] ?? "") || hasMarker(ref, ctx);
}

function takeBackOf(t: string, original: string, ctx: ReaderContext): PhotoReading | null {
  const back = /^take back (.+)$/.exec(t);
  const asked = photoWithdrawRequest(t) || /^(?:unsend|take back) (?:it|that|them|those|the photo|the photos)$/.test(t) || /^take (?:it|that|them) back$/.test(t)
    || (back !== null && takeBackRef(wordsOf(back[1]!), ctx));
  if (!asked) return null;
  const words = wordsOf(t);
  let target: Target | null = null;
  const rest: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const found: ReturnType<typeof targetAt> = target || ["all", "both", "everyone", "everybody"].includes(words[i]!) ? null : targetAt(words, i, ctx, false);
    if (found) { target = found.target; i += found.len - 1; continue; }
    const w = words[i]!;
    if (!WITHDRAW.has(w) && !VERBS.has(w) && !AUX.has(w)) rest.push(w);
  }
  const chosen = target ?? liveTarget(ctx);
  const thread = chosen.kind === "one" ? chosen.thread : null;
  const s = scopeOf(ctx, null, false);
  const ref = NUMERAL.test(rest[0] ?? "") ? ["photo", ...rest] : rest;
  const r = resolve(ref, s, flagsOf(ref.join(" "), original, s), 1);
  const named = r.hadFeature && ["ProposePhotos", "AlreadyShared", "ChoosePhotos", "TooManyPhotos"].includes(r.result.pick);
  return { kind: "take_back", threadId: thread?.threadId ?? null, numbers: named ? numbersOf(r.result.chosen) : null };
}

function hedged(t: string): boolean {
  return HEDGE_START.test(t) || HEDGE_WORDS.test(t) || (t.endsWith("?") && HEDGE_QUESTION.test(t));
}

export function readPhotoMessage(text: string, ctx: ReaderContext): PhotoReading {
  const t = normalized(text);
  if (!t) return NONE;
  if (/^photos ok$/.test(t)) return { kind: "photos_ok" };
  if (NO_MORE.test(t)) return { kind: "no_more_photos" };
  const share = parseRelayRequest(text).kind === "contact_share";
  return holdingsOf(t, ctx) ?? nameOf(t, text, ctx) ?? deleteOf(t, text, ctx) ?? takeBackOf(t, text, ctx)
    ?? (hedged(t) || share ? NONE : sendOf(t, text, ctx) ?? (ctx.draft ? draftOf(t, text, ctx, ctx.draft) : NONE));
}
