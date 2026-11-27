// spec/consoleNavigation.md, "The viewer answer selects a page that the roles cover"
// spec/staffSignIn.md, "The server answer decides the sign-in phase"
import { useEffect, type ReactNode, type RefObject } from "react";
import type { City, ScoreComponents } from "@thenetwork/core";
import { getCity } from "../../../packages/core/src/cities.ts";
import { CITY_TZ } from "../../../packages/core/src/time.ts";
import {
  AreaLink as AreaSubjectLink, Countdown as ClockCountdown, formatDuration, MemberLink as MemberSubjectLink, MeterBars, OpportunityLink, StatusMark,
  type MeterRow, type StatusTone,
} from "@thenetwork/ui";
import { canJumpToTab, type ConsoleNav, type FilterKey as NavFilterKey, jumpToTab } from "../../../packages/core/src/generated/consoleNavigation.ts";
import { initial as initialWorkspace, receiveViewer as receiveWorkViewer, type StaffView, type WorkMode } from "../../../packages/core/src/generated/consoleWorkspace.ts";
import { type IdentityAnswer, methodForAnswer, phaseForAnswer, type StaffSignIn } from "../../../packages/core/src/generated/staffSignIn.ts";
import type { ObsOpportunity, SystemEvent } from "../src/types.ts";
import { navTab, store, STORE_TAB, type DrawerTab, type FilterKey } from "./store.ts";

export { navTab, STORE_TAB, subjectOf } from "./store.ts";

const tf = new Map<string, Intl.DateTimeFormat>();
function fmt(opts: Intl.DateTimeFormatOptions, city?: City) {
  const tz = city ? (getCity(city)?.tz ?? CITY_TZ[city] ?? CITY_TZ.nyc) : store.activeTz();
  const key = `${tz}|${JSON.stringify(opts)}`;
  if (!tf.has(key)) tf.set(key, new Intl.DateTimeFormat("en-US", { timeZone: tz, ...opts }));
  return tf.get(key)!;
}
export const localTime = (t: number, city?: City) => fmt({ hour: "numeric", minute: "2-digit" }, city).format(t);
export const localDate = (t: number, city?: City) => fmt({ weekday: "short", month: "short", day: "numeric" }, city).format(t).replace(",", "");
export const shortDate = (t: number, city?: City) => fmt({ month: "short", day: "numeric" }, city).format(t);
export const stamp = (t: number, city?: City) => fmt({ month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }, city).format(t);
export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
export const num = (x: number) => x.toLocaleString("en-US");
export const humanize = (s: string) => s.replace(/_/g, " ").toLowerCase();
export const sentence = (s: string) => { const h = humanize(s); return h.charAt(0).toUpperCase() + h.slice(1); };
/** Compact duration: "45m", "4h 12m", "2d 3h". */
export const dur = formatDuration;
/** "3h ago", "2d ago" against the store clock (simulated time in the game, wall time on real data). */
export function ago(t: number, now = store.now()) { return `${dur(Math.max(0, now - t))} ago`; }

/** Closes the open popover (store.ui.popover) on a click outside `ref`. */
export function useOutsideClose(ref: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) store.setUI({ popover: null }); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
}

/** A member name that moves the console focus to the member. */
export function MemberLink({ id, first, children }: { id: string; first?: boolean; children?: ReactNode }) {
  const m = store.members.get(id);
  const n = m ? (first ? m.name.split(" ")[0] : m.name) : id;
  return <MemberSubjectLink onOpen={() => store.focus({ kind: "member", id })}>{children ?? n}</MemberSubjectLink>;
}
/** An opportunity name ("Maya + Jon") that moves the console focus to the opportunity. */
export function OppLink({ o, children }: { o: ObsOpportunity; children?: ReactNode }) {
  return <OpportunityLink onOpen={() => store.focus({ kind: "opportunity", id: o.id })}>{children ?? store.oppTitle(o)}</OpportunityLink>;
}
/** A neighborhood name that moves the console focus to the neighborhood. */
export function AreaLink({ area }: { area?: string }) {
  if (!area) return null;
  return <AreaSubjectLink onOpen={() => store.focus({ kind: "neighborhood", id: area })}>{area}</AreaSubjectLink>;
}
/** The time left to a review deadline on the store clock. */
export function Countdown({ deadline, prefix = "", what = "Review deadline" }: { deadline: number; prefix?: string; what?: string }) {
  return <ClockCountdown deadline={deadline} now={store.now()} prefix={prefix} what={what} deadlineLabel={stamp(deadline)} />;
}

export const COMPONENT_SIGN: Record<keyof ScoreComponents, 1 | -1> = {
  fit: 1, mutualBenefit: 1, warmPath: 1, novelty: 1, timingFit: 1, confidence: 1,
  activationCost: -1, interruptionCost: -1, load: -1, repetition: -1, socialRisk: -1,
};
export function hasScoreParts(c: ScoreComponents): boolean {
  return Object.values(c).some(v => v !== 0);
}
export function componentRows(c: ScoreComponents, gainTone: "primary" | "ok" = "primary", costTone: "warn" | "destructive" = "warn"): MeterRow[] {
  return (Object.keys(COMPONENT_SIGN) as (keyof ScoreComponents)[]).map(k => ({
    key: k, label: humanize(k.replace(/([A-Z])/g, "_$1")), value: c[k], tone: COMPONENT_SIGN[k] < 0 ? costTone : gainTone, title: `${k}: ${c[k]}`,
  }));
}

export function ScoreParts({ c, emptyNote = false, gainTone = "primary" }: { c?: ScoreComponents; emptyNote?: boolean; gainTone?: "primary" | "ok" }) {
  if (!c) return null;
  if (!hasScoreParts(c)) return emptyNote ? <p className="text-sm text-muted-foreground">no component breakdown for this source</p> : null;
  return <MeterBars aria-label="Score parts" rows={componentRows(c, gainTone, "destructive")} ranked={false} max={1} format={v => v.toFixed(2)} />;
}

export function eventBadge(e: SystemEvent): { tone: StatusTone; label: string } {
  const t = e.type, d = e.detail ?? {};
  if (t === "review_decision") {
    if (d.decision === "reject") return { tone: "destructive", label: "rejected" };
    if (d.decision === "reroll") return { tone: "warn", label: "re-rolled" };
    return { tone: "ok", label: "approved" };
  }
  if (t === "review_expired") return { tone: "destructive", label: "expired" };
  if (t === "review_invalidated" || t === "review_refused" || t === "send_refused" || t === "send_skipped" || t === "proposal_skipped" || t === "gate_reason") {
    return { tone: "warn", label: humanize(t) };
  }
  if (t.startsWith("review")) return { tone: "primary", label: humanize(t) };
  if (t.startsWith("probe") || t === "time_answer") return { tone: "primary", label: humanize(t) };
  if (t === "send_deferred") return { tone: "warn", label: "deferred" };
  if (t === "booked_cancelled") return { tone: "destructive", label: "cancelled" };
  if (t === "guard_blocked") return { tone: "destructive", label: "leak blocked" };
  if (t === "trust" || t === "abuse" || t === "safety_flag" || t === "safety_action" || t === "member_blocked") return { tone: "destructive", label: humanize(t) };
  if (t.startsWith("age") || t === "minor_signal" || t === "join_declined") return { tone: "warn", label: humanize(t) };
  if (t === "meeting_scheduled" || t === "interaction_occurred" || t === "member_accepted") return { tone: "ok", label: humanize(t) };
  return { tone: e.severity === "bad" ? "destructive" : e.severity === "warn" ? "warn" : e.severity === "good" ? "ok" : "neutral", label: humanize(t) };
}

export function EventBadge({ e }: { e: SystemEvent }) {
  const badge = eventBadge(e);
  return <StatusMark tone={badge.tone} label={badge.label} showLabel />;
}

export function downloadTextFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The generated filter key of each store filter. */
export const NAV_FILTER: Record<FilterKey, NavFilterKey> = { range: "RangeKey", borough: "BoroughKey", members: "MembersKey", origin: "OriginKey", stateGroup: "StateKey" };

/** The console navigation state of the store, for the generated consoleNavigation decisions. */
export function consoleNav(s = store): ConsoleNav {
  return s.nav();
}

/** Opens the drawer on a tab only where the generated `canJumpToTab` allows it, with the state of `jumpToTab`. True when the tab opened. */
export function jumpTo(tab: DrawerTab, s = store): boolean {
  const nav = consoleNav(s);
  if (!canJumpToTab(nav, navTab(tab))) return false;
  const next = jumpToTab(nav, navTab(tab));
  s.setUI({ drawer: STORE_TAB[next.wantedTab], drawerOpen: next.drawerOpen });
  return true;
}

/** Picks or unpicks a member: the store applies the generated `togglePick` only where `canTogglePick` allows it. */
export function pickMember(id: string, s = store): void {
  s.togglePick(id);
}

/** The workspace staff view of the store, for the generated consoleWorkspace decisions. */
export function staffView(s = store): StaffView {
  const mode: WorkMode = s.mode !== "real" ? "SimulatedWorld" : s.canAct() ? "RealWithService" : "RealWithoutService";
  return receiveWorkViewer(initialWorkspace, mode, s.can("safety"), !!s.me && s.isAdmin(), s.can("analyst"), s.canSim(), !!s.env?.piiRevealed).staff;
}

/** The sign-in state of the store, for the generated staffSignIn decisions. The store does not know the second factor: the server checks it. */
export function staffSignIn(s = store): StaffSignIn {
  const viaAccess = s.me?.via === "sso";
  const grants = s.me ? (s.me.grants?.length ?? s.me.roles.length) : 0;
  const answer: IdentityAnswer | null = s.authNeeded ? "SignInNeeded" : s.me ? "IdentityAccepted" : s.loading ? null : "ServerUnreachable";
  if (!answer) return { phase: "Checking", method: "NoCredential", tokenInAddress: false, secondFactor: false, roleCount: 0 };
  const accepted = answer === "IdentityAccepted";
  return {
    phase: phaseForAnswer(answer, viaAccess, true, grants),
    method: methodForAnswer(answer, viaAccess, "NoCredential"),
    tokenInAddress: false,
    secondFactor: accepted && viaAccess,
    roleCount: accepted ? grants : 0,
  };
}
