import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { memberInviteWindowMs } from "../../core/src/generated/memberInvitation.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { staffUser } from "../../observatory/src/staff.ts";
import type { AppId } from "../../platform/src/apps.ts";
import {
  findApprovedMemberInvitationReview, findMemberInvitation, holdMemberInvitation, InvitationUnavailable, memberInvitationReviewId, memberInvitationReviewStatus,
  newMemberInvitation, purgeExpiredMemberInvitationReviews, releaseMemberInvitationReview, storeMemberInvitation,
  type HeldMemberInvitation,
} from "../../platform/src/invite-links.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { staffDecideInvitationReview, staffInvitationReviewQueue } from "../service/invitation-review.ts";

describe.skipIf(!pgAvailable)("member invitation review in PostgreSQL", () => {
  const app = "friends";
  const inviter = "friends_inviter";
  const secondMember = "friends_second";
  const at = Date.UTC(2026, 10, 16);
  const reviewer = staffUser("reviewer@example.test", [{ role: "reviewer", app }], "sso");
  const outsideReviewer = staffUser("outside@example.test", [{ role: "reviewer", app: "slop" }], "sso");
  let url: string;
  let sql: SQL;

  function scoped<T>(scope: AppId, work: (tx: SQL) => Promise<T>): Promise<T> {
    return sql.begin(async tx => {
      await tx`set local role network_service`;
      await tx`select set_config('app.app_id', ${scope}, true)`;
      return work(tx);
    });
  }

  function request(messageId: string): HeldMemberInvitation {
    return {
      id: memberInvitationReviewId("integration-fixture", app, inviter, messageId), inviterMemberId: inviter,
      relationship: "friend", durationMonths: 0, depth: "met_once", reviewReasons: ["weak_vouch"], at,
    };
  }

  beforeAll(async () => {
    url = await migratedDb("invite_review");
    sql = new SQL(url);
    await scoped(app, tx => tx`insert into network.members (id, name, home_city) values (${inviter}, 'Inviter', 'nyc'), (${secondMember}, 'Other', 'nyc')`);
  }, 120_000);

  afterAll(async () => {
    await sql?.close();
    if (url) await dropDb(url);
  });

  test("approval belongs to one app and inviter, survives a failed release, then yields one expiring link", async () => {
    const held = request("original-signed-turn");
    await scoped(app, tx => holdMemberInvitation(tx, app, held));
    expect(await scoped(app, tx => memberInvitationReviewStatus(tx, app, held.id, inviter, at))).toBe("pending");
    expect(await scoped(app, tx => memberInvitationReviewStatus(tx, app, held.id, secondMember, at))).toBeUndefined();
    expect(await scoped("slop", tx => memberInvitationReviewStatus(tx, "slop", held.id, inviter, at))).toBeUndefined();
    expect(await scoped(app, tx => staffInvitationReviewQueue(tx, app, outsideReviewer, at))).toBeUndefined();
    expect(await scoped("slop", tx => staffInvitationReviewQueue(tx, "slop", outsideReviewer, at))).toEqual([]);
    expect(await scoped(app, tx => staffInvitationReviewQueue(tx, app, reviewer, at))).toEqual([{ ...held, expiresAt: at + memberInviteWindowMs }]);
    expect(await scoped("slop", tx => staffDecideInvitationReview(tx, "slop", held.id, "approve", outsideReviewer, at))).toBe("unavailable");
    expect(await scoped(app, tx => staffDecideInvitationReview(tx, app, held.id, "approve", reviewer, at))).toBe("decided");
    expect(await scoped(app, tx => memberInvitationReviewStatus(tx, app, held.id, inviter, at))).toBe("approved");

    await scoped(app, tx => holdMemberInvitation(tx, app, { ...held, at: at + 10, reviewReasons: ["burst"] }));
    expect(await scoped(app, tx => findApprovedMemberInvitationReview(tx, app, held.id, secondMember, at))).toBeUndefined();
    await expect(scoped(app, tx => releaseMemberInvitationReview(tx, app, held.id, secondMember, at))).rejects.toBeInstanceOf(InvitationUnavailable);
    expect(await scoped(app, tx => findApprovedMemberInvitationReview(tx, app, held.id, inviter, at))).toMatchObject(held);

    const { tokenHash } = newMemberInvitation("integration-fixture", app);
    const approval = await scoped(app, tx => findApprovedMemberInvitationReview(tx, app, held.id, inviter, at));
    const referral = { tokenHash, inviterMemberId: inviter };
    await expect(scoped(app, async tx => {
      await releaseMemberInvitationReview(tx, app, held.id, inviter, at + 1);
      await storeMemberInvitation(tx, app, { ...referral, tokenHash: "invalid" }, held.relationship, at + 1, approval!.expiresAt);
    })).rejects.toThrow("member_invitations_token_hash_check");
    expect(await scoped(app, tx => findApprovedMemberInvitationReview(tx, app, held.id, inviter, at + 1))).toEqual(approval);

    const releasedAt = at + memberInviteWindowMs - 1;
    await scoped(app, async tx => {
      const reviewed = await releaseMemberInvitationReview(tx, app, held.id, inviter, releasedAt);
      await storeMemberInvitation(tx, app, referral, reviewed.relationship, releasedAt, reviewed.expiresAt, reviewed);
    });
    expect(await scoped(app, tx => memberInvitationReviewStatus(tx, app, held.id, inviter, releasedAt))).toBe("released");
    await expect(scoped(app, tx => releaseMemberInvitationReview(tx, app, held.id, inviter, releasedAt))).rejects.toBeInstanceOf(InvitationUnavailable);
    expect(await scoped(app, tx => findMemberInvitation(tx, app, tokenHash, releasedAt))).toEqual(referral);
    expect(await scoped(app, tx => findMemberInvitation(tx, app, tokenHash, releasedAt + 1))).toBeUndefined();
    expect(await scoped(app, tx => memberInvitationReviewStatus(tx, app, held.id, inviter, releasedAt + 1))).toBeUndefined();

    await scoped(app, tx => purgeExpiredMemberInvitationReviews(tx, app, releasedAt + 1));
    const [count] = await sql`select count(*)::int as rows from platform.member_invitation_reviews where id=${held.id}`;
    expect(count?.rows).toBe(0);
    const audit = await sql`select actor, app_id, ok, detail from network.staff_audit where target_id=${held.id} order by id`;
    expect([...audit]).toEqual([
      { actor: outsideReviewer.id, app_id: "slop", ok: false, detail: { decision: "approve" } },
      { actor: reviewer.id, app_id: app, ok: true, detail: { decision: "approve" } },
    ]);
  });

  test("ordinary links preserve structured evidence alongside legacy relationship-only links", async () => {
    const legacy = newMemberInvitation("integration-fixture", app).tokenHash;
    const current = newMemberInvitation("integration-fixture", app).tokenHash;
    await scoped(app, async tx => {
      await storeMemberInvitation(tx, app, { tokenHash: legacy, inviterMemberId: inviter }, "friend", at);
      await storeMemberInvitation(tx, app, { tokenHash: current, inviterMemberId: inviter }, "family", at, undefined, { durationMonths: 1500, depth: "well" });
    });
    const [savedLegacy] = await scoped(app, tx => tx`select relationship, duration_months, depth from platform.member_invitations where token_hash=${legacy}`);
    const [savedCurrent] = await scoped(app, tx => tx`select relationship, duration_months, depth from platform.member_invitations where token_hash=${current}`);
    expect(savedLegacy).toEqual({ relationship: "friend", duration_months: null, depth: null });
    expect(savedCurrent).toEqual({ relationship: "family", duration_months: 1500, depth: "well" });
  });
});
