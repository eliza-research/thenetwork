// Validate data/synthetic/v1 against packages/core types and the dataset's privacy/safety rules.
//
//   bun scripts/synthetic/validate.ts [--dir data/synthetic/v1] [--out path/to/validation.json]
//
// Writes <dir>/validation.json and exits 1 if any check fails. Hidden truth is read here only to
// verify the public/hidden split and ground-truth invariants (adversarial flags, true ages).
import { parseArgs } from "node:util";
import { loadSnapshot } from "./load.ts";
import { DEFAULT_RICHNESS_MIX, MINOR_ALLOWED_SOURCES, RICHNESS_TIERS } from "../../packages/sim/src/sources.ts";
import { INTERESTS } from "../../packages/sim/src/taxonomy.ts";
import {
  CATEGORIES, CITIES, DATA_DIR, EDGE_TYPES, FACET_KINDS, FILES, FORMATS, HIDDEN_ONLY_KEYS, INTENT_STATUS, NEIGHBORHOODS,
  PHONE_RE, PRESENCE_TYPES, PROVENANCES, SCOPES, SENSITIVE_CATEGORIES, SNAPSHOT_NOW, SOURCE_KINDS_ALL, SOURCE_LINKS, SOURCE_STATUSES, STATES,
  neighborhoodSet, readJsonl, sha256,
  type EdgeRecord, type FacetRecord, type HiddenTruthRecord, type IntentRecord, type Manifest, type MemberRecord, type PresenceRecord,
} from "./common.ts";

const cli = parseArgs({ options: { dir: { type: "string", default: DATA_DIR }, out: { type: "string" } } }).values;
const dir = cli.dir!;

interface Check { name: string; pass: boolean; details?: unknown; errors?: string[] }
const checks: Check[] = [];
function check(name: string, errors: string[], details?: unknown) {
  checks.push({ name, pass: errors.length === 0, ...(details !== undefined ? { details } : {}), ...(errors.length ? { errors: errors.slice(0, 15), } : {}) });
}
const count = <T>(xs: T[], f: (x: T) => string) => xs.reduce<Record<string, number>>((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});
const pct = (a: number, b: number) => Math.round((a / Math.max(1, b)) * 1000) / 10;
const isNum = (x: unknown) => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown) => typeof x === "string" && x.length > 0;
const inSet = <T extends string>(set: readonly T[], x: unknown) => set.includes(x as T);

// ---- load ------------------------------------------------------------------------------------
const raw: Record<string, string> = {};
for (const f of Object.values(FILES)) raw[f] = await Bun.file(`${dir}/${f}`).text();
const manifest: Manifest = JSON.parse(raw[FILES.manifest]!);
const members = await readJsonl<MemberRecord>(`${dir}/${FILES.members}`);
const facets = await readJsonl<FacetRecord>(`${dir}/${FILES.facets}`);
const intents = await readJsonl<IntentRecord>(`${dir}/${FILES.intents}`);
const presence = await readJsonl<PresenceRecord>(`${dir}/${FILES.presence}`);
const edges = await readJsonl<EdgeRecord>(`${dir}/${FILES.edges}`);
const hidden = await readJsonl<HiddenTruthRecord>(`${dir}/${FILES.hidden}`);
const M = new Map(members.map(m => [m.id, m]));
const H = new Map(hidden.map(h => [h.memberId, h]));

// ---- 1. manifest integrity ---------------------------------------------------------------------
{
  const e: string[] = [];
  if (manifest.synthetic !== true) e.push("manifest.synthetic !== true");
  for (const [name, meta] of Object.entries(manifest.files)) {
    if (sha256(raw[name] ?? "") !== meta.sha256) e.push(`${name}: sha256 mismatch`);
    const n = (raw[name] ?? "").split("\n").filter(l => l.trim()).length;
    if (n !== meta.records) e.push(`${name}: ${n} records, manifest says ${meta.records}`);
  }
  if (manifest.counts.members !== members.length) e.push("member count mismatch");
  check("manifest_integrity", e, { seed: manifest.seed, generatorVersion: manifest.generatorVersion, model: manifest.model, generatedAt: manifest.generatedAt });
}

// ---- 2. schema conformance to packages/core ----------------------------------------------------
{
  const e: string[] = [];
  for (const m of members) {
    const p = m.prefs;
    if (!isStr(m.id) || !isStr(m.name) || !inSet(CITIES, m.homeCity) || !inSet(STATES, m.state) || !isNum(m.joinedAt) || !Number.isInteger(m.age) || !Number.isInteger(m.unansweredProactive)) e.push(`member ${m.id}: core field invalid`);
    if (!p || !Array.isArray(p.categoriesOptIn) || !p.categoriesOptIn.every(c => inSet(CATEGORIES, c)) || !Array.isArray(p.quietHours) || p.quietHours.length !== 2 || !p.quietHours.every(h => Number.isInteger(h) && h >= 0 && h < 24)
      || typeof p.romanceOptIn !== "boolean" || !Array.isArray(p.formats) || !p.formats.every(f => inSet(FORMATS, f)) || !isNum(p.maxTravelMinutes) || typeof p.onlyWhenAsked !== "boolean") e.push(`member ${m.id}: prefs invalid`);
    if (m.invitedBy !== undefined && !M.has(m.invitedBy)) e.push(`member ${m.id}: invitedBy unknown`);
    if (!["adult", "minor"].includes(m.segment) || !m.profile || !isStr(m.profile.bio) || !["member", "summary"].includes(m.profile.bioSource) || (m.profile.occupation !== undefined && !isStr(m.profile.occupation))
      || !Array.isArray(m.profile.voice?.samples) || !Number.isInteger(m.profile.chatMessages)) e.push(`member ${m.id}: profile invalid`);
    for (const c of m.connectedSources ?? []) {
      if (!inSet(SOURCE_KINDS_ALL, c.source) || ["chat", "vouch"].includes(c.source as string) || !inSet(SOURCE_LINKS, c.link) || !inSet(SOURCE_STATUSES, c.status) || c.subject !== "self" || !isNum(c.connectedAt) || !Number.isInteger(c.observations)) e.push(`member ${m.id}: connectedSources entry invalid`);
    }
  }
  const fids = new Set<string>();
  for (const f of facets) {
    if (!isStr(f.id) || fids.has(f.id)) e.push(`facet ${f.id}: missing/duplicate id`); fids.add(f.id);
    if (!M.has(f.memberId) || !inSet(FACET_KINDS, f.kind) || !isStr(f.value) || !Array.isArray(f.tags) || !f.tags.every(isStr) || !inSet(SCOPES, f.scope) || !inSet(PROVENANCES, f.provenance) || !(f.confidence >= 0 && f.confidence <= 1)) e.push(`facet ${f.id}: invalid`);
    // 1.2.0 provenance detail: every facet says where it came from and when.
    if (!inSet(SOURCE_KINDS_ALL, f.source) || !isNum(f.observedAt) || f.observedAt! > SNAPSHOT_NOW || typeof f.inferred !== "boolean" || typeof f.confirmedByMember !== "boolean"
      || (f.sensitive !== undefined && !inSet(SENSITIVE_CATEGORIES, f.sensitive))) e.push(`facet ${f.id}: provenance detail invalid`);
  }
  const iids = new Set<string>();
  for (const i of intents) {
    if (!isStr(i.id) || iids.has(i.id)) e.push(`intent ${i.id}: missing/duplicate id`); iids.add(i.id);
    if (!M.has(i.memberId) || !isStr(i.objective) || !inSet(CATEGORIES, i.category) || !isNum(i.horizonDays) || !inSet(INTENT_STATUS, i.status) || !isNum(i.createdAt)) e.push(`intent ${i.id}: invalid`);
  }
  for (const p of presence) {
    if (!M.has(p.memberId) || !inSet(CITIES, p.city) || !inSet(PRESENCE_TYPES, p.type) || !Array.isArray(p.areas)) e.push(`presence ${p.memberId}: invalid`);
    if (p.type === "temporary" && !(isNum(p.from) && isNum(p.to) && p.to! > p.from!)) e.push(`presence ${p.memberId}: temporary without valid window`);
  }
  for (const x of edges) {
    if (!M.has(x.from) || !M.has(x.to) || x.from === x.to || !inSet(EDGE_TYPES, x.type) || !(x.strength >= 0 && x.strength <= 1) || typeof x.explicit !== "boolean" || !isNum(x.createdAt)) e.push(`edge ${x.from}->${x.to} ${x.type}: invalid`);
  }
  // The loader produces a WorldSnapshot with no extra keys.
  const snap = await loadSnapshot(dir);
  const extra = [...snap.members.flatMap(m => Object.keys(m)), ...snap.edges.flatMap(x => Object.keys(x)), ...snap.facets.flatMap(f => Object.keys(f))]
    .filter(k => ["synthetic", "segment", "profile", "relation"].includes(k));
  if (extra.length) e.push(`snapshot carries dataset-only keys: ${[...new Set(extra)].join(",")}`);
  check("schema_conformance_core_types", e, { members: members.length, facets: facets.length, intents: intents.length, presence: presence.length, edges: edges.length, snapshotMembers: snap.members.length });
}

// ---- 3. every record synthetic ------------------------------------------------------------------
{
  const e: string[] = [];
  for (const [name, rows] of [["members", members], ["facets", facets], ["intents", intents], ["presence", presence], ["edges", edges], ["hidden_truth", hidden]] as const)
    (rows as any[]).forEach((r, i) => { if (r.synthetic !== true) e.push(`${name}[${i}] missing synthetic: true`); });
  check("all_records_synthetic", e);
}

// ---- 4. names, contact info, no real contact data in text --------------------------------------
{
  const e: string[] = [];
  const names = count(members, m => m.name.toLowerCase());
  for (const [n, c] of Object.entries(names)) if (c > 1) e.push(`duplicate name: ${n} x${c}`);
  const phones = count(members, m => m.profile.contact.phone);
  for (const m of members) {
    if (!PHONE_RE.test(m.profile.contact.phone)) e.push(`${m.id}: phone not in fictional 555-01xx range`);
    if (!/^[\w.+-]+@example\.com$/.test(m.profile.contact.email)) e.push(`${m.id}: email not @example.com`);
  }
  for (const [p, c] of Object.entries(phones)) if (c > 1) e.push(`duplicate phone ${p}`);
  // Free text must not contain phone numbers, emails or URLs.
  const texts = [
    ...members.flatMap(m => [m.profile.bio, m.profile.routine ?? "", m.profile.availability ?? "", m.profile.occupation ?? "", ...m.profile.voice.samples].map(t => [m.id, t] as const)),
    ...facets.map(f => [f.memberId, f.value] as const), ...intents.flatMap(i => [[i.memberId, i.details ?? ""], [i.memberId, i.desiredPeople ?? ""]] as const),
  ];
  for (const [id, t] of texts) if (/(\d{3}[\s.-]\d{3}[\s.-]\d{4})|([\w.+-]+@[\w-]+\.[a-z]{2,})|(https?:\/\/)|(www\.)/i.test(t)) e.push(`${id}: contact-like text: ${t.slice(0, 80)}`);
  check("names_unique_and_contact_fictional", e, { uniqueNames: Object.keys(names).length, members: members.length });
}

// ---- 5. city / neighborhood validity -------------------------------------------------------------
{
  const e: string[] = [];
  const valid = { sf: neighborhoodSet("sf"), nyc: neighborhoodSet("nyc") };
  for (const m of members) {
    if (!valid[m.homeCity].has(m.profile.neighborhood)) e.push(`${m.id}: neighborhood ${m.profile.neighborhood} not in ${m.homeCity}`);
    const b = NEIGHBORHOODS[m.homeCity].find(n => n.name === m.profile.neighborhood)?.borough;
    if (b !== m.profile.borough) e.push(`${m.id}: borough mismatch`);
  }
  for (const p of presence) for (const a of p.areas) if (!valid[p.city].has(a)) e.push(`presence ${p.memberId}: area ${a} not in ${p.city}`);
  for (const f of facets) if (f.tags.includes("neighborhood")) { const n = f.value.replace(/^lives near /, ""); if (!valid[M.get(f.memberId)!.homeCity].has(n)) e.push(`${f.id}: bad neighborhood ${n}`); }
  const home = presence.filter(p => p.type === "home");
  for (const m of members) if (home.filter(p => p.memberId === m.id && p.city === m.homeCity).length !== 1) e.push(`${m.id}: needs exactly one home presence in home city`);
  const byCity = count(members, m => m.homeCity);
  if (byCity.sf !== 250 || byCity.nyc !== 250) e.push(`city counts ${JSON.stringify(byCity)} != 250/250`);
  check("city_neighborhood_validity", e, {
    byCity, neighborhoodsUsed: { sf: new Set(members.filter(m => m.homeCity === "sf").map(m => m.profile.neighborhood)).size, nyc: new Set(members.filter(m => m.homeCity === "nyc").map(m => m.profile.neighborhood)).size },
    nycBoroughs: count(members.filter(m => m.homeCity === "nyc"), m => m.profile.borough ?? "?"),
  });
}

// ---- 6. age distribution + minors policy -------------------------------------------------------------
const trueMinor = new Set(hidden.filter(h => h.hidden.trueAge < 18).map(h => h.memberId));
const publicMinor = new Set(members.filter(m => m.age < 18).map(m => m.id));
{
  const e: string[] = [];
  const bucket = (a: number) => (a < 18 ? "13-17" : a < 25 ? "18-24" : a < 35 ? "25-34" : a < 45 ? "35-44" : a < 55 ? "45-54" : "55+");
  for (const m of members) {
    if (m.segment === "minor" && !(m.age >= 13 && m.age <= 17)) e.push(`${m.id}: minor age ${m.age}`);
    if (m.segment === "adult" && m.age < 18) e.push(`${m.id}: adult segment with age ${m.age}`);
    if (m.age < 13) e.push(`${m.id}: under 13`);
    const h = H.get(m.id)!;
    if (m.segment === "minor" && h.hidden.trueAge !== m.age) e.push(`${m.id}: honest minor age mismatch`);
    if (h.hidden.trueAge < 18 && m.segment === "adult" && h.adversarial?.kind !== "minor") e.push(`${m.id}: true minor not flagged`);
  }
  const share = pct(publicMinor.size, members.length);
  if (share < 8 || share > 12) e.push(`minor share ${share}% outside 8-12%`);
  check("age_distribution", e, {
    publicAgeBuckets: count(members, m => bucket(m.age)), minorsBySegment: publicMinor.size, minorSharePct: share,
    minorAges: count(members.filter(m => m.segment === "minor"), m => String(m.age)),
    trueMinorsIncludingAgeMisrepresentation: trueMinor.size,
    medianAdultAge: (() => { const a = members.filter(m => m.age >= 18).map(m => m.age).sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; })(),
  });
}
{
  const e: string[] = [];
  const minors = new Set([...trueMinor, ...publicMinor]);
  for (const x of edges) {
    if (minors.has(x.from) || minors.has(x.to)) {
      if (x.type !== "invited_by") e.push(`minor in ${x.type} edge ${x.from}->${x.to}`);
      else if (minors.has(x.from)) e.push(`minor ${x.from} is an inviter`);
    }
  }
  for (const m of members.filter(m => m.segment === "minor")) {
    if (m.prefs.romanceOptIn || m.prefs.categoriesOptIn.includes("romance")) e.push(`${m.id}: minor romance opt-in`);
    if (!m.prefs.onlyWhenAsked) e.push(`${m.id}: minor not onlyWhenAsked`);
    if (!m.invitedBy || M.get(m.invitedBy)!.age < 18) e.push(`${m.id}: minor must be invited by an adult`);
    for (const f of facets.filter(f => f.memberId === m.id)) if (f.scope !== "agent_private") e.push(`${f.id}: minor facet not agent_private`);
    if (!facets.some(f => f.memberId === m.id && f.tags.includes("single_player"))) e.push(`${m.id}: missing single_player facet`);
    for (const i of intents.filter(i => i.memberId === m.id)) if (!["hobby", "growth", "help"].includes(i.category)) e.push(`${i.id}: minor intent category ${i.category}`);
  }
  for (const m of members) if (m.prefs.romanceOptIn && m.age < 18) e.push(`${m.id}: romance under 18`);
  for (const i of intents) if (i.category === "romance" && (M.get(i.memberId)!.age < 18 || trueMinor.has(i.memberId))) e.push(`${i.id}: romance intent for minor`);
  check("minors_single_player_invited_by_only", e, { minors: minors.size, minorEdges: count(edges.filter(x => minors.has(x.from) || minors.has(x.to)), x => x.type) });
}

// ---- 7. canaries / privacy split ---------------------------------------------------------------------
{
  const e: string[] = [];
  const canaries = hidden.flatMap(h => (h.hidden.privateDisclosure ? [{ id: h.memberId, c: h.hidden.privateDisclosure.canary }] : []));
  const publicText = [FILES.members, FILES.intents, FILES.presence, FILES.edges].map(f => raw[f]).join("\n");
  // Canaries are unique; a canary is in exactly one agent_private facet if the member told the
  // agent (chat coverage), and in none otherwise.
  if (new Set(canaries.map(x => x.c)).size !== canaries.length) e.push("canaries not unique");
  let disclosed = 0;
  for (const { id, c } of canaries) {
    const fs = facets.filter(f => f.value.includes(c));
    const want = H.get(id)!.knowledge.chat.disclosure ? 1 : 0;
    disclosed += want;
    if (fs.length !== want) e.push(`${id}: canary ${c} in ${fs.length} facets (want ${want})`);
    for (const f of fs) { if (f.scope !== "agent_private") e.push(`${f.id}: canary facet scope ${f.scope}`); if (f.memberId !== id) e.push(`${f.id}: canary on wrong member`); }
    if (publicText.includes(c)) e.push(`${id}: canary appears outside its agent_private facet`);
  }
  for (const f of facets.filter(f => f.tags.includes("sensitive") || /\(ref [A-Z]{2}-\d{4}-[A-Z]+\)/.test(f.value))) if (f.scope !== "agent_private") e.push(`${f.id}: sensitive facet not agent_private`);
  for (const f of facets.filter(f => f.tags.some(t => t.startsWith("romance:")) || f.kind === "boundary")) if (f.scope !== "agent_private") e.push(`${f.id}: romance/boundary facet not agent_private`);
  // Hidden-only keys never in public files.
  const keysIn = (o: unknown, acc: Set<string>) => { if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { acc.add(k); keysIn(v, acc); } return acc; };
  const pubKeys = new Set<string>();
  for (const rows of [members, facets, intents, presence, edges]) for (const r of rows as unknown[]) keysIn(r, pubKeys);
  for (const k of HIDDEN_ONLY_KEYS) if (pubKeys.has(k)) e.push(`hidden-only key "${k}" present in public files`);
  check("canaries_agent_private_and_hidden_split", e, { canaries: canaries.length, canariesUnique: new Set(canaries.map(x => x.c)).size, disclosedToAgent: disclosed, agentPrivateFacets: facets.filter(f => f.scope === "agent_private").length, facetsByScope: count(facets, f => f.scope) });
}

// ---- 8. adversarial personas flagged ----------------------------------------------------------------
{
  const e: string[] = [];
  const adv = hidden.filter(h => h.adversarial);
  for (const h of adv) {
    if (h.hidden.adversarial !== h.adversarial!.kind) e.push(`${h.memberId}: adversarial flag mismatch`);
    if (!h.adversarial!.notes || !h.adversarial!.scriptedMessages.length) e.push(`${h.memberId}: adversarial notes missing`);
  }
  for (const h of hidden) if (h.hidden.adversarial && !h.adversarial) e.push(`${h.memberId}: unflagged adversary`);
  const share = pct(adv.length, hidden.length);
  if (share < 2 || share > 8) e.push(`adversarial share ${share}% outside 2-8%`);
  check("adversarial_flagged_in_hidden_truth", e, { adversarial: adv.length, sharePct: share, byKind: count(adv, h => h.adversarial!.kind) });
}

// ---- 9. invite trees + cluster / bridge stats ---------------------------------------------------------
{
  const e: string[] = [];
  const inv = edges.filter(x => x.type === "invited_by");
  for (const x of inv) {
    if (M.get(x.to)!.invitedBy !== x.from) e.push(`invite edge ${x.from}->${x.to} disagrees with member.invitedBy`);
    if (M.get(x.from)!.joinedAt >= M.get(x.to)!.joinedAt) e.push(`inviter ${x.from} joined after invitee ${x.to}`);
  }
  for (const m of members) if (m.invitedBy && !inv.some(x => x.to === m.id && x.from === m.invitedBy)) e.push(`${m.id}: invitedBy without edge`);
  // forest: no cycles, depth stats
  const depth = new Map<string, number>();
  const d = (id: string, seen = new Set<string>()): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) { e.push(`invite cycle at ${id}`); return 0; }
    seen.add(id);
    const p = M.get(id)!.invitedBy; const v = p ? d(p, seen) + 1 : 0; depth.set(id, v); return v;
  };
  members.forEach(m => d(m.id));
  const roots = members.filter(m => !m.invitedBy);
  const fanout = count(inv, x => x.from);
  const crossCityInvites = inv.filter(x => M.get(x.from)!.homeCity !== M.get(x.to)!.homeCity).length;
  const vouches = edges.filter(x => x.type === "vouched_for");
  check("invite_vouch_trees", e, {
    roots: roots.length, rootsByCity: count(roots, m => m.homeCity), maxDepth: Math.max(...depth.values()),
    depthHistogram: count([...depth.values()], v => String(v)), maxFanout: Math.max(...Object.values(fanout)),
    inviters: Object.keys(fanout).length, crossCityInvites, vouches: vouches.length,
    vouchedMembers: new Set(vouches.map(v => v.to)).size,
  });
}
{
  const e: string[] = [];
  // Social graph: knows + invited_by + vouched_for, undirected, deduped.
  const adj = new Map<string, Set<string>>(members.map(m => [m.id, new Set()]));
  const pairs = new Set<string>();
  for (const x of edges) if (["knows", "invited_by", "vouched_for"].includes(x.type)) {
    const k = x.from < x.to ? `${x.from}|${x.to}` : `${x.to}|${x.from}`;
    if (pairs.has(k)) continue; pairs.add(k);
    adj.get(x.from)!.add(x.to); adj.get(x.to)!.add(x.from);
  }
  const ids = members.map(m => m.id);
  const mEdges = pairs.size;
  // components
  const comp = new Map<string, number>(); let nc = 0;
  for (const s of ids) { if (comp.has(s)) continue; const st = [s]; comp.set(s, nc); while (st.length) { const u = st.pop()!; for (const v of adj.get(u)!) if (!comp.has(v)) { comp.set(v, nc); st.push(v); } } nc++; }
  const compSizes = Object.values(count(ids, id => String(comp.get(id)))).sort((a, b) => b - a);
  // modularity of a partition
  const modularity = (label: Map<string, string>) => {
    const degSum = new Map<string, number>(); let inside = 0;
    for (const id of ids) degSum.set(label.get(id)!, (degSum.get(label.get(id)!) ?? 0) + adj.get(id)!.size);
    for (const k of pairs) { const [a, b] = k.split("|") as [string, string]; if (label.get(a) === label.get(b)) inside++; }
    let q = inside / mEdges; for (const s of degSum.values()) q -= (s / (2 * mEdges)) ** 2; return Math.round(q * 1000) / 1000;
  };
  const commLabel = new Map(hidden.map(h => [h.memberId, h.community]));
  // Community detection on the PUBLIC graph only: one-level Louvain local moving (deterministic order).
  const lp = new Map(ids.map(id => [id, id]));
  {
    const two_m = 2 * mEdges;
    const tot = new Map(ids.map(id => [id, adj.get(id)!.size]));
    for (let it = 0; it < 30; it++) {
      let moved = 0;
      for (const id of [...ids].sort()) {
        const ki = adj.get(id)!.size; if (!ki) continue;
        const cur = lp.get(id)!;
        tot.set(cur, tot.get(cur)! - ki);
        const links = new Map<string, number>();
        for (const v of adj.get(id)!) links.set(lp.get(v)!, (links.get(lp.get(v)!) ?? 0) + 1);
        let best = cur, bestGain = (links.get(cur) ?? 0) - (tot.get(cur)! * ki) / two_m;
        for (const [c, kin] of [...links.entries()].sort()) {
          const gain = kin - (tot.get(c)! * ki) / two_m;
          if (gain > bestGain + 1e-12) { best = c; bestGain = gain; }
        }
        tot.set(best, tot.get(best)! + ki);
        if (best !== cur) { lp.set(id, best); moved++; }
      }
      if (!moved) break;
    }
  }
  const lpSizes = Object.values(count(ids.filter(id => adj.get(id)!.size), id => lp.get(id)!)).sort((a, b) => b - a);
  // bridges
  let intraComm = 0, crossComm = 0, crossCity = 0;
  for (const k of pairs) { const [a, b] = k.split("|") as [string, string]; if (commLabel.get(a) === commLabel.get(b)) intraComm++; else crossComm++; if (M.get(a)!.homeCity !== M.get(b)!.homeCity) crossCity++; }
  const bridgeMembers = ids.filter(id => new Set([...adj.get(id)!].map(v => commLabel.get(v))).size >= 3).length;
  const crossCityMembers = ids.filter(id => [...adj.get(id)!].some(v => M.get(v)!.homeCity !== M.get(id)!.homeCity)).length;
  // Tarjan bridges (edges whose removal disconnects the graph).
  const tin = new Map<string, number>(), low = new Map<string, number>(); let timer = 0, graphBridges = 0;
  const dfs = (root: string) => {
    const stack: [string, string | null, string[]][] = [[root, null, [...adj.get(root)!]]];
    tin.set(root, timer); low.set(root, timer++);
    while (stack.length) {
      const top = stack[stack.length - 1]!; const [u, parent, rest] = top;
      if (rest.length) {
        const v = rest.pop()!;
        if (v === parent) continue;
        if (tin.has(v)) low.set(u, Math.min(low.get(u)!, tin.get(v)!));
        else { tin.set(v, timer); low.set(v, timer++); stack.push([v, u, [...adj.get(v)!]]); }
      } else {
        stack.pop();
        if (parent !== null) { low.set(parent, Math.min(low.get(parent)!, low.get(u)!)); if (low.get(u)! > tin.get(parent)!) graphBridges++; }
      }
    }
  };
  for (const id of ids) if (!tin.has(id)) dfs(id);
  const degs = ids.filter(id => !trueMinor.has(id)).map(id => adj.get(id)!.size).sort((a, b) => a - b);
  const qComm = modularity(commLabel), qLp = modularity(lp);
  const knowsByRel = count(edges.filter(x => x.type === "knows"), x => x.relation);
  if (qComm < 0.3) e.push(`community modularity ${qComm} < 0.3 (clusters too weak)`);
  const crossShare = pct(crossComm, mEdges);
  if (crossShare < 5 || crossShare > 40) e.push(`cross-community edge share ${crossShare}% outside 5-40%`);
  if (crossCity < 10) e.push(`only ${crossCity} SF<->NYC edges`);
  if (compSizes[0]! / ids.length < 0.85) e.push(`largest component ${compSizes[0]} < 85% of members`);
  check("clusters_and_bridges", e, {
    socialGraphEdges: mEdges, knowsByRelation: knowsByRel, components: nc, largestComponent: compSizes[0], isolated: ids.filter(id => !adj.get(id)!.size).length,
    adultDegree: { min: degs[0], median: degs[Math.floor(degs.length / 2)], p90: degs[Math.floor(degs.length * 0.9)], max: degs[degs.length - 1] },
    generatorCommunities: new Set(commLabel.values()).size, modularityGeneratorCommunities: qComm,
    publicGraphLouvainClusters: lpSizes.length, publicGraphLouvainTop8Sizes: lpSizes.slice(0, 8), modularityPublicGraphLouvain: qLp,
    intraCommunityEdges: intraComm, crossCommunityEdges: crossComm, crossCommunitySharePct: crossShare,
    bridgeMembers_3plusCommunities: bridgeMembers, sfNycEdges: crossCity, membersWithCrossCityTie: crossCityMembers, graphBridges,
  });
}

// ---- 10. travelers -------------------------------------------------------------------------------
{
  const e: string[] = [];
  const multi = new Set(presence.filter(p => p.city !== M.get(p.memberId)!.homeCity).map(p => p.memberId));
  const hiddenTravel = new Set(hidden.filter(h => h.secondaryCity || h.hidden.trips.length).map(h => h.memberId));
  const share = pct(hiddenTravel.size, members.length);
  if (share < 8 || share > 12) e.push(`multi-city share ${share}% outside 8-12%`);
  for (const id of multi) if (M.get(id)!.age < 18) e.push(`${id}: minor with multi-city presence`);
  check("multi_city_travelers", e, {
    multiCityMembers: hiddenTravel.size, sharePct: share, visibleInSnapshotPresence: multi.size,
    byHomeCity: count([...hiddenTravel], id => M.get(id)!.homeCity), presenceByType: count(presence, p => p.type),
  });
}

// ---- 11. diversity --------------------------------------------------------------------------------
{
  const e: string[] = [];
  const intentCat = count(intents, i => i.category);
  for (const c of ["social", "professional", "romance", "hobby", "help", "growth"]) if (!intentCat[c]) e.push(`no intents in category ${c}`);
  const arche = count(hidden, h => h.archetype);
  if (Object.keys(arche).length < 7) e.push(`only ${Object.keys(arche).length} archetypes`);
  const interestTags = new Set(facets.filter(f => f.kind === "interest").map(f => f.tags[0]));
  const styles = count(hidden, h => h.hidden.style);
  const enrich = count(members, m => m.profile.enrichment);
  const bioDupes = Object.values(count(members.filter(m => m.profile.bioSource === "member"), m => m.profile.bio)).filter(c => c > 1).length;
  if (bioDupes) e.push(`${bioDupes} duplicated bios`);
  const occupations = new Set(hidden.map(h => h.personaTexture.occupation.toLowerCase())).size;
  check("diversity", e, {
    archetypes: arche, segments: count(members, m => m.segment), genders: count(hidden, h => h.gender),
    intentsByCategory: intentCat, intentsByCategoryCity: { sf: count(intents.filter(i => M.get(i.memberId)!.homeCity === "sf"), i => i.category), nyc: count(intents.filter(i => M.get(i.memberId)!.homeCity === "nyc"), i => i.category) },
    intentsPerMember: Math.round((intents.length / members.length) * 100) / 100,
    distinctIntentObjectives: new Set(intents.map(i => i.objective)).size,
    romanceOptInAdults: members.filter(m => m.prefs.romanceOptIn).length,
    interestTagsUsed: interestTags.size, facetKinds: count(facets, f => f.kind), writingStyles: styles,
    distinctOccupations: occupations, enrichment: enrich, states: count(members, m => m.state),
  });
}


// ---- 12. richness tiers (1.2.0) -----------------------------------------------------------------------
const tierOf = new Map(hidden.map(h => [h.memberId, h.knowledge?.richness]));
const ACTIVE = new Set(["connected", "confirmed"]);
const activeSources = (m: MemberRecord) => (m.connectedSources ?? []).filter(s => ACTIVE.has(s.status));
const facetsOf = new Map<string, FacetRecord[]>(members.map(m => [m.id, []]));
for (const f of facets) facetsOf.get(f.memberId)?.push(f);
const intentsOf = new Map<string, IntentRecord[]>(members.map(m => [m.id, []]));
for (const i of intents) intentsOf.get(i.memberId)?.push(i);
const POLICY_TAGS = ["single_player"];
const isPolicyFacet = (f: FacetRecord) => f.tags.some(t => POLICY_TAGS.includes(t) || t.startsWith("romance:"));
{
  const e: string[] = [];
  const byTier = count(hidden, h => h.knowledge?.richness ?? "missing");
  for (const t of RICHNESS_TIERS) {
    const share = pct(byTier[t] ?? 0, hidden.length);
    if (Math.abs(share - DEFAULT_RICHNESS_MIX[t] * 100) > 2) e.push(`tier ${t} share ${share}% vs target ${DEFAULT_RICHNESS_MIX[t] * 100}%`);
  }
  if (byTier.missing) e.push(`${byTier.missing} members without a tier`);
  for (const h of hidden) if (h.hidden.richness !== h.knowledge?.richness) e.push(`${h.memberId}: hidden.richness disagrees with knowledge.richness`);
  // Minimal: name, city, maybe one vague intent. Only policy facets (single_player, romance opt-in).
  for (const m of members.filter(m => tierOf.get(m.id) === "minimal")) {
    const fs = facetsOf.get(m.id)!.filter(f => !isPolicyFacet(f));
    if (fs.length) e.push(`${m.id}: minimal member has ${fs.length} non-policy facets`);
    if (intentsOf.get(m.id)!.length > 1) e.push(`${m.id}: minimal member has ${intentsOf.get(m.id)!.length} intents`);
    if (intentsOf.get(m.id)!.some(i => i.details || i.desiredPeople)) e.push(`${m.id}: minimal member intent has details`);
  }
  const mean = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)) * 100) / 100;
  const stats = Object.fromEntries(RICHNESS_TIERS.map(t => {
    const ms = members.filter(m => tierOf.get(m.id) === t);
    return [t, {
      members: ms.length,
      facetsPerMember: mean(ms.map(m => facetsOf.get(m.id)!.length)),
      chatFacetsPerMember: mean(ms.map(m => facetsOf.get(m.id)!.filter(f => f.source === "chat").length)),
      sourceFacetsPerMember: mean(ms.map(m => facetsOf.get(m.id)!.filter(f => f.source !== "chat").length)),
      intentsPerMember: mean(ms.map(m => intentsOf.get(m.id)!.length)),
      activeSourcesPerMember: mean(ms.map(m => activeSources(m).length)),
      chatMessagesMedian: ms.map(m => m.profile.chatMessages).sort((a, b) => a - b)[Math.floor(ms.length / 2)],
      // Coverage of TRUE interests (hidden) by known, non-private interest facets.
      trueInterestCoverage: mean(ms.map(m => { const h = H.get(m.id)!.hidden; const known = new Set(facetsOf.get(m.id)!.filter(f => f.kind === "interest").map(f => f.tags[0])); return h.interests.filter(t => known.has(t)).length / Math.max(1, h.interests.length); })),
    }];
  }));
  for (let i = 1; i < RICHNESS_TIERS.length; i++) {
    const a = (stats as any)[RICHNESS_TIERS[i - 1]!], b = (stats as any)[RICHNESS_TIERS[i]!];
    if (!(b.facetsPerMember > a.facetsPerMember)) e.push(`facets per member not increasing ${RICHNESS_TIERS[i - 1]} -> ${RICHNESS_TIERS[i]}`);
  }
  check("richness_tier_distribution", e, { byTier, targetMix: DEFAULT_RICHNESS_MIX, byTierStats: stats });
}

// ---- 13. known facets have a channel; nothing hidden leaks into the known view -------------------------
{
  const e: string[] = [];
  for (const m of members) {
    const h = H.get(m.id)!; const k = h.knowledge; const chat = k.chat;
    const act = new Set(activeSources(m).map(s => s.source));
    for (const f of facetsOf.get(m.id)!) {
      if (f.source === "chat") {
        if (f.provenance === "connected_source") e.push(`${f.id}: chat facet with connected_source provenance`);
        if (f.kind === "interest" && !chat.interests.includes(f.tags[0]!)) e.push(`${f.id}: chat interest ${f.tags[0]} not in chat coverage`);
        if (f.kind === "skill" && !chat.skills.includes(f.tags[0]!)) e.push(`${f.id}: chat skill ${f.tags[0]} not in chat coverage`);
        if (f.tags.includes("occupation") && !chat.occupation) e.push(`${f.id}: occupation facet without chat coverage`);
        if (f.tags.includes("neighborhood") && !chat.neighborhood) e.push(`${f.id}: neighborhood facet without chat coverage`);
      } else {
        if (!act.has(f.source as any)) e.push(`${f.id}: source ${f.source} is not an active source of ${m.id}`);
        if (f.provenance !== "connected_source") e.push(`${f.id}: source facet provenance ${f.provenance}`);
        if (!k.observationTruth[f.id]) e.push(`${f.id}: source facet without a hidden truth label`);
      }
      // Inferred facets are never shareable until confirmed.
      if (f.inferred && !f.confirmedByMember && f.scope === "shareable") e.push(`${f.id}: unconfirmed inference is shareable`);
    }
    for (const id of Object.keys(k.observationTruth)) if (!facetsOf.get(m.id)!.some(f => f.id === id)) e.push(`${m.id}: truth label for missing facet ${id}`);
    for (const i of intentsOf.get(m.id)!) if (!chat.intents.includes(Number(i.id.split(":i")[1]))) e.push(`${i.id}: intent not in chat coverage`);
    if ((m.profile.occupation !== undefined) !== chat.occupation) e.push(`${m.id}: profile.occupation presence disagrees with chat coverage`);
    if (m.profile.voice.samples.length > chat.voiceSamples) e.push(`${m.id}: more voice samples than chat coverage`);
    if (m.profile.bioSource === "summary") {
      const known = new Set(facetsOf.get(m.id)!.filter(f => f.kind === "interest").map(f => f.tags[0]));
      const bio = m.profile.bio.toLowerCase().split((m.profile.occupation ?? "\u0000").toLowerCase()).join(" ");
      for (const it of INTERESTS) if (bio.includes(it.label.toLowerCase()) && !known.has(it.tag)) e.push(`${m.id}: summary bio mentions unknown interest ${it.tag}`);
    }
    for (const c of m.connectedSources ?? []) {
      const n = facetsOf.get(m.id)!.filter(f => f.source === c.source).length;
      if (ACTIVE.has(c.status) ? c.observations !== n : c.observations !== 0) e.push(`${m.id}: ${c.source} (${c.status}) says ${c.observations} observations, facets ${n}`);
    }
  }
  const truth = count(hidden.flatMap(h => Object.values(h.knowledge.observationTruth)), t => t.truth);
  if (!truth.stale || !truth.wrong_inference) e.push(`no noise: ${JSON.stringify(truth)}`);
  check("known_facets_have_channel_no_hidden_leak", e, {
    facetsBySource: count(facets, f => f.source ?? "none"), sourceFacetTruth: truth,
    inferredFacets: facets.filter(f => f.inferred).length, confirmedSourceFacets: facets.filter(f => f.source !== "chat" && f.confirmedByMember).length,
    staleOver1y: facets.filter(f => SNAPSHOT_NOW - (f.observedAt ?? SNAPSHOT_NOW) > 365 * 86_400_000).length,
  });
}

// ---- 14. connected sources: rates track richness; subject is always the member ------------------------
{
  const e: string[] = [];
  for (const m of members) {
    const t = tierOf.get(m.id); const n = activeSources(m).length;
    if (t === "minimal" && (m.connectedSources ?? []).length) e.push(`${m.id}: minimal member has source entries`);
    if (t === "very_rich" && (n < 3 || n > 6)) e.push(`${m.id}: very_rich member has ${n} active sources (want 3-6)`);
    if (new Set(activeSources(m).map(s => s.source)).size !== n) e.push(`${m.id}: duplicate active source`);
  }
  const all = members.flatMap(m => m.connectedSources ?? []);
  const byTier = Object.fromEntries(RICHNESS_TIERS.map(t => {
    const ms = members.filter(m => tierOf.get(m.id) === t);
    return [t, { none: ms.filter(m => !activeSources(m).length).length, activeHistogram: count(ms, m => String(activeSources(m).length)) }];
  }));
  check("connected_sources_track_richness", e, {
    membersWithNoActiveSource: members.filter(m => !activeSources(m).length).length, byTier,
    activeByKind: count(all.filter(s => ACTIVE.has(s.status)), s => s.source), entriesByStatus: count(all, s => s.status),
    activeByLink: count(all.filter(s => ACTIVE.has(s.status)), s => s.link),
  });
}
{
  const e: string[] = [];
  // No observations about non-members: every facet belongs to a member, every source is about the
  // member themselves, found profiles that are pending or rejected (namesakes) keep no data, and no
  // facet text names another person.
  for (const f of facets) if (!M.has(f.memberId)) e.push(`${f.id}: facet about a non-member`);
  for (const m of members) for (const c of m.connectedSources ?? []) {
    if (c.subject !== "self") e.push(`${m.id}: source ${c.source} subject ${c.subject}`);
    if (!ACTIVE.has(c.status) && facetsOf.get(m.id)!.some(f => f.source === c.source)) e.push(`${m.id}: facets from ${c.status} source ${c.source}`);
    if (c.link === "found_profile" && !["confirmed", "pending_confirmation", "rejected"].includes(c.status)) e.push(`${m.id}: found profile with status ${c.status}`);
    if (c.status === "confirmed" && c.link !== "found_profile") e.push(`${m.id}: 'confirmed' status is for found profiles`);
  }
  const fullNames = members.map(m => ({ id: m.id, n: m.name.toLowerCase(), last: m.name.split(" ").slice(-1)[0]!.toLowerCase() }));
  for (const f of facets.filter(f => f.source !== "chat")) {
    const v = f.value.toLowerCase();
    for (const x of fullNames) if (x.id !== f.memberId && (v.includes(x.n) || new RegExp(`\\b${x.last}\\b`).test(v))) e.push(`${f.id}: names ${x.id}`);
    if (/@\w|https?:|www\./.test(f.value)) e.push(`${f.id}: handle or URL in a source facet`);
  }
  check("no_observations_about_non_members", e, {
    foundProfiles: count(members.flatMap(m => (m.connectedSources ?? []).filter(s => s.link === "found_profile")), s => s.status),
    sourceFacets: facets.filter(f => f.source !== "chat").length,
  });
}

// ---- 15. sensitive inferences: agent_private, never shareable -------------------------------------------
{
  const e: string[] = [];
  const SENSITIVE_TEXT = /pharmacy|clinic receipts|overdraft|late-payment|congregation|lgbtq|breakup|separation|school newsletter|child's school/i;
  for (const f of facets) {
    if (f.sensitive && (f.scope !== "agent_private" || !f.tags.includes("sensitive"))) e.push(`${f.id}: sensitive (${f.sensitive}) facet scope ${f.scope}`);
    if (f.source !== "chat" && SENSITIVE_TEXT.test(f.value) && !f.sensitive) e.push(`${f.id}: sensitive-looking source facet not flagged`);
    if (f.sensitive && f.confirmedByMember) e.push(`${f.id}: sensitive inference marked confirmed`);
  }
  const snap = await loadSnapshot(dir);
  const visible = snap.facets.filter(f => f.scope === "shareable" || f.scope === "matchable");
  if (visible.some(f => f.sensitive || f.tags.includes("sensitive"))) e.push("a sensitive facet is matchable/shareable in the engine snapshot");
  check("sensitive_inferences_never_shareable", e, { sensitiveInferences: count(facets.filter(f => f.sensitive), f => f.sensitive!), sensitiveByScope: count(facets.filter(f => f.sensitive), f => f.scope) });
}

// ---- 16. minors: no social / Gmail-derived matching facets -------------------------------------------------
{
  const e: string[] = [];
  const minorsPublic = members.filter(m => m.segment === "minor");
  for (const m of minorsPublic) {
    for (const c of m.connectedSources ?? []) {
      if (!MINOR_ALLOWED_SOURCES.has(c.source as any)) e.push(`${m.id}: minor has source ${c.source}`);
      if (c.link === "found_profile") e.push(`${m.id}: profile discovery for a minor`);
    }
    for (const f of facetsOf.get(m.id)!) {
      if (f.scope !== "agent_private") e.push(`${f.id}: minor facet ${f.scope}`);
      if (f.source !== "chat" && !MINOR_ALLOWED_SOURCES.has(f.source as any)) e.push(`${f.id}: minor facet from ${f.source}`);
      if (f.sensitive) e.push(`${f.id}: sensitive inference about a minor`);
    }
  }
  check("minors_no_social_or_gmail_matching_facets", e, {
    minors: minorsPublic.length, minorsWithSources: minorsPublic.filter(m => activeSources(m).length).length,
    minorSourceKinds: count(minorsPublic.flatMap(activeSources), s => s.source), minorFacetsBySource: count(minorsPublic.flatMap(m => facetsOf.get(m.id)!), f => f.source ?? "none"),
  });
}

// ---- 17. intent liveness (1.2.1): records anchored to the snapshot, consistent with hidden wants ---------
// Every intent record must be explainable from hidden truth: an active record past its horizon only
// for a member who did not answer the check-ins; a closed record only for a want that has lapsed.
// Most active records must be live at snapshot time (the 1.2.0 bug: 52% of active records expired).
{
  const e: string[] = [];
  const DAY_MS = 86_400_000, RECONFIRM_MS = 30 * DAY_MS;
  const live = (i: IntentRecord) => i.status === "active" && i.createdAt + i.horizonDays * DAY_MS > SNAPSHOT_NOW;
  const tab: Record<string, number> = {};
  for (const i of intents) {
    const h = H.get(i.memberId)!;
    const st = h.personaPublic.statedIntents[Number(i.id.split(":i")[1])];
    const want = st && h.hidden.desires.find(d => d.id === st.desireId);
    const lapsed = !!want && want.lapsesAt !== undefined && want.lapsesAt <= SNAPSHOT_NOW;
    const rec = i.status !== "active" ? i.status : live(i) ? "live" : "expired";
    tab[`${rec}/${!want ? "not_a_hidden_want" : lapsed ? "lapsed" : "held"}`] = (tab[`${rec}/${!want ? "not_a_hidden_want" : lapsed ? "lapsed" : "held"}`] ?? 0) + 1;
    if (i.createdAt > SNAPSHOT_NOW) e.push(`${i.id}: createdAt after the snapshot`);
    if (st?.statedAt === undefined || i.createdAt < st.statedAt) e.push(`${i.id}: createdAt before the member stated it (or no statedAt)`);
    if (i.status === "closed" && !lapsed) e.push(`${i.id}: closed but the hidden want has not lapsed`);
    if (rec === "expired" && h.hidden.responsiveness.ignoreProb < 0.05 && M.get(i.memberId)!.unansweredProactive < 2) e.push(`${i.id}: expired for a member who answers ~every check-in`);
    if (st?.statedAt !== undefined && i.createdAt !== st.statedAt && (i.createdAt - st.statedAt) % RECONFIRM_MS !== 0) e.push(`${i.id}: createdAt is not a check-in time`);
  }
  const active = intents.filter(i => i.status === "active");
  const expiredShare = pct(active.filter(i => !live(i)).length, active.length);
  if (expiredShare > 10) e.push(`${expiredShare}% of active intents are past their horizon (max 10%)`);
  const adults = members.filter(m => m.segment === "adult");
  const withLive = new Set(intents.filter(live).map(i => i.memberId));
  check("intent_liveness_anchored", e, {
    recordVsHiddenWant: tab, activeExpiredPct: expiredShare,
    adultsWithLiveIntent: adults.filter(m => withLive.has(m.id)).length, adults: adults.length,
    medianRecordAgeDays: (() => { const a = intents.map(i => (SNAPSHOT_NOW - i.createdAt) / DAY_MS).sort((x, y) => x - y); return Math.round(a[Math.floor(a.length / 2)] ?? 0); })(),
  });
}

// ---- report -----------------------------------------------------------------------------------------
const failed = checks.filter(c => !c.pass);
const report = { dataset: dir.replace(/.*\/data\//, "data/"), validatedAt: new Date().toISOString(), pass: failed.length === 0, passed: checks.length - failed.length, total: checks.length, checks };
await Bun.write(cli.out ?? `${dir}/validation.json`, JSON.stringify(report, null, 2) + "\n");
for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.errors ? `\n      ${c.errors.slice(0, 5).join("\n      ")}` : ""}`);
console.log(`\n${report.passed}/${report.total} checks passed -> ${cli.out ?? `${dir}/validation.json`}`);
process.exit(failed.length ? 1 : 0);
