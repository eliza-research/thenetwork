# Proposed PRD edits: the multi-app platform as built (2026-10-08)

These edits make the PRD match the platform code built on 2026-10-08: one backend, one admin panel and one database for four apps with different sites. Apply them in the canonical Google Doc, then re-snapshot `docs/prd-snapshot.md`. Nobody edited the Google Doc for this file. A Claude agent wrote it by hand from the code, the build reports of this round and the plan (`docs/research/2026-10-08-platform-architecture.md`).

**Read this first.**

- **The scope is approved.** The founder approved the multi-app platform on 2026-10-08. PRD Section 40 ("Work, friendship, love: the multi-app platform") records it. Section 40 is in the Google Doc and in the snapshot on `origin/main` (commit d8d339c). The snapshot in this worktree is older and stops at Section 39. The edits below add to Section 40. They do not replace it.
- **Section 40 wins where it differs from the code.** The code was built from task defaults that came before Section 40. Section D lists each difference and the work it needs. Do not change Section 40 to match the code on those points unless the founder says so.
- Items marked **[DECIDE]** need a founder decision before anyone applies them. Section E lists them all.

Names: the app ids are `ntwrk`, `slop`, `peon` and `friends` (the code still says `buddies`). A network id is `<app>:<city>`, for example `slop:nyc`.

---

## A. Record the scope approval

**A1. Section 38 (review decisions and comment resolution log): add a row.**

> | Multi-app platform (four apps on one backend) | Approved by the founder, 2026-10-08. Scope: Section 40. Plan: docs/research/2026-10-08-platform-architecture.md. Built locally the same day: the platform schema, phone login, memberships per app, one service for every network, the four sites, and the admin app switcher. Nothing deployed. | Decided. |

**A2. Section 28.3: add one row** (Section 40 already adds the memberships, packs, slop, admin and sites rows).

> | Web account page | Each app's site has a settings page: phone login with a text-message code, membership state, export of this app's data, stop messages for this app, leave this app, and delete everything (typed confirmation). The same page exists on every app's domain; a login on one domain is not a login on another. | 40.3 |

---

## B. Additions to Section 40

**B1. Section 40.2 (the apps table): add four rows.**

> | Attribute | slop.date | friends.help | peon.biz | The Network |
> |---|---|---|---|---|
> | Network id | slop:nyc | friends:nyc | peon:nyc | ntwrk:nyc (later ntwrk:sf) |
> | Join mode (default, a setting) | open | open | open (waitlist copy) | invite |
> | Join age / match age | 13 / 18 | 13 / 18 | 13 / 18 | 13 / 18 |
> | Matching today | Off until the slop pack passes its gates | Off until the friends pack ships (today's engine may run it with 18+ matching) | Off until the peon pack passes its gates | Off until the founder turns it on |

The join mode, the ages and the matching switch are data (`platform.apps`, `platform.networks`), so the founders can change them without a code change. **[DECIDE]** the join mode per app (Section 40.9 already lists it as open).

**B2. Section 40.3, "Identity by phone": add after the first paragraph.**

> Web login. A person types a US number (+1 only) on an app's site and gets a six-digit code by text. The answer to "send me a code" is the same, after the same minimum time, whether or not the number is known. Limits: 3 codes per number per hour, 10 per IP address per hour, 30 seconds between codes to one number, 10 minutes to use a code, 5 wrong tries, one use per code. A bot check (Cloudflare Turnstile) can sit in front of the send step. A session is a random token in a first-party cookie for that app's domain only (HttpOnly and SameSite=Lax; Secure in production), kept 30 days, and replaced at each login and after one day. The server stores only a hash of the token. Phones, IP addresses and codes are stored as keyed hashes where the full value is not needed.
>
> Recycled numbers. A number not seen for 12 months waits for staff review before a new membership attaches to the old person. A carrier lookup (VoIP, landline, recent port or SIM change) is planned, not built.

**B3. Section 40.3, "Ages": add one sentence.**

> A person who states an age under the join age on any app, in a text or on a web form, has that age recorded on the person, so a later, older answer cannot undo it. A join refused for age stores nothing else.

**[DECIDE]** This sentence describes a fix, not the current code. Today a refused web join stores nothing, and the same person can join with an older age on the next try (seen in a local check, `docs/runbook-platform.md` section 3). Storing the stated age keeps a small fact about a person who did not join. The founder decides between "store the lowest stated age on the person" and "store nothing".

**B4. Section 40.3, "One line, keyword routing": add after the STOP bullet.**

> - STOP, STOP ALL, START and HELP are recorded per app in one consent ledger, with the exact opt-in wording the person agreed to. STOP on the shared line stops every app. "leave <app>" or the site's leave button stops one app and deletes that app's data (the forget path); other memberships stay. START on the line resumes the app of the line.
> - Routing tables per line may stay as data. If an app ever gets its own line, STOP on that line stops that app only, unless a setting (`PLATFORM_STOP_SCOPE=global`) makes it stop every app.
> - A person-level cap: at most 3 proactive messages a day to one person across all apps, checked when a message is sent. (This replaces "Proposed on top" in 40.4.)
> - Live sends per app need the founder's approval for that app (`<APP>_LIVE_APPROVED`), in addition to the existing live-send approval.

**B5. Section 40.3, "Cross-app privacy": add after the last bullet.**

> How the code keeps apps apart:
> - Each app-scoped table has the app id. Keys join on the app, so a row that links two apps is a database error.
> - The engine snapshot for one network reads only that app's rows. Person-to-person blocks are the only cross-app input.
> - The admin console reads each app through its own database role, with row-level security.
> - A shared base profile is a grant: first name, city, age band and interests. A grant copies nothing. The share choice is hidden in the sites until the founders approve its copy.
> - Delete everything removes every membership and the phone. A tombstone and a hashed suppression entry stay, so a STOP is never forgotten.
> - The export is per app and holds only that app's data.

**B6. Section 40.3, "Admin panel": replace the paragraph with this text.**

> Admin panel. One admin panel (Section 35) with an app switcher (ntwrk, slop, friends, peon, all). Every view and action is for one app. Staff roles are per app (reviewer@slop) or for all apps (reviewer@*), so a hiring reviewer never sees dating items. New roles: engineer (simulated worlds only, never real data) and cross_app_safety (the cross-app person view only). Each app has its own review reasons and review deadline: slop adds "preference mismatch" and "safety concern" (6 hours); peon adds "not qualified" and "role closed" (24 hours); The Network and friends keep the Section 32.8 list (12 hours). The cross-app person view shows memberships, states, holds and blocks, never a phone or a name. Only cross_app_safety and admins of all apps can open it. Each app's panel opens only with a typed reason, and the audit row is written before any data is read. The reviewer of record is the signed-in person. One append-only audit log carries the app on every row.

**[DECIDE]** the per-app reason lists and deadlines.

**B7. Section 40.8: add a bullet.**

> - Until each pack ships its own world, the admin simulation lab runs every app on The Network's NYC world with that app's copy and join age, and with no new engine proposals for slop and peon. These runs check safety only; they say nothing about the app's matching.

**B8. Appendix B (core data objects): add the platform objects.**

> Platform schema (one per deployment, shared by every app): apps, cities, networks (app and city, matching switch), people (lowest age, tombstone), phone identities (the only place a phone lives), memberships (app, person, member id, state), consent events (phone, app or all, state, source, wording, time), share grants, person blocks, staff roles (role, app), audit (append-only, with the app), app lines, OTP challenges, sessions (hashed), rate limits, suppression (hashed). The engine tables carry the app id on every row.

---

## C. Edits elsewhere

**C1. Section 31.4 (data and migrations): add a sentence.**

> Schema changes are numbered SQL migrations with a ledger table and an advisory lock (`bun run db:migrate`). A migration runs once. Production migrations run as a role that row-level security does not filter.

**C2. Section 35 (admin console), first paragraph: add a sentence.**

> The console serves every app (Section 40.3): an app switcher, roles per app and a reason-gated, audited cross-app person view.

**C3. Section 32.2 (messaging): add a sentence.**

> Each live send needs `BLOOIO_ALLOW_SEND=1`, the founder's live approval (`NTWRK_LIVE_APPROVED=1`), and the founder's approval for that app (`<APP>_LIVE_APPROVED=1`). The person-level cap (40.3) is checked at send time.

---

## D. Where the code differs from Section 40

| Section 40 says | The code does | Work |
|---|---|---|
| App id `friends`, domain friends.help (40.2) | `buddies`, buddies.nyc in the registry, migrations 0003 and 0005, the site folder, the console and the tests | Rename in one change plus a migration (rows, roles, views) |
| Join age 13 on every app (40.3) | 18 for slop, peon and buddies | Change `platform.apps` and `packages/platform/src/apps.ts`; the sites' 18+ copy |
| With no keyword, the person joins The Network and the agent enrolls them in apps (40.3) | A stranger with no keyword gets The Network's invite-only reply | Onboarding change and founder copy |
| Compliance is a backlog, not a gate (40.7) | slop.date shows a safety notice step before the phone step; peon.biz says automated ranking is off for NYC roles until a bias audit | Founder decides whether to keep them as text |
| ntwrk.love is the home page that links to the apps (40.1) | ntwrk.love links to no other app (a test checks that no site names another app's domain) | Founder decides whether the home page may name the apps; this conflicts with "no enumeration" only if a page says that a person uses an app |
| slop launches first; peon and friends local only (40.1) | Nothing is deployed; each site has a `wrangler.toml` | None now |

---

## E. Open founder decisions

From the platform plan, section 10:

| # | Question | State |
|---|---|---|
| 1 | Who owns ntwrk.club? | Answered in 40.1: someone else. Keep ntwrk.love. |
| 2 | A separate legal entity per app (10DLC brand, FCC sender, liability)? | Open. 40.7 records the 10DLC risk for slop. |
| 3 | Separate Blooio orgs, or written proof that `sibling_ban` stays inside one key? | Changed by 40.3 (one line for every app). A ban now affects every app. Open: a second line as a fallback. |
| 4 | How does Twilio classify a non-adult dating service (SHAFT, error 30953)? | Open, in the 40.7 backlog |
| 5 | Invite-only on every app, or open on slop, peon and friends? | Open (40.9). The code default: ntwrk invite, others open. |
| 6 | Should a safety removal on one app apply to hiring? | 40.3 says a removal holds the person everywhere. Confirm for peon. |
| 7 | Is peon an employment agency for record keeping? | Open, in the 40.7 backlog |

New from the build of 2026-10-08:

| # | Question | Default in the code |
|---|---|---|
| 8 | Store the lowest stated age when a join is refused for age (B3)? | Nothing stored, so a retry with an older age can pass |
| 9 | After delete everything, keep a hash of a person whom others blocked, so the blocks apply if they join again? | Blocks stay on the tombstone person; a new join with the same phone gets a new person, so the blocks no longer apply |
| 10 | After delete everything, how long must the opt-in record (with its wording) be kept for 10DLC? | The consent events are deleted; only the suppression hash stays. Counsel. |
| 11 | The base-profile fields that can be shared, and the share copy | First name, city, age band, interests. The share choice is hidden on the sites. SHARE by text copies first name, city and interests from every other app. No engine reads grants yet. |
| 12 | The link notice ("You've used this number with us before. Nothing is shared between apps unless you say so. Reply SHARE ...") | Sent after a join by a known person. It tells the phone holder that the number was known. On a recycled number, that reveals something about the old owner. Joins by text skip the recycled-number hold. |
| 13 | The per-app brand texts (agent names "slop's matchmaker", "peon's recruiter", "your buddies.nyc friend"; STOP, STOP ALL, START, HELP; the invite-only and under-age replies) | Drafts in `packages/platform/src/apps.ts`. Counsel should check the STOP wording. They need the CONTRIBUTING 3.5 videos. |
| 14 | Who answers keywords on the shared line: this service or the Eliza Cloud gateway? | The service. One owner must be chosen before any live send. |
| 15 | The invite-only reply on The Network | At most one a day per number; nothing stored |
| 16 | Review reasons and deadlines per app (B6) | slop 6 h, peon 24 h, others 12 h |
| 17 | Does a hold from one app show to each app's own staff as "hold from another app"? | Only the cross-app view shows it |
| 18 | Does the person cap count a message that waits for quiet hours? | Yes: it counts when the message is handed to the sender |
| 19 | Turnstile on the sites (a script from challenges.cloudflare.com) | Not used: it needs a content-security and privacy wording decision |
| 20 | The landing-page demo replay | The sites show it if the API serves it; the API serves none |
| 21 | Rotation of the hash key (`PLATFORM_HASH_KEY`) | No plan. A new key orphans old suppression entries. |
| 22 | Are slop.date, peon.biz and friends.help zones in the ntwrk.love Cloudflare account, and do the support mailboxes (help@<domain>) exist? | Assumed in the site configs; not checked |
| 23 | The weekly check-in: offer it at onboarding as well as in the first booked plan? | First booked plan only |
| 24 | Network capital per app or shared (from docs/mvp-plan.md) | The service attaches no ledger yet. The simulator harness attaches one ledger per Network (`--capital`), so per app. |
| 25 | Photos in slop.date probes; when The Network's own matching opens (40.9) | No photos; ntwrk matching off until the founder turns it on |
