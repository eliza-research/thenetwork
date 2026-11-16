// /join flow: phone -> code -> short profile -> done. Notices on the page (slop.date's safety notice)
// are information next to the flow, never a step that blocks joining (PRD 40.7).
// Root: [data-join]. Optional attributes on the root:
//   data-join-mode="invite"     the page's default when /api/app cannot be read
//   data-min-age="13"           the page's default when /api/app cannot be read
// Steps: loading, invite, phone, code, profile, member, blocked, done.
import { api, type ApiError, type Me } from "./api.ts";
import { prefillJoin } from "./prefill.ts";
import { mountAuth } from "./auth.ts";
import { $, busy, fill, formatDate, message, plainText, ready, setError, showStep, when } from "./ui.ts";

const pendingInviteKey = "network.join.invite";
const inviteTokenPattern = /^[A-Za-z0-9_-]{43}$/;

/** The fragment stays on this origin. Read any Cloud handoff state once and clear it. */
function readInviteToken(): string | undefined {
  const fragment = location.hash.startsWith("#invite=") ? location.hash.slice("#invite=".length) : undefined;
  if (fragment !== undefined) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(pendingInviteKey);
    sessionStorage.removeItem(pendingInviteKey);
  } catch { /* Phone-code signup can keep the invitation in this page's memory. */ }
  const token = fragment ?? saved;
  if (token === null) return undefined;
  return inviteTokenPattern.test(token) ? token : "";
}

function start(root: HTMLElement): void {
  showStep(root, "phone");
}

function flowError(root: HTMLElement, text: string): void {
  const el = $(root, "[data-flow-error]");
  if (!el) return;
  el.textContent = text;
  el.hidden = text === "";
}

function block(root: HTMLElement, reason: string): void {
  const known: ApiError[] = ["under_age", "invite_only", "invalid", "review"];
  const key = (known as string[]).includes(reason) ? (reason as ApiError) : "unknown";
  fill(root, { blockedReason: message(root, key) });
  when(root, "blocked-invite", key === "invite_only");
  showStep(root, "blocked");
}

function route(root: HTMLElement, me: Me, inviteOnly: boolean): void {
  if (me.canJoin) {
    fill(root, { phoneMasked: me.phoneMasked });
    showStep(root, "profile");
  } else if (me.membership) {
    fill(root, { firstName: me.membership.firstName, joinedAt: formatDate(me.membership.joinedAt) });
    showStep(root, "member");
  } else {
    block(root, me.reason ?? (inviteOnly ? "invite_only" : "unknown"));
  }
}

export async function mountJoin(root: HTMLElement): Promise<void> {
  let inviteToken = readInviteToken();
  const profile = $(root, 'form[data-form="profile"]') as HTMLFormElement | null;
  // Block native GET submission even while the optional draft is loading.
  profile?.addEventListener("submit", event => event.preventDefault());
  // Never reuse browser-restored Join values from an earlier authenticated account.
  profile?.reset();
  prefillJoin(root);
  const edited = new Set<string>();
  profile?.addEventListener("input", ev => { const input = ev.target as HTMLInputElement; if (input.name) edited.add(input.name); });
  profile?.addEventListener("change", ev => { const input = ev.target as HTMLInputElement; if (input.name) edited.add(input.name); });
  let generation = 0, account: string | undefined, loading = false;
  const resetAccount = () => {
    generation++; loading = false; account = undefined; edited.clear(); profile?.reset();
  };
  const prefill = async (me: Me) => {
    if (!me.canJoin || !me.signupView || loading || !profile) return;
    if (account && account !== me.signupView) resetAccount();
    account = me.signupView;
    if (!["friends", "ntwrk"].includes(me.app)) return;
    const requestGeneration = generation, requestAccount = account;
    loading = true;
    try {
      const response = await fetch("/oauth/signup-draft", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok || requestGeneration !== generation) return;
      const { draft, signupView } = await response.json();
      if (requestGeneration !== generation) return;
      // A cookie may have changed in another tab while this response was in flight.
      const current = await api.me();
      if (requestGeneration !== generation) return;
      if (signupView !== requestAccount || !current.ok || current.data.signupView !== requestAccount) {
        resetAccount();
        if (current.ok) { route(root, current.data, inviteOnly); void prefill(current.data); }
        else start(root);
        return;
      }
      if (!draft || typeof draft.firstName !== "string" || draft.firstName.length > 50) return;
      for (const name of ["firstName", "homeCity"] as const) {
        const input = profile.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
        const value = draft[name];
        if (!input || input.value || edited.has(name) || typeof value !== "string") continue;
        if (name === "homeCity" && value !== "sf" && value !== "nyc") continue;
        input.value = value;
      }
    } catch { /* Keep the draft server-side so a same-account revisit can retry. */ }
    finally { if (requestGeneration === generation) loading = false; }
  };
  showStep(root, "loading");
  const [app, me] = await Promise.all([api.app(), api.me()]);
  const inviteOnly = app.ok ? app.data.joinMode === "invite" : root.dataset.joinMode === "invite";
  fill(root, { minJoinAge: app.ok ? app.data.minJoinAge : root.dataset.minAge ?? "" });
  if (!app.ok && app.error === "api_unreachable") flowError(root, message(root, "api_unreachable"));

  if (me.ok) {
    route(root, me.data, inviteOnly);
    void prefill(me.data);
  } else if (inviteOnly) {
    showStep(root, "invite");
  } else {
    start(root);
  }
  ready(root);

  root.querySelectorAll('[data-action="restart"], [data-action="change-number"]').forEach((b) => b.addEventListener("click", () => { resetAccount(); start(root); }));

  mountAuth(root, async () => {
    resetAccount();
    flowError(root, "");
    const again = await api.me();
    if (again.ok) { route(root, again.data, inviteOnly); void prefill(again.data); }
    else {
      start(root);
      flowError(root, message(root, again.error));
    }
  }, () => {
    if (inviteToken === undefined) return true;
    try {
      sessionStorage.setItem(pendingInviteKey, inviteToken);
      return true;
    } catch { return false; }
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
      ...(account ? { signupView: account } : {}),
      ...(inviteToken !== undefined ? { inviteToken } : {}),
      firstName,
      age,
      ...(str("homeCity") ? { homeCity: str("homeCity") as "nyc" | "sf" } : {}),
      ...(str("neighborhood") ? { neighborhood: str("neighborhood") } : {}),
      ...(zip ? { zip } : {}),
      ...(interests.length ? { interests } : {}),
      ...(str("about") ? { about: str("about") } : {}),
      consent: { sms: true as const, wording: plainText($(form, "[data-consent-wording]")) },
    };
    const submitGeneration = generation, submitAccount = account;
    const res = await busy(form, () => api.join(body));
    if (submitGeneration !== generation) return;
    if (res.ok) {
      inviteToken = undefined;
      generation++; loading = false;
      // Deliberate successful Join ends the draft, without changing the normal Join contract.
      if (submitAccount && app.ok && ["friends", "ntwrk"].includes(app.data.id))
        void fetch("/oauth/signup-draft/discard", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ signupView: submitAccount }) }).catch(() => {});
      fill(root, { firstName: res.data.membership?.firstName ?? firstName });
      const done = $(root, '[data-step="done"]');
      if (new URLSearchParams(location.search).get("via") === "agent" && done && !done.querySelector("[data-agent-return]")) {
        const next = document.createElement("p");
        next.dataset.agentReturn = "";
        next.textContent = "Go back to the same chat to finish setting up your profile.";
        done.append(next);
      }
      showStep(root, "done");
    } else if (res.error === "account_changed") {
      resetAccount();
      const changedGeneration = generation, current = await api.me();
      if (changedGeneration !== generation) return;
      if (current.ok) { route(root, current.data, inviteOnly); void prefill(current.data); }
      else start(root);
      flowError(root, message(root, "account_changed"));
    } else if (res.error === "under_age" || res.error === "invite_only" || res.error === "review") {
      block(root, res.error);
    } else if (res.error === "unauthorized") {
      resetAccount(); start(root);
      flowError(root, message(root, "unauthorized"));
    } else {
      setError(form, message(root, res.error));
    }
  });
}

const root = document.querySelector<HTMLElement>("[data-join]");
if (root) void mountJoin(root);
