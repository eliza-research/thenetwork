# POC P14: event ingestion for SF and NYC (results)

**Question:** Can we ingest at least 200 future events per week per city for San Francisco and New York from public sources, legitimately and reliably, then normalize and dedupe them, without breaking anyone's terms?

**Short answer:** Mostly yes, with caveats.

- **NYC:** yes, through compliant sources alone. There were 460 unique events in the next 7 days, but most come from NYC Parks. Only about 66 are tech or social events.
- **SF:** yes this week (841 unique compliant events), but SF Tech Week inflates that number. In a normal week, compliant sources excluding Cerebral Valley give about 300 events (about 200 adult-audience), and most of those are library programs.
- **Relevance:** reaching 200 *relevant* (tech, professional, social) events per city every week needs one of two things: Cerebral Valley lifting its 760-row snapshot cap, or partnerships or API access with Luma, Eventbrite and Meetup.
- **Dedupe:** works. On 79 hand-labelled pairs, precision is 1.00 and recall 0.975. On the last held-out round, recall was 0.91.

Snapshot taken Tue 2026-10-06 ~17:00 UTC. Window: the next 7 days. All live fetches went through `src/http.ts`:

- Honest User-Agent: `TheNetworkEventsPOC/0.1 (The Network concierge research prototype; low-rate; respects robots.txt)`.
- robots.txt is fetched and parsed per origin, and disallowed paths are skipped. Groups are merged as RFC 9309 requires, and the longest match wins.
- At most 1 request per second per host.
- No logins, credentials, CAPTCHAs or bot-protection bypasses.

The ingestion run made 114 requests, all HTTP 200 (`data/fetch-log.json`). About 40 other requests were probes and terms-of-service reads.

> **Caveat on the week:** Oct 5-11 is SF Tech Week and NY AI Week. SF tech volume is several times normal. See "steady state" below.

## Per-source findings

The counts are unique events in the 7-day window that we could place in each city. "Green" means the source offers a public feed or API for this use. "Grey" means the endpoint is public and robots allows it, but it is not an advertised interface. "Restricted" means the ToS forbids automated extraction.

| Source | Method found | robots.txt | ToS (fetched; key clause) | SF 7d | NYC 7d | Fields available | Failure modes / notes | Verdict |
|---|---|---|---|---|---|---|---|---|
| **Cerebral Valley** | `llms-full.txt` (one fetch, refreshed hourly: date, title, city, type, outbound URL for every upcoming listing). City pages `/events/{city}` carry schema.org `ItemList` JSON-LD with exact times (20 items). | Allows public pages; `/api/` and `/auth/` disallowed. `llms.txt` invites agents: "for agents that want the whole site in one fetch". | No scraping or automated-access clause in its ToS (`/legal/terms`). | 552 | 40 | title, date (time only for the 20 JSON-LD items), city, category/type, url. No venue, geo or price. | **The snapshot is capped at the first 760 listings worldwide**, so this Tech Week it only reached Oct 8. The pagination API is under `/api/` and robots blocks it. Listings are mostly SF/AI-heavy. It acts as a meta-source: it links out to Partiful (463 SF), tech-week.com, Luma, Meetup and Eventbrite. | **Use now.** Ask CV for an uncapped feed or partnership; they are clearly agent-friendly. |
| **Luma: calendar ICS** | `https://api.lu.ma/ics/get?entity=calendar&id=cal-…` is the "Subscribe" feed every public Luma calendar offers. 88 calendars fetched. | Allowed (`api.lu.ma` disallows only `/insights/`). | Luma ToS forbids reusing "Site Content" except "through our publicly supported interfaces". ICS subscription is one. | 54 | 33 | title, start/end (99%), lat/lng (100%, GEO), venue/address (55%; hidden when the address is "guests-only"), url. No price or categories. | Coverage depends on which calendars we follow. Calendar ids were harvested from the discover JSON (grey). In production, use a curated list or ids found via CV's Luma links. ICS includes past events and events in other cities, so filter by GEO. | **Use now** with a curated calendar list (aim for 200+ SF/NYC community calendars). |
| **Luma: discover** | The JSON the public `luma.com/{city}` page itself calls (`api.lu.ma/discover/get-paginated-events?discover_place_api_id=…`). Also 20 events as `ItemList` JSON-LD on `luma.com/sf`. | Allowed; luma.com has no `*` rules. | Same clause as above. This is an undocumented internal endpoint, so not clearly a "publicly supported interface". The official Luma API is scoped to your own calendars and needs a Luma Plus key. | 37 | 24 | title, start/end, lat/lng (obfuscated to the neighbourhood when the address is guests-only), price/free, sold-out/waitlist, calendar, timezone. | City feeds are curated "popular" lists (SF `event_count` 78), not exhaustive. 50 entries covered about 8 days. All 61 events were also reachable via ICS. | **Grey.** Don't run in production without Luma's OK; ask for discover/API access. |
| **Eventbrite** | City browse pages (`/d/ca--san-francisco/events--this-week/`) embed `__SERVER_DATA__` (20/page, 49 pages) and `ItemList` JSON-LD. The public v3 `/events/search/` API is gone: HTTP 404 `NOT_FOUND`. | Browse pages are allowed. `/rss/`, `/atom/` and `/api/v3/destination/events/` are disallowed. | ToS §"Scraping or Commercial Use of Site Content is Prohibited": "scrape, crawl, or employ any automated means to extract data from the Sites". API ToS forbids building something "that competes with products or services offered by Eventbrite" and requires a link back plus deleting stored content on termination. | (40 / 19 from one probe page per city; the site reports **1,047 SF / 3,550 NYC events this week**) | | title, local start/end time, venue name, address, lat/lng, Eventbrite category/format, url. No price on browse pages. | Huge volume, but the ToS forbids automated extraction. With an API key you can only read events by organizer or venue id. | **Restricted.** Needs a partnership or affiliate/data deal. Parser kept for that case only. |
| **Meetup** | `/find/us--ca--san-francisco/` embeds schema.org `Event` JSON-LD (56 per page). The GraphQL API needs OAuth plus a Meetup Pro subscription. | Search URLs with `?source=`, `?keywords=`, `?dateRange=` and so on are disallowed. Group RSS/atom/xml feeds are disallowed. | ToS forbids extracting data "for a commercial purpose not permitted by these Terms" (screen/data/web scraping). | (36 / 32 from one probe page each) | | title, start/end, venue name, address, price (offers), url. No geo in JSON-LD. | Only one page per city is reachable without disallowed query params. | **Restricted.** Apply for API (Pro) access or a partnership. |
| **Partiful** | `/explore` `__NEXT_DATA__` holds only ~5 "trending" events per city. Event pages are invite-centric; there is no public discovery feed. | No `*` group, so generic crawlers are unrestricted. Blocks GPTBot, ClaudeBot, CCBot and other AI crawlers by name. | ToS bans "data mining, robots, scraping, or similar data gathering or extraction methods". | (1 / 0) | | title, start, venue, address (on explore) | Effectively no discovery surface. Partiful *links* do reach us via Cerebral Valley (463 SF this week) as link plus title plus date. | **Restricted.** Partnership only. Store CV-provided links, don't fetch pages. |
| **NYC Parks (NYC Open Data)** | Socrata SODA API, dataset `w3wp-dpdi` "NYC Parks Public Events – Upcoming 14 Days" (updated daily). No key needed at our volume. | Allowed (crawl-delay 1). | The terms page renders client-side and has no clause on reuse. The data is published on the city's open-data portal for reuse. The nycgovparks.org HTML returned 403 to us, so use the API. | 0 | 394 | title, start/end, park/location, lat/lng, categories (99%), url | Low professional relevance: fitness, kids, tours. 247 of the 394 are adult-audience. | **Use now** (add a Socrata app token). |
| **SFPL (library)** | Server-rendered `/events?page=N` (25 per page; 1,715 upcoming). | Allowed. | Public agency. No reuse restriction found on the site. | 235 | 0 | title, start/end, branch, audience, topics, free | Times print without am/pm ("9:00 - 5:00"), so am/pm is inferred (1-7 means pm). Many events are kids' programs (137 adult). | **Use**, filtered by audience. |
| **SF Rec & Park** | CivicPlus calendar RSS `RSSFeed.aspx?ModID=58`. | Allowed. | Public agency. Disclaimer page has no reuse restriction. | 13 | 0 | title, date, time, address | Only 29 items, about 2 weeks ahead | Use (small). |
| Venue sites probed | Commonwealth Club and Exploratorium returned 403. Gray Area and Funcheap have no Tribe Events REST API. Funcheap RSS lists only newly posted items (10). | — | — | — | — | — | Venue calendars need per-site work or ICS links. | Later, per venue. |

## Normalized schema and dedupe

`src/types.ts` defines `NormalizedEvent`, one row per source listing:

- `id` (`source:sourceId`), `source`, `url`, and `altUrls` (outbound links, used for link-based dedupe)
- `title`, `startsAt` (UTC), `startDate` (local), `hasTime`, `endsAt`, `timezone`, `city`
- `venueName`, `address`, `lat`, `lng`, `price`, `categories`, `online`
- `tos` (green / grey / restricted), `fetchedAt`

Following PRD 22.5, we store links and minimal metadata, not descriptions. City assignment uses geo bounding boxes (SF city proper; NYC's five boroughs) and falls back to locality text. Not built yet: H3 cells, embeddings and staleness rules.

`src/dedupe.ts` works in four steps:

1. **Exact merge:** the same Luma `evt-…` id across discover and ICS, or a row's URL appearing in another row's links (CV → Luma, Partiful, Meetup or Eventbrite).
2. **Blocking:** candidate pairs are compared only within the same (city, local date).
3. **Fuzzy score:**
   - Title similarity is the max of token Jaccard, character-trigram Dice, and prefix/tail containment, where "Org presents: Talk" matches "Talk". Containment needs two or more non-generic tokens.
   - Time agreement means start times within 30 minutes.
   - Venue agreement means geo distance of 250 m or less, or matching venue tokens with generic words removed.
4. **Vetoes:** pairs are not merged if they are on different days, more than 1.2 km apart, have a title score below 0.7, or have only title evidence scoring below 0.8.

Matching clusters are merged into one canonical row via union-find. The canonical row is the one with a time and geo, and it keeps every source URL.

**Counts (7-day window).** These include the one-page restricted probes, so the cross-source overlap can be measured.

| City | Rows (after same-id merge) | Unique events | Unique and reachable from a compliant source | Clusters with 2+ sources | Duplicate rate |
|---|---|---|---|---|---|
| SF | 968 | 915 | **841** (743 not kid-focused; 593 tech/social via Luma+CV) | 41 | 5.5% |
| NYC | 542 | 506 | **460** (313 not kid-focused; 66 tech/social) | 29 | 6.6% |

**Steady state (excluding Cerebral Valley, whose snapshot this week stops at Oct 8):**

| City | Compliant events | Adult-audience | Breakdown of adult-audience events |
|---|---|---|---|
| SF | 302 | 204 | Luma ICS 54, SFPL 137, Rec & Park 13 |
| NYC | 427 | 280 | NYC Parks 247, Luma ICS 33 |

Unique events seen *only* in grey or restricted sources (from just one probe page per city): SF 74, NYC 46. Eventbrite's own totals (1,047 SF / 3,550 NYC this week) show the true gap is much larger.

**Dedupe accuracy.** I hand-checked labels in three rounds and froze the rules before each new round.

| Round | Pairs | Precision | Recall | Notes |
|---|---|---|---|---|
| 1 | 30 | 0.80 | 1.00 | Baseline. False positives were same-day "COLM Happy Hour" variants from different hosts. |
| 2 | 29, unseen | 0.68 | 1.00 | Run after the round-1 fixes. False positives were event series ("Founder Reset: X" vs "Founder Reset: Y"), one club's chapters at different venues, and same-slot happy hours. |
| 3 | 20, unseen | 1.00 | 0.91 | Rules frozen after round 2. The one miss was "Techonomy26" vs "Techonomy 2026". |
| All | 79 | 1.00 | 0.975 | Current rules, after fixing the year-token and generic-venue-token bugs. The one remaining miss is a same-name build day with different subtitles, labelled moderate-confidence. |

There is also an objective check that doesn't depend on hand labels. For the 23 cross-platform pairs that share a URL, the fuzzy matcher with URLs hidden recovers 21 (recall 0.91). The 2 misses are an event renamed on Luma ("Claude Build Day" became "Claude Impact Lab"), which URL matching catches anyway.

Caveats on these labels:

- They were made by the agent, not a human. They use title, time, venue, host (from Luma JSON) and CV's description text. A few are marked moderate or low confidence in `why`.
- n=79 is far too small to *prove* precision ≥ 0.95. The 95% interval on 39/39 true positives reaches down to about 0.91.
- Before relying on the P14 exit criterion, label 200 or more pairs by hand.

Labels: `fixtures/dedupe-labels.json`. Sampled pairs per round: `data/dedupe-sample-round{1,2,3}.json`.

## Recommendation

1. **Ship with the green set:**
   - Cerebral Valley `llms-full.txt` (hourly)
   - Luma calendar ICS for a curated list of SF/NYC community calendars (12h refresh, matching their `X-PUBLISHED-TTL`)
   - NYC Open Data `w3wp-dpdi` (daily)
   - SFPL and SF Rec & Park (daily, filtered by audience)

   This passes 200 per week per city in raw count today. It passes for SF on relevance only in a heavy week.
2. **Partnerships or API keys, in priority order:**
   1. **Cerebral Valley:** lift the 760-row cap, or give us a feed or key. This is the cheapest relevance win, and they already aggregate Partiful, Luma and tech-week links.
   2. **Luma:** permission to use the discover endpoint, or partner API access. Luma is the main source for SF/NYC tech and social events.
   3. **Meetup:** Pro or partner GraphQL access.
   4. **Eventbrite:** data or affiliate partnership. Volume is huge, but scraping is banned, the search API is gone, and the API ToS bars competing products.
   5. **Partiful:** partnership. Until then, keep link-only listings via CV.
3. **Don't run** the grey Luma discover fetch or any Eventbrite/Meetup/Partiful page fetching in production. Their parsers (`src/sources/luma.ts`, `src/sources/restricted.ts`) exist for when access is granted.
4. **Change the exit criterion** to "200 *relevant* future events/week/city (by category)". Raw counts are easy to reach with civic calendars that don't fit The Network.
5. **Fragility:**
   - Every HTML or embedded-JSON parser (SFPL, CV city pages, and the restricted ones) breaks silently when the markup changes. Add per-source volume alarms (for example, alert when a source returns less than 50% of its 4-week median).
   - ICS, SODA and llms.txt are stable contracts.

## Layout and how to run

```
src/http.ts                 polite fetch: UA, robots.txt (RFC 9309), 1 req/s/host, fetch log
src/types.ts, util.ts, ics.ts
src/sources/luma.ts         luma-discover (grey) + luma-ics (green)
src/sources/cerebral-valley.ts
src/sources/civic.ts        nyc-parks, sf-recpark, sfpl
src/sources/restricted.ts   eventbrite, meetup, partiful (probe fixtures / future partnerships only)
src/dedupe.ts               blocking, scoring, clustering, merge
scripts/ingest.ts           live run -> data/events.json, data/fetch-log.json
scripts/dedupe-report.ts    pairs, clusters, sample for labelling, P/R vs fixtures/dedupe-labels.json
scripts/stats.ts            field coverage and per-city counts
scripts/probe.ts, robots-check.ts   one-off probes used for this review
fixtures/                   small trimmed recordings of each source + robots.txt files + labelled pairs
tests/                      bun test: parsers, robots, time zones, dedupe P/R gate (19 tests)
```

```
bun test                                   # offline, fixtures only
RAW_DIR=/tmp/ev bun run scripts/ingest.ts  # live (~2.5 min, 114 requests)
bun run scripts/dedupe-report.ts && bun run scripts/stats.ts
```

`PROBE_DIR` makes `ingest.ts` parse previously captured restricted probe pages. It never fetches them.
