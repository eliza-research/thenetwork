# MVP plan: slop.date first, in New York

Status: 2026-10-08, after the cleanup (`origin/main` b2bb4d6). The canonical source is the PRD Google Doc: Sections 28 (MVP), 37 (build plan, critical path, prototypes, gates) and 40 (the multi-app platform). The snapshot is `docs/prd-snapshot.md`. The detail behind this page, including the status matrix, is in [mvp-gaps.md](mvp-gaps.md). Edit the PRD first; this page is the working summary.

## The apps and where they stand

One network, one engine with a pack per app, one Postgres, one admin console (the Observatory), one phone-verified login and one Blooio iMessage line routed by keyword. Members aged 13-17 may join every app but are never matched or connected. Adult means the lowest stated age is 18 or more; an unknown age fails closed. There is no ID check, and compliance is a deferred backlog (PRD 40.7).

| App | Site (Cloudflare Pages) | Backend and matching | Next step |
|---|---|---|---|
| slop.date (`slop`) | On Pages | Pack wired (`slop-pack-1.4.0`); matching off by the stored switch; no live send yet | **The first pilot: NYC, about 40-75 adults** |
| ntwrk.love (`ntwrk`) | On Pages; home page for every app | Invite-only; no-keyword joins enrol people in the apps they ask for | Its own NYC matching opens after slop |
| friends.help (`friends`) | On Pages | Pack passes its sim gates; matching off; runs locally only | Join mode to decide |
| peon.biz (`peon`) | On Pages | Pack passes its sim gates; matching off; runs locally only | Join mode to decide |

All four sites are Cloudflare Pages projects; the shared backend (`deploy/backend/server.ts`) goes to Railway at `api.ntwrk.love`. Onboarding is agent-first: each site hands the person a prompt for their own AI, which reads the site's `SKILL.md` and submits the profile through the MCP server on the backend. Joining by text ("slop") works too.

## Critical path

Owners: **E** is engine and packs (`packages/core`, `engine`, `sim`, `capital`); **P** is platform (`packages/network`, `platform`, `blooio`, `mcp`, `observatory`, `deploy`, `sites`). Estimates are engineer-days for one agent-assisted engineer.

| # | Piece | Owner | Days | Needs |
|---|---|---|---|---|
| 0 | Founder decisions (below) | Founder | 1 | |
| 1 | Backend deploy to Railway, staging then production | P | 2 | 0 |
| 2 | Migrations on Railway; backups on and one restore tested | P | 1 | 1 |
| 3 | Blooio in and out on the live line; persisted outbound queue | P | 3 | 1, 2 |
| 4 | slop onboarding conversation: free-text understanding, read-back, photo ask for adults | P, E | 4 | 3 |
| 5 | Photo upload (site and MMS) and Clef rating wired in `server.ts`; weekly bias monitor | P, E | 4 | 2, 4 |
| 6 | Review queue for slop: slop in `PACK_READY`, reviewer of record is the person, slop rubric, SLA alerts | P | 2 | 1 |
| 7 | Photo in the probe; relay through the agent with consent per item, scam check, relay log | E, P | 6 | 3, 5, 6 |
| 8 | Post-date feedback, report and ban on the live path, ban check on photo intake | P | 1 | 7 |
| 9 | STOP/HELP live on iMessage with one owner | P | 1 | 3 |
| 10 | Console on Railway behind Cloudflare Access, bias and cost panels | P | 2 | 1, 6 |
| 11 | Monitoring and alerts (uptime, heartbeat, send failures, SLA misses, safety) | P | 2 | 1 |
| 12 | Cost tracking and budget alerts | P | 1.5 | 4, 5, 11 |
| 12b | Close the P0 and slop-relevant P1 audit findings for network, platform, observatory and sites | P | 4 | none |
| 13 | Shadow mode with every proposal reviewed, then live | Founder, reviewers | 14 calendar | 1-12 |

About 35 engineer-days plus the two-week shadow. Items 1-3, 6 and 12b can run alongside 4-5 and the engine half of 7.

## Prototypes still needed

| # | Prototype | Decides |
|---|---|---|
| P1 | Concierge pilot: 20-30 NYC adults, human-composed probes on the real line, engine in shadow | Whether people say yes, show up and want a second date |
| P2 | Clef weight fitting from labelled pairs, with a bias audit | Whether ratings help at all; replaces the placeholder weights |
| P3 | Blooio deliverability on 10-20 test phones for 3 days | The daily cap per line, attachments, ban risk |
| P4 | Onboarding quality, rules only against rules plus the LLM reader | At least 80% of hard fields filled in 24 hours, 0 wrong gender or seeking parses |
| P5 | Photo in the probe, A/B inside P1 | Confirms the arm; code and sim must agree |
| P6 | 50-100 curated NYC first-date venues | Booking links only or partner reservations |
| P7 | Hand-run relay inside P1 | One-shot number swap or a persistent thread |
| P8 | Age-liar and catfish signals without ID | Whether the age-liar gate is an accepted risk |

## Validation plan

**Simulations only.** `bun run sim` is the single validation command and runs in CI. It fails on any blocking gate. Tracked gates are printed and never fail.

- **Blocking (152 gates today, all passing):** the corpora in `evals/`; The Network's invariants and scenarios; the slop safety gates (0 declared-minor contacts, 0 stated-filter violations, scammer median reach at most 1, 0 leaks, no rating text), the slop quality gates that pass on the pinned seeds (13-16, 4 weeks), and slop conformance; the peon and friends official gate sets and conformance.
- **Tracked (slop, failing today):** dates per member-month at least 0.9x random (0.82), age-liar contact cut at least 90% (82%), adversary-contact cut at least 90% (47%), smallest gender or orientation group at least 0.7x (0.33), harm-event cut at least 90% (87%). Each is fixed, waived in writing by the founder, or carried as a known risk into the pilot.
- **The message pipeline (`bun run sim --only pipeline`):** a signed webhook in, NetworkService, Postgres (a throwaway database on the dev cluster), the persisted queue, the Blooio adapter out to a fake provider, on a simulated clock. Scripted members join by keyword, onboard, are reviewed, probed and booked; with duplicate webhooks, a provider outage, a crash during a send and a restart, STOP in a thread, and the gateway as the STOP/HELP owner. Blocking: 0 lost or duplicated messages, 0 sends after STOP, 0 sends to minors about others, every row ends delivered or failed, keyword routing. Without Postgres (CI) it is tracked as skipped.
- **Still missing in sim:** LLM personas sending free text through the platform; adversarial scenarios against the live agent (scammer in relay, "how hot did you rate me?", ban evader, prompt injection for a number). Gates: 0 rating or contact leaks, scammer reach at most 1.

**Live pilot go/no-go:** every blocking gate passes; P3 measured; STOP owner decided; two weeks of shadow with a precision baseline; 40 committed NYC adults; restore tested; cost alerts and safety on-call live.

**Weekly during the pilot:**

| Metric | Gate | Roll back or pause if |
|---|---|---|
| Mutual yes per probe | 25% or more | under 15% for 2 weeks |
| Dates held per mutual yes | 60% or more | |
| Second-date rate | 20% or more | |
| Worthwhile interruption | 70% or more | under 50% |
| Mute, STOP or complaint rate | under 5% | over 10% |
| Minor contacts; rating or contact leaks | 0 | any |
| Bias monitor by rating quintile and group | 0.85x or more | under 0.8x |
| Blooio delivery failures | under 2% | an account flag |
| Cost per active member | within the founder's target | over budget |

## Open founder decisions

1. **STOP/HELP owner on the shared line:** decided (founder, 2026-10-08): one system only, chosen by `STOP_HELP_OWNER`. The default is `service` (this service answers with core's keyword table and opt-out reading; STOP stops every app, "leave <app>" leaves one). With `gateway`, the Eliza Cloud gateway answers and reports each STOP, STOP ALL and START to the service's signed `POST /consent/gateway`; the service then never answers a keyword but still records and applies every opt-out. The backend serves `/consent/gateway` on its public port (the service checks the signature). Open: which value production uses **[FOUNDER]**.
2. **Where the conversation runs:** the service's own LLM reader (`understand`, gpt-6-luna) or the Eliza agent (`packages/plugin-network`). Today the service owns every message and the plugin is not on the line.
3. **Join mode for peon and friends** on production (invite, open or waitlist). The code default is open.
4. **Ban evasion:** build a same-face check, or drop that gate and rely on phone and person bans.
5. **The security suite** (`bun run security`, six files, CI job pending): keep it or delete it.
6. **Clef weight fitting:** the fitter was deleted in the cleanup and the shipped weights are a placeholder. Rebuild the fitter for P2, or launch with ratings off until it exists.

Other open platform questions (legal entity per app, a second line, recycled numbers, hash-key rotation and more) are listed in [mvp-gaps.md](mvp-gaps.md) section 5.
