# Pilot and rollout

The first pilot is slop.date in New York City. Enroll about 40–75 committed adults in a few nearby neighborhoods. A committed member completed onboarding and opted into proactive messages. An active member exchanged a message with the agent or took part in an opportunity in the last 30 days. The Network's own NYC pilot follows slop. Open enrollment in friends and peon does not authorize live matching or sends.

This is the build and acceptance plan for the [product spec](README.md). [Owner actions](https://github.com/eliza-research/thenetwork/issues/22), the [cutover issue](https://github.com/eliza-research/thenetwork/issues/126), and [dated results](../../docs/results/) carry changing evidence. Complete each gate with current evidence before promoting a release.

## Delivery order

| Step | Owner | Depends on | Acceptance |
|---|---|---|---|
| 0. Confirm owner decisions | Founder and ops | | Record live-send approval steps and operating targets. Resolve remaining owner decisions before they gate the relevant rollout. |
| 1. Qualify the backend and sites | Platform | 0 | Qualify the always-on Eliza backend and the matching signed Pages proxy pair. Preserve account and history continuity with the canonical Postgres database. Identify the deployed build. Stage before production. |
| 2. Qualify data and recovery | Platform | 1 | Apply reviewed migrations using the owning login. Run the application under a restricted login. Turn on backups and point-in-time recovery. Restore in isolation and replay erasures. |
| 3. Qualify the shared line | Platform | 1, 2 | Eliza gateway receives Blooio, calls the signed turn and sends its returned replies. Backend proactive messages go through signed Eliza delivery. Qualify provider receipts, persisted queue, retry, send fences, the one live owner and P3 delivery. |
| 4. Qualify agent-first onboarding | Platform and engine | 1, 3 | Real in-agent signup and readback use the same account and approved app. Check invite, age and preference readback with actual supported clients. Qualify matching profile fields and the Eliza conversation path. |
| 5. Qualify private photos and ratings | Platform and engine | 2, 4 | Adult and consent checks precede intake. Recheck on completion. Use private storage, active Clef rating policy and weekly ratio monitoring. P2 alone changes the placeholder weights. |
| 6. Staff the review desk | Platform and reviewers | 1 | Slop review is app-scoped and names the real reviewer. Train and calibrate reviewers. Run the slop pack in shadow. Check deadlines, rubrics and SLA alerts. |
| 7. Qualify probes and relay | Engine and platform | 3, 5, 6 | Text-only anonymous probes, independent yes, a short public first date, persistent post-match relay, consent per item and no appearance leak. Qualify the Clef hold path and the relay audit. |
| 8. Qualify feedback, reports and bans | Platform | 7 | Check post-date feedback, an actionable report, holds and bans, consent withdrawal and age downgrade, including queued relay and photo intake. |
| 9. Qualify consent and HELP live | Platform and ops | 3 | Check STOP, STOP ALL, START, HELP and leave on a test phone. One keyword owner. No sends after STOP outside the compliance path. |
| 10. Deploy the Observatory | Platform and ops | 1, 6 | Private access, staff sign-in with second factor, app roles, app and safety dashboards, and audited read/reveal. |
| 11. Turn on monitoring | Platform and ops | 1 | External uptime and heartbeat, queue/backlog, send failures, SLA, safety and invariant alerts with owners. |
| 12. Confirm costs and audit closure | Platform, engine and ops | 4, 5, 11 | Cost ledger and daily alert cover LLMs, Workers AI and carrier costs. Close P0 and slop-relevant P1 audit findings or record their approved disposition. |
| 13. Shadow, approve, then live | Founder, reviewers and ops | 1–12 | Review all shadow proposals for at least 14 days. Confirm the precision baseline and the committed adult cohort. Obtain separate approval to enable live sends. |

Workstreams are the app packs and their worlds, and the platform and integrations. The pack sequence is the shared conformance core, slop, local friends and peon, then attention, plans and capital across apps. The cross-app platform can proceed in parallel with the slop pack. Each pack runs on the shared engine with app-specific rules.

The original estimate was about 35 engineer-days plus shadow. See [historical PRD §37](source/prd.md#37-mvp-build-plan-and-milestones) for the original milestones and estimates. Railway is the prior backend plan. [PR #132](https://github.com/eliza-research/thenetwork/pull/132) records the approved direction to pair each Pages project with the selected Eliza backend. The deployment itself still needs public signed API and real-client evidence. Avoid two active send owners during the handoff.

## Prototypes

| ID | Exercise | Decision or acceptance |
|---|---|---|
| P1 | Concierge pilot with 20–30 NYC adults, human-composed probes and shadow engine | ≥25% mutual yes, ≥60% of booked dates happen, ≥20% want a second date. Actual sends require approval. |
| P2 | Fit Clef on consented and labeled adult photos. Plan for about 4,000 labels from six or more raters on 600–1,000 photos. | Held-out AUC improves over placeholder and group and rating-quintile ratios are ≥0.85x. Use the [P2 decision rule](../../docs/results/2026-10-09-clef-fitting.md) for fitting and promotion. |
| P3 | Qualify Blooio on 10–20 test phones for three days | Measure throughput, new-conversation cap, receipts and attachments. Require delivery margin and no account flag. |
| P4 | Compare rules-only onboarding with rules plus the LLM reader on controlled and consenting journeys | ≥80% hard fields complete in 24 hours, ≤12 turns and zero wrong gender or seeking values. Check readback and ambiguous text. |
| P5 | Photo in probe | Closed by founder on October 11. Probes are text only and members cannot view each other's profile. Code and simulations use the no-photo arm. |
| P6 | Curate 50–100 public NYC first-date venues | ≥80% rated good. Decide which booking links or partner reservation options are appropriate. |
| P7 | Hand-run relay in P1 | Persistent post-match thread. Optional number exchange and voluntary per-item photo share. Qualify wire support before offering an unsupported item. |
| P8 | Evaluate indicators of unreliable age attestations without ID | Measure with consented or fictional journeys. Fix the required safety gate before live sends. A phone-based ban remains binding. |

## Evidence before live Slop sends

- All blocking simulation gates pass on pinned seeds. Require zero private or cross-app leaks, invariant violations, underage multi-person contacts and stated filter violations. Run real Postgres integration including security, and full HTTP end-to-end journeys. A skip in a required Postgres gate does not count as evidence.
- The slop age-liar contact, adversary contact and harm-event reductions each target at least 90%. Fix those safety cuts before live sends. The founder's shadow-only waivers apply to dates per member-month, smallest-group ratio, second dates, reveal back-outs and probe text length. Each still gets weekly review. Shadow permission is not live permission.
- Exercise the signed inbound and persisted outbound pipeline with a simulated Clock, real throwaway Postgres, controlled personas and a provider substitute. Include review, keyword join, probe and booking, duplicate turns, outage, restart, STOP, leave, age changes and queue expiry. Require zero lost or duplicate messages, zero ordinary sends after STOP, zero minor contacts, expected app routing and terminal queue outcomes.
- Qualify the real agent and the real provider separately. Record agent client, version, model, provider, supported consent surface, observed result and evidence. Run scripted and real-model journeys for ambiguous consent, profile readback, member privacy, scam handling, application routing and age safety. Use fictional or consenting members. Review the app path before enabling any new send or matching switch.
- Measure P3 and confirm STOP, HELP and report on the test line. Staff and rehearse safety on-call. Require urgent response within 1 hour and others within 24 hours. Confirm the Observatory audit and two-click member evidence. Verify one backup restore and cost alerts.
- Run two weeks or more of shadow review and retain the precision baseline by category. The proposed baseline targets 80% reviewer approvals without edits, 40% recipient opt-in and 70% worthwhile interruption. Confirm the founder-approved baseline and staff the SLA.
- Reach at least 40 committed NYC adults. The founder approves live sends for the app after the gates. Only an authorized operator switches matching on and records the change.

For per-pack validation, see [PRD §40.8](source/prd.md#408-simulation-and-testing-per-app), the [simulation runbook](../../docs/runbook-simulation.md) and [test policy](../../docs/tests-policy.md). slop uses pinned seeds 13–16 over four weeks with private ratings on and text-only probes. The slop scammer median reach target is at most one. Friends measures repeat groups, friendship improvement over one-off dinners, zero travel/affinity/age violations and V14 ≥85%. Peon checks ≥0.8 outcome ratio at each automated stage, zero protected/proxy judge mentions, zero jobs missing pay range or unverified employers reaching candidates, and refusal of all discriminatory requests. The shared conformance suite covers age, consent order, blocks and holds, privacy canaries, budget and quiet hours, judge veto, deterministic replay and mutual geo. Product test and formal obligations are distinct from recorded release evidence.

## Weekly Slop pilot scorecard

| Measure | Gate | Pause or roll back |
|---|---|---|
| Mutual yes per probe | ≥25% | Under 15% for 2 weeks |
| Dates held per mutual yes | ≥60% | |
| Second-date rate | ≥20% | |
| Median time to first date | ≤14 days | |
| Worthwhile interruptions | ≥70% | Under 50% |
| Mute, STOP or complaint rate | Under 5% | Over 10% |
| Minor contacts | 0 | Any |
| Safety reports per 1,000 dates | Track and answer urgent reports in 1 hour | Any harm to a minor or rating/contact leak |
| Outcome ratio by rating quintile and group | ≥0.85x | Under 0.8x |
| Probes received by top 10% of members | ≤20% | |
| Reviewer time per sent proposal | ≤2 minutes | |
| Cost per active member-month | Owner-set target | Over budget |
| Blooio delivery failures | Under 2% | Any carrier account flag |

Track V14 at ≥85% in simulation and ≥70% in the pilot. For the wider Network MVP, measure opt-in ≥40% of sent proposals, completion ≥70% of mutually accepted opportunities, ≥20% of positive first meetings leading to another interaction within 60 days, first meaningful outcome within 14 days for ≥60% of members, and ≥30% of members vouching for someone with invitee activation comparable to seed activation. Track reach and opportunity distribution by group, newcomer and neighborhood. Record denominators and uncertainty. Use the [PRD experiment matrix](source/prd.md#appendix-c-validation-experiment-matrix) for comparisons.

## Owner decisions and follow-up

- Track whether same-face ban evasion detection is in scope before pilot. Phone and person bans apply today.
- The configured line limits remain 20 new chats and 200 agent-started messages per day until P3. The daily cost alert is $50 across all apps. Owners still set cost per active member, monthly budget, unit prices, recovery objectives and on-call roster.
- The Clef ratings default is on. Use placeholder weights until P2 qualifies a fitted file with provenance. Use the production Clef relay classifier before live relay; missing classifier support holds otherwise eligible text for staff. Keep peer visibility restricted to consented relay.
- Keep live matching and sends for friends and peon local until an independent founder decision. Qualify their own worlds and production entry before expanding. New York City's broader Network pilot follows slop. Any new live city follows the [expansion gates](source/prd.md#256-expansion-gates).
- Follow the existing support and operator routes for unanswered questions about retention, security key rotation, recycled numbers, legal requirements, role scope and separate lines. See the [historical gap analysis](../../docs/mvp-gaps.md#5-open-platform-questions) for original questions and [owner tracker](https://github.com/eliza-research/thenetwork/issues/22) for current dispositions.
