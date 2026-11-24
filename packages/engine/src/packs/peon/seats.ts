import { canBeMatched, type Edge, type Facet, type Intent, type Member, type MemberId, type Presence } from "@thenetwork/core";
import { initial, normalJobSeatUsesOpenBudget, remainingOpenings, seatRecordOccupies, step, type SeatLedger } from "../../../../core/src/generated/peonCapacity.ts";
import type { EngineInput } from "../../types.ts";
import { JOB_INTENT, SAFETY, T } from "./schema.ts";

export const SEAT_PREFIX = "job:";
export const seatIdOf = (postingId: string): MemberId => `${SEAT_PREFIX}${postingId}`;
export const isSeatId = (id: MemberId): boolean => id.startsWith(SEAT_PREFIX);
export const postingIdOf = (seat: MemberId): string => seat.slice(SEAT_PREFIX.length);

export function seatOwnerOf(m: Member): MemberId | undefined {
  return isSeatId(m.id) ? (m as Member & { seatOwner?: MemberId }).seatOwner : undefined;
}

const companyFact = (t: string) => t.startsWith(T.company) || t === T.verified || t === SAFETY.scam || t === SAFETY.discriminatoryRequest;
const isPosting = (i: Intent) => i.category === "professional" && (i.details ?? "").startsWith(JOB_INTENT);

interface SnapshotLike { members: Member[]; facets: Facet[]; intents: Intent[]; presence: Presence[]; edges: Edge[] }

export function peonSeats<S extends SnapshotLike>(snap: S): S {
  const byId = new Map(snap.members.map(m => [m.id, m]));
  const postings = snap.intents.filter(i => isPosting(i) && byId.has(i.memberId) && !isSeatId(i.memberId));
  if (!postings.length) return snap;
  const postingIds = new Set(postings.map(p => p.id));
  const postingOf = (f: Facet) => f.tags.find(t => t.startsWith(T.posting))?.slice(T.posting.length);
  const members: Member[] = [...snap.members];
  const facets: Facet[] = snap.facets.filter(f => { const p = postingOf(f); return !p || !postingIds.has(p); });
  const intents: Intent[] = snap.intents.filter(i => !postingIds.has(i.id));
  const presence: Presence[] = [...snap.presence];
  const edges: Edge[] = [...snap.edges];
  for (const p of [...postings].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const owner = byId.get(p.memberId)!;
    if (!canBeMatched(owner.age) || !Number.isInteger(owner.age)) continue;
    const id = seatIdOf(p.id);
    if (byId.has(id)) continue;
    members.push({
      ...owner, id, state: normalJobSeatUsesOpenBudget(owner.state) ? "open" : owner.state,
      age: 18, joinedAt: p.createdAt, seatOwner: owner.id,
    } as Member);
    edges.push({ from: owner.id, to: id, type: "avoid", strength: 1, explicit: false, createdAt: p.createdAt });
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

export function seatFills(input: Pick<EngineInput, "interactions" | "openOpportunities">): Map<MemberId, Set<MemberId>> {
  const ledgers = new Map<MemberId, SeatLedger>();
  const observe = (participants: readonly MemberId[]) => {
    const seat = participants.find(isSeatId);
    if (!seat) return;
    let ledger = ledgers.get(seat) ?? initial;
    for (const candidate of participants) if (candidate !== seat) {
      ledger = step(ledger, { type: "observeCandidate", candidate, occupies: true });
    }
    ledgers.set(seat, ledger);
  };
  for (const r of input.interactions ?? []) if (seatRecordOccupies(false, r.outcome)) observe(r.participants);
  for (const o of input.openOpportunities ?? []) if (seatRecordOccupies(true, "")) observe(o.participants);
  return new Map([...ledgers].map(([seat, ledger]) => [seat, new Set(step(ledger, { type: "publishLedger" }).occupied)]));
}

export function peonSeatCapacity(input: EngineInput): EngineInput {
  if (!input.members.some(m => isSeatId(m.id))) return input;
  const fills = seatFills(input);
  const facets = input.facets.map(f => {
    if (!isSeatId(f.memberId) || f.id !== `${f.memberId}:openings`) return f;
    const posted = Number(f.tags.find(t => t.startsWith(T.openings))?.slice(T.openings.length) ?? 0);
    const left = remainingOpenings(posted, fills.get(f.memberId)?.size ?? 0);
    return { ...f, value: `Openings: ${left} of ${posted}`, tags: [`${T.openings}${left}`, `${T.seatCap}${left}`] };
  });
  return { ...input, facets };
}
