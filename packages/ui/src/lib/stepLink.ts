// spec/oneStepPage.md, "The link stays in the fragment, and only the home-help link is kept across Cloud sign-in"

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
