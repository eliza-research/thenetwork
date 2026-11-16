import type { AppId, MemberId } from "@thenetwork/core";

export type InviteRelationship = "friend" | "coworker" | "roommate" | "family";

export interface MemberInviteRequest {
  inviterId: MemberId;
  messageId: string;
  firstName: string;
  relationship: InviteRelationship;
  at: number;
}

export type MemberInviteResult = { status: "issued"; url: string } | { status: "review" };

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

function invitationLinkPrefix(app: { id: AppId; domain: string }): string {
  const path = app.id === "peon" ? "/join" : "/SKILL.md";
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
