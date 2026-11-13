import { APPS, keywordApp, type AppId, type AppInfo } from "../../platform/src/apps.ts";
import type { Membership } from "../../platform/src/store.ts";

export type ProfileReadRequest = { kind: "read"; app?: AppId } | { kind: "ambiguous" } | { kind: "refused" };

/** Only an explicit own-profile read selects an app within a sentence. */
export function profileReadRequest(
  text: string,
  apps: Record<AppId, Pick<AppInfo, "id" | "domain">> = APPS,
): ProfileReadRequest | undefined {
  let t = text
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/u, "");
  t = t
    .replace(
      /[.;!?]\s*(?:please )?(?:leave it unchanged|keep it unchanged|do not change anything|do not edit it(?: or suggest matches)?|don't edit it(?: or suggest matches)?)$/u,
      "",
    )
    .trim()
    .replace(/[.!?]+$/u, "");
  t = t.replace(/^(?:can|could) you (?:please )?/u, "");
  // A trailing courtesy or urgency word is not the app's name: "show my Friends profile please" is the
  // same read as "show my Friends profile". The front of the sentence already allows "Please ...".
  for (let i = 0; i < 2; i++)
    t = t.replace(/[.,;!?\s]+(?:thank you|thanks|right now|real quick|please|asap|pls|now)$/u, "").trim();
  const read =
    /^(?:please )?(?:show|read)(?: me| back| me back)? (.+)$/u.exec(t) ??
    /^what does (.+) say$/u.exec(t) ??
    /^what is (.+)$/u.exec(t);
  if (!read || !/\bprofiles?\b/u.test(read[1]!)) return;
  // A combined read/edit is still an edit request, never a read-only operation.
  if (
    /\b(?:edit|change|update|delete|remove|replace|set|save|join|leave|stop|start|add|enroll|suggest|introduce)\b/u.test(
      t,
    )
  )
    return;
  let subject = read[1]!;
  if (subject.startsWith("my ")) subject = subject.slice(3);
  else if (subject.startsWith("the ") && subject.endsWith(" i saved")) subject = subject.slice(4, -8);
  else return { kind: "refused" };
  subject = subject.replace(/ (?:i saved|you saved|you have saved)$/u, "");
  if (!/\bprofiles?$/u.test(subject)) return { kind: "ambiguous" };
  const appText = subject
    .replace(/\bprofiles?$/u, "")
    .replace(/\b(?:saved|stored|current)\b/gu, "")
    .trim();
  if (!appText) return { kind: "read" };
  const app = keywordApp(appText, apps);
  return app ? { kind: "read", app } : { kind: "ambiguous" };
}

/** Stored member-supplied fields only; no inferred facts, suggestions or model call. */
export function savedProfileText(app: AppInfo, membership: Membership, age?: number): string {
  const p = membership.profile;
  const location =
    typeof p.neighborhood === "string" && p.neighborhood.trim()
      ? p.neighborhood
      : p.homeCity === "sf"
        ? "San Francisco / Bay Area"
        : p.homeCity === "nyc"
          ? "New York City"
          : undefined;
  const title = [membership.firstName, age === undefined ? undefined : String(age), location]
    .filter(Boolean)
    .join(" · ");
  const fields = [
    title,
    typeof p.about === "string" && p.about.trim() ? p.about : undefined,
    Array.isArray(p.interests) && p.interests.every((v) => typeof v === "string") && p.interests.length
      ? `Interests: ${p.interests.join(", ")}`
      : undefined,
    typeof p.zip === "string" && p.zip.trim() ? `Postal code: ${p.zip}` : undefined,
  ].filter(Boolean);
  const text = `Here is your saved ${app.name} profile:\n${fields.join("\n")}\n\nI left it unchanged.`;
  // The existing signed Cloud delivery contract caps a handled reply at 1,600.
  // Refuse the oversized display explicitly; never truncate saved user fields.
  return text.length <= 1600 ? text : "Your saved profile is too long for one text. I left it unchanged.";
}
