// The Hire lane's level band (spec/pairValue.md, "A pair needs both utilities over the floor and a
// standing gap within the band"; spec/memberStanding.md, "A member with no reviewed facts gets the
// widest uncertainty"). Role levels are 25 standing points apart and the Hire band is 15, so a
// two-level gap (50) passes only while the candidate's uncertainty is 17 or more: a candidate with
// two reviewed facets (a trusted level and a trusted skill) is refused it, and a trusted facet that
// carries both the level and the skill is one reviewed fact, not two.
import { expect, test } from "vitest";
import { DAY, type MemberId } from "@thenetwork/core";
import { noPairValue } from "../../core/src/generated/pairValue.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { PEON_ENGINE_CONFIG, peonPack } from "../src/packs/peon/index.ts";
import { JOB_INTENT, SEARCH_INTENT, T } from "../src/packs/peon/schema.ts";
import type { EngineInput } from "../src/types.ts";
import { World } from "../src/world.ts";

const NOW = Date.UTC(2026, 10, 2, 12);
type Source = "said" | "connected_source";

function addMember(input: EngineInput, id: MemberId, facets: { tags: string[]; provenance?: Source }[], job: boolean) {
  input.members.push({ id, name: `Synthetic ${id}`, age: 30, homeCity: "nyc", state: "open", joinedAt: NOW - 40 * DAY, unansweredProactive: 0,
    prefs: { categoriesOptIn: ["professional"], quietHours: [22, 8], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false } });
  input.presence.push({ memberId: id, city: "nyc", type: "home", areas: ["manhattan"] });
  for (const f of facets) {
    input.facets.push({ id: `${id}-f${input.facets.length}`, memberId: id, kind: "fact", value: "Synthetic fact", tags: f.tags,
      scope: "shareable", confidence: 1, provenance: f.provenance ?? "said" });
  }
  input.intents.push({ id: `${id}-intent`, memberId: id, category: "professional", objective: job ? "Hire a software engineer" : "Find a software engineering role",
    details: job ? JOB_INTENT : SEARCH_INTENT, status: "active", createdAt: NOW - DAY, horizonDays: 90 });
}

/** A candidate at `level` with Python at level 5; `trusted`: a connected source gave both facts; `oneFacet`: both sit in one facet. */
function addCandidate(input: EngineInput, id: MemberId, o: { level: number; trusted: boolean; oneFacet: boolean }) {
  const source: Source = o.trusted ? "connected_source" : "said";
  const role = [`${T.family}software_engineer`, `${T.seniority}${o.level}`, `${T.mode}remote`];
  const skill = [`${T.skill}python:5`];
  addMember(input, id, [
    { tags: [`${T.entity}candidate`] },
    ...(o.oneFacet ? [{ tags: [...role, ...skill], provenance: source }] : [{ tags: role, provenance: source }, { tags: skill, provenance: source }]),
    { tags: [`${T.floor}60`, `${T.auth}yes`, `${T.needsSponsor}no`] },
  ], false);
}

test("a two-level Hire gap passes only while the candidate has at most one reviewed facet", () => {
  const input: EngineInput = { now: NOW, members: [], facets: [], intents: [], presence: [], edges: [], recentProposals: [], interactions: [] };
  addMember(input, "job", [
    { tags: [`${T.entity}job`] },
    { tags: [`${T.family}software_engineer`, `${T.seniority}4`, `${T.mode}remote`] },
    { tags: [`${T.company}acme`, T.verified, `${T.pay}100-150`, `${T.openings}3`, `${T.urgency}1`, `${T.sponsors}yes`] },
    { tags: [`${T.must}python:2`] },
  ], true);
  addCandidate(input, "stated", { level: 2, trusted: false, oneFacet: false });
  addCandidate(input, "together", { level: 2, trusted: true, oneFacet: true });
  addCandidate(input, "apart", { level: 2, trusted: true, oneFacet: false });
  addCandidate(input, "apart-near", { level: 3, trusted: true, oneFacet: false });
  for (const seed of [1, 2]) {
    const w = new World(input, resolveConfig({ ...PEON_ENGINE_CONFIG, seed }), localEmbed, peonPack);
    // The remote seat has one entity per market; every candidate is in nyc.
    const hire = (id: MemberId) => w.match.profilesOf(id).find(p => p.lane === "Hire" && p.market === "nyc")!;
    // Uncertainty 20 - 2 x reviewed facets: the posting 1, stated 0, together 1, apart 2.
    expect([hire("job"), hire("stated"), hire("together"), hire("apart")].map(p => p.uncertainty)).toEqual([18, 20, 18, 16]);
    expect(hire("job").standing - hire("apart").standing).toBe(50);
    expect(w.match.value(hire("job"), hire("stated"))).toBeGreaterThanOrEqual(0);   // 50 <= 15 + 18 + 20
    expect(w.match.value(hire("job"), hire("together"))).toBeGreaterThanOrEqual(0); // 50 <= 15 + 18 + 18
    expect(w.match.value(hire("job"), hire("apart"))).toBe(noPairValue);            // 50 > 15 + 18 + 16
    expect(w.match.value(hire("job"), hire("apart-near"))).toBeGreaterThanOrEqual(0); // one level: 25
  }
});
