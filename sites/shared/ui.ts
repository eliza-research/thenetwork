// Small DOM helpers shared by the join and settings pages. Each site writes its own markup and
// copy; this code only finds elements by data attributes:
//   [data-step="name"]       one panel of a flow; only one is visible at a time
//   [data-slot="name"]       text filled in from the API (textContent only)
//   [data-error]             inline error text inside a form (aria-live)
//   [data-msg-<error>]       on the flow root: this site's wording for an API error
//   [data-when="name"]       shown only when the named condition is true
import { MESSAGES, type ApiError } from "./api.ts";

export function $(root: ParentNode, sel: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(sel);
}

export function showStep(root: HTMLElement, name: string): void {
  let target: HTMLElement | null = null;
  for (const el of root.querySelectorAll<HTMLElement>("[data-step]")) {
    const on = el.dataset.step === name;
    el.hidden = !on;
    if (on) target = el;
  }
  root.dataset.current = name;
  if (!target) return;
  const focusable = target.querySelector<HTMLElement>("[data-focus]") ?? target.querySelector<HTMLElement>("h1, h2");
  // Move focus only after the first screen is shown, so a page load never jumps or scrolls.
  if (focusable && root.dataset.ready === "1") {
    if (!focusable.hasAttribute("tabindex") && !/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(focusable.tagName)) focusable.tabIndex = -1;
    focusable.focus({ preventScroll: false });
  }
}

/** Call once the first screen of a flow is shown. Later step changes move focus. */
export function ready(root: HTMLElement): void {
  root.dataset.ready = "1";
}

export function when(root: ParentNode, name: string, on: boolean): void {
  for (const el of root.querySelectorAll<HTMLElement>(`[data-when="${name}"]`)) el.hidden = !on;
}

export function fill(root: ParentNode, values: Record<string, string | number | null | undefined>): void {
  for (const [k, v] of Object.entries(values)) {
    for (const el of root.querySelectorAll<HTMLElement>(`[data-slot="${k}"]`)) el.textContent = v == null ? "" : String(v);
  }
}

export function message(root: HTMLElement, error: ApiError): string {
  const attr = root.getAttribute(`data-msg-${error.replace(/_/g, "-")}`);
  return attr ?? MESSAGES[error];
}

export function setError(form: HTMLElement, text: string): void {
  const out = form.querySelector<HTMLElement>("[data-error]");
  if (out) {
    out.textContent = text;
    out.hidden = text === "";
  }
}

/** Disables a form's controls while a request runs, and shows the button's busy label. */
export async function busy<T>(form: HTMLFormElement, run: () => Promise<T>): Promise<T> {
  const controls = Array.from(form.elements) as HTMLInputElement[];
  const button = form.querySelector<HTMLButtonElement>("button[type=submit], button:not([type])");
  const label = button?.textContent ?? "";
  for (const c of controls) c.disabled = true;
  form.setAttribute("aria-busy", "true");
  if (button?.dataset.busy) button.textContent = button.dataset.busy;
  try {
    return await run();
  } finally {
    for (const c of controls) c.disabled = false;
    form.removeAttribute("aria-busy");
    if (button) button.textContent = label;
  }
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/** Collapses whitespace so the stored consent wording matches what the person read. */
export function plainText(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}
