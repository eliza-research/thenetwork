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
  const say = (t: string) => { status.textContent = t; };
  const why = (b: any) => TEXT[String(b?.error ?? "")] ?? "Something went wrong. Nothing was changed. Please try again.";

  async function load(): Promise<void> {
    const [c, mine] = await Promise.all([get("/api/photos/consent"), get("/api/photos")]);
    // Photos off, not signed in, or no person yet: the section stays hidden.
    if (c.status !== 200 || mine.status === 401 || mine.status === 503) { box.hidden = true; return; }
    // Not allowed to add photos here (under 18 or unknown age, a ban, an app that takes none) and nothing
    // left to delete: the section stays hidden, so a minor never sees the consent text or the upload control.
    if (mine.status !== 200 || (mine.body.eligible !== true && !(mine.body.photos ?? []).length)) { box.hidden = true; return; }
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
      return li;
    }));
    if (!items.length) { const li = document.createElement("li"); li.className = "muted"; li.textContent = "No photos yet."; list.append(li); }
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
    if ((e as CustomEvent<{ membership: unknown } | undefined>).detail?.membership) void load(); else box.hidden = true;
  });
}

const box = document.querySelector<HTMLElement>("[data-photos]");
if (box) mountPhotos(box);
