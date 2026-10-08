// Gaming detection (design 2.3: anomaly detection on the graph, reviewer spot checks, clawback).
// Pure: reads ledger entries, returns flags for human review. A flag never changes NC by itself;
// only a reviewer's `fraud_confirmed` event claws credit back.
//
// - reciprocal_ring: a member whose confirmed credits mostly come from a small set of members
//   they confirm back (directly, or through one other member: A->B->C->A). Help farming and
//   vouch rings both look like this. Only member-controlled credits count (help, needs,
//   member-started plans, vouches): engine- and organizer-made matches are mutual by design.
//   A larger ring (8-12 members, each confirming a few others) is out of reach of two hops: it is
//   found as a strongly connected set of repeat confirmations (two or more confirmations per edge).
// - staged_meetup: the same pair of people attends plans they chose (member-started, or
//   organizer-started with no check-in) again and again, with attendance verified only by each
//   other (no check-in, organizer or reviewer). Counted per pair, so rotating "fillers" do not
//   hide the recurring core (capital-8); pairs that share members are reported as one set.
// - vouch_ring: a vouch credit whose invitee's value came only from members with a two-way
//   confirmation tie to the voucher; or one provider who confirmed the value of two or more of the
//   same voucher's invitees (sybil vouching with one accomplice, capital-1).
import { DAY } from "../../core/src/clock.ts";
import { DEFAULT_CAPITAL, type CapitalConfig } from "./config.ts";
import type { GamingFlag, LedgerEntry, MemberId } from "./types.ts";
import { memberControlled } from "./ledger.ts";

export function detectGaming(entries: readonly LedgerEntry[], now: number, cfg: CapitalConfig = DEFAULT_CAPITAL): GamingFlag[] {
  const d = cfg.detection;
  const recent = entries.filter(e => e.sign === 1 && e.base > 0 && e.t <= now && now - e.t < d.windowDays * DAY);
  const flags = new Map<string, GamingFlag>();
  const add = (f: GamingFlag) => {
    const key = `${f.kind}|${[...f.members].sort().join(",")}`;
    if (!flags.has(key)) flags.set(key, { ...f, members: [...new Set(f.members)].sort() });
  };

  // Confirmation graph: confirmer -> member whose credit they confirmed (count).
  const confirms = new Map<MemberId, Map<MemberId, number>>();
  const byMember = new Map<MemberId, LedgerEntry[]>();
  // Only member-controlled credits and vouches: an engine-made intro confirms both sides by design.
  for (const e of recent) {
    if (!memberControlled(e) && e.category !== "vouch") continue;
    if (!byMember.has(e.member)) byMember.set(e.member, []);
    byMember.get(e.member)!.push(e);
    for (const c of e.provenance.confirmedBy) {
      if (c === e.member) continue;
      const m = confirms.get(c) ?? new Map<MemberId, number>();
      m.set(e.member, (m.get(e.member) ?? 0) + 1);
      confirms.set(c, m);
    }
  }
  const confirmsOf = (a: MemberId) => confirms.get(a) ?? new Map<MemberId, number>();
  /** Members `m` confirms directly or via one intermediary. */
  const reach2 = (m: MemberId) => {
    const r = new Set<MemberId>();
    for (const x of confirmsOf(m).keys()) { r.add(x); for (const y of confirmsOf(x).keys()) r.add(y); }
    r.delete(m);
    return r;
  };
  const mutual = (a: MemberId, b: MemberId) => (confirmsOf(a).get(b) ?? 0) > 0 && (confirmsOf(b).get(a) ?? 0) > 0;
  const confirmedOf = (m: MemberId) => (byMember.get(m) ?? []).filter(e => e.provenance.confirmedBy.some(c => c !== m));

  // reciprocal_ring
  for (const m of byMember.keys()) {
    const confirmed = confirmedOf(m);
    if (confirmed.length < d.ringMinCredits) continue;
    const back = reach2(m);
    const recipConfirmers = new Set<MemberId>();
    let recip = 0;
    for (const e of confirmed) {
      const rc = e.provenance.confirmedBy.filter(c => back.has(c));
      if (rc.length) { recip++; rc.forEach(c => recipConfirmers.add(c)); }
    }
    const share = recip / confirmed.length;
    // A two-person "ring" whose credits are mostly plans together is the staged_meetup pattern; it is
    // judged there (stagedRepeat), so honest close friends are not flagged twice. A pair still
    // counts here on its other credits (help, needs).
    const evidence = recipConfirmers.size === 1 ? confirmed.filter(e => e.category !== "attendance").length : confirmed.length;
    if (share >= d.ringShare && recipConfirmers.size <= d.ringMaxSize && evidence >= d.ringMinCredits) {
      add({ kind: "reciprocal_ring", members: [m, ...recipConfirmers], t: now, evidence: { confirmedCredits: confirmed.length, reciprocalShare: round(share), ringSize: recipConfirmers.size + 1 } });
    }
  }

  // reciprocal_ring, large: strongly connected sets of repeat confirmations (capital-11).
  const repeat = new Map<MemberId, MemberId[]>();
  for (const [c, m] of confirms) repeat.set(c, [...m].filter(([, k]) => k >= 2).map(([x]) => x));
  for (const scc of stronglyConnected(repeat)) {
    if (scc.length < 3 || scc.length > d.ringMaxMembers) continue;
    const inside = new Set(scc);
    const farming = scc.filter(m => {
      const confirmed = confirmedOf(m);
      const fromInside = confirmed.filter(e => e.provenance.confirmedBy.some(c => inside.has(c))).length;
      return confirmed.length >= d.ringMinCredits && fromInside / confirmed.length >= d.ringShare;
    });
    if (farming.length * 2 >= scc.length) add({ kind: "reciprocal_ring", members: scc, t: now, evidence: { ringSize: scc.length, farming: farming.length } });
  }

  // staged_meetup, per pair
  const pairs = new Map<string, { a: MemberId; b: MemberId; plans: Set<string> }>();
  for (const e of recent) {
    if (e.category !== "attendance" || e.provenance.eventType !== "plan_attended") continue;
    const v = e.provenance.verification ?? [];
    if (e.provenance.origin === "engine" || !v.length || v.some(x => x !== "counterpart")) continue;
    for (const cp of e.provenance.counterparts) {
      const [a, b] = [e.member, cp].sort() as [MemberId, MemberId];
      const k = `${a}|${b}`;
      const p = pairs.get(k) ?? { a, b, plans: new Set<string>() };
      p.plans.add(e.provenance.planId ?? e.provenance.eventId);
      pairs.set(k, p);
    }
  }
  const staged = [...pairs.values()].filter(p => p.plans.size >= d.stagedRepeat);
  // Pairs that share a member are one staged set (a trio staging together is one flag).
  const group = new Map<MemberId, MemberId>();
  const root = (x: MemberId): MemberId => { let r = x; while (group.get(r) !== r) r = group.get(r)!; return r; };
  for (const p of staged) for (const x of [p.a, p.b]) if (!group.has(x)) group.set(x, x);
  for (const p of staged) group.set(root(p.a), root(p.b));
  const sets = new Map<MemberId, { members: Set<MemberId>; plans: Set<string> }>();
  for (const p of staged) {
    const s = sets.get(root(p.a)) ?? { members: new Set<MemberId>(), plans: new Set<string>() };
    s.members.add(p.a); s.members.add(p.b); p.plans.forEach(x => s.plans.add(x));
    sets.set(root(p.a), s);
  }
  for (const s of sets.values()) add({ kind: "staged_meetup", members: [...s.members], t: now, evidence: { plans: s.plans.size } });

  // vouch_ring
  const byProvider = new Map<string, { voucher: MemberId; provider: MemberId; invitees: Set<MemberId> }>();
  for (const e of recent) {
    if (e.category !== "vouch") continue;
    const providers = e.provenance.confirmedBy;
    if (providers.length && providers.every(p => mutual(p, e.member))) {
      add({ kind: "vouch_ring", members: [e.member, ...e.provenance.counterparts, ...providers], t: now, evidence: { providers: providers.length } });
    }
    for (const p of providers) {
      const k = `${e.member}|${p}`;
      const x = byProvider.get(k) ?? { voucher: e.member, provider: p, invitees: new Set<MemberId>() };
      e.provenance.counterparts.forEach(i => x.invitees.add(i));
      byProvider.set(k, x);
    }
  }
  for (const x of byProvider.values()) {
    if (x.invitees.size >= 2) add({ kind: "vouch_ring", members: [x.voucher, x.provider, ...x.invitees], t: now, evidence: { sharedProviderInvitees: x.invitees.size } });
  }
  return [...flags.values()];
}

const round = (x: number) => Math.round(x * 100) / 100;

/** Strongly connected components of a directed graph (iterative Tarjan). */
function stronglyConnected(g: Map<MemberId, MemberId[]>): MemberId[][] {
  const index = new Map<MemberId, number>(), low = new Map<MemberId, number>(), on = new Set<MemberId>();
  const stack: MemberId[] = [], out: MemberId[][] = [];
  let n = 0;
  for (const start of g.keys()) {
    if (index.has(start)) continue;
    const work: { v: MemberId; i: number }[] = [{ v: start, i: 0 }];
    index.set(start, n); low.set(start, n); n++; stack.push(start); on.add(start);
    while (work.length) {
      const top = work[work.length - 1]!;
      const next = g.get(top.v) ?? [];
      if (top.i < next.length) {
        const w = next[top.i++]!;
        if (!index.has(w)) {
          index.set(w, n); low.set(w, n); n++; stack.push(w); on.add(w);
          work.push({ v: w, i: 0 });
        } else if (on.has(w)) low.set(top.v, Math.min(low.get(top.v)!, index.get(w)!));
        continue;
      }
      work.pop();
      if (work.length) { const p = work[work.length - 1]!.v; low.set(p, Math.min(low.get(p)!, low.get(top.v)!)); }
      if (low.get(top.v) === index.get(top.v)) {
        const comp: MemberId[] = [];
        let w: MemberId;
        do { w = stack.pop()!; on.delete(w); comp.push(w); } while (w !== top.v);
        out.push(comp);
      }
    }
  }
  return out;
}
