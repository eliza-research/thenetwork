// Gaming detection (design 2.3: anomaly detection on the graph, reviewer spot checks, clawback).
// Pure: reads ledger entries, returns flags for human review. A flag never changes NC by itself;
// only a reviewer's `fraud_confirmed` event claws credit back.
//
// - reciprocal_ring: a member whose confirmed credits mostly come from a small set of members
//   they confirm back (directly, or through one other member: A->B->C->A). Help farming and
//   vouch rings both look like this. Only member-controlled credits count (help, needs,
//   member-started plans, vouches): engine- and organizer-made matches are mutual by design.
// - staged_meetup: the same set of people attends member-started plans again and again, with
//   attendance verified only by each other (no check-in, organizer or reviewer).
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

  // reciprocal_ring
  for (const [m, es] of byMember) {
    const confirmed = es.filter(e => e.provenance.confirmedBy.some(c => c !== m));
    if (confirmed.length < d.ringMinCredits) continue;
    const back = reach2(m);
    const recipConfirmers = new Set<MemberId>();
    let recip = 0;
    for (const e of confirmed) {
      const rc = e.provenance.confirmedBy.filter(c => back.has(c));
      if (rc.length) { recip++; rc.forEach(c => recipConfirmers.add(c)); }
    }
    const share = recip / confirmed.length;
    if (share >= d.ringShare && recipConfirmers.size <= d.ringMaxSize) {
      add({ kind: "reciprocal_ring", members: [m, ...recipConfirmers], t: now, evidence: { confirmedCredits: confirmed.length, reciprocalShare: round(share), ringSize: recipConfirmers.size + 1 } });
    }
  }

  // staged_meetup
  const sets = new Map<string, { members: MemberId[]; plans: Set<string> }>();
  for (const e of recent) {
    if (e.category !== "attendance" || e.provenance.eventType !== "plan_attended") continue;
    if (e.provenance.origin !== "member") continue;
    const v = e.provenance.verification ?? [];
    if (!v.length || v.some(x => x !== "counterpart")) continue;
    const members = [e.member, ...e.provenance.counterparts].sort();
    const key = members.join(",");
    const s = sets.get(key) ?? { members, plans: new Set<string>() };
    s.plans.add(e.provenance.planId ?? e.provenance.eventId);
    sets.set(key, s);
  }
  for (const s of sets.values()) {
    if (s.plans.size >= d.stagedRepeat) add({ kind: "staged_meetup", members: s.members, t: now, evidence: { plans: s.plans.size } });
  }

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
