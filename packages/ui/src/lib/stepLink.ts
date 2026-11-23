// spec/oneStepPage.md, "The link stays in the fragment, and only the home-help link is kept across Cloud sign-in"
import type { CloudReturn } from "../../../core/src/generated/oneStepPage.ts";

/** The one-step links that a page may keep across the Cloud sign-in. A photo upload link is never one of them. */
export type KeptLinkKey = "home-help";

const storageKey = (key: KeptLinkKey): string => `step-link:${key}`;

/**
 * Reads the fragment once and removes it from the address, before the page sends any request. Returns "" when there is none.
 * @model spec/oneStepPage.md
 */
export function takeLinkFragment(): string {
  const fragment = window.location.hash.slice(1);
  if (window.location.hash !== "") window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  return fragment;
}

const cloudReturns: Readonly<Record<string, CloudReturn>> = {
  sign_in_expired: "CloudReturnExpired",
  sign_in_refused: "CloudReturnRefused",
  sign_in_unavailable: "CloudReturnUnavailable",
};

/**
 * Reads the `error` value that a failed Cloud sign-in puts on the return address, once, and removes the query from the address.
 * Any other value, and no value, is `CloudReturnNone`.
 * @model spec/oneStepPage.md
 */
export function takeCloudReturn(): CloudReturn {
  const search = new URLSearchParams(window.location.search);
  if (!search.has("error")) return "CloudReturnNone";
  const value = search.get("error") ?? "";
  search.delete("error");
  const rest = search.toString();
  window.history.replaceState(window.history.state, "", window.location.pathname + (rest === "" ? "" : `?${rest}`) + window.location.hash);
  return cloudReturns[value] ?? "CloudReturnNone";
}

/**
 * Keeps the link in session storage just before the page leaves for the Cloud sign-in. A storage error is ignored: the person then opens the link again.
 * @model spec/oneStepPage.md
 */
export function keepLinkFragment(key: KeptLinkKey, fragment: string): void {
  if (fragment === "") return;
  try {
    window.sessionStorage.setItem(storageKey(key), fragment);
  } catch {
    return;
  }
}

/**
 * Reads and removes the kept link. Returns "" when there is none or when storage is off.
 * @model spec/oneStepPage.md
 */
export function takeKeptFragment(key: KeptLinkKey): string {
  try {
    const fragment = window.sessionStorage.getItem(storageKey(key)) ?? "";
    window.sessionStorage.removeItem(storageKey(key));
    return fragment;
  } catch {
    return "";
  }
}
