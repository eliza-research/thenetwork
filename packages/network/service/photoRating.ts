// Photos on the live path (slop.date; PRD 40.5, 37.1 items 5 and 7). Three pieces the service wires:
//  - The rater: the engine's AppearanceRater (the Clef rater from CLOUDFLARE_AI_TOKEN and
//    CLOUDFLARE_ACCOUNT_ID, always behind the engine's adults-only guard) adapted to the platform's
//    PhotoRater. Without that environment there is no rater ("none": nothing is rated).
//  - The writer: one agent_private facet per member, '<member>:appearance', with the slop pack's
//    'appearance:*' tags (face, body, overall on the z-like scale, conf, bodyType, bodyTypeConf), made
//    by the engine's appearanceFacet. The pack reads it from the snapshot (profile.ts parseAppearance).
//  - The probe photo check (SLOP_PROBE_PHOTO=1 only, off by default): at send time a probe may carry
//    one approved photo of the other person when both are verified adults, neither is held or banned,
//    the photo is still there and approved, and the caption passes the leak guard and appearanceLeak.
// Nothing here is member-facing: no score, body type or rating word ever reaches a member.
import type { Facet, MemberId } from "@thenetwork/core";
import { appearanceFacet, appearanceLeak, APPEARANCE_PREFIX, canRatePhotos, isBodyType, type AppearanceRater, type AppearanceScore } from "@thenetwork/engine/src/packs/slop/appearance.ts";
import { makeClefRaterFromEnv } from "@thenetwork/engine/src/packs/slop/clef.ts";
import type { PhotoRater, PhotoScores } from "../../platform/src/photos.ts";

/** The flag that lets a slop probe carry a photo. Off unless exactly "1". */
export const PROBE_PHOTO_FLAG = "SLOP_PROBE_PHOTO";
export const probePhotoOn = (env: Record<string, string | undefined> = process.env) => env[PROBE_PHOTO_FLAG] === "1";

/** The engine rater from the environment: the Clef rater when its token and account are set, else undefined (no rater). */
export function appearanceRaterFromEnv(env: Record<string, string | undefined> = process.env): AppearanceRater | undefined {
  if (!env.CLOUDFLARE_AI_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) return undefined;
  return makeClefRaterFromEnv(env);
}

/** The platform rater from the environment (server.ts): undefined without the rater's environment. */
export function photoRaterFromEnv(env: Record<string, string | undefined> = process.env): PhotoRater | undefined {
  const r = appearanceRaterFromEnv(env);
  return r && photoRaterFrom(r);
}

const clampZ = (x: number) => Math.max(-3, Math.min(3, Number.isFinite(x) ? x : 0));
const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/**
 * An engine AppearanceRater as the platform's PhotoRater. The platform already checked that the
 * person is a verified adult (lowest age 18+, no failed age check); the engine rater checks the
 * subject again before it reads any photo. Null from the engine (refused, or no usable photo) is
 * "could not rate" (tried again later).
 */
export function photoRaterFrom(rater: AppearanceRater): PhotoRater {
  return {
    id: rater.id,
    async rate(photos, subject) {
      const s = await rater.rate({ age: subject.age, ageVerified: true }, photos.map(p => ({ id: p.id, bytes: p.bytes })));
      return s ? scoresOf(s) : undefined;
    },
  };
}

/** Engine scores to the platform's (the same scale: z-like, clamped; confidence 0..1). */
export function scoresOf(s: AppearanceScore): PhotoScores {
  return {
    face: clampZ(s.face), body: clampZ(s.body), overall: clampZ(s.overall), confidence: clamp01(s.confidence), model: s.model,
    ...(s.bodyType ? { bodyType: s.bodyType, bodyTypeConfidence: clamp01(s.bodyTypeConfidence ?? s.confidence) } : {}),
  };
}

/**
 * The member's rating facet (the engine's appearanceFacet: id '<member>:appearance', agent_private,
 * value "photo rating (internal)"). Throws for anyone who is not a verified adult. A body type the
 * engine does not know is dropped.
 */
export function appearanceRatingFacet(memberId: MemberId, age: number, s: PhotoScores, at: number): Facet {
  const bodyType = isBodyType(s.bodyType) ? s.bodyType : undefined;
  return appearanceFacet(memberId, { age, ageVerified: true }, {
    face: clampZ(s.face), body: clampZ(s.body), overall: clampZ(s.overall), confidence: clamp01(s.confidence), model: s.model,
    ...(bodyType ? { bodyType, bodyTypeConfidence: clamp01(s.bodyTypeConfidence ?? s.confidence) } : {}),
  }, at);
}

/** The facet id of a member's rating, and the ids of the first rater's per-photo facets (removed). */
export const appearanceFacetId = (memberId: MemberId) => `${memberId}:appearance`;
export const legacyRatingLike = (memberId: MemberId) => `${memberId}:photo:%`;

/** Everything the probe photo check needs, gathered by the service at send time. */
export interface ProbePhotoFacts {
  /** SLOP_PROBE_PHOTO is "1". */
  flag: boolean;
  app: string;
  /** The recipient's and the pictured person's lowest ages (null: unknown), and whether each passes the app's adult check. */
  recipient: { age: number | null; verified: boolean; banned: boolean };
  subject: { age: number | null; verified: boolean; banned: boolean };
  /** The Network's send-time recipient policy for this probe about the subject (held, watch, blocks, minors). */
  policy: { ok: boolean; reason?: string };
  /** The photo to attach: still stored and approved. */
  photo?: { id: string; moderation: string };
  /** The caption (the probe text) and what the leak guard found in it. */
  caption: string;
  guard: string[];
  /** The subject's stored rating tags (an exact tag in the caption is a leak too). */
  scoreTags?: readonly string[];
}

/** Whether a probe may carry the subject's photo now, and why not. */
export function probePhotoCheck(f: ProbePhotoFacts): { ok: true } | { ok: false; reason: string } {
  const no = (reason: string) => ({ ok: false as const, reason });
  if (!f.flag) return no("flag_off");
  if (f.app !== "slop") return no("app");
  // Adults only on both sides, the same rule as rating (an unknown age is a minor).
  for (const [who, x] of [["recipient", f.recipient], ["subject", f.subject]] as const) {
    if (x.age === null || !canRatePhotos({ age: x.age, ageVerified: x.verified })) return no(`${who}_not_adult`);
    if (x.banned) return no(`${who}_banned`);
  }
  if (!f.policy.ok) return no(`policy_${f.policy.reason ?? "refused"}`);
  if (!f.photo) return no("no_photo");
  if (f.photo.moderation !== "approved") return no("not_approved");
  if (f.guard.length) return no("leak_guard");
  if (appearanceLeak(f.caption, (f.scoreTags ?? []).filter(t => t.startsWith(APPEARANCE_PREFIX)))) return no("appearance_leak");
  return { ok: true };
}
