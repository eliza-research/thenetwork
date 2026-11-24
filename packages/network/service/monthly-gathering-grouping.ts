import { createHash, randomUUID } from "node:crypto";
import { monthlyGatheringStaffAllowed } from "../../core/src/generated/monthlyGathering.ts";
import { gatheringGroupingApprovalCurrent, gatheringGroupingCanSeat, gatheringGroupingReviewAllowed, gatheringGroupingSizeAllowed } from "../../core/src/generated/monthlyGatheringGrouping.ts";
import { gatheringRsvpRosterAllowed } from "../../core/src/generated/monthlyGatheringRsvp.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { allowed, rolesFor } from "../../../apps/observatory/src/staff.ts";
import type { StaffUser } from "../../../apps/observatory/src/types.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import { readCappedText } from "../../platform/src/body.ts";
import { gatheringRsvpRoster, type GatheringRsvpKey } from "./monthly-gathering-rsvp.ts";

export interface GatheringGroupingEvidence {
  members: readonly string[];
  pairs: readonly { first: string; second: string; value: number }[];
}
type ReadEvidence = (members: readonly string[], now: number) => GatheringGroupingEvidence;
interface GroupingContext {
  app: AppInfo;
  city: string;
  staff: StaffUser;
  now: () => number;
  scoped: <T>(run: (tx: SQL) => Promise<T>) => Promise<T>;
  accountsFor: (tx: SQL) => Pick<Accounts, "activeMembership" | "lowestAge">;
  withGroupingEvidence: <T>(run: (read: ReadEvidence) => Promise<T>) => Promise<T>;
}
interface Gathering {
  status: string;
  revision: number;
  reviewed_at: Date | null;
  starts_at: Date;
  ends_at: Date;
}
interface GroupingReview {
  review_id: string;
  fingerprint: string;
  group_count: number;
  member_count: number;
  reviewed_at: Date;
}

const PATH = /^\/gatherings\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/grouping(?:\/(review))?$/;
const FINGERPRINT = /^[0-9a-f]{64}$/;
const compareIds = (first: string, second: string) => first < second ? -1 : first === second ? 0 : 1;
const revisionAllowed = (revision: unknown): revision is number => typeof revision === "number" && Number.isInteger(revision) && revision > 0 && revision <= 2_147_483_647;

/** Find compatible triples first so adding a fourth or fifth member cannot crowd out a new group. */
function suggestGroups(roster: readonly string[], evidence: GatheringGroupingEvidence): string[][] {
  const admitted = new Set(evidence.members);
  const members = roster.filter(id => admitted.has(id)).sort(compareIds);
  const weights = new Map(members.map(id => [id, new Map<string, number>()]));
  for (const { first, second, value } of evidence.pairs) {
    if (first === second || !weights.has(first) || !weights.has(second) || !Number.isFinite(value) || value < 0) continue;
    weights.get(first)!.set(second, value);
    weights.get(second)!.set(first, value);
  }
  const unseated = new Set(members);
  const groups: string[][] = [];
  const seeds = [...members].sort((first, second) => weights.get(first)!.size - weights.get(second)!.size || compareIds(first, second));
  for (const seed of seeds) {
    if (!unseated.has(seed)) continue;
    const edges = weights.get(seed)!;
    const peers = members.filter(id => gatheringGroupingCanSeat(weights.has(id), edges.has(id), !unseated.has(id), 1));
    let best: { group: string[]; lowest: number; total: number } | undefined;
    for (let i = 0; i < peers.length; i++) for (let j = i + 1; j < peers.length; j++) {
      const first = peers[i]!, second = peers[j]!;
      const together = weights.get(first)!.get(second);
      if (!gatheringGroupingCanSeat(weights.has(second), together !== undefined, !unseated.has(second), 2) || together === undefined) continue;
      const seedFirst = edges.get(first)!, seedSecond = edges.get(second)!;
      const lowest = Math.min(seedFirst, seedSecond, together);
      const total = seedFirst + seedSecond + together;
      if (!best || lowest > best.lowest || (lowest === best.lowest && total > best.total)) {
        best = { group: [seed, first, second], lowest, total };
      }
    }
    if (!best) continue;
    groups.push(best.group);
    for (const id of best.group) unseated.delete(id);
  }
  for (const id of unseated) {
    const edges = weights.get(id)!;
    let best: string[] | undefined;
    let bestValue = -1;
    for (const group of groups) {
      if (!gatheringGroupingCanSeat(weights.has(id), group.every(peer => edges.has(peer)), !unseated.has(id), group.length)) continue;
      const value = Math.min(...group.map(peer => edges.get(peer)!));
      if (!best || group.length < best.length || (group.length === best.length && value > bestValue)) {
        best = group;
        bestValue = value;
      }
    }
    if (best) {
      best.push(id);
      unseated.delete(id);
    }
  }
  return groups.filter(group => gatheringGroupingSizeAllowed(group.length)).map(group => group.sort(compareIds))
    .sort((first, second) => compareIds(first[0]!, second[0]!));
}

function response(body: object, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
const failure = (error: string, status: number) => response({ ok: false, error }, status);

function openGathering(event: Gathering, key: GatheringRsvpKey, now: number): boolean {
  return gatheringRsvpRosterAllowed(event.status === "approved", event.revision === key.revision,
    event.reviewed_at?.getTime() ?? 0, event.ends_at.getTime(), now);
}

function receipt(key: GatheringRsvpKey, review: GroupingReview, replayed: boolean) {
  return response({ ok: true, review: { ...key, reviewId: review.review_id, fingerprint: review.fingerprint,
    groupCount: review.group_count, memberCount: review.member_count, reviewedAt: review.reviewed_at.getTime() }, replayed });
}

async function auditGrouping(tx: SQL, ctx: GroupingContext, key: GatheringRsvpKey, action: "read_monthly_gathering_grouping" | "approve_monthly_gathering_grouping",
  groupCount: number, memberCount: number, now: number) {
  const roles = [...rolesFor(ctx.staff, ctx.app.id, "real")];
  await tx`insert into network.staff_audit (at,actor,roles,action,target_type,target_id,mode,ok,detail,app_id)
    values (${new Date(now)},${ctx.staff.id},${tx.array(roles,"TEXT")},${action},'case',${key.id},'real',true,
      ${{ revision: key.revision, groupCount, memberCount }}::jsonb,${ctx.app.id})`;
}

async function reviewGrouping(tx: SQL, ctx: GroupingContext, key: GatheringRsvpKey, readEvidence: ReadEvidence, submitted?: string): Promise<Response> {
  const app = ctx.app.id;
  const [event] = await tx<Gathering[]>`select status,revision,reviewed_at,starts_at,ends_at
    from network.monthly_gatherings where app_id=${app} and city=${ctx.city} and id=${key.id} for update`;
  if (!event || !openGathering(event, key, ctx.now())) return failure("not_found", 404);
  const roster = await gatheringRsvpRoster(tx, ctx.accountsFor(tx), ctx.app, key, ctx.now(), submitted !== undefined);
  if (!roster) return failure("not_found", 404);
  const willing = roster.filter(member => member.grouping).map(member => member.memberId);
  const groups = suggestGroups(willing, readEvidence(willing, ctx.now()));
  const memberCount = groups.reduce((sum, group) => sum + group.length, 0);
  const fingerprint = createHash("sha256").update(JSON.stringify(["monthly-gathering-grouping", app, ctx.city, key.id, key.revision, groups])).digest("hex");
  const [approved] = await tx<(GroupingReview & { stored_count: number })[]>`select review.*,
    (select count(*)::int from network.monthly_gathering_group_members member
      where member.app_id=review.app_id and member.gathering_id=review.gathering_id and member.revision=review.revision and member.review_id=review.review_id) as stored_count
    from network.monthly_gathering_grouping_reviews review where review.app_id=${app} and review.gathering_id=${key.id}
      and review.revision=${key.revision} and review.superseded_at is null`;
  const complete = !!approved && approved.group_count === groups.length && approved.member_count === memberCount && approved.stored_count === memberCount;
  const current = gatheringGroupingApprovalCurrent(!!approved, approved?.fingerprint === fingerprint, complete);
  const now = ctx.now();
  if (submitted === undefined) {
    if (!openGathering(event, key, now)) return failure("not_found", 404);
    await auditGrouping(tx, ctx, key, "read_monthly_gathering_grouping", groups.length, memberCount, now);
    return response({ ok: true, ...key, fingerprint, groups, approved: current });
  }
  if (!gatheringGroupingReviewAllowed(openGathering(event, key, now), now < event.starts_at.getTime(), submitted === fingerprint, groups.length > 0)) {
    return failure("gathering_grouping_review_conflict", 409);
  }
  if (current && approved) return receipt(key, approved, true);
  if (approved) await tx`update network.monthly_gathering_grouping_reviews set superseded_at=${new Date(now)}
    where app_id=${app} and gathering_id=${key.id} and revision=${key.revision} and review_id=${approved.review_id}`;

  const reviewId = randomUUID();
  const [recorded] = await tx<GroupingReview[]>`insert into network.monthly_gathering_grouping_reviews
    (app_id,gathering_id,revision,review_id,fingerprint,group_count,member_count,reviewed_by,reviewed_at)
    values (${app},${key.id},${key.revision},${reviewId},${fingerprint},${groups.length},${memberCount},${ctx.staff.id},${new Date(now)})
    returning review_id,fingerprint,group_count,member_count,reviewed_at`;
  const seats = groups.flatMap((group, index) => group.map(member_id => ({ member_id, group_no: index + 1 })));
  await tx`insert into network.monthly_gathering_group_members (app_id,gathering_id,revision,review_id,group_no,member_id)
    select ${app},${key.id}::uuid,${key.revision},${reviewId}::uuid,seat.group_no,seat.member_id
    from jsonb_to_recordset(${tx.json(seats)}::jsonb) as seat(group_no integer,member_id text)`;
  await auditGrouping(tx, ctx, key, "approve_monthly_gathering_grouping", groups.length, memberCount, now);
  return receipt(key, recorded!, false);
}

/** Staff-operated grouping. The caller holds the app's runtime lock while current evidence is read. */
export async function handleMonthlyGatheringGrouping(req: Request, path: string, ctx: GroupingContext): Promise<Response | undefined> {
  const match = PATH.exec(path);
  if (!match) return;
  if (!monthlyGatheringStaffAllowed(ctx.app.id === "ntwrk", ctx.city === "nyc", allowed(ctx.staff, ["admin"], ctx.app.id, "real"))) return failure("forbidden", 403);
  const id = match[1]!;
  if (!match[2]) {
    if (req.method !== "GET") return failure("method_not_allowed", 405);
    const revisions = new URL(req.url).searchParams.getAll("revision");
    const revision = Number(revisions[0]);
    if (revisions.length !== 1 || !/^[1-9][0-9]*$/.test(revisions[0]!) || !revisionAllowed(revision)) return failure("invalid_revision", 400);
    return ctx.withGroupingEvidence(read => ctx.scoped(tx => reviewGrouping(tx, ctx, { id, revision }, read)));
  }
  if (req.method !== "POST") return failure("method_not_allowed", 405);
  let body: unknown;
  try {
    const raw = await readCappedText(req, 1024);
    if (raw === "too_large") return failure("body_too_large", 413);
    body = JSON.parse(raw);
  } catch {
    return failure("invalid_request", 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2
    || !Object.hasOwn(body, "revision") || !Object.hasOwn(body, "fingerprint")) return failure("invalid_review", 400);
  const { revision, fingerprint } = body as Record<string, unknown>;
  if (!revisionAllowed(revision) || typeof fingerprint !== "string" || !FINGERPRINT.test(fingerprint)) return failure("invalid_review", 400);
  return ctx.withGroupingEvidence(read => ctx.scoped(tx => reviewGrouping(tx, ctx, { id, revision }, read, fingerprint)));
}
