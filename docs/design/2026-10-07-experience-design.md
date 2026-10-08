# Experience design: attention budget, introduction types, plans and continuous conversation (2026-10-07)

Status: design proposal, for founder review. Section 1 (Phase 1) is implemented in `packages/engine/src/attention.ts` and measured in `docs/results/2026-10-07-attention-budget.md` (iterations 1-4). Section 4 (Phase 2, plans) is implemented in `packages/engine/src/plans.ts` and `activities.ts` and measured in `docs/results/2026-10-08-plans.md`; section 4.11 records what was built and the measured defaults. The founder's decisions of 2026-10-07 replace D2, D4 and D5 (section 9) and are written into section 1 below; section 1.11 (availability capture) is new. No LLM calls were made to write it.

slop.date exception (founder decision, 2026-10-08; PRD 40.5): a slop.date probe may include one photo, for adults only (lowest stated age 18+). Name and contact still stay hidden until both say yes. Everywhere else D5 and F2 below still hold: no name or photo before both say yes.

Builds on:
- `docs/research/2026-10-07-match-failures-and-diversity.md` ("the match report"; summarized in `docs/results/SUMMARY.md`, full text in git history at 16cde70)
- `docs/results/2026-10-07-engine-v1.2.md` ("the v1.2 results")
- `docs/results/2026-10-06-luna-error-analysis.md` ("the error analysis"; summarized in `docs/results/SUMMARY.md`, full text in git history at 16cde70)
- `docs/research/2026-10-07-audit.md` ("the audit"; in git history at 16cde70)
- `docs/research/2026-10-07-prompt-optimization.md` (summarized in `docs/results/SUMMARY.md`, full text in git history at 16cde70)
- `data/synthetic/README.md` ("Data model: profile richness and connected sources")
- `packages/engine/src/{config,outreach,generators}.ts` at `engine-v1.2.0`
- `packages/blooio/README.md`
- PRD sections 7.2, 8.2, 9, 12.2-12.3, 28-29, 32.4-32.16, 33, 34

## 0. Summary

The Network today thinks in proposals: the engine selects pairs and groups, and outreach spends a weekly count of proactive messages on them. The evidence says that this framing is the main constraint on value, not match quality:

- Interruption budgets are the biggest pre-selection loss: 70% of never-generated good pairs had a member at budget in at least half the nightly runs (match report, 1.1).
- Structural formats (events, groups) are what actually spread value. They cut the no-proposal share from 19.6% to 2.9% at equal precision in v1.2. Re-rankers (MMR, exposure debt, bridge bonus) move the Gini by ±0.01.
- 51% of missed good pairs on synthetic data have no engine-visible signal at all. That is an information problem, not a ranking problem.
- Only 12.6% of proposals end with every participant accepting. The acceptance step, not the selection step, is where value dies.

Sections 1-7 take the founder's seven directions in order (attention budget, introduction types, the "no proposal" fix, plans, match quality, the evolving member model, conversation). Section 8 is the phased build plan and section 9 lists the open decisions with recommended defaults. The three ideas that carry the rest: budget interruptions rather than opportunities, so one message can carry a menu; measure value every 14 days (V14) rather than proposals; and make time-first plans the default for members a one-to-one intro cannot serve.

### Constraints that hold everywhere in this doc

| Constraint | Where it is enforced in this design |
|---|---|
| No cold outreach | Only members (and vouched invitees, F1) are ever messaged. Probes go only to members. Introducer-routed intros ask a member to forward; the Network never contacts a non-member. |
| Quiet hours | Every agent-initiated message, including digests, reminders and plan logistics (audit P1-8). Only direct replies and safety/account notices are exempt. |
| Auto-pause after two unanswered | Counted per message, not per item. A digest is one message (2.4). |
| Human review under ~1,000 members | Any item that names or probes on behalf of a specific other member is reviewed before the first probe goes out. Outside-world items (events, places, services) are not matches and are sampled, not gated (Decision D7). |
| Minimum age 13; 13-17 never matched | Minors get the personal agent: chat, answers, events, places, solo plans. They are never in any multi-person item, in any role, including as a helper, host, introducer or warm path. Age is re-checked at probe, accept and send (audit P1-5). |
| Romance adults-only, double opt-in | Romance items only between adults who both opted in and stated preferences (v1.2 gate). Romance is never inferred from a plan, never in a group, and never in a mixed digest unless the member allows it (D10). |
| No scraping of non-members | Sources describe only the member (`subject: "self"`). Outside-world suggestions use public listings, never people. |
| Privacy classes | `agent_private` facts are never in a probe, digest, explanation, reviewer view or LLM-judge input without redaction. Probes use only `shareable` attributes. |

---

## 1. Attention budget

### 1.1 Unit of account

The scarce resource is the member's attention, and the thing that spends it is an **interruption**: a message the Network starts that the member did not ask for. The budget counts interruptions, not opportunities.

**Founder decision 3 (2026-10-07): only initial invites count against the cap.** The first message that proposes a new opportunity to a given member counts once against **that member's** cap. For the second person in a pair, their first probe is their initial invite and counts against **their** cap; it needs no break-in and can go out as soon as the first person says yes, within their cap, their quiet hours and their learned send time (1.4). Everything after the initial invite is free: check-ins, the partner follow-up after a yes, the reveal, scheduling, reminders, day-of check-ins, feedback asks and acknowledgements. The hard limits still apply to everything: Blooio's third-unanswered rule (1.9), the two-unanswered pause on initial invites, and quiet hours.

| Message | Initial invite? | Counts against cap | Counts toward two-unanswered | Blooio streak |
|---|---|---|---|---|
| Message carrying at least one new opportunity (probe, menu of 1-3 items, outside-world suggestion) | Yes | 1 (once per message) | 1 | 1 |
| The partner's first probe after the first member's yes | Yes, for the partner | 1 for the partner | 1 for the partner | 1 |
| Re-engagement (D6) | Yes | 1 | exempt from the pause (`meta.reengagement`), still counted | 1 |
| Profiling question, including an opt-in "what's your week like?" check-in with no proposal (1.11 d) | No | 0; one-question rule: at most one open question | 0 | 1 |
| Same check-in carrying a proposal | Yes | 1 | 1 | 1 |
| "Was that worth a text?" and other feedback asks | No | 0 (one-question rule) | 0 | 1 |
| Reveal, scheduling, reminders, day-of check-ins, relay, partner follow-up | No | 0 | 0 | 1 (logistics need <= 2 outstanding) |
| Acknowledgements ("Thanks, noted.") | No | 0 | 0 | folded into the next message, never sent alone (iteration 2) |
| Reply to a member's message, including items offered in that reply | No | 0 | 0 | resets the streak |
| Safety and account notices | No | 0 | 0 | exempt |

Implementation: `attention.ts isInitialInvite`, `countsAgainstCap` (a message counts iff it carries an item whose kind is not in `cfg.notInvites`), `composeMessage` (at cap, only non-invite asks can still go), `outreach.ts isProactive` (`invitation`, `recommendation`) and `isAsk` (profiling and feedback asks: not budgeted, one open at a time).

This keeps PRD 32.9 intact (Normal: 2 proactive messages per week) while letting one message carry up to three things. The match report shows recall saturates at 3 items per week (budget 3: 20.0%, budget 4: 19.4%), and COMBO D's gain came from the third slot. Packing the third item into an existing message buys that gain without a third interruption (D3).

### 1.2 Data model

New types in `packages/core` (engine-local first, promoted later like `NetworkEvent`):

```ts
type ItemKind = "intro_probe" | "plan_probe" | "group_probe" | "event_suggestion" | "place_suggestion"
  | "help_ask" | "advice_route" | "profiling_question" | "reconfirm" | "worthwhile_check" | "nothing_yet";
type Effort = "glance" | "reply" | "meet_short" | "meet_long" | "contribute";

interface AttentionItem {
  id: string; memberId: MemberId; kind: ItemKind; category: Category;
  sourceProposalId?: string;          // engine proposal, plan, or concierge result
  involvesMember: boolean;            // true => human review before the first probe (under 1,000 members)
  effort: Effort;
  enjoy: number;                      // Ê: calibrated P(worthwhile | it happens), 0..1
  accept: number;                     // P̂acc: P(member says yes), 0..1
  urgency: { expiresAt: number; bestBy?: number };
  createdAt: number; reviewState: "not_needed" | "pending" | "approved" | "rejected";
}

interface HeldItem extends AttentionItem {
  heldReason: "cap" | "below_send_value" | "quiet_hours" | "awaiting_review" | "only_when_asked" | "digest_wait";
  revalidateAt: number;               // re-run eligibility (age, blocks, holds, open opps) before any send
}

interface CadencePrefs {               // explicit, set in plain language (F20)
  mode: "digest" | "as_it_comes" | "only_when_great" | "only_when_asked";
  digestDays: number[]; digestHour: number;    // default every day (rolling), 12 local (founder decision 1)
  sendHours?: { weekday: number; weekend: number };  // learned from the member's replies (1.4)
  categoryWeight: Partial<Record<Category, number>>;  // "more of X" 1.5, "less of Y" 0.5, off 0
  maxItemsPerDigest: 1 | 2 | 3;
  romanceInDigest: boolean;            // default false (D10)
}

interface Responsiveness {             // learned, engine-visible only
  replyRateByHour: number[];           // Beta-smoothed, 24 buckets, local time
  medianLatencyMin: number;
  acceptRate: { yes: number; n: number };       // already in world.ts acceptanceOf
  annoyance: number;                   // multiplier r in [0.5, 3], see 1.3
}

interface AttentionLedgerEntry {        // one per outbound message
  messageId: string; memberId: MemberId; at: number; kind: "digest" | "break_in" | "probe" | "question" | "logistics" | "reply" | "notice";
  itemIds: string[]; countsAgainstCap: boolean;
  repliedAt?: number; replyKind?: "pick" | "none" | "more" | "less" | "stop" | "tapback" | "other";
}
```

`OutboundMessage` in `outreach.ts` already groups bundled items under one message id and counts unique ids for the cap and the unanswered streak. The ledger extends that with item ids and the reply classification.

### 1.3 Cost function

Two layers: a **hard cap** on interruptions (PRD 32.9, unchanged) and a **price** that decides what is worth an interruption and what shares one.

**Item value.**

V_i = Ê_i × √P̂acc_i × w_kind × w_m(category_i) × u_i(t)

- Ê_i: calibrated probability the item is worthwhile if it happens (section 5.3). For outside-world items, the calibrated acted-on rate for that member and category.
- √P̂acc_i: acceptance, square-rooted (match report 2.1: ordering by score × √P(mutual accept) gave +30% met and worthwhile, at 98% of the oracle upper bound).
- w_kind: initial weights, tuned in the simulator: intro, plan, group 1.0; event 0.7; place 0.5; help ask to a helper 0.6; advice route 0.4; profiling question = expected value of information (7.3), capped at 0.5.
- w_m: the member's "more of / less of" weight (default 1.0).
- u_i(t): urgency, 1.0 normally, rising to 1.3 for items that expire before the next digest slot.

**Attention cost of a message M.**

A(M) = 1 + Σ_{i ∈ M} e_i × (1 − Ê_i)

| Effort | e | Examples |
|---|---|---|
| glance | 0.1 | An event link, a place, an answer |
| reply | 0.2 | "Up for a climbing partner Saturday?" (probe), a confirm-a-guess question |
| meet_short | 0.4 | Coffee, a 1-2 hour plan |
| meet_long | 0.6 | Dinner, a half-day activity |
| contribute | 0.8 | A help ask, hosting, mentoring (also uses the 2/14d contribution budget) |

The "1" is the fixed cost of the buzz in the pocket. The surcharge is effort weighted by the chance it is wasted, so a confident, low-effort item is nearly free to add to a message that is going out anyway, and an uncertain, high-effort one is expensive.

**Shadow price of attention.**

λ_m(t) = λ_state × (1 + used/cap)² × r_m

- λ_state: Open 0.15, Normal 0.25, Quiet 0.50, Receiving 0.25 (support-only items), Paused ∞.
- used/cap: interruptions used in the rolling window. The second slot of the week costs four times the first.
- r_m: the learned annoyance multiplier, in [0.5, 3]. ×1.5 after a "too much" or "less", ×1.25 per unanswered interruption, ×0.8 after a "more" or a pick within 2 hours. Decays toward 1.0 with a 30-day half-life.

**Send rule.** Compose M from held and new items, best V first, at most `maxItemsPerDigest` (default 3, at most 2 items that involve another member). Send M at its slot if all of these hold:

1. Hard gates pass: state, category opt-in, quiet hours, only-when-asked, review approved for member-involving items, age re-check, Blooio conversation rules (1.6).
2. used < cap.
3. max_i Ê_i ≥ θ_bar (the quality bar, 1.5).
4. U(M) = Σ V_i − λ_m × A(M) > 0.

Otherwise everything stays in the hold queue. Learned signals can only make the Network quieter than the state cap allows. Only an explicit member request raises frequency, and never above the state cap (D11).

### 1.4 Delivery: rolling sends at a learned send time

**Founder decision 1 (2026-10-07, replaces D2): rolling sends, not a weekly digest.**

- **Rolling slot.** Every day has one send slot per member. It is used only when the best held item clears the quality bar and the member has cap; whatever else is ready is batched into the same message (up to 3 items, at most 2 that involve another member). Nothing ready, nothing sent. The member can still ask for a weekly digest ("weekly on Sundays" sets `digestDays`).
- **Send time.** Default around lunchtime local: **12:00**, spread over 2 hours by per-member jitter (burst smoothing, 1.9). A message may go out from the slot until 6 hours after it (`sendTime.windowHours`); a slot missed for a transient reason (quiet hours, the Blooio streak) is retried inside that window only.
- **Learning the send time** (`attention.ts learnSendProfile`). Track when each member actually replies. Replies are bucketed into slots (morning 07-11 → send 09:00, lunch 11-14 → 12:00, afternoon 14-17 → 15:00, evening 17-22 → 18:00), recency-weighted (half-life 28 days), with **separate weekday and weekend profiles**. A profile moves off 12:00 only with **at least 5 replies** in it, when the best slot holds at least 40% of the weight and beats the default slot by at least 15 points. A slot whose send hour is in the member's quiet hours is never chosen. Moving the hour is not a frequency change (D11).
- **Partner probes** (decision 3) go as soon as the first member says yes, inside the partner's send window, within the partner's cap and quiet hours. They need no break-in.
- **Break-ins** (D4, now narrow). With a slot every day, a break-in is only for an item that expires before the next slot (a same-day plan): V ≥ 1.5 × the member's median item V, within the per-state break-in limit (Normal 1/7d, Open 2/7d, Quiet 0) and the cap. Same-day plans use the 1-hour review SLA.
- **Review SLA.** A member-involving item must be reviewed before its first probe; with a daily slot, an item reviewed after today's window waits for tomorrow's.
- **Pull.** "Anything for me?" or "what's on this weekend?" is a member-initiated thread. The reply can show the top held items at zero cost. This is the main channel for Quiet and only-when-asked members.

Reply grammar for a digest: "1", "2 and 3", "none", "not this week", "more like 2", "less of this", or free text. Any reply, including "none" and a tapback, marks the message answered. "none" is not a decline of any person: probe partners are released politely and no pair cooldown is set.

Example (Normal, Thursday 12:17, two things were ready):

> Two things, reply with a number (or "none"):
> 1. Up for a bouldering partner near the Mission, Saturday 10am or Sunday 2pm? I'll only share who it is if you both say yes.
> 2. Fri 7pm: a small film-photography walk in Dumbo, $15, 12 spots left.

### 1.5 Silence below the quality bar

θ_bar is the engine's state threshold (Open 0.22, Normal 0.30, Quiet 0.42) applied to the calibrated item, plus Ê ≥ 0.6 for members in `only_when_great` mode. If no item clears it, nothing is sent: no filler, no "nothing this week". The F21 "nothing fits yet" message is itself an item (`nothing_yet`), sent at most once per 30 days, only inside a digest, and only when the no-proposal diagnosis (section 3) has a remedy to offer with it.

### 1.6 Hold queue

| Field | Rule |
|---|---|
| Capacity | 10 items per member; evict lowest V. |
| Expiry | Event and plan items: the earlier of start − 24h and the probe deadline. Intro probes: 14 days (the reason goes stale). Profiling questions: 30 days. Outside-world items: the listing's end, or 7 days for places. |
| Revalidation | On every send attempt and every 24 hours: age, blocks, safety holds, open opportunities, partner still eligible, partner's own budget, listing still live (audit P1-5, P2-5). |
| Release | Next digest, a break-in, or a member pull. At most one released item per inbound message when a member returns from only-when-asked (audit P2-5). |
| Visibility | Held items are visible on the member web page (32.17) and in the admin member-perspective timeline, with the hold reason. |

### 1.7 Defaults per participation state

| State | Cap (interruptions) | Digest | Break-ins | λ_state | Max items | Item classes allowed |
|---|---|---|---|---|---|---|
| Open | 4 / 7d | Rolling daily slot, learned send time (default 12:00) | 2 / 7d (same-day items only) | 0.15 | 3 | All |
| Normal | 2 / 7d | Rolling daily slot, learned send time (default 12:00) | 1 / 7d (same-day items only) | 0.25 | 3 | All |
| Quiet | 1 / 30d | Rolling daily slot; the cap keeps it to one a month | 0 | 0.50 | 2 | Ê ≥ 0.6 only |
| Receiving | 2 / 7d | Rolling daily slot | 1 / 7d | 0.25 | 2 | Support and low-effort social only; no contribute asks |
| Paused | 0 | None | 0 | ∞ | 0 | Safety and account notices only |
| Only-when-asked (any state) | 0 | None | 0 | n/a | n/a | Pull only; held items shown when asked |
| Member aged 13-17 | 1 / 7d (D9) | Rolling, never after 20:00 on school nights | 0 | 0.25 | 2 | Events, places, solo plans, answers. Never people. |
| First 14 days (newcomer) | State cap | Rolling, plus one welcome item | 1 | 0.20 | 3 | Newcomer welcome and outside-world prioritized |

Caps count initial invites only (decision 3, 1.1). Contribution asks (helper, host, provider, mentor, introducer) keep their own 2/14d budget on top (config `contribution`).

### 1.8 Consent-first probes

**Founder decision 2 (2026-10-07): always probe first.** Every member-involving opportunity is consent-first, whatever its type or category. A probe asks about the activity and the time before it reveals the person, with 2-3 concrete times (1.11 a): "Up for a climbing partner near the Mission, Thursday 7pm or Saturday 10am?"

- Content (D5, unchanged): only the activity, 2-3 time options (or a time window), the area and at most one `shareable` attribute of the other person ("also new to bouldering"). Never a name, photo, employer or anything `matchable` or `agent_private` until both say yes. Time options are built from availability evidence (1.11) and pass the same leak gate as the rest of the text.
- Order: probe the member with the live want first (the seeker or initiator). Only on their yes is the partner probed, with the times the first member picked. Declines therefore cost only the person who asked for the thing, and the partner's scarce slot is spent only on a half-confirmed match. The partner's probe is the partner's initial invite (decision 3): it counts against the partner's cap, needs no break-in and goes in the partner's next send window.
- Reveal: first names, the shareable "why" and the time both picked go to both only after both say yes. Then relay (F16) and scheduling (F17) begin. If no offered time fits both, the reveal proposes the best estimated joint time. Neither side ever learns of a decline (32.10). The reveal and everything after it are not invites (decision 3).
- Cost, measured: consent-first probes cost meetings in the simulator (three answers instead of two; iteration 2: 6-9 met and worthwhile per seed). Iteration 3 measures the founder's defaults with probes on for everything.
- **Reveal as a booked plan (iteration 4, default `consent.reveal: "opt_out"`).** After both yeses, the reveal is the plan: "You're both in: meet Sam, Thu 7pm near the Mission. Reply if you can't make it." There is no third required yes; the time is the one both picked in their probe answers (or the best estimated joint slot). Names are disclosed at the same point as before (after both yeses). Measured: +3.4 to +7.7 met and worthwhile per seed over a required reconfirmation; about 4-6% of reveal recipients would say no once they know who it is, the same share as with reconfirmation.
- **Parallel probes** (both members at once) were measured and are not the default: no gain, about 60% more initial invites spent on opportunities that die on the other member's no or silence.
- **Warm mentions** ("a friend of Sam", `attention.ts warmMention`) fit D5 only as the one shareable fact, with consent from the mutual and from the person described, an anonymity set of at least 3 of the mutual's connections, adults only, never romance. Off by default until that consent is captured.
- Review: the reviewer approves the underlying proposal before the first probe. A partner swap after a decline is a new proposal and is reviewed again (audit P1-9).
- Romance probes are never anonymous-to-identified surprises: the probe states it is a romance intro ("someone you might like to go on a date with"), is sent only to adults with stated preferences, and is always double opt-in.

### 1.9 Interaction with Blooio limits and the two-unanswered rule

Blooio enforces, per conversation, at most 3 unanswered outbound messages, then exactly one re-engagement after 14 days of silence, and about 20-50 new conversations per line per day. Blooio counts every outbound message, while the Network's two-unanswered rule counts only interruptions. The two have to be reconciled in one counter.

| Rule | Design |
|---|---|
| Unified streak | One per-conversation counter `outboundSinceInbound` in the network runtime, shared with the Blooio queue (audit P1-7). Any inbound message or tapback resets it. |
| Reserve the third slot | An interruption may be sent only if `outboundSinceInbound ≤ 1`. Then the Network's own auto-pause (2 unanswered interruptions) always fires before Blooio's limit, and the third Blooio slot stays free for logistics inside an accepted item (a reminder) or a safety notice. |
| Logistics | Reminders and check-ins for an accepted item are sent while `outboundSinceInbound ≤ 2`. If a member stops answering mid-plan, the plan continues without them and they are marked unconfirmed, not messaged a fourth time. |
| Auto-pause | After two unanswered interruptions (72h or expiry, as F28), the member moves to only-when-asked. Their held items stay held; probes on their behalf to partners are withdrawn politely. |
| Re-engagement | Blooio allows one message after 14 days. Use it at most once, at ≥ 30 days of silence, and only if a held item has V above the member's 75th percentile. It is a single item plus "want me to keep sending these?" If unanswered, permanent silence until inbound (D6). It carries `meta.reengagement: true`, which the judge exempts from the two-unanswered check (it still counts toward the streak). |
| New conversations | Digests and probes go only to existing conversations. New conversations are invitations (F1) and first onboarding messages, capped at 20 per line per day, sent 10:00-19:00 recipient local (Blooio's 8am-8pm guidance, inside quiet hours). |
| Burst smoothing | Digest sends are spread over a 2-hour window with per-member jitter, and cities are split into Wednesday and Thursday cohorts once a line has over 500 conversations (audit P2-5). |

### 1.10 Metrics

| Family | Metric | Definition | Target (pilot) |
|---|---|---|---|
| Annoyance | STOP rate | STOP or "stop texting me" per 1,000 interruptions | < 3 |
| | Unanswered rate | Interruptions with no reply within 72h | < 40% |
| | Auto-pause rate | Members entering only-when-asked per 100 member-months | < 5 |
| | "Too much" rate | Members saying "too much", "less" or downgrading state, per month | < 3% |
| | Worthwhile rate | "Was that worth a text?" yes share (F19 sample) | ≥ 70% (PRD 28.2) |
| Value | Good meetings | Meetings held where every attendee rated it positive, per 100 members per month | Tracked, rising |
| | Value per interruption | Value events (3.3) / interruptions | ≥ 0.35 |
| | Time-to-value | Days from onboarding to first value event | Median ≤ 10 |
| | V14 | Section 3.3 | ≥ 70% pilot, ≥ 85% sim |
| Efficiency | Pick rate | Digest items picked / items shown | Tracked by kind |
| | Hold waste | Held items expired unsent with V above the send bar | Tracked; high = cap too tight |
| | Probe yield | Probes that led to a mutual yes / probes sent | ≥ 25% |

All of these are computed from the attention ledger and the event log (32.19), in the simulator and in production, by the same code in `packages/sim/src/judge/metrics.ts`.

### 1.11 Availability capture (founder decision 4)

A plan dies most often on "when?". Every round trip about time is another message, another chance to be ignored, and another slot on Blooio's streak. Availability capture puts the time into the probe, so a yes is a yes to a time.

**The four sources, and what each is good for**

| Source | How | Pros | Cons | Use |
|---|---|---|---|---|
| **Ask in the probe** (a) | 2-3 concrete options in the probe itself: "climbing Thursday 7pm or Saturday 10am?" | No extra message; the answer is current and specific; the member chooses; works on day 1 with no history; fits the one-question rule (it is the same question) | The options are only as good as the evidence behind them; a member who is free only at other times says "neither" (one more turn); 3 options is the limit before the text gets long | **Always**, in every probe for a member-involving opportunity |
| **Standing availability** (b) | "Usually free Tue evenings and Sun mornings", from onboarding or conversation (and `availability_pattern` facets) | Free to use once stated; covers members with no calendar; the member said it, so it is trusted | Goes stale (jobs, seasons, kids); says nothing about one-off conflicts; people over-state it | A **decaying prior**: confidence 0.8 (stated) or 0.5 (inferred), half-life 45 days, re-confirmed after 30 days as a profiling ask ("still free Tuesday evenings?") inside a message that is going anyway |
| **Calendar** (c) | Google free/busy only, never titles (F7) | The best signal of when someone is NOT free; no question needed; catches one-off conflicts | Many people never connect it; a free calendar does not mean free (evenings and weekends are often unrecorded); consent and trust cost; asking for it up front looks like a land grab | **Busy filter only**: a busy block multiplies P(free) by 0.05; a free calendar only nudges P up. Offer it at the **moment of value**, after a first accepted plan: "want me to check your calendar next time so I don't have to ask?" Tentative holds only with explicit consent |
| **Inference** (e) | Times the member accepted and attended | Free; improves with use; specific to the person | Slow to learn; biased by what we offered; cannot tell "free" from "made an effort once" | Learned weight n / (n + 2), **capped at 0.5** until the member confirms it; "can't do those times" answers pull P down |

Plus **(d) an opt-in weekly "what's your week like?" check-in** for members who want plans: one short question at their send time (default Sunday 17:00 local, `availability.weeklyCheckIn`). It is an initial invite only if it carries a proposal; otherwise it is a profiling ask under the one-question rule and does not count against the cap (decision 3). Answers become stated windows for that week (confidence 0.8, expiring at the end of the week). Presence windows (travel) set P = 0 outside the city.

**Recommendation.** Ask in the probe, always, and choose the options with everything else: calendar as a busy filter when connected, standing availability as a decaying prior, inference capped until confirmed, presence as a hard filter. Do not ask for availability as a separate message except in the opt-in weekly check-in; do not require a calendar; offer the calendar once, after the first accepted plan.

**Choosing the options** (`attention.ts chooseTimeOptions`, implemented):

1. Candidate slots in the recipient's local time, 24 hours to 7 days ahead: weekday 19:00, weekend 10:00, 14:00 and 19:00, 2 hours long, inside the opportunity's window if it has one. A fixed-time opportunity (an event) offers its own time only.
2. For each candidate and each member: P(free) = daypart prior (weekday day 0.10, weekday evening 0.35, weekend day 0.45, weekend evening 0.40), moved toward 0.85 by a standing window that covers it (or down by up to 50% when the member has standing windows that do not), toward 0.8 by learned accepts and attends in the same weekday/weekend daypart, × 0.05 for a calendar busy block (or toward 0.8 by 0.3 for a free calendar); 0 in quiet hours or away.
3. Joint P = the product over the members (independent).
4. Greedy: add the slot with the largest gain in P(at least one works) = 1 − Π(1 − joint), at most one per day, until P(any) ≥ 0.9 or an option adds under 0.03, with at least 2 options and at most 3.
5. The first member gets the options; the partner gets the slots the first member picked; the meeting is set at the earliest slot both picked. If none fits, the reveal proposes the best estimated joint slot.

Every option and every piece of evidence is engine-visible only; the probe shows times, never why a time was chosen.

Measured (results doc, iteration 3): when attendance depends on the meeting time, time options halve the share of meeting seats set at a time the member is not free (30% vs 59% with capture off) and add about 2 met and worthwhile meetings per seed; they do not reduce yeses.

---

## 2. Introduction types

### 2.1 Catalog

Status: E = existing generator (`generators.ts`), N = new. "Oracle good" is the simulator label for the type. The existing pair label is: both enjoyment ≥ 0.55. The group label is: mean ≥ 0.55 and min ≥ 0.40. The help label needs the prosocial helper term (match report 4.5): seeker ≥ 0.55, helper ≥ 0.45.

| # | Type | St | Trigger | Inputs | Scoring and oracle good |
|---|---|---|---|---|---|
| 1 | intent_to_capability | E | Live intent needs a skill or offer another member has | Intents, skill and offer facets, structured needs → offers | Fit + complementarity; help label (seeker 0.55, provider 0.45) |
| 2 | complementary_intents (incl. romance path) | E | Two intents fit each other | Intents, desire centroids, romance prefs | Pair label; romance also needs mutual opt-in and preference match |
| 3 | shared_intent_pooling | E | Several members want the same thing | Intents with pool tags | Pair or group label |
| 4 | event_anchor | E | Ingested event fits ≥ 2 members | Events, interests, presence | Pair label at the event; threshold 0.40 |
| 5 | warm_path | E | A member's edge connects two people who should meet | Edges, intents | Pair label; share capped at 5% |
| 6 | help_request | E | Bounded ask needs 1-3 helpers | Help intents, helper offers, load | Help label; F14 home-entry safety class |
| 7 | group_composer | E | Shareable theme with ≥ 4 interested members | Shareable interests, warm ties | Group label; threshold 0.40 |
| 8 | second_encounter | E | Mutual positive feedback + a new context | Interactions, feedback, events | Pair label on the second meeting |
| 9 | newcomer_welcome | E | Member in first 14 days with few edges | Join date, host tags, groups | Group label with newcomer min ≥ 0.45 |
| 10 | network_growth | E | Capability or area gap | Gap analysis, connectors | Invite acted on and invitee activated (no enjoyment label) |
| 11 | expansion | E | Desire outside usual pattern | Desire facets ("miss making things") | Pair or group label, reported separately as exploration |
| 12 | plan | N | Availability window + activity interest | Availability, activity taxonomy, venues, events | Plan label (4.6) |
| 13 | recurring crew | N | ≥ 2 positive plans sharing ≥ 3 members, or a "weekly X" intent | Plan history, feedback, standing availability | Retention: ≥ 60% of crew attend 3 of the first 4 sessions |
| 14 | hosted dinner | N | Member with host tag offers a slot | Host tag, venue (public venue only in MVP, PRD 17.5), guest pool | Group label, host min ≥ 0.50 |
| 15 | skill swap | N | A teaches X wants Y; B teaches Y wants X | Structured needs and offers | Pair label with both "own want met" terms > 0 |
| 16 | mentorship | N | Professional growth intent + mentor offer with capacity | Seniority, offers, contribution budget | Help label over 3 sessions; mentor ≥ 0.45 |
| 17 | accountability partner | N | Two members with the same goal and a check-in cadence | Goal intents, cadence preference | Pair label + ≥ 3 of 4 weekly check-ins completed |
| 18 | travel | N | Temporary presence in the other city (F26) | Presence windows, visitor opt-in | Outside-world acted on, or pair/plan label inside the window |
| 19 | reconnect | N | Positive past meeting or `knows` edge, no contact for ≥ 60 days, new shared context | Edges, interactions, events | Pair label on the reconnect |
| 20 | introducer-routed intro | N | A member knows someone who fits (member or vouched invitee) | Edges, connector role | Introducer agrees; then pair label (member) or invite flow F1 (non-member) |
| 21 | help/advice routing | N | Question the agent cannot answer from the world | Expertise facets, answerer load | Seeker rates the answer useful; answerer ≥ 0.45 |
| 22 | outside-world suggestion | N | Any want with no member fit, or a pull ("anything this weekend?") | Events, venues, services | Acted on (RSVP, went, booked) within 7 days |

### 2.2 Consent, minors and romance

| # | Consent flow | Minors (13-17) | Romance |
|---|---|---|---|
| 1 | Probe seeker; on yes, probe provider (contribution budget) | Never. Outside-world lessons instead. | n/a |
| 2 | Probe initiator, then partner; double opt-in | Never | Adults, both opted in, stated prefs, double opt-in; own message unless `romanceInDigest` |
| 3 | Parallel anonymous probes, quorum | Never | Never pooled |
| 4 | "A couple of people you might enjoy are going; want to meet there?" Each side independently | Event suggestion only, solo | Never anchored on an event |
| 5 | Probe both ends; the connecting member is never named without their consent | Never, including as the connecting member | Never |
| 6 | Seeker states scope; helpers probed in parallel; home address only after all accept | Never as helper or seeker of member help | Never |
| 7 | Parallel probes, quorum 3, alternates | Never | Never |
| 8 | Offered to each in the post-meeting follow-up | Never | Only if the first meeting was a romance intro |
| 9 | Host probed first (contribution budget), then newcomer, then guests | Welcome is an outside-world event list | Never |
| 10 | Ask the connector; they forward a vouch invite (F1) | Never asked; never invited via a minor | n/a |
| 11 | As the underlying type, marked exploration | Outside-world only | Never |
| 12 | Plan probes and quorum (section 4) | Solo plan to a public, age-appropriate event | Never |
| 13 | Each session is opt-in; the crew can move to its own group chat (D14) | Never | Never |
| 14 | Host first, then guests, quorum | Never | Never |
| 15 | Both probed as mutual; either can decline | Never | Never |
| 16 | Seeker first, then mentor; time-boxed to 3 sessions, renewable | Never (mentoring minors is also a high-risk pattern in `config.highRiskPatterns`) | Never |
| 17 | Both probed; the agent runs check-ins as logistics | Never | Never |
| 18 | Outside-world first; intros only to members who opted in to visitor intros | Outside-world only | Only with the member's standing romance consent and stated prefs |
| 19 | Each probed separately: "want to catch up with Ana at X?" | Never | Never re-surfaces a past romance |
| 20 | Introducer first; then each party; nobody learns another's decline | Never as introducer, target or seeker | Never |
| 21 | Question relayed anonymously to 1-3 answerers; the answer relayed back | Answers come from the agent or public sources only | Never |
| 22 | None needed; no other member involved | Yes, age-filtered (no 21+ venues) | Adults only for singles events |

### 2.3 Simulator requirements, scenarios and coverage gates

Legend for requirements: EC event calendar, VN venues, IH interaction history fed back, FB feedback, MJ mid-run joiners, HA hidden weekly availability, HT host tags, SI shareable interests, DF desire facets, RP romance preferences, TP temporary presence, RG relationship graph, OF structured offers, PH prosocial helper term in the oracle. The v1.2 snapshot already emits EC, SI, HT and RP, and fires `second_encounter` 4.8 times per seed (v1.2 results). The rest are new.

| # | Requires | Scenario (packages/sim scenario library) | Coverage gate (3 seeds, 30 days unless stated) |
|---|---|---|---|
| 1 | OF, PH | "A sailing learner joins on day 5; one member teaches sailing" | Fires in 3/3 seeds; precision ≥ 30% (today 12.1%) |
| 2 | RP | "Guitarist and drummer both want a band"; "two compatible daters" | Precision ≥ 40%; romance precision ≥ 25% with RP |
| 3 | - | "Three want a weekend tennis partner nearby" | Precision ≥ 38% |
| 4 | EC | 6 events per city per week | No-proposal share ≤ 8%; precision ≥ 35% |
| 5 | RG, IH | "A friend of a friend has exactly the experience asked about" | Share ≤ 5%; precision ≥ 35% |
| 6 | PH | "Moving a couch Saturday"; home-entry variant | Fires; home-entry with one unacquainted helper goes to safety queue in 100% |
| 7 | SI | "Six film lovers, two know each other" | Group precision ≥ 30%; min enjoyment ≥ 0.40 in 80% |
| 8 | IH, FB, 60-day run | "Two people who enjoyed helping with a move both like a food event" | ≥ 20% of mutual-positive pairs get a second encounter within 60 days |
| 9 | MJ, HT | 10% of personas join after day 10 | ≥ 80% of joiners get a welcome offer within 14 days |
| 10 | gap model | "No hosts in Brooklyn" | Asks ≤ contribution budget; 0 non-member data stored |
| 11 | DF | "Engineer who misses making things" | Exploration share ≤ 15%; precision reported separately |
| 12 | HA, VN, EC | "Four free Saturday evenings, all into climbing" | Fill rate ≥ 50%; plan precision ≥ 40% |
| 13 | HA, FB, 60-day run | "A plan that goes well twice" | ≥ 1 crew forms per city per 60 days |
| 14 | HT, VN | "A host offers Thursday dinner for six" | Quorum in ≥ 60% of offers |
| 15 | OF | "Spanish speaker wants to code; coder wants Spanish" | Fires; both sides' want met in 100% of picks |
| 16 | OF, seniority | "Junior PM wants a mentor; two senior PMs offer" | Mentor load ≤ contribution budget |
| 17 | goal intents | "Two members training for the same half marathon" | ≥ 3 of 4 check-ins in 50% of pairs |
| 18 | TP | "NYC member in SF the 10th to the 14th" | Item delivered inside the window in 100%; never after |
| 19 | IH, 90-day run | "Pair met on day 3, quiet since; shared event on day 70" | Fires; never for blocked, negative or romance pairs |
| 20 | RG, connector role | "Member knows someone who fits a stated need" | Introducer asked first in 100%; no non-member contacted |
| 21 | expertise facets | "Which climbing gym for beginners near Dolores?" | Answer in ≤ 24h in 70%; answerer load within budget |
| 22 | EC, VN | Every member, every week | Every adult and minor gets ≥ 1 eligible outside-world item per 14 days |

**Global gates for every scenario:** 0 minor contacts, 0 canary leaks, 0 invariant violations, 0 over-cap sends, 0 quiet-hour sends, 0 probes without prior review approval. These run in `packages/sim/src/judge/metrics.ts` against every simulated run.

---

## 3. The "no proposal" fix

### 3.1 Diagnosis

The engine already logs a per-member funnel (`FunnelLog`). Add a diagnosis code per member per nightly run, first match wins:

| Code | Condition (engine-visible) | Share today (sim/synthetic, match report) |
|---|---|---|
| X0 not eligible for people items | Minor, paused, only-when-asked, safety hold | Not a failure; excluded from the people-item denominator |
| D1 too little data | No structured want and < 3 matchable facets (`config.ask.minFacets`) | 51% of synthetic misses ("no signal") |
| D2 no live want | Facets exist, no active intent (never stated or expired after 60 days) | Part of the 62 "never above threshold" members |
| D3 no good one-to-one partner | Live want, candidates generated, none above threshold | 62 of 75 no-proposal members; mostly help, romance, growth wants |
| D4 travel or thin network | Candidates fail on presence, area or category density | Shows up in temporary-presence and outer-neighborhood members |
| D5 budget or busy | Eligible candidates exist; member or all partners at cap or in an open opportunity | 70% of never-generated good pairs (sim) |

### 3.2 Remedies

| Code | Remedy | Mechanism |
|---|---|---|
| D1 | Ask one guess-and-confirm question in the next digest; offer to connect a calendar or paste an AI-memory summary; meanwhile send outside-world items from what is known (city, age band, any interest) | `config.ask` (exists, off) turned on with answers fed back. In the richness sim, asking raised adults with a proposal from 54.9% to 62.2% after one answer cycle |
| D2 | Re-confirmation item ("still looking for a running group?"); a want-type menu ("what would make next month better: new friends, a hobby partner, work people, dating?"); plans need no want, only availability | Evidence ledger decay (6.1) |
| D3 | Switch format before giving up: event anchor, theme group, plan, or advice routing; then outside-world; then a standing intent plus an honest F21 with a growth ask | Structural levers: no-proposal share 19.6% → 2.9% in v1.2 |
| D4 | Outside-world first; travel intros to members who opted in to visitors; targeted network-growth ask for the gap | Types 18, 22, 10 |
| D5 | Put it in the menu instead of spending a new interruption; hold queue; substitute a partner with budget; bill only sent items | Sections 1.3-1.6; dispatch awareness (+22% met and worthwhile) |

### 3.3 The metric: value every 14 days (V14)

"Everyone gets a proposal" rewards spending attention, not creating value, and it cannot be met for minors or quiet members. Replace it with V14.

**Value event.** For member m, a value event is one of:

| Kind | Credited when |
|---|---|
| Intro | Mutual yes, and either a meeting is held or both exchanged at least one relayed message |
| Plan or group | The member attended (day-of check-in or post-plan factual answer) |
| Event or place | The member acted on it: said they are going, RSVP link opened and confirmed, or reported going, within 7 days |
| Useful answer | The member rated it useful, or acted on it within 72h, or replied positively. Sampled "was this useful?" on 20% of answers (D12) |
| Help given or received | Completed and the recipient's feedback was not negative |
| Second encounter or crew session | Attended |

Not value: a proposal sent, a probe, an honest "nothing yet", a profiling question.

**Definition.** Let E(t) be the eligible members on day t: active (PRD 28.1), tenure ≥ 14 days, not paused. Let v(m, s) = 1 if m has a value event on day s.

V14(m, t) = 1 if Σ_{s ∈ (t−14, t]} v(m, s) ≥ 1, else 0

V14(t) = (1 / |E(t)|) × Σ_{m ∈ E(t)} V14(m, t)

The reported metric is the mean of V14(t) over the days of a period, by city, cohort (newcomer, quiet, minors, richness tier in the simulator) and state. Two companions:

- **Gap length:** for each member, the longest run of days without a value event. Report the 90th percentile. Target ≤ 21 days.
- **Push share:** the share of value events that came from an interruption rather than a pull. A healthy network has a rising pull share.

Targets: simulator ≥ 85% on the v1.2 snapshot, pilot ≥ 70%. The PRD 28.2 first-value bar (60% within 14 days of joining) becomes V14 at day 14 of tenure. Minors and only-when-asked members are reported separately and not held to the target, since their value is pull-only.

---

## 4. Plans as a core product

### 4.1 Why

Plans are time-first, not person-first. A member who says "free Saturday, into climbing" needs no stated want, no rich profile and no perfect partner: a group of compatible people with an activity and a venue clears the bar far more often than a one-to-one intro. This is the structural lever the match report found for diversity and coverage, made into the default experience for D2, D3 and D4 members.

### 4.2 Capture

Availability capture is specified in section 1.11 (founder decision 4); this table lists the channels.

| Channel | How | Effort for member |
|---|---|---|
| Midweek prompt | One item in the Wednesday or Thursday digest: "Free this weekend? Reply with a time and anything you're into." | Reply |
| Standing availability | "I'm usually free Thursday evenings and Sunday mornings." Stored as recurring windows, re-confirmed after 30 days | Once |
| Calendar | Google Calendar free/busy only (F7), already allowed for minors; never event titles | Connect once |
| Pull | "Anything Saturday night?" | Member-initiated, free |
| Learned | Historical accept times; confidence capped at 0.5 until confirmed | None |

### 4.3 Data model

```ts
interface AvailabilityWindow {
  id: string; memberId: MemberId; city: City; start: number; end: number;
  recurrence?: { freq: "weekly"; byDay: number[]; startHour: number; endHour: number; until?: number };
  source: "stated" | "standing" | "calendar" | "learned";
  confidence: number; flexibility: "fixed" | "flexible";
  areas?: string[]; maxTravelMinutes?: number;
  vibe?: string[];                 // "chill", "active", "social", from the member's words
  activityHints?: string[];        // activity ids or free text, matched to the taxonomy
  scope: "matchable";              // never shareable as such; a plan reveals only "free Saturday"
  expiresAt: number;
}

interface ActivityType {
  id: string; label: string; parent?: string;        // "bouldering" < "climbing" < "active"
  groupSize: [number, number]; durationMin: number; costTier: 0 | 1 | 2 | 3;
  setting: "indoor" | "outdoor" | "either"; intensity: 0 | 1 | 2;
  needsBooking: boolean; ageMin: number;              // 21 for bars
  riskClass: "low" | "medium";                        // 17.5 exclusions never appear
  tags: string[];
}

interface Venue {
  id: string; city: City; area: string; h3?: string;
  activities: string[]; capacity?: number; priceTier: 0 | 1 | 2 | 3;
  hours?: string; bookingUrl?: string; ageMin: number; accessibility?: string[];
  source: "maps" | "listing" | "curated"; freshAt: number;
}

interface Plan {
  id: string; city: City; activityId: string; venueId?: string; eventId?: string;
  window: { start: number; end: number };
  hostId?: MemberId; crewId?: string;
  invited: { memberId: MemberId; role: "host" | "guest"; familiarWith: MemberId[]; state: ParticipantState }[];
  alternates: MemberId[];
  size: { min: number; target: number; max: number };
  probeDeadline: number; status: OpportunityState;   // reuses the 32.10 machine
  fallback?: "smaller" | "solo_event" | "next_week";
}

interface Crew {
  id: string; activityId: string; members: MemberId[]; cadence: "weekly" | "biweekly" | "monthly";
  hostRotation: MemberId[]; sessions: string[]; handedOff: boolean;
}
```

The activity taxonomy starts from `packages/engine/src/taxonomy.ts` (shared with the simulator), with about 60 activities in 8 families. Venues come from the PRD 32.6 ingestion plus maps, curated per city by the team for the pilot (about 150 per city).

### 4.4 Engine integration: a planner, not a generator

Plans are a separate planner module that emits plans into the same review and outreach path. **As built (2026-10-08):** `packages/engine/src/plans.ts` (planner, scoring, quorum, fallbacks, crews, probe copy) and `activities.ts` (activity taxonomy, venue type), with a `plans` config section (`config.ts DEFAULT_PLANS`, its own hash, like the attention section). It is not registered in `GENERATOR_NAMES`: that would change the engine config and its hash for every run. A plan becomes an `EngineProposal` with `generator: "plan"` (`planToProposal`) for logs and review, and `plan_probe` attention items (`planItem`).

Why not a plain generator:
- **Windows first.** Generators start from an intent or a pair. The planner starts from aggregated demand per window (who is free Saturday 7-11pm in this city) and builds activity × venue × group.
- **Inventory.** It needs venues and events with capacity and hours.
- **Objective.** Least misery over a group, not pair fit.
- **Lifecycle.** Probes, quorum, backfill and fallbacks span hours to days. That logic belongs in the opportunity workflow, with the planner re-invoked on a decline.

What it shares: hard filters (`filters.ts`, including age, blocks, romance exclusion), retrieval for social fit, pairwise compatibility and beam search (`group.ts`), the judge for top configurations, budgets and review. It runs on the Wednesday pre-weekend run, on any new availability window (debounced 30 minutes), and on decline (backfill).

### 4.5 Plan builder

For each city and window w with at least `size.min` available members:

1. **Demand pool.** D(w) = eligible adults with a window overlapping w by ≥ 2 hours, inside travel range, not in an open opportunity at that time.
2. **Activities.** Candidate activities a with ≥ size.min members in D(w) liking a (interest facets, activity hints, desire facets). Ingested events in w count as activities with a fixed venue.
3. **Venues.** For each a, venues near the travel-time centroid of the likely group, open in w, within the group's price tolerance, age-appropriate.
4. **Group.** Beam search (width 8) over D(w) for groups G of size 2-6:

   u_i(G) = activity_fit_i(a) × venue_fit_i(v) × time_fit_i(w) × (0.5 + 0.5 × mean_{j ∈ G, j ≠ i} compat(i, j))

   U(G) = 0.6 × min_{i ∈ G} u_i + 0.4 × mean_{i ∈ G} u_i

   This is least misery: the group is as good as its least happy member, softened by the average so a strong group is not vetoed by one middling fit.
5. **Familiarity.** Prefer groups where each member has exactly one familiar face (a prior positive edge) and at least one new face. A +0.05 bonus per member who meets this, a −0.10 penalty per member with ≥ 2 familiar faces (closed clique), no penalty for newcomers with none. This replaces warm_path's triangle-closing in group form.
6. **Floors.** min u_i ≥ 0.40, U ≥ the plan threshold (start at 0.40, as for groups), pairwise compatibility floor from `group.minPairwise`, no blocked pairs, no romance framing.
7. **Output.** The primary group, 3 alternates, and a fallback chain.

### 4.6 Probes, quorum, booking and reminders

- **Probe wave.** After review, anonymous probes go to the target group: "Saturday 7pm: bouldering at a gym in the Mission with 3 others who like climbing, about $25. In?" Probes go in the digest if the digest lands before the deadline, else as a break-in.
- **Quorum.** min 3 (2 for activity pairs), deadline the earlier of 24 hours after probes or 30 hours before start. On each decline or expiry, the next alternate is probed (re-reviewed if they were not in the reviewed alternate list). *As built:* the deadline is the earlier of 96 hours after the plan is made and 30 hours before the start (a 24-hour window left most invitees unreached under the 2/7d cap, 4.11); a yes waiting for quorum does not hold the member back from other items, only a booked plan does; activity-partner plans probe the second member only after the first says yes (one-to-one rules).
- **Reveal.** When quorum is met: first names, the shareable why, the group relay thread (F16). *As built:* the reveal is the booked plan (attention v1.2 "(c)"): "You're in: bouldering at <place>, Sat 7pm, with Ana R., Ben K. Everyone pays their own way. Reply if you can't make it." A later yes joins until 6 hours before the start; a "can't" removes only that member, and the plan is cancelled only below 2.
- **Booking.** MVP: the agent suggests the venue and a booking link. The host, or a volunteer among participants, books; everyone pays their own way (32.12). Bookings needing a deposit are not proposed.
- **Reminders.** T−24h and T−3h, day-of check-in. Logistics, not budgeted; quiet hours apply.
- **Fallbacks,** in order: (1) a smaller group if ≥ 2 said yes and the activity allows it; (2) a solo event suggestion for the yes-sayers ("the group didn't come together; this is happening nearby, want the link?"); (3) next week: the demand carries forward as a held plan item with the same activity.

### 4.7 Recurring plans and hosts

- A crew is proposed when ≥ 3 members attended ≥ 2 plans together with mutual positive feedback, or when a member states a recurring intent ("weekly run club").
- Each session is opt-in by reply. The host role rotates among members with the host tag. Hosts use the contribution budget.
- After 3 sessions, the Network offers to hand the crew off to its own group chat, with each member's consent, and recedes (PRD 8.3). Handed-off crews still count as value for V14 when members report sessions (D14).

### 4.8 Feedback and second encounter

A few hours after: factual ("did it happen, who came"), then one question: "anyone you'd do this again with?" Named people become `would_interact_again` edges, feeding second_encounter, crews and the "one familiar face" bonus. Negative answers weaken only that pair, privately.

### 4.9 Simulator and oracle design for plan value

New hidden persona fields in `packages/sim`:

| Field | Shape | Use |
|---|---|---|
| `hidden.availability` | Weekly free windows derived from `routine.freeEvenings` plus weekend blocks, with a per-week busy shock (p = 0.25) | Whether the persona can attend; stated windows are a noisy subset |
| `hidden.activityLikes` | Activity id → liking in [0, 1], drawn from interests | activity_fit truth |
| `hidden.priceTolerance` | 0-3 | venue fit |
| `hidden.groupSizeComfort` | Preferred size range | Penalty outside it (already in the oracle for introverts) |
| `hidden.familiarityNeed` | 0-1 | Penalty when no familiar face, for high values |

Plan enjoyment for persona i:

e_i = 0.22 + 0.35 × like_i(a) + 0.25 × mean_j pairEnjoymentSystematic(i, j) + 0.08 × [has familiar face] × familiarityNeed_i − 0.10 × travelOverTolerance_i − 0.08 × priceOverTolerance_i − sizePenalty_i + chemistry_G

where chemistry_G ~ N(0, 0.10) is drawn per group and per member. Attendance requires hidden availability in w; then the existing flakiness model applies.

- **Plan good** (label): attendees ≥ size.min, mean e ≥ 0.55, min e ≥ 0.40.
- **Plan value:** PV = Σ over attendees of [e_i ≥ 0.5]. This is the plan analogue of met and worthwhile.

The oracle must also adopt the match report's calibration fixes (decision noise keyed by member, pair and week; a weekly slot model for capacity), or plan acceptance will be capped near 0.2 the way pair acceptance is.

### 4.10 Plan metrics

| Metric | Definition | Target (sim) |
|---|---|---|
| Fill rate | Plans reaching quorum / plans probed | ≥ 50% |
| Attendance | Attended / confirmed | ≥ 75% |
| Plan precision | Plans good / plans held | ≥ 40% |
| Probes per filled seat | Probes sent / attendees | ≤ 2.5 |
| Capture-to-plan | Hours from a stated window to a probe | Median ≤ 24h |
| Crew formation | Crews per city per 60 days | ≥ 1 per 50 active members |
| Coverage | Share of members with a stated window who got a plan or fallback | ≥ 80% |

### 4.11 As built and measured (2026-10-08)

Built in `packages/engine/src/plans.ts` and `activities.ts` (config `DEFAULT_PLANS`, now `plans-v1.1.0`), measured in `docs/results/2026-10-08-plans.md` (8 seeds, 150 personas, 30 days; harness `experiments/plans*.ts`; no LLM calls). MVP scope per the growth doc, section 3: public venues and listed events only, volunteer shifts at existing organizations, no home hosting, no money through the Network.

| Design item | As built |
|---|---|
| Data model (4.3) | `ActivityType` (32 activities, 9 families, mapped to facet tags and taxonomy objectives), `Venue` (public only), `Plan`, `Crew`; availability = attention's `AvailabilityEvidence` plus this week's `StatedWindows`. A slot is demand only with a stated, standing or learned window (never the daypart prior alone) |
| Capture (4.2, 1.11 d) | Opt-in weekly "what's your week like?" (Sunday 17:00, a profiling ask, never on the cap) and standing availability at onboarding. The midweek digest prompt and calendar were not added |
| Planner (4.4, 4.5) | Separate from the generators, not in `GENERATOR_NAMES` (keeps the engine config hash); runs Monday and Thursday 09:00 local; least misery with familiarity as specified; invite 4-6, quorum 3; activity-partner plans of 2 only when no group clears the floors; activity fit = a stated interest or want (family fit does not qualify) |
| Probes, quorum, booking (4.6) | Anonymous `plan_probe` carrying the plan's time (D5), review first; deadline the earlier of 96 h after the plan is made and 30 h before the start; backfill from reviewed alternates; the reveal is the booked plan (attention v1.2 "(c)"); a yes waiting for quorum does not hold the member; no double booking within 4 h |
| Fallbacks (4.6) | Smaller group (activity allows 2), solo public event, next week (demand carried, +0.1 fit for 10 days) |
| Crews (4.7) | `detectCrews`: **after one great plan** (>= 3 attendees would do it again; founder decision 2026-10-08), each person opts in (`crewOptIn`, >= 3 to form); weekly sessions, rotating member host, hand-off after 3 sessions |
| Plan allowance (founder decision 2026-10-08) | 1 initial plan invite per member per 7 days on top of the unchanged 2/7d intro cap, for members with a stated, standing or learned window or the weekly check-in (`planAllowanceEligible`, `planAllowanceConfig`); quiet hours, two-unanswered and Blooio limits apply; one plan per message |

Iteration 1 (plan invites on the intro cap), measured against attention v1.2 "(c)" with fixes 1-3: **V14 28.4% → 35.5% (+7.1 ± 1.4 points), adults with no value event 56.1% → 47.8% (-8.3 ± 1.0), Gini of value events 0.686 → 0.637; met + worthwhile 15.0 → 18.5 per seed (+3.5 ± 2.1, not significant)**: plans add +5.5 ± 0.6 met + worthwhile meetings per seed and take -2.0 ± 2.0 from intros through the shared 2/7d cap (+0.23 interruptions per member-week, all within cap). Quorum rate 23% and attendance 65% are below the 4.10 targets (50%, 75%); plan precision 34% (target 40%). 17% of members' first value came from a plan. Invariants: 0 declared minors in any plan role, 0 minor contacts, 0 canary leaks, 0 names in plan probes, 0 over-cap and 0 quiet-hour sends.

What carries the result, and what is still assumed: the weekly check-in (standing availability alone: V14 +2.5, met + worthwhile -1.1 ± 1.0) and window priming, a harness assumption that a member who said "free Saturday" answers a matching plan like a request they made (without it: met + worthwhile +0.0 ± 1.7, V14 +4.1). The pilot should measure that yes rate first. Crews almost never form within 60 days under the 2-plan rule because the planner does not yet regroup people who enjoyed a plan (4.8's `would_interact_again` edges are not fed back yet). The familiarity term measured a small cost to plan quality in the simulator, which cannot represent its benefit; the founder kept it (2026-10-08).

**Founder decisions of 2026-10-08 (current defaults), 8 seeds:** at 60 days met + worthwhile **+8.4 ± 2.4 per seed (32.8 → 41.1)**, V14 **+9.0 ± 0.8 points (26.4% → 35.5%)**, adults with no value event **-10.7 ± 2.2 points**, Gini 0.632 → 0.561 (plans +11.8 ± 1.0, intros -3.4 ± 2.1); at 30 days +3.5 ± 2.2 (not significant), V14 +6.1 ± 1.5, no-value -9.5 ± 2.1. The separate allowance itself measures as neutral against plans on the intro cap (+1.3 ± 2.8 at 60 days): intros still lose meetings because a member waiting on a plan answer or booked into a plan gets no new item meanwhile, not because of the cap. Crews after one great plan form about 0.25 times per seed in 60 days, because held plans average 2.2 attendees. Without the weekly check-in the gain disappears (-3.0 ± 2.1 at 60 days); without window priming it is +3.4 ± 1.9. Every invariant holds, including 0 sends over the intro cap and 0 over the plan allowance. Details: `docs/results/2026-10-08-plans.md`, iteration 2.

---

## 5. Match quality and experience variety

### 5.1 Structured needs and offers

The structured needs-to-offers score picked good pairs at 46-47% against 24-28% for embeddings (liveness/complementarity results), and it is already blended at weight 0.5. The gap is coverage: most members have no structured profile. Extraction (section 7) should produce:

```ts
interface Need  { id: string; memberId: MemberId; what: string; taxonomyId?: string; category: Category;
                  specificity: "vague" | "objective" | "detailed"; strength: 1 | 2 | 3;
                  format?: Format; horizonDays: number; constraints?: string[]; evidenceIds: string[] }
interface Offer { id: string; memberId: MemberId; what: string; taxonomyId?: string;
                  level: "beginner" | "intermediate" | "expert"; willingness: "happy" | "sometimes" | "rarely";
                  capacityPerMonth?: number; evidenceIds: string[] }
```

### 5.2 Questions worth asking

The error analysis puts 28% of pipeline errors on information never collected: how strongly someone wants something, the real want behind a vague intent, and dating preferences.

- **Strength of want**, once per new intent, guess-and-confirm: "Sounds like finding a doubles partner is a real priority, not a someday thing. Right?" Maps to strength 1-3.
- **Romance preferences**, only for adults who opted in, before any romance item: who they want to meet, age range, and what they are looking for. Without them romance runs at 3-18% precision in every score bin; v1.2 already gates on them.
- **Group-size comfort**, asked the first time a group or plan is relevant.

### 5.3 Separate enjoyment and acceptance models

| Model | Predicts | Inputs | Labels | Use |
|---|---|---|---|---|
| Ê (enjoyment) | P(every participant finds it worthwhile if it happens) | Engine score components, judge verdict, category, type | Post-meeting feedback, "worth a text?", reviewer approve/reject | Threshold, and the item value in 1.3 |
| P̂acc (acceptance) | P(this member says yes now) | Acceptance history (Beta prior 0.45, strength 2, as `acceptanceOf`), recent proactive load, hour of day, open commitments, effort | Accept, decline, no-response | Ordering only |

Rank by Ê × √(Π P̂acc). The threshold applies to Ê alone, so a popular-but-mediocre match is never sent just because people say yes. Recommendation: turn `acceptance.exponent` to 0.5 in config once dispatch awareness is on (it is). The match report measured +30% met and worthwhile at 98% of the oracle upper bound (D13).

Calibration: per-category isotonic regression of the engine score onto outcomes, refit weekly. Romance and professional are badly calibrated today (romance flat at 3-18%, professional ≤ 42% at high scores).

### 5.4 Learning loop

| Signal | Label for | Weight | Notes |
|---|---|---|---|
| Reviewer approve without edits | Ê positive (weak) | 0.5 | Under 1,000 members every proposal has one: the densest label |
| Reviewer reject, reason "weak reason" or "wrong fit" | Ê negative | 1.0 | Reason codes are features (32.8) |
| Reviewer reject, "timing" or "capacity" | P̂acc negative | 0.5 | Not a fit label |
| Reviewer edit or swap | Pairwise preference (swap-in > swap-out) | 1.0 | For learning-to-rank later |
| Accept / decline / no response | P̂acc | 1.0 | Declines are weak Ê evidence (AUC 0.63) |
| Met + both positive | Ê positive | 2.0 | The gold label |
| "Was that worth a text?" | Interruption value | 1.0 | Feeds λ and r_m |

Selection bias: outcomes exist only for sent items. Log the propensity of every sent item (exploration picks are randomized), and use inverse propensity weighting when refitting. Reviewer agreement is measured by double review on 10% of items (34.6), and labels from low-agreement categories are down-weighted.

### 5.5 Diversity levers

| Lever | Evidence | Decision |
|---|---|---|
| Events (event_anchor at 0.40) | No-proposal 19.6% → 5.7%, Gini 0.47 → 0.38 | Keep; extend with outside-world events |
| Theme groups (group_composer at 0.40) | No-proposal → 14.6% | Keep |
| Growth wants routed as hobby | Recall +1.6, Gini −0.04 | Keep (on in v1.2) |
| Plans | Structural, same mechanism as events and groups | Add (section 4) |
| Warm_path cap ~5% | Precision +1.5, less triadic closure | Add |
| Exploration 12.5% through `expansion` | Buys ~5 points of coverage at 13.8% precision | Keep, route through expansion |
| MMR 0.10 | Within noise, cheap | Optional |
| MMR > 0.10, exposure debt, bridge bonus, cluster quotas, novelty 0.4 | Gini ±0.01; novelty 0.4 costs 3 points of precision | Do not use |

The principle: diversity comes from changing who can be matched (new formats, new inputs), not from reordering the same eligible pool.

---

## 6. The evolving member model

### 6.1 Evidence ledger

Every claim the Network holds about a member is a ledger entry; facets, intents, availability and preferences are views over the ledger.

```ts
interface Evidence {
  id: string; memberId: MemberId;
  claim: { kind: FacetKind | "intent" | "availability" | "preference" | "need" | "offer"; key: string; value: string };
  source: SourceKind; provenance: Provenance; inferred: boolean;
  confidence0: number; observedAt: number; lastConfirmedAt?: number;
  halfLifeDays: number | null;            // null = no decay
  privacy: PrivacyScope; sensitive?: SensitiveCategory;
  supersedes?: string; status: "active" | "contradicted" | "retracted" | "expired";
  quoteRef?: string;                      // pointer to the message span, never copied into facets
}
```

Effective confidence: c(t) = confidence0 × 2^(−(t − max(observedAt, lastConfirmedAt)) / halfLifeDays).

| Claim kind | Half-life | Re-confirm when |
|---|---|---|
| City, age band, name | None | Member changes it |
| Boundaries | None (only the member removes them) | Never asked again |
| Skills, offers | 365 days | Used in a candidate and c < 0.5 |
| Interests | 180 days | Same |
| Romance preferences | 180 days | Before a romance item if c < 0.6 |
| Intents and needs | 60 days (PRD F9) | At 45 days, inside a digest |
| Standing availability | 30 days | Next midweek prompt |
| One-off availability | Expires at window end | n/a |
| Inferred from sources | Half of the above | Before first use in a probe |

Rules carried from PRD 32.4: said beats inferred; contradictions create a confirmation question, never a silent overwrite; engine-learned state (reliability, edges, feedback) is a separate store and never overwritten by profile syncs. Re-confirmation questions are profiling items and compete for digest space like everything else.

### 6.2 Event-driven re-matching with stability

Triggers (PRD 33.3), each scoped to the affected member and debounced 30 minutes: new or changed intent, facet change with |Δc| ≥ 0.2, new availability window, new event matching an interest, new member in the same city, mutual positive feedback.

Stability rules:
- **Sent items are frozen.** A probe in flight is never retracted for a better match.
- **Hysteresis.** A held item is replaced only if the new item's V exceeds it by ≥ 0.10.
- **Churn budget.** At most 2 held-item replacements per member per week.
- **No visible retraction.** Members never see an offer withdrawn because the engine changed its mind. Withdrawals happen only for safety, eligibility or the partner declining, and use neutral wording.

Metric: held-item churn rate (replacements / held items), target < 15%.

### 6.3 Engine versioning and rollout

`ENGINE_VERSION` plus the config hash already identify every run (ME-004). The rollout ladder:

| Stage | What | Gate to advance |
|---|---|---|
| 1. Offline replay | Re-run the new version on logged inputs (production snapshots, or simulator seeds 1-8) | No invariant regressions; V14, met and worthwhile, and precision within noise or better (8 seeds: precision ±2.5 points, met and worthwhile ±4) |
| 2. Shadow | Runs beside production on live inputs for ≥ 2 weeks; outputs logged, never sent; reviewers label a blind sample | Reviewer approval rate ≥ production − 3 points; no new safety reason codes |
| 3. City rollout | One city first (the one with more reviewer coverage), then the other after 2 weeks | Annoyance metrics within targets (1.10); kill switch reverts by config hash |

Every member-facing number in the weekly review is tagged with the engine version that produced the item.

### 6.4 Learning-curve metrics

| Metric | Definition |
|---|---|
| Time to first good match (TTFGM) | Days from onboarding to the first value event that involved another member |
| Quality vs richness | Precision and V14 by richness tier (simulator) or by matchable-facet count decile (production); the slope should flatten over versions |
| Knowledge gain per question | Δ(matchable facets with c ≥ 0.6) per profiling question asked |
| Re-confirmation yield | Share of re-confirmations that changed a claim |

### 6.5 Simulator personas that evolve

| Behavior | Today | Needed |
|---|---|---|
| Reveal over time | Tiers are fixed for the run | Each persona discloses hidden facets at a rate driven by chat engagement and by questions the Network asks (answer prob by tier) |
| Drift | Desires lapse (`lapsesAt`) | New desires appear (Poisson, 1 per 60 days); interests shift weight |
| Life events | None | Move neighborhood, new job (busy 4 weeks → Quiet), breakup (romance opt-in may change), travel (temporary presence), new member friend joins |
| Mid-run joiners | `joinDay` exists | 10-20% join after day 10 in every scenario run |
| Weekly availability | `routine.freeEvenings` | Hidden windows with busy shocks (4.9) |

Runs that test the ledger and re-matching need 90 simulated days.

---

## 7. Talk to the Network about anything

### 7.1 Message router

Every inbound message is routed before anything else is done. Order of precedence:

| Order | Route | Example | Handling |
|---|---|---|---|
| 0 | Safety and compliance | "STOP", "report Alex", "I'm 15" | Keyword path, safety queue, age reclassification. Run first, including on the first message (audit P1-4) |
| 1 | State and preference change | "slammed until November", "less work stuff" | Update cadence prefs, confirm in one line |
| 2 | Reply to an open item | "2", "none", "yes Saturday works" | Resolve against the latest open digest or probe |
| 3 | Answer directly | "what's a good gift for a climber?" | The agent answers; no member involved |
| 4 | Outside world | "anything fun Saturday?", "good ramen near Dolores?" | Concierge search (F10), returns 1-3 options |
| 5 | Make a plan | "free Saturday night, into live music" | Availability window + activity hints → planner |
| 6 | Match a member | "know anyone who does hardware?" | Draft opportunity → engine → review |
| 7 | Ask a follow-up | Ambiguous or under-specified | One clarifying question, guess-and-confirm |

For members aged 13-17, routes 5 (with people) and 6 are rewritten to 4: the agent offers events, places and solo plans, and says plainly that the Network does not connect members under 18.

A message can trigger several routes (an answer plus a stored intent). The reply addresses the route the member most likely meant; the others become silent updates.

### 7.2 Extraction with privacy classification

Each inbound turn yields zero or more claims for the evidence ledger:

```ts
interface ExtractedClaim {
  kind: Evidence["claim"]["kind"]; key: string; value: string;
  stated: boolean;                         // said vs inferred
  confidence: number;
  privacy: PrivacyScope;                   // classified at extraction
  sensitive?: SensitiveCategory;
  aboutThirdParty: boolean;                // claims about other people are not stored as their facets
  span: [number, number];                  // pointer into the message
}
```

Privacy classification rules, in order:
1. Any sensitive category (health, finances, religion, sexuality, relationship, children) → `agent_private` + `sensitive`.
2. Anything about a minor member → `agent_private`.
3. Anything about a third party → `agent_private` context for the speaker only; never a facet about that person (no non-member profiles).
4. Explicit "don't share this" → `agent_private`.
5. Stated, non-sensitive facts → `matchable`.
6. `shareable` only after the member confirms ("can I mention you're into film photography?") or for facts they volunteered as an introduction.

### 7.3 Progressive profiling

- At most one question per interaction, and none if the member's message was itself a question that has not been answered yet.
- Prefer guess-and-confirm over open questions: "Sounds like you're into bouldering more than ropes. Right?"
- Choose the question with the highest expected value of information: EVI(q) = P(answer) × Σ over candidate items the change in expected V if the answer is known, minus a tone cost. Practically: rank by (a) items blocked on the answer (romance prefs blocking a romance item, strength blocking a threshold call), (b) D1/D2 members, (c) decaying claims in use.
- Inside a reply, the question is free. Sent alone, it is an interruption and is budgeted (F6).

### 7.4 Extraction eval

A new suite in `packages/evals` ("extract-v1"), deterministic scoring, run on cached transcripts:

| Measure | Definition | Gate |
|---|---|---|
| Facet precision / recall | Extracted facets vs hidden truth (persona `public` + `hidden` traits that were disclosed in the transcript) | Precision ≥ 0.85, recall ≥ 0.6 (precision over recall, 32.5) |
| Intent F1 | Matching on taxonomy id and category | ≥ 0.75 |
| Strength calibration | Extracted strength vs hidden `Desire.strength` (Spearman) | ≥ 0.5 |
| Availability IoU | Extracted windows vs hidden windows mentioned | ≥ 0.6 |
| Privacy-class confusion | 4×4 matrix of predicted vs true scope | `agent_private` → `shareable` or `matchable`: **0**, a hard gate. Over-restriction ≤ 15% |
| Third-party leakage | Claims about others stored as facets | 0 |
| Minor handling | Any claim on a 13-17 member classified other than `agent_private` | 0 |

Transcripts come from simulator personas with known hidden truth. The persona agents disclose by tier. Canary facts are planted in `agent_private` disclosures.

### 7.5 Match on what was extracted

Today the simulator snapshot is built from the persona's known profile, not from what an extractor produced. The extraction eval adds an arm in which `buildSnapshot` reads only the extractor's ledger, and the engine runs on that. The **extraction gap** = (precision, V14, met and worthwhile on ground-truth snapshot) − (same on extracted snapshot). It is reported per engine and extractor version, and is the number that says whether conversation quality or matching quality is the bottleneck.

---

## 8. Build plan

Package owners follow the audit's tags: [engine] = `packages/engine`, `packages/core`; [sim] = `packages/sim` (persona, oracle, snapshot); [other] = `packages/network`, `packages/observatory`, sim agent/world (another session); [msg] = `packages/blooio`; [evals] = `packages/evals`; [judge] = `packages/sim/src/judge`.

### Phase 1: attention budget, menu message, hold queue

| Work | Owner | PRD |
|---|---|---|
| `AttentionItem`, `HeldItem`, `CadencePrefs`, ledger types | [engine] core | 32.9, 13.1 |
| Cost function, send rule, digest composer, break-in rule in `outreach.ts`; unify budget definition (audit P2-13) and per-window deferral counting (P2-12) | [engine] | 32.9, 12.3 |
| Hold queue with expiry and revalidation (P1-5) | [engine] + [other] | 32.9, 32.10 |
| Digest copy, reply grammar, probe-first flow | [other] network | 29 F11, F20, F28 |
| Unified per-conversation streak, reserve the third slot, single re-engagement (P1-7) | [msg] + [other] | 36.1 |
| Review gate before any member-involving probe (P0-1) | [other] + [engine] | 32.8 |
| Metrics in judge: annoyance, value per interruption, V14 | [judge] | 21.2, 34.4 |

Test gates: 0 over-cap, 0 quiet-hour, 0 unreviewed probes, 0 Blooio fourth-unanswered over 8 seeds; unit tests for the send rule and reply grammar. Success: in the simulator at Normal 2/7d with 3-item digests, met and worthwhile per seed ≥ COMBO D (19.6, legacy snapshot) at ≤ 0.6 interruptions per member per week; persona worthwhile rate ≥ 60%.

### Phase 2: plans and simulator availability

| Work | Owner | PRD |
|---|---|---|
| Hidden availability, activity likes, price and familiarity traits; plan oracle (4.9); oracle calibration fixes 1-3 of the match report | [sim] | 34.3 |
| Activity taxonomy, venue table, curated venue seed per city | [engine] + data | 32.6 |
| `planner.ts`, `plan` in `GENERATOR_NAMES`, per-generator threshold | [engine] | 33.4, 33.7 |
| Plan lifecycle: probes, quorum, backfill, fallbacks, reminders, crews | [other] network | 32.10, 32.12, 29 F12, F17-F19 |
| Midweek capture prompt, standing availability, calendar free/busy | [other] + [engine] | 32.5, 32.12 |

Test gates: plan scenarios 12-14 pass coverage gates; no minors in any plan, 0 romance-framed plans. Success: fill rate ≥ 50%, plan precision ≥ 40%, V14 (sim) ≥ 85%, no-proposal share on the richness simulator ≤ 10% (today 20.9%).

### Phase 3: generator coverage scenarios

| Work | Owner | PRD |
|---|---|---|
| Scenario library for all 22 types (2.3), 30, 60 and 90-day runs | [sim] | 34.3 |
| New types 15-21 as generators or variants (skill swap and mentorship as `intent_to_capability` variants; accountability and reconnect as `second_encounter`-style generators; introducer-routed and advice routing in the workflow) | [engine] + [other] | 33.4, 12.2 |
| Prosocial helper term; category passed in `recordProposal` | [sim] | 34.3 |
| Diagnosis codes D1-D5 in `FunnelLog`; remedies wired to item kinds | [engine] | 33.10 |
| Coverage matrix test (type × gate) in CI nightly | [judge] + [ops] | 34.1 |

Test gates: every type fires in 3/3 seeds of its scenario, meets its gate, and every global gate holds. Success: generator share has no type at 0%; intent_to_capability precision ≥ 30%; V14 gap-length p90 ≤ 21 days.

### Phase 4: conversation extraction eval

| Work | Owner | PRD |
|---|---|---|
| Router (7.1) with route-labelled golden set | [other] | 32.3, 29 F8 |
| Extraction schema, privacy classifier, evidence ledger with decay | [engine] core + [other] | 32.4, 32.5 |
| "extract-v1" suite and extracted-snapshot arm (7.4, 7.5) | [evals] + [sim] | 34.2, 34.5 |
| Progressive profiling with EVI selection | [other] | 9.3, 29 F6 |
| Evolving personas (6.5) | [sim] | 34.3 |

Test gates: privacy-class gate (0 private → shareable/matchable), 0 third-party facets, 0 minor misclassification; extraction precision ≥ 0.85. Success: extraction gap ≤ 5 points of precision and ≤ 10% of met and worthwhile; knowledge gain per question rising over versions.

Later, after Phase 4: the Ê/P̂acc refit loop on review labels (5.4), learning-to-rank (33.11 post-MVP), and the versioned rollout ladder (6.3) used for every engine change from M6 onward.

### Mapping to PRD milestones (37)

| Phase | Milestones | PRD sections changed |
|---|---|---|
| 1 | M3 (outreach controller), M4 | 7.2, 12.3, 29 F6/F11/F20/F28, 32.8, 32.9, 36.1 |
| 2 | M2 (simulator), M4 (coordination) | 8.3, 29 F12/F17-F19, 32.6, 32.12, 33.3-33.4, 33.7 |
| 3 | M3, M4 | 33.4, 33.10, 34.3-34.4 |
| 4 | M1 (extraction), M2 | 9.3, 32.4-32.5, 34.2, 34.5 |

---

## 9. Open founder decisions

| # | Question | Recommended default |
|---|---|---|
| D1 | Adopt "interruptions, not opportunities" as the unit of the PRD 32.9 budget? | Yes. Caps unchanged (Open 4/7d, Normal 2/7d, Quiet 1/30d); one message may carry up to 3 items |
| ~~D2~~ → **F1** (decided 2026-10-07) | Default send cadence and time | **Rolling sends**, not a weekly digest: a daily slot used only when something clears the bar and the member has cap. Default **12:00 local**; learned per member from reply times (>= 5 replies per profile, 28-day half-life, weekday and weekend separately), quiet hours always respected (1.4) |
| D3 | Raise Normal to 3 per week (COMBO D)? | No. Keep 2 interruptions; get the third item through the menu |
| ~~D4~~ → **F3** (decided 2026-10-07) | What counts against the cap? Break-ins? | **Only initial invites count**: the first message proposing a new opportunity to a member counts once against that member's cap; the partner's first probe counts against the partner's cap but needs no break-in and goes as soon as the first says yes, within cap, quiet hours and send time. Check-ins, partner follow-ups, reveals, scheduling, reminders, day-of check-ins, feedback asks and acks never count. Hard limits stay: Blooio's 3rd unanswered, the two-unanswered pause on initial invites, quiet hours. Break-ins remain only for same-day items (1.1, 1.4) |
| ~~D5~~ → **F2** (decided 2026-10-07) | Consent-first? What may a probe reveal? | **Always probe first** for every member-involving opportunity. A probe shows the activity, 2-3 time options, the area and at most one `shareable` attribute; never a name, photo or employer until both say yes (1.8) |
| **F4** (decided 2026-10-07) | How is availability captured? | Time options in the probe; standing availability as a decaying prior, re-confirmed; calendar as a free/busy filter, offered after the first accepted plan; an opt-in weekly check-in; learning from accepted and attended times (1.11) |
| D6 | Use Blooio's single re-engagement after auto-pause? | Once, at ≥ 30 days of silence, only for a held item above the member's 75th-percentile value, framed as "want me to keep sending these?" |
| D7 | Do outside-world suggestions (events, places, services) need human review under 1,000 members? | No, they are not matches; review a 20% sample weekly. Anything that names or probes for a member is reviewed before the first probe |
| D8 | Plans: does the Network book or hold money? | No (PRD 32.12). Suggest venue and link; the host or a volunteer books; no deposits |
| D9 | Cadence for members aged 13-17 | 1 interruption per 7 days, events, places and solo plans only, quiet hours 20:00-08:00 local on school nights |
| D10 | Romance items in a mixed digest? | Off by default (sent as their own message within the cap); member can allow it |
| D11 | Can learned cadence ever increase frequency? | No. Learning only lowers frequency; only an explicit member request raises it, never above the state cap |
| D12 | What counts as a "useful answer" for V14? | Positive reply, or acted on within 72h, or "useful" on a 20% sampled check |
| D13 | Turn on acceptance ordering (Ê × √P̂acc) by default? | Yes, exponent 0.5, threshold still on Ê alone |
| D14 | Recurring crews: managed forever or handed off? | Offer hand-off to the crew's own group chat after 3 sessions, with each member's consent |
| D15 | Plan size | 3-6 for group plans (PRD 33.4); 2 allowed only for activity-partner plans, which follow one-to-one intro rules |
| D16 | Can partner venues pay for placement in suggestions? | No (PRD 18.3) |
| D17 | May the extractor send `agent_private` message content to the LLM provider (audit P2-16)? | Yes for extraction only, with canaries redacted and no retention at the provider; never to judges or reviewers unredacted |
| D18 | Replace "everyone gets a proposal" with V14 as the headline experience metric? | Yes. Targets: simulator ≥ 85%, pilot ≥ 70%; PRD 28.2 first-value bar becomes V14 at day 14 |
