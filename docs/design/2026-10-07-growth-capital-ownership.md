# Growth, network capital and ownership

Status: design proposal, 2026-10-07. The ownership sections are post-MVP. Network capital has an MVP version and a later version. Everyone, including the founders, is just a member: there is no founding-member cohort or special status.

## 1. Framing

The goal of The Network is to grow the network: more members, but above all more capability. That means more people who can help with things, more skills and knowledge within reach, more recurring groups, more warm paths, more cities and more trust. Introductions are one way that capability gets used; they are not the product.

The pitch is a network that its members build and, after the MVP, own. It is not "an AI that introduces you to people". Each member's agent puts the network's capital to work for them. Each member grows that capital by taking part.

The core economic idea is already in PRD Section 5: capital comes in many forms (time, attention, skill, relationships, space, culture, money). The Network's value is that these forms convert into each other more easily than they do through money:
- An hour of advice turns into a warm introduction.
- A vouch turns into a new member who can teach something.
- Showing up reliably turns into trust that opens better opportunities.

Money-based markets handle these conversions badly or not at all. The Network handles them with an agent and a shared ledger.

## 2. Network capital

### 2.1 What it is

Network capital (NC) is the member's account of what they have put into and taken out of the Network. It is the internal unit the Network uses to decide where to spend its own scarce resources: AI effort, reviewer time, invites and proactive reach. It is earned by doing things that grow the network, and lost through behavior that damages it.

It is not a public score, a rank or a measure of a person's worth. It never buys access to a specific person, and never changes whether another member sees you or how you rank for them. PRD Principles 5 and 6 still apply: money buys capacity, never people, and no single score is shown to others.

### 2.2 Strengths

| Strength | Why it matters |
|---|---|
| Aligns incentives with growth | Good vouches, showing up, helping and organizing are rewarded, so the network grows in the ways we want |
| Makes vouching mean something | Inviting someone puts a bounded stake behind them, so quality matters more than quantity |
| Gives a principled basis for AI spend | Deep judge passes, research and concierge work cost real money; spend more where it creates more value |
| Rewards non-monetary contribution | Time, attention, knowledge and introductions are counted even though no money moves |
| Makes capital forms convert into each other | A common unit lets help given in one form be recognized and returned in another |
| Bridge to ownership | NC history is a record of who built the network, which the founding team can use when designing ownership allocation post-MVP (no promise of conversion) |

### 2.3 Risks and mitigations

| Risk | How it fails | Mitigation |
|---|---|---|
| Hidden caste (PRD 24) | More NC brings more AI, which brings better outcomes and then more NC, so a self-reinforcing elite forms | Every member gets a high baseline of service; NC adds effort with strongly diminishing returns; exposure fairness and matching for other people never read NC; cap the maximum tier; audit by NC decile |
| Conflict with Principle 6 (no universal score) | One number collapses multidimensional capital | Keep NC as an itemized ledger with categories. Reliability stays contextual and separate. Never show NC to others or use it in another member's ranking |
| Goodhart and gaming | Vouch rings, staged meetups, farming low-value help, collusion | Credit needs confirmation from the counterpart plus a real outcome; diminishing credit per pair and per period; anomaly detection on the graph; reviewer spot checks; clawback when fraud is found |
| Punishing people for life | Illness, caregiving, disability or volatile work schedules cause cancellations | Cancelling before a cutoff costs nothing; one forgiven no-show (PRD 15.2); declining never costs anything (Principle 7); Quiet, Receiving and Paused states never decay NC |
| Vouch liability chills inviting | Inviters fear being blamed for someone else's behavior | The vouch stake is bounded and only lost for serious, confirmed violations within a window (for example 90 days). Never lost because an invitee is quiet, declines things, or simply doesn't click |
| Crowding out kindness | Paying for prosocial acts can reduce intrinsic motivation and turn gifts into transactions | Don't price individual acts in the member's face ("+5 for helping"). Acknowledge contributions as a story. Gift interactions stay gifts (PRD 18.1) |
| Receiving loses dignity | Members who need help feel they must earn it first | Receiving state and safety support never depend on NC. Asking for help never costs NC in the MVP |
| Coercion | Members feel they must say yes to protect their NC | Only follow-through on commitments you accepted counts. Declines are free |
| Legal | If NC later converts to ownership tokens, it may be treated as a security, a reward subject to tax, or stored value | In the MVP, NC is non-transferable, has no cash value and comes with no promise of conversion. Get securities and tax counsel before any link to tokens |
| Privacy and inference | The ledger reveals behavior | Entries are visible only to the member and to audited staff roles. No private facts go in entry text. Inference rules (PRD 17.2) apply |
| Minors | 13-17s aren't matched, so most entries don't apply to them | Minors are excluded from NC in the MVP |

### 2.4 Earning and losing

| Earn | Lose |
|---|---|
| A vouch that works out: the invitee activates, gets value within 30 days and has no safety flags | A vouched member removed for serious abuse within 90 days (bounded stake) |
| Showing up to an accepted intro, group, plan or event; giving feedback | A no-show after confirming, beyond the forgiven one; ghosting after accepting |
| Helping: answering an ask, giving advice, making an introduction, sharing knowledge, confirmed by the recipient | Confirmed spam, harassment, scams or policy violations (alongside safety action) |
| Organizing at public venues: starting or leading a recurring crew, plan or volunteer outing | Gaming: clawback of credit found to be fraudulent |
| Answering the Network's needs list (for example "we need someone who knows X") | |
| Reviewing and stewarding (staff or trained members, later) | |

Never earned or lost:
- declining;
- being in Quiet, Receiving or Paused;
- inactivity;
- sharing more personal data (rewarding data sharing would pressure privacy);
- anything an invitee does short of serious abuse.

### 2.5 What NC changes

MVP:
- **Agent effort.** Effort tiers decide how much AI is spent on the member: deep judge passes on their candidates, concierge research depth, how often their standing intents are re-searched, and plan-building effort. Effort has a high floor for everyone and diminishing returns at the top.
- **Vouch capacity.** Invite allowance grows with good vouches and shrinks after bad ones.
- **Organizing reach.** Members with good history can start crews and plans that reach more people. Each invitee still has to opt in, and their attention budgets still apply.
- **Reviewer context** (staff only): helps decide whether to approve a member-initiated request.

Never:
- priority for a specific person;
- ranking in anyone else's results;
- visibility to others;
- romance advantage;
- the ability to bypass any safety rule, budget or review.

### 2.6 What members see

- **MVP:** an itemized, private "what you've built" history in the member web and on request by text ("you've vouched for 3 people who are now active; you've helped 5 members; you organized 2 climbing nights"). No number is shown at first. This follows PRD 20.3: don't create visible progression until it is shown to improve belonging rather than hierarchy.
- **Later:** a visible balance, if the pilot shows it helps and doesn't hurt.

### 2.7 MVP vs later

| MVP | Later |
|---|---|
| Internal NC ledger built from events the MVP already records (vouches, attendance, feedback, help confirmations, organizing) | NC as a spendable currency between members: time-bank style requests, with the helper earning what the requester spends |
| Effort tiers, vouch capacity and organizing reach driven by NC | Visible balance; categories and transfers |
| Private "what you've built" view | NC history as one input to the ownership allocation (founding team decides) |
| Bounded vouch stake; flake and abuse deductions with grace rules | Commons-funded missions that pay out NC |
| Simulation of NC dynamics, gaming and inequality before launch | |

### 2.8 Simulation and tests before launch

- Add NC to the simulated world: personas with friends outside the network (potential invitees), mid-run joiners, flaky personas, and gaming adversaries (vouch rings, staged meetups, help farming).
- Measure:
  - NC inequality (Gini by decile);
  - the outcome gap between top and bottom deciles;
  - how often gaming succeeds and how fast it is caught;
  - the effect on vouch quality;
  - whether people with life-driven cancellations are penalized.
- Launch gate: the outcome gap between NC deciles stays within a set bound (for example the bottom decile's 14-day value rate (V14) is at least 80% of the top decile's), and no gaming strategy in the scenario library yields more than a small bounded gain.

### 2.9 MVP-lite build and simulation (2026-10-08)

Status: built in `packages/capital` and simulated before launch. Not yet wired into the Network or the engine. Results, commands and caveats are in [docs/results/2026-10-08-network-capital.md](../results/2026-10-08-network-capital.md).

**What is built:**
- An append-only ledger. Each entry has a category, a sign, and provenance: the event, the counterparts, who confirmed it, and the outcome. Reversals are new entries.
- Members aged 13-17, and members with an unknown age, get no entries.
- Declining, the Quiet, Receiving and Paused states, inactivity, asking for help and sharing data never write an entry.

**Rules that make section 2.4 concrete (defaults):**
- Vouch:
  - The voucher earns 10 when the invitee activates and gets value within 30 days, has no safety flag, and the value came from someone outside the voucher's close circle.
  - If the invitee is removed for serious abuse within 90 days, the voucher's credit is reversed and the voucher loses a further 10.
- Attendance:
  - An accepted plan that the member attended and that was verified earns 2.
  - Feedback earns 0.5. It is scaled by the same anti-gaming multiplier as the attendance.
- Help confirmed useful by the recipient earns 3. Each answered need earns 3.
- Organizing earns 4 per session at a public venue with at least 2 attendees.
- A no-show after confirming costs 3. A late cancellation after confirming counts as a no-show.
- Cancelling at least 4 hours before the start is free.
- One no-show is forgiven per 90 days.
- Ghosting after accepting costs 2. Confirmed abuse costs 20.
- Confirmed gaming claws back every credit earned with the ring, plus a penalty of 10 (once per 30 days).

**Anti-gaming:**
- Credit with the same counterpart decays by x0.5 for each earlier credit with them.
  - The window is 30 days for matches made by the engine or an organizer.
  - The window is 90 days for interactions the pair chose themselves: help, needs, and plans a member started.
- Within a category, each credit in the last 30 days reduces later credits: the multiplier is 1/(1 + n/softN).
- Positive NC is capped at 40 per 30 days.
- Detection flags three patterns:
  - reciprocal rings, using member-controlled credits only;
  - staged meetups: 3 or more plans with the same people, started by a member and verified only by each other;
  - vouch rings.
- A flag goes to a reviewer. It never changes NC by itself.

**Levers:**
- Effort tiers are set at NC 10, 30 and 80. The effort index is 1.0, 1.12, 1.20 and 1.25 (capped).
  - Tier 0 is today's engine default, so everyone keeps the full current service.
  - Each tier changes only the judge pass-2 top-K, deep-pass eligibility, concierge research depth, re-search interval and plan options.
  - Each tier is an overlay for this member's own intents. It is never a ranking input.
- Vouch capacity starts at 2 invites per 30 days.
  - It gains 1 per vouch that worked out, up to 3 more, with a maximum of 5.
  - It loses 2 per lost stake.
  - It is 0 for 90 days after abuse or fraud.
- Organizing reach starts at 8 people.
  - It gains 2 for every 3 sessions, up to 16.
  - It is 4 for 90 days after abuse or fraud.

**Launch gate, measured (8 seeds, 90 days):**
- The gaming gate passes when reviewers work flags. Every strategy ends with a net loss: vouch ring -8.5, staged meetups -9.4 and help farming -10.2 NC, against +16.5 for an honest regular. Median time to detection is 9 days.
- The V14 gate as written (bottom NC decile's V14 at least 80% of the top's) fails: 0.74.
  - It also fails with every NC lever off: 0.75. The gap comes from participation, not NC. NC measures participation, so its top decile is organizers and helpers, who get more value whatever the effort.
  - NC's own contribution is small. The effort lever changes the ratio by -0.010 ± 0.008 (paired seeds), and by -0.016 at 2.5x the assumed effort effect.
- Decision needed: restate the gate as "NC levers must not lower the bottom/top V14 ratio by more than 0.02 against the same population with the levers off", or accept a gate that NC defaults cannot move.

## 3. Lower lift, higher value for the MVP

The MVP should favor opportunities that need little physical resource, money or risk, and that create real value quickly. Anything that needs homes, money custody, goods changing hands or bulk purchasing comes later.

| MVP (light touch, high value) | Why |
|---|---|
| Ask the Network: answers, advice and member-vetted recommendations ("who's a good accountant?", "best climbing gym for beginners?") | AI first, members second; saves money and time; no logistics |
| Warm intros for work: clients, jobs, collaborators, co-founders, investors, mentors | The clearest way members make money; low lift |
| Light help: a 15-minute call, resume or pitch feedback, an introduction, a question answered | High value per unit of attention; bounded |
| One-to-one intros and small groups at public venues | The core MVP |
| Plans and recurring crews at public venues (run club, climbing, dinner at a restaurant) | Fixes "no proposal", creates repeat relationships, no hosting burden |
| Event co-attendance, including volunteer events at existing organizations | Fulfilling "missions" with zero resource draw; uses the existing event inventory |
| Vouch invites plus the Network's needs list ("we need people who know X in Brooklyn") | Growth with quality |
| Monthly all-member gathering per city | Already MVP |
| Information missions: curate, map or compile something useful for the network ("best quiet cafes to work from in the Mission") | Low lift, builds shared knowledge, gives organizers something to do |

Later:
- home hosting;
- borrowing, lending, rental and a marketplace;
- group purchases and collective buying;
- payments, splits and paid services;
- childcare and care swaps;
- partner inventory and unused-capacity deals;
- the Commons and funded missions;
- the ownership protocol.

## 4. Ownership: member-owned protocol and treasury (post-MVP)

### 4.1 Direction

After the MVP, The Network becomes a protocol whose treasury and governance are owned by its members. Everyone, founders included, is a member. Tokens represent an ownership stake in the protocol and treasury. Ownership amounts are decided by the founding team when the system launches. It goes on chain when the time is right; nothing is on chain in the MVP.

### 4.2 Virtual ownership by default, self-custody by choice

- **Virtual ownership:** each member's ownership is held for them and tied to their verified identity (phone number and Network account). They can govern from their phone or through their agent without a wallet, seed phrase or gas.
- **Open claim:** every member has an open claim to their tokens and can choose to claim and self-custody them at any time, subject to eligibility checks.
- **Governance from the phone or the agent:** members can direct their portion of voting power toward proposals by text or through their agent. The agent acts only on explicit member authorization for each decision, or on a standing instruction the member set and can revoke.
- **Gasless voting:** votes are signed and relayed so members never pay transaction fees.

### 4.3 Decision markets for the treasury (Umia-style)

- Treasury allocation and major protocol decisions use decision markets in the style of Umia. For each proposal, participants trade on conditional outcomes ("if this passes, what happens to metric M?"), and the market's forecast informs or decides the outcome.
- Metrics should be network-health measures from PRD 21: meaningful reachable possibility, V14, repeat relationships, capability coverage, safety, plus treasury health.
- Members can take part with their virtual holdings from their phone or agent, without self-custody.

### 4.4 Requirements and guardrails

- **Belonging stays free.** Ownership never buys social priority, matching rank or access to people (PRD 18.1, 18.3).
- **Legal first:** securities, tax, money transmission and consumer protection review per jurisdiction before launch. Ownership and claims are for members 18 and over.
- **Identity and security:** phone-based control is exposed to SIM swaps and account takeover. Claims and large votes need stronger authentication, and there are cooling-off periods and recovery flows.
- **Agent authority:** the agent may vote only within the member's explicit instructions. All agent votes are logged and visible to the member.
- **Anti-capture:** consider caps, delegation limits and vesting to prevent concentration and vote buying. Decision-market manipulation needs market-design safeguards.
- **Data:** governance never exposes personal or graph data. Proposals and markets use aggregate metrics only.
- **Relationship to NC:** NC history may inform allocation, but there is no promised conversion rate, and NC in the MVP has no cash value.

### 4.5 Sequence

1. MVP: no ownership mechanics. Record the NC ledger.
2. After product-market fit: legal structure, token design and allocation decided by the founding team; build the virtual ownership ledger and gasless voting.
3. Launch governance with decision markets on a small part of the treasury; expand as safeguards prove out.
4. Open claims and self-custody once custody, compliance and recovery are ready.

## 5. Metrics

Add to PRD 21:
- **Network capability created** per city: new members who activate, new recurring crews, new skills and knowledge within reach, newly connected clusters.
- **Vouch quality:** share of vouched members who activate, get value and have no safety flags within 90 days.
- **Member-created opportunities:** share of opportunities started by members (asks, crews, member intros, missions) rather than the engine.
- **NC fairness:** outcome gap between NC deciles, and NC Gini.
- **Gaming detection:** rate and time to detection.
