# MVP reframe: your people first

Status: proposal, 2026-10-07. Narrows `2026-10-07-gtm-cornerstone.md`. If adopted, it changes:
- PRD 25.1: one city, not SF and NYC;
- PRD 28: single-player first, matching later;
- the PRD's rule against storing information about non-members (13.3 and 1.2(8)): see Section 5.

## 1. The idea in one paragraph

The Network starts as your agent for the people you already have.
- You tell it who your people are, how often you want to see each of them, what you like doing together, and when their birthdays are.
- It notices when someone is drifting, suggests a specific plan (a time, a place, a drafted text), and remembers birthdays and the small things.
- It also asks one question: "Are you open to meeting new people?"
- **Phase 1** is single-player. Nobody gets an "X invited you to the Network" message.
- **Phase 2** comes once a plan has worked. Then it suggests bringing that friend in, so the two agents can coordinate.
- **Phase 3** is new connections in the launch city. It serves the members who said yes, starting with friends of friends.

**Who it's for:**
- **Newcomers:** people who moved to the city in the last 12-18 months.
- **Drifters:** people who like their friends but keep failing to see them.

## 2. Is "Grow your network" the right name?

The idea is right, but the phrase is wrong. "Grow your network" sounds like LinkedIn, and phase 1 isn't about growth. It's about keeping people. Options in the member's own words:

- **"More of your people."** Covers both keeping and finding.
- **"Never lose touch."** Clear for drifters, says nothing to newcomers.
- **"Your people, on purpose."**

**Internal names:** keep "grow the network" as the company's goal, and call the member-facing product "your people".

## 3. Comparable products

| Product | What it did | What happened | Lesson |
|---|---|---|---|
| Monica, Dex, Clay, Fabriq, Garden, UpHabit (personal CRMs) | Contact list plus "reach out every N weeks" reminders and notes | Paid niche for professionals and the very organized. No mass adoption and no viral spread | Reminders without a plan feel like chores, and "managing" friends feels clinical. Being single-player means nothing pulls new users in |
| Bebo founders' Birthday Alarm | Birthday reminders; it emailed your friends asking them to add their own birthday | ~100M users; funded Bebo | **Asking friends for their birthday is a proven viral loop.** It touches non-users with a request that's flattering and harmless |
| Facebook birthdays | Built-in reminders; killed the standalone birthday apps in 2008 | For years one of Facebook's most powerful engagement drivers | Birthdays reliably bring people back. With fewer people using Facebook, that gap is open |
| SocialCalendar (Facebook app) | Birthday and event calendar | 11M+ installs, then faded when Facebook did it natively | Don't rely on someone else's platform for the core loop |
| Howbout | Calendars shared between friends, Gen Z | 4M+ monthly users; >75% share their calendar with a friend; growth through the "chief friend officer" who organizes the group | **Organizers drive adoption.** Your phase 1 user is often the friend who wishes someone would organize |
| Partiful | Party invites | Spread because the invitee doesn't need an account to RSVP | **The plan is the invite.** Non-users touch the product without being "invited to" it |
| Pie | AI-assisted friend-making through events in Chicago, then SF; pays hosts $5-10 per RSVP | 130k monthly users in two cities; $24M raised | Newcomers will show up to events, but the supply of events had to be paid for. Plan for that cost |
| Timeleft | Dinner for 6 strangers, same night every week | 150+ cities | A fixed weekly ritual makes up for a thin graph |
| Bumble BFF, Meetup | Stranger friend-matching and groups | Large but low-intent, with many one-off meetings | Strangers without a shared context rarely become a second meeting |
| Down to Lunch, Houseparty | "Who's free now?" pings | Spiked, then died | Asking about availability is not a habit |

**The pattern:** keeping up with friends has failed when it's a reminder app, and worked when it's a plan the friend can join (Partiful, Howbout) or a birthday the friend adds themselves (Birthday Alarm). The Network's agent can do both from one text thread.

## 4. Strengths

- **No cold start.** It is useful to one person on day one with zero members, which beats PRD 1.2(7) ("useful when small") outright.
- **It isn't weird.** Nobody receives "someone invited you to a network". Friends receive a plan or a birthday question from someone they know.
- **It produces the best possible data.** The engine learns who matters to whom, how often, and doing what. Those are relationships with real intent, not profile similarity. When both sides of a relationship join, the graph already has a strong, confirmed edge.
- **The two groups supply each other.** Newcomers need new people. Drifters who say "open to new people" are established locals with friend groups. Each is what the other is missing.
- **The agent does what a reminder app can't.** It picks the time and place, drafts the text, follows up, and remembers what happened. That is the PRD's "coordination tax" (Section 2) applied to friends you already have.
- **It serves the thesis.** Contraction (PRD 2) is mostly drift from people you already like. Fixing that before adding strangers is more honest and more likely to work.
- **Birthdays bring people back all year.** The average person has 15-40 dates worth remembering, so there are natural reasons to message spread through the year.

## 5. Weaknesses and risks

| Risk | Why it matters | Mitigation |
|---|---|---|
| Becomes another ignored reminder app | Every personal CRM has died this way | Every nudge comes with a ready plan: time, place and a drafted text. The two-unanswered rule (PRD 7.2) applies. Measure plans acted on, not reminders sent |
| The user still has to do the reaching out | In phase 1 the agent can't message the friend, so the hardest step stays with the user | Plan links the friend can RSVP to without joining, using the PRD's external participant role (7.1). The user sends them from their own phone, Partiful-style |
| Feels transactional ("friendship points") | Scoring friends turns care into a game. Overjustification risk (growth doc 2.3) | Missions are framed as care, never points, and nothing scores a friend. "Ask 5 friends their birthdays" is a mission with a story afterwards ("you now know 23 birthdays"), not a score |
| Notes about non-members | The PRD forbids shadow profiles of non-members. A friend list with birthdays and preferences is exactly that unless it's scoped | **Private member notes:** owned by the member, never used for matching, never shown to anyone, never merged into the friend's profile when they join, deleted with the account. Treat them like a phone's contacts app. Store month and day only for birthdays. Needs an explicit PRD decision row |
| Newcomers get little from phase 1 | They have few local friends to keep up with | Newcomers get phase 3 from the start, through weekly tables (Section 7). Phase 1 still helps them keep up with far-away friends and remember birthdays |
| Phase 1 to phase 2 conversion never happens | Single-player tools rarely become networks (personal CRMs never did) | Make joining useful to the *friend*: "Dev, Shaw's agent and yours can just find a time. Want one?" Ask only after a plan has actually happened |
| Low frequency | Seeing a friend is weekly at best | Fine for a messaging agent with no feed. Judge by plans per month and drift prevented, not daily use |
| Minors (13+) | Phase 1 for teens is fine (it's their own friends). Phase 3 is not | Phases 1-2 at 13+. Phase 3 (new people) at 18+, or age-banded per the GTM doc 9.1, after legal review |
| Hard to make money | A single-player keeper doesn't earn anything | Not an MVP goal (business model is deferred, PRD 18). Later: gifts, bookings, partner venues, and paid plans with clear labels |
| LLM cost per user with no revenue | Single-player opens the door widely | Effort tiers (NC) and a cheap model for routine nudges; `luna` is already the default |

## 6. The viral loops (none says "you've been invited")

1. **Birthday ask (the Birthday Alarm loop).** The mission is "ask 5 friends whose birthdays you don't know".
   - The agent gives the member a link to send from their own phone: "Add your birthday so I never miss it." The friend enters month and day on a one-field page.
   - The page ends with: "Want an agent that remembers your people too?"
   - The friend enters their own data, so there's no privacy problem.
   - When friends ask "why are you asking?", the answer is word of mouth: "my AI's helping me not be a bad friend".
2. **The plan link (the Partiful loop).** Every plan the agent suggests gets a link the friend can open, RSVP to and suggest another time on, with no account. The footer says the plan was made by the member's agent.
3. **Agent-to-agent (phase 2).** "Dev's on the Network too, so your agents found Thursday." This is the first moment the network itself is visible, and it's useful.
4. **The newcomer table.** "I just moved here and my AI set up dinner with 5 people." This is the story that gets told.
5. **Content.** "My AI planned my best friend's birthday" and "I asked 5 friends their birthdays and it got emotional" are short-video formats that cost nothing to seed.

## 7. Launching in one city

### 7.1 Which city

Pick the city where the founders live and can run events in person. Both phase 3 and the newcomer tables need a hands-on team. Beyond that:

- **NYC:** the biggest newcomer inflow, walkable, plenty of public venues, and Timeleft-style dinners already work there. The newcomer problem is loud.
- **SF:** the founders' builder graph, early adopters of AI-over-text, and a large wave of AI workers moving in. Smaller, so density comes faster.

### 7.2 Phase 1 doesn't need the city boundary

- **Who can use phase 1:** anyone in the US can use the keeper agent, because it needs no density. Every user outside the launch city adds to a "bring it to my city" count, which tells you where demand is.
- **Where the spending goes:** marketing, events, partnerships and content all concentrate in the launch city.
- **Where phase 3 runs:** only in the launch city, and only in a few adjacent neighborhoods at first.

### 7.3 The launch city's newcomer boundary

- **Newcomer cohorts.** Give newcomers a legible cohort identity, the way Facebook gave each campus one: "New in NYC, Fall '26". Everyone who moved in the last 12 months is in it.
  - The freshman effect is real: people make the most new friends in the first weeks somewhere new, while everyone around them is also new.
  - A cohort recreates that.
- **Locals.** Drifters who say "open to new people" join the cohort's tables as locals: one or two per table of 6. They're the bridges into existing friend groups.

### 7.4 Where to find newcomers in the first 1,000

| Channel | Why | How |
|---|---|---|
| New-build apartment buildings and co-living | Whole floors of people who just moved in | Partner with leasing offices on a resident welcome: "the building's welcome dinner, set up by the Network" |
| New-grad and new-hire cohorts | Big employers hire in classes | Go through employee resource groups and new-hire Slack channels; offer a free "new in town" table night |
| Grad school orientation | Fall intake | Student groups; this is how Ditto and Series grew |
| Reddit and local "just moved here" threads | High intent, already asking | Reply helpfully as a person, never as a bot account. Link the birthday/plan page, not a sign-up |
| Run clubs, climbing gyms, coworking | Places newcomers go to meet people | Venue partners for table nights; the venue gets regulars |
| Founders' and early members' own friends | Drifters | The birthday mission does this |

### 7.5 Sequence

1. **Weeks 0-4: concierge phase 1 with about 100 people** (the founders' friends plus 30-50 newcomers). Staff and the agent run it by hand.
   - Does the agent get people to see friends they'd been missing?
   - Do birthday links spread?
2. **Weeks 4-8: the first newcomer table nights.** Weekly, 3-6 tables of 6 at partner venues. Composition is reviewed by a person. One or two "open" locals per table.
3. **Weeks 8-12: phase 2 asks**, only after a plan has happened ("want your agents to coordinate next time?"). This is also where Three Names from the GTM doc fits naturally: two people who list each other learn it's mutual.
4. **Months 3-6: new connections beyond the tables.** Friend-of-friend intros come first, since phase 2 has made that graph real, then the wider engine. Human review stays on while the network is under 1,000 members.
5. **Second city:** chosen from the "bring it to my city" count, once the expansion gates (PRD 25.6) are met.

## 8. Metrics

| Metric | Target |
|---|---|
| Activation: member names 3+ people with a cadence in week 1 | ≥ 60% |
| Plans acted on: suggested plans that happen within 14 days | ≥ 25% |
| Drift prevented: share of named people seen within their cadence, vs the member's own stated baseline | Up from baseline by month 2 |
| Birthdays captured per member in 30 days | ≥ 10 |
| Birthday link k-factor: new sign-ups per member from birthday and plan pages | ≥ 0.3 |
| Phase 2: friends who join after a plan happened | ≥ 15% of plans that happened |
| Newcomers: first table within 14 days of joining; second meeting with someone from it within 60 days | ≥ 70%; ≥ 20% |
| Retention: members with a plan or a birthday act in each 30-day window | ≥ 50% at month 3 |

## 9. Decisions needed

1. Which launch city. This reverses the SF+NYC decision.
2. Whether to allow private member notes about non-members (Section 5). Without this, phase 1 doesn't work.
3. The member-facing name ("Grow your network" vs "More of your people" etc.).
4. The age policy for each phase.
5. Whether phase 1 is open nationally or only in the launch city.

## Sources

- [TechCrunch: Pie's AI friend-making app](https://techcrunch.com/2025/03/04/andy-dunns-new-app-pie-uses-ai-to-help-you-make-friends), [TechCrunch: Pie comes to SF](https://techcrunch.com/2024/11/19/irl-social-app-pie-is-coming-to-sf-to-make-you-less-lonely)
- [TechCrunch: Howbout raises $8M](https://techcrunch.com/2024/09/13/howbout-raises-8m-from-goodwater-to-build-a-calendar-that-you-can-share-with-your-friends)
- [TechCrunch: Facebook destroys the birthday reminder industry](https://techcrunch.com/2008/11/16/facebook-destroys-lucrative-birthday-reminder-industry/), [The Ringer on Facebook birthdays](https://www.theringer.com/2016/07/28/tech/facebook-birthdays-business-5ddb9d73732f), [TechCrunch: SocialCalendar](https://techcrunch.com/2009/03/17/socialcalendar-organizes-your-social-life)
- [Dex: relationship tools overview](https://getdex.com/blog/what-are-the-best-tools-for-nurturing-everlasting-relationships)
