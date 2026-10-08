<!-- Snapshot of the canonical PRD (Google Doc). Edit the Google Doc, not this file. https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit -->

THE NETWORK
Product Requirements Document
The Network is an intelligence for discovering and activating the latent potential between people. It creates the conditions for useful, surprising, meaningful things to happen - without requiring people to spend more of their lives managing social coordination.
Version 0.2 (October 5, 2026). This revision resolves every review comment, adds a precise MVP definition (Section 28), all user flows (29), an Eliza platform gap analysis (30), MVP architecture and subsystem specs (31-33), the testing and simulation strategy (34), the admin and analytics console (35), the remaining launch requirements (36), the MVP build plan (37), and the review decision log (38). Sections 18-19 (business model and Commons) are explicitly deferred until after MVP. Section 40 (October 8, 2026) adds the multi-app platform: three apps for work, friendship and love, powered by The Network.

# Contents
1. Executive summary and pitch
2. Problem: why lives contract
3. Product vision, goals, and non-goals
4. Foundational product principles
5. Capital as a vector
6. The opportunity model: engineered synchronicity
7. Members, roles, and participation states
8. End-to-end member experience
9. Phone-first onboarding and progressive profiling
10. Native app and web UX/UI
11. The Network Gateway: ChatGPT, Claude, Grok, Muse, and future assistants
12. The Network agent
13. Social graph and data model
14. Matching and opportunity engine
15. Engagement, seriousness, trust, and load balancing
16. Location and time intelligence
17. Privacy, consent, safety, and inference boundaries
18. Regenerative business model - no monthly membership fee
19. Network Commons and capital regeneration
20. Validation plan: social hypotheses and mechanical tests
21. Metrics and instrumentation
22. Technical architecture and implementation requirements
23. Human operations, governance, and stewardship
24. Failure modes and mitigations
25. Launch plan and staged roadmap
26. Team and resourcing
27. Open questions and decision log
28. MVP definition: what ships first and what does not
29. User flows and interactions: MVP and later
30. Eliza platform analysis: what exists vs. what The Network needs
31. MVP system architecture
32. Subsystem specifications
33. Matching and opportunity engine v1: detailed design
34. Validation: simulations only
35. Admin console, backend tools, and data analysis
36. Launch requirements we were missing
37. MVP build plan and milestones
38. Review decisions and comment resolution log
39. Growth, network capital, and member ownership
40. Work, friendship, love: the multi-app platform
41. Experience design: attention budget, plans and continuous conversation
Appendix A. Example experiences and conversations
Appendix B. Core data objects and tool contracts
Appendix C. Validation experiment matrix
Appendix D. Research and standards notes

# 1. Executive summary and pitch
The Network is a real-world social intelligence layer. It learns what people care about, what they need, what they can offer, whom they know, where they spend time, what kinds of interaction they enjoy, and how much capacity they currently have. It then looks for moments when bringing the right people, resources, places, timing, and context together could create unusual value.
Core thesis: Most people are surrounded by far more friendship, knowledge, help, opportunity, love, adventure, generosity, space, tools, and useful human capacity than they can currently access. The problem is not only scarcity. It is coordination.
The Network is not primarily a dating product, friendship product, services marketplace, professional network, volunteer app, event platform, or mutual-aid marketplace. It must be general enough to produce all of those outcomes without defining itself by any one of them. The three apps in Section 40 are lenses on the same network, not a narrowing of it. Its unit of value is an opportunity: a plausible configuration of people and circumstances that can make a life larger, easier, more connected, more useful, more surprising, or more meaningful.
The product should feel like engineered synchronicity. The member does not receive a stream of assigned tasks. Instead, the agent occasionally notices that something interesting has become possible: someone nearby needs exactly the kind of help the member likes giving; two people have a reason to meet; a friend-of-a-friend has a capability that could unlock a problem; an underused room plus an organizer plus six curious people could become a dinner; a business has unused capacity that can become a community experience; a person is already going somewhere and someone else would enjoy joining.
The Network is valuable when it increases the reachable possibility of a person's life while decreasing the effort required to coordinate it. It should create surface area, not screen time. It should make people more capable outside the product, not more dependent on it. The goal is to grow the network's capability: more people, skills, knowledge, trust, and warm paths within reach. Members build the Network and, after the MVP, will own it (Section 39); introductions are one output among several. The Network powers three apps that share one engine, one database, one admin panel and one phone login: work (peon.biz), friendship (friends.help) and love (slop.date). slop.date launches first, with ntwrk.love as the home page (Section 40).
Network effects matter: by Metcalfe's law, a network's value grows roughly with the square of its connected members, which is why density within each city matters more than total size (Section 25.1).
## 1.1 Product promise
You have more possible life around you than you can currently see. The Network helps the right possibilities become real.
- For the member: more chances to matter, receive support, meet people for real reasons, try things, and encounter a wider life without managing an endless social calendar.
- For the network: every good interaction creates new edges, information, trust, capability, and future possibilities.
- For the agent: solve things itself when possible; ask a human only when human participation creates meaningful additional value.
- For the company: make money when new economic value or new capacity is created, while returning a defined share of that value to the network's future capability.
## 1.2 What must be true for this to work
1. The Network must become trusted enough that an unexpected message feels intriguing rather than annoying.
2. Matching quality must be high enough that members learn the system usually has a reason for contacting them. While the network is under ~1,000 members, every proactive match is reviewed by a human before it is sent (Section 33.9); weak ideas are re-rolled or dropped, never sent "to see what happens."
3. It must reduce coordination cost more than it creates social obligations.
4. It must understand relationships and warm paths, not just profile similarity.
5. It must protect human attention as a scarce resource and actively prevent overuse of generous people.
6. It must preserve privacy not only at the data-field level but at the inference level.
7. It must be useful when the network is small and become qualitatively more capable as it grows.
8. It must work through ordinary channels - especially phone and existing AI assistants - rather than requiring constant app engagement. It must not build profiles of people who have not joined: no scraped or shadow profiles. Growth comes from a carefully invited seed of high-quality members, and early value comes from single-player concierge help (events, places, plans) until the graph is dense enough for high-conviction introductions.
9. Its economic model must not let money buy social rank, preferential access to people, or algorithmic favoritism.
## 1.3 MVP at a glance
The MVP is slop.date in New York City, the first app on The Network's shared platform (Section 40). People join by texting the one Blooio iMessage line ("slop") or through their own AI assistant, which reads the site's skill file and submits a profile through the MCP server (28.3). Adults are matched by lowest stated age (18+); members aged 13-17 may join but are never matched. The engine with the slop pack proposes pairs, and a human reviews every proposal before the first anonymous probe, which can include a photo. On mutual yes the agent books a first date at a public venue, and anything the two exchange (messages, numbers, photos) goes through the agent with consent per item. The four sites are on Cloudflare Pages and the shared backend runs on Railway. The team runs it from the admin console (the Observatory) and validates it with simulations only (Section 34). The Network's own matching follows in New York; San Francisco comes after the expansion gates (25.6). Payments, the Commons, the native app and hosted-assistant connectors beyond onboarding come later.
# 2. Problem: why lives contract
The enemy is not simply loneliness. It is contraction. Over time, many people develop less social and experiential surface area: fewer places they go repeatedly, fewer weak ties, fewer people they might call, fewer unfamiliar situations, fewer opportunities to be useful, fewer chances to discover a new interest, and fewer spontaneous reasons to be in a room with someone outside their existing pattern.
People often say they do not have time. Clock time is real, especially during demanding life stages, but the product must recognize that lack of time usually bundles several distinct frictions.
| Source of contraction | What it feels like | Product implication |
|---|---|---|
| Unpredictable time | "I may be free, but I cannot promise Thursday." | Offer flexible windows, short commitments, and last-minute opportunities without penalizing declines. |
| Coordination tax | "Making a plan takes six texts and 30 minutes of thinking." | The agent handles scheduling, place selection, reminders, routing, and relays. |
| Low social energy | "A new person might be great, but I cannot handle an awkward night." | Use warm paths, context, bounded duration, group formats, and easy exits. |
| Opportunity-cost anxiety | "I could spend that evening recovering or seeing someone I already love." | Only interrupt when expected value is high; attach opportunities to existing plans. |
| Convenience and efficiency | Delivery, remote work, streaming, and direct-to-door services remove incidental encounters. | Create low-friction real-world collisions around existing routines. |
| Weakening repeated contact | Friends move, have children, change jobs, or become logistically distant. | Support second and third encounters and local recurring patterns. |
| Fear of imposing | People avoid asking for help and avoid offering it. | Normalize both giving and receiving; make scope explicit and consent-based. |
| Identity hardening | "I am not someone who does that." | Introduce carefully chosen expansion opportunities outside the user's usual pattern. |
| Exhaustion | An interesting plan loses to the couch. | Sometimes give time back before asking for more time. |


The 2025 American Time Use Survey reported an average of 5.16 hours per day in leisure and sports for people age 15+, including 2.61 hours watching television and 0.58 hours socializing and communicating; ages 35-44 averaged 3.89 total leisure hours, the lowest among the listed age groups.[1] This does not imply that people have abundant discretionary capacity. It does show why the product cannot treat "time" as a single quantity. Availability, energy, predictability, activation cost, and social risk all matter.
The U.S. Surgeon General's social-connection framework treats connection as a property shaped by individuals, relationships, communities, institutions, and the built/social environment.[2] The Network should therefore be understood as coordination infrastructure, not a behavioral reminder app telling people to socialize more.
## 2.1 The design target: lower activation energy
For any opportunity, a person is implicitly comparing expected delight, usefulness, meaning, growth, and connection against time, travel, planning, uncertainty, awkwardness, obligation, and exhaustion. The Network should obsess over lowering the second side of that equation.
Prefer enriching existing time over claiming new time.
Examples include pairing people who are already going to the same museum, finding someone to walk a dog with a member who was already going outside, turning a moving task into shared time, or solving a planning burden so a parent can participate in something they actually want. Another example: "You have wanted to start making films. Someone you know has a camera they barely use, another member wants acting experience, and a friend has a space free Saturday. Everyone is interested. Shall I arrange it?" Once people commit to something like this, the Network must help them actually show up: proposing and confirming times, checking calendars, reminding, checking in on the day, and finding a replacement without blame if someone drops (Section 32.12).
# 3. Product vision, goals, and non-goals
## 3.1 Vision
Build a network that becomes increasingly capable of creating useful, surprising, and meaningful outcomes as its members, relationships, locations, resources, and economic capacity grow. The product should make members feel that they are part of something that learns with them, remembers what matters, and becomes more useful because they helped build it.
## 3.2 Overarching goals
- Increase the surface area of members' lives without increasing coordination burden. The largest hidden coordination burden is telling the system who you are. Data collection must be progressive, mostly passive (connected sources, conversation, behavior), and valuable on its own as a single-player experience, never a long form.
- Create conditions for relationships to form through real reasons to interact, rather than explicit "matching" alone.
- Make it easy and prestigious to both give and receive.
- Protect human attention by solving problems with AI/search first and escalating to humans only when useful.
- Build a high-quality local social graph that understands who knows whom, who has met, and the contexts in which people interact well.
- Let the system use extended personal networks through permissioned warm forwarding rather than shadow profiling nonmembers.
- Become portable across SMS/voice, native app, web, and third-party AI assistants.
- Generate revenue without a monthly member fee and use commercial activity to increase the network's future capacity.
- Make members more autonomous and connected outside the product over time.
## 3.3 Explicit non-goals
- Not an infinite content feed or attention-maximizing social network.
- Not a public popularity system, follower-count game, or universal social credit score.
- Not a marketplace where money purchases priority access to other humans, or a cold-outreach channel. Members cannot mass-message or recruit other members (no "hackathon DM spam"). Members whose behavior looks like spam or abuse are rate-limited or restricted, and are told why and how to appeal.
- Not a replacement for emergency services, clinical care, regulated professional judgment, or safeguarding systems.
- Not a promise that every need can be met, especially while local network capacity is small.
- Not a system that keeps relationships inside the app to preserve engagement. Members should rarely need to open an app at all: they tell the Network about themselves, it messages them when the timing is right, and life happens outside. The app exists for reviewing and editing what the Network knows, privacy and location controls, and history.
- Not an ideology, belief system, or authority over what counts as a good life.
# 4. Foundational product principles
| Principle | Meaning |
|---|---|
| 1. Create conditions, not outcomes. | The Network can create a reason to meet; it cannot promise friendship, romance, fulfillment, or success. |
| 2. Human attention is scarce. | AI, search, local knowledge, and existing resources should be exhausted before asking people for help unless the human interaction is itself the value. This also applies to learning about members: use what the member has connected or already said before asking them a question. |
| 3. Nothing happening is a valid state. | The product should be willing to say "nothing needs your attention right now." Silence increases trust in interruptions. |
| 4. Belonging is not subscription-gated. | No recurring consumer membership fee. A member's place in the Network is not conditional on paying monthly dues. (A voluntary paid governance membership, discussed in Sections 19 and 27 (earlier idea, superseded by 39.4), would confer voice only, never belonging or social priority.) |
| 5. Money buys capacity, never people. | Commercial spending can fund venues, transport, tools, professional work, childcare, materials, or experiences; it cannot buy social rank or obligation. |
| 6. Capital is multidimensional. | Time, attention, social reach, skill, space, knowledge, and money are different forms of capacity and must not be collapsed into one score. Internally the system does keep contextual estimates (for example, reliability for a type of commitment, or confidence in a claimed skill) on an open, extensible ontology. These are never collapsed into one universal score and are never shown to members. |
| 7. Declining is healthy behavior. | A no protects the network from resentment and burnout. Declining an opportunity never reduces reliability. |
| 8. Reliability is contextual. | Follow-through on an accepted commitment matters; "good person" scores do not. |
| 9. Participation has seasons. | Open, Normal, Quiet, and Receiving states allow members to change capacity without being treated as churn. These are not online/away statuses. They describe how much proactive contact a member wants and about what (Section 7.2). |
| 10. Warm paths beat cold matching. | When appropriate, prefer introductions through people and contexts that create trust and meaning. |
| 11. Recurrence creates relationships. | One-off novelty is insufficient. The product should notice when a second or third encounter could strengthen a useful edge. |
| 12. Expansion matters alongside fit. | The system should sometimes offer a carefully chosen experience outside the user's existing pattern. |
| 13. Privacy includes inference. | Do not use one person's private information in a way that reveals it indirectly to another. |
| 14. The product should disappear when it succeeds. | People who become friends, collaborators, or direct contacts should not need the Network to mediate forever. |
| 15. The Network itself should regenerate. | Economic activity and participation should increase future network capacity, not merely extract value from it. |


# 5. Capital as a vector
The Network should model wealth as a vector of heterogeneous forms of capital. This is a conceptual and technical foundation, not a member score. The network is powerful because different forms of capital can combine and transform into one another.

## 5.1 Core capital dimensions
| Dimension | Definition | Examples | Typical constraints |
|---|---|---|---|
| Financial capital (F) | Actual money that can fund activity or remove a barrier. | Cash, sponsorship, grants, paid transactions. | Budget, purpose restrictions, legal/tax treatment. |
| Social capital (S) | Permissioned relationships and reachable trust paths. | Friends, colleagues, family, warm introductions, community ties. | Consent, tie strength, privacy, reciprocity, social risk. |
| Human capital (H) | Skills, knowledge, judgment, lived experience, and practiced capability. | Cooking, design, local knowledge, mentoring, languages. | Qualification, willingness, context, professional boundaries. |
| Physical capital (P) | Things and spaces that can enable an outcome. | Rooms, rooftops, cars, tools, equipment, spare tickets. | Ownership, insurance, scheduling, access. |
| Cultural capital (K) | Traditions, taste, local context, rituals, stories, norms, and scene knowledge. | Knowing the neighborhood, hosting traditions, music scenes, cultural fluency. | Appropriateness, consent, community boundaries. |
| Attention (A) | Willingness and capacity to notice, listen, think, care, or coordinate. | Listening for 20 minutes, reviewing a plan, making an introduction. | Fatigue, frequency, emotional load. |
| Time (T) | Available human capacity over a specific interval. | 15 minutes tonight, two hours Saturday, monthly hosting. | Schedule, energy, unpredictability, travel. |


## 5.2 Formal model
For a member i at time t, define a conceptual capital state: C_i(t) = [F_i, S_i, H_i, P_i, K_i, A_i, T_i]. Each component is itself structured rather than a scalar. For example, H_i contains capability categories and confidence; S_i is fundamentally a permissioned relationship graph; T_i varies by time window; P_i includes resources with availability and access constraints.
An opportunity o has a required capital profile R_o and an expected created-capital profile G_o. Matching seeks a configuration of participants whose permissioned contribution vectors complement R_o while keeping activation cost, social risk, privacy risk, and load acceptable. The goal is not to maximize ||C_i||. There is no meaningful notion that one member is simply "wealthier" because their vector is larger.
Capital is a vector, not a score. Opportunity comes from complementarity, not rank.
## 5.3 Capital transformation
Financial capital is especially useful because it can transform into other forms: paying for a room creates physical capacity; paying for transport or childcare creates time; paying an organizer creates attention; underwriting a workshop creates cultural and human capital; funding a shared dinner can create new social edges. This is the foundation for a regenerative business model.
The product should eventually track network-level capital deltas for major programs. The goal is not to assign fake dollar values to friendship. The goal is to observe whether spending created durable new capacity: more available hosts, more reachable neighborhoods, more recurring relationships, more bookable space, more members with practiced facilitation skills, or lower participation friction.
## 5.4 What members see
Members should not see an abstract capital score. They can see human-readable inventories such as "things I like helping with," "things I am open to sharing," "people I am comfortable forwarding to," "places I can sometimes host," "what I want more of," and "my current capacity." At the network level, members may see collective capability stories: "The Network can now reliably welcome newcomers in five neighborhoods" or "we have enough musicians to assemble a small band."
# 6. The opportunity model: engineered synchronicity
Opportunity is the core product object. An opportunity is a proposed configuration of people, resources, timing, place, context, and intent that could create meaningful net value if activated. It may originate from a direct request, an offer, a desire, an event in the world, a relationship path, unused commercial capacity, or the agent's recognition of a pattern nobody explicitly asked it to find.

## 6.1 Opportunity sources
| Source | Example | Notes |
|---|---|---|
| Need | "I need two people to help move a couch." | Direct, bounded, functional; may also create social value. |
| Desire | "I miss playing piano." | May not require solving a problem; could become a dinner with a piano. |
| Offer | "I love helping people practice presentations." | Do not overuse because someone is capable. |
| Extended network | "My cousin works in theater." | Ask the member to forward; do not shadow-profile the cousin. |
| Place/event | Several compatible members are already near the same public event. | Attach to existing time; high serendipity potential. |
| Cause | A local garden needs four people Saturday. | Must align with member's stated cause interest and capacity. |
| Unused physical/commercial capacity | A studio has three empty seats Tuesday. | Can become sponsored or paid opportunity inventory. |
| Network need | A new neighborhood cluster lacks a host. | The Network may create opportunities that strengthen its topology. |
| Standing intent | "I want to start a band with people who like rock." "I want to meet climate founders." "I am open to dating." | Overt, durable wants that the member has made room for. Matched asynchronously as new members and events arrive. Capacity is checked on both sides before anyone is contacted. |
| Romantic interest (opt-in) | A member has opted in to romance and described what they are looking for. | Only between adult members who both opted in; delivered as dinners, activities, or friend-of-a-friend introductions rather than swipe-style matches. |
| Professional goal | "I am hiring a designer." "I want a cofounder." "I want to meet people in biotech." | Common early demand; often satisfiable by intros between members with shareable work context. |
| Fun / play | "Surprise me this weekend." A karaoke night with two open spots. | Synchronicity for its own sake: playful, low-stakes, time-bounded invitations. |
| External world (single-player) | Luma, Partiful, Eventbrite, Cerebral Valley, venue calendars, listings. | The agent recommends events and places directly, and turns them into opportunities when two or more compatible members are going or would go. |
| Member introduction | "You would really like my friend Theo." | Members are encouraged to introduce people; the Network handles both sides privately. A primary growth and social-capital mechanism. |
| Network growth | A cluster lacks a host; a newcomer has no edges yet; a member knows someone who would add a missing capability. | The Network asks members to bring in specific kinds of people they can vouch for, and creates welcome opportunities for new members. |
| All-member gathering | Monthly open event per city. | Creates density, warm ties, and natural second encounters (Section 32.16). |


The member experience of sources should be invisible: members never pick a "source." They talk naturally ("I want to get back into music," "anything fun this weekend?") and the agent decides whether the answer is information, a recommendation, a standing intent, or a human opportunity. The Network is about synchronicity, having fun, helping people reach romantic and professional goals, and growing the network itself, not only about matching needs to offers.
## 6.2 Opportunity object
Every opportunity must be structured, even when the member sees conversational language. Minimum fields: objective; origin; beneficiary or initiator; required and optional participants; relevant capital requirements; location and travel radius; time window and flexibility; estimated effort; social format; privacy class; safety class; financial mode; completion condition; cancellation policy; expected value hypotheses; matching explanation; and follow-up policy. Scheduling is a first-class part of the object: proposed time options, each participant's availability evidence, the confirmed time, venue, reschedule history, reminder plan, day-of check-in plan, attendance per participant, and replacement policy if someone drops.
## 6.3 Opportunity language
The interface should avoid turning life into a stream of "quests." The system may use internal state-machine language, but members should receive natural invitations: "I thought of you for something," "I have a strange idea," "there may be an interesting opportunity here," or "I think someone you know might be able to help." The goal is anticipation and curiosity, not gamified compliance.
## 6.4 Relationship formation
A successful one-off interaction should create an edge in the graph, not a finished outcome. If both participants enjoyed the interaction, the system should watch for a natural second encounter. It must not force a friendship narrative. A useful long-term metric is how often two people begin interacting directly without requiring the Network as intermediary.
# 7. Members, roles, and participation states
## 7.1 Core roles
| Role | Meaning | Key permissions |
|---|---|---|
| Member | Invite-only participant with a personal Network agent. | Receive opportunities, ask for help, offer capacity, connect assistants, manage boundaries. |
| Inviter | Member who vouches that an invitee is worth considering. | Issue limited invitations; provide private context; no immunity from later safety review. |
| Connector | Member who is comfortable receiving more "do you know someone?" opportunities. | Forward opportunities into their own network without exposing third-party data. |
| Host | Member willing to bring people together in an approved setting. | Host small events; may receive additional planning tools. |
| Steward | Trained human supporting onboarding, conflicts, safety, and local network health. | Operational access with audited, role-limited permissions. |
| External participant | Nonmember who joins one opportunity via a private link or forwarded invitation. | Only sees the minimum necessary; may later be invited to join. |
| Partner | Venue, business, nonprofit, or institution contributing capacity. | Provide inventory, funding, events, or services; cannot buy social priority. |


## 7.2 Participation states
| State | Default agent behavior | Member meaning |
|---|---|---|
| Open | Higher exploration allowance; may receive spontaneous opportunities within limits. | "Surprise me. I have capacity." |
| Normal | Only high-confidence opportunities plus quiet in-app possibilities. (MVP: lower-confidence possibilities are offered only when the member asks, Section 33.9.) | Default. |
| Quiet | Rare interruptions; preserve context and place in the Network. | "Life is full right now." |
| Receiving | Prioritize support and low-effort social value; do not assume giving capacity. | "I need more than I can give at the moment." |
| Paused | No proactive outreach except safety/account notices. | Member remains part of the graph but inactive. |


States are not online/away statuses. Within any state a member can set per-category preferences (for example: "only tell me about dating and music," "no work stuff," "only when I ask") and quiet hours. Members can say it in plain language ("I am slammed until November," "surprise me this weekend" - an informal "ready to mingle" mode maps to Open). The agent may suggest a state change based on repeated declines or explicit life context. Non-response is handled mechanically and transparently: after two consecutive unanswered proactive messages the member automatically moves to "only when I ask" for proactive outreach, and the next time they message the agent it says so and offers to turn proactive messages back on. This is an outreach setting, not a judgment: it never counts as low seriousness or reliability.
# 8. End-to-end member experience
## 8.1 Entry
A member receives an invitation from a person or steward. The invitation explains what The Network is and offers three ways to begin: text a Network number, call and speak to the agent, or open a lightweight web/app flow. If the member already uses a supported AI assistant, the invitation can also offer to connect The Network there after identity verification. The Network needs members to grow it, but not by inviting strangers. An invitation is a vouch: the inviter tells the agent how they know the person, for how long, how well, what the person is like and wants, and anything the Network should know. Vouch strength (relationship depth, duration, context) is stored as evidence on the invite edge and seeds the new member's profile with consent. Invitations are scarce and intentional; the Network may ask a member for a specific kind of person it needs ("we have few hosts in Brooklyn; do you know someone?"). New-member approval is automatic with an internal soft-approval score; only flagged cases go to a human. (Post-MVP.) The minimum age to join is 13. Under-13s are declined at join with a kind message, and no data is kept beyond what is needed to decline. Members aged 13-17 can use the agent as a personal agent (chat, things to do, events, learning) but are never matched or connected to other people (Section 17.4).
## 8.2 First value
The first goal is not profile completeness. It is a useful outcome within the first two weeks: receiving help, helping in a way that feels good, joining something unusually relevant, making an introduction, or discovering an opportunity the member would not have found alone. The agent should be honest when local density cannot yet support a request.
Most members arrive wanting a few concrete things: career colleagues and collaborators, people who share an interest, hobby or activity partners, new friends, romantic partners, or people who can introduce them to any of those. Onboarding should identify one or two of these explicitly as standing intents, so the engine has something to work on from day one. The first-two-weeks target is at least one of: a relevant event or place recommendation the member acts on; one high-conviction introduction or group invitation; or an honest "nobody fits yet; here is what would help" (Section 29, flow F21).
## 8.3 Ongoing loop
1. The member lives normally; the Network does not require daily checking.
2. The agent solves ordinary information problems through search/tools when human participation is unnecessary.
3. The opportunity engine detects high-value configurations.
4. Only opportunities above the member's interruption threshold become proactive messages; lower-confidence possibilities stay in the app. The threshold is per member and per category: someone may want an immediate text about a dating or music opportunity but nothing about work. If a member is not accepting proactive messages they are excluded from proactive opportunities until they re-engage (Section 32.9). (MVP: they are held and offered on request, since there is no app surface, Section 33.9.)
5. If the member opts in, the system gets consent from other participants, mediates logistics, and exposes only necessary information.
6. After the interaction, the system asks lightweight factual/contextual questions and updates the graph.
7. When two people establish their own relationship, the Network can recede.
## 8.4 Example member moments
| Moment | Agent behavior |
|---|---|
| Birthday | "Someone one connection away had plans fall through tonight. You are nearby, you love singing, and three people are already going. Want to show up for one song?" |
| Moving | "Two people are already helping Priya move Saturday. You are 12 minutes away and said you enjoy practical group tasks. Want details?" |
| Dating indirectly | Rather than assigning a date, create a dinner or shared context; later ask trusted participants if they know someone a member might enjoy meeting. (slop.date plans a first date directly after a mutual yes; Section 40.5.) |
| Career | Use search and AI first; if lived experience would materially help, ask one qualified member who opted into that kind of conversation. |
| Creative expansion | "You said you miss performing. A small dinner one warm connection away has a piano. They are open to someone new joining." |
| Extended network | "You once mentioned your cousin knows theatrical production. Would you be comfortable forwarding a 30-minute advice request?" |


# 9. Phone-first onboarding and progressive profiling
Phone onboarding should be a first-class product, not a fallback. The initial experience can happen through an AI voice conversation or SMS thread tied to a verified phone number. The native app should deepen the relationship later rather than gate it. (v0.2: the MVP has no native app surface; see Sections 28.4 and 32.17.)
## 9.1 Identity model
- A phone number is an authentication and communication channel, not the permanent identity key. Every member has a stable internal member ID. (Section 40.3: one person per verified phone, with a member ID per app.)
- All login, on every surface, is by phone number and a text-message code; there are no passwords, email logins, or magic links. Invitation token + phone verification establishes the first account session.
- Passkeys can be added later as an optional second factor on top of phone verification, never as a replacement for it.
- Changing a phone number must not create a new identity or break relationship history.
- Linking a third-party AI assistant or agent uses the same phone verification: the agent asks for the member's number, the member reads back the texted code, and the Network issues an agent key bound to the same Network identity (Section 11.5).
## 9.2 Voice/SMS onboarding flow
1. Welcome and provenance: who invited the person and why The Network exists.
2. Consent: what the agent may remember, what can be used for matching, and what is never shared by default.
3. Current life: what the person wishes there were more of, what is difficult, and what they are curious about.
4. Gifts: what they enjoy doing for others, not merely what they are professionally competent at.
5. People: broad categories of personal-network reach the member is comfortable being asked about; never request a contact upload by default.
6. Place and time: city, neighborhoods, travel preference, typical patterns, and current availability mode.
7. Causes and values: optional areas they care about; avoid ideological profiling beyond what is needed for opportunities.
8. Social format and boundaries: groups vs one-to-one, spontaneous vs planned, privacy, romance opt-in/out, home-entry restrictions, etc.
9. Interruption calibration: show 3-5 hypothetical opportunities and ask which would be worth a text. (MVP messaging onboarding uses 2-3, flow F4.)
10. Editable summary: the agent reads back what it believes and asks for corrections.
Before step 3, the agent should already know what it can learn without asking: the inviter's vouch notes and anything the member chose to connect (calendar, LinkedIn or X profile URL, a pasted memory summary from their AI assistant). It opens with what it guessed ("Sounds like you are a product designer in the Mission who climbs. Right?") rather than a blank questionnaire. A voice call is optional, never required. Which questions are essential versus annoying is decided by A/B tests on completion, correction rate, comfort, and time-to-first-value, and by in-person testing of SMS, voice, and web with real people. Minimum viable onboarding target: under 8 minutes, and the member can stop at any point and still be useful to the Network.
## 9.3 Progressive profiling
Onboarding should deliberately remain incomplete. The richest model should come from later conversations and behavior. The agent can ask one contextually relevant question at a time, such as "Would you ever be comfortable hosting four people?" after the member mentions a rooftop, rather than administering a 100-field survey. Sources in order of preference: (1) things the member already said, (2) sources the member connected (calendar for availability and routines; public LinkedIn/X profiles; their AI assistant's memory export; later Gmail and other socials, only with explicit consent), (3) behavior (accepts, declines, feedback), (4) an occasional single question that is timely and fun. The agent may guess and confirm. Optional private progress (for example, "the Network now knows enough to find you a tennis partner") is allowed; tokens or XP are not part of the MVP.
## 9.4 Phone requirements
| ID | Requirement |
|---|---|
| PH-001 | A member can complete minimum viable onboarding entirely by SMS or voice call. |
| PH-002 | The system must support outbound proactive messages only within the member's notification permissions and applicable messaging consent requirements. |
| PH-003 | Every proactive message includes a simple path to silence or pause future outreach. |
| PH-004 | Sensitive account changes and high-risk disclosures must route to an authenticated surface or human process. |
| PH-005 | SMS conversations and app conversations share the same canonical state and history. |
| PH-006 | Voice transcripts must obey the same memory/privacy classification as typed input. |


# 10. Native app and web UX/UI
## 10.1 Information architecture
| Surface | Purpose | Design notes |
|---|---|---|
| Today | 0-3 high-confidence opportunities, current commitments, and a conversational entry point. | Must be comfortable when empty. No infinite feed. |
| Possibilities | Broader, lower-interruption opportunities to browse intentionally. | Sort by nearby, useful, surprising, causes, people, time. |
| People | People the member actually knows/met through the Network, with private context and mutual-contact controls. | No follower counts or popularity ranking. |
| Map | Optional local view of opportunities, places, and current opt-in presence zones. (Post-MVP. Later ideas include Bluetooth proximity at festivals or large events, similar to an app a friend of the team built for music festivals.) | Coarse by default; exact locations only when necessary. |
| Network | Collective capability and stories: what the network can do now, neighborhood growth, Commons projects. | Belonging without exposing sensitive topology. |
| Me | Wants, gifts, participation state, boundaries, availability, connected assistants, privacy controls, commercial modes. | Editable, transparent, exportable. |


## 10.2 UI principles
- Opportunity cards explain why the member was chosen and how much time/effort is expected. Cards and proactive messages should also convey the expected value in human terms (what you might get out of it) and who else is involved at the level of detail the privacy policy allows.
- No dark patterns around declining; "not for me" should be visually equal to "interested."
- Boundaries and availability are always one tap away.
- Completion flows ask factual questions before subjective ones.
- People are never reduced to star ratings.
- Commercial/sponsored opportunities are clearly labeled and cannot masquerade as organic recommendations.
- Network stories should emphasize what became possible, not who is most popular.
## 10.3 Example opportunity card
| Field | Example |
|---|---|
| Headline | I thought of you for something nearby. |
| What | Help welcome people for the first 30 minutes of a tiny community dinner. |
| Why you | You said you like hosting, want to meet more local creatives, and are already nearby Thursday. |
| Commitment | 30-60 minutes; leaving after the welcome is completely fine. |
| Social context | 6 people total; 2 members you have met before. |
| Privacy | Exact address appears only if you and the host both opt in. |
| Actions | Interested / Maybe later / Not for me / Why did you ask me? |


# 11. The Network Gateway: ChatGPT, Claude, Grok, Muse, and future assistants
The Network should be portable into the AI interface a member already uses. The member should not have to abandon ChatGPT, Claude, Grok, Muse, or a future assistant to access their Network. The Network remains the canonical identity, graph, consent, opportunity, and audit system; external assistants are clients.
As of October 2026, ChatGPT supports MCP-powered apps/plugins, Claude supports custom remote MCP connectors and plugins, and Grok supports remote MCP tools/custom connectors. The implementation should nevertheless be vendor-neutral because feature availability, approval requirements, and UI capabilities can change.
## 11.1 Integration architecture
- A remote MCP-compatible server is the preferred portable tool surface where the host supports it.
- A conventional REST/JSON API sits underneath so clients without MCP can be supported with adapters.
- A Network-specific skill/instruction package teaches host assistants the product philosophy: protect attention, prefer AI/search first, never leak private graph data, request confirmation for consequential actions, and avoid implying social entitlement.
- Identity linking uses phone verification through the skill (Section 11.5): the member gives the agent their number and the texted one-time code, and the Network issues a scoped, revocable agent key. The host assistant never holds a reusable Network credential other than that key.
- The connector receives only scopes the member explicitly grants. Default scopes should be minimal and revocable.
- All actions create server-side audit receipts visible to the member regardless of which client initiated them.
## 11.2 Proposed connector tools
Decision (v0.2): the earlier tool list was too granular. External assistants get a small, opaque surface; the Network itself decides state, privacy, matching, and timing. The MVP does not ship the connector (Section 28). Approved v0.2 tool set (five tools, because ChatGPT and Claude reject a catch-all tool that mixes reads and writes): ask_network_agent (read-only), tell_network_agent (write), share_profile_with_network (narrow typed fields only, no chat history), get_network_updates (read-only), and respond_to_network_item (the only accept/decline path). Served at https://mcp.ntwrk.love/mcp. The original four-tool draft is kept below for reference:

| Tool | Purpose | Risk |
|---|---|---|
| network.talk | Send a natural-language message to the member's Network agent and get its reply (ask for something, answer a question, change preferences, accept or decline). Everything else routes through this. | Medium; the Network applies confirmation and policy server-side |
| network.share_context | Hand the Network information about the member that the host assistant already knows (profile summary, interests, goals), with the member's approval. Used for onboarding and progressive profiling. | Medium |
| network.get_updates | Fetch pending opportunities, questions, and reminders already cleared for this member. | Low |
| network.respond | Structured accept / decline / "tell me more" on a specific pending item. | Medium |


A skill/instruction file ships with the connector telling the host assistant when to use each tool, to search and plan on its own first, and to treat Network data as private. The granular table below is retained only as the internal capability list behind network.talk.
| Tool | Purpose | Default risk |
|---|---|---|
| network.get_me | Return a privacy-minimized summary of the member's current Network state. | Low / read |
| network.search_world | Use Network world-search/local-knowledge capability before asking humans. | Low / read |
| network.find_possibilities | Return member-visible opportunities already cleared for that member. | Low / read |
| network.ask_for_help | Create a private need/request draft; does not contact anyone until confirmed. | Medium / write |
| network.offer_capacity | Update what the member is currently willing to offer/share. | Medium / write |
| network.respond_to_opportunity | Accept/decline/request details. | Medium / write |
| network.propose_introduction | Ask the Network to explore a warm introduction without revealing contact details. | Medium / write |
| network.ask_my_network | Create a forwardable request for the member's own contacts. | Medium / write |
| network.relay_message | Send an approved relay message inside an active interaction. | Medium / write |
| network.set_state | Change Open/Normal/Quiet/Receiving/Paused and notification settings. | Medium / write |
| network.invite | Create an invitation if the member has invite capacity. | High / write; confirmation |
| network.share_contact | Mutual-consent direct-contact exchange. | High / write; bilateral confirmation |
| network.report_safety | Start a safety/reporting flow and preserve evidence. | High / sensitive |


## 11.3 Host-assistant experience
A member might say in ChatGPT or another assistant: "I need help moving a table Saturday. First see if there is an easier solution, then ask The Network if it is worth involving people." The host assistant can search/plan first, then call Network tools with the user's permission. The Network service, not the host model, applies candidate privacy, interruption budgets, trust, and consent policy. The Network is itself an AI with search, places, and events: while the network is small it should usually find a service, place, or event first. Involving other people is often the last resort, not the first move.
Conversely, the host assistant could say: "The Network has an opportunity that seems relevant to what you are discussing. Want me to show it?" This should occur only when the connector is enabled and the host supports such suggestions.
## 11.4 Connector requirements
Connectors should be as thin and opaque as possible: the host assistant never sees the graph, other members, or scoring, only the member's own conversation with the Network and items cleared for them. The ChatGPT connector uses a teen-safe surface profile (no romance, bars or nightlife, alcohol, 18+ or 21+ venues, or sponsored items), described honestly to app reviewers. Decision (October 8, 2026): dating (slop.date) stays out of the ChatGPT listing, because plugins must suit users aged 13-17 and ChatGPT sends apps no age signal. slop.date's assistant entry is a paste-in prompt plus iMessage (docs/research/2026-10-08-entry-flows.md).
| ID | Requirement |
|---|---|
| GW-001 | External assistants never receive the full raw social graph by default. |
| GW-002 | The Network server enforces permissions even if the host assistant requests more data than allowed. |
| GW-003 | Write actions are idempotent and return durable action IDs. |
| GW-004 | High-risk actions require explicit member confirmation at the Network policy layer. |
| GW-005 | A user can revoke any assistant connector without losing Network account history. |
| GW-006 | The connector must work even if the host assistant has no long-term memory; Network context remains server-side. |
| GW-007 | Feature capability is negotiated per client so unsupported interactive UI or approval flows degrade gracefully. |


## 11.5 Phone verification and agent keys
Decision (October 6, 2026): all login to The Network, on every surface, is by phone number and a text-message code. There are no passwords, email logins, or magic links. This covers the web (eliza.app), a new phone or channel (F25), and any AI assistant or agent that uses the Network skill or connector. An agent proves it acts for a member by holding an agent key, which it gets only after the member verifies their phone number through it. The skill file teaches the agent this flow:
1. Check for a key. Before its first Network call in a conversation, the agent looks for a key: one already issued in this conversation or, on a computer, one saved in its key store (below). With no key, or when a call returns not_signed_in or key_expired, the agent treats itself as logged out and goes to step 2.
2. Ask for the number. The agent asks the member for their mobile number and calls start_phone_verification. The Network texts a six-digit code in the member's usual Network thread, for example: “Your Network code is 482913. It connects Claude to your Network. Only give it to the assistant you are setting up right now.” The tool's reply is identical whether or not the number belongs to a member, so it cannot be used to find out who is in The Network.
3. Read back the code. The member tells the agent the code and the agent calls verify_phone_code. A correct code returns an agent key: a long random token bound to the member ID, the verified number, a client label (for example “Claude, Mac”), the granted scopes (Appendix B.3), and an expiry. The key is shown once; the Network stores only a hash.
4. Use the key. The agent sends the key with every Network call, in the Authorization header where the host supports it, otherwise as a key argument. The server identifies the member from the key alone and never trusts a member ID, name, or phone number the agent supplies.
5. Confirm by text. The Network texts the member in the same thread: “Claude (Mac) is now connected to your Network. Reply DISCONNECT to remove it.” A member can link several agents; each gets its own key.
Rules:
- Session keys in chat assistants. A host with no storage of its own (ChatGPT, Claude.ai, Grok) keeps the key in the conversation only. The key stays valid for that session: it expires after 24 hours without use or 7 days in total, whichever comes first, and a new conversation verifies again. (Proposed defaults; tune in the pilot.)
- Stored keys on computers. An agent running on the member's own computer (Claude Code, Codex, a local Eliza or Milady agent, and similar) may save the key so the member does not verify every session: in the OS keychain where available, otherwise in ~/.config/thenetwork/agent-key.json with owner-only permissions (0600), never inside a project folder or repository. A stored key expires after 30 days without use or 90 days in total, then the agent verifies again.
- When the agent is unsure. Every Network reply includes the masked number the key belongs to (for example •••-•••-4321). If the agent is not sure it is talking to that member (a shared computer, a stored key it did not create, or the member says it is the wrong account), it asks the member to confirm the last four digits. If they do not match, it calls sign_out, deletes any stored key, and starts again at step 2.
- Verification tools. Three tools sit outside the five-tool set in 11.2 and need no key: start_phone_verification(phone), verify_phone_code(phone, code, client_label), and sign_out(). The five tools return not_signed_in until a valid key is presented.
- Code rules. Codes are six digits, single use, expire after 10 minutes, and lock after 5 wrong tries. At most 3 codes per number per 15 minutes and 10 per day, plus per-client and per-IP limits. Codes go only to numbers that belong to a member or have a pending invite, and only to supported countries (US at launch), which prevents SMS-pumping fraud and unwanted texts to strangers. Verification texts are transactional and covered by the consent recorded at invite acceptance (36.1).
- Revocation. The member can list and remove linked agents by texting the Network (“which assistants are connected?”, “disconnect Claude”) or on the web. Removing a member, a lost or recycled number, or a safety hold revokes every key for that member at once. A phone number change (F25) moves keys to the new number without breaking them.
- Handling secrets. The skill tells the agent never to repeat the key or the code in chat, never to put either in a URL, link, or shared file, never to pass them to any other tool or site, and to discard the code once verified. Keys never appear in logs; the admin console (Section 35) shows only key IDs, client labels, and last-used times.
- Why not OAuth first. Phone verification works in every host, including ones without OAuth support or a browser, and matches how members already reach The Network by text. The one-time code passes through the host assistant, but it is single use and expires in minutes, so the only reusable credential the host ever holds is the scoped, revocable agent key. If a host requires OAuth for remote connectors, its sign-in page uses the same phone and text-code step and issues the same kind of key.
- Update (October 8, 2026): listed hosted assistants use OAuth. OpenAI's plugin rules forbid collecting one-time codes in chat, and Claude's directory requires OAuth 2.0 for servers that need sign-in. The ChatGPT, Claude directory and Grok connectors therefore use OAuth 2.1, and our sign-in page asks for the phone number and the texted code. It issues the same scoped, revocable key, and the confirmation text still goes to the member's thread. Code-in-chat (steps 1-5 above) remains only for agents on the member's own computer and for unlisted custom connectors. App reviewers get a test number that works only for the reviewer client.
# 12. The Network agent
## 12.1 Responsibilities
- Understand requests, desires, and offers in natural language.
- Perform search, recommendation, planning, and ordinary assistant tasks that do not require human attention.
- Convert unstructured conversation into structured opportunity objects and member preferences.
- Explain why an opportunity is relevant without exposing protected information.
- Negotiate logistics within explicit permissions.
- Mediate relay communication while withholding personal contact information until mutual consent.
- Learn from behavior without overfitting the member into a static identity.
- Escalate safety, conflict, ambiguous consent, or sensitive exceptions to humans.
## 12.2 Escalation ladder
1. AI solves directly using reasoning, planning, and available tools.
2. Use public web/search/maps/local information and Network-curated knowledge.
3. Use aggregate Network capability without interrupting a person (for example, "there are likely members who know this").
4. Ask one high-confidence member.
5. Ask a warm connector whether someone in their personal network may fit.
6. Ask a small targeted cohort.
7. Only if appropriate, expose the opportunity in a broader opt-in feed.
The scarce resource is not compute. It is human attention and goodwill.
Standing intents: overt, durable wants ("start a rock band," "find a doubles partner," "meet investors in climate") are stored as intents and matched asynchronously as the network grows; the member is told the Network is keeping an eye out. Before contacting anyone, the engine checks that the other person has capacity for this kind of thing now (liking rock music is not the same as having time to rehearse weekly). When no member fits, the agent may still help with outside options it can find (public listings, events, communities, public profiles of relevant organizations) clearly labeled as outside the Network. It never contacts non-members on the member's behalf except through a member's own forwarding (post-MVP), and it never builds profiles of non-members. (Exception: the single vouched invitation in flow F1.)
## 12.3 Interruption budget
Every member has a dynamic interruption budget influenced by explicit preference, recent accepted opportunities, recent proactive contacts, current participation state, response pattern, and life context. A highly helpful member should not become the default target merely because they say yes. Overuse is a matching failure.
## 12.4 Agent voice
The agent should sound observant, concise, and non-needy. It should not guilt, flatter excessively, imply moral obligation, or anthropomorphize itself into a controlling authority. It may be playful when the context supports it. It should be comfortable acknowledging uncertainty: "This may be too random, but I have a reason for asking." Each app (Section 40) has its own persona within this voice.
# 13. Social graph and data model
The social graph is a core defensible asset, but it must model context rather than reducing every relationship to "friend." Most edges are directional and permissioned.
## 13.1 Core entities
Ontology principle (v0.2): keep the core small and generic, and push specificity into typed, versioned facets. Instead of separate tables for every concept (capability, desire, resource, trait), the MVP uses a few general objects, with a controlled but extensible vocabulary of facet types and tags:
- Member (and later Organization / external stub): stable ID, identity channels, states, consent records.
- Facet: any assertion about a member: kind (interest, skill, offer, desire, goal, boundary, trait, fact, resource, preference, availability_pattern), value text, structured attributes, tags, embedding, privacy scope, provenance (said / connected source / inferred / vouched), confidence, valid_from/valid_to.
- Intent: a standing or one-off want with an objective, category, desired participants, time sensitivity, and status.
- Presence: where a member is and when: home city/areas, recurring routines, and time-bounded presence ("in SF Oct 10-14"), so a member who lives between NYC and SF can be offered "if you are in SF this weekend..." Learned weekly patterns come from calendar and location only with consent.
- Edge: directional, typed relationship with evidence (Section 13.2), including key people the member mentions (partner, best friend, boss) as private stubs.
- Opportunity, Participation, Thread/Message, Event, Feedback, Consent, Audit event.
Overkill for MVP: separate Capability/Resource/Cultural-capital tables, a full capital-vector store, organization/partner objects, and a graph database. The capital vector (Section 5) remains a conceptual lens implemented as facet kinds. The entity table below is the long-term conceptual model. In the MVP, Capability, Desire/Need, Resource and Trust evidence are facet kinds, and Organization/Partner is not built (Section 32.4).
| Entity | Selected fields |
|---|---|
| Member | member_id, identity channels, participation state, city/neighborhoods, preferences, privacy policy version |
| Capability | category, description, confidence, member willingness mode, qualification flags, evidence |
| Desire / Need | description, category, urgency, recurrence, privacy scope, status |
| Resource | type, owner, availability, sharing mode, location, constraints |
| Person edge | source member, target member/external stub, edge type, direction, strength evidence, privacy |
| Interaction | participants, origin opportunity, time/place, completion, follow-up consent |
| Opportunity | structured object described in Section 6 |
| Place | public/private class, coordinates/geohash, accessibility, travel-time metadata |
| Organization / Partner | type, capacity supplied, contractual/safety terms |
| Consent | subject, object, scope, purpose, duration, revocation |
| Trust evidence | context-specific evidence; never a universal human rating |
| Event log | immutable product events for workflow, audits, analytics, and model evaluation |


## 13.2 Relationship edge types
- Invited by; knows offline; met through Network; completed something together; helped; received help; introduced; vouched for; hosted; worked together; socialized; would interact again; prefers group context; prefers one-to-one; blocked; safety restriction.
- Edges can contain evidence and confidence, but inferred states must be distinguishable from explicit member statements.
- An edge can be hidden from the other party when it is internal/private, unless revealing it is necessary and consented.
## 13.3 Nonmember contacts
The Network should not create a large shadow graph from uploaded address books. A member may describe a relationship in broad terms ("I know someone in theater") and can be asked to forward a private link. The external person becomes directly represented only after they interact with the link or otherwise consent. Decision (v0.2): no scraped or third-party profiles of people who have not joined, even public ones (for example, profiles another agent assembled from X). Matching people who never signed up yields unanswered outreach and erodes trust.
## 13.4 Event sourcing
Important social facts should be captured as immutable events: invite issued, opportunity proposed, member declined, member accepted, contact disclosure approved, interaction occurred, introduction forwarded, completion confirmed, report filed. Derived profile state and graph features can be rebuilt from this event history. This is critical for auditability and future model changes.
# 14. Matching and opportunity engine
The matching problem is not "find the most similar person." It is a constrained configuration problem over people, relationships, capital vectors, time, location, privacy, trust, and expected social value. Many opportunities require a small set of participants rather than a pair, making the problem closer to hypergraph matching than simple recommendation.
Empty states are normal early on. When the engine finds nothing good for a member, the agent says so honestly ("nobody quite fits yet"), and turns the gap into progress: it asks what else the member is into or would try, suggests events and places it can find itself, asks whether they want to go out this weekend, and asks if they know someone who would make the Network better for them (a vouch-based invite). It never lowers the bar to manufacture a match. The detailed v1 design is in Section 33.
## 14.1 Pipeline
1. Opportunity detection: identify a need, desire, offer, world event, relationship possibility, underused resource, or network-health gap.
2. Opportunity composition: create a structured opportunity object and estimate what capital is required and what capital may be created.
3. Policy filter: classify risk, allowed participant types, commercial mode, sensitive categories, and consent requirements.
4. Candidate retrieval: retrieve possible people/paths using graph, semantic, capability, location, availability, and behavior indices.
5. Warm-path search: determine whether a trusted connector or existing context is preferable to a direct ask.
6. Configuration ranking: score candidate individuals or groups on expected net value and confidence.
7. Load balancing: penalize recent asks, high giving load, repeated use of the same social cluster, and inequitable opportunity concentration.
8. Interruption decision: decide SMS/push, in-app only, ask a connector, hold quietly, or discard. (MVP: iMessage/SMS, hold, or discard.)
9. Consent handshake: independently ask required parties before revealing private details.
10. Execution and learning: coordinate, record outcome, and update contextual features.
## 14.2 Candidate retrieval channels
| Channel | Purpose |
|---|---|
| Capability match | Who can plausibly contribute the required human capital? |
| Desire match | Who would personally value this, even if they are not "needed"? |
| Graph path | Who is reachable through an appropriate warm relationship? |
| Location/travel time | Who can participate with low friction? |
| Time/availability | Who has capacity in the actual window? |
| Resource match | Who has relevant physical/cultural/financial capacity? |
| Behavioral affinity | What has the member actually enjoyed/accepted in the past? |
| Expansion candidate | What is somewhat outside their normal pattern but plausibly life-expanding? |
| Network health | Would this connect clusters, develop a new host, or avoid overusing the same members? |


## 14.3 Ranking model
A conceptual net opportunity score can be decomposed rather than treated as one opaque model output:
NetValue = NeedFit + DesireFit + MutualBenefit + RelationshipPotential + LifeExpansion + CollectiveValue + TimingFit - ActivationCost - InterruptionCost - Travel - Overload - PrivacyRisk - SocialRisk - Repetition
The production system should use calibrated component models and policy rules. Some features can be learned; some must be hard constraints. Privacy and safety are not compensable - a sufficiently exciting opportunity cannot override a prohibited disclosure or unsafe configuration. (The v1 formula actually implemented is in Section 33.6.)
## 14.4 Confidence
The interruption decision should depend on both expected value and confidence in that estimate. Confidence comes from evidence quality: explicit current availability is stronger than an old inference; a repeated demonstrated preference is stronger than a one-time mention; a direct warm path is stronger than a weak embedding similarity.
## 14.5 Exploration and serendipity
A pure recommender will shrink members into their past. The system should reserve a small, user-tunable exploration budget for high-upside experiences outside the dominant preference cluster. Exploration is constrained by safety, capacity, and explainability. The agent may explicitly say that novelty is part of the reason for the suggestion. The engine deliberately injects a bit of randomness: a small share of suggestions are chosen for novelty, labeled internally as exploration so their outcomes can be measured.
## 14.6 Group formation
Many of the best outcomes require 3-8 people. Group formation should optimize compatibility and role complementarity rather than pairwise similarity alone. A dinner may need one host, one connector, two people likely to enjoy one another, and enough existing edges that the group does not feel socially cold. The engine should model group composition features: number of warm ties, bridge edges, dominance risk, social-format preferences, and arrival/departure constraints. (MVP groups are 3-6, Section 33.4.)
# 15. Engagement, seriousness, trust, and load balancing
## 15.1 Seriousness is not activity volume
The Network must know whether a person will follow through, but it must not confuse high frequency with seriousness. A busy person who accepts one commitment per quarter and completes every one is extremely reliable. A socially active person who accepts everything and regularly cancels is not.
## 15.2 Reliability model
- Estimate P(completion | accepted, context) rather than a global reliability number.
- Context includes opportunity type, lead time, distance, time of day, commitment length, and whether the person initiated the plan.
- Declines have no negative reliability effect.
- Cancellation with appropriate notice is different from a no-show.
- Reliability evidence decays and updates; people change.
- The UI should not expose a universal numerical reliability score.
No-shows hurt other people. MVP policy: declining is always free; cancelling with reasonable notice is free; one no-show (or very late cancellation) is forgiven, after which the member is held out of group and time-sensitive opportunities until they have completed a lower-stakes commitment, and the agent explains why. The person who was flaked on is never made to feel bad: the agent apologizes on the Network's behalf, offers a replacement or a rain check, and records nothing negative about them. Post-MVP experiment: a refundable commitment deposit (via Stripe) for high-demand group events, where a no-show's deposit goes to the people whose time was wasted. Financial penalties are not part of the MVP because they need payments infrastructure and careful testing.
## 15.3 Engagement signals
Useful internal signals include response rate to proactive messages, acceptance precision, completion, repeat interaction preference, introduction success, participation-state changes, and whether the member updates availability. These signals guide interruption policy; they should not become moral judgments.
## 15.4 Burnout prevention
- Apply a contribution-load penalty when a member has recently given more time/attention than they prefer.
- Develop new capacity by asking less-established members when fit is sufficient.
- Allow members to set explicit per-category quotas (for example, "one career question per month").
- Proactively offer Receiving or Quiet mode to overextended members.
- Track concentration metrics: what share of completed help comes from the top 10% of members? Rising concentration is a network-health warning.
## 15.5 Game mechanics
Progress can exist without public status competition. Optional private progression may recognize discovered roles (Connector, Host, Builder, Guide, Explorer) or show concrete impact (people met, introductions that became recurring relationships, neighborhoods explored). Avoid daily streaks, public leaderboards, follower counts, and rewards that pressure constant participation.
# 16. Location and time intelligence
Location is fundamental because many latent opportunities only become attractive when travel cost is low. The product should understand travel time and routines without defaulting to continuous precise GPS tracking.
## 16.1 Location hierarchy
- Home neighborhood / general area: persistent, optional, coarse.
- Recurring areas: work neighborhood, gym area, school pickup area, frequently visited places, each with member permission.
- Current city: useful for travel and temporary relocation.
- Ephemeral presence: "I am around tonight" or "available within 20 minutes" with automatic expiration.
- Exact destination: disclosed only when necessary after consent.
The Network should build a general picture of a member's everyday routine (where and when they usually are during a normal week) from conversation, calendar, and, post-MVP, app location, plus the key people in their life (partner, close friends, family, boss) as private context. Collection may be as precise as the member allows; sharing is never precise (Section 22.6, SEC-004).
## 16.2 Travel-time model
Use route/travel-time estimates rather than raw distance. The product should learn personal friction: a member may happily walk 20 minutes but dislike a 10-minute subway transfer, or may only participate in opportunities that lie along an existing route.
## 16.3 Temporal features
- Time windows with uncertainty, not only calendar slots.
- Lead-time preference: spontaneous vs planned.
- Duration tolerance.
- Arrival/departure flexibility.
- Recurrence compatibility.
- Energy patterns where explicitly shared or safely inferred (for example, "never ask me after 9 PM").
# 17. Privacy, consent, safety, and inference boundaries
## 17.1 Privacy scopes
| Scope | Meaning | Example |
|---|---|---|
| Agent-private | May inform the member's own agent but cannot be used to reveal or imply the fact to others. | "I have been lonely lately." |
| Matchable | May be used internally to identify opportunities, but not quoted or disclosed. | "I want more low-pressure local social contact." |
| Shareable | Can be shown to another participant when relevant. | "I am a designer in Brooklyn and love live music." |
| Opportunity-specific | May be revealed only inside a particular mutually accepted interaction. | Exact address, phone number, event details. |


## 17.2 Inference privacy
The privacy system must evaluate whether an action indirectly reveals a protected fact. Example: if one member privately discloses a pregnancy, the system must not suddenly prompt friends with unusual reconnection suggestions whose timing would reasonably expose the disclosure. This requires provenance-aware reasoning: candidate generation can use private facts only within strict policy, and the explanation generator must be restricted to shareable evidence.
## 17.3 Relay communication
The Network can mediate communication through relay identifiers so members can coordinate before exchanging direct contact information. Messages are delivered through the app/SMS gateway, with clear indication when the agent is summarizing or translating. Direct contact exchange is bilateral and revocable where technically possible.
Decision (v0.2): members always message each other through the Network, never directly, until both agree to share contact details. Either member can ask the agent to share their number at any time, and the agent offers a contact swap after a completed in-person meeting where both gave positive feedback. The relay thread stays available indefinitely so people who forgot to swap numbers can still reach each other later. Relay gives the agent context for scheduling, safety, and feedback.
## 17.4 Safety architecture
- Invite-only entry, verified communication channel, and human welcome for the early network. (v0.2: approval is automatic with flagged-case review (8.1); the welcome is a newcomer-welcome opportunity plus the monthly gathering.)
- Clear block/report controls across every surface, including SMS.
- Risk classification for opportunities involving homes, transport, money, vulnerable people, minors, regulated advice, or intimate contexts. Decision (v0.2): the minimum age to join is 13. Members aged 13-17 may join, but the Network never matches or connects them to other people. They get only single-player help (concierge answers, public events and places, their own profile and preferences). Every multi-person opportunity (intros, groups, event co-attendance, help requests, relay, contact swaps, warm paths, member-initiated intros, gatherings seating) is adult-only, in any role including as an intermediary. Romance is adult-only and double opt-in. Adults are never shown or told about minors. The Network is not an 18+ product. Risk signals feed the internal ranking so that bad actors cannot exploit trust. ID verification (for example, Stripe Identity or Persona) is post-MVP for general members and planned first for hosts and home-entry opportunities.
- Role-specific verification where legally and operationally appropriate; membership alone is never a safety certification.
- Human safety review with documented decisions, appeals, and conflict-of-interest rules.
- Serious safety reports may temporarily restrict access while reviewed; this is separate from popularity or engagement.
## 17.5 High-risk exclusions for early launch
V1 should not casually coordinate childcare, unsupervised minor interactions, home medical care, custody of large sums of money, clinical services, controlled-substance activity, or other high-risk regulated services. Professional introductions can exist, but the product must distinguish informal guidance from professional engagement and use explicit terms. (v0.2: home-hosted events are also excluded from the MVP (Section 28.4); home-entry help requests follow the rule in flow F14.)
## 17.6 Low-control constitution
- No punishment for leaving, pausing, declining, or maintaining outside relationships.
- No required ideology, emotional disclosure, exclusivity, recruitment quota, or leader worship.
- Founders, wealthy members, donors, and popular members follow the same safety rules.
- Members can export their own data and direct contacts acquired with mutual consent.
- The Network should deliberately make members more capable outside the product.
# 18. Regenerative business model - no monthly membership fee
Status (v0.2): deferred. For the MVP we ignore the business model and focus on growth and quality. Nothing in Sections 18-19 is built in the MVP. Members handle any money between themselves outside the Network (Venmo, cash, etc.); the agent may help them agree on it. These sections are retained as direction for later. The ownership direction (a member-owned protocol and treasury governed through decision markets, post-MVP) is in Section 39.4.
Hard constraint: no recurring consumer membership fee. Belonging is free once invited. The Network earns when it creates new economic value, mobilizes underused capacity, or is underwritten to create public/shared value. (Open question, Section 27, earlier idea superseded by 39.4: a voluntary paid governance membership, which confers voice but never social priority, is being discussed and would not contradict this constraint as long as belonging stays free.)
## 18.1 Economic constitution
- Money cannot buy social rank, more desirable people, priority access to human generosity, or a higher chance of being matched socially.
- No sale of personal data, social-graph data, inferred vulnerability, or relationship data.
- No hidden sponsored ranking. Commercial influence is always labeled and policy-bounded.
- Fees should primarily attach to transactions where money is already appropriate: professional services, tickets, reservations, goods, logistics, or funded experiences.
- A defined portion of commercial surplus should increase Network capacity through the Network Commons or equivalent reinvestment mechanism.
- Gift interactions remain gift interactions; The Network does not insert a fee into kindness.
## 18.2 Revenue streams
| Revenue stream | Mechanism | Why aligned | Primary risk / guardrail |
|---|---|---|---|
| Paid member-to-member professional services | A member explicitly marks a capability as paid/professional; The Network may facilitate payment and take a transparent transaction fee. Later (not MVP): a member account and balance for paying people back, splitting meals and event costs, and paid services, with Stripe as the processor and transparent fees well below typical marketplace take rates. | Revenue exists only when real economic value is created. | Never silently convert informal help into paid lead generation; member controls mode. |
| Local commerce / booking referral | Commission or revenue share on restaurants, classes, tickets, transport, travel, tools, or services booked through the agent. | The system can reduce friction while capturing value from transactions that would occur anyway. | Organic recommendation quality must not be corrupted by higher commissions. |
| Underwritten opportunities | A venue, brand, donor, institution, or individual funds an experience or removes a barrier. | Financial capital becomes time, space, materials, access, or cultural/social capital. | Sponsor cannot select vulnerable targets or buy member data. |
| Unused-capacity marketplace | Businesses contribute off-peak tables, empty seats, rooms, inventory, or classes; The Network fills them and shares resulting revenue. | Turns latent commercial capacity into social capacity. | Avoid dumping low-quality inventory; opportunity still needs member fit. |
| Institutional launch / outcome contracts | Universities, employers, cities, residential communities, or nonprofits pay setup, usage, or outcome-based fees for a cohort. | An institution underwrites member access and local network-building. | Institution receives aggregate outcomes only, never personal graph or private need data. |
| Network-produced experiences | Ticketed dinners, workshops, trips, or events with transparent margin. | Paid experiences can cross-subsidize free community opportunities. | Do not let the product become merely an events company. |
| Patronage / grants / philanthropy | Voluntary one-time contributions to specific capacity-building funds or Commons projects. | Money directly increases shared capability. | Patronage confers no social privilege. |
| B2B coordination services | Partners pay The Network to organize volunteer participation, community activation, or distributed local tasks where members explicitly opt in. | Leverages coordination engine and can fund the Commons. | Must not convert members into an on-demand labor pool without fair terms. |


## 18.3 What is prohibited
- No paid tier for better social matching.
- No subscription required to keep one's relationships or place in the Network.
- No auctioning access to high-status members.
- No sale of "warm introductions" to unwilling humans. There are no targeted ads. A member may opt in to an explicitly labeled "deals and offers relevant to me" category later; it is off by default and never mixed into social opportunities.
- No compensation scheme that rewards recruiting people primarily for revenue.
- No manipulative advertising disguised as synchronicity.
- No monetization that depends on maximizing time in app.
## 18.4 Monetization sequence
1. Prove social value without monetization in a concierge pilot.
2. Add simple paid professional/service transactions only where members explicitly request commerce.
3. Add local booking/referral economics with recommendation-integrity tests.
4. Pilot underwritten opportunities and unused-capacity partnerships.
5. Create the Network Commons with transparent inflows/outflows once revenue is meaningful.
6. Only later evaluate institutional contracts and ownership/governance mechanisms at scale.
# 19. Network Commons and capital regeneration
Status (v0.2): not MVP. Abuse risk is real and must be tested at small scale first. One governance direction discussed earlier (earlier idea, superseded by 39.4): an open-source non-profit governed by members who choose to pay a membership fee; fees first fund the app and inference, and any surplus flows into the Commons pool. DAO governance experiments are worth studying for what to copy and what to avoid. Another idea for later: members contribute compute (with PII scrubbed so contributors cannot see what is computed) in exchange for points or ownership in the network. The current ownership direction is in Section 39.4: after the MVP, a member-owned protocol and treasury, with treasury decisions made through decision markets.
The Network Commons is a proposed pool of financial capital dedicated to removing barriers and increasing future shared capability. It is not a loyalty program and not a pool that members can cash out based on popularity.
## 19.1 Example uses
- Transport for a member who otherwise cannot participate.
- Childcare or care support that creates time for an important opportunity.
- Food for people helping someone move or volunteering together.
- Room rental, permits, or insurance for a community gathering.
- Materials for a workshop or neighborhood project.
- Tickets or access that turn unused capacity into a shared experience.
- Microgrants for member-proposed experiments that could create durable new Network capacity.
- Training for hosts, facilitators, or stewards so human capital increases.
## 19.2 Capital regeneration test
A spending decision is regenerative when it plausibly creates durable capacity beyond the immediate consumption event. For example, buying dinner may simply consume financial capital. Funding a recurring host training dinner may convert financial capital into human, cultural, and social capital that creates future opportunities. The system should record these intended transformations and later test whether they occurred.
## 19.3 Example economic flow
| Step | Capital movement |
|---|---|
| 1. Local venue has unused Tuesday capacity | Physical capacity exists but is idle. |
| 2. Venue offers 12 seats at low marginal cost | Physical capital becomes permissioned opportunity inventory. |
| 3. Sponsor funds food; Network contributes coordination | Financial capital becomes space, food, and attention. |
| 4. Agent invites a carefully composed group | Social/human/cultural vectors are combined. |
| 5. Members meet and form repeat connections | New social capital is created. |
| 6. Network earns a coordination margin | Financial capital is replenished. |
| 7. A defined share funds the Commons | Revenue increases the probability of future opportunities. |


## 19.4 Governance direction
Long-term ownership and governance should be designed so members who create the network's value are not treated purely as data-producing users. Options to explore include a public-benefit company with binding mission commitments, a community trust or member pool holding equity/economic rights, or eventually cooperative elements. Platform cooperative models provide examples of shared stakeholder ownership and governance, but this PRD does not commit the company to a cooperative structure at launch.[6] Current direction (2026-10-07): after the MVP, The Network becomes a protocol and treasury owned by its members (founders included), governed through gasless voting and Umia-style decision markets (Section 39.4).
# 20. Validation plan: social hypotheses and mechanical tests
Many of the hardest questions cannot be answered by software tests alone. The founding team must explicitly separate social hypotheses from mechanical implementation assumptions. Each major social claim should have a low-cost real-world experiment and a measurable gate before scaling.
## 20.1 Concierge-first validation
Before building a sophisticated graph engine, run a human-in-the-loop concierge network with 30-75 members in one dense geography. Operators manually identify opportunities, use the same structured opportunity schema the future system will use, and send messages through the same phone-based interface. This produces training/evaluation data while testing whether people actually want the product. (v0.2: two cities, SF and NYC, each with a 40-75 seed (Section 36.5); engine proposals are reviewed by humans rather than operators composing every opportunity by hand (Sections 28, 34.6).)
## 20.2 Core hypothesis matrix
| Hypothesis | Social test | Mechanical metric / gate |
|---|---|---|
| Unexpected invitations can feel delightful, not intrusive. | Stewards send only manually judged high-confidence opportunities. Interview recipients after 3-5 contacts. | >=70% of proactive contacts rated "worth sending"; mute/complaint rate <5% in pilot. |
| People will accept opportunities for reasons beyond direct self-benefit. | Mix help, social, cause, and playful opportunities. | Meaningful acceptance across at least 3 opportunity classes; no single class >70% of accepted volume. |
| Phone onboarding can build enough context without feeling invasive. (Includes A/B tests of which onboarding questions are essential versus annoying.) | Compare voice, SMS, and lightweight web onboarding. | Completion, correction rate, comfort score, time-to-first-value, privacy opt-out patterns. |
| Warm-path asks outperform cold matching. | A/B warm connector path vs direct cold invitation when both are ethically possible. | Acceptance, completion, comfort, later relationship continuation. |
| Members will forward good opportunities to nonmembers. (Post-MVP, L2.) | Ask selected connectors to forward private links. | Forward rate, external response, conversion, complaints. |
| The Network can create repeat relationships, not just novelty. | Intentionally create natural second encounters after a positive first interaction. | % of pairs/groups with a second interaction; % that later coordinate directly. |
| Receiving can feel dignified. | Recruit members with real current needs and do not require prior contribution. | Request rate, fulfillment, shame/comfort interview data, return participation. |
| Generous members can be protected from overload. | Impose contribution caps even when operators know a "perfect" helper. | Top-10% contribution concentration and burnout/quiet-mode rates stay bounded. |
| The agent can solve enough itself to protect attention. | Classify requests by self-serve vs human-value-added. | Share of requests resolved without human interruption; member satisfaction by route. |
| Regenerative money increases participation rather than distorting it. (Post-MVP.) | Fund transport, childcare, meals, venue, or materials for otherwise viable opportunities. | Incremental completion and inclusion relative to unfunded comparable cases; trust remains unchanged. |


## 20.3 Validation gates before scaling
- Do not launch a second city until the first city has repeat interaction, not merely signups. (v0.2: superseded for SF and NYC, which launch together (Section 25.1); the gate applies to any third city.)
- Do not automate proactive matching until human-selected opportunities have a clear precision baseline.
- Do not expose paid partner inventory until the team can demonstrate recommendation integrity.
- Do not add precise live location until members show clear value from coarse location and ephemeral presence.
- Do not add broad friend-of-friend reach until forwarding and privacy expectations are validated.
- Do not create visible progression/status systems until the team knows they improve belonging rather than hierarchy.
# 21. Metrics and instrumentation
## 21.1 North-star concept
Meaningful Reachable Possibility: How often does membership create a valuable outcome or relationship that would probably not have happened otherwise, at acceptable cost to attention and autonomy?
This is not a single perfect number. The product should use a balanced scorecard that captures opportunity quality, relationship formation, network capability, and burden.
## 21.2 Primary metrics
| Metric | Definition / intent |
|---|---|
| Worthwhile interruption rate | Share of proactive contacts recipients retrospectively say were worth sending. |
| Opportunity activation rate | Share of shown high-confidence opportunities that receive genuine opt-in. |
| Completion rate | Share of mutually accepted opportunities that happen as scoped. |
| Repeat-edge formation | Share of new member-member edges that lead to another interaction within 60 days. |
| Direct continuation | Share of successful connections that begin coordinating outside Network mediation. |
| Time-to-first-value | Days from invite acceptance to first meaningful outcome. |
| Network capability coverage | Share of common, in-scope needs/desires that can be plausibly served by current local capacity. |
| Attention burden | Proactive messages per member per month, declines, mutes, and stated annoyance. |
| Contribution concentration | How concentrated giving time/attention is across members. |
| Cross-cluster bridge rate | Share of interactions that connect previously weakly connected graph clusters. |
| Life-expansion rate | Share of accepted opportunities members describe as outside their normal pattern but worthwhile. |
| Receiving dignity | Comfort and willingness to ask again after receiving support. |
| Regenerative spend effect | Incremental outcomes enabled by Commons or partner-funded barrier removal. |
| Network capability created | Per city: new members who activate, new recurring crews, new skills and knowledge within reach, newly connected clusters (39.5). |
| Vouch quality | Share of vouched members who activate, get value, and have no safety flags within 90 days. |
| Member-created opportunities | Share of opportunities started by members (asks, crews, member intros, missions) rather than the engine. |
| Network capital fairness | Outcome gap between NC deciles and NC Gini; gaming detection rate and time (39.2). |
| Per-app success metrics | slop.date: mutual-yes rate, dates held, second-date rate, time to first date. friends.help: repeat-meetup rate, crews formed. peon.biz: intro-to-interview, hires, 90-day retention. Anti-metrics and launch gates per app: Section 40. |


## 21.3 Anti-metrics
Daily active users, minutes in app, notifications opened, and message volume may be monitored operationally but must never become primary optimization targets. A member can have a highly successful month with two texts and one excellent dinner. One good connection a month, in a month when the member barely opened anything, can be life-changing and is a success.
## 21.4 Mechanical observability
- Every opportunity decision should log candidate set size, major score components, policy exclusions, chosen interruption channel, and explanation provenance.
- Model versions must be attached to ranking decisions so offline evaluation can reproduce outcomes.
- Consent and privacy events require immutable audit logs.
- Human overrides must be tagged so automated and concierge performance can be compared.
# 22. Technical architecture and implementation requirements
Decision (v0.2): The Network is built on the existing Eliza stack: Eliza Cloud (Cloudflare Workers API, Railway Postgres via Hyperdrive, webhook gateway), the Eliza shared agent for all member conversations, and the eliza.app website and Capacitor app. No sandbox or per-member container agents. All matching and opportunity processing is asynchronous over data in Postgres; the engine's output is turned into messages that the agent sends. Section 31 supersedes the generic stack below where they differ. Superseded for the pilot (2026-10-08): the shared backend runs on Railway as its own service (deploy/backend) and the sites on Cloudflare Pages; see the Section 31 status note.

## 22.1 Recommended MVP stack
| Layer | Recommendation | Reason |
|---|---|---|
| Mobile | React Native / Expo or equivalent cross-platform client. Decision (v0.2): the existing Eliza app (Capacitor; iOS/Android) with a Network view; not required for MVP launch. | Reuses the existing eliza.app Capacitor app, push, and native location plugin; no new mobile codebase. |
| Web | Modern TypeScript/React framework. | Onboarding, account settings, ops links, desktop access. |
| Backend API | TypeScript service layer with strict typed schemas. Decision (v0.2): Eliza Cloud (Hono on Cloudflare Workers) with a new Network module, plus the Eliza agent runtime and plugins. | Existing auth, messaging gateway, shared agent, cron, billing, admin, and deployment. |
| Primary database | PostgreSQL (Railway, existing Eliza Cloud instance, separate network schema); H3 cells for geo. | Canonical relational state plus strong geospatial primitives. |
| Semantic retrieval | pgvector initially. Decision (v0.2): pgvector (HNSW) in the existing Postgres, with per-city partial indexes and per-query hnsw.ef_search and iterative_scan settings. Validated 2026-10-06: pgvector's defaults silently return too few rows under a city filter, and generic text embeddings did not beat keyword or hashing retrieval for matching, so ranking relies on structured needs-to-offers complementarity. Post-MVP, learned joint embeddings. | Already used by Eliza Cloud. Post-MVP: learned joint embeddings (a JEPA-like model trained on outcomes) instead of generic text embeddings. |
| Graph | Relational edges + materialized graph projections initially; dedicated graph DB only when query scale/complexity justifies it. | Avoid premature dual-source-of-truth architecture. |
| Workflow | Postgres job table with due times and leases, driven by existing Cloudflare cron fan-out; a batch worker for matching. | Opportunity state, reminders, timeouts, bilateral consent, cancellation, and settlement are long-running workflows. |
| Messaging/voice | iMessage via Blooio and SMS/voice via Twilio through the Eliza Cloud webhook gateway; later Telegram, WhatsApp, Signal. | Already integrated in Eliza Cloud; meet people on the channel they already use. |
| Model layer | Vendor-neutral model gateway with structured outputs and tool calling. | Different tasks may use different models; social policy stays server-side. |
| External AI integration | Remote MCP + REST adapter + phone-verified agent keys (11.5). (Onboarding through MCP is MVP, 28.3; the wider connector surface is later, 28.4.) | Portable across compatible assistant ecosystems. |
| Analytics | Event stream to warehouse; product metrics and model evaluation separated from operational DB. (MVP: nightly Postgres export to Parquet in R2 queried with DuckDB, plus a read replica, Section 31.4.) | Reproducibility and experimentation. |


## 22.2 Core services
- Identity Service: member IDs, phone verification (the only login method), web sessions, and agent keys for skills and connectors (Section 11.5). (Agent keys ship with the connector, post-MVP; passkeys, if added, are a second factor only.)
- Profile/Capital Service: structured wants, capabilities, resources, participation state, permissions, and current capacity.
- Graph Service: relationship edges, interaction history, warm paths, cluster/topology features.
- Opportunity Service: create, classify, state-transition, complete, cancel, and archive opportunities.
- Matching Service: candidate retrieval, configuration ranking, load balancing, confidence calibration.
- Policy/Consent Service: ABAC-style authorization, privacy scopes, safety restrictions, disclosure checks.
- Relay Service: mediated messaging, temporary identifiers, disclosure handshake.
- World Service: web search, maps, local entities, events, business/venue capacity, external resources.
- Economic Service: paid transactions, partner inventory, Commons ledger, sponsorship rules; separate from social rank. (Not built in MVP. In v0.2 these services are modules of one Network service package, not separate deployables, Section 31.1.)
- Ops/Safety Console: human review, steward queues, explanations, reports, overrides, audit.
## 22.3 Opportunity state machine
Suggested canonical states: DRAFT -> POLICY_CLEARED -> MATCHING -> CANDIDATES_READY -> INVITING -> PARTIALLY_ACCEPTED -> MUTUALLY_ACCEPTED -> SCHEDULED -> ACTIVE -> COMPLETED. Terminal or side states include DECLINED, EXPIRED, CANCELLED, SAFETY_HOLD, DISPUTED, and ABANDONED. State transitions must be idempotent and permission-checked. From SCHEDULED, RESCHEDULE_REQUESTED returns to SCHEDULED, and CANCELLED and NEEDS_REPLACEMENT are explicit transitions; the full MVP machine is in Section 32.10. (v0.2: the state names in Section 32.10 are canonical for implementation; POLICY_CLEARED, MATCHING and CANDIDATES_READY are internal engine stages before PROPOSED, and ACTIVE is called IN_PROGRESS.)
## 22.4 AI architecture
- LLMs parse, summarize, draft, reason about soft fit, and explain suggestions. The Network agent is an Eliza agent. Members reach it from the messaging app they already use: iMessage and SMS in the MVP, then Signal, Telegram, and WhatsApp so it is inclusive. Later it can be invited into existing group chats.
- Deterministic services enforce privacy, consent, safety, commercial rules, state transitions, and money movement.
- Model output should be structured and schema-validated before becoming product state.
- Prompts/tools should use least privilege; a matching model does not need raw payment credentials, and an external assistant does not need the full graph.
- Use offline evaluation sets built from accepted/declined/completed opportunities plus steward judgments.
- Human reviewers should be able to inspect major scoring factors without reading hidden chain-of-thought or relying on opaque prose.
## 22.5 Search and world intelligence
The agent should have strong web/local search so it does not bother humans with questions the internet can answer. World search should return provenance and confidence. Local recommendations should separate commercial inventory from organic relevance. The product may cache high-quality local knowledge but should not invent real-time facts such as opening hours or event availability.
## 22.6 Security requirements
| ID | Requirement |
|---|---|
| SEC-001 | Encrypt sensitive data in transit and at rest; use separate keys/domains for especially sensitive relationship and safety data where practical. PII is scrubbed or swapped for stable pseudonyms before data reaches human reviewers, logs, analytics, evaluation sets, and any third-party model that does not need it. |
| SEC-002 | Role-based and attribute-based controls must restrict staff access; all sensitive staff reads are audited. |
| SEC-003 | No assistant connector receives raw secrets, private safety reports, or unrestricted graph exports. Agent keys (11.5) are stored only as hashes, never logged, scoped, and revocable per agent. |
| SEC-004 | Location precision is minimized by default and exact coordinates have explicit retention rules. Revised (v0.2): location is collected at the highest precision the member allows, but never shared: other members and partners only ever see coarse areas or travel-time estimates, and exact coordinates have explicit retention rules. In the MVP, location comes only from what members say and calendar data (no device location). |
| SEC-005 | Deletion/export workflows include derived embeddings and graph projections where technically feasible. Validated 2026-10-06: deleted rows stay on disk until tables are rewritten, so erasure schedules a physical purge within 24 hours; backups expire after a set window (proposed 30 days), and erasures are replayed after any restore. |
| SEC-006 | Threat-model prompt injection and malicious member text as untrusted input; tools authorize independently of model instructions. |
| SEC-007 | Financial workflows use established payment processors; The Network should not store card data directly. (Stripe.) |


# 23. Human operations, governance, and stewardship
Humans running parts of the Network is not the end state, but it produces the best early results and creates training data. Humans (founders and, later, members) set direction, goals, capital allocation, and team; automation handles the day-to-day.
The first Network will be partly software and partly invisible human stewardship. This is a feature, not a failure. Human operators create training data, understand edge cases, resolve conflicts, and protect the social system while automated confidence is immature.
## 23.1 Steward queues
- Unmatched but important requests.
- High-value opportunities below automated confidence threshold.
- New-member welcome and ambiguous onboarding. (Automatic by default with an internal soft-approval score; only flagged cases are queued.)
- Safety reports and blocked interactions.
- Commercial opportunity integrity review. (Not MVP.)
- Commons funding requests and unusual barrier-removal decisions. (Not MVP.)
- Network topology concerns: isolated members, overused connectors, single-cluster dominance. Extensive data analysis and visualization tools for this are part of the MVP (Section 35).
Staffing: review queues can be staffed by trained contract reviewers (for example, a small team in the Philippines) working from a written rubric. Their decisions are labeled training data. Reviewers see PII-scrubbed views by default and work under confidentiality agreements; access is role-limited and audited.
## 23.2 Governance rules
- Consequential rules are written and visible, not merely embedded in prompts.
- Founders and major funders cannot bypass safety or consent policy.
- Commercial partners cannot inspect individual member data beyond what a member explicitly shares in a transaction.
- Appeals exist for restrictions or removals that materially affect participation.
- As scale grows, add independent/member representation to policy and safety governance.
# 24. Failure modes and mitigations
The Network is unusually powerful because it sits between people, relationships, vulnerabilities, money, and place. The product should be designed from its failure modes rather than assuming benevolent intent is sufficient.
| Failure mode | What goes wrong | Mitigation / design response |
|---|---|---|
| Benevolent spam | Too many "good" opportunities become another inbox. | Interruption budgets, high thresholds, quiet feed, and silence as a valid state. |
| Time extraction | The Network expands possibilities by consuming scarce time. | Prefer opportunities attached to existing routines; use money/AI to remove burdens. |
| Helper burnout | Reliable generous people become unpaid infrastructure. | Load penalty, quotas, contribution concentration metrics, capacity development. |
| Life-stage blindness | Low participation is treated as churn or lack of seriousness. | Participation seasons; no penalty for quiet periods. |
| Social caste system | Popularity, access, or reliability scores become visible status. | No public universal scores, follower counts, or leaderboards. |
| Clique replication | Invite-only growth reproduces the founders' class/industry/social circle. | Steward invitation channels, bridge-building goals, cluster monitoring. |
| Creepy inference | Agent uses private or indirect information in a revealing way. | Inference-privacy policy, provenance-aware explanations, human review for sensitive cases. |
| Shadow graph | Nonmembers are profiled from uploaded contacts without consent. | No default contact upload; use member-mediated forwarding and minimal external stubs. |
| One-off social entertainment | Many fun events, few durable relationships. | Second-encounter logic, direct-continuation metric, recurring local patterns. |
| Filter bubble | Model overfits past choices and makes life smaller. | Separate fit from expansion; bounded serendipity budget. |
| Dependence on Network | Members outsource social judgment and lose autonomy. | Encourage direct contact and outside relationships; exportability; easy exit. |
| Authority creep | Agent starts defining what a "good" member should do. | No ideology, no moral score, consent-first language, written low-control constitution. |
| Commercial corruption | Higher-paying partners distort opportunities. | Hard separation of relevance ranking and economics; explicit labels; audit tests. |
| Paid access to people | Wealthy members buy better social opportunities. | Prohibit social matching tiers; money funds infrastructure, not human priority. |
| Commodification of kindness | Every interaction turns into a transaction. | Gift mode remains outside fees; paid mode is explicit and member-controlled. |
| Unpaid professional exploitation | Members are repeatedly asked to donate costly expertise. | Per-capability modes: gift, informal, exchange, paid, do-not-ask. |
| Romantic coercion | Helping creates implied romantic entitlement. | Separate opt-in, bilateral consent, no credit/reward linkage, safety review. |
| Stalking/location abuse | Location data reveals routines or private addresses. | Coarse/ephemeral location, strict disclosure timing, rapid block/revoke. |
| Scams/grifting | Members exploit trust for money, investment, housing, or sales. | Risk classifiers, transaction protections, restricted categories, reporting, contextual trust. |
| Fake reliability | Members game visible metrics. | Keep internal and contextual; use observed commitments, not check-in badges. |
| Network emptiness | Small network cannot fulfill enough needs. | Set expectations, focus dense geography, let AI/search create standalone value. |
| Geographic dilution | Early launch across two cities creates weak density. | Start with one dense city/cluster and expand only after local thresholds. (v0.2: SF and NYC launch together, each concentrated in adjacent neighborhoods with its own activation threshold, Sections 25.1 and 28.5.) |
| Vendor lock-in | The product becomes dependent on one LLM or assistant platform. | Canonical Network backend, model gateway, MCP/REST adapter architecture. |
| AI hallucinated social facts | Model invents who knows whom or what someone said. | Relationship facts come from structured records; inference labeled with confidence. |
| Over-automation | Algorithm sends socially risky messages without human judgment. | Confidence gates, human review, deterministic policy service. |
| Safety theater | Invitation is mistaken for proof someone is safe. | Progressive trust, role-specific verification, clear reporting, equal enforcement. |
| Data breach | Social graph and vulnerabilities are exposed. | Data minimization, encryption, least privilege, segmented access, audits, incident plan. |
| Economic capture | Investors/partners pressure company toward extraction. | Mission constraints, economic constitution, Commons allocation, governance evolution. |
| False synchronicity | The Network overstates meaning or manipulates people with mystical framing. | Ground suggestions in explainable reasons; respect randomness and uncertainty. |
| Social rejection harm | Repeated nonresponse or declined introductions feels like personal rejection. | Do not expose candidate failures; only show opportunities after necessary private opt-ins. |
| Hidden internal caste | Internal signals (reliability, engagement, data richness) quietly filter out good people who are new, quiet, or unusual. | Exposure floors for new and low-data members, exploration budget, periodic audits of exposure distribution by cohort, and no single composite internal score. |
| Spam and cold outreach | Members use the Network to mass-recruit or pitch, as on hackathon sites. | No member-to-member cold messaging; all contact is via accepted opportunities; rate limits; transparent restrictions with reasons and appeal. |
| Block abuse | Someone who is themselves unpleasant weakens others' standing with blocks or negative feedback. | Blocks only affect the pair; negative feedback is weighted by the giver's own history and corroboration; human review of patterns. |
| Unresponsive outreach | The agent keeps messaging people who stopped replying. | Automatic stop after two unanswered proactive messages; resumes only when the member re-engages. |


# 25. Launch plan and staged roadmap
## 25.1 City strategy
Launch one city first, not two. NYC and San Francisco are both plausible, but the key variable is local density and founder/operator reach. A network of 100 people spread across two cities is often weaker than 75 people concentrated within a small set of adjacent neighborhoods. Superseded (v0.2): launch two cities, San Francisco and New York, each concentrated in a small set of adjacent neighborhoods. Two cities from day one prove the system works multi-city and serve the many members who live between both. The density risk is managed with per-city thresholds: each city needs its own dense seed (40-75 members, Section 36.5) and at least 40 committed members before proactive matching is switched on there (Section 28.5); the MVP target is 75-150 active members per city (Section 28.1). Superseded in part by Section 40 (2026-10-08): slop.date launches first, matched within one city, several cities, or a radius from a zip code; SF and NYC remain The Network's own cities. Current (2026-10-08): New York City only for the pilot, starting with slop.date; San Francisco follows only after the expansion gates (25.6).
## 25.2 Stage 0 - Concierge prototype (0-8 weeks)
- 30-50 invite-only members in one dense geography. Revised (v0.2): 30-50 in each of two dense geographies (SF and NYC). In the v0.2 plan the seed is 40-75 per city (Section 36.5), and Stage 0 corresponds to milestone M6 (private pilot, about weeks 12-14 of the build, Section 37), not weeks 0-8.
- Phone/SMS onboarding; human stewards use an internal profile template. Channels: iMessage via Blooio and SMS via Twilio to start; later Signal, Telegram, and WhatsApp.
- No consumer app required; simple web settings page is enough.
- Operators manually create opportunities and record structured outcomes.
- AI performs search, drafting, summarization, and profile extraction but does not autonomously contact members. (v0.2: during the pilot the engine runs in shadow mode; once proactive matching is on, the agent sends only human-approved proposals, Section 32.8.)
- Test 40-60 opportunities across at least five categories.
## 25.3 Stage 1 - Network core (2-5 months)
- 50-150 members. (v0.2: the MVP targets 150-300 members across SF and NYC, Section 28.1.)
- Canonical event model, relationship graph, opportunity state machine, SMS relay, privacy scopes. Monthly events open to all members in each city.
- Native app beta with Today, People, Network, and Me. (v0.2: not in MVP; members use messaging plus the web pages in Section 32.17; app features are post-MVP, Section 28.4.)
- First automated candidate retrieval; steward approves proactive contacts.
- Initial ChatGPT/Claude/Grok connector prototype via Network Gateway where supported. (v0.2: post-MVP, five-tool surface, Section 11.2.)
- No economic marketplace yet except direct expense reimbursements if operationally necessary.
## 25.4 Stage 2 - Calibrated automation and local capacity (5-9 months)
- Automated high-confidence opportunities for low-risk categories.
- Location/travel-time features and ephemeral "around tonight" presence. (v0.2: travel-time estimates are in MVP, Sections 32.12 and 33.5; device location and 'around tonight' remain later.)
- Second-encounter/relationship continuation logic. (v0.2: basic second encounters are in MVP, flow F19.)
- Partner inventory pilot: venues/classes/tickets with strict commercial labeling.
- First paid professional-service transactions and transparent transaction fee.
- Create small Network Commons and test barrier-removal spending.
## 25.5 Stage 3 - Network-level intelligence (9-18 months)
- Graph topology optimization: bridges, cluster health, host development.
- Multi-party group formation and capability coverage modeling. (v0.2: small groups of 3-6 are in MVP, Section 33.7; capability-coverage modeling remains later.)
- Institutional underwriters with aggregate-only reporting.
- Regenerative capital dashboard and Commons governance.
- Expansion beyond SF and NYC only after both cities meet the expansion gates in 25.6.
## 25.6 Expansion gates
| Gate | Suggested evidence before expansion |
|---|---|
| Opportunity quality | Proactive worthwhile-interruption rate consistently high across several months. |
| Relationship formation | Meaningful percentage of new edges recur or continue directly. |
| Operational safety | Reporting, investigation, blocking, and appeals workflows proven in practice. |
| Load health | Contribution is not concentrated in a small exhausted core. |
| Economic integrity | First revenue streams do not reduce recommendation trust. |
| Local density | Most members have multiple reachable people/opportunities within normal travel tolerance. |


# 26. Team and resourcing
## 26.1 Founding team responsibilities
| Function | Early responsibility |
|---|---|
| Product / founder | Thesis, member interviews, opportunity quality, partner model, governance. |
| Engineering lead | Core backend, identity, messaging, graph/event model, connector gateway, security. (Connector gateway is post-MVP.) |
| Product engineer(s) | SMS/voice flows, native/web client, ops tools, matching prototypes. |
| Community / stewardship lead | Onboarding, opportunity curation, safety operations, local density, host development. |
| Design / research | Phone + app experience, privacy comprehension, social comfort, experimental research. |
| Safety / legal advisors | Messaging consent, privacy, marketplace/payment issues, background/screening policy, high-risk categories. |
| Partnerships (later) | Venues, local capacity, sponsors, institutions, Commons underwriters. |


## 26.2 Do not understaff operations
A purely technical founding plan is insufficient. The product is a social system and the early matching model will learn from steward decisions. Community operations should be treated as product development, not customer support. (v0.2 MVP staffing: 2-3 engineers, 1 product/community lead, part-time design, contract reviewers (Section 37), plus a named safety on-call (Section 36.3) and a reviewer lead who owns the rubric (Section 36.7).)
# 27. Open questions and decision log
| Question | Current PRD position | When to decide |
|---|---|---|
| NYC or San Francisco first? | Decided (v0.2): both, each with a dense neighborhood seed and its own activation threshold. (Superseded: New York City only for the pilot, slop.date first; San Francisco after the expansion gates, 25.6.) | Decided. |
| Should the product use XP/levels? | Only private, optional, role-based progression; no universal hierarchy. | After qualitative pilot proves motivation need. |
| How many invites does each member get? | MVP default: 3 per member per month, adjustable by network need (Section 32.15); not a recruiting reward. | Tune weekly during pilot (Section 36.5). |
| Should there be any member-visible "capital" view? | Show inventories/capabilities and collective growth, not a score, and only when the member opts in. Never show scores directly. | Design prototype. |
| Should current location ever be continuous? | No by default; start coarse and ephemeral. (v0.2: collection may be as precise as the member allows; sharing is never precise (SEC-004); continuous device location is post-MVP.) | Only after demonstrated value and security review. |
| What percentage of commercial margin goes to Commons? | Must exist as a policy once revenue is meaningful; exact formula is not set yet (post-MVP, Section 18). | Before first material commercial scale. |
| Long-term ownership structure? | Explore PBC + community/economic participation mechanisms; no early commitment to full cooperative form. | Financing / post-product-market-fit. |
| Can sponsors name the experiences they fund? | Yes if clearly labeled and if funding adds real capacity; no control over private member targeting. | Partner pilot. |
| How much external-network information may be stored? | Minimal member-described relationship metadata until the external person consents. | Before friend-of-friend pilot. |
| How should model vendors be selected? | Task-based evaluation; vendor-neutral gateway. | Implementation. |
| Voluntary paid governance membership? (earlier idea, superseded by 39.4) | Was under discussion: belonging stays free; a paid governance membership could fund inference and the Commons and confer voice, never social priority. | Before any monetization (post-MVP). |
| No-show consequences | MVP: one forgiven no-show, then held from group and time-sensitive opportunities until a lower-stakes commitment is completed. Refundable deposits are a post-MVP experiment. | Revisit after first 100 completed meetups. |
| ID verification | Not required for MVP members (vouch + phone + age attestation (13+); under-18 members are single-player only). Required for hosts of home-based events when that ships. (Section 40.5: slop.date has no ID or liveness check for now; phone login is the identity check.) | Before home hosting. |
| Profiles of non-members | No. No scraped or third-party profiles; growth is invite and vouch only. | Decided. |
| Proactive outreach to unresponsive members | Stop after two unanswered proactive messages; resume on re-engagement. | Decided; tune with data. |
| Sender numbers per city or one national? | Open; decide after Blooio and 10DLC checks (32.2, 36.1). (Superseded by Section 40.3: one Blooio line for every app, routed by keyword.) | M0. |
| Monorepo or dedicated repository? | Default monorepo (31.1). | M0. |
| Precision gate and review SLA values | Proposed defaults in 32.8. | Before M6. |
| Home-entry help requests in MVP? | Allowed only under the F14 rule. | Before M6. |
| Login for hosted AI assistants | Decided (October 8, 2026): OAuth 2.1 with a phone and SMS-code sign-in page for ChatGPT, the Claude directory and Grok. Code-in-chat only for local agents and unlisted connectors (11.5). | Decided. |
| Dating in the ChatGPT listing | No: plugins must suit users aged 13-17. slop.date's assistant entry is a paste-in prompt plus iMessage (11.4). | Revisit if OpenAI adds an adult listing. |
| Profile enrichment sources | The member's own AI summary, conversation, screenshots, pasted LinkedIn text, Calendar, X OAuth (never for sensitive traits). No Gmail scopes, no scraping without legal sign-off, never non-members (32.5). | Decided. |
| Notifications across apps and assistants | One inbox for every surface; at most one message per person per send; links into the member's assistant carry a task token, never a credential (32.9). | Decided; tune caps in the pilot. |
| X bot, Telegram, WhatsApp | X bot not in MVP (later, for distribution only). Telegram is the first channel after launch. WhatsApp is excluded while its ban on AI assistants stands. | After launch. |
| STOP/HELP owner on the shared line | Open. The service answers keywords today; Eliza Cloud may also receive the line's webhook. One owner only. | Before any live send. |
| Where the conversation runs | Open: the service's own LLM reader or the Eliza shared agent (packages/plugin-network). The service owns every member message today (32.3). | Before the onboarding work (37.1, item 4). |
| Join mode for peon.biz and friends.help on production | Open: invite, open or waitlist. The code default is open, and the setting is data (40.2). | Before their sites take joins. |
| Ban evasion | Open: build a same-face check, or drop that gate and rely on bans by phone and person (40.5). | Before the pilot. |
| Keep the security suite? | Open: bun run security (six files) runs as a non-blocking CI job (34.2). | Before the backend deploy. |
| Clef weight fitting | Open: the fitter was deleted in the cleanup and the shipped weights are a placeholder. Rebuild it for prototype P2, or keep ratings off until fitted weights exist. | Before ratings feed live matching. |
| Other platform questions | A legal entity per app, a second line, recycled numbers, storing a refused age, hash-key rotation, review deadlines per app and more: docs/mvp-gaps.md, section 5. | Before or during the pilot. |



# 28. MVP definition: what ships first and what does not
Sections 1-27 describe the full product direction. This section defines the first version precisely. Anything not listed as MVP here is not built for launch, even if an earlier section describes it.
## 28.1 The MVP in one paragraph
Status (2026-10-08): the first pilot is slop.date in New York City, on the shared multi-app platform (Section 40), starting with about 40-75 committed adults. People join by texting the one Blooio iMessage line with a keyword ("slop"; with no keyword they join The Network and the agent asks what they want) or through their own AI assistant, which reads the site's SKILL.md, has them confirm their own phone by text code, and submits the profile through the MCP server. The minimum age is 13: under-13s are declined and nothing is stored beyond the decline, and members aged 13-17 use the agent for themselves and are never matched or connected. Adult means the lowest stated age is 18 or more; there is no ID check. The engine runs the slop pack over Postgres and proposes pairs. While the network is under 1,000 members, a human reviews every proactive proposal and every member-initiated request before any member is contacted, and a proposal that misses its review deadline expires. Approved proposals start with a consent-first anonymous probe (age band, distance band, intent, one shareable fact, optionally one photo). On mutual yes the agent books a first date at a public venue, relays messages, numbers and photos with consent per item, reminds, checks in after the date and collects feedback. The four sites (ntwrk.love, slop.date, peon.biz, friends.help) are Cloudflare Pages projects, and the shared backend runs on Railway at api.ntwrk.love (31). The team operates the Network through the admin console, first built as the Observatory (packages/observatory), with staff sign-in, roles, review, safety and analytics, and validates it with simulations only (34). The Network's own matching (ntwrk) follows in New York City as an invite-only network of about 150 members with a monthly all-member gathering. The peon.biz and friends.help sites are live, but their matching and sends stay local. (A committed member has completed onboarding and opted into proactive messages. An active member has exchanged a message with the agent or taken part in an opportunity in the last 30 days.)
## 28.2 What the MVP must prove
- Members find unexpected messages from the Network worth receiving (worthwhile-interruption rate at least 70%, mute/complaint rate under 5%).
- High-conviction opportunities get accepted and happen (opt-in rate at least 40% of sent proposals; completion at least 70% of mutually accepted).
- Some first meetings turn into relationships (at least 20% of positive first meetings lead to a second interaction within 60 days, through the Network or directly).
- The Network is useful while small: at least 60% of members get a first meaningful outcome (an acted-on recommendation, introduction, group, or help) within 14 days.
- Growth through vouching works: at least 30% of members invite someone, and invited members activate at the same rate as seed members.
- Operations are sustainable: the review queue stays under ~2 reviewer-minutes per sent proposal, and the simulated world catches regressions before members do.
## 28.3 In scope for MVP

| Area | MVP scope | Where specified |
|---|---|---|
| Membership | Join by keyword on the shared line, by the person's own AI through MCP, or on the web; invite and vouch for The Network (slop.date is open join). Founding-team seed invites; automatic soft approval with flagged-case review; phone verification by text code. Minimum age 13: under-13s are declined kindly and nothing is stored beyond the decline; members aged 13-17 may join every app and are never matched (matching is 18+ by lowest stated age, 40.3). New York City is the home city; a member can record a trip to another city. slop.date locates members by city, several cities, or a radius from a zip code. | 8.1, 32.1, 32.15 |
| Channels | One Blooio iMessage line for every app, routed by keyword (40.3). Twilio only sends the web login codes. SMS fallback, voice and web chat are later. STOP/HELP compliance, with one system owning keywords on the line (an open founder decision, 27). | 32.2 |
| Agent | Today the Network service (deploy/backend) answers every member message, with deterministic asks per app; an LLM reader for free text is still to be wired (37.1). Whether the conversation moves to the Eliza shared agent (Network character and plugin, packages/plugin-network) is an open founder decision (27). One persona per app (40.3); progressive profiling; concierge search for events and places later. | 32.3 |
| Profile model | Members, facets, intents, presence, edges, consent, provenance and confidence, privacy scopes. | 13.1, 32.4 |
| Enrichment | Conversation extraction; inviter vouch notes; optional Google Calendar connection; public LinkedIn/X profile from a URL the member gives; pasted memory summary from the member's AI assistant. LinkedIn's terms prohibit automated fetching, so for LinkedIn the member pastes their profile text; this is the main path, not a fallback. An X bio may be read from the URL where the terms allow. | 32.5 |
| World knowledge | Curated New York City event ingestion from sources whose terms allow it (Cerebral Valley, Luma calendar feeds, open-data and venue calendars; Eventbrite, Meetup and Partiful only through partnerships) plus web search and maps. | 32.6 |
| Matching engine | Opportunity types: 1:1 intro, small group, event co-attendance, help request, member-initiated introduction, newcomer welcome, network-growth ask. Hard filters, retrieval, scoring with LLM judgment, group composition, load balancing, exploration, explanations. | 33 |
| Human review | Review queue for every proactive proposal and every member-initiated request, before the first member contact (the anonymous probe included). Approve, edit, re-roll, reject with reason codes. A proposal that misses its SLA expires and is never sent late. Eligibility is checked again on approve. Review is required in code while the live member count is under 1,000. Reviewer rubric. Labels are stored as training data. | 32.8, 33.9 |
| Outreach control | Interruption budget, per-category preferences, quiet hours, two-unanswered auto-pause, participation states. | 7.2, 32.9 |
| Consent workflow | Opportunity state machine. A consent-first anonymous probe goes to each participant before anyone learns who the others are. Then independent double opt-in, quorum for groups, expiry, and decline without penalty. No member learns who said no to a probe or an invitation. | 32.10 |
| Relay | Network-mediated messaging between participants; contact swap on mutual request; persistent relay threads. | 17.3, 32.11 |
| Scheduling | Availability capture, time proposals, calendar free/busy check (if connected), venue suggestions, confirmation, reminders, day-of check-in, reschedule, cancel, flake handling and replacement. | 32.12 |
| Feedback | Post-meeting factual then subjective questions, edge updates, reliability evidence, second-encounter candidates. | 32.13 |
| Safety and privacy | Privacy scopes, explanation provenance, leak checks on every outbound message, block and report by text, safety holds, high-risk exclusions, PII scrubbing for reviewers and logs. | 17, 32.14 |
| Events | Monthly all-member gathering per city: invitations, RSVPs, reminders, seating/grouping suggestions, follow-ups. | 32.16 |
| Member web | "What the Network knows about me" review and edit, states and preferences, connected sources, invites, history, export and delete. | 32.17 |
| Admin and analytics | The admin console, first built as the Observatory (packages/observatory). It has: review queue with SLA; member 360; member-perspective timeline (messages plus system decisions); social-graph explorer; opportunity pipeline; matching-run inspector with shadow runs; safety console; requests and demand; growth; metrics and health alerts; audit log; simulation lab. Staff sign in with SSO and a second factor and have roles. Views are PII-scrubbed by default, and every reveal and staff read is logged. The console reads a read-only replica; staff actions go through the Network admin API. | 35 |
| Testing | Simulations only: bun run sim, the single validation command, with blocking and tracked gates per block (evals corpora, The Network, slop, peon, friends) and the conformance rules for every pack; shadow mode on real data. The security suite is pending a founder decision (34). | 34 |
| Network capital (internal) | Private ledger built from events the MVP already records (vouches, attendance, feedback, confirmed help, organizing). Drives agent effort tiers, vouch capacity, and organizing reach; private "what you've built" view. Never visible to others, never used in anyone else's ranking, no cash value. | 39.2 |
| App memberships and keyword routing | One person per verified phone with a membership per app (ntwrk, slop, friends, peon). One Blooio iMessage line for every app; the first message is routed by keyword; with no keyword the person joins The Network and the agent enrolls them in the apps they want. Members 13+ may join every app; matching is 18+. Cross-app privacy and blocks across apps. | 40.3 |
| App packs | One engine with a pack per app (ontology, filters, scoring, consent, geo, oracle, sims). Core invariants no pack can loosen; networkPack byte-identical to today; shared conformance suite. | 40.4 |
| slop.date pack and sim | Stated preferences as filters, reciprocal scoring with congestion and exposure caps, probe first then a booked first date, radius or city geo with distance bands, safety basics; sim world with adversaries and launch gates. | 40.5, 40.8 |
| Admin app switcher | One admin panel with an app switcher, per-app roles and review queues, and an audited cross-app person view for safety only. | 35, 40.3 |
| Home page and app sites | All four sites (ntwrk.love, slop.date, peon.biz, friends.help) are on Cloudflare Pages. ntwrk.love is the home page for the whole concept; each app has its own landing page and agent persona, and the landing pages are agent-first (Agent-first onboarding row). | 40.1 |
| Agent-first onboarding (MCP and skills) | Each site gives the person one prompt for their own AI (ChatGPT, Claude, Grok, Perplexity and others): read the site's SKILL.md and sign me up. The agent collects the profile in conversation, hands the person one link to confirm their own phone (the agent never sees the code), then submits the profile through the MCP server on the backend (packages/mcp; hosted assistants use OAuth with a phone sign-in, 11.5). Joining by text works too. | 11, 40.3 |
| Web account page | Each app's site has a settings page: phone login with a text-message code, membership state, export of this app's data, stop messages for this app, leave this app, and delete everything (typed confirmation). A login on one domain is not a login on another. | 40.3 |


## 28.4 Explicitly not in MVP (and what it builds on)

| Later capability | Why not now | Builds on MVP piece |
|---|---|---|
| Native app Network tab, push notifications, location sharing, "around tonight" presence, map | Messaging covers the MVP loop; location needs privacy validation (20.3). | Presence model, Capacitor app, native location plugin |
| Bluetooth/proximity discovery at events | Needs app and safety design. | Presence, events program |
| Hosted-assistant connectors beyond onboarding (the full five-tool MCP surface for updates, asks and responses) | Onboarding through MCP and the site skills is in the MVP (28.3); the rest of the connector surface follows the pilot. Hosted assistants sign in with OAuth and a phone code (11.5). | ask/tell_network_agent = the same agent turn; share_profile_with_network = enrichment pipeline |
| Telegram, WhatsApp, Signal channels; agent in existing group chats | Telegram and WhatsApp adapters exist in the cloud gateway, so these are fast follows; Signal has no connector. | Channel gateway, identity linking |
| Forwarding opportunities to non-members via private links | Validation gate in 20.3 (forwarding and privacy expectations). | Invitations, consent workflow |
| Gmail, Instagram, and broader data import | Sensitive; prove value with lighter sources first. | Enrichment pipeline with provenance |
| Payments, balances, splitting costs, paid professional services | Business model deferred (18). | Opportunity commercial_mode, Stripe in Eliza Cloud |
| Refundable no-show deposits | Needs payments and careful testing. | Reliability evidence, attendance records |
| Network Commons, sponsorship, partner inventory, institutional contracts | Deferred (18-19). | Opportunity object, world knowledge |
| Governance, paid governance membership, member ownership, protocol tokens, and decision-market governance | Decide after product-market fit; needs legal review and token design first (39.4). | Admin metrics, audit log, network capital ledger |
| ID verification | MVP relies on vouch, phone, and age attestation (13+). Needed first for home hosting. slop.date has no ID or liveness check for now; phone login is the identity check (40.5). | Safety subsystem |
| Home-hosted events, childcare, money custody, regulated services | High risk (17.5). Home hosting comes after light-touch opportunities prove out (39.3). | Safety classes |
| Learned ranking models and learned joint embeddings | Need labeled outcomes from MVP first. | Review labels, outcome data, matching logs |
| Graph topology optimization, capability-coverage modeling | Need scale. | Graph analytics in admin |
| Private progression, roles, gamification | Validation gate (20.3). | Feedback and edge history |
| Cities beyond New York City, San Francisco included (slop.date markets: Section 40.5) | Expansion gates (25.6). | Multi-city presence model |
| Spendable network capital (time-bank style requests between members) | Needs the internal ledger, fairness and gaming results, and legal review first (39.2). | Network capital ledger, effort tiers |
| Borrowing, lending, rental, and a marketplace | Goods changing hands need custody, disputes, and safety design (39.3). | Opportunity object, reliability evidence |
| Group purchases and collective buying | Needs payments and money custody (18, 39.3). | Intents, small-group composition |
| Live matching and sends for peon.biz and friends.help | slop.date launches first. Their sites are on Pages, but their matching and sends run locally until the founder approves; their packs already pass their sim gates (40.6). | App packs, shared platform, local sim worlds |
| Legal and compliance backlog (NYC LL144 bias audit, dating-safety notices, 10DLC registration and others) | Not a launch blocker for now (founder decision 2026-10-08); the safety guards stay (40.7). | Audit log, consent ledger, relay log |


## 28.5 MVP launch gates (go/no-go)
- bun run sim passes every blocking gate on the pinned seeds (152 on 2026-10-08), with no privacy-canary leaks and no invariant violations. Tracked gates are printed and reviewed; any waiver is written by the founder (34.1, 40.8).
- Every proactive proposal and every member-initiated request goes through the review queue before the first member contact, the anonymous probe included. Every outbound message goes through the leak check. Code enforces both, and a simulator invariant checks that no probe goes out without a prior approval. A proposal that misses its review SLA expires.
- STOP/HELP, block, and report work on the live line, with one system owning STOP/HELP on the shared line; the safety escalation runbook is rehearsed.
- Messaging: Blooio deliverability measured on test phones (daily cap per line, attachments, no account flag; prototype P3, 37.2) and the opt-in wording recorded. 10DLC registration is in the deferred backlog (40.7), not a gate.
- The admin console (the Observatory) can show any member's full experience within two clicks: their messages, what the engine considered for them, why each item was or was not sent, review decisions and leak-check results. Staff sign in with SSO and a second factor and have roles. Views are PII-scrubbed by default. Every PII reveal and every staff read of member data is in the audit log. The console is not reachable without sign-in.
- Seed cohort recruited: at least 40 committed adults in New York City before proactive matching is enabled for an app, after at least two weeks of shadow mode with every proposal reviewed (34.6). Only an admin can switch matching on in the console, and the switch is logged.
- Safety on-call staffed with response targets (36.3); reviewers trained and calibrated on the rubric (36.7); cost alerts live (36.4); backup restore tested (36.9). Published terms and policies are in the deferred backlog (40.7).
- Age policy: under-13s are declined at join with nothing stored beyond the decline. Simulated runs show 0 minor contacts. The safety console lists members aged 13-17 and confirms none is in a multi-person opportunity.
# 29. User flows and interactions: MVP and later
Each flow lists the trigger, the steps, the systems involved, and the main edge cases. Flows marked MVP must work at launch. Later flows are designed to reuse the same objects and state machine.
## 29.1 Flow index

| ID | Flow | MVP | Core systems |
|---|---|---|---|
| F1 | Member invites and vouches for someone | Yes | Invitations, agent, review (flagged only) |
| F2 | Founding team seeds an invite | Yes | Admin console, invitations |
| F3 | Invite acceptance and identity verification | Yes | Identity, channels |
| F4 | Onboarding conversation (iMessage/SMS; optional voice; web) | Yes | Agent, extraction, profile |
| F5 | Review and edit "what the Network knows about me" | Yes | Member web, agent |
| F6 | Progressive profiling question | Yes | Agent, outreach control |
| F7 | Connect a source (calendar, LinkedIn/X URL, AI memory paste) | Yes | Enrichment |
| F8 | Ask the Network for something (AI-first) | Yes | Agent, world knowledge, engine |
| F9 | Create and manage a standing intent | Yes | Agent, intents, engine |
| F10 | Concierge recommendation (single-player) | Yes | World knowledge, agent |
| F11 | Proactive one-to-one introduction | Yes | Engine, review, consent, relay |
| F12 | Small-group opportunity with quorum | Yes | Engine, review, consent, scheduling |
| F13 | Event co-attendance ("you are both going") | Yes | World knowledge, engine |
| F14 | Help request (bounded task) | Yes | Engine, load balancing |
| F15 | Member-initiated introduction ("you would like my friend Theo") | Yes | Agent, consent, invitations |
| F16 | Relay messaging and contact swap | Yes | Relay |
| F17 | Scheduling: propose, confirm, reschedule, cancel | Yes | Scheduling |
| F18 | Reminders, day-of check-in, running late, flake and replacement | Yes | Scheduling, engine |
| F19 | Post-interaction feedback and second encounter | Yes | Feedback, engine |
| F20 | Change participation state or preferences in plain language; STOP; pause | Yes | Agent, outreach control |
| F21 | Nothing fits yet (honest empty state) | Yes | Engine, agent |
| F22 | Monthly all-member gathering | Yes | Events program |
| F23 | Block, report, and safety hold | Yes | Safety |
| F24 | Export data or delete account | Yes | Member web, data platform |
| F25 | Change phone number or add a channel | Yes | Identity |
| F26 | Traveling or multi-city presence | Yes | Presence, engine |
| F27 | Reviewer approves, edits, re-rolls, or rejects a proposal | Yes | Review queue |
| F28 | Unresponsive member auto-pause and re-engagement | Yes | Outreach control |
| F29 | Opportunity expires or quorum fails | Yes | Consent workflow |
| L1 | Use The Network from ChatGPT/Claude/Grok (phone-verified agent key, 11.5) | Later | Connector |
| L2 | Forward an opportunity to a non-member via private link | Later | Invitations, consent |
| L3 | Telegram, WhatsApp, Signal; agent joins an existing group chat | Later | Channels |
| L4 | App: location presence, "around tonight", map, push | Later | App, presence |
| L5 | Pay someone back, split costs, paid services | Later | Payments |
| L6 | Commitment deposit for high-demand events | Later | Payments, reliability |
| L7 | Host a home event (with ID verification) | Later | Safety, events |
| L8 | Commons grant to remove a barrier | Later | Commons |
| L9 | Partner or sponsored opportunity | Later | Partner inventory |
| L10 | Governance vote | Later | Governance |


## 29.2 MVP flows in detail
### F1. Member invites and vouches for someone
Trigger: a member says "I want to invite my friend Sam" or the agent asks for a specific kind of person the Network needs. Steps: (1) agent checks invite allowance; (2) agent collects the vouch: how they know Sam, for how long, how well, what Sam is like and wants, anything important, and Sam's phone number; (3) the vouch is stored as an invite edge with strength evidence; (4) soft-approval scoring flags only unusual cases (very weak vouch, many invites in a short time, risk keywords) for a human; (5) the agent sends Sam a personal invitation that names the inviter and explains the Network, or the inviter forwards a link if they prefer. Edge cases: invitee already a member (merge, tell inviter nothing private); invitee declines (no further contact); invitee is under 13 (declined at join with a kind message; no data kept beyond what is needed to decline); invitee is 13-17 (may join as a single-player member and is never matched or connected to others). Inviter is told when the invitee joins, never what they said in onboarding. (v0.2: by default the inviter forwards a personal link or a pre-written text from their own phone. The agent sends at most one invitation message itself, and only if the inviter confirms Sam expects it; it names the inviter, includes opt-out language, and is never followed up if unanswered. Vouch notes about Sam are held as non-matchable invite data, used only to seed Sam's profile with Sam's consent at acceptance, and deleted if the invite is declined or expires after 30 days.)
### F2. Founding team seeds an invite
An admin creates invites in bulk for the seed cohort with vouch notes and city. Same downstream flow as F1; invites are attributed to the team member.
### F3. Invite acceptance and identity
Invitee replies to the invitation or opens the link. Steps: confirm phone ownership (they are texting from it, or one-time code on web), accept terms and messaging consent, age attestation (13+; under-13s are declined with a kind message and no data is kept beyond what is needed to decline; members 13-17 join as single-player members and are never matched or connected to others), choose iMessage or SMS (detected automatically when possible). Creates the member record, an Eliza Cloud user, and channel identities. Edge cases: different number than invited (verify and link); duplicate account (identity link codes already exist in Eliza Cloud).
### F4. Onboarding conversation
Default is a messaging conversation of 6-12 short exchanges, resumable at any time; the member can ask for a voice call instead. The agent opens with what it already knows from the vouch and connected sources, then covers: consent and what the Network remembers; what they want more of (one or two intents: career, interests, hobbies, friends, romance opt-in, introductions); what they enjoy giving; city, neighborhoods, travel tolerance, normal-week routine; social format and boundaries; 2-3 hypothetical opportunities to calibrate interruptions ("would this be worth a text?"); and a read-back summary for corrections. Output: facets with provenance, intents, preferences, presence, initial participation state. Ends with an immediate single-player win when possible (an event or place this week). Edge cases: member stops mid-way (profile still usable; agent resumes later at most once); sensitive disclosures (stored agent-private); romance only for adults who explicitly opt in.
### F5. Review and edit what the Network knows
Member asks "what do you know about me?" or opens the web page. Shows facets grouped by kind with source and privacy scope; the member can correct, delete, or change scope. Deletions remove derived embeddings and are honored by the engine on the next run.
### F6. Progressive profiling question
At most one question at a time, only when timely (after a related mention, before a matching decision that needs it, or when an intent is under-specified), and counted against the interruption budget. Prefer confirm-a-guess over open questions.
### F7. Connect a source
Calendar (Google OAuth, existing Eliza connector) for free/busy and routines; LinkedIn or X profile URL the member provides (fetched once, summarized, shown to the member for approval); pasted memory or profile summary from their AI assistant. Each produces proposed facets that the member can confirm. Nothing is shared with other members unless its scope allows.
### F8. Ask the Network for something
Member: "anyone know a good climbing gym near Dolores?" or "I need help moving a couch Saturday." The agent classifies: information (answer with search/maps, done), recommendation (concierge, F10), standing intent (F9), or human opportunity (help request F14, intro F11, group F12). For human opportunities the agent states what will happen and the likely timeline, and creates a draft opportunity for the engine. It never promises a match.
### F9. Standing intent
"I want to start a band." Agent clarifies just enough (instrument, genre, commitment level, area), stores the intent with time horizon, and tells the member it will keep an eye out. The engine re-evaluates intents when new members, facets, or events arrive. Member can list, pause, or close intents. Intents expire or are re-confirmed after 60 days.
### F10. Concierge recommendation
"Anything fun this weekend?" Agent queries ingested events and places filtered by the member's interests, presence, and format, and returns 1-3 options with why. If other compatible members are going or interested, the engine may turn it into F13.
### F11. Proactive one-to-one introduction
Engine produces a proposal; reviewer approves (F27). Outreach control checks budget and quiet hours. The agent messages the first party with a specific, shareable reason, time/effort, and an easy no. On yes, the second party is asked independently. Neither learns about the other's decline. On mutual yes: relay thread opens (F16) and scheduling begins (F17), or the intro stays asynchronous if both prefer. Expiry 48 hours per side by default.
### F12. Small-group opportunity
Engine composes a group of 3-6 around an anchor (dinner, activity, event) with a host role if needed. Reviewer approves. Invitations go out in parallel with a quorum rule (for example, 4 of 6). If quorum is not reached by the deadline, the engine invites alternates from the ranked backup list; if still short, the opportunity is cancelled gracefully. Once quorum is met: group relay thread, scheduling, venue, reminders.
### F13. Event co-attendance
Two or more compatible members are going to, or would like, the same public event. The agent offers "a couple of people you might enjoy are going; want me to introduce you there?" Low-stakes, attached to existing plans. The proposal passes review (F27) before anyone is contacted.
### F14. Help request
Bounded, functional asks (moving, feedback on a deck, practice interview). Agent first checks if a service or search solves it. Engine selects helpers who enjoy that kind of help, with load penalties. Ask states the scope and time exactly. Thank-you and feedback afterwards. Safety rule (v0.2): a help request that requires entering a member's home is safety class medium; it needs two or more helpers or helpers who have already met the requester, always passes review, and the exact address is shared only after everyone has accepted. Requests with a single unacquainted helper at a home go to the safety queue.
### F15. Member-initiated introduction
"You would really like my friend Theo" (Theo is a member) or "introduce me to someone who knows hardware." Agent asks the first person privately, then Theo privately, and only connects on mutual yes. If Theo is not a member, the flow becomes an invite (F1). At launch the ask to Theo passes review (Section 32.8).
### F16. Relay messaging and contact swap
Participants message the agent; the agent forwards to the other side with a clear prefix ("From Maya: ..."), and summarizes only when asked. Group threads fan out to each participant. Either side can say "share my number with Maya"; the agent asks Maya for consent and swaps both contacts only if both agree. After a positive completed meeting the agent offers the swap. Threads persist indefinitely. Harassment or unsafe content is held and routed to safety.
### F17. Scheduling
Agent collects availability windows (or reads free/busy), proposes 2-3 slots that fit everyone, and picks a venue suggestion near the travel-time centroid. Confirmation requires every participant's explicit yes. Reschedule requests re-run proposals and need everyone's yes again; cancellation notifies everyone with no blame. Calendar invites are sent only to members who connected a calendar or asked for one.
### F18. Reminders, check-ins, flakes
Reminder the day before and 2-3 hours before; light check-in on the day ("still good for 7? what is the plan for getting there?"). Running late is relayed. If someone drops: apologize to the others, offer a replacement from the backup list or a reschedule, record attendance, and apply the no-show policy (15.2).
### F19. Feedback and second encounter
A few hours after the meeting: factual first (did it happen, who came), then one or two subjective questions (how was it, would you do something like this again, with whom). Updates edges, intent status, reliability evidence. Mutual positive outcomes become second-encounter candidates for the engine. Negative feedback weakens the edge privately; no forced confrontation. For a sample of proactive messages (accepted or declined), the agent also asks one line: 'Was that worth a text?' This feeds the worthwhile-interruption metric (21.2, 28.2) and counts against the interruption budget.
### F20. States and preferences
"I am slammed until November," "only dating and music," "surprise me," "not after 9pm," "STOP." The agent maps these to states, per-category preferences, and quiet hours and confirms in one line. STOP always works immediately on that channel (carrier requirement) and the member can resume any time.
### F21. Nothing fits yet
After the engine finds nothing above threshold for a member's intent within 10 days (default, Section 33.10), the agent tells them honestly, asks what else they are into, suggests concierge options, and asks whether they know someone who would make the Network better for them.
### F22. Monthly all-member gathering
Admin creates the event; the engine suggests who to personally invite first (newcomers, isolated members, people with pending second encounters) and suggests small conversation groupings; the agent sends invitations, collects RSVPs, reminds, and follows up afterwards with "anyone you want to see again?"
### F23. Block, report, safety
"Block Alex" or "report" from any channel. Block takes effect immediately and only affects the pair. Reports create a safety case with preserved evidence, may place a safety hold on the reported member's opportunities, and go to the safety queue. Emergencies: the agent tells the member to contact emergency services first.
### F24. Export or delete
Member requests export (data package by secure link) or deletion (account, facets, embeddings, messages; minimal retained records for safety and legal obligations, disclosed in the privacy policy). Deletion cancels the member's open opportunities (others are told without blame), removes their name from other members' relay threads, and keeps messages others already received only as long as safety retention requires.
### F25. Phone number change or new channel
Verified by a text-message code to the new number plus confirmation from the existing number (or steward review if the old number is lost); identities link to the same member ID; linked agent keys move to the new number; history is preserved.
### F26. Travel and multi-city presence
"I will be in SF the 10th to the 14th." Creates time-bounded presence; the engine includes the member in that city's opportunities for that window ("if you are in SF this weekend..."). Members who live in both cities have two home areas with learned weekly patterns.
### F27. Review queue decision
Reviewer sees the proposal, the scrubbed profiles, score components, explanation, and draft message. Actions: approve, edit message, swap a participant, re-roll (engine regenerates with feedback), reject with reason code. Decisions and reasons are training labels.
### F28. Unresponsive member
After two consecutive unanswered proactive messages the member moves to "only when I ask." On their next inbound message the agent mentions this and offers to resume. A proactive message counts as unanswered if there is no reply within 72 hours or before it expires, whichever is first. Proactive messages are invitations, profiling questions (F6) and unsolicited recommendations; messages inside an accepted opportunity (scheduling, reminders, check-ins, relay) and safety or account notices do not count and keep being sent. The setting applies across channels and is shown on the web 'States and preferences' page, so the change is visible, not silent.
### F29. Expiry and quorum failure
Invitations expire (default 48h; same-day opportunities 2-4h). Partial acceptances are released politely without revealing who declined.
## 29.3 Interaction surfaces by flow

| Surface | MVP role | Later role | Notes |
|---|---|---|---|
| iMessage / SMS | Primary for everything | Still primary | Short messages, one question at a time, easy no |
| Voice call | Optional onboarding; occasional check-in on request | Voice-first members | Recording consent required |
| Web (eliza.app) | Web chat with the agent, profile review, privacy, states, invites, history, export | Richer views | Phone number + text-code login |
| Native app | Not required | Location, presence, push, map | Capacitor Eliza app |
| AI assistants | Not in MVP | Four-tool connector | Server-side policy only |
| Admin console | Team operations | Steward and member governance tools | Section 35 |


# 30. Eliza platform analysis: what exists vs. what The Network needs
This analysis is based on a review of the elizaOS v3 monorepo (github.com/elizaOS/eliza, packages and plugins), Eliza Cloud, the eliza.app deployment, the live Cloudflare and Railway resources, and the Soulmates project (github.com/Soulmates-Land/soulmates) as a reference. Summary: Eliza already provides most of the conversational, messaging, identity, scheduling, and hosting infrastructure. The matching and opportunity engine, the cross-member workflows (consent, relay, group coordination), the Network data model, the review queue, the Network admin and graph tools, and the simulated world do not exist and are the core MVP build.
## 30.1 What Eliza is today (relevant parts)
- Eliza Cloud API: one Cloudflare Worker (eliza-cloud-api-prod, Hono, file-based routes) serving api.eliza.app and cloud.eliza.app, with Durable Objects, KV, R2, rate limiters, Workers AI, and 11 cron schedules fanned out to HTTP handlers.
- Shared agent: for each turn the Worker builds an ephemeral AgentRuntime (in-memory SQLite), replays the member's history from a per-room Durable Object (SharedRuntimeConversation), runs the canonical message handler, and mirrors results to Postgres. Each user gets a deterministic per-user agent identity. It runs serverlessly, needs no sandbox, and already powers eliza.app messaging. Current plugin set per turn: model, assistant, capability, web search, media, reminders, todos.
- Database: Railway Postgres 18 (prod and dev; staging separate) reached through Cloudflare Hyperdrive; Drizzle schemas (~280 tables) and migrations; pgvector with HNSW indexes.
- Messaging: inbound webhooks for Blooio (iMessage/SMS), Twilio (SMS and voice), WhatsApp, and Telegram go through the Railway gateway-webhook service into the shared agent. Outbound sends exist for Twilio, Blooio, and WhatsApp; proactive delivery from the gateway exists for Blooio and Telegram. Twilio voice bridges to a realtime voice session (Cartesia STT/TTS). Phone numbers are bring-your-own (stored, not provisioned).
- Identity: Steward-based auth (JWT, API keys, sessions), phone/handle identity-link codes for eliza.app, core identity clusters and merge engine. (Steward here is Eliza Cloud's auth system, unrelated to the Network 'Steward' role in 7.1.)
- Group chats: Personal Shared group bindings for Telegram and Blooio with participant registry and consent modes.
- Scheduling and calendar: plugin-calendar (Google, Microsoft, Apple, ICS; deterministic free/busy), plugin-scheduling (scheduled-task state machine), multi-party meeting negotiation in plugin-personal-assistant (proposals, approvals), reminders, follow-up tracking.
- Relationships: plugin-relationships knowledge graph (entities, identities, attributes, typed edges with confidence, cadence, sentiment trend, audit events) for one owner's contacts.
- Conversational forms: plugin-form extracts structured fields across turns with corrections, stash/resume, and nudges, which is a good fit for onboarding.
- Connectors: Google Workspace (Gmail, Calendar), X, maps/places, web search (keyless), embeddings, MCP client.
- App: eliza.app web (Cloudflare Pages) and a Capacitor iOS/Android app with push registration, native location, contacts, talk mode.
- Testing: scenario runner with multi-agent arena (personas with private facts, canary strings for leak detection), group-chat when-to-speak evals, a logical clock step, LLM-simulated users in benchmarks (LifeOpsBench, tau-bench), a FakeClock in interrupt-bench, Mockoon provider mocks, Playwright e2e, trajectory recording and export.
- Admin and observability: Cloud admin API (users, orgs, metrics, moderation), small admin UI (moderation, redemptions, RPC status), trajectory and turn-trace tables, per-agent trajectory and memory viewers in the app. No PostHog/Sentry; OpenTelemetry settings exist.
- Training: trajectory collection, privacy filtering, SFT/DPO/RL pipelines for Eliza-1 models; useful later for a Network-tuned model.
## 30.2 Capability gap matrix

| Need | What exists in Eliza | Status | Work for MVP |
|---|---|---|---|
| Member conversation agent | Shared agent on Workers + Durable Object history | Exists | Network character, Network plugin, context providers; add Network tables to per-turn context |
| iMessage / SMS in and out | Blooio and Twilio adapters, gateway, outbound send | Exists | Dedicated Network numbers (one shared line for every app, Section 40.3); A2P 10DLC/toll-free registration (deferred backlog, Section 40.7); STOP/HELP handling verified; per-channel rate limits |
| Proactive outbound from backend jobs | Gateway internal delivery (Blooio, Telegram); core sendMessageToTarget | Partial | Network outbound service: budget, quiet hours, idempotency, delivery receipts, Twilio SMS path for proactive sends |
| Voice onboarding | Twilio voice to realtime session | Exists | Network voice prompt; recording consent; transcript to extraction |
| Identity and login | Steward auth, identity links, phone verification | Exists | Member table linked to Cloud user; invite tokens; age attestation (13+) and minor flag |
| Network data model | General Eliza memory, relationships (single-owner) | Missing | New network schema: members, facets, intents, presence, edges, opportunities, participations, threads, consents, feedback, events, audit |
| Profile extraction | plugin-form field extraction; personal-assistant profile evaluators | Partial | Network extraction prompts (strict fields + additive enrichment), provenance/confidence, facet merge |
| Enrichment from sources | Google Calendar, Gmail, X, web search | Partial | URL-based LinkedIn/X profile summarizer, AI-memory paste parser, member approval step |
| Event and place knowledge | Web search, maps | Partial | Per-city event ingestion jobs and an events table with dedupe and freshness |
| Matching and opportunity engine | Nothing comparable (Soulmates and love-match are separate dating-specific systems) | Missing | Entire engine (Section 33) |
| Review queue | Generic approval_requests tables in plugin-sql; personal-assistant approval queue for one owner | Missing for this use | Network review queue with rubric, actions, labels |
| Consent handshake and state machine | Soulmates has pairwise double opt-in (reference only) | Missing | Opportunity state machine with quorum, expiry, alternates |
| Relay between members | MESSAGE send action (single owner messaging their contacts) | Missing | Store-and-forward relay threads, group fan-out, contact swap, moderation hold |
| Multi-party scheduling | Personal-assistant negotiation (owner-centric), calendar free/busy | Partial | Network scheduler across members using their own availability; venue suggestion; reschedule with all-party consent |
| Reminders and check-ins | Shared reminder cron, scheduled tasks | Partial | Opportunity-linked reminder plans driven by the Network job table |
| Feedback and reliability | None for cross-member outcomes | Missing | Feedback flow, edge updates, contextual reliability evidence |
| Privacy and inference safety | Sensitive-request policy, trusted-delivery audience, output sanitizer, arena canaries | Partial | Privacy scopes on every facet, explanation provenance, outbound leak checker, PII scrubbing for reviewers |
| Safety: block, report, holds | Cloud moderation admin; safety-oriented policies | Partial | Network block/report flow, safety cases, holds, safety queue |
| Jobs and time | Cloudflare cron fan-out, Postgres jobs table with leases, Redis queue, DO alarms | Exists | Network job types; a Clock abstraction for virtual time |
| Batch compute for matching | Railway agent-server; Hetzner control-plane worker; jobs table | Exists | A Network matcher worker service (Railway) with advisory lock |
| Member web pages | eliza.app SPA, auth, settings | Partial | Network profile, privacy, invites, history pages |
| Native app | Capacitor app, push, location | Exists (not needed for MVP) | Network tab later |
| Admin: conversations, graph, analytics | Admin API basics, moderation UI, trajectory viewers | Mostly missing | Network admin console (Section 35) |
| Simulated world | Scenario runner, multi-agent arena, LLM user simulators, logical/fake clocks, synthetic-world plumbing (no virtual clock yet) | Partial | Network world simulator with persona agents, virtual clock, outcome simulation |
| Analytics warehouse | Analytics routes, trajectory export | Partial | Event log + read replica/warehouse + metric definitions |
| MCP connector for ChatGPT/Claude | Platform MCP endpoint (API key auth); no OAuth authorization-server metadata | Partial | Later: phone-verified agent keys (11.5) and the five tools; OAuth only if a host requires it |
| Payments | Stripe, credits, crypto | Exists (not MVP) | Later |


## 30.3 Running resources we can reuse

| Resource | What it is | Use for The Network |
|---|---|---|
| Cloudflare Worker eliza-cloud-api-prod / -staging | Eliza Cloud API and shared agent; cron triggers; Durable Objects | Host Network API routes, agent turns, cron-driven job fan-out. Build and test on staging first. |
| Cloudflare Pages eliza-app | eliza.app, cloud.eliza.app | Member web pages (for example eliza.app/network or network.eliza.app) |
| Hyperdrive eliza-prod-pg / eliza-staging-pg | Pooled connections to Railway Postgres | Network schema access from the Worker |
| Railway project eliza-cloud | Postgres (prod, dev), Redis (prod, staging), redis-rest, gateway-webhook, gateway-discord, agent-server, tunnel-proxy, embeddings (staging) | Postgres for the network schema; gateway for inbound messages; a new network-matcher service for batch matching and simulation runs |
| Railway project eliza-voice-services | Whisper STT and Kokoro TTS | Voice onboarding fallback |
| R2 (eliza-cloud-blob, backups) and KV | Blob storage and cache | Exports, simulation artifacts, cached world data |
| Cloudflare Queues | Only Stripe queues exist today; more can be created | Optional network-jobs queue with dead-letter queue |
| Hetzner (control plane, app nodes, tenant DB VM, runners per Terraform) | Not yet inventoried | Optional heavy batch/simulation capacity once access is restored |
| Domains | eliza.app, elizacloud.ai, elizalabs.ai, and others on Cloudflare | Network subdomain and sending domains |
| GitHub | elizaOS/eliza (v3 monorepo), elizaOS/cloud and related private repos; Soulmates-Land repos; lalalune/loveofyourlife | No repository exists yet for The Network; create one or a package inside the monorepo |


## 30.4 Lessons from Soulmates (research only; no code reuse)
Soulmates is an elizaOS WhatsApp dating matchmaker ("Ori") with a separate batch matcher, a rule-based notifier, and a read-only admin dashboard, all communicating through one Postgres database.
- Worth copying as ideas: (1) separate the conversational agent from a batch matcher and a time-based notifier that communicate only through Postgres, with an advisory lock on matcher ticks and idempotent hour-bucketed event IDs; (2) "the LLM writes, it does not decide": deterministic handlers change state and give the LLM a brief to phrase; (3) a scoring funnel: SQL hard filters and vector kNN, then a cheap heuristic, then a small-model pre-screen, then a large-model rubric with calibration anchors, minimum floors on key dimensions, a separate dealbreaker flag, and a pair-specific "why"; (4) a score cache keyed on profile revisions; (5) per-side acceptance timestamps and a database uniqueness constraint against duplicate active pairs; (6) every timeout handled both by the next inbound message and by cron, idempotently; (7) two-pass extraction: strict fields that drive gates, then additive free-text enrichment; (8) rater-harshness weighting for feedback and a boost for people who were ghosted; (9) LLM-simulated users plus deterministic style rules plus LLM judges, with JSONL reports; (10) heartbeat, stage-transition log, and SQL invariant alerts in admin.
- Not applicable to The Network: pair-only matching and one-active-match exclusivity; Gale-Shapley assignment; gender/orientation and attractiveness fields; strict same-city exact-string matching; manually seeded group meetups with no group-formation algorithm.
- Pitfalls to avoid (observed in their code): a completed match permanently blocking a user from further matching; blocks stored in one ID space and compared in another; negative-feedback cooldowns that stop working once feedback is processed; profile syncs wiping learned engine state; a cached zero score that never expires after one noisy LLM verdict; an LLM score that silently replaces reliability and safety signals; configured minimum-score thresholds that are never applied; stated dealbreakers not enforced as hard filters; whole-database in-memory snapshots every tick; no fake clock (timestamps were back-dated in tests); a benchmark that tested code paths production did not use; and eight monkey patches around agent-framework behavior. Each of these becomes an explicit requirement or test in Sections 33 and 34.
- Related prior art: lalalune/loveofyourlife (LoveGPT, love-match-api on Cloudflare Workers with D1 and Vectorize) is an assistant-skill-based matchmaking design in which the user's own AI assistant builds the profile and the server enforces reciprocal eligibility and mutual introductions. It is a useful reference for the later assistant-connector flow (L1).
# 31. MVP system architecture
Status (2026-10-08): superseded for the pilot where it differs. As built, one Bun service (deploy/backend/server.ts, wrapping packages/network/service) runs on Railway at api.ntwrk.love with Railway Postgres. It serves the platform API, the signed Blooio webhook for the one shared line, keyword routing, the MCP server for agent-first onboarding, and a private staff API for review, safety and the matching switch. The engine runs inside the service's one-minute tick. The four sites are Cloudflare Pages projects whose router forwards /api, /mcp and the OAuth paths to the backend. The admin console is the Observatory on Railway behind Cloudflare Access. Eliza Cloud, the Eliza shared agent and the Twilio SMS path are not on the live path; whether the conversation moves to the Eliza agent is an open founder decision (27). The principles below still hold.
## 31.1 Architectural principles
- Build on Eliza, add a Network module. Network code lives in the Eliza monorepo as a Network plugin (agent side), a Network service package (domain logic, schema, jobs), routes in Eliza Cloud, and an admin app. No forked infrastructure. (Default; the monorepo versus dedicated-repository decision is confirmed in M0, Section 36.10.)
- Conversation is synchronous; the Network is asynchronous. The agent answers members in real time. Everything that involves more than one member (matching, invitations, scheduling across people, reminders, feedback) is driven by jobs over Postgres and results in messages the agent sends.
- Deterministic core, LLM at the edges. State transitions, consent, privacy, budgets, and money (later) are deterministic code. LLMs extract, judge soft fit, compose explanations, and phrase messages from structured briefs.
- One source of truth. Network state lives in one Postgres schema with an append-only event log. Agent memory may cache, never own, Network facts.
- Everything takes time from a Clock. No direct calls to the system clock in Network code, so the whole system can run in real time or accelerated simulated time.
- Every outbound message is checked. Proactive messages pass the review queue (MVP) and every outbound message passes the privacy leak checker and outreach controls.
## 31.2 High-level component map

| Layer | Components | Runs on |
|---|---|---|
| Channels | Blooio (iMessage/SMS), Twilio (SMS, voice), web chat; later Telegram, WhatsApp, Signal, MCP connector | Provider webhooks into Eliza Cloud gateway-webhook (Railway) and the Cloud API Worker |
| Conversation | Eliza shared agent + Network character + Network plugin (actions, providers, evaluators) | Cloud API Worker (per-turn runtime), SharedRuntimeConversation Durable Object |
| Network API | Typed domain services: members, profile, intents, presence, opportunities, consent, relay, scheduling, feedback, invitations, safety, events | Cloud API Worker routes (/api/network/*) using Hyperdrive to Postgres |
| Async engine | Matcher (retrieval, scoring, composition, load balancing), enrichment jobs, world-ingestion jobs | network-matcher service (Railway, Bun) with Postgres advisory lock |
| Orchestration | Job table with due times and leases; opportunity state machine; outreach scheduler; reminder and check-in plans; timeouts | Cron fan-out every minute in the Worker plus the matcher service for heavy jobs |
| Outbound | Outreach controller (budget, quiet hours, preferences), message composer (LLM from brief), leak checker, channel send with idempotency and receipts | Cloud API Worker and gateway |
| Data | Postgres network schema (pgvector, H3 geo cells), event log, read replica or warehouse for analytics, R2 for exports and simulation artifacts | Railway Postgres; R2 |
| Operations | Admin console (review queue, member 360, conversations, graph explorer, pipeline, metrics, safety, audit); simulation lab | eliza.app admin routes (Pages) backed by admin API |
| Simulation | World simulator, persona agents, virtual clock, scenario runner, judges | network-matcher service or a dedicated sim worker; staging environment |


## 31.3 Core loops
- Inbound loop: member message arrives at a provider webhook, goes through the gateway to the shared agent turn; the Network plugin loads member context (profile summary, active threads, pending opportunities), the agent decides an action (answer, update profile, create intent, respond to opportunity, relay, schedule, block/report), the action calls the Network API, the API writes state and events, and the agent replies.
- Extraction loop: after each turn an evaluator extracts proposed facets and intents (strict pass synchronously for gating fields, additive enrichment asynchronously), with provenance and privacy scope; low-confidence or sensitive items are held for confirmation.
- Matching loop: triggers (new or changed intent or facet, new member, new event, schedule tick, pre-weekend run) enqueue matching jobs; the matcher produces proposals with scores and explanations; proposals go to the review queue; approved proposals become opportunities in INVITING.
- Outreach loop: the outreach controller decides when and how each invitation or question is sent; the composer phrases it; the leak checker validates it; the channel sends it; delivery receipts and replies update state.
- Commitment loop: accepted opportunities drive scheduling, reminders, day-of check-ins, attendance, and feedback jobs on the Clock.
- Learning loop: feedback, attendance, review decisions, and declines update edges, reliability evidence, intent status, and offline evaluation sets.
## 31.4 Data flow and storage boundaries
- Network tables live in a dedicated network schema in the Eliza Cloud Postgres (separate migrations, separate roles), keeping Network data isolated from generic Eliza tables and easy to export or move. Schema changes are numbered SQL migrations with a ledger table and an advisory lock (bun run db:migrate). A migration runs once. Production migrations run as a role that row-level security does not filter.
- The shared agent's conversation history remains in the Durable Object and its Postgres mirror; the Network keeps its own message log for relay threads and outreach (needed for admin views, feedback, and safety evidence).
- Embeddings live next to facets and intents (pgvector HNSW). Geography uses H3 cells at several resolutions plus lat/lng; travel times come from the maps service with caching.
- Analytics reads from a replica or a nightly export (Postgres to Parquet in R2, queried with DuckDB or a hosted warehouse), never from the primary during peak.
## 31.5 Environments
- Local: PGlite or Docker Postgres, mocked channels, virtual clock, deterministic model plugin for unit tests.
- Staging: eliza-cloud-api-staging, staging Postgres, test phone numbers, simulated world runs at accelerated time.
- Production: dedicated Network sender numbers (per city or one national number, decided in M0 after Blooio and 10DLC capacity checks, Section 32.2; superseded by Section 40.3: one Blooio line for every app, routed by keyword), production Postgres, review queue enforced, sim traffic forbidden. The admin console reads a read replica through a read-only login (network_observatory, no access to channel_identities) and one database role per app with row-level security (40.3). Game and simulation controls are off in production.
- Shadow mode (pre-launch): the engine runs on real seed-member data and writes proposals to the review queue only, never sending, to measure precision.
# 32. Subsystem specifications
Each subsystem lists purpose, what is reused from Eliza, what is new, key data, key logic, interfaces, and MVP scope.
## 32.1 Identity, membership, and access
- Purpose: one stable member identity across channels, cities, and number changes; roles and permissions. Updated 2026-10-08 (Section 40.3): one person per verified phone, with a membership per app.
- Reuse: Eliza Cloud users and Steward auth; identity-link codes; phone verification.
- New: network.members (member_id, cloud_user_id, status, roles, home areas, states, invite lineage, age attestation, created_at), network.channel_identities (channel, address, verified_at, primary), network.agent_keys (key_id, member_id, key_hash, verified_phone, client_label, scopes, created_at, last_used_at, expires_at, revoked_at), network.roles (member, connector, host, steward; staff roles admin, reviewer, safety, analyst, engineer per Section 35.1).
- Logic: invite token or verified inbound number creates a member; soft-approval score; account states (invited, onboarding, active, paused, restricted, removed); role-based admin access with audit. (The account state 'paused' is distinct from the participation state Paused (7.2) and from the 'only when I ask' outreach setting applied by the two-unanswered rule (F28).)
- MVP scope: everything above, with phone number + text-message code as the only login on every surface; agent keys ship with the connector (11.5); passkeys (second factor only) and ID verification later.
## 32.2 Channel gateway and messaging
- Purpose: receive and send messages on every supported channel reliably and compliantly.
- Reuse: Blooio and Twilio adapters, gateway-webhook, outbound send utilities, Twilio voice bridge, group bindings.
- New: Network sender numbers (one iMessage/SMS identity per city or one national number; decide after Blooio and 10DLC capacity checks; superseded by Section 40.3: one Blooio line for every app, routed by keyword); network.outbound_messages (idempotency key, channel, template/brief id, status, provider id, delivered/read timestamps); STOP/HELP/START keyword handling verified for Network numbers; per-recipient and per-number rate limits; quiet-hours enforcement in the member's local time; delivery failure fallback (iMessage to SMS).
- MVP scope (2026-10-08): one Blooio iMessage line for every app (40.3); Twilio only for web login codes; SMS fallback, voice and web chat later; Telegram is the first channel after launch (27). Each live send needs BLOOIO_ALLOW_SEND=1, the founder's live approval (NTWRK_LIVE_APPROVED=1) and the founder's approval for that app (<APP>_LIVE_APPROVED=1). The person-level cap (40.3) is checked at send time.
## 32.3 Network agent (Eliza shared agent)
- Purpose: the voice of the Network for every member conversation. Each app has its own persona on this agent (Section 40.3). Status (2026-10-08): the Network service owns every member message on the shared line today, with deterministic asks; packages/plugin-network is not connected to the line. Whether the conversation runs in this agent or in the service is an open founder decision (27).
- Reuse: shared runtime per turn, message service, web search, reminders, memory, voice session.
- New: Network character (observant, concise, non-needy; style rules in 12.4 as testable rules); Network plugin with:
- Providers: MEMBER_CONTEXT (shareable profile summary, states, preferences), ACTIVE_ITEMS (pending invitations, upcoming commitments, open relay threads, outstanding questions), CITY_CONTEXT (events this week, presence).
- Actions: UPDATE_PROFILE, MANAGE_INTENT, ASK_NETWORK (classify and route requests), RESPOND_TO_OPPORTUNITY, RELAY_MESSAGE, SHARE_CONTACT, SCHEDULE (availability, confirm, reschedule, cancel), SET_STATE, INVITE_PERSON, BLOCK_OR_REPORT, GIVE_FEEDBACK, CONCIERGE_SEARCH.
- Evaluators: facet/intent extraction, sentiment and safety signals, unanswered-question tracking. Validated (2026-10-06): state changes use one structured decision on the first model call, not the multi-step planner. The model proposes, deterministic code authorizes and executes, and the member sees a confirmation built from what actually executed. With gpt-6-luna the planner committed SET_STATE in 1 of 20 turns. The structured decision committed 58 of 60 with the correct state and exact dates and 0 of 30 false commits, using one model call (measured p95 6.7 s against the 8 s target). Dates the member states are resolved in code rather than trusted from the model, state changes can have a start date (presence windows), and no state is written without the end date the member gave.
- Logic: state-changing actions call the Network API, never write tables directly; deterministic handlers decide state, the LLM phrases replies from a brief; any message about another member is built only from fields the privacy policy allows.
- MVP scope: all of the above. A dedicated (non-shared) agent tier is not needed.
## 32.4 Profile and knowledge model
- Purpose: a flexible, provenance-aware model of each member (Section 13.1 ontology).
- New tables: facets (member_id, kind, value, attributes JSONB, tags, embedding, privacy_scope, provenance, source_ref, confidence, status: proposed/confirmed/rejected, valid_from/to, revision); intents (member_id, kind, objective, category, details, desired_people, time_horizon, urgency, status, last_confirmed_at, embedding); presence (member_id, type: home/routine/temporary, area H3 cells, city, time window, recurrence); preferences (notification categories, quiet hours, formats, travel tolerance, romance opt-in, boundaries); edges (Section 13.2 and Appendix B.2).
- Logic: facts said by the member beat inferred facts; inferred facts carry confidence and decay; contradictions create a confirmation question rather than a silent overwrite; every change bumps a revision used by the score cache; engine-learned state is stored separately and never overwritten by profile syncs (a Soulmates pitfall).
## 32.5 Extraction and enrichment
- Purpose: turn conversation and connected sources into facets and intents with minimal asking.
- Reuse: plugin-form extraction patterns; personal-assistant profile evaluators; Google Calendar; X; web search.
- New: strict extraction (gating fields: city, intents, consent answers, state changes) and additive enrichment (new insights only, never deleting), English-normalized vocabularies, vouch-note ingestion, LinkedIn/X profile paste parser (validated 2026-10-06: LinkedIn's terms prohibit automated fetching and X shows only a bio without its paid API, so pasting is the main path), AI-memory paste parser, calendar routine inference (free/busy patterns only), proposed-facet confirmation UX.
- Quality bar: precision over recall; golden test sets per extractor (Section 34.2).
- Sources (decided October 8, 2026), in order of value for effort and risk: the member's own AI summary (a fixed import prompt opened in ChatGPT or Claude by a link, pasted back by the member, and the raw text deleted after the member confirms what was extracted); conversation and vouch notes; screenshots the member sends (their own facts only, no face analysis, image discarded); pasted LinkedIn profile text; Google Calendar free/busy; X interests through OAuth, never used for dating or sensitive traits; YouTube subscriptions; Discord servers. Not used: Gmail scopes, the Instagram, Spotify and Reddit APIs, Strava data in models, data brokers, contact or follower lists imported as people, and any scraping without legal sign-off (never LinkedIn, never non-members). Sensitive categories are asked, never inferred. Detail in docs/research/2026-10-08-entry-flows.md.
## 32.6 World and concierge knowledge
- Purpose: make the Network useful before the graph is dense and seed opportunities around real events.
- New: per-city ingestion jobs for event sources whose terms allow it (Cerebral Valley feed, Luma calendar subscription feeds, city open-data, library and parks calendars, venue calendars; Eventbrite, Meetup and Partiful forbid scraping and need partner or API agreements. Validated 2026-10-06: allowed sources give about 200-280 adult events a week per city, mostly civic, so relevant volume depends on those partnerships), normalized events table (title, time, place, H3 cell, categories, price, source, freshness, embedding), dedupe, staleness rules (never state real-time facts without a fresh source), places via maps service.
- Interfaces: CONCIERGE_SEARCH action; engine event-anchored generators.
- Legal: respect each source's terms; prefer public APIs and feeds; store links and minimal metadata.
## 32.7 Opportunity engine
Specified in detail in Section 33.
## 32.8 Review queue and human-in-the-loop
- Purpose: keep early precision very high and produce training labels.
- New: review_items (proposal, priority, SLA, assignee, decision, edits, reason codes, time spent), reviewer rubric, reason-code taxonomy (weak reason, privacy risk, capacity concern, wrong timing, safety, tone, duplicate), re-roll with reviewer note, sampling of auto-approvable categories after the precision gate.
- Policy: every proactive proposal is reviewed for the whole MVP and while the network is under 1,000 members. After that, a category may move to sampled review only once it has held the precision gate for 4 consecutive weeks. Member-initiated requests (a member asking for an intro) also pass review at launch; whether they can skip review is decided after the pilot. All outbound messages always pass the leak checker. Precision gate (proposed default, confirm before M6): reviewer approval without edits at least 80%, recipient opt-in at least 40%, and worthwhile-interruption rate at least 70% for the category. Review SLA: standard proposals within 12 hours, same-day proposals within 1 hour, with reviewer coverage hours set per city; a proposal that misses its SLA expires instead of being sent late. Review happens before the first member contact, the consent-first anonymous probe included. The Network reads the live member count from the database. Approving a proposal re-checks age, block, pause and hold status for every participant. A simulated reviewer ('auto') is allowed only in the simulator.
## 32.9 Outreach and interruption control
- Purpose: decide whether, when, and how to contact a member.
- Inputs: participation state, per-category preferences, quiet hours, interruption budget (default Normal: at most 2 proactive messages per week; Open: 4; Quiet: 1 per month; Receiving: support-only; Paused: none), unanswered count, current commitments, local time. Budget counts proactive messages the member did not ask for (invitations, F6 questions, unsolicited recommendations); replies to the member and messages inside an accepted opportunity do not count. Budgets reset weekly in member local time.
- Logic: priority ordering when several items compete; bundling into one message when appropriate; deferral to the next allowed window; the two-unanswered rule; all decisions logged with reasons.
- Notifications (decided October 8, 2026): one inbox for every app and surface, and an item seen on any surface is seen everywhere. Each person gets at most one message per send across all apps on the shared line: requested reminders at once, urgent items after about 5 minutes, everything else in a digest, inside the weekly cap and quiet hours. Just before sending, items are re-checked and the message is cancelled if they were already seen elsewhere. The message carries the update in the thread, or points at the member's chosen or most-used assistant with a fill-only prefilled link and a task token, which is a reference and never a credential. Implemented in packages/notify; detail in docs/research/2026-10-08-entry-flows.md.
## 32.10 Opportunity workflow and consent
- States: DRAFT, PROPOSED (engine), IN_REVIEW, APPROVED, PROBING (anonymous availability check; no identities shared), INVITING (reveal and double opt-in to those who said yes), PARTIALLY_ACCEPTED, QUORUM_MET or MUTUALLY_ACCEPTED, SCHEDULING, SCHEDULED, RESCHEDULE_REQUESTED, NEEDS_REPLACEMENT, IN_PROGRESS, COMPLETED, FEEDBACK_COLLECTED; side and terminal states REJECTED_IN_REVIEW, EXPIRED_IN_REVIEW, DECLINED, EXPIRED, QUORUM_FAILED, CANCELLED, SAFETY_HOLD, DISPUTED, ABANDONED.
- Participation states per member: invited, accepted, declined, expired, confirmed, attended, cancelled_with_notice, no_show, replaced.
- Rules: transitions are idempotent, permission-checked, and logged as events; invitations are independent (no participant learns another's decline); quorum and alternates for groups; expiry timers on the Clock; database constraints prevent duplicate active opportunities for the same set of people and objective. The allowed transitions (from, to, trigger, actor, timer) are defined as a table in code and documented here before M4; any transition not in the table is rejected and raises an invariant alert.
## 32.11 Relay and contact exchange
- New: threads (opportunity_id, participants, status), thread_messages (sender, recipients, original text, delivered text, moderation status), contact_shares (requester, target, status).
- Logic: clear sender prefix; fan-out for groups; moderation hold for harassment or unsafe content; contact swap only with both consents; threads persist; the agent may summarize on request; members can leave a thread.
## 32.12 Scheduling and commitment
- Reuse: plugin-calendar free/busy, personal-assistant negotiation patterns, maps travel times.
- New: availability windows per member (stated, calendar-derived, and learned patterns with confidence), slot proposal algorithm (maximize attendance and minimize travel and lead-time mismatch), venue suggestion near the travel-time centroid, confirmation with all-party consent, reschedule chains (new proposal superseding the old, needing everyone's yes), reminder and check-in plans (T-24h, T-3h, day-of), running-late relay, replacement from backups, attendance capture. In the MVP the agent suggests venues and booking links but does not make reservations or hold money; for groups, the host (or a volunteer participant) books, and everyone pays their own way.
## 32.13 Feedback, reliability, and edge learning
- New: feedback records (factual, subjective, would-meet-again, free text), attendance-derived reliability evidence by context (type, lead time, size, distance), rater-bias weighting, edge updates (met, enjoyed, would-interact-again, group-only, avoid), second-encounter candidate generation.
- Rules: declines never affect reliability; one forgiven no-show; negative feedback weakens only that pair and is corroboration-weighted; nothing is shown as a score.
## 32.14 Policy, privacy, and safety
- New: privacy scope on every facet and message field; explanation builder that can only use shareable evidence; outbound leak checker (deterministic checks for agent-private facts and contact details plus an LLM classifier for indirect inference, using canary facts in tests; validated 2026-10-06 at about 99% recall on seeded leaks, with 2-3% of clean messages held for human review; subtle inference leaks still need a human-labelled test set); PII scrubber/pseudonymizer for reviewer views, logs, analytics, and third-party models; safety classifier on inbound messages (none, flag, urgent); blocks; safety cases with evidence preservation and holds; high-risk category filter (17.5); age policy enforcement (minimum age 13, under-13s declined at join; no member under 18 in any multi-person opportunity, in any role; romance 18+).
## 32.15 Invitations and growth
- New: invitation allowances (default 3 per member per month, adjustable by network need), vouch capture, invite edges with strength evidence, soft-approval scoring, targeted growth asks ("we need hosts in Brooklyn"), newcomer welcome opportunities.
## 32.16 Events program
- New: monthly all-member gathering per city: event records, priority invitation lists (newcomers, isolated members, pending second encounters), RSVP tracking, suggested conversation groupings, follow-up "who do you want to see again?" feeding second encounters.
## 32.17 Member web surface
- New: pages on each app's site (first: the settings page, 28.3): What the Network knows (facets by kind with source, scope, edit), Intents, States and preferences, Connected sources, Invites, History (opportunities and outcomes), Privacy and data (export, delete). Login by phone number and text-message code only. Mobile-first.
## 32.18 Jobs, scheduling, and the Clock
- New: network.jobs (type, payload, due_at, attempts, lease, idempotency key, status), job runner invoked by cron fan-out every minute and by the matcher service; Clock interface (now, sleep-until semantics via due_at) with RealClock and SimClock; all timers expressed as due_at rows so a simulation can advance time and drain due jobs deterministically.
## 32.19 Data platform and event log
- New: append-only network.events (who, what, when, object refs, payload, actor type: member, agent, engine, reviewer, admin, sim), metric definitions as code, nightly export to R2 (Parquet), analytics queries for dashboards, data retention and deletion propagation.
## 32.20 Observability and evaluation
- Reuse: trajectory recording, turn traces, trajectory export, OpenTelemetry settings.
- New: matching-run logs (candidate set size, filters applied, score components, model versions, chosen proposals), message composition traces (brief, draft, leak-check result), error tracking and alerting (heartbeats for matcher and job runner, invariant checks), offline evaluation sets from review decisions and outcomes.
# 33. Matching and opportunity engine v1: detailed design
This is the one major system that does not exist anywhere in Eliza. The v1 goal is not a learned model. It is a transparent, testable pipeline that produces a small number of high-conviction proposals per city per week, explains them, respects every constraint, and logs everything needed to learn later.
## 33.1 Design goals
- Precision over volume: a proposal should be something a thoughtful friend would suggest.
- Opportunities, not just pairs: support pairs, groups, event anchors, help asks, and network-growth asks with one framework.
- Hard constraints are never traded for score (privacy, safety, blocks, consent, capacity, states).
- Explainable with shareable reasons only.
- Fair: avoid concentrating opportunities on a popular few or silently excluding new, quiet, or unusual members.
- Reproducible: every run can be replayed from logs; every score has components.
- Time-aware: runs in real or simulated time.
## 33.2 Inputs
Members (state, preferences, presence, budgets), facets and intents with embeddings, edges, availability windows, events and places, open opportunities and recent history (who was asked what, when), reliability evidence, review labels, and feedback.
## 33.3 Triggers and cadence
- Event-driven (debounced): new member completes onboarding; new or updated intent; significant facet change; new event ingested matching someone's interests; feedback with would-meet-again; member says they are free ("anything tonight?").
- Scheduled: nightly full run per city; a pre-weekend run (Wednesday) for weekend plans; weekly network-health run (isolated newcomers, overused helpers, stale intents); monthly-event planning run.
- Concurrency: one matcher tick per city at a time (Postgres advisory lock); incremental work by default; full recompute nightly.
## 33.4 Opportunity generators
Each generator proposes candidate opportunities of one type. All share retrieval, scoring, and policy.

| Generator | Logic | Example |
|---|---|---|
| Intent to capability | An intent needs something another member has or offers. | Wants to learn sailing; another member teaches sailing and likes beginners. |
| Complementary intents | Two or more intents fit together. | Guitarist and drummer both want to start a rock band. |
| Shared intent pooling | Several members want the same thing. | Three people want a weekend tennis partner nearby; form a pair or a doubles group. |
| Event anchor | An event fits several members; propose going together or meeting there. | Two climate founders both interested in a demo night. |
| Warm path | A member's edge connects two people who should meet. | A friend of a friend has exactly the experience someone asked about. |
| Help request | A bounded ask needs one to three helpers. | Moving a couch Saturday. |
| Group composer | Build a dinner or activity for 3-6 with role coverage and warm ties. | Six people, two of whom already know each other, around a shared love of film. |
| Second encounter | Positive first meeting plus a natural next context. | Two people who enjoyed helping with a move both like a food event. |
| Newcomer welcome | New member with few edges joins a low-stakes group. | First-week welcome coffee with a host and two friendly members. |
| Network growth | A gap the Network needs filled; ask the members most likely to know someone. | No hosts in a neighborhood; ask two well-connected members to invite one. |
| Expansion | Outside the member's usual pattern but plausibly life-expanding; explicitly marked exploration. | A software engineer who said "I miss making things with my hands" invited to a ceramics session. |


## 33.5 Candidate retrieval
- Hard filters in SQL first: member active and in a state that allows this category; city or presence overlap during the opportunity window; not blocked either way; no active safety hold; not over interruption or contribution budget; not asked about something similar recently (cooldowns per pair and per category); romance only between adult mutual opt-ins with mutual stated preferences; no member under 18 in any multi-person opportunity, in any role (including as an intermediary or warm path); high-risk categories excluded. Every filter uses the same ID space (member_id UUID) everywhere.
- Retrieval channels (union, then dedupe): vector kNN on intent-to-facet and intent-to-intent embeddings (top 50 per channel); tag and category matches; graph neighbors within two hops via recursive SQL over edges; event-interest matches; availability overlap and travel-time limits (H3 neighborhoods first, maps API for finalists).
- Exposure floor: each run reserves part of the candidate pool for members with few recent proposals or little data, so they are not starved by stronger profiles.
## 33.6 Scoring
Scores are computed per candidate opportunity configuration (a pair or a group), as components that are logged separately.
- Fit components: intent satisfaction (how well the configuration satisfies each participant's intent), mutual benefit (every participant gets something, not only the initiator), semantic similarity where relevant, availability fit, travel cost, format fit (group vs one-to-one, spontaneous vs planned), warm-path bonus, novelty/expansion value.
- Cost and risk components: activation cost (lead time, duration, distance), interruption cost (budget used), load (recent giving, recent asks), repetition (same people, same cluster), social risk (format and familiarity), safety risk class.
- Confidence: evidence quality (said vs inferred, freshness, confirmation), retrieval agreement across channels, judge certainty.
- LLM judgment: for the top configurations only, a structured judge prompt receives scrubbed, scope-limited profiles and returns per-dimension scores (fit, mutual value, capacity realism, timing, social comfort, red flags) with calibration anchors, minimum floors, a separate dealbreaker flag, and a short shareable "why" per participant. A cheap model pre-screens; a strong model judges finalists. Judge outputs are cached by participant profile revisions and expire (no permanent zeros).
- Combination: v1 uses a transparent weighted sum with hard floors, tuned in the simulated world and against reviewer labels: NetValue = Fit + MutualBenefit + WarmPath + Novelty + TimingFit - ActivationCost - InterruptionCost - Load - Repetition - SocialRisk, multiplied by Confidence, with any floor violation or dealbreaker setting the proposal to ineligible. The LLM judge is one input, not the whole score: reliability, safety, and load components always apply.
## 33.7 Group composition
- Start from an anchor (event, activity, intent) and a target size and role set (for example host plus 3-5 guests).
- Beam search over candidates maximizing: average pairwise compatibility, minimum pairwise floor (no one is a bad fit with everyone), role coverage, one to two existing warm ties (not a closed clique), diversity of clusters (bridge value), and availability intersection.
- Produce a primary group and a ranked list of alternates for quorum backfill.
- LLM judge reviews the top two or three group configurations for social dynamics (dominance risk, awkward combinations) with scrubbed inputs.
## 33.8 Policy, load balancing, fairness, and exploration
- Load balancing: penalize members who have given or been asked often recently; per-category quotas set by the member; prefer developing new helpers when fit is sufficient.
- Fairness monitoring: track proposals, acceptances, and completions per member and per cohort (newcomers, cities, neighborhoods, inviter cluster); exposure floors in retrieval; weekly concentration report in admin (share of opportunities going to the top 10% of members).
- Exploration: 10-15% of proposals per member may be exploration picks (novel category or person outside their usual cluster), marked internally and measured separately; tunable per member ("surprise me" increases it).
- Anti-caste rule: no single composite internal score of members exists; components are contextual and decay.
## 33.9 Decision, review, and dispatch
- The engine converts top configurations into proposals with: participants and roles, opportunity draft (objective, format, time window, place area, effort), score components and confidence, shareable explanation per participant, suggested message briefs, alternates, and expiry.
- Proposals above the category threshold go to the review queue (MVP: all proactive proposals); below threshold they are discarded or kept as low-priority possibilities visible on request.
- Reviewer actions (approve, edit, swap, re-roll, reject with reasons) are recorded; re-roll reruns composition with the reviewer note as a constraint.
- Approved proposals move to INVITING and are handed to outreach control.
## 33.10 Empty states
If no proposal for a member's intent clears the bar for a set period (default 10 days), the engine emits a "nothing yet" item so the agent can run flow F21, and logs which constraint or density gap blocked it, so the team can see where the network is thin.
## 33.11 Learning plan
- MVP: hand-tuned weights; reviewer labels and outcomes collected as structured data; weekly offline evaluation of precision (approved and accepted) by generator and category.
- Post-MVP: learning-to-rank on reviewer decisions and outcomes; calibrated confidence; learned joint embeddings (a JEPA-like model trained to predict good outcomes from member representations) replacing generic text embeddings; graph features (bridges, cluster health); a Network-tuned Eliza model trained on consented, scrubbed trajectories.
## 33.12 Engine requirements

| ID | Requirement |
|---|---|
| ME-001 | Every proposal satisfies all hard constraints; a test suite asserts this on every simulated run. |
| ME-002 | No member receives more proactive proposals than their budget allows in any window. |
| ME-003 | Explanations contain only shareable facts; privacy canaries never appear in any output. |
| ME-004 | A matching run is reproducible from its logged inputs, configuration, model versions, and random seed. |
| ME-005 | Completed or positive past interactions never block future matching for either member. |
| ME-006 | Blocks, cooldowns, and negative-feedback rules are enforced in one ID space and remain effective after feedback is processed. |
| ME-007 | Profile updates never erase engine-learned state (reliability evidence, feedback summaries, edges). |
| ME-008 | Judge score caches expire on profile revision or time; no cached verdict is permanent. |
| ME-009 | Configured thresholds are applied and covered by tests; the benchmark runs through the production code path. |
| ME-010 | Matcher ticks are mutually exclusive per city and idempotent; a crashed tick leaves no partial proposals. |
| ME-011 | The engine handles members in multiple cities and time-bounded presence. |
| ME-012 | Exposure-concentration and fairness metrics are produced for every nightly run. |


# 34. Validation: simulations only
Status (2026-10-08): simulations only. The founder decided that the only tests the repository keeps are simulations, so the unit, contract, property, golden and end-to-end test files were deleted (docs/CLEANUP-REPORT.md). The Network is a social system, so most failures are not crashes: a bad introduction, a message at the wrong time, a leaked detail, a group that never forms. Simulated worlds catch those, and shadow mode on real data (34.6) checks the engine before members see it. The world simulator design in 34.3-34.5 still describes what the simulations do.
## 34.1 bun run sim
bun run sim (scripts/sim.ts) is the single validation command. It clears the provider keys, needs no Postgres, runs in CI on every push, and exits 1 on any blocking gate failure. Tracked gates are printed and never fail. Flags: --only <block>, --quick (fewer seeds; quality gates become tracked), --json <file>, and --nightly (adds the capital block).

| Block | Pinned run | Blocking gates | Tracked (never fail) |
|---|---|---|---|
| evals | The corpora in evals/ | Every corpus gate (24): replies, opt-out, the leak guard, the MCP output leak gate | None |
| network | Invariants on seed 3 for 10 days; consent against push on seeds 1-3 for 21 days; every NYC scenario | 61, including networkPack conformance and the attention and plans invariants | Run fingerprints |
| slop | Seeds 13-16, 4 weeks, 300 per city; photo in the probe and the rater on | 0 declared-minor contacts, 0 stated-filter violations, scammer median reach at most 1, 0 leaks and no rating text, the quality gates that pass on the pinned seeds, slop conformance | Dates per member-month at least 0.9x random (0.82), age-liar contact cut at least 90% (82%), adversary-contact cut at least 90% (47%), smallest gender or orientation group at least 0.7x (0.33), harm-event cut at least 90% (87%) |
| peon | Seeds 13-16, 8 weeks | The official gate set (10), sealed-attribute invariance, the four-fifths negative control, conformance | Run fingerprint |
| friends | Seeds 5-8, 8 weeks | The official gate set (8), harness caps, conformance (no romance, no minors in plans) | Undetected-adversary harm (1.67x against 0.5x), run fingerprint |


On 2026-10-08 the full run passed 152 of 152 blocking gates, with 7 tracked gates off target. Conformance (scripts/sim/conformance.ts) runs the core rules for every pack on its own worlds: minors in no role, blocks win, consent before reveal, the member-facing leak gate, and the judge cannot undo a hard filter.

## 34.2 Evals, the security suite and what is still missing
- Corpora are evals: the replies, opt-out and leak-guard rows that used to be unit tests live in evals/ and run as the evals block.
- The security suite (bun run security: database, API security, OAuth and backend tests; six files; needs Postgres) runs as a non-blocking CI job. Keeping or deleting it is an open founder decision (27).
- Still missing before the slop.date pilot (docs/mvp-gaps.md section 4): a world that runs the real message pipeline end to end (signed Blooio webhook in, the Blooio adapter out with a fake provider, the persisted queue, Postgres, the simulated clock) for 30 simulated days; LLM persona agents sending free text through the platform, where a no read as a yes must be 0; adversarial scenarios against the live agent (scammer in relay, harasser after the reveal, age liar, catfish, prompt injection for a number or a rating, ban evader, bot farm) with 0 rating or contact leaks and scammer reach at most 1; the real photo rater interface with a fake Workers AI; and a two-app persona through the real routing.
- The live pilot gates and rollback triggers are in 37.3.

## 34.3 The Network World Simulator
A simulated city of persona agents that use The Network exactly as real members would: they send and receive real messages through the same webhook ingress and outbound send paths (using a simulated channel adapter, or real test phone numbers in a staging smoke run), and they live their lives in simulated time.
- Persona generator. Produces diverse members with ground truth the system cannot see: demographics, home and work areas, a weekly routine, true interests and skills, hidden desires, what they say yes and no to, boundaries, romance opt-in and preferences, social energy, responsiveness (reply latency distribution, chance of ignoring messages), verbosity and writing style, flakiness, honesty (some exaggerate or misreport), and relationships with other personas (friends, coworkers, exes). Includes realistic proportions of busy parents, newcomers, connectors, introverts, very active people, and people who never reply.
- Adversarial personas. Spammers who try to mass-recruit, scammers, harassers, people who lie about age, people who try to extract others' contact details or private facts, people who abuse blocks and negative feedback, and prompt-injection attempts.
- Persona agents. Each persona is an LLM agent (a different model family from the Network agent, so the system is not graded by itself) with its persona card, memory of its conversations, and a decision policy for each incoming message: reply, ignore, accept, decline, counter-propose, flake, give feedback. Decisions are driven by the hidden ground truth plus calibrated randomness, so outcomes are realistic and measurable.
- Outcome model. When simulated people meet, the simulator decides whether they actually show up (flakiness, distance, weather-like noise) and how the meeting went, based on hidden compatibility, then has each persona give feedback in its own words. This gives ground truth to score the engine against: did the Network introduce people who truly fit?
- World events. A synthetic event calendar per city (and optionally real ingested events), venues, and occasional shocks (rainy weekend, holiday, a popular member goes quiet, a burst of new invites).
- Virtual time. The SimClock drives all Network code. Modes: real time (for demos and staging smoke tests); accelerated (for example, one simulated day per minute, with LLM calls batched and parallelized); and discrete-event (jump directly to the next due job or persona action, the fastest mode for long runs). Persona agents act at simulated times drawn from their routines and reply latencies.
- Scenario scripts. Seed specific situations on top of the background world: "two people who should start a band join a week apart," "a dinner of six where one flakes the morning of," "a member discloses something private and the engine must not leak it," "a member stops replying," "a member travels from NYC to SF for a week."
- Determinism and replay. Each run has a seed, configuration, and model versions; all messages, decisions, and engine logs are stored, so a run can be replayed, diffed, and inspected in the admin console as if it were real.
- Scale targets. 300 personas over 60 simulated days for nightly regression; 2,000 personas over 30 simulated days for load and fairness studies.
## 34.4 What the simulator measures
- Matching quality against hidden ground truth: precision of proposals (truly compatible), recall (how many good latent opportunities were found), and per-generator quality.
- Member experience: messages per member per week, worthwhile-message rate as judged by personas, time to first value, share of members who got nothing.
- Flow integrity: invariant violations, stuck states, expired items, duplicate sends.
- Privacy: canary leaks (target zero), indirect inference leaks found by an LLM auditor.
- Fairness: concentration of opportunities, exposure for newcomers and quiet members, cluster bridging.
- Reliability handling: flake rates and recovery (replacements found, rescheduled, cancelled gracefully).
- Cost and latency: LLM tokens and cost per member per week, job latency, send latency.
## 34.5 Judges and rubrics
- Deterministic rules first (length, one question at a time, no contact details, opt-out language present, no banned phrases).
- LLM judges with written rubrics for tone, clarity, explanation quality, appropriateness of timing, and privacy; judges use a different model family than the agent (during prototyping: OpenAI gpt-6-luna for judges; Cerebras qwen-3.8-27b for the engine, agent, and simulated personas); judge agreement is spot-checked by humans weekly.
- Reports in JSONL and an admin dashboard; CI runs bun run sim on every push; --quick is the fast subset and --nightly adds the capital block.
## 34.6 Shadow mode and pilot evaluation
Before proactive matching is switched on in a city, the engine runs in shadow mode on real seed data for at least two weeks. Reviewers label proposals as if they were to be sent; this sets the precision baseline required by Section 20.3. During the pilot, a share of review decisions is double-reviewed to measure reviewer agreement. Shadow proposals appear in the console review queue with a 'shadow' tag and are never sent. The Observatory's 'Run engine (shadow)' builds the snapshot from the read replica and writes nothing.
# 35. Admin console, backend tools, and data analysis
The team must be able to see everything happening in the Network, from any member's point of view, and understand why the system did what it did. These tools are MVP scope, not polish. They are also how reviewers do their jobs and how the simulator is inspected. The console serves every app (Section 40.3): an app switcher, roles per app and a reason-gated, audited cross-app person view.
## 35.1 Principles
- Staff sign in with SSO and a second factor; there are no shared accounts. The API and the live-update channel reject requests without a staff session and check Host and Origin. Role-based access (admin, reviewer, safety, analyst, engineer, cross_app_safety; per app or for all apps, 40.3), checked on the server. PII-scrubbed views by default. Message text that may hold a private disclosure is hidden until revealed. A PII reveal is per member, needs a written reason, lasts 15 minutes, and is only for admin and safety roles. Every reveal and every staff read of member data is written to the audit log. The console never writes to the database directly; staff actions go through the Network admin API.
- Every object links to every related object: member to opportunities to threads to messages to matching runs to review decisions.
- The same console works on production and on simulated worlds (with a clear environment banner).
## 35.2 Console modules

| Module | What it shows and does |
|---|---|
| Home / health | Live counts (members by state and city, opportunities by state, messages today), alerts (matcher heartbeat, job backlog, send failures, stuck states, invariant violations, safety cases), review queue depth and SLA. Also: review SLA misses, daily LLM spend against the cost alert, and the safety counters that must stay 0 (canary leaks, minor contacts, invariant violations). |
| Review queue | Proposal cards with participants (scrubbed), score components, confidence, explanation per participant, draft messages, alternates, and history between these people. Actions: approve, edit, swap, re-roll with note, reject with reason. Keyboard-driven for speed. Reviewer metrics: throughput, agreement, time per item. Reviewers and admins can also create a proposal manually; it passes the same policy filters, leak check and outreach control, and is tagged as human-composed so it can be compared with engine proposals (21.4). Shows the origin (engine, member request, plans, second encounter, newcomer welcome), the probe text and the reveal text each member will get, and an SLA countdown. A proposal that misses its SLA expires. Eligibility is re-checked on approve. |
| Member 360 | Profile facets with provenance, confidence, scope, and history; intents; presence and routine; preferences and budgets; edges; invitation lineage (who vouched, with what); opportunities and outcomes; reliability evidence (context-level); safety history; connected sources; audit of staff access. |
| Member perspective timeline | The whole experience exactly as a member lived it: every message they sent and received on every channel, in order, interleaved with what the system did behind the scenes at each moment (proposals considered for them, why they were or were not contacted, review decisions, budget state). Supports "replay this week" for both real members and simulated personas. Also: probes and their answers, skipped engine proposals and why, the leak-check result per outbound message, quiet-hours and budget deferrals, and trust changes. |
| Conversation explorer | Search all conversations and relay threads by member, opportunity, keyword, date, channel, sentiment, or safety flag; view the agent's trajectory for any turn (context, actions, tool calls, model, latency, cost). |
| Social graph explorer | Interactive graph per city: nodes are members (sized by activity, colored by cohort, neighborhood, or state), edges by type (invited, met, helped, would-meet-again, blocked) and recency. Filters by time, edge type, cluster, neighborhood. Highlights isolated members, bridges, dense cliques, overused connectors, and invite trees. Time slider to watch the graph grow. Click any edge to see the interactions behind it. |
| Opportunity pipeline | Kanban and table of opportunities by state, generator, category, and city; ageing; drop-off funnel (proposed, reviewed, invited, accepted, scheduled, completed, positive); drill into any opportunity's full event history. |
| Matching run inspector | For each run: inputs, candidate counts after each filter, retrieval channel contributions, score component distributions, judge outputs, chosen proposals, and why top alternatives lost. Diff two runs or two engine versions on the same snapshot. |
| Requests and demand | Open intents by category and city, time open, match attempts, why unmatched (which constraint or density gap), supply vs demand per category, suggested growth asks. Member requests (people and plans) with outcome (probing, fulfilled, still looking), retries, and why unfulfilled. |
| Metrics dashboards | North-star scorecard (Section 21): worthwhile-interruption rate, opt-in, completion, repeat edges, direct continuation, time to first value, attention burden, contribution concentration, bridge rate, life-expansion rate; plus cohort retention, invite activation, flake and replacement rates, review precision, LLM cost per member. Segment by city, cohort, generator, and exploration vs exploitation. |
| Fairness and network health | Exposure distribution (Lorenz curve, top-10% share), newcomer exposure, members who got nothing in 14/30 days, cluster dominance, helper load. |
| Safety console | Reports and cases, evidence, holds, decisions, appeals, repeat-target and repeat-offender views, block patterns, moderation holds on relay messages. Also: members on watch and hold with the events that caused it; hold and lift actions; an urgent-first queue with the 36.3 response targets; a minor-safety view (members aged 13-17, none in a multi-person opportunity). |
| Events | Monthly gatherings per city: invite lists, RSVPs, attendance, suggested groupings, follow-up outcomes. |
| Simulation lab | Configure and launch world runs (persona mix, size, duration, time mode, seed, engine version), watch progress, compare runs, open any simulated member in the perspective timeline, view judge and canary results. It is the same app as the production console (the Observatory's game mode), with a SIMULATION banner. Scenario levels, the truth lens and persona takeover exist only here. A simulated reviewer is allowed only here. |
| Data and notebooks | Saved SQL queries, CSV/Parquet export of scrubbed data, links to notebooks (DuckDB over the nightly export) for ad hoc analysis. |
| Configuration | Engine weights and thresholds, budgets, quiet hours defaults, category settings, feature flags per city, with change history and who changed what. |
| Audit log | Every admin action, data reveal, configuration change, and override. |
| Growth | Invites per member, invite trees, invitee activation compared with seed members, growth asks sent, inviters who lost invites after an invitee went on hold. |


## 35.3 Implementation notes
- The first implementation is the Observatory (packages/observatory): a Bun server with a React UI, one view model for simulated worlds and the real database, and a Canvas force graph. For production it runs behind SSO, reads a read replica through the read-only login network_observatory, and sends staff actions to /api/network/admin routes with role checks. Moving it into the eliza.app admin area is decided after the pilot.
- Analytics queries run against a read replica or the nightly Parquet export, not the primary.
- The perspective timeline is assembled from the event log, outbound and inbound message logs, agent trajectories, and matching-run logs, keyed by member and time.
# 36. Launch requirements we were missing
## 36.1 Messaging compliance and deliverability
- US SMS requires A2P 10DLC brand and campaign registration or toll-free verification; budget several weeks. (Registration is in the deferred compliance backlog, Section 40.7; not a launch gate for now.) Record consent wording at invite acceptance; honor STOP/HELP/START; no proactive messages without consent; quiet hours in the recipient's time zone.
- iMessage via Blooio: confirm per-number throughput, group messaging support, and reliability for proactive sends; keep SMS as fallback.
- Number strategy: dedicated Network numbers (per city or one national), memorable sender identity, contact card (vCard) sent at onboarding so members save the Network as a contact. Prototyping uses the existing Blooio line +1 (808) 788-1821; dedicated per-city lines follow. (Superseded by Section 40.3: one Blooio line serves every app, with keyword routing on the first message.)
- Voice: two-party recording consent (California) announced at the start of any recorded call.
## 36.2 Legal and policy
- Terms of service, privacy policy, community guidelines, and a short "how the Network uses what you tell it" explainer written in plain language.
- Minimum age 13 (COPPA); members 13-17 are single-player only (personal agent: chat, events, things to do) and are never matched or connected; parental-consent and state-law review before launch (superseded by Section 40.7: a deferred backlog item, not a launch gate); meetups in public places by default for first meetings; liability language for in-person meetings.
- Data rights: export and deletion (CCPA/CPRA in California; New York SHIELD Act security requirements), data retention schedule, breach response plan.
- Respect terms of service of event sources and profile sources used for enrichment.
## 36.3 Trust and safety operations
- Safety runbook: emergencies (direct to 911 first), harassment, stalking, scams, impersonation, minors; escalation contacts; evidence preservation; appeals.
- On-call rotation for safety reports during pilot hours; response targets (urgent within 1 hour, others within 24 hours). Outside covered hours, urgent reports get an immediate automated reply directing the member to emergency services, plus an automatic safety hold on the reported member's opportunities until reviewed.
## 36.4 Cost model and budgets
- Per-member monthly cost drivers: agent turns (LLM tokens), extraction and enrichment, matching judge calls, SMS and iMessage fees, voice minutes, embeddings, infrastructure. Target an all-in cost per active member per month that the team tracks weekly in the admin console; set alerts on per-member and per-day spend. Use cheaper models for pre-screening and extraction and stronger models only for final judgments and member-facing phrasing. Measured LLM cost (2026-10-07, gpt-6-luna on Surplus): about $3 a month for 300 members sending 5 messages a day each, at the billed rate (9-21% of list, from prompt caching and Surplus pricing). At list price ($0.10 per million input tokens, $0.50 per million output tokens, the same on Surplus and OpenAI) with no caching, it is about $27 a month including the outbound leak check. Set a numeric target cost per active member per month and a monthly pilot budget per city before M6, including monthly gathering costs (venue, food) and how they are covered in the MVP (team-funded or members self-pay).
## 36.5 Seed and density plan
- New York City: a founding seed of 40-75 members recruited through the founders' and early members' vouches, deliberately spanning several clusters (not one industry), concentrated in a few adjacent neighborhoods (for example, Lower Manhattan and north Brooklyn; the final choice depends on where the seed lives). San Francisco follows only after the expansion gates (25.6).
- First monthly gathering in each city within two weeks of opening.
- Invitation allowances tuned weekly to grow density without diluting quality.
## 36.6 Agent persona and voice
- Name, tone guide, and a library of example messages for every flow, per app persona (Section 40.3); tested as style rules (Section 34.5). The agent never pretends to be human; it is clear about when it is relaying another member's words.
## 36.7 Reviewer operations
- Rubric and training for reviewers (including contractors), calibration sessions, double-review sampling, privacy training, confidentiality agreements, and least-privilege access to scrubbed data.
## 36.8 Accessibility and inclusivity
- Plain-language messages, voice option, no dependence on the app, support for members who use assistive technologies on the web pages, and inclusive defaults (no assumptions about gender, relationships, or income).
## 36.9 Data, backup, and recovery
- Network schema included in existing Postgres backups with point-in-time recovery; tested restore; nightly export to R2; disaster-recovery runbook.
## 36.10 Repository and ownership
- Decided (2026-10-07): Network code lives in the thenetwork repository, including the Network plugin (packages/plugin-network). Eliza is included as a git submodule until its packages are published. Eliza Cloud keeps only the integration glue: identity scoping, the invite gate, STOP/HELP, the Twilio path, capability flags, network migrations, the Postgres store and per-turn wiring. Name an owner for each subsystem in Section 32. The repository is https://github.com/eliza-research/thenetwork (public since 2026-10-08). The 2026-10-08 cleanup deleted the prototypes and the unit and e2e tests; only simulations remain (34). The product domain is ntwrk.love (the home page for every app, Section 40; ntwrk.club belongs to someone else); the assistant connector is served at https://mcp.ntwrk.love/mcp.
# 37. MVP build plan and milestones
Indicative sequence assuming a small team (2-3 engineers, 1 product/community lead, part-time design, contract reviewers). Each milestone ends with simulated-world tests passing for the flows it delivers. The milestone table is the v0.2 plan, kept as history. The multi-app phases after it (2026-10-08, Section 40) and the critical path, prototypes and gates in 37.1-37.3 are current.

| Milestone | Weeks | Deliverables | Exit criteria |
|---|---|---|---|
| M0. Foundations | 1-2 | Repository and package layout; network schema v1 and migrations; Clock abstraction and job table; event log; the Observatory with staff sign-in, roles and the audit log; staging environment. | Schema migrated on staging; job runner and SimClock pass tests. |
| M1. Member conversation | 2-5 | Network character and plugin; invite, vouch, acceptance, onboarding (SMS/iMessage, optional voice); extraction; profile web pages; states and preferences; STOP/block/report; concierge search with event ingestion for New York City. Also: export and delete (F24); phone change and channel linking (F25); safety queue intake (F23). | Seed members can be onboarded end to end on staging; scenario suite green. |
| M2. Simulator v1 | 3-6 (parallel) | Persona generator, persona agents, simulated channel adapter, SimClock-driven world runner, judges, canaries, run storage, simulation lab (the Observatory's game mode). | 100 personas run 14 simulated days through onboarding and concierge flows. |
| M3. Engine v1 and review | 5-9 | Generators, retrieval, scoring, judge, group composer, load and fairness controls, proposals, review queue in the Observatory (with SLA expiry, a review stage in the Network before any probe, and a simulator invariant 'no probe without approval'), matching run inspector. Also: outreach controller (budgets, quiet hours, two-unanswered rule); outbound leak checker and PII scrubber; empty-state items (F21). | Engine passes ME-001 to ME-012 in simulation; precision against ground truth above target. |
| M4. Coordination | 7-11 | Consent workflow, relay, contact swap, scheduling, reminders, check-ins, flakes and replacement, feedback, second encounters, monthly events. | Full lifecycle flows F11-F29 pass for 300 personas over 60 simulated days with zero invariant violations and zero canary leaks. |
| M5. Admin and analytics complete | 8-12 | Member 360, perspective timeline, conversation explorer, graph explorer, pipeline, metrics, fairness, safety console. | Team can answer "what happened to member X this month and why" in under two minutes. |
| M6. Private pilot | 12-14 | Onboard the NYC seed cohort; concierge only plus shadow-mode engine; first monthly gatherings. (Superseded by Phases 1-2 below and Section 40: the first pilot is slop.date.) | Launch gates in 28.5 met; shadow precision baseline established. |
| M7. Proactive matching on | 14+ | Reviewed proactive proposals in NYC; weekly metric reviews; tuning. | MVP success criteria in 28.2 tracked weekly; decide on fast follows (Telegram/WhatsApp, connector, app features). |


Current plan (2026-10-08, multi-app; Section 40). Two workstreams: engine and packs, and platform. The milestones above still describe the work inside each phase; M6 and M7 are superseded by Phases 1-2 for the first pilot.

| Phase | Scope | Owner | Exit criteria |
|---|---|---|---|
| Phase 0. App packs core | AppPack interface; open core types; networkPack as a facade, then threaded through the engine one module at a time; geo seam; one conformance suite for every pack. | Engine and packs | Golden replays (engine, attention, plans, capital, judge, network) byte-identical under networkPack on a pinned clean commit; conformance suite green for networkPack. |
| Phase 1. slop.date pack, sim and local pilot readiness | slopPack: mutual hard filters, radius geo, reciprocal scoring with congestion and exposure caps, probe first then a booked first date, dating judge rubric, safety basics (40.5); dater personas, oracle, adversaries and scenarios. | Engine and packs | Conformance green; slop.date sim gates (40.8) pass over several seeds; end to end on local Postgres with test phones and dry-run sends; reviewers trained; shadow mode with human review of every intro. |
| Phase 2. Platform backend (in parallel) | Migration runner; platform schema (people, phone identities, memberships, consent events, share grants, blocks, staff roles, audit); app id on engine tables; one line with keyword routing and no-keyword enrollment; phone login; per-app personas; admin app switcher and per-app roles. | Platform | A test phone joins two apps by keyword and one through no-keyword enrollment; STOP and leaving one app work; export and delete per app; the ntwrk 21-day sim gives the same results after migration; cross_app_leak = 0. |
| Phase 3. friends.help pack and sim (local) | friendsPack: groups first, quorum, plans and crews, neighborhood geo, affinity tables; personas and oracle. | Engine and packs | Conformance green; friends.help sim gates (40.8); runs locally only. |
| Phase 4. peon.biz pack and sim (local) | peonPack: org and job entities with capacity, two-way retrieval, candidate-first consent, unranked slates, sealed protected attributes, proxy scrubbing; hiring personas and oracle. | Engine and packs | Conformance including protected-attribute invariance; peon.biz sim gates (40.8); runs locally only. |
| Phase 5. Attention, plans and capital across apps | Person-level cap across apps; attention budget, plan allowance and crews per pack; network capital per app or shared (to decide). | Engine and packs, with platform | No send over any per-app or person-level cap in a multi-app sim; the network capital fairness gate (39.2) holds per app. |


Phases 0-4 are built and pass their sim gates in bun run sim (since the cleanup, run fingerprints replace the golden files). slop.date goes live after the critical path in 37.1, two weeks of shadow and the founder's approval of live sends. The peon.biz and friends.help sites are on Pages; their matching and sends go live only by a later founder decision (28.4).
## 37.1 Critical path to the slop.date pilot (2026-10-08)
Owners: E is engine and packs (packages/core, engine, sim, capital); P is platform (packages/network, platform, blooio, mcp, observatory, deploy, sites). Estimates are engineer-days for one agent-assisted engineer. Detail: docs/mvp-gaps.md.

| # | Piece | Owner | Days | Needs | What is missing |
|---|---|---|---|---|---|
| 0 | Founder decisions | Founder | 1 | none | STOP/HELP owner on the shared line; where the conversation runs; join mode for peon and friends; ban evasion; the security suite; Clef weight fitting (27). |
| 1 | Backend deploy, staging then production | P | 2 | 0 | Railway project, Postgres and logins, secrets, api.ntwrk.love DNS, a private staff port, logins per app role. |
| 2 | Migrations on Railway | P | 1 | 1 | A reviewed migration path for a non-local host; backups on and one restore tested. |
| 3 | Blooio in and out on the live line | P | 3 | 1, 2 | Point the webhook at the backend; persist the outbound queue, counters and rate limits; test phones with the live-send approvals. Routing is done. |
| 4 | slop onboarding conversation | P, E | 4 | 3 | Wire the LLM reader for free text and the age hook; read back the profile; ask adults for photos; the same fields from MCP; a dating persona style guide. |
| 5 | Photo upload and Clef rating | P, E | 4 | 2, 4 | Upload on the slop.date settings page and from MMS; pass the Clef rater to the service; fitted weights (prototype P2); a weekly bias monitor job. |
| 6 | Review queue for slop | P | 2 | 1 | slop in the console's pack list; the reviewer of record is the person; a slop rubric; SLA alerts; shadow runs with the slop pack. |
| 7 | Photo probe and relay | E, P | 6 | 3, 5, 6 | The photo in the probe copy and leak guard; relay after a mutual yes with consent per item ("send them my number", photos), the appearance-leak check, a scam check and a relay log. |
| 8 | Feedback, report and ban on the live path | P | 1 | 7 | The relay log for ban notices; a ban check on photo intake. |
| 9 | STOP/HELP live | P | 1 | 3 | One owner; live checks of STOP, STOP ALL, START, HELP and "leave slop.date" on iMessage. |
| 10 | Console deploy | P | 2 | 1, 6 | The Observatory on Railway behind Cloudflare Access; bias-monitor and cost panels. |
| 11 | Monitoring | P | 2 | 1 | Uptime and heartbeat checks; alerts on send failures, SLA misses, invariant violations and urgent safety reports. |
| 12 | Cost alerts | P | 1.5 | 4, 5, 11 | LLM, Workers AI and Blooio spend per day and month, with an alert at 80% of budget (36.4). |
| 12b | Audit findings | P | 4 | none | Check the P0 and slop-relevant P1 findings for network, platform, observatory and sites, and record the result. |
| 13 | Shadow, then live | Founder, reviewers | 14 calendar | 1-12 | At least two weeks of shadow with every proposal reviewed; at least 40 committed NYC adults before matching is switched on. |


Total: about 35 engineer-days plus the two-week shadow. Items 1-3, 6 and 12b run alongside items 4-5 and the engine half of item 7.
## 37.2 Prototypes still needed
Build each small, learn from it, then commit.

| # | Prototype | Question | Pass to commit | Owner, time |
|---|---|---|---|---|
| P1 | Concierge pilot | Do 20-30 NYC adults answer probes, say yes, show up and want a second date, with human-composed probes on the real line and the engine in shadow? | Mutual yes at least 25%, at least 60% of booked dates happen, at least 20% want a second date | Founder and one reviewer, 2-3 weeks |
| P2 | Clef weight fitting | Do Clef ratings plus the decision model predict real mutual interest better than nothing, without group bias? | Held-out AUC above the placeholder; bias monitor at least 0.85x by quintile and group | E, 1 week plus labelling |
| P3 | Blooio deliverability | Per-line throughput, new-conversation limits, receipts, attachments, ban risk on a shared line | A measured daily cap with margin; attachments arrive; no account flag | P, 3 days |
| P4 | Onboarding quality | Can the line fill the slop hard fields from natural text? Rules only against rules plus the LLM reader | At least 80% complete in 24 hours, at most 12 turns, 0 wrong gender or seeking parses | P and E, 1 week |
| P5 | Photo in the probe | Does a photo raise mutual yes and second dates, or cut dates per member? A/B inside P1 | Choose the arm; code and sim agree | E, inside P1 |
| P6 | First-date venues | Are the suggested places good for a first date? Do people want reservations? | At least 80% rated a good place; booking links or partner reservations decided | Founder or ops, 1 week |
| P7 | Relay UX | Is relaying through the agent acceptable? Hand-run relay inside P1 | Relay scope chosen: one-shot number swap or a persistent thread | P, inside P1 |
| P8 | Age-liar signals without ID | Which cheap signals help (language, photo age estimate never stored as a score, reports)? | The age-liar gate is fixed or accepted as a known risk | E, 3 days |


## 37.3 Pilot validation gates
Blocking before any live send: every blocking gate in bun run sim passes (34.1); each tracked slop gate is fixed or waived in writing by the founder; P3 is measured; the STOP/HELP owner is decided; two weeks of shadow with every proposal reviewed and a precision baseline; at least 40 committed NYC adults; a backup restore tested; cost alerts and safety on-call live (28.5).
Weekly during the pilot (40.5, 28.2):

| Metric | Gate | Pause or roll back if |
|---|---|---|
| Mutual yes per probe | At least 25% | Under 15% for 2 weeks |
| Dates held per mutual yes | At least 60% |  |
| Second-date rate | At least 20% |  |
| Time to first date | At most 14 days median |  |
| Worthwhile interruption | At least 70% | Under 50% |
| Mute, STOP or complaint rate | Under 5% | Over 10% |
| Safety reports per 1,000 dates | Tracked; urgent answered within 1 hour | Any harm to a minor; any rating or contact leak |
| Minor contacts | 0 | Any |
| Bias monitor by rating quintile and group | At least 0.85x | Under 0.8x |
| Probes received, top-10% share | At most 20% |  |
| Reviewer minutes per sent proposal | At most 2 |  |
| Cost per active member per month | Within the founder's target | Over budget |
| Blooio delivery failures | Under 2% | An account flag |


# 38. Review decisions and comment resolution log
This section records the decisions made while resolving the October 4-5, 2026 review comments, so the reasoning survives after the comment threads are closed.

| Topic | Decision | Where reflected |
|---|---|---|
| Internal scoring of people | No universal or visible scores. Contextual internal estimates (reliability per commitment type, confidence in skills) on an open, extensible ontology are allowed and needed for quality. | 4, 15.2, 33.8 |
| Human operation early on | Humans review matches and run safety while the network is small; humans set direction, goals, capital allocation, and team; automation handles day-to-day. Contract reviewers (for example, in the Philippines) can staff queues; their decisions are training data. | 23, 32.8, 36.7 |
| Standing intents and outside options | Overt wants are stored as intents and matched asynchronously; capacity checked on both sides. When nobody fits, the agent can suggest outside options (listings, events, public profiles of organizations) labeled as outside the Network. | 12.2, 29 F9 |
| Profiles of non-members | No scraped or third-party profiles; invite-only, high-quality seed; very high conviction before messaging. | 1.2, 13.3, 27 |
| Participation states | Not online status: proactive-contact appetite by category, quiet hours, and "only when I ask"; automatic pause after two unanswered proactive messages. | 7.2, 8.3, 32.9 |
| Interruption threshold | Per member and per category (for example dating yes, work no). | 8.3, 32.9 |
| Opportunity state machine | Added reschedule, replacement, and cancellation transitions. | 22.3, 32.10 |
| Ontology flexibility and travel | Small generic core (members, facets, intents, presence, edges) with time-bounded presence for multi-city members ("if you are in SF this weekend"). | 13.1, 29 F26 |
| Bluetooth/proximity idea | Interesting for festivals and large events; post-MVP. | 10.1, 28.4 |
| Gift mode | Help given freely with no fee. Voluntary donations by members who get value are patronage, separate from gift mode. | B.1, 18 |
| Commons and governance | Not MVP. Earlier direction (superseded by 39.4): open-source non-profit governed by members who choose to pay a governance membership; fees first fund the app and inference, surplus to the Commons; learn from DAO successes and failures. | 19, 27 |
| Business model | Ignored for MVP; focus on growth. Members settle money outside the Network. Later: accounts, balances, splitting, paid services via Stripe with transparent low fees. | 18, 28.4 |
| Tech stack | Eliza backend, shared agent, Eliza Cloud infrastructure, eliza.app web, Capacitor app; no sandbox agents; asynchronous engine over Postgres. | 22, 30, 31 |
| pgvector and learned representations | pgvector for MVP; a learned, JEPA-like joint embedding trained on outcomes is a post-MVP upgrade. (Comment read as "maybe a CLIP- or JEPA-like model here"; please correct if something else was meant.) | 22.1, 33.11 |
| Randomness | Exploration budget of 10-15% with explicit novelty picks. | 14.5, 33.8 |
| Nothing for a user | Honest empty state that asks for more information, suggests concierge options, and asks for vouch-based invites. | 14, 29 F21, 33.10 |
| Commercial mode | Not MVP; MVP opportunities are gift or self-pay. | B.1 |
| No-shows | One forgiven no-show, then held from group and time-sensitive opportunities until a lower-stakes commitment is completed; the flaked-on person is supported. Deposits paid to those affected are a post-MVP experiment. | 15.2, 27 |
| Internal caste risk | Exposure floors, exploration, fairness audits, no composite member score. | 24, 33.8 |
| Cities | Launch SF and NYC together, each with a dense seed and its own activation threshold. (Superseded in part by Section 40: slop.date launches first.) | 25, 27, 36.5 |
| Ads | No targeted ads; an opt-in labeled offers category is a possible later feature. | 18.3 |
| Scheduling and flaking | Scheduling is first-class: calendar connection, proposals, confirmations, reminders, day-of check-ins, replacement without blame. | 2.1, 6.2, 32.12 |
| Frictionless data collection | Progressive, mostly passive, single-player valuable; connected sources; guess-and-confirm. Tokens/XP not in MVP. | 3.2, 9.3, 32.5 |
| Anti-spam | No member cold outreach; rate limits; transparent restrictions with reasons and appeals. | 3.3, 24 |
| Role of the app | Rarely opened; messaging is the main surface; the app is for review, editing, privacy, and later location. | 3.3, 29.3 |
| Connector tools | Collapsed to four opaque tools plus a skill file; the Network handles state and policy. Post-MVP. | 11.2-11.4 |
| AI first, people last | The Network searches services, places, and events before involving people. | 11.3, 12.2 |
| Feedback after interactions | Mandatory lightweight feedback; negative feedback weakens the pair privately; guard against unpleasant people punishing others with blocks; human review early. | 6.4, 32.13, 24 |
| Entry and vouching | Invitations are vouches with relationship strength; grow with people members can vouch for. | 8.1, 32.15 |
| First value | Expanded to career colleagues, interest and hobby partners, friends, romance, and introducers. | 8.2 |
| Onboarding testing | A/B test essential vs annoying questions; phone call optional; in-person testing of all channels. | 9.2, 20.2 |
| Relay | Always through the Network until both agree to swap contacts; persistent threads so people can reconnect later. | 17.3, 32.11 |
| Safety and minors | Minimum age 13; members 13-17 may join as single-player members but are never matched or connected to other people; romance and every multi-person opportunity are adult-only; risk signals in ranking; ID verification later, first for hosts. | 17.4, 27 |
| Location | Collect as precisely as allowed, never share precisely. | 16.1, 22.6 |
| PII | PII scrubbing and pseudonymization for reviewers, logs, analytics, and third-party models. | 22.6, 32.14 |
| Payments processor | Stripe (later). | 22.6 |
| Onboarding approval | Automatic with soft approval; only flagged cases queued. | 8.1, 23.1 |
| Analytics and visualization | Extensive data analysis and visualization tools are MVP. | 35 |
| Monthly events | Monthly all-member gathering per city in MVP. | 25.3, 32.16 |
| Introductions | Encourage members to introduce people; it builds social capital. | 6.1, A.3 |
| Channels | Blooio (iMessage) and Twilio (SMS/voice) first; then Telegram, WhatsApp, Signal; later group chats. | 22.1, 22.4, 28.4 |
| Login and agent verification | All login is by phone number and a text-message code; no passwords, email, or magic links. Agents using the skill or connector verify the member's number by texted code and receive a scoped, revocable agent key, kept for the session in chat assistants or stored locally by agents on a computer. | 9.1, 11.1, 11.5, 22.2, 29.3, 32.1, B.3 |
| Member ownership | Post-MVP: a member-owned protocol and treasury. Tokens are an ownership stake, held virtually against the member's phone and agent with an open claim to self-custody; gasless voting; Umia-style decision markets for treasury decisions. Amounts decided by the founding team at launch; on chain when the time is right. | 1, 18, 19.4, 28.4, 39.4 |
| Founders are members | Everyone, including the founders, is just a member. No founding cohort or special status. Invites are vouches. | 8.1, 39 |
| Network capital | MVP-lite: internal ledger, effort tiers, vouch capacity, and a private "what you've built" view. No visible score, no cash value, no promised conversion. A spendable currency comes later. | 28.3, 28.4, 39.2 |
| MVP opportunity mix | Favor light-touch opportunities: asks, work intros, light help, public-venue groups, plans and crews, events, and information missions. Home hosting, borrowing, rental, marketplace, and group buying come later. | 28.4, 39.3 |
| Three apps on one network (2026-10-08) | Work, friendship and love: peon.biz, friends.help and slop.date, all powered by The Network. One engine with app packs, one database, one admin panel, phone-verified login. Each app has its own onboarding, ontology, landing page and agent persona. A person can join one app or several. | 1, 28, 40.1-40.4 |
| App names and ids (2026-10-08) | peon.biz (peon), friends.help (friends; renamed from buddies.nyc), slop.date (slop). The Network itself (ntwrk) is the umbrella. | 40.2 |
| One iMessage line (2026-10-08) | One Blooio line for every app. The first message is routed by keyword ("join slop.date", "peon", "friends"). With no keyword the person joins The Network; the agent asks what they are looking for and enrolls them in the matching apps. | 27, 31.5, 32.2, 36.1, 40.3 |
| Home page (2026-10-08) | ntwrk.love is the home page for the whole concept. ntwrk.club belongs to someone else. | 36.10, 40.1 |
| Launch order (2026-10-08) | slop.date launches first. The peon.biz and friends.help sites are on Pages, but their matching and sends run locally only for now. | 1.3, 28.1, 28.4, 37, 40.9 |
| Ages across apps (2026-10-08) | Minimum age 13. Members aged 13-17 may join every app but are never matched or connected to anyone. Matching is 18+ everywhere. | 28.3, 40.3 |
| Compliance (2026-10-08) | Not a launch blocker for now. The existing safety guards stay. Legal and compliance items (for example NYC LL144, dating-safety notices, 10DLC) are a deferred backlog, not gates. | 28.5, 36.1, 36.2, 40.7 |
| Cross-app privacy (2026-10-08) | Dating membership and data are never visible to the other apps by default. Only a base profile crosses apps, with consent. Blocks apply across every app. | 40.3 |
| Earlier decisions stay (2026-10-08) | The attention budget (lunchtime learned send times, always probe first, only initial invites count against the cap, booked-plan reveal), plans with a separate plan allowance, crews after one great plan, network capital MVP-lite and post-MVP ownership apply in every app. | 39, 40.4 |
| Photos and attractiveness rating (2026-10-08) | Members upload photos. A private rater (Workers AI "Clef" plus a learned scoring layer) rates face, body, overall and body type for slop.date matching: a soft similarity term plus body-type preference. Scores are never shared, shown, used in member-facing text or logged. Rated only when the lowest stated age is 18+ (no ID check; unknown age fails closed, 40.3); members aged 13-17 and unknown ages are never rated. A weekly bias monitor reports outcome ratios by group. | 40.5 |
| Photos in the probe (2026-10-08) | The first anonymous probe can include a photo (quality over volume). Name and contact stay hidden until both say yes. | 40.5, 40.9 |
| Exchange through the agent (2026-10-08) | After a match, messages, numbers and photos pass only through the agent ("send them my number"), with consent per item. Each side learns only what the agent tells them: the other's first name and what they chose to share. | 40.5 |
| slop.date verification (2026-10-08) | No ID or liveness check for now; phone login is the identity check. Harassment and lying are caught through post-date feedback, then report, then hold or ban by phone and person. "Not single" is not a harm. | 27, 28.4, 40.5 |
| Multi-app platform (2026-10-08) | Approved by the founder. Four apps on one backend: the platform schema, phone login, memberships per app, one service for every network, the four sites and the admin app switcher. Sites on Pages; backend not yet deployed. | 40 |
| Simulations only (2026-10-08) | The only tests kept are simulations: bun run sim, with blocking and tracked gates per block; corpora are evals; the security suite is pending a founder decision. Unit, golden and e2e tests were deleted. | 28.3, 28.5, 34 |
| Agent-first onboarding (2026-10-08) | Sites hand the person a prompt for their own AI, which reads SKILL.md and submits the profile through MCP. MCP onboarding is MVP; the wider connector surface comes later. | 28.3, 28.4 |
| Hosting (2026-10-08) | All four sites on Cloudflare Pages; the shared backend on Railway (api.ntwrk.love), not inside Eliza Cloud. peon.biz and friends.help matching and sends stay local. | 22, 31, 40.1, 40.6 |
| Repository (2026-10-08) | github.com/eliza-research/thenetwork, public. The cleanup deleted the prototypes and tests and promoted packages/blooio. | 36.10 |
| Critical path to the slop.date pilot (2026-10-08) | About 35 engineer-days plus two weeks of shadow: deploy, the live line, the onboarding conversation, photos and Clef, review for slop, the photo probe and relay, monitoring, cost alerts and audit fixes. | 37.1 |
| Remaining prototypes (2026-10-08) | P1 concierge pilot, P2 Clef weight fitting, P3 Blooio deliverability, P4 onboarding quality, P5 photo in the probe, P6 venues, P7 relay UX, P8 age-liar signals. | 37.2 |
| Experience design (2026-10-08) | The 2026-10-07 experience design is now Section 41, reconciled with 40.4. | 41 |


Comments that were agreement or emphasis (for example on contraction, activation energy, silence as a valid state, anti-metrics, examples, and LGTMs) were acknowledged and closed without changes; the text they endorsed is unchanged.
# 39. Growth, network capital, and member ownership
Status (2026-10-07): network capital has an MVP version and a later version; member ownership is post-MVP. Everyone, including the founders, is just a member, with no founding cohort or special status. Invites are vouches.
## 39.1 Framing
The goal is to grow the network: more members, but above all more capability, meaning more people who can help, more skills and knowledge within reach, more recurring groups, more warm paths, more cities, and more trust. Introductions are one way that capability gets used; they are not the product.
The pitch is a network its members build and, after the MVP, own, not "an AI that introduces you to people". Each member's agent puts the network's capital to work for them, and each member grows that capital by taking part.
Capital comes in many forms (Section 5), and they convert into each other more liquidly here than through money: an hour of advice becomes a warm introduction, a vouch becomes a new member who can teach something, and showing up reliably becomes trust that opens better opportunities. Money markets handle these conversions badly; The Network handles them with an agent and a shared ledger.
## 39.2 Network capital
### 39.2.1 What it is and is not
Network capital (NC) is a member's account of what they have put into and taken out of the Network: the internal unit for deciding where to spend the Network's scarce resources (AI effort, reviewer time, invites, proactive reach). It is earned by growing the network and lost through behavior that damages it.
It is not a public score, a rank, or a measure of worth. It never buys access to a specific person or changes how you appear or rank for others. Principles 5 and 6 still apply: money buys capacity, never people, and no single score is shown to others.
### 39.2.2 Earning and losing

| Earn | Lose |
|---|---|
| A vouch that works out: the invitee activates, gets value within 30 days, and has no safety flags | A vouched member removed for serious abuse within 90 days (bounded stake) |
| Showing up to an accepted intro, group, plan, or event; giving feedback | A no-show after confirming, beyond the forgiven one (15.2); ghosting after accepting |
| Helping: answering an ask, giving advice, making an introduction, sharing knowledge, confirmed by the recipient | Confirmed spam, harassment, scams, or policy violations (alongside safety action) |
| Organizing at public venues: starting or leading a recurring crew, plan, or volunteer outing | Gaming: clawback of credit found to be fraudulent |
| Answering the Network's needs list ("we need someone who knows X") |  |
| Reviewing and stewarding (staff, later trained members) |  |


Never earned or lost: declining, being in Quiet, Receiving, or Paused, inactivity, sharing more personal data (rewarding it would pressure privacy), or anything an invitee does short of serious abuse.
### 39.2.3 What NC changes
In the MVP:
- Agent effort. Effort tiers set how much AI is spent on the member (deep judge passes, research depth, how often standing intents are re-searched). Everyone gets a high floor, with diminishing returns at the top.
- Vouch capacity. Invite allowance grows with good vouches and shrinks after bad ones.
- Organizing reach. Members with good history can start crews and plans that reach more people; invitees still opt in and budgets still apply.
- Reviewer context (staff only): helps decide whether to approve a member-initiated request.
NC never gives priority for a specific person, ranking in anyone else's results, visibility to others, romance advantage, or a way around any safety rule, budget, or review.
### 39.2.4 What members see
- MVP: a private, itemized "what you've built" history in the member web and by text ("you've vouched for 3 people who are now active; you organized 2 climbing nights"). No number is shown (20.3: no visible progression until it is shown to improve belonging, not hierarchy).
- Later: a visible balance, if the pilot shows it helps and doesn't hurt.
### 39.2.5 Strengths

| Strength | Why it matters |
|---|---|
| Aligns incentives with growth | Good vouches, showing up, helping, and organizing are rewarded. |
| Makes vouching mean something | An invite puts a bounded stake behind someone, so quality matters more than quantity. |
| Principled basis for AI spend | Spend more AI where it creates more value. |
| Rewards non-monetary contribution | Time, attention, knowledge, and introductions count, and help given in one form can be returned in another. |
| Bridge to ownership | NC history records who built the network, an input the founding team can use for ownership post-MVP (no promised conversion). |


### 39.2.6 Risks and mitigations

| Risk | Mitigation |
|---|---|
| Hidden caste (24): more NC brings more AI, better outcomes, and more NC | High baseline for everyone; diminishing returns; capped top tier; other members' matching never reads NC; audits by NC decile. |
| Conflict with Principle 6 (one number collapses capital) | Itemized ledger with categories; reliability stays contextual and separate; NC never shown to others or used in their ranking. |
| Gaming: vouch rings, staged meetups, help farming | Counterpart confirmation plus a real outcome; diminishing credit per pair and period; anomaly detection; spot checks; clawback. |
| Punishing people for life (illness, caregiving, volatile work) | Free cancellation before a cutoff; one forgiven no-show; declines never cost; Quiet, Receiving, and Paused never decay NC. |
| Vouch liability chills inviting | Bounded stake, lost only for serious confirmed violations within about 90 days. |
| Crowding out kindness; loss of dignity in receiving | No per-act pricing shown; gifts stay gifts (18.1); Receiving and safety support never depend on NC; asking never costs NC. |
| Coercion to say yes | Only follow-through on accepted commitments counts. |
| Legal (security, taxable reward, stored value) | In the MVP, NC is non-transferable, has no cash value, and carries no promise of conversion; securities and tax counsel before any link to tokens. |
| Privacy, inference, and minors | Entries visible only to the member and audited staff; no private facts in entries (17.2); under-18s excluded. |


### 39.2.7 MVP and later

| MVP | Later |
|---|---|
| Internal ledger built from events the MVP already records (vouches, attendance, feedback, help confirmations, organizing) | NC as a spendable currency between members: time-bank style requests, with the helper earning what the requester spends |
| Effort tiers, vouch capacity, and organizing reach driven by NC | Visible balance, categories, and transfers |
| Private "what you've built" view | NC history as one input to ownership allocation (founding team decides) |
| Bounded vouch stake; flake and abuse deductions with grace rules | Commons-funded missions that pay out NC |
| Simulation of NC dynamics, gaming, and inequality before launch |  |


Before launch, the simulated world (34) adds invitees, flaky personas, and gaming adversaries, and measures NC inequality, gaming success and detection time, vouch quality, and penalties on life-driven cancellations. Launch gate: the bottom NC decile's V14 is at least 80% of the top decile's, and no gaming strategy in the scenario library yields more than a small bounded gain.
## 39.3 Lower-lift MVP opportunities vs later
The MVP favors opportunities that need little physical resource, money, or risk and create real value quickly. Anything that needs homes, money custody, goods changing hands, or bulk buying comes later.

| MVP (light touch, high value) | Why | Later |
|---|---|---|
| Ask the Network: answers, advice, member-vetted recommendations | AI first, members second; no logistics | Home hosting |
| Warm intros for work: clients, jobs, collaborators, investors, mentors | The clearest way members make money | Borrowing, lending, rental, and a marketplace |
| Light help: a 15-minute call, resume or pitch feedback, a question answered | High value per unit of attention; bounded | Group purchases and collective buying |
| One-to-one intros and small groups at public venues | The core MVP | Payments, splits, and paid services |
| Plans and recurring crews at public venues (run club, climbing, dinner) | Creates repeat relationships with no hosting burden | Childcare and care swaps |
| Event co-attendance, including volunteer events | Missions with zero resource draw | Partner inventory and unused-capacity deals |
| Vouch invites plus the Network's needs list | Growth with quality | The Commons and funded missions |
| Monthly all-member gathering per city | Already MVP | The ownership protocol |
| Information missions: curate or map something useful ("quiet cafes to work from in the Mission") | Builds shared knowledge |  |


## 39.4 Member ownership (post-MVP)
### 39.4.1 Direction
After the MVP, The Network becomes a protocol whose treasury and governance are owned by its members, founders included. Tokens represent an ownership stake in the protocol and treasury; amounts are decided by the founding team at launch. It goes on chain when the time is right; nothing is on chain in the MVP.
### 39.4.2 Virtual ownership and the open claim
- Virtual ownership by default: each member's stake is held for them, tied to their phone number and Network account. No wallet, seed phrase, or gas.
- Open claim: any member can claim their tokens and self-custody them at any time, subject to eligibility checks.
- Governance from the phone or the agent: members direct their voting power by text or through their agent. The agent acts only on explicit authorization for each decision, or on a standing instruction the member set and can revoke.
- Gasless voting: votes are signed and relayed, so members never pay transaction fees.
### 39.4.3 Decision markets for the treasury
Treasury allocation and major protocol decisions use Umia-style decision markets: participants trade on conditional outcomes ("if this passes, what happens to metric M?"), and the forecast informs or decides the result. Metrics are network-health measures from Section 21 (V14, repeat relationships, capability coverage, safety) plus treasury health. Members take part with their virtual holdings, from their phone or agent.
### 39.4.4 Guardrails
- Belonging stays free. Ownership never buys social priority, matching rank, or access to people (18.1, 18.3).
- Legal first. Securities, tax, money transmission, and consumer protection review per jurisdiction before launch. Ownership and claims are for members 18 and over.
- Identity and security. Phone control is exposed to SIM swaps, so claims and large votes need stronger authentication, cooling-off periods, and recovery.
- Agent authority. The agent votes only within the member's explicit instructions; every agent vote is logged and visible to the member.
- Anti-capture. Caps, delegation limits, and vesting against concentration and vote buying; safeguards against market manipulation.
- Data. Governance never exposes personal or graph data; proposals and markets use aggregate metrics only.
- Relationship to NC. NC history may inform allocation, with no promised conversion rate; MVP NC has no cash value.
### 39.4.5 Sequence
1. MVP: no ownership mechanics; record the NC ledger.
2. After product-market fit: legal structure, token design, and allocation decided by the founding team; build the virtual ownership ledger and gasless voting.
3. Launch governance with decision markets on a small part of the treasury; expand as safeguards prove out.
4. Open claims and self-custody once custody, compliance, and recovery are ready.
## 39.5 Metrics
Added to Section 21.2:
- Network capability created per city: new members who activate, new recurring crews, new skills and knowledge within reach, newly connected clusters.
- Vouch quality: share of vouched members who activate, get value, and have no safety flags within 90 days.
- Member-created opportunities: share of opportunities started by members (asks, crews, member intros, missions) rather than the engine.
- NC fairness: outcome gap between NC deciles, NC Gini, and gaming detection rate and time.
# 40. Work, friendship, love: the multi-app platform
Status (2026-10-08): founder decisions. Where this section differs from an earlier one, this section wins, and the earlier text is marked as superseded or points here. Research: docs/research/2026-10-08-domain-research.md, 2026-10-08-platform-architecture.md and 2026-10-08-engine-generalization.md.
## 40.1 Framing
The Network is the umbrella: one network of people, one engine, one database, one admin panel and one phone-verified login. Three apps are lenses on it, each "powered by The Network": work (peon.biz), friendship (friends.help) and love (slop.date). Each has its own onboarding, ontology, landing page and agent persona, and asks the network a narrower question: who should I work with, who could become a friend, who should I date.
- A person can join one app or several. A second app adds a membership, not a second person.
- The Network itself (app id ntwrk) is the umbrella membership. Someone who joins without naming an app joins The Network, and the agent asks what they are looking for and enrolls them in the matching apps.
- ntwrk.love is the home page for the whole concept. ntwrk.club belongs to someone else.
- slop.date launches first. All four sites are on Cloudflare Pages; peon.biz and friends.help matching and sends run locally only for now, and their join mode is a founder decision (27).
- Everything earlier stays and applies in every app unless this section says otherwise (40.4).
## 40.2 The apps

| Attribute | slop.date (love) | friends.help (friendship) | peon.biz (work) | The Network (umbrella) |
|---|---|---|---|---|
| App id | slop | friends | peon | ntwrk |
| Domain | slop.date | friends.help (renamed from buddies.nyc) | peon.biz | ntwrk.love (home page for all apps) |
| Goal | Two adults who would each say yes meet safely for a first date and want a second. | People keep seeing the same few people: repeat meetups and small crews near home. | Qualified candidates and verified employers reach an interview quickly; hires stick. | The general network of Sections 1-39. |
| Matching style | Reciprocal pairs (harmonic mean or minimum of both directions) with congestion and exposure caps. | Groups first (3-6, least misery plus social-energy balance); activity partners second. | Reciprocal but asymmetric; employers see small unranked slates checked against stated must-haves. | Today's engine, as networkPack. |
| Consent flow | Probe first, then mutual yes, then a booked first date the agent plans. | Activity-first probe, quorum, then names and a group thread; private "see again?" after. | Candidate-first probe; the employer sees only a summary the candidate approved. | Probe first; the reveal is the booked plan. |
| Geo model | One city, several cities, or within X miles of a zip code; distance bands only. | Neighborhoods and transit minutes; the venue minimizes the group's longest trip. | Commute tolerance set by the candidate, remote and hybrid; never ranked by home zip. | City and neighborhood presence (NYC first; SF after the expansion gates). |
| Success metrics | Mutual-yes rate, dates held, second-date rate, time to first date. | Repeat-meetup rate within 30 days, crews formed, V14. | Intro-to-interview, interview-to-offer, hires, 90-day retention. | Sections 21 and 28.2. |
| Launch status | First public launch (pilot). | Site on Pages; matching and sends local only. | Site on Pages; matching and sends local only. | Home page live; no-keyword joins on the shared line. |
| Network id | slop:nyc | friends:nyc | peon:nyc | ntwrk:nyc (later ntwrk:sf) |
| Join mode (default; a setting) | Open | Open (founder to decide, 27) | Open with waitlist copy (founder to decide, 27) | Invite |
| Join age / match age | 13 / 18 | 13 / 18 | 13 / 18 | 13 / 18 |
| Matching today | Off by the stored switch until shadow and the founder's approval | Off; local only | Off; local only | Off until the founder turns it on |


## 40.3 Shared platform
Identity by phone. One person per verified phone number, proven by texting the line or by a web code. Login stays phone plus text-message code everywhere (9.1, 11.5). Age is a person-level fact: the lowest age the person ever stated on any app, failing closed.
Web login. A person types a US number (+1 only) on an app's site and gets a six-digit code by text. The answer to "send me a code" is the same, after the same minimum time, whether or not the number is known. Limits: 3 codes per number per hour, 10 per IP address per hour, 30 seconds between codes to one number, 10 minutes to use a code, 5 wrong tries, one use per code. A bot check (Cloudflare Turnstile) can sit in front of the send step. A session is a random token in a first-party cookie for that app's domain only (HttpOnly and SameSite=Lax; Secure in production), kept 30 days, and replaced at each login and after one day. The server stores only a hash of the token. Phones, IP addresses and codes are stored as keyed hashes where the full value is not needed.
Recycled numbers. A number not seen for 12 months waits for staff review before a new membership attaches to the old person. A carrier lookup (VoIP, landline, recent port or SIM change) is planned, not built.
Memberships. A membership per app (ntwrk, slop, friends, peon), each with its own state, profile, facets, intents, agent memory and member ID. A member ID belongs to one app, so engine data is separated by construction (composite keys, an app argument in every query, row-level security on console roles).
Ages. The minimum age is 13 on every app. Members aged 13-17 may join every app and get the personal agent, but are never matched, probed, introduced, placed in a plan, group or slate, or connected to anyone. Matching is 18+ everywhere.
Cross-app privacy.
- Nothing crosses apps by default. Dating membership and dating data are never visible to the other apps, their agents, their matching or their default admin views.
- Only a base profile (first name, city, age band, optionally interests) crosses apps, and only with explicit consent per direction, logged and revocable. Dating preferences, orientation, safety notes and hiring self-ID data never cross, even with consent.
- Blocks are person to person and apply in every app. A safety removal holds the person everywhere; other apps see only "account restricted".
- No flow reveals that a number belongs to a member of another app.
- New simulator invariant: cross_app_leak = 0 (canaries planted in one app must never reach another).
How the code keeps apps apart. Each app-scoped table has the app id, and keys join on the app, so a row that links two apps is a database error. The engine snapshot for one network reads only that app's rows; person-to-person blocks are the only cross-app input. The admin console reads each app through its own database role, with row-level security. A shared base profile is a grant (first name, city, age band and interests) and copies nothing; the share choice is hidden on the sites until the founders approve its copy. "Delete everything" removes every membership and the phone; a tombstone and a hashed suppression entry stay, so a STOP is never forgotten. The export is per app and holds only that app's data.
One line, keyword routing. One Blooio iMessage line serves every app, with SMS fallback (32.2).
- The first message is routed by keyword: "join slop.date", "slop", "peon", "friends" or an app's domain starts that app's onboarding.
- With no keyword, the person joins The Network: the same onboarding, but the agent asks what they are looking for (friends, dating, work) and enrolls them in the matching app memberships.
- A known person who names another app later gets a new membership after the age rule and a short notice that the apps are kept separate, with an offer to share their base profile.
- Every proactive message names its app, replies attach to the app of the open item, and each app keeps its own agent memory.
- STOP stops every app on the line, because carriers see one sender; "leave slop.date" stops one app.
- STOP, STOP ALL, START and HELP are recorded per app in one consent ledger, with the exact opt-in wording the person agreed to. STOP on the shared line stops every app. "leave <app>" or the site's leave button stops one app and deletes that app's data; other memberships stay. START on the line resumes the app of the line.
- Routing tables per line may stay as data. If an app ever gets its own line, STOP on that line stops that app only, unless a setting (PLATFORM_STOP_SCOPE=global) makes it stop every app.
- A person-level cap: at most 3 proactive messages a day to one person across all apps, checked when a message is sent.
- Live sends per app need the founder's approval for that app (<APP>_LIVE_APPROVED), in addition to the existing live-send approval.
Agent personas. One shared Eliza agent with a persona, copy and STOP/HELP text per app. The host sets the app from routing, never from model output. Today the Network service speaks for every app with these personas (32.3).
Admin panel. One admin panel (Section 35) with an app switcher (ntwrk, slop, friends, peon, all). Every view and action is for one app. Staff roles are per app (reviewer@slop) or for all apps (reviewer@*), so a hiring reviewer never sees dating items. New roles: engineer (simulated worlds only, never real data) and cross_app_safety (the cross-app person view only). Each app has its own review reasons and review deadline: slop adds 'preference mismatch' and 'safety concern' (6 hours); peon adds 'not qualified' and 'role closed' (24 hours); The Network and friends keep the Section 32.8 list (12 hours); the founder is to confirm these (27). The cross-app person view shows memberships, states, holds and blocks, never a phone or a name. Only cross_app_safety and admins of all apps can open it. Each app's panel opens only with a typed reason, and the audit row is written before any data is read. The reviewer of record is the signed-in person. One append-only audit log carries the app on every row.
## 40.4 The engine with app packs
One engine runs every app; each app is a pack the engine loads. The core owns invariants and packs own policy.
Core invariants no pack can loosen (a pack may only tighten them):
- matching 18+ only, unknown age failing closed, minors re-checked in every layer;
- blocks and safety holds win;
- hard filters before scoring, and the LLM judge can only remove candidates;
- the leak guard on every member-facing string;
- consent before any reveal;
- quiet hours, the two-unanswered rule, and human review of proactive matches under ~1,000 members per app;
- determinism (seeded, stable ordering, no clock reads).
Per pack: ontology (entities, roles, lanes, opportunity kinds, typed constraints, never-used attributes), hard filters, generators and retrieval, scoring and selection, consent flow, attention settings and copy, judge rubric and explanations, geo model, plans and capital settings, and a sim pack (personas with hidden truth, oracle, adversaries, scenarios, launch gates).
networkPack is today's engine behind the pack interface, with byte-identical golden replays of engine, attention, plans, capital and judge results.
Conformance suite. Every pack passes one shared suite before it runs anywhere: age, blocks and holds, consent order, leaks with canaries, protected-attribute invariance, determinism, judge cannot undo filters, attention caps and quiet hours, geo (mutual radius, bucketed distances, no coordinates) and cross_app_leak = 0. Each pack must also pass its own simulation launch gates (40.8).
Carried over to every app. The attention budget: rolling sends at a learned send time (default lunchtime, 12:00 local, then learned from replies); always probe first; only initial invites count against the cap (2 per 7 days in Normal); the reveal is the booked plan. Plans with a separate plan allowance (1 initial plan invite per 7 days); crews after one great plan; network capital MVP-lite; post-MVP member ownership (39). A person-level cap of at most 3 proactive messages a day across all apps is built (40.3).
## 40.5 slop.date MVP
Preferences. Stated preferences are hard filters only: gender and seeking, age range, radius or cities, intent and named dealbreakers. Profiles do not predict pair chemistry, so the engine learns from probe answers and post-date feedback, and never markets "compatibility science".
Gender and orientation. Matching gender, an optional identity description and the seeking set are stored separately. Both members must be in each other's seeking set, and selection works for non-bipartite pools. Orientation is asked neutrally, never inferred.
No race filters. No race or ethnicity field, filter or inference. Shared culture, language or faith may be a stated preference, soft unless marked a dealbreaker. Never used: inferred orientation, health status, immigration status, anything from another app.
Photos and attractiveness. Members upload photos. An attractiveness rater (Cloudflare Workers AI "Clef" plus a learned, jevector-style scoring layer) rates face, body, overall and body type. The scores feed matching as a soft similarity term plus body-type preference. They are never shared with anyone: never shown, never in member-facing text, never in logs. Adults only: with no ID check, adult means the person's lowest stated age is 18 or older, and an unknown age is treated as a minor (fail closed, 40.3). Members are rated only when the lowest stated age is 18+; members aged 13-17 and unknown ages are never rated. A weekly bias monitor reports outcome ratios by group.
Scoring. Reciprocal: harmonic mean or minimum of both directions. Congestion caps limit incoming probes per member per week; exposure floors give every adult member probes; the Gini of probes received is tracked. No paid boosts.
Flow. Probe first: an anonymous description (age band, area band, intent, one shareable fact) that can include a photo; name and contact stay hidden until both say yes. On a yes, the other person gets the same. On mutual yes, the agent plans a booked first date: 2-3 time options at a public venue, short by default (about an hour). After a match, members exchange messages, numbers and photos only through the agent ("send them my number"), with consent per item. Each side learns only what the agent tells them: the other's first name and what they chose to share. Probes and scheduling each expire after 24 hours. One first date is scheduled at a time, and no new probe goes out while a mutual yes waits on the member.
Geo. One city, several cities, or within X miles of a zip code (minimum 2; options 5, 10, 25, 50, 100), holding both ways. Zip centroids snap to coarse cells, GPS is never used for matching, and distances appear only as bands ("about 5 miles"). Travel windows expire automatically.
Safety basics.
- No ID or liveness check for now: phone login is the identity check.
- Harassment and lying are caught through post-date feedback, then report, then a hold or ban by phone and person, not by account. "Not single" is not a harm.
- Public venues only; a share-my-date tip (send the plan to a trusted contact); a check-in text after the date.
- A scam classifier on relay messages (money, crypto, gift cards, moving off-platform fast).
- Report and block by text, human triage, and a relay log so past contacts can be told about a ban.
Metrics. Mutual-yes rate, dates held, second-date rate, time to first date; safety reports per 1,000 dates.
Anti-metrics. Messages, swipes, time in app and probes sent; exposure concentration; ghosting after mutual yes, late cancellations and no-shows; unsafe reports. Pausing because they met someone counts as success, not churn.
## 40.6 peon.biz and friends.help: local pilot scope
Both sites are on Cloudflare Pages (2026-10-08), but matching and sends run locally only: local dev database, dry-run or test lines, simulated worlds. Their join mode on production is a founder decision (27).
friends.help.
- Groups of 3-6 at public venues: activity-first probe, quorum, then names and a group thread.
- Optimize for repeat meetups of the same group near home (a friend takes about 90 hours together); crews after one great plan, handed to their own chat after three sessions.
- Opt-in affinity tables (for example women-only), 21+ for alcohol venues, and a "friends, not dates" norm.
- Metrics: repeat-meetup rate, crews formed, V14 by neighborhood. Anti-metrics: one-off meetups, concentration, romantic advances.
peon.biz.
- An intro and logistics service; a human recruiter or hiring manager makes every decision.
- Candidate-first consent, unranked slates of 3-5 with must-have checkmarks, no scores to employers, redacted judge input.
- Pay range on every job, verified employers, current-employer blocking, an employer scam check.
- Protected attributes and proxies (zip, graduation year, gaps, names, photos) never reach matching.
- Metrics: intro-to-interview, interview-to-offer, hires, 90-day retention. Anti-metrics: volume, ghosting, adverse impact.
## 40.7 Deferred compliance backlog
Founder decision (2026-10-08): compliance is not a launch blocker for now. The safety guards stay (age rules, consent, STOP/HELP, quiet hours, leak guard, human review, report and block, bans by person). These items are recorded, not gated. None of this is legal advice.

| Item | App | Note |
|---|---|---|
| NYC Local Law 144 bias audit, public summary and candidate notice | peon | Before automated ranking touches NYC roles; also Illinois HB 3773, California FEHA, Colorado SB 26-189. |
| Employment-agency licensing and hiring record retention | peon | Ask counsel if any placement fee is charged. |
| Dating-safety notices and background-check disclosures (NY, NJ, CO, IL, TX, UT) | slop | Published safety policy and notices. |
| A2P 10DLC registration; dating content (Twilio error 30953) | all | May need a separate brand or entity for slop.date. |
| Apple and Blooio ban risk on the shared line | all | A ban affects every app; stay within per-line limits. |
| TCPA revoke-all rule (January 2027), state quiet hours | all | STOP is already global on one line. |
| Sensitive-data consent (orientation, sex life); zero-retention LLM endpoints | slop | Opt-in logged with exact wording. |
| Romance Scam Prevention Act ban notices | slop | Relay log built now. |
| Members 13-17 on dating and hiring apps | all | Never matched; counsel to review joining itself. |
| Terms, privacy and SMS terms per app | all | ntwrk.love pages are the template. |
| Biometric and sensitive data from photo ratings (IL BIPA, TX CUBI, WA, CCPA) | slop | Notice and written consent before rating; review before scale. Deferred and non-blocking (founder decision). |


## 40.8 Simulation and testing per app
Each pack ships a simulated world (personas with hidden truth, an oracle the engine cannot see, adversaries, scenarios) and blocking gates over several seeds, in memory or in a Postgres schema per world, never in production.
- slop.date. Hidden desirability hierarchy, taste, true versus stated intent, flakiness, body types and a catfish share; the oracle adds large pair-specific chemistry noise. Adversaries: romance scammer, catfish, age liar, harasser, ban evader, bot farm. Blocking gates in bun run sim (pinned seeds 13-16, 4 weeks, photo in the probe and the rater on): 0 declared-minor contacts, 0 stated-filter violations, scammer median reach at most 1, 0 private-field, rating or cross-app leaks, the second-date and fairness gates that pass on the pinned seeds, and slop conformance. Tracked (failing today; each is fixed or waived in writing): dates per member-month at least 0.9x random, age-liar contact cut at least 90%, adversary-contact cut at least 90%, smallest gender or orientation group at least 0.7x, harm-event cut at least 90%. Mutual yes per probe and the probes-received Gini are live pilot gates (37.3); same-face ban evasion is a founder decision (27). Then shadow mode with human review of every intro.
- friends.help. Friendships form when a pair's hours together cross thresholds. Gates: repeat rate at least 30% of groups within 30 days; more friendships than a one-off-dinner baseline; no trip over tolerance; 0 affinity or age violations; V14 at least 85%.
- peon.biz. Latent skills, over-claiming, fake jobs; protected attributes exist only in the simulator. Gates: impact ratios at least 0.8 at every automated stage; 0 protected or proxy mentions in judge reasoning; 0 jobs without pay ranges; 0 unverified employers reaching candidates; 100% of discriminatory requests refused.
- Across apps. cross_app_leak = 0 with two-app personas, and networkPack golden replays byte-identical.
- Admin simulation lab. The lab runs every app on The Network's NYC world with that app's copy and join age; these runs check safety only. The packs are wired, so the lab should run slop and peon with their own packs (docs/mvp-gaps.md, critical path item 6).
## 40.9 Phased plan
Two workstreams, engine and packs, and platform. Section 37 has owners and exit criteria.
- Phase 0: app packs core, networkPack byte-identical, conformance suite.
- Phase 1: slop.date pack, sim world and launch gates, then local pilot readiness.
- Phase 2 (parallel): platform backend (people, memberships, keyword routing, login, admin app switcher).
- Phase 3: friends.help pack and sim, local.
- Phase 4: peon.biz pack and sim, local.
- Phase 5: attention, plans and capital across apps.
slop.date goes live when Phases 0-2 meet their exit criteria and the founder approves live sends. Phases 0-4 are built and pass their sim gates; the critical path, the remaining prototypes and the pilot gates are in 37.1-37.3. Open: the join mode for peon.biz and friends.help, and when The Network's own NYC matching opens (San Francisco only after the expansion gates, 25.6).
# 41. Experience design: attention budget, plans and continuous conversation
Status (2026-10-08): the experience design of 2026-10-07 (docs/design/2026-10-07-experience-design.md), reconciled with Section 40.4. It amends 7.2, 8.2, 9.3, 12.3, 29 (F6, F11, F12, F20, F21, F28), 32.9, 33.3-33.4 and 33.10. Where it differs from 40.4, 40.4 wins: sends go at a learned send time (default 12:00 local), not in a fixed Thursday digest; only initial invites count against the cap; the reveal is the booked plan; plans have their own allowance (1 initial plan invite per 7 days); and crews form after one great plan. For slop.date a probe may include one photo (40.5).
## 41.1 Principles
- The scarce resource is the member's attention. Budget interruptions, not proposals, and measure value delivered, not messages sent.
- The conversation is the product, so onboarding never ends.
- Every existing rule holds: consent, privacy, minors, human review, quiet hours.
## 41.2 Attention budget
An interruption is any message the Network starts that the member did not ask for. The caps are unchanged: Open 4 per 7 days, Normal 2 per 7 days, Quiet 1 per 30 days, Receiving support only, Paused none.
- One interruption can carry a menu of up to three items.
- Pricing: an item's value is its calibrated chance of being worthwhile times the square root of its chance of a yes. The Network sends only if the total value exceeds the member's price of attention times the cost of the message.
- Learned signals can only make the Network quieter; only the member can ask for more.
- No filler. A hold queue keeps up to 10 items per member, each with an expiry, and re-checks them before sending.
## 41.3 Consent-first probes
- The Network asks about the activity before revealing the person: at most one shareable fact, never a name (slop.date may add one photo).
- The member with the live want is asked first. The match is reviewed before the first probe.
## 41.4 Messaging limits
Blooio allows three unanswered messages per conversation and one re-engagement after 14 days. The Network sends an interruption only when at most one message is unanswered, uses the single re-engagement at most once (after 30 or more days, for a high-value item), and keeps new conversations under 20 per line per day.
## 41.5 V14: value every 14 days
V14 is the share of active members (tenure 14 days or more, not paused) who had at least one value event in the last 14 days. Targets: 85% in the simulator and 70% in the pilot. The 28.2 first-value bar becomes V14 at day 14. When a member has nothing, the engine logs why, and the cause sets the remedy:

| Cause | Remedy |
|---|---|
| Too little data | One guess-and-confirm question in the next send; offer a calendar or the member's own AI summary; meanwhile outside-world items from what is known |
| No live want | A re-confirmation item ("still looking for a running group?") or a short want menu; plans need only availability |
| No good one-to-one partner | Switch format before giving up: an event anchor, a theme group, a plan or advice routing; then outside-world; then an honest "nothing yet" with a growth ask |
| Travel or a thin network | Outside-world first; travel intros to members who opted in to visitors; a targeted growth ask for the gap |
| Budget or busy | Add the item to a menu instead of a new interruption; the hold queue; a partner with budget left |


## 41.6 Plans and introduction types
- Plans: availability capture; a planner that builds an activity, a venue and 2-6 free members; least-misery group scoring; anonymous probes with a quorum (normally 3) and a deadline; alternates; the reveal is the booked plan; reminders and fallbacks; recurring crews with a rotating host after one great plan. Members aged 13-17 get solo plans to public, age-appropriate events only. Plans are never framed as romance.
- New introduction types join the engine's generators: plans, recurring crews, hosted dinners at public venues, skill swaps, mentorship, accountability partners, travel, reconnects, introducer-routed intros, advice routing and outside-world suggestions. Each needs a simulator coverage gate before it ships.
## 41.7 The conversation is the product
- Inbound messages are routed in a fixed order; claims are classified for privacy at extraction (sensitive topics, minors and third parties are agent_private).
- An evidence ledger keeps each fact's source, confidence and decay; wants are re-confirmed every 60 days; at most one question per interaction.
- Rollout: the attention budget, menus and hold queue; then plans and simulator availability; then coverage scenarios; then the extraction eval. Offline replay and two weeks of shadow come before live sends, one app at a time (37.1).
# Appendix A. Example experiences and conversations
## A.1 The surprising birthday
Agent -> Member: "I thought of you for something slightly ridiculous. Someone one connection away is turning 30 tonight and their plans fell apart. You are four blocks away, you told me you love singing, and three members are already going. They need someone willing to show up around 9:15 and sing an unnecessarily dramatic Happy Birthday. About 20 minutes unless you want to stay. Interested?"
The value is not the song. The song creates a reason for five people to share a moment without pretending they were algorithmically selected to become friends.
## A.2 The table move that becomes a relationship
Member: "I need to move a heavy table Saturday." Agent first checks whether delivery/moving services would be easier, asks budget and time, and determines that the member actually prefers informal help. It identifies two nearby members who enjoy practical group tasks and one existing warm connection. Only those people are asked. After the move, two participants say they would happily see each other again. Three weeks later the Network notices a food event both would genuinely enjoy and offers the second encounter.
## A.3 Dating without a dating match
A member says they would like to meet someone romantically but dislikes app-style matching. The Network does not assign a date. It creates more relevant social context: dinners, activities, introductions to connectors, and situations where friends can form informed opinions. A member later says, "You would really like my friend Theo." The agent then asks the first member privately whether they are open to the introduction, then independently asks Theo. No one is exposed to an unreciprocated rejection. The Network should actively encourage this: introducing people is one of the main ways members build social capital, and the agent should make it effortless.
## A.4 The extended network
Agent -> Connector: "Slightly random question. You once mentioned your father sails and enjoys teaching. Someone in The Network has wanted to learn for years. I do not need his contact information. Would you be comfortable forwarding a private note to him?" The outside person can decline without entering the Network. If they participate, the link gives only the details needed for that interaction.
## A.5 AI before human attention
Member: "Where can I find an obscure cable near Union Square?" The Network searches stores and availability. It does not notify engineers. Only if the task becomes genuinely experiential - for example, diagnosing a strange hardware problem that search cannot resolve - does it consider asking a technically inclined member who opted into that kind of help.
## A.6 Money as capital transformation
A parent wants to attend a small community dinner but has no childcare and does not want to ask another member to babysit. A Commons microgrant pays a vetted childcare provider for two hours. Financial capital creates time; the dinner creates social capital; the parent later becomes a host in another context. The system records this as a barrier-removal experiment, not as proof that every funded dinner creates durable connection. (Illustrative; not MVP.)
# Appendix B. Core data objects and tool contracts
## B.1 Opportunity pseudo-schema
| Field | Type / notes |
|---|---|
| opportunity_id | UUID |
| origin_type | need, desire, offer, standing_intent, world_event, member_introduction, network_growth, newcomer_welcome, second_encounter, exploration, partner_capacity (post-MVP); plus generator name and exploration flag |
| originator | member/partner/system reference |
| objective | structured text + category |
| required_capital | vector requirements and constraints |
| created_capital_hypothesis | expected vector deltas |
| participants | roles, min/max count |
| place | public/private class, geospatial constraints |
| time | window, duration, recurrence, flexibility |
| privacy_class | agent-private/matchable/shareable/opportunity-specific |
| safety_class | low/medium/high + policy rules |
| commercial_mode | gift / reimbursed / paid / sponsored / partner_inventory. Post-MVP: in the MVP every opportunity is gift (free) or self-pay (each person pays their own way outside the Network). "Gift" means help given freely with no fee. |
| status | state machine |
| completion_condition | explicit |
| matching_explanation_inputs | only shareable reasons |
| follow_up_policy | none / feedback / recurrence candidate |
| schedule | time options, availability evidence, confirmed slot, venue, reschedule history, reminder and check-in plan |
| attendance | per participant: confirmed / attended / cancelled_with_notice / no_show / replaced |
| review | reviewer decision, edits, reason codes, re-roll lineage (MVP: required for proactive opportunities) |
| expiry | per-participant invitation expiry (default 48h; same-day 2-4h, F29) |


## B.2 Relationship edge pseudo-schema
| Field | Notes |
|---|---|
| source_member_id | Directional source |
| target_ref | Member ID or minimal external stub |
| edge_type | invited_by, vouched_for, knows, met, introduced, helped, hosted, enjoyed, would_interact_again, group_only, avoid, etc. Each edge carries evidence (vouch strength, interactions, feedback) |
| explicitness | explicit / inferred |
| confidence | Model/evidence confidence, internal |
| context_tags | work, school, neighborhood, group-only, etc. |
| privacy_scope | Who may know the edge exists |
| last_interaction_at | Recency |
| repeat_preference | Would interact again / group-only / no preference |
| safety_state | normal / blocked / restricted |


## B.3 Connector authorization scopes
Post-MVP. Scopes are attached to the agent key issued by phone verification (11.5). With the five-tool connector (11.2): get_network_updates and ask_network_agent need read.basic; respond_to_network_item needs write.responses; share_profile_with_network needs write.profile; tell_network_agent can reach any write scope only through server-side confirmation, so the member grants scopes once and the Network enforces them per action.
| Scope | Allows |
|---|---|
| network.read.basic | Member-safe summary and already-visible opportunities. |
| network.read.relationships | Limited personal relationship context approved for host-assistant use; never raw full graph. |
| network.write.requests | Draft and submit needs/offers with confirmation. |
| network.write.responses | Accept/decline opportunities. |
| network.write.relay | Send messages inside active interactions. |
| network.write.profile | Update explicit preferences/availability. |
| network.write.invites | Issue invitations with confirmation. |
| network.sensitive.safety | Initiate reports; does not grant access to prior reports. |



## B.4 Platform schema
Platform schema (one per deployment, shared by every app): apps, cities, networks (app and city, matching switch), people (lowest age, tombstone), phone identities (the only place a phone lives), memberships (app, person, member id, state), consent events (phone, app or all, state, source, wording, time), share grants, person blocks, staff roles (role, app), audit (append-only, with the app), app lines, OTP challenges, sessions (hashed), rate limits, suppression (hashed). The engine tables carry the app id on every row. Schema changes are numbered SQL migrations (31.4).
# Appendix C. Validation experiment matrix
Experiments on Commons transport, partner capacity, and the assistant connector are post-MVP (Section 28.4). The others can run during the MVP pilot.
| Experiment | Setup | Success signal | Failure interpretation / next move |
|---|---|---|---|
| Interruption precision | 20 members, max 2 proactive texts/week, human-curated. | High "worth sending" score and low mute rate. | If low, improve matching/explanations before increasing volume. |
| Phone onboarding | Randomly offer voice, SMS, or web. | Comparable first-value rate with acceptable comfort. | If voice feels invasive, shorten and make progressive. |
| Warm vs cold | Comparable opportunities routed via direct vs connector path. | Warm path improves acceptance/comfort without excessive coordination. | If connector burden too high, reserve for high-value cases. |
| AI-first ladder | Track 100 requests; agents attempt search/self-service first. | Most informational tasks resolved without humans; human route scores higher when used. | If agent escalates too much, tighten human-attention policy. |
| Receiving-first cohort | Invite people with a real current need and no required contribution. | Members ask comfortably and later remain engaged voluntarily. | If shame/imbalance appears, redesign cultural framing. |
| Second encounter | After positive first interaction, offer natural second context to subset. | Higher durable-edge formation than control. | If it feels forced, require stronger contextual trigger. |
| Expansion budget | 10-20% of suggestions intentionally outside dominant preference cluster. (MVP engine setting: 10-15%, Section 33.8.) | A meaningful minority rated surprisingly worthwhile without higher annoyance. | Reduce exploration or improve novelty targeting. |
| Contribution cap | Artificially cap asks to top helpers and route to next-best candidates. | Completion remains acceptable while concentration improves. | If completion collapses, invest in capability development. |
| Commons transport | Fund transport only when travel cost is the blocking factor. | Incremental participation and no perceived stigma. | If uptake low, funding method may feel conspicuous. |
| Partner capacity | One venue supplies off-peak inventory; no ranking boost. | Good member fit and partner economics without trust decline. | If quality drops, tighten partner eligibility and recommendation separation. |
| Assistant connector | Small group links Network to existing AI client. | Members successfully invoke Network tools without confusion about identity/permissions. | Simplify scope model and action confirmations. |



# Appendix D. Research and standards notes
These sources support a small number of external facts referenced in the PRD. They do not validate the core product thesis; that requires the experiments above.
[1] U.S. Bureau of Labor Statistics - American Time Use Survey, 2025 results (released June 25, 2026). https://www.bls.gov/news.release/atus.htm
[2] U.S. Department of Health and Human Services / U.S. Surgeon General - Social Connection advisory and framework. https://www.hhs.gov/surgeongeneral/reports-and-publications/connection/index.html
[3] OpenAI - ChatGPT developer mode / MCP apps and developer documentation. https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt
[4] Anthropic - Claude connectors / custom remote MCP documentation. https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities
[5] xAI - Grok custom connectors / Remote MCP tools. https://docs.x.ai/grok/connectors
[6] Platform Cooperativism Consortium - platform cooperative concepts and shared stakeholder ownership. https://platform.coop/
## D.1 Notes on external-assistant integration
The assistant ecosystem is changing quickly. The PRD therefore treats MCP as a current interoperability mechanism rather than a permanent dependency. The Network should keep its own typed API, policy engine, and identity model so any future assistant can be supported through an adapter without giving that assistant ownership of the member relationship or graph.
## D.2 Product thesis still requiring validation
No cited source establishes that engineered synchronicity will increase belonging, expand life surface area, or produce durable relationships. The Network must earn those claims through controlled pilot evidence, qualitative research, and longitudinal member outcomes. The PRD intentionally labels those ideas as hypotheses rather than facts.

# Founding product statement
The Network expands the reachable possibility of a person's life. It understands the latent capacity contained in people, relationships, places, resources, time, attention, culture, and money - and creates the conditions under which that capacity can become real. It is successful when people's lives become larger while demanding less coordination from them. Its economy is successful when money earned by the system helps create more future possibility rather than buying privileged access to people.
The first version should be judged by whether a small group of real people begins to say some version of: "Interesting things happen because I am part of this," "I have people I can turn to," and "I get chances to matter that I would not otherwise have had." Everything else - graph sophistication, model quality, connector breadth, monetization, and expansion - exists to make those statements more reliably true.