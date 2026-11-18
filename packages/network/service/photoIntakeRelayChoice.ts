// spec/photoRelayItem.md, "A photo request delivers an approved choice, lists the photos, or records the named photo"
//
// The conversation step of selected-photo relay (/internal/relay, relay-endpoint.ts). "send them my
// photo" lists the member's own photos by number with the current notice and keeps that list for the
// match; "send them my photo 2" records the second listed photo as one pending item through
// PhotoRelayService.select, which checks the parties, the photo and the notice again. Staff review the
// item; the existing release path delivers it. The list holds photo ids only, never bytes or links.
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { photoRelayEntryFor, photoRelayOfferLive, type PhotoRelayEntry } from "../../core/src/generated/photoRelayItem.ts";
import type { AppId } from "../../platform/src/apps.ts";
import type { PhotoRelayService } from "../../platform/src/photo-relay.ts";
import type { PhotoService } from "../../platform/src/photos.ts";

/** The number a member names in a photo request ("send them my photo 2", "share my photo #3 with her"), or 0. */
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
} as const;

export interface PhotoRelayChoiceDeps {
  sql: SQL;
  photos: PhotoService;
  relay: PhotoRelayService;
  now: () => number;
}

export type PhotoChoiceResult = { entry: PhotoRelayEntry; decision: "none" | "hold" | "block"; notice: string };

/** The member's photo request when no approved item is ready for this match. */
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
      await d.sql`insert into platform.photo_relay_offers (sender_person_id, app_id, thread_id, photo_ids, policy_version, policy_notice, offered_at)
        values (${personId}::uuid, ${app}, ${threadId}, ${ids}, ${notice!.version}, ${notice!.policyNotice}, ${new Date(at)})
        on conflict (sender_person_id, app_id, thread_id) do update set photo_ids = excluded.photo_ids, policy_version = excluded.policy_version,
          policy_notice = excluded.policy_notice, offered_at = excluded.offered_at`;
      return { entry, decision: "none", notice: PHOTO_CHOICE_TEXT.list(ids.length, notice!.notice) };
    }
    case "RecordPhotoChoice": {
      const item = await d.relay.select(app, personId, threadId, offered[choice - 1]!, notice!.version, true, input.requestId);
      return item && item.state === "pending"
        ? { entry, decision: "hold", notice: PHOTO_CHOICE_TEXT.recorded }
        : { entry, decision: "block", notice: PHOTO_CHOICE_TEXT.refused };
    }
    case "AskForPhotosFirst": return { entry, decision: "block", notice: PHOTO_CHOICE_TEXT.addFirst };
    case "PhotoChoiceUnknown": return { entry, decision: "block", notice: PHOTO_CHOICE_TEXT.unknown };
    case "PhotoRelayOff": case "DeliverApprovedPhoto": return { entry, decision: "block", notice: PHOTO_CHOICE_TEXT.off };
    default: { const _exhaustive: never = entry; return _exhaustive; }
  }
}
