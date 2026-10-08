// The admin console for four apps (docs/research/2026-10-08-platform-architecture.md section 5).
// The app list, names, domains and ages come from the platform registry (packages/platform/src/apps.ts):
// a rename there changes the console too. This file adds what only the console needs: the review
// reason codes and the review SLA per app, and whether an app's engine pack has shipped (slop and peon
// matching stays off until it has).
import { APP_IDS, APPS, isAppId, type AppId } from "../../platform/src/apps.ts";
import { REVIEW_REASONS, type ReviewReason } from "./types.ts";

export { APP_IDS, APPS, isAppId, type AppId };

/** A role grant's app: one app, or every app ("*"). */
export type AppScope = AppId | "*";
/** The app a request without `app` belongs to (the console before the four apps). */
export const DEFAULT_APP: AppId = "ntwrk";

/**
 * Apps whose engine pack has shipped: matching may run. The others still simulate joins, onboarding and
 * safety, with matching off (founder direction 2026-10-08: the engine session owns the packs).
 */
export const PACK_READY: ReadonlySet<AppId> = new Set<AppId>(APP_IDS.filter(a => a === "ntwrk" || a === "buddies"));
export const matchingAllowed = (app: AppId) => PACK_READY.has(app);
export const MATCHING_OFF_TEXT = "matching off until pack";

/**
 * One review reason code. `base` is the PRD 32.8 code the Network stores (its decide() and the
 * review_items check accept only those). An app code that differs from its base goes to the Network
 * as the base code with "[code]" at the start of the note, so the training label keeps it.
 */
export interface AppReason { code: string; label: string; base: ReviewReason }

const PRD: Record<ReviewReason, string> = {
  weak_reason: "Weak reason", privacy_risk: "Privacy risk", capacity_concern: "Capacity concern", wrong_timing: "Wrong timing",
  safety: "Safety", tone: "Tone", duplicate: "Duplicate", other: "Other",
};
const prd = (code: ReviewReason): AppReason => ({ code, label: PRD[code], base: code });

/** Reason codes per app, in key order (1-8 in the review queue). ntwrk and buddies keep the PRD 32.8 list. */
export const APP_REASONS: Record<AppId, AppReason[]> = Object.fromEntries(APP_IDS.map(a => [a, REVIEW_REASONS.map(prd)])) as Record<AppId, AppReason[]>;
APP_REASONS.slop = [
  prd("weak_reason"), { code: "preference_mismatch", label: "Preference mismatch", base: "weak_reason" },
  { code: "safety_concern", label: "Safety concern", base: "safety" }, prd("privacy_risk"), prd("wrong_timing"), prd("tone"), prd("duplicate"), prd("other"),
];
APP_REASONS.peon = [
  prd("weak_reason"), { code: "not_qualified", label: "Not qualified", base: "weak_reason" },
  { code: "role_closed", label: "Role closed", base: "wrong_timing" }, prd("privacy_risk"), prd("capacity_concern"), prd("tone"), prd("duplicate"), prd("other"),
];

export const appReason = (app: AppId, code: string | undefined) => (code ? APP_REASONS[app].find(r => r.code === code) : undefined);

/**
 * A reviewer's reason as the Network takes it: the app's code -> its PRD 32.8 base code, with
 * "[code]" in front of the note when they differ. undefined: not one of this app's codes.
 */
export function toNetworkReason(app: AppId, code: string, note?: string): { reason: ReviewReason; note?: string } | undefined {
  const r = appReason(app, code);
  if (!r) return undefined;
  const n = note?.trim();
  return r.code === r.base ? { reason: r.base, ...(n ? { note: n } : {}) } : { reason: r.base, note: `[${r.code}]${n ? ` ${n}` : ""}` };
}

/**
 * Review SLA per app in hours: how long an item may wait before the console counts an SLA miss (the
 * Network's own deadline still expires items unsent). Defaults are founder decisions: slop 6 h (a
 * dating introduction goes stale fast), peon 24 h (hiring reviewers check a role), the others 12 h.
 * OBSERVATORY_REVIEW_SLA_HOURS="slop:6,peon:24" overrides them.
 */
export const DEFAULT_SLA_HOURS: Record<AppId, number> = Object.fromEntries(APP_IDS.map(a => [a, a === "slop" ? 6 : a === "peon" ? 24 : 12])) as Record<AppId, number>;
export function slaHours(spec = process.env.OBSERVATORY_REVIEW_SLA_HOURS): Record<AppId, number> {
  const out = { ...DEFAULT_SLA_HOURS };
  for (const part of (spec ?? "").split(",").map(x => x.trim()).filter(Boolean)) {
    const [a, h] = part.split(":");
    const n = Number(h);
    if (!isAppId(a) || !Number.isFinite(n) || n <= 0) throw new Error(`OBSERVATORY_REVIEW_SLA_HOURS: bad entry "${part}" (use app:hours)`);
    out[a] = n;
  }
  return out;
}

/** The app's short banner name: "SLOP", "NTWRK". */
export const appBanner = (app: AppId) => app.toUpperCase();

/** Public facts the console shows about an app (the switcher, the banner, the review queue). */
export interface ConsoleApp {
  id: AppId; name: string; domain: string; minJoinAge: number; minMatchAge: number;
  matchingAllowed: boolean; reasons: AppReason[]; slaHours: number;
}
export function consoleApps(sla = slaHours()): ConsoleApp[] {
  return APP_IDS.map(a => ({
    id: a, name: APPS[a].name, domain: APPS[a].domain, minJoinAge: APPS[a].minJoinAge, minMatchAge: APPS[a].minMatchAge,
    matchingAllowed: matchingAllowed(a), reasons: APP_REASONS[a], slaHours: sla[a],
  }));
}

/** "OBSERVATORY_DATABASE_URL_SLOP": the app's read login (a member of network_observatory_<app>). */
export const appUrlEnv = (app: AppId) => `OBSERVATORY_DATABASE_URL_${app.toUpperCase()}`;
