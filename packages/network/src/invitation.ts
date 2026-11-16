import type { AppId, MemberId } from "@thenetwork/core";
import { publicSignupUsesBrowser } from "../../core/src/generated/siteEnrollment.ts";

export type InviteRelationship = "friend" | "coworker" | "roommate" | "family";
export type InviteDepth = "met_once" | "somewhat" | "well";
export type InviteReviewReason = "weak_vouch" | "burst" | "risk_language";

export interface MemberInviteEvidence {
  durationMonths: number;
  depth: InviteDepth;
}

export interface MemberInviteRequest extends MemberInviteEvidence {
  inviterId: MemberId;
  requestId: string;
  messageId: string;
  firstName: string;
  relationship: InviteRelationship;
  reviewReasons: readonly InviteReviewReason[];
  disposition: "issue" | "review";
  at: number;
}

export type MemberInviteResult = { status: "issued"; url: string } | { status: "review"; reviewId?: string };

const personalRelationships = {
  friend: "friend", buddy: "friend", pal: "friend", coworker: "coworker", roommate: "roommate", cousin: "family",
} as const satisfies Record<string, InviteRelationship>;

const namedVouch = /\b[Mm]y (friend|buddy|pal|coworker|roommate|cousin) (\p{Lu}[\p{L}\p{M}'’-]{0,39})(?=$|[^\p{L}\p{M}'’-])/u;
const requestBeforeVouch = /^(?:please\s+)?(?:invite|i (?:want|would like) to invite|i['’]d like to invite|(?:can|could|would) you (?:please )?invite|(?:please )?send me an invite link for)\s*$/i;
const requestAfterVouch = /(?:^|,\s*|\band\s+)(?:can|could|would) you (?:please )?invite (?:them|her|him)\s*$/i;
const restOfRequest = /^\s*(?:to (?:the network|join))?\s*(?:please)?\s*$/i;

/** A concrete first name coupled to a direct request, with no phone number or third-party profile. */
export function directInviteVouch(body: string): Pick<MemberInviteRequest, "firstName" | "relationship"> | undefined {
  for (const clause of body.normalize("NFKC").split(/[.!?;\n]+/)) {
    const vouch = namedVouch.exec(clause.trim());
    if (!vouch) continue;
    const [whole, relationship, firstName] = vouch;
    const trimmed = clause.trim();
    const before = trimmed.slice(0, vouch.index);
    const after = trimmed.slice(vouch.index + whole.length);
    if ((requestBeforeVouch.test(before) && restOfRequest.test(after)) || (vouch.index === 0 && requestAfterVouch.test(after))) {
      return { firstName: firstName!, relationship: personalRelationships[relationship as keyof typeof personalRelationships] };
    }
  }
  return undefined;
}

const inviteDuration = /(?<![\d.])\b(\d{1,4}(?:\.\d{1,2})?|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(day|week|month|year)s?\b/i;
const durationWords = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const durationPerMonth: Record<string, number> = { day: 1 / 30, week: 7 / 30, month: 1, year: 12 };
const individualDepths = [
  [/\b(?:met (?:them |her |him )?(?:just |only )?once|only (?:met|spoken) (?:them |her |him )?once|met one time)\b/i, "met_once"],
  [/\b(?:somewhat|a little|not (?:very )?(?:close|well))\b/i, "somewhat"],
  [/\b(?:well|close(?: friends)?|very close)\b/i, "well"],
] as const;

/** A coarse relationship statement. Keep categories and whole months, never the source text. */
export function inviteVouchEvidence(body: string): MemberInviteEvidence | undefined {
  const text = body.normalize("NFKC");
  const duration = inviteDuration.exec(text);
  const depth = individualDepths.find(([pattern]) => pattern.test(text))?.[1];
  if (!duration || !depth) return;
  const stated = duration[1]!.toLowerCase();
  const amount = /^\d/.test(stated) ? Number(stated) : stated === "a" || stated === "an" ? 1 : durationWords.indexOf(stated);
  return { durationMonths: Math.floor(amount * durationPerMonth[duration[2]!.toLowerCase()]!), depth };
}

const unusualInviteLanguage = /\b(?:strangers?|met online|underage|minors?|pay(?:ing|ment)?|paid|cash|money|deposit|investment|recruit(?:ing|ment)?|mass invit(?:e|es|ing)|promot(?:e|ion|ing)|pitch(?:ing)?)\b/i;

export function inviteVouchRisk(body: string): boolean {
  return unusualInviteLanguage.test(body.normalize("NFKC"));
}

export function inviteReviewReference(value: string | undefined): string | undefined {
  return value?.length === 36 && /^mir_[a-f0-9]{32}$/.test(value) ? value : undefined;
}

function invitationLinkPrefix(app: { id: AppId; domain: string }): string {
  const path = publicSignupUsesBrowser(app.id) ? "/join" : "/SKILL.md";
  return `https://${app.domain}${path}#invite=`;
}

export function memberInvitationLink(app: { id: AppId; domain: string }, token: string): string {
  return `${invitationLinkPrefix(app)}${token}`;
}

export function isMemberInvitationLink(app: { id: AppId; domain: string }, url: string): boolean {
  const prefix = invitationLinkPrefix(app);
  const token = url.slice(prefix.length);
  return url.startsWith(prefix) && token.length === 43 && /^[A-Za-z0-9_-]+$/.test(token);
}
