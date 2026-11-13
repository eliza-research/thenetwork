import { initial, step as stepProfileRead, type ProfileRead } from "../../core/src/generated/savedProfileRead.ts";
import { APPS, keywordApp, type AppId, type AppInfo } from "../../platform/src/apps.ts";
import type { Membership } from "../../platform/src/store.ts";

export type ProfileReadRequest = { decision: ProfileRead; app?: AppId };

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
  const read =
    /^(?:please )?(?:show|read)(?: me| back| me back)? (.+)$/u.exec(t) ??
    /^what does (.+) say$/u.exec(t) ??
    /^what is (.+)$/u.exec(t);
  const raw = read?.[1] ?? "";
  const ownSubject = raw.startsWith("my ") || (raw.startsWith("the ") && raw.endsWith(" i saved"));
  const subject = raw.replace(/^(?:my|the) /u, "").replace(/ (?:i saved|you saved|you have saved)$/u, "");
  const appText = subject
    .replace(/\bprofiles?$/u, "")
    .replace(/\b(?:saved|stored|current)\b/gu, "")
    .trim();
  const app = appText ? keywordApp(appText, apps) : undefined;
  const facts = {
    readForm: !!read,
    namesProfile: /\bprofiles?\b/u.test(raw),
    asksChange: /\b(?:edit|change|update|delete|remove|replace|set|save|join|leave|stop|start|add|enroll|suggest|introduce)\b/u.test(t),
    ownSubject,
    endsWithProfile: /\bprofiles?$/u.test(subject),
    hasAppName: !!appText,
    appKnown: app !== undefined,
  };
  const decision = stepProfileRead(initial, { type: "classifyRead", facts });
  if (decision.phase !== "AwaitingAuthority") return;
  return { decision, app: decision.intent === "NamedRead" ? app : undefined };
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
