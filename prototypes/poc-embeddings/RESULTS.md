# POC: real embeddings for candidate retrieval (2026-10-06)

**Question.** Engine v1 retrieves candidates with a deterministic hashing embedding (`localEmbed`). The sim results list "generic text embeddings" and low pair recall (about 11%) as the main gaps. Do real embedding models materially raise retrieval recall of latent good pairs? What do they cost, and how slow are they? Is retrieval or ranking the bottleneck?

**Answer.** No. On the 500-member synthetic set, `text-embedding-3-small` and `text-embedding-3-large` retrieve latent good pairs **no better than** the hashing embedding or plain BM25.

- **Recall@50:** about 48% for all of them, against 22% for random. The differences are 2 points or less, which is inside the seed-to-seed noise.
- **What does help:** a structured scorer that uses the same engine-visible data reaches 58.5% recall@50 (70.5% if expired intents are kept). The public-profile ceiling is about 75%.
- **End to end through `runEngine`:** swapping in a real embedding does not change proposal precision (23-28% for every backend). Reranking the engine's own candidate set with the structured scorer nearly doubles top-N precision, from 24% to 46%.
- **The bottleneck:** ranking first, then retrieval coverage. It is not embedding quality.

Embeddings are cheap enough not to matter either way. Embedding 300 members costs about $0.002 with -small or $0.013 with -large.

## Setup

- **Data:** `data/synthetic/v1`, 500 members (450 adults), loaded through `scripts/synthetic/load.ts`.
- **Member text: public, engine-visible data only.** `src/data.ts#buildViews` mirrors `packages/engine/src/world.ts`:
  - Facets of scope `matchable|shareable` and kind interest/skill/offer/fact/etc., embedded as `value + tags` exactly as the engine does.
  - Intents only if `status === "active"` and `createdAt + horizonDays > now`, embedded as `intentText` exactly as the engine does.
  - From these the POC builds four views:
    - per-facet and per-intent texts (what the engine embeds today);
    - one profile document;
    - a *wants* text (intents);
    - an *offers* text (skills, offers, occupation and interests).
  - Hidden truth, bios, `agent_private` facets and the persona records are never used to build text.
- **Candidate pool per member:** members in the same home city, publicly 18+, and not already joined by any public edge. That gives 203-224 candidates (median 218). Adversarial members stay in the pool as negatives, because the engine cannot see them.
- **Ground truth: `packages/sim` `Oracle.latentPairs`.** This is the definition the sim uses for its "pair recall". It covers same-city adult, non-adversarial pairs that don't already know each other, rated `compatible` by the oracle (min enjoyment ≥ 0.55).
  - About 4,200 pairs (8.5% of the 49,056 candidate pairs), about 20 good partners per member. 420 of the 450 adults have at least one.
  - The oracle includes a seeded "pair chemistry" term that no profile can predict, so I ran oracle seeds 1-3 and report their mean.
  - About 20 latent pairs per seed are joined by a public edge (for example an invite) with no hidden relationship. They fall outside every pool and were dropped.
  - I also built a **systematic** label set: the same utility with chemistry set to 0 (2,927 pairs). This is the part of the truth that retrieval could find in principle.
- **Metrics:**
  - Recall@K: per member, the share of their good partners in their top K, averaged over members.
  - MRR: 1 / rank of the first good partner.
  - "K for 80%": the smallest K where mean recall reaches 80%.
  - Pair R@50: a pair counts as retrieved if either member has the other in their top 50 (the engine retrieves per member and then takes the union).

### Methods

| Method | Score for a pair (a, b) |
|---|---|
| random | hash |
| BM25 (doc) | BM25(doc_a → doc_b) + BM25(doc_b → doc_a), using the engine tokenizer |
| engine-style facets | Mirrors `intentFit`/`bestFacet`: max over intents × facets of cosine × provenance weight (+0.15 on a tag hit), in both directions, and the profile-centroid cosine × 0.8 |
| profile doc | cos(doc_a, doc_b) |
| want↔offer (asymmetric) | cos(want_a, offer_b) + cos(want_b, offer_a) |
| multi-view | doc + 0.5 × want↔offer + 0.5 × cos(want_a, want_b) (shared-intent pooling) |
| structured public | **Engine-legal** inputs: facet tags, live intents mapped to the product taxonomy (`DESIRES`: what each objective needs), and the romance opt-in/preference tags the engine already reads for its filters. Scored with the same pair-term form as the oracle: interest-tag overlap + intent complementarity (skill > shared pool > interest), symmetric by min |
| ceiling: STATED, neutral traits | The oracle's pair terms on each persona's stated interests, skills and intents, with every member-level hidden trait set to neutral. Not engine-legal: it reads the persona record. It is the bound for a perfect public-profile parser |
| ceiling: STATED | Same, but keeps the hidden member traits (social energy, capacity, boundaries) |
| ceiling: HIDDEN | The oracle's utility on hidden truth without chemistry. This is the most any ranker can do given the chemistry noise |

Each of the four embedding methods was run with local-hash (256-d), text-embedding-3-small (1536-d) and text-embedding-3-large (3072-d).

## Results: retrieval recall (oracle labels, mean of seeds 1-3; `out/results.json`)

| Method | R@10 | R@25 | **R@50** | R@100 | MRR | K for 80% | pair R@50 |
|---|---:|---:|---:|---:|---:|---:|---:|
| random | 4.3 | 11.2 | 22.2 | 45.6 | 0.223 | 174 | 40.4 |
| BM25 (doc) | 15.5 | 29.5 | **47.5** | 70.7 | 0.494 | 129 | 55.8 |
| local-hash / engine-style facets (**today**) | 13.5 | 29.9 | **48.7** | 71.0 | 0.396 | 128 | 48.9 |
| local-hash / profile doc | 15.1 | 29.0 | 45.5 | 67.9 | 0.473 | 137 | 53.4 |
| local-hash / want↔offer | 15.5 | 29.8 | 47.4 | 70.0 | 0.458 | 129 | 48.0 |
| local-hash / multi-view | 15.3 | 30.1 | 48.8 | 71.0 | 0.472 | 127 | 53.9 |
| 3-small / engine-style facets | 14.2 | 29.8 | 47.3 | 71.0 | 0.439 | 128 | 47.1 |
| 3-small / profile doc | 15.2 | 30.8 | **49.2** | 71.7 | 0.467 | 125 | 50.3 |
| 3-small / want↔offer | 16.5 | 31.1 | 48.2 | 69.7 | 0.497 | 133 | 51.9 |
| 3-small / multi-view | 15.1 | 30.1 | 48.8 | 71.1 | 0.483 | 128 | 51.5 |
| 3-large / engine-style facets | 14.6 | 29.8 | 47.9 | 71.0 | 0.445 | 128 | 48.1 |
| 3-large / profile doc | 15.3 | 30.4 | **48.9** | 72.3 | 0.486 | 124 | 50.1 |
| 3-large / want↔offer | 16.5 | 30.8 | 48.4 | 70.4 | 0.498 | 133 | 52.7 |
| 3-large / multi-view | 15.0 | 30.2 | 47.9 | 71.2 | 0.496 | 128 | 50.9 |
| **structured public (taxonomy + tags)** | **22.0** | **40.5** | **58.5** | **80.2** | **0.598** | **100** | **61.2** |
| structured + 3-small want↔offer (0.1 tie-break) | 22.5 | 41.2 | 60.3 | 80.9 | 0.602 | 97 | 61.7 |
| structured + 3-large want↔offer (0.1 tie-break) | 22.5 | 41.2 | 60.0 | 81.0 | 0.605 | 97 | 61.6 |
| ceiling: STATED profile, neutral member traits | 33.4 | 56.3 | 74.8 | 94.0 | 0.743 | 61 | 76.6 |
| ceiling: STATED profile | 35.0 | 58.5 | 76.9 | 94.7 | 0.766 | 56 | 80.7 |
| ceiling: HIDDEN truth (no chemistry) | 38.6 | 62.4 | 81.1 | 96.3 | 0.826 | 49 | 87.7 |

Notes on the table:
- The seed-to-seed spread for any one method is about ±1.5 points at R@50. Every embedding row lies between 45.5 and 49.2.
- The pool holds about 218 candidates, so K = 100 is 46% of the pool. Read every recall number against the random row.

**On systematic labels** (chemistry removed, 2,927 pairs), the picture is the same:

| Method | R@50 | K for 80% |
|---|---:|---:|
| BM25 | 61.9 | 92 |
| local-hash engine-style | 60.6 | 93 |
| 3-small profile doc | 62.7 | 92 |
| 3-large profile doc | 64.2 | 89 |
| structured | 73.5 | 61 |
| STATED ceiling | 92-94 | 20-22 |

Real embeddings gain 2-4 points at most.

### Counterfactual: expired intents (`--include-expired`, `out/results-include-expired.json`)

**Finding:** 347 of the 843 intents (41%) are `active` but past `createdAt + horizonDays` at snapshot time. Every intent has a 60-day horizon (90 for romance), counted from the join date. The engine drops them, so **223 of 450 adults have no live intent**. The oracle still treats those desires as live. With expired intents kept:

| Method | R@50 | K for 80% |
|---|---:|---:|
| BM25 | 57.1 | 103 |
| local-hash / profile doc | 55.5 | 109 |
| 3-small / profile doc | 52.8 | 114 |
| 3-large / multi-view | 54.1 | 106 |
| **structured public** | **70.5** | **70** |
| ceiling: STATED, neutral traits | 74.8 | 61 |

Keeping the intents is worth +8 to +12 points: more than any change of embedding model. With them, the structured scorer comes within 4 points of the public-profile ceiling. The real embeddings now come out slightly *below* BM25 and hashing. The intent text carries exact taxonomy tokens such as `(tags: friends)`, which lexical matchers exploit and dense embeddings blur.

## Results: end to end through `runEngine` (`src/e2e.ts`, `out/e2e.json`)

Setup:
- One tick, seed 1, judge off, oracle seed 1 labels: 4,172 latent pairs, base rate 8.5%.
- Real embeddings are passed in through `deps.embed`, which reads precomputed vectors. A second pass embeds any texts that only the new embedding reaches.
- "Quantile-mapped" runs move `minSim`, `warmMinSim` and `poolSim` to the same quantile of the intent→facet cosine distribution, because the default thresholds were tuned on the hashing scale.

| Backend | Proposals | Scored pairs: n (good, recall, precision) | Eligible pairs | Selected pairs | Intro precision | Top-N precision on the same scored set: engine score / structured / oracle ceiling |
|---|---:|---|---|---|---:|---|
| local-hash (today) | 210 | 3,016 (657, 15.7%, 21.8%) | 1,493 (333, 8.0%, 22.3%) | 280 (65, 1.6%, 23.2%) | 29.6% | **24.3% / 46.4% / 68.6%** (N=280) |
| 3-small, default thresholds | 240 | 6,308 (1,127, 27.0%, 17.9%) | 3,311 (719, 17.2%, 21.7%) | 276 (70, 1.7%, 25.4%) | 26.9% | 27.5% / 46.7% / 73.6% |
| 3-small, quantile-mapped | 240 | 3,001 (654, 15.7%, 21.8%) | 2,427 (563, 13.5%, 23.2%) | 264 (74, 1.8%, 28.0%) | 30.3% | 27.3% / 47.0% / 70.5% |
| 3-large, default thresholds | 240 | 6,349 (1,139, 27.3%, 17.9%) | 3,035 (674, 16.2%, 22.2%) | 290 (69, 1.7%, 23.8%) | 27.9% | 27.2% / 46.2% / 72.4% |
| 3-large, quantile-mapped | 240 | 3,067 (643, 15.4%, 21.0%) | 2,390 (538, 12.9%, 22.5%) | 290 (71, 1.7%, 24.5%) | 28.8% | 27.2% / 46.9% / 68.3% |

How to read this:
- **Retrieval coverage.**
  - Each tick the engine scores pairs covering about 16% of latent good pairs, at 22% precision (2.6x the base rate).
  - With default thresholds, real embeddings double the candidate volume (27% coverage), but precision drops to 18%. These are more candidates, not better ones.
  - At matched thresholds, coverage and precision equal the hashing embedding's.
- **Ranking is the larger loss.**
  - Inside the engine's own scored set, its score picks top-N pairs at 24-28% precision. That is barely above the set's average (18-22%).
  - Ranking the *same* candidates with the structured public scorer gives 46-47%.
  - The ceiling without chemistry is 68-74%.
  - Final selected-pair precision is 23-28% for every backend. The embedding model does not move it.
- **Selection budget.** One tick selects about 280 pairs out of about 4,200 latent pairs. Per-tick recall is therefore capped near 7% whatever retrieval does, and the sim's 11% 30-day pair recall accumulates across ticks. Coverage across ticks depends on retrieval breadth, which comes from intents and structure.

## Cost and latency (OpenAI list price: $0.02 per 1M tokens for small, $0.13 per 1M for large; `cache/usage.jsonl`)

| | 3-small | 3-large |
|---|---:|---:|
| All 3,673 texts for 500 members (facets + intents + doc + wants + offers) | 162,113 tokens, **$0.0032** | 162,113 tokens, **$0.0211** |
| Per member, all views (about 324 tokens) | $0.0000065 | $0.000042 |
| **300 members, full index** | about 97K tokens, **about $0.002** | **about $0.013** |
| **Per profile update** (re-embed doc + wants + offers + 1-2 changed facets/intents, about 5 texts, about 350 tokens) | **about $0.000007** | **about $0.00005** |
| Latency per 256-text batch (p50 / max) | 0.77 s / 1.4 s | 0.83 s / 1.5 s (1.2 s / 2.5 s in a later run) |
| Wall time to embed all 500 members, sequential batches | 15.5 s | 21.5 s |
| Local-hash, same texts | $0, 48 ms | |
| Vector cache on disk (float32) | 37 MB | 74 MB |

Scoring all 450 × about 218 pairs takes well under a second in-process for every backend. At this scale, dense vectors need no ANN index. A one-off sweep of the whole membership on every tick is fine.

## Recommendation

1. **Don't switch the engine to a real embedding model for recall.** It is not the bottleneck. It costs almost nothing (about $0.002 to $0.013 for 300 members), but it buys 0 to 2 points of recall@50 and no end-to-end precision. If you adopt one anyway (for example for messy real-member text, where lexical matching will be weaker than on this taxonomy-shaped synthetic text), use **3-small**: -large is 6.5x the price for no measurable gain here. You must also **recalibrate `minSim`, `warmMinSim` and `poolSim`**. On default thresholds, real embeddings double the candidate volume at lower precision.
2. **Fix ranking first.** The engine's NetValue barely sorts good pairs from bad inside its own candidate set: 24% versus a 22% average. A structured complementarity score gets 46% on the same candidates. That score is interest overlap plus intent → skill / shared-pool / interest satisfaction, computed from facet tags and the objective taxonomy. Use it as a `fit` and `mutualBenefit` input, or as a retrieval channel. In production the structure would come from LLM extraction into the taxonomy (one call per profile update) instead of pre-tagged synthetic facets. The LLM judge on top-K remains the next lever above that.
3. **Stop dropping expired intents silently**, or re-confirm them. A 60-day horizon from join date removes 41% of intents and half of the adults' intents at snapshot time. That is worth +8 to +12 points of recall@50, more than any embedding change. Options:
   - re-ask or re-confirm before expiry;
   - decay the weight instead of hard-dropping;
   - give the sim oracle the same horizon so that sim and engine agree.
4. **Retrieval coverage:** for 80% member-level recall you need K of about 125-130 with any text-similarity method, out of a pool of about 218, which is barely better than random's 174. The structured scorer needs K of about 100, or about 70 with intents kept. The public-profile ceiling is K of about 60, and the hidden-truth ceiling is about 49, because of chemistry. So at this pool size, retrieval should keep a wide top-K: 100 or more per member, or simply the whole same-city pool, which is cheap at 200-250 members per city. Spend the effort on the ranker.

## Caveats

- **The oracle and the synthetic text share a taxonomy.** The structured scorer copies the oracle's functional form, so its margin over embeddings is partly built in. The fair takeaway is that *complementarity structure* (who needs what someone else has, and shared pools such as "make new friends") is what predicts good pairs. Generic semantic similarity does not capture it at any model size. On real, messier text, dense embeddings may beat BM25 and hashing by more than they do here. The structured route would then need LLM extraction.
- **Chemistry noise caps every method.** Even the hidden-truth ranker reaches only 81% R@50 on oracle labels.
- **The ceilings read persona records**, which are not engine-legal. The romance part of the STATED ceilings uses hidden romance preferences, which match the public opt-in and preference tags.
- **Quantile threshold mapping is approximate.** Other cosine-scale assumptions in scoring (the `fit` floor, the fit component) were left as they are. A tuned real-embedding engine could do slightly better than the e2e rows, but the offline recall table bounds that gain.
- **Scope:** one dataset, one snapshot, 450 query members. The per-member recall SE is about 1.5 points.

## Files and reproduction

```bash
bun prototypes/poc-embeddings/src/run.ts                     # offline recall table -> out/results.json
bun prototypes/poc-embeddings/src/run.ts --include-expired   # counterfactual -> out/results-include-expired.json
bun prototypes/poc-embeddings/src/run.ts --no-api            # local-hash + BM25 + structured only
bun prototypes/poc-embeddings/src/e2e.ts                     # runEngine funnel per backend -> out/e2e.json
```

- `src/data.ts`: engine-visible views, candidate pools, oracle, systematic and stated truths, structured scorer.
- `src/embedders.ts`: OpenAI client with a content-addressed disk cache (`cache/<model>.jsonl`, gitignored) and a usage ledger (`cache/usage.jsonl`). Reruns make 0 API calls.
- `src/bm25.ts`, `src/run.ts`, `src/e2e.ts`.
- Total spent on API calls: about $0.036 (all embedding, including the include-expired run).
