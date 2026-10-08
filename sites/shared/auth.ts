// Phone -> code login, shared by /join and /settings.
// Markup contract inside the flow root:
//   [data-step="phone"]  form[data-form="phone"] with input[name=phone]
//   [data-step="code"]   form[data-form="code"] with input[name=code],
//                        [data-slot="phoneShown"], button[data-action="resend"], button[data-action="change-number"]
// The server answers otp/start the same way for every number, so this code shows the same
// screen for every number too.
import { api, toE164 } from "./api.ts";
import { $, busy, fill, message, setError, showStep } from "./ui.ts";

export function maskPhone(e164: string): string {
  return `(•••) •••-${e164.slice(-4)}`;
}

export function mountAuth(root: HTMLElement, onSignedIn: () => Promise<void> | void): void {
  const phoneForm = $(root, 'form[data-form="phone"]') as HTMLFormElement | null;
  const codeForm = $(root, 'form[data-form="code"]') as HTMLFormElement | null;
  if (!phoneForm || !codeForm) return;
  let phone = "";

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
    setError(phoneForm, "");
    const res = await busy(phoneForm, () => api.otpStart(e164));
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
    const res = await busy(codeForm, () => api.otpStart(phone));
    setError(codeForm, res.ok ? "We sent a new code." : message(root, res.error));
  });

  root.querySelector('[data-action="change-number"]')?.addEventListener("click", () => {
    setError(phoneForm, "");
    showStep(root, "phone");
  });
}
