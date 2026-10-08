# GTM and cornerstone feature

Status: proposal, 2026-10-07. Builds on PRD Sections 1, 8, 25, 28 and 39 and on `2026-10-07-growth-capital-ownership.md`.

## 0. The short version

- **The problem.** The PRD describes a general network ("not a dating, friendship, work or events product"). That is the right vision and the wrong launch. A general network has no cold start answer: nobody joins an empty "social intelligence layer". Every network in Section 1 below started with one narrow, dense group and one sharp thing to do.
- **Atomic network:** launch **scenes, not cities**. A scene is about 40-60 people who already share a neighborhood and a world, so they can answer each other's needs. Unlock them one at a time, the way Facebook unlocked campuses.
- **Cornerstone feature: "Wanted".** Text the Network what you need. It answers with AI if it can, with a member if one fits, and if nobody fits it asks members "who do you know who could help with this?". The person they vouch for arrives *already needed*.
  - Unmet demand recruits the right supply.
  - The new member's first experience is being wanted, not filling in a profile.
- **Viral artifact: the vouch letter.** It is what the invitee receives: who vouched, the words they used, and the need they were brought in for. People screenshot compliments (Gas, TBH). This one is also true and specific.
- **Density in time: a weekly ritual.** Each scene has a "table" night: small groups of 4-6 at a public venue, composed by the engine (Timeleft's Wednesday, in scene form). It gives the graph edges to work with and members a reason to stay between asks.
- **Status, without a committee.** The boundary is "someone wrote about why you belong", which anyone can understand. Scarcity comes from limited vouches (vouch capacity already driven by NC), not from a waitlist.

## 1. How the networks that worked actually launched

| Network | Atomic network | Boundary / status | Single-player value | What reached non-users | Hard side recruited first |
|---|---|---|---|---|---|
| Facebook (2004) | One campus at a time; next campuses chosen where rivals were weak | Harvard-only, then `.edu`: obvious who's in | Facemash-level curiosity: look up classmates | "Are you on thefacebook?" across one dense dorm graph | None needed; density did it (over half of Harvard joined in weeks) |
| Clubhouse (2020) | VC and creator Twitter | Invite-only, 2 invites, iOS-only | None; live rooms needed hosts | Celebrity rooms; contact-book nudges | Creators and VCs as hosts |
| Tinder (2012) | USC Greek life, then school by school | Launch parties where you needed the app to get in | Low | Party plus app at the door | The most socially central students |
| Snapchat | One LA high school | Peer-to-peer, ephemeral | Low | Friend graph inside one school | Teens |
| Gas / TBH | One high school at a time, geofenced | Only your school | Receiving compliments | Compliments about you, which got screenshotted | None: the content was praise |
| Slack / Partiful / Luma | One team or one party | The group itself | Planning tool works for one host | Every invite reaches non-users | Hosts |
| Nextdoor | One neighborhood, needed ~10 households to open | Verified address | Low | Founding member recruits neighbors | Founding neighbors |
| Boardy (2024) | Founder's own network of investors and founders | None formal | A good call is useful by itself | Members told their partners; one investor's whole firm joined within an hour | Investors (the people founders want) |
| Series (2025) | `.edu` across campuses; campus tours | `.edu` | AI friend over iMessage | Shares and intros within one campus | Students |
| Ditto (2025) | UC San Diego, then UC campuses; parties with Greek life | Campus | Planned date | Spread through sorority group chats; ~25% of new users from referrals | Sororities |
| Timeleft (2023) | One city; same night every week | Pay-to-join, open | Dinner happens even if you know nobody | "I had dinner with 5 strangers" stories | Restaurants and hosts per city |

### Patterns

1. **Borrow density, don't create it.** Every winner lit up a graph that already existed offline: a campus, a team, a sorority, a founder's phone book. None of them built density from scratch in a city.
2. **The atomic network is small and specific.** Nextdoor needed about 10 households, Facebook one campus, Slack one team. "SF + NYC, 150-300 members" is two cities' worth of thinness.
3. **The boundary has to be legible.** "Harvard", "USC Greek", "your school". "Invite-only" alone is not a boundary; it only tells you you're out.
4. **The artifact must touch non-users.** Examples: Partiful invites, Gas compliments, Boardy's "you should talk to my AI", Clubhouse's rooms.
5. **Recruit the hard side first.** That means the people others want access to (Clubhouse's creators, Boardy's investors, Tinder's popular students). For The Network the hard side is **people who can help**: connectors, people with skills, hosts.
6. **A shared clock creates density in time.** Examples: Timeleft's Wednesday, BeReal's daily notification, Clubhouse's scheduled rooms. With 50 people, synchronizing them matters more than adding 50 more.

### The failures

- **Clubhouse:** scarcity drove sign-ups, not retention. The boundary was the product, and when invites opened and lockdown ended there was nothing left. *Lesson: scarcity is the match, not the fuel.*
- **Lunchclub:** AI 1:1 intros on a weekly cadence. Match quality decayed as the pool grew and diluted, meetings became a chore, no-shows rose. *Lesson: matching as the product, without a real reason to meet, fades. This is the "Boardy for friends" trap the founder already rejected.*
- **friend.tech and token-incentive social apps:** paying for participation brought farmers who left when yields fell. *Lesson: ownership is a story about who built it, not a reason to join.*
- **Path, Google+:** no atomic network and no loop that brought the right next person in.

## 2. The Network's specific cold-start problem

- The engine is only as good as the candidates within travel distance. At 150 members per city spread across neighborhoods, most asks and standing intents have zero good candidates. The PRD acknowledges this with F21, "nothing fits yet", but treats it as a fallback.
- **Reframe:** "nothing fits yet" is the most valuable moment in the product, because it tells you exactly whom to recruit next. Every other network grows by inviting whoever is easiest to invite. The Network can grow by inviting whoever is *missing*.

## 3. Cornerstone candidates

| # | Cornerstone | Works at n=50? | Viral artifact | Density effect | Brand fit | Risk |
|---|---|---|---|---|---|---|
| A | **Wanted:** ask the Network, and unmet asks recruit the person who can answer | Yes: AI answers alone, members answer within a scene, and gaps recruit | Vouch letter naming the need | Every unmet need adds the missing node | Strong: "members build the network" made literal | Asks may be dull (plumbers); needs good ask prompts |
| B | **The Table:** weekly engine-composed groups of 4-6 per scene at a public venue | Yes, if 20+ people in the scene | "Dinner with people the Network picked" stories | High: synchronized, repeat edges | Medium: risks becoming "Timeleft with AI" | Ops-heavy; venue partners; flakes |
| C | **Plans, upgraded:** tell it your weekend; it finds the event and who else you know is going | Partly: single-player events work, co-attendance needs density | Weak | Medium | Medium | Becomes an events concierge; low switching cost |
| D | **The Vouch:** writing a vouch *is* the product (Gas-style praise) | Yes | Strong | Low by itself | Strong | Novelty fades; need a reason after joining |
| E | **Agent in your group chat:** the Network joins existing iMessage groups to make plans | Yes: every group chat is an atomic network | Very strong: non-members watch it work | High | Medium | Post-MVP in PRD; Blooio group support unknown; privacy of non-members |
| F | **Work intros for builders** (Boardy-style) | Yes, in a builder scene | Medium | Medium | Weak: the founder rejected "Boardy for friends" | Becomes a deal-flow tool |

## 4. Recommendation: A as the cornerstone, D as its artifact, B as the ritual

They form one loop:

```
member asks ──► AI answers? ──yes──► done (single-player value)
      │              │
      │              no
      ▼              ▼
  member in scene fits? ──yes──► human-reviewed intro / help (F8, F11, F14)
                     │
                     no
                     ▼
  "Wanted" ask to the 3-8 members most likely to know someone
                     │
                     ▼
  member vouches someone in for that need  ──► vouch letter (artifact)
                     │
                     ▼
  new member arrives already needed: first act is helping
                     │
                     ▼
  their own asks, their table night, their vouches ...
```

Why this beats the alternatives:

- **It solves cold start mechanically.** Unmet demand is the growth engine, so a small network grows toward exactly what it lacks. Section 2.4 of the growth doc already rewards good vouches and has a "needs list"; this makes it the main path rather than a side feature.
- **It recruits the hard side first.** People who can help arrive with a job. Nextdoor and Clubhouse had to court their hard side; here the network asks for it by name.
- **It fixes onboarding.** PRD 3.2 says the biggest hidden burden is telling the system who you are. An arrival brought in for a need already has a vouch, a skill and a first act. The profile starts from the vouch, not a form.
- **It creates the status moment without a gatekeeper.** "Someone in the Network needed a person who knows ceramics restoration. Maya said that's you. Here's what she wrote." People screenshot that.
- **It makes the ownership story true.** Members literally build the network by filling its gaps, and NC records who did. No token is needed to make that feel real.
- **It isn't "AI intros".** The product is "get what you need from people who are vouched for", which includes intros but is not defined by them.

The weekly table (B) stays because asks are lumpy. Members need a reason to interact when they have no need, and the engine needs repeat edges and feedback. Use the existing monthly gathering as the scene's launch event, and add a weekly small-table night once a scene passes about 25 committed members.

## 5. GTM plan

### 5.1 Scenes, not cities

- **What a scene is:** one world (builders, a creative scene, a climbing community) inside 2-3 adjacent neighborhoods. Target 40-60 committed members, which matches the PRD's 40-committed gate (28.5) but applies it per scene, not per city.
- **Picking the first scenes:** pick where the founders' own graph is densest and where people's needs overlap. For example, AI and crypto builders in the Mission / Hayes Valley, and a parallel scene in Brooklyn or Lower Manhattan. Builders have frequent, answerable asks: hires, co-founders, investors, apartments, advice, a co-working buddy. The Eliza and builder community is the obvious borrowed graph.
- **Then broaden:** to keep the network general, the second scene in each city should be deliberately different (a creative or outdoors scene). Adjacent scenes give the bridges that make it a network instead of a club.
- **Unlocking:** a scene "opens" publicly at its first all-member gathering once it reaches its threshold. Until then, members know it's filling ("Mission builders: 31 of 40").
  - This is Facebook's campus unlock with a legible boundary.
  - It is also a countdown people can push along by vouching.

### 5.2 The boundary

- The pitch line is *"You can't sign up. Someone has to say why you belong."*
- **Non-members** who find the number get a kind reply: "The Network grows by vouches. Ask someone you know inside, or tell me what you're good at and I'll mention it if a member needs it." The second option is consented, and the agent only keeps what the person typed. This is not a waitlist profile of a non-member. It needs a privacy review against PRD 1.2(8).
- **Vouch capacity** stays scarce and NC-driven. It is never sold.
- **No founder, VIP or "founding member" tier**, per the founder decision. Status comes from the vouch letter, not from a rank.

### 5.3 Seeding sequence per scene

1. **Week 0: hard side first.** The founding team vouches in 10-15 connectors and helpers in the scene: people others go to for advice, hosts, people with useful skills. Each is told: "you're here because people will need you".
2. **Weeks 1-2: asks before matching.** Members are prompted to make one real ask (onboarding ends with "what's one thing you'd like help with this month?"). AI and the seed answer. Unmet asks become Wanted asks and pull in the next 20-30 people.
3. **Weeks 2-4: launch event.** The first all-member gathering opens the scene, and the engine composes the seating. Shadow-mode matching becomes reviewed proactive matching once the scene passes 40.
4. **Week 4 on: weekly tables plus asks.** Monitor the loop metrics below. Open the next scene only when this one passes them.

### 5.4 Channels that touch non-users (within MVP privacy rules)

- **Vouch letter:** delivered by the inviter's share or by the agent texting the invitee after the inviter's explicit consent. It already falls under F1-F3.
- **Wanted asks:** go only to members. The member decides whether to forward anything to a friend, and in their own words. The agent never messages a non-member about someone else's need, so PRD's forwarding gate (20.3) is not crossed.
- **"Built by" stories:** with consent, short accounts of things the Network made happen (a crew that formed, an ask that was filled in 3 hours). These give the founders' public channels proof, not hype.
- **Group chat agent (E):** the strongest viral channel and the first post-MVP add. Every group chat is an atomic network, and non-members see value without joining. Check whether Blooio supports group threads before committing to it.

### 5.5 What not to do

- Don't lead with ownership or tokens in GTM. It brings farmers and creates securities exposure. Say "built and, later, owned by its members" as a principle, never "join early to earn".
- Don't launch city-wide or by waitlist. A waitlist without a vouch is Clubhouse's scarcity without its celebrities.
- Don't pitch "AI that introduces you to people". That is Boardy/Lunchclub, and the founder ruled it out.
- Don't count invites sent. Count vouches whose invitee was needed and helped.

## 6. Metrics for the loop (add to PRD 21)

| Metric | Target for a healthy scene |
|---|---|
| Ask rate: share of committed members who ask at least once in 30 days | ≥ 60% |
| Ask fill rate within 72h (AI, member or recruited member) | ≥ 70% |
| Wanted-to-vouch conversion: Wanted asks that produce a vouch within 7 days | ≥ 30% |
| Needed-arrival activation: recruited-for-a-need members who help within 14 days | ≥ 60% (vs seed baseline) |
| Need-driven k: new committed members per member per month from Wanted vouches | ≥ 0.3 in the first two months |
| Table attendance and repeat edges: share of table pairs who meet again in 60 days | ≥ 20% (aligns with 28.2) |
| Scene unlock time: days from first seed vouch to 40 committed | ≤ 30 |

The existing 28.2 gates still apply (worthwhile-interruption ≥ 70%, V14 ≥ 60%, ≥ 30% of members invite).

## 7. Experiments in the pilot (cheap, before building more)

1. **Concierge Wanted:** run the loop by hand in one scene for 3 weeks: asks by text, staff finds answers, staff sends Wanted asks to likely connectors. Measure fill rate and vouch conversion before writing engine code.
2. **Vouch letter A/B:** a plain invite vs a letter that quotes the vouch and names the need. Measure accept and activation.
3. **Table night vs no table** in two otherwise similar scenes. Measure repeat edges and ask rate.
4. **Simulator:** add "Wanted" to the Observatory. Make personas with off-network friends who can be recruited, and needs that start unfillable. Check that need-driven vouching closes coverage gaps faster than random invites, and watch for the known bursts-and-starvation problem (Gini up to 0.99).

## 8. Changes this implies in the PRD

- 25.1 and 28.5: the density unit becomes the scene (40-60 committed), not the city. SF and NYC stay as the two cities.
- 29: promote F8 (ask), F14 (help) and F21 (nothing fits yet) into one flow, "Wanted". Its last step is a targeted vouch request to the most likely connectors. Interruption budgets apply, and it is human-reviewed under 1,000 members.
- F1-F3: the vouch letter becomes the invite artifact, and the invite records the need it was for.
- 32.16: add the weekly scene table on top of the monthly gathering.
- 21: add the loop metrics in Section 6.
- 1.3 pitch line: "Text the Network what you need. If nobody in it can help yet, its members bring in someone who can."

## 9. Revision (same day): two narrow front doors

After review, the founder asked for something narrower that could actually go viral. Wanted (Section 4) stays as the loop that grows the network. Two front doors feed it.

### 9.1 Three Names (all ages 13+, friends)

- **The mechanic.** You text the Network the three people you wish you saw more of.
  - Nothing is revealed unless one of them names you back.
  - If it's mutual, both are told, and the agent plans the hangout.
  - Names who aren't members get a link that you send yourself: "Someone named you as one of the 3 people they want more of. Name yours to see if it's mutual."
- **Why it spreads:**
  - curiosity and flattery, revealed only when mutual (the Gas/TBH/NGL pattern);
  - it travels through friendships that already exist;
  - it's a ten-second ask;
  - the payoff is a real plan, not a notification.
- **It strengthens ties people already have.** It doesn't introduce strangers, which is why it can include 13-17s. This reverses the PRD rule that under-18s are never connected to other people, so it needs these rules:
  - **Age bands.** 13-17s only reveal with others in their band, within about 2 years of age. A mutual pair across an adult/minor line never reveals, and nobody is told why.
  - **Friends only.** No crush mode under 18. Under-18 plans are suggested at public venues during the day only.
  - **Non-members.** A non-member's number is kept only as a salted hash for matching if they join, deleted after about 30 days. No hashes are kept for anyone known to be under 18 who hasn't joined.
  - **Legal review first.** Check state minors' social-media laws and app-store age-verification acts before minors are included. The PRD's age-floor decision row needs updating.
  - **No "nobody named you".** Only mutual results ever surface.

### 9.2 Dating through your own AI (18+, the lovegpt.dev pattern)

- **The pattern.** lovegpt.dev hands the user a prompt to paste into ChatGPT or Claude. The assistant loads a skill file and works from the account the user already has, so there's no download or sign-up, and the prompt itself is what gets shared.
- **The Network version.** "Ask your AI who you should date."
  1. The member pastes the prompt into the AI they already use.
  2. Their assistant drafts a profile and "your type" from what it already knows about them. This is the pasted-memory enrichment in PRD 28.3.
  3. The member edits and approves the draft. Nothing is stored before approval.
  4. They verify their phone and get an agent key (PRD 11.5). This makes the connector work from Section 11 the front door, earlier than the post-MVP plan.
  5. From then on their own agent talks to the Network agent.
- **Viral artifact.** The "my AI's read on me" card. People already share what ChatGPT says about them; this turns that into a dating profile and an invite.
- **Matching:**
  - The two members' agents check fit with each other before any human is involved.
  - A human reviews every match while the network is under 1,000 members.
  - Both people opt in.
  - The Network sends a complete date plan at a public venue, Ditto-style.
- **Ties to Three Names.** The dating pool is friends of friends first. A mutual Three Names pair can play matchmaker for each other ("know anyone for Dev?"), which is how Hinge started.
- **Guardrails:**
  - 18+ with ID verification before any date. The PRD lists ID verification as post-MVP, so this pulls it forward.
  - Memory imports can contain sensitive inferences. Apply PRD 17.2 and drop sensitive categories unless the member adds them explicitly.
  - The skill file is a prompt-injection surface on our side and theirs. Keep it static, signed and minimal.
  - AI-written profiles all sound alike, so make the member edit one line in their own words.
- **Brand.** This is a door into the network, not its identity. Dating is one thing your agent does, beside friends, help and plans. That keeps the founder's "not Boardy for dating" position.

### 9.3 Order

1. **Weeks 0-2:** Three Names by hand in one scene, about 50 people. Measure:
   - share of members who send the link;
   - invitees who name three back;
   - mutual matches that meet.
2. **Weeks 2-6:** open the "ask your AI" dating door to adults in the same scene, so the friend-of-friend graph from Three Names already exists.
3. **After that:** Wanted asks and weekly tables keep both groups active.

## Sources

- [Boardy: Creandum on the AI superconnector](https://creandum.com/commitments/boardy), [TechCrunch on Boardy's pre-seed](https://techcrunch.com/2024/10/24/ai-networking-startup-boardy-raises-3m-pre-seed)
- [Series: iMessage AI social network for college students](https://www.founded.com/series-imessage-ai-social-network-yale-pre-seed/), [Series raises $5.1M](https://varenyaz.com/college-built-ai-social-network-raises-5-1m/)
- [Ditto raises $9.2M for iMessage college matchmaking](https://www.globaldatinginsights.com/featured/ditto-raises-9-2m-to-expand-imessage-college-matchmaking)
- [Timeleft: dinners with strangers, Brussels Times](https://www.brusselstimes.com/belgium/1160308/table-for-six-strangers-fighting-urban-loneliness-over-dinner/), [Paperjam](https://en.paperjam.lu/article/meet-five-likeminded-strangers)
- [lovegpt.dev](https://lovegpt.dev): paste-a-prompt matchmaking inside ChatGPT or Claude
- Facebook, Clubhouse, Tinder, Snapchat, Gas/TBH, Nextdoor, Slack, Partiful, Lunchclub, friend.tech: public histories; frameworks from Andrew Chen, *The Cold Start Problem* (atomic network, hard side).
