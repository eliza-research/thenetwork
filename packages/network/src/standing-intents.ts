import { createHash } from "node:crypto";

const referenceAlphabet = "ABCDEFGHIJKLMNOP";

function encodeReference(hex: string): string {
  return `INT-${Array.from(hex, digit => referenceAlphabet[Number.parseInt(digit, 16)]).join("")}`;
}

export type StandingIntentCommand =
  | { kind: "ListIntents"; page: number }
  | { kind: "PauseIntent" | "CloseIntent"; reference: string };

export function standingIntentCommand(text: string): StandingIntentCommand | undefined {
  const body = text.trim();
  const list = /^(?:list|show) (?:my )?(?:standing )?intents(?: (?:page )?([1-9]\d{0,2}))?[.!?]?$/i.exec(body);
  if (list) return { kind: "ListIntents", page: Number(list[1] ?? "1") };
  const change = /^(pause|close) (?:my )?(?:standing )?intent (INT-[a-p]{12}|I-[a-f0-9]{12})[.!?]?$/i.exec(body);
  if (change) {
    const supplied = change[2]!.toUpperCase();
    return {
      kind: change[1]?.toLowerCase() === "pause" ? "PauseIntent" : "CloseIntent",
      reference: supplied.startsWith("I-") ? encodeReference(supplied.slice(2)) : supplied,
    };
  }
}

export function standingIntentReference(app: string, member: string, key: string): string {
  const digest = createHash("sha256").update(JSON.stringify([app, member, key])).digest("hex");
  return encodeReference(digest.slice(0, 12));
}
