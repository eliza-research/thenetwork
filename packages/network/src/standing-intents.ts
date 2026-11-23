import { createHash } from "node:crypto";

export type StandingTarget = { kind: "reference"; reference: string } | { kind: "position"; position: number } | { kind: "pending" };

export type StandingIntentCommand =
  | { kind: "ListIntents"; page: number }
  | { kind: "PauseIntent" | "CloseIntent" | "ResumeIntent" | "KeepIntent"; target: StandingTarget }
  | { kind: "UndoIntent" };

export type StandingTurn = { kind: "reply"; body: string } | { kind: "silent" } | { kind: "pass" };

export type StandingKind = "want" | "intent" | "request" | "posting";
export type StandingStatus = "active" | "paused" | "waiting_on_you" | "open";

export interface StandingEntry {
  ref: string; number: number; kind: StandingKind; summary: string; status: StandingStatus; inProgress: boolean; endsAt: number | null;
}

export interface StandingView {
  entries: StandingEntry[];
  closedRecently: { ref: string; summary: string; closedAt: number }[];
  checkWithPerson: { ref: string; summary: string; reason: "said_not_wanted" | "ended_recently" }[];
}

export type AgentStandingResult =
  | { kind: "applied"; entry: StandingEntry; notice: string }
  | { kind: "unchanged"; entry: StandingEntry }
  | { kind: "refused"; reason: "unknown_ref" | "daily_limit" | "closed" | "posting" | "adults_only" };

const CHANGE_VERBS = { pause: "PauseIntent", close: "CloseIntent", resume: "ResumeIntent", keep: "KeepIntent" } as const;

export function standingIntentCommand(text: string): StandingIntentCommand | undefined {
  const body = text.trim().replace(/[‘’ʼ`´]/g, "'").replace(/\s+/g, " ");
  const list = /^(?:list|show) (?:my )?(?:standing )?intents(?: (?:page )?([1-9]\d{0,2}))?[.!?]?$/i.exec(body);
  if (list) return { kind: "ListIntents", page: Number(list[1] ?? "1") };
  if (/^(?:what am i looking for|what'?s active)[.!?]?$/i.test(body)) return { kind: "ListIntents", page: 1 };
  const change = /^(pause|close|resume|keep) (?:my )?(?:standing )?(?:intent )?(I-[a-f\d]{12}|[1-9]\d?)[.!?]?$/i.exec(body);
  if (change) {
    const kind = CHANGE_VERBS[change[1]!.toLowerCase() as keyof typeof CHANGE_VERBS];
    const named = change[2]!;
    return { kind, target: /^I-/i.test(named) ? { kind: "reference", reference: named.toUpperCase() } : { kind: "position", position: Number(named) } };
  }
  if (/^close[.!?]?$/i.test(body)) return { kind: "CloseIntent", target: { kind: "pending" } };
  if (/^keep(?: it| looking)?[.!?]?$/i.test(body)) return { kind: "KeepIntent", target: { kind: "pending" } };
  if (/^undo[.!?]?$/i.test(body)) return { kind: "UndoIntent" };
}

export function standingIntentReference(app: string, member: string, key: string): string {
  const digest = createHash("sha256").update(JSON.stringify([app, member, key])).digest("hex");
  return `I-${digest.slice(0, 12).toUpperCase()}`;
}

const dayFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" });
export const standingDate = (ms: number) => dayFormat.format(new Date(ms));
const quoted = (summaries: readonly string[]) => summaries.map(s => `“${s}”`).join(", ");
const LINE_STATUS: Record<StandingStatus, string> = { active: "active", paused: "paused", waiting_on_you: "waiting on you", open: "open" };

export const STANDING_COPY = {
  listHeader: (app: string, page: number, pages: number) => `What you're looking for in ${app} (${page}/${pages})`,
  listLine: (e: StandingEntry, endsSoon: boolean) =>
    `${e.number}. ${e.summary} · ${LINE_STATUS[e.status]}${e.inProgress ? " · introduction in progress" : ""}${endsSoon && e.endsAt !== null ? ` · ends ${standingDate(e.endsAt)}` : ""} · ${e.ref}`,
  listFooter: (first: number, nextPage: number | undefined) =>
    `Reply PAUSE ${first}, RESUME ${first} or CLOSE ${first}.${nextPage ? ` For more, say “list my intents ${nextPage}”.` : ""}`,
  listEmpty: (app: string) => `Nothing is active for you in ${app} right now. Tell me what you'd like to find.`,
  listPages: (pages: number) => `${pages === 1 ? "There is 1 page." : `There are ${pages} pages.`} Say “what am I looking for” to start.`,
  closed: (summaries: readonly string[]) =>
    `Closed: ${quoted(summaries)}. Reply UNDO within 24 hours to keep ${summaries.length > 1 ? "them" : "it"}.`,
  closedWithIntro: (summaries: readonly string[], released: number) =>
    `Closed: ${quoted(summaries)} and the introduction in progress.${released > 0 ? " The other person gets a short note that doesn't name you." : ""} Reply UNDO within 24 hours to turn the search back on.`,
  bookedStays: " A meeting you already booked for this stays on.",
  askFirst: (summaries: readonly string[]) =>
    `${quoted(summaries)} is paused: no new searches. An introduction for it is already in progress. Reply CLOSE to close it and that introduction, or KEEP to turn the search back on.`,
  paused: (summaries: readonly string[], inProgress: boolean) =>
    `Paused: ${quoted(summaries)}. No new searches for it. Reply UNDO to turn it back on.${inProgress ? " An introduction already in progress continues. Reply CLOSE to close that too." : ""}`,
  resumed: (summaries: readonly string[]) => `Back on: ${quoted(summaries)}.`,
  kept: (summary: string, until: number) => `Kept: “${summary}”. I'll keep looking until ${standingDate(until)}.`,
  pausedAgain: (summaries: readonly string[]) => `Paused again: ${quoted(summaries)}.`,
  nothingToUndo: "There's nothing to undo right now. Say “what am I looking for” to see your list.",
  unknown: "I couldn't find that one. Say “what am I looking for” to see your current list.",
  staleNumber: "That list is out of date. Say “what am I looking for” to see the current one.",
  already: (summary: string, state: "paused" | "on" | "closed") => `“${summary}” is already ${state}. No change made.`,
  pausedStays: (summary: string) => `“${summary}” is paused, so I'm not looking for it now. Say “what am I looking for” to see your list and turn it back on.`,
  postingNoPause: (title: string) => `Job posts can't be paused. Say “close my ${title} post” to close it.`,
  renewal: (summary: string, deadline: number) =>
    `Still looking for “${summary}”? Reply KEEP to keep looking for 60 more days. If not, it ends on ${standingDate(deadline)}.`,
  agentPaused: (summary: string, app: string, inProgress: boolean) =>
    `Your assistant paused “${summary}” in ${app}. No new searches for it. Reply UNDO to turn it back on.${inProgress ? " An introduction already in progress continues. Reply CLOSE to close that too." : ""}`,
  agentResumed: (summary: string, app: string) => `Your assistant turned “${summary}” back on in ${app}. Reply UNDO to pause it again.`,
};
