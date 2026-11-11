// /join flow: phone -> code -> short profile -> done. Notices on the page (slop.date's safety notice)
// are information next to the flow, never a step that blocks joining (PRD 40.7).
// Root: [data-join]. Optional attributes on the root:
//   data-join-mode="invite"     the page's default when /api/app cannot be read
//   data-min-age="13"           the page's default when /api/app cannot be read
// Steps: loading, invite, phone, code, profile, member, blocked, done.
import { api, type ApiError, type Me } from "./api.ts";
import { type Flow, type FlowEvent, type JoinFields, type JoinForm, flowNext, formPasses, formProblems, formResets, initialFlow } from "./join-core.ts";
import { prefillJoin } from "./prefill.ts";
import { mountAuth } from "./auth.ts";
import { $, busy, fill, formatDate, message, plainText, ready, setError, showStep, when } from "./ui.ts";

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
}

/** Fills the slots of the step that flowNext will choose for this person. */
function route(root: HTMLElement, me: Me, inviteOnly: boolean): void {
  if (me.canJoin) {
    fill(root, { phoneMasked: me.phoneMasked });
  } else if (me.membership) {
    fill(root, { firstName: me.membership.firstName, joinedAt: formatDate(me.membership.joinedAt) });
  } else {
    block(root, me.reason ?? (inviteOnly ? "invite_only" : "unknown"));
  }
}

/** The account key of a session. The page has no phone number when it finds an existing session. */
const accountOf = (me: Me): string => me.signupView ?? me.phoneMasked;

export async function mountJoin(root: HTMLElement): Promise<void> {
  const profile = $(root, 'form[data-form="profile"]') as HTMLFormElement | null;
  // Block native GET submission even while the optional draft is loading.
  profile?.addEventListener("submit", event => event.preventDefault());
  // Never reuse browser-restored Join values from an earlier authenticated account.
  profile?.reset();
  prefillJoin(root);
  const field = (name: string) => profile?.elements.namedItem(name) as HTMLInputElement | null | undefined;
  const fields = (): JoinFields => ({ firstName: field("firstName")?.value ?? "", age: field("age")?.value ?? "", ticked: field("consent")?.checked ?? false });
  let flow = initialFlow(fields());
  const dispatch = (event: FlowEvent): Flow => {
    const prev = flow;
    flow = flowNext(prev, event);
    if (formResets(prev, flow)) profile?.reset();
    flowError(root, flow.notice ? message(root, flow.notice as ApiError) : "");
    if (flow.step !== prev.step) showStep(root, flow.step);
    return flow;
  };
  const typed = () => dispatch({ tag: "typed", fields: fields() });
  const edited = new Set<string>();
  profile?.addEventListener("input", ev => { const input = ev.target as HTMLInputElement; if (input.name) edited.add(input.name); typed(); });
  profile?.addEventListener("change", ev => { const input = ev.target as HTMLInputElement; if (input.name) edited.add(input.name); typed(); });
  // account: the signupView marker of the shown account. /api/join sends it, so the server joins only
  // that account (409 account_changed for another cookie). marked: the server gave a marker for it.
  let generation = 0, account: string | undefined, marked = false, loading = false;
  // A new session cancels the answers in flight. flowNext decides what happens to the fields.
  const resetAccount = () => {
    generation++; loading = false; account = undefined; edited.clear();
  };
  // Take the marker of the account that the next sign-in step shows, on every site.
  const takeAccount = (me: Me) => { marked = !!me.signupView; account = me.canJoin ? me.signupView : undefined; };
  const prefill = async (me: Me) => {
    if (!me.canJoin || !["friends", "ntwrk"].includes(me.app) || !me.signupView || loading || !profile) return;
    if (account && account !== me.signupView) resetAccount();
    account = me.signupView;
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
        if (current.ok) { routeTo(current.data, ""); void prefill(current.data); }
        else dispatch({ tag: "sessionEnded", notice: "" });
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
      typed();
    } catch { /* Keep the draft server-side so a same-account revisit can retry. */ }
    finally { if (requestGeneration === generation) loading = false; }
  };
  showStep(root, "loading");
  const [app, me] = await Promise.all([api.app(), api.me()]);
  const inviteOnly = app.ok ? app.data.joinMode === "invite" : root.dataset.joinMode === "invite";
  fill(root, { minJoinAge: app.ok ? app.data.minJoinAge : root.dataset.minAge ?? "" });
  const notice = !app.ok && app.error === "api_unreachable" ? "api_unreachable" : "";
  // A signed-in person who changes account mid-Join goes through the same step as a sign-in.
  const routeTo = (me: Me, reason: string) => {
    takeAccount(me);
    route(root, me, inviteOnly);
    dispatch({ tag: "rerouted", account: accountOf(me), canJoin: me.canJoin, member: !!me.membership, notice: reason });
  };

  if (me.ok) {
    takeAccount(me.data);
    route(root, me.data, inviteOnly);
    dispatch({ tag: "loaded", signedInAs: accountOf(me.data), canJoin: me.data.canJoin, member: !!me.data.membership, inviteOnly, notice });
    void prefill(me.data);
  } else {
    dispatch({ tag: "loaded", signedInAs: "", canJoin: false, member: false, inviteOnly, notice });
  }
  ready(root);

  mountAuth(root, {
    current: () => flow,
    dispatch,
    onSignedIn: async (phone: string) => {
      resetAccount();
      const signInGeneration = generation, again = await api.me();
      // An answer from an older generation never moves the step.
      if (signInGeneration !== generation) return;
      if (again.ok) {
        takeAccount(again.data);
        route(root, again.data, inviteOnly);
        // Sign in as the session that /api/me read. flowNext ignores it when the number changed.
        // The key is the verified number when me shows its last 4 digits: two numbers can share a masked form.
        const key = again.data.signupView ?? (again.data.phoneMasked.endsWith(phone.slice(-4)) ? phone : again.data.phoneMasked);
        dispatch({ tag: "verified", phone, account: key, canJoin: again.data.canJoin, member: !!again.data.membership });
        void prefill(again.data);
      } else if (flow.step === "code" && flow.phone === phone) dispatch({ tag: "sessionEnded", notice: again.error });
    },
  });

  const form = $(root, 'form[data-form="profile"]') as HTMLFormElement | null;
  form?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = new FormData(form);
    const str = (k: string) => String(f.get(k) ?? "").trim();
    const firstName = str("firstName");
    const age = Number(str("age"));
    const zip = str("zip");
    const { ticked } = typed().fields;
    const checked: JoinForm = { firstName, age, wholeAge: Number.isInteger(age), zip, ticked };
    const found = formProblems(checked);
    const problems: string[] = [];
    if (found.name) problems.push("Enter your first name.");
    for (const radio of form.querySelectorAll<HTMLInputElement>("input[type=radio][required]")) {
      const group = form.querySelectorAll<HTMLInputElement>(`input[type=radio][name="${radio.name}"]`);
      if (![...group].some((r) => r.checked)) {
        const legend = plainText(radio.closest("fieldset")?.querySelector("legend") ?? null);
        problems.push(`Choose one: ${legend || "an option"}.`);
      }
    }
    if (found.age) problems.push("Enter your age in years.");
    if (found.zip) problems.push("Enter a 5-digit ZIP code, or leave it empty.");
    if (found.consent) problems.push("Tick the box to agree to texts. We can only work by text.");
    if (problems.length || !formPasses(checked)) {
      setError(form, problems.join(" "));
      return;
    }
    // Never send a join without the marker of the shown account when the server gave one.
    if (marked && !account) return;
    setError(form, "");
    const interests = f.getAll("interests").map(String).filter(Boolean);
    const body = {
      ...(account ? { signupView: account } : {}),
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
    // The form stays busy until the account_changed reroute has read /api/me (JF-3).
    await busy(form, async () => {
      const res = await api.join(body);
      if (submitGeneration !== generation) return;
      if (res.ok) {
        generation++; loading = false;
        // Deliberate successful Join ends the draft, without changing the normal Join contract.
        if (submitAccount) void fetch("/oauth/signup-draft/discard", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ signupView: submitAccount }) }).catch(() => {});
        fill(root, { firstName: res.data.membership?.firstName ?? firstName });
        const done = $(root, '[data-step="done"]');
        if (new URLSearchParams(location.search).get("via") === "agent" && done && !done.querySelector("[data-agent-return]")) {
          const next = document.createElement("p");
          next.dataset.agentReturn = "";
          next.textContent = "Go back to the same chat to finish setting up your profile.";
          done.append(next);
        }
        dispatch({ tag: "joined" });
      } else if (res.error === "account_changed") {
        resetAccount();
        const changedGeneration = generation, current = await api.me();
        if (changedGeneration !== generation) return;
        if (current.ok) { routeTo(current.data, "account_changed"); void prefill(current.data); }
        else dispatch({ tag: "sessionEnded", notice: "account_changed" });
      } else if (res.error === "under_age" || res.error === "invite_only" || res.error === "review") {
        block(root, res.error);
        dispatch({ tag: "refused" });
      } else if (res.error === "unauthorized") {
        resetAccount();
        dispatch({ tag: "sessionEnded", notice: "unauthorized" });
      } else {
        setError(form, message(root, res.error));
      }
    });
  });
}

const root = document.querySelector<HTMLElement>("[data-join]");
if (root) void mountJoin(root);
