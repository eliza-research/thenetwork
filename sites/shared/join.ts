// /join flow: (safety notice) -> phone -> code -> short profile -> done.
// Root: [data-join]. Optional attributes on the root:
//   data-first-step="safety"   show [data-step="safety"] before the phone step (slop.date)
//   data-join-mode="invite"     the page's default when /api/app cannot be read
//   data-min-age="18"           the page's default when /api/app cannot be read
// Steps: loading, safety, invite, phone, code, profile, member, blocked, done.
import { api, type ApiError, type Me } from "./api.ts";
import { mountAuth } from "./auth.ts";
import { $, busy, fill, formatDate, message, plainText, ready, setError, showStep, when } from "./ui.ts";

function start(root: HTMLElement): void {
  showStep(root, root.dataset.firstStep ?? "phone");
}

function flowError(root: HTMLElement, text: string): void {
  const el = $(root, "[data-flow-error]");
  if (!el) return;
  el.textContent = text;
  el.hidden = text === "";
}

function block(root: HTMLElement, reason: string): void {
  const known: ApiError[] = ["under_age", "invite_only", "invalid"];
  const key = (known as string[]).includes(reason) ? (reason as ApiError) : "unknown";
  fill(root, { blockedReason: message(root, key) });
  when(root, "blocked-invite", key === "invite_only");
  showStep(root, "blocked");
}

function route(root: HTMLElement, me: Me, inviteOnly: boolean): void {
  if (me.membership) {
    fill(root, { firstName: me.membership.firstName, joinedAt: formatDate(me.membership.joinedAt) });
    showStep(root, "member");
  } else if (!me.canJoin) {
    block(root, me.reason ?? (inviteOnly ? "invite_only" : "unknown"));
  } else {
    fill(root, { phoneMasked: me.phoneMasked });
    showStep(root, "profile");
  }
}

export async function mountJoin(root: HTMLElement): Promise<void> {
  showStep(root, "loading");
  const [app, me] = await Promise.all([api.app(), api.me()]);
  const inviteOnly = app.ok ? app.data.joinMode === "invite" : root.dataset.joinMode === "invite";
  fill(root, { minJoinAge: app.ok ? app.data.minJoinAge : root.dataset.minAge ?? "" });
  if (!app.ok && app.error === "api_unreachable") flowError(root, message(root, "api_unreachable"));

  if (me.ok) {
    route(root, me.data, inviteOnly);
  } else if (inviteOnly) {
    showStep(root, "invite");
  } else {
    start(root);
  }
  ready(root);

  root.querySelector('[data-action="ack-safety"]')?.addEventListener("click", () => showStep(root, "phone"));
  root.querySelectorAll('[data-action="restart"]').forEach((b) => b.addEventListener("click", () => start(root)));

  mountAuth(root, async () => {
    flowError(root, "");
    const again = await api.me();
    if (again.ok) route(root, again.data, inviteOnly);
    else {
      start(root);
      flowError(root, message(root, again.error));
    }
  });

  const form = $(root, 'form[data-form="profile"]') as HTMLFormElement | null;
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const str = (k: string) => String(f.get(k) ?? "").trim();
    const firstName = str("firstName");
    const age = Number(str("age"));
    const zip = str("zip");
    const consentBox = form.elements.namedItem("consent") as HTMLInputElement | null;
    const problems: string[] = [];
    if (!firstName) problems.push("Enter your first name.");
    for (const radio of form.querySelectorAll<HTMLInputElement>("input[type=radio][required]")) {
      const group = form.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${radio.name}"]`);
      if (![...group].some((r) => r.checked)) {
        const legend = plainText(radio.closest("fieldset")?.querySelector("legend") ?? null);
        problems.push(`Choose one: ${legend || "an option"}.`);
      }
    }
    if (!Number.isInteger(age) || age < 1 || age > 120) problems.push("Enter your age in years.");
    if (zip && !/^\d{5}$/.test(zip)) problems.push("Enter a 5-digit ZIP code, or leave it empty.");
    if (!consentBox?.checked) problems.push("Tick the box to agree to texts. We can only work by text.");
    if (problems.length) {
      setError(form, problems.join(" "));
      return;
    }
    setError(form, "");
    const interests = f.getAll("interests").map(String).filter(Boolean);
    const body = {
      firstName,
      age,
      ...(str("neighborhood") ? { neighborhood: str("neighborhood") } : {}),
      ...(zip ? { zip } : {}),
      ...(interests.length ? { interests } : {}),
      ...(str("about") ? { about: str("about") } : {}),
      consent: { sms: true as const, wording: plainText($(form, "[data-consent-wording]")) },
    };
    const res = await busy(form, () => api.join(body));
    if (res.ok) {
      fill(root, { firstName: res.data.membership?.firstName ?? firstName });
      showStep(root, "done");
    } else if (res.error === "under_age" || res.error === "invite_only") {
      block(root, res.error);
    } else if (res.error === "unauthorized") {
      start(root);
      flowError(root, message(root, "unauthorized"));
    } else {
      setError(form, message(root, res.error));
    }
  });
}

const root = document.querySelector<HTMLElement>("[data-join]");
if (root) void mountJoin(root);
