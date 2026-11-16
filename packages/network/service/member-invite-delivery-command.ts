import { normalizePhone } from "../../platform/src/phone.ts";

export type MemberInviteDeliveryCommand =
  | { kind: "stage"; link: string; e164: string }
  | { kind: "confirm"; reference: string }
  | { kind: "decline" }
  | { kind: "invalid" };

const REQUEST_PREFIX = /^send[ \t]+invite\b/i;
const CONFIRM_PREFIX = /^confirm[ \t]+expected[ \t]+invite\b/i;
const DECLINE_PREFIX = /^decline[ \t]+invite\b/i;
const REQUEST = /^send[ \t]+invite[ \t]+(https:\/\/[a-z0-9.-]{1,80}\/(?:SKILL\.md|join)#invite=[A-Za-z0-9_-]{43})[ \t]+to[ \t]+([0-9+(). -]{1,40})$/i;
const CONFIRM = /^confirm[ \t]+expected[ \t]+invite[ \t]+(mit_[a-p]{32})$/i;
const DECLINE = /^decline[ \t]+invite$/i;
const REFERENCE = /^mit_[a-p]{32}$/;

/** Decode a direct signed turn. The service binds the link, pending code and phone to current authority. */
export function memberInviteDeliveryCommand(text: string): MemberInviteDeliveryCommand | undefined {
  const line = text.trim();
  if (REQUEST_PREFIX.test(line)) {
    const [, link, phone] = REQUEST.exec(line) ?? [];
    const e164 = normalizePhone(phone);
    return link && e164 ? { kind: "stage", link, e164 } : { kind: "invalid" };
  }
  if (CONFIRM_PREFIX.test(line)) {
    const reference = CONFIRM.exec(line)?.[1]?.toLowerCase();
    return reference ? { kind: "confirm", reference } : { kind: "invalid" };
  }
  if (DECLINE_PREFIX.test(line)) return DECLINE.test(line) ? { kind: "decline" } : { kind: "invalid" };
}

const reply = {
  queued: "I've recorded your confirmation. An invitation gets at most one text.",
  unavailable: "I couldn't find a current invitation to send. You can ask me for an invitation to forward.",
  invalid: "Use SEND INVITE <your forwarding link> TO <their phone number>, or copy the exact confirmation command from my message.",
} as const;

/** Also acknowledge confirmation when we cannot contact the recipient. The reply reveals no recipient status. */
export function memberInviteDeliveryReply(outcome: keyof typeof reply): string {
  return reply[outcome];
}

/** Only the sender sees the pending code. The confirmation request has no address or forwarding token. */
export function memberInviteDeliveryPrompt(reference: string): string {
  if (!REFERENCE.test(reference)) return reply.unavailable;
  return `If they are expecting one invitation text from me, reply CONFIRM EXPECTED INVITE ${reference}. You can also forward your link yourself.`;
}
