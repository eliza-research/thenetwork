// Phone -> code login, for /join. The person types their own number and the code
// that we text them; nothing else (no agent, no other page) can enter it for them.
// Markup contract inside the flow root:
//   [data-step="phone"]  form[data-form="phone"] with input[name=phone] and an empty [data-turnstile]
//   [data-step="code"]   form[data-form="code"] with input[name=code],
//                        [data-slot="phoneShown"], button[data-action="resend"], button[data-action="change-number"]
// The server answers otp/start the same way for every number, so this code shows the same
// screen for every number too.
import { api, toE164 } from "./api.ts";
import { type Flow, type FlowEvent, NO_FIELDS, flowNext, initialFlow } from "./join-core.ts";
import { mountTurnstile } from "./turnstile.ts";
import { $, busy, fill, message, setError, showStep } from "./ui.ts";

export function maskPhone(e164: string): string {
  return `(•••) •••-${e164.slice(-4)}`;
}

/** The Join flow as this module sees it. flowNext owns the step and the number. */
export interface AuthFlow {
  current(): Flow;
  dispatch(event: FlowEvent): Flow;
  /** Runs after otp/verify passes for this number. The code form stays busy until it ends. */
  onSignedIn(phone: string): Promise<void> | void;
}

/** A sign-in form without a Join form: the same flowNext decides the step. */
function signInOnly(root: HTMLElement, onSignedIn: () => Promise<void> | void): AuthFlow {
  let flow = flowNext(initialFlow(NO_FIELDS), { tag: "loaded", signedInAs: "", canJoin: false, member: false, inviteOnly: false, notice: "" });
  return {
    current: () => flow,
    dispatch: event => {
      const prev = flow;
      flow = flowNext(prev, event);
      if (flow.step !== prev.step) showStep(root, flow.step);
      return flow;
    },
    onSignedIn,
  };
}

export function mountAuth(root: HTMLElement, flowOrSignedIn: AuthFlow | (() => Promise<void> | void)): void {
  const flow = typeof flowOrSignedIn === "function" ? signInOnly(root, flowOrSignedIn) : flowOrSignedIn;
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
      mountOtpAuth(root, flow);
      return;
    }
    if (mode.data.mode !== "cloud") { mountOtpAuth(root, flow); return; }
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
      const result = await busy(form, () => api.cloudAuthStart("/join"));
      if (!result.ok) { setError(form, "Sign-in is unavailable. Try again."); return; }
      location.assign(result.data.url);
    });
  });
}

function mountOtpAuth(root: HTMLElement, flow: AuthFlow): void {
  const phoneForm = $(root, 'form[data-form="phone"]') as HTMLFormElement | null;
  const codeForm = $(root, 'form[data-form="code"]') as HTMLFormElement | null;
  if (!phoneForm || !codeForm) return;
  const checkPending = root.getAttribute("data-msg-turnstile-wait") ?? "Wait for the check above to finish, then try again.";
  const checkFailed = root.getAttribute("data-msg-turnstile-failed") ?? "The security check failed. Refresh the page and try again.";
  const human = mountTurnstile(phoneForm, state => {
    const error = phoneForm.querySelector<HTMLElement>("[data-error]")?.textContent;
    const checkError = error === checkPending || error === checkFailed;
    if (state === "failed" && (!error || checkError)) setError(phoneForm, checkFailed);
    else if (state === "ready" && checkError) setError(phoneForm, "");
  });

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
      setError(phoneForm, human.state() === "failed" ? checkFailed : checkPending);
      return;
    }
    setError(phoneForm, "");
    const res = await busy(phoneForm, () => api.otpStart(e164, token));
    human?.reset();
    if (!res.ok) {
      setError(phoneForm, message(root, res.error));
      return;
    }
    (codeForm.elements.namedItem("code") as HTMLInputElement).value = "";
    setError(codeForm, "");
    fill(root, { phoneShown: maskPhone(flow.dispatch({ tag: "otpStarted", number: e164 }).shown) });
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
    const phone = flow.current().phone;
    // Keep the code form (and its change-number button) busy until onSignedIn has read /api/me.
    // Otherwise the person can start a new number while the old answer is in flight (JF-1).
    const res = await busy(codeForm, async () => {
      const verified = await api.otpVerify(phone, code);
      if (verified.ok) {
        setError(codeForm, "");
        await flow.onSignedIn(phone);
      }
      return verified;
    });
    if (!res.ok) {
      setError(codeForm, message(root, res.error));
      input.select();
    }
  });

  root.querySelector('[data-action="resend"]')?.addEventListener("click", async () => {
    // With Turnstile on, a new code needs a new check: go back to the phone step, number kept.
    if (human) {
      setError(phoneForm, "Confirm the check, then send a new code.");
      flow.dispatch({ tag: "changeNumber" });
      return;
    }
    const res = await busy(codeForm, () => api.otpStart(flow.current().phone));
    setError(codeForm, res.ok ? "We sent a new code." : message(root, res.error));
  });

  root.querySelector('[data-action="change-number"]')?.addEventListener("click", () => {
    setError(phoneForm, "");
    flow.dispatch({ tag: "changeNumber" });
  });
}
