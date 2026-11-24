// spec/photosMinePage.md, "The open answer decides between the list, the empty list, a closed link and a retry"
import { photoPagePurposeHeader } from "../../../core/src/generated/photoRelayItem.ts";
import {
  type GrantAccess,
  type GrantWire,
  grantAccessOf,
  grantCanBeTakenBack,
  type ImageKind,
  type OpenAnswer,
  type OpenKind,
  type TakeBackKind,
} from "../../../core/src/generated/photosMinePage.ts";
import { photoTokenWellFormed } from "./photoUpload.ts";
import { type StepAnswer, stepCall } from "./stepPages.ts";

/** One share of one photo: the first name of the match and how far the offer is. */
export interface HoldingShare {
  firstName: string;
  access: GrantAccess;
  shareRef: string;
}

/** One photo of the member as the list shows it: its number, its name or null, the day it was added (`YYYY-MM-DD`) and its shares. */
export interface HoldingPhoto {
  n: number;
  label: string | null;
  addedOn: string;
  shares: HoldingShare[];
}

const pagePath = "/api/photos/page/";
const pageHeaders = { [photoPagePurposeHeader]: "mine" };
const photoMax = 6;

const wireStates: Readonly<Record<string, GrantWire>> = {
  asked: "WireAsked",
  checking: "WireChecking",
  ready: "WireReady",
  opened: "WireOpened",
  taken_back: "WireTakenBack",
};

/**
 * Checks the token shape of a `/photos/mine` link: 43 characters of base64url, as for every photo page link.
 * @model spec/photosMinePage.md
 */
export function holdingsTokenWellFormed(token: string): boolean {
  return photoTokenWellFormed(token);
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

const shareOf = (value: unknown): HoldingShare | undefined => {
  if (!isRecord(value) || typeof value.firstName !== "string" || typeof value.shareRef !== "string" || !photoTokenWellFormed(value.shareRef)) return undefined;
  const firstName = value.firstName.trim();
  if (firstName.length < 1 || firstName.length > 30) return undefined;
  const wire = typeof value.state === "string" ? (wireStates[value.state] ?? "WireUnknown") : "WireUnknown";
  return { firstName, access: grantAccessOf(wire), shareRef: value.shareRef };
};

const photoOf = (value: unknown): HoldingPhoto | undefined => {
  if (!isRecord(value)) return undefined;
  const { n, label, addedOn, access } = value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > photoMax) return undefined;
  if (label !== null && (typeof label !== "string" || label.length > 24)) return undefined;
  if (typeof addedOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(addedOn)) return undefined;
  if (!Array.isArray(access)) return undefined;
  const shares = access.map(shareOf);
  if (shares.some((share) => share === undefined)) return undefined;
  return { n, label, addedOn, shares: shares as HoldingShare[] };
};

const listOf = (data: Readonly<Record<string, unknown>>): HoldingPhoto[] | undefined => {
  if (!Array.isArray(data.photos) || data.photos.length > photoMax) return undefined;
  const photos = data.photos.map(photoOf);
  if (photos.some((photo) => photo === undefined)) return undefined;
  const list = photos as HoldingPhoto[];
  const refs = list.flatMap(photo => photo.shares.map(share => share.shareRef));
  if (new Set(refs).size !== refs.length) return undefined;
  return new Set(list.map((photo) => photo.n)).size === list.length ? list : undefined;
};

const closedKind = (answer: StepAnswer): "timed_out" | "unavailable" | "other_phone" | "unreachable" | undefined => {
  if (!answer.reached) return "unreachable";
  const { status, code } = answer;
  if (status === 410 && code === "link_expired") return "timed_out";
  if (status === 404 && code === "link_unavailable") return "unavailable";
  if (status === 403 && code === "other_device") return "other_phone";
  if (status === 502 || status === 503) return "unreachable";
  return undefined;
};

const openKinds = { timed_out: "OpenTimedOut", unavailable: "OpenUnavailable", other_phone: "OpenOtherPhone", unreachable: "OpenUnreachable" } as const;

/**
 * Asks the server for the member's photo list. The token goes only in the JSON body, never in the address.
 * A list for another page (another `purpose`) is a link that does not work here; a list in the wrong shape is a page fault.
 * @model spec/photosMinePage.md
 */
export async function openHoldings(token: string): Promise<{ answer: OpenAnswer; photos: HoldingPhoto[] }> {
  const result = await stepCall(`${pagePath}open`, { method: "POST", json: { token }, headers: pageHeaders });
  const none = (kind: OpenKind) => ({ answer: { kind, photos: 0, grants: 0 }, photos: [] });
  const closed = closedKind(result);
  if (closed) return none(openKinds[closed]);
  if (!result.reached || result.status !== 200) return none("OpenFailed");
  if (result.data.purpose !== "mine") return none("OpenUnavailable");
  const photos = listOf(result.data);
  if (!photos) return none("OpenFailed");
  const sorted = [...photos].sort((a, b) => a.n - b.n);
  return { answer: { kind: "OpenListed", photos: sorted.length, grants: sorted.reduce((total, photo) => total + photo.shares.filter((share) => grantCanBeTakenBack(share.access)).length, 0) }, photos: sorted };
}

const imageKinds = { timed_out: "ImageTimedOut", unavailable: "ImageUnavailable", other_phone: "ImageOtherPhone", unreachable: "ImageMissing" } as const;

const errorCode = async (response: Response): Promise<string> => {
  try {
    const json: unknown = await response.json();
    return isRecord(json) && typeof json.error === "string" ? json.error : "";
  } catch {
    return "";
  }
};

/**
 * Asks for the image of photo `n` with the token in the JSON body and the device cookie of this phone.
 * A `200` with an image type gives an object URL; the caller revokes it. Every answer maps to one image kind.
 * @model spec/photosMinePage.md
 */
export async function holdingImage(token: string, n: number): Promise<{ kind: ImageKind; url?: string }> {
  let response: Response;
  try {
    response = await fetch(`${pagePath}image`, {
      method: "POST",
      credentials: "same-origin",
      headers: { ...pageHeaders, "content-type": "application/json", accept: "image/*" },
      body: JSON.stringify({ token, n }),
    });
  } catch {
    return { kind: "ImageMissing" };
  }
  const type = response.headers.get("content-type") ?? "";
  if (response.status === 200 && /^image\/(jpeg|png|webp)$/.test(type)) {
    try {
      return { kind: "ImageShown", url: URL.createObjectURL(await response.blob()) };
    } catch {
      return { kind: "ImageMissing" };
    }
  }
  const closed = closedKind({ reached: true, status: response.status, code: await errorCode(response), data: {}, retryAfterSeconds: undefined });
  return { kind: closed ? imageKinds[closed] : "ImageMissing" };
}

const takeBackKinds = { timed_out: "TakeBackTimedOut", unavailable: "TakeBackUnavailable", other_phone: "TakeBackOtherPhone", unreachable: "TakeBackUnreachable" } as const;

/**
 * Takes back the share referenced by the selected action. The server answers `taken_back` or `nothing_open`.
 * @model spec/photosMinePage.md
 */
export async function takeBackShare(token: string, shareRef: string): Promise<TakeBackKind> {
  const result = await stepCall(`${pagePath}answer`, { method: "POST", json: { token, answer: "take_back", shareRef }, headers: pageHeaders });
  const closed = closedKind(result);
  if (closed) return takeBackKinds[closed];
  if (!result.reached || result.status !== 200) return "TakeBackFailed";
  if (result.data.state === "taken_back") return "TakeBackDone";
  if (result.data.state === "nothing_open") return "TakeBackNothingOpen";
  return "TakeBackFailed";
}

/**
 * The day a photo was added, as the conversation writes it: `Sat 21 Nov`. The server gives the day in the member's zone, so the page formats it in UTC.
 * @model spec/photosMinePage.md
 */
export function holdingDayShown(addedOn: string): string {
  const [year, month, day] = addedOn.split("-").map(Number);
  if (!year || !month || !day) return addedOn;
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(date);
  const rest = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  return `${weekday} ${rest}`;
}
