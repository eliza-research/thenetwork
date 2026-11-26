import { createHash } from "node:crypto";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { readCapped } from "../../platform/src/body.ts";
import { photoMaxPerMessage } from "../../core/src/generated/photoPolicy.ts";
import { PHOTO_CONSENT, PHOTO_MAX_BYTES, type PhotoRefusal, type PhotoService } from "../../platform/src/photos.ts";
import type { PhotoUploadLinks, UploadLinkIssue } from "../../platform/src/photo-upload-link.ts";
import type { MembershipState, PeopleStore } from "../../platform/src/store.ts";
import { DAY } from "@thenetwork/core";

export const PHOTO_APP: AppId = "slop";
export const PHOTO_MAX_PER_MESSAGE = photoMaxPerMessage;
export const LIVE_MEMBERSHIP_STATES: readonly MembershipState[] = ["active", "paused", "onboarding"];

export const PHOTO_TEXT = {
  ask: `Before I keep any photos: ${PHOTO_CONSENT.text} Reply YES PHOTOS to agree and I will text you a private link to add them. Reply NO PHOTOS and I keep none.`,
  link: (url: string) => `Here is your private link to add up to 4 photos, 4 MB each and 8 MB in all. It works once, for 15 minutes: ${url} To delete your photos, text DELETE PHOTOS. To request a copy, email help@ntwrk.party.`,
  agreed: "Thanks. To delete your photos, text DELETE PHOTOS. To request a copy, email help@ntwrk.party.",
  linkLimit: "You asked for several photo links today. Ask again tomorrow.",
  declined: "OK. I will not keep your photos.",
  stored: (n: number) => (n === 1 ? "Got it. I saved your photo privately." : `Got it. I saved ${n} photos privately.`),
  notAdult: "I can't keep photos for you here.",
  badPhoto: "I could not use that photo. Send a JPEG, PNG or WebP photo of up to 8 MB.",
  tooMany: "You have the most photos I can keep. Text DELETE PHOTOS to delete them before you send more.",
  deleted: (n: number) => (n === 1 ? "I deleted your photo and the private rating made from it." : `I deleted your ${n} photos and the private rating made from them.`),
  noneToDelete: "You have no photos with me.",
} as const;

function photoBatchOf(ref: string): string {
  return createHash("sha256").update(`photo-batch:${ref}`).digest("hex").slice(0, 32);
}

function photoAddRequest(text: string): boolean {
  return /^\s*(?:add|upload)\s+(?:my\s+|a\s+|some\s+)?(?:photos?|pics?|pictures?)[\s.!]*$/i.test(text);
}

function photoDeleteRequest(text: string): boolean {
  return /^\s*(?:delete|remove|erase)\s+(?:all\s+)?(?:of\s+)?(?:my\s+)?(?:photos?|pics?|pictures?)[\s.!]*$/i.test(text);
}

export function photoConsentReply(text: string): "yes" | "no" | undefined {
  const m = /^\s*(yes|no)[\s,.:!-]+photos?[\s.!]*$/i.exec(text);
  return m ? (m[1]!.toLowerCase() as "yes" | "no") : undefined;
}

export type PhotoIntakeOutcome =
  | { outcome: "not_member" | "asked" | "ask_skipped" }
  | { outcome: "discarded"; reason: PhotoRefusal }
  | { outcome: "stored"; stored: number; refused: PhotoRefusal[] };

export interface PhotoIntakeDeps {
  people: PeopleStore;
  accounts: Accounts;
  photos: PhotoService;
  links: Pick<PhotoUploadLinks, "issue" | "refusal" | "recordConsent">;
  phoneKey: (e164: string) => string;
  now: () => number;
  fetchMedia: (url: string, maxBytes: number) => Promise<Uint8Array | "too_large" | undefined>;
  reply: (e164: string, text: string, key: string) => Promise<void>;
  log?: (s: string) => void;
}

export class PhotoIntake {
  constructor(private readonly d: PhotoIntakeDeps) {}

  private async member(e164: string) {
    const person = await this.d.accounts.personFor(e164);
    const m = person && (await this.d.people.getMembership(person.id, PHOTO_APP));
    return person && m && LIVE_MEMBERSHIP_STATES.includes(m.state) ? { person, m } : undefined;
  }

  async photosIn(e164: string, mediaUrls: readonly string[], ref: string): Promise<PhotoIntakeOutcome> {
    const who = await this.member(e164);
    if (!who) { this.d.log?.("[photos] a photo by text from someone with no slop membership: dropped, not fetched"); return { outcome: "not_member" }; }
    const refused = await this.d.photos.mayTake(who.person.id, PHOTO_APP);
    if (refused) {
      this.d.log?.(`[photos] a photo by text refused (${refused}): dropped, not fetched, not stored`);
      if (refused === "adults_only" || refused === "not_verified") await this.once(e164, "photo_not_adult", PHOTO_TEXT.notAdult, ref);
      return { outcome: "discarded", reason: refused };
    }
    if (who.m.profile.photoConsent !== PHOTO_CONSENT.version) {
      await this.d.people.putPending({ phoneHash: this.d.phoneKey(e164), kind: "photo_consent", app: PHOTO_APP, name: null, age: null, at: this.d.now() });
      return { outcome: (await this.once(e164, "photo_consent_ask", PHOTO_TEXT.ask, ref)) ? "asked" : "ask_skipped" };
    }
    let stored = 0;
    const no: PhotoRefusal[] = [];
    const batch = photoBatchOf(ref);
    for (const url of mediaUrls.slice(0, PHOTO_MAX_PER_MESSAGE)) {
      const bytes = await this.d.fetchMedia(url, PHOTO_MAX_BYTES).catch(e => { this.d.log?.(`[photos] attachment fetch failed: ${(e as Error).message}`); return undefined; });
      if (bytes === "too_large") { no.push("too_large"); continue; }
      if (!bytes) { no.push("not_found"); continue; }
      const r = await this.d.photos.upload(who.person.id, PHOTO_APP, bytes, PHOTO_CONSENT.version, undefined, batch);
      if (r.ok) stored++; else no.push(r.reason);
    }
    const text = stored ? PHOTO_TEXT.stored(stored) : no.includes("too_many") ? PHOTO_TEXT.tooMany : PHOTO_TEXT.badPhoto;
    await this.d.reply(e164, text, `photo:${ref}`);
    return { outcome: "stored", stored, refused: no };
  }

  async consentAnswer(e164: string, text: string, ref: string, app: AppId = PHOTO_APP): Promise<boolean> {
    if (app !== PHOTO_APP) return false;
    const a = photoConsentReply(text);
    if (!a) return false;
    const key = this.d.phoneKey(e164);
    const p = await this.d.people.getPending(key, "photo_consent", PHOTO_APP);
    if (!p || this.d.now() - p.at > DAY) return false;
    await this.d.people.deletePending(key, "photo_consent", PHOTO_APP);
    const who = await this.member(e164);
    if (a === "yes") {
      const refused = who ? (await this.d.links.refusal(who.person.id, PHOTO_APP))?.reason : "not_member";
      if (who && !refused && await this.d.links.recordConsent(who.person.id, PHOTO_APP)) {
        const link = await this.d.links.issue(who.person.id, PHOTO_APP, "text");
        await this.d.reply(e164, link.ok ? `Thanks. ${PHOTO_TEXT.link(link.url)}` : PHOTO_TEXT.agreed, `sys:${ref}`);
      } else if (refused && refused !== "banned" && refused !== "not_member") {
        await this.once(e164, "photo_not_adult", PHOTO_TEXT.notAdult, ref);
      }
    } else {
      await this.d.reply(e164, PHOTO_TEXT.declined, `sys:${ref}`);
    }
    return true;
  }

  async addRequest(e164: string, text: string, ref: string, app: AppId = PHOTO_APP): Promise<boolean> {
    if (app !== PHOTO_APP || !photoAddRequest(text)) return false;
    const who = await this.member(e164);
    if (!who) return false;
    const refused = (await this.d.links.refusal(who.person.id, PHOTO_APP))?.reason;
    if (refused) {
      if (refused !== "banned") await this.once(e164, "photo_not_adult", PHOTO_TEXT.notAdult, ref);
      return true;
    }
    if (who.m.profile.photoConsent !== PHOTO_CONSENT.version) {
      await this.d.people.putPending({ phoneHash: this.d.phoneKey(e164), kind: "photo_consent", app: PHOTO_APP, name: null, age: null, at: this.d.now() });
      await this.d.reply(e164, PHOTO_TEXT.ask, `sys:${ref}`);
      return true;
    }
    await this.d.reply(e164, this.linkText(await this.d.links.issue(who.person.id, PHOTO_APP, "text")), `sys:${ref}`);
    return true;
  }

  async deleteRequest(e164: string, text: string, ref: string): Promise<boolean> {
    if (!photoDeleteRequest(text)) return false;
    const person = await this.d.accounts.personFor(e164);
    if (!person) return false;
    const n = await this.d.photos.deleteFor(person.id);
    await this.d.reply(e164, n ? PHOTO_TEXT.deleted(n) : PHOTO_TEXT.noneToDelete, `sys:${ref}`);
    return true;
  }

  private linkText(link: UploadLinkIssue): string {
    if (link.ok) return PHOTO_TEXT.link(link.url);
    return link.reason === "daily_limit" ? PHOTO_TEXT.linkLimit : PHOTO_TEXT.notAdult;
  }

  private async once(e164: string, kind: string, text: string, ref: string): Promise<boolean> {
    const { ok } = await this.d.people.hit(`${kind}:${this.d.phoneKey(e164)}`, DAY, this.d.now(), { minGapMs: DAY });
    if (!ok) return false;
    await this.d.reply(e164, text, `sys:${ref}`);
    return true;
  }
}

export async function fetchMediaCapped(url: string, maxBytes: number): Promise<Uint8Array | "too_large" | undefined> {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  if (u.protocol !== "https:") return undefined;
  const res = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!res.ok || !res.body) return undefined;
  return readCapped(res, maxBytes);
}
