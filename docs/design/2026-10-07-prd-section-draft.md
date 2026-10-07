# Experience design: attention budget, plans and continuous conversation

(Draft for insertion as a new PRD section. Full design: `docs/design/2026-10-07-experience-design.md`. Amends 7.2, 8.2, 9.3, 12.3, 29 F6/F11/F12/F20/F21/F28, 32.9, 33.3-33.4, 33.10.)

## Principles

The scarce resource is the member's attention, not the Network's supply of opportunities. The Network therefore budgets interruptions, not proposals; measures value delivered, not proposals sent; and treats the conversation itself as the product, so onboarding never ends. In the simulator, interruption budgets were the largest single reason good matches were never made, and new formats (events, groups), not re-ranking, spread value to members who got nothing.

All existing rules hold: no cold outreach, quiet hours on every message the Network starts, auto-pause after two unanswered interruptions, human review of every proactive match while the Network is under about 1,000 members, members aged 13-17 get the personal agent but are never matched or connected, romance is adults-only with double opt-in and stated preferences, no data on non-members, and `agent_private` facts are never shared.

## Attention budget

**Unit.** An interruption is any message the Network starts that the member did not ask for. The caps are unchanged: Open 4 per 7 days, Normal 2 per 7 days, Quiet 1 per 30 days, Receiving 2 per 7 days (support only), Paused none. Replies to the member, items offered inside a member-initiated thread, and logistics inside an accepted opportunity are free. Safety and account notices are always sent.

**Menus.** One interruption may carry up to three items, for example a weekly digest: "Three things for this weekend, reply 1, 2, 3 or none." Any reply, including "none" or a tapback, counts as answered. The default digest is weekly on Thursday evening, local time, and the member can move it.

**Pricing.** Each item's value is its calibrated chance of being worthwhile times the square root of the chance the member says yes, weighted by the member's "more of / less of" preferences. Each message costs 1 for the interruption plus, per item, its effort times the chance it is unwanted. A message is sent only if its total value exceeds the member's price of attention times its cost. That price rises as the weekly cap is used and as the member shows signs of annoyance. Learned signals can only make the Network quieter; only the member can ask for more.

**Silence.** If nothing clears the quality bar, nothing is sent. There is no filler.

**Hold queue.** Good items that do not fit wait in a per-member queue (up to 10) with an expiry: event and plan items before start, intros after 14 days. Every item is re-checked before sending, and members see held items when they ask.

**Consent-first probes.** The Network asks about the activity before revealing the person: "Up for a climbing partner Saturday morning near the Mission?" A probe may include at most one shareable fact about the other person and never a name. The member with the live want is asked first, so a decline costs only the person who asked; names and the shareable reason are revealed only after both say yes. The underlying match is reviewed before the first probe.

**Messaging limits.** Blooio allows three unanswered messages per conversation and one re-engagement after 14 days. The Network sends an interruption only when at most one message is unanswered, so its own two-unanswered pause always comes first and the third slot stays free for reminders and safety. After auto-pause, Blooio's single re-engagement is used at most once, after 30 or more days, for a high-value item only. New conversations stay under 20 per line per day.

## Every member gets value every 14 days

The experience goal is no longer "everyone gets a proposal". It is **V14**: the share of active members (tenure 14 days or more, not paused) who had at least one value event in the last 14 days, averaged over days. Value events are: a mutual intro that led to a meeting or an exchange; a plan, group or event the member attended; an event or place they acted on; an answer they found useful; help given or received. Proposals, probes and "nothing yet" messages are not value. Targets: 85% in the simulator, 70% in the pilot. The first-value bar in 28.2 becomes V14 at day 14.

When a member gets nothing, the engine records why and applies the matching remedy:

| Diagnosis | Remedy |
|---|---|
| Too little data | One guess-and-confirm question in the next digest; offer to connect a calendar; outside-world suggestions meanwhile |
| No live want | Re-confirm the lapsed want, or offer a short menu of want types; offer plans, which need only availability |
| No good one-to-one partner | Change format first (event, group, plan, advice routing), then outside-world, then an honest "nothing yet" with a growth ask |
| Travel or thin network | Outside-world first; visitor intros to members who opted in; a targeted invite ask |
| Budget or busy | Add it to the menu, hold it, or substitute a partner with capacity |

## Plans

"I'm free Saturday night and into live music" is a core product. The Network captures availability through a midweek prompt in the digest, standing weekly availability, Google Calendar free/busy, or a member's own message. A planner, separate from the pair generators but sharing their filters, review and budgets, builds plans: an activity, a venue or public event, and two to six compatible free members. Group scoring is least-misery (the group is judged mostly by its least happy member), with a preference for one familiar face per person plus new faces.

Anonymous probes go out with a quorum (normally 3) and a deadline; alternates fill declines; names are revealed at quorum. The Network suggests the venue and a booking link; the host or a volunteer books, and everyone pays their own way. Reminders go out the day before and a few hours before. If the plan falls short, the fallbacks are a smaller group, a solo event suggestion, or carrying the demand to next week. Plans that go well twice can become recurring crews with a rotating member host, handed to their own group chat after three sessions if members agree. Feedback asks "anyone you'd do this again with?" and feeds second encounters.

Members aged 13-17 get solo plans to public, age-appropriate events only. Plans are never framed as romance.

## Introduction types

The 11 engine generators are joined by plans, recurring crews, hosted dinners (public venues only), skill swaps, mentorship, accountability partners, travel, reconnects, introducer-routed intros, advice routing, and outside-world suggestions (first on the 12.2 ladder). Each type has a trigger, consent flow, minors and romance rules, and a simulator coverage gate that must pass before it ships.

## The conversation is the product

Every inbound message is routed first: safety and compliance; state changes; replies to open items; a direct answer; an outside-world search; a plan; a member match; or one clarifying question. For members under 18, member-match and group-plan routes become outside-world suggestions. Each turn may yield claims (facets, intents, needs, offers, availability), each classified for privacy at extraction: sensitive topics, anything about a minor, and anything about third parties are `agent_private`. Claims live in an evidence ledger with source, confidence and decay; wants are re-confirmed every 60 days. The agent asks at most one question per interaction, preferring guess-and-confirm. Extraction is measured in the simulator against hidden truth (with zero tolerance for private facts marked shareable), and the engine is evaluated on what was actually extracted.

## Rollout

Phases: (1) attention budget, menus and hold queue; (2) plans and simulator availability; (3) coverage scenarios for every type; (4) the extraction eval. Engine changes go through offline replay, two weeks of shadow mode, then one city at a time.
