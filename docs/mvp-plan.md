# MVP plan: work, friendship, love

Status: 2026-10-08, from the founder decisions of that day. The canonical source is the PRD Google Doc, Sections 28, 37 and 40 (snapshot: `docs/prd-snapshot.md`). Edit the PRD first; this file is a short working summary.

## The apps

The Network is the umbrella. Three apps are lenses on it, all "powered by The Network", sharing one engine (app packs), one database, one admin panel and phone-verified login. Each app has its own onboarding, ontology, landing page and agent persona. A person can join one app or several.

| App id | Domain | Vertical | Status |
|---|---|---|---|
| `ntwrk` | ntwrk.love (home page for everything) | The Network, umbrella | Home page live; no-keyword joins |
| `slop` | slop.date | Love: dating in one city, several cities, or within X miles of a zip code | **Launches first** |
| `friends` | friends.help (renamed from buddies.nyc) | Friendship | Local only, no deploys |
| `peon` | peon.biz | Work: hiring | Local only, no deploys |

ntwrk.club belongs to someone else and is not used.

Rules that hold in every app:

- **One Blooio iMessage line.** The first message is routed by keyword ("join slop.date", "slop", "peon", "friends"). With no keyword, the person joins The Network: the same flow, but the agent asks what they want (friends, dating, work) and enrolls them in those apps.
- **Ages.** Minimum age 13. Members aged 13-17 may join every app but are never matched or connected to anyone. Matching is 18+ everywhere.
- **Cross-app privacy.** Dating membership and data are never visible to the other apps by default. Only a base profile crosses apps, with consent. Blocks apply in every app.
- **Compliance is not a launch blocker for now.** The safety guards stay (age rules, consent, STOP/HELP, quiet hours, leak guard, human review, report and block, bans by person). Legal items (NYC LL144, dating-safety notices, 10DLC and others) are a deferred backlog (PRD 40.7).
- **slop.date appearance ratings (founder decision 2026-10-08; changes PRD 40.5 "never used: photo attractiveness scores").** Photo ratings (face, body, overall and body type, from Cloudflare's Clef model) are now **used in matching but never shared**. They are stored as agent_private facts, are never in any member-facing text, probe, reveal, explanation, proposal or run log, and are rated for verified adults only (never 13-17, never an unknown or unverified age). Matched members talk and exchange photos through the agent and learn only what it tells them (first name, the plan). An admin bias monitor reports outcome ratios by group. See docs/results/2026-10-08-slop-pack.md, iteration 4.
- **Everything earlier stays:** the attention budget (lunchtime learned send times, always probe first, only initial invites count against the cap, booked-plan reveal), plans with a separate plan allowance, crews after one great plan, network capital MVP-lite and post-MVP member ownership.

## Launch order

1. slop.date, after Phases 0-2 below meet their exit criteria and the founder approves live sends.
2. friends.help and peon.biz stay local until their packs pass their sim gates and the founder decides to deploy them.

## Workstreams

- **Engine and packs:** `packages/core`, `packages/engine`, `packages/sim`, `packages/judge`, `packages/evals`, `packages/capital`, and the new pack modules.
- **Platform:** the `platform` schema and migrations, `packages/network` service, messaging (Blooio line, keyword routing), login, `packages/plugin-network`, and the admin panel (`packages/observatory`).

## Phases

| Phase | Scope | Owner | Exit criteria |
|---|---|---|---|
| 0. App packs core | `AppPack` interface, open core types, `networkPack` as a facade then threaded through the engine module by module, geo seam, `SimPack`, one conformance suite | Engine and packs | Golden replays byte-identical under `networkPack` on a pinned clean commit; conformance green for `networkPack` |
| 1. slop.date pack, sim, local pilot readiness | Mutual hard filters, radius geo with distance bands, reciprocal scoring with congestion and exposure caps, probe first then a booked first date, dating judge rubric, safety basics; dater personas, oracle, adversaries | Engine and packs | Conformance green; slop sim gates pass over several seeds (below); end to end locally with test phones and dry-run sends; reviewers trained; shadow mode with human review of every intro |
| 2. Platform backend (parallel) | Migration runner; `platform` schema (people, phone identities, memberships, consent events, share grants, blocks, staff roles, audit); `app_id` on engine tables; one line with keyword routing and no-keyword enrollment; phone login; per-app personas; admin app switcher and per-app roles | Platform | A test phone joins two apps by keyword and one by no-keyword enrollment; STOP and leaving one app work; export and delete per app; ntwrk 21-day sim unchanged after migration; `cross_app_leak = 0` |
| 3. friends.help pack and sim | Groups first, quorum, plans and crews, neighborhood geo, affinity tables | Engine and packs | Conformance green; friends sim gates; local only |
| 4. peon.biz pack and sim | Org and job entities, two-way retrieval, candidate-first consent, unranked slates, sealed protected attributes, proxy scrubbing | Engine and packs | Conformance incl. protected-attribute invariance; peon sim gates; local only |
| 5. Attention, plans, capital across apps | Person-level cap across apps; attention budget, plan allowance and crews per pack; network capital per app or shared (to decide) | Engine and packs, with platform | No send over any per-app or person-level cap in a multi-app sim; NC fairness gate holds per app |

Phases 0-1 and Phase 2 run in parallel. Phases 3-5 can start once Phase 0 is done.

### Simulation gates per pack (blocking)

- **slop.date:** 0 hard-constraint violations; 0 intros involving anyone under 18 or unverified; 0 private-field or cross-app leaks; scammer median reach at most 1; same-face ban-evasion catch at least 95%; mutual yes at least 25% of probes; probes-received Gini under threshold at twice the cold-start pool.
- **friends.help:** repeat rate at least 30% of groups within 30 days; more simulated friendships than a one-off-dinner baseline; no trip over a member's tolerance; 0 affinity or age violations; V14 at least 85%.
- **peon.biz:** impact ratios at least 0.8 at every automated stage; 0 protected or proxy mentions in judge reasoning; 0 jobs without pay ranges; 0 unverified employers reaching candidates; 100% of discriminatory requests refused.
- **Every pack:** the shared conformance suite (age, blocks, consent order, leaks, protected-attribute invariance, determinism, judge cannot undo filters, attention caps, geo) and `cross_app_leak = 0`.

## Local only

- peon.biz and friends.help: local dev Postgres (port 54339), sim worlds as their own schemas, dry-run or test lines, no site or service deploys.
- slop.date stays local through Phase 1. Its first live sends need Phases 0-2 done, `BLOOIO_ALLOW_SEND=1` plus the founder's live approval, and human review of every proactive intro.
- No production database ever holds sim data.

## Open decisions

- Join mode per app (invite, open or waitlist).
- ~~Whether slop.date probes include a photo.~~ Founder direction 2026-10-08: yes, adults only (the slop sim runs with photos in the probe). This reverses experience-design D5 / F2 ("never a photo until both say yes") for slop.date; the PRD text still needs the edit.
- When The Network's own SF and NYC matching opens relative to slop.date.
- Network capital per app or shared.
