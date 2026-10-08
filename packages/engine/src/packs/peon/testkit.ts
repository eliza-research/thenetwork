// A small seeded peon.biz EngineInput for the conformance suite and unit tests (engine-local; the
// full hiring world with hidden truth is packages/worlds/src/peon). Adversarial on purpose: 15%
// minors (13-17) with full candidate profiles, unverified and scam-cued jobs, jobs without a pay
// range, excluded companies, blocks, holds, canaries, id aliases and agent_private proxies.
import type { City, Edge, Facet, Intent, Member, Presence } from "@thenetwork/core";
import { DAY } from "@thenetwork/core";
import { Rng } from "../../rng.ts";
import type { EngineInput, SafetyHold } from "../../types.ts";
import { JOB_INTENT, SAFETY, SEARCH_INTENT, T, type PeonMode } from "./schema.ts";

const FAMILIES: Record<string, string[]> = {
  data_analyst: ["sql", "python", "excel", "statistics", "tableau"],
  software_engineer: ["javascript", "python", "sql", "cloud", "testing"],
  accountant: ["gaap", "excel", "reconciliation", "tax", "audit"],
};
const AREAS: Record<City, string[]> = { nyc: ["manhattan", "brooklyn", "queens"], sf: ["san_francisco", "oakland", "peninsula"], la: [] };
const FIRST = ["Avery", "Jordan", "Riley", "Casey", "Morgan", "Quinn", "Rowan", "Sasha", "Taylor", "Emery"];
const LAST = ["Okafor", "Lindqvist", "Moreau", "Tanaka", "Haddad", "Novak", "Reyes", "Abbott", "Kowalski", "Mensah"];

export interface PeonTestWorldOptions { seed?: number; candidates?: number; jobs?: number; minorShare?: number; now?: number }

export function peonTestWorld(o: PeonTestWorldOptions = {}): EngineInput {
  const rng = new Rng(o.seed ?? 1);
  const now = o.now ?? Date.UTC(2026, 9, 12, 12);
  const members: Member[] = [], facets: Facet[] = [], intents: Intent[] = [], presence: Presence[] = [], edges: Edge[] = [];
  const safetyHolds: SafetyHold[] = [];
  const idAliases: Record<string, string> = {};
  const fams = Object.keys(FAMILIES);
  const prefs = { categoriesOptIn: ["professional" as const], quietHours: [22, 8] as [number, number], romanceOptIn: false, formats: ["one_to_one" as const], maxTravelMinutes: 45, onlyWhenAsked: false };
  const nJobs = o.jobs ?? 18, nCand = o.candidates ?? 72;
  const companies: string[] = [];
  for (let k = 0; k < 8; k++) companies.push(`co${k}`);

  for (let i = 0; i < nJobs; i++) {
    const id = `j${String(i).padStart(3, "0")}`;
    const city: City = rng.chance(0.5) ? "nyc" : "sf";
    const fam = fams[i % fams.length]!;
    const sen = 1 + rng.int(4);
    const mode: PeonMode = rng.pick(["onsite", "hybrid", "remote"] as const);
    const area = rng.pick(AREAS[city]);
    const co = rng.pick(companies);
    const lo = 60 + 15 * sen + rng.int(20), hi = lo + 15 + rng.int(20);
    members.push({ id, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, homeCity: city, state: "open", prefs, joinedAt: now - 30 * DAY, age: 18, unansweredProactive: 0 });
    presence.push({ memberId: id, city, type: "home", areas: [area] });
    let fi = 0;
    const add = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"]) => facets.push({ id: `${id}-f${fi++}`, memberId: id, kind, value, tags, scope, provenance: "said", confidence: 0.9 });
    add("fact", "Hiring role", [`${T.entity}job`], "matchable");
    add("fact", `Company: ${co.toUpperCase()} Labs`, [`${T.company}${co}`], "shareable");
    if (rng.chance(0.85)) add("fact", "Employer verified", [T.verified], "matchable");
    add("fact", `${fam.replace(/_/g, " ")} role`, [`${T.family}${fam}`, `${T.seniority}${sen}`], "shareable");
    if (rng.chance(0.9)) add("fact", `Pay $${lo}k-$${hi}k`, [`${T.pay}${lo}-${hi}`], "shareable");
    add("fact", mode === "remote" ? "Remote" : `${mode} in ${area.replace(/_/g, " ")}`, [`${T.mode}${mode}`, `${T.market}${city}`, `${T.area}${area}`], "shareable");
    const musts = rng.sample(FAMILIES[fam]!, 2 + rng.int(1));
    for (const s of musts) add("skill", `Must have ${s}`, [`${T.must}${s}:${Math.min(4, 1 + sen)}`], "shareable");
    add("fact", "Openings", [`${T.openings}${1 + (rng.chance(0.3) ? 1 : 0)}`, `${T.urgency}${1 + rng.int(2)}`, `${T.sponsors}${rng.chance(0.3) ? "yes" : "no"}`], "matchable");
    if (rng.chance(0.08)) add("fact", "asked candidates to pay for equipment", [SAFETY.scam], "agent_private");
    if (rng.chance(0.08)) add("fact", "asked for young candidates only", [SAFETY.discriminatoryRequest], "agent_private");
    intents.push({ id: `${id}-i0`, memberId: id, objective: `Hire: ${fam.replace(/_/g, " ")} (level ${sen})`, category: "professional", details: `${JOB_INTENT} openings`, horizonDays: 90, status: "active", createdAt: now - rng.int(20) * DAY });
  }

  for (let i = 0; i < nCand; i++) {
    const id = `c${String(i).padStart(4, "0")}`;
    const city: City = rng.chance(0.5) ? "nyc" : "sf";
    const minor = rng.chance(o.minorShare ?? 0.15);
    const fam = rng.pick(fams);
    const sen = 1 + rng.int(4);
    members.push({ id, name: `${rng.pick(FIRST)} ${rng.pick(LAST)}`, homeCity: city, state: rng.chance(0.08) ? "paused" : "normal", prefs, joinedAt: now - rng.int(60) * DAY, age: minor ? 13 + rng.int(5) : 18, unansweredProactive: 0 });
    if (rng.chance(0.2)) idAliases[`phone:${id}`] = id;
    const home = rng.pick(AREAS[city]);
    presence.push({ memberId: id, city, type: "home", areas: [home] });
    let fi = 0;
    const add = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], prov: Facet["provenance"] = "said") =>
      facets.push({ id: `${id}-f${fi++}`, memberId: rng.chance(0.1) && idAliases[`phone:${id}`] ? `phone:${id}` : id, kind, value, tags, scope, provenance: prov, confidence: 0.85 });
    add("fact", "Looking for work", [`${T.entity}candidate`], "matchable");
    add("goal", `Wants ${fam.replace(/_/g, " ")} work`, [`${T.family}${fam}`, `${T.seniority}${sen}`], "matchable");
    for (const s of rng.sample(FAMILIES[fam]!, 3)) add("skill", `${s} level ${1 + rng.int(4)}`, [`${T.skill}${s}:${Math.min(5, sen + rng.int(2))}`], rng.chance(0.5) ? "shareable" : "matchable", rng.chance(0.2) ? "connected_source" : "said");
    add("preference", "Pay floor", [`${T.floor}${55 + 15 * sen + rng.int(15)}`], "matchable");
    const modes = rng.chance(0.3) ? ["remote"] : rng.chance(0.5) ? ["onsite", "hybrid", "remote"] : ["onsite", "hybrid"];
    add("preference", "Work models", [...modes.map(m => `${T.mode}${m}`), ...rng.sample(AREAS[city], 2).map(a => `${T.area}${a}`)], "matchable");
    add("fact", "Work authorization", [`${T.auth}yes`, `${T.needsSponsor}${rng.chance(0.15) ? "yes" : "no"}`, `${T.start}${rng.int(4)}`], "matchable");
    if (rng.chance(0.15)) add("boundary", "Do not show me to my current employer", [`${T.exclude}${rng.pick(companies)}`], "agent_private");
    // Proxies the agent may know from a resume: agent_private, never read by the pack.
    add("fact", `Lives near zip 1${rng.int(9999)}`, [`${T.proxy}zip:1${rng.int(9999)}`], "agent_private");
    add("fact", `Graduated ${1980 + rng.int(40)}`, [`${T.proxy}grad_year:${1980 + rng.int(40)}`], "agent_private");
    if (rng.chance(0.3)) add("fact", `Career gap ${3 + rng.int(20)} months`, [`${T.proxy}gap_months:${3 + rng.int(20)}`], "agent_private");
    if (rng.chance(0.4)) add("fact", `zq canary ${id} private health disclosure`, ["private"], "agent_private");
    if (rng.chance(0.05)) add("fact", "resume details inconsistent", [SAFETY.fakeCandidate], "agent_private");
    intents.push({ id: `${id}-i0`, memberId: id, objective: `Find a ${fam.replace(/_/g, " ")} role`, category: "professional", details: SEARCH_INTENT, horizonDays: 60, status: "active", createdAt: now - rng.int(10) * DAY });
    if (rng.chance(0.03)) safetyHolds.push({ memberId: id, from: now - DAY, reason: "report under review" });
  }
  // A few blocks between candidates and job seats (a candidate blocked a hiring manager).
  for (let k = 0; k < 6; k++) edges.push({ from: `c${String(rng.int(nCand - 1)).padStart(4, "0")}`, to: `j${String(rng.int(nJobs - 1)).padStart(3, "0")}`, type: "blocked", strength: 1, explicit: true, createdAt: now - 2 * DAY });
  return { now, members, facets, intents, presence, edges, recentProposals: [], safetyHolds, idAliases, interactions: [] };
}
