// peon.biz job postings and job seats in the ConsentNetwork (#9). Pure: no I/O, no clock, no
// randomness. The SQL side (rows, the staff API) is packages/network/service/postings.ts.
//
//   JobPosting    one job a hiring manager (a peon member: an adult, active, opted in to work
//                 matching) owns: a title, openings, a pay range (required: the pack never proposes a
//                 job without one), the work model and area, must-haves and nice-to-haves. It is stored
//                 as rows the engine already reads (postingFacts): an intent "Hire: <title>" (details
//                 "peon:job") and facets tagged `peon:posting:<id>` on the manager. The snapshot turns
//                 each active posting into a job seat `job:<id>` (engine peonSeats), so a posting
//                 persists across restarts with the member's other rows.
//   intake        a text in a handled turn ("We're hiring a data analyst, 2 openings, $90k-$120k, hybrid
//                 in Brooklyn, must have SQL"): rules only, never an LLM's open-turn output. The
//                 Network reads the post back and saves it only after the manager's yes (postingIntake).
//                 "Close my data analyst post" / "we filled it" is read back and closed the same way.
//   seat copy     the candidate-first probe, the manager's blind review of a candidate who said yes
//                 (must-have checkmarks, never a score, never a name), the intro after both yeses, and
//                 the check-in. Every text still goes through the Network's leak guard.
import { parseReply } from "@thenetwork/core";
import type { Category, Facet, Intent, MemberId, WorldSnapshot } from "@thenetwork/core";
import { maxOpenings, missingPostingFields, openingsInRange, payRangeAllowed } from "../../core/src/generated/postingPolicy.ts";
import { isSeatId, postingIdOf, seatIdOf, seatOwnerOf } from "@thenetwork/engine";
import type { EngineInput } from "@thenetwork/engine";
import { JOB_INTENT, T, type PeonMode } from "@thenetwork/engine/src/packs/peon/schema.ts";
import { NEVER_ASKS } from "@thenetwork/engine/src/packs/peon/copy.ts";
import { NEIGHBORHOODS } from "./geo.ts";

export interface JobPosting {
  id: string; managerId: MemberId; title: string;
  /** Role family (a lower-case id, e.g. data_analyst); default: the title as an id. */
  family: string; seniority?: number;
  openings: number; payMin: number; payMax: number;
  mode: PeonMode; area?: string;
  must: { skill: string; level: number }[]; nice: string[];
  sponsors?: boolean;
  status: "active" | "closed";
  /** Why it closed: the manager or staff closed it, or it was filled. */
  closedReason?: "closed" | "filled";
  createdAt: number; updatedAt: number;
}

/** What a manager said so far (plain JSON in MemberState.posting). `close`: the draft closes `id`. */
export interface PostingDraft {
  id?: string; close?: boolean;
  closeReason?: JobPosting["closedReason"];
  /** Keep the edits while asking which posting to update. */
  chooseUpdate?: boolean;
  /** The exact saved posting shown in an update or close read-back (postingRevision). */
  revision?: string;
  title?: string; family?: string; seniority?: number; openings?: number; payMin?: number; payMax?: number;
  mode?: PeonMode; area?: string; must?: { skill: string; level: number }[]; nice?: string[]; sponsors?: boolean;
  /** Questions asked for this draft (at most 2 before it is dropped). */
  asks?: number;
  /** The field the last question asked for; only a reply to "What's the job title?" can be a bare title. */
  asked?: "title" | "pay";
  /** Read back in full: the manager's yes saves it. */
  ready?: boolean;
}

/** A manager's posting as the Network sees it in the snapshot (seat members). */
export interface PostingRef { id: string; seat: MemberId; title: string; active: boolean; openings: number }

export const MAX_OPENINGS = maxOpenings;
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 };
const SENIORITY: [RegExp, number][] = [[/\b(intern|entry[- ]level|junior|jr)\b/i, 1], [/\b(mid[- ]level|mid)\b/i, 2], [/\b(senior|sr)\b/i, 3], [/\b(staff|lead)\b/i, 4], [/\bprincipal\b/i, 5]];
const BOROUGHS = ["manhattan", "brooklyn", "queens", "bronx", "staten island"];
const MODE = "remote|hybrid|on-?site|in[- ]office|in person";
const REFUSED_MODE = new RegExp(`\\b(?:(?:not|no)(?:\\s+longer)?\\s+(?:fully\\s+)?|non[- ])(?:${MODE})\\b(?:\\s+(?:or|nor)\\s+(?:${MODE})\\b)*`, "gi");
const PAY_RANGE = /(?<![\w.,])(\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*k?)\s*(?:-|–|—|to)\s*(\$?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*k?)(?!\w|[.,]\d)/gi;

/** The first stated yearly pay range, in thousands of dollars. A bare "2-3" is not pay: one end needs "$" or "k". */
function payRange(text: string): [number, number] | undefined {
  for (const hit of text.matchAll(PAY_RANGE)) {
    const amounts = [hit[1]!, hit[2]!];
    if (!amounts.some(amount => /[$k]/i.test(amount))) continue;
    const sharedK = amounts.some(amount => /k$/i.test(amount.trim()));
    const [low, high] = amounts.map(amount => {
      const value = Number(amount.replace(/[$,\sk]/gi, ""));
      return /k$/i.test(amount.trim()) || (sharedK && value < 1000 && !amount.includes(",")) ? value : value / 1000;
    }) as [number, number];
    // spec/postingPolicy.md, "The low end of the pay range comes first"
    if (payRangeAllowed(low, high)) return [low, high];
  }
  return undefined;
}

const AREAS = [...BOROUGHS, ...NEIGHBORHOODS.map(n => n.name.toLowerCase())].sort((a, b) => b.length - a.length);

const START_POSTING = /^\s*(?:(?:we(?:'| a)?re|i(?:'| a)?m|we are|i am|now)\s+hiring\b|hiring\s*:|post(?:ing)?\s+(?:a\s+)?(?:new\s+)?job\b|new\s+job\s+post|job\s+post(?:ing)?\s*:)/i;
const UPDATE_POSTING = /^\s*update\s+(?:my|our|the)\s+(.*?)\b(?:job(?:\s+post(?:ing)?)?|posting|post|role)\b(?=\s*(?:[:;,.!?]|$|[0-9]|to\b))/i;
const CLOSE_POSTING = /^\s*(?:close|take\s+down|remove)\s+(?:my|our|the)\s+(.*?)\b(?:job(?:\s+post(?:ing)?)?|posting|post|role)\b(?=\s*(?:[:;,.!?]|$))/i;
const FILLED_POSTING = /^\s*we\s+(?:filled|hired\s+for)\s+(?:(?:the|our|my)\s+([^!?.]+)|it\s*[.!]?\s*$)/i;
const commandText = (body: string) => body.replace(/[‘’]/g, "'");

/** A text that starts, updates or closes a job post (a posting command). */
export function isPostingCommand(body: string): boolean {
  const t = commandText(body);
  return START_POSTING.test(t) || UPDATE_POSTING.test(t) || CLOSE_POSTING.test(t) || FILLED_POSTING.test(t);
}

/** Read job-post fields from one text (rules only). Fields not in the text stay undefined. */
export function parsePosting(body: string): PostingDraft {
  const t = commandText(body).replace(/\s+/g, " ").trim();
  const d: PostingDraft = {};
  const title = /(?:hiring|job(?: post(?:ing)?)?|post(?:ing)?(?: a)?(?: new)? job(?: for)?|role|title)\s*(?:for|:|is|-)?\s*(?:an?\s+|the\s+)?([a-z][a-z0-9 /&+.-]{1,48}?)(?=\s*(?:[,.;(]|$)|\s+(?:(?:in|at|for|with|paying|pay|remote|hybrid|on-?site|in-office)\b|x\s?\d|\$|\d))/i.exec(t);
  if (title) {
    const raw = title[1]!.trim().replace(/\s+(?:role|position|job)$/i, "");
    if (!/^(?:a|an|the|job|post|posting|new|for|my|our)$/i.test(raw) && raw.length >= 2) d.title = raw.toLowerCase();
  }
  const open = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:open(?:ing)?s?|roles?|seats?|positions?|hires?|people|spots?)\b/i.exec(t) ?? /\bx\s?(\d{1,2})\b/i.exec(t);
  if (open) { const n = WORDS[open[1]!.toLowerCase()] ?? Number(open[1]); if (Number.isInteger(n) && openingsInRange(n)) d.openings = n; }
  const pay = payRange(t);
  if (pay) [d.payMin, d.payMax] = pay;
  // A refused work mode ("not remote") is removed before the mode is read.
  const modeText = t.replace(REFUSED_MODE, " ");
  if (/\bremote\b/i.test(modeText)) d.mode = "remote";
  else if (/\bhybrid\b/i.test(modeText)) d.mode = "hybrid";
  else if (/\b(on-?site|in[- ]office|in person)\b/i.test(modeText)) d.mode = "onsite";
  const lower = ` ${t.toLowerCase().replace(/[^a-z0-9' -]+/g, " ")} `;
  const area = AREAS.find(a => lower.includes(` ${a} `));
  if (area) d.area = slug(area);
  const list = (s: string) => s.split(/,|\band\b|\/|;/i).map(x => x.trim().toLowerCase()).filter(x => x && x.length <= 40 && !/^(?:a|an|the|some)$/.test(x));
  const must = /\bmust(?:[- ]haves?|\s+have|\s+know)?\s*:?\s*([^.;]+?)(?=\.|;|\bnice[- ]to[- ]haves?\b|$)/i.exec(t);
  if (must) d.must = list(must[1]!).map(x => { const m = /^(.*?)\s*(?:\(?(?:level\s*)?([0-5])\)?)$/i.exec(x); return { skill: slug(m?.[1] || x), level: m?.[2] ? Number(m[2]) : 2 }; }).filter(x => x.skill);
  const nice = /\bnice[- ]to[- ]haves?\s*:?\s*([^.;]+)/i.exec(t);
  if (nice) d.nice = list(nice[1]!).map(slug).filter(Boolean);
  // Skill lists can carry levels and seniority words that do not describe the role.
  let roleText = t;
  for (const section of [must, nice]) if (section) {
    roleText = roleText.slice(0, section.index) + " ".repeat(section[0].length) + roleText.slice(section.index + section[0].length);
  }
  for (const [re, n] of SENIORITY) if (re.test(roleText)) { d.seniority = n; break; }
  const lvl = /\blevel\s*([1-5])\b/i.exec(roleText);
  if (lvl) d.seniority = Number(lvl[1]);
  // A refusal ("no sponsorship available") is read before an offer ("sponsorship available").
  if (/\bno (?:visa )?sponsorship\b|\b(?:can(?:'|no)?t|cannot|won'?t|don'?t) sponsor\b/i.test(t)) d.sponsors = false;
  else if (/\b(can|will|we)\s+sponsor\b|\bsponsorship (?:available|ok|yes)\b/i.test(t)) d.sponsors = true;
  return d;
}

/** The fields still missing before a draft can be read back (a title and a pay range). */
export function missing(d: PostingDraft): ("title" | "pay")[] {
  return missingPostingFields(!!d.close, !!d.title, d.payMin !== undefined && d.payMax !== undefined) as ("title" | "pay")[];
}

const human = (s: string) => s.replace(/_/g, " ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const where = (mode: PeonMode | undefined, area: string | undefined) => (mode === "remote" ? "remote" : `${mode ?? "onsite"}${area ? ` in ${cap(human(area))}` : ""}`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Peon copy for the intake. Short words, no domain names (the leak guard reads a domain as contact details). */
export const POSTING_COPY = {
  adultsOnly: "Job posts are for adults (18+) only.",
  notReady: "I can't post jobs for you right now. A person on our team will take a look.",
  optIn: "To post a job, turn on work matches first: reply \"work\" and I'll set it up.",
  nothingToClose: "You have no open job posts.",
  whichToClose: (titles: string[]) => `Which post should I close: ${titles.join(", ")}?`,
  dropped: "OK, I didn't post anything.",
  askTitle: "What's the job title?",
  askPay: "What's the pay range for the role (for example $90k-$120k)? We only show jobs with a posted pay range.",
  saved: (title: string) => `Posted: ${title}. A person on our team reviews every match before anyone hears about it, and you see a short summary of each candidate who says yes. ${NEVER_ASKS}`,
  updated: (title: string) => `Updated: ${title}.`,
  closed: (title: string) => `Closed: ${title}. No new candidates will be sent for it.`,
  readBack: (d: PostingDraft) => {
    const title = cap(d.title ?? "the job");
    const bits = [title, plural(d.openings ?? 1, "opening"), `$${d.payMin}k-$${d.payMax}k a year`, where(d.mode, d.area)];
    const must = d.must?.length ? ` Must-haves: ${d.must.map(m => human(m.skill)).join(", ")}.` : "";
    const nice = d.nice?.length ? ` Nice to have: ${d.nice.map(human).join(", ")}.` : "";
    const sp = d.sponsors === undefined ? "" : d.sponsors ? " Visa sponsorship: yes." : " Visa sponsorship: no.";
    return `Here's your job post: ${bits.join(", ")}.${must}${nice}${sp} Reply yes to post it, or tell me what to change.`;
  },
  readBackClose: (title: string) => `Close your ${title} post? Intros for it that are not done yet end, and no new candidates are sent. Reply yes or no.`,
};

/** The postings of one manager in a (seat) snapshot. */
export function postingsOf(snap: Pick<WorldSnapshot, "members" | "intents" | "facets">, managerId: MemberId): PostingRef[] {
  const out: PostingRef[] = [];
  for (const m of snap.members) {
    if (seatOwnerOf(m) !== managerId) continue;
    const i = snap.intents.find(x => x.memberId === m.id && (x.details ?? "").startsWith(JOB_INTENT));
    const openings = Number(snap.facets.find(f => f.id === `${m.id}:openings`)?.tags.find(t => t.startsWith(T.openings))?.slice(T.openings.length) ?? 0);
    out.push({ id: postingIdOf(m.id), seat: m.id, title: (i?.objective ?? "").replace(/^Hire:\s*/i, "") || "your job", active: i?.status === "active", openings });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** The intake result for one text: a draft and the message to send, or undefined (not about a posting). */
export interface IntakeStep { draft?: PostingDraft; text: string; ready: boolean }

/**
 * The exact saved posting a read-back showed. Every stored field is in it, so two changes in the same
 * clock interval still give different revisions (spec/postingPolicy.md, "A stale yes never reopens or
 * overwrites a posting that staff changed or closed").
 */
export function postingRevision(p: JobPosting): string {
  return JSON.stringify([
    p.id, p.title, p.family, p.seniority, p.openings, p.payMin, p.payMax, p.mode, p.area, p.sponsors,
    p.status, p.closedReason, p.createdAt, p.updatedAt,
    p.must.map(m => `${m.skill}:${m.level}`).sort(),
    [...p.nice].sort(),
  ]);
}

/** The postings a text names. A title inside another named title is one match; two separate names stay ambiguous. */
function namedPostings(text: string, postings: readonly PostingRef[]): PostingRef[] {
  const lower = text.trim().toLowerCase();
  const mentions: { posting: PostingRef; start: number; end: number }[] = [];
  for (const posting of postings) {
    const title = posting.title.toLowerCase();
    if (!title) continue;
    for (let start = lower.indexOf(title); start >= 0; start = lower.indexOf(title, start + 1)) {
      const end = start + title.length;
      if (/[\p{L}\p{N}]/u.test(lower[start - 1] ?? "") || /[\p{L}\p{N}]/u.test(lower[end] ?? "")) continue;
      mentions.push({ posting, start, end });
    }
  }
  const named = new Set(mentions.filter(m => !mentions.some(n =>
    n.start <= m.start && n.end >= m.end && (n.start < m.start || n.end > m.end),
  )).map(m => m.posting.id));
  return postings.filter(p => named.has(p.id));
}

/** The one posting a text names, or the only open posting when the text names none. */
function pickPosting(text: string, open: readonly PostingRef[]): PostingRef | undefined {
  const named = namedPostings(text, open);
  return named.length === 1 ? named[0] : !text.trim() && open.length === 1 ? open[0] : undefined;
}

/** Words that make a text a request or a thought, not a job title ("can you find me a cofounder", "hmm let me think"). */
const NOT_A_TITLE = /\b(?:can|could|would|will|should|please|find|help|need|want|looking|let|think|thinking|know|sure|maybe|hmm+|um+|uh+|why|what|how|when|where|who|you|your|me|my|i'm|im)\b/i;

/** A bare job title: a short phrase (at most 6 words), no question mark, no request words. */
function looksLikeTitle(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 6 && !text.includes("?") && !NOT_A_TITLE.test(text);
}

/** True when a reply also states a field that differs from the draft (a correction needs a new read-back). */
export function postingDetailsChanged(body: string, draft: PostingDraft): boolean {
  return Object.entries(parsePosting(body)).some(([field, value]) =>
    JSON.stringify(value) !== JSON.stringify(draft[field as keyof PostingDraft]));
}

/**
 * Read a new draft, an update, a close, or a reply to the waiting draft in a handled turn. Returns the
 * next message: a question for a missing field, or the read-back (ready: a yes saves it). The waiting
 * draft owns its question count; a new command starts a new count. An update or close reads every field
 * back from the stored posting and keeps its revision for the check at the yes.
 */
export function readPostingText(body: string, ctx: {
  draft?: PostingDraft;
  postings: readonly PostingRef[];
  newId: string;
  storedPosting: (id: string) => JobPosting | undefined;
}): IntakeStep | undefined {
  const t = commandText(body);
  const update = UPDATE_POSTING.exec(t);
  const close = CLOSE_POSTING.exec(t);
  const filled = FILLED_POSTING.exec(t);
  const newPost = START_POSTING.test(t);
  const pending = !update && !close && !filled && !newPost ? ctx.draft : undefined;
  if (!update && !close && !filled && !newPost && !pending) return undefined;

  if (close || filled || pending?.close) {
    const open = ctx.postings.filter(p => p.active);
    if (!open.length) return { text: POSTING_COPY.nothingToClose, ready: false };
    const target = close?.[1] ?? (filled ? filled[1]?.replace(/\s+(?:job|post|posting|role)\s*$/i, "") ?? "" : t);
    const pick = pickPosting(target, open);
    const closeReason = filled ? "filled" : pending?.closeReason ?? "closed";
    const draft: PostingDraft = { close: true, closeReason, ...(pending?.asks !== undefined ? { asks: pending.asks } : {}) };
    const stored = pick ? ctx.storedPosting(pick.id) : undefined;
    if (!pick || !stored) return { draft, text: POSTING_COPY.whichToClose(open.map(p => p.title)), ready: false };
    return { draft: { ...draft, id: pick.id, title: pick.title, revision: postingRevision(stored) }, text: POSTING_COPY.readBackClose(pick.title), ready: true };
  }

  let base: PostingDraft = newPost ? { id: ctx.newId } : { ...pending };
  let read = parsePosting(update ? t.slice(update[0].length) : pending?.chooseUpdate ? "" : t);
  if (update || pending?.chooseUpdate) {
    // "Update my data analyst post: 3 openings": the named (or only) open post, read back from its stored fields.
    const open = ctx.postings.filter(p => p.active);
    if (!open.length) return { text: POSTING_COPY.nothingToClose, ready: false };
    const pick = pickPosting(update ? update[1]! : t, open);
    const { chooseUpdate: _choose, asks, ...savedEdits } = pending ?? {};
    const stored = pick ? ctx.storedPosting(pick.id) : undefined;
    if (!pick || !stored) return {
      draft: { ...savedEdits, ...read, chooseUpdate: true, ...(asks !== undefined ? { asks } : {}) },
      text: POSTING_COPY.whichToClose(open.map(p => p.title)).replace("close", "update"),
      ready: false,
    };
    const { title, family, seniority, openings, payMin, payMax, mode, area, must, nice, sponsors } = stored;
    base = { id: pick.id, revision: postingRevision(stored), title, family, seniority, openings, payMin, payMax, mode, area, must, nice, sponsors, ...(asks !== undefined ? { asks } : {}) };
    read = { ...savedEdits, ...read };
  } else if (!newPost && pending && pending.asked === "title" && !pending.title && !read.title
    && Object.keys(read).every(field => field === "seniority") && parseReply(t).reason === "no_signal" && looksLikeTitle(t)) {
    // A direct answer to "What's the job title?" ("Data analyst"). Any other text goes on to normal handling.
    const title = parsePosting(`title: ${t}`).title;
    if (title) read.title = title;
  }
  if (!newPost && !update && !pending?.chooseUpdate && !Object.keys(read).length) return undefined;
  const { asked: _asked, ...merged }: PostingDraft = { ...base, ...read };
  const need = missing(merged);
  if (need.length) return { draft: { ...merged, asked: need[0]! }, text: need[0] === "title" ? POSTING_COPY.askTitle : POSTING_COPY.askPay, ready: false };
  return { draft: merged, text: POSTING_COPY.readBack(merged), ready: true };
}

/** The posting a confirmed draft saves (an update keeps what the draft does not change). */
export function postingFromDraft(d: PostingDraft, managerId: MemberId, now: number, prev?: JobPosting): JobPosting | undefined {
  if (!d.id) return undefined;
  if (d.close) return prev ? { ...prev, status: "closed", closedReason: d.closeReason ?? "closed", updatedAt: now } : undefined;
  const title = d.title ?? prev?.title;
  const payMin = d.payMin ?? prev?.payMin, payMax = d.payMax ?? prev?.payMax;
  if (!title || payMin === undefined || payMax === undefined) return undefined;
  return {
    id: d.id, managerId, title, family: d.family ?? prev?.family ?? slug(title), ...(d.seniority ?? prev?.seniority ? { seniority: d.seniority ?? prev?.seniority } : {}),
    openings: d.openings ?? prev?.openings ?? 1, payMin, payMax, mode: d.mode ?? prev?.mode ?? "onsite", ...(d.area ?? prev?.area ? { area: d.area ?? prev?.area } : {}),
    must: d.must ?? prev?.must ?? [], nice: d.nice ?? prev?.nice ?? [], ...((d.sponsors ?? prev?.sponsors) !== undefined ? { sponsors: (d.sponsors ?? prev?.sponsors)! } : {}),
    status: "active", createdAt: prev?.createdAt ?? now, updatedAt: now,
  };
}

/** Check a posting's fields (the staff API and the Network both call it). Undefined when valid. */
export function postingProblem(p: JobPosting): string | undefined {
  if (!/^[A-Za-z0-9_.-]{1,80}$/.test(p.id)) return "invalid_id";
  if (!p.title.trim() || p.title.length > 80) return "invalid_title";
  if (!Number.isInteger(p.openings) || !openingsInRange(p.openings)) return "invalid_openings";
  if (!Number.isFinite(p.payMin) || !Number.isFinite(p.payMax) || !payRangeAllowed(p.payMin, p.payMax)) return "pay_range_required";
  if (!["onsite", "hybrid", "remote"].includes(p.mode)) return "invalid_mode";
  if (p.must.length > 12 || p.nice.length > 12 || p.must.some(m => !m.skill || !Number.isInteger(m.level) || m.level < 0 || m.level > 5)) return "invalid_skills";
  return undefined;
}

/**
 * The rows of a posting in the engine's own types (the snapshot reads the same shape from Postgres):
 * the intent and the manager's facets tagged `peon:posting:<id>`. The openings facet is matchable;
 * what a candidate may hear (title, pay, place, must-haves) is shareable.
 */
export function postingFacts(p: JobPosting): { intent: Intent; facets: Facet[] } {
  const tag = `${T.posting}${p.id}`;
  const f = (suffix: string, kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"] = "shareable"): Facet => ({
    id: `${p.id}-${suffix}`, memberId: p.managerId, kind, value, tags: [...tags, tag], scope, provenance: "said", confidence: 0.9, validFrom: p.createdAt, source: "chat", confirmedByMember: true,
  });
  // One row per skill (the facet id is unique): the highest stated level wins.
  const mustLevels = new Map<string, number>();
  for (const { skill, level } of p.must) mustLevels.set(skill, Math.max(level, mustLevels.get(skill) ?? level));
  // The posted headcount stays on a closed row; the seat projection (engine peonSeats) gives a closed posting no openings.
  const facets: Facet[] = [
    f("revision", "fact", "Posting revision", [
      `${T.postingUpdatedAt}${p.updatedAt}`,
      ...(p.status === "closed" && p.closedReason ? [`${T.postingClosedReason}${p.closedReason}`] : []),
    ], "agent_private"),
    f("role", "fact", `${p.title} role`, [`${T.family}${p.family}`, ...(p.seniority ? [`${T.seniority}${p.seniority}`] : [])]),
    f("pay", "fact", `Pay $${p.payMin}k-$${p.payMax}k`, [`${T.pay}${p.payMin}-${p.payMax}`]),
    f("mode", "fact", where(p.mode, p.area), [`${T.mode}${p.mode}`, `${T.market}nyc`, ...(p.area ? [`${T.area}${p.area}`] : [])]),
    ...[...mustLevels].map(([skill, level]) => f(`must-${skill}`, "skill", `Must have ${human(skill)}`, [`${T.must}${skill}:${level}`])),
    ...[...new Set(p.nice)].map(n => f(`nice-${n}`, "skill", `Nice to have ${human(n)}`, [`${T.nice}${n}`])),
    f("open", "fact", "Openings", [`${T.openings}${p.openings}`, `${T.urgency}2`, `${T.sponsors}${p.sponsors ? "yes" : "no"}`], "matchable"),
  ];
  const intent: Intent = { id: p.id, memberId: p.managerId, objective: `Hire: ${p.title}`, category: "professional" as Category, details: JOB_INTENT, horizonDays: 90, status: p.status, createdAt: p.createdAt };
  return { intent, facets };
}

/** A posting back from its rows (the intent and the facets tagged with its id). */
export function postingFromFacts(intent: Intent, facets: readonly Facet[]): JobPosting {
  const tags = facets.filter(f => f.tags.includes(`${T.posting}${intent.id}`)).flatMap(f => f.tags);
  const one = (prefix: string) => tags.find(t => t.startsWith(prefix))?.slice(prefix.length);
  const [payMin, payMax] = (one(T.pay) ?? "0-0").split("-").map(Number) as [number, number];
  const seniority = one(T.seniority);
  const updatedAt = Number(one(T.postingUpdatedAt));
  const closedReason = one(T.postingClosedReason);
  return {
    id: intent.id, managerId: intent.memberId, title: intent.objective.replace(/^Hire:\s*/i, ""), family: one(T.family) ?? slug(intent.objective),
    ...(seniority ? { seniority: Number(seniority) } : {}),
    openings: Number(one(T.openings) ?? 1) || 1, payMin, payMax, mode: (one(T.mode) ?? "onsite") as PeonMode, ...(one(T.area) ? { area: one(T.area)! } : {}),
    must: tags.filter(t => t.startsWith(T.must)).map(t => { const [s, l] = t.slice(T.must.length).split(":"); return { skill: s!, level: Number(l ?? 2) }; }),
    nice: tags.filter(t => t.startsWith(T.nice)).map(t => t.slice(T.nice.length)),
    ...(one(T.sponsors) ? { sponsors: one(T.sponsors) === "yes" } : {}),
    ...(intent.status !== "active" && (closedReason === "closed" || closedReason === "filled") ? { closedReason } : {}),
    status: intent.status === "active" ? "active" : "closed",
    createdAt: intent.createdAt, updatedAt: Number.isFinite(updatedAt) ? updatedAt : intent.createdAt,
  };
}

// ------------------------------------------------------------------ seat copy (the peon hooks, service/packs.ts)
/** What the seat copy needs of a job seat, read from the pack input (shareable posting facets only). */
export interface SeatJob { title: string; pay?: string; where?: string; must: { skill: string; level: number }[] }

export function seatJob(input: Pick<EngineInput, "facets" | "intents">, seat: MemberId): SeatJob {
  const intent = input.intents.find(i => i.memberId === seat && (i.details ?? "").startsWith(JOB_INTENT));
  const facets = input.facets.filter(f => f.memberId === seat);
  const tags = facets.flatMap(f => f.tags);
  const pay = tags.find(t => t.startsWith(T.pay))?.slice(T.pay.length).split("-");
  const mode = tags.find(t => t.startsWith(T.mode))?.slice(T.mode.length) as PeonMode | undefined;
  const area = tags.find(t => t.startsWith(T.area))?.slice(T.area.length);
  return {
    title: (intent?.objective ?? "").replace(/^Hire:\s*/i, "") || "a role",
    ...(pay?.length === 2 ? { pay: `$${pay[0]}k-$${pay[1]}k` } : {}), ...(mode ? { where: where(mode, area) } : {}),
    must: tags.filter(t => t.startsWith(T.must)).map(t => { const [s, l] = t.slice(T.must.length).split(":"); return { skill: s!, level: Number(l ?? 2) }; }),
  };
}

/** The must-have checks of a candidate for a seat (claimed or demonstrated levels; never a score). */
export function mustMarks(input: Pick<EngineInput, "facets">, candidate: MemberId, job: SeatJob): { skill: string; met: boolean }[] {
  const level = new Map<string, number>();
  for (const f of input.facets) if (f.memberId === candidate) for (const t of f.tags) {
    const m = /^peon:(?:skill|demonstrated):([^:]+):(\d)$/.exec(t);
    if (m) level.set(m[1]!, Math.max(level.get(m[1]!) ?? 0, Number(m[2])));
  }
  return job.must.map(m => ({ skill: m.skill, met: (level.get(m.skill) ?? -1) >= m.level }));
}

export const SEAT_COPY = {
  candidateProbe: (j: SeatJob) => `A verified employer is hiring: ${j.title}${j.pay ? `, ${j.pay}` : ""}${j.where ? `, ${j.where}` : ""}. Want me to put you forward? They see only a short summary, never your name, until they say yes too. ${NEVER_ASKS}`,
  managerProbe: (j: SeatJob, marks: { skill: string; met: boolean }[], startWeeks?: number) => {
    const met = marks.filter(m => m.met).length;
    const checks = marks.length ? ` Meets ${met} of ${marks.length} must-haves (${marks.map(m => `${human(m.skill)} ${m.met ? "yes" : "no"}`).join(", ")}).` : "";
    const start = startWeeks !== undefined ? ` Can start in ${plural(startWeeks, "week")}.` : "";
    return `A candidate said yes to your ${j.title} post.${checks}${start} Want an intro? Reply yes or no. You get their name only if you say yes.`;
  },
  candidateIntro: (j: SeatJob, manager: string) => `Good news: ${manager}, who is hiring for ${j.title}, said yes too. Write here and I'll pass it on, or ask me to share your number. ${NEVER_ASKS}`,
  managerIntro: (j: SeatJob, candidate: string) => `Intro: ${candidate} said yes to your ${j.title} post. Write here and I'll pass it on, or ask me to share your number.`,
  checkIn: (j: SeatJob, other: string) => `Did you and ${other} talk about the ${j.title} role? Tell me how it went, and tell me if anything felt off.`,
  postingClosed: "That job is no longer open, so I've stopped that intro. I'll keep looking for you.",
};

/** The seat of an opportunity, if the engine proposed it for a job seat (participants carry the seat id). */
export function seatIn(participants: readonly MemberId[]): MemberId | undefined { return participants.find(isSeatId); }
export { isSeatId, seatIdOf, seatOwnerOf, postingIdOf };
