// spec/siteEnrollment.md, "Success requires an eligible profile with current consent"
// and "The current membership determines whether a join needs an invite".
import { always, eventually } from "@antithesishq/bombadil";
import { actions, extract, registerCustomAction } from "@antithesishq/bombadil/browser";
export * from "@antithesishq/bombadil/browser/defaults/properties";

// spec/authorizationPages.md, "The server reply selects the page view"
// spec/connectedAssistants.md, "A confirmed removal shows its result"
const connector = extract(({ document, window }) => {
  const path = window.location.pathname;
  const remove = document.querySelector<HTMLFormElement>('form[action="/oauth/consents/revoke"]');
  return {
    path,
    canAllow: document.querySelector('button[name="decision"][value="approve"]') !== null,
    canChoose: document.querySelector('form input[name="remove"]') !== null,
    canConfirm: remove !== null,
    hasProof: !!remove?.querySelector<HTMLInputElement>('input[name="confirmation"]')?.value,
    removed: document.querySelector('[role="status"]')?.textContent?.trim() === "Access removed.",
    onList: path === "/oauth/consents" || path === "/oauth/consents/revoke",
  };
});

const beginConnector = registerCustomAction("begin-connector", async (_document, window) => {
  window.location.assign("/api/explore/connect");
});
const allowAssistant = registerCustomAction("allow-assistant", async (document) => {
  document.querySelector<HTMLButtonElement>('button[name="decision"][value="approve"]')?.click();
});
const chooseRemoval = registerCustomAction("choose-assistant-removal", async (document) => {
  document.querySelector<HTMLInputElement>('form input[name="remove"]')?.form?.requestSubmit();
});
const confirmRemoval = registerCustomAction("confirm-assistant-removal", async (document) => {
  document.querySelector<HTMLFormElement>('form[action="/oauth/consents/revoke"]')?.requestSubmit();
});

const profileSelector = '[data-join-step="Profile"] form';
const signup = extract(({ document, window }) => {
  const panel = document.querySelector<HTMLElement>("[data-join-step]");
  const step = panel?.dataset.joinStep ?? "";
  const form = panel?.querySelector<HTMLFormElement>("form");
  const name = form?.querySelector<HTMLInputElement>("input[name=firstName]")?.value.trim() ?? "";
  const age = form?.querySelector<HTMLInputElement>("input[name=age]")?.valueAsNumber ?? NaN;
  const error = form?.querySelector('[role="alert"]')?.textContent ?? "";
  return {
    step,
    filled: name !== "" && Number.isInteger(age),
    consent: form?.querySelector('[role="checkbox"]')?.getAttribute("aria-checked") === "true",
    consentAsked: error.toLowerCase().includes("tick the box"),
    busy: form?.getAttribute("aria-busy") === "true",
    savedConsent: panel?.dataset.joinConsent === "granted",
    receivedName: panel?.querySelector("h1")?.textContent === "You’re in, Ari.",
    returnsToAgent: panel?.textContent?.includes("Go back to the same chat") === true,
    hasPrivateUrlFields: ["age", "firstName", "phone", "code", "consent"].some(key => new URL(window.location.href).searchParams.has(key)),
  };
});

const fillProfile = registerCustomAction<[number]>("fill-profile", async (document, _window, age) => {
  const form = document.querySelector(profileSelector);
  const firstName = form?.querySelector<HTMLInputElement>("input[name=firstName]");
  const ageInput = form?.querySelector<HTMLInputElement>("input[name=age]");
  if (!firstName || !ageInput) throw new Error("Expected the profile fields");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setValue) throw new Error("Expected the browser input setter");
  setValue.call(firstName, "Ari");
  setValue.call(ageInput, String(age));
  for (const field of [firstName, ageInput]) field.dispatchEvent(new InputEvent("input", { bubbles: true }));
});
const submitProfile = registerCustomAction("submit-profile", async (document) => {
  document.querySelector<HTMLFormElement>(profileSelector)?.requestSubmit();
});
const chooseConsent = registerCustomAction("choose-text-consent", async (document) => {
  document.querySelector<HTMLButtonElement>(`${profileSelector} [role=checkbox]`)?.click();
});

export const joinActions = actions(() => {
  const state = signup.current;
  if (state.step === "Profile" && !state.busy) {
    if (!state.filled) return [fillProfile(13), fillProfile(30)];
    if (!state.consent && state.consentAsked) return [chooseConsent()];
    return [submitProfile()];
  }
  // A reload after signup reads back the stored membership before connecting the assistant.
  if (state.step === "Done") return ["Reload"];
  if (state.step === "Member") return [beginConnector()];
  const auth = connector.current;
  if (auth.canAllow) return [allowAssistant()];
  if (auth.canChoose) return [chooseRemoval()];
  if (auth.canConfirm) return [confirmRemoval()];
  return ["Wait"];
});

export const successNeedsConsent = always(() => {
  const state = signup.current;
  return state.step !== "Done" || (state.savedConsent && state.receivedName && state.returnsToAgent);
});
export const profileDetailsStayOutOfUrls = always(() => !signup.current.hasPrivateUrlFields);
export const currentMembershipAppearsAfterReload = eventually(() => signup.current.step === "Member");

export const revokeFormNeedsConfirmation = always(() => {
  const state = connector.current;
  return !state.canConfirm || state.path === "/oauth/consents" && state.hasProof && !state.canChoose;
});
export const confirmedAssistantRemovalAppears = eventually(() => {
  const state = connector.current;
  return state.onList && state.removed && !state.canChoose && !state.canConfirm;
});
