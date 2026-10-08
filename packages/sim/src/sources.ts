// Profile richness tiers and simulated connected sources (founder request 2026-10-06).
//
// Every persona keeps COMPLETE hidden truth (so the oracle still knows true compatibility). What
// the Network KNOWS about them is a separate, tiered and noisy view:
//   1. chat coverage: which of the things they would say (PublicProfile) they actually told the
//      agent, which grows with chat history (tier);
//   2. connected sources (Gmail, Calendar, LinkedIn, Instagram, GitHub, Strava, Spotify, event
//      platforms, a personal site, X, an AI-memory paste) plus public profiles OF THE MEMBER that
//      the Network found with consent and the member confirmed. Each active source yields facets
//      derived deterministically from hidden truth + seeded noise: partial coverage, stale facts
//      (an old job), wrong inferences (a gift read as a hobby), and sensitive inferences that are
//      always agent_private.
// Nothing here ever describes a non-member: every source has subject "self", and found profiles
// that turn out to be someone else (namesakes) keep no data at all.
import { DAY, type ConnectedSourceSummary, type Facet, type FacetKind, type PrivacyScope, type SensitiveCategory, type SourceKind, type SourceLink } from "@thenetwork/core";
import type { Rng } from "@thenetwork/core";
import type { AdversarialKind, Archetype, Persona } from "./persona.ts";
import { INTERESTS, SKILLS, desireById } from "./taxonomy.ts";

export type RichnessTier = "minimal" | "light" | "medium" | "rich" | "very_rich";
export const RICHNESS_TIERS: readonly RichnessTier[] = ["minimal", "light", "medium", "rich", "very_rich"];
/** Target population mix (exact quotas by rank, see assignRichness). */
export const DEFAULT_RICHNESS_MIX: Record<RichnessTier, number> = { minimal: 0.15, light: 0.25, medium: 0.3, rich: 0.2, very_rich: 0.1 };

export type ActiveSourceKind = Exclude<SourceKind, "chat" | "vouch">;
export const SOURCE_KINDS: readonly ActiveSourceKind[] = [
  "gmail", "google_calendar", "linkedin", "x", "instagram", "github", "strava", "spotify",
  "eventbrite", "partiful", "luma", "personal_website", "ai_memory",
];
/** Sources a minor may connect (single-player help only; never social, Gmail or location-revealing). */
export const MINOR_ALLOWED_SOURCES: ReadonlySet<ActiveSourceKind> = new Set(["google_calendar", "spotify", "github"]);
/** Public profiles the Network may look for (with consent) for the member themselves. */
export const DISCOVERABLE_SOURCES: readonly ActiveSourceKind[] = ["linkedin", "instagram", "github", "strava", "x", "personal_website"];
const DEFAULT_LINK: Record<ActiveSourceKind, SourceLink> = {
  gmail: "oauth", google_calendar: "oauth", linkedin: "profile_url", x: "profile_url", instagram: "oauth", github: "oauth",
  strava: "oauth", spotify: "oauth", eventbrite: "oauth", partiful: "oauth", luma: "oauth", personal_website: "profile_url", ai_memory: "paste",
};
export const SOURCE_LABEL: Record<SourceKind, string> = {
  chat: "conversation", vouch: "vouch note", ai_memory: "AI-assistant memory", gmail: "Gmail", google_calendar: "Google Calendar",
  linkedin: "LinkedIn", x: "X", instagram: "Instagram", github: "GitHub", strava: "Strava", spotify: "Spotify",
  eventbrite: "Eventbrite", partiful: "Partiful", luma: "Luma", personal_website: "personal website",
};

/** What the member has told the agent in chat (subset of their PublicProfile), by tier. */
export interface ChatCoverage {
  /** Messages the member has sent the agent (chat history length). */
  messages: number;
  /** Stated interest / skill tags they actually mentioned. */
  interests: string[];
  skills: string[];
  /** Indices into public.statedIntents that are known. */
  intents: number[];
  /** none: no intent; vague: one vague category-level want; objective: the objective only; detailed: objective + details. */
  intentMode: "none" | "vague" | "objective" | "detailed";
  neighborhood: boolean; occupation: boolean; availability: boolean;
  /** Indices into hidden.boundaries they stated. */
  boundaries: number[];
  /** Whether they told the agent their private disclosure (agent_private facet + canary). */
  disclosure: boolean;
  offers: number; voiceSamples: number; bio: boolean;
}

/** Ground-truth label of a source-derived facet (hidden; never in public data). */
export type ObservationTruth = "correct" | "stale" | "wrong_inference";
export type FacetDraft = Omit<Facet, "id" | "memberId">;
export interface SourceObservation { facet: FacetDraft; truth: ObservationTruth; note?: string }

export interface Knowledge {
  richness: RichnessTier;
  chat: ChatCoverage;
  /** Every source entry, including pending / rejected / revoked ones (which have no observations). */
  sources: ConnectedSourceSummary[];
  /** Facets derived from active sources, with their hidden truth label. */
  observations: SourceObservation[];
}

export interface KnowledgeContext {
  tier: RichnessTier;
  now: number;
  joinedAt: number;
  /** Honest minor (stated age < 18): sources restricted, every facet agent_private. */
  minor: boolean;
  /** True current role and employer type when known to the generator (dataset); inferred otherwise. */
  occupation?: string;
  sector?: string;
}

// ---- tier assignment --------------------------------------------------------------------------
const ARCH_BIAS: Record<Archetype, number> = {
  very_active: 0.5, connector: 0.5, traveler: 0.15, regular: 0.1, busy_parent: -0.1, introvert: -0.15, newcomer: -0.35, never_replies: -0.6,
};
export interface RichnessCandidate { id: string; archetype: Archetype; tenureDays: number; minor?: boolean; adversarial?: AdversarialKind }

/**
 * Exact-quota tier assignment by rank of a noisy engagement score (archetype + tenure). Very
 * active, long-tenured members skew rich; newcomers and never-repliers skew minimal.
 */
export function assignRichness(cands: RichnessCandidate[], r: Rng, mix: Partial<Record<RichnessTier, number>> = DEFAULT_RICHNESS_MIX): Map<string, RichnessTier> {
  const m = { ...DEFAULT_RICHNESS_MIX, ...mix };
  const total = RICHNESS_TIERS.reduce((s, t) => s + m[t], 0) || 1;
  const n = cands.length;
  const raw = RICHNESS_TIERS.map(t => (m[t] / total) * n);
  const quota = raw.map(Math.floor);
  let left = n - quota.reduce((s, q) => s + q, 0);
  [...raw.keys()].sort((a, b) => (raw[b]! - quota[b]!) - (raw[a]! - quota[a]!) || a - b).forEach(i => { if (left > 0) { quota[i]!++; left--; } });
  const scored = cands.map(c => ({ id: c.id, s: ARCH_BIAS[c.archetype] + 0.4 * Math.min(1, Math.max(0, c.tenureDays) / 180) + r.fork("score", c.id).normal(0, 0.35) }))
    .sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1));
  const out = new Map<string, RichnessTier>();
  let k = 0;
  for (let ti = RICHNESS_TIERS.length - 1; ti >= 0; ti--) for (let q = 0; q < quota[ti]!; q++) out.set(scored[k++]!.id, RICHNESS_TIERS[ti]!);
  return out;
}

// ---- chat coverage ------------------------------------------------------------------------------
interface ChatParams { msgs: [number, number]; interest: number; skill: number; occ: number; avail: number; hood: number; bound: number; disc: number; offers: number; samples: number; bio: boolean }
const CHAT: Record<RichnessTier, ChatParams> = {
  minimal:   { msgs: [1, 4],     interest: 0,    skill: 0,    occ: 0,   avail: 0,   hood: 0,   bound: 0,   disc: 0,   offers: 0, samples: 0, bio: false },
  light:     { msgs: [4, 12],    interest: 0.35, skill: 0.3,  occ: 0.4, avail: 0.3, hood: 0.8, bound: 0.3, disc: 0.3, offers: 0, samples: 1, bio: false },
  medium:    { msgs: [12, 40],   interest: 0.6,  skill: 0.6,  occ: 0.8, avail: 0.7, hood: 1,   bound: 0.6, disc: 0.6, offers: 1, samples: 2, bio: false },
  rich:      { msgs: [40, 120],  interest: 0.85, skill: 0.85, occ: 1,   avail: 0.9, hood: 1,   bound: 0.9, disc: 0.9, offers: 3, samples: 3, bio: true },
  very_rich: { msgs: [120, 400], interest: 1,    skill: 1,    occ: 1,   avail: 1,   hood: 1,   bound: 1,   disc: 1,   offers: 3, samples: 3, bio: true },
};

export function chatCoverage(p: Persona, tier: RichnessTier, r: Rng): ChatCoverage {
  const c = CHAT[tier];
  const keep = <T>(xs: T[], prob: number, min = 0) => {
    const kept = xs.filter(() => r.bool(prob));
    return kept.length >= min || !xs.length ? kept : xs.slice(0, min);
  };
  const nIntents = p.public.statedIntents.length;
  const intentMode: ChatCoverage["intentMode"] = tier === "minimal" ? (nIntents && r.bool(0.6) ? "vague" : "none") : tier === "light" ? (nIntents ? "objective" : "none") : nIntents ? "detailed" : "none";
  const intents = intentMode === "none" ? [] : intentMode === "vague" || intentMode === "objective" ? [0] : [...Array(nIntents).keys()];
  return {
    messages: r.int(c.msgs[0], c.msgs[1]),
    interests: keep(p.public.statedInterests, c.interest, tier === "light" ? 1 : 0),
    skills: keep(p.public.statedSkills, c.skill),
    intents, intentMode,
    neighborhood: r.bool(c.hood), occupation: r.bool(c.occ), availability: r.bool(c.avail),
    boundaries: [...p.hidden.boundaries.keys()].filter(() => r.bool(c.bound)),
    disclosure: !!p.hidden.privateDisclosure && r.bool(c.disc),
    offers: c.offers, voiceSamples: c.samples, bio: c.bio,
  };
}

/** Category-level phrasing for a minimal member's one vague want. */
export const VAGUE_INTENT: Record<string, string> = {
  social: "meet some new people", professional: "grow my network a bit", romance: "maybe meet someone",
  hobby: "find something fun to do on weekends", help: "get a hand with something", growth: "learn something new", events: "go to more things",
};

// ---- connected sources -----------------------------------------------------------------------------
const SOURCE_COUNT: Record<RichnessTier, [number, number][]> = {
  minimal: [[0, 1]],
  light: [[0, 0.55], [1, 0.45]],
  medium: [[0, 0.25], [1, 0.45], [2, 0.3]],
  rich: [[1, 0.25], [2, 0.4], [3, 0.35]],
  very_rich: [[3, 0.25], [4, 0.3], [5, 0.25], [6, 0.2]],
};
const CONFIRM_RATE: Record<RichnessTier, number> = { minimal: 0, light: 0.1, medium: 0.25, rich: 0.45, very_rich: 0.6 };

const tagsOf = (cluster: string) => INTERESTS.filter(i => i.cluster === cluster).map(i => i.tag);
const VISUAL = ["photography", "ceramics", "painting", "cooking", "coffee", "wine", "hiking", "climbing", "dogs", "dancing", "gardening", "yoga", "sailing", "film"];
const SPORTS_STRAVA = ["running", "cycling", "hiking", "climbing"];
const MUSIC = tagsOf("music");
const TECH = tagsOf("tech");
const RECEIPT = ["cooking", "wine", "coffee", "ceramics", "painting", "photography", "board_games", "books", "gardening", "dogs", "cycling", "climbing", "running", "yoga", "chess", "hardware"];
const TICKETED = ["live_music", "jazz", "rock_music", "electronic_music", "theater", "film", "dancing", "tennis", "basketball"];
const EVENTISH: Record<"eventbrite" | "partiful" | "luma", string[]> = {
  eventbrite: ["live_music", "theater", "film", "books", "volunteering", "urbanism", "dancing", "wine", "photography", "writing"],
  partiful: ["dancing", "live_music", "cooking", "wine", "board_games", "electronic_music", "coffee"],
  luma: ["ai", "startups", "climate_tech", "crypto", "hardware", "urbanism", "philosophy", "writing"],
};
const X_TOPICS = [...tagsOf("tech"), ...tagsOf("ideas"), ...tagsOf("civic"), "film", "books"];
const PRO_SKILLS = ["ml_engineering", "design", "fundraising", "pitch_feedback", "interview_practice", "hardware_eng", "climate_policy", "writing_editor"];
const GITHUB_SKILLS = ["ml_engineering", "hardware_eng", "design"];
const SITE_SKILLS = ["design", "photography_pro", "writing_editor", "ml_engineering", "pottery_wheel", "chef", "climate_policy"];
const SITE_INTERESTS = ["writing", "photography", "painting", "ceramics", "film", "ai", "hardware", "urbanism", "books"];
const AESTHETIC: Record<string, string> = {
  arts: "film-photo, gallery-heavy aesthetic", food: "food and cafe photos", outdoors: "trail and landscape shots",
  music: "gig photos and record sleeves", tech: "desk setups and conference badges", wellness: "calm, studio-light aesthetic",
  family: "family outings and park days", sports: "game-day photos", play: "game-night photos", ideas: "book stacks and notes", civic: "street and neighborhood photos",
};
const ROLE_BY_SKILL: Record<string, string> = {
  ml_engineering: "ML engineer", design: "product designer", hardware_eng: "electrical engineer", climate_policy: "climate policy analyst",
  writing_editor: "editor", fundraising: "startup founder", photography_pro: "photographer", chef: "chef", sailing_instructor: "sailing instructor",
};
const ROLE_BY_CLUSTER: Record<string, [string, string]> = {
  tech: ["software engineer", "software company"], arts: ["graphic designer", "design studio"], food: ["line cook", "restaurant group"],
  ideas: ["teacher", "school"], civic: ["policy analyst", "city agency"], wellness: ["physical therapist", "health clinic"],
  family: ["teacher", "public school"], music: ["sound engineer", "music venue"], sports: ["coach", "sports club"],
  play: ["operations manager", "small business"], outdoors: ["landscape architect", "parks nonprofit"],
};
const OLD_SECTORS = ["consulting firm", "retail chain", "university lab", "marketing agency", "bank", "law firm"];
const OLD_ROLES = ["junior analyst", "barista", "research assistant", "associate consultant", "teaching assistant", "sales associate", "marketing intern", "paralegal"];
const label = (t: string) => INTERESTS.find(i => i.tag === t)?.label ?? t.replace(/_/g, " ");
const cluster = (t: string) => INTERESTS.find(i => i.tag === t)?.cluster ?? "other";
const skillLabel = (t: string) => SKILLS.find(s => s.tag === t)?.label ?? t.replace(/_/g, " ");
const skillTags = (t: string) => { const sk = SKILLS.find(s => s.tag === t); return [t, ...(sk?.teaches ? [sk.teaches] : []), ...(t === "hosting" || t === "chef" ? ["host"] : [])]; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const r2 = (x: number) => Math.round(x * 100) / 100;

/** Plausible role + employer type for a persona when the generator did not fix one (sim worlds). */
export function inferredRole(p: Persona): { occupation: string; sector: string } {
  const sk = p.hidden.skills.find(s => ROLE_BY_SKILL[s]);
  const cl = cluster(p.hidden.interests[0] ?? "");
  const [role, sector] = ROLE_BY_CLUSTER[cl] ?? ["office manager", "small business"];
  return { occupation: sk ? ROLE_BY_SKILL[sk]! : role, sector: sk && ["ml_engineering", "hardware_eng", "design", "fundraising"].includes(sk) ? "tech startup" : sector };
}

/** Default scope for a source-derived facet: minors and sensitive -> agent_private; confirmed -> shareable (some kinds). */
export function sourceFacetScope(kind: FacetKind, o: { minor: boolean; sensitive?: SensitiveCategory; confirmed: boolean }): PrivacyScope {
  if (o.minor || o.sensitive) return "agent_private";
  if (o.confirmed && (kind === "interest" || kind === "availability_pattern" || kind === "offer")) return "shareable";
  return "matchable";
}

function sourceWeights(p: Persona, minor: boolean): [ActiveSourceKind, number][] {
  const h = p.hidden;
  const has = (xs: string[]) => h.interests.filter(t => xs.includes(t)).length;
  const tech = has(TECH) + h.skills.filter(s => ["ml_engineering", "hardware_eng", "design"].includes(s)).length;
  const w: [ActiveSourceKind, number][] = [
    ["gmail", 0.75], ["google_calendar", 0.6], ["linkedin", 0.5], ["x", 0.1 + 0.1 * Math.min(2, tech)], ["ai_memory", 0.15 + 0.1 * Math.min(2, tech)],
    ["instagram", 0.3 + 0.08 * has(VISUAL)], ["github", tech ? 0.25 + 0.15 * tech : 0.01], ["strava", has(SPORTS_STRAVA) ? 0.55 : 0.02],
    ["spotify", 0.25 + 0.2 * Math.min(2, has(MUSIC))], ["eventbrite", 0.12], ["partiful", 0.1 + 0.05 * has(EVENTISH.partiful)],
    ["luma", 0.04 + 0.1 * Math.min(3, has(EVENTISH.luma))], ["personal_website", 0.05 + (h.skills.some(s => SITE_SKILLS.includes(s)) ? 0.2 : 0)],
  ];
  return minor ? w.filter(([k]) => MINOR_ALLOWED_SOURCES.has(k)) : w;
}

function weightedSample<T>(r: Rng, items: [T, number][], k: number): T[] {
  const pool = items.filter(([, w]) => w > 0);
  const out: T[] = [];
  while (out.length < k && pool.length) {
    const pick = r.weighted(pool);
    out.push(pick);
    pool.splice(pool.findIndex(([x]) => x === pick), 1);
  }
  return out;
}

/** Simulate what the Network knows about one persona. Deterministic for (persona, ctx, rng). */
export function simulateKnowledge(p: Persona, ctx: KnowledgeContext, r: Rng): Knowledge {
  const chat = chatCoverage(p, ctx.tier, r.fork("chat"));
  const h = p.hidden;
  const minor = ctx.minor;
  const rs = r.fork("sources");
  const nActive = ctx.tier === "minimal" ? 0 : rs.weighted(SOURCE_COUNT[ctx.tier]);
  const active = weightedSample(rs, sourceWeights(p, minor), nActive);
  const span = Math.max(DAY, ctx.now - ctx.joinedAt);
  const sources: ConnectedSourceSummary[] = [];
  const observations: SourceObservation[] = [];
  const role = { ...inferredRole(p), ...(ctx.occupation ? { occupation: ctx.occupation } : {}), ...(ctx.sector ? { sector: ctx.sector } : {}) };

  for (const kind of active) {
    const sr = rs.fork(kind);
    const found = !minor && DISCOVERABLE_SOURCES.includes(kind) && sr.bool(0.35);
    const link: SourceLink = found ? "found_profile" : DEFAULT_LINK[kind];
    const connectedAt = Math.round(ctx.joinedAt + sr.range(0.05, 0.95) * span);
    const lastSyncAt = link === "oauth" ? Math.round(ctx.now - sr.range(0.1, 3) * DAY) : connectedAt;
    const obs = observe(p, kind, link, { ...ctx, connectedAt, role }, sr.fork("obs"));
    observations.push(...obs);
    sources.push({ source: kind, link, status: found ? "confirmed" : "connected", subject: "self", connectedAt, ...(lastSyncAt ? { lastSyncAt } : {}), observations: obs.length });
  }
  // Inactive entries: found-profile candidates awaiting confirmation, namesakes the member rejected
  // (nothing about them is kept), and sources the member revoked (facets deleted). Adults only.
  if (!minor && ctx.tier !== "minimal") {
    const rx = r.fork("inactive");
    const unused = (xs: readonly ActiveSourceKind[]) => xs.filter(k => !sources.some(s => s.source === k));
    const at = () => Math.round(ctx.joinedAt + rx.range(0.1, 0.95) * span);
    const add = (kinds: ActiveSourceKind[], status: ConnectedSourceSummary["status"], link?: SourceLink) => {
      if (!kinds.length) return;
      const k = rx.pick(kinds);
      sources.push({ source: k, link: link ?? DEFAULT_LINK[k], status, subject: "self", connectedAt: at(), observations: 0 });
    };
    if (rx.bool(0.12)) add(unused(DISCOVERABLE_SOURCES), "pending_confirmation", "found_profile");
    if (rx.bool(0.07)) add(unused(DISCOVERABLE_SOURCES), "rejected", "found_profile");
    if (ctx.tier !== "light" && rx.bool(0.06)) add(unused(SOURCE_KINDS), "revoked");
  }
  return { richness: ctx.tier, chat, sources, observations };
}

interface ObsCtx extends KnowledgeContext { connectedAt: number; role: { occupation: string; sector: string } }

function observe(p: Persona, kind: ActiveSourceKind, link: SourceLink, ctx: ObsCtx, r: Rng): SourceObservation[] {
  const h = p.hidden;
  const out: SourceObservation[] = [];
  const confirmP = CONFIRM_RATE[ctx.tier] + (link === "found_profile" ? 0.1 : 0);
  const fresh = () => Math.round(link === "oauth" ? ctx.now - r.range(1, 150) * DAY : Math.min(ctx.connectedAt, ctx.now) - r.range(0, 200) * DAY);
  const push = (fk: FacetKind, value: string, tags: string[], truth: ObservationTruth, o: { inferred?: boolean; sensitive?: SensitiveCategory; observedAt?: number; conf?: number; note?: string } = {}) => {
    const inferred = o.inferred ?? true;
    // Members only confirm correct, non-sensitive facets they reviewed; wrong/stale ones stay unconfirmed.
    const confirmed = truth === "correct" && !o.sensitive && r.bool(confirmP);
    const conf = o.conf ?? (truth === "stale" ? r.range(0.7, 0.85) : truth === "wrong_inference" ? r.range(0.4, 0.65) : inferred ? r.range(0.55, 0.85) : r.range(0.8, 0.92));
    const observedAt = o.observedAt ?? (truth === "stale" ? Math.round(ctx.now - r.range(400, 1100) * DAY) : fresh());
    out.push({
      facet: {
        kind: fk, value, tags, scope: sourceFacetScope(fk, { minor: ctx.minor, sensitive: o.sensitive, confirmed }),
        provenance: "connected_source", confidence: r2(confirmed ? Math.max(conf, 0.9) : conf), validFrom: observedAt,
        source: kind, observedAt, inferred, confirmedByMember: confirmed, ...(o.sensitive ? { sensitive: o.sensitive } : {}),
      },
      truth, ...(o.note ? { note: o.note } : {}),
    });
  };
  /** Correct facets for the true interests in `cover` (each with p), plus maybe one wrong inference. */
  const interests = (cover: string[], p_: number, phrase: (l: string) => string, wrongP: number, wrongNote: string, extraTags: string[] = []) => {
    for (const t of h.interests) if (cover.includes(t) && r.bool(p_)) push("interest", phrase(label(t)), [t, cluster(t), ...extraTags], "correct");
    const notMine = cover.filter(t => !h.interests.includes(t) && !(ctx.minor && ["wine", "crypto"].includes(t)));
    if (notMine.length && r.bool(wrongP)) { const t = r.pick(notMine); push("interest", phrase(label(t)), [t, cluster(t), ...extraTags], "wrong_inference", { note: wrongNote }); }
  };
  const freeDays = p.routine.freeEvenings;

  switch (kind) {
    case "gmail": {
      interests(INTERESTS.map(i => i.tag), 0.3, l => `subscribes to newsletters about ${l}`, 0.12, "newsletter they never open");
      interests(RECEIPT, 0.3, l => `receipts suggest a ${l} habit`, 0.25, "gift purchase read as their own hobby");
      interests(TICKETED, 0.5, l => `buys tickets for ${l}`, 0.12, "tickets bought for someone else");
      if (r.bool(0.7)) push("fact", `work email domain suggests a ${ctx.role.sector}`, ["occupation", "employer_type"], "correct");
      if (freeDays.length && r.bool(0.5)) push("availability_pattern", `calendar invites cluster on ${freeDays.map(d => DAYS[d]).join("/")} evenings`, freeDays.map(d => `evening:${DAYS[d]}`), "correct");
      // Sensitive inferences: agent_private, never shareable, never used in explanations.
      const disc = h.privateDisclosure?.fact ?? "";
      const sens = (cat: SensitiveCategory, p_: number, value: string, truth: ObservationTruth = "correct", note?: string) => {
        if (r.bool(p_)) push("fact", value, ["sensitive", `sensitive:${cat}`], truth, { sensitive: cat, note });
      };
      if (/illness|therapy|recovery|burnout/.test(disc)) sens("health", 0.6, "pharmacy and clinic receipts suggest an ongoing health matter");
      else sens("health", 0.06, "pharmacy receipts suggest an ongoing health matter", "wrong_inference", "buying for a relative");
      sens("finances", /rent|money/.test(disc) ? 0.7 : 0.05, "late-payment and overdraft notices suggest money stress");
      sens("religion", 0.05, "regular donation receipts from a religious congregation");
      if (h.romance.seeking.includes(p.gender)) sens("sexuality", 0.3, "newsletters from LGBTQ+ community organizations");
      if (p.relationships.some(x => x.type === "ex") || /divorce/.test(disc)) sens("relationship", 0.45, "email suggests a recent breakup or separation");
      if (p.archetype === "busy_parent" || h.interests.includes("parenting")) sens("children", 0.7, "receives a child's school newsletters (school withheld)");
      break;
    }
    case "google_calendar": {
      const known = freeDays.filter(() => r.bool(0.75));
      if (known.length) push("availability_pattern", `calendar usually free ${known.map(d => DAYS[d]).join("/")} evenings`, known.map(d => `evening:${DAYS[d]}`), "correct", { inferred: true });
      const busy = [0, 1, 2, 3, 4, 5, 6].filter(d => !freeDays.includes(d));
      if (busy.length && r.bool(0.15)) { const d = r.pick(busy); push("availability_pattern", `calendar looks free ${DAYS[d]} evenings`, [`evening:${DAYS[d]}`], "wrong_inference", { note: "commitment never put on the calendar" }); }
      const b = p.routine.busyBlocks[0];
      if (b && r.bool(0.8)) push("fact", `weekday calendar is blocked roughly ${fmtH(b[0])}-${fmtH(p.routine.busyBlocks[p.routine.busyBlocks.length - 1]![1])}`, ["routine", `wake:${p.routine.wake}`], "correct");
      break;
    }
    case "linkedin": {
      const stale = r.bool(0.22);
      if (stale) push("fact", `works as ${r.pick(OLD_ROLES)}`, ["occupation"], "stale", { inferred: false, note: "profile not updated since an old job" });
      else push("fact", /^works /i.test(ctx.role.occupation) ? ctx.role.occupation : `works as ${ctx.role.occupation}`, ["occupation"], "correct", { inferred: false });
      if (stale) push("fact", `employer type: ${r.pick(OLD_SECTORS)}`, ["employer_type"], "stale", { inferred: false, note: "previous employer" });
      else push("fact", `employer type: ${ctx.role.sector}`, ["employer_type"], "correct", { inferred: false });
      const age = h.trueAge;
      const sen = age < 26 ? "junior" : age < 33 ? "mid" : age < 42 ? "senior" : "lead";
      push("fact", `${sen}-level career stage`, [`seniority:${sen}`], "correct");
      for (const s of h.skills) if (PRO_SKILLS.includes(s) && r.bool(0.8)) push("skill", skillLabel(s), skillTags(s), "correct", { inferred: false });
      if (r.bool(0.15)) { const s = r.pick(PRO_SKILLS.filter(x => !h.skills.includes(x))); push("skill", skillLabel(s), skillTags(s), "wrong_inference", { inferred: false, note: "endorsement from a colleague, not a real skill" }); }
      break;
    }
    case "x":
      interests(X_TOPICS, 0.5, l => `posts about ${l}`, 0.15, "replies to friends' threads, not their own interest");
      break;
    case "ai_memory": {
      interests(INTERESTS.map(i => i.tag), 0.45, l => `assistant memory mentions ${l}`, 0.05, "one-off question to the assistant");
      for (const s of h.skills) if (r.bool(0.45)) push("skill", skillLabel(s), skillTags(s), "correct");
      for (const d of h.desires) {
        const def = desireById.get(d.id);
        if (!def || def.category === "romance" || !r.bool(0.4)) continue;
        push("goal", `wants to ${def.text}`, [...def.needsInterests, ...def.needsSkills, ...(def.pool ? [def.pool] : [])], "correct");
      }
      if (r.bool(0.15)) push("goal", `wants to ${r.pick(["learn to sail", "run a marathon", "learn Italian", "start a podcast"])}`, ["goal"], "stale", { note: "old goal from a months-old memory" });
      break;
    }
    case "instagram": {
      interests(VISUAL, 0.6, l => `posts photos of ${l}`, 0.2, "a friend's hobby they appear in");
      push("fact", `often posts from around ${p.routine.homeArea}`, ["place", slug(p.routine.homeArea)], "correct");
      const cl = cluster(h.interests[0] ?? "");
      if (AESTHETIC[cl] && r.bool(0.6)) push("trait", AESTHETIC[cl]!, ["aesthetic", cl], "correct");
      break;
    }
    case "github": {
      for (const s of h.skills) if (GITHUB_SKILLS.includes(s) && r.bool(0.85)) push("skill", skillLabel(s), skillTags(s), "correct", { inferred: true });
      interests(TECH, 0.7, l => `repos and stars around ${l}`, 0.1, "starred a repo once");
      break;
    }
    case "strava": {
      const sports = h.interests.filter(t => SPORTS_STRAVA.includes(t));
      for (const t of sports) if (r.bool(0.9)) push("interest", `logs ${label(t)} activities`, [t, cluster(t)], "correct", { inferred: false });
      const s0 = sports[0];
      if (s0) {
        push("fact", `${label(s0)} routes start around ${p.routine.homeArea}`, ["place", slug(p.routine.homeArea)], "correct");
        push("availability_pattern", `usually ${label(s0)} around ${fmtH(p.routine.wake)} on weekdays`, [`wake:${p.routine.wake}`], "correct");
      }
      break;
    }
    case "spotify":
      interests(MUSIC, 0.9, l => `listens to a lot of ${l}`, 0.15, "shared account with a partner or family");
      break;
    case "eventbrite": case "partiful": case "luma": {
      const n = () => r.int(2, 9);
      for (const t of h.interests) if (EVENTISH[kind].includes(t) && r.bool(0.55)) push("interest", `went to ${n()} ${label(t)} events via ${SOURCE_LABEL[kind]} this year`, [t, cluster(t), "events"], "correct", { inferred: false });
      const notMine = EVENTISH[kind].filter(t => !h.interests.includes(t));
      if (notMine.length && r.bool(0.18)) { const t = r.pick(notMine); push("interest", `went to 1 ${label(t)} event via ${SOURCE_LABEL[kind]} this year`, [t, cluster(t), "events"], "wrong_inference", { inferred: false, note: "tagged along with a friend once" }); }
      break;
    }
    case "personal_website": {
      for (const s of h.skills) if (SITE_SKILLS.includes(s) && r.bool(0.8)) push("skill", skillLabel(s), skillTags(s), "correct", { inferred: false });
      interests(SITE_INTERESTS, 0.6, l => `site features work about ${l}`, 0.05, "an old side project");
      if (r.bool(0.3)) push("fact", `site still lists a past role as ${r.pick(OLD_ROLES)}`, ["occupation"], "stale", { inferred: false, note: "site not updated" });
      break;
    }
  }
  return out;
}

function fmtH(x: number): string { const hh = Math.floor(x) % 24; const mm = Math.round((x - Math.floor(x)) * 60); return `${hh % 12 === 0 ? 12 : hh % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${hh < 12 ? "am" : "pm"}`; }
