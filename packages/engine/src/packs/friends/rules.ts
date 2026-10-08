// friends.help hard filters (friendsPack.eligibility). They run AFTER the core prefixes (minors,
// holds, pause; duplicate / minors / blocks for pairs) and can only remove. Order is the contract:
// the first failing rule names the funnel reason.
//
//   romance_excluded   friends.help never matches romance (lane, member, pair and configuration)
//   unverified         liveness and age assurance must both have passed (fail closed); bots fail
//                      liveness, age liars fail the age check (domain research C2 "Safety", C7.3-4)
//   safety_review      any safety cue the agent observed (romantic pursuit, sales pitch, bot pattern,
//                      hostile language, age signal) holds the member for human review
//   reliability        two no-shows without a completed meetup since: no group seats
//   group_first        one-to-one only after the member has attended a group meetup (groups first;
//                      domain research C2 safety recommendations)
//   transit            geo.pairReason: two homes too far apart for any venue to fit both tolerances
import type { CandidateRule, MemberRule, PairRule } from "../../pack.ts";
import { NETWORK_MEMBER_RULES, NETWORK_PAIR_RULES } from "../network/rules.ts";
import { friendsInfo } from "./info.ts";
import type { World } from "../../world.ts";
import type { MemberId } from "@thenetwork/core";

const net = (id: string) => {
  const r = NETWORK_MEMBER_RULES.find(x => x.id === id);
  if (!r) throw new Error(`network member rule ${id} missing`);
  return r;
};
const netPair = (id: string) => {
  const r = NETWORK_PAIR_RULES.find(x => x.id === id);
  if (!r) throw new Error(`network pair rule ${id} missing`);
  return r;
};

/** Members who attended at least one group meetup (>= 3 participants, completed). */
const groupVeterans = new WeakMap<World, Set<MemberId>>();
export function attendedGroup(w: World, id: MemberId): boolean {
  let s = groupVeterans.get(w);
  if (!s) {
    s = new Set();
    for (const r of w.interactions) if (r.outcome === "completed" && r.participants.length >= 3) for (const p of r.participants) s.add(p);
    groupVeterans.set(w, s);
  }
  return s.has(id);
}

let memberRules: readonly MemberRule[] | undefined;
export const friendsMemberRules = (): readonly MemberRule[] => (memberRules ??= [
  { id: "romance_excluded", check: (_w, _id, _mi, c) => (c.category === "romance" ? "romance_excluded" : null) },
  net("category_opt_out"),
  { id: "unverified", check: (w, id) => (friendsInfo(w).get(id)?.verified ? null : "unverified") },
  { id: "safety_review", check: (w, id) => (friendsInfo(w).get(id)?.safetyCue ? "safety_review" : null) },
  net("only_when_asked"),
  net("reliability_holdout"),
  { id: "group_first", check: (w, id, _mi, c) => (c.format === "one_to_one" && !attendedGroup(w, id) ? "group_first" : null) },
]);

let pairRules: readonly PairRule[] | undefined;
export const friendsPairRules = (): readonly PairRule[] => (pairRules ??= [
  { id: "romance_excluded", check: (_w, _a, _b, lane) => (lane === "romance" ? "romance_excluded" : null) },
  netPair("negative_feedback_cooldown"),
  netPair("unknown_member"),
  netPair("dealbreaker"),
]);

export const FRIENDS_CANDIDATE_PRE_RULES: readonly CandidateRule[] = [
  { id: "romance_excluded", check: (_w, c) => (c.category === "romance" ? "romance_excluded" : null) },
  {
    id: "group_size", check: (_w, c) => {
      if (c.kind === "group" && (c.participants.length < 3 || c.participants.length > 6)) return "group_size";
      if ((c.kind === "intro" || c.kind === "second_encounter") && c.participants.length !== 2) return "group_size";
      return null;
    },
  },
];
export const FRIENDS_CANDIDATE_POST_RULES: readonly CandidateRule[] = [];
