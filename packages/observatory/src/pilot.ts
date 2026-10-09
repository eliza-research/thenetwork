// The slop.date pilot scorecard (PRD 37.3 weekly gates, 40.5; prototype P1), per app, over a window
// (default the last 7 days). pilotMetrics() does the arithmetic on plain rows; loadPilotInput() reads
// them from the network tables of one app. The console (sources/real.ts) and the monitor
// (packages/network/service/monitor.ts) both use them, so the numbers and the pause alerts agree.
//
// What each metric reads, and its limits, is in its `how`. A pause threshold only counts when the
// sample is at least PAUSE_MIN_N, so one bad day with three probes does not page anyone.
import type { SQL } from "bun";
import { DAY, HOUR } from "@thenetwork/core";
import type { HealthAlert, ScoreMetric } from "./types.ts";

export const PILOT_WINDOW = 7 * DAY;
export const PAUSE_MIN_N = 20;
/** A probe nobody answered is settled (counted as a no) after this long. */
const PROBE_SETTLE = 72 * HOUR;
const SECOND_DATE_DAYS = 60;

export interface PilotInput {
  now: number;
  windowMs?: number;
  /** probe_sent events: a member was asked about an opportunity. */
  probes: { oppId: string; memberId: string; at: number }[];
  /** probe_answer events. */
  answers: { oppId: string; memberId: string; yes: boolean; at: number }[];
  /** Opportunities (not shadow), with who attended (participations "attended"). */
  opps: { id: string; state: string; participants: string[]; attended: string[]; createdAt: number; meetingAt?: number }[];
  /** Joined members: when they joined and whether they are an adult (only adults are probed). */
  members: { id: string; joinedAt?: number; adult: boolean }[];
  /** STOP (member_opted_out), mutes and complaints in the window. */
  optOuts: number; mutes: number; complaints: number;
  /** Members who got a proactive message that went out in the window. */
  reached: number;
  /** Post-date safety reports in the window. */
  reports: { at: number; kind: string }[];
  /** Sends handed to Blooio in the window, and how many failed. */
  blooio: { handed: number; failed: number };
  /** "Was that worth a text?" labels (worth_a_text events) in the window. */
  worth: { worth: boolean; at: number }[];
  /** This month's spend for the app and its active members (cost ledger). */
  cost?: { monthUsd: number; activeMembers: number; targetUsd?: number };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const share = (a: number, b: number) => (b > 0 ? a / b : null);
function metric(m: Omit<ScoreMetric, "met" | "paused">): ScoreMetric {
  const t = m.target, v = m.value, p = m.pause;
  const cmp = (op: string, x: number, y: number) => (op === ">=" ? x >= y : op === "<=" ? x <= y : op === "<" ? x < y : op === ">" ? x > y : x === y);
  const met = v === null || !t ? undefined : cmp(t.op, v, t.value);
  const paused = v === null || !p || m.n < PAUSE_MIN_N ? undefined : cmp(p.op, v, p.value);
  return { ...m, value: v === null ? null : r3(v), ...(met === undefined ? {} : { met }), ...(paused ? { paused } : {}) };
}

/** Gini of non-negative counts (0: equal, 1: one member has everything). */
export function gini(xs: number[]): number | null {
  const n = xs.length, sum = xs.reduce((a, b) => a + b, 0);
  if (!n || sum === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  let acc = 0;
  for (let i = 0; i < n; i++) acc += (2 * (i + 1) - n - 1) * s[i]!;
  return acc / (n * sum);
}
/** Share of all counts held by the top 10% of members (at least one member). */
export function top10Share(xs: number[]): number | null {
  const sum = xs.reduce((a, b) => a + b, 0);
  if (!xs.length || sum === 0) return null;
  const k = Math.max(1, Math.ceil(xs.length / 10));
  return [...xs].sort((a, b) => b - a).slice(0, k).reduce((a, b) => a + b, 0) / sum;
}
const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

export function pilotMetrics(x: PilotInput): ScoreMetric[] {
  const since = x.now - (x.windowMs ?? PILOT_WINDOW);
  const inWin = (t: number) => t >= since && t <= x.now;
  const oppById = new Map(x.opps.map(o => [o.id, o]));

  // Mutual yes per probed opportunity: every participant said yes. Settled when all answered, or 72 h after the first probe.
  const firstProbe = new Map<string, number>();
  for (const p of x.probes) if (inWin(p.at)) firstProbe.set(p.oppId, Math.min(firstProbe.get(p.oppId) ?? Infinity, p.at));
  const yes = new Map<string, Set<string>>(), answered = new Map<string, Set<string>>();
  for (const a of x.answers) {
    (answered.get(a.oppId) ?? answered.set(a.oppId, new Set()).get(a.oppId)!).add(a.memberId);
    if (a.yes) (yes.get(a.oppId) ?? yes.set(a.oppId, new Set()).get(a.oppId)!).add(a.memberId);
  }
  let settled = 0, mutual = 0;
  const mutualIds: string[] = [];
  for (const [id, t] of firstProbe) {
    const o = oppById.get(id);
    const who = o?.participants ?? [...(answered.get(id) ?? [])];
    const all = who.length >= 2 && who.every(m => yes.get(id)?.has(m));
    const done = all || who.every(m => answered.get(id)?.has(m)) || x.now - t >= PROBE_SETTLE;
    if (!done) continue;
    settled++;
    if (all) { mutual++; mutualIds.push(id); }
  }

  // Dates held: mutual yeses whose meeting time has passed, held when two or more attended.
  const due = mutualIds.map(id => oppById.get(id)).filter(o => o?.meetingAt !== undefined && o.meetingAt <= x.now);
  const heldDue = due.filter(o => o!.attended.length >= 2).length;

  // Dates (any time) for second dates and time to first date.
  const held = x.opps.filter(o => o.attended.length >= 2 && o.meetingAt !== undefined && o.meetingAt <= x.now).sort((a, b) => a.meetingAt! - b.meetingAt!);
  const firstPair = new Map<string, number>(), again = new Set<string>();
  const firstDate = new Map<string, number>();
  for (const o of held) {
    for (const id of o.attended) if (!firstDate.has(id)) firstDate.set(id, o.meetingAt!);
    for (let i = 0; i < o.attended.length; i++) for (let j = i + 1; j < o.attended.length; j++) {
      const a = o.attended[i]!, b = o.attended[j]!, key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const f = firstPair.get(key);
      if (f === undefined) firstPair.set(key, o.meetingAt!);
      else if (o.meetingAt! - f <= SECOND_DATE_DAYS * DAY) again.add(key);
    }
  }
  // Pairs whose first date is old enough to have had a second inside 60 days, or who already did.
  const pairsDue = [...firstPair.entries()].filter(([k, t]) => again.has(k) || x.now - t >= 14 * DAY).length;
  const joined = new Map(x.members.map(m => [m.id, m.joinedAt]));
  const daysToFirst = [...firstDate.entries()].filter(([id, t]) => inWin(t) && joined.get(id) !== undefined).map(([id, t]) => (t - joined.get(id)!) / DAY);
  const heldInWindow = held.filter(o => inWin(o.meetingAt!)).length;

  // Probes received per adult member in the window (zeros count).
  const received = new Map<string, number>();
  for (const m of x.members) if (m.adult) received.set(m.id, 0);
  for (const p of x.probes) if (inWin(p.at) && received.has(p.memberId)) received.set(p.memberId, received.get(p.memberId)! + 1);
  const counts = [...received.values()], probesTotal = counts.reduce((a, b) => a + b, 0);

  const reports = x.reports.filter(r => inWin(r.at));
  const worth = x.worth.filter(w => inWin(w.at));
  const unhappy = x.optOuts + x.mutes + x.complaints;
  const c = x.cost;

  return [
    metric({ key: "mutual_yes", label: "Mutual yes per probe", value: share(mutual, settled), unit: "share", n: settled, target: { op: ">=", value: 0.25 }, pause: { op: "<", value: 0.15 },
      how: "Probed opportunities where every participant said yes, over those settled (all answered, or 72 h after the first probe). The PRD pause is under 15% for 2 weeks." }),
    metric({ key: "dates_held", label: "Dates held per mutual yes", value: share(heldDue, due.length), unit: "share", n: due.length, target: { op: ">=", value: 0.6 },
      how: "Mutual yeses whose date time has passed where two or more attended (participations 'attended': booked and not cancelled; per-person check-ins are not stored yet)." }),
    metric({ key: "second_date", label: "Second-date rate", value: share(again.size, pairsDue), unit: "share", n: pairsDue, target: { op: ">=", value: 0.2 },
      how: "Pairs who had a date and met again through the app within 60 days, over pairs whose first date is at least 14 days old (or who met again). Dates arranged directly are not seen." }),
    metric({ key: "days_to_first_date", label: "Median days to first date", value: median(daysToFirst), unit: "days", n: daysToFirst.length, target: { op: "<=", value: 14 },
      how: "Days from joining to the first date held, for members whose first date was in the window." }),
    metric({ key: "probes_top10", label: "Probes received, top-10% share", value: top10Share(counts), unit: "share", n: probesTotal, target: { op: "<=", value: 0.2 },
      how: "Share of the window's probes that went to the 10% of adult members who got the most (members with none count)." }),
    metric({ key: "probes_gini", label: "Probes received, Gini", value: gini(counts), unit: "share", n: counts.length,
      how: "Gini of probes received per adult member in the window (0 is equal)." }),
    metric({ key: "mute_stop_complaint", label: "Mute, STOP or complaint rate", value: share(unhappy, x.reached), unit: "share", n: x.reached, target: { op: "<=", value: 0.05 }, pause: { op: ">", value: 0.1 },
      parts: { stop: x.optOuts, mute: x.mutes, complaint: x.complaints },
      how: "STOPs, mutes and complaints in the window over members who got a proactive message that went out. Mutes and complaints count only where an event records them." }),
    metric({ key: "reports_per_1000_dates", label: "Safety reports per 1,000 dates", value: heldInWindow ? (reports.length / heldInWindow) * 1000 : null, unit: "per_1000", n: heldInWindow,
      parts: { reports: reports.length, minor: reports.filter(r => r.kind === "minor").length },
      how: "Post-date reports in the window per 1,000 dates held in the window. Tracked; any harm to a minor pauses the pilot (the monitor alerts on every minor report)." }),
    metric({ key: "blooio_failures", label: "Blooio delivery failures", value: share(x.blooio.failed, x.blooio.handed), unit: "share", n: x.blooio.handed, target: { op: "<=", value: 0.02 },
      how: "Sends Blooio took in the window that ended 'failed'. An account flag (the pause) is not visible here." }),
    metric({ key: "worth_a_text", label: "Worth a text (labels)", value: share(worth.filter(w => w.worth).length, worth.length), unit: "share", n: worth.length, target: { op: ">=", value: 0.7 }, pause: { op: "<", value: 0.5 },
      how: "Members' answers to 'Was that worth a text?' in the window (worth_a_text events)." }),
    metric({ key: "cost_per_active_member", label: "Cost per active member (month)", value: c && c.activeMembers > 0 ? c.monthUsd / c.activeMembers : null, unit: "usd", n: c?.activeMembers ?? 0,
      ...(c?.targetUsd !== undefined ? { target: { op: "<=" as const, value: c.targetUsd }, pause: { op: ">" as const, value: c.targetUsd } } : {}),
      how: "This month's LLM, Blooio and Workers AI spend for the app (cost ledger) over members who texted in the last 30 days. The target is a founder number (COST_TARGET_PER_MEMBER_USD)." }),
  ];
}

/** An alert per metric past its pause threshold (enough sample). */
export function pilotAlerts(app: string, metrics: ScoreMetric[]): HealthAlert[] {
  return metrics.filter(m => m.paused).map(m => ({
    level: "bad" as const, key: `pilot_pause:${m.key}`, count: m.n,
    text: `${app}: ${m.label} is ${m.value} (pause threshold ${m.pause!.op} ${m.pause!.value}, n=${m.n}): consider pausing proactive matching`,
  }));
}

type Row = Record<string, any>;
const ms = (v: unknown) => (v === null || v === undefined ? undefined : new Date(v as string).getTime());

/**
 * One app's pilot rows for the window (plus 60 days of dates for second dates and time to first
 * date). `sql` must see the app's rows (an app-scoped transaction or the app's console login). Every
 * part that fails (a table the login cannot read) is empty.
 */
export async function loadPilotInput(sql: SQL, app: string, now: number, o: { windowMs?: number; reports?: PilotInput["reports"]; cost?: PilotInput["cost"] } = {}): Promise<PilotInput> {
  const windowMs = o.windowMs ?? PILOT_WINDOW;
  const since = new Date(now - windowMs), older = new Date(now - windowMs - SECOND_DATE_DAYS * DAY - PROBE_SETTLE);
  const safe = <T>(p: Promise<T>, empty: T) => p.catch(() => empty);
  const [ev, opps, members, reached, blooio, reports] = await Promise.all([
    safe(sql`select type, at, actor_id, payload from network.events where app_id = ${app} and at >= ${new Date(now - windowMs - PROBE_SETTLE)} and at <= ${new Date(now)}
      and type in ('probe_sent', 'probe_answer', 'member_opted_out', 'member_muted', 'complaint', 'worth_a_text')`, [] as Row[]),
    safe(sql`select o.id, o.state, o.created_at, o.meeting_at, array_agg(p.member_id) filter (where p.member_id is not null) as participants,
      array_agg(p.member_id) filter (where p.status = 'attended') as attended
      from network.opportunities o left join network.participations p on p.app_id = o.app_id and p.opportunity_id = o.id and p.role = 'participant'
      where o.app_id = ${app} and (o.created_at >= ${older} or o.meeting_at >= ${older}) group by o.id, o.state, o.created_at, o.meeting_at`, [] as Row[]),
    safe(sql`select id, joined_at, age from network.members where app_id = ${app} and account_status not in ('invited', 'removed')`, [] as Row[]),
    safe(sql`select count(distinct member_id)::int as n from network.messages where app_id = ${app} and direction = 'outbound' and proactive and not system
      and ts >= ${since} and ts <= ${new Date(now)} and status !~ '^(refused|suppressed|blocked|parked|held|expired|failed_no_address|queued|pending|sending|deferred|retry|dropped)'`, [{ n: 0 }] as Row[]),
    safe(sql`select count(*) filter (where status in ('accepted', 'sent', 'delivered', 'read', 'failed'))::int as handed, count(*) filter (where status = 'failed')::int as failed
      from network.messages where app_id = ${app} and direction = 'outbound' and ts >= ${since} and ts <= ${new Date(now)}`, [{ handed: 0, failed: 0 }] as Row[]),
    o.reports ? Promise.resolve(undefined) : safe(sql`select r->>'kind' as kind, (r->>'at')::bigint as at from network.network_state s, jsonb_array_elements(coalesce(s.state->'reports', '[]'::jsonb)) r
      where s.app_id = ${app} and (r->>'at')::bigint >= ${now - windowMs}`, [] as Row[]),
  ]);
  const evs = ev as Row[];
  const inWin = (r: Row) => ms(r.at)! >= since.getTime();
  const p = (r: Row) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload) ?? {};
  const worthOf = (v: unknown) => v === true || v === "yes" || v === "worth" || v === 1;
  return {
    now, windowMs,
    probes: evs.filter(r => r.type === "probe_sent").map(r => ({ oppId: String(p(r).oppId ?? ""), memberId: String(p(r).memberId ?? r.actor_id ?? ""), at: ms(r.at)! })).filter(x => x.oppId && x.memberId),
    answers: evs.filter(r => r.type === "probe_answer").map(r => ({ oppId: String(p(r).oppId ?? ""), memberId: String(p(r).memberId ?? r.actor_id ?? ""), yes: p(r).yes === true, at: ms(r.at)! })),
    opps: (opps as Row[]).map(r => ({ id: r.id, state: r.state, participants: r.participants ?? [], attended: r.attended ?? [], createdAt: ms(r.created_at) ?? 0, ...(r.meeting_at ? { meetingAt: ms(r.meeting_at) } : {}) })),
    members: (members as Row[]).map(r => ({ id: r.id, ...(r.joined_at ? { joinedAt: ms(r.joined_at) } : {}), adult: typeof r.age === "number" && r.age >= 18 })),
    optOuts: evs.filter(r => r.type === "member_opted_out" && inWin(r)).length,
    mutes: evs.filter(r => r.type === "member_muted" && inWin(r)).length,
    complaints: evs.filter(r => r.type === "complaint" && inWin(r)).length,
    reached: (reached as Row[])[0]?.n ?? 0,
    reports: o.reports ?? ((reports ?? []) as Row[]).map(r => ({ kind: r.kind ?? "other", at: Number(r.at) })),
    blooio: { handed: (blooio as Row[])[0]?.handed ?? 0, failed: (blooio as Row[])[0]?.failed ?? 0 },
    worth: evs.filter(r => r.type === "worth_a_text" && inWin(r)).map(r => ({ worth: worthOf(p(r).worth), at: ms(r.at)! })),
    ...(o.cost ? { cost: o.cost } : {}),
  };
}

/**
 * This month's spend of one app (UTC month: LLM rows of the app, plus its Blooio and Workers AI
 * counters at the prices in the environment) and its active members (texted in the last 30 days).
 * Undefined when the login cannot read the cost ledger (only the cross-app console login and the
 * service can, migration 0015).
 */
export async function appMonthCost(sql: SQL, app: string, now: number, env: Record<string, string | undefined> = process.env): Promise<PilotInput["cost"] | undefined> {
  const d = new Date(now), month = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const price = (v: string | undefined) => { const n = Number(v); return v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 ? n : undefined; };
  try {
    const [[llm], daily, [active]] = await Promise.all([
      sql`select coalesce(sum(cost_micro), 0)::bigint as micro from network.llm_usage where app_id = ${app} and at >= ${month} and at <= ${d}`,
      sql`select kind, sum(n)::int as n, sum(cost_micro)::bigint as micro from network.usage_daily where app_id = ${app} and day >= ${month.toISOString().slice(0, 10)}::date group by 1`,
      sql`select count(distinct member_id)::int as n from network.messages where app_id = ${app} and direction = 'inbound' and ts >= ${new Date(now - 30 * DAY)} and ts <= ${d}`,
    ]);
    let usd = Number((llm as Row).micro) / 1e6;
    for (const r of daily as Row[]) {
      const unit = r.kind === "blooio_message" ? price(env.BLOOIO_COST_PER_MESSAGE_USD) : price(env.WORKERS_AI_COST_PER_CALL_USD);
      usd += Number(r.micro) > 0 ? Number(r.micro) / 1e6 : r.n * (unit ?? 0);
    }
    const target = price(env.COST_TARGET_PER_MEMBER_USD);
    return { monthUsd: Math.round(usd * 1e6) / 1e6, activeMembers: (active as Row).n, ...(target !== undefined ? { targetUsd: target } : {}) };
  } catch { return undefined; }
}
