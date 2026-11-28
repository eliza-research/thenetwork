import { cityTimezone, DAY, fromLocal, localParts, quietEndAfterText, quietStartAfterText, type Category } from "@thenetwork/core";
import {
  changeParticipationCategory, controlRomanceOptIn, pauseUntilWeekdayDaysAhead,
  participationCategoryAllowed, participationControlAllowed, participationControlState,
  quietHoursCommandComplete, quietHoursEmpty, quietHoursOffHour,
} from "../../core/src/generated/participationControls.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import { canMatchInApp } from "../../platform/src/age.ts";
import { memberCommandOwner, type MemberCommandOwner } from "./member-command.ts";

type ParticipationCommand = { kind: "mode"; pause: boolean; durationDays?: number; untilWeekday?: number; untilTomorrow?: boolean }
  | { kind: "quiet"; hours?: [number, number]; start?: number; end?: number }
  | { kind: "category"; category: Category; enable: boolean };

const WEEKDAYS: Record<string, number> = { monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6 };
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const CATEGORY_NAMES = new Map<string, Category>([
  ["social", "social"], ["friend", "social"], ["friends", "social"], ["friendship", "social"],
  ["professional", "professional"], ["work", "professional"], ["jobs", "professional"], ["career", "professional"], ["networking", "professional"],
  ["romance", "romance"], ["dating", "romance"], ["dates", "romance"], ["hobby", "hobby"], ["hobbies", "hobby"],
  ["help", "help"], ["events", "events"], ["growth", "growth"], ["invitations", "growth"],
]);
const CATEGORY_LABELS: Record<Category, string> = {
  social: "Friendship", professional: "Work", romance: "Dating", hobby: "Hobby", help: "Help", events: "Event", growth: "Growth",
};

function hourOf(text: string): number | undefined {
  const military = /^(\d{1,2}):(00|30)$/.exec(text);
  if (military) {
    const h = Number(military[1]);
    return h >= 0 && h < 24 ? h + (military[2] === "30" ? 0.5 : 0) : undefined;
  }
  const meridiem = /^(1[0-2]|[1-9])(?::(00|30))? *(am|pm)$/.exec(text);
  if (meridiem) return (Number(meridiem[1]) % 12) + (meridiem[3] === "pm" ? 12 : 0) + (meridiem[2] === "30" ? 0.5 : 0);
}

function durationDaysOf(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = /^(?:for )?(a|an|one|two|three|four|\d{1,2}) (day|days|week|weeks|month|months)$/.exec(text.trim());
  if (!m) return undefined;
  const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4 };
  const n = words[m[1]!] ?? Number(m[1]);
  if (!Number.isSafeInteger(n) || n < 1 || n > 90) return undefined;
  const unit = m[2]!;
  const days = unit.startsWith("week") ? n * 7 : unit.startsWith("month") ? n * 30 : n;
  return days <= 180 ? days : undefined;
}

export function participationCommand(text: string): ParticipationCommand | undefined {
  const line = text.normalize("NFKC").trim().toLowerCase().replace(/[.!]$/, "").replace(/\s+/g, " ").replace(/^please /, "");
  const mode = /^(pause|resume) (?:my )?(?:matching|introductions|matches)$/.exec(line);
  if (mode) return { kind: "mode", pause: mode[1] === "pause" };
  const naturalPause = /^(?:(?:pause(?: me| my matching| matching| my matches| matches| my introductions| introductions)?|put me on pause)(?: (?:(for (?:a|an|one|two|three|four|\d{1,2}) (?:days?|weeks?|months?))|until (?:next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)))?|pause(?: my texts| texts| my messages| messages) until (?:next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)|(?:i need to |let me )?take a break(?: (?:(for (?:a|an|one|two|three|four|\d{1,2}) (?:days?|weeks?|months?))|until (?:next )?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow)))?)$/.exec(line);
  if (naturalPause && line !== "pause") {
    const durationDays = durationDaysOf(naturalPause[1] ?? naturalPause[4]);
    const untilWord = naturalPause[2] ?? naturalPause[3] ?? naturalPause[5];
    return { kind: "mode", pause: true,
      ...(durationDays !== undefined ? { durationDays } : {}),
      ...(untilWord === "tomorrow" ? { untilTomorrow: true } : untilWord ? { untilWeekday: WEEKDAYS[untilWord] } : {}) };
  }
  if (/^(?:unpause(?: me| my matching| matching)?|resume me)$/.test(line)) return { kind: "mode", pause: false };
  if (/^(?:quiet hours off|(?:turn off|clear) (?:my )?quiet hours)$/.test(line)) return { kind: "quiet", hours: [quietHoursOffHour, quietHoursOffHour] };
  const quiet = /^(?:set )?(?:my )?quiet hours(?: (.*))?$/.exec(line);
  if (quiet) {
    const range = /^(?:(?:from|to|are) )?(.+?) *(?: to | until |[-–—]) *(.+)$/.exec(quiet[1] ?? "");
    const start = range ? hourOf(range[1]!.trim()) : undefined;
    const end = range ? hourOf(range[2]!.trim()) : undefined;
    return { kind: "quiet", hours: quietHoursCommandComplete(start !== undefined, end !== undefined, start ?? 0, end ?? 0) ? [start!, end!] : undefined };
  }
  const bounded = /^(?:don't|do not|dont|never|stop|quit|cease|no more|no) (?:text|message|contact|msg|sms|send|texting|messaging|contacting|sending|write to|email|texts|messages|msgs)(?: (?:me|us))?(?: (?:texts?|messages?|msgs?))? (after|before) (.+)$/.exec(line);
  if (bounded) {
    const hour = hourOf(bounded[2]!.trim());
    if (hour !== undefined) {
      return bounded[1] === "after" ? { kind: "quiet", start: hour } : { kind: "quiet", end: hour };
    }
  }
  const setting = /^(allow|enable|turn on|disable|turn off|no more|stop sending(?: me)?|skip|mute) (.+?)(?: (?:suggestions|offers|matches|introductions|intros|stuff|ones|plans))?$/.exec(line);
  const category = setting ? CATEGORY_NAMES.get(setting[2]!) : undefined;
  if (category && setting) return { kind: "category", category, enable: ["allow", "enable", "turn on"].includes(setting[1]!) };
}

const displayHour = (hour: number) => {
  const whole = Math.floor(hour);
  const mins = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

export async function saveParticipationControl(tx: SQL, accounts: Pick<Accounts, "activeMembership" | "lowestAge">,
  owner: MemberCommandOwner, command: ParticipationCommand, appCategories: readonly string[], now: number): Promise<string | undefined> {
  const binding = await memberCommandOwner(tx, accounts, owner);
  const member = binding?.member;
  if (!participationControlAllowed(true, !!member) || !binding || !member) return;
  const { app, memberId, e164 } = owner;
  if (command.kind === "mode") {
    const state = participationControlState(command.pause);
    let until = command.pause && command.durationDays ? new Date(now + command.durationDays * DAY).toISOString() : null;
    if (command.pause && (command.untilWeekday !== undefined || command.untilTomorrow)) {
      const tz = cityTimezone(member.home_city) ?? "UTC";
      const parts = localParts(now, tz);
      const daysAhead = command.untilTomorrow ? 1 : pauseUntilWeekdayDaysAhead(parts.weekday, command.untilWeekday!);
      const end = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + daysAhead));
      until = new Date(fromLocal(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate(), 0, tz)).toISOString();
    }
    const windowPayload = until ? { state: "paused", from: new Date(now).toISOString(), until } : null;
    const saved = await tx`update network.members set participation_state=${state}, participation_window=${windowPayload}::jsonb
      where app_id=${app.id} and id=${memberId} and (participation_state is distinct from ${state} or participation_window is distinct from ${windowPayload}::jsonb) returning id`;
    if (saved.length) await tx`insert into network.events(app_id, at, actor_type, actor_id, type, object_type, object_id, payload)
      values (${app.id}, ${new Date(now)}, 'member', ${memberId}, 'member_state_requested', 'member', ${memberId},
        ${{ state: command.pause ? "paused" : "open", from: until ? new Date(now).toISOString() : null, until, source: "text" }}::jsonb)`;
    if (command.pause && command.durationDays) {
      const span = command.durationDays % 7 === 0 ? `${command.durationDays / 7} week${command.durationDays === 7 ? "" : "s"}` : `${command.durationDays} day${command.durationDays === 1 ? "" : "s"}`;
      return `Matching is paused for this app for ${span}. Say ‘resume matching’ when you're ready.`;
    }
    if (command.pause && (command.untilWeekday !== undefined || command.untilTomorrow)) {
      const resumeDay = command.untilTomorrow ? "tomorrow" : WEEKDAY_NAMES[command.untilWeekday!];
      return `Matching is paused for this app until ${resumeDay}. Say ‘resume matching’ when you're ready.`;
    }
    return command.pause ? "Matching is paused for this app. Say ‘resume matching’ when you're ready." : "Matching is no longer paused for this app. Your category choices and quiet hours still apply.";
  }

  const prefs = member.prefs ?? {};
  let patch: { quietHours: [number, number] } | { categoriesOptIn: string[]; romanceOptIn?: boolean };
  let reply: string;
  if (command.kind === "quiet") {
    const saved = Array.isArray(prefs.quietHours) && prefs.quietHours.length === 2
      && prefs.quietHours.every((h: unknown) => typeof h === "number" && Number.isFinite(h) && h >= 0 && h < 24 && Math.round(h * 2) === h * 2)
      ? prefs.quietHours as [number, number] : [21, 9] as [number, number];
    const hours = command.hours ?? (command.start !== undefined || command.end !== undefined
      ? [quietStartAfterText(saved[0], command.start ?? saved[0], command.start !== undefined),
        quietEndAfterText(saved[1], command.end ?? saved[1], command.end !== undefined)] as [number, number]
      : undefined);
    if (!hours) return "Use whole local hours, like ‘quiet hours 10 pm to 8 am’ or ‘quiet hours 22:00 to 08:00’.";
    patch = { quietHours: hours };
    reply = quietHoursEmpty(...hours) ? "Quiet hours are off for this app." : `Quiet hours are ${displayHour(hours[0])} to ${displayHour(hours[1])} local time for this app.`;
  } else {
    const { category, enable } = command;
    const age = category === "romance" && enable ? await accounts.lowestAge(e164, binding.person) : undefined;
    if (!participationCategoryAllowed(category, enable, appCategories.includes(category), canMatchInApp(age, app))) {
      return `${CATEGORY_LABELS[category]} suggestions are unavailable for this membership.`;
    }
    const current = Array.isArray(prefs.categoriesOptIn) ? prefs.categoriesOptIn : [];
    patch = {
      categoriesOptIn: changeParticipationCategory(current, category, enable),
      ...(category === "romance" ? { romanceOptIn: controlRomanceOptIn(prefs.romanceOptIn === true, category, enable) } : {}),
    };
    reply = `${CATEGORY_LABELS[category]} suggestions are ${enable ? "on" : "off"} for this app.`;
  }
  const saved = await tx`update network.members set prefs=coalesce(prefs, '{}'::jsonb) || ${patch}::jsonb
    where app_id=${app.id} and id=${memberId} and (coalesce(prefs, '{}'::jsonb) || ${patch}::jsonb) is distinct from prefs returning id`;
  if (saved.length) await tx`insert into network.events(app_id, at, actor_type, actor_id, type, object_type, object_id, payload)
    values (${app.id}, ${new Date(now)}, 'member', ${memberId}, 'member_preferences_changed', 'member', ${memberId}, ${patch}::jsonb)`;
  return reply;
}
