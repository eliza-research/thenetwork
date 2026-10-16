// Private photos on the settings page (slop.date only; packages/platform/src/photos.ts is the contract).
// Root: [data-photos] inside [data-settings]. It loads when the settings page shows the account (the
// "account" event), and stays hidden when photos are off, the person has no membership, they are not
// signed in, or they may not add photos (GET /api/photos says eligible: false). Adults only: the server
// refuses anyone whose lowest stated age is under 18 or unknown.
//   GET  /api/photos/consent   the consent text and version (shown next to the checkbox)
//   GET  /api/photos           {eligible, photos}: may they add one; their own photos (ids and dates only)
//   POST /api/photos           the image bytes, X-Photo-Consent: <version>
//   POST /api/photos/delete    {id}
// The browser makes a smaller JPEG first (at most 2048 px on the long side): the upload is small, and
// the new file has no EXIF or GPS block. The server checks the type on the bytes and strips metadata again.
import { $, formatDate } from "./ui.ts";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SIDE = 2048;
const TEXT: Record<string, string> = {
  photos_off: "",
  consent_required: "Tick the box to agree before you add a photo.",
  adults_only: "Photos are for adults (18+) only.",
  not_verified: "Photos are for adults (18+) only.",
  review: "We need to check this number before it can add photos. Email us for help.",
  too_large: "That photo is too large. Use one under 8 MB.",
  bad_type: "Use a JPEG, PNG or WebP photo.",
  bad_image: "We could not read that photo. Try another one.",
  too_many: "You have the most photos we keep. Delete one first.",
  not_found: "That photo is already gone.",
  unauthorized: "Your session ended. Please log in again.",
  network: "We can't reach our server right now. Nothing was sent. Please try again in a minute.",
};

interface PhotoItem { id: string; createdAt: number }

async function get(path: string): Promise<{ status: number; body: any }> {
  try {
    const r = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch { return { status: 0, body: { error: "network" } }; }
}
async function post(path: string, body: BodyInit, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  try {
    const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { accept: "application/json", ...headers }, body });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  } catch { return { status: 0, body: { error: "network" } }; }
}

/** A JPEG of at most MAX_SIDE px from the chosen file (no metadata), or the file itself when the browser cannot draw it. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const out = await new Promise<Blob | null>(res => c.toBlob(res, "image/jpeg", 0.88));
    return out ?? file;
  } catch { return file; }
}

export function mountPhotos(box: HTMLElement): void {
  const list = $(box, "[data-photo-list]")!;
  const status = $(box, "[data-photo-status]")!;
  const consentText = $(box, "[data-photo-consent-text]")!;
  const consent = box.querySelector<HTMLInputElement>("input[data-photo-consent]")!;
  const input = box.querySelector<HTMLInputElement>("input[type=file][data-photo-file]")!;
  let version = "";
  let generation = 0;
  const say = (t: string) => { status.textContent = t; };
  const why = (b: any) => TEXT[String(b?.error ?? "")] ?? "Something went wrong. Nothing was changed. Please try again.";

  async function load(): Promise<void> {
    const g = ++generation;
    const [c, mine, relay] = await Promise.all([get("/api/photos/consent"), get("/api/photos"), get("/api/relay-photos/options")]);
    if (g !== generation) return;
    const selections = relay.status === 200 && Array.isArray(relay.body.selections) ? relay.body.selections as { itemId: string; photoId: string; state: string; expiresAt: number }[] : [];
    // Own cancellation survives policy/storage withdrawal and loss of upload eligibility.
    if (c.status !== 200 || (mine.status !== 200 && !selections.length)) { box.hidden = true; return; }
    // Not allowed to add photos here (under 18 or unknown age, a ban, an app that takes none) and nothing
    // left to delete: the section stays hidden, so a minor never sees the consent text or the upload control.
    if (mine.body.eligible !== true && !(mine.body.photos ?? []).length && !selections.length) { box.hidden = true; return; }
    box.hidden = false;
    version = String(c.body.version ?? "");
    consentText.textContent = String(c.body.text ?? "");
    // Photos still there but no longer allowed to add one: they can be deleted, and nothing can be added.
    input.disabled = mine.body.eligible !== true; consent.disabled = mine.body.eligible !== true;
    if (mine.body.eligible !== true) say(why({ error: "adults_only" }));
    const items = (mine.body.photos ?? []) as PhotoItem[];
    list.replaceChildren(...items.map((p, i) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = `Photo ${i + 1}, added ${formatDate(new Date(p.createdAt).toISOString())}`;
      const del = document.createElement("button");
      del.type = "button"; del.className = "linkish"; del.textContent = "Delete";
      del.setAttribute("aria-label", `Delete photo ${i + 1}`);
      del.addEventListener("click", async () => {
        del.disabled = true;
        const r = await post("/api/photos/delete", JSON.stringify({ id: p.id }), { "content-type": "application/json" });
        say(r.status === 200 ? "Photo deleted." : why(r.body));
        await load();
      });
      li.append(label, " ", del);
      // Closed by default. Only an approved item-review policy returns these options.
      if (relay.status === 200 && relay.body.enabled === true && Array.isArray(relay.body.threads) && relay.body.threads.length && !selections.some(s => s.photoId === p.id && (s.state === "pending" || s.state === "approved"))) {
        const choose = document.createElement("select");
        choose.setAttribute("aria-label", `Share photo ${i + 1} with a match`);
        choose.add(new Option("Choose a match", ""));
        for (const thread of relay.body.threads) choose.add(new Option(String(thread.label), String(thread.id)));
        const notice = document.createElement("label"), agree = document.createElement("input"), words = document.createElement("span");
        agree.type = "checkbox"; agree.disabled = true;
        notice.append(agree, words);
        const send = document.createElement("button"); send.type = "button"; send.textContent = "Request photo sharing"; send.disabled = true;
        choose.addEventListener("change", () => {
          requestNonce = "";
          agree.checked = false; agree.disabled = !choose.value; send.disabled = true;
          words.textContent = choose.value ? String(relay.body.notice).replaceAll("{{recipient}}", choose.selectedOptions[0]!.textContent ?? "") : "";
        });
        let requestNonce = "";
        agree.addEventListener("change", () => {
          send.disabled = !agree.checked || !choose.value;
          if (agree.checked && choose.value) {
            const key = JSON.stringify(["photo-relay", relay.body.accountView, p.id, choose.value, relay.body.version]);
            try {
              const terminal = selections.filter(s => s.photoId === p.id && (s.state === "revoked" || s.state === "rejected" || s.state === "expired")).map(s => s.itemId).sort().join(",");
              const retained = JSON.parse(sessionStorage.getItem(key) ?? "null") as { nonce?: string; terminal?: string } | null;
              requestNonce = retained?.terminal === terminal && typeof retained.nonce === "string" ? retained.nonce : crypto.randomUUID();
              sessionStorage.setItem(key, JSON.stringify({ nonce: requestNonce, terminal }));
            } catch { requestNonce ||= crypto.randomUUID(); }
          }
        });
        send.addEventListener("click", async () => {
          if (g !== generation || !agree.checked || !choose.value) return;
          send.disabled = true;
          const result = await post("/api/relay-photos/select", JSON.stringify({ photoId: p.id, threadId: choose.value, noticeVersion: relay.body.version, consent: true }), { "content-type": "application/json", "x-photo-account": String(relay.body.accountView), "idempotency-key": requestNonce });
          if (g !== generation) return;
          agree.checked = false;
          say(result.status === 200 ? "Your selected photo is waiting for a safety review. It has not been sent." : result.status === 409 ? "Your account changed. Refresh before choosing a photo." : "This photo cannot be shared right now.");
          // A reload discovers the persisted selection even when the POST response was lost.
          await load();
        });
        li.append(document.createElement("br"), choose, notice, send);
      }
      return li;
    }));
    for (const selected of selections) {
      const li = document.createElement("li");
      li.textContent = selected.state === "pending" ? "Selected photo: waiting for a safety review. " : selected.state === "approved" ? "Selected photo: approved for sharing. " : selected.state === "expired" ? "Photo-sharing permission expired." : "Photo sharing canceled.";
      if (selected.state === "pending" || selected.state === "approved") {
        const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = "Cancel photo sharing";
        cancel.addEventListener("click", async () => {
          if (g !== generation) return;
          cancel.disabled = true;
          const stopped = await post("/api/relay-photos/revoke", JSON.stringify({ itemId: selected.itemId }), { "content-type": "application/json", "x-photo-account": String(relay.body.accountView) });
          if (g !== generation) return;
          say(stopped.status === 200 ? "Photo sharing canceled." : stopped.status === 409 ? "Your account changed. Refresh before canceling." : "Could not cancel. Refresh and try again.");
          await load();
        });
        li.append(cancel);
      }
      list.append(li);
    }
    if (!items.length && !selections.length) { const li = document.createElement("li"); li.className = "muted"; li.textContent = "No photos yet."; list.append(li); }
  }

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!consent.checked) return say(TEXT.consent_required!);
    say("Adding your photo…");
    input.disabled = true;
    try {
      const blob = await shrink(file);
      if (blob.size > MAX_BYTES) return say(TEXT.too_large!);
      const r = await post("/api/photos", blob, { "content-type": blob.type || "image/jpeg", "x-photo-consent": version });
      say(r.status === 200 ? "Photo added. Only the matchmaker uses it, privately." : why(r.body));
    } finally {
      input.disabled = false;
      await load();
    }
  });

  // Only for a member of this app (the settings page sends its GET /api/me answer with the event).
  box.closest("[data-settings]")?.addEventListener("account", e => {
    ++generation; list.replaceChildren(); consent.checked = false; status.textContent = "";
    if ((e as CustomEvent<{ membership: unknown } | undefined>).detail?.membership) void load(); else box.hidden = true;
  });
}

const box = document.querySelector<HTMLElement>("[data-photos]");
if (box) mountPhotos(box);
