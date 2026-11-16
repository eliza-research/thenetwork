import { createHash } from "node:crypto";

export type StandingIntentCommand =
  | { kind: "ListIntents"; page: number }
  | { kind: "PauseIntent" | "CloseIntent"; reference: string };

export function standingIntentCommand(text: string): StandingIntentCommand | undefined {
  const body = text.trim();
  const list = /^(?:list|show) (?:my )?(?:standing )?intents(?: (?:page )?([1-9]\d{0,2}))?[.!?]?$/i.exec(body);
  if (list) return { kind: "ListIntents", page: Number(list[1] ?? "1") };
  const change = /^(pause|close) (?:my )?(?:standing )?intent (I-[a-f\d]{12})[.!?]?$/i.exec(body);
  if (change) return { kind: change[1]?.toLowerCase() === "pause" ? "PauseIntent" : "CloseIntent", reference: change[2]!.toUpperCase() };
}

export function standingIntentReference(app: string, member: string, key: string): string {
  const digest = createHash("sha256").update(JSON.stringify([app, member, key])).digest("hex");
  return `I-${digest.slice(0, 12).toUpperCase()}`;
}
