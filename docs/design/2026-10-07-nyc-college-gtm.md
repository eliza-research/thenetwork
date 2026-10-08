# NYC college GTM: approaches compared, plus guerrilla playbook

Status: proposal, 2026-10-07. Builds on:
- `2026-10-07-gtm-cornerstone.md`: Wanted, Three Names, and dating through your own AI.
- `2026-10-07-mvp-your-people.md`: keeper agent, birthdays, newcomer tables.

Launch city: NYC, starting with colleges (NYU first).

## 1. Why NYC colleges

- **Every freshman, transfer and grad student is a newcomer** at the same time, in the same place. They are the most open to new friends they'll ever be.
- **NYU has no quad.** Dorms and classes are spread across Manhattan and Brooklyn, so the usual ways students run into each other are weak. The app can be the campus NYU doesn't have. Columbia/Barnard, The New School/Parsons, FIT, Pace, Baruch and other CUNY colleges, Fordham Lincoln Center, Cooper Union and Pratt are all within a short subway ride.
- **Dorm floors and clubs are ready-made starting groups.** A dorm floor of 30-50 people is about the size of Nextdoor's 10 households or Slack's one team.
- **Mostly 18+.** That avoids most of the minors problem. Some freshmen are 17, so age attestation and age bands still apply.
- **Students make content.** Campus Instagram accounts, TikTok and group chats spread things in hours.
- **Timing (today is 2026-10-07).** The first six weeks of fall, when freshmen make friends fastest, are nearly over. The next moments are:
  - Halloween (24 days away; the Village Halloween Parade runs up Sixth Avenue next to NYU);
  - Friendsgiving, for students who don't go home for Thanksgiving;
  - finals;
  - the spring semester start in late January (transfers, spring admits, the spring club fair);
  - Valentine's Day.

## 2. Every approach, gamed out

Ratings: High / Med / Low. "Cold start" means it works with almost nobody else on it.

| Approach | Virality | Retention | Cold start | Ops cost | Risk | Strengths | Weaknesses |
|---|---|---|---|---|---|---|---|
| **Your People** (keeper agent: cadence, plans, birthdays) | Med (birthday and plan links) | **High**: real recurring value | **High** | Low | Notes about non-members (privacy) | Useful alone; best data; not weird | Not exciting on its own; risk of becoming a reminder app; users must still send the text |
| **Birthday mission and links** | **High** (Birthday Alarm reached ~100M) | Med (yearly dates) | High | Low | Low | Flattering, harmless, touches non-users | Can feel like a chain letter if overdone |
| **Three Names / "Mutual Night"** (who do you want more of? revealed only if mutual) | **Very high**: curiosity plus flattery, synchronized reveal | Low by itself; Med when plans follow | High within one school | Low | Hurt feelings if nothing is mutual; must never show "nobody" | Gas/TBH energy without anonymity abuse; creates real edges | Spikes and fades unless it feeds plans |
| **Mutual crush night / dating pact** (18+, Marriage Pact / Datamatch style) | **Very high** on campus | Low (yearly event) | High | Med | Romance safety, 17-year-olds, rejection | Proven: Marriage Pact spread to dozens of campuses, and Harvard's Datamatch has run since 1994 | Once a year; can define the brand as dating |
| **Dating through your own AI** ("ask your AI who you should date") | High ("my AI's read on me" cards) | Med | Med | Med (review, ID checks) | Sensitive memory imports, ID checks, prompt injection | Novel; no sign-up; your AI already knows you | Needs enough people on both sides; brand pull toward dating |
| **Newcomer tables** (6 strangers, same night weekly) | Med (stories) | **High** for those who attend | Med (needs ~30 newcomers per week) | **High** (venues, flakes) | Venue safety | Proven (Timeleft); makes real friends; works with few members | Expensive to run; Pie had to pay hosts |
| **Wanted** (asks; gaps recruit the right person) | Med | High once dense | Low-Med | Med | Low | Grows the network toward what it lacks | Needs density first; less fun |
| **Vouch letter / invite-only** | Med-High (status) | Low | High | Low | Clubhouse-style collapse | Status and quality | Scarcity alone doesn't retain; "X invited you" weirdness |
| **Group chat agent** (agent joins a group chat and plans) | **Very high**: non-members watch it work | High | **High**: every group chat is a starting group | Med | Privacy of non-members in the chat; whether Blooio supports groups | Best for spreading through existing friend groups | Technical unknown; post-MVP in PRD |
| **Missed connections** (post one; revealed only if the other person also posts) | High (NYC loves missed connections) | Low | Med | Med (moderation) | Stalking or harassment if not strictly mutual | Spicy, very NYC, press-friendly | Moderation burden; only safe if strictly mutual and anonymous |

### What the comparison says

No single approach is both viral and sticky:
- **Your People and newcomer tables** keep people.
- **Mutual Night, the crush pact and group chats** spread.

The plan is one daily-useful product (Your People) with **scheduled spikes** (Mutual Night, Halloween crews, Friendsgiving, Valentine's pact). Each spike sends people into plans and tables, and those keep them.

## 3. The stack

1. **Product people stay for:** Your People, the keeper agent over iMessage/SMS. It keeps your friends close, remembers birthdays and makes plans.
2. **Viral spikes:** campus-wide synchronized events (Section 4), one about every 3-4 weeks.
3. **Ritual:** weekly newcomer tables per school once the school has 30 or more members wanting new people.
4. **Later:** the group chat agent (once Blooio group support is confirmed), then dating through your own AI, launched for Valentine's.

## 4. Launch calendar

| When | Moment | Mechanic | Goal |
|---|---|---|---|
| Oct 7-20 | Quiet pilot | ~100 people by hand: founders' friends plus NYU students recruited by hand (club leaders, RAs) | Do plans happen? Do birthday links spread? |
| Oct 21-31 | **Halloween Crews** | "Text us. We'll put you in a group costume crew of 4 for the Village Halloween Parade." The agent forms crews, assigns the costume theme and sets the meeting point | First public stunt; strangers get a reason to meet, fun with no pressure; very NYU |
| Nov | **Mutual Night, NYU** | Everyone texts 3 names by Thursday midnight; results drop 9am Friday. Mutual pairs get a plan that weekend | The big campus spike |
| Late Nov | **Strays Friendsgiving** | Tables for students not going home (international, far from home, can't afford flights) | Press-worthy, warm, builds tables |
| Dec | Birthday drive and finals | "Study crew" plans; "ask 5 friends their birthday before break" mission | Retention over break |
| Late Jan | **Spring start** | Spring admits and transfers cohort ("New at NYU, Spring '27"); club fair table | Second intake; expand to Columbia, The New School, Parsons |
| Feb 1-14 | **Mutual Crush Night / "Ask your AI" pact** (18+) | Dating door opens with a Valentine's reveal | Biggest spike of the year |

## 5. Guerrilla playbook

### 5.1 Fliers and print (handed out or on approved boards)

The rule for every flier: the call to action is "text HI to (number)". The user always texts first, so there are no unsolicited messages and the TCPA isn't an issue.

- **Tear-off "MISSING" fliers.**
  - *"MISSING: your friends. Last seen at orientation. Answers to 'we should hang out sometime.'"*
  - Tear-off tabs carry the number. People photograph funny tear-off fliers and post them.
- **"We should get coffee sometime" fliers.** *"= never. Text us and it'll actually happen."*
- **Birthday flier.** *"Quick: when's your best friend's birthday? ... Text us."*
- **NYU in-joke.** *"NYU doesn't have a quad. We're making one."*
- **Receipts.** Hand out printed "friendship receipts" at Washington Square Park: *"Last saw: Maya, 47 days ago. Balance due: 1 coffee."*
- **Rules:**
  - NYU and other schools require approval to post on their boards.
  - NYC fines posters stuck on lampposts and public property, per poster.
  - Hand-to-hand flyering on public sidewalks is generally allowed.
  - Café community boards and partner venues are free and legal.
  - Don't wild-post on public property.

### 5.2 Street and park stunts (Washington Square Park, Union Square, Columbia's steps)

- **"Do you know your best friend's birthday?" street quiz.** Film people failing, then calling their friend. Cheap, repeatable, made for TikTok.
- **Birthday table.** "Is it your birthday? Free cupcake." Every day for two weeks, partnered with a bakery. Film the reactions; every person there signs up so their friends never forget again.
- **Reunion coffee.** A partner café gives a free coffee to any two people who come in together and say they haven't seen each other in a month. Their agent makes the plan.
- **Live Mutual Night board.** On reveal morning, a screen or chalkboard in the park shows the running count of mutual pairs (numbers only, no names): "1,284 mutuals at NYU". People talk about whether they got one.

### 5.3 Campus inside game

- **RA kit.** RAs must run floor programs, so give them one: "Floor Mutual Night" plus a birthday wall for the floor. RAs are the "chief friend officers" Howbout grew through.
- **Club leaders.** Club presidents get a free agent to keep members coming (attendance plans, birthday shout-outs). Every club is a starting group.
- **Floor vs floor.** The dorm floor with the most mutual pairs or plans that happen wins a pizza party. A starting group competing against another starting group.
- **Campus ambassadors.** Paid per *active* member, not per sign-up, to avoid junk sign-ups. Ditto grew through sorority group chats; NYU's Greek life is small, so use clubs, dorms and cultural associations instead.
- **International student associations.** They have the most newcomers who need the most help (Friendsgiving, holidays, first NYC winter).

### 5.4 Spicy / edgy (and where the line is)

| Idea | Spice | Line |
|---|---|---|
| "Your friends aren't busy. You just never made a plan." | Mild shame, true | Fine |
| **NYC Missed Connections by text.** Post "Intro Psych, Tuesday, green tote". Revealed only if the other person posts a matching missed connection | High | Must be strictly mutual and anonymous until both agree. No descriptions of bodies. Moderated, with block and report. Never helps anyone find a person who didn't post |
| **Mutual Crush Night** | High | 18+ only, never reveals one-sided crushes, never shows "nobody" |
| **"Breakup with your group chat"**: the agent turns a dead group chat into a real plan | Medium | Needs the group chat agent; everyone in the chat must consent |
| **Anti-ads mocking dating apps**: "Swiping is a part-time job. Text us instead." | Medium | Don't name competitors' trademarks in a misleading way |
| **"Rent-a-friend" fake-out booth** that turns out to say "you already have friends, let's see them" | Medium | Fine |
| **Anonymous compliment / vouch wall** (Gas style) | High | Positive-only prompts, no free text that could bully, moderated |

**Don't do these:**
- Use school logos, or look like an official university service.
- Text anyone who didn't text first.
- Fake scarcity ("only 100 spots" when it isn't true).
- Market to students as a mental-health fix. Loneliness framing is fine, but the agent needs crisis handling (988, Crisis Text Line) and must not act like a therapist.
- Plant fake users or fake testimonials (the IRL app collapsed over fake users).
- Run stunts on campus property without permission.

### 5.5 Online

- **Short-video formats:** the birthday street quiz; "my AI planned my roommate's birthday"; "I asked 5 friends their birthday and one cried"; "we went to the Halloween parade as strangers"; Mutual Night reaction videos.
- **Campus meme accounts:** pay them for a Mutual Night drop announcement, marked as a sponsored post.
- **Reddit (r/nyu, r/columbia, r/nyc, r/AskNYC "just moved" threads):** founders reply as themselves, helpfully, and say who they are.
- **The "my AI's read on me" card** for the Valentine's dating launch.

## 6. Numbers to aim for at NYU (~29k undergrads)

| Step | Target |
|---|---|
| Quiet pilot | 100 users, ≥ 25% of suggested plans happen |
| Halloween crews | 200+ people in crews, ≥ 60% show up |
| Mutual Night #1 | 2,000+ participants (~7% of undergrads); ≥ 15% of participants get at least one mutual; ≥ 30% of mutuals meet within 2 weeks |
| End of fall | 3,000 members at NYU; ≥ 50% with a plan or birthday act in the last 30 days |
| Spring | Columbia and The New School added; Valentine's pact 5,000+ participants across schools |

## 7. Budget sketch (fall)

| Item | Rough cost |
|---|---|
| Fliers, tear-offs, receipts, chalkboards | $1-2k |
| Bakery and café partners (cupcakes, reunion coffees) | $3-5k |
| Ambassadors (10 × paid per active member) | $5-10k |
| Halloween crew kits and Friendsgiving tables | $5-8k |
| Campus meme account posts | $2-5k |
| SMS and iMessage costs, LLM | Scales with users; `luna` keeps it low |

## 8. Decisions needed

1. Approve NYU as the first school and NYC as the only city (this reverses SF+NYC).
2. Approve the Halloween Crews stunt. It needs the crew-forming flow in the next 2 weeks.
3. Approve Mutual Night as the first big spike, including the rule that only mutual results are ever shown.
4. Missed Connections: yes or no. It's the spiciest idea here and needs the strongest moderation.
5. Age policy: 17-year-old freshmen are in for Your People, and out of Mutual Night crush mode and dating.
