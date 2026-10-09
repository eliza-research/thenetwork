// /settings: log in by phone, then see this app's membership, export it, stop messages,
// leave this app, or delete everything tied to the phone number.
// Root: [data-settings]. Steps: loading, phone, code, account, gone.
// Actions: button[data-action="export|stop|leave|delete-all|logout|photo-agree"].
// Photos (slop.date): [data-when="photos"] is shown only to a signed-in verified adult (GET /api/photos
// says eligible; the API refuses everyone else too). It holds form[data-form="photos"] with the
// current consent text ([data-slot="photoConsent"], from the API) and its checkbox, a file input, and
// ul[data-photo-list] with a delete button per photo. No score or rating is ever shown.
// Confirms: dialog[data-confirm="stop|leave|delete-all"] holding form[method=dialog] with a
// button value="confirm". The delete-all dialog also holds input[name=confirmText] that must
// equal its data-word attribute. A page without the dialog cannot run the action (fail closed).
// Connected assistants (PRD 11.5): every settings page links /oauth/consents, where the person sees
// and removes the AI assistants they allowed. A page without its own [data-assistants] block gets one.
import { api, type Me, type PhotoList } from "./api.ts";
import { mountAuth } from "./auth.ts";
import { $, busy, fill, formatDate, message, ready, setError, showStep, when } from "./ui.ts";

const STATE_LABELS: Record<string, string> = {
  active: "Active",
  member: "Active",
  invited: "Invited",
  pending: "Waiting for review",
  waitlist: "On the waitlist",
  minor: "Active (personal help only)",
  paused: "Paused",
  opted_out: "Messages stopped",
  stopped: "Messages stopped",
  removed: "Removed",
};

function status(root: HTMLElement, text: string): void {
  const el = $(root, "[data-status]");
  if (el) el.textContent = text;
}

function flowError(root: HTMLElement, text: string): void {
  const el = $(root, "[data-flow-error]");
  if (!el) return;
  el.textContent = text;
  el.hidden = text === "";
}

/** The link to the person's connected assistants (/oauth/consents on this site), added once to the actions. */
function assistantsLink(root: HTMLElement): void {
  if (root.querySelector("[data-assistants]")) return;
  const actions = $(root, ".actions");
  if (!actions) return;
  const box = document.createElement("div");
  box.dataset.assistants = "";
  const h = document.createElement("h3");
  h.textContent = "Connected assistants";
  const p = document.createElement("p");
  p.textContent = "See which AI assistants you allowed to check your status here, and remove any of them. You can also text DISCONNECT.";
  const a = document.createElement("a");
  a.className = "btn quiet";
  a.href = "/oauth/consents";
  a.textContent = "Connected assistants";
  box.append(h, p, a);
  actions.insertBefore(box, actions.children[1] ?? null);
}

function render(root: HTMLElement, me: Me): void {
  const m = me.membership;
  const stopped = m ? ["opted_out", "stopped"].includes(m.state) : false;
  fill(root, {
    phoneMasked: me.phoneMasked,
    firstName: m?.firstName ?? "",
    state: m ? STATE_LABELS[m.state] ?? m.state : "",
    joinedAt: m ? formatDate(m.joinedAt) : "",
  });
  when(root, "has-membership", !!m);
  when(root, "no-membership", !m);
  when(root, "stopped", stopped);
  when(root, "not-stopped", !!m && !stopped);
  assistantsLink(root);
  showStep(root, "account");
}

/** Photo refusals in the page's words (the platform's codes, packages/platform/src/photos.ts). */
const PHOTO_MESSAGES: Record<string, string> = {
  consent_required: "Please tick the box to agree to how we keep your photos.",
  too_large: "That photo is too large. The limit is 8 MB.",
  bad_type: "Please choose a JPEG, PNG or WebP photo.",
  bad_image: "We could not read that photo. Please try another one.",
  too_many: "You already have 6 photos. Delete one to add another.",
  photos_off: "Photos are not available right now.",
};
const STATUS_LABELS: Record<string, string> = { pending: "Waiting for a check", approved: "Checked", rejected: "Not used" };

/** The consent version the page shows, set from the API. */
let photoConsentVersion = "";

function renderPhotos(root: HTMLElement, list: PhotoList): void {
  when(root, "photos", list.eligible);
  when(root, "no-photos", list.eligible && list.photos.length === 0);
  const ul = $(root, "[data-photo-list]");
  if (!ul) return;
  ul.replaceChildren(
    ...list.photos.map((p, i) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `Photo ${i + 1}, added ${formatDate(new Date(p.createdAt).toISOString())} (${STATUS_LABELS[p.status] ?? p.status})`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "linkish";
      del.textContent = "Delete";
      del.setAttribute("aria-label", `Delete photo ${i + 1}`);
      del.addEventListener("click", async () => {
        del.disabled = true;
        const res = await api.deletePhoto(p.id);
        if (!res.ok) { del.disabled = false; return status(root, message(root, res.error)); }
        status(root, "Photo deleted.");
        await refreshPhotos(root);
      });
      li.append(label, " ", del);
      return li;
    }),
  );
}

/** Shows the photo section only to a verified adult; hides it on any refusal or error. */
async function refreshPhotos(root: HTMLElement): Promise<void> {
  if (!$(root, "[data-photos]")) return;
  const [consent, list] = await Promise.all([api.photoConsent(), api.photos()]);
  if (!consent.ok || !list.ok) return when(root, "photos", false);
  photoConsentVersion = consent.data.version;
  fill(root, { photoConsent: consent.data.text });
  renderPhotos(root, list.data);
}

async function refresh(root: HTMLElement): Promise<void> {
  const me = await api.me();
  if (me.ok) { render(root, me.data); await refreshPhotos(root); return; }
  showStep(root, "phone");
  if (me.error !== "unauthorized") flowError(root, message(root, me.error));
}

/**
 * Opens a confirm dialog. Resolves true only when the person pressed the confirm button. No dialog,
 * or a browser without showModal: false, so a destructive action never runs unconfirmed.
 */
export function confirmWith(dialog: HTMLDialogElement | null): Promise<boolean> {
  if (!dialog || typeof dialog.showModal !== "function") return Promise.resolve(false);
  const word = dialog.dataset.word;
  const input = dialog.querySelector<HTMLInputElement>('input[name="confirmText"]');
  const ok = dialog.querySelector<HTMLButtonElement>('button[value="confirm"]');
  if (input && ok && word) {
    input.value = "";
    ok.disabled = true;
    input.oninput = () => (ok.disabled = input.value.trim().toUpperCase() !== word);
  }
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true });
  });
}

function download(name: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function mountSettings(root: HTMLElement): Promise<void> {
  showStep(root, "loading");
  mountAuth(root, async () => {
    flowError(root, "");
    await refresh(root);
  });
  await refresh(root);
  ready(root);

  const act = (name: string, fn: (btn: HTMLButtonElement) => Promise<void>) =>
    root.querySelectorAll<HTMLButtonElement>(`[data-action="${name}"]`).forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await fn(b);
        } finally {
          b.disabled = false;
        }
      }),
    );
  const dialog = (name: string) => root.querySelector<HTMLDialogElement>(`dialog[data-confirm="${name}"]`);

  act("export", async () => {
    status(root, "Preparing your file…");
    const res = await api.exportData();
    if (!res.ok) return status(root, message(root, res.error));
    download(`${root.dataset.exportName ?? "my-data"}.json`, res.data);
    status(root, "Your file is downloaded. It holds only this site's data about you.");
  });

  act("stop", async () => {
    if (!(await confirmWith(dialog("stop")))) return;
    const res = await api.stop();
    if (!res.ok) return status(root, message(root, res.error));
    await refresh(root);
    status(root, root.dataset.msgStopped ?? "Messages are stopped. Text START to us to turn them back on.");
  });

  act("leave", async () => {
    if (!(await confirmWith(dialog("leave")))) return;
    const res = await api.remove("app");
    if (!res.ok) return status(root, message(root, res.error));
    status(root, "");
    fill(root, { goneText: root.dataset.goneApp ?? "You left. We deleted your data for this site." });
    showStep(root, "gone");
  });

  act("delete-all", async () => {
    if (!(await confirmWith(dialog("delete-all")))) return;
    const res = await api.remove("all");
    if (!res.ok) return status(root, message(root, res.error));
    status(root, "");
    fill(root, { goneText: root.dataset.goneAll ?? "Everything tied to your phone number is deleted." });
    showStep(root, "gone");
  });

  const photoForm = root.querySelector<HTMLFormElement>('form[data-form="photos"]');
  photoForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const agreed = photoForm.querySelector<HTMLInputElement>('input[name="consent"]')?.checked ?? false;
    const file = photoForm.querySelector<HTMLInputElement>('input[name="photo"]')?.files?.[0];
    if (!agreed) return setError(photoForm, PHOTO_MESSAGES.consent_required!);
    if (!file) return setError(photoForm, "Please choose a photo.");
    setError(photoForm, "");
    const res = await busy(photoForm, () => api.uploadPhoto(file, photoConsentVersion));
    if (!res.ok) return setError(photoForm, (res.code && PHOTO_MESSAGES[res.code]) || message(root, res.error));
    photoForm.reset();
    status(root, "Photo added. Someone on our team checks it before it is used.");
    await refreshPhotos(root);
  });

  act("photo-agree", async () => {
    if (!photoForm) return;
    if (!photoForm.querySelector<HTMLInputElement>('input[name="consent"]')?.checked) return setError(photoForm, PHOTO_MESSAGES.consent_required!);
    setError(photoForm, "");
    const res = await api.agreePhotos(photoConsentVersion);
    if (!res.ok) return setError(photoForm, (res.code && PHOTO_MESSAGES[res.code]) || message(root, res.error));
    status(root, "Thanks. You can now send your photos by text.");
  });

  act("logout", async () => {
    // Show the logged-out screen only after the server ended the session.
    const res = await api.logout();
    if (!res.ok) return status(root, message(root, res.error));
    status(root, "");
    showStep(root, "phone");
  });
}

const root = document.querySelector<HTMLElement>("[data-settings]");
if (root) void mountSettings(root);
