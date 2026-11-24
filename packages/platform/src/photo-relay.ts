import { createHash, createHmac, randomBytes } from "node:crypto";
import { DAY } from "../../core/src/clock.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import {
  answerNo, answerYes, askReceiver, canAnswerNo, canAnswerYes, canEndOffer, canLapseAnswer, canReportOffer, canRevokeOffer, canSettleReview,
  endOffer, initial as offerInitial, lapseAnswer, offerOpen, photoCheckSetMatches, photoDraftTtlMs, photoItemWithdrawable, photoListedAs, photoOfferAdmissionFor,
  photoMineShareMatches, photoPageLinkLive, photoPageLinkTtlMs, photoSenderViewFor, photoTakeBackFor, photoViewAllowed, photoViewLinkRenewable, reportOffer,
  revokeOffer, senderNoticeDueAt, senderNoticeFor, settleReview, unsentNoticeKept,
  type OfferAdmission, type OfferNotice, type OfferPhase, type PhotoOffer, type PhotoSenderView,
} from "../../core/src/generated/photoRelayItem.ts";
import {
  canCheckParties, canCheckPhoto, canRecordSelection, canResolveNotice, initial as selectionInitial,
  photoHeldForReview, photoReviewable, photoReviewMayProceed, photoScreenOutcomeFor, photoScreenRetryDelayMs, photoScreenVerdictFor,
  relayItemTtlMs, reviewAuthorizationCurrent, reviewNeedsCurrent, reviewPreviewAllowed, step as stepPhotoSelection,
  type PhotoSelection, type ReviewState, type ScreenOutcome,
} from "../../core/src/generated/photoRelayReview.ts";
import type { AppId } from "./apps.ts";
import { keyedHash } from "./phone.ts";
import type { PhotoScreen } from "./photo-screen.ts";
import type { PhotoLabelResult, PhotoRow, PhotoService, PhotoType } from "./photos.ts";

export const PHOTO_SEND_NOTICE = {
  version: "2026-11-22-d14",
  text: "An automatic check screens it first. {{recipient}} can view it until you take it back, and could take a screenshot. Taking it back stops more views but can't undo one.",
} as const;
const PHOTO_PAGE = { check: "/photos/check", mine: "/photos/mine", view: "/photos/view" } as const;
type PhotoPagePurpose = keyof typeof PHOTO_PAGE;
export const PHOTO_RELAY_TIME_ZONE = "America/New_York";
const PHOTO_EXPIRY_BATCH = 100;
const PAGE_LINK_KEEP_MS = DAY;
const PHOTO_SCREEN_CLAIM_MS = 60_000;
const FINAL_OFFER_KEEP_MS = 90 * DAY;
const opaque = () => { for (;;) { const id = randomBytes(16).toString("hex"); if (!/\d{7}/.test(id)) return id; } };
const ms = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).getTime());

export function firstNameOf(name: unknown): string {
  const n = (typeof name === "string" ? name : "").normalize("NFKC").replace(/[^\p{L}\p{M}' -]/gu, "").trim().split(/\s+/)[0] ?? "";
  return n.length >= 1 && n.length <= 30 ? n : "Your match";
}
export const maskOf = (numbers: readonly number[]): number => numbers.reduce((m, n) => m | (1 << (n - 1)), 0);
export const numbersOf = (mask: number, count: number): number[] => Array.from({ length: count }, (_, i) => i + 1).filter(n => (mask >> (n - 1)) & 1);
export function photoDay(at: number, timeZone: string = PHOTO_RELAY_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

interface PhotoRelayParties {
  threadId: string; senderPersonId: string; recipientPersonId: string;
  senderMemberId: string; recipientMemberId: string;
}
export interface PhotoRelayItem extends PhotoRelayParties {
  id: string; app: AppId; photoId: string; sha256: string; bytes: number; contentType: PhotoType;
  consentId: string; consentedAt: number; expiresAt: number; policyVersion: string; policyNotice: string; notice: string;
  state: "screening" | "pending" | "approved" | "rejected" | "revoked" | "expired";
  reviewId: string | null; reviewedAt: number | null; reviewerId: string | null; offerId: string | null;
  screenAttempts: number; screenAt: number | null;
}
interface PhotoReviewer { id: string; roles: readonly string[] }
const storedReview: Record<ReviewState, PhotoRelayItem["state"]> = {
  ScreeningReview: "screening", PendingReview: "pending", ApprovedReview: "approved", RejectedReview: "rejected", RevokedReview: "revoked", ExpiredReview: "expired",
};
const reviewFromRow: Record<PhotoRelayItem["state"], ReviewState> = {
  screening: "ScreeningReview", pending: "PendingReview", approved: "ApprovedReview", rejected: "RejectedReview", revoked: "RevokedReview", expired: "ExpiredReview",
};
const OPEN_ITEM_STATES: readonly PhotoRelayItem["state"][] = ["screening", "pending", "approved"];
function selectionState(item: PhotoRelayItem): PhotoSelection {
  return { phase: "StoredSelection", review: reviewFromRow[item.state] };
}
interface PhotoRelayStore {
  create(item: PhotoRelayItem, requestId: string, requestHash: string, tx?: SQL): Promise<{ item?: PhotoRelayItem; conflict?: true }>;
  pending(app: AppId): Promise<PhotoRelayItem[]>;
  ofOffer(offerId: string, tx?: SQL): Promise<PhotoRelayItem[]>;
  duePending(app: AppId, at: number, limit: number): Promise<PhotoRelayItem[]>;
  dueScreens(app: AppId, at: number, limit: number, offerId?: string): Promise<PhotoRelayItem[]>;
  locked<T>(id: string, fn: (item: PhotoRelayItem | undefined, save: (item: PhotoRelayItem) => Promise<void>, tx: SQL) => Promise<T>, tx?: SQL): Promise<T>;
}
const itemRow = (r: Record<string, any>): PhotoRelayItem => ({
  id: r.id, app: r.app_id, photoId: r.photo_id, threadId: r.thread_id,
  senderPersonId: r.sender_person_id, recipientPersonId: r.recipient_person_id,
  senderMemberId: r.sender_member_id, recipientMemberId: r.recipient_member_id,
  sha256: r.content_sha256, bytes: r.content_bytes, contentType: r.content_type,
  consentId: r.consent_id, consentedAt: new Date(r.consented_at).getTime(), expiresAt: new Date(r.expires_at).getTime(),
  policyVersion: r.policy_version, policyNotice: r.policy_notice, notice: r.notice, state: r.state, reviewId: r.review_id,
  reviewedAt: r.reviewed_at === null ? null : new Date(r.reviewed_at).getTime(), reviewerId: r.reviewer_id, offerId: r.offer_id ?? null,
  screenAttempts: r.screen_attempts ?? 0, screenAt: ms(r.screen_at),
});
export class PgPhotoRelayStore implements PhotoRelayStore {
  constructor(private readonly sql: SQL) {}
  async create(r: PhotoRelayItem, requestId: string, requestHash: string, transaction?: SQL) {
    let result: { item?: PhotoRelayItem; conflict?: true } = {};
    const perform = async (tx: SQL) => {
      const inserted = await tx`insert into platform.photo_relay_requests (sender_person_id,app_id,request_id,request_hash,item_id)
        values (${r.senderPersonId}::uuid,${r.app},${requestId},${requestHash},${r.id}) on conflict do nothing returning item_id`;
      const [request] = await tx`select * from platform.photo_relay_requests where sender_person_id=${r.senderPersonId}::uuid and app_id=${r.app} and request_id=${requestId}`;
      if (!request || request.request_hash !== requestHash || request.item_id !== r.id) { result = { conflict: true }; return; }
      if (!inserted.length) {
        const [existing] = await tx`select * from platform.photo_relay_items where id=${r.id}`;
        result = { item: existing ? itemRow(existing) : undefined }; return;
      }
      await tx`insert into platform.photo_relay_items
      (id,app_id,sender_person_id,recipient_person_id,photo_id,thread_id,sender_member_id,recipient_member_id,
       content_sha256,content_type,content_bytes,consent_id,consented_at,expires_at,policy_version,policy_notice,notice,state,offer_id,screen_attempts,screen_at)
      values (${r.id},${r.app},${r.senderPersonId}::uuid,${r.recipientPersonId}::uuid,${r.photoId},${r.threadId},
       ${r.senderMemberId},${r.recipientMemberId},${r.sha256},${r.contentType},${r.bytes},${r.consentId},
       ${new Date(r.consentedAt)},${new Date(r.expiresAt)},${r.policyVersion},${r.policyNotice},${r.notice},${r.state},${r.offerId},
       ${r.screenAttempts},${r.screenAt === null ? null : new Date(r.screenAt)})`;
      result = { item: r };
    };
    if (transaction) await perform(transaction); else await this.sql.begin(perform);
    return result;
  }
  async pending(app: AppId) {
    return (await this.sql`select * from platform.photo_relay_items where app_id=${app} and state='pending' order by expires_at,id`).map(itemRow);
  }
  async ofOffer(offerId: string, tx?: SQL) {
    return (await (tx ?? this.sql)`select * from platform.photo_relay_items where offer_id=${offerId} order by id`).map(itemRow);
  }
  async duePending(app: AppId, at: number, limit: number) {
    return (await this.sql`select * from platform.photo_relay_items where app_id=${app} and state in ('pending','screening') and expires_at<=${new Date(at)}
      order by expires_at,id limit ${limit}`).map(itemRow);
  }
  async dueScreens(app: AppId, at: number, limit: number, offerId?: string) {
    return (await this.sql`select * from platform.photo_relay_items where app_id=${app} and state='screening' and screen_at<=${new Date(at)}
      ${offerId === undefined ? this.sql`` : this.sql`and offer_id=${offerId}`} order by screen_at,id limit ${limit}`).map(itemRow);
  }
  async locked<T>(id: string, fn: (item: PhotoRelayItem | undefined, save: (item: PhotoRelayItem) => Promise<void>, tx: SQL) => Promise<T>, transaction?: SQL): Promise<T> {
    let result!: T;
    const perform = async (tx: SQL) => {
      const [row] = await tx`select * from platform.photo_relay_items where id=${id} for update`;
      result = await fn(row ? itemRow(row) : undefined, async r => {
        if (!row || r.id !== id) throw new Error("photo_relay_missing");
        await tx`update platform.photo_relay_items set state=${r.state},review_id=${r.reviewId},
          reviewed_at=${r.reviewedAt === null ? null : new Date(r.reviewedAt)},reviewer_id=${r.reviewerId},
          screen_attempts=${r.screenAttempts},screen_at=${r.screenAt === null ? null : new Date(r.screenAt)} where id=${id}`;
      }, tx);
    };
    if (transaction) await perform(transaction); else await this.sql.begin(perform);
    return result;
  }
}

type StoredOfferPhase = "asking" | "reviewing" | "ready" | "declined" | "lapsed" | "rejected" | "check_timed_out" | "revoked" | "ended" | "reported";
type StoredNotice = "sent" | "not_taken" | "not_approved" | "check_timed_out";
const PHASE: Record<StoredOfferPhase, OfferPhase> = {
  asking: "Asking", reviewing: "Reviewing", ready: "Ready", declined: "Declined", lapsed: "Lapsed", rejected: "Rejected",
  check_timed_out: "CheckTimedOut", revoked: "Revoked", ended: "Ended", reported: "Reported",
};
const STORED_PHASE = Object.fromEntries(Object.entries(PHASE).map(([k, v]) => [v, k])) as Record<OfferPhase, StoredOfferPhase>;
const NOTICE: Record<Exclude<OfferNotice, "NoNotice">, StoredNotice> = { TellSent: "sent", TellNotTaken: "not_taken", TellNotApproved: "not_approved", TellCheckTimedOut: "check_timed_out" };
const NOTICE_FROM_ROW = Object.fromEntries(Object.entries(NOTICE).map(([k, v]) => [v, k])) as Record<StoredNotice, Exclude<OfferNotice, "NoNotice">>;
const OPEN_PHASES: readonly StoredOfferPhase[] = ["asking", "reviewing", "ready"];
const WAITING_PHASES: readonly StoredOfferPhase[] = ["asking", "reviewing"];
const FINAL_PHASES: readonly StoredOfferPhase[] = ["declined", "lapsed", "rejected", "check_timed_out", "revoked", "ended", "reported"];

interface PhotoOfferRow {
  id: string; requestKey: string; app: AppId; threadId: string;
  senderPersonId: string; recipientPersonId: string; senderMemberId: string; recipientMemberId: string;
  photoIds: string[]; photoSha256: string[]; takenBackIds: string[]; consentId: string; consentedAt: number; policyVersion: string;
  phase: StoredOfferPhase; answerBy: number; partyEnded: boolean;
  wasReady: boolean; endedBySender: boolean; senderNotice: StoredNotice | null; noticeAt: number | null; noticeSentAt: number | null;
  createdAt: number; changedAt: number;
}
const offerRow = (r: Record<string, any>): PhotoOfferRow => ({
  id: r.id, requestKey: r.request_key, app: r.app_id, threadId: r.thread_id,
  senderPersonId: r.sender_person_id, recipientPersonId: r.recipient_person_id, senderMemberId: r.sender_member_id, recipientMemberId: r.recipient_member_id,
  photoIds: [...r.photo_ids], photoSha256: [...r.photo_sha256], takenBackIds: [...(r.taken_back_ids ?? [])],
  consentId: r.consent_id, consentedAt: ms(r.consented_at)!, policyVersion: r.policy_version,
  phase: r.phase, answerBy: ms(r.answer_by)!, partyEnded: r.party_ended === true,
  wasReady: r.was_ready, endedBySender: r.ended_by_sender, senderNotice: r.sender_notice ?? null, noticeAt: ms(r.notice_at), noticeSentAt: ms(r.notice_sent_at),
  createdAt: ms(r.created_at)!, changedAt: ms(r.changed_at)!,
});
const machine = (o: PhotoOfferRow): PhotoOffer => ({ phase: PHASE[o.phase], answerBy: o.answerBy });
const senderFacts = (o: PhotoOfferRow, at: number): [OfferPhase, boolean, boolean, boolean] => [
  canLapseAnswer(machine(o), at) ? "Lapsed" : PHASE[o.phase], o.wasReady, o.endedBySender,
  o.senderNotice !== null && o.noticeSentAt === null && o.noticeAt !== null && o.noticeAt > at,
];
const ACCESS: Record<Exclude<PhotoSenderView, "SeesNothing">, PhotoAccessState> = { SeesAsked: "asked", SeesChecking: "checking", SeesSent: "ready", SeesTakenBack: "taken_back" };

export interface PhotoSlot { n: number; id: string; addedAt: number; batch: string; label: string | null; sharedWith: string[]; heldBy: string[] }
export type PhotoAccessState = "asked" | "checking" | "ready" | "taken_back";
export interface PhotoHolding { n: number; label: string | null; addedAt: number; addedOn: string; access: { firstName: string; state: PhotoAccessState; shareRef: string }[] }
export interface PhotoDraft {
  id: string; personId: string; app: AppId; purpose: "send" | "delete"; threadId: string | null; recipientMemberId: string | null;
  shownIds: string[]; proposedIds: string[]; wantsSet: boolean; listed: boolean; photoSetSha: string; policyVersion: string;
  promptVia: "turn" | "send"; promptInboundId: string | null; promptKey: string; shownAt: number; revision: number;
}
export type DraftPrompt = { via: "turn"; inboundId: string; key: string } | { via: "send" };
export interface DraftInput {
  personId: string; app: AppId; purpose: "send" | "delete"; threadId: string | null; recipientMemberId: string | null;
  shownIds: string[]; proposedIds: string[]; wantsSet: boolean; listed: boolean; prompt: DraftPrompt;
}
const draftRow = (r: Record<string, any>): PhotoDraft => ({
  id: r.id, personId: r.sender_person_id, app: r.app_id, purpose: r.purpose, threadId: r.thread_id ?? null, recipientMemberId: r.recipient_member_id ?? null,
  shownIds: [...r.shown_ids], proposedIds: [...r.proposed_ids], wantsSet: r.wants_set, listed: r.listed, photoSetSha: r.photo_set_sha,
  policyVersion: r.policy_version, promptVia: r.prompt_via, promptInboundId: r.prompt_inbound_id ?? null, promptKey: r.prompt_key,
  shownAt: ms(r.shown_at)!, revision: r.revision,
});
export interface PhotoPageLink {
  id: string; personId: string; app: AppId; purpose: PhotoPagePurpose; draftId: string | null; draftRevision: number | null;
  offerId: string | null; issuedAt: number; expiresAt: number | null; deviceHash: string | null;
}
const linkRow = (r: Record<string, any>): PhotoPageLink => ({
  id: r.id, personId: r.person_id, app: r.app_id, purpose: r.purpose, draftId: r.draft_id ?? null, draftRevision: r.draft_revision ?? null,
  offerId: r.offer_id ?? null, issuedAt: ms(r.issued_at)!, expiresAt: ms(r.expires_at), deviceHash: r.device_hash ?? null,
});
export interface PreparedOffer {
  admission: OfferAdmission; recipientMemberId: string; recipientPersonId: string; firstName: string; firstAsk: boolean; count: number; threadId: string;
  commit(tx: SQL): Promise<{ admission: OfferAdmission; offerId?: string; phase?: StoredOfferPhase; replayed: boolean; firstAsk: boolean }>;
}
interface SettledOffer {
  offerId: string; from: StoredOfferPhase; phase: StoredOfferPhase; changed: boolean; notice: OfferNotice; dueAt: number | null;
  viewLink?: string; senderPersonId: string; senderMemberId: string; recipientPersonId: string; recipientMemberId: string; threadId: string; count: number;
}
export interface DueNotice { offerId: string; app: AppId; threadId: string; senderPersonId: string; senderMemberId: string; recipientMemberId: string; notice: Exclude<OfferNotice, "NoNotice">; firstName: string }
interface PhotoAsk { offerId: string; senderMemberId: string; firstName: string; count: number; createdAt: number; answerBy: number }
interface RenewedViewLink { offerId: string; senderMemberId: string; threadId: string; count: number; link: string }
interface HeldPhoto { id: string; app: AppId; photoId: string; threadId: string; senderMemberId: string; recipientMemberId: string; offerId: string | null; createdAt: number; deadline: number }

interface PhotoRelayOptions {
  store: PhotoRelayStore; photos: PhotoService; sql: SQL; signingKey: string; hashKey: string; now: () => number;
  screen: PhotoScreen;
  origin(app: AppId): string;
  authorize(input: { app: AppId; threadId: string; senderPersonId: string }, tx?: SQL): Promise<Omit<PhotoRelayParties, "threadId"> | undefined>;
  threads(app: AppId, senderPersonId: string): Promise<{ id: string; label: string }[]>;
}
type PreparedSelection = { item: PhotoRelayItem; requestId: string; requestHash: string; selection: PhotoSelection };
class SelectionConflict extends Error { constructor() { super("photo_selection_conflict"); } }
const reviewerSafe = (reviewer: PhotoReviewer) => reviewer.roles.includes("safety");

export function photoSetSha(rows: readonly Pick<PhotoRow, "id" | "sha256">[]): string {
  return createHash("sha256").update(JSON.stringify(rows.map(r => [r.id, r.sha256]))).digest("hex");
}

export class PhotoRelayService {
  private readonly now: () => number;
  constructor(private readonly o: PhotoRelayOptions) { this.now = o.now; }
  get enabled() { return this.o.photos.enabled; }

  private url(app: AppId, purpose: PhotoPagePurpose, token: string) { return `${this.o.origin(app).replace(/\/+$/, "")}${PHOTO_PAGE[purpose]}#${token}`; }
  private linkId(token: string) { return keyedHash(this.o.hashKey, `photo-page-link:${token}`); }
  deviceId(cookie: string) { return keyedHash(this.o.hashKey, `photo-page-device:${cookie}`); }

  private async issueLink(tx: SQL, input: { personId: string; app: AppId; purpose: PhotoPagePurpose; draftId?: string; draftRevision?: number; offerId?: string; expiresAt: number | null }): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await tx`insert into platform.photo_page_links (id, person_id, app_id, purpose, draft_id, draft_revision, offer_id, issued_at, expires_at)
      values (${this.linkId(token)}, ${input.personId}::uuid, ${input.app}, ${input.purpose}, ${input.draftId ?? null}, ${input.draftRevision ?? null},
        ${input.offerId ?? null}, ${new Date(this.now())}, ${input.expiresAt === null ? null : new Date(input.expiresAt)})`;
    return this.url(input.app, input.purpose, token);
  }

  async pageLink(token: string, tx?: SQL): Promise<PhotoPageLink | undefined> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const [r] = await (tx ?? this.o.sql)`select * from platform.photo_page_links where id = ${this.linkId(token)} ${tx ? tx`for update` : this.o.sql``}`;
    return r ? linkRow(r) : undefined;
  }
  async lockLink(tx: SQL, linkId: string): Promise<PhotoPageLink | undefined> {
    const [r] = await tx`select * from platform.photo_page_links where id = ${linkId} for update`;
    return r ? linkRow(r) : undefined;
  }
  async bindDevice(tx: SQL, linkId: string, deviceHash: string): Promise<boolean> {
    return (await tx`update platform.photo_page_links set device_hash = ${deviceHash} where id = ${linkId} and device_hash is null returning id`).length === 1;
  }
  linkLive(link: PhotoPageLink, deviceHash: string | null, sameRevision: boolean): boolean {
    return photoPageLinkLive(link.issuedAt, this.now(), link.deviceHash !== null, link.deviceHash !== null && link.deviceHash === deviceHash, sameRevision);
  }

  private async names(app: AppId, memberIds: readonly string[], tx?: SQL): Promise<Map<string, string>> {
    const ids = [...new Set(memberIds)];
    const out = new Map<string, string>();
    if (!ids.length) return out;
    const read = async (t: SQL) => {
      await t`select set_config('app.app_id', ${app}, true)`;
      return t`select id, name from network.members where app_id = ${app} and id = any(${ids}::text[])`;
    };
    const rows = tx ? await read(tx) : await this.o.sql.begin(read);
    for (const r of rows as Record<string, any>[]) out.set(r.id as string, firstNameOf(r.name));
    for (const id of ids) if (!out.has(id)) out.set(id, firstNameOf(""));
    return out;
  }

  async firstName(app: AppId, memberId: string, tx?: SQL): Promise<string> {
    return (await this.names(app, [memberId], tx)).get(memberId)!;
  }

  private async parties(app: AppId, threadId: string, senderPersonId: string, recipientPersonId: string | null, tx?: SQL) {
    const p = await this.o.authorize({ app, threadId, senderPersonId }, tx);
    if (!p || p.senderPersonId !== senderPersonId || p.senderPersonId === p.recipientPersonId || p.senderMemberId === p.recipientMemberId) return;
    if (recipientPersonId !== null && p.recipientPersonId !== recipientPersonId) return;
    if (await this.o.photos.mayTake(senderPersonId, app, tx)) return;
    if (await this.o.photos.mayTake(p.recipientPersonId, app, tx)) return;
    return p;
  }

  private async partiesCurrent(o: PhotoOfferRow, tx?: SQL): Promise<boolean> {
    if (o.partyEnded) return false;
    const p = await this.parties(o.app, o.threadId, o.senderPersonId, o.recipientPersonId, tx);
    return !!p && p.senderMemberId === o.senderMemberId && p.recipientMemberId === o.recipientMemberId;
  }

  private async currentPhotoIds(o: PhotoOfferRow, tx?: SQL): Promise<string[]> {
    const out: string[] = [];
    for (const [i, id] of o.photoIds.entries()) {
      const row = await this.o.photos.relayPhoto(o.senderPersonId, o.app, id, undefined, tx);
      if (row && row.sha256 === o.photoSha256[i]) out.push(id);
    }
    return out;
  }

  private async offerParties(o: PhotoOfferRow, tx?: SQL): Promise<boolean> {
    return await this.partiesCurrent(o, tx) && (await this.currentPhotoIds(o, tx)).length === o.photoIds.length;
  }

  private async offerAlive(o: PhotoOfferRow, tx: SQL): Promise<boolean> {
    if (o.phase === "asking") return this.offerParties(o, tx);
    return await this.partiesCurrent(o, tx) && (await this.currentPhotoIds(o, tx)).length > 0;
  }

  async endFor(personId: string, tx?: SQL): Promise<number> {
    return (await (tx ?? this.o.sql)`update platform.photo_offers set party_ended = true
      where phase = any(${OPEN_PHASES as string[]}::text[]) and not party_ended
        and (sender_person_id = ${personId}::uuid or recipient_person_id = ${personId}::uuid) returning id`).length;
  }

  private async senderOffers(personId: string, app: AppId, tx?: SQL): Promise<PhotoOfferRow[]> {
    return (await (tx ?? this.o.sql)`select * from platform.photo_offers
      where sender_person_id = ${personId}::uuid and app_id = ${app} order by created_at, id`).map(offerRow);
  }

  async slots(personId: string, app: AppId, tx?: SQL): Promise<PhotoSlot[]> {
    const rows = await this.o.photos.rows(personId, app, tx);
    const shared = (await this.sharedPhotos(await this.senderOffers(personId, app, tx), tx)).filter(s => s.state !== "taken_back");
    return rows.map((r, i) => ({
      n: i + 1, id: r.id, addedAt: r.createdAt, batch: r.batchId ?? r.id, label: r.label,
      sharedWith: [...new Set(shared.filter(s => s.photoId === r.id).map(s => s.offer.recipientMemberId))],
      heldBy: [...new Set(shared.filter(s => s.photoId === r.id && s.state === "ready").map(s => s.offer.recipientMemberId))],
    }));
  }

  private async listed(o: PhotoOfferRow, seen: PhotoSenderView, tx?: SQL): Promise<{ photoId: string; seen: PhotoSenderView }[]> {
    if (seen === "SeesNothing") return [];
    const taken = o.takenBackIds.map(photoId => ({ photoId, seen: photoListedAs(seen, true) }));
    if (seen === "SeesTakenBack") return taken;
    const live = o.photoIds.filter(id => !o.takenBackIds.includes(id));
    if (seen === "SeesAsked") return [...live.map(photoId => ({ photoId, seen: photoListedAs(seen, false) })), ...taken];
    const items = await this.o.store.ofOffer(o.id, tx);
    const out: { photoId: string; seen: PhotoSenderView }[] = [];
    for (const photoId of live) {
      const item = items.find(i => i.photoId === photoId);
      if (!item) continue;
      const waiting = item.state === "screening" || item.state === "pending";
      const sent = item.state === "approved" || (item.state === "revoked" && item.reviewId !== null);
      const state: PhotoSenderView | null = seen === "SeesChecking" ? (waiting || item.state === "approved" ? "SeesChecking" : null)
        : sent ? "SeesSent" : waiting ? "SeesChecking" : null;
      if (state) out.push({ photoId, seen: photoListedAs(state, false) });
    }
    return [...out, ...taken];
  }

  private async sharedPhotos(offers: readonly PhotoOfferRow[], tx?: SQL): Promise<{ offer: PhotoOfferRow; photoId: string; state: PhotoAccessState }[]> {
    const at = this.now();
    const out: { offer: PhotoOfferRow; photoId: string; state: PhotoAccessState }[] = [];
    for (const offer of offers) {
      for (const l of await this.listed(offer, photoSenderViewFor(...senderFacts(offer, at)), tx)) {
        if (l.seen !== "SeesNothing") out.push({ offer, photoId: l.photoId, state: ACCESS[l.seen] });
      }
    }
    return out;
  }

  private shareRef(offer: PhotoOfferRow, photoId: string): string {
    return createHmac("sha256", this.o.hashKey)
      .update(JSON.stringify(["photo-mine-share", offer.app, offer.senderPersonId, offer.id, photoId]))
      .digest("base64url");
  }

  async holdings(personId: string, app: AppId, timeZone: string = PHOTO_RELAY_TIME_ZONE): Promise<PhotoHolding[]> {
    const rows = await this.o.photos.rows(personId, app);
    const shared = await this.sharedPhotos(await this.senderOffers(personId, app));
    const names = await this.names(app, shared.map(s => s.offer.recipientMemberId));
    return rows.map((r, i) => ({
      n: i + 1, label: r.label, addedAt: r.createdAt, addedOn: photoDay(r.createdAt, timeZone),
      access: shared.filter(s => s.photoId === r.id).map(s => ({
        firstName: names.get(s.offer.recipientMemberId)!, state: s.state, shareRef: this.shareRef(s.offer, s.photoId),
      })),
    }));
  }

  async draftOf(personId: string, app: AppId, tx?: SQL): Promise<PhotoDraft | undefined> {
    const [r] = await (tx ?? this.o.sql)`select * from platform.photo_relay_drafts where sender_person_id = ${personId}::uuid and app_id = ${app} ${tx ? tx`for update` : this.o.sql``}`;
    return r ? draftRow(r) : undefined;
  }

  async saveDraft(tx: SQL, input: DraftInput): Promise<{ draftId: string; revision: number; link: string | null; promptKey: string }> {
    if (input.shownIds.length > 6 || input.proposedIds.length > 3) throw new Error("photo draft too large");
    if ((input.purpose === "send") !== (input.threadId !== null && input.recipientMemberId !== null)) throw new Error("photo draft target");
    const rows = await this.o.photos.rows(input.personId, input.app, tx);
    const own = new Set(rows.map(r => r.id));
    if (![...input.shownIds, ...input.proposedIds].every(id => own.has(id))) throw new Error("photo draft names a photo the member does not own");
    const at = this.now();
    const fresh = `pdr_${opaque()}`;
    const temporaryKey = input.prompt.via === "turn" ? input.prompt.key : `photo-draft:${fresh}:pending`;
    const [saved] = await tx`insert into platform.photo_relay_drafts (id, sender_person_id, app_id, purpose, thread_id, recipient_member_id, shown_ids, proposed_ids,
        wants_set, listed, photo_set_sha, policy_version, prompt_via, prompt_inbound_id, prompt_key, shown_at, revision)
      values (${fresh}, ${input.personId}::uuid, ${input.app}, ${input.purpose}, ${input.threadId}, ${input.recipientMemberId}, ${input.shownIds}::text[], ${input.proposedIds}::text[],
        ${input.wantsSet}, ${input.listed}, ${photoSetSha(rows)}, ${PHOTO_SEND_NOTICE.version}, ${input.prompt.via}, ${input.prompt.via === "turn" ? input.prompt.inboundId : null},
        ${temporaryKey}, ${new Date(at)}, 1)
      on conflict (sender_person_id, app_id) do update set purpose = excluded.purpose, thread_id = excluded.thread_id, recipient_member_id = excluded.recipient_member_id,
        shown_ids = excluded.shown_ids, proposed_ids = excluded.proposed_ids, wants_set = excluded.wants_set, listed = excluded.listed,
        photo_set_sha = excluded.photo_set_sha, policy_version = excluded.policy_version, prompt_via = excluded.prompt_via,
        prompt_inbound_id = excluded.prompt_inbound_id, prompt_key = excluded.prompt_key, shown_at = excluded.shown_at,
        revision = platform.photo_relay_drafts.revision + 1
      returning id, revision`;
    const draftId = saved!.id as string, revision = saved!.revision as number;
    const promptKey = input.prompt.via === "turn" ? input.prompt.key : `photo-draft:${draftId}:${revision}`;
    if (promptKey !== temporaryKey) await tx`update platform.photo_relay_drafts set prompt_key = ${promptKey} where id = ${draftId}`;
    const link = input.purpose === "send"
      ? await this.issueLink(tx, { personId: input.personId, app: input.app, purpose: "check", draftId, draftRevision: revision, expiresAt: at + photoPageLinkTtlMs })
      : null;
    return { draftId, revision, link, promptKey };
  }

  async pickOnPage(tx: SQL, link: PhotoPageLink, proposedIds: string[]): Promise<{ revision: number } | undefined> {
    if (!link.draftId || proposedIds.length < 1 || proposedIds.length > 3) return;
    const [r] = await tx`update platform.photo_relay_drafts set proposed_ids = ${proposedIds}::text[], wants_set = ${proposedIds.length > 1},
        revision = revision + 1, prompt_via = 'send', prompt_inbound_id = null, prompt_key = ${`photo-page:${link.id.slice(0, 32)}:${this.now()}`}
      where id = ${link.draftId} and revision = ${link.draftRevision} returning revision`;
    if (!r) return;
    await tx`update platform.photo_page_links set draft_revision = ${r.revision} where id = ${link.id}`;
    return { revision: r.revision as number };
  }

  async dropDraft(tx: SQL, personId: string, app: AppId): Promise<void> {
    await tx`delete from platform.photo_relay_drafts where sender_person_id = ${personId}::uuid and app_id = ${app}`;
  }

  async mineLink(personId: string, app: AppId): Promise<string | undefined> {
    if (await this.o.photos.mayTake(personId, app)) return;
    return this.o.sql.begin(tx => this.issueLink(tx, { personId, app, purpose: "mine", expiresAt: this.now() + photoPageLinkTtlMs }));
  }

  private async admission(db: SQL, input: { app: AppId; senderPersonId: string; recipientPersonId: string; partiesOk: boolean; count: number; at: number }): Promise<{ admission: OfferAdmission; firstAsk: boolean }> {
    const { app, senderPersonId, recipientPersonId, at } = input;
    const pair = (await db`select * from platform.photo_offers where app_id = ${app} and sender_person_id = ${senderPersonId}::uuid and recipient_person_id = ${recipientPersonId}::uuid`).map(offerRow);
    const openToPair = pair.filter(o => WAITING_PHASES.includes(o.phase) || (o.noticeAt !== null && o.noticeAt > at)).length;
    const unopened = pair.filter(o => (o.phase === "declined" || o.phase === "lapsed") && !o.wasReady);
    const lastUnopenedEndAt = unopened.reduce((m, o) => Math.max(m, o.noticeAt ?? o.changedAt), 0);
    const [{ n: photosLastDay }] = await db`select coalesce(sum(photo_count), 0)::int as n from platform.photo_offers
      where app_id = ${app} and sender_person_id = ${senderPersonId}::uuid and created_at > ${new Date(at - DAY)}`;
    const [pref] = await db`select never from platform.photo_receive_prefs where person_id = ${recipientPersonId}::uuid and app_id = ${app}`;
    const [{ n: asked }] = await db`select count(*)::int as n from platform.photo_offers where app_id = ${app} and recipient_person_id = ${recipientPersonId}::uuid`;
    return {
      admission: photoOfferAdmissionFor(input.partiesOk, openToPair, unopened.length, lastUnopenedEndAt, at, photosLastDay as number, input.count, pref?.never === true),
      firstAsk: (asked as number) === 0,
    };
  }

  async prepareOffer(personId: string, app: AppId, draftId: string, revision: number, at: number): Promise<PreparedOffer | undefined> {
    const draft = await this.draftOf(personId, app);
    if (!draft || draft.id !== draftId || draft.revision !== revision || draft.purpose !== "send" || !draft.threadId || !draft.recipientMemberId) return;
    const threadId = draft.threadId;
    const p = await this.parties(app, threadId, personId, null);
    const rows = await this.o.photos.rows(personId, app);
    const photos = draft.proposedIds.map(id => rows.find(r => r.id === id));
    const partiesOk = !!p && p.recipientMemberId === draft.recipientMemberId && photos.every(r => !!r) && draft.policyVersion === PHOTO_SEND_NOTICE.version;
    const recipientPersonId = p?.recipientPersonId ?? "";
    const names = await this.names(app, [draft.recipientMemberId]);
    const count = draft.proposedIds.length;
    const first = p ? await this.admission(this.o.sql, { app, senderPersonId: personId, recipientPersonId, partiesOk, count, at }) : { admission: photoOfferAdmissionFor(false, 0, 0, 0, at, 0, count, false), firstAsk: false };
    const requestKey = `${draft.id}:${draft.revision}`;
    const commit = async (tx: SQL) => {
      await tx`select id from platform.people where id = ${personId}::uuid for update`;
      const [existing] = await tx`select * from platform.photo_offers where request_key = ${requestKey}`;
      if (existing) { const e = offerRow(existing); return { admission: e.phase === "declined" ? "OfferSilentDecline" as const : "OfferAsk" as const, offerId: e.id, phase: e.phase, replayed: true, firstAsk: false }; }
      const [locked] = await tx`select revision from platform.photo_relay_drafts where id = ${draft.id} for update`;
      if (!locked || locked.revision !== draft.revision || !p) return { admission: "OfferUnavailable" as const, replayed: false, firstAsk: false };
      const again = await this.parties(app, threadId, personId, recipientPersonId, tx);
      const current = await this.o.photos.rows(personId, app, tx);
      const chosen = draft.proposedIds.map(id => current.find(r => r.id === id));
      const ok = !!again && again.recipientMemberId === draft.recipientMemberId && chosen.every(r => !!r) && photoCheckSetMatches(draft.photoSetSha, photoSetSha(current));
      const decided = await this.admission(tx, { app, senderPersonId: personId, recipientPersonId, partiesOk: ok, count, at });
      if (decided.admission !== "OfferAsk" && decided.admission !== "OfferSilentDecline") return { admission: decided.admission, replayed: false, firstAsk: decided.firstAsk };
      const asked = askReceiver(offerInitial, at);
      const next = decided.admission === "OfferAsk" ? asked : answerNo(asked);
      const notice = senderNoticeFor(next.phase, false, false);
      const offerId = `pof_${opaque()}`;
      const inserted = await tx`insert into platform.photo_offers (id, request_key, app_id, thread_id, sender_person_id, recipient_person_id, sender_member_id, recipient_member_id,
          photo_ids, photo_sha256, photo_count, consent_id, consented_at, policy_version, phase, answer_by, sender_notice, notice_at, created_at, changed_at, checked_at)
        values (${offerId}, ${requestKey}, ${app}, ${threadId}, ${personId}::uuid, ${recipientPersonId}::uuid, ${again!.senderMemberId}, ${again!.recipientMemberId},
          ${chosen.map(r => r!.id)}::text[], ${chosen.map(r => r!.sha256)}::text[], ${chosen.length}, ${`pcn_${opaque()}`}, ${new Date(at)}, ${draft.policyVersion},
          ${STORED_PHASE[next.phase]}, ${new Date(next.answerBy)}, ${notice === "NoNotice" ? null : NOTICE[notice]},
          ${notice === "NoNotice" ? null : new Date(senderNoticeDueAt(notice, at, next.answerBy))}, ${new Date(at)}, ${new Date(at)}, ${new Date(at)})
        on conflict do nothing returning id`;
      if (!inserted.length) return { admission: "OfferWaitForAnswer" as const, replayed: false, firstAsk: false };
      return { admission: decided.admission, offerId, phase: STORED_PHASE[next.phase], replayed: false, firstAsk: decided.firstAsk };
    };
    return { admission: first.admission, recipientMemberId: draft.recipientMemberId, recipientPersonId, firstName: names.get(draft.recipientMemberId)!, firstAsk: first.firstAsk, count, threadId, commit };
  }

  private async lockedOffer(tx: SQL, offerId: string): Promise<PhotoOfferRow | undefined> {
    const [r] = await tx`select * from platform.photo_offers where id = ${offerId} for update`;
    return r ? offerRow(r) : undefined;
  }

  private async move(tx: SQL, o: PhotoOfferRow, next: PhotoOffer, endedBySender = false): Promise<PhotoOfferRow> {
    const at = this.now();
    const ended = o.endedBySender || endedBySender;
    const notice = o.senderNotice === null ? senderNoticeFor(next.phase, ended, o.wasReady) : "NoNotice";
    const kept = o.senderNotice === null || o.noticeSentAt !== null || unsentNoticeKept(NOTICE_FROM_ROW[o.senderNotice], next.phase);
    const saved: PhotoOfferRow = {
      ...o, phase: STORED_PHASE[next.phase], wasReady: o.wasReady || next.phase === "Ready", endedBySender: ended,
      senderNotice: notice !== "NoNotice" ? NOTICE[notice] : kept ? o.senderNotice : null,
      noticeAt: notice !== "NoNotice" ? senderNoticeDueAt(notice, at, o.answerBy) : kept ? o.noticeAt : null, changedAt: at,
    };
    await tx`update platform.photo_offers set phase = ${saved.phase}, was_ready = ${saved.wasReady}, ended_by_sender = ${saved.endedBySender},
        sender_notice = ${saved.senderNotice}, notice_at = ${saved.noticeAt === null ? null : new Date(saved.noticeAt)}, changed_at = ${new Date(at)}
      where id = ${o.id}`;
    if (next.phase === "Revoked" || next.phase === "Ended" || next.phase === "Reported") await this.revokeItems(tx, o.id, null);
    return saved;
  }

  private async revokeItems(tx: SQL, offerId: string, photoIds: readonly string[] | null): Promise<number> {
    let revoked = 0;
    for (const item of await this.o.store.ofOffer(offerId, tx)) {
      if (photoIds !== null && !photoIds.includes(item.photoId)) continue;
      const done = await this.o.store.locked(item.id, async (r, save) => {
        if (!r || !OPEN_ITEM_STATES.includes(r.state)) return false;
        const selection = selectionState(r);
        const next = stepPhotoSelection(selection, { type: "revokeSelection", ownerMatches: true });
        if (next === selection) return false;
        await save({ ...r, state: storedReview[next.review], screenAt: null });
        return true;
      }, tx);
      if (done) revoked++;
    }
    return revoked;
  }

  private itemId(app: AppId, senderPersonId: string, requestId: string) {
    return `pri_${createHmac("sha256", `photo-selection:${this.o.signingKey}`).update(JSON.stringify([app, senderPersonId, requestId])).digest("hex").slice(0, 32)}`;
  }

  private async prepareItem(o: PhotoOfferRow, index: number, tx: SQL): Promise<PreparedSelection | undefined> {
    const photoId = o.photoIds[index]!, requestId = `${o.id}_${photoId}`;
    const inputValid = /^[A-Za-z0-9_-]{16,80}$/.test(requestId) && /^ph_[a-f0-9]{24}$/.test(photoId) && o.threadId.length <= 200;
    let selection = stepPhotoSelection(selectionInitial, { type: "checkSelection", inputValid, explicitConsent: o.policyVersion === PHOTO_SEND_NOTICE.version });
    if (!canCheckParties(selection)) return;
    const parties = await this.parties(o.app, o.threadId, o.senderPersonId, o.recipientPersonId, tx);
    selection = stepPhotoSelection(selection, {
      type: "checkParties", senderMatches: parties?.senderPersonId === o.senderPersonId && parties.senderMemberId === o.senderMemberId && parties.recipientMemberId === o.recipientMemberId,
      differentPeople: !!parties && parties.senderPersonId !== parties.recipientPersonId,
      differentMembers: !!parties && parties.senderMemberId !== parties.recipientMemberId,
    });
    if (!parties || !canCheckPhoto(selection)) return;
    const photo = await this.o.photos.relayPhoto(o.senderPersonId, o.app, photoId, undefined, tx);
    selection = stepPhotoSelection(selection, { type: "checkPhoto", currentPhoto: !!photo && photo.sha256 === o.photoSha256[index] });
    if (!photo || !canResolveNotice(selection)) return;
    const thread = (await this.o.threads(o.app, o.senderPersonId)).find(t => t.id === o.threadId);
    selection = stepPhotoSelection(selection, { type: "resolveNotice", readyNotice: !!thread });
    if (!thread || !canRecordSelection(selection)) return;
    const notice = PHOTO_SEND_NOTICE.text.replaceAll("{{recipient}}", firstNameOf(thread.label));
    const at = this.now();
    const state = storedReview[selection.review];
    const item: PhotoRelayItem = {
      threadId: o.threadId, senderPersonId: o.senderPersonId, recipientPersonId: o.recipientPersonId, senderMemberId: o.senderMemberId, recipientMemberId: o.recipientMemberId,
      id: this.itemId(o.app, o.senderPersonId, requestId), app: o.app, photoId, sha256: photo.sha256, bytes: photo.bytes, contentType: photo.contentType,
      consentId: `prc_${opaque()}`, consentedAt: o.consentedAt, expiresAt: at + relayItemTtlMs, policyVersion: o.policyVersion, policyNotice: PHOTO_SEND_NOTICE.text,
      notice, state, reviewId: null, reviewedAt: null, reviewerId: null, offerId: o.id, screenAttempts: 0, screenAt: state === "screening" ? at : null,
    };
    const requestHash = createHash("sha256").update(JSON.stringify({ offerId: o.id, photoId, threadId: o.threadId, consentId: o.consentId, sha256: photo.sha256, bytes: photo.bytes, contentType: photo.contentType, policyVersion: o.policyVersion })).digest("hex");
    return { item, requestId, requestHash, selection };
  }

  private async recordItem(prepared: PreparedSelection, tx: SQL): Promise<PhotoRelayItem | undefined> {
    const created = await this.o.store.create(prepared.item, prepared.requestId, prepared.requestHash, tx);
    if (created.conflict) throw new SelectionConflict();
    const selection = stepPhotoSelection(prepared.selection, { type: "recordSelection" });
    return selection.phase === "StoredSelection" ? created.item : undefined;
  }

  async answer(tx: SQL, offerId: string, recipientPersonId: string, answer: "yes" | "no"): Promise<{ outcome: "taken" | "declined" | "lapsed" | "ended" | "not_open"; offer?: PhotoOfferRow }> {
    const o = await this.lockedOffer(tx, offerId);
    if (!o || o.recipientPersonId !== recipientPersonId) return { outcome: "not_open" };
    const m = machine(o), at = this.now();
    if (canLapseAnswer(m, at)) return { outcome: "lapsed", offer: await this.move(tx, o, lapseAnswer(m, at)) };
    if (answer === "no") return canAnswerNo(m) ? { outcome: "declined", offer: await this.move(tx, o, answerNo(m)) } : { outcome: "not_open" };
    if (!canAnswerYes(m, at)) return { outcome: "not_open" };
    if (!(await this.offerParties(o, tx))) return { outcome: "ended", offer: await this.move(tx, o, endOffer(m)) };
    let made = 0;
    for (const i of o.photoIds.keys()) {
      const prepared = await this.prepareItem(o, i, tx);
      if (prepared && await this.recordItem(prepared, tx)) made++;
    }
    if (made !== o.photoIds.length) { await this.revokeItems(tx, o.id, null); return { outcome: "ended", offer: await this.move(tx, o, endOffer(m)) }; }
    return { outcome: "taken", offer: await this.move(tx, o, answerYes(m, at)) };
  }

  async screensDue(app: AppId, offerId?: string): Promise<{ itemId: string; offerId: string | null }[]> {
    return (await this.o.store.dueScreens(app, this.now(), PHOTO_EXPIRY_BATCH, offerId)).map(i => ({ itemId: i.id, offerId: i.offerId }));
  }

  async screen(itemId: string): Promise<ScreenOutcome | undefined> {
    const r = await this.o.store.locked(itemId, async (item, save) => {
      const at = this.now();
      if (!item || item.state !== "screening" || item.screenAt === null || item.screenAt > at) return undefined;
      const claimed = { ...item, screenAt: at + PHOTO_SCREEN_CLAIM_MS };
      await save(claimed);
      return claimed;
    });
    if (!r) return;
    const bytes = await this.o.photos.relayBytes(r.senderPersonId, r.app, r.photoId, r);
    const reading = bytes ? await this.o.screen.screen(bytes, r.app) : { kind: "unanswered" as const };
    const verdict = photoScreenVerdictFor(reading.kind !== "unusable", reading.kind === "answered", reading.kind === "answered" ? reading.riskPerMille : 0);
    const screenOutcome = photoScreenOutcomeFor(verdict, r.screenAttempts);
    return this.o.store.locked(itemId, async (current, save) => {
      if (!current || current.state !== "screening" || current.screenAttempts !== r.screenAttempts || current.screenAt !== r.screenAt) return undefined;
      const at = this.now(), selection = selectionState(current);
      const next = stepPhotoSelection(selection, { type: "screenSelection", screenOutcome, now: at, deadline: current.expiresAt });
      if (next === selection) return undefined;
      const approved = next.review === "ApprovedReview";
      await save({
        ...current, state: storedReview[next.review],
        screenAttempts: verdict === "ScreenCannotRun" ? current.screenAttempts + 1 : current.screenAttempts,
        screenAt: next.review === "ScreeningReview" ? at + photoScreenRetryDelayMs(current.screenAttempts) : null,
        ...(approved ? { reviewId: `prv_${opaque()}`, reviewedAt: at, reviewerId: this.o.screen.id } : {}),
      });
      return screenOutcome;
    });
  }

  async setNever(tx: SQL, personId: string, app: AppId, never: boolean): Promise<number> {
    await tx`insert into platform.photo_receive_prefs (person_id, app_id, never, changed_at) values (${personId}::uuid, ${app}, ${never}, ${new Date(this.now())})
      on conflict (person_id, app_id) do update set never = excluded.never, changed_at = excluded.changed_at`;
    if (!never) return 0;
    let declined = 0;
    const asks = await tx`select id from platform.photo_offers where app_id = ${app} and recipient_person_id = ${personId}::uuid and phase = 'asking' order by id`;
    for (const { id } of asks as { id: string }[]) {
      const o = await this.lockedOffer(tx, id);
      if (o && canAnswerNo(machine(o))) { await this.move(tx, o, answerNo(machine(o))); declined++; }
    }
    return declined;
  }

  async asksFor(personId: string, app: AppId, tx?: SQL): Promise<PhotoAsk[]> {
    const rows = (await (tx ?? this.o.sql)`select * from platform.photo_offers where app_id = ${app} and recipient_person_id = ${personId}::uuid
      and phase = 'asking' and answer_by > ${new Date(this.now())} order by created_at desc, id`).map(offerRow);
    const names = await this.names(app, rows.map(r => r.senderMemberId), tx);
    return rows.map(r => ({ offerId: r.id, senderMemberId: r.senderMemberId, firstName: names.get(r.senderMemberId)!, count: r.photoIds.length, createdAt: r.createdAt, answerBy: r.answerBy }));
  }

  async withdrawShare(tx: SQL, app: AppId, personId: string, currentThreads: ReadonlySet<string>, shareRef: string): Promise<boolean> {
    const owned = new Set((await this.o.photos.rows(personId, app, tx)).map(photo => photo.id));
    for (const offer of await this.senderOffers(personId, app, tx)) {
      const currentMatch = currentThreads.has(offer.threadId);
      const photoId = offer.photoIds.find(id => photoMineShareMatches(shareRef, this.shareRef(offer, id), owned.has(id), currentMatch));
      if (photoId) return (await this.withdraw(tx, app, personId, offer.threadId, [photoId], offer.id)).revoked === 1;
    }
    return false;
  }

  async withdraw(tx: SQL, app: AppId, personId: string, threadId: string, photoIds: readonly string[] | null, offerId?: string): Promise<{ revoked: number; viewing: boolean }> {
    const at = this.now();
    const offers = (await tx`select * from platform.photo_offers where app_id = ${app} and sender_person_id = ${personId}::uuid and thread_id = ${threadId}
      ${offerId === undefined ? tx`` : tx`and id = ${offerId}`} order by id for update`).map(offerRow);
    let revoked = 0, viewing = false;
    for (const o of offers) {
      const m = machine(o);
      const own = o.senderPersonId === personId && o.app === app;
      const facts = senderFacts(o, at);
      const takeBack = photoTakeBackFor(...facts);
      if (!photoItemWithdrawable(own, o.threadId === threadId, takeBack !== "TakeBackNothing")) continue;
      const seen = photoSenderViewFor(...facts);
      const listed = (await this.listed(o, seen, tx)).filter(l => l.seen !== "SeesTakenBack").map(l => l.photoId);
      const hit = photoIds === null ? listed : listed.filter(id => photoIds.includes(id));
      if (!hit.length) continue;
      const takenBack = [...new Set([...o.takenBackIds, ...hit])];
      const left = o.photoIds.map((id, i) => [id, o.photoSha256[i]!] as const).filter(([id]) => !hit.includes(id));
      const keepLeft = () => tx`update platform.photo_offers set photo_ids = ${left.map(k => k[0])}::text[], photo_sha256 = ${left.map(k => k[1])}::text[],
        taken_back_ids = ${takenBack}::text[], changed_at = ${new Date(at)} where id = ${o.id}`;
      if (takeBack === "TakeBackOffer") {
        if (!canRevokeOffer(m, own)) continue;
        if (o.phase !== "asking") await this.revokeItems(tx, o.id, hit);
        const live = o.phase === "asking" ? left.map(k => k[0])
          : (await this.o.store.ofOffer(o.id, tx)).filter(i => OPEN_ITEM_STATES.includes(i.state) && left.some(k => k[0] === i.photoId)).map(i => i.photoId);
        if (!live.length) {
          await this.move(tx, o, revokeOffer(m, own), true);
          await tx`update platform.photo_offers set taken_back_ids = ${takenBack}::text[] where id = ${o.id}`;
        } else await keepLeft();
      } else if (takeBack === "TakeBackQuietly") {
        if (!left.length) await tx`update platform.photo_offers set ended_by_sender = true, sender_notice = null, taken_back_ids = ${takenBack}::text[], changed_at = ${new Date(at)} where id = ${o.id}`;
        else await keepLeft();
      } else await tx`update platform.photo_offers set taken_back_ids = ${takenBack}::text[], changed_at = ${new Date(at)} where id = ${o.id}`;
      revoked++;
      if (seen === "SeesSent") viewing = true;
    }
    return { revoked, viewing };
  }

  async label(personId: string, app: AppId, n: number, label: string | null): Promise<PhotoLabelResult | "invalid"> {
    const slot = (await this.slots(personId, app)).find(s => s.n === n);
    if (!slot) return "not_found";
    return this.o.photos.setLabel(personId, app, slot.id, label === null ? null : label.toLowerCase());
  }

  async report(tx: SQL, offerId: string, recipientPersonId: string): Promise<PhotoOfferRow | undefined> {
    const o = await this.lockedOffer(tx, offerId);
    if (!o) return;
    const m = machine(o), byReceiver = o.recipientPersonId === recipientPersonId;
    if (!canReportOffer(m, byReceiver)) return;
    return this.move(tx, o, reportOffer(m, byReceiver));
  }

  async settle(tx: SQL, offerId: string): Promise<SettledOffer | undefined> {
    const o = await this.lockedOffer(tx, offerId);
    if (!o) return;
    const at = this.now(), m = machine(o);
    const result = (saved: PhotoOfferRow, viewLink?: string): SettledOffer => ({
      offerId: o.id, from: o.phase, phase: saved.phase, changed: saved.phase !== o.phase,
      notice: saved.senderNotice !== o.senderNotice && saved.senderNotice !== null ? NOTICE_FROM_ROW[saved.senderNotice] : "NoNotice",
      dueAt: saved.senderNotice !== o.senderNotice ? saved.noticeAt : null, ...(viewLink ? { viewLink } : {}),
      senderPersonId: o.senderPersonId, senderMemberId: o.senderMemberId, recipientPersonId: o.recipientPersonId, recipientMemberId: o.recipientMemberId,
      threadId: o.threadId, count: o.photoIds.length,
    });
    if (!offerOpen(m)) return result(o);
    await tx`update platform.photo_offers set checked_at = ${new Date(at)} where id = ${o.id}`;
    if (canLapseAnswer(m, at)) return result(await this.move(tx, o, lapseAnswer(m, at)));
    if (canEndOffer(m) && !(await this.offerAlive(o, tx))) return result(await this.move(tx, o, endOffer(m)));
    if (o.phase !== "reviewing") return result(o);
    for (const item of await this.o.store.ofOffer(o.id, tx)) if ((item.state === "pending" || item.state === "screening") && item.expiresAt <= at) await this.expire(item.id, tx);
    const items = (await this.o.store.ofOffer(o.id, tx)).filter(i => i.state !== "revoked");
    const approved = items.filter(i => i.state === "approved").length, rejected = items.filter(i => i.state === "rejected").length;
    const timedOut = items.filter(i => i.state === "expired").length;
    if (!canSettleReview(m, approved, rejected, timedOut, items.length)) return result(o);
    const saved = await this.move(tx, o, settleReview(m, approved, rejected, timedOut, items.length));
    if (saved.phase !== "ready") return result(saved);
    const viewLink = await this.issueLink(tx, { personId: o.recipientPersonId, app: o.app, purpose: "view", offerId: o.id, expiresAt: null });
    return { ...result(saved, viewLink), count: approved };
  }

  async renewViewLinks(personId: string, app: AppId): Promise<RenewedViewLink[]> {
    const offers = (await this.o.sql`select * from platform.photo_offers where app_id = ${app} and recipient_person_id = ${personId}::uuid
      and phase = 'ready' order by created_at, id`).map(offerRow);
    const out: RenewedViewLink[] = [];
    for (const o of offers) {
      const link = await this.o.sql.begin(async (tx: SQL) => {
        const locked = await this.lockedOffer(tx, o.id);
        if (!locked || !photoViewLinkRenewable(PHASE[locked.phase], locked.recipientPersonId === personId, await this.viewCurrent(locked, tx))) return undefined;
        await tx`delete from platform.photo_page_links where offer_id = ${o.id} and purpose = 'view'`;
        return this.issueLink(tx, { personId, app, purpose: "view", offerId: o.id, expiresAt: null });
      });
      if (link) out.push({ offerId: o.id, senderMemberId: o.senderMemberId, threadId: o.threadId, count: (await this.viewItems(o)).length, link });
    }
    return out;
  }

  async due(app: AppId, limit: number = PHOTO_EXPIRY_BATCH): Promise<string[]> {
    const at = new Date(this.now());
    const rows = await this.o.sql`select id from platform.photo_offers where app_id = ${app}
        and (phase = any(${WAITING_PHASES as string[]}::text[]) or (phase = 'ready' and party_ended))
      order by (case when phase = 'asking' and answer_by <= ${at} then 0 else 1 end), checked_at, id limit ${limit}`;
    return (rows as { id: string }[]).map(r => r.id);
  }

  async notices(app: AppId, limit: number = PHOTO_EXPIRY_BATCH): Promise<DueNotice[]> {
    const rows = (await this.o.sql`select * from platform.photo_offers where app_id = ${app} and sender_notice is not null and notice_at is not null
      and notice_sent_at is null and notice_at <= ${new Date(this.now())} order by notice_at, id limit ${limit}`).map(offerRow);
    const names = await this.names(app, rows.map(r => r.recipientMemberId));
    return rows.map(r => ({
      offerId: r.id, app: r.app, threadId: r.threadId, senderPersonId: r.senderPersonId, senderMemberId: r.senderMemberId, recipientMemberId: r.recipientMemberId,
      notice: NOTICE_FROM_ROW[r.senderNotice!], firstName: names.get(r.recipientMemberId)!,
    }));
  }

  async noticeSent(tx: SQL, offerId: string): Promise<boolean> {
    return (await tx`update platform.photo_offers set notice_sent_at = ${new Date(this.now())} where id = ${offerId} and sender_notice is not null and notice_sent_at is null returning id`).length === 1;
  }

  async purge(app: AppId): Promise<{ drafts: number; links: number; offers: number }> {
    const at = this.now();
    return this.o.sql.begin(async tx => ({
      drafts: (await tx`delete from platform.photo_relay_drafts where app_id = ${app} and shown_at <= ${new Date(at - photoDraftTtlMs)} returning id`).length,
      links: (await tx`delete from platform.photo_page_links where app_id = ${app} and expires_at is not null and expires_at <= ${new Date(at - PAGE_LINK_KEEP_MS)} returning id`).length,
      offers: (await tx`delete from platform.photo_offers where app_id = ${app} and phase = any(${FINAL_PHASES as string[]}::text[])
        and changed_at <= ${new Date(at - FINAL_OFFER_KEEP_MS)} and (sender_notice is null or notice_sent_at is not null) returning id`).length,
    }));
  }

  async offer(offerId: string, tx?: SQL): Promise<PhotoOfferRow | undefined> {
    const [r] = await (tx ?? this.o.sql)`select * from platform.photo_offers where id = ${offerId}`;
    return r ? offerRow(r) : undefined;
  }

  viewAllowed(o: PhotoOfferRow, deviceBound: boolean, sameDevice: boolean, current: boolean): boolean {
    return photoViewAllowed(PHASE[o.phase], deviceBound, sameDevice, current);
  }

  async viewItems(o: PhotoOfferRow, tx?: SQL): Promise<PhotoRelayItem[]> {
    const items = (await this.o.store.ofOffer(o.id, tx)).filter(i => i.state === "approved" && i.policyVersion === PHOTO_SEND_NOTICE.version && i.policyNotice === PHOTO_SEND_NOTICE.text);
    return (await this.currentPhotoIds(o, tx)).map(id => items.find(i => i.photoId === id)).filter((i): i is PhotoRelayItem => !!i);
  }

  async viewCurrent(o: PhotoOfferRow, tx?: SQL): Promise<boolean> {
    if (!this.enabled || !(await this.partiesCurrent(o, tx))) return false;
    return (await this.viewItems(o, tx)).length > 0;
  }

  async viewBytes(o: PhotoOfferRow, n: number) {
    const item = (await this.viewItems(o))[n - 1];
    if (!item) return;
    return this.o.photos.relayBytes(item.senderPersonId, item.app, item.photoId, item);
  }

  async ownBytes(personId: string, app: AppId, n: number, expectedSetSha?: string) {
    const rows = await this.o.photos.rows(personId, app);
    if (expectedSetSha !== undefined && !photoCheckSetMatches(expectedSetSha, photoSetSha(rows))) return;
    const row = rows[n - 1];
    if (!row) return;
    return this.o.photos.relayBytes(personId, app, row.id, row);
  }

  private async current(r: PhotoRelayItem, tx?: SQL): Promise<PhotoRow | undefined> {
    if (!this.enabled || r.policyVersion !== PHOTO_SEND_NOTICE.version || r.policyNotice !== PHOTO_SEND_NOTICE.text || r.expiresAt <= this.now() || r.state === "revoked" || r.state === "rejected" || !r.offerId) return;
    const offer = await this.offer(r.offerId, tx);
    if (!offer || (offer.phase !== "reviewing" && offer.phase !== "ready")) return;
    const p = await this.parties(r.app, r.threadId, r.senderPersonId, r.recipientPersonId, tx);
    if (!p || !sameParties({ ...p, threadId: r.threadId }, r)) return;
    const photo = await this.o.photos.relayPhoto(r.senderPersonId, r.app, r.photoId, r, tx);
    if (r.expiresAt <= this.now()) return;
    return photo;
  }

  async duePending(app: AppId): Promise<PhotoRelayItem[]> {
    return this.o.store.duePending(app, this.now(), PHOTO_EXPIRY_BATCH);
  }
  async expire(id: string, tx: SQL): Promise<boolean> {
    return this.o.store.locked(id, async (r, save) => {
      if (!r) return false;
      const selection = selectionState(r);
      const next = stepPhotoSelection(selection, { type: "expireSelection", now: this.now(), deadline: r.expiresAt });
      if (next === selection) return false;
      await save({ ...r, state: storedReview[next.review], screenAt: null });
      return true;
    }, tx);
  }
  async review(id: string, reviewer: PhotoReviewer, decision: "safe" | "unsafe" | "unknown", tx?: SQL): Promise<boolean> {
    return this.o.store.locked(id, async (r, save, context) => {
      if (!r || !this.enabled || r.policyVersion !== PHOTO_SEND_NOTICE.version || r.policyNotice !== PHOTO_SEND_NOTICE.text) return false;
      const selection = selectionState(r);
      if (!photoReviewable(selection)) return false;
      const reviewerAuthorized = reviewerSafe(reviewer);
      const choice = decision === "safe" ? "ApprovePhoto" : decision === "unsafe" ? "RejectPhoto" : "KeepPending";
      const initiallyLive = reviewerAuthorized && choice !== "KeepPending" && !(this.now() >= r.expiresAt);
      if (!photoReviewMayProceed(selection, choice, reviewerAuthorized, initiallyLive)) return false;
      const currentItem = !reviewNeedsCurrent(choice) || !!(await this.current(r, context));
      const next = stepPhotoSelection(selection, {
        type: "recordReview", choice, reviewerAuthorized, currentItem, itemLive: currentItem && !(this.now() >= r.expiresAt),
      });
      if (next === selection) return false;
      await save({ ...r, state: storedReview[next.review], reviewId: `prv_${opaque()}`, reviewedAt: this.now(), reviewerId: reviewer.id });
      return true;
    }, tx);
  }
  async reviewAuthorized(id: string, reviewer: PhotoReviewer, tx?: SQL): Promise<boolean> {
    return this.o.store.locked(id, async (r, _save, context) => {
      if (!r) return false;
      const selection = selectionState(r);
      if (!photoReviewable(selection) || !(await this.current(r, context))) return false;
      const reviewerAuthorized = reviewerSafe(reviewer);
      const enabled = reviewerAuthorized && this.enabled;
      const itemLive = enabled && r.expiresAt > this.now();
      const samePolicy = itemLive && r.policyVersion === PHOTO_SEND_NOTICE.version && r.policyNotice === PHOTO_SEND_NOTICE.text;
      return reviewAuthorizationCurrent(selection, enabled, reviewerAuthorized, itemLive, samePolicy);
    }, tx);
  }
  async reviewBytes(id: string, reviewer: PhotoReviewer) {
    return this.o.store.locked(id, async (r, _save, context) => {
      if (!r) return;
      const selection = selectionState(r);
      if (!photoHeldForReview(selection) || !(await this.current(r, context))) return;
      const reviewerAuthorized = reviewerSafe(reviewer);
      if (!reviewPreviewAllowed(selection, reviewerAuthorized, reviewerAuthorized && !(r.expiresAt <= this.now()))) return;
      const bytes = await this.o.photos.relayBytes(r.senderPersonId, r.app, r.photoId, r, context);
      return reviewPreviewAllowed(selection, reviewerAuthorized, r.expiresAt > this.now()) ? bytes : undefined;
    });
  }
  async item(id: string) { return this.o.store.locked(id, async r => r); }
  async held(app: AppId): Promise<HeldPhoto[]> {
    const held: HeldPhoto[] = [];
    for (const r of await this.o.store.pending(app)) {
      if (photoHeldForReview(selectionState(r)) && await this.current(r)) held.push({ id: r.id, app: r.app, photoId: r.photoId, threadId: r.threadId, senderMemberId: r.senderMemberId, recipientMemberId: r.recipientMemberId, offerId: r.offerId, createdAt: r.consentedAt, deadline: r.expiresAt });
    }
    return held;
  }
}
function sameParties(a: PhotoRelayParties, b: PhotoRelayParties) { return a.threadId === b.threadId && a.senderPersonId === b.senderPersonId && a.recipientPersonId === b.recipientPersonId && a.senderMemberId === b.senderMemberId && a.recipientMemberId === b.recipientMemberId; }
