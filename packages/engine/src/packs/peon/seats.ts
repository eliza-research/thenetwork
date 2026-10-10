// Job seats from job postings (the seat model of schema.ts, for the service's peon network).
//
// In the service a hiring manager is one member, and each job they post is one intent of theirs
// (category professional, details "peon:job ...") with the posting's own facets tagged
// `peon:posting:<intent id>`. peonPack matches job SEATS, one member record per open job, so:
//
//   peonSeats(snapshot)          (packages/network/service/snapshot.ts, app peon)
//     each posting becomes a seat member `job:<intent id>`, with the posting's facets, its intent,
//     the company facts of the hiring manager (company, verified, safety cues), the manager's
//     presence, and the manager's blocks (a candidate who blocked the manager never sees their
//     jobs). The seat holds `peon:openings:<n>`, the posted headcount (1 when none is stated; 0
//     when the posting is not active). A posting whose manager is not a confirmed adult gets no
//     seat (minors are never matched, and a job seat is 18+). The posting rows leave the manager.
//
//   peonSeatCapacity(input)      (packages/network/service/packs.ts, the peon engineInput hook)
//     the seat's capacity left: posted openings minus the candidates who already took one (an
//     intro both sides accepted, or a hire) and minus intros still in flight. A seat with nothing
//     left reads `peon:openings:0` (the job_closed member rule: no new matches). `peon:seat_cap:<n>`
//     caps the seat's slate in one engine run at the openings left (selection.ts slateCap), so a
//     seat is never over-filled: one member per opening.
//
// The simulated hiring world (packages/sim/src/apps/peon) writes seats directly and never uses
// these functions, so the pinned peon gates do not move. Pure; reads no hidden truth.
import type { Edge, Facet, Intent, Member, MemberId, Presence } from "@thenetwork/core";
import type { EngineInput } from "../../types.ts";
import { JOB_INTENT, SAFETY, T } from "./schema.ts";

/** The seat member id of a posting (the posting's intent id). */
export const SEAT_PREFIX = "job:";
export const seatIdOf = (postingId: string): MemberId => `${SEAT_PREFIX}${postingId}`;
export const isSeatId = (id: MemberId): boolean => id.startsWith(SEAT_PREFIX);
/** The posting id of a seat member id. */
export const postingIdOf = (seat: MemberId): string => seat.slice(SEAT_PREFIX.length);

/**
 * The hiring manager who owns a seat (the service routes the seat's probe and intro to them,
 * packages/network/src/jobs.ts). peonSeats stamps it on the seat member record; the engine never reads it.
 */
export function seatOwnerOf(m: Member): MemberId | undefined {
  return isSeatId(m.id) ? (m as Member & { seatOwner?: MemberId }).seatOwner : undefined;
}

/** Company facts of the hiring manager that every one of their seats carries. */
const companyFact = (t: string) => t.startsWith(T.company) || t === T.verified || t === SAFETY.scam || t === SAFETY.discriminatoryRequest;
const isPosting = (i: Intent) => i.category === "professional" && (i.details ?? "").startsWith(JOB_INTENT);

interface SnapshotLike { members: Member[]; facets: Facet[]; intents: Intent[]; presence: Presence[]; edges: Edge[] }

/** Postings -> job seats (see the header). Members, facets and intents that are not postings pass through unchanged. */
export function peonSeats<S extends SnapshotLike>(snap: S): S {
  const byId = new Map(snap.members.map(m => [m.id, m]));
  const postings = snap.intents.filter(i => isPosting(i) && byId.has(i.memberId) && !isSeatId(i.memberId));
  if (!postings.length) return snap;
  const postingIds = new Set(postings.map(p => p.id));
  const postingOf = (f: Facet) => f.tags.find(t => t.startsWith(T.posting))?.slice(T.posting.length);
  const members: Member[] = [...snap.members];
  // The posting rows leave the manager (who may also be a candidate elsewhere); seats get them below.
  const facets: Facet[] = snap.facets.filter(f => { const p = postingOf(f); return !p || !postingIds.has(p); });
  const intents: Intent[] = snap.intents.filter(i => !postingIds.has(i.id));
  const presence: Presence[] = [...snap.presence];
  const edges: Edge[] = [...snap.edges];
  for (const p of [...postings].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const owner = byId.get(p.memberId)!;
    // A job seat is 18+: only a manager with a valid adult age on the record gets one (unknown is not adult).
    if (typeof owner.age !== "number" || !Number.isInteger(owner.age) || owner.age < 18) continue;
    const id = seatIdOf(p.id);
    if (byId.has(id)) continue;
    members.push({ ...owner, id, age: 18, joinedAt: p.createdAt, seatOwner: owner.id } as Member);
    let posted: number | undefined;
    for (const f of snap.facets) {
      if (f.memberId !== owner.id) continue;
      if (postingOf(f) === p.id) {
        const tags = f.tags.filter(t => { if (!t.startsWith(T.openings)) return true; const n = Number(t.slice(T.openings.length)); if (Number.isInteger(n) && n >= 0) posted = Math.max(posted ?? 0, n); return false; });
        facets.push({ ...f, id: `${f.id}@${id}`, memberId: id, tags });
      } else if (!postingOf(f) && f.tags.some(companyFact)) {
        facets.push({ ...f, id: `${f.id}@${id}`, memberId: id, tags: f.tags.filter(companyFact) });
      }
    }
    const openings = p.status === "active" ? posted ?? 1 : 0;
    facets.push(
      { id: `${id}:entity`, memberId: id, kind: "fact", value: "Hiring role", tags: [`${T.entity}job`], scope: "matchable", provenance: "said", confidence: 1, validFrom: p.createdAt },
      { id: `${id}:openings`, memberId: id, kind: "fact", value: `Openings: ${openings}`, tags: [`${T.openings}${openings}`], scope: "matchable", provenance: "said", confidence: 1, validFrom: p.createdAt },
    );
    intents.push({ ...p, memberId: id });
    for (const x of snap.presence) if (x.memberId === owner.id) presence.push({ ...x, memberId: id, areas: [...x.areas] });
    for (const e of snap.edges) {
      if (e.type !== "blocked" && e.type !== "avoid") continue;
      if (e.from === owner.id) edges.push({ ...e, from: id });
      if (e.to === owner.id) edges.push({ ...e, to: id });
    }
  }
  return { ...snap, members, facets, intents, presence, edges };
}

/**
 * Who holds or is about to hold an opening of each seat: candidates in an intro both sides accepted,
 * a hire, or an intro still in flight (pending, or open in the Network). Declined, expired, cancelled
 * and no-show intros free the opening again.
 */
export function seatFills(input: Pick<EngineInput, "interactions" | "openOpportunities">): Map<MemberId, Set<MemberId>> {
  const out = new Map<MemberId, Set<MemberId>>();
  const add = (participants: readonly MemberId[]) => {
    const seat = participants.find(isSeatId);
    if (!seat) return;
    if (!out.has(seat)) out.set(seat, new Set());
    for (const id of participants) if (id !== seat) out.get(seat)!.add(id);
  };
  for (const r of input.interactions ?? []) if (r.outcome === "accepted" || r.outcome === "completed" || r.outcome === "pending") add(r.participants);
  for (const o of input.openOpportunities ?? []) add(o.participants);
  return out;
}

/** The capacity each seat has left (see the header). Inputs without seats pass through unchanged. */
export function peonSeatCapacity(input: EngineInput): EngineInput {
  if (!input.members.some(m => isSeatId(m.id))) return input;
  const fills = seatFills(input);
  const facets = input.facets.map(f => {
    if (!isSeatId(f.memberId) || f.id !== `${f.memberId}:openings`) return f;
    const posted = Number(f.tags.find(t => t.startsWith(T.openings))?.slice(T.openings.length) ?? 0);
    const left = Math.max(0, posted - (fills.get(f.memberId)?.size ?? 0));
    return { ...f, value: `Openings: ${left} of ${posted}`, tags: [`${T.openings}${left}`, `${T.seatCap}${left}`] };
  });
  return { ...input, facets };
}
