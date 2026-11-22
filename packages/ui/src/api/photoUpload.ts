// spec/photoUploadPage.md, "The server answer decides between saved, refused, closed and a retry"
import type { PhotoAnswer, PhotoAnswerKind, PhotoBatch } from "../../../core/src/generated/photoUploadPage.ts";
import { type StepAnswer, stepCall } from "./stepPages.ts";

/** The refusal of one photo that the page shows. A server reason that the page does not know is `other`. */
export type PhotoRefusalShown = "bad_type" | "bad_image" | "too_large" | "too_many" | "adults_only" | "other";

const photoUploadPath = "/api/photos/upload";

const allowedTypes: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

const refusalsShown: Readonly<Record<string, PhotoRefusalShown>> = {
  bad_type: "bad_type",
  bad_image: "bad_image",
  too_large: "too_large",
  too_many: "too_many",
  adults_only: "adults_only",
};

/**
 * Checks the token shape: 43 characters of base64url with zero padding bits, as the server issues it.
 * @model spec/photoUploadPage.md
 */
export function photoTokenWellFormed(token: string): boolean {
  return /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(token);
}

/**
 * The facts of a choice of files that the photo upload machine checks: the count, the largest size, the total size and the types.
 * @model spec/photoUploadPage.md
 */
export function batchOf(files: readonly File[]): PhotoBatch {
  return {
    count: files.length,
    largestBytes: files.reduce((largest, file) => Math.max(largest, file.size), 0),
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    typesOk: files.every((file) => allowedTypes.includes(file.type)),
  };
}

const kindOf = (answer: StepAnswer): PhotoAnswerKind => {
  if (!answer.reached) return "UploadUnreachable";
  const { status, code } = answer;
  if (status === 200) return "UploadStored";
  if (status === 422) return "UploadAllRefused";
  if ((status === 404 || status === 410) && code === "link_unavailable") return "UploadLinkClosed";
  if (status === 413) return "UploadTooLarge";
  if (status === 400 && code === "photo_count") return "UploadCount";
  if (status === 400 && code === "consent_required") return "UploadConsentRequired";
  if (status === 502 || status === 503) return "UploadUnreachable";
  return "UploadInvalid";
};

const savedCountOf = (answer: StepAnswer): number => {
  if (!answer.reached) return 0;
  const stored = answer.data.stored;
  return typeof stored === "number" && Number.isSafeInteger(stored) && stored > 0 ? stored : 0;
};

const refusalsOf = (answer: StepAnswer): PhotoRefusalShown[] => {
  if (!answer.reached || !Array.isArray(answer.data.refused)) return [];
  const shown = answer.data.refused.map((reason: unknown) => (typeof reason === "string" ? refusalsShown[reason] : undefined) ?? "other");
  return [...new Set(shown)];
};

/**
 * Sends the chosen photos once with the link token. The consent version goes in its header only when the person ticked the box.
 * The token goes only in the `x-photo-upload-link` header, never in the address.
 * @model spec/photoUploadPage.md
 */
export async function sendPhotos(token: string, files: readonly File[], consentVersion: string | undefined): Promise<{ answer: PhotoAnswer; refused: PhotoRefusalShown[] }> {
  const form = new FormData();
  for (const file of files) form.append("photo", file);
  const headers: Record<string, string> = { "x-photo-upload-link": token };
  if (consentVersion !== undefined && consentVersion !== "") headers["x-photo-consent"] = consentVersion;
  const answer = await stepCall(photoUploadPath, { method: "POST", form, headers });
  const kind = kindOf(answer);
  const closing = kind === "UploadStored" || kind === "UploadAllRefused";
  const refused = closing ? refusalsOf(answer) : [];
  return { answer: { kind, savedCount: kind === "UploadStored" ? savedCountOf(answer) : 0, someRefused: refused.length > 0 }, refused };
}
