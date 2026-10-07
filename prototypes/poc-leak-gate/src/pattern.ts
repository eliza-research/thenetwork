// Fix 5 (sketch): cross-message pattern-of-life check (PRD INV-PRIV-10).
// A single message such as "Teodoro can't do Tuesday mornings" is harmless; three of them to the same
// recipient about the same person can add up to a routine ("pool at 6am Tue/Thu") that the recipient
// may not see. The per-message gate cannot see this, so the tracker keeps, per recipient, the
// schedule fragments disclosed about each third party over the last N messages and flags when the
// union reveals a recipient-invisible routine.
//
// Deterministic and in-memory. Production would persist the window per recipient and run record()
// after decide() returned SEND (or before, as a pre-send check via peek()).
import type { GateInput } from "./types.ts";
import { visibility, type OwnedFacet } from "./visibility.ts";

export type Day = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type Part = "morning" | "afternoon" | "evening" | "night";

export interface ScheduleFacts { days: Set<Day>; parts: Set<Part>; times: Set<string>; places: Set<string>; recurring: boolean }

// Full day names case-insensitive; abbreviations only capitalized ("Sat", not "sat"; "Sun", not "sun").
const DAY_RE: [RegExp, Day[]][] = [
  [/\b[Mm]ondays?\b|\bMon\b/, ["mon"]], [/\b[Tt]uesdays?\b|\bTues?\b/, ["tue"]], [/\b[Ww]ednesdays?\b|\bWed\b/, ["wed"]], [/\b[Tt]hursdays?\b|\bThu(rs?)?\b/, ["thu"]],
  [/\b[Ff]ridays?\b|\bFri\b/, ["fri"]], [/\b[Ss]aturdays?\b|\bSat\b/, ["sat"]], [/\b[Ss]undays?\b|\bSun\b/, ["sun"]],
  [/\bweekdays?\b/i, ["mon", "tue", "wed", "thu", "fri"]], [/\bweekends?\b/i, ["sat", "sun"]],
];
const PART_RE: [RegExp, Part][] = [[/\bmornings?\b|\bbefore work\b|\bsunrise\b/i, "morning"], [/\bafternoons?\b|\blunch(time)?\b/i, "afternoon"], [/\bevenings?\b|\bafter work\b/i, "evening"], [/\bnights?\b/i, "night"]];
const TIME_RE = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b(\d{1,2}):(\d{2})\b/gi;
const PLACE_RE = /\b(pool|gym|laundromat|school|rec center|church|clinic|meetings?|class(es)?|studio|track|dog run|daycare|pickup)\b/gi;
const RECURRING_RE = /\b(every|each|usually|always|regularly|routinely|weekly|most (mornings|evenings|nights|days|weeks|weekdays)|standing|religiously|like clockwork|keeps? [^.!?]{0,30}\b(clear|free|blocked)|never (free|available)|three times a week|twice a week|\b(mon|tues|wednes|thurs|fri|satur|sun|week)days\b)/i;

/** Schedule fragments in a piece of text: days, parts of day, clock times, routine places, recurrence words. */
export function extractSchedule(text: string): ScheduleFacts {
  const days = new Set<Day>(), parts = new Set<Part>(), times = new Set<string>(), places = new Set<string>();
  for (const [re, ds] of DAY_RE) if (re.test(text)) for (const d of ds) days.add(d);
  for (const [re, p] of PART_RE) if (re.test(text)) parts.add(p);
  for (const m of text.matchAll(TIME_RE)) {
    let h = Number(m[1] ?? m[4]); const min = m[2] ?? m[5] ?? "00"; const ap = m[3]?.toLowerCase();
    if (ap === "pm" && h < 12) h += 12; if (ap === "am" && h === 12) h = 0;
    times.add(`${String(h).padStart(2, "0")}:${min}`);
    parts.add(h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night");
  }
  for (const m of text.matchAll(PLACE_RE)) places.add(m[0].toLowerCase().replace(/s$/, "").replace(/^class(e)?$/, "class"));
  // A bare plural day ("Tuesdays") is recurring; a singular one ("Tuesday") is a one-off plan.
  const recurring = RECURRING_RE.test(text.replace(/\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/gi, ""));
  return { days, parts, times, places, recurring };
}

const empty = (): ScheduleFacts => ({ days: new Set(), parts: new Set(), times: new Set(), places: new Set(), recurring: false });
function union(a: ScheduleFacts, b: ScheduleFacts): ScheduleFacts {
  return { days: new Set([...a.days, ...b.days]), parts: new Set([...a.parts, ...b.parts]), times: new Set([...a.times, ...b.times]), places: new Set([...a.places, ...b.places]), recurring: a.recurring || b.recurring };
}
const inter = <T>(a: Set<T>, b: Set<T>) => [...a].filter(x => b.has(x));
const minus = <T>(a: Set<T>, b: Set<T>) => new Set([...a].filter(x => !b.has(x)));

/** Sentences of `text` attributed to each named third party (pronoun sentences inherit the last named person). */
export function attribute(text: string, people: { id: string; first: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let last: string | undefined;
  for (const s of text.split(/(?<=[.!?\n])\s+/)) {
    const named = people.filter(p => new RegExp(`\\b${p.first}\\b`).test(s));
    if (named.length === 1) last = named[0]!.id;
    else if (named.length > 1) { last = undefined; continue; } // ambiguous: skip
    else if (!/\b(he|she|they|him|her|them|his|their)\b/i.test(s)) { last = undefined; continue; }
    if (last) (out.get(last) ?? out.set(last, []).get(last)!).push(s);
  }
  return out;
}

interface Entry { messageId: string; at: number; subjectId: string; facts: ScheduleFacts; sentences: string[] }

export interface PatternAlert {
  recipientId: string;
  subjectId: string;
  subjectName: string;
  /** routine_match: the union matches a recipient-invisible routine/availability facet; recurring_pattern: a recurring weekly pattern beyond what the recipient can see. */
  kind: "routine_match" | "recurring_pattern";
  /** True when no single message in the window revealed it alone. */
  crossMessage: boolean;
  messageIds: string[];
  detail: string;
}

export interface PatternOptions { windowMessages?: number; windowMs?: number }

export class PatternTracker {
  private log = new Map<string, Entry[]>(); // recipientId -> entries, oldest first
  private msgCount = new Map<string, string[]>(); // recipientId -> message ids, oldest first
  constructor(private o: PatternOptions = {}) {}

  /** Records a message sent to input.recipientId and returns alerts for the updated window. */
  record(input: GateInput, messageId: string, at: number): PatternAlert[] {
    const entries = this.entriesFor(input, messageId, at);
    const log = this.log.get(input.recipientId) ?? [];
    log.push(...entries);
    this.log.set(input.recipientId, log);
    const ids = this.msgCount.get(input.recipientId) ?? [];
    ids.push(messageId); this.msgCount.set(input.recipientId, ids);
    this.prune(input.recipientId, at);
    return this.evaluate(input);
  }

  /** Alerts the window would have if this draft were sent (pre-send check); does not record it. */
  peek(input: GateInput, messageId: string, at: number): PatternAlert[] {
    const saved = this.log.get(input.recipientId)?.slice(), savedIds = this.msgCount.get(input.recipientId)?.slice();
    try { return this.record(input, messageId, at); }
    finally {
      if (saved) this.log.set(input.recipientId, saved); else this.log.delete(input.recipientId);
      if (savedIds) this.msgCount.set(input.recipientId, savedIds); else this.msgCount.delete(input.recipientId);
    }
  }

  private entriesFor(input: GateInput, messageId: string, at: number): Entry[] {
    const people = input.members.filter(m => m.id !== input.recipientId).map(m => ({ id: m.id, first: m.name.split(/\s+/)[0]! }));
    return [...attribute(input.draft, people)].map(([subjectId, sentences]) => ({ messageId, at, subjectId, sentences, facts: extractSchedule(sentences.join(" ")) }));
  }

  private prune(recipientId: string, now: number) {
    const n = this.o.windowMessages ?? 10;
    const ids = this.msgCount.get(recipientId)!;
    while (ids.length > n) ids.shift();
    const keep = new Set(ids);
    this.log.set(recipientId, this.log.get(recipientId)!.filter(e => keep.has(e.messageId) && (this.o.windowMs === undefined || now - e.at <= this.o.windowMs)));
  }

  private evaluate(input: GateInput): PatternAlert[] {
    const vis = visibility(input);
    const alerts: PatternAlert[] = [];
    const bySubject = new Map<string, Entry[]>();
    for (const e of this.log.get(input.recipientId) ?? []) (bySubject.get(e.subjectId) ?? bySubject.set(e.subjectId, []).get(e.subjectId)!).push(e);
    for (const [subjectId, es] of bySubject) {
      const name = input.members.find(m => m.id === subjectId)?.name ?? subjectId;
      const all = es.reduce((u, e) => union(u, e.facts), empty());
      const ids = [...new Set(es.map(e => e.messageId))];
      // What the recipient may already see about this person's schedule is not a disclosure.
      const seen = vis.visible.filter(f => f.ownerId === subjectId).reduce((u, f) => union(u, extractSchedule(f.value)), empty());
      const hidden = vis.invisible.filter((f: OwnedFacet) => f.ownerId === subjectId && (f.kind === "routine" || f.kind === "availability_pattern" || /\b(every|times a week|weekdays|mornings|evenings)\b/i.test(f.value)));
      const revealedDays = minus(all.days, seen.days), revealedParts = minus(all.parts, seen.parts);
      const revealsNew = revealedDays.size > 0 || revealedParts.size > 0 || inter(all.times, seen.times).length < all.times.size || all.places.size > 0;
      // A single entry's facts alone: did one message already reveal it?
      const matches = (u: ScheduleFacts, h: ScheduleFacts) => {
        const d = inter(u.days, h.days).length, need = Math.min(2, h.days.size);
        const anchor = inter(u.parts, h.parts).length + inter(u.times, h.times).length + inter(u.places, h.places).length;
        return h.days.size > 0 ? d >= need && anchor >= 1 : inter(u.places, h.places).length >= 1 && (inter(u.times, h.times).length >= 1 || u.recurring);
      };
      let flagged = false;
      for (const f of hidden) {
        const h = extractSchedule(f.value);
        if (!revealsNew || !matches(all, h)) continue;
        const single = es.some(e => matches(e.facts, h));
        alerts.push({ recipientId: input.recipientId, subjectId, subjectName: name, kind: "routine_match", crossMessage: !single, messageIds: ids,
          detail: `union {days: ${[...all.days].join("/")}, parts: ${[...all.parts].join("/")}, times: ${[...all.times].join("/")}, places: ${[...all.places].join("/")}} matches hidden "${f.value.slice(0, 80)}"` });
        flagged = true; break;
      }
      if (flagged) continue;
      // No registry match: a recurring weekly pattern the recipient cannot see (>=3 days, or >=2 days with a part of day / time).
      const recurring = all.recurring && (revealedDays.size >= 3 || (revealedDays.size >= 2 && (revealedParts.size + all.times.size) >= 1));
      if (recurring) {
        const single = es.some(e => { const d = minus(e.facts.days, seen.days); return e.facts.recurring && (d.size >= 3 || (d.size >= 2 && (minus(e.facts.parts, seen.parts).size + e.facts.times.size) >= 1)); });
        alerts.push({ recipientId: input.recipientId, subjectId, subjectName: name, kind: "recurring_pattern", crossMessage: !single, messageIds: ids,
          detail: `recurring {days: ${[...revealedDays].join("/")}, parts: ${[...all.parts].join("/")}, times: ${[...all.times].join("/")}} not in ${name.split(" ")[0]}'s visible availability` });
      }
    }
    return alerts;
  }
}
