// /settings: log in by phone, then see this app's membership, export it, stop messages,
// leave this app, or delete everything tied to the phone number.
// Root: [data-settings]. Steps: loading, phone, code, account, gone.
// Actions: button[data-action="export|stop|leave|delete-all|logout"].
// Confirms: dialog[data-confirm="stop|leave|delete-all"] holding form[method=dialog] with a
// button value="confirm". The delete-all dialog also holds input[name=confirmText] that must
// equal its data-word attribute. A page without the dialog cannot run the action (fail closed).
import { api, type Me } from "./api.ts";
import { mountAuth } from "./auth.ts";
import { $, fill, formatDate, message, ready, showStep, when } from "./ui.ts";

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

function render(root: HTMLElement, me: Me): void {
  const m = me.membership;
  const stopped = typeof me.smsOptedIn === "boolean" ? !me.smsOptedIn
    : m ? ["opted_out", "stopped"].includes(m.state) : false;
  fill(root, {
    phoneMasked: me.phoneMasked,
    firstName: m?.firstName ?? "",
    state: m ? stopped ? STATE_LABELS.stopped : STATE_LABELS[m.state] ?? m.state : "",
    joinedAt: m ? formatDate(m.joinedAt) : "",
  });
  when(root, "has-membership", !!m);
  when(root, "no-membership", !m);
  when(root, "stopped", stopped);
  when(root, "not-stopped", !!m && !stopped);
  showStep(root, "account");
}

async function refresh(root: HTMLElement): Promise<void> {
  const me = await api.me();
  if (me.ok) return render(root, me.data);
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
    status(root, root.dataset.msgStopped ?? "Messages from every app powered by The Network are stopped. Text START to resume this app.");
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
