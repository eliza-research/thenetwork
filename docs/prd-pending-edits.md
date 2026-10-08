<!-- Pending edits for the canonical PRD (Google Doc). Edit the Google Doc, not the snapshot. https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit -->

# PRD pending edits

The PRD Google Doc is canonical: https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit. `docs/prd-snapshot.md` is a copy of it.

This file lists the proposed PRD edits that are not yet in the PRD. It replaces three files: `docs/prd-edits-2026-10-07.md`, `docs/prd-edits-2026-10-08-platform.md` and `docs/design/2026-10-07-prd-section-draft.md`. Each item was checked against `docs/prd-snapshot.md` on 2026-10-08. Items already in the PRD were dropped (see "Already applied" at the end).

How to use it: apply an edit in the Google Doc, re-snapshot `docs/prd-snapshot.md`, then delete the edit here. Items marked **[DECIDE]** need a founder decision first.

Each item gives the PRD section, the change, the source file and date, and the decision behind it.

## 1. MVP and admin console (source: prd-edits-2026-10-07.md, 2026-10-07)

Authority: founder decisions of 2026-10-07 (review gate, consent-first probes, NYC only, minimum age 13, the admin console). Detail: `docs/admin-console.md`. The review gate is also a code invariant in `AGENTS.md` (founder decision, below 1,000 members). Review is always on in code; sampled review for a category after 1,000 members is a later product decision.

Note on Section 40 (2026-10-08): slop.date now launches first, and 28.1, 37 and 40 say so. The NYC-only edits below apply to The Network's own (ntwrk) pilot. Check them against 40.2 and 40.9, which still say "SF, NYC" for The Network's own matching, and against the open decision "When The Network's own SF and NYC matching opens" in `docs/mvp-plan.md`.

**1.1 Section 28.1 (MVP in one paragraph).** Replace the San Francisco and New York pilot text with: "An invite-only Network in New York City for about 150 members (target 75-150 active). Members join through a vouch from an existing member or the founding team. The minimum age is 13. Members aged 13-17 use the agent for themselves and are never matched or connected. ... While the network is under 1,000 members, a human reviews every proactive proposal and every member-initiated request before any member is contacted. A proposal that misses its review deadline expires. Approved proposals start with a consent-first anonymous probe ('up for X this week near Y?'). The Network reveals who the others are only to members who said yes, then sends double opt-in invitations. ... The team operates the Network through an admin console. Its first implementation is the Observatory (packages/observatory). The console shows conversations, the social graph, member perspectives and analytics. It needs staff sign-in and roles, and the same console runs the simulated world (simulation lab)." Keep the 2026-10-08 Section 40 update sentence.

**1.2 Section 28.3, Membership row.** The 2026-10-08 update on ages is in. Still pending: "Under-13s are declined kindly and nothing is stored beyond the decline. ... New York City is the home city; a member can record a trip to another city." (replaces "SF/NYC home city with multi-city presence").

**1.3 Section 28.3, World knowledge row.** "Curated per-city event ingestion" becomes "Curated New York City event ingestion".

**1.4 Section 28.3, Human review row.** Replace with: "Review queue for every proactive proposal and every member-initiated request, before the first member contact (the anonymous probe included). Approve, edit, re-roll, reject with reason codes. A proposal that misses its SLA expires and is never sent late. Eligibility is checked again on approve. Review is required in code while the live member count is under 1,000. Reviewer rubric. Labels are stored as training data."

**1.5 Section 28.3, Consent workflow row.** Replace with: "Opportunity state machine. A consent-first anonymous probe goes to each participant before anyone learns who the others are. Then independent double opt-in, quorum for groups, expiry, and decline without penalty. No member learns who said no to a probe or an invitation."

**1.6 Section 28.3, Admin and analytics row.** Replace with: "The admin console, first built as the Observatory (packages/observatory). It has: review queue with SLA; member 360; member-perspective timeline (messages plus system decisions); social-graph explorer; opportunity pipeline; matching-run inspector with shadow runs; safety console; requests and demand; growth; metrics and health alerts; audit log; simulation lab. Staff sign in with SSO and a second factor and have roles. Views are PII-scrubbed by default, and every reveal and staff read is logged. The console reads a read-only replica; staff actions go through the Network admin API."

**1.7 Section 28.4, last cities row.** Current: "Cities beyond SF and NYC for The Network's own matching ... | Expansion gates (25.6). | Multi-city presence model". Proposed: "Cities beyond New York City, San Francisco included | NYC proves the loop first; expansion gates (25.6). | Multi-city presence model, trips". Keep the slop.date markets pointer to 40.5.

**1.8 Section 28.5, gate 2.** Replace with: "Every proactive proposal and every member-initiated request goes through the review queue before the first member contact, the anonymous probe included. Every outbound message goes through the leak check. Code enforces both, and a simulator invariant checks that no probe goes out without a prior approval. A proposal that misses its review SLA expires."

**1.9 Section 28.5, gate 5.** Replace with: "The admin console (the Observatory) can show any member's full experience within two clicks: their messages, what the engine considered for them, why each item was or was not sent, review decisions and leak-check results. Staff sign in with SSO and a second factor and have roles. Views are PII-scrubbed by default. Every PII reveal and every staff read of member data is in the audit log. The console is not reachable without sign-in."

**1.10 Section 28.5, gate 6.** Replace with: "Seed cohort recruited: at least 40 committed members in New York City before proactive matching is enabled. Only an admin can switch it on in the console, and the switch is logged."

**1.11 Section 28.5, new gate.** Add: "Age policy: under-13s are declined at join with nothing stored beyond the decline. Simulated runs show 0 minor contacts. The safety console lists members aged 13-17 and confirms none is in a multi-person opportunity."

**1.12 Section 31.5 (Environments), Production bullet.** Add: "The admin console reads a read replica through a read-only login (network_observatory, no access to channel_identities). Game and simulation controls are off in production." Reconcile with item 2.6 (one database role per app, with row-level security).

**1.13 Section 32.8, Policy.** Already in: member-initiated requests pass review at launch, and a proposal past its SLA expires. Still pending, add: "Review happens before the first member contact, the consent-first anonymous probe included. The Network reads the live member count from the database. Approving a proposal re-checks age, block, pause and hold status for every participant. A simulated reviewer ('auto') is allowed only in the simulator."

**1.14 Section 32.10 (States).** States become "DRAFT, PROPOSED (engine), IN_REVIEW, APPROVED, PROBING (anonymous availability check; no identities shared), INVITING (reveal and double opt-in to those who said yes), ...". Add EXPIRED_IN_REVIEW to the terminal states.

**1.15 Section 34.6 (Shadow mode).** Add: "Shadow proposals appear in the console review queue with a 'shadow' tag and are never sent. The Observatory's 'Run engine (shadow)' builds the snapshot from the read replica and writes nothing."

**1.16 Section 35.1 (Principles).** Replace the role-based access bullet with: "Staff sign in with SSO and a second factor; there are no shared accounts. The API and the live-update channel reject requests without a staff session and check Host and Origin. Role-based access (admin, reviewer, safety, analyst, engineer), checked on the server. PII-scrubbed views by default. Message text that may hold a private disclosure is hidden until revealed. A PII reveal is per member, needs a written reason, lasts 15 minutes, and is only for admin and safety roles. Every reveal and every staff read of member data is written to the audit log. The console never writes to the database directly; staff actions go through the Network admin API." Reconcile with item 2.7 (new roles engineer and cross_app_safety).

**1.17 Section 35.2, Review queue row.** Add: "Shows the origin (engine, member request, plans, second encounter, newcomer welcome), the probe text and the reveal text each member will get, and an SLA countdown. A proposal that misses its SLA expires. Eligibility is re-checked on approve."

**1.18 Section 35.2, Member perspective timeline row.** Add: "probes and their answers, skipped engine proposals and why, leak-check result per outbound message, quiet-hours and budget deferrals, trust changes."

**1.19 Section 35.2, Intents and demand row.** Rename it "Requests and demand". Add: "Member requests (people and plans) with outcome (probing, fulfilled, still looking), retries, and why unfulfilled."

**1.20 Section 35.2, new Growth row.** Add: "Growth | Invites per member, invite trees, invitee activation compared with seed members, growth asks sent, inviters who lost invites after an invitee went on hold."

**1.21 Section 35.2, Safety console row.** Add: "Members on watch and hold with the events that caused it; hold and lift actions; urgent-first queue with the 36.3 response targets; a minor-safety view (members aged 13-17, none in a multi-person opportunity)."

**1.22 Section 35.2, Simulation lab row.** Add: "It is the same app as the production console (the Observatory's game mode), with a SIMULATION banner. Scenario levels, the truth lens and persona takeover exist only here. A simulated reviewer is allowed only here."

**1.23 Section 35.2, Home / health row.** Add: "review SLA misses, daily LLM spend against the cost alert, and the safety counters that must stay 0 (canary leaks, minor contacts, invariant violations)."

**1.24 Section 35.3 (Implementation notes), first bullet.** Replace the eliza.app admin-area text with: "The first implementation is the Observatory (packages/observatory): a Bun server with a React UI, one view model for simulated worlds and the real database, and a Canvas force graph. For production it runs behind SSO, reads a read replica through the read-only login network_observatory, and sends staff actions to /api/network/admin routes with role checks. Moving it into the eliza.app admin area is decided after the pilot."

**1.25 Section 36.5 (Seed and density plan).** Replace "Each city: a founding seed of 40-75 members ... (for example, Mission/SoMa/Hayes Valley in SF; Lower Manhattan and north Brooklyn in NYC ...)" with "New York City: a founding seed of 40-75 members ... concentrated in a few adjacent neighborhoods (for example, Lower Manhattan and north Brooklyn; the final choice depends on where the seed lives). San Francisco follows only after the expansion gates (25.6)."

**1.26 Section 37 (Build plan), milestone table.**
- M0: "admin shell with auth and roles" becomes "The Observatory with staff sign-in, roles and the audit log."
- M1: "concierge search with event ingestion for both cities" becomes "... for New York City".
- M2: "simulation lab in admin" becomes "simulation lab (the Observatory's game mode)".
- M3: "review queue" becomes "review queue in the Observatory, with SLA expiry, a review stage in the Network before any probe, and a simulator invariant 'no probe without approval'".
- M6: "Onboard seed cohorts in SF and NYC" becomes "Onboard the NYC seed cohort". M7: "Reviewed proactive proposals per city" becomes "Reviewed proactive proposals in NYC". Section 37 already marks M6 and M7 as superseded by Phases 1-2, so these two may be dropped.

## 2. Multi-app platform as built (source: prd-edits-2026-10-08-platform.md, 2026-10-08)

Authority: the founder approved the multi-app platform on 2026-10-08; PRD Section 40 records it. These edits add to Section 40 and do not replace it. Where Section 40 and the code differ, Section 40 wins. A Claude agent wrote the source file from the code, the build reports and the plan (`docs/research/2026-10-08-platform-architecture.md`); nobody had edited the Google Doc for it. App ids: `ntwrk`, `slop`, `peon`, `friends`. A network id is `<app>:<city>`, for example `slop:nyc`.

**2.1 Section 38, new row (A1).** "| Multi-app platform (four apps on one backend) | Approved by the founder, 2026-10-08. Scope: Section 40. Plan: docs/research/2026-10-08-platform-architecture.md. Built locally the same day: the platform schema, phone login, memberships per app, one service for every network, the four sites, and the admin app switcher. Nothing deployed. | Decided. |"

**2.2 Section 28.3, new row (A2).** "| Web account page | Each app's site has a settings page: phone login with a text-message code, membership state, export of this app's data, stop messages for this app, leave this app, and delete everything (typed confirmation). The same page exists on every app's domain; a login on one domain is not a login on another. | 40.3 |"

**2.3 Section 40.2, four new rows in the apps table (B1).**

| Attribute | slop.date | friends.help | peon.biz | The Network |
|---|---|---|---|---|
| Network id | slop:nyc | friends:nyc | peon:nyc | ntwrk:nyc (later ntwrk:sf) |
| Join mode (default, a setting) | open | open | open (waitlist copy) | invite |
| Join age / match age | 13 / 18 | 13 / 18 | 13 / 18 | 13 / 18 |
| Matching today | Off until the slop pack passes its gates | Off until the friends pack ships (today's engine may run it with 18+ matching) | Off until the peon pack passes its gates | Off until the founder turns it on |

The join mode, the ages and the matching switch are data (`platform.apps`, `platform.networks`), so the founders can change them without a code change. **[DECIDE]** the join mode per app (open decision in `docs/mvp-plan.md` and 40.9).

**2.4 Section 40.3, "Identity by phone", after the first paragraph (B2).** "Web login. A person types a US number (+1 only) on an app's site and gets a six-digit code by text. The answer to 'send me a code' is the same, after the same minimum time, whether or not the number is known. Limits: 3 codes per number per hour, 10 per IP address per hour, 30 seconds between codes to one number, 10 minutes to use a code, 5 wrong tries, one use per code. A bot check (Cloudflare Turnstile) can sit in front of the send step. A session is a random token in a first-party cookie for that app's domain only (HttpOnly and SameSite=Lax; Secure in production), kept 30 days, and replaced at each login and after one day. The server stores only a hash of the token. Phones, IP addresses and codes are stored as keyed hashes where the full value is not needed. Recycled numbers. A number not seen for 12 months waits for staff review before a new membership attaches to the old person. A carrier lookup (VoIP, landline, recent port or SIM change) is planned, not built."

**2.5 Section 40.3, "One line, keyword routing", after the STOP bullet (B4).** Add:
- "STOP, STOP ALL, START and HELP are recorded per app in one consent ledger, with the exact opt-in wording the person agreed to. STOP on the shared line stops every app. 'leave <app>' or the site's leave button stops one app and deletes that app's data (the forget path); other memberships stay. START on the line resumes the app of the line."
- "Routing tables per line may stay as data. If an app ever gets its own line, STOP on that line stops that app only, unless a setting (PLATFORM_STOP_SCOPE=global) makes it stop every app."
- "A person-level cap: at most 3 proactive messages a day to one person across all apps, checked when a message is sent." This replaces "Proposed on top" in 40.4. (The cap is also founder decision 7 in `AGENTS.md`.)
- "Live sends per app need the founder's approval for that app (<APP>_LIVE_APPROVED), in addition to the existing live-send approval."

**2.6 Section 40.3, "Cross-app privacy", after the last bullet (B5).** "How the code keeps apps apart: Each app-scoped table has the app id. Keys join on the app, so a row that links two apps is a database error. The engine snapshot for one network reads only that app's rows. Person-to-person blocks are the only cross-app input. The admin console reads each app through its own database role, with row-level security. A shared base profile is a grant: first name, city, age band and interests. A grant copies nothing. The share choice is hidden in the sites until the founders approve its copy. Delete everything removes every membership and the phone. A tombstone and a hashed suppression entry stay, so a STOP is never forgotten. The export is per app and holds only that app's data."

**2.7 Section 40.3, "Admin panel", replace the paragraph (B6).** "Admin panel. One admin panel (Section 35) with an app switcher (ntwrk, slop, friends, peon, all). Every view and action is for one app. Staff roles are per app (reviewer@slop) or for all apps (reviewer@*), so a hiring reviewer never sees dating items. New roles: engineer (simulated worlds only, never real data) and cross_app_safety (the cross-app person view only). Each app has its own review reasons and review deadline: slop adds 'preference mismatch' and 'safety concern' (6 hours); peon adds 'not qualified' and 'role closed' (24 hours); The Network and friends keep the Section 32.8 list (12 hours). The cross-app person view shows memberships, states, holds and blocks, never a phone or a name. Only cross_app_safety and admins of all apps can open it. Each app's panel opens only with a typed reason, and the audit row is written before any data is read. The reviewer of record is the signed-in person. One append-only audit log carries the app on every row." **[DECIDE]** the per-app reason lists and deadlines (decision 16 below).

**2.8 Section 40.8, new bullet (B7).** "Until each pack ships its own world, the admin simulation lab runs every app on The Network's NYC world with that app's copy and join age, and with no new engine proposals for slop and peon. These runs check safety only; they say nothing about the app's matching."

**2.9 Appendix B (core data objects), platform objects (B8).** "Platform schema (one per deployment, shared by every app): apps, cities, networks (app and city, matching switch), people (lowest age, tombstone), phone identities (the only place a phone lives), memberships (app, person, member id, state), consent events (phone, app or all, state, source, wording, time), share grants, person blocks, staff roles (role, app), audit (append-only, with the app), app lines, OTP challenges, sessions (hashed), rate limits, suppression (hashed). The engine tables carry the app id on every row."

**2.10 Section 31.4 (data and migrations), new sentence (C1).** "Schema changes are numbered SQL migrations with a ledger table and an advisory lock (bun run db:migrate). A migration runs once. Production migrations run as a role that row-level security does not filter."

**2.11 Section 35, first paragraph, new sentence (C2).** "The console serves every app (Section 40.3): an app switcher, roles per app and a reason-gated, audited cross-app person view."

**2.12 Section 32.2 (messaging), new sentence (C3).** "Each live send needs BLOOIO_ALLOW_SEND=1, the founder's live approval (NTWRK_LIVE_APPROVED=1), and the founder's approval for that app (<APP>_LIVE_APPROVED=1). The person-level cap (40.3) is checked at send time."

### Code differences from Section 40 (source section D)

Section D listed places where the code differed from Section 40. These are code work, not PRD edits. A check of the worktree on 2026-10-08 found the code now follows Section 40 on each row: the app id is `friends` with domain friends.help (`packages/platform/src/apps.ts`); every app has join age 13; a message with no keyword enrolls the person by what they want (friends, dating, work); the slop.date safety notice is information, not a step (`sites/README.md`); ntwrk.love links to the apps (`AGENTS.md` founder decision 4). Nothing is deployed yet. No PRD edit is needed for these rows.

### Open founder decisions (source section E)

Already listed in `docs/mvp-plan.md` "Open decisions", so not repeated here: join mode per app (E5), network capital per app or shared (E24), and when The Network's own matching opens (E25). E1 (ntwrk.club) is answered in 40.1. The photo half of E25 is decided and in the PRD (see "Already applied").

| # | Question | State or default in the code (2026-10-08) |
|---|---|---|
| 2 | A separate legal entity per app (10DLC brand, FCC sender, liability)? | Open. 40.7 records the 10DLC risk for slop. |
| 3 | A second Blooio line as a fallback? | 40.3 has one line for every app, so a ban affects every app. A second line is open. |
| 4 | How does Twilio classify a non-adult dating service (SHAFT, error 30953)? | Open, in the 40.7 backlog. |
| 6 | Should a safety removal on one app apply to hiring? | 40.3 says a removal holds the person everywhere. Confirm for peon. |
| 7 | Is peon an employment agency for record keeping? | Open, in the 40.7 backlog. |
| 8 | Store the lowest stated age when a join is refused for age? | 40.3 already makes age a person-level fact (lowest stated age). Open: whether a refused join stores that age. Source default: nothing stored, so a retry with an older age can pass (`docs/runbook-platform.md` section 3). |
| 9 | After delete everything, keep a hash of a person whom others blocked, so the blocks apply if they join again? | Blocks stay on the tombstone person; a new join with the same phone gets a new person, so the blocks no longer apply. |
| 10 | After delete everything, how long must the opt-in record (with its wording) be kept for 10DLC? | The consent events are deleted; only the suppression hash stays. Counsel. |
| 11 | The base-profile fields that can be shared, and the share copy | First name, city, age band, interests. The share choice is hidden on the sites. SHARE by text copies first name, city and interests from every other app. No engine reads grants yet. |
| 12 | The link notice ("You've used this number with us before. Nothing is shared between apps unless you say so. Reply SHARE ...") | Sent after a join by a known person. It tells the phone holder that the number was known. On a recycled number, that reveals something about the old owner. Joins by text skip the recycled-number hold. |
| 13 | The per-app brand texts (agent names; STOP, STOP ALL, START, HELP; the invite-only and under-age replies) | Drafts in `packages/platform/src/apps.ts`. Counsel should check the STOP wording. They need the CONTRIBUTING 3.5 videos. |
| 14 | Who answers keywords on the shared line: this service or the Eliza Cloud gateway? | The service. One owner must be chosen before any live send. |
| 15 | The invite-only reply on The Network | At most one a day per number; nothing stored. |
| 16 | Review reasons and deadlines per app (item 2.7) | slop 6 h, peon 24 h, others 12 h. |
| 17 | Does a hold from one app show to each app's own staff as "hold from another app"? | Only the cross-app view shows it. |
| 18 | Does the person cap count a message that waits for quiet hours? | Yes: it counts when the message is handed to the sender. |
| 19 | Turnstile on the sites (a script from challenges.cloudflare.com) | Needs a content-security and privacy wording decision. The site build now takes a Turnstile site key (`sites/README.md`). |
| 20 | The landing-page demo replay | The sites show it if the API serves it; the API served none at the time of writing. |
| 21 | Rotation of the hash key (PLATFORM_HASH_KEY) | No plan. A new key orphans old suppression entries. |
| 22 | Are slop.date, peon.biz and friends.help zones in the right Cloudflare account, and do the support mailboxes (help@<domain>) exist? | Assumed in the site configs; not checked. `AGENTS.md` founder decision 8 now puts the sites in the Eliza Labs Cloudflare account. |
| 23 | The weekly check-in: offer it at onboarding as well as in the first booked plan? | First booked plan only. |

## 3. Experience design section (source: design/2026-10-07-prd-section-draft.md, 2026-10-07)

Authority: design proposal for founder review; full design in `docs/design/2026-10-07-experience-design.md`. Probe-first was decided 2026-10-07 (decision F2 there). Section 38 row "Earlier decisions stay (2026-10-08)" and 40.4 "Carried over to every app" confirm the attention budget, probe first, plans and crews, but with later details.

**3.1 New PRD section: "Experience design: attention budget, plans and continuous conversation".** Insert as a new section. The draft says it amends 7.2, 8.2, 9.3, 12.3, 29 F6/F11/F12/F20/F21/F28, 32.9, 33.3-33.4 and 33.10. None of its body is in the PRD; only the V14 metric (39, 40) and a short attention-budget summary (38, 40.4) are. Its parts:
- Principles: the scarce resource is the member's attention; budget interruptions, not proposals; measure value delivered; the conversation is the product, so onboarding never ends. All existing rules hold.
- Attention budget: an interruption is any message the Network starts that the member did not ask for. Caps unchanged (Open 4 per 7 days, Normal 2 per 7 days, Quiet 1 per 30 days, Receiving support only, Paused none). Menus of up to three items in one interruption, with a weekly digest on Thursday evening by default. Pricing: item value is calibrated chance of worthwhile times the square root of the chance of yes; send only if total value exceeds the member's price of attention times cost. "Learned signals can only make the Network quieter; only the member can ask for more." Silence: no filler. Hold queue of up to 10 items per member with expiry, re-checked before sending.
- Consent-first probes: "The Network asks about the activity before revealing the person." At most one shareable fact, never a name. The member with the live want is asked first. The match is reviewed before the first probe.
- Messaging limits: Blooio allows three unanswered messages per conversation and one re-engagement after 14 days. The Network sends an interruption only when at most one message is unanswered. The single re-engagement is used at most once, after 30 or more days, for a high-value item. New conversations stay under 20 per line per day.
- V14: "the share of active members (tenure 14 days or more, not paused) who had at least one value event in the last 14 days". Targets 85% in the simulator, 70% in the pilot. The 28.2 first-value bar becomes V14 at day 14. A diagnosis-to-remedy table (too little data, no live want, no good one-to-one partner, travel or thin network, budget or busy).
- Plans: availability capture, a planner that builds an activity, a venue and 2-6 free members; least-misery group scoring; anonymous probes with quorum (normally 3) and a deadline; alternates; reveal at quorum; reminders; fallbacks; recurring crews with a rotating host. Members aged 13-17 get solo plans to public, age-appropriate events only. Plans are never framed as romance.
- Introduction types: plans, recurring crews, hosted dinners (public venues only), skill swaps, mentorship, accountability partners, travel, reconnects, introducer-routed intros, advice routing and outside-world suggestions join the 11 engine generators. Each needs a simulator coverage gate before it ships.
- The conversation is the product: inbound routing order; claims classified for privacy at extraction (sensitive topics, minors and third parties are agent_private); an evidence ledger with source, confidence and decay; wants re-confirmed every 60 days; at most one question per interaction.
- Rollout: (1) attention budget, menus and hold queue; (2) plans and simulator availability; (3) coverage scenarios; (4) the extraction eval. Offline replay, two weeks of shadow mode, then one city at a time.

Reconcile before inserting. Later decisions in 40.4 change parts of the draft: sends happen at a learned send time (default 12:00 local), not a fixed Thursday digest; only initial invites count against the cap; the reveal is the booked plan; plans have a separate allowance (1 initial plan invite per 7 days); crews form after one great plan. For slop.date, a probe may include a photo (40.5), which the draft's probe rule does not allow. The draft's "one city at a time" rollout predates the slop.date-first order in Section 40.

## Already applied (dropped)

- slop.date photo in the probe, reversing experience-design D5/F2 "never a photo until both say yes" (founder direction 2026-10-08, `docs/mvp-plan.md`): in the PRD as Section 38 row "Photos in the probe (2026-10-08)" and 40.5 "Flow" ("an anonymous description ... that can include a photo"). The experience-design doc itself still says "never a ... photo".
- Platform B3, age as a person-level fact so a later, older answer cannot undo a stated minor age: in 40.3 "Identity by phone" ("Age is a person-level fact: the lowest age the person ever stated on any app, failing closed"). The open part is decision 8 above.
- Platform E1, ntwrk.club: answered in 40.1.
- Ages 13+ on every app with 18+ matching (part of 2026-10-07 edit 2): in the 28.3 Membership row update and 40.3 "Ages".
- Member-initiated requests reviewed at launch, and SLA expiry instead of late sending (part of 2026-10-07 edits 4 and 13): in 32.8 Policy.
