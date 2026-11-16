// spec/siteEnrollment.md, "Success requires an eligible profile with current consent"
// and "The current membership determines whether a join needs an invite".
import { always, eventually } from "@antithesishq/bombadil";
import { actions, extract, registerCustomAction } from "@antithesishq/bombadil/browser";
export * from "@antithesishq/bombadil/browser/defaults/properties";

const profileSelector = 'form[data-form="profile"]';
const signup = extract(({ document, window }) => {
  const form = document.querySelector<HTMLFormElement>(profileSelector);
  const step = document.querySelector<HTMLElement>("[data-join] [data-step]:not([hidden])")?.dataset.step ?? "";
  const name = form?.querySelector<HTMLInputElement>("input[name=firstName]")?.value.trim() ?? "";
  const age = form?.querySelector<HTMLInputElement>("input[name=age]")?.valueAsNumber ?? NaN;
  const consent = form?.querySelector<HTMLInputElement>("input[name=consent]")?.checked === true;
  const error = form?.querySelector("[data-error]")?.textContent ?? "";
  const busy = form?.querySelector<HTMLButtonElement>("button[type=submit]")?.disabled === true;
  return {
    step,
    filled: name !== "" && Number.isInteger(age),
    ageEligible: age >= 13 && age <= 120,
    consent,
    consentAsked: error.includes("Tick the box"),
    busy,
    receivedName: document.querySelector('[data-step="done"] [data-slot="firstName"]')?.textContent === name,
    returnsToAgent: document.querySelector('[data-step="done"] [data-agent-return]') !== null,
    hasPrivateUrlFields: ["age", "firstName", "phone", "code", "consent"].some(key => new URL(window.location.href).searchParams.has(key)),
  };
});

const fillProfile = registerCustomAction<[number]>("fill-profile", async (document, _window, age) => {
  const form = document.querySelector(profileSelector);
  const firstName = form?.querySelector<HTMLInputElement>("input[name=firstName]");
  const ageInput = form?.querySelector<HTMLInputElement>("input[name=age]");
  if (!firstName || !ageInput) throw new Error("Expected the profile fields");
  firstName.value = "Ari";
  ageInput.value = String(age);
  for (const field of [firstName, ageInput]) field.dispatchEvent(new InputEvent("input", { bubbles: true }));
});
const submitProfile = registerCustomAction("submit-profile", async (document) => {
  document.querySelector<HTMLFormElement>(profileSelector)?.requestSubmit();
});
const chooseConsent = registerCustomAction("choose-text-consent", async (document) => {
  document.querySelector<HTMLInputElement>(`${profileSelector} input[name=consent]`)?.click();
});

export const joinActions = actions(() => {
  const state = signup.current;
  if (state.step === "profile" && !state.busy) {
    if (!state.filled) return [fillProfile(13), fillProfile(30)];
    if (!state.consent && state.consentAsked) return [chooseConsent()];
    return [submitProfile()];
  }
  // A reload after signup must read the stored membership through the same site API.
  return state.step === "done" || state.step === "member" ? ["Reload"] : ["Wait"];
});

export const successNeedsConsent = always(() => {
  const state = signup.current;
  return state.step !== "done" || (state.filled && state.ageEligible && state.consent && state.receivedName && state.returnsToAgent);
});
export const profileDetailsStayOutOfUrls = always(() => !signup.current.hasPrivateUrlFields);
export const currentMembershipAppearsAfterReload = eventually(() => signup.current.step === "member");
