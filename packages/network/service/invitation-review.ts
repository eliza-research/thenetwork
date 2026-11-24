import type { SQL } from "../../core/src/runtime/postgres.ts";
import { allowed, rolesFor } from "../../../apps/observatory/src/staff.ts";
import type { StaffRole, StaffUser } from "../../../apps/observatory/src/types.ts";
import type { AppId } from "../../platform/src/apps.ts";
import {
  decideMemberInvitationReview, isMemberInvitationReviewId, listMemberInvitationReviews,
  type MemberInvitationReview, type MemberInvitationReviewDecision,
} from "../../platform/src/invite-links.ts";

const reviewers: readonly StaffRole[] = ["reviewer", "safety"];

/** Call within the app-scoped transaction. Evidence leaves it only after a durable read audit. */
export async function staffInvitationReviewQueue(tx: SQL, app: AppId, user: StaffUser, at: number): Promise<MemberInvitationReview[] | undefined> {
  if (!allowed(user, reviewers, app, "real")) return;
  const roles = [...rolesFor(user, app, "real")];
  await tx`insert into network.staff_audit (at, actor, roles, action, mode, ok, app_id)
    values (${new Date(at)}, ${user.id}, ${tx.array(roles, "TEXT")}, 'read_member_invitation_reviews', 'real', true, ${app})`;
  return listMemberInvitationReviews(tx, app, at);
}

/** An append-only audit and an exact pending decision commit together. This function never sends. */
export async function staffDecideInvitationReview(
  tx: SQL, app: AppId, id: string, decision: MemberInvitationReviewDecision, user: StaffUser, at: number,
): Promise<"decided" | "unavailable" | "forbidden"> {
  if (!allowed(user, reviewers, app, "real")) return "forbidden";
  if (!isMemberInvitationReviewId(id)) return "unavailable";
  const changed = await decideMemberInvitationReview(tx, app, id, decision, user.id, at);
  const roles = [...rolesFor(user, app, "real")];
  await tx`insert into network.staff_audit (at, actor, roles, action, target_type, target_id, mode, ok, detail, app_id)
    values (${new Date(at)}, ${user.id}, ${tx.array(roles, "TEXT")}, 'decide_member_invitation_review', 'case', ${id}, 'real',
      ${changed}, ${{ decision }}::jsonb, ${app})`;
  return changed ? "decided" : "unavailable";
}
