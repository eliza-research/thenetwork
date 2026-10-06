# Synthetic members: SF + NYC (v1)

> **Disclaimer: every record here is SYNTHETIC.** These are invented people with invented names, made for development, demos, the simulator and the admin console. None of them is a real person, member or employee of a real company. Given names are common names drawn from many cultures. Surnames are invented by joining morphemes from unrelated traditions (for example "Hokuthorne" or "Vasalund"), so any resemblance to a real person is coincidental. Phone numbers use only the fictional `555-01xx` range, and emails use `example.com`. Workplaces are generic descriptions such as "a 45-person fintech company in Flatiron", never named employers. The PRD forbids profiles of non-members, so do not add real people or scrape real profiles into this directory.

Every record has a top-level `"synthetic": true`, and so does `manifest.json`.

## Files (`data/synthetic/v1/`)

| File | Records | What it holds |
|---|---|---|
| `members.jsonl` | 500 | Core `Member` (packages/core) plus `segment` (`adult`/`minor`) and `profile`: pronouns, neighborhood, borough, occupation, bio, texting voice (`style`, `samples`), routine, availability, `secondaryCity`, fictional `contact`, and `enrichment` (`llm`/`template`) |
| `facets.jsonl` | 6,783 | Core `Facet`: interests, skills, offers, boundaries, romance and dealbreaker preferences, neighborhood, occupation, availability pattern, and canary-bearing private disclosures |
| `intents.jsonl` | 889 | Core `Intent`: an objective from the sim taxonomy, plus an LLM-written `details` sentence followed by `(format; tags)`, and `desiredPeople` |
| `presence.jsonl` | 549 | Core `Presence`: 500 home, 24 routine (bi-coastal members), 25 temporary (trips already announced at snapshot time) |
| `edges.jsonl` | 2,092 | Core `Edge` plus `relation`: `invited_by` 490, `vouched_for` 334, `knows` 1,253 (949 friend, 297 coworker, 7 roommate), `blocked` 15 |
| `hidden_truth.jsonl` | 500 | **Ground truth. Never load this into the engine or show it in a product surface.** It holds the sim `HiddenTruth` (true age, real interests and desires, honesty, flakiness, responsiveness, private disclosure plus canary, trips, adversarial kind), archetype, gender, community, workplace, relationships (including exes, which are never disclosed), adversarial notes with scripted messages, and the public persona |
| `manifest.json` | | Seed, snapshot time, generator version, sim-generator source hash, model, counts, LLM usage and cost, file hashes |
| `validation.json` | | Output of `validate.ts` |
| `engine_v1_run.json` | | Output of `load.ts --engine` |

Every timestamp is relative to the snapshot time `now = 2026-10-12T17:00Z` (Mon 10:00 PDT / 13:00 EDT). Member ids are `sf-0001..sf-0250` and `ny-0001..ny-0250`. Facet ids are `<member>:fNN` and intent ids are `<member>:iN`.

### Privacy scopes
- **Minors:** all of their facets are `agent_private`.
- **Adults:**
  - Interests are about 60% `shareable` and 40% `matchable`.
  - Skills and occupation are `matchable`.
  - Offers, neighborhood and availability are `shareable`.
  - Boundaries, romance preferences (`romance:is|seeks|age` tags), dealbreakers and private disclosures are `agent_private`.
- **Private disclosures:** each one carries a unique canary (`(ref XX-1234-WORD)`), exactly as the simulator does, so leak checks are exact.

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
bun scripts/synthetic/generate.ts                  # Cerebras-enriched; uses CEREBRAS_* from .env
bun scripts/synthetic/generate.ts --no-llm         # template prose only, no API calls (~0.1 s)
bun scripts/synthetic/generate.ts --concurrency 4 --fresh   # ignore the LLM cache
bun scripts/synthetic/validate.ts                  # writes v1/validation.json, exit 1 on failure
bun scripts/synthetic/load.ts --engine             # runs engine v1, writes v1/engine_v1_run.json
```

Everything except the LLM prose is a pure function of `SEED = 20261005` (`scripts/synthetic/common.ts`), the `packages/sim` generator and the taxonomy. The manifest records `simGeneratorSourceSha256`, so you can tell when the sim generator changed underneath the dataset. LLM outputs are cached per member under `runs/synthetic-cache/v1/` (gitignored), keyed by a hash of model plus prompt. A rerun with the cache in place reproduces the data files byte for byte, except for members that fell back to template text, which the rerun retries. This was verified: a cached rerun differed only in `sf-0103`, the one fallback member. Without the cache you get the same structure with different prose.

The pipeline:
1. `generatePersonas` runs once per city.
2. Deterministic post-processing adds invented names, real neighborhoods, the age mix including minors, extra career intents (about 25% of adults), travelers, workplaces, join dates, participation state and the graph.
3. One Cerebras call per member returns JSON with bio, occupation, 3 voice samples, routine, availability, offers, intent details, desired people and rephrased boundaries.
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

`loadSnapshot` never reads `hidden_truth.jsonl`. It strips the dataset-only fields (`synthetic`, `segment`, `profile`, `relation`), so the engine sees exactly the `packages/core` contract. `recentProposals` is empty, and there are no `events`, feedback or interactions, so `event_anchor` and `second_encounter` have nothing to work from.

## Results (generated 2026-10-06)

### Generation
- **Model and time:** Cerebras `qwen-3.8-27b` at concurrency 4. The run took **13m13s** of wall time.
- **Coverage:** 499 of 500 members were enriched by the LLM. 88 of those came from the cache of an earlier partial run. **1 member fell back to template text** after repeated 429s. There were 0 partial-field fallbacks and 0 contact scrubs.
- **Rate limits:** the run made 1,038 HTTP calls, and 517 of them were 429s. The 150K TPM limit is the constraint, because about 88% of the output tokens are hidden reasoning. The retries absorbed all of these.
- **Tokens and cost:**
  - Final run: 307K prompt tokens and 1.69M completion tokens (1.51M of them reasoning), **about $2.82**.
  - The aborted earlier attempts cost about **$0.65** more, so the dataset cost about **$3.50** in total.
  - These figures use the price assumption in `docs/test-plan.md` §15 ($0.99/M input, $1.49/M output). Confirm them on the console.
- **Checks:** a scan of bios and voice samples for common real brand, employer and school names found 0 hits.

### Validation: 13/13 pass (`v1/validation.json`)

| Check | Result |
|---|---|
| manifest integrity | sha256 and record counts match |
| schema conformance (core types) | 500 members, 6,783 facets, 889 intents, 549 presence, 2,092 edges valid; enums are tied to core types at compile time; the snapshot carries no extra keys |
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
- **Intents by category:** social 262, romance 160, professional (career) 148, help 142, hobby 120, growth 57. That is 1.78 intents per member over 20 objectives.
- **Romance:** 207 adults are opted in to romance. That is high, because it inherits the sim's 30% rate plus dating intents, so tune it down if the demos need to.
- **Coverage:** all 38 interest tags and all 8 writing styles appear.

### Engine v1 on the loaded snapshot (`v1/engine_v1_run.json`, seed 1, no LLM judge)

The run produced **204 proposals** in 1.3 s, touching 276 members (SF 110, NYC 94). 28 of the proposals are exploration picks.

| Generator | Candidates | Selected |
|---|---:|---:|
| warm_path | 720 | **130** |
| intent_to_capability | 880 | 31 |
| complementary_intents | 2,005 | 17 |
| shared_intent_pooling | 256 | 14 |
| newcomer_welcome | 16 | 6 |
| group_composer | 16 | 3 |
| help_request | 165 | 2 |
| network_growth | 16 | 1 |
| event_anchor / second_encounter / expansion | 0 | 0 |

- **Funnel:** 4,074 generated, 2,332 passed the hard filters, 997 eligible, 204 selected.
  - Rejections: `no_presence_overlap` 1,316, `high_risk` 404, `dealbreaker` 17, `home_entry_rule` 5.
  - Member funnel: 415 available, 50 underage, 21 only-when-asked, 14 paused.
- **Fairness:** Gini 0.50, top-10% share 0.25.
- **Safety checks:** 0 minors in any participant, alternate or via role; 0 canary leaks in the proposals.
- **What this shows:**
  - The dense invite and friend graph makes `warm_path` dominate. With no events or feedback in the snapshot, `event_anchor` and `second_encounter` are idle.
  - Romance produced 0 proposals despite 160 intents.
  - The 404 `high_risk` rejections suggest the engine's risk-term list is hitting ordinary text in intent details, such as "kids".

  All three are worth a look before demos.

## Privacy note

- **What this data is:** these files contain no real personal data. They do contain realistic *kinds* of sensitive data, including private disclosures (divorce, recovery, grief, money stress), boundaries, romance preferences and minors, because the system has to be tested against exactly that.
- **How to handle it:**
  - Treat `hidden_truth.jsonl` as evaluation-only ground truth.
  - Treat `agent_private` facets as you would real ones: never in explanations, outreach or the admin console without the same access controls production will use.
  - Never paste canary tokens into prompts, logs or fixtures outside a leak test.
- **If you extend the dataset:** keep `synthetic: true`, the `555-01xx` and `example.com` contact rules, invented surnames, and the minors-only-`invited_by` rule. Then rerun `validate.ts`.
