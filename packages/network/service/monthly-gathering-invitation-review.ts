import { createHash } from "node:crypto";
import { gatheringMaxCapacity, monthlyGatheringStaffAllowed } from "../../core/src/generated/monthlyGathering.ts";
import { gatheringInvitationReviewAllowed, gatheringSelectionInOrder, gatheringSelectionReplay } from "../../core/src/generated/monthlyGatheringInvitationReview.ts";
import { gatheringRsvpWindow } from "../../core/src/generated/monthlyGatheringRsvp.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { allowed, rolesFor } from "../../../apps/observatory/src/staff.ts";
import type { StaffUser } from "../../../apps/observatory/src/types.ts";
import type { AppInfo } from "../../platform/src/apps.ts";
import { readCappedText } from "../../platform/src/body.ts";
import type { GatheringRsvpKey } from "./monthly-gathering-rsvp.ts";

type Recommendation = (tx: SQL, key: GatheringRsvpKey, capacity: number) => Promise<readonly string[]>;
interface GatheringInvitationReviewContext {
  app: AppInfo;
  city: string;
  staff: StaffUser;
  now: () => number;
  scoped: <T>(run: (tx: SQL) => Promise<T>) => Promise<T>;
  withRecommendation: <T>(run: (recommendation: Recommendation) => Promise<T>) => Promise<T>;
}

interface Gathering {
  status: string;
  revision: number;
  capacity: number;
  reviewed_at: Date | null;
  starts_at: Date;
  ends_at: Date;
}

interface RecordedReview {
  selection_hash: string;
  recipient_count: number;
  reviewed_at: Date;
  reviewed_by: string;
}

const PATH = /^\/gatherings\/([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\/invitations\/review$/;
const MEMBER_ID = /^[\w.:-]{1,200}$/;

function parseReview(body: unknown): { revision: number; memberIds: string[] } | undefined {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 2
    || !Object.hasOwn(body, "revision") || !Object.hasOwn(body, "memberIds")) return;
  const { revision, memberIds } = body as Record<string, unknown>;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1 || revision > 2_147_483_647
    || !Array.isArray(memberIds) || memberIds.length > gatheringMaxCapacity
    || !memberIds.every(id => typeof id === "string" && MEMBER_ID.test(id)) || new Set(memberIds).size !== memberIds.length) return;
  return { revision, memberIds };
}

function response(body: object, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}
const failure = (error: string, status: number) => response({ ok: false, error }, status);
const conflict = () => failure("gathering_invitation_review_conflict", 409);

function receipt(key: GatheringRsvpKey, stored: RecordedReview, replayed: boolean) {
  return response({ ok: true, review: { ...key, count: stored.recipient_count, reviewedAt: stored.reviewed_at.getTime(), reviewedBy: stored.reviewed_by }, replayed });
}

function futureApproved(event: Gathering, key: GatheringRsvpKey, now: number): boolean {
  return gatheringRsvpWindow(event.status === "approved", event.revision === key.revision, false, event.reviewed_at?.getTime() ?? 0,
    event.starts_at.getTime(), event.ends_at.getTime(), now, now);
}

async function recordGatheringInvitationReview(
  tx: SQL, ctx: GatheringInvitationReviewContext, key: GatheringRsvpKey, memberIds: string[], recommendation: Recommendation,
): Promise<Response> {
  const app = ctx.app.id;
  const [event] = await tx<Gathering[]>`select status,revision,capacity,reviewed_at,starts_at,ends_at
    from network.monthly_gatherings where app_id=${app} and city=${ctx.city} and id=${key.id} for update`;
  if (!event) return failure("not_found", 404);

  const hash = createHash("sha256").update(JSON.stringify(["monthly-gathering-invitation", app, key.id, key.revision, memberIds])).digest("hex");
  const [saved] = await tx<RecordedReview[]>`select selection_hash,recipient_count,reviewed_at,reviewed_by
    from network.monthly_gathering_invitation_reviews where app_id=${app} and gathering_id=${key.id} and revision=${key.revision}`;
  const replay = gatheringSelectionReplay(!!saved, saved?.selection_hash === hash);
  if (replay === "ConflictingGatheringReview") return conflict();
  if (replay === "ExactGatheringReview" && saved) return receipt(key, saved, true);

  if (!gatheringInvitationReviewAllowed(futureApproved(event, key, ctx.now()), true, memberIds.length, event.capacity)) return conflict();
  if (memberIds.length) {
    const current = await tx<{id: string}[]>`select id from network.members where app_id=${app} and id=any(${tx.array(memberIds, "TEXT")}) order by id for update`;
    if (current.length !== memberIds.length) return conflict();
  }
  const recommended = memberIds.length ? [...await recommendation(tx, key, event.capacity)] : [];
  const now = ctx.now();
  if (!gatheringInvitationReviewAllowed(futureApproved(event, key, now), gatheringSelectionInOrder(recommended, memberIds), memberIds.length, event.capacity)) return conflict();

  const [recorded] = await tx<RecordedReview[]>`insert into network.monthly_gathering_invitation_reviews
    (app_id,gathering_id,revision,selection_hash,recipient_count,reviewed_by,reviewed_at)
    values (${app},${key.id},${key.revision},${hash},${memberIds.length},${ctx.staff.id},${new Date(now)})
    returning selection_hash,recipient_count,reviewed_by,reviewed_at`;
  if (memberIds.length) await tx`insert into network.monthly_gathering_invitees (app_id,gathering_id,revision,member_id,position)
    select ${app},${key.id}::uuid,${key.revision},selected.member_id,selected.position::int
    from unnest(${tx.array(memberIds, "TEXT")}) with ordinality as selected(member_id,position)`;
  const roles = [...rolesFor(ctx.staff, app, "real")];
  await tx`insert into network.staff_audit (at,actor,roles,action,target_type,target_id,mode,ok,detail,app_id)
    values (${new Date(now)},${ctx.staff.id},${tx.array(roles,"TEXT")},'approve_monthly_gathering_invitees','case',${key.id},'real',true,
      ${{ revision: key.revision, count: memberIds.length }}::jsonb,${app})`;
  return receipt(key, recorded!, false);
}

/** The staff route passes the authenticated actor and keeps the engine recommendation current through the write. */
export async function handleMonthlyGatheringInvitationReview(req: Request, path: string, ctx: GatheringInvitationReviewContext): Promise<Response | undefined> {
  const matched = PATH.exec(path);
  if (!matched) return;
  if (!monthlyGatheringStaffAllowed(ctx.app.id === "ntwrk", ctx.city === "nyc", allowed(ctx.staff, ["admin"], ctx.app.id, "real"))) return failure("forbidden", 403);
  if (req.method !== "POST") return failure("method_not_allowed", 405);
  let body: unknown;
  try {
    const raw = await readCappedText(req, 32_768);
    if (raw === "too_large") return failure("body_too_large", 413);
    body = JSON.parse(raw);
  } catch {
    return failure("invalid_request", 400);
  }
  const review = parseReview(body);
  if (!review) return failure("invalid_review", 400);
  const key = { id: matched[1]!, revision: review.revision };
  return ctx.withRecommendation(recommendation => ctx.scoped(tx => recordGatheringInvitationReview(tx, ctx, key, review.memberIds, recommendation)));
}
