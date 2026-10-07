# PoC: H3 cell travel-time heuristic (P15)

**Question:** can the engine estimate travel time between two members from coarse H3 res-8 cells (the precision we store under SEC-004) without calling a maps API for every candidate pair? P15 exit criterion: estimates within 25% of a maps API.

**Method:** 80 random pairs (40 SF, 40 NYC) jittered around 20 neighborhood centers per city. The engine side sees only the res-8 cell centers; the reference side routes the true endpoints. Model: `minutes = overhead + km * min_per_km`, fitted per mode and city on half the pairs and tested on the other half. References: public OSRM (car, free-flow, no traffic) and routing.openstreetmap.de (foot, bike), at 1 req/s. Run: `PAIRS=80 bun run run.ts` (responses cached in cache.json).

| Mode | City | Pairs (test) | Fitted min/km | Overhead min | Median abs err | Within 25% | Within 25% (trips > 10 min) |
|---|---|---|---|---|---|---|---|
| car | SF | 20 | 1.84 | 2.2 | 17% | 60% (n=20) | 78% (n=9) |
| car | NYC | 20 | 1.52 | 4.0 | 11% | 95% (n=20) | 100% (n=15) |
| foot | SF | 20 | 15.75 | 2.7 | 5% | 100% (n=20) | 100% (n=20) |
| foot | NYC | 20 | 14.11 | 5.1 | 6% | 95% (n=20) | 95% (n=20) |
| bike | SF | 20 | 5.18 | 1.3 | 12% | 95% (n=20) | 94% (n=18) |
| bike | NYC | 20 | 4.84 | 4.4 | 7% | 85% (n=20) | 94% (n=18) |

**Reading:**
- Walking and biking: the heuristic meets the 25% bar from res-8 cells (85-100% of pairs). Good enough for hard filters and scoring.
- Driving: fine in NYC; in SF only 60% of all pairs (78% of trips over 10 minutes). Short SF drives are dominated by one-way streets and hills. OSRM is free-flow, so real traffic error is larger.
- **Not validated: transit**, which is the dominant mode for NYC members and common in SF. No free router covers it here. Next step: Google Routes or Transitland/OTP with GTFS for MUNI/BART/MTA on ~200 pairs, then a per-city transit fit.
- **Recommendation:** use the per-city heuristic for retrieval and filters (no API calls). Call a maps API only for finalists (venue choice, 32.12), as P15 already plans. Fit the coefficients from cached finalist calls over time.
