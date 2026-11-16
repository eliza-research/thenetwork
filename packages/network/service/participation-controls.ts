import type { Category } from "@thenetwork/core";
import {
  changeParticipationCategory, controlQuietHoursValid, controlRomanceOptIn,
  participationCategoryAllowed, participationControlAllowed, participationControlState,
} from "../../core/src/generated/participationControls.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import { canMatchInApp } from "../../platform/src/age.ts";
import { memberCommandOwner, type MemberCommandOwner } from "./member-command.ts";

type ParticipationCommand = { kind: "mode"; pause: boolean }
  | { kind: "quiet"; hours?: [number, number] }
  | { kind: "category"; category: Category; enable: boolean };

const CATEGORY_NAMES = new Map<string, Category>([
  ["social", "social"], ["friends", "social"], ["friendship", "social"],
  ["professional", "professional"], ["work", "professional"], ["jobs", "professional"],
  ["romance", "romance"], ["dating", "romance"], ["hobby", "hobby"], ["hobbies", "hobby"],
  ["help", "help"], ["events", "events"], ["growth", "growth"], ["invitations", "growth"],
]);
const CATEGORY_LABELS: Record<Category, string> = {
  social: "Friendship", professional: "Work", romance: "Dating", hobby: "Hobby", help: "Help", events: "Event", growth: "Growth",
};

function hourOf(text: string): number | undefined {
  const military = /^(\d{1,2}):00$/.exec(text);
  if (military) return Number(military[1]);
  const meridiem = /^(1[0-2]|[1-9])(?::00)? *(am|pm)$/.exec(text);
  if (meridiem) return Number(meridiem[1]) % 12 + (meridiem[2] === "pm" ? 12 : 0);
}

/** Recognize explicit own-app commands without turning profile prose into a setting. */
export function participationCommand(text: string): ParticipationCommand | undefined {
  const line = text.normalize("NFKC").trim().toLowerCase().replace(/[.!]$/, "").replace(/\s+/g, " ").replace(/^please /, "");
  const mode = /^(pause|resume) (?:my )?(?:matching|introductions|matches)$/.exec(line);
  if (mode) return { kind: "mode", pause: mode[1] === "pause" };
  if (/^(?:quiet hours off|(?:turn off|clear) (?:my )?quiet hours)$/.test(line)) return { kind: "quiet", hours: [0, 0] };
  const quiet = /^(?:set )?(?:my )?quiet hours(?: (.*))?$/.exec(line);
  if (quiet) {
    const range = /^(?:(?:from|to|are) )?(.+?) *(?: to | until |[-–—]) *(.+)$/.exec(quiet[1] ?? "");
    const start = range ? hourOf(range[1]!.trim()) : undefined;
    const end = range ? hourOf(range[2]!.trim()) : undefined;
    return { kind: "quiet", hours: start !== undefined && end !== undefined && controlQuietHoursValid(start, end) ? [start, end] : undefined };
  }
  const setting = /^(allow|enable|turn on|disable|turn off|no more) (.+?)(?: (?:suggestions|offers|matches|introductions))?$/.exec(line);
  const category = setting ? CATEGORY_NAMES.get(setting[2]!) : undefined;
  if (category && setting) return { kind: "category", category, enable: !["disable", "turn off", "no more"].includes(setting[1]!) };
}

const displayHour = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/** Check ownership and apply an explicit command in the same transaction as its signed reply. */
export async function saveParticipationControl(tx: SQL, accounts: Pick<Accounts, "activeMembership" | "lowestAge">,
  owner: MemberCommandOwner, command: ParticipationCommand, appCategories: readonly string[], now: number): Promise<string | undefined> {
  const binding = await memberCommandOwner(tx, accounts, owner);
  const member = binding?.member;
  if (!participationControlAllowed(true, !!member) || !binding || !member) return;
  const { app, memberId, e164 } = owner;
  if (command.kind === "mode") {
    const state = participationControlState(command.pause);
    const saved = await tx`update network.members set participation_state=${state}, participation_window=null
      where app_id=${app.id} and id=${memberId} and (participation_state is distinct from ${state} or participation_window is not null) returning id`;
    if (saved.length) await tx`insert into network.events(app_id, at, actor_type, actor_id, type, object_type, object_id, payload)
      values (${app.id}, ${new Date(now)}, 'member', ${memberId}, 'member_state_requested', 'member', ${memberId},
        ${{ state: command.pause ? "paused" : "open", from: null, until: null, source: "text" }}::jsonb)`;
    return command.pause ? "Matching is paused for this app. Say ‘resume matching’ when you're ready." : "Matching is no longer paused for this app. Your category choices and quiet hours still apply.";
  }

  const prefs = member.prefs ?? {};
  let patch: { quietHours: [number, number] } | { categoriesOptIn: string[]; romanceOptIn?: boolean };
  let reply: string;
  if (command.kind === "quiet") {
    const hours = command.hours;
    if (!hours) return "Use whole local hours, like ‘quiet hours 10 pm to 8 am’ or ‘quiet hours 22:00 to 08:00’.";
    patch = { quietHours: hours };
    reply = hours[0] === hours[1] ? "Quiet hours are off for this app." : `Quiet hours are ${displayHour(hours[0])} to ${displayHour(hours[1])} local time for this app.`;
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
