import { randomBytes } from "node:crypto";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { memberInviteWindowMs } from "../../core/src/generated/memberInvitation.ts";
import type { AppId } from "./apps.ts";
import { keyedHash } from "./phone.ts";

export interface ReferralJoin {
  tokenHash: string;
  inviterMemberId: string;
}

export class InvitationUnavailable extends Error {
  constructor() { super("Invitation is unavailable"); }
}

export function memberInvitationHash(key: string, app: AppId, token: string): string | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || Buffer.from(token, "base64url").toString("base64url") !== token) return;
  return keyedHash(key, `member_invitation:${app}:${token}`);
}

export function newMemberInvitation(key: string, app: AppId): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: keyedHash(key, `member_invitation:${app}:${token}`) };
}

export async function storeMemberInvitation(
  tx: SQL, app: AppId, referral: ReferralJoin, relationship: string, now: number,
  expiresAt = now + memberInviteWindowMs, evidence?: Pick<HeldMemberInvitation, "durationMonths" | "depth">,
): Promise<void> {
  await tx`insert into platform.member_invitations (app_id, token_hash, inviter_member_id, relationship, issued_at, expires_at, duration_months, depth)
    values (${app}, ${referral.tokenHash}, ${referral.inviterMemberId}, ${relationship}, ${new Date(now)}, ${new Date(expiresAt)},
      ${evidence?.durationMonths ?? null}, ${evidence?.depth ?? null})`;
}

export async function findMemberInvitation(tx: SQL, app: AppId, tokenHash: string, now: number): Promise<ReferralJoin | undefined> {
  const [row] = await tx`select inviter_member_id from platform.member_invitations
    where app_id=${app} and token_hash=${tokenHash} and issued_at<=${new Date(now)} and expires_at>${new Date(now)} and redeemed_at is null`;
  if (row) return { tokenHash, inviterMemberId: row.inviter_member_id as string };
}

export async function consumeMemberInvitation(tx: SQL, app: AppId, referral: ReferralJoin, inviteeMemberId: string, now: number): Promise<void> {
  const rows = await tx`update platform.member_invitations set redeemed_member_id=${inviteeMemberId}, redeemed_at=${new Date(now)}
    where app_id=${app} and token_hash=${referral.tokenHash} and inviter_member_id=${referral.inviterMemberId}
      and inviter_member_id<>${inviteeMemberId} and redeemed_at is null and issued_at<=${new Date(now)} and expires_at>${new Date(now)}
    returning token_hash`;
  if (rows.length !== 1) throw new InvitationUnavailable();
}

type ReviewReason = "weak_vouch" | "burst" | "risk_language";

export interface HeldMemberInvitation {
  id: string;
  inviterMemberId: string;
  relationship: "friend" | "coworker" | "roommate" | "family";
  durationMonths: number;
  depth: "met_once" | "somewhat" | "well";
  reviewReasons: readonly ReviewReason[];
  at: number;
}

export interface MemberInvitationReview extends HeldMemberInvitation {
  expiresAt: number;
}

export type MemberInvitationReviewDecision = "approve" | "deny";
export type MemberInvitationReviewStatus = "pending" | "approved" | "denied" | "released";

export function memberInvitationReviewId(key: string, app: AppId, inviterMemberId: string, requestId: string): string {
  return `mir_${keyedHash(key, JSON.stringify(["member_invitation_review", app, inviterMemberId, requestId])).slice(0, 32)}`;
}

export const isMemberInvitationReviewId = (value: string): boolean => value.length === 36 && /^mir_[0-9a-f]{32}$/.test(value);

interface ReviewRow {
  id: string;
  inviter_member_id: string;
  relationship: HeldMemberInvitation["relationship"];
  duration_months: number;
  depth: HeldMemberInvitation["depth"];
  review_reasons: ReviewReason[];
  requested_at: Date;
  expires_at: Date;
}

function invitationReview(row: ReviewRow): MemberInvitationReview {
  return {
    id: row.id, inviterMemberId: row.inviter_member_id, relationship: row.relationship,
    durationMonths: row.duration_months, depth: row.depth, reviewReasons: row.review_reasons,
    at: row.requested_at.getTime(), expiresAt: row.expires_at.getTime(),
  };
}

/** Replaying the exact request id keeps its original evidence, expiry and decision. */
export async function holdMemberInvitation(tx: SQL, app: AppId, request: HeldMemberInvitation): Promise<void> {
  await tx`insert into platform.member_invitation_reviews
    (app_id, id, inviter_member_id, relationship, duration_months, depth, review_reasons, requested_at, expires_at)
    values (${app}, ${request.id}, ${request.inviterMemberId}, ${request.relationship}, ${request.durationMonths}, ${request.depth},
      ${tx.array(request.reviewReasons, "TEXT")}, ${new Date(request.at)}, ${new Date(request.at + memberInviteWindowMs)})
    on conflict (app_id, id) do nothing`;
}

export async function listMemberInvitationReviews(tx: SQL, app: AppId, at: number): Promise<MemberInvitationReview[]> {
  const rows = await tx<ReviewRow[]>`select id, inviter_member_id, relationship, duration_months, depth, review_reasons, requested_at, expires_at
    from platform.member_invitation_reviews where app_id=${app} and state='pending' and requested_at<=${new Date(at)} and expires_at>${new Date(at)}
    order by requested_at, id limit 100`;
  return rows.map(invitationReview);
}

export async function decideMemberInvitationReview(tx: SQL, app: AppId, id: string, decision: MemberInvitationReviewDecision, reviewer: string, at: number): Promise<boolean> {
  const rows = await tx`update platform.member_invitation_reviews
    set state=${decision === "approve" ? "approved" : "denied"}, reviewer_id=${reviewer}, reviewed_at=${new Date(at)}
    where app_id=${app} and id=${id} and state='pending' and requested_at<=${new Date(at)} and expires_at>${new Date(at)}
    returning id`;
  return rows.length === 1;
}

/** A member can see only the state of their own live request. */
export async function memberInvitationReviewStatus(tx: SQL, app: AppId, id: string, inviterMemberId: string, at: number): Promise<MemberInvitationReviewStatus | undefined> {
  const now = new Date(at);
  const [row] = await tx<{ state: MemberInvitationReviewStatus }[]>`select state from platform.member_invitation_reviews
    where app_id=${app} and id=${id} and inviter_member_id=${inviterMemberId} and requested_at<=${now} and expires_at>${now}`;
  return row?.state;
}

export async function findApprovedMemberInvitationReview(tx: SQL, app: AppId, id: string, inviterMemberId: string, at: number): Promise<MemberInvitationReview | undefined> {
  const [row] = await tx<ReviewRow[]>`select id, inviter_member_id, relationship, duration_months, depth, review_reasons, requested_at, expires_at
    from platform.member_invitation_reviews where app_id=${app} and id=${id} and inviter_member_id=${inviterMemberId}
      and state='approved' and reviewed_at<=${new Date(at)} and expires_at>${new Date(at)}`;
  if (row) return invitationReview(row);
}

/** Release inside the same transaction that writes the link. A failed write keeps the approval usable. */
export async function releaseMemberInvitationReview(tx: SQL, app: AppId, id: string, inviterMemberId: string, at: number): Promise<MemberInvitationReview> {
  const [row] = await tx<ReviewRow[]>`update platform.member_invitation_reviews set state='released', released_at=${new Date(at)}
    where app_id=${app} and id=${id} and inviter_member_id=${inviterMemberId} and state='approved' and reviewed_at<=${new Date(at)} and expires_at>${new Date(at)}
    returning id, inviter_member_id, relationship, duration_months, depth, review_reasons, requested_at, expires_at`;
  if (!row) throw new InvitationUnavailable();
  return invitationReview(row);
}

export async function purgeExpiredMemberInvitationReviews(tx: SQL, app: AppId, at: number): Promise<void> {
  await tx`delete from platform.member_invitation_reviews where app_id=${app} and expires_at<=${new Date(at)}`;
}
