import {
  canInvalidateHomeHelp, homeHelpConsentComplete, homeHelpConsentStopped, homeHelpNoticeAllowed, homeHelpResponseAfterDelivery, initial, step,
  type HomeHelpConsentPhase,
} from "../../core/src/generated/homeHelpConsent.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { AppId } from "../../platform/src/apps.ts";
import type { BoundedHomeHelp, HomeHelpDraft, HomeHelpReviewPlan } from "./bounded-help.ts";

export interface HomeHelpConsentKey { app: AppId; id: string; revision: number }
export interface HomeHelpConsentActor { memberId: string; e164: string }
type RecipientKey = HomeHelpConsentKey & { recipientId: string };
type NoticeKey = RecipientKey & { noticeId: string };

export interface HomeHelpConsentNotice extends NoticeKey, Pick<HomeHelpDraft, "task" | "area" | "effortMinutes" | "startsAt" | "endsAt" | "expiresAt"> {
  role: "requester" | "helper";
  helperCount: number;
}

type Decision = "accept" | "decline" | "withdraw";
type Response = "Accepted" | "Declined" | "Withdrawn";
type PersistedPhase = Exclude<HomeHelpConsentPhase, "Unstaged">;

interface Recipient {
  recipient_id: string;
  notice_id: string;
  phase: PersistedPhase;
  sent_at: Date | null;
  answered_at: Date | null;
}

interface ConsentRoster {
  plan: HomeHelpReviewPlan;
  rows: Recipient[];
  exact: boolean;
  stopped: boolean;
  requesterAccepted: boolean;
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const int32 = (n: number) => Number.isInteger(n) && n > 0 && n <= 2_147_483_647;
const keyValid = (key: HomeHelpConsentKey) => UUID.test(key.id) && int32(key.revision);
const active = (["Pending", "Sent", "Accepted"] as const).filter(phase => canInvalidateHomeHelp({ phase }, true));
const cancelled = step({ phase: "Pending" }, { type: "invalidateHomeHelp", planInvalidated: true }).phase;
const responseFor: Record<Decision, Response> = { accept: "Accepted", decline: "Declined", withdraw: "Withdrawn" };
const participants = (plan: HomeHelpReviewPlan) => [plan.requesterId, ...plan.helperIds];

/** Uses the app transaction, generated consent transitions, and the existing live approval authority. */
export class BoundedHomeHelpConsent {
  constructor(
    private readonly plans: Pick<BoundedHomeHelp, "currentApproval">,
    private readonly authorizeActor: (tx: SQL, app: AppId, actor: HomeHelpConsentActor) => Promise<boolean>,
    private readonly now: () => number,
  ) {}

  private async approval(tx: SQL, key: HomeHelpConsentKey, readOnly = false): Promise<HomeHelpReviewPlan | undefined> {
    if (!keyValid(key)) return;
    const [row] = await tx<{ helper_ids: string[] }[]>`select helper_ids from network.bounded_home_help
      where app_id=${key.app} and id=${key.id} and revision=${key.revision} and phase='Approved'`;
    if (!row) return;
    const plan = await this.plans.currentApproval(tx, { ...key, helperIds: row.helper_ids, ongoingConsent: true });
    if (plan || readOnly) return plan;
    await tx`update network.bounded_home_help_consent set phase=${cancelled}
      where app_id=${key.app} and plan_id=${key.id} and revision=${key.revision} and phase in ${tx(active)}`;
  }

  private async recipients(tx: SQL, plan: HomeHelpReviewPlan): Promise<ConsentRoster> {
    const rows = await tx<Recipient[]>`select recipient_id,notice_id,phase,sent_at,answered_at from network.bounded_home_help_consent
      where app_id=${plan.app} and plan_id=${plan.id} and revision=${plan.revision} order by recipient_id for update`;
    const expected = new Set(participants(plan));
    return { plan, rows,
      exact: rows.length === expected.size && rows.every(row => expected.has(row.recipient_id)),
      stopped: rows.some(row => homeHelpConsentStopped(row.phase)),
      requesterAccepted: rows.some(row => row.recipient_id === plan.requesterId && row.phase === "Accepted"),
    };
  }

  private async noticeKey(tx: SQL, app: AppId, noticeId: string, recipientId: string): Promise<NoticeKey | undefined> {
    if (!UUID.test(noticeId)) return;
    const [row] = await tx<{ plan_id: string; revision: number }[]>`select plan_id,revision from network.bounded_home_help_consent
      where app_id=${app} and notice_id=${noticeId} and recipient_id=${recipientId}`;
    if (row) return { app, id: row.plan_id, revision: row.revision, noticeId, recipientId };
  }

  /** Open one consent cycle per approved revision. A repeated stage call keeps existing notice IDs. */
  async stage(tx: SQL, key: HomeHelpConsentKey): Promise<boolean> {
    const plan = await this.approval(tx, key);
    const phase = step(initial, { type: "stageNotice", reviewedNow: !!plan }).phase;
    if (!plan || phase !== "Pending") return false;
    const roster = await this.recipients(tx, plan);
    if (roster.rows.length) return roster.exact && !roster.stopped;
    const ids = participants(plan);
    await tx`insert into network.bounded_home_help_consent (app_id,plan_id,revision,recipient_id,phase)
      select ${key.app},${key.id}::uuid,${key.revision}::int,recipient,${phase} from unnest(${tx.array(ids, "TEXT")}::text[]) as recipient`;
    return true;
  }

  /** Read a single eligible card at queue admission or final dispatch. Callers render only these safe fields. */
  async pendingNotice(tx: SQL, key: RecipientKey): Promise<HomeHelpConsentNotice | undefined> {
    const plan = await this.approval(tx, key);
    if (!plan) return;
    const roster = await this.recipients(tx, plan);
    const row = roster.rows.find(candidate => candidate.recipient_id === key.recipientId);
    const requester = key.recipientId === plan.requesterId;
    if (!row || !homeHelpNoticeAllowed(row.phase, true, roster.exact, roster.stopped, requester, roster.requesterAccepted)) return;
    const { task, area, effortMinutes, startsAt, endsAt, expiresAt } = plan.draft;
    return { app: key.app, id: key.id, revision: key.revision, recipientId: key.recipientId, noticeId: row.notice_id,
      role: requester ? "requester" : "helper", helperCount: plan.helperIds.length, task, area, effortMinutes, startsAt, endsAt, expiresAt };
  }

  async pendingNoticeById(tx: SQL, app: AppId, noticeId: string, recipientId: string): Promise<HomeHelpConsentNotice | undefined> {
    const key = await this.noticeKey(tx, app, noticeId, recipientId);
    if (!key) return;
    const pending = await this.pendingNotice(tx, key);
    if (pending?.noticeId === noticeId) return pending;
  }

  /** The caller passes an authoritative positive receipt bound to the exact outbound ID and recipient. */
  async recordSent(tx: SQL, key: NoticeKey & { acceptedAt?: number }): Promise<boolean> {
    const exact = await this.noticeKey(tx, key.app, key.noticeId, key.recipientId);
    if (exact?.id !== key.id || exact.revision !== key.revision) return false;
    const plan = await this.approval(tx, key);
    if (!plan) return false;
    const now = this.now(), acceptedAt = key.acceptedAt ?? now;
    if (!plan.approval || !Number.isSafeInteger(acceptedAt) || acceptedAt < plan.approval.at || acceptedAt > now) return false;
    const roster = await this.recipients(tx, plan);
    const row = roster.rows.find(candidate => candidate.recipient_id === key.recipientId && candidate.notice_id === key.noticeId);
    if (!row || !roster.exact || roster.stopped) return false;
    const deliveryAllowed = homeHelpNoticeAllowed(row.phase, true, roster.exact, roster.stopped,
      key.recipientId === plan.requesterId, roster.requesterAccepted);
    const next = step(row, { type: "recordNoticeSent", deliveryAllowed, exactReceipt: true });
    if (next.phase === row.phase) return row.sent_at !== null;
    await tx`update network.bounded_home_help_consent set phase=${next.phase},sent_at=${new Date(acceptedAt)}
      where app_id=${key.app} and plan_id=${key.id} and revision=${key.revision} and recipient_id=${key.recipientId}`;
    return true;
  }

  async recordSentById(tx: SQL, app: AppId, noticeId: string, recipientId: string, acceptedAt?: number): Promise<boolean> {
    const key = await this.noticeKey(tx, app, noticeId, recipientId);
    return !!key && await this.recordSent(tx, { ...key, acceptedAt });
  }

  /** The caller supplies the authenticated sender of the command. No other recipient's decision is returned. */
  async respond(tx: SQL, key: HomeHelpConsentKey & { actor: HomeHelpConsentActor; decision: Decision; receivedAt?: number }): Promise<Response | undefined> {
    if (!keyValid(key) || !Object.hasOwn(responseFor, key.decision) || !await this.authorizeActor(tx, key.app, key.actor)) return;
    const [bound] = await tx`select recipient_id from network.bounded_home_help_consent
      where app_id=${key.app} and plan_id=${key.id} and revision=${key.revision} and recipient_id=${key.actor.memberId}`;
    if (!bound) return;
    const plan = await this.approval(tx, key);
    if (!plan) return;
    const roster = await this.recipients(tx, plan);
    const row = roster.rows.find(candidate => candidate.recipient_id === key.actor.memberId);
    if (!row || !roster.exact || !await this.authorizeActor(tx, key.app, key.actor)) return;
    const now = this.now(), receivedAt = key.receivedAt ?? now;
    const since = key.decision === "withdraw" ? row.answered_at : row.sent_at;
    if (!since || !Number.isSafeInteger(receivedAt) || !homeHelpResponseAfterDelivery(since.getTime(), receivedAt, now)) return;
    const phase = responseFor[key.decision];
    if (row.phase === phase) return phase;
    const next = key.decision === "withdraw"
      ? step(row, { type: "withdrawHomeHelp", exactActor: true })
      : step(row, { type: "chooseHomeHelp", responseAllowed: !roster.stopped, exactActor: true, wantsHelp: key.decision === "accept" });
    if (next.phase !== phase) return;
    await tx`update network.bounded_home_help_consent set phase=${phase},answered_at=${new Date(receivedAt)}
      where app_id=${key.app} and plan_id=${key.id} and revision=${key.revision} and recipient_id=${key.actor.memberId}`;
    return phase;
  }

  /** Use inside the later action transaction. Holds the current approval and exact consent rows. */
  async currentConsent(tx: SQL, key: HomeHelpConsentKey, readOnly = false): Promise<HomeHelpReviewPlan | undefined> {
    const plan = await this.approval(tx, key, readOnly);
    if (!plan) return;
    const roster = await this.recipients(tx, plan);
    const accepted = roster.rows.filter(row => row.phase === "Accepted").length;
    if (homeHelpConsentComplete(true, roster.exact, 1 + plan.helperIds.length, accepted)) return plan;
  }

  /** Seal existing cycles on a canonical STOP, hold, offer withdrawal or other participant invalidation. */
  async invalidateForMember(tx: SQL, app: AppId, memberId: string): Promise<void> {
    await tx`update network.bounded_home_help_consent set phase=${cancelled}
      where app_id=${app} and recipient_id=${memberId} and phase in ${tx(active)}`;
  }
}
