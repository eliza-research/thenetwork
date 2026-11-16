import { hash32, type Facet, type Intent } from "@thenetwork/core";
import { JOB_INTENT, SEARCH_INTENT, T } from "@thenetwork/engine/src/packs/peon/schema.ts";
import { AREAS, FAMILIES, payMid } from "./apps/peon/skills.ts";
import type { PlantedMember, PlantedSkill } from "./planted.ts";

const human = (id: string) => id.replaceAll("_", " ");

/** Project planted offers and requests through Peon's normal job-intake and candidate tags. */
export function plantedPeonHire(member: PlantedMember, intent: Intent, area: string): { facets: Facet[]; intent: Intent } {
  const lane = member.lanes.Hire;
  if (!member.adult || !lane || lane.side === "Peer") return { facets: [], intent };

  const cohort = member.circle < 0 ? member.id : member.circle;
  const family = FAMILIES[hash32("planted-peon-family", member.market, cohort) % FAMILIES.length]!;
  const marketAreas = AREAS[member.market];
  const site = marketAreas[hash32("planted-peon-site", area) % marketAreas.length]!;
  const seniority = 1 + Math.floor(lane.observed / 20.2);
  const median = payMid(family.id, seniority, member.market);
  const skillsOf = (items: readonly PlantedSkill[]) => {
    const skills = new Map<string, number>();
    for (const item of items) {
      const skill = family.skills[hash32("planted-peon-skill", item.skill) % family.skills.length]!;
      skills.set(skill, Math.max(skills.get(skill) ?? 0, item.level));
    }
    return skills;
  };
  const facets: Facet[] = [];
  const add = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], provenance: Facet["provenance"] = "said") => {
    facets.push({ id: `${member.id}-hire-${facets.length}`, memberId: member.id, kind, value, tags, scope, provenance, confidence: 0.9, app: "peon" });
  };
  const role = [`${T.family}${family.id}`, `${T.seniority}${seniority}`];

  if (lane.side === "Offering") {
    const payMin = Math.round(median * 0.9);
    const payMax = Math.round(median * 1.2);
    add("fact", "Hiring seat", [`${T.entity}job`], "matchable");
    add("fact", `Company: Example ${family.title} Team`, [`${T.company}planted-${member.id}`], "shareable");
    add("fact", "Employer verified", [T.verified], "matchable", "connected_source");
    add("fact", family.title, role, "shareable");
    add("fact", `$${payMin}k to $${payMax}k`, [`${T.pay}${payMin}-${payMax}`], "shareable");
    add("fact", `Hybrid in ${human(site.id)}`, [`${T.mode}hybrid`, `${T.market}${member.market}`, `${T.area}${site.id}`], "shareable");
    for (const [skill, level] of skillsOf(member.seeks)) {
      const required = Math.max(1, level - 1);
      add("skill", `${human(skill)} at level ${required}`, [`${T.must}${skill}:${required}`, skill], "shareable");
    }
    if (family.cred) add("fact", `Requires ${family.cred.id}`, [`${T.credRequired}${family.cred.id}`], "shareable");
    add("fact", "One opening", [`${T.openings}1`], "matchable");
    return { facets, intent: { ...intent, objective: `Hire: ${family.title}`, details: JOB_INTENT } };
  }

  const floor = Math.round(median * 0.85);
  const commute = [site.id, ...site.neighbours];
  add("fact", "Candidate profile", [`${T.entity}candidate`], "matchable");
  add("goal", `Find a ${family.title} role`, role, "matchable");
  for (const [skill, level] of skillsOf(member.offers)) {
    add("skill", `${human(skill)} at level ${level}`, [`${T.skill}${skill}:${level}`, skill], "shareable", lane.reviewed > 0 ? "connected_source" : "said");
  }
  add("preference", `Pay floor $${floor}k`, [`${T.floor}${floor}`], "matchable");
  add("preference", "Hybrid within my commute", [`${T.mode}hybrid`, ...commute.map(id => `${T.area}${id}`)], "matchable");
  add("fact", "Authorized to work", [`${T.auth}yes`, `${T.needsSponsor}no`], "matchable");
  if (family.cred) add("fact", `Holds ${family.cred.id}`, [`${T.cred}${family.cred.id}`], "matchable");
  return { facets, intent: { ...intent, objective: `Find a ${family.title} role`, details: SEARCH_INTENT } };
}
