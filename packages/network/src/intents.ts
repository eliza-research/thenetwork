// Replies to everything an active adult says (PRD F5, F8-F10, F19-F21, F24, 32.3, 32.5, 33.10, 41.5,
// 41.7). The ConsentNetwork hands this module what its own flows did not handle (handleInbound), so
// every text from an active adult gets one short, honest reply:
//   help              what the agent does and what the member can say
//   know_me           what was learned, grouped "you told me" and "from your profile"; never a photo
//                     rating, appearance, trust or safety fact
//   correct           learned again from the message (the app's tags too), and the change confirmed
//   pause / resume    participation state "paused" until a date or until they say resume
//   quiet_hours       the member's quiet hours; only_when_asked, more/less often: state and outreach
//   list / close      the open asks and learned wants, closed or put on hold by name
//   info_question     honest: it cannot look things up; never a place it has not checked
//   export / delete   the app's settings page; nothing is deleted by text
//   anything else     learned from, then a short line on what the agent can do (a bare "ok" gets nothing)
// And the agent-started texts that belong to them (through the Network's send(), every rule applies):
//   one reconfirm per learned want 7 days before it lapses (F9), one honest "nothing fits yet" when
//   the engine finds nothing for 10+ days (33.10, at most every 30 days), and the sampled "Was that
//   worth a text?" a day after a probe answer (F19, 21.2), stored as an event "worth_a_text".
// Members aged 13-17 never reach this module (they keep their own path), and it never sends to them.
import { DAY, localParts, type Category, type Facet, type MemberId, type ParticipationState, type SimMeta } from "@thenetwork/core";
import { desireById, INTERESTS, skillFirstPerson, SKILLS } from "@thenetwork/engine/src/packs/network/vocabulary.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import type { AppTag } from "./apphooks.ts";
import type { PauseSpan } from "./asks.ts";
import { consentOf, extractProfile, type Classified } from "./classify.ts";
import type { Copy } from "./copy.ts";
import { NY, type SendKind } from "./outreach.ts";

/** Settings a member set by text, and the per-member state of this module (kept in the Network's state). */
export interface MemberTexts {
  /**
   * What the member set by text: participation state (with an end for a pause), quiet hours, and
   * "only when I ask". `base*`: what the member record said at the time. The record wins again once
   * it says the same (the service mirrored it) or something new (the member's settings page, staff).
   */
  own?: { state?: ParticipationState; until?: number; baseState?: string; quiet?: [number, number]; baseQuiet?: [number, number]; onlyWhenAsked?: boolean };
  /** The last "nothing fits yet" note. */
  emptyAt?: number;
  /** Sampled probe answers for "Was that worth a text?": when to ask, when asked, and the answer. */
  worth?: { oppId: string; due: number; askedAt?: number; worth?: boolean }[];
  /** Wants reconfirmed (desire id -> the statedAt the reconfirm was for), and the open reconfirm. */
  reconfirmed?: Record<string, number>;
  reconfirmOpen?: { desireId: string; at: number };
}

/** What this module reads and changes on a member (the Network's MemberState has all of it). */
export interface TextsMember {
  id: MemberId; first: string; minor: boolean; minorSignal: boolean; stage: string; state: string; quietHours: [number, number];
  onlyWhenAsked: boolean; optedOut: boolean; account?: string; ageUnknown?: boolean; ageConflict?: boolean; minorReported?: boolean;
  learned: { interests: Set<string>; skills: Set<string>; desires: Map<string, number>; area?: string; eveningsOpen?: boolean; groups?: boolean };
  appTags?: AppTag[]; texts?: MemberTexts;
}
/** A member request as this module sees it (network.ts Request). */
export interface TextsRequest { id: string; memberId: MemberId; at: number; kind: "people" | "plans"; desireId?: string; tags: string[]; outcome?: string; closed?: boolean }
/** A setting change for the service to mirror on the member record (network.members). */
export interface MemberSettings { state?: ParticipationState; quietHours?: [number, number] }

/** What the Network gives this module. Every send goes through the Network's send(). */
export interface TextsHost {
  readonly app: AppInfo;
  readonly copy: Copy;
  readonly allowedCategories: ReadonlySet<Category>;
  readonly seed: number;
  /** How long a learned want stays live (days). */
  readonly desireDays: number;
  /** Share of probe answers that get "Was that worth a text?" (0 = never). */
  readonly worthSample: number;
  now(): number;
  log(kind: string, detail: Record<string, unknown>): void;
  send(m: TextsMember, body: string, meta: SimMeta, kind: SendKind): "sent" | "deferred" | "refused";
  /** A short acknowledgement folded into the next message (never sent alone). */
  ack(m: TextsMember, text: string): void;
  members(): Iterable<TextsMember>;
  requests(): TextsRequest[];
  /** learnFrom: the offline reading (and the LLM's), the app's tags with these asks' bare-answer rules. */
  learn(m: TextsMember, body: string, reasons: readonly string[]): void;
  /** The member record's state and quiet hours (undefined without a record). */
  record(id: MemberId): { state?: string; quietHours?: [number, number] } | undefined;
  /** The member's own facets from the snapshot (never the mirrored chat rows). */
  profileFacets(id: MemberId): Facet[];
  /** Interruptions may go out now (send window and quiet hours). */
  slotOpen(m: TextsMember): boolean;
  /** Member invites exist (the world or the platform can make one). */
  invitesOpen(): boolean;
  /** The service mirrors a setting onto the member record (optional). */
  onSettings?(id: MemberId, s: MemberSettings): void;
  dirty(): void;
}

/** The asks whose bare answers the app's parser reads on a correction ("women 25-30 actually"). */
const CORRECTION_REASONS = ["slop_orientation", "slop_age_range", "slop_distance", "slop_basics"];
/** A bare acknowledgement or a bare yes/no with nothing pending: no reply (a reply to "thanks" is noise). */
const BARE_ACK = /^(?:ok(?:ay)?|k|kk|thx|thanks?(?: you| so much)?|ty|cool|great|nice|perfect|got it|sounds good|will do|see you(?: then)?|yes|yeah|yep|yup|sure|no|nope|nah|lol|haha|ha|[\s.!,:;)(-]|\p{Extended_Pictographic})+$/iu;
/** Tags never described back to a member: ratings, appearance, trust, safety, verification. */
const NEVER_SAY = /(?:^|:)(?:rating|appearance|photo|safety|trust|verify|review|risk|flag|body)\b|:rating:|^slop:(?:self|wants|wants_body|free|activity|area|smoking|drinking|has_kids|wants_kids|religion|religion_importance|politics):/;
const PURPOSE_SAY: Record<string, string> = { casual: "something casual", long_term: "something long-term", unsure: "seeing where it goes" };
const DEALBREAKER_SAY: Record<string, string> = {
  smoker: "no smokers", heavy_drinker: "no heavy drinkers", has_kids: "no one with kids", wants_kids: "no one who wants kids", no_kids_ever: "someone who wants kids",
  religious: "no one religious", nonreligious: "someone religious", right_politics: "no one on the right", left_politics: "no one on the left",
};
const GENDER_SAY: Record<string, [string, string]> = { woman: ["a woman", "women"], man: ["a man", "men"], nonbinary: ["nonbinary", "nonbinary people"] };

const INTO = "you're into ";
const interestLabel = (t: string) => INTERESTS.find(i => i.tag === t)?.label ?? t.replace(/_/g, " ");
const skillLabel = (t: string) => SKILLS.find(s => s.tag === t)?.label ?? t.replace(/_/g, " ");
/** "find a regular climbing partner" -> "a regular climbing partner". */
const wantPhrase = (text: string) => text.replace(/^(find|meet|get|be part of|try|start|make|play|join|go on) /, "").replace(/^learn to /, "learning to ");
const listOf = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** "9pm", "10am", "noon". */
export function hourPhrase(h: number): string {
  if (h === 0) return "midnight";
  if (h === 12) return "noon";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

/** A day in New York words: "Sunday, November 1". */
function dayPhrase(t: number): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: NY, weekday: "long", month: "long", day: "numeric" }).format(t);
}

/** When a pause the member said ends: 9am New York on that day (never in the past; at least a day away). */
export function pauseEnd(span: PauseSpan, now: number): number | undefined {
  const p = localParts(now, NY);
  // 9am New York is 13:00 or 14:00 UTC; 14:00 UTC is 9 or 10am, never the night before.
  const at = (y: number, mo: number, d: number) => Date.UTC(y, mo - 1, d, 14);
  let t: number | undefined;
  if (span.days !== undefined) t = at(p.year, p.month, p.day) + span.days * DAY;
  else if (span.month !== undefined) {
    let y = p.year;
    const d = span.day ?? 1;
    if (at(y, span.month, d) <= now + DAY) y++;
    t = at(y, span.month, d);
  } else if (span.weekday !== undefined) {
    const ahead = ((span.weekday - p.weekday + 7) % 7) || 7;
    t = at(p.year, p.month, p.day) + ahead * DAY;
  }
  return t !== undefined && t > now ? t : undefined;
}

/**
 * The member record with what the member set by text (MemberTexts.own) on top. The Network's
 * syncRecord reads this instead of the record. A pause that ended goes back to the state before it
 * (mirrored to the record through onSettings). `rec`: the record as the snapshot gives it.
 */
export function withOwnSettings<R extends { state?: string; prefs?: { quietHours?: [number, number] } }>(m: TextsMember, rec: R, now: number, host?: Pick<TextsHost, "onSettings" | "log">): R {
  const o = m.texts?.own;
  if (!o) return rec;
  const recQuiet = rec.prefs?.quietHours;
  if (o.state && o.until !== undefined && now >= o.until) {
    // The pause is over: back to what the record said before it (an older pause or none: normal).
    const back = (o.baseState && o.baseState !== "paused" ? o.baseState : "normal") as ParticipationState;
    o.state = back; o.baseState = rec.state; delete o.until;
    host?.onSettings?.(m.id, { state: back });
    host?.log("member_setting", { memberId: m.id, setting: "pause_ended", state: back });
  }
  if (o.state) {
    // The record caught up (the service mirrored it), or someone changed it since (the settings page, staff): the record wins.
    if (rec.state === undefined || (rec.state === o.state && o.until === undefined) || (rec.state !== o.baseState && rec.state !== o.state)) { delete o.state; delete o.baseState; delete o.until; }
  }
  if (o.quiet) {
    const same = (a?: [number, number], b?: [number, number]) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
    if (!recQuiet || same(recQuiet, o.quiet) || !same(recQuiet, o.baseQuiet)) { delete o.quiet; delete o.baseQuiet; }
  }
  const out = { ...rec } as R;
  if (o.state) out.state = o.state;
  if (o.quiet) out.prefs = { ...(rec.prefs ?? {}), quietHours: [o.quiet[0], o.quiet[1]] } as R["prefs"];
  return out;
}

/** The plain-words reason a want found nobody for a while, and one thing the member could change (33.10). Undefined: say nothing. */
export function emptyStateWords(reason: string, app: string): { why: string; change: string } | undefined {
  const r = reason.replace(/^filtered:/, "");
  if (r === "age_range") return { why: "not many people nearby fit the age range you gave", change: "widening your age range a little" };
  if (r === "age_range_unknown") return { why: "I don't know what age range you're looking for", change: "telling me the age range that feels right" };
  if (r === "orientation_mismatch") return { why: "not many people near you are looking for someone like you yet", change: "telling me if you're open to meeting more people" };
  if (/distance|radius|too_far|no_presence_overlap|market|geo/.test(r)) return { why: "not many people are within the distance you gave", change: app === "slop" ? "letting me look a few more miles out" : "telling me another neighborhood you're often in" };
  if (r === "no_candidates" || r === "density_gap") return { why: "there aren't many people near you who fit yet", change: app === "slop" ? "letting me look a few more miles out" : "telling me another neighborhood you're often in, or a nearby interest" };
  if (r === "below_threshold") return { why: "the closest people I found weren't a strong enough fit", change: "telling me a bit more about what you're into" };
  // Budgets, holds, reviews, safety and appearance reasons are never explained (nothing to change, or private).
  return undefined;
}

/** A stable draw in [0, 1) from the seed and two ids (FNV-1a). */
function draw(seed: number, a: string, b: string): number {
  let h = 0x811c9dc5 ^ (seed * 7919);
  for (const ch of `worth|${a}|${b}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return (h >>> 0) / 2 ** 32;
}

export class MemberTextReplies {
  constructor(private readonly h: TextsHost) {}

  private reply(m: TextsMember, body: string, type: SimMeta["type"] = "info") { this.h.send(m, body, { type, proactive: false }, "reply"); }
  private texts(m: TextsMember): MemberTexts { return (m.texts ??= {}); }
  private paused(m: TextsMember) { return m.state === "paused" || m.texts?.own?.state === "paused"; }

  /** The message from an active adult that the Network's own flows did not handle. */
  handle(m: TextsMember, c: Classified, body: string) {
    if (m.minor) return;
    const now = this.h.now();
    const t = m.texts;
    const yn = (c.kind === "ack" || c.kind === "other") ? consentOf(body).answer : "unclear";
    // The answer to "Was that worth a text?" (open for 3 days).
    const w = t?.worth?.find(x => x.askedAt !== undefined && x.worth === undefined && now - x.askedAt < 3 * DAY);
    if (w && (yn === "yes" || yn === "no")) {
      w.worth = yn === "yes";
      this.h.log("worth_a_text", { memberId: m.id, opportunityId: w.oppId, worth: w.worth });
      this.h.ack(m, this.h.copy.worthThanks);
      return;
    }
    // The answer to a reconfirm ("Still want me to look for ...?").
    const rc = t?.reconfirmOpen;
    if (rc && now - rc.at < 3 * DAY && (yn === "yes" || yn === "no")) {
      delete t!.reconfirmOpen;
      if (yn === "yes" && m.learned.desires.has(rc.desireId)) m.learned.desires.set(rc.desireId, now);
      if (yn === "no") { m.learned.desires.delete(rc.desireId); this.closeRequests(m, rc.desireId); }
      this.h.dirty();
      this.h.log("want_reconfirmed", { memberId: m.id, desireId: rc.desireId, keep: yn === "yes" });
      return this.reply(m, yn === "yes" ? this.h.copy.reconfirmKept : this.h.copy.reconfirmDropped);
    }
    switch (c.kind) {
      case "help": return this.reply(m, this.h.copy.help);
      case "know_me": return this.knowMe(m);
      case "correct": return this.correct(m, body);
      case "pause": return this.pause(m, c.ask?.pause);
      case "resume": return this.resume(m);
      case "quiet_hours": return this.quiet(m, c.ask?.quiet ?? {});
      case "only_when_asked": return this.onlyWhenAsked(m);
      case "more_often": return this.cadence(m, "open");
      case "less_often": return this.cadence(m, "quiet");
      case "list_intents": return this.listIntents(m);
      case "close_intent": return this.closeIntent(m, body, c.ask?.closeMode ?? "close");
      case "info_question": return this.reply(m, this.h.copy.infoQuestion(this.h.allowedCategories.has("social") || this.h.allowedCategories.has("hobby")));
      case "export_request": return this.reply(m, this.h.copy.exportData(this.h.app.domain));
      case "delete_request":
        this.h.log("delete_request", { memberId: m.id });
        return this.reply(m, this.h.copy.deleteData(this.h.app.domain));
      // "Can't make it" with nothing booked (a booked plan is handled before this).
      case "cancel": return this.reply(m, this.h.copy.nothingBooked);
      default: return this.fallback(m, c, body);
    }
  }

  /** Anything else: learn what it says about them (F5), then say what changed or what the agent can do. */
  private fallback(m: TextsMember, c: Classified, body: string) {
    if (c.kind === "ack" && BARE_ACK.test(body.trim())) return;
    if (c.abuse.length) return;
    const before = this.told(m);
    this.h.learn(m, body, []);
    const added = this.told(m).filter(x => !before.includes(x));
    if (added.length) return this.reply(m, this.h.copy.corrected(this.fit(this.merged(added), 220)));
    this.reply(m, this.h.copy.fallback);
  }

  // ------------------------------------------------------------------ what the agent knows (F5)
  /** What the member told us, in plain words. Never a rating, appearance, trust or safety tag. */
  told(m: TextsMember): string[] {
    const out: string[] = [];
    const now = this.h.now();
    // One item per interest, so a change names only what is new (merged() joins them for the reply).
    for (const t of m.learned.interests) out.push(`you're into ${interestLabel(t)}`);
    for (const s of m.learned.skills) out.push(skillFirstPerson(s).replace(/^I'm /, "you're ").replace(/^I /, "you "));
    for (const [d, at] of m.learned.desires) {
      const def = desireById.get(d);
      if (def && now - at <= this.h.desireDays * DAY) out.push(`you'd like to ${def.text}`);
    }
    if (m.learned.area) out.push(`you're around ${m.learned.area}`);
    if (m.learned.groups !== undefined) out.push(m.learned.groups ? "you like small groups" : "you prefer one-on-one");
    out.push(...this.appTold(m.appTags ?? []));
    return out;
  }

  /** The app's tags in plain words (slop: who they are and seek, age range, distance, zip, goal, dealbreakers). */
  private appTold(tags: AppTag[]): string[] {
    const out: string[] = [];
    const vals = (p: string) => tags.filter(t => t.tag.startsWith(p) && !NEVER_SAY.test(t.tag)).map(t => t.tag.slice(p.length));
    const is = vals("romance:is:")[0], seeks = vals("romance:seeks:");
    if (is || seeks.length) {
      const who = seeks.length >= 3 ? "everyone" : listOf(seeks.map(g => GENDER_SAY[g]?.[1] ?? g));
      out.push(is && seeks.length ? `you're ${GENDER_SAY[is]?.[0] ?? is} looking to meet ${who}` : is ? `you're ${GENDER_SAY[is]?.[0] ?? is}` : `you'd like to meet ${who}`);
    }
    const age = vals("romance:age:")[0];
    if (age) out.push(`ages ${age.replace("-", " to ")}`);
    const scope = vals("slop:scope:")[0], miles = vals("slop:max_miles:")[0];
    if (scope === "city") out.push("anywhere in the city");
    else if (miles) out.push(`within ${miles} miles`);
    const zip = vals("slop:zip:")[0];
    if (zip) out.push(`your zip is ${zip}`);
    const goal = vals("slop:goal:")[0];
    if (goal && PURPOSE_SAY[goal]) out.push(`you want ${PURPOSE_SAY[goal]}`);
    const db = vals("slop:dealbreaker:").map(x => DEALBREAKER_SAY[x]).filter(Boolean);
    if (db.length) out.push(listOf(db as string[]));
    return out;
  }

  /** What the member's profile says (snapshot facets they can see): no private, sensitive or unconfirmed inference. */
  private fromProfile(m: TextsMember, told: string[]): string[] {
    const seen = new Set(told.join(" ").toLowerCase().split(/[^a-z0-9]+/));
    const out: string[] = [];
    for (const f of this.h.profileFacets(m.id)) {
      if (f.scope === "agent_private" || f.sensitive || (f.inferred && !f.confirmedByMember) || f.tags.some(t => NEVER_SAY.test(t)) || /:photo:|:verify:/.test(f.id)) continue;
      if (!["interest", "skill", "offer", "goal", "preference", "fact", "resource"].includes(f.kind)) continue;
      const tag = f.tags[0];
      const v = (tag && INTERESTS.some(i => i.tag === tag) ? interestLabel(tag) : tag && SKILLS.some(s => s.tag === tag) ? skillLabel(tag) : f.value).replace(/_/g, " ").trim();
      if (!v || v.length > 60 || /\d{6,}|@/.test(v)) continue;
      if (v.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).every(w => seen.has(w))) continue;
      if (!out.includes(v)) out.push(v);
    }
    return out;
  }

  /** "you're into jazz", "you're into climbing" -> "you're into jazz and climbing". */
  private merged(items: string[]): string[] {
    const into = items.filter(x => x.startsWith(INTO)).map(x => x.slice(INTO.length));
    const rest = items.filter(x => !x.startsWith(INTO));
    return into.length ? [`${INTO}${listOf(into.slice(0, 6))}`, ...rest] : rest;
  }

  /** Items joined until the text is about `max` characters. */
  private fit(items: string[], max: number): string {
    const kept: string[] = [];
    for (const x of items) { if ([...kept, x].join("; ").length > max) break; kept.push(x); }
    return kept.join("; ") || items[0]!.slice(0, max);
  }

  private knowMe(m: TextsMember) {
    const told = this.told(m);
    const profile = this.fromProfile(m, told);
    this.h.log("know_me", { memberId: m.id, told: told.length, profile: profile.length });
    if (!told.length && !profile.length) return this.reply(m, this.h.copy.knowNothing);
    this.reply(m, this.h.copy.knowMe(told.length ? this.fit(this.merged(told), profile.length ? 150 : 250) : "", profile.length ? this.fit(profile, told.length ? 90 : 250) : ""));
  }

  /** "Actually, women 25-30": learn again (the app's bare answers too) and confirm what changed. */
  private correct(m: TextsMember, body: string) {
    const before = this.told(m);
    this.h.learn(m, body, CORRECTION_REASONS);
    const after = this.told(m);
    const changed = after.filter(x => !before.includes(x));
    this.h.log("profile_corrected", { memberId: m.id, changed: changed.length });
    if (!changed.length) return this.reply(m, this.h.copy.correctUnclear(this.h.app.id === "slop" ? "women 25-30, within 5 miles" : "I'm into climbing, and I'm around Astoria"));
    this.reply(m, this.h.copy.corrected(this.fit(this.merged(changed), 220)));
  }

  // ------------------------------------------------------------------ settings by text (F20, F28)
  /** Set the member's participation state by text, and mirror it to the record. */
  private setState(m: TextsMember, state: ParticipationState, until?: number) {
    const o = (this.texts(m).own ??= {});
    const rec = this.h.record(m.id)?.state;
    // The state before this text: kept across a pause that only changes its end.
    const base = o.state ? o.baseState : rec ?? m.state;
    o.state = state; o.baseState = base ?? "normal";
    if (until !== undefined) o.until = until; else delete o.until;
    m.state = state;
    this.h.onSettings?.(m.id, { state });
    this.h.dirty();
  }

  private pause(m: TextsMember, span: PauseSpan | undefined) {
    const now = this.h.now();
    const until = span ? pauseEnd(span, now) : undefined;
    this.setState(m, "paused", until);
    this.h.log("member_setting", { memberId: m.id, setting: "pause", until: until ?? null });
    this.reply(m, this.h.copy.paused(until !== undefined ? dayPhrase(until) : undefined));
  }

  private resume(m: TextsMember) {
    const o = m.texts?.own;
    const wasAsked = m.onlyWhenAsked || !!o?.onlyWhenAsked;
    if (!this.paused(m) && !wasAsked) return this.reply(m, this.h.copy.notPaused);
    if (o) delete o.onlyWhenAsked;
    m.onlyWhenAsked = false;
    if (this.paused(m)) {
      const back = (o?.baseState && o.baseState !== "paused" ? o.baseState : "normal") as ParticipationState;
      this.setState(m, back);
      if (o) delete o.until;
    }
    this.h.log("member_setting", { memberId: m.id, setting: "resume", state: m.state });
    this.reply(m, this.h.copy.resumed);
  }

  private quiet(m: TextsMember, q: { from?: number; to?: number }) {
    const cur = m.quietHours;
    const next: [number, number] = [q.from ?? cur[0], q.to ?? cur[1]];
    const o = (this.texts(m).own ??= {});
    if (!o.quiet) o.baseQuiet = this.h.record(m.id)?.quietHours ?? [cur[0], cur[1]];
    o.quiet = next;
    m.quietHours = [next[0], next[1]];
    this.h.onSettings?.(m.id, { quietHours: next });
    this.h.dirty();
    this.h.log("member_setting", { memberId: m.id, setting: "quiet_hours", from: next[0], to: next[1] });
    this.reply(m, this.h.copy.quietSet(hourPhrase(next[0]), hourPhrase(next[1])));
  }

  private onlyWhenAsked(m: TextsMember) {
    (this.texts(m).own ??= {}).onlyWhenAsked = true;
    m.onlyWhenAsked = true;
    this.h.log("member_setting", { memberId: m.id, setting: "only_when_asked" });
    this.reply(m, this.h.copy.onlyWhenAsked);
  }

  private cadence(m: TextsMember, state: "open" | "quiet") {
    const o = m.texts?.own;
    if (o?.onlyWhenAsked) { delete o.onlyWhenAsked; m.onlyWhenAsked = false; }
    this.setState(m, state);
    this.h.log("member_setting", { memberId: m.id, setting: state === "open" ? "more_often" : "less_often" });
    this.reply(m, state === "open" ? this.h.copy.moreOften : this.h.copy.lessOften);
  }

  // ------------------------------------------------------------------ open asks (F9)
  /** The member's open asks: requests still waiting or searching (7 days), then wants they told us that are still live. */
  private openAsks(m: TextsMember): { key: string; desireId?: string; what: string; tags: string[] }[] {
    const now = this.h.now();
    const out: { key: string; desireId?: string; what: string; tags: string[] }[] = [];
    for (const r of this.h.requests()) {
      if (r.memberId !== m.id || r.kind !== "people" || r.closed || (r.outcome !== undefined && r.outcome !== "none" && r.outcome !== "probing") || now - r.at > 7 * DAY) continue;
      const def = r.desireId ? desireById.get(r.desireId) : undefined;
      const what = def ? wantPhrase(def.text) : r.tags[0] ? `someone into ${interestLabel(r.tags[0])}` : "";
      if (what && !out.some(x => x.what === what)) out.push({ key: r.desireId ?? r.id, desireId: r.desireId, what, tags: r.tags });
    }
    for (const [d, at] of m.learned.desires) {
      const def = desireById.get(d);
      if (!def || now - at > this.h.desireDays * DAY || out.some(x => x.desireId === d)) continue;
      out.push({ key: d, desireId: d, what: wantPhrase(def.text), tags: def.needsInterests });
    }
    return out;
  }

  private listIntents(m: TextsMember) {
    const open = this.openAsks(m);
    this.h.log("intents_listed", { memberId: m.id, open: open.length });
    if (!open.length) return this.reply(m, this.h.copy.listNone);
    this.reply(m, this.h.copy.listIntents(this.fit(open.map(x => x.what), 220)));
  }

  private closeRequests(m: TextsMember, desireId: string | undefined, tags: string[] = []) {
    for (const r of this.h.requests()) {
      if (r.memberId !== m.id || r.closed) continue;
      if ((desireId && r.desireId === desireId) || (!desireId && tags.length && r.tags.some(t => tags.includes(t)))) r.closed = true;
    }
  }

  /** "Stop looking for a climbing partner", "pause the tennis search": one open ask, by name. */
  private closeIntent(m: TextsMember, body: string, mode: "close" | "pause") {
    const open = this.openAsks(m);
    const x = extractProfile(body);
    const named = new Set([...x.desireIds, ...x.notWanted]);
    const words = body.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 3);
    const hit = open.find(a => a.desireId && named.has(a.desireId))
      ?? open.find(a => a.tags.some(t => x.interests.includes(t)))
      ?? open.find(a => words.some(w => a.what.toLowerCase().includes(w) && !["looking", "search", "searching", "stop", "pause", "request"].includes(w)))
      ?? (open.length === 1 && /\b(?:it|that|this|the search|my request|looking)\b/i.test(body) ? open[0] : undefined);
    if (!hit) return this.reply(m, this.h.copy.intentNotFound);
    if (hit.desireId) m.learned.desires.delete(hit.desireId);
    this.closeRequests(m, hit.desireId, hit.tags);
    this.h.dirty();
    this.h.log("intent_closed", { memberId: m.id, desireId: hit.desireId ?? null, mode });
    this.reply(m, mode === "pause" ? this.h.copy.intentPaused(hit.what) : this.h.copy.intentClosed(hit.what));
  }

  // ------------------------------------------------------------------ invites (honest until member invites exist)
  /** The reply to "invite my friend Maya" when no invite can be made: how a friend joins, or that invites are not open. */
  inviteReply(friend: string): string {
    return this.h.app.joinMode === "open" ? this.h.copy.inviteHowToJoin(friend, this.h.app.id, this.h.app.domain) : this.h.copy.invitesNotOpen(friend);
  }

  // ------------------------------------------------------------------ agent-started texts
  /** Members who may get an agent-started text from this module: adults, active, reachable, not paused. */
  private reachable(m: TextsMember): boolean {
    return !m.minor && !m.minorSignal && !m.ageUnknown && !m.ageConflict && !m.minorReported && m.stage === "active" && !m.optedOut && !m.account && !m.onlyWhenAsked && !this.paused(m);
  }

  /** A probe was answered (yes or no): sampled for "Was that worth a text?" a day later. Never twice for one opportunity. */
  probeAnswered(m: TextsMember, oppId: string) {
    if (m.minor || this.h.worthSample <= 0) return;
    const t = this.texts(m);
    if (t.worth?.some(w => w.oppId === oppId)) return;
    if (draw(this.h.seed, oppId, m.id) >= this.h.worthSample) return;
    t.worth = [...(t.worth ?? []), { oppId, due: this.h.now() + DAY }].slice(-20);
  }

  /** Every tick: the due worth-a-text questions and want reconfirms, in the member's send window. */
  tick(now: number) {
    for (const m of this.h.members()) {
      const t = m.texts;
      if (!t || !this.reachable(m)) continue;
      const w = t.worth?.find(x => x.askedAt === undefined && now >= x.due);
      if (w) {
        // Too late to be about that text (a long quiet spell): dropped, never asked.
        if (now - w.due > 2 * DAY) { w.askedAt = -1; continue; }
        if (!this.h.slotOpen(m)) continue;
        const r = this.h.send(m, this.h.copy.worthAsk, { type: "question", proactive: false, worthAText: w.oppId } as SimMeta, "interview");
        if (r !== "refused") { w.askedAt = now; this.h.log("worth_a_text_asked", { memberId: m.id, opportunityId: w.oppId }); }
        continue;
      }
    }
    this.reconfirms(now);
  }

  /** F9: one reconfirm per learned want, 7 days before it lapses. */
  private reconfirms(now: number) {
    for (const m of this.h.members()) {
      if (!this.reachable(m) || !m.learned.desires.size) continue;
      const t = this.texts(m);
      if (t.reconfirmOpen && now - t.reconfirmOpen.at < 3 * DAY) continue;
      for (const [d, at] of m.learned.desires) {
        const lapse = at + this.h.desireDays * DAY;
        if (now < lapse - 7 * DAY || now >= lapse || t.reconfirmed?.[d] === at) continue;
        const def = desireById.get(d);
        if (!def || !this.h.slotOpen(m)) break;
        const r = this.h.send(m, this.h.copy.reconfirm(wantPhrase(def.text)), { type: "question", proactive: false }, "interview");
        if (r !== "refused") {
          t.reconfirmed = { ...t.reconfirmed, [d]: at };
          t.reconfirmOpen = { desireId: d, at: now };
          this.h.log("want_reconfirm_sent", { memberId: m.id, desireId: d });
        }
        break;
      }
    }
  }

  /**
   * After an engine run (33.10): a member whose want found nothing for 10+ days (runLog.emptyStates)
   * hears it once, honestly, with the reason in plain words and one thing they could change. At most
   * once every 30 days; never to a minor; nothing when the reason is private or not theirs to change.
   */
  emptyStates(list: readonly { memberId: MemberId; reason: string }[], now: number) {
    const byId = new Map<MemberId, TextsMember>();
    for (const m of this.h.members()) byId.set(m.id, m);
    const done = new Set<MemberId>();
    for (const e of list) {
      const m = byId.get(e.memberId);
      if (!m || done.has(m.id) || !this.reachable(m)) continue;
      const t = this.texts(m);
      if (t.emptyAt !== undefined && now - t.emptyAt < 30 * DAY) continue;
      const words = emptyStateWords(e.reason, this.h.app.id);
      if (!words) continue;
      done.add(m.id);
      const r = this.h.send(m, this.h.copy.emptyState(words.why, words.change), { type: "info", proactive: false }, "info");
      if (r === "refused") continue;
      t.emptyAt = now;
      this.h.log("empty_state_notice", { memberId: m.id, reason: e.reason });
    }
  }
}
