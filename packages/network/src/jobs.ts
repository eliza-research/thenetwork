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
import type { Category, Facet, Intent, MemberId, WorldSnapshot } from "@thenetwork/core";
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
  title?: string; family?: string; seniority?: number; openings?: number; payMin?: number; payMax?: number;
  mode?: PeonMode; area?: string; must?: { skill: string; level: number }[]; nice?: string[]; sponsors?: boolean;
  /** Questions asked for this draft (at most 2 before it is dropped). */
  asks?: number;
  /** Read back in full: the manager's yes saves it. */
  ready?: boolean;
}

/** A manager's posting as the Network sees it in the snapshot (seat members). */
export interface PostingRef { id: string; seat: MemberId; title: string; active: boolean; openings: number }

export const MAX_OPENINGS = 50;
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1 };
const SENIORITY: [RegExp, number][] = [[/\b(intern|entry[- ]level|junior|jr)\b/i, 1], [/\b(mid[- ]level|mid)\b/i, 2], [/\b(senior|sr)\b/i, 3], [/\b(staff|lead)\b/i, 4], [/\bprincipal\b/i, 5]];
const BOROUGHS = ["manhattan", "brooklyn", "queens", "bronx", "staten island"];
const AREAS = [...BOROUGHS, ...NEIGHBORHOODS.map(n => n.name.toLowerCase())].sort((a, b) => b.length - a.length);

/** A text that starts or changes a job post (a posting command). */
export const POSTING_COMMAND = /^\s*(?:(?:we(?:'| a)?re|i(?:'| a)?m|we are|i am|now)\s+hiring\b|hiring\s*:|post(?:ing)?\s+(?:a\s+)?(?:new\s+)?job\b|new\s+job\s+post|job\s+post(?:ing)?\s*:|update\s+(?:my|our|the)\s+[\w ]{0,40}?(?:job|post|posting|role)\b|(?:close|take\s+down|remove)\s+(?:my|our|the)\s+[\w ]{0,40}?(?:job|post|posting|role)\b|we\s+(?:filled|hired\s+for)\s+(?:the|our|my)\b)/i;
const CLOSE_COMMAND = /^\s*(?:(?:close|take\s+down|remove)\s+(?:my|our|the)\b|we\s+(?:filled|hired\s+for)\b)/i;

/** Read job-post fields from one text (rules only). Fields not in the text stay undefined. */
export function parsePosting(body: string): PostingDraft {
  const t = body.replace(/\s+/g, " ").trim();
  const d: PostingDraft = {};
  const title = /(?:hiring|job(?: post(?:ing)?)?|post(?:ing)?(?: a)?(?: new)? job(?: for)?|role|title)\s*(?:for|:|is|-)?\s*(?:an?\s+|the\s+)?([a-z][a-z0-9 /&+.-]{1,48}?)(?=\s*(?:[,.;(]|$)|\s+(?:(?:in|at|for|with|paying|pay|remote|hybrid|on-?site|in-office)\b|x\s?\d|\$|\d))/i.exec(t);
  if (title) {
    const raw = title[1]!.trim().replace(/\s+(?:role|position|job)$/i, "");
    if (!/^(?:a|an|the|job|post|posting|new|for|my|our)$/i.test(raw) && raw.length >= 2) d.title = raw.toLowerCase();
  }
  const open = /\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:open(?:ing)?s?|roles?|seats?|positions?|hires?|people|spots?)\b/i.exec(t) ?? /\bx\s?(\d{1,2})\b/i.exec(t);
  if (open) { const n = WORDS[open[1]!.toLowerCase()] ?? Number(open[1]); if (Number.isInteger(n) && n >= 1 && n <= MAX_OPENINGS) d.openings = n; }
  const pay = /\$?\s*(\d{2,3})(?:,000|k)?\s*(?:-|–|to)\s*\$?\s*(\d{2,3})(?:,000)?\s*k\b/i.exec(t) ?? /\$\s*(\d{2,3})(?:,000|k)\s*(?:-|–|to)\s*\$?\s*(\d{2,3})(?:,000|k)?/i.exec(t);
  if (pay) { const a = Number(pay[1]), b = Number(pay[2]); if (a >= 10 && b >= a && b <= 999) { d.payMin = a; d.payMax = b; } }
  if (/\bremote\b/i.test(t)) d.mode = "remote"; else if (/\bhybrid\b/i.test(t)) d.mode = "hybrid"; else if (/\b(on-?site|in[- ]office|in person)\b/i.test(t)) d.mode = "onsite";
  const lower = ` ${t.toLowerCase().replace(/[^a-z0-9' -]+/g, " ")} `;
  const area = AREAS.find(a => lower.includes(` ${a} `));
  if (area) d.area = slug(area);
  for (const [re, n] of SENIORITY) if (re.test(t)) { d.seniority = n; break; }
  const lvl = /\blevel\s*([1-5])\b/i.exec(t); if (lvl) d.seniority = Number(lvl[1]);
  const list = (s: string) => s.split(/,|\band\b|\/|;/i).map(x => x.trim().toLowerCase()).filter(x => x && x.length <= 40 && !/^(?:a|an|the|some)$/.test(x));
  const must = /\bmust(?:[- ]haves?|\s+have|\s+know)?\s*:?\s*([^.;]+?)(?=\.|;|\bnice to have\b|$)/i.exec(t);
  if (must) d.must = list(must[1]!).map(x => { const m = /^(.*?)\s*(?:\(?(?:level\s*)?([0-5])\)?)$/i.exec(x); return { skill: slug(m?.[1] || x), level: m?.[2] ? Number(m[2]) : 2 }; }).filter(x => x.skill);
  const nice = /\bnice[- ]to[- ]haves?\s*:?\s*([^.;]+)/i.exec(t);
  if (nice) d.nice = list(nice[1]!).map(slug).filter(Boolean);
  if (/\b(can|will|we)\s+sponsor\b|\bsponsorship (?:available|ok|yes)\b/i.test(t)) d.sponsors = true;
  else if (/\bno (?:visa )?sponsorship\b|\b(?:can(?:'|no)?t|cannot|won'?t|don'?t) sponsor\b/i.test(t)) d.sponsors = false;
  return d;
}

/** The fields still missing before a draft can be read back (a title and a pay range). */
export function missing(d: PostingDraft): ("title" | "pay")[] {
  if (d.close) return [];
  return [...(d.title ? [] : ["title" as const]), ...(d.payMin !== undefined && d.payMax !== undefined ? [] : ["pay" as const])];
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
 * Read one text in a handled turn. `draft`: what waits for the manager's yes. A posting command
 * starts a new draft (or a close); a text while a draft waits corrects it. Returns the next message:
 * a question for a missing field, or the read-back (ready: a yes saves it).
 */
export function readPostingText(body: string, ctx: { draft?: PostingDraft; postings: readonly PostingRef[]; newId: string }): IntakeStep | undefined {
  const command = POSTING_COMMAND.test(body);
  if (!command && !ctx.draft) return undefined;
  if (command && CLOSE_COMMAND.test(body)) {
    const open = ctx.postings.filter(p => p.active);
    if (!open.length) return { text: POSTING_COPY.nothingToClose, ready: false };
    const lower = body.toLowerCase();
    const named = open.filter(p => lower.includes(p.title.toLowerCase()));
    const pick = named.length === 1 ? named[0] : open.length === 1 ? open[0] : undefined;
    if (!pick) return { draft: { close: true }, text: POSTING_COPY.whichToClose(open.map(p => p.title)), ready: false };
    return { draft: { close: true, id: pick.id, title: pick.title }, text: POSTING_COPY.readBackClose(pick.title), ready: true };
  }
  if (ctx.draft?.close && !command) {
    const lower = body.toLowerCase();
    const pick = ctx.postings.filter(p => p.active && lower.includes(p.title.toLowerCase()));
    if (pick.length !== 1) return undefined;
    return { draft: { close: true, id: pick[0]!.id, title: pick[0]!.title }, text: POSTING_COPY.readBackClose(pick[0]!.title), ready: true };
  }
  const read = parsePosting(body);
  const base: PostingDraft = command && !/^\s*update\b/i.test(body) ? { id: ctx.newId } : { ...(ctx.draft ?? {}) };
  if (command && /^\s*update\b/i.test(body)) {
    // "Update my data analyst post: 3 openings": the named (or only) active post, its stored fields kept by the caller.
    const open = ctx.postings.filter(p => p.active);
    const named = open.filter(p => body.toLowerCase().includes(p.title.toLowerCase()));
    const pick = named.length === 1 ? named[0] : open.length === 1 ? open[0] : undefined;
    if (!pick) return { text: open.length ? POSTING_COPY.whichToClose(open.map(p => p.title)).replace("close", "update") : POSTING_COPY.nothingToClose, ready: false };
    if (base.id !== pick.id) { base.id = pick.id; base.title ??= pick.title; }
    if (read.title?.toLowerCase() === pick.title.toLowerCase() || (read.title && body.toLowerCase().includes(`${read.title} post`))) delete read.title;
  }
  const merged: PostingDraft = { ...base };
  for (const [k, v] of Object.entries(read)) if (v !== undefined) (merged as Record<string, unknown>)[k] = v;
  if (!command && !Object.keys(read).length) return undefined;
  const need = missing(merged);
  if (need.length) return { draft: merged, text: need[0] === "title" ? POSTING_COPY.askTitle : POSTING_COPY.askPay, ready: false };
  return { draft: merged, text: POSTING_COPY.readBack(merged), ready: true };
}

/** The posting a confirmed draft saves (an update keeps what the draft does not change). */
export function postingFromDraft(d: PostingDraft, managerId: MemberId, now: number, prev?: JobPosting): JobPosting | undefined {
  if (!d.id) return undefined;
  if (d.close) return prev ? { ...prev, status: "closed", closedReason: "closed", updatedAt: now } : undefined;
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
  if (!Number.isInteger(p.openings) || p.openings < 1 || p.openings > MAX_OPENINGS) return "invalid_openings";
  if (!Number.isFinite(p.payMin) || !Number.isFinite(p.payMax) || p.payMin < 10 || p.payMax < p.payMin || p.payMax > 999) return "pay_range_required";
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
  const facets: Facet[] = [
    f("role", "fact", `${p.title} role`, [`${T.family}${p.family}`, ...(p.seniority ? [`${T.seniority}${p.seniority}`] : [])]),
    f("pay", "fact", `Pay $${p.payMin}k-$${p.payMax}k`, [`${T.pay}${p.payMin}-${p.payMax}`]),
    f("mode", "fact", where(p.mode, p.area), [`${T.mode}${p.mode}`, `${T.market}nyc`, ...(p.area ? [`${T.area}${p.area}`] : [])]),
    ...p.must.map(m => f(`must-${m.skill}`, "skill", `Must have ${human(m.skill)}`, [`${T.must}${m.skill}:${m.level}`])),
    ...p.nice.map(n => f(`nice-${n}`, "skill", `Nice to have ${human(n)}`, [`${T.nice}${n}`])),
    f("open", "fact", "Openings", [`${T.openings}${p.status === "active" ? p.openings : 0}`, `${T.urgency}2`, `${T.sponsors}${p.sponsors ? "yes" : "no"}`], "matchable"),
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
  return {
    id: intent.id, managerId: intent.memberId, title: intent.objective.replace(/^Hire:\s*/i, ""), family: one(T.family) ?? slug(intent.objective),
    ...(seniority ? { seniority: Number(seniority) } : {}),
    openings: Number(one(T.openings) ?? 1) || 1, payMin, payMax, mode: (one(T.mode) ?? "onsite") as PeonMode, ...(one(T.area) ? { area: one(T.area)! } : {}),
    must: tags.filter(t => t.startsWith(T.must)).map(t => { const [s, l] = t.slice(T.must.length).split(":"); return { skill: s!, level: Number(l ?? 2) }; }),
    nice: tags.filter(t => t.startsWith(T.nice)).map(t => t.slice(T.nice.length)),
    ...(one(T.sponsors) ? { sponsors: one(T.sponsors) === "yes" } : {}),
    status: intent.status === "active" ? "active" : "closed", createdAt: intent.createdAt, updatedAt: intent.createdAt,
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
