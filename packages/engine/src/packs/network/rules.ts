// The Network's hard-filter rules (networkPack.eligibility), moved verbatim from filters.ts.
// ORDER IS PART OF THE CONTRACT (byte-identity rule 3): the funnel counts the FIRST failing reason.
// The core runs its own prefix first (filters.ts: unknown_member, underage, safety_hold, state_paused;
// pairs: duplicate_participant, underage, blocked; configurations: duplicate_participant, then these
// pre-rules, then minors / via / member / pair, then these post-rules, then the geo overlap).
import { DAY } from "@thenetwork/core";
import { isHomeEntry, isMinorAge, riskTerms } from "../../filters.ts";
import type { CandidateRule, MemberRule, PairRule } from "../../pack.ts";
import { CONTRIBUTOR_ROLES } from "../../types.ts";
import { pairKey, type MemberIndex } from "../../world.ts";
import {
  askedRecently, categoryCooldownReason, categoryQuotaReason, contributionBudgetReason, interruptionBudgetReason,
  negativeFeedbackReason, onlyWhenAskedReason, pairCooldownReason, reliabilityHoldoutReason, romanceAdmits,
  romancePairReason, type RomanceSide,
} from "./rulesCore.ts";

export const NETWORK_MEMBER_RULES: readonly MemberRule[] = [
  { id: "state_receiving_contributor", check: (_w, _id, mi, c) => (mi.m.state === "receiving" && CONTRIBUTOR_ROLES.has(c.role) ? "state_receiving_contributor" : null) },
  { id: "category_opt_out", check: (_w, _id, mi, c) => (!mi.m.prefs.categoriesOptIn.includes(c.category) ? "category_opt_out" : null) },
  { id: "romance_opt_out", check: (_w, _id, mi, c) => (c.category === "romance" && !mi.m.prefs.romanceOptIn ? "romance_opt_out" : null) },
  {
    id: "only_when_asked", check: (w, _id, mi, c) =>
      onlyWhenAskedReason(mi.m.prefs.onlyWhenAsked, mi.m.unansweredProactive, askedRecently(w.now, c.ownIntentCreatedAt, w.cfg.askedRecencyDays * DAY)),
  },
  {
    id: "interruption_budget", check: (w, _id, mi, c) => interruptionBudgetReason(mi.recentProactive, c.extraProactive ?? 0, w.cfg.budgets[mi.m.state].limit),
  },
  { id: "contribution_budget", check: (w, _id, mi, c) => contributionBudgetReason(CONTRIBUTOR_ROLES.has(c.role), mi.recentContribution, c.extraContribution ?? 0, w.cfg.contribution.limit) },
  {
    id: "category_quota", check: (w, id, mi, c) => categoryQuotaReason(w.quotas[id]?.[c.category], mi.categoryCount30.get(c.category) ?? 0),
  },
  {
    id: "category_cooldown", check: (w, id, _mi, c) =>
      categoryCooldownReason(w.now, w.memberCategoryDeclines.get(id)?.get(c.category), w.cfg.cooldowns.categoryDeclineDays * DAY),
  },
  {
    id: "reliability_holdout", check: (w, id, _mi, c) => {
      const rel = w.reliability[id];
      return rel ? reliabilityHoldoutReason(rel.noShows, rel.completedSinceLastNoShow, c.format === "one_to_one", c.timeSensitive) : null;
    },
  },
];

/** Romance, one direction: the seeker's stated orientation / age range admits the other (rulesCore.romanceAdmits). */
export function romanceCompatible(seeker: MemberIndex, other: MemberIndex): boolean {
  return romanceAdmits(seeker.romance, other.m.age, other.romance?.is ?? []);
}

/** The facts of one side of a romance pair. `minor` uses the same policy as the core pair prefix. */
const romanceSide = (mi: MemberIndex): RomanceSide =>
  ({ optIn: mi.m.prefs.romanceOptIn, minor: isMinorAge(mi.m.age), age: mi.m.age, prefs: mi.romance, is: mi.romance?.is ?? [] });

export const NETWORK_PAIR_RULES: readonly PairRule[] = [
  {
    id: "negative_feedback_cooldown", check: (w, a, b) =>
      negativeFeedbackReason(w.now, w.negativeFeedback.get(pairKey(a, b)), w.cfg.cooldowns.negativeFeedbackDays * DAY),
  },
  {
    id: "pair_cooldown", check: (w, a, b) =>
      pairCooldownReason(w.pairInteractions.get(pairKey(a, b)) ?? [], w.now, w.cfg.cooldowns.pairDeclinedDays * DAY),
  },
  { id: "active_duplicate", check: (w, a, b) => (w.activePairs.has(pairKey(a, b)) ? "active_duplicate" : null) },
  { id: "unknown_member", check: (_w, _a, _b, _lane, ma, mb) => (!ma || !mb ? "unknown_member" : null) },
  {
    // config.romance.requireStatedPrefs holds for EVERY romance configuration (event pairs,
    // groups, second encounters...), not only the romance-intro generator (engine-pipeline-15).
    // A minor never reaches this rule (the core pair prefix says "underage" first); the core also refuses one.
    id: "romance_incompatible", check: (w, _a, _b, lane, ma, mb) =>
      romancePairReason(lane, w.cfg.romance.requireStatedPrefs, romanceSide(ma), romanceSide(mb)),
  },
  { id: "dealbreaker", check: (_w, _a, _b, _lane, ma, mb) => (ma.dealbreakers.some(d => mb.tags.has(d)) || mb.dealbreakers.some(d => ma.tags.has(d)) ? "dealbreaker" : null) },
];

export const NETWORK_CANDIDATE_PRE_RULES: readonly CandidateRule[] = [
  {
    id: "group_size", check: (w, c) => {
      if (c.kind === "group" || c.kind === "newcomer_welcome") {
        if (c.participants.length < w.cfg.group.minSize || c.participants.length > w.cfg.group.maxSize) return "group_size";
      }
      return null;
    },
  },
  // Romance is pairs-only (engine-pipeline-15): a romance-category event or theme never becomes a romance group.
  { id: "romance_group", check: (_w, c) => (c.category === "romance" && c.participants.length !== 2 ? "romance_group" : null) },
  { id: "high_risk", check: (w, c) => (c.riskFlags?.length || riskTerms(w.cfg, c.riskText).length ? "high_risk" : null) },
];

export const NETWORK_CANDIDATE_POST_RULES: readonly CandidateRule[] = [
  {
    // F14: help that enters a home needs 2+ helpers or helpers who already met the requester.
    id: "home_entry_rule", check: (w, c) => {
      if (c.kind === "help" && isHomeEntry(w.cfg, c.riskText)) {
        const requester = c.participants[0]!;
        const helpers = c.participants.slice(1);
        const acquainted = helpers.every(h => w.edgeHas(requester, h, "met") || w.edgeHas(requester, h, "knows") || w.edgeHas(requester, h, "helped"));
        if (helpers.length < 2 && !acquainted) return "home_entry_rule";
        c.safetyClass = "medium";
      }
      return null;
    },
  },
];

/** Pass-3 hard gate, pack part (was judgeDeep.ts hardGate after the core checks). */
export function networkHardGate(w: { get(id: string): MemberIndex | undefined }, c: { participants: string[]; category: string }): string | null {
  for (const id of c.participants) {
    const m = w.get(id)!.m;
    if (c.category === "romance" && !m.prefs.romanceOptIn) return "romance_opt_out";
    if (!m.prefs.categoriesOptIn.includes(c.category as never)) return "category_opt_out";
  }
  return null;
}
