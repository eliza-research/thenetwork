# Synthetic members: SF + NYC (v1, generator 1.2.1)

> **Disclaimer: every record here is SYNTHETIC.** These are invented people with invented names, made for development, demos, the simulator and the admin console. None of them is a real person, member or employee of a real company. Given names are common names drawn from many cultures. Surnames are invented by joining morphemes from unrelated traditions (for example "Hokuthorne" or "Vasalund"), so any resemblance to a real person is coincidental. Phone numbers use only the fictional `555-01xx` range, and emails use `example.com`. Workplaces are generic descriptions such as "a 45-person fintech company in Flatiron", never named employers. The PRD forbids profiles of non-members, so do not add real people or scrape real profiles into this directory.

Every record has a top-level `"synthetic": true`, and so does `manifest.json`.

## Files (`data/synthetic/v1/`)

| File | Records | What it holds |
|---|---|---|
| `members.jsonl` | 500 | Core `Member` (packages/core), including `connectedSources` (1.2.0), plus `segment` (`adult`/`minor`) and `profile`. The `profile` holds pronouns, neighborhood, borough, a fictional `contact`, `enrichment` (`llm`/`template`) and `secondaryCity`. Since 1.2.0 it also holds `chatMessages`, a `bio` with `bioSource` (`member` for the rich tiers, otherwise a `summary` of known facets), texting `voice` with 0-3 samples, and `occupation`, `routine` and `availability` **only if the member told the agent** |
| `facets.jsonl` | 5,224 | Core `Facet` with `source`, `observedAt`, `inferred`, `confirmedByMember` and, on sensitive inferences, `sensitive`. It holds **only known facts**: what the member said in chat (3,723) plus facets from their active connected sources (1,501) |
| `intents.jsonl` | 659 | Core `Intent`, only the ones the member told the agent. Minimal-tier members have one vague category-level want, and light-tier members the objective only. From the medium tier up, intents carry an LLM-written `details` sentence followed by `(format; tags)`, plus `desiredPeople`. Since 1.2.1, `createdAt` is when the want was stated or last re-confirmed, and `status` can be `closed` (withdrawn after the want lapsed) |
| `presence.jsonl` | 549 | Core `Presence`: 500 home, 24 routine (bi-coastal members), 25 temporary (trips already announced at snapshot time) |
| `edges.jsonl` | 2,092 | Core `Edge` plus `relation`: `invited_by` 490, `vouched_for` 334, `knows` 1,253 (949 friend, 297 coworker, 7 roommate), `blocked` 15 |
| `hidden_truth.jsonl` | 500 | **Ground truth. Never load this into the engine or show it in a product surface.** It holds the sim `HiddenTruth` (true age, real interests and desires, honesty, flakiness, responsiveness, private disclosure plus canary, trips, adversarial kind, `richness` tier), `knowledge` (tier, chat coverage, every source entry, and a `correct`/`stale`/`wrong_inference` label for each source-derived facet), `personaTexture` (the full LLM prose whether or not it is known), archetype, gender, community, workplace, relationships (including exes, which are never disclosed), adversarial notes with scripted messages, and the public persona |
| `manifest.json` | | Seed, snapshot time, generator version, sim-generator source hash, model, counts, LLM usage and cost, file hashes |
| `validation.json` | | Output of `validate.ts` |
| `engine_v1_run.json` | | Output of `load.ts --engine` (generator 1.2.1 data, engine v1.1.0). It includes `byRichness`, stratified by the hidden tier, and `oracle`: whole-run precision, pair recall and adults without a live intent. Both are harness-only reads of hidden truth |

Every timestamp is relative to the snapshot time `now = 2026-10-12T17:00Z` (Mon 10:00 PDT / 13:00 EDT). Member ids are `sf-0001..sf-0250` and `ny-0001..ny-0250`. Facet ids are `<member>:fNN` and intent ids are `<member>:iN`.

### Privacy scopes
- **Minors:** all of their facets are `agent_private`.
- **Adults:**
  - Interests are about 60% `shareable` and 40% `matchable`.
  - Skills and occupation are `matchable`.
  - Offers, neighborhood and availability are `shareable`.
  - Boundaries, romance preferences (`romance:is|seeks|age` tags), dealbreakers and private disclosures are `agent_private`.
- **Private disclosures:** each one carries a unique canary (`(ref XX-1234-WORD)`), exactly as the simulator does, so leak checks are exact. Since 1.2.0 a disclosure is a facet only if the member told the agent (71 of 133). The others stay in hidden truth only.
- **Source-derived facets (1.2.0):**
  - Sensitive inferences (health, finances, religion, sexuality, relationship, children; all from Gmail) are always `agent_private`.
  - A confirmed interest, availability or offer is `shareable`.
  - Everything else is `matchable`.
  - An unconfirmed inference is never `shareable`, and since 1.2.0 that includes chat-inferred interests.
  - For minors, only Calendar, Spotify and GitHub are allowed, and every facet is `agent_private`. See `docs/data-model-sources.md`.

### Population design
- **Cities and ages:** 250 SF and 250 NYC. The NYC members cover all five boroughs. The data uses 34 real SF neighborhoods and 41 real NYC neighborhoods.
  - Adult ages: 18-24: 69, 25-34: 174, 35-44: 121, 45-54: 61, 55+: 25 (median 33).
- **Minors (10%, 50 members, ages 13-17):** they are honest about their age and single-player only.
  - Each has an `onlyWhenAsked` preference and no romance.
  - Their intents are limited to hobby and growth, phrased as solo help.
  - Their facets are all `agent_private`.
  - Their **only edge is `invited_by` from an adult**, who is often a parent-archetype neighbor.
- **Multi-city travelers (10%, 50 members, 25 per city):** half are bi-coastal (a `routine` presence in the other city), and half have a trip. 43 of these are visible in the snapshot; trips more than 14 days out stay in hidden truth only.
- **Adversarial personas (4%, 20 members):**
  - spammer 4, scammer 4, harasser 4, prompt_injector 2, block_abuser 2.
  - 4 age-misrepresenting teens who claim 18-21 but are really 15-17.
  - They are flagged only in hidden truth. Their public side looks plausible, which is the point of the test. The validator treats the age-misrepresenting teens as minors for edges (they too have only `invited_by`).
- **Graph structure:**
  - **Invite trees:** 10 founding roots (5 per city) and invite depth of 7 at most. Older members invite more.
  - **Vouches:** on about 65% of invites, plus a few later vouches.
  - **Friendships:** a stochastic block model over 18 interest communities (9 per city) with friend-of-friend closure.
  - **Coworker cliques:** 51 workplaces, including 3 bi-coastal companies.
  - **Roommates:** 7 pairs.
  - **Bridges:** cross-community friends, 61 SF<->NYC ties through travelers and bi-coastal coworkers, and 16 cross-city invites.

## Regenerate

```bash
bun scripts/synthetic/generate.ts --dry-run        # list members whose text is cached vs needs the LLM; no API calls, writes nothing
bun scripts/synthetic/generate.ts --max-fresh 60   # LLM-enriched via defaultLLM() (DEFAULT_LLM_PROVIDER/MODEL, default Surplus gpt-6-luna); refuses if >60 members need new text
bun scripts/synthetic/generate.ts --no-llm         # template prose only, no API calls (~0.1 s)
bun scripts/synthetic/generate.ts --concurrency 4 --fresh   # ignore the LLM cache (regenerates all 500)
bun scripts/synthetic/validate.ts                  # writes v1/validation.json (or --out PATH), exit 1 on failure
bun test scripts                                   # dataset invariants, validator negative tests, determinism
bun scripts/synthetic/load.ts --engine             # runs engine v1, writes v1/engine_v1_run.json
```

Everything except the LLM prose is a pure function of `SEED = 20261005` (`scripts/synthetic/common.ts`), the `packages/sim` generator and the taxonomy. The manifest records `simGeneratorSourceSha256`, so you can tell when the sim generator changed underneath the dataset. LLM outputs are cached per member under `runs/synthetic-cache/v1/` (gitignored). Each entry stores the model that wrote it and a hash of model plus prompt; an entry is reused whenever the member's prompt is unchanged, **whichever model wrote it**, so switching the default model does not regenerate existing text. A rerun with the cache in place reproduces the data files byte for byte, except for members without a valid entry (template fallbacks, or members whose prompt changed), which the rerun sends to the LLM. Without the cache you get the same structure with different prose.

The pipeline:
1. `generatePersonas` runs once per city.
2. Deterministic post-processing adds invented names, real neighborhoods, the age mix including minors, extra career intents (about 25% of adults), travelers, workplaces, join dates, participation state and the graph.
3. One LLM call per member (`defaultLLM()` from `packages/core`; v1.0.0 used Cerebras `qwen-3.8-27b`) returns JSON with bio, occupation, 3 voice samples, routine, availability, offers, intent details, desired people and rephrased boundaries.
4. Outputs are scrubbed for contact info and canaries. If a call fails, the member falls back to template text and the fallback is counted.

## Load

```ts
import { loadSnapshot, loadPersonas } from "../../scripts/synthetic/load.ts";
const snapshot = await loadSnapshot();                 // core WorldSnapshot from PUBLIC files only
const sfOnly   = await loadSnapshot(undefined, { cities: ["sf"] });

// Engine
import { runEngine } from "../../packages/engine/src/index.ts";
const { proposals, runLog } = await runEngine(snapshot, { seed: 1 });

// Simulator (harness only: reads hidden truth). Trips are day offsets from snapshotNow.
import { runWorld, Oracle } from "../../packages/sim/src/index.ts";
const personas = await loadPersonas();
// runWorld({ personas, start: snapshot.now, days: 30, network, engine, seed: 1 })
```

`loadPersonas` also rebuilds each persona's `knowledge` (tier, chat coverage, sources, and source facets with truth labels), so sim `buildSnapshot` exposes the same tiered view. `loadSnapshot` never reads `hidden_truth.jsonl`. It strips the dataset-only fields (`synthetic`, `segment`, `profile`, `relation`), so the engine sees exactly the `packages/core` contract. `recentProposals` is empty, and there are no `events`, feedback or interactions, so `event_anchor` and `second_encounter` have nothing to work from.

## Results (generator 1.2.1, regenerated 2026-10-06)

### What changed in 1.2.1: intent liveness and the dating opt-in
Full analysis: `docs/results/2026-10-06-liveness-complementarity.md`.

- **Intent records are anchored to the snapshot.** In 1.2.0, `createdAt` was the first statement (join + 0-20 days) with a 60/90-day horizon and no re-confirmation. So 304 of 582 active records had expired at `now`, and **252 of 450 adults had no live intent**, while the oracle still counted those wants.
  - The agent now re-asks every 30 days (`packages/sim/src/persona.ts` `intentRecordTiming`).
  - An answered check-in re-confirms a held want, which moves `createdAt`, or withdraws a lapsed one: `status: "closed"`.
  - Unanswered check-ins let the record age out. Members at 2 or more unanswered proactive messages count no check-ins.
  - Hidden wants carry `lapsesAt`: an exponential lifetime from when the want was stated, with mean 45 days for help, 240 for romance and 365 for everything else. Each stated intent carries `statedAt` in `personaPublic`. The oracle ignores a want once it has lapsed.
- **Result:**
  - Records: 435 active and live, 18 active but expired, 142 closed, 64 paused.
  - **144 of 450 adults have no live intent**; 23 of them never stated one.
  - The median record age is 18 days.
  - 205 of 855 hidden wants (24%) have lapsed by `now`.
  - 541 of 595 non-paused records match hidden truth exactly. The rest are realistic lags: 27 live but lapsed, 12 expired but held, 6 expired and lapsed, plus 9 wants an exaggerating persona states without holding.
- **A dating desire implies the romance opt-in.** The fix is in `packages/sim/src/generator.ts` and `calibrateRomance`. Two adults changed, and adult romance opt-in goes from 117 to 119. The only dating holders who are opted out are the 3 age-lying minors.
- **Unchanged:** members, facets (except 2 romance-preference facets), presence and edges are byte-identical to 1.2.0. RNG streams are unchanged (lapses use their own fork). There was no new LLM text: 0 calls, $0.

### What changed in 1.2.0: profile richness and connected sources
The founder asked for profiles ranging from barely known to well known, and for simulated Gmail, connected sources and found social profiles. The full design is in `docs/data-model-sources.md`, and the code is in `packages/sim/src/sources.ts`.
- **Hidden tiers, as exact quotas:** minimal 75 (15%), light 125 (25%), medium 150 (30%), rich 100 (20%), very_rich 50 (10%). Ranking uses a noisy archetype plus tenure score.
- **What is known:** the public files hold only what each member told the agent (chat coverage by tier) plus facets from their active sources. Hidden truth is unchanged and complete, so the oracle is unaffected.

| Tier | Facets per member | True interests known | Active sources | Median chat messages |
|---|---:|---:|---:|---:|
| minimal | 0.21 (policy only) | 0% | 0 | 2 |
| light | 5.5 | 41% | 0.46 | 8 |
| medium | 10.2 | 65% | 0.92 | 26 |
| rich | 17.5 | 84% | 2.09 | 75 |
| very_rich | 24.9 | 98% | 4.38 | 208 |

- **Sources:**
  - 624 active: 529 connected via OAuth, profile URL or paste, plus 95 found public profiles of the member that the member confirmed.
  - 75 inactive: 32 found profiles pending confirmation, 22 rejected namesakes (nothing kept), 21 revoked.
  - 189 members connected nothing.
  - Active by kind: Calendar 101, Gmail 92, LinkedIn 73, Spotify 68, Instagram 62, GitHub 49, AI memory 33, X 33, Strava 26, website 23, Luma 22, Partiful 21, Eventbrite 21.
- **Source facets: 1,501**, of which 1,314 are correct, 148 are wrong inferences (a gift read as a hobby, a shared Spotify, a friend's hobby on Instagram, a colleague's endorsement, a calendar that looks free) and 39 are stale (an old LinkedIn job, a stale website or AI-memory goal). 553 are member-confirmed (correct ones only). There are 58 sensitive inferences, all `agent_private`.
- **Knock-on counts:**
  - Facets 6,700 -> 5,224 and intents 843 -> 659.
  - Adult romance opt-in 130 -> 117, because a minimal member opted in only if their one want was romance.
  - 71 of 133 canaries are disclosed to the agent.
  - Members, graph, presence, ages, minors and travelers are unchanged.
- **No new LLM text.** Prompts are unchanged, so all 500 members reuse cached prose (0 calls, $0). The full prose moved to `hidden_truth.jsonl` `personaTexture`.

### What changed in 1.1.0
- **Romance opt-in calibrated.** In 1.0.0, 207 of 450 adults (46%) were opted in to romance: the sim's independent 30% hidden opt-in plus dating intents sampled from the taxonomy. `calibrateRomance` in `generate.ts` now keeps a stated dating intent with p = 0.68 and a hidden-only opt-in with p = 0.3, and makes hidden truth agree with the public opt-in (adversarial personas are untouched, so the harassers keep their opt-in). Result: **130 of 450 adults (28.9%)**, 110 romance intents (was 160).
- **Only changed members got new text.** Dropping a dating intent changes a member's prompt, so those **50 members** were re-enriched with Surplus `gpt-6-luna` (50 calls, 0 retries, 21.5K prompt / 30.7K completion tokens, **$0.0026**, provider-reported). The other 450 reuse their cached `qwen-3.8-27b` text unchanged. The manifest lists the 50 ids under `llm.freshMemberIds` and keeps the 1.0.0 run stats under `llm.previousRuns`.
- **`sf-0103` now has LLM text.** It was the one template fallback in 1.0.0 (after repeated Cerebras 429s). A valid cached `qwen-3.8-27b` entry for its exact prompt was written by an earlier cache-repair run, and the cache-aware generator picked it up; 500/500 members now have LLM text.
- Prose is now from two models (450 qwen, 50 gpt-6-luna); a scan of the 50 new profiles found no brand/employer/school names and no dating language.
- Counts that moved: facets 6,783 -> 6,700 (fewer romance-preference facets and offers), intents 889 -> 843. Everything else (members, ages, minors, travelers, graph, canaries) is identical.

### Generation (1.0.0, the 450 members whose text was reused)
- **Model and time:** Cerebras `qwen-3.8-27b` at concurrency 4. The run took **13m13s** of wall time.
- **Coverage:** 499 of 500 members were enriched by the LLM. 88 of those came from the cache of an earlier partial run. **1 member fell back to template text** after repeated 429s. There were 0 partial-field fallbacks and 0 contact scrubs.
- **Rate limits:** the run made 1,038 HTTP calls, and 517 of them were 429s. The 150K TPM limit is the constraint, because about 88% of the output tokens are hidden reasoning. The retries absorbed all of these.
- **Tokens and cost:**
  - Final run: 307K prompt tokens and 1.69M completion tokens (1.51M of them reasoning), **about $2.82**.
  - The aborted earlier attempts cost about **$0.65** more, so the dataset cost about **$3.50** in total.
  - These figures use the price assumption in `docs/test-plan.md` §15 ($0.99/M input, $1.49/M output). Confirm them on the console.
- **Checks:** a scan of bios and voice samples for common real brand, employer and school names found 0 hits.

### Validation: 20/20 pass on the 1.2.1 data (`v1/validation.json`)

Added in 1.2.1: **`intent_liveness_anchored`**. Every record has to be explainable from hidden truth:

- `createdAt` is at or after `statedAt`, on a check-in, and not after `now`;
- `closed` only for a lapsed want;
- an expired active record only for a member who doesn't answer check-ins;
- at most 10% of active records expired (now 4.0%; 1.2.0 fails this check with 52%).

The six checks added in 1.2.0:

| Check | Result |
|---|---|
| richness tier distribution | Every tier is within 2 points of its target. Minimal members have only policy facets and at most one vague intent. Facets per member rise strictly by tier |
| known facets have a channel, no hidden leak | Every chat facet is within that member's chat coverage, and every source facet comes from an active source of that member and has a hidden truth label. `profile.occupation` appears only when stated, and summary bios mention only known interests. An unconfirmed inference is never `shareable` |
| connected sources track richness | Minimal members have 0 sources. Very rich members have 3-6 active sources (11/16/16/7 with 3/4/5/6). Observation counts match the facets |
| no observations about non-members | Every source has `subject: "self"`. Pending and rejected found profiles carry no facets, and no source facet names another member, a handle or a URL |
| sensitive inferences never shareable | 58 sensitive facets, all `agent_private` and none confirmed; none is visible in the engine snapshot |
| minors: no social or Gmail matching facets | 27 of the 50 minors have sources (Calendar 19, Spotify 16, GitHub 10), with no found profiles and every facet `agent_private` |

The canary check now requires every canary to be unique (133 of 133). A canary must appear in exactly one `agent_private` facet if it was disclosed to the agent, and in none otherwise.

The table below is from 1.1.0. The counts it gives for facets, intents and romance moved in 1.2.0 (see above).

| Check | Result |
|---|---|
| manifest integrity | sha256 and record counts match |
| schema conformance (core types) | 500 members, 6,700 facets, 843 intents, 549 presence, 2,092 edges valid; enums are tied to core types at compile time; the snapshot carries no extra keys |
| all records synthetic | yes, in all 6 JSONL files |
| names and contact | 500 unique names; every phone `+1-AAA-555-01xx` and unique; every email `@example.com`; no phone, email or URL in free text |
| city and neighborhood | 250/250; every neighborhood, borough and presence area valid for its city |
| age distribution | 50 minors (10.0%, ages 13:6, 14:10, 15:7, 16:17, 17:10); median adult age 33 |
| minors single-player | 54 true minors (50 honest + 4 age-misrepresenting), whose only edges are 54 `invited_by` (invitee side, adult inviter); no romance; all facets `agent_private` |
| canaries and hidden split | 133 canaries, each in exactly one `agent_private` facet and nowhere else; no hidden-only keys in public files |
| adversarial flagged | 20 (4.0%), every one with kind, notes and scripted messages |
| invite and vouch trees | 10 roots, max depth 7 (depths 1-3 hold 377 members), max fan-out 18, 334 vouches |
| clusters and bridges | one component; adult degree median 6 (p90 10, max 21); modularity 0.588 over generator communities; a public-graph Louvain pass finds 100 clusters (top sizes 47/33/25/23) at Q=0.487; 34.7% of edges cross communities; 214 members touch 3 or more communities; 61 SF<->NYC edges; 84 members have a cross-city tie; 60 graph bridges |
| travelers | 50 (10.0%), 25 per city |
| diversity | see below |

- **Archetypes:** regular 167, newcomer 67, busy_parent 62, introvert 50, traveler 50, very_active 40, connector 34, never_replies 30.
- **Genders:** woman 254, man 217, nonbinary 29.
- **Intents by category:** social 266, professional (career) 148, help 142, hobby 120, romance 110, growth 57. That is 1.69 intents per member over 20 objectives.
- **Romance:** 130 of 450 adults (28.9%) are opted in to romance (was 207, 46%, in 1.0.0; see "What changed").
- **Coverage:** all 38 interest tags and all 8 writing styles appear.

### Engine v1.2.0 by richness tier (1.2.1 data, seed 1, no LLM judge)

Engine v1.2.0 (docs/results/2026-10-07-engine-v1.2.md) turns on dispatch awareness, personal-growth wants matched as hobby, the 0.40 bar for event pairs and theme groups, and the romance stated-preferences gate. On this one-tick snapshot only the growth fix and the group bar act (no history, no events in the files). The run produced **218 proposals** touching 256 members (v1.1.0: 208 touching 247). Oracle precision is **33.0%** (34.6%, inside the ±6.5-point CI), latent-pair recall 2.2% (2.1%), Gini 0.540 (0.558). The run had 0 minors in any proposal and 0 canary leaks. `bun scripts/synthetic/load.ts --engine` regenerates `v1/engine_v1_run.json`.

| Tier (adults) | Proposals per member | Share with any proposal | Mean fit | Mean confidence | Oracle compatible | Latent-pair recall |
|---|---:|---:|---:|---:|---:|---:|
| minimal (63) | 0.27 | 22% | 0.66 | 0.66 | 0.27 (n=11) | 0.3% |
| light (115) | 0.67 | 46% | 0.63 | 0.75 | 0.33 | 0.9% |
| medium (131) | 1.05 | 66% | 0.58 | 0.77 | 0.33 | 2.5% |
| rich (94) | 1.48 | 72% | 0.58 | 0.79 | 0.35 | 4.2% |
| very_rich (47) | 1.49 | 72% | 0.59 | 0.79 | 0.36 | 4.4% |

Light-tier reach rises most (40% → 46%), from growth wants now matched. With a weekly event feed (6 per city), v1.2 reaches 60.0% of adults at 32.3% precision. With "ask before proposing" (off by default) and the answers arriving one tick later, it reaches 64.4% of adults and 33% of minimal-tier members (25% before); see the results doc.

### Engine v1.1.0 by richness tier (historical: 1.2.1 data, seed 1, no LLM judge)

Engine v1.1.0 adds structured complementarity (weight 0.5). The run produced **208 proposals** touching 247 members. Oracle precision is **34.6%** (20.5% for engine v1 on 1.2.0 data), and latent-pair recall is 2.1% of 3,191 latent pairs (1.2% of 4,192). The run had 0 minors in any proposal and 0 canary leaks.

| Tier (adults) | Proposals per member | Share with any proposal | Mean fit | Mean confidence | Oracle compatible | Latent-pair recall |
|---|---:|---:|---:|---:|---:|---:|
| minimal (63) | 0.30 | 25% | 0.61 | 0.69 | 0.23 (n=13) | 0.3% |
| light (115) | 0.56 | 40% | 0.61 | 0.75 | 0.35 | 0.9% |
| medium (131) | 0.99 | 64% | 0.58 | 0.78 | 0.34 | 2.3% |
| rich (94) | 1.44 | 72% | 0.57 | 0.79 | 0.35 | 3.9% |
| very_rich (47) | 1.55 | 70% | 0.57 | 0.79 | 0.33 | 4.2% |

Precision is now roughly flat across the tiers that have data (33-35%), against 17-19% before. Reach still rises with richness.

### Engine v1 by richness tier (historical: 1.2.0 data, seed 1, no LLM judge, engine working tree of 2026-10-06)

The run produced 151 proposals touching 230 members. Under 1.1.0 it produced 210 touching 287. The run had 0 minors in any proposal and 0 canary leaks. Fit is `components.fit`, and "oracle compatible" is the share of the tier's proposals that the sim oracle rates good from hidden truth. Recall is the share of the oracle's latent good same-city stranger pairs touching the tier that the engine proposed.

| Tier (adults) | Proposals per member | Share with any proposal | Mean fit | Mean confidence | Oracle compatible | Latent-pair recall |
|---|---:|---:|---:|---:|---:|---:|
| minimal (63) | 0.25 | 21% | 0.75 | 0.67 | 0.30 (n=10) | 0.3% |
| light (115) | 0.51 | 41% | 0.62 | 0.73 | 0.17 | 0.7% |
| medium (131) | 0.71 | 50% | 0.56 | 0.76 | 0.18 | 1.1% |
| rich (94) | 1.14 | 71% | 0.55 | 0.77 | 0.18 | 1.8% |
| very_rich (47) | 1.19 | 79% | 0.57 | 0.78 | 0.19 | 3.3% |

Reach and recall rise steeply with richness: very rich members get about 5x the proposals of minimal ones, and recall is 11x higher. Confidence rises too.

Fit and oracle quality are flat or noisy. Minimal members surface almost only through `warm_path`, `newcomer_welcome` and network moves, which carry fixed fit floors, so their fit is high but rests on 10 proposals. Other generators are moving in the engine at the same time, so treat these numbers as a snapshot.

### Engine v1 on the 1.1.0 snapshot (historical, seed 1, no LLM judge)

Rerun on 2026-10-06 against generator 1.1.0 data (28.9% adult romance opt-in, 843 intents) and the engine after the review fixes (commit 2613cea).

The run produced **210 proposals** in 3.6 s, touching 287 members (SF 106 proposals, NYC 104). 28 are exploration picks.

| Generator | Candidates | Selected |
|---|---:|---:|
| warm_path | 713 | **96** |
| intent_to_capability | 892 | 39 |
| complementary_intents | 1,244 | 36 |
| shared_intent_pooling | 255 | 24 |
| newcomer_welcome | 16 | 6 |
| network_growth | 16 | 4 |
| help_request | 165 | 3 |
| group_composer | 16 | 2 |
| event_anchor / second_encounter / expansion | 0 | 0 |

- **By category:** social 91, professional 61, hobby 39, romance 12, growth 4, help 3.
- **Funnel:** 3,317 generated, 3,279 passed the hard filters, 1,185 eligible, 210 selected.
  - Rejections: `high_risk` 18, `home_entry_rule` 16, `no_presence_overlap` 4.
  - Member funnel: 415 available, 50 underage, 21 only-when-asked, 14 paused.
- **Fairness:** Gini 0.47, top-10% share 0.24.
- **Safety checks:** 0 minors in any participant, alternate or via role; 0 canary leaks in the proposals.
- **Compared with the first run** (1.0.0 data, pre-fix engine: 204 proposals, warm_path 130, romance 0, `high_risk` 404, Gini 0.50):
  - Romance now produces proposals. There are fewer than the 35 seen on 1.0.0 data during the review, because opt-in was lowered from 46% to 29%.
  - `high_risk` false positives are gone: whole-word, context-aware risk terms.
  - `warm_path` share fell from 64% to 46%.
  - `event_anchor` and `second_encounter` are still idle, because the snapshot has no events or meeting history. Tests cover them with that data present.

## Privacy note

- **What this data is:** these files contain no real personal data. They do contain realistic *kinds* of sensitive data, including private disclosures (divorce, recovery, grief, money stress), boundaries, romance preferences and minors, because the system has to be tested against exactly that.
- **How to handle it:**
  - Treat `hidden_truth.jsonl` as evaluation-only ground truth.
  - Treat `agent_private` facets as you would real ones: never in explanations, outreach or the admin console without the same access controls production will use.
  - Never paste canary tokens into prompts, logs or fixtures outside a leak test.
- **If you extend the dataset:** keep `synthetic: true`, the `555-01xx` and `example.com` contact rules, invented surnames, and the minors-only-`invited_by` rule. Then rerun `validate.ts`.
