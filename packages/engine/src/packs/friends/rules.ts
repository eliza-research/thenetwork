import type { CandidateRule, MemberRule, PairRule } from "../../pack.ts";
import { NETWORK_MEMBER_RULES, NETWORK_PAIR_RULES } from "../network/rules.ts";
import { friendsMutuallyOpen } from "../../../../core/src/generated/mutualOpenness.ts";
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
  { id: "friend_openness", check: (w, a, b) => {
    const info = friendsInfo(w), fa = info.get(a)?.friend, fb = info.get(b)?.friend;
    return fa && fb && friendsMutuallyOpen(fa, fb) ? null : "friend_openness";
  } },
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
