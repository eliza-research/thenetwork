# Engine generalization: one matching engine, four app packs

> **Superseded names (2026-10-08 cleanup note).** This is a dated research record. Since it was written: buddies.nyc was renamed friends.help (AppId `friends`, `friendsPack`); ntwrk.club belongs to someone else and is not used (ntwrk.party is the home page); `packages/worlds` moved to `packages/sim/src/apps`; the prototypes were deleted or promoted (`packages/blooio`). Current decisions: AGENTS.md "Platform decisions" and docs/mvp-plan.md.

Date: 2026-10-08. Read-only audit. No code was changed and no LLM calls were made.

**Goal.** Turn the matching engine into a reusable package with a flexible interface. One unified engine serves four apps. Each app has its own matchmaking goals and opportunity types, and its own simulations, experiments and tests.

| App | Domain | What it matches |
|---|---|---|
| **The Network** | ntwrk.club (ntwrk.party is live today) | The existing app: friends, activities, help, professional, dating with opt-in, events and plans; SF and NYC, with NYC the launch city. |
| **slop.date** | Dating | A single city, several cities, or within X miles of a zip code or point. |
| **peon.biz** | Hiring | Candidate ↔ job (employer). |
| **buddies.nyc** | Friend-finding | NYC only. |

**What this doc proposes.** Split the code into:
- a generic **core**: the pipeline, invariants, safety, determinism, simulation runner and eval kernels;
- one **app pack** per app: ontology, rules, generators, prompts, copy, geo data, personas, oracle and launch gates.

The current results must reproduce byte-identically under `networkPack` for every refactor step.

**Tree state when audited:**
- **Checked-out branch.** The research ran in the repository checkout, branch `docs/matching-research-compendium` @ `06f860e`.
  - It has engine v1.2, attention v1.2, plans v1.1, judge v2/v3 and the capital ledger.
  - It is 5 commits ahead of `main` and 15 behind it.
- **`main` @ `93feb51`.** It has none of capital, plans or judgeContext. It does have `packages/plugin-network`, which this branch does not.
- **Uncommitted WIP in both worktrees.** The working tree and the `obs/network-console` worktree (the `thenetwork-console` worktree, HEAD = `main`) both carry large uncommitted changes:
  - `packages/network`: adds `service/`, `db/`, `harness/`, `store.ts`, `outreach.ts`;
  - `packages/observatory`;
  - `packages/sim`: `world.ts`, `agent/policy.ts`, `channel.ts`, `stubNetwork.ts`.

  `packages/network` and `packages/observatory` were read from `main` via `git show`, with the console WIP noted where it matters.
- **Consequence for baselines.** Any "byte-identical" baseline must be pinned to a commit **and** a clean tree. The sim WIP alone can move every simulated number (see section 3, seam R1).

Legend for section 1: **G** = generic; **N** = specific to The Network; **M** = mixed (generic mechanism with Network policy or data baked in).

---

## 1. Inventory

### 1.1 Module table

| Module | Class | Evidence (file:line) and notes |
|---|---|---|
| `core/src/types.ts` | **M** | `City = "sf" \| "nyc"` (3); `Category` with `romance`, `growth` (10). `Preferences.romanceOptIn` (50-54) is a dating concept inside the core `Member`. `Member.age: number` is required (74-80); for hiring, a numeric age is a protected attribute (ADEA 40+). `OpportunityKind` is the Network's 9 kinds (88-90). `ScoreComponents` (91-95), `Facet`/`Intent`/`Edge`/`Presence` shapes and `PrivacyScope`/`Provenance` are generic. `SourceKind` (18-21) is a generic list of consumer sources. |
| `core/src/policy.ts` | **M** | The age floor is a good cross-app invariant: `ADULT_AGE = 18`, `canBeMatched`. The 13-17 "personal agent" tier (`MIN_MEMBER_AGE = 13`, `canJoin`) is a Network product decision. `UNDER_MIN_AGE_DECLINE` names "The Network". |
| `core/src/guard.ts` | **G** | `LeakGuard` / `findLeaks`: contacts, canaries, fuzzy private facts, folding. Reusable as-is. |
| `core/src/llm.ts`, `chatJson.ts`, `clock.ts` | **G** | Model client, retrying JSON chat, clock. |
| `engine/src/types.ts` | **M** | `Role` union (88-90) and `CONTRIBUTOR_ROLES` (91) are Network roles. `AskReason` includes `romance_prefs` (44). `ItemKind` (190-191) mixes generic items (`intro_probe`, `profiling_question`) with Network ones (`help_ask`, `advice_route`, `place_suggestion`). `CadencePrefs.romanceInDigest` (219). `NetworkEvent`, `FeedbackRecord`, `InteractionRecord`, `MatchingRunLog` and `FairnessMetrics` are generic apart from `byCity`. |
| `engine/src/config.ts` | **M** | `cities: ["sf","nyc"]` and `timezones` (128-129). The `GENERATOR_NAMES` list (10-14) and `Record<GeneratorName, boolean>` (67) fix the generator set. Lane-specific thresholds: `byCategory: {romance, help, growth}` (145), `categoryOverride` (148), `romance.requireStatedPrefs` (95, 190). `personalGrowthAsHobby` (80). The risk lexicon (`highRiskTerms`/`highRiskPatterns`/`homeEntryTerms`, 213-226) is Network safety policy for in-person meetups. `group` size 3..6 is enforced in `resolveConfig` (452). Everything else (budgets, cooldowns, weights, floors, retrieval, exploration, judge, selection) is a generic knob with Network values. **`configHash` hashes the whole `EngineConfig` (457-460)**: adding any field changes `runId`. |
| `config.ts` attention section | **M** | Generic mechanism: caps, lambda, kind weights, effort costs, hold queue, send-time learning, availability (256-351). Network policy: `minors` (291, 378-383), `romanceInDigest` (296, 386), `blooio` coupling (295, 385), `v14` (299), `consent` (323, 399). `version: "attention-v1.2.0"` (356). |
| `config.ts` plans section | **M** | Planner knobs are generic (468-525). Network rules: `size.min >= 3`, `partner === 2` (554-555), "plans never romance". `version: "plans-v1.1.0"` (528). |
| `engine/src/world.ts` | **M** | Index, id aliasing, blocks, cooldowns, exposure and acceptance are generic. Network-specific parts: <ul><li>minors excluded from the warm graph and inviter roots (94, 106, 314);</li><li>romance prefs parsed from facet tags `romance:is:/seeks:/age:` (267-277);</li><li>dealbreakers from `dealbreaker:` tags (266);</li><li>`isHost` from the `host` tag (299);</li><li>personal growth recategorized as hobby (196-204, 247-248).</li></ul> **Geo is city-bucket only**: `location()` (324-343) and `overlap()` (374-387) intersect time intervals per `City` string. `canMeet` iterates `cfg.cities` (366). |
| `engine/src/filters.ts` | **M** | Engine structure is generic: `memberReason`/`pairReason`/`candidateReason` with a first-failing-reason funnel. Network rules are hard-coded in order:<ul><li>minors (56, 80, 154);</li><li>category opt-in (60);</li><li>`romance_opt_out` (61);</li><li>`romance_incompatible` via `romanceCompatible` (91-105);</li><li>`home_entry_rule` for help (178-184);</li><li>presence overlap per city (185-199).</li></ul> `FilterReason` (10-16) is a closed union. `maxTravelMinutes` is **not** a hard filter anywhere. |
| `engine/src/taxonomy.ts` | **N** | 20 hard-coded `OBJECTIVES` regexes (27-48) shared with `sim/src/taxonomy.ts DESIRES`. `isPersonalGrowth` and `NETWORK_GROWTH_TEXT` (79-82). |
| `engine/src/complementarity.ts` | **M** | The needs→offers satisfaction math is generic (`SAT` 31). `romanceMutual` (61-66) is dating logic. It relies on the Network taxonomy. |
| `engine/src/retrieval.ts` | **G** | Semantic top-K + tag + graph two-hop + structured need channel + exposure floor (60-121). Only coupling: `Category`/`Role` types. |
| `engine/src/generators.ts` | **M→N** | All 11 generators are Network strategies, with hard-coded lane exclusions: `help/romance/growth` skipped (68, 99, 208, 335). `romanceIntros` (146-200) is the dating path. `group_composer` is fixed to `"social"` (445). `newcomer_welcome` uses hosts and is fixed to `"social"`, size 3-4 (529-560). `network_growth` uses category `"growth"` (614). `expansion` is fixed to `"hobby"` (634). Member-facing objective labels: `CATEGORY_LABEL` (20-23), e.g. romance = "a dinner introduction". Generic building blocks inside: `makeCandidate`, `bestShareable`, `intentFormat`, and the pairing and pooling patterns. |
| `engine/src/group.ts` | **G** | Beam-search group composer (`composeGroup`, `makeCompat`). Coupled only through `pairReason` and `City`. |
| `engine/src/scoring.ts` | **M** | Components, `netValue`, floors and threshold logic are generic. Reciprocity is built in: harmonic mean for pairs, "average without misery" for groups (34-40). Network policy points: `romance` social-risk +0.1 (143); novelty overrides by kind `expansion` / `second_encounter` (83-84); area-sharing activation cost from `Presence.areas` names (97-103); judge blending (152-160). |
| `engine/src/policy.ts` | **M** | Selection (greedy, exposure floor, exposure debt, exploration, per-city cap 114-122, floor cap × `cfg.cities.length` 174) and fairness metrics are generic. `ASK_TEXT` (31) and the romance-prefs ask (81-83) are Network-specific. Minors carry no debt (306). |
| `engine/src/engine.ts` | **G** (pipeline) | `runEngine` stages 0-7 are a generic pipeline (45-251). Couplings: <ul><li>member funnel probe uses `category: "social", role: "peer"` (73);</li><li>`city_not_in_run` (106);</li><li>the default judge model string (60);</li><li>`involvesMinor` last-line guard (199).</li></ul> |
| `engine/src/judge.ts`, `judgeScreen.ts`, `judgeDeep.ts`, `judgeCommon.ts`, `judgeContext.ts` | **M** | The cache, concurrency, retries, parse/validate and "judge can only add risk" logic are generic (`runCachedPass`, `passCacheKey` judgeCommon 44-47). Every system prompt names The Network and its policy:<ul><li>`JUDGE_SYSTEM` (judge.ts 43), `JUDGE_SYSTEM_V3` (67);</li><li>`SCREEN_SYSTEM` (judgeScreen 21, romance rule 26);</li><li>`DEEP_SYSTEM` (judgeDeep 36) and its rubric keys (57), plus "would_thank_us";</li><li>dating guidance (judgeCommon 350), `CODE_ENFORCED_V3` (359).</li></ul> The context builders emit Network fields: `romance_opt_in`, `categories_opted_in` (judgeContext 70, 116, 321) and an "age 18+" hard-filter note (385). There is a default city of `"sf"` (158). **Prompt bytes are pinned by tests** (evals `datasetV2.test.ts`, the replay fixture). |
| `engine/src/explain.ts` | **M** | The leak-gated explanation builder and `privateVocabulary` are generic. The phrases are Network copy: `KIND_PHRASE` (12), and per-kind sentences for `network_growth`, `newcomer_welcome`, `second_encounter` (47-53). |
| `engine/src/outreach.ts` | **M** | Budget, quiet-hours and two-unanswered mechanics are generic. `CITY_TZ` is hard-coded (67). |
| `engine/src/opportunity.ts` | **G** | Explicit transition table, idempotent events, actor checks (1-40+). Supports review, quorum, alternates, scheduling and disputes: enough for the probe-first, double-opt-in and application flows if packs pick transitions. |
| `engine/src/attention.ts` | **M** | Item value, shadow price, composer, hold queue, send-time learning and availability are generic. Network policy:<ul><li>minors tier (61, 103-117, 255-262, 411-421);</li><li>`romance_not_allowed` (423);</li><li>romance always sent in its own message (511-515);</li><li>enjoyment calibrator knots per Network category (161-166), fitted on Network sim labels.</li></ul> |
| `engine/src/activities.ts` | **N** | 30 activities in 9 families; `ageMin` 18/21, `category: "social"` (31-75). The `Venue` shape (88-95) is generic but keyed by `City`. |
| `engine/src/plans.ts` | **M** | The planner (least misery, quorum, fallbacks, crews) is generic. Network policy: `PLAN_CATEGORY = "social"` and "never romance" (36); public venues only; minors never in plans; venue fit by area-name match (258, 294-301). |
| `engine/src/tick.ts` | **G** | Per-city lock and idempotent tick. `tickId` hashes the city string (43). |
| `engine/src/embed.ts`, `rng.ts` | **G** | Deterministic hashing embedding (English stopwords) and RNG. |
| `engine/experiments/*` | **N** | Harnesses import sim internals by relative path (`lib.ts` 26-34). `tracedEngine` re-implements `runEngine` from exported stages (`lib.ts` header), and `verify.ts` checks byte-identity against it. |
| `engine/src/testkit.ts` | **N** | SF/NYC neighbourhoods and city split (41, 72, 96, 187). |
| `sim/src/persona.ts` | **M** | The hidden-truth vs public-profile split is generic and the core idea of the sim. The fields are Network/dating: `Gender`, `romance` (52), `RelationshipType` incl. `ex`, archetypes (8-10), `AdversarialKind` incl. `minor` (11-12), `Trip` between cities. |
| `sim/src/taxonomy.ts` | **N** | `INTERESTS`, `SKILLS`, `DESIRES` (with category, pools, needs: 34-50+), neighbourhoods, names, private disclosures. |
| `sim/src/generator.ts` | **N** | 50/50 SF/NYC (94) and `otherCity` (88); archetype params (65-74); `DEFAULT_MINOR_SHARE = 0.05` (21); adversarial mix. RNG fork names are the seed contract. |
| `sim/src/oracle.ts` | **N** | Ground truth for Network outcomes:<ul><li>`pairEnjoyment` over desires, skills and interests (78+);</li><li>romance compatibility using gender and age range (84, 115-117, 331-334);</li><li>`GOOD_PAIR 0.55` (47);</li><li>unsafe flags `minor_included`, `romance_mismatch`, `ex_partners`, `city_mismatch` (17-18, 194-195);</li><li>category appetite (213-217).</li></ul> |
| `sim/src/snapshot.ts` | **M** | Persona → `WorldSnapshot` (134-233). `SnapshotFeatures` (16-31) includes `romancePrefs`. `publicEvents` loops over SF/NYC with local 7pm offsets (237, 246). `maxTravelMinutes` 20/35 by archetype (93). |
| `sim/src/sources.ts` | **M** | Richness tiers and connected-source simulation are generic; source kinds and inferred occupation are consumer-social. |
| `sim/src/world.ts`, `scheduler.ts`, `channel.ts`, `time.ts`, `rng.ts` | **G/M** | Event loop, channel and scheduler are generic. The engine loop is over `["sf","nyc"]` with `hash32(seed, city, now)` (483-490). |
| `sim/src/network.ts` | **G** | `NetworkUnderTest` / `Engine` interfaces. Clean seam. |
| `sim/src/stubNetwork.ts` | **N** | City loop (134), copy, default city `"sf"` (414). |
| `sim/src/agent/policy.ts` | **M** | The decision policy is generic. `classifyMessage` (19) parses **Network copy text** to classify messages; the invite reply names "The Network" (529); oracle probes by category. |
| `sim/src/scenario.ts` | **M** | The scenario DSL is generic; it defaults to `"sf"` (74, 120-122). |
| `evals/*` | **M** | Pass runners, transport, metrics and reports are generic. Datasets are Network-specific: `judgeDataset.ts` (hand-written minors/romance items, 186-213), `recDataset.ts` (romance unsafe classes, 39-48, 128-191), `historicalPrompts.ts`. Worlds use the sim by relative path (`worlds.ts`). |
| `judge/src/rules.ts` | **G** | Style and contact rules for outbound messages (opt-out language, guilt, length). |
| `judge/src/policy.ts` | **N** | Rules: `minor_connection`, `minor_romance`, `romance_without_optin` (35), plus an LLM rubric. |
| `judge/src/metrics.ts` | **M** | Run-log metrics are generic. `unsafe` counters are Network classes: minor, adversarial, cityMismatch, romanceMismatch, exPartners (23). Weekly budget default 3. |
| `capital/*` | **M** | The ledger, idempotency, append-only, anti-gaming decay and ring detection are generic. Network policy: <ul><li>categories `vouch`, `attendance`, `organizing`, `needs_answered` (types 7-9);</li><li>`PlanKind` (19);</li><li>minors exclusion at `member_joined`;</li><li>credit table and levers (`config.ts` 66-82).</li></ul> `levers.ts` imports the engine config type by relative path (5) and may only touch `judge` keys (31). Experiments are self-contained. |
| `network` (main) | **N** | `ConsentNetwork` is NYC-only:<ul><li>`cities: ["nyc"]` (network.ts 781);</li><li>NYC snapshot filter (905-929);</li><li>`city: "nyc"` (476, 602);</li><li>imports **sim taxonomy** (`desireById`, `INTERESTS`, `SKILLS`) into production code (21).</li></ul> `geo.ts` holds NYC neighbourhoods, boroughs, public venues, `km` (haversine, 99) and `travelMinutes` (110-120). Console WIP: `service.ts` keys state by network id `"nyc"` (102, 107); `db/network-state.sql` defaults `id 'nyc'`. |
| `observatory` (main) | **M** | Run inspector, projector and store are generic over `MatchingRunLog`. Types carry `City`, `romanceOptIn`, and persona desires by category (`types.ts` 50-85). `engineCapture.ts` is generic. |
| `plugin-network` (main) | **M** | Eliza plugin: participation-state routing (`SET_STATE`), date parsing, authz. The participation states (open/normal/quiet/receiving/paused) are generic attention concepts; prompts and copy are Network-specific. |

### 1.2 Hot spots asked about

1. **Hard-coded categories and taxonomy.**
   - The `Category` union is in `core/types.ts:10`.
   - Literal lane names appear in generators (68, 99, 208, 335, 445, 503, 535, 614, 634), filters (60-61, 91), scoring (143), thresholds (config 145-150), attention (161-166, 423, 511) and plans (36).
   - `OBJECTIVES` (taxonomy 27-48) and sim `DESIRES` are one shared vocabulary, pinned together by `complementarity.test.ts`.
   - `ACTIVITIES` (activities 36-75).
2. **Romance and minors.**
   - **Minors** are correctly centralized in `core/policy.ts`, then re-checked in world (94), filters (56, 80, 154, 216), the engine last line (199), attention (61, 291, 411-423), plans, capital and the judge policy. This defense in depth is a cross-app invariant and should stay in core.
   - **Romance** is scattered:
     - opt-in and compatibility: filters 61, 91-105;
     - tag parsing: world 267-277;
     - generator: generators 146-200;
     - risk bump: scoring 143;
     - prefs ask: policy 31, 81-83;
     - complementarity: 61-70;
     - prompts: screen 26, judgeCommon 350;
     - context: judgeContext 116;
     - digest rule: attention 423, 511;
     - oracle: 115-117, 331;
     - evals: recDataset;
     - judge policy.
3. **SF/NYC.**
   - The type is in `core/types.ts:3`.
   - Engine: config 128-129, outreach 67, judgeContext 158.
   - Sim: generator 88, 94; snapshot 237, 246; world 483; stubNetwork 134, 414; scenario 74, 120.
   - Tests: testkit 41-187.
   - Network: geo.ts (NYC data), network.ts 781/905.
4. **Opportunity kinds.** The `OpportunityKind` union (core 88-90) is used by the oracle, evals `ConfigSpec`, capital `PlanKind` and observatory types. Kind-specific logic: scoring 83-84, filters 149 (`group`/`newcomer_welcome` size), 178 (`help` home entry), explain 47-53, world 228 (contributor inference for `help`).
5. **Generators.** All 11 are Network strategies, registered in a fixed array (generators 669-682) and a fixed name union (config 10-15). Nothing is pluggable.
6. **Attention defaults.**
   - `DEFAULT_ATTENTION` (config 355-412) is Network-tuned. The per-state caps, the minors tier and `romanceInDigest` are policy. The kind weights and calibrator knots are fitted on Network sim labels.
   - The calibrator (attention 161-166) is **data**, not code, and must be per pack.
7. **Judge prompts.** Five system prompts plus historical versions (evals `historicalPrompts.ts`) all describe The Network. Their exact bytes feed cache keys and test fixtures.
8. **The oracle.** Entirely Network (see table). The pattern is reusable: hidden truth, `evaluate`, `probe`, primed acceptance (`PRIMED_MODEL` 45).
9. **Snapshot shape.** `WorldSnapshot` (core 111-114) plus `EngineInput` extensions (engine types 61-90) is generic enough for friends and dating. For hiring it lacks:
   - non-person entities (jobs, orgs) with capacity;
   - asymmetric roles at the data level;
   - a sealed store for protected attributes.

   Romance preferences are smuggled through facet tags (world 267-277) rather than typed fields.
10. **Member, Facet, Intent, Presence and Edge types.**
    - `Facet` and `Intent` are generic.
    - `Member` carries `age`, `homeCity: City`, `prefs.romanceOptIn` and `prefs.maxTravelMinutes`.
    - `Presence` is `{city, areas[]}` with no coordinates.
    - `Edge` types are mostly generic. `invited_by`/`vouched_for` are Network growth; `group_only`/`avoid`/`blocked` are generic.

---

## 2. Proposed interface: the `AppPack` contract

### 2.1 Principles

- **The core owns invariants. Packs own policy.** These can never be configured away, only tightened:
  - adults only for matching (`canBeMatched`, 18+);
  - blocks dominate warm ties;
  - hard filters before scoring, and the judge can only remove;
  - the leak guard on every member-facing string;
  - determinism (seeded RNG, stable ordering, no clock reads);
  - consent before reveal;
  - quiet hours.

  A pack can raise the age floor and add rules. It cannot remove core rules.
- **Packs are data plus small pure hooks.** Hooks are synchronous, pure and called in a fixed order, so runs stay deterministic and hashable. Every pack has a `version` and a `hash`, and the run log records both (omitted for `networkPack` until a deliberate re-baseline; see 3.2).
- **Types are open strings at the core, narrowed by the pack.** `LaneId`, `RoleId`, `KindId`, `MarketId`, `GeneratorId` are `string` in core. `networkPack` exports the existing literal unions, so Network code keeps its type safety.
- **"Lane"** replaces "category" in the core vocabulary (a lane is a kind of want with its own consent and threshold). `Category` stays as the Network's lane union.

### 2.2 TypeScript sketch

```ts
// ---------- identifiers (core) ----------
export type LaneId = string; export type RoleId = string; export type KindId = string;
export type MarketId = string; export type GeneratorId = string; export type EntityId = string;

export interface AppPack<L extends LaneId = LaneId, R extends RoleId = RoleId, K extends KindId = KindId> {
  id: string;                      // "network" | "slop" | "peon" | "buddies"
  version: string;                 // "network-pack-1.0.0"
  ontology: Ontology<L, R, K>;
  eligibility: EligibilityPolicy<L, R>;
  geo: GeoPolicy;
  generators: GeneratorSpec<L, R, K>[];   // ORDER IS PART OF THE CONTRACT (funnel key order, dedupe ties)
  retrieval: RetrievalPolicy;
  scoring: ScoringPolicy<L, K>;
  selection: SelectionPolicy<L, R>;
  consent: ConsentPolicy<R, K>;
  attention: AttentionPack<L>;
  judge?: JudgePack<L, K>;
  explain: ExplainPack<L, K>;
  plans?: PlansPack<L>;
  capital?: CapitalPack;
  sim: SimPack<L, R, K>;
  metrics: MetricsPack;
  /** Pack defaults. EngineConfig keeps its exact shape so configHash is unchanged for networkPack. */
  defaults: { engine: EngineConfig; attention: AttentionConfig; plans?: PlansConfig; capital?: CapitalConfig };
}

// ---------- ontology ----------
export interface Ontology<L, R, K> {
  /** Who/what can be matched. The Network: only "person". peon: person + org + job (listing). */
  entityKinds: { id: string; matchable: boolean; ownedBy?: string; capacity?: boolean }[];
  roles: { id: R; contributor?: boolean; label: string }[];            // network: seeker, provider, host...; peon: candidate, hiring_manager; slop: dater
  lanes: LaneDef<L>[];
  kinds: { id: K; format: "one_to_one" | "small_group" | "event" | "listing"; size: [number, number]; lanes: L[] }[];
  facetKinds: FacetKind[];                         // generic set from core, pack may restrict
  tags: { tag: string; label: string; cluster?: string; kind: "interest" | "skill" | "attribute" }[];
  objectives: ObjectiveDef[];                      // today: engine/taxonomy.ts OBJECTIVES (needs, pools, interests)
  edges: { positive: EdgeType[]; blocking: EdgeType[]; acquaintance: EdgeType[] };
  /** Typed per-lane preference constraints, replacing "romance:seeks:x" facet tags. */
  constraints: ConstraintDef[];
  /** Map stated wants to lanes (today: isPersonalGrowth growth->hobby). Pure. */
  normalizeIntent?(i: Intent): Intent;
}
export interface LaneDef<L> {
  id: L; label: string;
  optIn: "default_on" | "explicit" | "explicit_mutual";   // romance today: explicit_mutual
  adultOnly: true;                                        // core invariant; there is no false
  reciprocal: "harmonic" | "min" | "one_sided" | "weighted";
  threshold?: number; thresholdOverride?: number;         // today: thresholds.byCategory / categoryOverride
  socialRiskBump?: number;                                // today: romance +0.1 (scoring 143)
  shipsAlone?: boolean;                                   // today: romance not in digest (attention 511)
  requiresConstraints?: string[];                         // today: romance.requireStatedPrefs
}
export interface ConstraintDef {
  id: string;                       // "seeks_gender", "age_range", "max_distance_km", "work_auth", "salary_floor", "remote"
  lane?: LaneId; mutual: boolean;   // dating: both sides must admit each other
  evaluate(a: MemberView, b: MemberView | EntityView): boolean;   // pure
}

// ---------- eligibility & hard filters ----------
export interface EligibilityPolicy<L, R> {
  minMatchAge: number;              // >= 18, asserted at pack load
  accountTiers?: { minAge: number; matchable: false }[];   // network: 13-17 personal agent; others: none
  /** Ordered: the first failing rule names the funnel reason. networkPack order == filters.ts today. */
  memberRules: MemberRule<L, R>[];
  pairRules: PairRule<L>[];
  candidateRules: CandidateRule[];
  sendTimeRules: MemberRule<L, R>[];
  risk: { terms: string[]; patterns: string[]; homeEntry: string[] };
  /** Attributes that must never reach retrieval, embedding, scoring, judge context or explanations. */
  protectedAttributes: ProtectedAttribute[];
}
export type MemberRule<L, R> = { id: string; check(w: WorldView, id: EntityId, c: MemberCheck<L, R>): string | null };
export type PairRule<L> = { id: string; check(w: WorldView, a: EntityId, b: EntityId, lane: L): string | null };
export interface ProtectedAttribute {
  id: "age" | "sex" | "gender_identity" | "sexual_orientation" | "race" | "ethnicity" | "national_origin" | "religion"
    | "disability" | "pregnancy" | "marital_status" | "genetic" | "veteran" | "criminal_history" | "credit_history"
    | "height_weight" | "caregiver_status" | string;
  /** "sealed": stored only in the audit store; "allowed_lane": usable only in the named lane (dating gender). */
  use: "sealed" | { allowedLanes: LaneId[] };
  /** Proxy patterns scrubbed from free text before embedding/judging (e.g. graduation years, "young", pronouns for peon). */
  proxies?: RegExp[];
}

// ---------- candidate generation & retrieval ----------
export interface GeneratorSpec<L, R, K> {
  id: GeneratorId; enabled: boolean;
  run(ctx: GenCtx<L, R>): Candidate<L, R, K>[];   // may call core building blocks: retrieveForIntent, composeGroup, twoHop
}
export interface RetrievalPolicy {
  channels: ("semantic" | "tag" | "graph" | "need" | "geo" | "exposure_floor")[];
  topK: number; exposureFloorK: number; minSim: number; warmMinSim: number;
  /** peon: retrieve jobs for candidates and candidates for jobs; network: members for intents. */
  directions: { from: string; to: string }[];
}

// ---------- scoring ----------
export interface ScoringPolicy<L, K> {
  weights: Weights; floors: Floors;
  objective: "reciprocal" | "one_sided" | "two_sided_asymmetric";   // peon: candidate side weight != employer side
  sideWeights?: Record<RoleId, number>;
  pairAggregate: "harmonic" | "min" | "mean";       // network: harmonic (scoring 37)
  groupAggregate: "without_misery" | "least_misery";// network: without_misery (scoring 38-39); plans: least misery
  complementarity?: { weight: number; overlap: number; need: number; give: number };
  /** Kind/lane overrides applied at the same point and in the same order as today (byte identity). */
  componentHooks?: { novelty?(k: K, v: number): number; socialRisk?(lane: L, v: number): number };
  calibrator: { knots: [number, number][]; byLane: Partial<Record<L, [number, number][]>> };  // attention 161-166
  fairness: { exposureDebt: boolean; exposureFloorShare: number; monitor?: AdverseImpactMonitor };
}
export interface AdverseImpactMonitor {      // peon: computed OFFLINE from the sealed store; never fed back per person
  groups: ProtectedAttribute["id"][]; ratioFloor: 0.8; window: "rolling_90d"; alertOnly: true;
}

// ---------- selection ----------
export interface SelectionPolicy<L, R> {
  budgets: Record<string /* participation state */, { limit: number; periodDays: number }>;
  contribution?: { limit: number; periodDays: number };
  perMarketCap: number; maxPerIntent: number;
  /** Capacity of anchors (event capacity, job openings x pipeline multiple, venue capacity). */
  anchorCapacity?(anchorId: string): number;
  exploration: { rate: number; maxShare: number };
  /** peon: one employer may receive many candidates per job, a candidate few jobs per week. */
  perRoleBudgets?: Partial<Record<R, { limit: number; periodDays: number }>>;
}

// ---------- consent ----------
export type ConsentFlow =
  | { kind: "probe_first"; order: "wanter_first" | "parallel"; reveal: "confirm" | "opt_out"; anonymousProbe: true }   // network (attention consent)
  | { kind: "double_opt_in"; blind: boolean; revealOn: "mutual_yes"; expiresHours: number }                          // slop
  | { kind: "application"; initiator: RoleId; reviewer: RoleId; blindReview: ProtectedAttribute["id"][]; stages: string[] } // peon
  | { kind: "group_rsvp"; quorum: number; lateJoinHours: number };                                                    // buddies / plans
export interface ConsentPolicy<R, K> { byKind: Partial<Record<K, ConsentFlow>>; default: ConsentFlow; transitions: TransitionRule[] }

// ---------- outreach & attention ----------
export interface AttentionPack<L> {
  config: AttentionConfig;          // caps, lambda, kinds, quiet hours, send time ... (minors tier only if accountTiers exist)
  itemKinds: { id: ItemKind | string; weight: number; effort: Effort; countsAgainstCap: boolean; memberInvolving: boolean }[];
  lanePolicy: Partial<Record<L, { shipsAlone?: boolean; inDigestDefault?: boolean }>>;
  copy: CopyPack;                   // probes, reveals, asks, re-engagement, declines; every string goes through LeakGuard
  channel: { kind: "imessage" | "sms" | "email" | "push" | "web"; maxOutstanding: number };
}

// ---------- judge ----------
export interface JudgePass<V> {
  version: string; system: string;                       // verbatim prompt bytes (cache keys depend on them)
  buildContext(w: WorldView, c: Candidate): unknown;     // must not include protectedAttributes (conformance-tested)
  parse(raw: unknown): V; decide(v: V): "yes" | "no" | "insufficient";
}
export interface JudgePack<L, K> {
  screen?: JudgePass<unknown>; rubric: JudgePass<JudgeVerdict>; deep?: JudgePass<unknown>;
  rubricKeys: string[]; hardGate(w: WorldView, c: Candidate): string | null;
}

// ---------- explanations ----------
export interface ExplainPack<L, K> {
  laneLabel: Record<L, string>;                    // generators.ts CATEGORY_LABEL
  facetPhrase: Partial<Record<FacetKind, string>>; // explain.ts KIND_PHRASE
  kindSentence?(k: K, role: RoleId): string | undefined;   // explain.ts 47-53
  objective(c: Candidate): string;                 // "Intro: climbing" etc.
}

// ---------- plans / capital ----------
export interface PlansPack<L> { config: PlansConfig; lane: L; activities: ActivityType[]; venues: VenueSource; allowPairs: boolean }
export interface CapitalPack { config: CapitalConfig; earn: string[]; lose: string[]; mapEvent(e: DomainEvent): CapitalEvent[]; overlayKeys: readonly string[] }

// ---------- geo ----------
export interface GeoPolicy {
  model: "city" | "radius" | "multi_market";
  markets: { id: MarketId; tz: string; bounds?: GeoJSONPolygon; centroid?: LatLng }[];
  resolve(p: PresenceInput): Location[];                 // zip/area/point -> coarse cells
  coLocated(a: Location[], b: Location[], prefs: { a: GeoPrefs; b: GeoPrefs }): GeoMatch | null;  // hard filter
  travelMinutes?(a: Location, b: Location, mode: TravelMode): number;      // scoring + venue choice
  displayDistance(km: number): string;                   // bucketed, never exact
}

// ---------- simulation ----------
export interface SimPack<L, R, K> {
  personas: { generate(opts: { n: number; seed: number | string; markets?: Record<MarketId, number> }): Persona[] };
  snapshot(personas: Persona[], s: SnapshotState): WorldSnapshot;      // public side only
  oracle(personas: Persona[], seed: number | string, start: number): OracleLike;   // evaluate, probe, evaluatePrimed
  agent: { classify(body: string, meta?: SimMeta): MessageType; voice: VoicePack };  // must not parse free copy if meta exists
  scenarios: Scenario[];
  adversarial: { kinds: string[]; rate: number };
}

// ---------- metrics & gates ----------
export interface MetricsPack {
  primary: string[];                                    // "met_worthwhile_per_100", "mutual_like_rate", "interview_rate"...
  gates: { metric: string; op: ">=" | "<=" | "=="; value: number; seeds: number; ci?: number; blocking: boolean }[];
  unsafeClasses: string[];                              // network: minor, adversarial, cityMismatch, romanceMismatch, exPartners
}
```

### 2.3 How the four packs fill the contract

| Slot | networkPack (ntwrk.club) | slopPack (slop.date) | peonPack (peon.biz) | buddiesPack (buddies.nyc) |
|---|---|---|---|---|
| Entities and roles | person; seeker/provider/peer/helper/host/guest/newcomer/connector/attendee | person; dater | person (candidate, hiring manager), org, **job** (listing with openings) | person; friend/host/newcomer |
| Lanes | social, professional, romance, hobby, help, events, growth | dating (explicit, mutual); optional "date plan" | full_time, part_time, contract, internship | friends, activity partner, group, events |
| Age | match 18+; 13-17 personal-agent tier | 18+ only, no minor tier; verified age | 18+ floor in v1; age **sealed** (ADEA): store an "is 18+" attestation, not a number | 18+ only (decision: the 13-17 tier is not offered) |
| Protected attributes | sensitive facets agent_private (core) | gender and orientation **allowed in the dating lane only**; race/religion/etc. sealed; no ethnicity filters | all EEO classes **sealed**; proxy scrubbing (grad years, names in judge context, photos); blind first review | sealed except stated preferences such as "women's running group" (decision) |
| Geo | city buckets SF/NYC, area names; NYC venues | radius from zip or point, mutual radii, multi-city | commute time and remote/hybrid; market = metro; work authorization | NYC neighbourhoods, transit minutes, venues (reuse network geo.ts) |
| Generators | 11 today, in order | mutual-pref pairs (`romanceIntros` generalized), shared-interest, event co-attend, exploration across clusters | candidate→jobs, job→candidates (two directions), referral warm path (`warm_path`), re-surface (`second_encounter` analogue) | complementary intents, interest pools, group composer, newcomer welcome, plans |
| Scoring | harmonic pair, without-misery groups, judge blend | reciprocal harmonic + strong exposure debt (popularity skew) + distance cost | two-sided asymmetric (employer must-haves as floors; candidate prefs as fit); no novelty bonus; capacity per job | without-misery groups; familiarity bonus (plans) |
| Consent | probe-first, wanter first, booked-plan reveal with opt-out | double opt-in, blind; reveal on mutual yes | application: the candidate opts in (applies or accepts a "you'd fit X" probe), the employer reviews a blind profile, then a reveal and interview scheduling | probe-first; group RSVP with quorum |
| Attention | caps 2/7d Normal, romance ships alone, minors tier | caps per state; dating items alone; evening send hour | candidates: digest; employers: dashboard/email with an SLA, not interruption caps | same as network, NYC tz |
| Judge | judge-v3 prompt (pass 2), passes 1/3 off | dating rubric (mutual stated prefs, values, dealbreakers, safety) | job-fit rubric on **scrubbed** context; must cite job requirements; no culture-fit vibes | friendship rubric (energy, availability, shared activity) |
| Plans | public venues, groups 3-6 + partner, crews | optional first-date plans at public venues (D15 says plans are never romance, a Network rule; slop decides) | interviews (scheduling only), no plans | central: plans and crews |
| Capital | NC ledger (vouch, attendance, help, organizing...) | reliability only (no-show, ghosting); no vouch economy initially | employer reputation (response SLA, ghosting candidates); candidate no-show for interviews | network ledger minus professional parts |
| Sim | 150 personas SF/NYC, Network oracle | dater personas with a desirability skew, asymmetric attraction, dealbreakers, distance tolerance; oracle = mutual like × chemistry × show-up | candidates (skills, seniority, comp, location), employers/jobs (must-haves, nice-to-haves, openings, response latency); oracle = interview pass × offer × accept; sealed protected attributes for bias tests | NYC-only personas from the Network generator (cityWeights nyc=1), friend oracle |
| Gates | met+worthwhile, precision, unsafe=0, leaks=0, caps | mutual-match rate, date-happened rate, safety reports, Gini of likes received, distance honoured 100% | time to first interview, interview→offer, employer response SLA, adverse impact ratio ≥ 0.8 monitored, protected-attribute invariance 100% | groups formed, repeat meetups (crews), worthwhile, zero-exposure share |

Hiring notes (not legal advice; confirm with counsel before launch):
- **NYC Local Law 144** applies to automated employment decision tools used for NYC candidates. It requires a bias audit with published impact ratios by sex and race/ethnicity, plus notice to candidates.
- **NYC Fair Chance Act and credit-history rules:** no criminal-history or credit-history checks before the right stage.
- **Federal law:** Title VII, ADEA and ADA.

This is why `protectedAttributes.use = "sealed"` exists: the audit needs the data, and the matcher must never see it.

---

## 3. Refactor plan

### 3.1 Order of operations

Every phase ends with the golden suite green: identical bytes for the network pack (3.3). Phases 1-6 are pure moves.

| Phase | Work | Effort |
|---|---|---|
| **P0. Freeze and capture goldens** | <ul><li>Commit or stash the WIP in both worktrees and pick the baseline commit. `06f860e` is the only commit with engine-v1.2 + attention-v1.2 + plans-v1.1 + judge-v3 default + capital together. Merge `main`'s `plugin-network` and Blooio work first, then baseline.</li><li>Add `goldens/capture.ts`, which writes canonical JSON (stable stringify, `timingsMs` and wall times removed) plus a sha256 per artifact (list below the table).</li><li>Add `test/golden.test.ts`: a fast tier on every commit and a full tier nightly.</li></ul> | M |
| **P1. Open the types** | <ul><li>Add `LaneId`, `MarketId`, `RoleId`, `KindId` = `string` to core.</li><li>Keep `City`, `Category`, `OpportunityKind` and `Role` as the Network's narrowed unions, exported from `networkPack`.</li><li>Make engine internals generic (`Record<string, …>`), types only.</li></ul> | M |
| **P2. `networkPack` as a facade** | <ul><li>Create `packages/packs/network`, which re-exports the existing constants: `DEFAULT_CONFIG`, `DEFAULT_ATTENTION`, `DEFAULT_PLANS`, `DEFAULT_CAPITAL`, `OBJECTIVES`, `ACTIVITIES`, `CITY_TZ`, `GENERATORS`, the prompts, the calibrator knots, `CATEGORY_LABEL`, `KIND_PHRASE`, `ASK_TEXT`.</li><li>No call sites change.</li></ul> | S |
| **P3. Thread the pack through the engine, one module per commit** | <ol><li>`World(input, cfg, embed, pack = networkPack)`: constraints parsing (romance tags → `ConstraintDef`), `normalizeIntent`, `isHost`, edge sets.</li><li>`taxonomy`/`complementarity` → `pack.ontology.objectives`.</li><li>`filters` → `pack.eligibility` rule arrays in **today's exact order**.</li><li>`generators` → `pack.generators`; `GENERATOR_NAMES` stays in `EngineConfig`, so `configHash` is unchanged.</li><li>`scoring` lane and kind hooks at the same arithmetic position.</li><li>`policy` ask texts.</li><li>`explain` labels.</li><li>`judge*` prompts and context builders moved verbatim.</li><li>`outreach` and `tick` time zones from `pack.geo.markets`.</li></ol> | L |
| **P4. Geo seam** | <ul><li>`pack.geo` implements `location/overlap/canMeet`.</li><li>`CityGeo` reproduces `world.ts` 324-387 exactly; the area-name activation cost (scoring 97-103) and the plans venue fit move behind `geo`.</li><li>Radius geo arrives as a second implementation (section 4).</li></ul> | M |
| **P5. Sim behind `SimPack`** | <ul><li>Persona generator, snapshot builder, oracle, agent classifier and scenarios.</li><li>`world.ts` 483 and `stubNetwork.ts` 134 loop over `pack.geo.markets` **in the same order with the same strings** (seed = `hash32(seed, city, now)`).</li><li>Keep RNG fork names.</li><li>Move `taxonomy.ts` into the network pack; the `complementarity.test.ts` pin moves with it.</li></ul> | L |
| **P6. Attention, plans, capital, judge, evals** | <ul><li>Minors tier → `eligibility.accountTiers`.</li><li>`romanceInDigest` / ships-alone → `LaneDef.shipsAlone`, keeping the `AttentionConfig` field so `attentionConfigHash` is unchanged.</li><li>Calibrator → pack.</li><li>Activities and venues → `PlansPack`.</li><li>Capital categories → `CapitalPack`.</li><li>`judge/policy.ts` rules → pack.</li><li>Eval datasets → `packs/network/evals`.</li></ul> | M |
| **P7. Apps** | <ul><li>`packages/network` stops importing sim taxonomy (network.ts 21) and reads `pack.ontology`.</li><li>Its `geo.ts` becomes the NYC data of `networkPack.geo` (also used by buddies).</li><li>Observatory types use `LaneId`/`MarketId`.</li><li>Console DB: `network_state.id` → `(app_id, market_id)`.</li></ul> | M |
| **P8. Second pack: buddies.nyc** | <ul><li>Closest to the Network (NYC, friends, plans, no romance).</li><li>It proves the boundary with almost no new mechanics: lanes subset, no romance, `cityWeights {nyc:1}`, NYC geo.</li><li>The conformance suite (3.4) goes green.</li></ul> | M |
| **P9. slop.date** | <ul><li>Radius geo (section 4).</li><li>Double-opt-in consent flow (transition subset).</li><li>Dater personas and oracle with desirability skew.</li><li>Dating judge prompt, exposure-fairness gates.</li></ul> | L |
| **P10. peon.biz** | <ul><li>New entity kinds (org, job with capacity).</li><li>Two-direction retrieval.</li><li>Asymmetric scoring, application consent.</li><li>Sealed protected-attribute store, proxy scrubbing, invariance tests, adverse-impact monitor.</li><li>Employer-side attention, hiring sim and oracle.</li></ul> | L (largest) |
| **P11. Rename** | `@thenetwork/*` → neutral names (for example `@matchkit/core`, `@matchkit/engine`, `@matchkit/sim`, `@matchkit/geo`, `@matchkit/capital`, `@matchkit/evals`; packs under `@matchkit/pack-*`). Last, mechanical, one commit. | S |

**What P0 captures:**

| Line of work | Artifacts |
|---|---|
| Engine | `runEngine` on the synthetic snapshot (`scripts/synthetic/load.ts`) with seeds 1-3: proposals, asks and the run log. `experiments/verify.ts` output. `experiments/v12.ts --sim-only` per-seed metrics (seeds 1-8). |
| Attention | `experiments/attention.ts --json` (variants R/A/HQ and the v1.2 default). |
| Plans | `experiments/plans.ts --json` (30 days, seeds 1-8; plus the 60-day `P`/`P-crew1` rows). |
| Judge | `evals/test/judgeReplay.test.ts` and `datasetV2.test.ts` are already goldens (recorded replies and prompt-byte cache keys). Add a snapshot of every `*_PROMPT_VERSION` and `sha256(system)`. |
| Capital | `capital/experiments/run.ts` JSON (8 seeds, 90 days). |
| Network | `docs/results/network/*.json` regenerated from the clean baseline. They are modified in the working tree today, so they are not trustworthy as goldens until regenerated. |

### 3.2 Byte-identity rules for `networkPack`

1. **`EngineConfig`, `AttentionConfig`, `PlansConfig` and `CapitalConfig` keep their exact shapes and defaults.**
   - Pack identity is passed beside the config (`deps.pack` / the `World` constructor), never inside it.
   - Otherwise `configHash` (config 457) changes, then `runId` (engine 57) changes, and every run log differs.
2. **Additive run-log fields are omitted when the pack is `network`**, using the `...(x ? {x} : {})` pattern already used at engine 229. Adding `packId`/`packHash` for the Network is a separate, explicit re-baseline commit, if wanted.
3. **Rules and generators keep today's order.** The funnel counts the *first* failing reason, and `byGenerator`/`rejectedBy` serialize in insertion order.
4. **Floating-point operations keep their order.** For example, the romance `+0.1` must still be added after the safety-class bump (scoring 142-143), not folded into a pre-summed lane constant.
5. **Prompts move as string constants, not templates.** Their bytes feed `passCacheKey` (judgeCommon 44-47) and `datasetV2.test.ts`.
6. **Market ids stay `"sf"`/`"nyc"`.** They are inside seeds (sim world 486), tick ids (tick 43) and proposal keys through the participants and anchors.
7. **`Object.entries` iteration order of pack records must equal today's literals** (sim `cityW` 94, archetype mix, `CATEGORY_LABEL`). The pack builds them with the same key order.

### 3.3 Risky seams

- **R1. Dirty trees.**
  - The sim WIP (`world.ts`, `agent/policy.ts`, `channel.ts`, `stubNetwork.ts`) and the network/observatory WIP are uncommitted in two worktrees.
  - The plans, attention and network results depend on sim behaviour.
  - Baseline after the WIP lands, or the goldens will churn.
- **R2. `tracedEngine` duplicates `runEngine`** (`experiments/lib.ts`). Every pipeline change must land in both, or the experiments silently diverge.
  - Better: make `runEngine` accept stage hooks (`rescore`, `levers`, `postSelect`), and have `tracedEngine` call it.
  - `verify.ts` becomes a test.
- **R3. Hidden coupling through text.**
  - The sim agent classifies Network messages by parsing copy (`classifyMessage`, agent/policy 19). Changing copy per pack changes persona replies.
  - Packs must attach `SimMeta.type` to every outbound message, so classification never depends on wording.
- **R4. Romance in facet tags.**
  - The `romance:*` tags are parsed in world (267-277) and read by filters, complementarity and the generator.
  - Moving them to typed constraints must produce identical `RomanceProfile` values, including the defaults `ageMin 18`/`ageMax 120` and the `split("-").map(Number)` quirks.
- **R5. Shared taxonomy across engine and sim.** `OBJECTIVES` and `DESIRES` are pinned by a test. Both must move into the same pack together.
- **R6. Production code imports the sim.** `packages/network/src/network.ts:21` imports `desireById`, `INTERESTS` and `SKILLS` from `@thenetwork/sim`. Break this before the sim moves.
- **R7. Relative cross-package imports.** These bypass package boundaries (evals → sim/engine/core; capital → engine/core; engine experiments → sim/judge). A move breaks them at runtime, not only at type-check. Add a lint rule (no `../../*/src`) in P1.
- **R8. `configHash`, `attentionConfigHash`, `plansConfigHash`.** Any new default or field changes a hash. See 3.2 rule 1.
- **R9. Minors in five layers.** world, filters, engine last line, attention and plans each enforce the same rule. Do not "simplify" them into one pack hook: keep the core invariant in every layer and let packs only add tiers.
- **R10. The 13-17 personal-agent tier.**
  - It exists only for the Network.
  - Attention's minors branch (`isMinor` → the minors cap and `MINOR_SAFE`) must be dead code for packs without `accountTiers`.
  - Conformance must prove that a pack without the tier never stores a member under 18.
- **R11. City-keyed records.** `Record<City, …>` in config `timezones`, `CITY_TZ` and `perCity` caps (policy 114). Generalizing to `MarketId` keys must keep `maxProposalsPerCity × cities.length` (policy 174) identical.
- **R12. Judge model default and cache TTL.** These are environment-dependent (`engine.ts:60` reads env vars). The goldens must pin the env (the plans results already run with empty keys).

---

## 4. Geo

### 4.1 What exists

- **Engine: city buckets only.**
  - `Presence {city, type, areas[], from, to}` (core 45-49). `World.location/overlap` (324-387) intersect availability per city string.
  - Areas are free-text neighbourhood names, used for the activation cost (scoring 97-103) and plan venue fit (plans 258, 294-301).
  - `Preferences.maxTravelMinutes` exists but is only a +0.15 activation cost when under 20 minutes (scoring 103); it is never a filter.
  - Trips are `temporary` presence in another city.
- **Network (main): NYC geo.** `packages/network/src/geo.ts` has:
  - 43 neighbourhood centroids with boroughs, and real public venues with lat/lng and tags;
  - `km()` haversine (99-103);
  - `travelMinutes()`, a transit heuristic: walking under 1.2 km, else 8 + 3.2 min/km plus borough penalties (110-120);
  - `meetingSpot()`, which minimizes the worst participant trip (130-142).

  Members are located only by area name (`neighborhood()` falls back to Midtown).
- **PoC: travel time** (`thenetwork-poc/prototypes/poc-travel-time`, branch `poc/validation` @ `4437bb7`; summary in `docs/results/SUMMARY.md`).
  - It stores members at **H3 res-8 cells** (SEC-004 precision) and fits `minutes = overhead + km × min/km` per city and mode against OSRM.
  - Within 25% of a router: walk 95-100%, bike 85-95%, car 60% (SF) / 95% (NYC).
  - Transit was not validated.
  - Its recommendation: use the heuristic for retrieval and filters, and call a maps API only for finalists.

### 4.2 What radius and zip matching (slop.date) needs

1. **Location model.** `Location {cell: H3 res-8, market: MarketId, tz, source: "zip" | "area" | "device" | "venue", precisionKm}`.
   - Keep `Presence` but add `cells?: string[]`.
   - `city` becomes `market` (open string). Multi-city is several `home` presences, which the engine already models (world 328-334).
2. **Geocoding.**
   - **Zip.** Use the Census ZCTA Gazetteer centroids, which are offline and public domain, and snap to an H3 cell (res-8, or res-7 for very large ZCTAs).
   - **Free text and venue addresses.** Use a geocoder only at onboarding (Mapbox, Google or Nominatim), cache the result, store the cell, and **discard the raw address and coordinates**.
   - Non-US markets need a postal-code dataset per country.
3. **Distance.**
   - **Hard filter:** haversine between cell centroids, symmetric and cheap. Dating needs **mutual radius**: `d ≤ min(rA, rB)`.
   - **Retrieval channel:** H3 `gridDisk(cell, k)` with k from the radius (res-8 edge ≈ 0.46 km). This prunes the pool before semantic ranking, as `canMeet` does today for cities.
   - **Scoring:** travel minutes from the per-market fitted heuristic (PoC) by the member's mode. Use transit for NYC (fit `travelMinutes` from network geo.ts against a transit router before relying on it), car or transit for SF and suburbs.
   - **Venue choice for finalists:** a maps API call, cached.
   - Make `maxTravelMinutes` a real per-lane filter (an opt-in `ConstraintDef`) instead of a soft cost.
4. **Privacy of exact location.**
   - Store cells, not points.
   - Never compute or show exact distance: show buckets ("under 2 mi", "2-5 mi", "5-10 mi", "10+ mi"), with the bucket computed from **centroids of snapped cells**, so repeated queries cannot be averaged (unlike random jitter).
   - Enforce a minimum displayed bucket, to block the classic dating-app trilateration attack that shifts a fake location and watches distance changes.
   - Rate-limit location changes.
   - Never put cells or zips in URLs or member-facing text; the core `LeakGuard` already blocks addresses.
   - Distance is opportunity-specific data: it goes to the judge as a bucket, never as coordinates.
   - Travel-time minutes shown to members are approximate ranges.
5. **Markets for operations.** Ticks lock per market (tick 43), and per-market caps and time zones are kept. A radius app still needs markets (a metro or a tz shard) for locking and caps. Matching across a market border is allowed if the radius admits it: overlap is computed on cells, not market ids.

**buddies.nyc** reuses the NYC data in `network/geo.ts` as `networkPack.geo`'s NYC market. **peon.biz** needs commute time (transit or car) plus `remote/hybrid` constraints and a work-location market. There is no member-to-member co-location.

---

## 5. Effort and test strategy

### 5.1 Estimates

| Item | Size | Notes |
|---|---|---|
| P0 goldens + clean baseline | M | Mostly scripting existing `--json` outputs; the full tier is minutes of CPU per run. |
| P1 open types + import lint | M | Wide but shallow. |
| P2 networkPack facade | S | |
| P3 engine threading | L | About 10 modules, golden after each. |
| P4 geo seam (CityGeo) | M | |
| P5 SimPack | L | RNG and seed contracts are the risk. |
| P6 attention/plans/capital/judge/evals | M | |
| P7 apps (network, observatory, console DB) | M | Depends on the console WIP landing. |
| buddiesPack | M | First real proof of the boundary. |
| slopPack + radius geo | L | Geo M, consent flow S, sim/oracle M, judge prompt + eval set M. |
| peonPack | L+ | Entities and capacity M, sealed protected-attribute store and scrubbing M, application flow M, hiring sim/oracle L, compliance gates M. |
| P11 rename | S | |

### 5.2 Tests

- **Golden replays (byte identity for `networkPack`).**
  - **Fast tier, every commit (target under 60 s):**
    - synthetic-snapshot `runEngine` for seeds 1-3 (proposals + run log minus timings, sha256);
    - `verify.ts` assertions;
    - judge replay + prompt-key tests;
    - one short sim (seed 1, 7 days) for engine, attention and plans;
    - one capital seed.
  - **Full tier, nightly:** the published tables (engine-v1.2 8 seeds; attention v1.2; plans v1.1 30 and 60 days; capital 8 seeds; network arms) compared to stored canonical JSON.
  - **Diffing:** a mismatch prints the first differing path, not just a hash.
- **Per-pack conformance suite** (`packs/<id>/conformance.test.ts`, generated from one shared spec in core). Every pack must pass:
  1. **Age.** No member under `max(18, pack.minMatchAge)` appears in any proposal, alternate, `via`, plan, group, attention item with others, or capital credit. Unknown age fails closed. Without account tiers, nobody under 18 is stored.
  2. **Blocks and holds.** A blocked pair, a safety hold or a paused member never appears in a proposal (the existing property tests, parametrized by pack).
  3. **Consent.** No reveal of another member's identity before the pack's consent flow allows it (state-machine walk with random event orders).
  4. **Leaks.** Every member-facing string (explanations, probes, reveals, asks, judge `why`) passes `LeakGuard` with canaries planted in agent-private facets.
  5. **Protected-attribute invariance.** For each sealed attribute, counterfactual worlds that differ only in that attribute (and its proxies) produce byte-identical proposals, scores and judge contexts. This is mandatory for peon and covers the dating-lane exceptions for slop.
  6. **Determinism.** Same snapshot, config, seed and pack give the same bytes, and shuffled input order gives the same output.
  7. **Judge cannot undo filters.** A mocked "always yes" LLM never adds a candidate that failed a hard filter.
  8. **Attention.** Caps, quiet hours, one-question rule, ships-alone lanes.
  9. **Geo.** The radius is honoured mutually, displayed distances are bucketed, and no coordinates appear in outputs.
  10. **Registration.** Generator ids, rule ids and filter reasons are unique, and prompt versions change whenever prompt bytes change (hash check).
- **Per-pack simulation gates.** Each pack ships a `SimPack` and `metrics.gates`. CI runs N seeds and fails on blocking gates:
  - engine beats a random baseline on oracle precision;
  - unsafe = 0, leaks = 0;
  - the pack-specific gates in 2.3.

  The oracle is harness-only and must never be importable from engine code; add a lint rule for this.

---

## 6. Open decisions for the founder

1. **Minor accounts outside The Network.** Should buddies.nyc or peon.biz ever allow under-18 accounts? Proposal: no. The core floor stays 18 for matching everywhere.
2. **Romance plans.** slop.date first-date plans at public venues would reverse D15 for that pack only. Allow them?
3. **peon.biz scope for v1.** Proposal: candidate-side opt-in first, employer review second, and no automated rejection, so the system recommends and a human decides. This simplifies NYC LL144 exposure but does not remove it; counsel review is needed.
4. **Shared identity across apps.** Is one person one member across all four apps, with separate lanes and opt-ins, or are the apps fully separate tenants? Proposal: separate tenants first (`app_id` on every row), then optional linking.
5. **Package naming** for the extracted core (P11).

---

## 7. Summary (20 lines)

1. Today the engine is a generic pipeline (retrieve → hard filters → score → judge → select → explain) with Network policy hard-coded throughout.
2. Generic and reusable as-is: core guard, LLM, chatJson; engine retrieval, group, opportunity, tick, embed, rng; the judge pass runner; the capital ledger mechanics; the sim runner and channel.
3. Mixed: core types (City `sf|nyc`, Category with romance, `Member.age`, `prefs.romanceOptIn`), world, filters, scoring, policy, attention, plans, judge context, observatory.
4. Network-only: taxonomy, generators, activities, sim taxonomy, persona and oracle, judge prompts, `judge/policy.ts` rules, `packages/network` (NYC-only, and it imports sim taxonomy into production).
5. Romance is spread over 12+ places (filters 61/91, world tag parsing 267, generators 146, scoring 143, prompts, attention 423/511, oracle, evals); minors are centralized in core and re-checked in 5 layers. Keep that.
6. Proposed: an `AppPack` contract with ontology (entities, roles, lanes, kinds, typed constraints), eligibility, geo, ordered generators, retrieval, scoring, selection, consent flow, attention, judge passes, explain templates, plans, capital, `SimPack` and metric gates.
7. Core invariants stay in core and cannot be loosened by a pack: matching 18+ only, blocks win, filters before the judge, LeakGuard on every member-facing string, determinism, consent before reveal.
8. Packs: network (today's behaviour), buddies.nyc (a subset; it proves the boundary), slop.date (mutual radius geo, double opt-in, exposure fairness), peon.biz (job entities with capacity, two-way retrieval, application consent, sealed protected attributes).
9. The refactor starts by freezing a clean baseline. The tree is dirty in two worktrees, and capital/plans/judge-v3 exist only on `docs/matching-research-compendium`.
10. Then capture goldens: engine, attention, plans, capital and network JSON, plus the existing judge replay and prompt-key tests.
11. Byte-identity rules: config shapes and hashes unchanged, pack identity outside the config, no new run-log fields for network, rule and generator order kept, float operation order kept, prompts verbatim, market ids `sf`/`nyc`.
12. Riskiest seams: `tracedEngine` duplicating `runEngine`, sim persona replies parsing Network copy text, romance prefs stored in facet tags, relative cross-package imports, and the `cityW` and seed strings.
13. Order: open types → facade pack → thread the pack through the engine module by module → geo seam → SimPack → attention/plans/capital/judge → apps → buddies → slop → peon → rename.
14. Geo today: city buckets plus area names in the engine; NYC centroids, venues, haversine and a transit heuristic in `network/geo.ts`; the H3 res-8 travel-time PoC (walk and bike good, SF car weak, transit unvalidated).
15. Radius and zip need: ZCTA centroid geocoding to H3 cells, a mutual-radius haversine filter, gridDisk retrieval, fitted travel minutes for scoring, and maps API calls only for finalists.
16. Location privacy: store cells only, show bucketed distances from snapped centroids (anti-trilateration), and never put coordinates or zips in text, URLs or judge context.
17. Hiring needs a sealed protected-attribute store, used only for adverse-impact audits (NYC LL144), proxy scrubbing, and counterfactual invariance tests. Counsel review is required.
18. Effort: P0-P2 S/M; engine threading L; SimPack L; buddies M; slop L; peon L+ (the largest).
19. Tests: a fast golden tier on every commit, a full golden tier nightly, and a per-pack conformance suite (age, blocks, consent, leaks, protected-attribute invariance, determinism, judge-can't-undo, attention, geo).
20. Each pack also ships its own sim personas, oracle and blocking launch gates, run over N seeds in CI.
