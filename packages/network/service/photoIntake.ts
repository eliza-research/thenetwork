// Photos sent to the shared line by text (MMS or iMessage attachments; critical path item 5).
//
// Order of checks for a message with attachments, before any byte is fetched:
//  1. The sender is a person with a live slop.date membership. Anyone else: the photo is dropped
//     (never fetched, never stored) and nothing is answered about it.
//  2. PhotoService.mayTake: photos are on, the person is not banned, and the person is an adult (the
//     lowest age they ever stated is 18 or more, never unknown; no failed staff age check). A member
//     aged 13-17, or of unknown age, gets one plain answer a day and the photo is dropped: never
//     fetched, never stored, never rated. A banned person gets no answer.
//  3. The photo consent (PHOTO_CONSENT, the same text as the site) is asked once by text. Until the
//     person answers YES, the photo is dropped and nothing is kept; they send it again after YES.
//     Only the core reply parser's "yes" is consent (AGENTS.md decision 11). The consent is stored on
//     the slop membership (profile.photoConsent), so leaving slop.date clears it.
//  4. With consent: each attachment (at most PHOTO_MAX_PER_MESSAGE) is fetched with a byte cap and goes
//     through PhotoService.upload, which checks everything again (type on the bytes, size, count),
//     strips metadata, stores it privately and rates the member (adults only).
import { classifyYesNo } from "@thenetwork/core";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { PHOTO_CONSENT, PHOTO_MAX_BYTES, type PhotoRefusal, type PhotoService } from "../../platform/src/photos.ts";
import type { PeopleStore } from "../../platform/src/store.ts";
import { DAY } from "@thenetwork/core";

/** The app that takes photos by text. */
export const PHOTO_APP: AppId = "slop";
/** Attachments taken from one message. */
export const PHOTO_MAX_PER_MESSAGE = 4;
/** Membership states that may send photos. */
const LIVE = new Set(["active", "paused", "onboarding"]);

/** Draft copy (needs the founder's approval and the CONTRIBUTING 3.5 videos). */
export const PHOTO_TEXT = {
  ask: `Before I keep any photos: ${PHOTO_CONSENT.text} Reply YES to agree, then send the photo again. Reply NO and I keep none.`,
  agreed: "Thanks. Send your photos any time. You can see or delete them at slop.date/settings.",
  declined: "OK. I will not keep your photos.",
  stored: (n: number) => (n === 1 ? "Got it. I saved your photo privately." : `Got it. I saved ${n} photos privately.`),
  notAdult: "I can't keep photos for you here.",
  badPhoto: "I could not use that photo. Send a JPEG, PNG or WebP photo of up to 8 MB.",
  tooMany: "You have the most photos I can keep. Delete one at slop.date/settings first.",
} as const;

export type PhotoIntakeOutcome =
  | { outcome: "not_member" | "asked" | "ask_skipped" }
  | { outcome: "discarded"; reason: PhotoRefusal }
  | { outcome: "stored"; stored: number; refused: PhotoRefusal[] };

export interface PhotoIntakeDeps {
  people: PeopleStore;
  accounts: Accounts;
  photos: PhotoService;
  /** The keyed phone hash (pending texts and rate limits). */
  phoneKey: (e164: string) => string;
  now: () => number;
  /** One attachment's bytes, at most `maxBytes` (undefined: not fetched or too large). Fakes in the simulation; never called before the checks pass. */
  fetchMedia: (url: string, maxBytes: number) => Promise<Uint8Array | "too_large" | undefined>;
  /** One fixed text to the sender (not stored as a member message). */
  reply: (e164: string, text: string, key: string) => Promise<void>;
  log?: (s: string) => void;
}

export class PhotoIntake {
  constructor(private readonly d: PhotoIntakeDeps) {}

  /** The person's live slop membership, if any. */
  private async member(e164: string) {
    const person = await this.d.accounts.personFor(e164);
    const m = person && (await this.d.people.getMembership(person.id, PHOTO_APP));
    return person && m && LIVE.has(m.state) ? { person, m } : undefined;
  }

  /** Attachments on a message from `e164` (ref: the inbound message id, for reply keys). */
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
    for (const url of mediaUrls.slice(0, PHOTO_MAX_PER_MESSAGE)) {
      const bytes = await this.d.fetchMedia(url, PHOTO_MAX_BYTES).catch(e => { this.d.log?.(`[photos] attachment fetch failed: ${(e as Error).message}`); return undefined; });
      if (bytes === "too_large") { no.push("too_large"); continue; }
      if (!bytes) { no.push("not_found"); continue; }
      const r = await this.d.photos.upload(who.person.id, PHOTO_APP, bytes, PHOTO_CONSENT.version);
      if (r.ok) stored++; else no.push(r.reason);
    }
    const text = stored ? PHOTO_TEXT.stored(stored) : no.includes("too_many") ? PHOTO_TEXT.tooMany : PHOTO_TEXT.badPhoto;
    await this.d.reply(e164, text, `photo:${ref}`);
    return { outcome: "stored", stored, refused: no };
  }

  /**
   * The answer to the photo consent ask. True when it was one (YES or NO); false when nothing is
   * pending or the answer is unclear (the message then goes on as a normal message).
   */
  async consentAnswer(e164: string, text: string, ref: string): Promise<boolean> {
    const key = this.d.phoneKey(e164);
    const p = await this.d.people.getPending(key, "photo_consent", PHOTO_APP);
    if (!p || this.d.now() - p.at > DAY) return false;
    const a = classifyYesNo(text);
    if (a === "unsure") return false;
    await this.d.people.deletePending(key, "photo_consent", PHOTO_APP);
    const who = await this.member(e164);
    if (a === "yes" && who && !(await this.d.photos.mayTake(who.person.id, PHOTO_APP))) {
      await this.d.people.putMembership({ ...who.m, profile: { ...who.m.profile, photoConsent: PHOTO_CONSENT.version, photoConsentAt: this.d.now(), photoConsentSource: "text" } });
      await this.d.reply(e164, PHOTO_TEXT.agreed, `sys:${ref}`);
    } else if (a === "no") {
      await this.d.reply(e164, PHOTO_TEXT.declined, `sys:${ref}`);
    }
    return true;
  }

  /** One text a day per number and kind. True when it was sent. */
  private async once(e164: string, kind: string, text: string, ref: string): Promise<boolean> {
    const { count } = await this.d.people.hit(`${kind}:${this.d.phoneKey(e164)}`, DAY, this.d.now());
    if (count > 1) return false;
    await this.d.reply(e164, text, `sys:${ref}`);
    return true;
  }
}

/**
 * The default attachment fetch: https only, no redirects, a 15 s timeout and a byte cap while reading
 * (a body past the cap is abandoned). The URL comes from a signed Blooio webhook.
 */
export async function fetchMediaCapped(url: string, maxBytes: number): Promise<Uint8Array | "too_large" | undefined> {
  let u: URL;
  try { u = new URL(url); } catch { return undefined; }
  if (u.protocol !== "https:") return undefined;
  const res = await fetch(u, { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!res.ok || !res.body) return undefined;
  if (Number(res.headers.get("content-length") ?? "0") > maxBytes) return "too_large";
  const parts: Uint8Array[] = [];
  let n = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > maxBytes) { await reader.cancel().catch(() => {}); return "too_large"; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
