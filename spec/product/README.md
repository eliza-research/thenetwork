# The Network product spec

The Network helps people find useful things to do and people to meet through an agent they already use. A good outcome is a worthwhile event, a useful answer, help with a real need, or a relationship that continues. The agent spends a member's attention only when there is a reason.

This directory merges the PRD, MVP plan and subsequent founder decisions. [Stories and acceptance rules](stories.md) define the member and staff journeys. [Pilot](pilot.md) sets the delivery order, launch gates and operating targets. [Product policies](policies.md) define rules shared by those journeys. A later decision in this directory supersedes an earlier description in the [historical PRD](source/prd.md).

## What ships and when

| App | Enrollment and purpose | Matching and sends |
|---|---|---|
| **slop.date** (`slop`) | Open at 13+. Dating by text. Adults alone are eligible for introductions. | First reviewed pilot in New York City. Aim for 40–75 committed adults. |
| **ntwrk.party** (`ntwrk`) | The Network's home page. Invite-only through its site and app-bound agent signup. The no-keyword text entry asks what the person wants. | Invite-only New York City pilot after slop. About 150 members and a monthly gathering. |
| **friends.help** (`friends`) | Open at 13+. Public group activities near home and repeat meetups for adults. | Local simulation, development and approved test lines until a separate live decision. |
| **peon.biz** (`peon`) | Open at 13+. Adult candidates and verified employers can express interest. | Local simulation, development and approved test lines until a separate live decision. A human hiring team makes every hiring decision. |

Each domain has a Cloudflare Pages site with its own brand and agent entry. eliza.app is another entry into The Network. One shared backend, Postgres, Observatory and Blooio line serve all four apps. The [pilot](pilot.md#delivery-order) records the deployment direction and keeps account continuity and production approval in scope. Signup may accept a supported home region before live matching starts in that region.

The first pilot covers age-safe signup and progressive profiling, private settings through conversation, AI-first concierge help, reviewed and anonymous probes, explicit consent, scheduling, moderated relay, feedback, safety operations and staff evidence. The wider Network MVP includes vouch invites, standing intents, public groups, events, bounded help, repeat encounters, plans and crews, and an internal network capital ledger. Each wider MVP feature needs the same age, consent, review, privacy and rollout gates as the first pilot.

## Rules that apply across apps

- A person who is 13–17 can use their own agent for answers, public events and solo plans. Every role in a multi-person opportunity requires adult eligibility. Use the person's lowest recorded or stated age. Unknown age is ineligible for matching and rating. An under-13 join is declined before membership or profile creation.
- Every proactive proposal and member-initiated request passes human review before any participant hears of it. Expired approval can never send. Recheck eligibility at dispatch. All member-facing messages pass the leak check.
- An explicit yes to one action applies only to that action. Probes use shareable facts and disclose neither identity nor photos. Each participant opts in independently. A hold, ban, block, age downgrade or consent withdrawal takes precedence over pending work.
- STOP suppresses every app on the shared line. `leave <app>` removes that app alone. The service and gateway share consent ordering. The line has one sender-side owner for keyword confirmations.
- Keep one verified person identity with app-bound memberships, sessions, profiles, reviews and consent. A person may separately approve sharing a limited base profile. Staff cross-app reads are role-limited, reasoned and audited. Phone and contact information stay private.
- Sign-in is part of signup and connector authorization. Public landing pages have no standalone sign-in, member dashboard or settings portal. Product controls are in the member's conversation. Export and deletion requests go through help@ntwrk.party. An already authorized agent can read back the person's own saved profile on its app.
- A product claim about signup, delivery, a date, or a saved profile requires evidence from the responsible system. A draft, verification request, simulated outcome or switch setting alone establishes only that step.

## Deferred scope

Expansion beyond New York City, live matching for friends and peon, native app experiences, device location or proximity, hosted assistant features beyond approved signup and access, other messaging channels, payment flows, refundable deposits, home hosting, childcare, custody, regulated services, marketplaces and broader data imports require later scope. The [historical scope table](source/prd.md#284-explicitly-not-in-mvp-and-what-it-builds-on) records prerequisites. The bounded safety rule for a member's help request remains in [F14](stories.md#story-f14--ask-for-bounded-help).

The economic direction keeps participation free and prevents money from buying access to people or ranking. Revenue mechanisms, sponsorship, institutional contracts, the Commons, spendable capital, paid governance, transfers, member ownership and decision markets are post-MVP. See [PRD §§18–19](source/prd.md#18-regenerative-business-model---no-monthly-membership-fee) and [§39](source/prd.md#39-growth-network-capital-and-member-ownership).

Track legal and compliance work separately from the pilot's technical gates. The existing consent, privacy, age, safety, review and sending rules apply. [PRD §40.7](source/prd.md#407-deferred-compliance-backlog) preserves the compliance backlog.

## How to change a rule

Start from the relevant product story. Put each rule and its Quint together
in a top-level Vibespec module. For a flow with I/O or concurrency, use the
[whole-flow model](../models/README.md) to compare the complete sequence.

| Product area | Generated decisions used by the app |
|---|---|
| Signup and identity | [Site enrollment](../siteEnrollment.md), [phone changes](../phoneChange.md), [member age](../memberAge.md), [phone verification limits](../otpLimits.md), [connector grant issuance](../oauthGrantIssuance.md), [Cloud sign-in](../cloudSignIn.md), [Slop onboarding](../slopOnboarding.md) |
| Consent and review | [Carrier consent](../carrierConsent.md), [probe answers](../probeReply.md), [review deadlines](../reviewDeadline.md), [opportunity lifecycle](../opportunityLifecycle.md) |
| Safety and relay | [Trust levels](../trustLevel.md), [relay decisions](../relayDecision.md), [relay item lifecycle](../relayLifecycle.md), [selected-photo relay](../photoRelayItem.md), [photo eligibility and limits](../photoPolicy.md) |
| Outreach and matching | [Daily outreach cap](../outreachPolicy.md), [quiet hours](../quietHours.md), [participation budgets](../participationBudgets.md), [participation windows](../participationWindow.md), [matching budgets and cooldowns](../matchingBudgets.md), [dating radius](../datingRadius.md), [candidate exposure floor](../exposureFloor.md), [global selection](../selectionRun.md), [Slop assignment](../slopAssignment.md) |
| Hiring | [Job posting policy](../postingPolicy.md) |
| Inbox and network capital | [Notification delivery](../notificationDelivery.md), [capital levers](../capitalLevers.md) |
| Group plans | [Plan decisions](../planDecision.md), [crew offers](../crewOffer.md), [group formation](../groupFormation.md) |
| Member profile | [Saved profile reads](../savedProfileRead.md), [suggestion review](../profileSuggestionReview.md) |
| Staff operations | [Review, safety and heartbeat timing](../operationsTiming.md), [console synchronization](../observatorySync.md), [staff review interaction](../staffReview.md), [staff permissions](../staffPermissions.md), [member inspector](../consoleMemberView.md) |
| Conversation infrastructure | [Structured reply retries](../chatRetry.md), [outbound admission](../outboundAdmission.md), [outbound receipts](../outboundReceipt.md) |
| Service operations | [Startup configuration](../bootPolicy.md), [scratch database restore](../databaseRestore.md) |

The product directory also records provider, rollout, and human requirements
that need separate evidence. The [model index](../models/README.md) links
generated transitions and decision libraries to their runtime flows. The
imported models record additional storage, concurrency, and provider behavior.

## Sources

The [historical PRD](source/prd.md) keeps all 41 sections and four appendices from the Google Doc, including requirements identifiers, source diagrams, experiment designs and the decision log. The [founder decision history](source/founder-decisions.md) preserves the dated implementation context and the service contract. The October 8 MVP plan is available at [main before this migration](https://github.com/eliza-research/thenetwork/blob/a0ed7bc/docs/mvp-plan.md). The October 11 decisions require text-only anonymous probes, a persistent post-match relay, line and budget controls, and shadow-only quality waivers. The October 19 correction removes the public account portal. The later [agent-only signup work](https://github.com/eliza-research/thenetwork/pull/128) and [backend cutover work](https://github.com/eliza-research/thenetwork/pull/132) refine the original launch plan.
