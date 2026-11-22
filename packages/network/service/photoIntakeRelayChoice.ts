import type { MemberId } from "@thenetwork/core";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { photoRelayEntryFor, photoRelayOfferLive, photoWithdrawalFor, type PhotoRelayEntry, type PhotoWithdrawal } from "../../core/src/generated/photoRelayItem.ts";
import type { AppId } from "../../platform/src/apps.ts";
import type { PhotoRelayService } from "../../platform/src/photo-relay.ts";
import type { PhotoService } from "../../platform/src/photos.ts";
import type { NetworkRuntime } from "./runtime.ts";

export function photoChoice(text: string): number {
  const m = /\b(?:photo|pic|picture|selfie)\s*(?:#|no\.?|number)?\s*(\d{1,2})\b/i.exec(text ?? "");
  return m ? Number(m[1]) : 0;
}

export const PHOTO_CHOICE_TEXT = {
  off: "I can't send photos to a match yet.",
  addFirst: "You have no photos with me yet. Text ADD PHOTOS and I will send you a private link to add them.",
  list: (count: number, notice: string) =>
    `You have ${count === 1 ? "1 photo" : `${count} photos`} with me, numbered from the oldest. ${notice} To agree and choose one, say "send them my photo" and its number, from 1 to ${count}.`,
  unknown: "I could not match that number to the photos I listed. Say \"send them my photo\" to see the list again.",
  recorded: "Thanks. A person on the safety team checks the photo first. I will send it after that check.",
  refused: "I could not choose that photo. Say \"send them my photo\" to see the list again.",
  withdrawn: "Okay, I won't send your photo.",
  noneToWithdraw: "No photo of yours is waiting to go to this match.",
  expired: "The safety team could not check your photo in time, so I didn't send it. You can choose it again.",
} as const;

export function photoWithdrawRequest(text: string): boolean {
  const t = (text ?? "").replace(/[\u2019\u2018`\u00b4]/g, "'").toLowerCase();
  return /\b(?:don'?t|dont|do not|never|stop|cancel|hold off|withdraw|take back|unsend|changed my mind|scratch)\b/.test(t)
    && /\b(?:photos?|pics?|pictures?|selfies?)\b/.test(t);
}

export type PhotoWithdrawResult = { entry: PhotoWithdrawal; notice: string; commit: (tx: SQL) => Promise<void> };

export async function withdrawPhoto(d: Pick<PhotoRelayChoiceDeps, "relay">, input: { app: AppId; personId: string; threadId: string | undefined }): Promise<PhotoWithdrawResult> {
  const { app, personId, threadId } = input;
  const ids = threadId ? await d.relay.withdrawable(app, personId, threadId) : [];
  const entry = photoWithdrawalFor(ids.length);
  const commit = async (tx: SQL) => {
    if (!threadId || !ids.length) return;
    if ((await d.relay.withdraw(tx, app, personId, threadId, ids)) < ids.length) throw new Error("Photo item changed before the withdrawal");
  };
  return { entry, notice: entry === "PhotoWithdrawn" ? PHOTO_CHOICE_TEXT.withdrawn : PHOTO_CHOICE_TEXT.noneToWithdraw, commit };
}

export interface PhotoRelayChoiceDeps {
  sql: SQL;
  photos: PhotoService;
  relay: PhotoRelayService;
  now: () => number;
}

export type PhotoChoiceResult = { entry: PhotoRelayEntry; decision: "none" | "hold" | "block"; notice: string; commit?: (tx: SQL) => Promise<void> };

export async function choosePhoto(d: PhotoRelayChoiceDeps, input: { app: AppId; personId: string; threadId: string; text: string; requestId: string }): Promise<PhotoChoiceResult> {
  const { app, personId, threadId } = input;
  const at = d.now(), choice = photoChoice(input.text);
  const notice = d.relay.enabled ? await d.relay.noticeFor(app, personId, threadId) : undefined;
  const photos = notice ? await d.photos.list(personId, app) : [];
  const [offer] = notice && choice > 0
    ? await d.sql`select photo_ids, policy_version, policy_notice, offered_at from platform.photo_relay_offers
        where sender_person_id = ${personId}::uuid and app_id = ${app} and thread_id = ${threadId}`
    : [];
  const offered = (offer?.photo_ids ?? []) as string[];
  const live = !!offer && photoRelayOfferLive(new Date(offer.offered_at).getTime(), at, offer.policy_version === notice?.version && offer.policy_notice === notice?.policyNotice);
  const entry = photoRelayEntryFor(!!notice, false, photos.length, choice, live, offered.length);
  switch (entry) {
    case "OfferPhotoChoices": {
      const ids = photos.map(p => p.id);
      const commit = async (tx: SQL) => { await tx`insert into platform.photo_relay_offers (sender_person_id, app_id, thread_id, photo_ids, policy_version, policy_notice, offered_at)
        values (${personId}::uuid, ${app}, ${threadId}, ${ids}, ${notice!.version}, ${notice!.policyNotice}, ${new Date(at)})
        on conflict (sender_person_id, app_id, thread_id) do update set photo_ids = excluded.photo_ids, policy_version = excluded.policy_version,
          policy_notice = excluded.policy_notice, offered_at = excluded.offered_at`; };
      return { entry, decision: "none", notice: PHOTO_CHOICE_TEXT.list(ids.length, notice!.notice), commit };
    }
    case "RecordPhotoChoice": {
      const prepared = await d.relay.prepareSelection(app, personId, threadId, offered[choice - 1]!, notice!.version, true, input.requestId);
      if (!prepared || prepared.item.state !== "pending") return { entry, decision: "block", notice: PHOTO_CHOICE_TEXT.refused };
      const commit = async (tx: SQL) => {
        const item = await d.relay.recordSelection(prepared, tx);
        if (!item || item.state !== "pending") throw new Error("Photo choice changed before commit");
      };
      return { entry, decision: "hold", notice: PHOTO_CHOICE_TEXT.recorded, commit };
    }
    case "AskForPhotosFirst": return { entry, decision: "block", notice: PHOTO_CHOICE_TEXT.addFirst };
    case "PhotoChoiceUnknown": return { entry, decision: "block", notice: PHOTO_CHOICE_TEXT.unknown };
    case "PhotoRelayOff": case "DeliverApprovedPhoto": return { entry, decision: "block", notice: PHOTO_CHOICE_TEXT.off };
    default: { const _exhaustive: never = entry; return _exhaustive; }
  }
}

export interface PhotoExpiryDeps {
  sql: SQL;
  relay: PhotoRelayService;
  runtimeOfMember: (app: AppId, memberId: string) => Promise<NetworkRuntime | undefined>;
  log: (line: string) => void;
}

export async function expirePendingPhotos(d: PhotoExpiryDeps, app: AppId): Promise<number> {
  let expired = 0;
  for (const item of await d.relay.duePending(app)) {
    try {
      const rt = await d.runtimeOfMember(app, item.senderMemberId);
      const expire = async (tx: SQL) => { if (!(await d.relay.expire(item.id, tx))) throw new Error("Photo item changed before its expiry"); };
      if (rt) {
        await rt.unitOfWork(net => {
          net.photoRelayExpired(item.senderMemberId as MemberId, item.id, PHOTO_CHOICE_TEXT.expired);
          rt.unit.completeAction = expire;
        });
      } else {
        await d.sql.begin(expire);
      }
      expired++;
    } catch (e) {
      d.log(`[photo-relay] the expiry of ${item.id} on ${app} waits for the next tick: ${(e as Error).message}`);
    }
  }
  return expired;
}
