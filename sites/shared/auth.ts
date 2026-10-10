// Phone -> code login, shared by /join and /settings. The person types their own number and the code
// that we text them; nothing else (no agent, no other page) can enter it for them.
// Markup contract inside the flow root:
//   [data-step="phone"]  form[data-form="phone"] with input[name=phone] and an empty [data-turnstile]
//   [data-step="code"]   form[data-form="code"] with input[name=code],
//                        [data-slot="phoneShown"], button[data-action="resend"], button[data-action="change-number"]
// The server answers otp/start the same way for every number, so this code shows the same
// screen for every number too.
import { api, toE164 } from "./api.ts";
import { mountTurnstile } from "./turnstile.ts";
import { $, busy, fill, message, setError, showStep } from "./ui.ts";

export function maskPhone(e164: string): string {
  return `(•••) •••-${e164.slice(-4)}`;
}

export function mountAuth(root: HTMLElement, onSignedIn: () => Promise<void> | void): void {
  const form = root.querySelector<HTMLFormElement>('form[data-form="phone"]');
  if (!form) return;
  // The static form defaults to GET; block native submission before any await.
  form.addEventListener("submit", event => event.preventDefault());
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit], button:not([type])");
  const busyLabel = submit?.dataset.busy;
  if (submit) submit.dataset.busy = "Loading sign-in…";
  // A transient failure (5xx, network) is retried; after that the phone-code flow is the fallback.
  const lookup = async () => {
    for (let attempt = 0; ; attempt++) {
      const mode = await api.authMode();
      if (mode.ok || mode.status === 404 || attempt >= 2) return mode;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
    }
  };
  void busy(form, lookup).then(mode => {
    if (submit) {
      if (busyLabel === undefined) delete submit.dataset.busy;
      else submit.dataset.busy = busyLabel;
    }
    if (!mode.ok) {
      // Older, unconfigured backends, and a mode lookup that keeps failing, keep the phone-code flow.
      mountOtpAuth(root, onSignedIn);
      return;
    }
    if (mode.data.mode !== "cloud") { mountOtpAuth(root, onSignedIn); return; }
    const explanation = form.parentElement?.querySelector(":scope > p");
    explanation?.remove();
    const error = form.querySelector<HTMLElement>("[data-error]");
    const button = document.createElement("button");
    button.type = "submit";
    button.className = "btn";
    button.dataset.busy = "Opening…";
    button.textContent = "Continue with your phone";
    form.replaceChildren(button);
    if (error) form.append(error);
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const result = await busy(form, () => api.cloudAuthStart(location.pathname.startsWith("/settings") ? "/settings" : "/join"));
      if (!result.ok) { setError(form, "Sign-in is unavailable. Try again."); return; }
      location.assign(result.data.url);
    });
  });
}

function mountOtpAuth(root: HTMLElement, onSignedIn: () => Promise<void> | void): void {
  const phoneForm = $(root, 'form[data-form="phone"]') as HTMLFormElement | null;
  const codeForm = $(root, 'form[data-form="code"]') as HTMLFormElement | null;
  if (!phoneForm || !codeForm) return;
  let phone = "";
  const human = mountTurnstile(phoneForm);

  phoneForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = phoneForm.elements.namedItem("phone") as HTMLInputElement;
    const e164 = toE164(input.value);
    if (!e164) {
      input.setAttribute("aria-invalid", "true");
      setError(phoneForm, root.getAttribute("data-msg-bad-phone") ?? "Enter a 10-digit US mobile number.");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    const token = human?.token();
    if (human && !token) {
      setError(phoneForm, root.getAttribute("data-msg-turnstile-wait") ?? "Wait for the check above to finish, then try again.");
      return;
    }
    setError(phoneForm, "");
    const res = await busy(phoneForm, () => api.otpStart(e164, token));
    human?.reset();
    if (!res.ok) {
      setError(phoneForm, message(root, res.error));
      return;
    }
    phone = e164;
    fill(root, { phoneShown: maskPhone(e164) });
    (codeForm.elements.namedItem("code") as HTMLInputElement).value = "";
    setError(codeForm, "");
    showStep(root, "code");
  });

  codeForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = codeForm.elements.namedItem("code") as HTMLInputElement;
    const code = input.value.replace(/\D/g, "");
    if (code.length < 4 || code.length > 8) {
      input.setAttribute("aria-invalid", "true");
      setError(codeForm, "Enter the code from the text we sent.");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    const res = await busy(codeForm, () => api.otpVerify(phone, code));
    if (!res.ok) {
      setError(codeForm, message(root, res.error));
      input.select();
      return;
    }
    setError(codeForm, "");
    await onSignedIn();
  });

  root.querySelector('[data-action="resend"]')?.addEventListener("click", async () => {
    if (!phone) return showStep(root, "phone");
    // With Turnstile on, a new code needs a new check: go back to the phone step, number kept.
    if (human) {
      setError(phoneForm, "Confirm the check, then send a new code.");
      return showStep(root, "phone");
    }
    const res = await busy(codeForm, () => api.otpStart(phone));
    setError(codeForm, res.ok ? "We sent a new code." : message(root, res.error));
  });

  root.querySelector('[data-action="change-number"]')?.addEventListener("click", () => {
    setError(phoneForm, "");
    showStep(root, "phone");
  });
}
