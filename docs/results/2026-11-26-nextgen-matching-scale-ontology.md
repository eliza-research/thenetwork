# Next-Generation Matching, Scale, Market Clearing, and Connection Ontology Results

- **Date:** 2026-11-26
- **Base commit (`origin/develop`):** `1b0f3d421769c0fe11fcf9665462dd5d0a4e8957`
- **Integrated branch:** `feat/nextgen-matching-eliza`
- **Merged component commits (file-disjoint, double-verified):**
  1. `eliza/engine-scale` @ `c11196494c8d113592bff5f380481a5a4074fc16`
  2. `eliza/theory-status` @ `8b1caebd4a92ebfe3da8b2c5a06cfdae5271970a`
  3. `eliza/vectors-ontology` @ `9c72682af06b202b8797bfbf931aa7faa3e9dc73`
  4. `eliza/sim-worlds` @ `41edca896e4b02518291fb7df5e438aca2718b32`
- **Runtime and package manager:** Node `v26.13.0`, `corepack pnpm@10.24.0`
- **Local database:** Postgres on `localhost:54339` (`REQUIRE_PG=1`, zero skipped Postgres gates)
- **Hand-written vs generated code:** All 56 changed TypeScript files under `packages/engine/src/`, `packages/network/service/`, `packages/network/harness/`, and `packages/sim/src/`, plus documentation updates, are hand-written. Zero generated files under `packages/core/src/generated/`, zero specs under `spec/`, zero `spec/lock.json` entries, and zero mirror files (`packages/core/src/svc/contract.ts`, `packages/core/src/svc/svc-auth.ts`) were changed. `corepack pnpm@10.24.0 run spec:check-generated` verified all 270 generated TypeScript and VibeLang artifacts unchanged.

---

## 1. Summary of Changes and Cross-Module Synergy

This integration combines four verified subsystems and adds cross-module synergy and sound search pruning:

1. **Scale and graph indexing (`eliza/engine-scale`):**
   - `embed.ts`: Clause-scoped negation-aware local feature hashing (`localEmbed`), 4-way unrolled `cosine`, and `Float64Array` `centroid`.
   - `spatialIndex.ts` and `retrieval.ts`: Adult-only (`canBeMatched`, `ADULT_AGE`) hex spatial grid, 168-bit weekly availability POPCNT masks, IDF tag postings, multi-facet SimHash LSH, and fail-closed `Int16Array` `[30000, 0]` romance bounds.
   - `leiden.ts` and `world.ts`: Adult-only CSR Leiden partitions (`micro` $\gamma=2.5$, `meso` $\gamma=1.0$), local dynamic updates, Burt brokerage (`1 - C_i`), Adamic-Adar 2-hop scores, and lazy `World` embeddings (`LazyVectorMap`, lazy `facetEmb`/`profileEmb`/`capEmb`/`desireEmb`/`revision`).
   - `config.ts`, `engine.ts`, `judgeCommon.ts`, `judgeScreen.ts`, `packages/network/service/{runtime,snapshot}.ts`: Single-pass stable serialization (byte-identical hashes), WeakMap screen cache, cursor queue, `Set` deduplication, and `turnLeakIndex`.

2. **Market clearing, status beliefs, and group coalition scoring (`eliza/theory-status`):**
   - `sinkhorn.ts`: Flat CSR sparse Choo-Siow quadratic-root IPFP (`solveChooSiowIPFP`) in $O(T \cdot |E|)$ with outside option $\mu^*_{i,0} = A_i^2 > 0$, shadow prices $\lambda_i = -2\beta \ln A_i$, `p80ShadowPrice`, and MIPS shadow vectors (`exportMipsShadowVectors`).
   - `status.ts`: Adult-only ephemeral 6-dimensional `StatusBelief` (`[phys, econ, cult, soc, warm, pot]`), seed-anchored `solveEigenTrust`, out-degree-normalized Jacobi-CG `solveSpringRank`, chronological `glicko2SingleUpdate`, vertical PAM/NAM/parity/warmth kernels, strict `slop`-only physical dimension wall (`physDimensionWeight`), and `explorationPairAllowed`.
   - `match/circles.ts`, `group.ts`, `scoring.ts`, `policy.ts`, `packs/slop/{assign,standing,profile}.ts`: Member-weighted least-pair-value growth and MFHG Geometric Nash Social Welfare scoring (`circleOracle` rises from `0.607 -> 0.901` on `ntwrk` and `0.643 -> 0.886` on `friends`), shared deterministic market equilibrium across `selectProposals` and `blockingPairs` (`blockingPairs = 0`), Protected Thompson Sampling in exploration, and Sinkhorn-assisted congestion clearing in `slopAssign`.

3. **Multi-dimensional human vectors and 17-type connection ontology (`eliza/vectors-ontology`):**
   - `humanVector.ts`: Adult-only `HumanVector` (`vectorEligible`), strict `slop`-only `aestheticReadAllowed`, NYC LL 144 `peonCapitalAllowed` firewall, fail-closed `discretionGateOk`, `stepAheadDeltaOk`, `spendTierCompatible`, `venueCostFitsTier`, `parentSupportSafe`, and single-player `classifyEmptyStateRemedy` (`involvesOtherMembers: false`).
   - `packs/network/{vocabulary,taxonomy,ontology,vectors,generators}.ts`, `packs/friends/{vectors,generators,planner}.ts`, `packs/peon/match.ts`, `packs/slop/appearance.ts`: 17 connection ontology specs (`CONNECTION_ONTOLOGY_SPECS`), `hv:*` signal bridge, `pairPassesVectorGuard`, adult budget-safe venue selection, job-related `workStylePaceDelta` on `peon`, and `photoReadinessDiagnostic` (reads only `gate.*`/`aux.*` fields under `canRatePhotos` and `aestheticReadAllowed`).

4. **Expanded multi-strata simulator worlds (`eliza/sim-worlds`):**
   - Multi-strata adult personas, asymmetric Bruch-Newman tier acceptance, grift/extraction ground-truth diagnostics, `hv:*` public tag projection (strictly skipped for minors, posers, planted worlds, scripted scenarios, and slop-only worlds), and `qualityBreakdown` / `assortativity` / `matchQuality` / `strataQuality` metrics across all four worlds.

5. **Cross-module synergy and hill-climbed pruning (`integrator-2`):**
   - `packages/engine/src/index.ts` and `packages/engine/src/packs/slop/index.ts`: Export all new public modules and symbols with zero name collisions.
   - `packages/engine/src/status.ts`: Enriches adult cold-start priors (`!w.minors.has(id) && canComputeStatus(...)`) with Leiden Burt brokerage (`World.brokerage`, social capital prior) and `HumanVector` verified craft rungs (`peonCapitalAllowed("domain_craft")`), propagated vouch quality, explicit economic tier (excluded on `peon`), and behavioral extraction risk / discretion penalties. Keeps `phys` strictly walled inside `slop`, `peon` strictly free of physical/wealth/pedigree proxies, and minors strictly excluded.
   - `packages/engine/src/humanVector.ts`: Reuses `World.brokerage`, converts `horizontal.embeddings` to lazy getters, compiles `HumanVector` lazily per queried member, guards language regexes with `LANG_HINT_RE`, and exports `memberMayHavePositiveVectorBonus`.
   - `packages/engine/src/packs/{network,friends}/vectors.ts`: Adds sound zero-allocation `packBound` and 2-class `packClasses` (`0` = no positive explicit signals, `1` = has positive explicit signals) to restore exact baseline pruning tightness (`0` `packBoundViolations`, `0` `classCapViolations`, `0` `boundViolations`).

---

## 2. BEFORE vs AFTER: Expanded Multi-Strata Worlds

- **BEFORE command and commit:** `REPO_ROOT=.../wt2-sim-worlds node --import tsx --conditions eliza-source .../scratch/bench-expanded-sim.ts --out .../scratch/logs/expanded-eliza-before.json` (`41edca896e4b02518291fb7df5e438aca2718b32`, baseline engine on `1b0f3d421`)
- **AFTER command and commit:** `REPO_ROOT=.../wt2-integrated node --import tsx --conditions eliza-source .../scratch/bench-expanded-sim.ts --out .../scratch/logs/expanded-eliza-after.json` (`feat/nextgen-matching-eliza`)
- **Model:** Deterministic simulator (no LLM calls); calibration checks verified `hiddenKeysLeakedInSnapshot = 0`, `shareableCanaryLeaks = 0`, `minorMatchableFacets = 0`, `minorProposalUnsafe = true` on both BEFORE and AFTER.

### 2.1 Simulated World (`150 personas, 30 days, discrete, StubNetwork`, seeds 1-3 mean)

| Metric | BEFORE (`41edca896`) | AFTER (Integrated) | Delta |
|---|---:|---:|---:|
| Proposals / seed | 78.67 | 95.67 | +17.00 (+21.6%) |
| **Precision vs oracle** | **38.6%** | **48.3%** | **+9.7 pp** |
| **Mean oracle quality** | **0.551** | **0.569** | **+0.018** |
| **Pair recall** | **4.4%** | **6.9%** | **+2.5 pp (+56.8%)** |
| **Member recall** | **29.3%** | **42.0%** | **+12.7 pp (+43.3%)** |
| **Engine welfare** | **24.28** | **33.79** | **+9.51 (+39.2%)** |
| **OracleGap ratio (`engine / oracle`)** | **34.5%** | **41.1%** | **+6.6 pp** |
| Worthwhile interruption rate | 62.2% | 66.6% | +4.4 pp |
| Meetings held / seed | 12.67 | 13.00 | +0.33 |
| Mean enjoyment | 0.694 | 0.679 | -0.015 |
| Fairness: Gini | 0.603 | 0.567 | -0.036 (better) |
| Fairness: Zero-proposal share | 42.4% | 37.1% | -5.3 pp (better) |
| Fairness: Top-10% share | 35.9% | 32.1% | -3.8 pp (better) |
| **Status mismatch rate** | **10.6%** | **4.1%** | **-6.5 pp (-61.3%)** |
| **Grift exposure count / seed** | **2.33** | **0.33** | **-2.00 (-85.7%)** |
| **Top-decile overload share** | **10.5%** | **7.6%** | **-2.9 pp (-27.6%)** |
| Safety (`canary / minor / invariants`) | **0 / 0 / 0** | **0 / 0 / 0** | **0** |

Richness + quality churn (seed 1): `statusMismatchRate` `8.0% -> 0.0%`, `griftExposureCount` `1 -> 0`, `topDecileOverloadShare` `10.4% -> 5.7%`, `optOuts = 0`, `canaryLeaks = 0`, `minorContacts = 0`.

### 2.2 ConsentNetwork (`experiment.ts --days 21 --seed 1`, `consent` arm)

| Metric | BEFORE (`41edca896`) | AFTER (Integrated) | Delta |
|---|---:|---:|---:|
| **Precision (revealed)** | **46.9%** | **55.0%** | **+8.1 pp** |
| Precision (started) | 30.6% | 32.3% | +1.7 pp |
| Probe yes rate (opt-in) | 43.4% | 45.9% | +2.5 pp |
| Invite accept rate | 92.6% | 94.4% | +1.8 pp |
| Proposals all-yes rate | 86.4% | 90.0% | +3.6 pp |
| Meetings held | 51 | 52 | +1 |
| **Mean enjoyment** | **0.574** | **0.595** | **+0.021** |
| Scorecard: worthwhile / completion | 35.4% / 77.5% | 36.6% / 78.5% | +1.2 pp / +1.0 pp |
| Request fulfill rate | 21.7% | 22.8% | +1.1 pp |
| **Status mismatch rate** | **4.9%** | **2.5%** | **-2.4 pp (-49.0%)** |
| **Grift exposure count** | **2** | **1** | **-1 (-50.0%)** |
| Top-decile overload share | 12.4% | 9.4% | -3.0 pp (-24.2%) |
| Group least-misery mean | 0.000 | 0.406 | +0.406 |
| Bottom-40% accept rate | 47.2% | 49.4% | +2.2 pp |
| Acceptance by tier quartile (`q1 / q2 / q3 / q4`) | `0.372 / 0.368 / 0.326 / 0.316` | `0.432 / 0.404 / 0.417 / 0.360` | all +3.6 to +9.1 pp |
| Meeting Gini / Zero-proposal share | 0.744 / 57.2% | 0.740 / 56.2% | -0.004 / -1.0 pp |
| Adversaries restricted | 7/8 | 7/7 | 100% |
| Safety (`invariants / canaryLeaks / minorContacts`) | **0 / 0 / 0** | **0 / 0 / 0** | **0** |

### 2.3 Per-App Worlds (`slop` seeds 13-16, `peon` seeds 13-16, `friends` seeds 5-8)

| App & Metric | BEFORE (`41edca896`) | AFTER (Integrated) | Delta |
|---|---:|---:|---:|
| **`slop`** Dates / seed (`dates/mm`) | 86.25 (0.214) | 88.25 (0.219) | +2.00 (+0.005) |
| **`slop`** Good-date rate | 40.5% | 42.4% | +1.9 pp |
| **`slop`** **Second-date rate** (`vs random`) | **26.7%** (4.05x) | **27.9%** (4.22x) | **+1.2 pp** |
| **`slop`** **Second dates / seed** | **23.0** | **24.5** | **+1.5 (+6.5%)** |
| **`slop`** Soft second-date rate / mean quality | 23.3% / 0.425 | 24.6% / 0.438 | +1.3 pp / +0.013 |
| **`slop`** Back-out rate at reveal | 5.0% | 4.7% | -0.3 pp (better) |
| **`slop`** Mean desirability gap / cross-tier mismatch | 1.077 / 26.6% | 1.059 / 25.6% | -0.018 / -1.0 pp |
| **`slop`** Bottom-40% date rate / 2nd-date rate | 18.0% / 23.4% | 18.7% / 26.5% | +0.7 pp / +3.1 pp |
| **`slop`** Harm events cut / scam cut / minors / filter viol. | 92% / 100% / 0 / 0 | 93.2% / 100.0% / 0 / 0 | PASS / PASS / 0 / 0 |
| **`peon`** **Hires / seed** (`vs keyword / oracle`) | **43.75** (1.04x / 0.89x) | **44.25** (1.05x / 0.90x) | **+0.50** |
| **`peon`** Qualified share / interviews per hire | 62.7% / 3.912 | 62.9% / 3.905 | +0.2 pp / -0.007 |
| **`peon`** Demonstrated craft / work-pace alignment | 42.8% / 0.732 | 42.9% / 0.744 | +0.1 pp / +0.012 |
| **`peon`** Official gates (`pooled impact`, `minors`) | 10/10 PASS (0.95, 0) | 10/10 PASS (0.95, 0) | 10/10 PASS |
| **`friends`** Meetups / repeat / V14 / friendship track | 188.5 / 32.7% / 33.9% / 11.3% | 188.5 / 32.7% / 33.9% / 11.3% | Exact parity |
| **`friends`** Official gates (`minors`, `known adv.`, `openness`) | 9/9 PASS (0 / 0 / 0) | 9/9 PASS (0 / 0 / 0) | 9/9 PASS |

---

## 3. BEFORE vs AFTER: Scale Benchmark (`N = 150..6000`, `seed = 42`)

- **Command:** `REPO_ROOT=<root> node --expose-gc --import tsx --env-file-if-exists=.env --conditions eliza-source .../scratch/bench-eliza-scale.ts --json <out>`
- **BEFORE:** `1b0f3d421769c0fe11fcf9665462dd5d0a4e8957` (`scratch/logs-eliza/bench-eliza-before.json`)
- **AFTER:** `feat/nextgen-matching-eliza` (`scratch/logs-eliza/bench-eliza-after.json`)

| Pack | N | Index ms (Before -> After) | Wall ms (Before -> After) | Heap $\Delta$ MB (Before -> After) | Search checks (Before -> After) | Budgeted (Before -> After) | Blocking Pairs |
|---|---:|---:|---:|---:|---:|---:|---:|
| `network` | 150 | 21.4 -> 13.2 (1.6x) | 100.4 -> 252.8 | 14.7 -> 15.5 | 1,117 -> 1,117 | 0 -> 0 | 0 |
| `network` | 500 | 45.8 -> 9.9 (4.6x) | 209.8 -> 439.1 | 46.4 -> 20.4 | 6,463 -> 6,463 | 0 -> 0 | 0 |
| `network` | 1500 | 120.1 -> 43.7 (2.7x) | 516.3 -> 1371.9 | 93.2 -> 70.5 | 20,886 -> 20,893 | 0 -> 0 | 0 |
| `network` | 3000 | 234.7 -> 65.9 (3.6x) | 1076.2 -> 2358.7 | 129.2 -> 121.1 | 46,186 -> 46,273 | 0 -> 0 | 0 |
| `network` | 6000 | **489.0 -> 148.4 (3.3x)** | 2536.8 -> 5873.1 | **320.9 -> 266.8** | 110,105 -> 110,321 | 0 -> 0 | **0** |
| `slop` | 150 | 16.8 -> 4.6 (3.7x) | 74.5 -> 97.3 | 20.4 -> 16.2 | 544 -> 544 | 0 -> 0 | 0 |
| `slop` | 500 | 49.7 -> 13.9 (3.6x) | 250.8 -> 403.5 | 40.8 -> 32.9 | 6,189 -> 6,189 | 0 -> 0 | 0 |
| `slop` | 1500 | 144.7 -> 47.6 (3.0x) | 1139.7 -> 1814.4 | 137.1 -> 101.9 | 48,765 -> 48,765 | 0 -> 0 | 0 |
| `slop` | 3000 | 289.7 -> 93.7 (3.1x) | 3739.5 -> 6179.9 | 269.6 -> 239.0 | 145,350 -> 145,350 | 52 -> 52 | 0 |
| `slop` | 6000 | **576.5 -> 187.0 (3.1x)** | 14926.8 -> 22610.0 | **552.7 -> 494.2** | 415,120 -> 415,120 | 894 -> 894 | **0** |
| `peon` | 150 | 29.9 -> 6.3 (4.7x) | 66.0 -> 76.4 | 16.3 -> 18.9 | 300 -> 300 | 0 -> 0 | 0 |
| `peon` | 500 | 70.1 -> 11.6 (6.0x) | 221.1 -> 372.1 | 36.7 -> 43.0 | 3,852 -> 3,852 | 0 -> 0 | 0 |
| `peon` | 1500 | 253.5 -> 39.2 (6.5x) | 1022.8 -> 1694.6 | 150.1 -> 100.1 | 26,044 -> 26,030 | 0 -> 0 | 0 |
| `peon` | 3000 | 452.0 -> 71.7 (6.3x) | 2795.0 -> 4087.5 | 316.5 -> 244.4 | 77,137 -> 76,980 | 0 -> 0 | 0 |
| `peon` | 6000 | **832.2 -> 139.3 (6.0x)** | 7605.0 -> 12647.8 | **449.4 -> 364.9** | 215,988 -> 215,229 | 0 -> 0 | **0** |
| `friends` | 150 | 13.8 -> 7.7 (1.8x) | 141.1 -> 275.7 | 34.1 -> 47.0 | 1,615 -> 1,615 | 0 -> 0 | 0 |
| `friends` | 500 | 43.3 -> 10.8 (4.0x) | 391.4 -> 708.9 | 73.7 -> 59.1 | 7,867 -> 7,867 | 0 -> 0 | 0 |
| `friends` | 1500 | 118.5 -> 47.8 (2.5x) | 1165.3 -> 2284.1 | 171.2 -> 138.1 | 28,637 -> 28,637 | 6 -> 6 | 0 |
| `friends` | 3000 | 261.4 -> 79.9 (3.3x) | 2520.6 -> 4657.9 | 260.2 -> 232.6 | 53,775 -> 53,775 | 5 -> 5 | 0 |
| `friends` | 6000 | **1018.2 -> 125.0 (8.1x)** | **14674.3 -> 11469.8 (-21.8%)** | **504.1 -> 377.6** | **106,156 -> 106,156** | 90 -> 91 | **0** |

All 20 runs report `boundViolations = 0`, `packBoundViolations = 0`, `classCapViolations = 0`, and `blockingPairs = 0`. At `N=6000`, `World` indexing is **3.1x to 8.1x faster** and heap delta drops **11% to 25%** across all four packs. Generation time reflects the added 2-pass MFHG circle swap refinement (`circleOracle` +24 to +29 pp) and per-run `StatusBelief` + Choo-Siow IPFP clearing, while `friends N=6000` total wall time drops 21.8% below baseline.

---

## 4. Measured Hill-Climbing Log

| Iter | Hypothesis & Change | Measured Effect | Decision |
|---|---|---|---|
| **0 (Merged + Synergy)** | Merge 4 branches; share `World.brokerage` in `humanVector.ts`; make `horizontal.embeddings` lazy; enrich adult priors in `status.ts` with Leiden brokerage and `HumanVector` craft/vouch/extraction risk. | World precision `38.6% -> 48.3%`, grift `2.33 -> 0.33`, consent precision `46.9% -> 55.0%`, slop 2nd-date `26.7% -> 27.9%`, peon hires `43.75 -> 44.25`. Bottleneck found: `friends N=6000` checks rose `106,156 -> 286,424` (`budgeted 90 -> 153`) because `packValue` lacked `packBound` and `packClasses`. | **Keep** (base for Iter 1) |
| **1a (Naive `packBound` + lazy `HumanVector`)** | Add lazy per-member `humanVectorOf` + `LANG_HINT_RE` + sound `packBound`/`packClasses` calling `baseFriendUtility` and `humanVectorOf`. | `friends N=6000` checks dropped `286,424 -> 106,156` (-63%), `budgeted 153 -> 91`; `network N=6000` checks dropped `146,479 -> 110,321` (-25%). However, `friends N=6000` gen rose `12.8s -> 29.8s` due to 16.8M array allocations and `WeakMap` lookups inside `packBound`. | **Superseded by 1b** |
| **1b (Zero-alloc `packBound` + `packClass` fast path)** | Inline integer `baseFriendUtility`/`baseDirectedUtility`, add `memberMayHavePositiveVectorBonus` for 2-class `packClasses`, and short-circuit `packBound` in O(1) when `(a.packClass \| b.packClass) === 0`. | `friends N=6000` wall dropped `30.8s -> 11.47s` (**2.68x faster than 1a, 21.8% faster than `1b0f3d421` baseline**); `network N=6000` dropped `6.15s -> 5.87s`; `0` bound/packBound/classCap violations; 100% lossless quality parity on `bench-expanded-sim.ts`. | **Accepted** |
| **2 (Skip `worldStatusPairMultipliers` on `peon`)** | Test skipping `worldStatusPairMultipliers` in `scoring.ts` when `w.pack.id === "peon"` to see if `peon` QoH and impact ratio improve. | On `peon` seeds 13-16: hires dropped `44.3 -> 43.8` (-0.5), qualified share dropped `62.9% -> 62.7%`, work-pace alignment dropped `0.744 -> 0.736`, offer acceptance dropped `76.5% -> 74.6%`, pooled impact ratio stayed `0.95`. | **Rejected** (reverted; `peonCapitalAllowed`-guarded priors help `peon`) |

---

## 5. Held-Out / Untuned Seeds Validation (`CONTRIBUTING.md §7.3`)

Paired BEFORE (`wt2-sim-worlds` @ `41edca896`) vs AFTER (`wt2-integrated`) on completely untuned seeds:

| World & Seeds | Metric | BEFORE (`41edca896`) | AFTER (Integrated) | Delta |
|---|---|---:|---:|---:|
| **`cli.ts` (`150p x 30d`, seeds 7-9 mean)** | **Precision vs oracle** | **34.7%** | **48.6%** | **+13.9 pp** |
| `cli.ts` (seeds 7-9) | Mean oracle quality | 0.466 | 0.538 | +0.072 |
| `cli.ts` (seeds 7-9) | Pair recall / Member recall | 5.3% / 35.5% | 8.1% / 47.1% | +2.8 pp / +11.6 pp |
| `cli.ts` (seeds 7-9) | **Engine welfare / OracleGap ratio** | **24.88 / 34.4%** | **41.08 / 45.3%** | **+65.1% / +10.9 pp** |
| `cli.ts` (seeds 7-9) | Worthwhile interruption rate | 61.8% | 72.6% | +10.8 pp |
| `cli.ts` (seeds 7-9) | Meetings held / share with nothing | 9.33 / 92.5% | 15.00 / 86.5% | +60.8% / -6.0 pp |
| `cli.ts` (seeds 7-9) | Fairness Gini / Zero-proposal share | 0.595 / 38.1% | 0.564 / 34.3% | -0.031 / -3.8 pp |
| `cli.ts` (seeds 7-9) | Status mismatch / Bottom-40% accept | 3.6% / 36.5% | 1.1% / 47.9% | -2.5 pp / +11.4 pp |
| `cli.ts` (seeds 7-9) | Safety (`canaryLeaks / minorContacts`) | 0 / 0 | 0 / 0 | 0 / 0 |
| **`slop` (`packEval.ts --gates3`, seeds 21-24)** | **Second-date rate** (`vs random`) | **21.8%** (3.32x) | **23.4%** (3.57x) | **+1.6 pp** |
| `slop` (seeds 21-24) | Second dates / seed (`soft 2nd`) | 18.0 (18.5) | 19.5 (19.8) | +1.5 (+1.3) |
| `slop` (seeds 21-24) | Good-date rate / mean quality | 33.8% / 0.397 | 36.5% / 0.413 | +2.7 pp / +0.016 |
| `slop` (seeds 21-24) | Desirability gap / cross-tier mismatch | 1.12 / 28.7% | 1.06 / 26.3% | -0.06 / -2.4 pp |
| `slop` (seeds 21-24) | Harm events / harm-cut gate | 5.0 (89.4%, FAIL) | 4.5 (90.3%, PASS) | Flipped to PASS |
| **`peon` (`cli.ts`, seeds 21-24)** | **Hires / seed** (`vs keyword / oracle`) | **38.0** (1.06x / 0.87x) | **38.5** (1.07x / 0.88x) | **+0.50** |
| `peon` (seeds 21-24) | Demonstrated craft / work-pace / pooled impact | 41.6% / 0.756 / 0.94 | 41.9% / 0.759 / 0.95 | +0.3 pp / +0.003 / +0.01 |
| `peon` (seeds 21-24) | Official gates (`minors`) | 10/10 PASS (0) | 10/10 PASS (0) | 10/10 PASS |
| **`friends` (`cli.ts`, seeds 9-12)** | Meetups / repeat / V14 / travel / minors / adv. | 186.5 / 27.3% / 33.2% / 25.6m / 0 / 0 | 186.5 / 27.3% / 33.2% / 25.6m / 0 / 0 | Exact parity, 1.4x faster |

Note on `cli.ts` seed 7 `StubNetwork` invariant: `StubNetwork` (the uncapped push baseline) recorded `over_budget = 1` for `m0063` (normal, budget 2 per 7 days). Root-cause trace: the engine proposed `p_32f6b069195e990d` at `t = 1792054800000` and `p_3878b884256396cf` at `t = 1792659600000` (exactly `604,800,000 ms = 7.000 days` apart, so the engine's `age < 7 * DAY` window correctly counted 1 prior proposal). Because `StubNetwork` delayed delivery of the first invite by 10 hours (waiting for the first responder) and delivered the third invite after 8 hours, the delivery gap was `6.919 days < 7 days` with no send-time attention cap. `ConsentNetwork` enforces send-time attention caps and recorded `0` invariant violations across all seeds.

---

## 6. Full Official Validation Matrix

| Check | Command | Result |
|---|---|---|
| Typecheck | `corepack pnpm@10.24.0 run typecheck` | **PASS** (0 errors across all workspaces) |
| Generated spec check | `corepack pnpm@10.24.0 run spec:check-generated` | **PASS** (`270/270` artifacts unchanged) |
| Contract mirror | `corepack pnpm@10.24.0 run check:mirror` + `packages/core/test/contract-mirror.test.ts` | Upstream `elizaos/eliza@develop` migrated to VibeLang (exits 2); offline mirror test **PASS (2/2)** |
| Quint formal models | `corepack pnpm@10.24.0 run quint:check` | **PASS** (`32 models, 0 failures, 18 jobs, 1922s`) |
| Plugin snapshots | `node --import tsx --env-file-if-exists=.env plugins/build.ts --check` | **PASS** (`plugin skill snapshots are up to date`) |
| Relay evaluation | `corepack pnpm@10.24.0 run relay-eval` | **PASS** (offline cache; shipped bank tuning rules+Clef 100% recall, 0.0% honest held; heldout-2 100%/90%/100%/100% recall, 4.0% honest held) |
| Security suite (`REQUIRE_PG=1`) | `REQUIRE_PG=1 corepack pnpm@10.24.0 run security` | **PASS** (`11/11` files, `291/291` tests, 72.0s) |
| End-to-end suite (`REQUIRE_PG=1`) | `REQUIRE_PG=1 corepack pnpm@10.24.0 run test:e2e` | **PASS** (`16 passed`, `5 skipped`, `145 passed`, `8 skipped`, `0 failed`, 60.2s) |
| Integration suite (`REQUIRE_PG=1`) | `REQUIRE_PG=1 corepack pnpm@10.24.0 run test:integration` | `338 passed, 10 failed, 1 skipped` (`2789 passed, 13 failed, 7 skipped`). Breakdown: 9 files are pre-existing upstream drifts on `1b0f3d421` in untouched packages (`mcp`, `signup-draft-prefill`, `venue-coverage`, `friends-repeat-rate-na`, `line-routing`, `notify-inbox`, `relay`, `staging-authority`, and `apps/observatory/test/reviewed-proposal-count.integration.test.ts`, confirmed failing identically on `wt2-sim-worlds` and `wt2-engine-scale`); 1 file (`packages/network/test/experiment-acceptance.integration.test.ts`) fails identically on `eliza/sim-worlds` (`41edca896`) because the expanded Oracle had 0 explicit counters in 7d seed 1. |
| Full `sim` (`REQUIRE_PG=1`) | `REQUIRE_PG=1 corepack pnpm@10.24.0 run sim` | **643/644 blocking gates PASS**, 0 Postgres skips, 3833.3s. All 14 touched/engine/network/world/Postgres blocks pass 100%: `evals` 40/40 (1.1s), `onboard` 23/23 (0.8s), `network` 123/123 (536.4s), `matching` 116/116 incl. N=100k ladders (2926.5s), `slop` 57/57 (95.8s), `peon` 30/30 (15.2s), `peon-seats` 23/23 (0.8s), `friends` 67/67 (176.0s), `clef` 10/10 (1.2s), `safety` 18/18 (6.4s), `ops` 17/17 (2.6s), `pipeline` 15/15 (5.2s), `pipeline-slop` 14/14 (47.8s), `audit` 18/18 (16.6s). Single failure: `relay` 72/73 (`"My son is a 16-year-old"` expected `pass`, got `block`), verified pre-existing on unmodified `1b0f3d421` relay code (`wt2-sim-worlds` fails identically). |
| Real-LLM verification (`§7.2`) | `node --import tsx --conditions eliza-source packages/sim/src/cli.ts --personas 6 --days 3 --seed 2 --llm --engine ./packages/sim/src/engineAdapter.ts --judge 10 --no-log` | **Blocked on empty key:** `/Users/nubs/thenetwork-vibestack-pr-review-20261122/.env` defines `SURPLUS_API_KEY` with length `0` and no `OPENAI_API_KEY` is present in the environment. Ready to run as soon as a live `SURPLUS_API_KEY` is supplied. |

---

## 7. Design Defense: Alternative Implementations Considered (`CONTRIBUTING.md §12`)

### 7.1 Spatial Index and Community Detection (`spatialIndex.ts`, `leiden.ts`)
- **Chosen design:** Pure TypeScript deterministic H3-like hex cells, 168-bit POPCNT weekly masks, multi-facet SimHash LSH, and adult-only CSR Leiden + Burt brokerage lazily cached on `World`.
- **Alternative 1 (External native extensions — `h3-js` + `graphology` + `hnswlib-node`):** Rejected because native addons add cross-platform build risk, non-deterministic floating-point/thread ordering (violating ME-004 determinism), and require wrapping every call with minor/block filters.
- **Alternative 2 (Database-backed `pgvector` + PostGIS queries inside the engine):** Rejected because the engine must stay pure, deterministic, and runnable offline in `pnpm run sim` without I/O (`AGENTS.md` architecture rule: pure decisions in engine, persistence in shell).

### 7.2 Market Clearing and Multi-Dimensional Status (`sinkhorn.ts`, `status.ts`, `policy.ts`)
- **Chosen design:** Flat CSR sparse Choo-Siow quadratic-root IPFP (`O(T * |E|)`) coupled with an adult-only ephemeral 6D `StatusBelief` (EigenTrust + Jacobi-CG SpringRank + Glicko-2) feeding one shared deterministic `marketContextFor` into `selectProposals` and `blockingPairs`.
- **Alternative 1 (Exact Integer Linear Programming / Min-Cost Max-Flow matching via OR-Tools or HiGHS WASM):** Rejected because ILP violates the generated `selectionRun` greedy monotonicity invariant (`blockingPairs === 0` with monotonic `greedyBound`), adds heavy WASM dependencies, and scales poorly beyond `N=3000` with pairwise time-conflict constraints.
- **Alternative 2 (Single scalar Elo / Bradley-Terry standing shared across all four apps):** Rejected because it collapses orthogonal capitals (economic, cultural/craft, social, warmth, potential), leaks dating appearance into non-dating apps, violates the NYC LL 144 `peonCapitalAllowed` firewall, and cannot express non-assortative complementary exchanges (such as step-ahead mentorship or patronage).

### 7.3 HumanVector, 17-Type Ontology, and Search Pruning (`humanVector.ts`, `packs/{network,friends}/vectors.ts`)
- **Chosen design:** Lazy per-member `HumanVector` compilation gated on `vectorEligible` (`canBeMatched`, `ADULT_AGE`), paired with zero-allocation sound `packBound` and 2-class `packClasses` (`memberMayHavePositiveVectorBonus`) in `MatchRun`.
- **Alternative 1 (Materialized `HumanVector` columns persisted in Postgres and fed through `WorldSnapshot`):** Rejected because persisting inferred status/capital/extraction scores violates the ephemeral-privacy rule, creates stale cache divergence across runs, and breaks the existing `WorldSnapshot` wire contract.
- **Alternative 2 (Post-search reranking outside `MatchRun` without `packValue` / `packBound`):** Rejected because `MatchRun`'s bounded search keeps only the top `searchLimit` (8-12) candidates per member; without `packValue` inside `MatchRun`, high-value step-ahead mentors, cross-class guilds, and discretion-safe matches can be pruned before reranking ever sees them, whereas adding `packValue` with tight sound `packBound` + `packClasses` gives both exact top-K recall and baseline search speed.

### 7.4 Expanded Multi-Strata Simulation (`packages/sim/src/*`)
- **Chosen design:** Multi-strata hidden attributes (`Persona.hidden`) strictly walled inside `packages/sim`, with opt-in `ORACLE_PARAMS.strataEffects` (`false` default on `friends`) and public `hv:*` facet projection skipped on minors, posers, planted worlds, scripted scenarios, and slop-only worlds.
- **Alternative 1 (Separate standalone benchmark simulator outside `packages/sim`):** Rejected because a separate simulator would drift from production `engineAdapter`, `ConsentNetwork`, `LeakGuard`, and `teen_stop_equals_pre_feature` invariants.
- **Alternative 2 (Always-on strata oracle overrides across all existing `friends` seeds):** Rejected because it would shift legacy golden baselines and break `teen_stop_equals_pre_feature` parity on the existing `friends` validation block.
