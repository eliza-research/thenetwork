import type { AppId, MemberId } from "@thenetwork/core";
import { standingCeiling, type LaneSide, type MatchLane } from "../../../core/src/generated/matchLane.ts";
import { observeStanding } from "../../../core/src/generated/memberStanding.ts";
import { sha256 } from "../hash.ts";
import type { MemberStandingRow } from "../types.ts";
import type { World } from "../world.ts";

type StandingMembership = Pick<MemberStandingRow, "memberId" | "lane" | "side">;

/** One position per member, lane and side, including a synthetic job seat's own member id. */
export function standingKey({ memberId, lane, side }: StandingMembership): string {
  return JSON.stringify([memberId, lane, side]);
}

/** A scoped, opaque source identity suitable for storage and for removal of a profile fact. */
export function standingEvidenceKey(app: AppId, memberId: MemberId, lane: MatchLane, side: LaneSide, sourceId: string): string {
  return sha256(JSON.stringify(["member-standing-evidence", app, memberId, lane, side, sourceId]));
}

function previousObservations(rows: readonly MemberStandingRow[]): Map<string, MemberStandingRow> {
  const prior = new Map<string, MemberStandingRow>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (!Number.isSafeInteger(row.value) || row.value < 0 || row.value > standingCeiling
      || !Number.isSafeInteger(row.observedAt) || row.observedAt < 0 || !Array.isArray(row.evidenceIds)) continue;
    const key = standingKey(row);
    if (prior.has(key)) duplicates.add(key);
    prior.set(key, row);
  }
  for (const key of duplicates) prior.delete(key);
  return prior;
}

/** Observe each eligible membership once after profiles have been put in canonical order. */
export function standingObservations(w: World, updates?: MemberStandingRow[]) {
  if (w.input.memberStanding === undefined) return (_: StandingMembership, target: number) => target;
  const prior = previousObservations(w.input.memberStanding);
  const observedHere = new Map<string, number>();
  const now = Number.isSafeInteger(w.now) ? w.now : -1;

  return (member: StandingMembership, target: number, sourceIds: readonly string[] = []): number => {
    const key = standingKey(member);
    const done = observedHere.get(key);
    if (done !== undefined) return done;
    const { memberId, lane, side } = member;
    const sources = new Set(sourceIds.map(id => standingEvidenceKey(w.pack.id, memberId, lane, side, id)));
    const previous = prior.get(key);
    const authorized = previous?.evidenceIds.every(id => sources.has(id)) ? previous : undefined;
    const { standing: value, updatedAt: observedAt } = observeStanding(authorized?.value ?? target, authorized?.observedAt ?? now, target, now, authorized !== undefined);
    observedHere.set(key, value);
    if (observedAt >= 0 && (!authorized || value !== authorized.value || observedAt !== authorized.observedAt)) {
      updates?.push({ memberId, lane, side, value, observedAt, evidenceIds: [...sources].sort() });
    }
    return value;
  };
}
