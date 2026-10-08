// Per-app Member 360 panels (admin-console 3.3.1). The app packs keep app data in facet tags
// (packages/engine/src/packs/slop/profile.ts and packs/peon/schema.ts), so the console reads the
// same tags from the member's facets. Rules:
//  - slop dating preferences are hidden by default: they show only while a safety or admin reveal
//    for that member is active (POST /api/reveal, audited). Until then the panel says how many there are.
//  - Scores and ratings of a person (attractiveness, desirability, any rating) are agent_private and
//    never leave the server, in any app, revealed or not.
//  - slop photos: never for a member under 18 or of unknown age; for a verified adult only, to admin
//    or safety with a typed reason (POST /api/member/:id/photos, audited before the read).
//  - peon: the roles a job seat hires for and the member's introductions (applications). Proxy tags
//    (zip, graduation year, gaps: peon:proxy:*) are never shown.
import type { Facet } from "@thenetwork/core";
import { validAge } from "@thenetwork/core";
import type { AppProfile360, MemberDetail, PeonProfile360, SlopPrefs, SlopProfile360 } from "./types.ts";

/** A score or rating of a person: never shown (PRD 40.5: never photo attractiveness scores). */
const SCORE = /(^|[:_.])(desirability|attractiveness|attractive|attraction|hotness|looks|beauty|rating|ratings|elo|score|scores)([:_.=]|$)/i;
export const isScoreFacet = (f: Facet) => f.tags.some(t => SCORE.test(t)) || SCORE.test(f.kind) || /\b(attractiveness|desirability|hotness)\b/i.test(f.value);

/** slop's dating facts: the pack's tag families (romance:, slop:, verify:, safety:). */
const DATING = /^(romance|slop|verify|safety):/;
const isDating = (f: Facet) => f.tags.some(t => DATING.test(t));

/** The facets a member detail may carry for this app: never a score; on slop, dating facts only while revealed. */
export function memberFacets(app: string, facets: Facet[], revealed: boolean): Facet[] {
  return facets.filter(f => !isScoreFacet(f) && (app !== "slop" || revealed || !isDating(f)));
}

const tagsOf = (facets: Facet[]) => facets.filter(f => !isScoreFacet(f)).flatMap(f => f.tags);
const after = (tags: string[], prefix: string) => tags.filter(t => t.startsWith(prefix)).map(t => t.slice(prefix.length));

/** Adult for the photo rule: a valid age of 18 or more and not treated as under 18 by the Network (unknown age fails closed). */
function adultOf(d: MemberDetail): boolean {
  const m = d.member;
  return !m.minor && !m.ageUnknown && !m.declined && validAge(m.age) && (m.age ?? 0) >= 18;
}
const ageVerifiedOf = (d: MemberDetail) => tagsOf(d.facets).includes("verify:age:pass");

/** May staff see this member's photos (slop)? "ok", or why not. */
export function photosAllowed(d: MemberDetail): "ok" | "never_minor" | "needs_verification" {
  if (!adultOf(d)) return "never_minor";
  return ageVerifiedOf(d) ? "ok" : "needs_verification";
}

export function slopPrefs(facets: Facet[]): SlopPrefs {
  const t = tagsOf(facets);
  const one = (p: string) => after(t, p)[0];
  const age = one("romance:age:")?.split("-").map(Number);
  const values: Record<string, string> = {};
  for (const k of ["smoking", "drinking", "has_kids", "wants_kids", "religion", "religion_importance", "politics"]) { const v = one(`slop:${k}:`); if (v !== undefined) values[k] = v; }
  const miles = one("slop:max_miles:");
  return {
    ...(one("romance:is:") ? { is: one("romance:is:") } : {}), seeks: after(t, "romance:seeks:"),
    ...(age?.length === 2 && age.every(Number.isFinite) ? { ageRange: [age[0]!, age[1]!] as [number, number] } : {}),
    ...(one("slop:scope:") ? { scope: one("slop:scope:") } : {}), ...(miles !== undefined && Number.isFinite(Number(miles)) ? { maxMiles: Number(miles) } : {}),
    ...(one("slop:goal:") ? { goal: one("slop:goal:") } : {}),
    values, dealbreakers: after(t, "slop:dealbreaker:"), activities: after(t, "slop:activity:"), free: after(t, "slop:free:"),
    verification: t.filter(x => x.startsWith("verify:")), safety: t.filter(x => x.startsWith("safety:")),
  };
}

function slopProfile(d: MemberDetail, revealed: boolean): SlopProfile360 {
  const dating = d.facets.filter(f => !isScoreFacet(f) && isDating(f));
  const why = photosAllowed(d);
  return {
    app: "slop", adult: adultOf(d), ageVerified: ageVerifiedOf(d),
    prefs: revealed ? { hidden: false, prefs: slopPrefs(dating) } : { hidden: true, count: dating.length },
    photos: why === "ok" ? "reason_required" : why,
  };
}

function peonProfile(d: MemberDetail): PeonProfile360 {
  // Proxies (zip, graduation year, gaps) never: whatever their scope.
  const t = tagsOf(d.facets).filter(x => !x.startsWith("peon:proxy:"));
  const one = (p: string) => after(t, p)[0];
  const entity = one("peon:entity:");
  const num = (p: string) => { const v = one(p); return v !== undefined && Number.isFinite(Number(v)) ? Number(v) : undefined; };
  const job = d.intents.find(i => i.details === "peon:job" || /^hire:/i.test(i.objective));
  const roles: PeonProfile360["roles"] = entity === "job"
    ? [{
      ...(job ? { title: job.objective.replace(/^hire:\s*/i, "") } : {}), ...(one("peon:family:") ? { family: one("peon:family:") } : {}),
      ...(num("peon:seniority:") !== undefined ? { seniority: num("peon:seniority:") } : {}), ...(one("peon:pay:") ? { pay: `$${one("peon:pay:")}k` } : {}),
      ...(one("peon:mode:") ? { mode: one("peon:mode:") } : {}), ...(one("peon:market:") ? { market: one("peon:market:") } : {}),
      ...(num("peon:openings:") !== undefined ? { openings: num("peon:openings:") } : {}), verified: t.includes("peon:verified"),
    }]
    : after(t, "peon:family:").map(family => ({ family, ...(num("peon:seniority:") !== undefined ? { seniority: num("peon:seniority:") } : {}), ...(after(t, "peon:mode:").length ? { mode: after(t, "peon:mode:").join("/") } : {}) }));
  return {
    app: "peon", entity: entity === "job" || entity === "candidate" ? entity : "unknown", roles,
    applications: d.opportunities.filter(o => o.source !== "shadow").map(o => ({ opportunityId: o.id, state: o.state, ...(o.status[d.member.id] ? { status: o.status[d.member.id] } : {}), at: o.updatedAt })),
  };
}

/** The app's own panel for one member. `revealed`: an active reveal for this member (safety or admin). */
export function appProfile(app: string, d: MemberDetail, o: { revealed: boolean }): AppProfile360 {
  if (app === "slop") return slopProfile(d, o.revealed);
  if (app === "peon") return peonProfile(d);
  return { app, none: true };
}
