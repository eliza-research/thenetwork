// spec/photosViewPage.md, "Photo view page"
import type { ViewImageAnswer, ViewOpenAnswer, ViewOpenKind, ViewReportAnswer } from "../../../core/src/generated/photosViewPage.ts";
import { photoTokenWellFormed } from "./photoUpload.ts";
import { type StepAnswer, stepCall } from "./stepPages.ts";

const viewOpenPath = "/api/photos/page/open";
const viewImagePath = "/api/photos/page/image";
const viewAnswerPath = "/api/photos/page/answer";

const imageTypes: readonly string[] = ["image/jpeg", "image/png", "image/webp"];

/** What a good open answer carries beside the machine answer: the sender's first name. The answer has no end time. */
export interface PhotoViewOpened {
  answer: ViewOpenAnswer;
  /** The first name of the sender; "" unless the answer is `OpenShown`. */
  fromFirstName: string;
}

/** One image answer, with the object URL of the bytes when the answer is `ImageShown`. The caller releases the URL. */
export interface PhotoViewImage {
  answer: ViewImageAnswer;
  url: string | undefined;
}

/**
 * Checks the token shape: 43 characters of base64url (32 random bytes), the same shape as every one-step photo link.
 * @model spec/photosViewPage.md
 */
export function photoViewTokenWellFormed(token: string): boolean {
  return photoTokenWellFormed(token);
}

const firstNameOf = (value: unknown): string => (typeof value === "string" && value.trim() !== "" && value.length <= 60 ? value.trim() : "");

const openKindOf = (answer: StepAnswer): ViewOpenKind => {
  if (!answer.reached) return "OpenUnreachable";
  const { status, code, data } = answer;
  if (status === 200) return data.purpose === "view" && firstNameOf(data.fromFirstName) !== "" ? "OpenShown" : "OpenFailed";
  if (status === 403 && code === "other_device") return "OpenOtherDevice";
  if (status === 410 && code === "link_expired") return "OpenGone";
  if (status === 404 && code === "link_unavailable") return "OpenReplaced";
  if (status === 502 || status === 503) return "OpenUnreachable";
  return "OpenFailed";
};

const countOf = (answer: StepAnswer): number => {
  if (!answer.reached) return 0;
  const count = answer.data.count;
  return typeof count === "number" && Number.isSafeInteger(count) ? count : 0;
};

/**
 * Opens the view link when the person taps. The first open binds this browser; a later open on it reads the count again.
 * The token goes only in the JSON body.
 * @model spec/photosViewPage.md
 */
export async function openPhotoView(token: string): Promise<PhotoViewOpened> {
  const answer = await stepCall(viewOpenPath, { method: "POST", json: { token } });
  const kind = openKindOf(answer);
  if (kind !== "OpenShown" || !answer.reached) return { answer: { kind, count: 0 }, fromFirstName: "" };
  return { answer: { kind, count: countOf(answer) }, fromFirstName: firstNameOf(answer.data.fromFirstName) };
}

const errorCodeOf = async (response: Response): Promise<string> => {
  try {
    const data: unknown = await response.json();
    return typeof data === "object" && data !== null && "error" in data && typeof data.error === "string" ? data.error : "";
  } catch {
    return "";
  }
};

const imageKindOf = (status: number, code: string): ViewImageAnswer => {
  if (status === 404 && code === "not_found") return "ImageMissing";
  if (status === 404 && code === "link_unavailable") return "ImageReplaced";
  if (status === 410 && code === "link_expired") return "ImageGone";
  if (status === 403 && code === "other_device") return "ImageOtherDevice";
  if (status === 502 || status === 503) return "ImageUnreachable";
  return "ImageFailed";
};

/**
 * Asks for photo `n` of the offer and keeps its bytes in memory as an object URL. The request is a POST, so the token never
 * reaches an address, a cache or a `Referer` header.
 * @model spec/photosViewPage.md
 */
export async function loadPhotoView(token: string, n: number): Promise<PhotoViewImage> {
  let response: Response;
  try {
    response = await fetch(viewImagePath, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      headers: { "content-type": "application/json", accept: imageTypes.join(", ") },
      body: JSON.stringify({ token, n }),
    });
  } catch {
    return { answer: "ImageUnreachable", url: undefined };
  }
  if (response.status !== 200) return { answer: imageKindOf(response.status, await errorCodeOf(response)), url: undefined };
  const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!imageTypes.includes(type)) return { answer: "ImageFailed", url: undefined };
  let bytes: Blob;
  try {
    bytes = await response.blob();
  } catch {
    return { answer: "ImageUnreachable", url: undefined };
  }
  if (bytes.size === 0) return { answer: "ImageFailed", url: undefined };
  return { answer: "ImageShown", url: URL.createObjectURL(new Blob([bytes], { type })) };
}

const reportOf = (answer: StepAnswer): ViewReportAnswer => {
  if (!answer.reached) return "ReportUnreachable";
  const { status, code, data } = answer;
  if (status === 200) return data.state === "reported" ? "ReportDone" : "ReportFailed";
  if (status === 410 && code === "link_expired") return "ReportGone";
  if (status === 404 && code === "link_unavailable") return "ReportReplaced";
  if (status === 403 && code === "other_device") return "ReportOtherDevice";
  if (status === 502 || status === 503) return "ReportUnreachable";
  return "ReportFailed";
};

/**
 * Reports the photos of this link. It closes the offer on the server, and the safety team looks at it.
 * @model spec/photosViewPage.md
 */
export async function reportPhotoView(token: string): Promise<ViewReportAnswer> {
  return reportOf(await stepCall(viewAnswerPath, { method: "POST", json: { token, answer: "report" } }));
}
