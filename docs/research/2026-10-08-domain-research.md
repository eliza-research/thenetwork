# Domain research: slop.date, peon.biz, buddies.nyc (2026-10-08)

> **Founder decisions (2026-10-08) override some recommendations below:**
> - Members aged 13-17 may join every app but are never matched or connected to anyone; matching is 18+ everywhere.
> - Compliance is not a launch blocker for now; the safety guards stay.
> - One Blooio line serves all apps, with keyword routing on the first message.
> - slop.date ships first; ntwrk.love is the home page.
> - peon.biz and buddies.nyc run locally only.


Status: research note. Scope: one matching engine (The Network's engine, PRD sections 14, 17 and 33, and `docs/design/2026-10-07-experience-design.md`) powering three branded apps on a shared database, admin panel and phone-verified login:

- **slop.date**: dating, matched in one city, several cities, or within X miles of a zip code.
- **peon.biz**: hiring.
- **buddies.nyc**: friend-finding in New York City.

Each app is an agent over SMS/iMessage (plus web) that onboards people conversationally and proposes matches.

**Method.** Web research was done on 2026-10-07 by three research passes (dating, hiring, friends plus cross-app). Most legal and company facts were checked against primary pages: statutes, regulators, court documents and company newsrooms.
- Items that come only from secondary sources, or could not be checked, are marked **[UNVERIFIED]**.
- Items not researched in this pass are marked **[NOT RESEARCHED]**.
- Design recommendations (ontologies, rubrics, simulation designs, gates) are ours, not sourced.
- Several sources were reached only through search snippets because the page returned 403; those are noted inline.

None of this is legal advice. Every "regulatory must-have" below should be confirmed by counsel before launch.

General reciprocal-recommendation, graph and LLM-judge material is already in `docs/research/matching-and-graphs.md` and is not repeated here. This note adds what is specific to each domain.

Vocabulary reused from the PRD and the experience design:
- **Privacy scopes:** agent-private, matchable, shareable, opportunity-specific.
- **Consent-first probes:** ask about the activity before naming the person.
- **Attention budget:** limits on messages the Network starts.
- **Relay:** members message each other through the Network until both agree to swap numbers.
- **V14:** the share of active members who had a real value event in the last 14 days.
- **Human review of proactive matches** while each network is small.

---

## 0. Cross-cutting conclusions (read this first)

1. **Profiles do not predict dating chemistry, so dating optimizes for cheap, safe first meetings.**
   - Joel, Eastwick & Finkel (2017) could predict how much someone desires people in general, and how desired they are, but none of a person's unique desire for a specific partner.
   - Eastwick & Finkel (2008) found that preferences stated before a speed-dating event did not predict actual attraction.
   - So slop.date should use stated preferences as hard filters, use revealed behaviour and post-date feedback for learning, and get mutual yeses to a date quickly. Ditto, Amata and Known all converged on "the agent plans the date."
2. **Hiring is the only regulated decision of the three.**
   - An algorithm that ranks or screens candidates for NYC roles is likely an automated employment decision tool under NYC Local Law 144: bias audit, public summary, 10 business days' notice.
   - It also falls under the California FEHA automated-decision rules (in force since Oct 1, 2025), Illinois HB 3773 (Jan 1, 2026) and Colorado SB 26-189 (Jan 1, 2027).
   - Federal disparate-impact enforcement has been rolled back, but state, city and private-suit exposure has not.
   - peon.biz should launch with the agent as an **intro and logistics service with a human recruiter deciding**, keep scores away from employers, and budget for a bias audit before any ranking touches NYC candidates.
3. **Friendship needs repeated exposure, not one perfect match.**
   - Hall (2018): about 50 hours of time together to become a casual friend, about 90 for a friend, 200+ for a close friend.
   - So buddies.nyc should optimize for **repeat meetups of the same small group near home**. That is Timeleft's format plus Adams's "repeated, unplanned interaction," made recurring.
4. **Isolation between apps is a legal and trust requirement, not a nice-to-have.**
   - Norway's appeal court held that merely revealing someone uses Grindr discloses their sexual orientation.
   - Virginia, Colorado and Connecticut treat sexual orientation (and some, sex life) as sensitive data needing opt-in consent.
   - So no dating-side fact, including the fact that someone uses slop.date, may be visible to peon.biz or buddies.nyc, to their admins' default views, or to their matching.
5. **SMS delivery is a launch risk for dating specifically.**
   - Twilio rejects 10DLC campaigns whose website "hosts or links to … dating … content" (error 30953).
   - slop.date needs its own campaign, its own site, its own sender lines and probably a non-Twilio or RCS/iMessage path.
   - It must not share a campaign or linked website with the other two brands, or it can take them down with it.
6. **18+ across all three brands.**
   - Dating is legally and ethically adults-only. Hiring of 14–17 year-olds needs NY working papers and hazardous-job filters. Friend apps (Bumble BFF, Meetup, Timeleft) are 18+.
   - 18+ everywhere also avoids COPPA and the teen rules of the NY Child Data Protection Act.
   - This is stricter than The Network's 13+ policy; the brands should not inherit the 13–17 single-player tier.

---

# Part A: slop.date (dating)

## A1. Matchmaking goal and success metrics

**Goal.** Two adults who would each say yes meet in person, safely, and want to see each other again. Long-term relationships are the north star but are slow and sparse as a signal.

**Funnel metrics, in order of value:**

| Stage | Metric | Notes / benchmarks |
|---|---|---|
| Probe | Probe-yes rate per side | Consent-first: the activity and a shareable fact, before revealing the person |
| Mutual | Mutual-yes rate (both accept the intro) | The reciprocal success rate. RECON raised top-10 success from 26% to 45% by scoring both directions ([RECON](https://www.researchgate.net/publication/221140972_RECON_A_reciprocal_recommender_for_online_dating)) |
| Date | Match-to-date conversion within 14 days | Company claims: Known 80% of intros became dates in its SF beta ([TechCrunch](https://techcrunch.com/2025/12/19/known-uses-voice-ai-to-help-you-go-on-more-in-person-dates/)); Ditto targets 20% ([TFN](https://techfundingnews.com/ditto-9-2m-seed-peak-xv-ai-college-dates/)). No major app publishes this |
| Date quality | Both-sides "went well" (We Met-style follow-up) | Hinge's We Met asks after the date ([Refinery29](https://www.refinery29.com/en-us/2018/10/214128/hinge-we-met-feature-dating-app)); the 90% / 72% figures often quoted are [UNVERIFIED] |
| Second date | Second-date rate per first date | Primary signal of a good match; feeds the learner |
| Relationship | Self-reported exclusivity at 90 days; "paused because I met someone" | Slow, sparse; use as a holdout outcome |
| Safety | Reports per 1,000 dates; serious-incident rate; time to action on a report | Must be tracked from day 1 |

**Anti-metrics (things we must not optimize, or must cap):**
- Messages, swipes, time-in-app, or proposals sent. Proposals are not value (V14 rule).
- **Exposure concentration.** Share of likes or probes going to the top 10% most-desired members. Bruch & Newman (2018) show a strong, consistent desirability hierarchy, with most users messaging people about 25% more desirable than themselves ([Science Advances](https://www.science.org/doi/10.1126/sciadv.aap9815)).
- Ghosting rate after mutual yes, and late cancellations or no-shows (Amata pauses matching after two consecutive cancellations ([GDI](https://www.globaldatinginsights.com/featured/ai-dating-startup-amata-launches-with-6m-in-funding/))).
- Unsolicited-sexual-content reports, harassment reports, "felt unsafe" responses.
- Retention through artificial scarcity, or holding back good matches to keep subscriptions. FTC v. Match settled for $14M over deceptive "guarantees" and cancellation practices ([FTC](https://www.ftc.gov/legal-library/browse/cases-proceedings/match-group-inc-timeline-item-2025-08-12)).
- Churn because the member found a partner should count as a **success**, not churn.

## A2. Market and science review

### Reciprocal recommendation and two-sided markets
- **RECON (Pizzato et al., RecSys 2010).** Scoring both directions of interest raised top-10 success from 26% to 45% on an Australian dating site ([link](https://www.researchgate.net/publication/221140972_RECON_A_reciprocal_recommender_for_online_dating)).
- **Palomares et al. (2021), *Information Fusion* 69.** The standard survey of reciprocal recommender systems: users are the "items," and success requires both sides to accept ([ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1566253520304267), [arXiv](https://arxiv.org/abs/2007.16120)).
- **Hitsch, Hortaçsu & Ariely (2010), *AER* 100(1).** They estimated preferences from a dating site; stable matches predicted with Gale-Shapley fit observed matches well. Sorting comes from preferences, not search friction ([AEA](https://www.aeaweb.org/articles?id=10.1257%2Faer.100.1.130)).
- **Kanoria & Saban (2021), *Management Science* 67(10).** When evaluating partners is costly, a platform can cut wasted search by restricting actions, for example letting only one side propose (as Bumble does) or hiding quality signals ([INFORMS](https://pubsonline.informs.org/doi/10.1287/mnsc.2020.3794)).
- **Rios, Saban & Zheng (MSOM 2022/23).** Users who matched recently like less. Showing high-potential profiles when a user is most receptive produced **at least 27% more matches** in a pilot on a major US platform with capped daily views ([INFORMS](https://pubsonline.informs.org/doi/10.1287/msom.2022.1107), [EurekAlert](https://www.eurekalert.org/news-releases/964166)).
- **Bruch & Newman (2018).**
  - Covers heterosexual daters in four US cities.
  - Desirability rankings are consistent across cities. 21% of "reach-up" messages got replies.
  - Men's desirability rose with age to about 50; women's fell from 18 to 60.
  - Source: [Science Advances](https://www.science.org/doi/10.1126/sciadv.aap9815).
- **Attractiveness inequality on Tinder.** The often-cited Gini of 0.58 for likes received by men comes from a self-published, small-sample Medium analysis. Use it only as an illustration ([Medium](https://medium.com/@worstonlinedater/tinder-experiments-ii-guys-unless-you-are-really-hot-you-are-probably-better-off-not-wasting-your-2ddf370a6e9a)). Tinder says it retired Elo in 2019 [UNVERIFIED primary] ([secondary](https://www.capitalfm.com/lifestyle/tinder-elo-score/)).
- **Hinge Your Turn Limits** (global, Sep 2024). You cannot like new people while 8 or more replies are owed. Responsiveness rose 20% ([Hinge](https://hinge.co/newsroom/your-turn-limits)). This is congestion control in product form, and the attention budget does the same job.

### Stable matching vs recommendation; Hinge "Most Compatible"
- **Hinge Most Compatible (2018).**
  - One daily pick, using Gale-Shapley adapted to the stable-roommates variant so that same-sex and nonbinary pairings work.
  - Pairs were reported as 8x more likely to exchange numbers ([TechCrunch](https://techcrunch.com/?p=1668547), [The Hustle](https://thehustle.co/hinge-machine-learning-algorithm)).
  - Hinge's current help page describes it as based on "mutual preferences, recent activity, and shared patterns" without naming Gale-Shapley ([Hinge help](https://help.hinge.co/hc/en-us/articles/360011233073-What-is-Most-Compatible); snippet only, page returned 403).
- **Implication.**
  - An agent that sends one intro at a time is a centralised match mechanism.
  - Stability is useful as a **diagnostic** (count blocking pairs among active members) and as a congestion tool.
  - Run the engine as capacity-constrained max-weight selection with per-member caps, as already recommended in `matching-and-graphs.md`.
  - Use the stable-roommates framing for non-bipartite pools.

### What predicts compatibility
- **Joel, Eastwick & Finkel (2017), *Psych Science* 28.**
  - More than 100 self-report measures, across two speed-dating samples.
  - These predicted 4–18% of actor variance and 7–27% of partner variance, but **not** relationship-specific variance ([PDF](https://gwern.net/doc/psychology/2017-joel.pdf)).
- **Joel et al. (2020), *PNAS* 117(32).** 43 datasets of couples. The best predictors of relationship quality are relationship-specific perceptions (commitment, appreciation, sexual satisfaction, perceived partner satisfaction, conflict), which are only observable after a relationship exists ([PNAS](https://www.pnas.org/doi/10.1073/pnas.1917036117)).
- **Eastwick & Finkel (2008), *JPSP* 94.** Stated sex differences (looks vs earning prospects) did not show up in actual attraction, and stated preferences did not predict who people desired ([PDF](https://faculty.wcas.northwestern.edu/eli-finkel/documents/EastwickFinkel2008_JPSP.pdf)).
- **Finkel et al. (2012), *PSPI* 13(1).** There is no compelling evidence that matching algorithms work, and they likely can't in principle. Browsing many profiles can lead people to treat partners as commodities ([APS](https://www.psychologicalscience.org/publications/journals/pspi/online-dating.html)).
- **Fisman et al. (2006), *QJE* 121(2).** In a randomized speed-dating experiment, women weighted intelligence and race more; men weighted attractiveness more ([Columbia](https://academiccommons.columbia.edu/doi/10.7916/D8FB585Z)).
- **Design consequences:**
  - Hard filters come from stated dealbreakers.
  - Soft scoring should use the predictable parts: general "actor" and "partner" desirability, intent alignment (casual vs serious), logistics, and values the member stated as dealbreakers.
  - Learn from post-date feedback.
  - Do not market "compatibility science." It invites FTC deception risk, and the evidence does not support it.

### Curated and AI matchmakers (2024–2026)

| Company | Model | Facts |
|---|---|---|
| **Ditto** (closest analogue) | iMessage-only AI that plans one full date at a time for UC students | $9.2M seed led by Peak XV (Feb 2026); 42k users at the raise, about 25% via referral; targets 20% match-to-date ([TFN](https://techfundingnews.com/ditto-9-2m-seed-peak-xv-ai-college-dates/), [Yahoo](https://finance.yahoo.com/news/ditto-raises-9-2m-replace-140000935.html)). 150k signups [UNVERIFIED] |
| **Sitch** (NYC) | AI trained on a matchmaker's method; about 50-question onboarding by text or voice; manual profile review; group-chat intro after both say yes | Pay per match: 3 for $89.99, 5 for $124.99, 8 for $159.99; $5M seed ([TechCrunch](https://techcrunch.com/2025/06/25/sitch-wants-to-fuse-human-personality-and-ai-for-matchmaking), [CNBC](https://www.cnbc.com/2025/08/07/30-year-old-founder-is-using-ai-to-help-singles-find-love.html)) |
| **Keeper** (NYC) | 100+ data points at intake; AI does about 95% of filtering, with human verification | Success-based fee averaging about $50k (paid on milestones such as an 18-month relationship); $4M pre-seed; claims of 1.5M signups and that 1 in 10 first dates leads to marriage are company figures [UNVERIFIED] ([AlleyWatch](https://www.alleywatch.com/2025/12/keeper-ai-matchmaking-dating-relationship-science-jake-kozloski/)) |
| **Amata** (NYC, Oct 2025) | No swiping, no inbox; the AI picks venue and time | $16 token per date; chat opens 2 hours before the date; two consecutive cancellations pause matching for a week; $6M pre-seed ([GDI](https://www.globaldatinginsights.com/featured/ai-dating-startup-amata-launches-with-6m-in-funding/)) |
| **Known** (SF) | 26-minute voice-AI onboarding; 24 hours to accept an intro, 24 hours to schedule; restaurant suggestions and calendar sync | $30 per successful date; 80% of intros became dates in the SF beta (company claim); $9.7M ([TechCrunch](https://techcrunch.com/2025/12/19/known-uses-voice-ai-to-help-you-go-on-more-in-person-dates/)) |
| **Overtone** (Hinge founder) | Voice- and audio-led curated intros, no feed | $18M from Match Group, FirstMark and Pace (Jul 2026); launching later in 2026 ([TechCrunch](https://techcrunch.com/2026/07/14/the-founder-of-hinge-raised-18m-to-build-a-new-ai-dating-service-overtone/)) |
| **Date Drop** (Stanford) | Weekly algorithmic "drops" from about 50 questions | ([Stanford Daily](https://stanforddaily.com/2025/10/09/matchmaking-platform-date-drop-weekly/)) |
| **Volar** | AI avatars run the first chat before humans take over | $2M; current status [UNVERIFIED] ([WashTimes](https://www.washingtontimes.com/news/2024/jan/23/volar-dating-new-matchmaker-app-sends-artificial-i/)) |
| **Incumbents** | Hinge Convo Starters (Dec 2025), Tinder Chemistry (AI Q&A plus opt-in camera-roll scan; "a drop or two" instead of a swipe deck), Bumble "Bee" AI matchmaker (Mar 2026), Grindr AI Wingman | [Hinge](https://hinge.co/newsroom/convo-starters), [TC Tinder](https://techcrunch.com/2025/11/05/tinder-to-use-ai-to-get-to-know-users-tap-into-their-camera-roll-photos/), [TC Bumble](https://techcrunch.com/2026/03/12/bumble-introduces-an-ai-dating-assistant-bee/), [Grindr IR](https://investors.grindr.com/news/news-details/2025/Grindr-Unveils-2025-Product-Roadmap-Including-Six-New-Intent-Based-Travel-and-AI-Personalization-Products/default.aspx) |

**Takeaways:**
- The 2025–26 category has converged on four things: conversational intake, few curated intros, the agent planning the date, and payment per date or per outcome.
- slop.date is not differentiated by "AI over text," since Ditto, Sitch and others already do that. It needs a wedge: geography or radius flexibility, the multi-app identity, or a specific community.

### Date-planning features
- Amata, Known and Ditto plan the venue and time themselves. Known also syncs calendars.
- Tinder Double Date (June 2025) lets you pair with up to 3 friends.
  - About 90% of its profiles came from users under 29, and users sent about 25% more messages per match.
  - It became a "Mode" in Sep 2025 ([Tinder](https://www.tinderpressroom.com/2025-06-17-Tinder-Launches-Double-Date-The-New-Way-to-Make-Connections-with-Your-Bestie), [Modes](https://www.tinderpressroom.com/2025-09-10-Tinder-Introduces-Modes-Starting-with-Double-Date-Mode-and-College-Mode)).
- Bumble Share Date (Mar 2025) sends date details to a trusted contact ([Engadget](https://www.engadget.com/apps/bumble-adds-id-verification-and-other-safety-features-170228333.html)).
- **Engine fit:** The Network's planner (activity, venue, availability) already exists. For dating it should:
  - restrict to public venues;
  - default to short first dates (coffee or a drink, about 1 hour);
  - offer a "share my date" message to a trusted contact;
  - send a check-in text after the date.

### Safety
- **Identity and liveness.**
  - Tinder Face Check (Oct 2025) is a mandatory video-selfie liveness check for new users in California and expanding US states. It also detects the same face across accounts and keeps an encrypted face vector. Tinder reports over 60% less exposure to likely bad actors and over 40% fewer reports ([Tinder](https://www.tinderpressroom.com/2025-10-22-Tinder-to-Expand-Facial-Verification-Feature-Across-the-U-S-,-Setting-a-New-Standard-for-Dating-Safety)). Vendor [UNVERIFIED].
  - Bumble ID verification (Mar 2025) uses a government ID plus a selfie through Veriff, with a badge and a "verified only" filter ([Engadget](https://www.engadget.com/apps/bumble-adds-id-verification-and-other-safety-features-170228333.html)).
- **Scam and fake-profile detection.**
  - Bumble's Deception Detector automatically blocks up to 95% of spam and scam accounts, and reports fell 45% ([TechCrunch](https://techcrunch.com/2024/02/05/bumbles-new-ai-tool-identifies-and-blocks-scam-accounts-and-fake-profiles)).
  - Bumble's Private Detector blurs nude images and was open-sourced in 2022 ([secondary](https://en.wikipedia.org/wiki/Bumble)).
- **Romance-scam scale (FTC).**
  - $1.14B lost in 2023 ([FTC](https://www.ftc.gov/business-guidance/blog/2024/02/love-stinks-when-scammer-involved)).
  - About $1.16B in the first nine months of 2025 ([secondary](https://www.centraloregondaily.com/news/consumer/ftc-romance-scams-1-billion-losses-2025/article_c32c7fc5-c3a9-4cdc-8f4b-c80293080267.html)); full-year 2025 total [UNVERIFIED].
  - Nearly 60% of 2025 romance-scam losses started on social media rather than dating apps ([FTC](https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2026/04/reported-losses-scams-social-media-eight-times-higher-2020)).
- **Sexual assault.** The Markup/CalMatters "Dating Apps Reporting Project" (Feb 2025) found:
  - Match Group's internal "Sentinel" logged hundreds of assault reports a week by 2022.
  - Banned users could rejoin with the same phone, name, birthday and photos.
  - The promised transparency report was never released.
  - Six survivors sued in Dec 2025 ([Markup](https://themarkup.org/investigations/2025/02/13/dating-app-tinder-hinge-cover-up), [lawsuit](https://themarkup.org/impact/2025/12/16/dating-app-rape-survivors-file-lawsuit-accusing-hinge-tinder-of-accommodating-rapists)).
  - **Lesson:** ban evasion is the core failure. Ban by phone, face vector, device and payment fingerprint, not by account.
- **Sex-offender screening.** Match.com has screened registries since 2011, but the free apps did not ([ProPublica](https://www.propublica.org/article/tinder-lets-known-sex-offenders-use-the-app-its-not-the-only-one)). Tinder's Garbo background-check partnership ended in Aug 2023 ([TechCrunch](https://techcrunch.com/2023/08/17/match-groups-background-check-partner-garbo-ends-its-partnership/)).
- **Laws that apply to an "online dating service":**
  - **New York Internet Dating Safety Act (2012):** safety notices ([NY Senate](https://www.nysenate.gov/legislation/bills/2011/S3618/amendment/A)). NY A3323 (2025, pending) would require identity verification ([NY Senate](https://www.nysenate.gov/legislation/bills/2025/A3323)).
  - **New Jersey Internet Dating Safety Act:** safety-awareness notice, plus a bold all-caps disclosure if no criminal background screening is run ([NJ](https://www.njconsumeraffairs.gov/statutes/internet-dating-safety-act.pdf)).
  - **Colorado SB24-011:** any dating service with Colorado users must publish a safety policy (C.R.S. 6-1-731.5, since Jan 1, 2025) ([CO](https://content.leg.colorado.gov/sites/default/files/2024a_011_signed.pdf)).
  - **California SB 1390 (2026):** background checks; appears stalled [UNVERIFIED] ([link](https://calmatters.digitaldemocracy.org/bills/ca_202520260sb1390)).
  - **Federal Romance Scam Prevention Act (H.R. 2481 / S. 841):** dating services must notify users who were messaged by an account later banned for fraud. It passed the Senate by unanimous consent on Sep 23, 2026, after passing the House. Whether it has been signed is [UNVERIFIED]. There would be a 1-year compliance window ([Blackburn](https://www.blackburn.senate.gov/2026/9/senate-unanimously-passes-blackburn-s-bipartisan-bill-to-prevent-romance-scams), [Congress.gov](https://www.congress.gov/bill/119th-congress/house-bill/2481/all-info)).
  - **Build for it now:** keep a log of who messaged whom through the relay, so that ban notifications are possible.

### Age: 18+ and how to verify it
- **App-store age laws.**
  - Utah's App Store Accountability Act puts obligations on stores and developers from May 6, 2026 ([Inside Privacy](https://www.insideprivacy.com/united-states/state-legislatures/utah-enacts-app-store-accountability-act/)).
  - Texas SB 2420 was enjoined on Dec 23, 2025, but the Fifth Circuit stayed the injunction on June 10, 2026, so it is now enforceable ([MoFo](https://www.mofo.com/resources/insights/251111-texas-targets-app-stores-with-new-accountability-law), [DataGuidance](https://www.dataguidance.com/news/texas-district-court-issues-injunction-barring-app)).
  - These target apps distributed through app stores. An SMS and web service is probably outside them, but this is counsel's call.
- **Industry baseline.**
  - In the UK under the Online Safety Act, Tinder and Hinge use Yoti facial age estimation, with an ID document as fallback ([GDI](https://www.globaldatinginsights.com/featured/uk-dating-apps-adopt-age-verification-ahead-of-online-safety-law/)).
  - **Recommendation:** self-declared date of birth at intake, then a selfie liveness check plus age estimation (Yoti, Persona or Veriff) **before the first intro**, with an ID document as fallback when the estimate is within a buffer, e.g. under 23.
  - Store only the pass or fail result, the estimate band and the liveness vector hash.

### Gender and orientation preference modeling
- **What others offer.**
  - Hinge has three base genders (Man, Woman, Non-binary), each with 50+ more specific identities or free text. Users pick every gender they want to date, and showing gender or pronouns is optional ([Hinge help](https://help.hinge.co/hc/en-us/articles/36311196515731-Gender-and-Sexuality-on-Profiles)).
  - OkCupid offered 22 gender identities and 13 orientations from 2014 ([Advocate](https://www.advocate.com/politics/media/2015/06/29/okcupid-launches-new-gender-inclusive-identity-project)).
- **Model.** Store three things separately:
  - (a) **matching gender**, a coarse set used for filtering;
  - (b) **identity description**, free text and display-optional;
  - (c) **seeking genders**, a set.
- **Rule.** Both members must be in each other's seeking set. This check is symmetric and hard.
- **Engine.** Use non-bipartite (stable-roommates style) selection so that queer pools are not second-class.
- **Privacy.** Orientation is sensitive data (see D5). The agent should ask it neutrally ("who are you hoping to meet?") and never infer it.

### Race filters: the ethics debate
- Grindr removed its ethnicity filter in June 2020 after years of criticism ([Metro Weekly](https://www.metroweekly.com/2020/06/grindr-will-remove-controversial-ethnicity-filter-after-years-of-complaints/), [Vice](https://www.vice.com/en_us/article/z3e3y8/grindr-still-hasnt-deleted-its-ethnicity-filter-despite-promise)).
- Hutson, Taft, Barocas & Levy (2018), "Debiasing Desire" (CSCW): platform design, including race filters and collaborative filtering that reproduces majority preferences, shapes desire and can entrench sexual racism. They propose structural interventions that respect autonomy ([arXiv](https://arxiv.org/abs/1809.01563)).
- Fisman et al. (2006) found women weighted race more in speed dating.
- **Recommendation:**
  - Offer **no race or ethnicity filter** and no "ethnicity" field used for matching.
  - Members may say that a shared culture, language, religion or faith practice matters to them. These are allowed as stated preferences, because they are often central to people's lives, especially for minority communities.
  - These preferences should be soft unless the member explicitly marks them as a dealbreaker. They must never be inferred from photos or names, and never used as a proxy for race.
  - The learner must not pick up race from photos or names. Audit exposure by any demographic data a member voluntarily provides.

### Distance and radius UX
- **What others do.**
  - Tinder's 100-mile maximum and Passport (paid) are commonly reported [UNVERIFIED].
  - Bumble Travel Mode is Premium-only and lasts 7 days ([Bumble](https://bumble.com/en-us/features/travel-mode/)).
  - Hinge's distance limit is a soft preference unless marked as a dealbreaker ([Hinge help](https://hingeapp.zendesk.com/hc/en-us/articles/360011321613-Why-do-I-only-see-profiles-that-are-far-away)). A 100-mile default is [UNVERIFIED].
- **Location leakage.** KU Leuven (2024) used "oracle trilateration" through distance filters to locate users of Bumble, Hinge, Happn and others to within about 2 m. The fix is rounding to about 1 km ([TechCrunch](https://techcrunch.com/2024/07/31/bumble-and-hinge-allowed-stalkers-to-pinpoint-users-locations-down-to-2-meters-researchers-say)).
- **Recommendation for zip + X miles:**
  - Store the zip centroid or a coarse geohash. Never GPS for matching.
  - Never echo exact distances. Use bands ("about 5 miles", "same borough").
  - Minimum radius of 2 miles; radius options of 5/10/25/50/100.
  - Multi-city membership with an "I'm in Chicago Oct 10–14" travel window that expires automatically.
  - Distance as a travel-time-weighted soft score inside the hard radius.

## A3. Ontology (slop.date)

**Entities and roles:**
- `Member` (dater). Every member is both seeker and candidate.
- `DatingProfile`: an app-scoped projection of the shared person record.
- `Preference`: hard or soft.
- `Intro`: probe to mutual yes to relay thread.
- `Date`: plan, venue, time, status, check-in.
- `Feedback`: per side, private.
- `SafetyReport`.
- `Verification`: age, liveness, ID.
- `Venue`: public only.
- `TravelWindow`.

**Facets:**
- **Identity and logistics:** age (verified), matching gender, seeking genders, location (zip centroid plus radius, or a city set), travel windows, availability.
- **Intent:** casual / dating / long-term / marriage; timeline; monogamy or ENM; kids (have, want); open to long distance.
- **Lifestyle:** drinking, smoking, cannabis, faith practice, diet, pets, schedule (night owl or early riser), activity level.
- **Interests and conversation:** prompts, "a great first date is…", humor style.
- **Values:** stated dealbreakers only (politics as a stated dealbreaker is common and allowed if self-reported).
- **Photos.** Optional for the SMS MVP, but needed for verification and, realistically, for mutual yes.

**Hard constraints** (never compensable):
- Both 18+ and verified before the first intro.
- Mutual gender and seeking fit.
- Inside both members' radius or city set.
- Both members' age ranges contain each other.
- Both members' stated dealbreakers satisfied (kids, smoking, monogamy and others they choose).
- Neither has blocked or reported the other.
- Not the same person as a banned identity.
- Not previously introduced.
- Neither has a safety hold.
- Intent is compatible: casual vs marriage-track is hard unless either marks "open."

**Soft preferences:** age within range (closeness to the middle), distance and travel time, lifestyle overlaps, interests, height and similar items stated as preferences, revealed-preference model, exploration.

**Never used for matching:**
- Race or ethnicity (no field, no filter, no inference).
- Inferred orientation.
- Health status, including HIV and STI status (Grindr precedent, see D5).
- Immigration status.
- Income, unless the member volunteers a stated preference about lifestyle, and even then never as a hard filter shown to others.
- Disability, unless the member chooses to share it.
- Anything from peon.biz or buddies.nyc.
- Attractiveness scores derived from photos. A learned "desirability" can exist internally only for congestion control, never shown and never used to sort exposure downward.
  - **Superseded for slop.date (founder decision 2026-10-08):** photo ratings (face, body, overall, body type) are now used in matching, as a soft similarity term and against stated or revealed body-type preferences, and are never shared with members. Exposure is still never sorted downward by them (the congestion and exposure-debt controls are unchanged). See docs/results/2026-10-08-slop-pack.md, iteration 4.

## A4. Matching specifics (slop.date)

- **Reciprocal, pair-based.** Score by harmonic mean or minimum of the two directional probabilities (RECON). Exception: double dates (Tinder Double Date shows demand) as a post-MVP group format.
- **Consent flow** (consent-first probe, then double opt-in):
  1. The member with the live want gets a probe: a short anonymised description of the other person (age band, neighborhood band, one shareable fact, intent) and optionally one photo.
  2. On yes, the other side gets the same.
  3. On mutual yes, the agent proposes 2–3 time slots and a public venue (the Amata/Known pattern).
  4. Members talk through the relay. Numbers are shared only when both ask.
  - Names and photos together appear only at mutual yes. Decide whether photos go in the probe; the evidence says looks drive yes/no, so a photo in the probe saves wasted mutual-yes rounds.
- **Attention budget.**
  - At most 1 active intro being scheduled per member at a time, with a cap of 2–3 probes per week.
  - A Hinge-style "your turn" limit: no new probes while a mutual-yes is waiting on you.
  - Known's 24 hours to accept plus 24 hours to schedule is a good default expiry.
- **Geo.** Radius from the zip centroid, or a city set, or a travel window. Score by estimated travel time inside the hard radius. For cross-city or long-distance members, intros only when both opted into long distance or travel.
- **Fairness and exposure.**
  - Congestion control: per-member caps on incoming probes per week, so desirable members are not flooded.
  - Exposure floors so every verified member gets probes, as in the Rios-Saban-Zheng receptivity timing.
  - Track a Gini of probes received, split by any demographic data members volunteer.
  - Do not "boost" for pay. That turns fairness into a product.
- **LLM judge rubric** (finalists only; 1–5 per dimension plus a veto):
  1. All hard constraints satisfied (veto if not).
  2. Intent alignment.
  3. Mutual-want plausibility from each side's stated reasons.
  4. Logistics: overlapping availability, travel time.
  5. Conversation hook: is there a specific, shareable reason this pair might enjoy talking?
  6. Safety flags (any red flags in either thread; veto).
  7. Explanation uses only shareable evidence (veto).
  - Ask the judge to explain before scoring, swap the order of the pair, and calibrate it against reviewer labels (see `matching-and-graphs.md`).
- **Explanation norms.**
  - One sentence, built only from shareable facts, framed as a guess, never as a score ("You both said a perfect Sunday is a long walk and a bookstore. She's in Park Slope.").
  - Never "92% compatible."
  - Never reveal why the other person said no; declines are silent.

## A5. Simulation design (slop.date)

- **Personas with hidden truth.**
  - **Observable facets:** age, gender, seeking, zip, intent, lifestyle, interests, availability.
  - **Hidden variables:**
    - `attractiveness_to_others`, drawn so that the population reproduces Bruch-Newman style hierarchies.
    - Per-persona `taste` vectors over the observable facets.
    - `true_intent`, which may differ from stated intent.
    - `flakiness`, `responsiveness` and `receptivity`, which is lower after a recent match (Rios-Saban-Zheng).
    - `stated_vs_revealed_gap`: how much stated preferences mispredict actual yes.
- **Oracle for a good match.** P(date goes well) = σ( a·attraction_ij + a·attraction_ji + b·intent_alignment + c·compatibility(values, lifestyle) − d·travel + ε_chemistry ).
  - The chemistry noise ε is large and pair-specific, so that profile-based predictability is capped near the Joel 2017 levels.
  - Second date requires both sides' post-date utility to clear their thresholds.
  - Acceptance of a probe follows a calibrated choice model on hidden utilities, not on LLM free choice.
- **Adversaries:**
  - **Romance scammer:** fast escalation, moves off-platform, asks for money or crypto, stock photos, multiple accounts.
  - **Catfish:** photos don't match the liveness check.
  - **Underage applicant:** claims 18, estimate says 16.
  - **Harasser:** sexual content after a mutual yes.
  - **Ban evader:** re-registers with a new number and the same face.
  - **Married or "taken" profile.**
  - **Bot farm:** the IRL failure, 95% bots.
  - **Mass-prober** trying to game exposure.
- **Scenarios:**
  - **Pool imbalances:** cities that are 70/30 men to women; a small queer pool in a suburban zip.
  - **Geography:** sparse rural radii; multi-city traveler; long-distance opt-in.
  - **Congestion and supply:** a "superstar" flooded by probes; cold start with 30 members in a city.
  - **Behaviour:** a holiday surge.
  - **Safety:** one member reports another after a date.
- **Evaluation metrics:**
  - Funnel: mutual-yes rate, date rate, second-date rate (oracle), wasted-yes rate (one side yes, other no).
  - Spread: probes-received Gini, share of verified members with at least one mutual yes in 14 days (V14 analogue).
  - Safety: time to detect each adversary, adversary-contact exposure (number of real members a scammer reached before ban), zero underage intros, zero hard-constraint violations.
- **Launch gates** (simulator):
  - 0 hard-constraint violations and 0 unverified-age intros.
  - 0 private-field leaks in explanations.
  - Scammer median reach ≤ 1 member before detection.
  - Ban-evasion catch rate ≥ 95% on same-face reentry.
  - Mutual-yes rate ≥ 25% of probes.
  - Probes-received Gini below a set threshold, at 2x the cold-start pool.
  - Then shadow mode with human review of every intro.

## A6. Onboarding (slop.date)

**First conversation (about 10 minutes of texting, with one question per turn where possible):**
1. Name or nickname and date of birth (for the 18+ gate); "you'll verify with a quick selfie before your first intro."
2. Where: zip code, or a list of cities; radius ("how far would you go for a first date?").
3. Who you're hoping to meet (genders) and your own gender. Neutral wording; free text allowed.
4. Age range you're open to.
5. What you're looking for: intent and timeline.
6. Two or three dealbreakers (kids, smoking, monogamy, faith, politics, as the member chooses).
7. "Tell me about a great first date" or "what are you like on a Sunday?" This gives shareable hooks.
8. Usual availability for dates (weeknights or weekends).
9. Photos: 2–4, via MMS or a web link, plus the liveness or age check link.
10. Safety terms, the dating-safety notice, and consent to the relay.

**Learned later:** revealed taste (from probe yes/no), communication style, lifestyle details, post-date feedback, flakiness, preferred venues, how real the stated dealbreakers are ("you said under 35, but said yes to two 37-year-olds; want me to widen it?" A guess-and-confirm question; never widen silently).

## A7. Risks and must-haves before launch (ranked)

1. **Sexual assault and violence after an intro.**
   - Verified age plus liveness for everyone before the first intro.
   - Ban by person, not account (phone, face vector, device).
   - Public venues only for planned dates.
   - Share-my-date with a trusted contact, plus a post-date check-in.
   - 24/7 report path by SMS keyword with human triage, and a documented response playbook.
   - Learn from the Markup findings.
2. **Minors.** Age assurance before matching; a buffer for ID fallback.
3. **Romance scams and fake profiles.**
   - Scam classifier on relay messages: money, crypto, gift cards, moving off-platform, investment talk.
   - Liveness check; rate limits on new accounts; a "we'll never ask you for money" message.
   - Ban notifications to contacts (prepares for the Romance Scam Prevention Act).
4. **SMS deliverability and carrier rejection** of dating content (D4). This blocks launch if unsolved.
5. **Sensitive-data handling.** Orientation, sex life and HIV status are sensitive under VA, CO and CT law and the Grindr precedent. Opt-in consent, separate storage scope, no sharing with ad or AI vendors (FTC Match/OkCupid 2026 order, D5).
6. **Dating-service statutes.** NY and NJ safety notices (NJ's all-caps no-background-check disclosure), Colorado's published safety policy.
7. **Deceptive marketing.** No compatibility guarantees, easy cancel if paid (FTC v. Match, ROSCA).
8. **Location leakage.** Coarse geo, distance bands.

---

# Part B: peon.biz (hiring)

## B1. Matchmaking goal and success metrics

**Goal.** Qualified candidates and real, verified employers get to an interview quickly; hires happen and stick; both sides would use it again.

| Stage | Metric | Benchmarks |
|---|---|---|
| Intro | Mutual-interest rate (candidate yes and employer yes) | |
| Screen | Intro-to-interview rate | Ashby/Gem Q1 2026: 11.7 interviews per hire for business roles, 17.6 for technical; about 10.4% and 7.3% of interviewed candidates get offers [secondary] ([Gem](https://www.gem.com/blog/key-takeaways-from-the-2026-recruiting-benchmarks-report)) |
| Offer | Interview-to-offer rate, offer acceptance | Offer acceptance about 84% business, 73% technical [secondary] |
| Hire | Hires; time-to-fill vs the 44-day median | SHRM 2025 median time-to-fill 44 days; average cost per hire $5,475 for non-executives [secondary] ([SHRM](https://www.shrm.org/about/press-room/shrm-releases-2025-benchmarking-reports--how-does-your-organizat)) |
| Retention | 90-day and 1-year retention; hiring-manager satisfaction | Median 90-day new-hire turnover about 3.4% [vendor] ([HRBench](https://www.hrbench.com/resource/learn/90-day-new-hire-turnover)) |
| Quality of hire | Composite: early performance, ramp time, retention, manager satisfaction | No standard formula |

**Anti-metrics:**
- Applications sent or candidates "submitted" per role. Volume is the recruiting industry's disease.
- Candidate time wasted: intros to roles that were already filled, or ghosting after an interview. Measure candidate-reported ghosting.
- **Adverse impact.** Selection-rate ratios by protected group at each automated stage (four-fifths check), even where federal enforcement is paused.
- Scam-employer exposure: candidates contacted by a fake employer before ban.
- Concentration: a few employers getting all the top candidates, or the same candidates getting all the interviews (congestion, as in the LinkedIn ReCon work).

## B2. Market and science review

### Matching: skills ontologies and two-sided job recommendation
- **ESCO** (EU skills and occupations): v1.2.0 (May 2024) has 3,039 occupations and 13,939 skills in 28 languages. v1.2.1 (Oct 2025) per a search snippet [UNVERIFIED] ([ESCO](https://esco.ec.europa.eu/en/news/esco-v12-live)).
- **O\*NET** (US): database release 30.0 (Aug 2025); Web Services API v2.0 since Nov 20, 2025; 1,016 occupation titles, 923 with full data ([O*NET](https://services.onetcenter.org/whatsnew), [releases](https://www.onetcenter.org/db_releases.html)).
- **Lightcast Open Skills:** about 32–35k skills, updated every two weeks. Commercial API use reportedly needs a license since Apr 2026 [UNVERIFIED] ([Lightcast](https://lightcast.io/open-skills), [secondary](https://jobspipe.dev/blog/lightcast-api)).
- **Embeddings:** TechWolf JobBERT v2/v3 (open, title and skill matching) ([HF](https://huggingface.co/TechWolf/JobBERT-v2), [arXiv](https://arxiv.org/pdf/2505.24640)); TalentCLEF 2025/26 benchmarks against ESCO ([arXiv](https://arxiv.org/pdf/2506.19058)).
- **Recommendation and congestion:**
  - RecSys Challenge 2016/2017 on XING job data, with the 2017 edition focused on cold start ([2016](https://dl.acm.org/doi/10.1145/2987538.2987544), [2017](http://2017.recsyschallenge.com/)).
  - LinkedIn's job recommendation system ([RecSys 2017](http://www-cs-students.stanford.edu/~kngk/papers/personalizedJobRecommendationSystemAtLinkedIn-RecSys2017.pdf)).
  - ReCon (RecSys 2023) spreads job recommendations to reduce congestion ([arXiv](https://arxiv.org/pdf/2308.09516)).
  - Reciprocal job recommendation (2024) ([arXiv](https://arxiv.org/pdf/2409.10992)).
- **Horton (JOLE 2017), oDesk field experiment.** Algorithmic recruiting suggestions raised fill rates 20% for technical jobs, without crowding out other applicants, and helped most for jobs likely to get few applicants ([RePEc](https://ideas.repec.org/a/ucp/jlabec/doi10.1086-689213.html)).
- **Design.**
  - Map titles and free text to O\*NET occupation codes and ESCO or O\*NET skills, using an LLM extractor plus an embedding nearest-neighbour step.
  - Match on skills × seniority × logistics.
  - The agent's comparative advantage is finding the right people for **under-applied** roles, which is exactly where Horton found the gains.

### Recruiter workflows
- **The standard workflow:** intake (role kickoff with the hiring manager), sourcing, outreach, screen, submittal to the hiring manager, interview loop, debrief, offer, close, onboarding.
- **Agent fit.** The agent can own intake, outreach, the first screen as a conversation (not a scored assessment), scheduling and follow-up. A human recruiter or hiring manager owns the selection decisions. This split is also the main legal lever (B2 legal).

### AI recruiting agents (2026 state)
- **Mercor:**
  - $10B valuation (Series C, Oct 2025). Talks at $20B (Jul 2026) are not confirmed as closed [UNVERIFIED].
  - About $2B gross run-rate (secondary).
  - It moved from a recruiting marketplace to an expert-contractor supplier for AI training data ([TechCrunch](https://techcrunch.com/2026/07/09/mercor-is-in-talks-for-a-20b-valuation/), [Bloomberg](https://www.bloomberg.com/news/articles/2026-07-09/ai-training-startup-mercor-discusses-20-billion-valuation)).
  - Lesson: AI-vetted talent supply found its best market with AI labs, not employers.
- **Paraform:** a recruiter marketplace with split fees; $40M Series B (Mar 2026); bootstrapped supply with recruiters laid off in 2022–23 ([Axios](https://www.axios.com/pro/all-deals/2026/03/18/paraform-ai-recruiting-series-b), [Frontlines](https://www.frontlines.io/the-story-of-paraform-building-the-future-of-recruiting-marketplaces/)).
- **Juicebox (PeopleGPT):** AI sourcing; $80M Series B at $850M (Mar 2026); 5,000+ customers ([BusinessWire](https://www.businesswire.com/news/home/20260310781820/en/Juicebox-Raises-$80M-at-$850M-Valuation-to-Help-Businesses-Reach-Top-Talent-Before-Anyone-Else-Does)).
- **LinkedIn Hiring Assistant:**
  - Globally available in English since about Sep 2025 ([LinkedIn](https://business.linkedin.com/hire/hiring-assistant)).
  - "Hiring Assistant 2" was announced in late Sep 2026 and rolls out from Nov 2026, per trade press [UNVERIFIED with LinkedIn] ([HR Brew](https://www.hr-brew.com/stories/linkedin-announces-its-next-generation-recruiter-agent)).
- **Indeed:** Career Scout (seekers) and Talent Scout (employers), launched Sep 10, 2025 ([Indeed](https://www.indeed.com/news/releases/indeed-introduces-new-suite-of-hiring-products-career-scout-talent-scout-premium-sponsored-jobs-and-indeed-connect)).
- **Workday:** bought HiredScore (2024), closed Paradox (Oct 2025) and agreed to buy Sana ([SEC](https://www.sec.gov/Archives/edgar/data/1327811/000132781125000187/wday-09162025x991sunflower.htm)).
- **Litigation against AI hiring vendors:**
  - ***Mobley v. Workday*** (N.D. Cal.):
    - An age-discrimination group (40+) was preliminarily certified on May 16, 2025 and expanded to HiredScore on Jul 7, 2025.
    - The motion to dismiss was mostly denied on Jun 22, 2026, and an early appeal was denied on Jul 2. Discovery is ongoing.
    - The outcome of the Sep 14, 2026 hearing is [UNVERIFIED] ([Duane Morris](https://blogs.duanemorris.com/classactiondefense/2026/06/24/california-federal-court-grants-in-part-and-denies-in-part-workdays-motion-to-dismiss-in-mobley-v-workday/)).
    - Vendors can be liable as the employer's "agent."
  - ***Kistler v. Eightfold AI*** (N.D. Cal. 4:26-cv-01768):
    - Claims AI applicant scores and profiles are "consumer reports" under the FCRA.
    - The motion to dismiss is fully briefed; no ruling found [UNVERIFIED] ([Ogletree](https://ogletree.com/insights-resources/blog-posts/groundbreaking-lawsuit-tests-whether-ai-hiring-tools-trigger-fcra-compliance/)).

### Legal: federal
- **Statutes unchanged.** Title VII (race, color, religion, sex including orientation and gender identity, national origin), ADEA (40+), ADA (disability, plus reasonable accommodation, which applies to the agent's own screening conversation).
- **EEOC AI guidance removed.** The EEOC took down its 2023 Title VII and 2022 ADA AI guidance around Jan 27, 2025 ([Cooley](https://www.cooley.com/news/insight/2025/2025-02-21-gone-but-not-forgotten-federal-laws-still-apply-despite-guidance-disappearance-act)).
- **Disparate impact being dismantled federally.**
  - EO 14281 (Apr 23, 2025) directs agencies to eliminate disparate-impact liability "to the maximum degree possible."
  - A DOJ legal opinion (Jun 9, 2026) concludes the EEOC's disparate-impact rules, including the Uniform Guidelines, are unconstitutional; it does not bind courts ([S&C](https://www.sullcrom.com/insights/blogs/2026/June/DOJ-Issues-Opinion-Disparate-Impact-Liability)).
  - The EEOC has rulemakings listed to rescind parts of the Uniform Guidelines (RIN 3046-AB43, 3046-AB45) ([reginfo](https://www.reginfo.gov/public/do/eAgendaViewRule?pubId=202510&RIN=3046-AB43)). OPM removed its references on Jul 31, 2026 ([Federal Register](https://www.federalregister.gov/documents/2026/07/31/2026-15586/removal-of-references-to-the-uniform-guidelines-on-employee-selection-procedures-in-federal)).
  - Final EEOC rescission [UNVERIFIED].
- **Practical effect.**
  - Federal agency risk is low.
  - Disparate impact remains in Title VII as Congress wrote it, so private suits continue.
  - It also remains under NYC, NY State, California and Illinois law.
- **The four-fifths rule** (29 CFR 1607.4(D)): a group selected at less than 80% of the rate of the highest group indicates adverse impact.
  - Keep computing it. NYC LL144 requires impact ratios anyway.
- **Proxies to keep out of models:**
  - zip code (explicitly banned as a proxy in Illinois HB 3773);
  - graduation year and years of experience used as an age proxy (cap "years of experience" at a role-relevant minimum; never use a maximum);
  - employment gaps (disability, caregiving, sex);
  - names, photos, voice;
  - school prestige (race and class proxy; allow only when the employer states a credential requirement);
  - commute distance used as a soft rank (zip proxy; use it only as a candidate-set hard filter that the **candidate** sets).

### NYC Local Law 144 (automated employment decision tools): current status
- **Requirements.**
  - An AEDT is a computational process that issues a simplified output (score, classification, recommendation) used to substantially assist or replace discretionary hiring or promotion decisions for NYC jobs.
  - It requires a bias audit by an independent auditor within one year before use, a published summary of the results (selection or scoring rates and impact ratios by sex, race/ethnicity and intersectional categories), and notice to candidates at least **10 business days** before use, including the job qualifications and characteristics it assesses and how to request an alternative process.
  - In force since Jan 1, 2023; enforced since Jul 5, 2023 ([DCWP rule](https://rules.cityofnewyork.us/rule/automated-employment-decision-tools-updated/)).
- **Enforcement.**
  - The NY State Comptroller's audit (Dec 2, 2025) found DCWP enforcement "ineffective": only 2 complaints in two years, and DCWP found 1 violation among 32 companies where auditors found at least 17 potential ones.
  - DCWP agreed to proactive enforcement ([OSC](https://www.osc.ny.gov/state-agencies/audits/2025/12/02/enforcement-local-law-144-automated-employment-decision-tools)).
  - Expect more enforcement, not less.
- **2026 changes.** Local Law 25 of 2026 covers city agencies only. No City Council amendment or new DCWP rule for private employers was found. A rumoured Jan 1, 2027 change is [UNVERIFIED].
- **Pending NY State bills, none enacted:** S4394A, S10147, A9601 (meaningful human review), S9028. The AI Labor Information Act (S.8706B/A.9581B) passed the legislature in June 2026; whether it was signed is [UNVERIFIED] ([NY Senate](https://www.nysenate.gov/legislation/bills/2025/S10147)).
- **Implication for peon.biz.** If the agent ranks, scores or shortlists candidates for NYC roles and the employer relies on it, it is likely an AEDT, and the **employer** must have a bias audit and give notice. As a vendor, we would have to supply the audit.
- **Ways to stay outside it, or comply:**
  - (a) The agent presents **unranked**, criteria-matched candidates that the human selects from, and gives no score. Whether this escapes "substantially assist" is a legal question.
  - (b) Commission a bias audit before NYC launch and publish it. Candidate demographics would have to be collected voluntarily and separately from matching, purely for audit.
  - Recommendation: plan for (b). The audit needs data, so collect voluntary self-ID from day 1 in a separate, matching-blind store.

### Illinois
- **AI Video Interview Act** (820 ILCS 42, 2020): notice, explanation and consent for AI analysis of video interviews; deletion within 30 days on request; demographic reporting if AI alone decides who gets an in-person interview ([FindLaw](https://codes.findlaw.com/il/chapter-820-employment/il-st-sect-820-42-5/)).
  - Don't do video analysis.
- **HB 3773** (Public Act 103-0804; in effect Jan 1, 2026; amends the Illinois Human Rights Act): using AI that discriminates is a civil-rights violation; zip codes as a proxy are banned; failing to give notice of AI use is a violation.
  - IDHR proposed notice rules May 15, 2026 and withdrew them Jun 2, 2026; the statute still applies ([Seyfarth](https://www.seyfarth.com/news-insights/illinois-department-of-human-rights-temporarily-withdraws-proposed-rules-on-use-of-artificial-intelligence-in-employment.html)).

### Colorado
- **SB 24-205 (Colorado AI Act):**
  - Originally effective Feb 1, 2026; pushed to Jun 30, 2026 by SB 25B-004.
  - Stayed by federal court on Apr 27, 2026 after suits by xAI and DOJ.
  - **Repealed and replaced by SB 26-189** (signed May 14, 2026).
- **SB 26-189 (effective Jan 1, 2027):** covers ADMT used in consequential decisions, including employment.
  - Notice at the point of use.
  - A plain-language explanation within 30 days of an adverse decision.
  - Rights to correct data and to request meaningful human review.
  - Developers must document their systems for deployers and keep records for 3 years.
  - Enforced by the Attorney General, with a 60-day cure period until 2030 and no private right of action.
  - The duty to prevent "algorithmic discrimination" was dropped ([CO leg](https://leg.colorado.gov/bills/sb26-189), [NRF](https://www.nortonrosefulbright.com/en/knowledge/publications/de3ad9de/xai-sues-doj-intervenes-enforcement-of-colorado-ai-act-suspended)).

### California
- **Civil Rights Council FEHA rules on automated-decision systems** (in effect Oct 1, 2025; employers with 5+ employees):
  - Disparate impact from an automated system can violate FEHA.
  - Records, including automated-decision data, must be kept 4 years.
  - Anti-bias testing, or its absence, is relevant evidence for a defense.
  - Vendors can be covered as "agents" ([Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2025/08/california-adopts-new-employment-ai-regulations-effective-october-1-2025)).
- **CPPA (CCPA) rules on automated decision-making technology** (in effect Jan 1, 2026): for significant decisions, including employment, businesses must give pre-use notice, offer opt-out (with exceptions) and answer access requests **by Jan 1, 2027**. Risk assessments are required from 2026 ([CPPA](https://cppa.ca.gov/announcements/2025/20250923.html)).
- **No Robo Bosses:** SB 7 was vetoed Oct 2025. The narrower SB 947 was signed Sep 30, 2026, effective Jul 1, 2027. It covers discipline and termination, not hiring ([leginfo](https://leginfo.legislature.ca.gov/faces/billStatusClient.xhtml?bill_id=202520260SB947)).

### EU AI Act
- Employment uses (recruitment, filtering applications, evaluating candidates) are high-risk under Annex III point 4.
- The Digital Omnibus (in force Jul 27, 2026) moved stand-alone high-risk obligations to **Dec 2, 2027** ([Council](https://www.consilium.europa.eu/en/press/press-releases/2026/06/29/artificial-intelligence-council-gives-final-green-light-to-simplify-and-streamline-rules/)).
- Relevant only if EU employers or candidates are served. Geo-fence to the US at launch.

### FCRA and background data
- A company that assembles information about people's character, reputation, personal characteristics or mode of living, and provides it to others for employment eligibility, is a consumer reporting agency.
  - FTC v. Spokeo (2012), $800k, for selling social profiles to recruiters ([FTC](https://www.ftc.gov/news-events/news/press-releases/2012/06/spokeo-pay-800000-settle-ftc-charges-company-allegedly-marketed-information-employers-recruiters)).
  - *Kistler v. Eightfold* tests whether AI scores built from outside data qualify.
- The CFPB's proposed data-broker rule was withdrawn on May 15, 2025 ([FR](https://www.federalregister.gov/documents/2025/05/15/2025-08644/protecting-americans-from-harmful-data-broker-practices-regulation-v-withdrawal-of-proposed-rule)).
- **Design rule:**
  - Use only data the candidate gave us, shared with an employer at the candidate's direction, per intro.
  - No scraping or enrichment from third parties.
  - No scores sent to employers.
  - No background checks. Employers run their own through a licensed consumer reporting agency after an offer.
- **NYC Fair Chance Act:** no criminal-history questions until after a conditional offer, and the agent must never ask ([CCHR](https://www.nyc.gov/site/cchr/media/fair-chance-legalguidance.page)).
- NYC also bans salary-history questions (NYC Human Rights Law, 2017) [UNVERIFIED in this pass]. The agent should ask about **expectations**, never history.

### Pay transparency

| Jurisdiction | Effective | Notes |
|---|---|---|
| NYC (Local Law 32) | Nov 1, 2022 | 4+ employees |
| New York State (§194-b) | Sep 17, 2023 | 4+ employees; include the job description if one exists ([EBG](https://www.ebglaw.com/workforce-bulletin/new-york-states-salary-transparency-law-takes-effect-september-17-2023)) |
| California (SB 1162; SB 642) | Jan 1, 2023; Jan 1, 2026 | 15+ employees; good-faith estimate of the pay expected at hire |
| Colorado (EPEWA) | 2021, amended 2024 | Range, benefits, application close date |
| Washington (SSB 5408) | May 2025 amendment | 5-business-day cure period before an applicant can sue; fixed wage allowed ([Seyfarth](https://www.seyfarth.com/news-insights/washington-amends-epoa-bringing-more-balance-to-employer-job-posting-obligations.html)) |
| Illinois / Minnesota | Jan 1, 2025 | 15+ / 30+ employees ([IL](https://labor.illinois.gov/news/press-release.30746.html)) |
| New Jersey / Vermont / Massachusetts | Jun 2025 / Jul 2025 / Oct 2025 | |
| Virginia / Maine (new) | Jul 1, 2026 / Jul 29, 2026 | ([Ogletree](https://ogletree.com/insights-resources/blog-posts/virginia-and-maine-enact-pay-transparency-laws-to-take-effect-in-july-2026/)) |
| Delaware | Sep 26, 2027 | |

**Product rule:**
- No job is proposed to a candidate without a good-faith pay range.
- peon.biz advertising jobs may itself count as an "employment agency" posting under NYC and NY State rules.
- The range is a required field at job intake, and pay is a hard filter against the candidate's floor.

### Work eligibility and minimum age
- **Form I-9:** Section 2 within 3 business days of the start date; E-Verify is voluntary for most private employers.
  - The agent must not ask about citizenship or immigration status beyond the neutral "Are you authorized to work in the US?" and "Will you need sponsorship?" Asking more invites national-origin and citizenship discrimination claims.
- **Federal child labor (DOL Fact Sheet #43):** 14–15 limited hours and jobs; 16–17 any non-hazardous job; 17 hazardous-occupation orders set an 18 minimum ([DOL](https://www.dol.gov/agencies/whd/fact-sheets/43-child-labor-non-agriculture)).
- **New York:** working papers for everyone 14–17 ([NY DOL](https://dol.ny.gov/laws-governing-employment-minors-p882-english)).
- **Recommendation:** 18+ only at launch.

### Job scams and employer verification
- **FTC data.**
  - Job and employment-agency scam losses were $501M in 2024, up from $90M in 2020; business and job opportunity losses together were $750.6M ([FTC](https://www.ftc.gov/news-events/news/press-releases/2025/03/new-ftc-data-show-big-jump-reported-losses-fraud-125-billion-2024)).
  - The 2025 job-scam figure is [UNVERIFIED].
  - "Task scams" were about 40% of job-scam reports in the first half of 2024 and **usually start by text or WhatsApp** ([FTC](https://www.ftc.gov/news-events/data-visualizations/data-spotlight/2024/12/paying-get-paid-gamified-job-scams-drive-record-losses)).
  - Fake recruiters ask for bank details "for direct deposit" ([FTC](https://consumer.ftc.gov/consumer-alerts/2025/07/job-scammers-are-looking-hire-you)).
- **What others verify.** LinkedIn verifies companies and requires workplace verification for recruiter and executive titles ([Engadget](https://www.engadget.com/social-media/linkedin-will-require-recruiters-and-executives-to-verify-their-identity-to-cut-down-on-scams-130040435.html)). Indeed's own process is [UNVERIFIED].
- **peon.biz is exactly the channel scammers imitate.** Required:
  - employer verification: business-domain email, a state business-registry or EIN check, and a human call for the first job;
  - a published "peon.biz will never ask for money, bank details, SSN or a purchase" message, repeated in onboarding;
  - a scam classifier on employer messages;
  - candidate-facing "report this employer";
  - per-employer rate limits.

### Two-sided cold start
- **Paraform** seeded the supply side with laid-off recruiters ([Frontlines](https://www.frontlines.io/the-story-of-paraform-building-the-future-of-recruiting-marketplaces/)).
- **Wellfound** grew on top of AngelList's startup network.
- **Triplebyte** was profitable at small scale but couldn't grow into its valuation; privacy incidents broke engineer trust, and it was sold to Karat in 2023 ([Karat](https://karat.com/karat-acquires-leading-adaptive-assessment-technology-from-triplebyte/), [secondary](https://startups.rip/company/triplebyte)).
- **Hired** was absorbed into Adecco/LHH in 2024 ([Wikipedia](https://en.wikipedia.org/wiki/Hired_(company))).
- **Implication.** Start **demand-first in a narrow vertical**: one role family, in NYC, with 5–10 verified employers who have real, open, under-applied roles. Then recruit candidates for those roles specifically.
  - A candidate pool with no jobs churns, and an empty agent kills trust.
  - Horton's result says the agent adds most value on under-applied roles.

## B3. Ontology (peon.biz)

**Entities and roles:**
- `Candidate`
- `EmployerUser`: a hiring manager or recruiter, verified, belonging to a Company.
- `Company`: verified, with EIN or registry ID, size (for pay-transparency thresholds) and locations.
- `Recruiter`: agency or in-house; a third-party recruiter must disclose the client.
- `Job`: title mapped to O\*NET SOC; skills mapped to ESCO/O\*NET; seniority; pay range (required); location type (onsite, hybrid, remote) with work-site location; schedule; work-authorization requirement; legitimate credential requirements; open or closed; headcount.
- `Application/Intro`: probe, candidate yes, employer yes, interview.
- `Interview`, `Offer`, `Hire`.
- `Outcome`: 90-day check-in.
- `EmployerReport`, `AuditRecord`.

**Facets:**
- **Candidate:** skills with evidence (claimed, demonstrated, referenced), occupations and titles, seniority, years in the skill (capped, never a maximum), pay floor, location and commute tolerance (candidate-set), remote preference, schedule and availability, start date, work authorization (yes/no plus sponsorship need), industries to avoid, deal-breakers (on-call, travel), career intent (growth, stability, pay, mission).
- **Job:** must-have and nice-to-have skills, pay range, location model, schedule, team and culture facts the employer will stand behind, interview process length.

**Hard constraints:**
- Candidate pay floor ≤ top of the job's range.
- Location: onsite within the candidate's commute tolerance, or remote/hybrid compatible.
- Work authorization and sponsorship compatible.
- Schedule compatible.
- Legitimate licensing or credential requirements met (CDL, RN), as stated by the employer and job-related.
- Employer verified.
- Candidate 18+.
- Not previously intro'd to this job.
- Candidate hasn't excluded the company (current employer, for example). **Current-employer blocking is essential**: never show a candidate to their own employer.

**Soft:** skill overlap weighted by must-have vs nice-to-have, seniority fit, career-intent fit, pay headroom, commute time, interview-speed preference.

**Never used for matching or ranking, and never asked by the agent:**
- Race, color, ethnicity, national origin, citizenship beyond work authorization.
- Sex, gender identity, sexual orientation, pregnancy or family plans.
- Religion. Age or date of birth: collect only an 18+ yes/no for hiring, not a date of birth.
- Disability, health, genetic information.
- Marital status. Criminal history (Fair Chance Act). Salary history.
- Credit. Arrest records. Veteran status (except voluntary self-ID).
- **Proxies:** zip code as a ranking feature, graduation year, gaps, names, photos, voice, school prestige (unless a stated credential requirement), club or affinity-group memberships.
- **Anything from slop.date or buddies.nyc.**
- Voluntary self-ID data lives in a separate audit store, never visible to the matcher, the LLM judge or employers.

## B4. Matching specifics (peon.biz)

- **Reciprocal but asymmetric.** The candidate's yes comes first (consent-first probe: role, pay range, company type or name, location). Then the employer sees a **candidate-approved summary** and says yes. Then the intro and interview scheduling.
- **Pair, plus a slate.** Employers get a small slate (3–5) of candidates who said yes, **unranked or in random order**, each with criteria checkmarks against the stated must-haves. This keeps the human as decision-maker and narrows LL144 exposure. Candidates are offered 1–3 roles per week.
- **Consent flow.** Candidate-first probe; then a summary built only from data the candidate approved and marked shareable; then employer yes; then the intro thread or scheduling link. Contact details are released only at interview scheduling.
- **Attention budget.**
  - Candidates: about 3 roles per week, menu-style.
  - Employers: a slate per role per week.
  - Per-candidate cap on simultaneous active intros (about 5) to limit congestion.
  - Per-job cap on intros to stop an employer hoarding candidates.
  - Expire probes after 5 days; jobs auto-close if the employer is silent for 14 days.
- **Geo.** Candidate-set commute tolerance as a hard filter. Estimate commute time with transit routing (NYC GTFS). Remote: work-authorization state and time-zone overlap. Never rank by home zip.
- **Fairness and exposure.**
  - Track selection rates and four-fifths impact ratios at every automated stage (probe offered, employer yes, interview) using audit-store self-ID, aggregated only.
  - Exposure floors for candidates. Diversify slates by skill evidence type (bootcamp vs degree vs experience), not by protected class.
  - Run the LL144-format audit internally every month.
- **LLM judge rubric** (job-related criteria only):
  1. Must-have criteria evidenced: yes, partial or no per item, citing the candidate's own words.
  2. Logistics fit: pay, location, schedule, authorization.
  3. Candidate-intent fit.
  4. Risk flags: scam signals on the employer side; misrepresentation signals.
  5. **Protected-attribute and proxy screen**: the judge must flag if its reasoning mentions any protected trait or proxy; veto and log.
  - Run the judge on **redacted** profiles: no names, photos, pronouns, ages, graduation years, addresses.
  - Store prompts and outputs for 4 years (California FEHA rule).
- **Explanation norms.**
  - To employers: criteria-based ("meets 4 of 5 must-haves; has run payroll for a 40-person company; available in 2 weeks; within your range"). Never a score or percentile.
  - To candidates: why this role fits what they said.
  - On request, a plain-language explanation of any automated decision, and how to request human review (Colorado 2027, CPPA 2027).

## B5. Simulation design (peon.biz)

- **Personas with hidden truth.**
  - **Candidates:** true skill levels per skill (latent), self-presentation bias (over- or under-claiming), interview performance noise, true pay floor vs stated, flakiness, true retention propensity per job type, job-search urgency.
  - **Protected attributes** are assigned in the simulator only, so adverse impact can be measured. Correlate them realistically with proxies (zip, school, gaps) to test that the engine does not learn them.
  - **Employers:** true bar per skill, hiring-manager responsiveness, interview loop length, true pay flexibility, culture variables, and whether the job is real.
- **Oracle.**
  - P(hire) = P(employer yes | true skills vs bar) × P(interview pass | skills + noise) × P(offer accept | pay, commute, intent).
  - Fit or retention = σ(skill match + intent match + pay headroom − commute + noise).
  - "Good match" = hire and still employed at 90 days.
- **Adversaries:**
  - Scam employer: task scam, fake check, "buy equipment," harvesting SSNs or bank details, impersonating a real brand.
  - Fake candidate: fraudulent identity, North Korea-style remote IT worker schemes [UNVERIFIED as a 2026 trend in this pass].
  - Candidate who exaggerates skills.
  - Discriminatory employer: asks the agent for "young" or "native English" candidates, or rejects by name.
  - Recruiter who hoards candidates; employer who ghosts.
- **Scenarios:** cold start (5 employers, 100 candidates); one hot role swamped; under-applied roles; a protected group concentrated in specific zips (proxy test); an employer requesting discriminatory filters (the agent must refuse and log); a remote role with interstate pay-transparency rules.
- **Metrics:** intro-to-interview, interview-to-offer, hires, simulated 90-day retention, time-to-fill vs 44 days, candidate wasted intros, four-fifths ratios at each stage, scam-employer reach before ban, judge proxy-leak rate.
- **Launch gates:**
  - Impact ratios ≥ 0.8 at every automated stage across the simulator's protected groups, including intersectional groups with enough sample.
  - 0 protected or proxy mentions in judge reasoning on the golden set.
  - 0 jobs without a pay range.
  - 0 unverified employers reaching candidates.
  - Scam-employer median reach ≤ 1 candidate.
  - 100% of adversarial discriminatory requests refused.
  - Independent bias audit complete before any NYC ranking; human recruiter approval on every intro in pilot.

## B6. Onboarding (peon.biz)

**Candidate, first conversation:**
1. Consent and notices: AI-use notice (Illinois, NYC, Colorado 2027, CPPA 2027 style), "we never ask for money, bank details or SSN," and how to request a human.
2. 18+ confirmation (yes/no).
3. What work you do or want (free text; the agent maps it to an occupation and confirms: "Sounds like bookkeeping / staff accountant, right?").
4. Top skills with one example each.
5. Pay floor (expectation, not history).
6. Where: onsite commute tolerance, hybrid or remote preference.
7. Schedule and start date.
8. Work authorization and sponsorship (yes/no only).
9. Companies to exclude (current employer).
10. Résumé or LinkedIn upload link (optional; the candidate's own data).
11. Optional voluntary self-ID survey, kept separate and clearly optional ("used only to audit fairness, never for matching").

**Employer, first conversation:**
1. Verification: work email on the company domain, company legal name, EIN or registry. A human verifies the first job.
2. Role: title, must-haves (max 5) and nice-to-haves.
3. Pay range (required), location model, schedule, interview steps and timeline.
4. Headcount and urgency.
5. Agreement to the anti-discrimination terms; the agent refuses protected-trait criteria.

**Learned later:** demonstrated skills (from interview feedback), real pay flexibility, the employer's revealed bar, candidate responsiveness, retention outcomes, what "culture fit" actually means in job-related terms.

## B7. Risks and must-haves before launch (ranked)

1. **Discrimination liability.**
   - No protected traits or proxies in models; redacted judge input; candidate-first consent; humans make selections.
   - Monthly four-fifths monitoring.
   - **NYC LL144 bias audit and notice** before any automated ranking or scoring for NYC jobs.
   - Illinois HB 3773 notice and no zip proxies.
   - 4-year record retention (California).
   - Watch *Mobley* on vendor-as-agent liability.
2. **Job scams through our channel.** Employer verification, a "never ask for money/SSN" message, a scam classifier, ban by person.
3. **FCRA exposure.** No third-party enrichment or scraping; no scores to employers; no background checks (*Kistler v. Eightfold*).
4. **Pay transparency.** Required range on every job.
5. **Privacy.** Hiring data is not sensitive in the dating sense, but résumés carry PII. Under CPPA ADMT rules, notice, opt-out and access come by Jan 1, 2027 for California residents.
6. **Minors.** 18+ only.
7. **Cold start.** Demand-first in one role family.
8. **Unlicensed employment agency.** A for-profit agency that places applicants for a fee in New York may need an employment-agency license from DCWP in NYC (NY General Business Law Article 11) [UNVERIFIED in this pass; confirm with counsel]. This is a likely launch requirement if employers or candidates pay placement fees.

---

# Part C: buddies.nyc (friend-finding in NYC)

## C1. Matchmaking goal and success metrics

**Goal.** New Yorkers get to people they keep seeing: a first meetup that leads to repeat meetups, small groups that become recurring, and eventually friendships that happen without the agent.

| Stage | Metric |
|---|---|
| Probe | Probe-yes rate for an activity or plan |
| Meetup | Plans that reach quorum and happen; attendance and no-show rate |
| Quality | "Anyone you'd see again?" with at least one mutual yes per meetup |
| Repeat | Repeat-meetup rate: same pair or group meets again within 30 days (strongest early signal; Hall's hours accumulate) |
| Crew | Recurring crews (3+ sessions) and handoff to their own group chat (graduation is a success) |
| Network | Friends per member who met 3+ times; estimated hours together (Hall: ~50 casual, ~90 friend, 200+ close) |
| Loneliness | Optional self-report pulse (e.g. Gallup's "loneliness a lot of yesterday" item) at intake and at 90 days |
| Value | V14 (from the experience design) |

**Anti-metrics:**
- Meetups attended by the same small share of members (concentration).
- One-off meetups with no repeat (the "event treadmill").
- Romantic or sexual advances on a friend platform (report rate).
- Members feeling "set up on a date."
- Hosts burning out.
- Engagement for its own sake: daily streaks, feeds.
- Growth in bots or fake users (IRL's collapse: the board found 95% of users were bots ([SFist](https://sfist.com/2024/08/01/founder-of-social-media-startup-irl-charged-with-170m-fraud-scheme/), [IBTimes](https://www.ibtimes.com/softbank-backed-irl-shuts-down-after-ceo-misconduct-probe-admits-95-users-are-bots-3702030))).

## C2. Market and science review

### Landscape (2025–26)
- **Bumble BFF:** relaunched Sep 2025 on Geneva's group and community stack, with a Groups tab and events alongside one-to-one matching. In the US, the BFF Mode in Bumble and the separate Bumble For Friends app were replaced by one "BFF" app [secondary] ([WERSM](https://wersm.com/bumble-bff-relaunches-with-new-focus-on-groups-and-community-building/)). 18+ ([Bumble](https://support.bumbleforfriends.com/hc/en-us/articles/12279886448541-How-old-do-I-need-to-be-to-use-Bumble-For-Friends)).
- **Timeleft:**
  - Dinners of strangers every Wednesday. NYC since Mar 6, 2024 ([Timeleft NYC](https://timeleft.com/post/timeleft-launches-in-nyc-choose-chance-in-the-city-of-infinite-possibilities/)).
  - Scale (sources disagree): 200+ cities in 52 countries and about 6,500 dinners a week by its own guide ([Timeleft](https://timeleft.com/blog/how-does-timeleft-work/)); 300+ cities and about 11,500 people every Wednesday, 68% women, per Alta ([Alta](https://www.altaonline.com/dispatches/a63924701/strangers-in-the-night/)).
  - Matching uses a personality and "social energy" test plus neighborhood, language, diet and budget, aiming for a balanced table.
  - $19.99/month in the US, meals paid separately.
- **222:** ML-matched friendship or romance outings; $10.1M Series A (Upfront), $13.7M total; 17 markets, NYC the largest; about $22/month or $22.22 per outing ([Fast Company](https://www.fastcompany.com/91356813/222-aims-to-end-loneliness-by-engineering-chance), [SV Post](https://svpost.com/articles/222-10m-series-a/), [TechCrunch](https://techcrunch.com/2026/04/05/as-people-look-for-ways-to-make-new-friends-here-are-the-apps-promising-to-help/)).
- **Pie:** Andy Dunn; $11.5M Series A (Forerunner), $24M total; Chicago, Austin and SF; groups of six from a personality quiz; a Creator Fund pays hosts per RSVP; free ([TechCrunch](https://techcrunch.com/2025/03/04/andy-dunns-new-app-pie-uses-ai-to-help-you-make-friends), [Fitt](https://insider.fitt.co/pie-raises-11-5m-for-irl-friendships/)). Seattle and "Pie Plus" are [UNVERIFIED].
- **Les Amís:** AI-matched friendship for women, trans and LGBTQ+ people; NYC, Austin, Europe; $70 in NYC ([TechCrunch](https://techcrunch.com/2026/04/05/as-people-look-for-ways-to-make-new-friends-here-are-the-apps-promising-to-help/)).
- **Others in that roundup:** Clyx (events; Miami and London, expanding to NYC), Mmotion (NYC location-sharing, application required), Meet5 and Wyzr (40+), Synchrony (neurodivergent adults).
- **Meetup:** owned by Bending Spoons since Jan 2024; about 60M members; 18+ ([TechCrunch](https://techcrunch.com/2024/02/15/evernote-and-meetup-owner-bending-spoons-raises-155m-in-equity-financing/), [Meetup ToS](https://help.meetup.com/hc/en-us/articles/360027447252-Terms-of-Service); snippet only, page returned 403).
- **Cautionary cases:**
  - **IRL:** shut down in 2023; 95% of users were bots; the SEC charged the founder over about $170M raised (secondary; SEC release not fetched).
  - **Lunchclub:** stagnant since 2022; reported pivot to a crypto exchange ([secondary](https://www.articuler.ai/resources/compare/lunchclub-alternatives/)).
- **AI agents over iMessage/SMS (closest analogues):**
  - **Poke:** AI assistant over iMessage, SMS and Telegram via Linq; public Mar 2026 ([TechCrunch](https://techcrunch.com/2026/04/08/poke-makes-ai-agents-as-easy-as-sending-a-text/)).
  - **Series:** AI "friend" in iMessage that makes introductions; $5.1M pre-seed in 2026 ([TechCrunch](https://techcrunch.com/2026/04/24/two-college-kids-raise-a-5-1-million-pre-seed-to-build-an-ai-social-network-in-imessage/)).
  - **Ditto** (dating, above).
  - **Photon** (infrastructure).
- **[NOT RESEARCHED]:** Partiful, Wingman, Hinge friend features, Friended, Clyde, Breakfast Club, Fika, Not Strangers, Pals, supper clubs.

### Group dinner formats
- **Timeleft:** 4–6 strangers; the restaurant is revealed the day before; optional "last drinks" at a bar with the other tables; women-only Tuesday dinners in 50+ cities.
- Timeleft self-reports 96% "felt compatible" and that "99% of experiences happen without a safety incident" (marketing figures). No public repeat-attendance number was found.
- **Pricing benchmarks:** Timeleft $19.99/month, 222 about $22, Les Amís $70 in NYC, Pie free.
- **Gap to exploit.** Timeleft reshuffles tables every week, which optimizes novelty, not repeat exposure. Hall and Adams both say repetition is what makes friends. buddies.nyc's format is **"same table again"**: offer the whole group a second dinner, then a recurring crew.

### What predicts friendship
- **Hall (2018), *JSPR*:** about 50 hours to a casual friend, about 90 to a friend, 200+ to a close friend. Leisure time counts much more than time spent working together ([KU](https://news.ku.edu/news/article/2018/03/06/study-reveals-number-hours-it-takes-make-friend)).
- **Back, Schmukle & Egloff (2008), *Psych Science* 19:** randomly assigned seat neighbours became closer friends a year later; pure proximity ([ScienceDaily](https://www.sciencedaily.com/releases/2008/06/080602163842.htm)).
- **Rebecca G. Adams** (via the NYT 2012): proximity; repeated, unplanned interaction; and a setting that encourages people to let their guard down ([via MetaFilter](https://www.metafilter.com/117906/We-the-People-Are-Lonely); NYT not fetched).
- **Classic findings** [UNVERIFIED in this pass; standard citations]: Festinger, Schachter & Back (1950), the Westgate study (proximity and doorway layout predicted friendships); Zajonc (1968), mere exposure; McPherson, Smith-Lovin & Cook (2001), homophily; Dunbar's layers (about 5/15/50/150).
- **Context and demand:**
  - Surgeon General (2023): about half of US adults report loneliness; people aged 15–24 had 70% less social time with friends than two decades earlier ([NPR](https://www.npr.org/2023/05/02/1173418268/loneliness-connection-mental-health-dementia-surgeon-general)).
  - Gallup: 20% felt lonely "a lot of yesterday" in 2024 ([Gallup](https://news.gallup.com/poll/651881/daily-loneliness-afflicts-one-five.aspx)).
  - American Time Use Survey: time with friends fell from about 60 to 26 minutes a day, 2003–2023 ([WaPo](https://www.washingtonpost.com/opinions/interactive/2024/friends-loneliness-solitude-friendships/)).
  - Survey Center on American Life (2021): 12% have no close friends, up from 3% in 1990 ([SCAL](https://www.americansurveycenter.org/research/the-state-of-american-friendship-change-challenges-and-loss/)).
- **Design consequences:**
  - (1) Proximity: match within neighborhood or transit time.
  - (2) Repetition: recurring formats over one-offs.
  - (3) Similarity on interests, life stage and values gets a first yes. Balance (Timeleft's mix of social energy) makes a group work.
  - (4) Leisure context, not networking.

### NYC specifics
- **Neighborhoods.** 262 Neighborhood Tabulation Areas (2020), nested in Community District Tabulation Areas ([NYC Open Data](https://data.cityofnewyork.us/City-Government/2020-Neighborhood-Tabulation-Areas-NTAs-Tabular/9nt8-h7nd), [DCP](https://s-media.nyc.gov/agencies/dcp/assets/files/pdf/data-tools/bytes/nynta2020_metadata.pdf)).
  - Use the NTA as the location unit; members pick theirs, plus work or "often around" NTAs.
- **Subway.**
  - 472 stations; 2025 ridership about 1.28B; single-day record 4.65M on Dec 11, 2025 ([MTA](https://www.mta.info/agency/new-york-city-transit/ridership/2025)).
  - Static GTFS covers subway, bus, LIRR and Metro-North; a "supplemented" file is updated hourly ([data.ny.gov](https://data.ny.gov/Transportation/MTA-General-Transit-Feed-Specification-GTFS-Static/fgm6-ccue), [MTA dev](https://www.mta.info/developers)).
  - Compute a precomputed NTA-to-NTA transit-time matrix (OpenTripPlanner or r5 on GTFS; our suggestion) for weekday-evening and weekend-day windows.
- **Population.** Ages 25–34 about 1.43M (16.8%); 18–24 about 0.69M [secondary; check against ACS DP05] ([Neilsberg](https://www.neilsberg.com/insights/new-york-ny-population-by-age/)).
- **Borough-crossing friction** is [NOT RESEARCHED].
  - Heuristic: treat transit time over about 35 minutes, or more than one transfer, as a strong penalty for weeknights.
  - Venues at the transit-time centroid of the group, not the geographic centroid.

### Safety for meeting strangers
- Timeleft requires a legal name, offers ID verification and women-only tables, and books restaurants (public venues).
- Meetup requires organizers to be 18+. Formal harassment policies are [NOT RESEARCHED].
- **Recommendations:**
  - Public venues only; group format first (3–6) before any one-to-one.
  - Women-only, LGBTQ+ and age-band tables as opt-in (Les Amís and Timeleft show demand).
  - Post-meetup "anyone make you uncomfortable?" check.
  - Romantic advances reportable; a "not here for dating" norm stated at onboarding.
  - Liveness or selfie verification before the first meetup.
  - No home-hosted events at MVP (matches PRD 17.5).

### Age policy
- Bumble BFF, Meetup and Timeleft are 18+.
- The NY Child Data Protection Act (in effect Jun 20, 2025) limits processing of minors' data to what is strictly necessary and bans sale ([NY Senate](https://www.nysenate.gov/newsroom/press-releases/2025/andrew-gounardes/sen-gounardes-new-york-child-data-protection-act-goes)).
- The NY SAFE for Kids Act rules take effect Jan 25, 2027 and cover feed-based "addictive" platforms. An SMS agent is probably out of scope, but counsel should confirm ([NY AG](https://ag.ny.gov/press-release/2026/attorney-general-james-and-governor-hochul-release-final-safe-kids-act-rules)).
- **Recommendation:** 18+, with optional age-band tables (21+ when venues serve alcohol).

## C3. Ontology (buddies.nyc)

**Entities and roles:**
- `Member`
- `Host`: an opt-in role, earned after attending (Pie pays creators; consider perks)
- `Group/Crew`: recurring, with a cadence and history
- `Plan/Meetup`: activity, venue, time, quorum, status
- `Venue`: public; NTA; transit stops; price band; accessibility; alcohol yes/no
- `Activity`: a taxonomy, e.g. dinner, run club, climbing, board games, museum, volunteering, comedy, pickleball, book club
- `Availability`
- `Feedback`: "see again?" per person, private
- `SafetyReport`

**Facets:**
- **Place:** home NTA; often-around NTAs; max transit minutes on weeknights and weekends; borough willingness.
- **Time:** standing availability (e.g. Tue/Thu evenings, weekend mornings), lead-time preference.
- **Activities:** loved, curious, never.
- **Social:** group size preference (2 / 3–4 / 6+), "social energy" (introvert to extrovert), talk vs do, new to NYC (and since when).
- **Life stage:** student, early career, parent, retired. Age band (stated). Optional affinity tables (women-only, LGBTQ+, language, faith community, sober-curious) as **opt-in self-selection**.
- **Budget band. Alcohol yes/no.**
- **Accessibility needs:** venue constraints, stored as matchable/private.

**Hard constraints:**
- 18+ (21+ for alcohol venues).
- Within each member's transit tolerance.
- Available in the window.
- Budget band.
- Opted-in affinity requirement (a women-only table contains only members who opted into women-only).
- Accessibility needs met by the venue.
- Not blocked or reported; no safety hold.
- Alcohol-free if any member requested it.

**Soft:** activity overlap, social-energy balance (a mix, not sameness), life-stage similarity, age-band closeness, at least one familiar face (for repeat), novelty, how much the member wants more of the same group vs new people.

**Never used for matching** (unless the member opted into an affinity table that is about exactly that):
- Race or ethnicity, religion, orientation, health, income.
- Dating intent or relationship status. Do not infer "single."
- Anything from slop.date or peon.biz.

## C4. Matching specifics (buddies.nyc)

- **Groups first, pairs second.**
  - Default format is a plan of 3–6 at a public venue. One-to-one "activity buddy" intros (climbing partner, running buddy) are for specific activities.
  - Group scoring is least-misery plus a social-energy balance term plus at least one shared hook per person (experience design).
- **Reciprocal.** Every group member must have said yes to the plan before names are revealed (quorum probes, as in the experience design).
- **Consent flow.**
  1. Activity-first probe: "Board games in Greenpoint Thursday 7pm, 5 people roughly your age, want in?"
  2. Quorum of yeses.
  3. Names, venue and a group thread.
  4. After the meetup, private "see again?" responses.
  5. Mutual yeses become a repeat invitation for the **same group**.
  6. Three sessions become a crew handed to its own group chat, if members agree.
- **Attention budget.** A weekly digest (Thursday, per the experience design) with up to 3 options; at most 1–2 meetups per week per member by default. A recurring crew's cadence doesn't count against the budget once joined.
- **Geo.**
  - NTA-to-NTA transit-time matrix for weeknight and weekend windows.
  - Hard cap at the member's tolerance.
  - The venue is chosen to minimize the maximum travel time across the group, not the average, which is fairer to the outer boroughs.
  - Favour home-NTA clusters for repeat potential (proximity drives unplanned re-encounters).
- **Fairness and exposure.**
  - Spread seats so that newcomers and less-connected members get invited.
  - Cap how often the "great guest" is reused.
  - Track V14 by borough; watch outer-borough members getting nothing because venues cluster in Manhattan and North Brooklyn.
- **LLM judge rubric:**
  1. All hard constraints met (veto).
  2. Each member has at least one stated reason to enjoy this plan (cite it).
  3. Group balance: social energy, life stage, no one isolated (e.g. not one person 20 years older than everyone else unless they opted in).
  4. Repeat potential: proximity and cadence fit.
  5. Safety and comfort: an affinity-table promise is kept; no member flagged for romantic pursuit placed with someone who reported them.
  6. The explanation uses shareable facts only.
- **Explanation norms.** Activity-first ("you all said you've been meaning to try climbing and live within 20 min of Gowanus"). Never mention loneliness, being new or recent breakups. These are agent-private.

## C5. Simulation design (buddies.nyc)

- **Personas with hidden truth.**
  - **Observable:** home NTA (sampled in proportion to NYC young-adult population), often-around NTAs, availability, activities, group size preference, social energy, life stage, budget.
  - **Hidden:** true activity enjoyment; true social energy (the stated value is noisy); `chemistry` per pair (noise); `reliability`; `loneliness` (affects acceptance); `travel_disutility` (personal friction per transfer); romance-seeking misuse propensity.
- **Oracle.**
  - Meetup enjoyment per member = activity enjoyment + mean pair chemistry with others + group balance − travel friction + noise.
  - "See again" for a pair = σ(chemistry + similarity + enjoyment).
  - Friendship forms when the accumulated hours together for a pair cross Hall's thresholds (about 50 for casual, about 90 for friend). This makes **repeat exposure** necessary for outcomes and keeps the simulator honest about one-off formats.
- **Adversaries:** romance-seeker using friend groups to pursue people; harasser; promoter or MLM recruiter; bot or fake accounts (the IRL scenario); no-show serial; a venue that is unsafe or closed.
- **Scenarios:**
  - Geography: outer-borough sparse member (Staten Island, the far Rockaways).
  - Membership mix: a cohort of newcomers to NYC arriving in September; a skewed gender mix (Timeleft's tables are 68% women); women-only table demand.
  - Logistics: rain or subway disruption (supplemented GTFS); holiday lull; a host who burns out.
- **Metrics:** meetups held, attendance, no-show rate, "see again" mutual rate, repeat rate within 30 days, crews formed, simulated friendships formed per member (hours threshold), V14 by borough, Gini of invites, adversary reach, travel-time max per group.
- **Launch gates:**
  - Repeat rate ≥ 30% of groups within 30 days (simulator).
  - Simulated friendships per active member at 90 days above a baseline that only offers one-off Timeleft-style reshuffled dinners.
  - No member's max travel above their tolerance.
  - 0 affinity-table violations; 0 under-18 or alcohol-age violations.
  - Promoter/MLM and romance-seeker detection within 2 reports.
  - V14 ≥ 85% (simulator) across all five boroughs where members exist.

## C6. Onboarding (buddies.nyc)

**First conversation:**
1. Name and 18+ confirmation (date of birth for the 21+ alcohol gate).
2. Neighborhood: "what neighborhood do you live in? Where are you often around?" (NTA mapping, confirmed).
3. How far you'll go on a weeknight vs a weekend (minutes).
4. When you're usually free (standing availability).
5. Three things you'd love to do with new people, plus one you'd try.
6. Group or one-on-one; "more of a talker or a doer?"
7. Budget band; alcohol yes/no.
8. Optional affinity tables (women-only, LGBTQ+, language, sober, parents).
9. New to NYC? (agent-private framing: used only for timing and tone).
10. The friend-not-dating norm, safety rules, selfie verification link.

**Learned later:** who they click with (see-again), true social energy, reliability, preferred venues, real travel tolerance, life events (moves, new job) that change neighborhood, availability changes (calendar connection optional).

## C7. Risks and must-haves before launch (ranked)

1. **Physical safety and harassment** at meetups with strangers. Public venues, groups first, verification, post-meetup check, reporting by SMS, bans by person, opt-in women-only and LGBTQ+ tables.
2. **Romance misuse of a friend platform.** A clear norm, a reporting category, removal after repeat reports.
3. **Fake users and bots.** Liveness check, phone line-type check (block non-fixed VoIP), and honest metrics (the IRL lesson).
4. **Minors and alcohol.** 18+, plus 21+ for alcohol venues.
5. **Venue liability.** Never host at homes; use public, licensed venues; do not take payments for venues at MVP.
6. **Concentration and the outer boroughs.** Fairness by borough.
7. **SMS compliance:** quiet hours, consent, frequency (D4).

---

# Part D: Cross-app considerations

## D1. One person on several apps: privacy between apps
- **Shared identity, separate personas.** One `Person` record (phone, verification status, safety status) and **app-scoped profiles** (`DatingProfile`, `CandidateProfile`, `FriendProfile`), each with its own scopes, its own claims ledger and its own agent memory.
- **Default: no cross-app reads.**
  - The slop.date agent cannot see peon.biz facts and vice versa.
  - The engine's candidate retrieval is partitioned per app at the query level (row-level security or separate schemas), not just filtered in prompts.
- **Membership is itself sensitive.**
  - Norway's appeal court upheld Grindr's NOK 65M fine on Oct 21, 2025, holding that revealing someone is a Grindr user discloses sexual orientation, and that consent bundled with app access was invalid ([Datatilsynet](https://www.datatilsynet.no/en/news/news-2025/the-court-of-appeal-upholds-the-fine-against-grindr/)).
  - So peon.biz and buddies.nyc agents, members and default admin views must never see that someone is on slop.date.
- **Sensitive-data law.**
  - Virginia, Colorado and Connecticut treat sexual orientation (CO and CT also sex life) as sensitive data needing opt-in consent; California gives a right to limit ([GT Law](https://www.gtlaw-dataprivacydish.com/2023/09/defining-sensitive-data-how-do-different-states-treat-questions-of-gender-and-sexuality/)).
  - Washington's My Health My Data Act is broad and has a private right of action ([Orrick](https://www.orrick.com/en/Insights/2025/02/First-Lawsuit-Filed-Under-Washingtons-My-Health-My-Data-Act)).
  - New York has no comprehensive privacy law yet (S3044/A8158 pending; the health-privacy act was vetoed Dec 2025) ([Covington](https://www.insideprivacy.com/health-privacy/new-york-governor-vetoes-restrictive-health-privacy-law/)). The SHIELD Act's security duties apply.
- **FTC precedent.** Match/OkCupid (Mar 30, 2026) is a permanent order after about 3M photos plus location were shared with an AI firm ([FTC](https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-takes-action-against-match-okcupid-deceiving-users-sharing-personal-data-third-party)); Kochava (sensitive location) ([MediaPost](https://www.mediapost.com/publications/article/414816/kochava-wont-sell-sensitive-location-data-witho.html)).
  - Implication: dating photos and messages must not go to LLM or AI vendors for training. Use zero-retention LLM endpoints and say so in the privacy policy.
- **Hiring leakage is the worst case.** A dating fact reaching an employer creates a discrimination claim (sex, orientation) as well as a privacy one. Hard rule: the peon.biz matcher, judge and employer surfaces run under a role that **cannot** query dating or friend tables.
- **Admin panel.**
  - Per-app roles; dating-safety reviewers are a separate role.
  - A cross-app identity view is limited to Trust & Safety, logged, and justified per access (for example, banning a violent person across all three).
  - **Safety bans propagate across apps; the reason does not.** The other apps just see "account restricted."
- **Inference privacy** (PRD 17.2) applies across apps. Don't suggest a friend group of "people who also use slop.date," and don't time buddies.nyc nudges to a dating breakup.

## D2. Consent to share a profile across apps
- Opt-in, per direction, per field, revocable. Example: "Want me to reuse your neighborhood and interests from buddies.nyc for slop.date?"
- Allowed defaults to offer: name, neighborhood, interests, availability.
- Never offered for reuse in the hiring direction: anything from dating; health; orientation. Never use dating or friend data in peon.biz even with consent, because consent in employment contexts is weak and discrimination exposure is high. Hiring may share **into** buddies.nyc (e.g. "new to NYC for a job") only with explicit consent.
- Log consents with a timestamp and the exact wording (needed for state-law opt-in proof).

## D3. Phone-number identity
- **Phone is the login across all three apps**, so number recycling is an account-takeover risk.
  - Check the FCC Reassigned Numbers Database (a "no" answer gives a TCPA safe harbor) ([Manatt](https://www.manatt.com/insights/newsletters/tcpa-connect/reassigned-number-database-up-and-running)).
  - Use Twilio Lookup line type (block or flag `nonFixedVoip` such as Google Voice), SIM-swap timestamps and the SMS-pumping risk score ([Line Type](https://www.twilio.com/docs/lookup/v2-api/line-type-intelligence), [SIM swap](https://www.twilio.com/docs/lookup/v2-api/sim-swap)).
  - Turn on Twilio Verify Fraud Guard ([Twilio](https://www.twilio.com/docs/verify/preventing-toll-fraud/sms-fraud-guard)).
- **Step-up checks.**
  - A recent SIM swap, or a long dormancy followed by re-login, triggers a selfie re-verification before any dating or hiring data is shown.
  - Liveness verification ties the phone to a face.
  - Bans attach to the face vector and device as well as the phone (the Markup lesson).
- Prove [NOT RESEARCHED].

## D4. SMS 10DLC and brand registration; sender lines
- **Registration structure.**
  - One TCR Brand per EIN, with Campaigns per use case. Standard brands get up to 5 campaigns unless they justify more (sole proprietors get 1) [Twilio snippet] ([Twilio](https://www.twilio.com/docs/trust-hub/registrations/a2p-10dlc-brand)).
  - Since Feb 1, 2025, carriers block unregistered 10DLC traffic.
  - Twilio reportedly requires privacy-policy and terms URLs on every campaign from Jun 30, 2026 [secondary] ([dev.to](https://dev.to/flarecanary/twilio-a2p-10dlc-campaign-registration-will-400-on-june-30-two-new-required-fields-most-saas-apps-fm)).
- **Dating is the blocker.**
  - Twilio error 30953 rejects campaigns whose website "hosts or links to pornographic, escort, dating, or adult entertainment content" ([Twilio](https://www.twilio.com/docs/api/errors/30953)).
  - SHAFT content is forbidden on all US/Canada channels, including toll-free and RCS via Twilio ([toll-free](https://www.twilio.com/docs/messaging/compliance/toll-free/console-onboarding)).
  - T-Mobile fines $500 for SHAFT violations ([ACA](https://www.acainternational.org/news/t-mobile-implements-fines-for-non-compliant-text-messages/)).
  - Whether any dating app has a conversational 10DLC campaign approved is [UNVERIFIED].
- **Recommended structure.**
  - Consider a **separate legal entity (EIN) and brand for slop.date**, so that a dating rejection or carrier fine can't block peon.biz and buddies.nyc.
  - Never link slop.date from the other brands' websites or messages.
  - Separate campaigns per brand: one-time login codes (2FA, easiest to approve) and conversational or "mixed" per brand.
  - Separate number pools per brand, so that each app has its own sender line(s). Members save "buddies.nyc" and "peon.biz" as separate contacts, and STOP on one doesn't look like STOP on all.
  - For slop.date, evaluate non-10DLC paths: iMessage relays (with their risk), RCS through a provider that accepts dating, or an app or web-push channel with SMS used only for login codes.
- **Fees** (2025): brand $4.50, vetting $41.50, campaign vetting $15, T-Mobile $50 activation per campaign, carrier surcharges about $0.003–0.005 per message ([Telgorithm](https://www.telgorithm.com/news/how-much-does-10dlc-registration-cost-2025-guide-for-isvs)).
- **CTIA guidelines** were updated Oct 2025 (opt-in wording, brand identification) [secondary; PDF not read]. Every message should start with or include the brand name.
- **iMessage.**
  - Apple Messages for Business is customer-initiated, and business-initiated messages are limited to narrow approved utility cases ([Apple FAQ](https://register.apple.com/resources/messages/messaging-documentation/faq)). That is a poor fit for proactive matching.
  - Third-party relays (Blooio, Linq, Sendblue) run on Apple IDs with no official API. Lindy's self-hosted account was banned on launch day ([Lindy](https://www.lindy.ai/blog/imessage-api-three-rewrites-one-apple-ban-and-what-actually-works)).
  - Treat iMessage as a best-effort channel, with SMS/RCS fallback per brand and per-brand sender identities on the relay too.
- **RCS for Business on iPhone:** began with iOS 18.1. About 70% iPhone reach on supported US carriers by Jan 2026 [secondary] ([Twilio](https://www.twilio.com/en-us/blog/insights/trends/rcs-business-messaging-apple-update)).
- **TCPA.**
  - The one-to-one consent rule was vacated (11th Cir., Jan 24, 2025) ([Justia](https://law.justia.com/cases/federal/appellate-courts/ca11/24-10277/24-10277-2025-01-24.html)).
  - The **"revoke-all" rule is delayed to Jan 31, 2027** and is being revised ([Burr](https://www.burr.com/telephone-consumer-protection-act/the-fcc-delays-effective-date-of-tcpa-revoke-all-rule-until-january-31-2027)). Plan for a STOP on one brand possibly having to apply across brands from the same sender, which is another reason for separate entities or senders. Ask counsel.
  - *McLaughlin v. McKesson* (2025) ended mandatory deference to the FCC; courts disagree on whether texts are "calls" ([Kennedys](https://www.kennedyslaw.com/en/thought-leadership/article/2026/post-chevron-chaos-courts-split-on-whether-texts-are-calls-under-the-tcpa/)).
  - State mini-TCPAs: Florida, Oklahoma and Maryland allow 8am–8pm and at most 3 messages per 24 hours; Texas 9am–9pm (secondary) ([Burr FL](https://www.burr.com/telephone-consumer-protection-act/florida-enacts-significant-amendment-to-telephone-solicitation-act-amendment), [DWT](https://www.dwt.com/blogs/broadband-advisor/2023/05/telemarketing-tcpa-maryland-florida)).
  - The Network's quiet hours should be the **strictest window** (8am–8pm recipient-local) for any message we start, with 3 per 24 hours as an absolute ceiling across all brands to the same number.

## D5. Shared engine, separate policies
- One engine, with an **app policy pack** per brand:
  - the ontology (facets, hard constraints, never-use list);
  - the judge rubric and explanation templates;
  - attention budgets;
  - the consent flow (dating double opt-in, hiring candidate-first, friends quorum);
  - the geo model (radius from zip centroid; commute plus remote; NTA transit matrix);
  - age gates;
  - audit requirements (hiring four-fifths and LL144 export; dating safety log; friends borough fairness).
- The policy pack is code-reviewed, and the simulator gates are per pack.

## D6. Ranked cross-app must-haves before any launch
1. Per-app data partitioning enforced in the database, plus a separate Trust & Safety cross-app role with logging.
2. 18+ age assurance, at least before the first intro or meetup.
3. Bans by person (phone, face, device) across apps, without sharing the reason.
4. Messaging: separate brands, campaigns and number pools; consider a separate entity for slop.date; strictest quiet hours; STOP handling per brand (with revoke-all readiness).
5. Opt-in, logged consent for sensitive data (orientation and sex life) and for any cross-app reuse.
6. LLM vendors with zero retention and no training on member data, especially dating.
7. Per-app privacy policy and terms; dating-safety notices (NY, NJ, CO); hiring AI notices (NYC LL144, Illinois).

---

## Unverified or not researched (consolidated)
- **Dating:** full-year 2025 FTC romance-scam total; Tinder and Hinge distance defaults and maxima; Hinge We Met percentages; Ditto 150k signups; Volar status; Tinder Face Check vendor; **whether the Romance Scam Prevention Act was signed**; California SB 1390 status; Keeper's marriage claims; Tinder's Elo retirement (primary source).
- **Hiring:** outcome of the Sep 14, 2026 *Mobley* hearing; any ruling on the *Eightfold* motion to dismiss; whether Mercor's $20B round closed; whether the EEOC has finished rescinding the Uniform Guidelines; the 2025 FTC job-scam total; any 2026 LL144 amendments; whether the NY AI Labor Information Act was signed; Indeed's employer verification; LinkedIn Hiring Assistant 2 (LinkedIn's own source); Lightcast licensing; **the NY employment-agency licensing requirement (GBL Art. 11)**; the NYC salary-history ban (not checked in this pass); remote IT-worker fraud trend.
- **Friends:** Pie in Seattle and Pie Plus; the classic friendship studies (Festinger, Zajonc, McPherson, Dunbar; standard citations, not fetched); the "~493" subway station count; whether the MTA API key is still required; borough-crossing friction; Timeleft and Meetup harassment policies; Partiful, Wingman, Hinge friend features and others not researched.
- **Cross-app:** whether any dating app has an approved conversational 10DLC campaign; Twilio's Jun 30, 2026 required fields; CTIA Oct 2025 changes; Prove; short codes; Poke and Apple Messages for Business approval claims.

---

## 25-line summary

1. One engine, three policy packs (ontology, hard constraints, never-use list, judge rubric, consent flow, geo, budgets, audits); identities are shared and profiles are app-scoped.
2. Make all three brands 18+ (stricter than The Network's 13+), with age assurance before the first intro or meetup; 21+ for alcohol venues.
3. Dating science: profiles predict general desirability, not pair chemistry (Joel 2017; Eastwick & Finkel 2008), so use stated preferences as filters and learn from dates.
4. slop.date goal: mutual yes, then a safe first date, then a second date. Anti-metrics: exposure concentration, ghosting, no-shows, unsafe reports, swipe volume.
5. The 2025–26 AI matchmakers (Ditto over iMessage, Sitch, Keeper, Amata, Known, Overtone) converged on text or voice intake, few intros, the agent planning the date and pay per date. AI over text alone won't differentiate.
6. Dating matching: reciprocal (harmonic/min), stable-roommates framing for queer pools, per-member probe caps, Hinge-style "your turn" limits; receptivity timing gave at least 27% more matches (Rios-Saban-Zheng).
7. Dating safety is the top risk: liveness and age check, ban by person (the Markup found Match bans were evaded), public venues, share-my-date, scam classifier, NY/NJ/CO safety notices.
8. The federal Romance Scam Prevention Act passed Congress in Sep 2026 (signature unverified); build ban notices to past contacts now.
9. No race or ethnicity filters (Grindr 2020; "Debiasing Desire"); coarse geo with distance bands only (trilateration attacks); zip centroid plus radius, multi-city and travel windows.
10. peon.biz goal: qualified mutual intros, then interviews, hires and 90-day retention vs the 44-day median time-to-fill. Anti-metrics: volume, ghosting, adverse impact, scam reach.
11. Hiring is regulated. Ranking or scoring NYC candidates likely makes us an AEDT under LL144 (bias audit, public summary, 10 business days' notice); the Comptroller called enforcement ineffective in Dec 2025, so expect more.
12. Federal disparate-impact enforcement is being dismantled (EO 14281; DOJ opinion of Jun 2026), but Title VII private suits, NYC, NY State, California FEHA (ADS rules since Oct 2025) and Illinois HB 3773 (Jan 2026, zip-proxy ban) still apply.
13. Colorado's AI Act was repealed and replaced by SB 26-189 (effective Jan 1, 2027: notice, explanation, human review); EU high-risk hiring obligations moved to Dec 2, 2027.
14. Litigation: *Mobley v. Workday* (vendor-as-agent age claims, in discovery) and *Kistler v. Eightfold* (AI scores as FCRA consumer reports). So: no third-party enrichment and no scores to employers.
15. peon.biz design: candidate-first consent, unranked criteria-checked slates, humans select, redacted judge, monthly four-fifths checks, separate self-ID audit store, 4-year records.
16. Every job needs a pay range (NYC, NY State, CA, CO, WA, IL, MN, NJ, VT, MA, VA, ME); we may count as an "employment agency" poster; check the NY employment-agency license with counsel.
17. Job scams start by text (task scams were about 40% of job-scam reports): verified employers only, "we never ask for money/SSN," a scam classifier; launch demand-first in one role family (Horton: the most value is on under-applied roles).
18. buddies.nyc goal: repeat meetups and crews, not one-offs. Hall (2018): about 50, 90 and 200 hours for casual, friend and close; proximity and repetition (Back 2008, Adams).
19. The landscape (Timeleft, 222, Pie, Les Amís, BFF relaunch) reshuffles strangers; the wedge is "same table again" near home, with crews handed off after three sessions.
20. NYC geo: 262 NTAs, a GTFS transit-time matrix, venues that minimize the group's maximum travel, and V14 fairness by borough.
21. Simulators: hidden-truth personas; the dating oracle is attraction × compatibility plus large chemistry noise; the hiring oracle is P(hire) × 90-day retention; the friends oracle accumulates hours past Hall's thresholds.
22. Adversaries for the simulators: romance scammers, catfish, ban evaders, minors, scam employers, discriminatory employers, MLM promoters, romance-seekers on the friend app, bot farms (IRL had 95% bots).
23. Launch gates: 0 hard-constraint, age or privacy violations; scammer reach ≤ 1; impact ratios ≥ 0.8; 0 jobs without pay ranges; repeat rate ≥ 30%; V14 ≥ 85% in the simulator.
24. Cross-app privacy: even slop.date membership is sensitive (Grindr appeal, 2025); partition at the database level; bans propagate but reasons don't; opt-in consent for reuse; dating data never reaches hiring.
25. Messaging: Twilio rejects dating-linked 10DLC campaigns (error 30953), so use a separate entity, brand, campaigns and sender lines for slop.date; iMessage relays risk Apple bans; strictest quiet hours (8am–8pm, 3 per day); TCPA revoke-all applies from Jan 31, 2027.
