import type { Intent, MemberId } from "@thenetwork/core";
import { cofounderIntentEligible } from "../../../../core/src/generated/cofounderDispatch.ts";
import { cofounderIntentObjective } from "../../../../core/src/generated/cofounderIntent.ts";
import { laneLimits } from "../../../../core/src/generated/matchLane.ts";
import { standingFacetReadable } from "../../../../core/src/generated/memberStanding.ts";
import { peonCofounderMayPair, peonCofounderMayProfile } from "../../../../core/src/generated/peonCofounder.ts";
import { standingIntentLive } from "../../../../core/src/standing-intent.ts";
import { memberReason } from "../../filters.ts";
import { pairCandidate } from "../../genkit.ts";
import type { EntityTags, Membership } from "../../match/profile.ts";
import type { GeneratorSpec } from "../../pack.ts";
import type { Candidate } from "../../types.ts";
import type { World } from "../../world.ts";
import { cofounderFactsOf, cofounderFactTags, cofounderMustHavesFit } from "../network/cofounderFacts.ts";
import { intentWant } from "../network/vectors.ts";
import { jobOf } from "./profile.ts";
import { isSeatId } from "./seats.ts";

/** The Peon peer's explicit consent, projected by the app-scoped standing-intent store. */
export function peonCofounderIntentOf(w: World, id: MemberId): Intent | undefined {
  const member = w.get(id);
  if (!member) return undefined;
  const { m } = member;
  const intent = member.intents.find(i => i.objective === cofounderIntentObjective
    && cofounderIntentEligible(i.app ?? "", "peon", i.category, i.details ?? "", standingIntentLive(i, w.now)));
  if (!intent) return undefined;
  const contactOpen = !m.prefs.onlyWhenAsked && m.unansweredProactive < 2;
  return peonCofounderMayProfile(m.apps?.includes("peon") === true, isSeatId(id) || !!jobOf(w, id), true,
    m.prefs.categoriesOptIn.includes("professional"), m.prefs.formats.includes("one_to_one"), contactOpen, !member.inOpenOpportunity) ? intent : undefined;
}

export function peonCofounderMembership(w: World, id: MemberId): Membership | undefined {
  const member = w.get(id);
  if (!member || !w.cfg.cities.includes(member.m.homeCity) || memberReason(w, id, {
    lane: "Cofounder", category: "professional", role: "peer", format: "one_to_one", timeSensitive: false,
  }) !== null) return undefined;
  const capacity = laneLimits("Cofounder").weeklyCapacity - member.recentProactive;
  return { id: `${id}/Cofounder/Peer`, lane: "Cofounder", side: "Peer", market: member.m.homeCity, capacity };
}

export function peonCofounderPair(w: World, a: MemberId, b: MemberId): boolean {
  return peonCofounderMayPair(!!peonCofounderIntentOf(w, a), !!peonCofounderIntentOf(w, b),
    w.get(a)?.m.homeCity === w.get(b)?.m.homeCity)
    && cofounderMustHavesFit(w, a, b, "peon");
}

/** The express goal describes what a peer seeks. It supplies no offer of skill. */
export function peonCofounderTags(w: World, id: MemberId): EntityTags {
  const intent = peonCofounderIntentOf(w, id)!;
  const want = intentWant(w, intent);
  const facts = cofounderFactTags(cofounderFactsOf(w, id, "peon"));
  const offers: string[] = [...facts.offers], seeks = [...want.seeks.filter(t => !want.pools.includes(t)), ...facts.seeks], interests = [...want.interests];
  for (const f of w.get(id)!.match) {
    if (f.app !== "peon" || f.tags.some(t => t.toLowerCase().startsWith("peon:"))) continue;
    if (!standingFacetReadable(f.scope, f.provenance, f.confirmedByMember === true, f.sensitive !== undefined, f.inferred === true)) continue;
    const tags = f.tags.filter(t => !t.includes(":"));
    if (f.kind === "skill" || f.kind === "offer" || f.kind === "resource") offers.push(...tags);
    if (f.kind === "desire") seeks.push(...tags);
    if (f.kind === "interest") interests.push(...tags);
  }
  return { offers, seeks, interests };
}

/** The bounded lane search supplies one pair per two peers. Record both exact intents. */
export const peonCofounderGenerator: GeneratorSpec = {
  name: "peon_cofounder",
  run({ w }) {
    const out: Candidate[] = [];
    for (const edge of w.match.edges("Cofounder")) {
      const a = w.match.profile(edge.a), b = w.match.profile(edge.b);
      if (!a || !b) continue;
      const first = peonCofounderIntentOf(w, a.memberId), second = peonCofounderIntentOf(w, b.memberId);
      if (!first || !second) continue;
      out.push(pairCandidate(w, a, b, edge.value, {
        kind: "intro", generator: "peon_cofounder", category: "professional", format: "one_to_one",
        roles: { [a.memberId]: "peer", [b.memberId]: "peer" }, objective: "Meet a potential cofounder",
        anchor: { type: "intent", id: first.id }, cofounderIntents: { [a.memberId]: first.id, [b.memberId]: second.id },
        evidence: {}, channels: new Set(["match"]),
      }));
    }
    return out;
  },
};
