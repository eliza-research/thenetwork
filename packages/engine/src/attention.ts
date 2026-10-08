// Attention budget, digest assembly, hold queue and consent-first probes (Phase 1 of
// docs/design/2026-10-07-experience-design.md, section 1; founder defaults D1-D18).
//
// The scarce resource is the member's attention and the thing that spends it is an INTERRUPTION:
// a message the Network starts that the member did not ask for (D1). One message (a digest) can
// carry up to 3 items. A hard cap counts interruptions per participation state; a shadow price
// decides what is worth an interruption and what shares one:
//
//   V_i  = Ê_i x P̂acc_i^0.5 x w_kind x w_m(category) x u_i(t)           (item value, D13)
//   A(M) = 1 + sum_i e_i x (1 - Ê_i)                                     (attention cost of message M)
//   λ_m  = λ_state x (1 + used/cap)^2 x r_m                               (shadow price)
//   send M iff hard gates pass, used < cap, max Ê >= θ_bar and U(M) = ΣV - λ A(M) > 0
//
// Founder decisions of 2026-10-07 (iteration 3, replacing D2, D4 and D5): rolling sends at a learned
// per-member send time (default 12:00 local; learnSendProfile); consent-first probes for every
// member-involving opportunity; only a member's initial invite to a new opportunity counts against
// their cap (isInitialInvite / countsAgainstCap); availability capture with 2-3 concrete time
// options in the probe (chooseTimeOptions over calendar free/busy, standing availability, learned
// times and presence).
//
// Everything here is a deterministic pure function of its inputs (no clock reads, no randomness,
// no LLM calls). The Network runtime owns the state (hold queues, ledger, conversation streaks)
// and calls these functions; see docs/results/2026-10-07-attention-budget.md for the integration note.
import type { Category, MemberId, ParticipationState } from "@thenetwork/core";
import { canBeMatched, DAY, HOUR, MINUTE } from "@thenetwork/core";
import { DEFAULT_ATTENTION, type AttentionConfig } from "./config.ts";
import { tokenize } from "./embed.ts";
import { privateVocabulary } from "./explain.ts";
import { checkMemberFacing } from "./judgeCommon.ts";
import type { EligibilityCheck } from "./opportunity.ts";
import { fromLocal, inQuietHours, localParts } from "./outreach.ts";
import type {
  AttentionItem, AttentionLedgerEntry, CadencePrefs, Effort, EngineProposal, HeldItem, HoldReason, ItemKind, LedgerKind, Role,
} from "./types.ts";
import { CONTRIBUTOR_ROLES } from "./types.ts";
import type { AppPack } from "./pack.ts";
import { DEFAULT_ENJOY_BY_CATEGORY, DEFAULT_ENJOY_KNOTS } from "./packs/network/calibrator.ts";
import { GENERIC_ACTIVITY as NETWORK_GENERIC_ACTIVITY } from "./packs/network/copy.ts";
import { networkPack } from "./packs/network/index.ts";
import type { World } from "./world.ts";

// ------------------------------------------------------------------------------------------------
// Member view

/** What the composer needs to know about a member (from the Member record plus cadence prefs). */
export interface MemberAttention {
  memberId: MemberId; state: ParticipationState; age: number; tz: string; quietHours: [number, number];
  /** "Only when I ask" (explicit, or after two unanswered interruptions). */
  onlyWhenAsked: boolean;
  /** First 14 days (1.7). */
  newcomer?: boolean;
  prefs: CadencePrefs;
  /** Categories the member opted in to (items in other categories are never sent). */
  categoriesOptIn?: Category[];
}

/** Per-conversation counter shared with the Blooio queue (1.9): any inbound message or tapback resets it. */
export interface Conversation {
  outboundSinceInbound: number;
  lastInboundAt?: number;
  /** When the single re-engagement message (D6) was sent, if ever. */
  reengagedAt?: number;
}

export const isMinor = (age: unknown) => !canBeMatched(age);

/** Default cadence for a participation state (founder decision 1: a rolling daily slot at 12:00 local). */
export function defaultCadence(state: ParticipationState, cfg: AttentionConfig = DEFAULT_ATTENTION): CadencePrefs {
  const items = Math.max(1, Math.min(3, cfg.maxItems[state] || 1)) as 1 | 2 | 3;
  return {
    mode: "digest", digestDays: [...cfg.digest.days[state]], digestHour: cfg.digest.hour, digestPeriod: cfg.digest.period[state],
    categoryWeight: {}, maxItemsPerDigest: items, romanceInDigest: cfg.romanceInDigest,
  };
}

/**
 * D11: learned cadence never increases frequency. Every frequency-related field of the result is
 * the quieter of the explicit preference and the learned one: fewer digest days, fewer items,
 * a lower cap, mode only ever moved towards quieter. Only an explicit request (the `explicit`
 * argument) can raise frequency, and capFor() still clamps that to the state cap.
 */
export function applyLearnedCadence(explicit: CadencePrefs, learned: Partial<CadencePrefs>): CadencePrefs {
  const out: CadencePrefs = { ...explicit, categoryWeight: { ...explicit.categoryWeight } };
  if (learned.digestDays) {
    const kept = explicit.digestDays.filter(d => learned.digestDays!.includes(d));
    out.digestDays = kept.length ? kept : explicit.digestDays.slice(0, 1);
  }
  if (learned.maxItemsPerDigest !== undefined) out.maxItemsPerDigest = Math.min(explicit.maxItemsPerDigest, learned.maxItemsPerDigest) as 1 | 2 | 3;
  if (learned.capOverride !== undefined) out.capOverride = Math.min(explicit.capOverride ?? Infinity, learned.capOverride);
  if (learned.digestPeriod === "month") out.digestPeriod = "month";
  const quietness: Record<CadencePrefs["mode"], number> = { as_it_comes: 0, digest: 1, only_when_great: 2, only_when_asked: 3 };
  if (learned.mode && quietness[learned.mode] > quietness[explicit.mode]) out.mode = learned.mode;
  for (const [c, w] of Object.entries(learned.categoryWeight ?? {})) {
    const cur = explicit.categoryWeight[c as Category] ?? 1;
    out.categoryWeight[c as Category] = Math.min(cur, w ?? cur);
  }
  // The digest hour is not a frequency: learning may move it (reply-rate by hour).
  if (learned.digestHour !== undefined) out.digestHour = learned.digestHour;
  return out;
}

// ------------------------------------------------------------------------------------------------
// Caps (D1, D4, D9)

export interface Cap { limit: number; periodDays: number }

/** Interruption cap for the member: state cap (D1), minors 1/7d (D9), 0 when paused or only-when-asked. */
export function capFor(m: MemberAttention, cfg: AttentionConfig = DEFAULT_ATTENTION): Cap {
  // Minors take the stricter of the minors cap and their state's cap (a Quiet minor keeps Quiet's
  // 1 per 30 days, engine-attention-plans-5).
  const st = cfg.caps[m.state];
  const base = isMinor(m.age) && cfg.minors.cap.limit / cfg.minors.cap.periodDays < st.limit / st.periodDays ? cfg.minors.cap : cfg.caps[m.state];
  if (m.state === "paused" || m.onlyWhenAsked || m.prefs.mode === "only_when_asked") return { limit: 0, periodDays: base.periodDays };
  // An explicit request can lower the cap, or restore it, but never exceed the state cap (D11).
  const limit = m.prefs.capOverride === undefined ? base.limit : Math.min(base.limit, Math.max(0, Math.floor(m.prefs.capOverride)));
  return { limit, periodDays: base.periodDays };
}

/** Break-ins allowed per period (D4): Normal 1/7d, Open 2/7d, Quiet 0, minors 0, newcomers 1. Always within the cap. */
export function breakInLimit(m: MemberAttention, cfg: AttentionConfig = DEFAULT_ATTENTION): Cap {
  const cap = capFor(m, cfg);
  const st = cfg.breakIns[m.state];
  let limit = isMinor(m.age) ? cfg.minors.breakIns : st.limit;
  if (m.newcomer && !isMinor(m.age) && st.limit > 0) limit = cfg.newcomer.breakIns;
  return { limit: Math.min(limit, cap.limit), periodDays: st.periodDays };
}

const uniqueIds = (xs: AttentionLedgerEntry[]) => new Set(xs.map(x => x.messageId)).size;

/** Interruptions (unique messages that count against the cap) in the rolling window (now - period, now]. */
export function interruptionsUsed(ledger: readonly AttentionLedgerEntry[], memberId: MemberId, now: number, periodDays: number): number {
  return uniqueIds(ledger.filter(e => e.memberId === memberId && e.countsAgainstCap && e.at <= now && e.at > now - periodDays * DAY));
}
export function breakInsUsed(ledger: readonly AttentionLedgerEntry[], memberId: MemberId, now: number, periodDays: number): number {
  return uniqueIds(ledger.filter(e => e.memberId === memberId && e.kind === "break_in" && e.at <= now && e.at > now - periodDays * DAY));
}

/**
 * Consecutive most-recent interruptions with no reply by their deadline (72h). Pending ones are
 * skipped. `since` (the member's last inbound message, Conversation.lastInboundAt): interruptions
 * sent at or before it do not count, so any later message from the member (a late reply, "resume")
 * lifts the two-unanswered pause (engine-attention-plans-1).
 */
export function unansweredInterruptions(ledger: readonly AttentionLedgerEntry[], memberId: MemberId, now: number, cfg: AttentionConfig = DEFAULT_ATTENTION, since?: number): number {
  const mine = ledger.filter(e => e.memberId === memberId && e.countsAgainstCap && e.at <= now && (since === undefined || since > now || e.at > since))
    .sort((a, b) => (b.at - a.at) || (a.messageId < b.messageId ? -1 : 1));
  const seen = new Set<string>();
  let n = 0;
  for (const e of mine) {
    if (seen.has(e.messageId)) continue;
    seen.add(e.messageId);
    const dl = e.at + cfg.annoyance.unansweredHours * HOUR;
    if (e.repliedAt !== undefined && e.repliedAt <= dl && e.repliedAt <= now) break;
    if (now < dl) continue;
    n++;
  }
  return n;
}

// ------------------------------------------------------------------------------------------------
// Value and cost (1.3)

/** Ê from an engine score. Default: the sim-fitted isotonic table below (refit on production "worth a text?" labels). */
export type Calibrator = (score: number, category: Category) => number;

/**
 * Isotonic (pool-adjacent-violators) fit of persona "worth a text?" judgments on the engine score,
 * engine-v1.2.0 defaults, simulator seeds 101-104 (disjoint from the evaluation seeds 1-8), 1,650
 * labels, base rate 58.7%: `bun packages/engine/experiments/attention.ts --fit`. Knots are
 * (score, P(worthwhile)); linear in between, flat outside. Per-category knots where n >= 100. A
 * prior to be replaced by the weekly per-category refit on production labels (5.3).
 */
// The knots are networkPack data (fitted on Network sim labels), moved verbatim to packs/network/calibrator.ts.
export { DEFAULT_ENJOY_BY_CATEGORY, DEFAULT_ENJOY_KNOTS } from "./packs/network/calibrator.ts";
export function knotCalibrator(knots: [number, number][] = DEFAULT_ENJOY_KNOTS, byCategory: Partial<Record<Category, [number, number][]>> = DEFAULT_ENJOY_BY_CATEGORY): Calibrator {
  return (score, category) => interpolate(byCategory[category] ?? knots, score);
}
export function interpolate(knots: [number, number][], x: number): number {
  if (!knots.length) return x;
  if (x <= knots[0]![0]) return knots[0]![1];
  for (let i = 1; i < knots.length; i++) {
    const [x1, y1] = knots[i]!, [x0, y0] = knots[i - 1]!;
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return knots[knots.length - 1]![1];
}

/** w_kind; profiling questions and re-confirmations are worth their expected value of information, capped. */
export function kindWeight(item: Pick<AttentionItem, "kind" | "evi">, cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  const w = cfg.kindWeight[item.kind];
  return item.kind === "profiling_question" || item.kind === "reconfirm" ? Math.min(w, item.evi ?? w) : w;
}

/** V_i = Ê x P̂acc^0.5 x w_kind x w_m(category) x u(t). `nextSlot`: items expiring before it get the urgency boost. */
export function itemValue(item: AttentionItem, prefs: Pick<CadencePrefs, "categoryWeight">, cfg: AttentionConfig = DEFAULT_ATTENTION, nextSlot?: number): number {
  const acc = Math.pow(Math.max(0, Math.min(1, item.accept)), cfg.acceptanceExponent);
  const wm = prefs.categoryWeight[item.category] ?? 1;
  const u = nextSlot !== undefined && item.urgency.expiresAt < nextSlot ? cfg.urgencyBoost : 1;
  return Math.max(0, item.enjoy) * acc * kindWeight(item, cfg) * wm * u;
}

/** A(M) = 1 + Σ e_i (1 - Ê_i): the buzz in the pocket plus effort weighted by the chance it is wasted. */
export function attentionCost(items: readonly Pick<AttentionItem, "effort" | "enjoy">[], cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  return 1 + items.reduce((s, i) => s + cfg.effortCost[i.effort] * (1 - Math.max(0, Math.min(1, i.enjoy))), 0);
}

/** λ_m = λ_state x (1 + used/cap)^2 x r_m. Infinity when the cap is 0 or the state is paused. */
export function shadowPrice(m: Pick<MemberAttention, "state" | "age" | "newcomer">, used: number, cap: number, r: number, cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  if (cap <= 0 || m.state === "paused") return Infinity;
  let base = cfg.lambda[m.state];
  if (isMinor(m.age)) base = Math.max(cfg.lambda.normal, base); // 1.7: members 13-17 price like Normal (0.25), or stricter
  else if (m.newcomer && (m.state === "open" || m.state === "normal" || m.state === "receiving")) base = Math.min(base, cfg.newcomer.lambda);
  return base * Math.pow(1 + used / cap, 2) * r;
}

/** U(M) = Σ V_i − λ A(M). */
export function messageUtility(values: number[], cost: number, price: number): number {
  if (!Number.isFinite(price)) return -Infinity;
  return values.reduce((s, v) => s + v, 0) - price * cost;
}

/**
 * Learned annoyance multiplier r_m in [min, max] (1.3): x1.5 after a "less"/"too much"/STOP-like
 * reply, x1.25 per interruption left unanswered past 72h, x0.8 after an explicit "more"; decays
 * toward 1 with a 30-day half-life. D11: a learned positive signal (a pick within 2 hours) can only
 * bring r back DOWN TO 1 (undo earlier annoyance), never below it, so learning can never make the
 * Network more frequent than its baseline. Only an explicit "more" can take r below 1.
 */
export function annoyance(ledger: readonly AttentionLedgerEntry[], memberId: MemberId, now: number, cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  const A = cfg.annoyance;
  const ev: { t: number; f: number; learnedPositive?: boolean }[] = [];
  const seen = new Set<string>();
  for (const e of ledger) {
    if (e.memberId !== memberId || !e.countsAgainstCap || e.at > now || seen.has(e.messageId)) continue;
    seen.add(e.messageId);
    const dl = e.at + A.unansweredHours * HOUR;
    const replied = e.repliedAt !== undefined && e.repliedAt <= now && e.repliedAt <= dl;
    if (replied && (e.replyKind === "less" || e.replyKind === "stop")) ev.push({ t: e.repliedAt!, f: A.less });
    else if (replied && e.replyKind === "more") ev.push({ t: e.repliedAt!, f: A.positive });
    else if (replied && e.replyKind === "pick" && e.repliedAt! - e.at <= A.fastPickHours * HOUR) ev.push({ t: e.repliedAt!, f: A.positive, learnedPositive: true });
    if (!replied && dl <= now) ev.push({ t: dl, f: A.unanswered });
  }
  ev.sort((a, b) => a.t - b.t);
  let r = 1, last = ev[0]?.t ?? now;
  const decay = (to: number) => { r = 1 + (r - 1) * Math.pow(2, -(to - last) / (A.halfLifeDays * DAY)); last = to; };
  for (const x of ev) {
    decay(x.t);
    if (x.learnedPositive) r = r > 1 ? Math.max(1, r * x.f) : r;
    else r *= x.f;
    r = Math.max(A.min, Math.min(A.max, r));
  }
  decay(Math.max(now, last));
  return Math.max(A.min, Math.min(A.max, r));
}

// ------------------------------------------------------------------------------------------------
// Time: quiet hours (incl. D9 school nights), digest slots (D2)

const jsDay = (ts: number, tz: string) => (localParts(ts, tz).weekday + 1) % 7;

/**
 * Overnight hours (local) in which a member aged 13-17 is never messaged, on any day, whatever
 * their own quiet hours say (engine-attention-plans-6). School nights extend it to cfg.minors.quietHours.
 */
export const MINOR_OVERNIGHT: [number, number] = [22, 7];

/** Member quiet hours, plus 20:00-08:00 local on school nights for members aged 13-17 (D9) and MINOR_OVERNIGHT every night. */
export function inMemberQuietHours(m: Pick<MemberAttention, "tz" | "quietHours" | "age">, t: number, cfg: AttentionConfig = DEFAULT_ATTENTION): boolean {
  if (inQuietHours(t, m.tz, m.quietHours)) return true;
  if (!isMinor(m.age)) return false;
  if (inQuietHours(t, m.tz, MINOR_OVERNIGHT)) return true;
  const [s, e] = cfg.minors.quietHours;
  const h = localParts(t, m.tz).hour;
  const d = jsDay(t, m.tz);
  if (h >= s) return cfg.minors.schoolNights.includes(d);
  if (h < e) return cfg.minors.schoolNights.includes((d + 6) % 7);
  return false;
}
export function memberQuietEnd(m: Pick<MemberAttention, "tz" | "quietHours" | "age">, t: number, cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  let x = t;
  for (let i = 0; i < 4 * 72 && inMemberQuietHours(m, x, cfg); i++) x = Math.floor(x / (15 * MINUTE)) * 15 * MINUTE + 15 * MINUTE;
  return x;
}

/** Stable per-member offset inside the digest burst window (1.9 burst smoothing). */
export function digestJitter(memberId: MemberId, cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  let h = 2166136261;
  for (let i = 0; i < memberId.length; i++) { h ^= memberId.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return cfg.digest.spreadMinutes > 0 ? (h % cfg.digest.spreadMinutes) * MINUTE : 0;
}

/** Digest slots of the member's local calendar day `offset` days from `ts` (0 or 1 slot). */
function slotOnDay(m: Pick<MemberAttention, "memberId" | "tz" | "prefs">, ts: number, offset: number, cfg: AttentionConfig): number | undefined {
  const p = localParts(ts, m.tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + offset));
  if (!m.prefs.digestDays.includes(d.getUTCDay())) return undefined;
  if (m.prefs.digestPeriod === "month" && d.getUTCDate() > 7) return undefined; // first such weekday of the month
  const hour = m.prefs.sendHours ? (cfg.sendTime.weekendDays.includes(d.getUTCDay()) ? m.prefs.sendHours.weekend : m.prefs.sendHours.weekday) : m.prefs.digestHour;
  return fromLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, m.tz) + digestJitter(m.memberId, cfg);
}
/** The next digest slot strictly after `ts`. */
export function nextDigestSlot(m: Pick<MemberAttention, "memberId" | "tz" | "prefs">, ts: number, cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  if (!m.prefs.digestDays.length) return Infinity;
  for (let k = 0; k <= 62; k++) { const s = slotOnDay(m, ts, k, cfg); if (s !== undefined && s > ts) return s; }
  return Infinity;
}
/** The latest digest slot at or before `ts`. */
export function lastDigestSlot(m: Pick<MemberAttention, "memberId" | "tz" | "prefs">, ts: number, cfg: AttentionConfig = DEFAULT_ATTENTION): number | undefined {
  for (let k = 0; k >= -62; k--) { const s = slotOnDay(m, ts, k, cfg); if (s !== undefined && s <= ts) return s; }
  return undefined;
}
/**
 * The slot a digest is due for now, or undefined: the latest slot within the last `windowHours`
 * (so a slot that falls in quiet hours can still go out when they end) not yet served.
 * as_it_comes members have no slot wait: any time is a slot.
 */
export function digestDue(m: MemberAttention, now: number, lastServedSlot: number | undefined, cfg: AttentionConfig = DEFAULT_ATTENTION, windowHours = 24): number | undefined {
  if (m.prefs.mode === "as_it_comes") return now;
  const s = lastDigestSlot(m, now, cfg);
  if (s === undefined || now - s >= windowHours * HOUR) return undefined;
  return lastServedSlot !== undefined && lastServedSlot >= s ? undefined : s;
}

/**
 * Founder decision 3: inside the member's send window right now (from today's slot until
 * cfg.sendTime.windowHours after it). A partner probe (the first member already said yes) may go out
 * at any moment inside this window, even if the slot already served a message: it needs no
 * break-in, only the partner's cap, quiet hours and send time.
 */
export function inSendWindow(m: MemberAttention, now: number, cfg: AttentionConfig = DEFAULT_ATTENTION): boolean {
  if (m.prefs.mode === "as_it_comes") return true;
  const s = lastDigestSlot(m, now, cfg);
  return s !== undefined && now - s < cfg.sendTime.windowHours * HOUR;
}

// ------------------------------------------------------------------------------------------------
// Send time learned from replies (founder decision 1)

const hourInQuiet = (h: number, [s, e]: [number, number]) => (s === e ? false : s < e ? h >= s && h < e : h >= s || h < e);

export interface SendProfile {
  /** Local send hour on weekdays and on weekends. */
  weekday: number; weekend: number;
  /** Replies seen per profile, and whether the hour moved off the default. */
  samples: { weekday: number; weekend: number };
  learned: { weekday: boolean; weekend: boolean };
}

/**
 * When to send to this member: the default hour (12:00 local) until their own replies say
 * otherwise. `replies` are the timestamps of the member's inbound messages (answers to the
 * Network). Weekday and weekend profiles are learned separately; each needs cfg.sendTime.minSamples
 * replies; replies are recency-weighted (half-life halfLifeDays) and bucketed into the configured
 * slots; the hour moves to the best slot only when it holds >= minShare of the weight AND beats the
 * default slot by `margin`. A slot whose send hour falls in the member's quiet hours is never chosen.
 */
export function learnSendProfile(replies: readonly number[], tz: string, now: number, quietHours: [number, number] | undefined, cfg: AttentionConfig = DEFAULT_ATTENTION): SendProfile {
  const T = cfg.sendTime;
  const slotOf = (h: number) => T.slots.findIndex(sl => h >= sl.start && h < sl.end);
  const def = slotOf(T.defaultHour);
  const okHour = (h: number) => !quietHours || Array.from({ length: Math.max(1, T.minOpenHours) }, (_, i) => (h + i) % 24).every(x => !hourInQuiet(x, quietHours));
  const learn = (weekend: boolean) => {
    const w = T.slots.map(() => 0);
    let n = 0;
    for (const t of replies) {
      if (t > now) continue;
      const p = localParts(t, tz);
      if (T.weekendDays.includes((p.weekday + 1) % 7) !== weekend) continue;
      const k = slotOf(p.hour);
      if (k < 0) continue;
      n++;
      w[k] += Math.pow(2, -(now - t) / (T.halfLifeDays * DAY));
    }
    const fallback = okHour(T.defaultHour) ? T.defaultHour : T.slots.find(sl => okHour(sl.send))?.send ?? T.defaultHour;
    if (n < T.minSamples) return { hour: fallback, n, learned: false };
    const total = w.reduce((a, b) => a + b, 0);
    const order = w.map((x, i) => ({ x, i })).filter(o => okHour(T.slots[o.i]!.send)).sort((a, b) => (b.x - a.x) || (a.i - b.i));
    const best = order[0];
    if (!best || total <= 0 || best.i === def) return { hour: fallback, n, learned: false };
    const share = best.x / total, defShare = def >= 0 ? w[def]! / total : 0;
    if (share >= T.minShare && share - defShare >= T.margin) return { hour: T.slots[best.i]!.send, n, learned: true };
    return { hour: fallback, n, learned: false };
  };
  const wd = learn(false), we = learn(true);
  return { weekday: wd.hour, weekend: we.hour, samples: { weekday: wd.n, weekend: we.n }, learned: { weekday: wd.learned, weekend: we.learned } };
}

// ------------------------------------------------------------------------------------------------
// Composition: digest packing and break-ins (1.3, 1.4, D1, D4, D9, D10)

export interface ComposeInput {
  member: MemberAttention;
  /** Candidate items (held + new). Revalidate before composing (revalidateHold). */
  items: readonly AttentionItem[];
  ledger: readonly AttentionLedgerEntry[];
  conversation: Conversation;
  now: number;
  mode: "digest" | "break_in";
  /** Median V of the member's past digest items (break-in bar); cfg.breakIn.defaultMedianValue if none. */
  medianDigestValue?: number;
  cfg?: AttentionConfig;
  /** The app pack (default networkPack): lane gates and the ships-alone lane. */
  pack?: AppPack;
}
export interface ComposeResult {
  send: boolean; reason: string; kind?: LedgerKind;
  /** Founder decision 3: whether this message carries an initial invite (push the ledger entry with this). */
  countsAgainstCap?: boolean;
  items: AttentionItem[]; values: number[];
  value: number; cost: number; price: number; utility: number;
  cap: Cap; used: number;
  /** Items left out and why (they stay in the hold queue unless the reason is terminal). */
  skipped: { itemId: string; reason: string }[];
}

/**
 * Founder decision 3: the first message proposing a new opportunity to a member is their initial
 * invite and counts once against THEIR cap. That includes the partner's first probe after the first
 * member's yes (stage "partner"). Profiling asks, re-confirmations, "worth a text?" and "nothing yet"
 * are not invites. Everything after the invite (reveal, scheduling, reminders, check-ins, feedback,
 * acknowledgements) is not an item at all and never counts.
 */
export const isInitialInvite = (it: Pick<AttentionItem, "kind">, cfg: AttentionConfig = DEFAULT_ATTENTION) => !cfg.notInvites.includes(it.kind);
/** A message counts against the cap (once) iff it carries at least one initial invite. A "what's your week like?" check-in without a proposal does not. */
export const countsAgainstCap = (items: readonly Pick<AttentionItem, "kind">[], cfg: AttentionConfig = DEFAULT_ATTENTION) => items.some(it => isInitialInvite(it, cfg));

const MINOR_SAFE = (it: AttentionItem, cfg: AttentionConfig) => cfg.minors.allowedKinds.includes(it.kind) && it.others.length === 0 && !it.involvesMember;

/** Why an item may not go to this member at all right now (null = eligible). */
export function itemGate(m: MemberAttention, it: AttentionItem, now: number, cfg: AttentionConfig = DEFAULT_ATTENTION, pack: AppPack = networkPack): string | null {
  if (it.memberId !== m.memberId) return "wrong_member";
  if (it.urgency.expiresAt <= now) return "expired";
  if (it.reviewState === "rejected") return "review_rejected";
  if (it.involvesMember && it.reviewState !== "approved") return "awaiting_review";
  if (isMinor(m.age)) {
    // D9: events, places and solo plans only; never anything that involves another member.
    if (!MINOR_SAFE(it, cfg)) return "minor_restricted";
  }
  // Pack lane gate (networkPack: romance only for opted-in adults, "romance_not_allowed").
  const laneGate = pack.attention.itemGate?.(m, it);
  if (laneGate) return laneGate;
  if (m.categoriesOptIn && !m.categoriesOptIn.includes(it.category) && it.involvesMember) return "category_opt_out";
  if ((m.prefs.categoryWeight[it.category] ?? 1) <= 0) return "category_off";
  if (m.state === "receiving" && it.effort === "contribute") return "receiving_no_contribute";
  if (m.state === "quiet" && it.enjoy < cfg.quietMinEnjoy) return "below_quiet_bar";
  if (m.prefs.mode === "only_when_great" && it.enjoy < cfg.onlyWhenGreatMinEnjoy) return "below_great_bar";
  return null;
}

/** Max items in one message for this member. */
export function maxItemsFor(m: MemberAttention, cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  const st = cfg.maxItems[m.state];
  return Math.max(0, Math.min(st, m.prefs.maxItemsPerDigest, isMinor(m.age) ? cfg.minors.maxItems : 3));
}

/**
 * Pick what goes in one message. Hard gates first (paused, only-when-asked / two unanswered,
 * the Blooio conversation streak, quiet hours, cap, break-in limit), then packing:
 * - best V first, at most maxItems (3; Quiet/Receiving 2; minors 2), at most 2 member-involving
 *   items, never two items about the same other member;
 * - an item joins only if it adds value (V_i > λ e_i (1 - Ê_i)): a confident low-effort item is
 *   nearly free to add, an uncertain high-effort one is not;
 * - romance goes in its own message (D10) unless the member allows it in a digest: the composer
 *   compares the best romance-only message with the best romance-free digest and sends the better;
 * - break-in (D4): one item that expires before the next slot with V >= 1.5 x the median digest V.
 * Then: max Ê >= θ_bar and U(M) > 0, else nothing is sent (no filler).
 */
export function composeMessage(inp: ComposeInput): ComposeResult {
  const cfg = inp.cfg ?? DEFAULT_ATTENTION;
  const P = inp.pack ?? networkPack;
  const { member: m, now, ledger } = inp;
  const cap = capFor(m, cfg);
  const used = interruptionsUsed(ledger, m.memberId, now, cap.periodDays);
  const res: ComposeResult = { send: false, reason: "", items: [], values: [], value: 0, cost: 0, price: Infinity, utility: -Infinity, cap, used, skipped: [] };
  const no = (reason: string) => ({ ...res, reason });
  if (m.state === "paused") return no("paused");
  // The two-unanswered pause comes first (F28): the Network's own auto-pause always fires before Blooio's limit.
  if (m.onlyWhenAsked || m.prefs.mode === "only_when_asked" || unansweredInterruptions(ledger, m.memberId, now, cfg, inp.conversation.lastInboundAt) >= 2) return no("only_when_asked");
  // Reserve Blooio's third unanswered slot for logistics and safety (1.9).
  if (inp.conversation.outboundSinceInbound > cfg.blooio.interruptMaxOutstanding) return no("conversation_streak");
  if (inMemberQuietHours(m, now, cfg)) return no("quiet_hours");
  // Founder decision 3: the cap binds initial invites only. At cap, a message may still carry
  // items that are not invites (a profiling ask under the one-question rule).
  const atCap = used >= cap.limit;
  if (atCap && !inp.items.some(it => !isInitialInvite(it, cfg))) return no("cap");
  if (inp.mode === "break_in") {
    const bl = breakInLimit(m, cfg);
    if (breakInsUsed(ledger, m.memberId, now, bl.periodDays) >= bl.limit) return no("break_in_limit");
  }
  const r = annoyance(ledger, m.memberId, now, cfg);
  // At cap only non-invite asks remain; they do not use the cap, so they are priced as the first slot.
  const price = shadowPrice(m, atCap ? 0 : used, cap.limit, r, cfg);
  const next = nextDigestSlot(m, now, cfg);
  const eligible: { it: AttentionItem; v: number }[] = [];
  for (const it of inp.items) {
    const why = atCap && isInitialInvite(it, cfg) ? "cap" : itemGate(m, it, now, cfg, P);
    if (why) { res.skipped.push({ itemId: it.id, reason: why }); continue; }
    eligible.push({ it, v: itemValue(it, m.prefs, cfg, next) });
  }
  eligible.sort((a, b) => (b.v - a.v) || (a.it.urgency.expiresAt - b.it.urgency.expiresAt) || (a.it.id < b.it.id ? -1 : 1));
  const maxItems = maxItemsFor(m, cfg);
  const marginal = (x: { it: AttentionItem; v: number }) => x.v - price * cfg.effortCost[x.it.effort] * (1 - x.it.enjoy);

  const pack = (pool: { it: AttentionItem; v: number }[], limit: number) => {
    const out: { it: AttentionItem; v: number }[] = [];
    const people = new Set<MemberId>();
    let memberItems = 0;
    for (const x of pool) {
      if (out.length >= limit) break;
      if (x.it.involvesMember && memberItems >= cfg.maxMemberItems) continue;
      if (x.it.others.some(o => people.has(o))) continue;
      if (out.length > 0 && marginal(x) <= 0) continue;
      out.push(x);
      if (x.it.involvesMember) memberItems++;
      for (const o of x.it.others) people.add(o);
    }
    return out;
  };
  const evaluate = (xs: { it: AttentionItem; v: number }[]) => {
    const cost = attentionCost(xs.map(x => x.it), cfg);
    return { xs, cost, value: xs.reduce((s, x) => s + x.v, 0), utility: messageUtility(xs.map(x => x.v), cost, price) };
  };

  const options: ReturnType<typeof evaluate>[] = [];
  if (inp.mode === "break_in") {
    const bar = cfg.breakIn.valueRatio * (inp.medianDigestValue ?? cfg.breakIn.defaultMedianValue);
    const urgent = eligible.filter(x => x.it.urgency.expiresAt < next && x.v >= bar);
    if (urgent.length) options.push(evaluate([urgent[0]!]));
  } else {
    // The pack's ships-alone lane (networkPack: romance, D10) unless the member allows it in a digest.
    const lane = P.attention.shipsAloneLane;
    const romanceAlone = lane !== undefined && !(m.prefs.romanceInDigest);
    const rom = eligible.filter(x => x.it.category === lane);
    const rest = romanceAlone ? eligible.filter(x => x.it.category !== lane) : eligible;
    if (rest.length) options.push(evaluate(pack(rest, maxItems)));
    if (romanceAlone && rom.length) options.push(evaluate([rom[0]!]));
  }
  if (!options.length || options.every(o => !o.xs.length)) return { ...no(atCap && !eligible.length ? "cap" : eligible.length ? "no_urgent_item" : "nothing_eligible"), price };
  options.sort((a, b) => (b.utility - a.utility) || (b.xs.length - a.xs.length));
  const best = options[0]!;
  const out = {
    ...res, price, items: best.xs.map(x => x.it), values: best.xs.map(x => x.v), value: best.value, cost: best.cost, utility: best.utility,
  };
  for (const x of eligible) if (!best.xs.includes(x)) out.skipped.push({ itemId: x.it.id, reason: "not_packed" });
  const bar = cfg.qualityBar[m.state];
  if (Math.max(...best.xs.map(x => x.it.enjoy)) < bar) return { ...out, items: [], values: [], reason: "below_quality_bar" };
  if (!(best.utility > 0)) return { ...out, items: [], values: [], reason: "below_send_value" };
  return { ...out, send: true, reason: "ok", kind: inp.mode === "break_in" ? "break_in" : "digest", countsAgainstCap: countsAgainstCap(best.xs.map(x => x.it), cfg) };
}

// ------------------------------------------------------------------------------------------------
// Re-engagement (D6) and the Blooio streak (1.9)

/** Logistics inside an accepted item may go out while outboundSinceInbound <= 2 (1.9). */
export const canSendLogistics = (c: Conversation, cfg: AttentionConfig = DEFAULT_ATTENTION) => c.outboundSinceInbound <= cfg.blooio.logisticsMaxOutstanding;
/** A new interruption needs outboundSinceInbound <= 1, which keeps Blooio's third slot free. */
export const canInterrupt = (c: Conversation, cfg: AttentionConfig = DEFAULT_ATTENTION) => c.outboundSinceInbound <= cfg.blooio.interruptMaxOutstanding;

export function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

export const REENGAGE_SUFFIX = "Want me to keep sending these?";

/**
 * D6: one Blooio re-engagement after auto-pause. Only when the member is in only-when-asked
 * because of unanswered interruptions (not STOP, not their explicit choice), silent >= 30 days,
 * never re-engaged since their last inbound message, outside quiet hours, and only for a held item
 * whose V is above the member's 75th percentile (`valueHistory`: V of items held or sent to them).
 * If it goes unanswered, the member stays silent until they write in.
 */
export function reengagement(inp: {
  member: MemberAttention; autoPaused: boolean; optedOut: boolean; conversation: Conversation; joinedAt: number;
  items: readonly AttentionItem[]; valueHistory: number[]; now: number; cfg?: AttentionConfig;
  /** The app pack (default networkPack): its lane gates apply to the re-engagement item too. */
  pack?: AppPack;
}): { send: boolean; reason: string; item?: AttentionItem; value?: number } {
  const cfg = inp.cfg ?? DEFAULT_ATTENTION;
  const P = inp.pack ?? networkPack;
  const { member: m, conversation: c, now } = inp;
  if (inp.optedOut) return { send: false, reason: "opted_out" };
  if (!inp.autoPaused || m.prefs.mode === "only_when_asked") return { send: false, reason: "not_auto_paused" };
  if (m.state === "paused") return { send: false, reason: "paused" };
  if (c.reengagedAt !== undefined && (c.lastInboundAt === undefined || c.reengagedAt > c.lastInboundAt)) return { send: false, reason: "already_reengaged" };
  const silentSince = Math.max(c.lastInboundAt ?? inp.joinedAt, inp.joinedAt);
  if (now - silentSince < cfg.blooio.reengageAfterDays * DAY) return { send: false, reason: "too_soon" };
  if (inMemberQuietHours(m, now, cfg)) return { send: false, reason: "quiet_hours" };
  // The Blooio streak (1.9): never past the outstanding limit that logistics may use (engine-attention-plans-8).
  if (!canSendLogistics(c, cfg)) return { send: false, reason: "conversation_streak" };
  const vals = inp.items.filter(it => !itemGate(m, it, now, cfg, P)).map(it => ({ it, v: itemValue(it, m.prefs, cfg) }))
    .sort((a, b) => (b.v - a.v) || (a.it.id < b.it.id ? -1 : 1));
  const best = vals[0];
  if (!best) return { send: false, reason: "nothing_eligible" };
  const bar = quantile(inp.valueHistory.length ? inp.valueHistory : vals.map(x => x.v), cfg.blooio.reengagePercentile);
  if (!(best.v > bar)) return { send: false, reason: "not_high_value" };
  return { send: true, reason: "ok", item: best.it, value: best.v };
}

// ------------------------------------------------------------------------------------------------
// Hold queue (1.6)

/** Hold-queue expiry for an item from an engine proposal (1.6). */
export function holdExpiry(p: Pick<EngineProposal, "window" | "anchor" | "participants">, kind: ItemKind, now: number, cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  const days = kind === "profiling_question" || kind === "reconfirm" ? cfg.expiry.profilingDays
    : kind === "place_suggestion" ? cfg.expiry.placeDays
    : kind === "group_probe" ? cfg.expiry.groupProbeDays : cfg.expiry.introProbeDays;
  let exp = now + days * DAY;
  // Fixed-time items (event anchors, plans): the earlier of start - 24h and the probe deadline.
  if (p.anchor?.type === "event" && p.window) exp = Math.min(exp, p.window.start - cfg.expiry.eventLeadHours * HOUR);
  return exp;
}

/** Static value used for queue ordering and eviction (no urgency term). */
const holdValue = (it: AttentionItem, prefs: Pick<CadencePrefs, "categoryWeight">, cfg: AttentionConfig) => itemValue(it, prefs, cfg);

export interface HoldResult { queue: HeldItem[]; added: boolean; evicted: HeldItem[]; reason?: "duplicate" | "hold_full" | "expired" | "dismissed" }

/**
 * Add an item to a member's hold queue (capacity 10, evict lowest V). The same key (the same
 * opportunity re-proposed by a later run) replaces the held item only if its V is higher by the
 * hysteresis margin (6.2). `dismissed`: keys the member saw and passed on, until a time.
 */
export function addToHold(queue: readonly HeldItem[], item: AttentionItem, prefs: Pick<CadencePrefs, "categoryWeight">, now: number,
  o: { reason?: HoldReason; dismissed?: ReadonlyMap<string, number>; cfg?: AttentionConfig } = {}): HoldResult {
  const cfg = o.cfg ?? DEFAULT_ATTENTION;
  const q = [...queue];
  if (item.urgency.expiresAt <= now) return { queue: q, added: false, evicted: [], reason: "expired" };
  if ((o.dismissed?.get(item.key) ?? -Infinity) > now) return { queue: q, added: false, evicted: [], reason: "dismissed" };
  const held: HeldItem = { ...item, heldReason: o.reason ?? "digest_wait", heldAt: now, revalidateAt: now + cfg.hold.revalidateHours * HOUR };
  const evicted: HeldItem[] = [];
  const same = q.findIndex(x => x.key === item.key);
  if (same >= 0) {
    const old = q[same]!;
    // A partner probe (the first member already said yes) always supersedes a cold one.
    const promote = item.stage === "partner" && old.stage !== "partner";
    if (!promote && holdValue(item, prefs, cfg) < holdValue(old, prefs, cfg) + cfg.hold.replaceMargin) return { queue: q, added: false, evicted: [], reason: "duplicate" };
    evicted.push(old);
    q.splice(same, 1);
  }
  q.push(held);
  if (q.length > cfg.hold.capacity) {
    // Evict the lowest V; partner probes are evicted last (someone already said yes).
    const order = [...q].sort((a, b) => ((a.stage === "partner" ? 1 : 0) - (b.stage === "partner" ? 1 : 0))
      || (holdValue(a, prefs, cfg) - holdValue(b, prefs, cfg)) || (b.heldAt - a.heldAt) || (a.id < b.id ? 1 : -1));
    const out = order[0]!;
    q.splice(q.indexOf(out), 1);
    evicted.push(out);
    if (out === held) return { queue: q, added: false, evicted: evicted.filter(x => x !== held), reason: "hold_full" };
  }
  return { queue: q, added: true, evicted };
}

/**
 * Re-validate a hold queue before any send and every 24 hours (audit P1-5). Expired items are
 * dropped with reason "expired"; then the existing send-time check (opportunity.ts
 * EligibilityCheck, built with filters.ts eligibilityFor) runs for the member and for every other
 * member involved: an ineligible member drops the item ("ineligible:<why>" or
 * "partner_ineligible:<why>"). `extra` adds runtime checks (partner in an open opportunity,
 * partner budget, listing still live).
 */
export function revalidateHold(queue: readonly HeldItem[], now: number, eligible?: EligibilityCheck, extra?: (it: HeldItem) => string | null, cfg: AttentionConfig = DEFAULT_ATTENTION):
  { kept: HeldItem[]; dropped: { item: HeldItem; reason: string }[] } {
  const kept: HeldItem[] = [], dropped: { item: HeldItem; reason: string }[] = [];
  for (const it of queue) {
    let reason: string | null = null;
    if (it.urgency.expiresAt <= now) reason = "expired";
    else if (it.reviewState === "rejected") reason = "review_rejected";
    if (!reason && eligible) {
      // The send-time check is about meeting people: "underage" does not apply to an item that involves
      // no other member (D9: members 13-17 do get events, places and solo plans; itemGate enforces that).
      // Member items re-check the lane opt-ins too (engine-pipeline-10).
      const solo = it.others.length === 0 && !it.involvesMember;
      const why = eligible(it.memberId, it.others, solo ? undefined : it.category);
      if (why && !(solo && why === "underage")) reason = `ineligible:${why}`;
      else for (const o of it.others) {
        const w = eligible(o, [it.memberId, ...it.others.filter(x => x !== o)], solo ? undefined : it.category);
        if (w) { reason = `partner_ineligible:${w}`; break; }
      }
    }
    if (!reason && extra) reason = extra(it);
    if (reason) dropped.push({ item: it, reason });
    else kept.push({ ...it, revalidateAt: now + cfg.hold.revalidateHours * HOUR });
  }
  return { kept, dropped };
}

// ------------------------------------------------------------------------------------------------
// Items from engine proposals

const FIRST_ROLES: Role[] = ["seeker", "initiator", "newcomer"];

/** Consent-first order (1.8): the member with the live want (seeker / initiator / newcomer) is probed first. */
export function firstToProbe(p: Pick<EngineProposal, "participants" | "roles">): MemberId {
  for (const r of FIRST_ROLES) { const id = p.participants.find(x => p.roles?.[x] === r); if (id) return id; }
  return p.participants[0]!;
}

export function itemKindFor(p: Pick<EngineProposal, "participants" | "roles" | "kind">, member: MemberId): ItemKind {
  const role = p.roles?.[member];
  if ((role && CONTRIBUTOR_ROLES.has(role)) || p.kind === "network_growth") return "help_ask";
  return p.participants.length > 2 ? "group_probe" : "intro_probe";
}
export function effortFor(p: Pick<EngineProposal, "participants" | "roles" | "kind">, member: MemberId): Effort {
  const role = p.roles?.[member];
  if ((role && CONTRIBUTOR_ROLES.has(role)) || p.kind === "network_growth") return "contribute";
  if (p.participants.length > 2 || p.kind === "event_coattend") return "meet_long";
  return "meet_short";
}

export interface ItemOptions {
  now: number; calibrate?: Calibrator; cfg?: AttentionConfig;
  /** Review state for member-involving items (the Network's review gate; "approved" once reviewed). */
  reviewState?: AttentionItem["reviewState"];
}

/** The opportunity key: the same participant set is the same opportunity across engine runs. */
export const opportunityKey = (participants: readonly MemberId[]) => [...participants].sort().join("|");

function itemFor(p: EngineProposal, member: MemberId, stage: "first" | "partner", o: ItemOptions): AttentionItem {
  const cfg = o.cfg ?? DEFAULT_ATTENTION;
  const cal = o.calibrate ?? knotCalibrator();
  const kind = itemKindFor(p, member);
  const others = p.participants.filter(x => x !== member);
  let expiresAt = holdExpiry(p, kind, o.now, cfg);
  if (stage === "partner") expiresAt = Math.min(expiresAt, o.now + cfg.expiry.partnerProbeDays * DAY);
  return {
    id: `${p.id}:${member}`, memberId: member, kind, category: p.category, sourceProposalId: p.id, others,
    involvesMember: others.length > 0, effort: effortFor(p, member),
    enjoy: Math.max(0, Math.min(1, cal(p.score, p.category))), accept: itemAcceptance(p, member, stage, cfg),
    urgency: { expiresAt, ...(p.window ? { bestBy: p.window.start } : {}) },
    createdAt: o.now, reviewState: others.length ? (o.reviewState ?? "pending") : "not_needed",
    key: opportunityKey(p.participants), stage,
  };
}

/**
 * P̂acc for the item (D13: order by score x sqrt(P(mutual accept))). A cold pair probe needs both
 * yeses, so it carries the product of both members' estimates; a partner probe after the first
 * member's yes needs only the partner's; a group probe (quorum, parallel) the member's own.
 */
export function itemAcceptance(p: Pick<EngineProposal, "participants" | "acceptance">, member: MemberId, stage: "first" | "partner", cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  const acc = (id: MemberId) => p.acceptance?.[id] ?? cfg.acceptancePrior;
  if (stage === "partner" || p.participants.length !== 2) return acc(member);
  return p.participants.reduce((x, id) => x * acc(id), 1);
}

/**
 * Items for a fresh engine proposal: pairs probe the member with the want first (the partner's
 * item is created only after their yes, partnerItem); groups probe everyone in parallel (quorum).
 */
export function itemsForProposal(p: EngineProposal, o: ItemOptions & { parallel?: boolean }): AttentionItem[] {
  // Groups, and pairs probed in parallel (iteration 4, design 1.8): everyone at once, reveal when all needed said yes.
  if (p.participants.length > 2 || o.parallel) return p.participants.map(id => itemFor(p, id, "first", o));
  return [itemFor(p, firstToProbe(p), "first", o)];
}
/** The partner's item, once the first member said yes. Expires sooner (cfg.expiry.partnerProbeDays). */
export function partnerItem(p: EngineProposal, partner: MemberId, o: ItemOptions): AttentionItem {
  return itemFor(p, partner, "partner", o);
}

// ------------------------------------------------------------------------------------------------
// Consent-first probes (1.8, D5)

export type ProbeAnswer = "pending" | "yes" | "no";
export interface ProbeFlow {
  proposalId: string; first: MemberId; partners: MemberId[]; group: boolean; quorum: number;
  /** A pair probed in parallel: both at once, any order; revealed when both said yes, closed on any no. */
  parallel?: boolean;
  answers: Record<MemberId, ProbeAnswer>;
  stage: "probing_first" | "probing_partners" | "revealed" | "closed";
}

/**
 * Pairs: probe the first member, then the partner on yes (sequential), or both at once (`parallel`).
 * Groups: everyone in parallel; reveal at quorum. Either way nobody is named before everyone needed said yes.
 */
export function startProbeFlow(p: Pick<EngineProposal, "id" | "participants" | "roles">, o: { parallel?: boolean } = {}): ProbeFlow {
  const group = p.participants.length > 2;
  const parallel = !group && !!o.parallel;
  const first = group ? p.participants[0]! : firstToProbe(p);
  return {
    proposalId: p.id, first, partners: p.participants.filter(x => x !== first), group,
    quorum: group ? Math.max(3, Math.ceil(p.participants.length * 0.66)) : 2,
    answers: Object.fromEntries(p.participants.map(x => [x, "pending" as ProbeAnswer])),
    stage: group || parallel ? "probing_partners" : "probing_first",
    ...(parallel ? { parallel: true } : {}),
  };
}
/**
 * The probe flow the pack's consent policy prescribes for a proposal (AppPack.consent). probe_first
 * "parallel" and double_opt_in probe both sides blind at once and reveal only on mutual yes;
 * group_rsvp and groups reveal at quorum; everything else probes the wanter first. Nobody is
 * named before the flow reaches "revealed" (core invariant: consent before reveal).
 */
export function startProbeFlowFor(p: Pick<EngineProposal, "id" | "participants" | "roles" | "kind">, pack: AppPack = networkPack): ProbeFlow {
  const flow = pack.consent.byKind[p.kind] ?? pack.consent.default;
  const parallel = (flow.kind === "probe_first" && flow.order === "parallel") || flow.kind === "double_opt_in";
  return startProbeFlow(p, { parallel });
}
/** Who should be probed now (members with no answer whose turn it is). */
export function toProbe(f: ProbeFlow): MemberId[] {
  if (f.stage === "probing_first") return f.answers[f.first] === "pending" ? [f.first] : [];
  if (f.stage === "probing_partners") return Object.keys(f.answers).filter(x => f.answers[x] === "pending" && (f.group || f.parallel || x !== f.first));
  return [];
}
export function recordProbeAnswer(f: ProbeFlow, member: MemberId, yes: boolean): ProbeFlow {
  if (!(member in f.answers) || f.stage === "closed" || f.stage === "revealed") return f;
  if (!f.group && f.stage === "probing_first" && member !== f.first) return f; // partner is never probed before the first says yes
  const answers = { ...f.answers, [member]: (yes ? "yes" : "no") as ProbeAnswer };
  const yesN = Object.values(answers).filter(a => a === "yes").length;
  const open = Object.values(answers).filter(a => a === "pending").length;
  let stage: ProbeFlow["stage"] = f.stage;
  if (f.parallel) stage = !yes ? "closed" : yesN === Object.keys(answers).length ? "revealed" : f.stage;
  else if (!f.group) {
    if (member === f.first) stage = yes ? "probing_partners" : "closed";
    else stage = yes && answers[f.first] === "yes" ? "revealed" : "closed";
  } else if (yesN >= f.quorum) stage = "revealed";
  else if (yesN + open < f.quorum) stage = "closed";
  return { ...f, answers, stage };
}
/** D5: identities are revealed only after everyone needed said yes. */
export const canReveal = (f: ProbeFlow) => f.stage === "revealed";
/** What `recipient` may learn about the others: names only once revealed, and only of people who said yes. Never who declined. */
export function revealFor(f: ProbeFlow, recipient: MemberId, nameOf: (id: MemberId) => string): { names: string[] } | null {
  if (!canReveal(f) || f.answers[recipient] !== "yes") return null;
  return { names: Object.keys(f.answers).filter(x => x !== recipient && f.answers[x] === "yes").map(nameOf) };
}

const EMPLOYER_TAGS = /^(employer|employer_type|occupation|company|job|job_title|workplace|work|role|title)$/i;
const EMPLOYER_TEXT = /\b(works? (at|for)|employer|employed|company|job|occupation|workplace|engineer at|manager at)\b/i;
const ATTRIBUTE_KINDS = new Set(["interest", "skill", "goal"]);

/**
 * Warm-path mention (iteration 4): "a friend of Sam" in a probe, when the opportunity came through a
 * mutual (`EngineProposal.via`). It stays within D5 only as THE one shareable fact (the attribute is
 * dropped), and only when: both the mutual and the person described consented to mutual mentions
 * (`consented`); the mutual is an adult in good standing; the recipient and the other person are
 * each directly connected to the mutual; the mutual has at least `minAnonymity` connections other
 * than the recipient (so "a friend of Sam" does not single out one person); never for romance. The
 * mutual's first name only. Returns the first name or null.
 */
export function warmMention(w: World, via: MemberId | undefined, recipient: MemberId, others: readonly MemberId[], consented: (id: MemberId) => boolean, category: Category, cfg: AttentionConfig = DEFAULT_ATTENTION): string | null {
  if (!via || others.length !== 1 || w.pack.attention.noWarmMentionLanes.includes(category)) return null;
  const mv = w.get(via);
  if (!mv || isMinor(mv.m.age) || mv.m.state === "paused" || w.holds.has(via)) return null;
  if (!consented(via) || !consented(others[0]!)) return null;
  const friends = w.positive.get(via);
  if (!friends?.has(recipient) || !friends.has(others[0]!)) return null;
  if ([...friends.keys()].filter(x => x !== recipient).length < cfg.consent.warmMinAnonymity) return null;
  return mv.m.name.trim().split(/\s+/)[0] || null;
}

export interface ProbeSpec {
  proposalId: string; kind: EngineProposal["kind"]; category: Category; objective: string;
  window?: { start: number; end: number }; tz: string;
  /** The recipient's own role (contributor roles get a "could you help" probe). */
  role?: Role;
  /** Founder decision 4a: 2-3 concrete time options (chooseTimeOptions) asked in the probe itself. */
  options?: TimeSlot[];
  /** Iteration 4: a consenting mutual's first name (warmMention); replaces the attribute as the one fact. */
  mutual?: string;
}
export interface Probe { text: string; attribute?: string; area?: string; mutual?: string }

/** The Network's generic activity phrases (moved verbatim to packs/network/copy.ts; buildProbe reads the pack's). */
export const GENERIC_ACTIVITY: Record<Category, string> = NETWORK_GENERIC_ACTIVITY;
function activityOf(objective: string): string {
  const s = objective.replace(/^(intro|small group|go together|help with|friend-of-a-friend intro|try something new|small crew for|another meetup|see each other again at)\s*:?\s*/i, "").trim();
  return s.length > 60 ? s.slice(0, 60).replace(/\s+\S*$/, "") : s;
}
function whenPhrase(window: { start: number; end: number } | undefined, now: number, tz: string): string {
  // An availability window that is already open says nothing about a day: keep it general.
  if (!window || window.start <= now) return "in the next week or so";
  const days = (window.start - now) / DAY;
  const at = localParts(window.start, tz), today = localParts(now, tz);
  const wd = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][at.weekday]!;
  // "later today" only on the same local calendar day (engine-attention-plans-16).
  if (at.year === today.year && at.month === today.month && at.day === today.day) return "later today";
  if (days < 6) return `on ${wd}`;
  return "in the next week or so";
}
/** Name tokens of a member (full name, first, last, "First L."), lowercased. */
function nameTokens(w: World, ids: MemberId[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) for (const t of tokenize(w.get(id)?.m.name ?? "")) out.add(t.toLowerCase());
  return out;
}
/** Employer-like values of the others, any scope (never in a probe, D5). */
function employerValues(w: World, ids: MemberId[]): string[] {
  const out: string[] = [];
  for (const id of ids) for (const f of w.input.facets) {
    if (w.canonical(f.memberId) !== id) continue;
    if (f.tags.some(t => EMPLOYER_TAGS.test(t)) || EMPLOYER_TEXT.test(f.value)) out.push(f.value);
  }
  return out;
}
/** At most one `shareable` attribute of the other person (D5): an interest, skill or goal; never employer-like. */
function shareableAttribute(w: World, other: MemberId, recipient: MemberId): string | undefined {
  const mo = w.get(other);
  if (!mo) return undefined;
  const mine = new Set((w.get(recipient)?.match ?? []).flatMap(f => f.tags));
  const cands = mo.share.filter(f => ATTRIBUTE_KINDS.has(f.kind) && !f.tags.some(t => EMPLOYER_TAGS.test(t)) && !EMPLOYER_TEXT.test(f.value) && f.value.length <= 60)
    .sort((a, b) => ((b.tags.some(t => mine.has(t)) ? 1 : 0) - (a.tags.some(t => mine.has(t)) ? 1 : 0)) || (a.id < b.id ? -1 : 1));
  return cands[0]?.value;
}

/**
 * Build an anonymous consent-first probe (1.8, D5). It reveals only the activity, the time, an
 * area and at most one `shareable` attribute of the other person; never a name, photo, employer,
 * or anything `matchable` / `agent_private`. Every candidate text must pass the existing leak gate
 * (judgeCommon.ts checkMemberFacing with explain.ts privateVocabulary of the other people), plus a
 * name-token check and the others' employer-like values; if the richest text fails, the attribute
 * and then the area are dropped; if nothing passes, null (do not send). Minors: always null.
 * Romance probes say plainly that it is a romance intro, and only go between adults.
 */
export function buildProbe(w: World, spec: ProbeSpec, recipient: MemberId, others: MemberId[], now: number): Probe | null {
  const ids = [recipient, ...others];
  if (ids.some(id => !w.get(id) || isMinor(w.get(id)!.m.age))) return null;
  const AP = w.pack.attention;
  if (AP.probeAllowed && !AP.probeAllowed(spec.category, others.length)) return null;
  const when = spec.options?.length ? timeOptionsPhrase(spec.options, spec.tz) : whenPhrase(spec.window, now, spec.tz);
  const area = w.get(recipient)!.presence.find(p => p.type === "home")?.areas?.[0] ?? w.get(recipient)!.presence[0]?.areas?.[0];
  const attr = others.length === 1 && !spec.mutual ? shareableAttribute(w, others[0]!, recipient) : undefined;
  const contributor = spec.role && w.pack.ontology.contributorRoles.has(spec.role);
  // The probe copy is the pack's (networkPack: packs/network/copy.ts networkProbeText, moved verbatim).
  const frame = (activity: string, a?: string, ar?: string) =>
    AP.probeText({ lane: spec.category, kind: spec.kind, when, othersCount: others.length, contributor: !!contributor, mutual }, activity, a, ar);
  let mutual: string | undefined = spec.mutual;
  const vocab = privateVocabulary(w, others);
  const names = nameTokens(w, others);
  const forbidden = employerValues(w, others);
  const ok = (text: string) => !tokenize(text).some(t => names.has(t.toLowerCase())) && checkMemberFacing(text, vocab, forbidden).ok;
  // The activity can itself come from someone's private facet (e.g. a matchable workplace word):
  // then a generic phrase for the category is used instead.
  for (const m of mutual ? [mutual, undefined] : [undefined]) {
    mutual = m;
    for (const activity of [...new Set([activityOf(spec.objective), AP.laneActivity[spec.category], "meeting new people"])]) {
      for (const [a, ar] of [[attr, area], [attr, undefined], [undefined, area], [undefined, undefined]] as const) {
        const text = frame(activity, a, ar);
        if (ok(text)) return { text, ...(a ? { attribute: a } : {}), ...(ar ? { area: ar } : {}), ...(m ? { mutual: m } : {}) };
      }
    }
  }
  return null;
}

/** The digest message text: a numbered menu with the reply grammar (1.4). */
/** PRD PH-003: every proactive message includes a simple path to silence or pause future outreach. */
export const PAUSE_PATH = "Reply STOP anytime to opt out.";
/** The message body with the pause path appended once (PH-003), unless it already has one. */
export function withPausePath(body: string): string {
  return /\breply stop\b|\bstop to opt out\b|\bopt[- ]out\b/i.test(body) ? body : `${body}${/\n/.test(body) ? "\n" : " "}${PAUSE_PATH}`;
}

export function digestText(lines: string[]): string {
  // The head names the count, so only 1-3 lines are valid (engine-attention-plans-19).
  if (lines.length < 1 || lines.length > 3) throw new Error(`digestText takes 1-3 lines, got ${lines.length}`);
  if (lines.length === 1) return lines[0]!;
  const head = lines.length === 2 ? "Two things for this week" : "Three things for this week";
  return `${head}, reply with a number (or "none"):\n${lines.map((l, i) => `${i + 1}. ${l}`).join("\n")}`;
}

// ------------------------------------------------------------------------------------------------
// Availability capture and time options (founder decision 4; design doc 1.11)

export interface TimeSlot { start: number; end: number }
/** A recurring weekly window in local time (JS weekdays, hours [startHour, endHour)). */
export interface WeeklyWindow { byDay: number[]; startHour: number; endHour: number }
/** Standing availability (4b): "usually free Tue evenings", from onboarding, conversation or a calendar pattern. */
export interface StandingAvailability extends WeeklyWindow {
  source: "onboarding" | "conversation" | "calendar_pattern";
  /** When it was stated (or inferred), and last re-confirmed by the member. */
  statedAt: number; confirmedAt?: number;
  /** true = inferred (e.g. from calendar patterns), false = said by the member. */
  inferred?: boolean;
}
/** Everything the Network knows about when a member is free. All of it is engine-visible; none of it is shareable. */
export interface AvailabilityEvidence {
  memberId: MemberId; tz: string;
  quietHours?: [number, number];
  /** Connected calendar, free/busy only (4c): busy blocks, never titles. Absent = not connected. */
  calendar?: { busy: TimeSlot[] };
  standing?: StandingAvailability[];
  /** Times the member accepted (picked) or attended, and times they turned down as "can't then" (4e). */
  history?: { at: number; outcome: "accepted" | "attended" | "declined_time" }[];
  /** Presence windows: the member is away (outside the city) in these intervals. */
  away?: TimeSlot[];
}

const daypart = (h: number) => (h < 17 ? "day" : "evening");
/** P(the member is free for `slot`), from all evidence. Pure; deterministic. */
export function availabilityProb(ev: AvailabilityEvidence, slot: TimeSlot, now: number, cfg: AttentionConfig = DEFAULT_ATTENTION): number {
  const A = cfg.availability;
  const lp = localParts(slot.start, ev.tz);
  const day = (lp.weekday + 1) % 7;
  const weekend = cfg.sendTime.weekendDays.includes(day);
  if (ev.quietHours && hourInQuiet(lp.hour, ev.quietHours)) return 0;
  if (ev.away?.some(a => a.start < slot.end && a.end > slot.start)) return 0;
  const part = daypart(lp.hour);
  let p = weekend ? (part === "day" ? A.prior.weekendDay : A.prior.weekendEvening) : (part === "day" ? A.prior.weekdayDay : A.prior.weekdayEvening);
  // (b) standing availability: a decaying prior.
  let inside = 0, any = 0;
  for (const w of ev.standing ?? []) {
    const c0 = w.inferred ? A.standing.inferredConfidence : A.standing.statedConfidence;
    const conf = c0 * Math.pow(2, -Math.max(0, now - (w.confirmedAt ?? w.statedAt)) / (A.standing.halfLifeDays * DAY));
    any = Math.max(any, conf);
    if (w.byDay.includes(day) && lp.hour >= w.startHour && lp.hour < w.endHour) inside = Math.max(inside, conf);
  }
  if (inside > 0) p += inside * (A.standing.inside - p);
  else if (any > 0) p *= 1 - A.standing.outsideFactor * any;
  // (e) learned from accepted / attended times in the same weekday-or-weekend daypart.
  let pos = 0, neg = 0;
  for (const h of ev.history ?? []) {
    if (h.at > now + 14 * DAY) continue;
    const hp = localParts(h.at, ev.tz);
    const hd = (hp.weekday + 1) % 7;
    if (cfg.sendTime.weekendDays.includes(hd) !== weekend || daypart(hp.hour) !== part) continue;
    const w = Math.pow(2, -Math.max(0, now - h.at) / (A.learned.halfLifeDays * DAY)) * (hd === day ? 1 : 0.5);
    if (h.outcome === "declined_time") neg += w; else pos += w;
  }
  if (pos > 0) p += Math.min(A.learned.maxWeight, pos / (pos + A.learned.k)) * (A.learned.target - p);
  if (neg > 0) p *= 1 - A.learned.declinePenalty * (neg / (neg + A.learned.k));
  // (c) calendar free/busy: a hard-ish filter.
  if (ev.calendar) {
    if (ev.calendar.busy.some(b => b.start < slot.end && b.end > slot.start)) p *= A.calendar.busyFactor;
    else p += A.calendar.freeWeight * (A.calendar.freeTarget - p);
  }
  return Math.max(0, Math.min(1, p));
}

/** Candidate slots in the recipient's local time: `minLeadHours` to `horizonDays` ahead, at the template hours, inside `window` if given. */
export function candidateSlots(tz: string, now: number, o: { window?: TimeSlot } = {}, cfg: AttentionConfig = DEFAULT_ATTENTION): TimeSlot[] {
  const A = cfg.availability;
  const out: TimeSlot[] = [];
  const p = localParts(now, tz);
  for (let k = 0; k <= A.horizonDays; k++) {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day + k));
    const hours = cfg.sendTime.weekendDays.includes(d.getUTCDay()) ? A.templates.weekend : A.templates.weekday;
    for (const h of hours) {
      const start = fromLocal(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), h, tz);
      const slot = { start, end: start + A.slotHours * HOUR };
      if (start < now + A.minLeadHours * HOUR || start > now + A.horizonDays * DAY) continue;
      if (o.window && (start < o.window.start || slot.end > o.window.end + A.slotHours * HOUR)) continue;
      out.push(slot);
    }
  }
  return out;
}

export interface TimeOptions { slots: { slot: TimeSlot; joint: number; each: Record<MemberId, number> }[]; pAny: number }

/**
 * Pick 2-3 time options for a probe that maximize the chance that at least one works for everyone
 * (4a): joint P = product of each member's availabilityProb (independent members); options are
 * added greedily by their gain in P(any) = 1 - prod(1 - joint), at most one per local day, until
 * targetAny is reached or an option adds less than minGain (always at least minOptions when
 * candidates exist above minJoint). A fixed-time opportunity (an event) gets its own time only.
 */
export function chooseTimeOptions(members: readonly AvailabilityEvidence[], now: number, o: { tz: string; window?: TimeSlot; fixed?: boolean; candidates?: TimeSlot[] }, cfg: AttentionConfig = DEFAULT_ATTENTION): TimeOptions {
  const A = cfg.availability;
  const score = (slot: TimeSlot) => {
    const each: Record<MemberId, number> = {};
    let joint = 1;
    for (const m of members) { const p = availabilityProb(m, slot, now, cfg); each[m.memberId] = p; joint *= p; }
    return { slot, joint, each };
  };
  if (o.fixed && o.window) {
    const one = score({ start: o.window.start, end: Math.max(o.window.end, o.window.start + A.slotHours * HOUR) });
    return { slots: [one], pAny: one.joint };
  }
  const cands = (o.candidates ?? candidateSlots(o.tz, now, { window: o.window }, cfg)).map(score)
    .filter(c => c.joint >= A.minJoint).sort((a, b) => (b.joint - a.joint) || (a.slot.start - b.slot.start));
  const chosen: TimeOptions["slots"] = [];
  const dayOf = (t: number) => { const p = localParts(t, o.tz); return `${p.year}-${p.month}-${p.day}`; };
  let miss = 1;
  for (const c of cands) {
    if (chosen.length >= A.maxOptions) break;
    if (chosen.some(x => dayOf(x.slot.start) === dayOf(c.slot.start))) continue;
    const gain = miss * c.joint;
    if (chosen.length >= A.minOptions && (1 - miss >= A.targetAny || gain < A.minGain)) break;
    chosen.push(c);
    miss *= 1 - c.joint;
  }
  chosen.sort((a, b) => a.slot.start - b.slot.start);
  return { slots: chosen, pAny: 1 - miss };
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Thursday 7pm or Saturday 10am" (local time of the recipient). */
export function timeOptionsPhrase(slots: readonly TimeSlot[], tz: string): string {
  const one = (t: number) => {
    const p = localParts(t, tz);
    const h = p.hour % 12 === 0 ? 12 : p.hour % 12;
    return `${WEEKDAY_NAMES[(p.weekday + 1) % 7]} ${h}${p.minute ? `:${String(p.minute).padStart(2, "0")}` : ""}${p.hour < 12 ? "am" : "pm"}`;
  };
  const xs = slots.map(s => one(s.start));
  return xs.length <= 2 ? xs.join(" or ") : `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
}

/** Standing availability from `availability_pattern` facets ("calendar usually free Tue/Thu evenings": tags evening:Tue). */
export function standingFromFacets(facets: readonly { kind: string; tags: string[]; inferred?: boolean; observedAt?: number; validFrom?: number }[], now: number): StandingAvailability[] {
  const DAYS3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const PARTS: Record<string, [number, number]> = { morning: [7, 12], afternoon: [12, 17], evening: [17, 22] };
  const out: StandingAvailability[] = [];
  for (const f of facets) {
    if (f.kind !== "availability_pattern") continue;
    const by = new Map<string, number[]>();
    for (const t of f.tags) {
      const [rawPart, rawDay] = t.split(":");
      const part = rawPart?.toLowerCase();
      // Day tags arrive as "Tue" or "tue" depending on the source (sim sources.ts emits lowercase).
      const i = DAYS3.findIndex(d => d.toLowerCase() === (rawDay ?? "").slice(0, 3).toLowerCase());
      if (!part || !PARTS[part] || i < 0) continue;
      by.set(part, [...(by.get(part) ?? []), i]);
    }
    for (const [part, days] of by) out.push({ byDay: days, startHour: PARTS[part]![0], endHour: PARTS[part]![1], source: f.inferred ? "calendar_pattern" : "conversation", statedAt: f.observedAt ?? f.validFrom ?? now, inferred: !!f.inferred });
  }
  return out;
}

/** Standing windows due for re-confirmation ("still free Tuesday evenings?"), a profiling ask, never an invite. */
export const needsReconfirm = (w: StandingAvailability, now: number, cfg: AttentionConfig = DEFAULT_ATTENTION) => now - (w.confirmedAt ?? w.statedAt) >= cfg.availability.standing.reconfirmDays * DAY;

// ------------------------------------------------------------------------------------------------
// Metrics (1.10, 3.3)

export interface MemberSpan {
  id: MemberId; joinedAt: number; adult: boolean;
  /** Left the eligible set (STOP / paused) at, if ever. */
  leftAt?: number;
  /** Entered only-when-asked at (reported separately for V14, 3.3). */
  onlyWhenAskedAt?: number;
}
export interface ValueEvent { memberId: MemberId; at: number }

/**
 * V14 (3.3): on each day t, E(t) = adults active with tenure >= 14 days and not paused /
 * only-when-asked; V14(m, t) = 1 if m had a value event in (t - 14d, t]. Reported: the mean of
 * V14(t) over the days of [start, end] on which E(t) is non-empty.
 */
export function v14(events: readonly ValueEvent[], members: readonly MemberSpan[], start: number, end: number, cfg: AttentionConfig = DEFAULT_ATTENTION): { mean: number; days: number; byDay: { t: number; eligible: number; withValue: number }[] } {
  const by = new Map<MemberId, number[]>();
  for (const e of events) { if (!by.has(e.memberId)) by.set(e.memberId, []); by.get(e.memberId)!.push(e.at); }
  const byDay: { t: number; eligible: number; withValue: number }[] = [];
  for (let t = start + DAY; t <= end + 1; t += DAY) {
    const elig = members.filter(m => m.adult && t - m.joinedAt >= cfg.v14.minTenureDays * DAY && (m.leftAt === undefined || m.leftAt > t) && (m.onlyWhenAskedAt === undefined || m.onlyWhenAskedAt > t));
    if (!elig.length) continue;
    const withValue = elig.filter(m => (by.get(m.id) ?? []).some(x => x <= t && x > t - cfg.v14.windowDays * DAY)).length;
    byDay.push({ t, eligible: elig.length, withValue });
  }
  const mean = byDay.length ? byDay.reduce((s, d) => s + d.withValue / d.eligible, 0) / byDay.length : NaN;
  return { mean, days: byDay.length, byDay };
}

export interface AttentionMetrics {
  interruptions: number; memberWeeks: number; interruptionsPerMemberWeek: number;
  /** Interruptions with no reply within 72h. */
  unansweredRate: number;
  /** Members entering only-when-asked per 100 member-months. */
  autoPausePer100MemberMonths: number;
  /** STOP per 1,000 interruptions. */
  stopPer1000: number;
  itemsDelivered: number; itemsPerInterruption: number;
  valueEvents: number; valuePerInterruption: number;
  /** Median days from joining to the first value event (members with one). */
  timeToValueDaysMedian: number | null;
  v14: number;
}

export function attentionMetrics(inp: {
  ledger: readonly AttentionLedgerEntry[]; members: readonly MemberSpan[]; values: readonly ValueEvent[];
  autoPauses: readonly { memberId: MemberId; at: number }[]; stops: readonly { memberId: MemberId; at: number }[];
  start: number; end: number; cfg?: AttentionConfig;
}): AttentionMetrics {
  const cfg = inp.cfg ?? DEFAULT_ATTENTION;
  const msgs = new Map<string, AttentionLedgerEntry>();
  // Only the metric window [start, end] counts (engine-attention-plans-22).
  for (const e of inp.ledger) if (e.countsAgainstCap && e.at >= inp.start && e.at <= inp.end) {
    const cur = msgs.get(e.messageId);
    if (!cur) msgs.set(e.messageId, { ...e, itemIds: [...e.itemIds] });
    else { cur.itemIds.push(...e.itemIds); if (e.repliedAt !== undefined && (cur.repliedAt === undefined || e.repliedAt < cur.repliedAt)) cur.repliedAt = e.repliedAt; }
  }
  const ints = [...msgs.values()];
  const memberWeeks = inp.members.reduce((s, m) => s + Math.max(0, inp.end - Math.max(m.joinedAt, inp.start)) / (7 * DAY), 0);
  const counted = ints.filter(e => e.at + cfg.annoyance.unansweredHours * HOUR <= inp.end);
  const unanswered = counted.filter(e => e.repliedAt === undefined || e.repliedAt > e.at + cfg.annoyance.unansweredHours * HOUR).length;
  const items = ints.reduce((s, e) => s + Math.max(1, new Set(e.itemIds).size), 0);
  const first = new Map<MemberId, number>();
  const inWin = (t: number) => t >= inp.start && t <= inp.end;
  const values = inp.values.filter(v => inWin(v.at));
  for (const v of values) first.set(v.memberId, Math.min(first.get(v.memberId) ?? Infinity, v.at));
  const join = new Map(inp.members.map(m => [m.id, m.joinedAt]));
  const ttv = [...first].filter(([id]) => join.has(id)).map(([id, t]) => (t - join.get(id)!) / DAY).sort((a, b) => a - b);
  const safe = (a: number, b: number) => (b ? a / b : 0);
  return {
    interruptions: ints.length, memberWeeks, interruptionsPerMemberWeek: safe(ints.length, memberWeeks),
    unansweredRate: safe(unanswered, counted.length),
    autoPausePer100MemberMonths: safe(new Set(inp.autoPauses.filter(a => inWin(a.at)).map(a => a.memberId)).size * 100, memberWeeks / (30 / 7)),
    stopPer1000: safe(inp.stops.filter(x => inWin(x.at)).length * 1000, ints.length),
    itemsDelivered: items, itemsPerInterruption: safe(items, ints.length),
    valueEvents: values.length, valuePerInterruption: safe(values.length, ints.length),
    timeToValueDaysMedian: ttv.length ? quantile(ttv, 0.5) : null,
    v14: v14(inp.values, inp.members, inp.start, inp.end, cfg).mean,
  };
}
