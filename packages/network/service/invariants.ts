// The production invariant checker (PRD 32.20, 34; critical path item 11). The simulator checks these
// rules on every run; this job checks the same rules on the stored rows of every app, so the console's
// "invariant violations" count (sources/real.ts reads invariant_violation events) is a real number.
//
// Rules, over the window (default the last 48 hours; the job runs every 5 minutes, so windows overlap
// and each violation is written once, by its key):
//  - probe_without_approval: a probe or connection message (probe, plan_probe, scheduling, proposal)
//    about an opportunity whose review item is missing or not approved.
//  - minor_in_opportunity: a member treated as under 18 (record age, or the Network's age state:
//    minor, unknown age, a minor signal) in an opportunity with two or more participants.
//  - minor_connection_message: a probe or connection message sent to such a member.
//  - send_after_opt_out: a non-compliance message that went out after the member opted out (and is
//    still opted out).
//  - person_cap: a person sent more proactive messages in 24 hours, across apps, than the cap.
//  - leak_guard: an outbound message that the leak guard (the Network's own rules: other members'
//    private facets and canaries) refuses now. Every send passes the guard first, so a hit means a path
//    skipped it.
// A violation is written as a network.events row (type invariant_violation, payload {rule, detail, key}),
// in the app's own scoped transaction. The detail names ids only, never a message text.
import type { SQL } from "bun";
import { DAY, LeakGuard, HELP_TEXT, STOP_CONFIRMATION } from "@thenetwork/core";
import { CANARY_RE, PUBLIC_PHRASES } from "../src/network.ts";
import { appIds, scopedTo } from "./costs.ts";
import { PERSON_DAILY_CAP } from "./service.ts";

export const INVARIANT_WINDOW = 2 * DAY;
/** Message types that contact a member about a specific opportunity (probe or connection). */
export const CONNECTION_TYPES = ["probe", "plan_probe", "scheduling", "proposal"] as const;
/** Statuses of a send that did not go out (or has not yet): never a violation. */
const NOT_OUT = /^(refused|suppressed|blocked|parked|held|expired|failed_no_address|queued|pending|sending|deferred|retry|dropped)/;

export interface Violation { app: string; rule: string; key: string; memberId?: string; detail: Record<string, unknown> }
export interface InvariantResult { found: Violation[]; written: Violation[] }

type Row = Record<string, any>;
const went = (status: string) => !NOT_OUT.test(status);

/** The members of an app treated as under 18: the record age, or the Network's stored age state. */
async function minorsOf(tx: SQL, app: string): Promise<Set<string>> {
  const rows = await tx`select id from network.members where app_id = ${app} and age is not null and age < 18
    union select m->>'id' as id from network.network_state s, jsonb_array_elements(coalesce(s.state->'members', '[]'::jsonb)) m
      where s.app_id = ${app} and (m->>'minor' = 'true' or m->>'ageUnknown' = 'true' or m->>'minorSignal' = 'true' or m->>'minorReported' = 'true')`;
  return new Set((rows as Row[]).map(r => r.id as string).filter(Boolean));
}

/** Check one app (inside its scoped transaction). Person-cap rows are returned for the cross-app count. */
async function checkApp(tx: SQL, app: string, since: Date): Promise<{ found: Violation[]; proactive: { person: string; ts: number; id: string }[] }> {
  const found: Violation[] = [];
  const add = (rule: string, key: string, detail: Record<string, unknown>, memberId?: string) => found.push({ app, rule, key: `${rule}:${key}`, ...(memberId ? { memberId } : {}), detail });
  const [msgs, reviews, parts, optOuts, facets] = await Promise.all([
    tx`select m.id, m.member_id, m.type, m.opportunity_id, m.status, m.ts, m.proactive, m.system, m.body, mb.person_id, mb.opted_out
       from network.messages m left join network.members mb on mb.app_id = m.app_id and mb.id = m.member_id
       where m.app_id = ${app} and m.direction = 'outbound' and m.ts >= ${since}`,
    tx`select opportunity_id, decision from network.review_items where app_id = ${app}`,
    tx`select p.opportunity_id, p.member_id, o.created_at, o.state, o.source from network.participations p join network.opportunities o on o.app_id = p.app_id and o.id = p.opportunity_id
       where p.app_id = ${app} and p.role = 'participant'`,
    tx`select actor_id, max(at) as at from network.events where app_id = ${app} and type = 'member_opted_out' group by 1`,
    tx`select member_id, value from network.facets where app_id = ${app} and privacy_scope = 'agent_private' and status <> 'rejected'`,
  ]);
  const minors = await minorsOf(tx, app);
  const review = new Map((reviews as Row[]).map(r => [r.opportunity_id as string, r.decision as string | null]));
  const optedAt = new Map((optOuts as Row[]).map(r => [r.actor_id as string, new Date(r.at).getTime()]));

  // Opportunities with two or more participants and a minor in them (created in the window, or still open).
  const byOpp = new Map<string, { members: string[]; created: number; state: string }>();
  for (const p of parts as Row[]) {
    const o = byOpp.get(p.opportunity_id) ?? { members: [] as string[], created: new Date(p.created_at).getTime(), state: p.state };
    o.members.push(p.member_id);
    byOpp.set(p.opportunity_id, o);
  }
  const minorOpps = new Set<string>();
  for (const [id, o] of byOpp) {
    if (o.members.length < 2) continue;
    const young = o.members.filter(m => minors.has(m));
    if (!young.length) continue;
    minorOpps.add(id);
    const open = !["COMPLETED", "CANCELLED", "SKIPPED", "EXPIRED", "DECLINED", "ABANDONED"].includes(o.state);
    if (open || o.created >= since.getTime()) add("minor_in_opportunity", id, { opportunityId: id, members: young, state: o.state }, young[0]);
  }

  // Leak guard: the Network's own construction (network.ts guardCheck), on this app's private facets.
  const priv = (facets as Row[]).filter(f => typeof f.value === "string" && f.value.trim());
  const guard = priv.length ? new LeakGuard({
    forbidden: priv.map(f => ({ text: f.value as string, owner: f.member_id as string })),
    canaries: priv.flatMap(f => [...(f.value as string).matchAll(CANARY_RE)].map(x => x[1]!)),
    allow: [HELP_TEXT, STOP_CONFIRMATION], publicPhrases: PUBLIC_PHRASES,
  } as ConstructorParameters<typeof LeakGuard>[0]) : undefined;

  const proactive: { person: string; ts: number; id: string }[] = [];
  for (const m of msgs as Row[]) {
    if (!went(m.status)) continue;
    const ts = new Date(m.ts).getTime();
    const connection = (CONNECTION_TYPES as readonly string[]).includes(m.type);
    if (connection && m.opportunity_id) {
      const d = review.get(m.opportunity_id);
      if (d !== "approve") add("probe_without_approval", m.id, { messageId: m.id, opportunityId: m.opportunity_id, type: m.type, review: d === undefined ? "missing" : d ?? "open" }, m.member_id);
    }
    if (connection && (minors.has(m.member_id) || (m.opportunity_id && minorOpps.has(m.opportunity_id))))
      add("minor_connection_message", m.id, { messageId: m.id, opportunityId: m.opportunity_id ?? null, type: m.type }, m.member_id);
    const out = optedAt.get(m.member_id);
    if (!m.system && m.opted_out && out !== undefined && ts > out) add("send_after_opt_out", m.id, { messageId: m.id, optedOutAt: new Date(out).toISOString() }, m.member_id);
    if (m.proactive && !m.system && m.person_id) proactive.push({ person: m.person_id, ts, id: m.id });
    if (guard && !m.system) {
      let hits: string[] = [];
      try { hits = guard.check(m.body ?? "", { exceptOwner: m.member_id }); } catch { hits = ["guard_error"]; }
      // Only the kind of each hit ("forbidden", "canary"...), never what matched.
      if (hits.length) add("leak_guard", m.id, { messageId: m.id, reasons: [...new Set(hits.map(h => String(h).split(":")[0]))] }, m.member_id);
    }
  }
  return { found, proactive };
}

/** People over the person cap in any 24-hour span (proactive sends that went out, every app). */
export function personCapViolations(sends: { app: string; person: string; ts: number; id: string }[], cap: number): Violation[] {
  const byPerson = new Map<string, typeof sends>();
  for (const s of sends) { if (!byPerson.has(s.person)) byPerson.set(s.person, []); byPerson.get(s.person)!.push(s); }
  const out: Violation[] = [];
  for (const [person, list] of byPerson) {
    list.sort((a, b) => a.ts - b.ts);
    for (let i = cap; i < list.length; i++) {
      if (list[i]!.ts - list[i - cap]!.ts < DAY) {
        const s = list[i]!;
        out.push({ app: s.app, rule: "person_cap", key: `person_cap:${s.id}`, detail: { messageId: s.id, cap, within: "24h", person } });
      }
    }
  }
  return out;
}

/**
 * Check every app and write the new violations as invariant_violation events. Returns what was found
 * (all, in the window) and what was written now (not seen before).
 */
export async function runInvariants(sql: SQL, o: { now: number; since?: number; apps?: string[]; cap?: number; write?: boolean }): Promise<InvariantResult> {
  const since = new Date(o.since ?? o.now - INVARIANT_WINDOW);
  const apps = o.apps ?? await appIds(sql);
  const found: Violation[] = [];
  const sends: { app: string; person: string; ts: number; id: string }[] = [];
  for (const app of apps) {
    const r = await scopedTo(sql, app, tx => checkApp(tx, app, since));
    found.push(...r.found);
    sends.push(...r.proactive.map(s => ({ ...s, app })));
  }
  // The person in the detail is a platform id; it stays inside the event of the app that sent.
  found.push(...personCapViolations(sends, o.cap ?? PERSON_DAILY_CAP));
  const written: Violation[] = [];
  if (o.write === false) return { found, written };
  const byApp = new Map<string, Violation[]>();
  for (const v of found) { if (!byApp.has(v.app)) byApp.set(v.app, []); byApp.get(v.app)!.push(v); }
  for (const [app, list] of byApp) await scopedTo(sql, app, async tx => {
    const keys = list.map(v => v.key);
    const seen = new Set(((await tx`select payload->>'key' as key from network.events where app_id = ${app} and type = 'invariant_violation'
      and payload->>'key' in ${tx(keys)}`) as Row[]).map(r => r.key as string));
    const fresh = list.filter(v => !seen.has(v.key));
    if (!fresh.length) return;
    const at = new Date(o.now);
    const rows = fresh.map(v => ({
      app_id: app, at, actor_type: "agent", actor_id: v.memberId ?? null, type: "invariant_violation", object_type: v.detail.opportunityId ? "opportunity" : v.memberId ? "member" : null,
      object_id: (v.detail.opportunityId as string | undefined) ?? v.memberId ?? null, payload: { rule: v.rule, key: v.key, detail: v.detail, source: "invariants" },
    }));
    for (let i = 0; i < rows.length; i += 500) await tx`insert into network.events ${tx(rows.slice(i, i + 500))}`;
    written.push(...fresh);
  });
  return { found, written };
}

/** The violations written in the last `windowMs` (default 24 h), per rule, for the monitor. */
export async function recentViolations(sql: SQL, now: number, windowMs = DAY, apps?: string[]): Promise<{ app: string; rule: string; n: number }[]> {
  const out: { app: string; rule: string; n: number }[] = [];
  for (const app of apps ?? await appIds(sql)) {
    const rows = await scopedTo(sql, app, tx => tx`select payload->>'rule' as rule, count(*)::int as n from network.events
      where app_id = ${app} and type = 'invariant_violation' and at >= ${new Date(now - windowMs)} group by 1`);
    for (const r of rows as Row[]) out.push({ app, rule: r.rule ?? "unknown", n: r.n });
  }
  return out;
}
