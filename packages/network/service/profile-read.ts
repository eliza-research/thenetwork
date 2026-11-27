import { initial, step as stepProfileRead, type ProfileRead } from "../../core/src/generated/savedProfileRead.ts";
import { savedProfileFitsReply, savedProfileLocation } from "../../core/src/generated/savedProfileJourney.ts";
import { APPS, keywordApp, type AppId, type AppInfo } from "../../platform/src/apps.ts";
import type { Membership } from "../../platform/src/store.ts";

export type ProfileReadRequest = { decision: ProfileRead; app?: AppId };

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
  for (let i = 0; i < 2; i++)
    t = t.replace(/[.,;!?\s]+(?:thank you|thanks|right now|real quick|please|asap|pls|now)$/u, "").trim();
  const read =
    /^(?:please )?(?:show|read)(?: me| back| me back)? (.+)$/u.exec(t) ??
    /^what does (.+) say$/u.exec(t) ??
    /^what(?: is|'s|s) (.+)$/u.exec(t);
  const raw = read?.[1] ?? "";
  const subjectPhrase = raw.replace(/^(?:saved\s+)?(?:on|in)\s+/u, "");
  const wholeRead = !!read && /^(?:my|the|his|her|their|your|ur|[\p{L}][\p{L}'-]*'s)\s+(?:(?:saved|stored|current)\s+)*(?:[\p{L}\p{N}.'-]+(?:\s+(?:and|or)\s+[\p{L}\p{N}.'-]+)*\s+)?(?:(?:saved|stored|current)\s+)*profiles?(?:\s+(?:i saved|you saved|you have saved))?$/u.test(subjectPhrase);
  const ownSubject = subjectPhrase.startsWith("my ") || (subjectPhrase.startsWith("the ") && subjectPhrase.endsWith(" i saved"));
  const subject = subjectPhrase.replace(/^(?:my|the) /u, "").replace(/ (?:i saved|you saved|you have saved)$/u, "");
  const appText = subject
    .replace(/\bprofiles?$/u, "")
    .replace(/\b(?:saved|stored|current)\b/gu, "")
    .trim();
  const app = appText ? keywordApp(appText, apps) : undefined;
  const facts = {
    readForm: wholeRead,
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

export function savedProfileText(app: AppInfo, membership: Membership, age?: number): string {
  const p = membership.profile;
  const neighborhood = typeof p.neighborhood === "string" ? p.neighborhood : undefined;
  const label = savedProfileLocation(!!neighborhood?.trim(), typeof p.homeCity === "string" ? p.homeCity : "");
  const location = label === "NeighborhoodLabel" ? neighborhood
    : label === "BayAreaLabel" ? "San Francisco / Bay Area"
      : label === "NewYorkLabel" ? "New York City"
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
  return savedProfileFitsReply(text.length) ? text : "Your saved profile is too long for one text. I left it unchanged.";
}
