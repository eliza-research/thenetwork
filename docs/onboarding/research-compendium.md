# The Network: Background Research Compendium

*Onboarding reading list for matching, networks, search, judging, graphs and ontologies. Compiled October 2026.*

The Network is an invite-only AI agent that members text over iMessage and SMS. It learns what members want and can offer, then finds latent opportunities between them: double-opt-in introductions, small groups of 3-6, event invitations and help requests. Behind the conversation is an asynchronous matching engine over Postgres. It extracts typed facets from conversation, retrieves candidates by embedding similarity, tags and 2-hop warm paths, scores them for mutual benefit, tie strength, timing and load, asks an LLM judge, composes groups, enforces fairness and budgets, and puts every proactive proposal in front of a human reviewer. A simulated world of 500 LLM personas with hidden ground truth is used to evaluate it.

Working on this means borrowing from several fields at once: network science, the sociology of friendship, matching markets, recommender systems, knowledge representation, LLM agents and evaluation. This compendium collects the best instructional material for each of them, chosen for relevance to what we are building.

## How to use this compendium

- Start with the core path below. It is about 15 hours of the highest-value material across all fields, mostly short videos and essays.
- Then read the internal documents, which show how these ideas became design decisions.
- After that, go to the sections for your area. Each section opens with key concepts (a vocabulary you should be able to explain), then Must-read / must-watch items in a suggested order, then Additional items for depth and reference.
- Every entry gives the format, the approximate time, the level, a one-line summary and why it matters for The Network. Links were checked in October 2026; papers link to free versions where one exists.

## Start here: the core path

Eighteen items, in order. If you only have a weekend, do these.

1. **[Can you really reach anyone in 6 steps?](https://www.youtube.com/watch?v=CYlon2tvywA)**. Veritasium, 2025. *Video · ~30 min · Intro*  
   Small worlds and why short paths exist and can be found.
2. **[The Wisdom and/or Madness of Crowds](https://ncase.me/crowds/)**. Nicky Case, 2018. *Interactive · ~30 min · Intro*  
   Interactive intuition for bridging vs. bonding ties and contagion.
3. **[The Strength of Weak Ties](https://www.cs.umd.edu/~golbeck/INST633o/granovetterTies.pdf)**. Mark Granovetter, 1973 (American Journal of Sociology). *Paper · ~1 hr · Intro*  
   Why acquaintances, not best friends, carry new opportunities.
4. **[A Causal Test of the Strength of Weak Ties](https://digitaleconomy.stanford.edu/publication/a-causal-test-of-the-strength-of-weak-ties)**. Rajkumar, Saint-Jacques, Bojinov, Brynjolfsson & Aral, 2022 (Science). *Paper · ~45 min · Intermediate*  
   The causal, inverted-U evidence behind our tie-strength scoring.
5. **[How many hours does it take to make a friend? (KU news summary of Hall 2018, J. Social & Personal Relationships)](https://news.ku.edu/2018/03/06/study-reveals-number-hours-it-takes-make-friend)**. Jeffrey A. Hall / University of Kansas, 2018. *Blog · ~10 min · Intro*  
   One intro does not make a friend; repeat encounters do.
6. **[Stable Marriage Problem](https://www.youtube.com/watch?v=Qcv1IqHWAzg)**. Numberphile (Emily Riehl), 2014. *Video · ~9 min · Intro*  
   Stable matching and blocking pairs in nine minutes.
7. **[Who Gets What — and Why | Alvin E. Roth | Talks at Google](https://www.youtube.com/watch?v=IxrN1HuRt08)**. Talks at Google (Alvin Roth with Hal Varian), 2015. *Talk · ~55 min · Intro*  
   Thick, uncongested, safe markets: the vocabulary behind budgets and cooldowns.
8. **[Reciprocal Recommender Systems: Analysis of State-of-Art Literature, Challenges and Opportunities towards Social Recommendation](https://arxiv.org/abs/2007.16120)**. Palomares, Porcel, Pizzato, Guy, Herrera-Viedma, 2021 (Information Fusion; arXiv preprint 2020). *Paper · ~2 hrs (skim sections 1–4 in ~45 min) · Intermediate*  
   People-to-people recommendation: both sides must say yes.
9. **[Romantic Matches Are Hard to Predict Before People Meet (APS release on Joel, Eastwick & Finkel, "Is Romantic Desire Predictable?")](https://www.psychologicalscience.org/news/releases/romantic-matches-are-hard-to-predict.html)**. Association for Psychological Science, 2017. *Blog · ~5 min (paper ~1 hr) · Intro*  
   Pair chemistry is mostly unpredictable, so the judge must not claim it.
10. **[Embeddings: What they are and why they matter](https://simonwillison.net/2023/Oct/23/embeddings/)**. Simon Willison, 2023. *Blog · ~35 min · Intro*  
   What embeddings are and how semantic retrieval over facets works.
11. **[System Design for Recommendations and Search](https://eugeneyan.com/writing/system-design-for-discovery/)**. Eugene Yan, 2021. *Blog · ~30 min · Intermediate*  
   Retrieval, ranking and serving as one system.
12. **[Ontology Development 101: A Guide to Creating Your First Ontology](https://protege.stanford.edu/publications/ontology_development/ontology101-noy-mcguinness.html)**. Natalya F. Noy & Deborah L. McGuinness (Stanford), 2001. *Paper · ~1.5 hrs · Intro*  
   How to design the facet vocabulary without drowning in taxonomies.
13. **[\[1hr Talk\] Intro to Large Language Models](https://www.youtube.com/watch?v=zjkBMFhNj_g)**. Andrej Karpathy (YouTube), 2023. *Video · ~1 hr · Intro*  
   What an LLM is, from the person who explains it best.
14. **[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)**. Erik Schluntz and Barry Zhang (Anthropic), 2024. *Blog · ~25 min · Intro*  
   Workflows vs. agents, and when to use each.
15. **[Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/)**. Hamel Husain, 2024. *Blog · ~30 min · Intro*  
   Why evals come first and how to look at your data.
16. **[Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685)**. Zheng et al. (LMSYS), 2023. *Paper · ~1.5 hrs · Intermediate*  
   LLM judges: how well they agree with people and how they are biased.
17. **[2021 Distinguished Lecture: "Contextual Integrity"](https://www.youtube.com/watch?v=VPwmC0Sfe50)**. Helen Nissenbaum / UW Human Centered Design & Engineering (YouTube), 2021. *Talk · ~1 hr · Intermediate*  
   Contextual integrity: the privacy model behind "shareable reasons only".
18. **[Timeleft Algorithm: The Maestro of Your Dinners](https://timeleft.com/post/timeleft-algorithm-the-maestro-of-your-dinners/)**. Timeleft, n.d. *Case study · ~10 min · Intro*  
   A real product that composes strangers into dinner groups.

## Prerequisite knowledge map

| Area | What you should be able to explain | Where it shows up in The Network | Section |
|---|---|---|---|
| Network science | Small worlds, weak ties, structural holes, homophily, triadic and focal closure, centrality, communities | Warm-path generator, tie-strength scoring, cross-cluster health metrics, simulator tie formation | 1 |
| Social science of connection | How friendships form, social capital (bridging vs. bonding), loneliness, gatherings | Second-encounter generator, group dinners, the north-star metric, product principles | 2 |
| Products and case studies | What Boardy, Timeleft, 222, Hinge, Lunchclub, LinkedIn PYMK learned | Product scope, cadence, group format, cold start and network effects | 2 |
| Privacy | Contextual integrity, LLM secret leakage, attribute inference | Privacy scopes on facets, explanation shareability, canary tests | 2 |
| Matching and market design | Stable matching, blocking pairs, congestion, reciprocal recommenders, b-matching, CP-SAT, group aggregation (least misery) | MutualBenefit term, run-level selector, budgets and cooldowns, group composer | 3 |
| Search and recommender systems | Embeddings, exact vs. approximate kNN, hybrid search, recsys pipeline, ranking metrics, bandits, off-policy evaluation, exposure fairness | Candidate retrieval over pgvector, exploration budget, propensity logging, future learning-to-rank | 4 |
| Graphs and ontologies | Graph modeling, recursive SQL, knowledge graphs, ontologies and controlled vocabularies, bi-temporal facts, event sourcing | Member/Facet/Edge data model, 2-hop queries, taxonomy consolidation, facet validity windows | 5 |
| LLMs and agents | How LLMs work, prompting, structured outputs, tool use, agent loops, memory, MCP, prompt injection | The Eliza agent, facet extraction, persona agents, MCP connector, safety | 6 |
| Judging and evaluation | Error analysis, LLM-as-judge and its biases, precision/recall/AUC, kappa, calibration, simulation, pass^k, prompt optimization | Judge passes, model evals, simulated world with oracle, shadow mode and pilot | 7 |

## The Network's own documents

- [PRD (canonical Google Doc)](https://docs.google.com/document/d/1lLQAZNAMSC_yHCkUBVbp1CCwvyR17PuvV7TnpfuY8Xc/edit). Read Sections 1-6 (vision, capital as a vector, the opportunity model), 13-14 (data model and engine), 28 (MVP) and 33 (matching engine v1).
- **README** (thenetwork repo: README.md). What each package does and the latest results.
- **Matching, Graphs, and Evaluation: research survey** (thenetwork repo: docs/research/matching-and-graphs.md). The design-decision companion to this compendium: every paper mapped to an engine subsystem, plus the evaluation methodology.
- **Engine v1 vs. random** (thenetwork repo: docs/results/2026-10-06-engine-v1-vs-random.md). How the engine performs against the simulated oracle.
- **Judge passes and error analysis** (thenetwork repo: docs/results/2026-10-06-judge-passes.md and 2026-10-06-luna-error-analysis.md). What the LLM judge gets right and wrong, and which errors no judge can fix.
- **Why matches fail, and diversity** (thenetwork repo: docs/research/2026-10-07-match-failures-and-diversity.md). The current failure funnel and the levers that help.
- **Observatory** (thenetwork repo: docs/observatory.md). The simulator and visualizer; run it with `bun run observatory`.

## 1. Networks, small worlds and social structure

The Network is, at bottom, a bet on network science: that the most valuable introductions are often a few hops away, cross weak ties and structural holes, and can be found with local information. This section gives you the vocabulary and the core studies (and their critiques) behind warm-path retrieval, tie-strength scoring, group composition, and the persona simulation.

### 1.1 Key concepts

- **Small world / six degrees.** Most people are connected by short chains of acquaintances (Milgram: about 6; Facebook 2016: about 3.57). *Why it matters:* the 2-hop warm-path retrieval assumes most valuable members are close in the graph, and in a 150-1,000 member city network almost everyone is within 2-3 hops.
- **Watts–Strogatz model.** A few random "shortcut" edges added to a clustered lattice shrink path lengths sharply while keeping local clustering high. *Why it matters:* each cross-cluster intro the agent makes is a shortcut, so a handful of good bridging intros can reshape the network.
- **Navigability / decentralized search (Kleinberg).** Short paths existing is not the same as people being able to *find* them; that requires long-range links distributed in the right proportion to distance. *Why it matters:* the agent does the "search" members can't do themselves, and Kleinberg's result explains why mixing near (homophilous) and far (novel) candidates matters.
- **Strength of weak ties (Granovetter).** Acquaintances bridge to parts of the network your close friends don't reach, so they carry new information and opportunities. LinkedIn's randomized experiments found the effect is an inverted U: moderately weak ties work best. *Why it matters:* this informs how the scorer weights tie strength. A pair with no shared context is a cold intro, and a pair with many mutual friends is redundant.
- **Structural holes / brokerage (Burt).** People who span gaps between otherwise disconnected groups get earlier, more diverse information and produce better ideas. *Why it matters:* a member who spans a hole is a good warm-path introducer, and closing holes deliberately is the product's value proposition.
- **Homophily.** Similar people connect more ("birds of a feather"), along race, age, occupation, values, and more. *Why it matters:* vector kNN on facets is homophily by construction, so without diversity terms the matcher reinforces existing bubbles. This is the core tension behind the fairness and exposure budgets.
- **Triadic and focal closure.** Two people who share a friend (triadic) or a context such as a class, club, or company (focal) are much more likely to connect. *Why it matters:* these are the strongest baseline link predictors. Use them as features and as a baseline the LLM judge must beat, not as a goal in themselves (they predict ties that would form anyway).
- **Dunbar's number and tie layers.** Humans maintain roughly 5/15/50/150 relationships at decreasing intimacy. The single number "150" is contested. *Why it matters:* this informs the "load" component and the intro-rate limits. Members have finite relational bandwidth, and every intro competes for it.
- **Scale-free networks and preferential attachment.** In many networks degree follows a heavy tail because the rich get richer: new nodes link to already popular nodes. *Why it matters:* left alone, the matcher would route most intros to a few popular members. Exposure budgets exist to counteract preferential attachment.
- **Friendship paradox.** On average, your friends have more friends than you do, because popular people show up in many friend lists. *Why it matters:* this biases what members see (and what warm-path sampling returns), so popularity has to be corrected for when evaluating "who is connected to whom."
- **Centrality (degree, betweenness, closeness, eigenvector/PageRank).** These are different definitions of "important node." Betweenness, in particular, measures brokerage. *Why it matters:* centrality feeds observatory metrics, introducer selection, and the detection of over-exposed hubs.
- **Community detection (modularity, Louvain).** Algorithms that find densely connected clusters. *Why it matters:* used to measure whether intros are bridging communities or deepening them, and as an input to the group composer.
- **Link prediction.** Predicting which non-edges will become edges, using neighborhood scores (common neighbors, Adamic–Adar, Katz) or learned embeddings. *Why it matters:* this is the formal framing of the candidate retrieval problem and the standard evaluation setup for the simulated world.
- **Social contagion: simple vs. complex.** Some things spread from one contact (information). Others need reinforcement from several (behaviors, joining a group). Contagion is also hard to tell apart from homophily in observational data. *Why it matters:* invites to groups and events behave like complex contagion, so group composition should include several people who know each other. Also be skeptical of "influence" claims in our own metrics.
- **Economic connectedness and friending bias (Chetty).** Cross-class friendship is one of the strongest predictors of upward mobility, and half of the gap is exposure while half is friending bias even after exposure. *Why it matters:* this is evidence that intros across social strata are high-value and don't happen on their own, which motivates both a goal and a metric for the fairness layer.

### 1.2 Must-read / must-watch

- **[Can you really reach anyone in 6 steps?](https://www.youtube.com/watch?v=CYlon2tvywA)**. Veritasium, 2025. *Video · ~30 min · Intro*
  A beautifully produced walk through Milgram's experiment, Watts–Strogatz shortcuts, Kleinberg navigability and the math of six degrees. The best single starting point. Why it matters for The Network: it builds intuition for why 2-hop warm-path retrieval and a few well-chosen "shortcut" intros can transform a city network.

- **[The Wisdom and/or Madness of Crowds](https://ncase.me/crowds/)**. Nicky Case, 2018. *Interactive · ~30 min · Intro*
  An interactive game where you build networks and watch ideas spread, teaching complex contagion, the majority illusion, bonding vs. bridging, and small worlds. Why it matters for The Network: it gives a direct feel for how group composition (bonding vs. bridging) changes whether an invite or idea takes hold, which matters for the group composer.

- **[Networks, Crowds, and Markets: Reasoning About a Highly Connected World](https://www.cs.cornell.edu/home/kleinber/networks-book/)**. David Easley & Jon Kleinberg, 2010. *Book · ~6-8 hrs for Ch. 2-4, 19-20 · Intro*
  The canonical free undergraduate textbook (full PDF on the page). Ch. 3 covers strong/weak ties, triadic closure and structural holes, Ch. 4 homophily and focal closure, Ch. 19 cascades, Ch. 20 small worlds and decentralized search. Why it matters for The Network: Ch. 3-4 are essentially the theory behind the warm-path and tie-strength components of the scorer.

- **[The Strength of Weak Ties](https://www.cs.umd.edu/~golbeck/INST633o/granovetterTies.pdf)**. Mark Granovetter, 1973 (American Journal of Sociology). *Paper · ~1 hr · Intro*
  The foundational argument that acquaintances, not close friends, bridge to new information and opportunities (jobs, ideas). Why it matters for The Network: it is the theoretical justification for preferring moderately weak warm paths over both strangers and inner circles in candidate scoring.

- **[A Causal Test of the Strength of Weak Ties](https://digitaleconomy.stanford.edu/publication/a-causal-test-of-the-strength-of-weak-ties)**. Rajkumar, Saint-Jacques, Bojinov, Brynjolfsson & Aral, 2022 (Science). *Paper · ~45 min · Intermediate*
  Randomized experiments on LinkedIn's "People You May Know" with 20M+ users showed that weak ties cause job mobility, but in an inverted U, with moderately weak ties (by mutual-connection count) working best. Why it matters for The Network: this is the closest real-world analogue of our recommender, and it tells us to model tie strength non-monotonically in the warm-path score.

- **[Navigation in a Small World](https://www.cs.cornell.edu/home/kleinber/nat00.pdf)**. Jon Kleinberg, 2000 (Nature). *Paper · ~20 min · Intermediate*
  A two-page result showing that short paths can be *found* with local information only when long-range links fall off with distance at exactly the right rate. Why it matters for The Network: it frames the agent as a decentralized-search engine and motivates mixing near and far candidates rather than pure nearest-neighbor retrieval.

- **[Structural Holes and Good Ideas](https://snap.stanford.edu/class/cs224w-readings/Burt04StructureHole.pdf)**. Ronald S. Burt, 2004 (American Journal of Sociology). *Paper · ~1.5 hrs · Intermediate*
  Evidence from a large firm that people whose networks span structural holes have better ideas, pay and promotions. Brokerage turns network position into value. Why it matters for The Network: it tells us which intros create value (hole-spanning ones) and which members make the best introducers on warm paths.

- **[Social Capital I: Measurement and Associations with Economic Mobility](https://opportunityinsights.org/paper/social-capital-i-measurement-and-associations-with-economic-mobility/)**. Raj Chetty, Matthew O. Jackson et al., 2022 (Nature). *Paper · ~1.5 hrs · Intermediate*
  Uses 21 billion Facebook friendships to show that "economic connectedness" (cross-class friendship) strongly predicts upward mobility, while cohesion and civic engagement don't. Why it matters for The Network: it is rigorous evidence for valuing cross-strata bridging intros, and a model for how to define and measure a connectedness metric in the observatory.

- **[Network Science](http://networksciencebook.com/)**. Albert-László Barabási, 2016. *Book · ~5-6 hrs for Ch. 2-5, 9 · Intro*
  A free, interactive, beautifully illustrated textbook covering graph basics, random networks, small worlds, scale-free networks, preferential attachment (Ch. 5) and communities (Ch. 9). Why it matters for The Network: it explains the degree distributions and hub formation that our exposure budgets and community metrics are designed to manage.

### 1.3 Additional

#### Small worlds and search

- **[The Small World Problem](https://snap.stanford.edu/class/cs224w-readings/milgram67smallworld.pdf)**. Stanley Milgram, 1967 (Psychology Today). *Paper · ~30 min · Intro*
  The original letter-forwarding experiment that gave us "six degrees." It is readable, and it also shows how many chains failed. Why it matters for The Network: chain attrition is the human cost of search that the agent removes by doing the routing itself.

- **[Collective Dynamics of 'Small-World' Networks](https://snap.stanford.edu/class/cs224w-readings/watts98smallworld.pdf)**. Duncan Watts & Steven Strogatz, 1998 (Nature). *Paper · ~30 min · Intermediate*
  The rewiring model showing that high clustering and short paths coexist with only a few random shortcuts. Why it matters for The Network: it is a ready-made generator and baseline for building the 500-persona simulated social graph.

- **[The Small-World Phenomenon: An Algorithmic Perspective](https://www.cs.cornell.edu/home/kleinber/swn.pdf)**. Jon Kleinberg, 2000 (STOC). *Paper · ~1.5 hrs · Advanced*
  The full technical version of the navigability result, with proofs for the inverse-square law of long-range links. Why it matters for The Network: read it if you are tuning how retrieval trades off graph and embedding distance against novelty.

- **[An Experimental Study of Search in Global Social Networks](https://www.cs.princeton.edu/~chazelle/courses/BIB/dodds2003pa.pdf)**. Peter Dodds, Roby Muhamad & Duncan Watts, 2003 (Science). *Paper · ~20 min · Intro*
  A 60,000-person email replication of Milgram. Successful chains ran through medium/weak professional ties rather than hubs, and success depended heavily on incentives. Why it matters for The Network: it supports routing warm paths through professional and medium ties, and it shows that participation incentives (double opt-in friction) dominate reachability.

- **[Four Degrees of Separation](https://arxiv.org/abs/1111.4570)**. Backstrom, Boldi, Rosa, Ugander & Vigna, 2012. *Paper · ~45 min · Intermediate*
  Exact distance measurements on the whole Facebook graph (721M users), with an average of about 4.74 hops. Why it matters for The Network: it calibrates expectations of path length and the reach of 2-hop retrieval in dense urban subgraphs.

- **[Three and a Half Degrees of Separation](https://research.facebook.com/blog/2016/2/three-and-a-half-degrees-of-separation/)**. Facebook Research (Bhagat, Burke, Diuk, Filiz, Edunov), 2016. *Blog · ~10 min · Intro*
  A short post giving the updated 3.57 average degrees and explaining how they estimated it at scale. Why it matters for The Network: it is a quick reference number for pitches and for checking that the simulated graph's path lengths are realistic.

#### Structure, growth, and ties

- **[Emergence of Scaling in Random Networks](https://arxiv.org/abs/cond-mat/9910332)**. Albert-László Barabási & Réka Albert, 1999 (Science). *Paper · ~30 min · Intermediate*
  The preferential-attachment model that explains power-law degree distributions. Why it matters for The Network: it is the mechanism our exposure/fairness budgets counteract, since unchecked match ranking produces "rich get richer" hubs.

- **[The Anatomy of the Facebook Social Graph](https://arxiv.org/abs/1111.4503)**. Johan Ugander, Brian Karrer, Lars Backstrom & Cameron Marlow, 2011. *Paper · ~1 hr · Intermediate*
  An empirical description of a real social graph: degree distribution, clustering, and strong degree assortativity and age/geography homophily. Why it matters for The Network: it supplies realistic targets for calibrating the 500-persona simulated world.

- **[Birds of a Feather: Homophily in Social Networks](https://pdodds.w3.uvm.edu/files/papers/others/2001/mcpherson2001.pdf)**. Miller McPherson, Lynn Smith-Lovin & James Cook, 2001 (Annual Review of Sociology). *Paper · ~1.5 hrs · Intro*
  The definitive review of homophily across race, age, religion, education, occupation and values, and of its causes. Why it matters for The Network: it explains why vector similarity on facets will reproduce bubbles unless the judge and fairness layer push against it.

- **[Empirical Analysis of an Evolving Social Network](https://cse.iitk.ac.in/users/cs888/files/good.pdf)**. Gueorgi Kossinets & Duncan Watts, 2006 (Science). *Paper · ~30 min · Intermediate*
  A year of university email showing that new ties form mostly via triadic closure (shared friends) and focal closure (shared classes). Why it matters for The Network: it quantifies the baseline tie-formation process that our intros should *add to*, not duplicate.

- **[Origins of Homophily in an Evolving Social Network](https://research.google/pubs/origins-of-homophily-in-an-evolving-social-network/)**. Gueorgi Kossinets & Duncan Watts, 2009 (American Journal of Sociology). *Paper · ~1.5 hrs · Advanced*
  Shows that observed homophily is amplified by structural opportunity (triadic and focal closure), not just preference. Why it matters for The Network: if the system controls exposure, it can lower homophily without fighting member preferences, and this is the lever for the fairness layer.

- **[Romantic Partnerships and the Dispersion of Social Ties](https://arxiv.org/abs/1310.6753)**. Lars Backstrom & Jon Kleinberg, 2014 (CSCW). *Paper · ~1 hr · Intermediate*
  Introduces "dispersion," a structural tie-strength measure (mutual friends who are not connected to each other), which beats raw embeddedness at identifying partners. Why it matters for The Network: it is a concrete, computable tie-strength feature for the warm-path score beyond counting mutual friends.

- **[Why Your Friends Have More Friends Than You Do](https://fermatslibrary.com/s/why-your-friends-have-more-friends-than-you-do)**. Scott Feld, 1991 (American Journal of Sociology). *Paper · ~45 min · Intro*
  The original friendship paradox paper (annotated edition). Why it matters for The Network: warm-path sampling over-represents popular members, so evaluation and exposure accounting must correct for degree bias.

- **[Do Online Social Media Cut Through the Constraints That Limit the Size of Offline Social Networks?](https://royalsocietypublishing.org/doi/10.1098/rsos.150292)**. Robin Dunbar, 2016 (Royal Society Open Science). *Paper · ~30 min · Intro*
  A national survey finding that online network size still caps at around 150, with only a handful of dependable ties. It is open access and the clearest modern statement of the layered-ties view. Why it matters for The Network: it grounds the "load" component and per-member intro-rate limits in relational bandwidth.

- **['Dunbar's Number' Deconstructed](https://royalsocietypublishing.org/doi/10.1098/rsbl.2021.0158)**. Patrik Lindenfors, Andreas Wartel & Johan Lind, 2021 (Biology Letters). *Paper · ~20 min · Intro*
  Reanalysis showing the confidence interval on "150" is so wide that no single number is defensible. Why it matters for The Network: treat load limits as per-member, learned parameters rather than a hard-coded 150.

#### Algorithms: communities, centrality, link prediction

- **[The Link Prediction Problem for Social Networks](https://www.cs.cornell.edu/home/kleinber/link-pred.pdf)**. David Liben-Nowell & Jon Kleinberg, 2007 (JASIST). *Paper · ~1.5 hrs · Intermediate*
  Systematic comparison of neighborhood (common neighbors, Adamic–Adar, Jaccard) and path-based (Katz) predictors on co-authorship networks. Why it matters for The Network: these cheap scores are the baselines that candidate retrieval and the LLM judge must beat in simulation evals.

- **[The Structure and Function of Complex Networks](https://arxiv.org/abs/cond-mat/0303516)**. Mark Newman, 2003 (SIAM Review). *Paper · ~3 hrs · Intermediate*
  A long, free review covering degree distributions, clustering, assortativity, centrality, community structure and network models. It is a compact substitute for Newman's textbook *Networks* (OUP, 2nd ed. 2018). Why it matters for The Network: it is a reference for every observatory metric we will compute on the simulated and real graph.

- **[Fast Unfolding of Communities in Large Networks (Louvain)](https://arxiv.org/abs/0803.0476)**. Blondel, Guillaume, Lambiotte & Lefebvre, 2008. *Paper · ~45 min · Intermediate*
  The standard, fast modularity-maximization community detection algorithm. Why it matters for The Network: it is the default way to label communities so we can measure whether intros bridge or deepen clusters.

- **[Community Detection in Graphs](https://arxiv.org/abs/0906.0612)**. Santo Fortunato, 2010 (Physics Reports). *Paper · ~4+ hrs (skim) · Advanced*
  The comprehensive survey of community detection methods and their pitfalls (resolution limit, validation). Why it matters for The Network: consult it before trusting a single community partition in group-composer or fairness metrics.

- **[CS224W: Machine Learning with Graphs](https://www.youtube.com/playlist?list=PLoROMvodv4rPLKxIpqhjhPgdQy7imNkDn)**. Jure Leskovec, Stanford Online, 2021. *Course · ~20 hrs · Intermediate*
  The full lecture series, covering traditional graph features, node embeddings, GNNs, link prediction, community structure and recommender systems. Course site with slides: <https://web.stanford.edu/class/cs224w/>. Why it matters for The Network: the lectures on link prediction and recommendation map directly to evolving the retrieval stage beyond pgvector kNN.

- **[Social and Economic Networks: Models and Analysis](https://www.coursera.org/learn/social-economic-networks)**. Matthew O. Jackson, Stanford/Coursera. *Course · ~20 hrs · Intermediate*
  A free course from Chetty's coauthor covering network formation, centrality, diffusion, peer effects and strategic network games, with an economics lens. Why it matters for The Network: its strategic network-formation models describe why members accept or decline intros, which bears on reciprocal/mutual-benefit scoring.

#### Contagion and its critiques

- **[The Spread of Obesity in a Large Social Network over 32 Years](https://www.cis.upenn.edu/~mkearns/teaching/NetworkedLife/C+Fobese.pdf)**. Nicholas Christakis & James Fowler, 2007 (NEJM). *Paper · ~45 min · Intro*
  The famous claim that traits spread up to "three degrees of influence" through social ties. Also see Christakis's TED talk (<https://www.ted.com/talks/nicholas_christakis_the_hidden_influence_of_social_networks>). Why it matters for The Network: it is a seductive story about network influence. Read it with the two critiques below before claiming our intros "cause" downstream outcomes.

- **[Homophily and Contagion Are Generically Confounded in Observational Social Network Studies](https://arxiv.org/abs/1004.4704)**. Cosma Shalizi & Andrew Thomas, 2011. *Paper · ~1.5 hrs · Advanced*
  A formal proof that influence and homophily cannot generally be distinguished from observational network data. Why it matters for The Network: it is the reason our evaluation relies on simulated ground truth and randomized holdouts rather than correlational outcome data. Lyons's direct critique of Christakis–Fowler is a companion read (<https://arxiv.org/abs/1007.2876>).

- **[Distinguishing Influence-Based Contagion from Homophily-Driven Diffusion in Dynamic Networks](https://pmc.ncbi.nlm.nih.gov/articles/pmid/20007780)**. Sinan Aral, Lev Muchnik & Arun Sundararajan, 2009 (PNAS). *Paper · ~1 hr · Advanced*
  Matched-sample estimation on 27M users showing naive methods overstate peer influence by 300-700%. Why it matters for The Network: it is a practical method for estimating the real lift of intros if we ever must work from observational data.

- **[The Spread of Behavior in an Online Social Network Experiment](https://faculty.cs.byu.edu/~mike/mikeg/papers/SpreadofBehaviorinSocialNetworkExperimentScience.pdf)**. Damon Centola, 2010 (Science). *Paper · ~30 min · Intermediate*
  A controlled experiment showing that behavior spreads faster in clustered networks, because reinforcement from multiple contacts matters (complex contagion). Why it matters for The Network: small groups and event invites should seed several connected members at once rather than isolated individuals.

- **[Structural Diversity in Social Contagion](https://pmc.ncbi.nlm.nih.gov/articles/PMC3341012)**. Johan Ugander, Lars Backstrom, Cameron Marlow & Jon Kleinberg, 2012 (PNAS). *Paper · ~45 min · Intermediate*
  Facebook sign-up data showing that adoption depends on how many *distinct* social contexts invited you, not on the raw number of contacts. Why it matters for The Network: it suggests that for event invitations, "friends from different contexts are going" is a stronger signal than headcount.

#### Social capital

- **[Social Capital II: Determinants of Economic Connectedness](https://pmc.ncbi.nlm.nih.gov/articles/PMC9352593)**. Raj Chetty et al., 2022 (Nature). *Paper · ~1.5 hrs · Intermediate*
  Splits the cross-class friendship gap into exposure and "friending bias," and shows that the structure of groups (size, type) changes friending bias. Why it matters for The Network: group size and setting choices in the group composer and event design can directly reduce friending bias. Data explorer: <https://www.socialcapital.org/>.

## 2. The social science of connection, related products, and privacy

This section explains why The Network is built the way it is. It covers what research says about how people become friends and why it matters. It covers what earlier "connect people" products learned, often the hard way. It also covers the privacy theory behind the "shareable reasons only" rule. Start with the Key concepts, then work through the Must list in order (roughly 6-7 hours in total).

### 2.1 Key concepts

- **Friendship takes hours, not matches.** Jeffrey Hall's studies estimate about 50 hours together to go from acquaintance to casual friend, about 90 to reach "friend," and over 200 to become close friends. *Why it matters:* one intro never makes a friendship. That is why the PRD treats a good first meeting as a new graph edge and then watches for a natural **second encounter** (PRD 6.4).
- **Social connection is a health outcome.** The 2023 US Surgeon General advisory and the Holt-Lunstad meta-analysis link weak social ties to higher mortality, at a level comparable to well-known risk factors. *Why it matters:* this is the "why lives contract" problem (PRD 2). It also explains why the product optimizes for durable ties and not for engagement.
- **Bonding vs. bridging social capital (Putnam).** Bonding capital is ties within a group (close friends, your own scene). Bridging capital is ties across groups. *Why it matters:* "cross-cluster ties" is a north-star goal. The engine has to deliberately propose bridges that people would not form through their existing scenes.
- **Forms of capital (Bourdieu).** Economic, cultural, and social capital are different resources, and each can convert into the others. *Why it matters:* this is the intellectual root of PRD 5, "Capital as a vector." Members hold different kinds of capacity (space, skill, time, reach), and opportunities come from complementarity, not rank. That is why the product has **no member scores**.
- **Economic connectedness and friending bias (Chetty et al.).** Having cross-class friends is one of the strongest predictors of upward mobility. Half of the class divide comes from *exposure* (who you are ever in a room with). The other half comes from *friending bias* (you don't befriend the people you do meet). *Why it matters:* The Network can act on both. It creates exposure through small groups and events, and it lowers friending bias through warm framing and second encounters.
- **Strength of weak ties.** Novel information and opportunities, such as jobs, tend to flow through acquaintances, not close friends. LinkedIn's large-scale experiments found the effect peaks at *moderately* weak ties. *Why it matters:* professional-goal intros should favor "friend-of-a-friend with a few mutuals" over strangers or best friends.
- **Propinquity and mere exposure.** People befriend whoever they keep running into. In the Westgate housing study, friendships followed the layout of doorways and stairwells. *Why it matters:* local density, recurring formats, and "two people you'd like are already going" event anchors manufacture repeated exposure.
- **The liking gap and undersociality.** After a conversation, people underestimate how much the other person liked them (Boothby et al.). People also predict that talking to strangers will be worse than it actually is (Epley & Schroeder). *Why it matters:* members will under-initiate on their own. A trusted third party who frames the invitation and handles follow-up removes exactly this friction ("lower activation energy," PRD 2.1).
- **Chemistry is hard to predict in advance.** Joel, Eastwick & Finkel found that pre-meeting traits predict who is generally liked, but not which *specific pair* will click. *Why it matters:* be humble about match scores. Keep explanations modest, include exploration and serendipity (PRD 14.5), and learn from post-meeting feedback, not profile similarity alone.
- **Gathering design (Priya Parker).** A gathering works when it has a specific purpose, deliberate curation, and explicit temporary norms ("pop-up rules"). *Why it matters:* dinners of 3-6 are *designed* experiences. The opportunity object's objective, social format, and framing language are the levers.
- **Cold start and the atomic network.** A network product only works once a minimum dense cluster exists, such as one city or one scene. The "hard side" (hosts, connectors) has to be won first. *Why it matters:* this is why the MVP is invite-only in two dense cities with about 150-300 members, and why hosts and connectors get special care.
- **Double opt-in and indistinguishable declines.** Each side agrees independently before anyone is revealed. A decline must look exactly like "never proposed." *Why it matters:* this is the core consent mechanic of every intro, group, and romance proposal, and Boardy and others use the same mechanic.
- **Contextual integrity (Nissenbaum).** Privacy means information flows that fit the norms of the context it came from. It is not a public/private bit. *Why it matters:* every fact a member tells the agent carries a flow policy, such as "usable for matching, shown to a counterparty only as a paraphrase."
- **LLMs leak and infer.** Benchmarks (ConfAIde, PrivacyLens) show LLM agents disclose private information in context even when told not to. Staab et al. show LLMs can *infer* sensitive attributes from innocuous text. *Why it matters:* privacy has to be enforced structurally, by controlling what facts the explainer can see, and checked with an inference auditor. Prompt instructions alone are not enough.
- **Trust & safety is product, not policy.** Dating and meetup platforms have repeatedly matched users with known offenders and handled assault reports badly. *Why it matters:* vouch-based entry, human review, safety classes on opportunities, and public first-meeting venues are core features, not add-ons.

### 2.2 Must-read / must-watch

#### Social science

- **[How many hours does it take to make a friend? (KU news summary of Hall 2018, J. Social & Personal Relationships)](https://news.ku.edu/2018/03/06/study-reveals-number-hours-it-takes-make-friend)**. Jeffrey A. Hall / University of Kansas, 2018. *Blog · ~10 min · Intro*
  A plain-language summary of two studies that measure the hours needed to move from acquaintance to casual, regular, and close friend, and which kinds of conversation deepen ties. Why it matters: this gives the time budget behind "second encounters." The engine's job is to make the next 10-50 hours easy, not to declare a match. (The original paper, DOI 10.1177/0265407518761225, is paywalled at SAGE.)

- **[Our Epidemic of Loneliness and Isolation: The U.S. Surgeon General's Advisory on the Healing Effects of Social Connection and Community](https://www.hhs.gov/sites/default/files/surgeon-general-social-connection-advisory.pdf)**. Vivek Murthy / HHS, 2023. *Paper · ~1.5 hrs (skim exec summary in 15 min) · Intro*
  The authoritative public-health synthesis on loneliness. It covers the health effects, the measurement framework (structure, function, quality of connection), and recommendations for institutions and technology. Why it matters: it supplies the problem framing and vocabulary for "why lives contract." Its tech recommendations (design for connection, not engagement) map directly onto our non-goals.

- **[Social Capital and Economic Mobility (non-technical research summary)](https://opportunityinsights.org/wp-content/uploads/2022/07/socialcapital_nontech.pdf)**. Raj Chetty, Matthew O. Jackson, Theresa Kuchler, Johannes Stroebel et al. / Opportunity Insights, 2022. *Paper · ~30 min · Intro*
  An accessible summary of the two 2022 *Nature* papers that used 21B Facebook friendships to define economic connectedness, exposure, and friending bias. Why it matters: it is the best empirical case that *who you meet* changes life outcomes. It also splits the problem into exposure and friending bias, two levers the matching engine can act on.

- **[Bowling Alone: America's Declining Social Capital](https://muse.jhu.edu/article/16643/summary)**. Robert D. Putnam, *Journal of Democracy*, 1995. *Essay · ~45 min · Intro*
  The essay that launched the modern "social capital" debate. It traces the decline of associational life in the US and argues that dense civic networks underpin trust and cooperation. The 2000 book adds the bonding/bridging distinction. Why it matters: The Network is an attempt to rebuild "third places" and associational ties with software. Bridging capital is the explicit target. (Project MUSE may show a verification step first.)

- **[The Forms of Capital](https://www.marxists.org/reference/subject/philosophy/works/fr/bourdieu-forms-capital.htm)**. Pierre Bourdieu (trans. Richard Nice), 1986. *Essay · ~1 hr · Intermediate*
  The classic theory of economic, cultural, and social capital, and how each converts into the others. Why it matters: it is the theory behind PRD Section 5 ("Capital as a vector," "capital transformation"), and it explains why we never collapse capital into one score.

- **[3 steps to turn everyday get-togethers into transformative gatherings](https://www.ted.com/talks/priya_parker_3_steps_to_turn_everyday_get_togethers_into_transformative_gatherings)**. Priya Parker / TED, 2019. *Talk · ~10 min · Intro*
  The author of *The Art of Gathering* explains how to give a gathering a specific purpose, invite "good controversy," and set pop-up rules. Why it matters: these are design rules for our small-group dinners and for the opportunity "framing" language the agent sends.

#### Products and case studies

- **[The Network Effects Manual: 16 Different Network Effects (and counting)](https://nfx.com/post/network-effects-manual)**. NFX (James Currier et al.), updated through 2020s. *Essay · ~45 min · Intro*
  A taxonomy of network effects, from personal and marketplace to tribal, belief, and hub-and-spoke, ranked by strength. Why it matters: it helps a new team member say exactly which network effects The Network has (personal, data, tribal/belonging) and which it does not.

- **[The Cold Start Problem: How to Start and Scale Network Effects (Talks at Google)](https://www.youtube.com/watch?v=TSnYO34b3TA)**. Andrew Chen / Talks at Google, 2022. *Talk · ~55 min · Intro*
  The a16z partner presents his framework: the atomic network, the hard side, the tipping point, escape velocity, and the ceiling. Examples include Tinder, Uber, Slack, and Zoom. Why it matters: it justifies the invite-only, two-city, ~300-member MVP and the special focus on hosts and connectors (the "hard side").

- **[Timeleft Algorithm: The Maestro of Your Dinners](https://timeleft.com/post/timeleft-algorithm-the-maestro-of-your-dinners/)**. Timeleft, n.d. *Case study · ~10 min · Intro*
  Timeleft's own description of how it composes weekly dinners of six strangers from a personality quiz. It mixes similarity on some dimensions with deliberate balance on others, such as introvert/extrovert. Why it matters: it is the closest consumer analogue to our 3-6 person dinner generator, and evidence for mixed similarity/complementarity objectives in group composition.

- **[AI networking startup Boardy raises $3M pre-seed](https://techcrunch.com/2024/10/24/ai-networking-startup-boardy-raises-3m-pre-seed/)**. TechCrunch, 2024. *Case study · ~8 min · Intro*
  Explains how Boardy works: a voice AI calls you, learns your goals, and brokers double-opt-in email intros. Why it matters: Boardy is our nearest AI "superconnector" competitor in professional intros. Our differentiation is groups, events, local presence, and non-professional desires.

#### Privacy and trust

- **[2021 Distinguished Lecture: "Contextual Integrity"](https://www.youtube.com/watch?v=VPwmC0Sfe50)**. Helen Nissenbaum / UW Human Centered Design & Engineering (YouTube), 2021. *Talk · ~1 hr · Intermediate*
  The originator of contextual integrity explains the framework (context, actors, attribute, transmission principle) with modern examples. Why it matters: it is the formal model behind our privacy scopes and the "shareable reasons only" rule for intro explanations.

- **[Can LLMs Keep a Secret? Testing Privacy Implications of Language Models via Contextual Integrity Theory (ConfAIde)](https://confaide.github.io/)**. Niloofar Mireshghallah et al., ICLR 2024. *Paper · ~20 min (project page) / ~1.5 hrs (paper) · Intermediate*
  A tiered benchmark showing that GPT-4 and ChatGPT reveal private information in contexts where humans would not, about 39% and 57% of the time respectively. Why it matters: it is hard evidence that "only use shareable facts" in a prompt is not enough. The explainer must only ever *receive* facts whose scope allows that destination.

### 2.3 Additional

#### Social science

- **[What makes a good life? Lessons from the longest study on happiness](https://www.ted.com/talks/robert_waldinger_what_makes_a_good_life_lessons_from_the_longest_study_on_happiness)**. Robert Waldinger / TED (TEDxBeaconStreet), 2015. *Talk · ~13 min · Intro*
  The director of the 80+-year Harvard Study of Adult Development summarizes its central finding: the quality of close relationships predicts health and happiness better than wealth or fame. Why it matters: it is a shared, memorable "why" for the whole team. Relationship quality, not contact volume, is the outcome to optimize. (Study background: <https://www.robertwaldinger.com/harvard-study/>)

- **[Social Relationships and Mortality Risk: A Meta-analytic Review](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC2910600/)**. Julianne Holt-Lunstad, Timothy B. Smith, J. Bradley Layton, *PLoS Medicine*, 2010. *Paper · ~45 min · Intermediate*
  A meta-analysis of 148 studies (~309k people): stronger social relationships are associated with about 50% higher odds of survival. Why it matters: it is the primary source behind the "as harmful as smoking" claims. Cite this, not pop summaries, when making impact claims.

- **[Social capital I: measurement and associations with economic mobility (with companion Social capital II: determinants of economic connectedness, https://www.nature.com/articles/s41586-022-04997-3)](https://www.nature.com/articles/s41586-022-04996-4)**. Raj Chetty et al., *Nature*, 2022. *Paper · ~2 hrs each · Advanced*
  The full papers: paper I defines and validates connectedness, cohesion, and civic engagement. Paper II decomposes cross-class connection into exposure and friending bias by setting (school, church, workplace, recreation). Why it matters: paper II's finding that *which venues* produce cross-class friendships depends on group size and structure is directly useful for choosing event anchors and group compositions.

- **[The Social Capital Atlas](https://www.socialcapital.org/)**. Opportunity Insights & Meta, 2022. *Interactive · ~20 min · Intro*
  An interactive map of economic connectedness, exposure, and friending bias by ZIP code, high school, and college. Why it matters: you can explore SF and NYC neighborhoods and see how segregated their friendship networks are, which shows the cross-cluster gap the product is trying to close.

- **[How Social Connections Shape Economic Mobility (RSA lecture)](https://www.youtube.com/watch?v=vU7bK4psnak)**. Raj Chetty / Royal Society of Arts (YouTube), 2022. *Talk · ~1 hr · Intro*
  Chetty walks through the social capital findings with visuals and Q&A. Why it matters: it is the easiest way to absorb "exposure vs. friending bias" if you prefer video to papers.

- **[Why the Internet Won't Get You Any More Friends](https://www.youtube.com/watch?v=tRUCKxKMVTo)**. Robin Dunbar / Santa Fe Institute (YouTube), 2014. *Talk · ~1 hr · Intro*
  Dunbar explains the social brain hypothesis, the ~150 limit, and the nested layers (~5, 15, 50, 150), and argues that time investment, not platform reach, sets relationship capacity. Why it matters: members have finite relationship slots and time. This supports the interruption budget and a "few, high-conviction proposals" design over a feed.

- **[Propinquity (incl. the Festinger, Schachter & Back Westgate study)](https://en.wikipedia.org/wiki/Propinquity)**. Wikipedia, ongoing. *Blog · ~10 min · Intro*
  A quick reference on proximity effects. It covers the 1950 MIT Westgate housing study, where friendships followed building layout, and the related mere-exposure effect. Why it matters: the engine can't move people's apartments, but it can create "functional proximity" through recurring formats, neighborhood clustering, and repeated co-attendance. (The original book, *Social Pressures in Informal Groups*, 1950, has no free online copy.)

- **[The Liking Gap in Conversations: Do People Like Us More Than We Think?](https://faculty.wharton.upenn.edu/wp-content/uploads/2020/05/The-Liking-Gap-in-Conversations.pdf)**. Erica Boothby, Gus Cooney, Gillian Sandstrom, Margaret Clark, *Psychological Science*, 2018. *Paper · ~45 min · Intermediate*
  Across lab, dorm, and workshop studies, people systematically underestimate how much their conversation partners liked them. Why it matters: after a good first meeting, both people may wrongly assume the other is lukewarm. A gentle agent nudge toward a second encounter fixes a real, measured bias.

- **[Mistakenly Seeking Solitude](https://faculty.haas.berkeley.edu/jschroeder/Publications/Epley%26Schroeder2014.pdf)**. Nicholas Epley & Juliana Schroeder, *Journal of Experimental Psychology: General*, 2014. *Paper · ~45 min · Intermediate*
  Commuters told to talk to strangers had better commutes, yet everyone predicted the opposite. Why it matters: people mispredict the value of connecting with strangers, so a well-framed invitation from a trusted agent produces connections they would not have chosen on their own.

- **[Disintermediating your friends: How online dating in the United States displaces other ways of meeting](https://web.stanford.edu/~mrosenfe/Rosenfeld_et_al_Disintermediating_Friends.pdf)**. Michael Rosenfeld, Reuben Thomas, Sonia Hausen, *PNAS*, 2019. *Paper · ~40 min · Intermediate*
  Nationally representative data show that meeting online overtook meeting through friends for US heterosexual couples around 2013. Why it matters: friends-as-matchmakers declined. The Network is partly an attempt to bring back the "introduced by someone who knows us both" path with software.

- **[The Serendipity Mindset: The Art and Science of Creating Good Luck](https://www.penguin.co.uk/books/1313931/the-serendipity-mindset/9780241990216.html)**. Christian Busch, Penguin, 2020. *Book · ~7 hrs · Intro*
  A management scholar argues that serendipity can be cultivated through "triggers," noticing, and connecting the dots, drawing on his research (including a 2024 JMS best-paper on "serendipity mindset"). Why it matters: it gives vocabulary for "engineered synchronicity." Our job is to plant triggers and lower the cost of following up, not to script outcomes.

#### Products and case studies

- **[Do Things that Don't Scale](https://paulgraham.com/ds.html)**. Paul Graham, 2013. *Essay · ~25 min · Intro*
  A classic essay arguing that startups should recruit users by hand and deliver unusually personal experiences early on. Why it matters: human review of every proposal and hand-curated early dinners are deliberate unscalable choices, and this essay explains why that is correct at our stage.

- **[Solve a Hard Problem (Tinder): Chapter 8 of *The Cold Start Problem*](https://andrewchen.com/solve-a-hard-problem-cold-start-problem/)**. Andrew Chen, 2021. *Essay · ~15 min · Intro*
  A free book chapter on how Tinder won its first atomic network (campus parties) by solving a painful problem for the "hard side." Why it matters: dating and social apps are the closest analogue for our launch. It shows how to seed density in one scene at a time.

- **[Optimizing People You May Know (PYMK) for equity in network creation](https://engineering.linkedin.com/blog/2021/optimizing-pymk-for-equity-in-network-creation)**. LinkedIn Engineering, 2021. *Blog · ~15 min · Intermediate*
  LinkedIn describes reranking PYMK so members with small networks get more connection opportunities, and the A/B results. Why it matters: it is a production example of trading raw engagement for exposure fairness and network growth for the under-connected, the same tension as our "newcomer" and cross-cluster goals.

- **[Bumble BFF's revamped app is here, focusing on friend groups and community building](https://techcrunch.com/2025/09/18/bumble-bffs-revamped-app-is-here-focusing-on-friend-groups-and-community-building)**. TechCrunch, 2025. *Case study · ~6 min · Intro*
  Bumble rebuilt BFF on its acquired Geneva community platform, moving from 1:1 friend swiping to groups, chats, and planning tools. Why it matters: it is a market signal that 1:1 friend-matching underperforms, and it supports our emphasis on groups, events, and recurring formats.

- **[222 wants to match perfect strangers for bespoke, real-life experiences](https://techcrunch.com/2022/11/14/2440702/)**. TechCrunch, 2022. *Case study · ~6 min · Intro*
  Profile of 222, which grew out of a university research project: a values and personality quiz, vetting, and curated outings with strangers at partner venues. Why it matters: it shows vetting plus mystery (venue reveal) as product features, and venue partnerships as a supply source.

- **[Make Plans Like Magic: Why We Invested In Pie](https://www.originventures.com/blog/make-plans-like-magic-why-we-invested-in-pie)**. Origin Ventures, 2024. *Case study · ~10 min · Intro*
  An investor memo on Pie, which groups event RSVPs into pods of ~6 with a pre-event group chat so attending alone feels safe. Why it matters: "event anchor + pre-assigned pod + pre-event thread" is a proven pattern for our event-anchor generator and relay group threads.

- **[Lunchclub tops $100 million valuation amid quarantine usage spike](https://www.cnbc.com/2020/09/01/lunchclub-tops-100-million-valuation-amid-quarantine-usage-spike.html)**. CNBC, 2020. *Case study · ~6 min · Intro*
  A snapshot of Lunchclub at its peak: AI-matched weekly 1:1 video meetings with a $100M valuation. Why it matters: read it as the "before" picture. Lunchclub later plateaued, and users reported low-value matches and little control. That is a warning about auto-matched 1:1s without strong intent (no reputable post-mortem exists; see the matching-and-graphs research doc, 8b).

- **[On Deck lays off a third of staff after cutting a quarter just months prior](https://techcrunch.com/2022/08/04/on-deck-lays-off-a-third-of-staff-after-cutting-a-quarter-just-months-prior/)**. TechCrunch, 2022. *Case study · ~8 min · Intro*
  How the fellowship/community startup over-expanded into many cohorts and services, then cut back to its founder focus. Why it matters: it is a cautionary tale for community businesses. Curation quality and a focused member promise don't survive rapid horizontal expansion.

- **[How Robert Putnam Helped Create the Tea Party](https://washingtonmonthly.com/2011/09/21/how-robert-putnam-helped-create-the-tea-party/)**. Washington Monthly, 2011. *Essay · ~20 min · Intro*
  Traces how *Bowling Alone* inspired Scott Heiferman to found Meetup ("use the Internet to get people off the Internet"), and how the platform's open organizing tools were then used by movements no one anticipated. Why it matters: it is the origin story of the closest prior "tech for civic connection" company, and a reminder that open organizing tools get used for ends their designers didn't plan.

- **[Meet Partiful, the Gen Z party-planning staple that's taking on Apple](https://www.cnbc.com/2025/04/19/meet-partiful-the-gen-z-party-planning-staple-thats-taking-on-apple.html)**. CNBC, 2025. *Case study · ~8 min · Intro*
  How Partiful grew through social invites and visible guest lists. Why it matters: "who's going" is the strongest attendance signal. Our event anchors reproduce it privately ("two people you'd like are going"), and Partiful/Luma events are a world-knowledge source.

- **[A Bet on American Intellectual Life—and Beyond (interview with Anna Gát)](https://www.millersbookreview.com/p/anna-gat-a-bet-on-american-intellectual-life-and-beyond)**. Miller's Book Review, 2026. *Blog · ~25 min · Intro*
  Interintellect's founder on running a network of member-hosted salons (online and in person) and on hosting culture. Why it matters: Interintellect is a working model of the "member as host" supply side we need for dinners and gatherings.

- **[The Five-Minute Favor](https://medium.com/business-networking/77c6fb321ecb)**. Adam Rifkin (Medium), 2014. *Essay · ~10 min · Intro*
  The person Fortune named the best networker of 2011 explains his habit of quick, generous intros and favors, later featured in Adam Grant's *Give and Take*. Why it matters: it describes the "superconnector" behavior our agent automates (and our member-introduction source encourages): low-cost, high-value, other-oriented intros.

#### Privacy and trust

- **[Privacy as Contextual Integrity](https://digitalcommons.law.uw.edu/wlr/vol79/iss1/10)**. Helen Nissenbaum, *Washington Law Review* 79(1), 2004. *Paper · ~2 hrs · Advanced*
  The original paper: privacy as appropriate flow under context-specific norms of appropriateness and distribution. Why it matters: read this when designing facet flow policies and judge checks. It is the source of truth for the vocabulary we use in privacy scopes.

- **[PrivacyLens: Evaluating Privacy Norm Awareness of Language Models in Action](https://arxiv.org/abs/2409.00138)**. Yijia Shao et al., NeurIPS Datasets & Benchmarks, 2024. *Paper · ~1.5 hrs · Advanced*
  Shows that LMs that answer privacy-probing questions correctly still leak in agentic trajectories, even with privacy prompts. Why it matters: test privacy on *agent actions* (relay messages, scheduling, explanations), not on Q&A, and adapt its vignette-to-trajectory pipeline for simulator canaries.

- **[Beyond Memorization: Violating Privacy Via Inference with Large Language Models](https://arxiv.org/abs/2310.07298)**. Robin Staab, Mark Vero, Mislav Balunović, Martin Vechev, ICLR 2024. *Paper · ~1.5 hrs · Advanced*
  LLMs infer location, income, sex, and other personal attributes from innocuous text with high accuracy, at a fraction of human cost. Why it matters: our extractors must not store inferred sensitive attributes, and outbound intro explanations need an inference audit so a counterparty can't deduce private facts.

- **[Tinder Lets Known Sex Offenders Use the App. It's Not the Only One.](https://www.propublica.org/article/tinder-lets-known-sex-offenders-use-the-app-its-not-the-only-one)**. Columbia Journalism Investigations / ProPublica, 2019. *Case study · ~25 min · Intro*
  A 16-month investigation into how Match Group's free apps failed to screen known offenders and handled assault reports. Why it matters: it shows concretely what goes wrong without vetting, re-entry prevention, and report handling. It motivates vouch-based entry, safety classes, and human review for romance and 1:1 proposals.

## 3. Matching, market design and group formation

> Local deep-dive: `~/thenetwork/docs/research/matching-and-graphs.md` (sections 1–3 and the "Verdict"). This page is the on-ramp; that doc is where the design decisions live.

### 3.1 Key concepts

- **Two-sided / matching market.** A market where you can't just "buy" what you want; the other side has to choose you back (jobs, dating, school seats, intros). *Why it matters:* every Network intro is a two-sided match. A proposal is only worth something if **both** people would say yes, which is why we use double opt-in.
- **Stable matching & blocking pairs.** A matching is *stable* if no two people would both rather be with each other than with whoever they were assigned. A pair that would defect like this is a *blocking pair*. *Why it matters:* we don't promise stability, but we count blocking pairs in the simulator as a "did we leave value on the table?" diagnostic.
- **Gale–Shapley / deferred acceptance (DA).** One side proposes in rounds and the other side tentatively holds its best offer so far. The result is always stable, and it favors the proposing side. *Why it matters:* it is the canonical algorithm and the foundation of Hinge's "Most Compatible" pick. We don't use it as the engine because our data is sparse, non-bipartite, capacitated and includes groups.
- **Stable roommates (non-bipartite).** Stable matching inside one pool, where anyone can pair with anyone. A stable solution may not exist, and for random preferences it usually doesn't. *Why it matters:* friend and peer intros are a roommates problem, so "stable" is the wrong promise for us.
- **Market design: thickness, congestion, safety (Roth).** Markets work when they are *thick* (enough participants), *uncongested* (people have time to consider options) and *safe* (honest participation isn't punished). *Why it matters:* this is the vocabulary behind our per-member budgets, cooldowns and "few high-conviction proposals" design.
- **Congestion & restricting actions (Kanoria–Saban; Rios–Saban–Zheng).** On dating-style platforms attention piles onto popular users, and people who recently matched become less responsive. Platforms improve outcomes by *limiting* who can initiate and by controlling what each user is shown. *Why it matters:* the Network initiates, popular members get load penalties, and acceptance probability is modeled as falling with recent proposals.
- **Reciprocal recommender systems (RRS).** Recommenders where the "item" is also a person with preferences. You score both directions (A→B and B→A) and combine them so the weaker side counts, using a harmonic or geometric mean. *Why it matters:* this is exactly our `MutualBenefit` term.
- **Assignment problem & Hungarian algorithm.** This is the problem of pairing N workers with N tasks at minimum total cost (or maximum total value). The Hungarian algorithm solves it exactly in polynomial time. *Why it matters:* it's the simplest version of "pick the best set of pairs at once" and builds intuition for our global selector.
- **Maximum-weight matching & b-matching.** Choose a set of edges (pairs) with the highest total weight so that each person appears at most *b* times (b = their capacity or budget). *Why it matters:* our run-level selector is a max-weight b-matching with extra constraints (time conflicts, cooldowns, exposure floors).
- **Integer programming / CP-SAT.** You write the problem as yes/no decision variables plus linear constraints and an objective, then hand it to a solver (OR-Tools CP-SAT) that finds an optimal or near-optimal answer. *Why it matters:* this is how we encode budgets, conflicts and fairness floors without hand-writing a bespoke algorithm. A few thousand candidate pairs solves in well under a second.
- **Group recommendation aggregation (Masthoff).** These are rules for turning individual preferences into a group score. *Average* maximizes total happiness. *Least misery* maximizes the minimum. *Average-without-misery* averages, but only over options that clear a floor. *Why it matters:* our group composer uses average pairwise fit plus a least-misery floor, so no one gets dragged into a group they'd hate.
- **Team formation & seating assignment.** Pick a subset of people who cover the needed skills at low "coordination cost", or partition people into tables. These problems are NP-hard, so they're solved with ILP or with heuristics plus local search. *Why it matters:* this is the formal shape of the group composer (beam search, then swap-and-improve) and of the monthly-gathering table plan.
- **Social choice basics.** Social choice studies how individual rankings get turned into a collective decision. Arrow's theorem shows that no ranked aggregation rule satisfies every fairness property at once. *Why it matters:* there is no "neutral" way to score a group. Every aggregation rule (average, min, Borda) is a value choice, and we should state ours explicitly.
- **Fairness & exposure in matching markets.** Fairness here means spreading opportunity (exposure, proposals) so newcomers and less-"popular" members aren't starved, while keeping match quality. Common tools are envy-freeness, Nash social welfare, and amortized exposure. *Why it matters:* this is the basis for our exposure budgets and the anti-caste rule (never show a universal desirability score).
- **Pair chemistry is mostly unpredictable (Joel et al. 2017).** From rich pre-meeting data, models predict who is liked *in general* and who is *picky*, but not which specific two people will click. *Why it matters:* the LLM judge must not claim chemistry. Signal lives in actor effects (reliability, openness), logistics and timing.
- **LLM-agent markets.** These are markets where AI agents search, negotiate and accept on people's behalf. Early results show biases such as first-proposal bias, and show that classical mechanism guarantees don't automatically carry over. *Why it matters:* our 500-persona simulator is itself an agent market, and future agent-to-agent intent negotiation will face these issues.

### 3.2 Must-read / must-watch

*Ordered as a learning sequence: intuition → real-world market design → algorithms you'll actually use → people-to-people recommendation → groups → humility.*

- **[Stable Marriage Problem](https://www.youtube.com/watch?v=Qcv1IqHWAzg)**. Numberphile (Emily Riehl), 2014. *Video · ~9 min · Intro*
  A clear, animated walkthrough of Gale–Shapley: what "stable" means, how proposing works, and why the proposing side does better. Why it matters for The Network: it gives you the blocking-pair concept we use as a simulator diagnostic, and it shows who gets advantaged when one side "proposes" (the Network initiates on members' behalf).

- **[Stable matching: Theory, evidence, and practical design (Nobel Prize popular science background, 2012)](https://www.nobelprize.org/uploads/2018/06/popular-economicsciences2012.pdf)**. Royal Swedish Academy of Sciences, 2012. *Paper · ~20 min · Intro*
  A 5-page plain-language explainer of Shapley's theory and Roth's applied work: deferred acceptance, the U.S. doctor match, school choice and kidney exchange. Why it matters for The Network: it is the fastest way to see how an abstract algorithm became real clearinghouse infrastructure, and why stability matters when participants could otherwise "go around" the system.

- **[Who Gets What — and Why | Alvin E. Roth | Talks at Google](https://www.youtube.com/watch?v=IxrN1HuRt08)**. Talks at Google (Alvin Roth with Hal Varian), 2015. *Talk · ~55 min · Intro*
  Roth explains his book's core ideas: markets need to be thick, uncongested and safe, and design choices (timing, who proposes, what's revealed) decide who gets what. Why it matters for The Network: "congestion" and "thickness" are exactly the forces behind our per-member budgets, cooldowns, and the choice to send few, high-conviction proposals.

- **[Algorithmic Game Theory, Lecture 10: Kidney Exchange and Stable Matching](https://www.youtube.com/watch?v=NT07sILhsv4)**. Tim Roughgarden Lectures (Stanford CS364A), 2013. *Course · ~76 min video, or ~30 min for the notes · Intermediate*
  Lecture notes: <https://timroughgarden.org/f13/l/l10.pdf> A rigorous but approachable lecture covering kidney exchange as a matching and incentive problem (cycles, chains, why the problem becomes integer programming), then deferred acceptance with proofs of stability and proposer-optimality. Why it matters for The Network: kidney exchange is the best case study of capacity-constrained, non-bipartite matching solved by optimization rather than Gale–Shapley, which is the same move our CP-SAT selector makes.

- **[Solving an Assignment Problem (CP-SAT)](https://developers.google.com/optimization/assignment/assignment_cp)**. Google OR-Tools docs, current. *Docs · ~30 min hands-on · Intro*
  A runnable Python example that models "who does what" as boolean variables with capacity constraints and a cost objective, then solves it with CP-SAT. Why it matters for The Network: our run-level selector is this pattern scaled up (one boolean per candidate pair or group, per-member budget constraints, time-conflict constraints, maximize total NetValue), so this is the template to learn first.

- **[Reciprocal Recommender Systems: Analysis of State-of-Art Literature, Challenges and Opportunities towards Social Recommendation](https://arxiv.org/abs/2007.16120)**. Palomares, Porcel, Pizzato, Guy, Herrera-Viedma, 2021 (Information Fusion; arXiv preprint 2020). *Paper · ~2 hrs (skim sections 1–4 in ~45 min) · Intermediate*
  The canonical survey of people-to-people recommendation (dating, recruiting, mentoring, social). It covers how two-directional preference is modeled and aggregated, and the open problems: cold start, popularity overload, fairness and explanations. Why it matters for The Network: it is the literature behind our harmonic-mean `MutualBenefit` score and the "failure has a cost for the recipient" principle behind double opt-in. (Use v2; v3 was withdrawn on arXiv. The final version is in Information Fusion 69.)

- **[Facilitating the Search for Partners on Matching Platforms (Management Science Review summary)](https://www.informs.org/Blogs/ManSci-Blogs/Management-Science-Review/Facilitating-the-Search-for-Partners-on-Matching-Platforms)**. INFORMS blog on Kanoria & Saban, 2021. *Blog · ~8 min · Intro*
  A readable summary of Kanoria & Saban's model: unrestricted platforms waste effort (thousands of profile views per real date), and platforms do better when they *restrict* actions, for example by letting only the short side initiate or hiding quality signals. Why it matters for The Network: it is the theoretical justification for the Network (not members) initiating intros and for never showing a universal member score.

- **[Group Recommender Systems (RecSys Summer School 2017 tutorial slides)](https://pro.unibz.it/projects/schoolrecsys17/JudithMasthoff.pdf)**. Judith Masthoff, 2017. *Talk · ~45 min (72 slides) · Intro*
  A tutorial from the person who systematized group aggregation strategies (average, least misery, most pleasure, average-without-misery, Borda and others). It includes user studies of which strategies people actually find fair. Why it matters for The Network: our group composer's objective (average pairwise fit plus a minimum-pair floor) is "average without misery". This deck explains why people judge a group by its worst-off member.

- **[Romantic Matches Are Hard to Predict Before People Meet (APS release on Joel, Eastwick & Finkel, "Is Romantic Desire Predictable?")](https://www.psychologicalscience.org/news/releases/romantic-matches-are-hard-to-predict.html)**. Association for Psychological Science, 2017. *Blog · ~5 min (paper ~1 hr) · Intro*
  Paper: <https://journals.sagepub.com/doi/abs/10.1177/0956797617714580> Using 100+ pre-date questionnaire traits from speed daters, machine learning predicted who is generally liked and who is picky, but essentially none of the *pair-specific* desire. Why it matters for The Network: it is the humility check on our LLM judge. Weight actor effects, timing and logistics, and never let the judge claim it can predict chemistry.

### 3.3 Additional

*Stable matching & market design foundations*

- **[Stable Marriage Problem (the math bit)](https://www.youtube.com/watch?v=LtTV6rIxhdo)**. Numberphile2 (Emily Riehl), 2014. *Video · ~12 min · Intro*
  The follow-up to the main Numberphile video, proving that the algorithm terminates and produces a stable matching. Why it matters for The Network: it is the minimal proof intuition you need before reading about why non-bipartite (friend) matching breaks these guarantees.

- **[College Admissions and the Stability of Marriage](https://www.math.utoronto.ca/mccann/assignments/477/GaleShapley62.pdf)**. David Gale & Lloyd Shapley, 1962. *Paper · ~30 min · Intro*
  The original 7-page paper. It is famously readable and covers both one-to-one (marriage) and many-to-one (college admissions with quotas) versions. Why it matters for The Network: its "college with quota" variant is the ancestor of our capacity-constrained (budgeted) matching.

- **[Who Gets What — and Why: The New Economics of Matchmaking and Market Design](https://openlibrary.org/books/OL27186738M)**. Alvin E. Roth, 2015. *Book · ~6 hrs · Intro*
  A popular-audience book on matching markets: medical residency, school choice, kidney exchange, dating and "repugnant" transactions. It is organized around thickness, congestion and safety. Why it matters for The Network: it gives the whole team a shared vocabulary for why a curated, invite-only, budgeted market can beat an open feed.

- **[The Theory and Practice of Market Design (Nobel Prize Lecture)](https://www.nobelprize.org/prizes/economic-sciences/2012/roth/lecture/)**. Alvin E. Roth, 2012. *Talk · ~45 min · Intermediate*
  Roth's Nobel lecture (slides and full-text PDF on the page) on market design as an engineering discipline: diagnose failures, design mechanisms, iterate. Why it matters for The Network: it models the simulate → deploy → measure → redesign loop we run with the 500-persona world.

- **[The Redesign of the Matching Market for American Physicians](https://web.stanford.edu/~niederle/nrmpdesign.pdf)**. Alvin Roth & Elliott Peranson, 1999. *Paper · ~1.5 hrs · Intermediate*
  The NRMP case study: how the residency match was re-engineered (applicant-proposing DA, couples, computational experiments on real data). Why it matters for The Network: it is a template for using simulation on real preference data to choose between mechanisms before deploying, which is exactly what our persona simulator is for.

- **[Kidney Exchange](https://www.nber.org/papers/w10002)**. Alvin Roth, Tayfun Sönmez, M. Utku Ünver, 2004 (QJE; NBER WP 10002). *Paper · ~1.5 hrs · Advanced*
  It designs exchanges among incompatible donor–patient pairs (cycles and chains) with efficiency and incentive guarantees. Why it matters for The Network: it is the archetype of non-bipartite matching with small cycles, analogous to our 3–6 person groups and multi-hop warm paths.

- **[Stable Matching (Kleinberg–Tardos Ch. 1 lecture slides)](https://www.cs.princeton.edu/~wayne/kleinberg-tardos/pdf/01StableMatching.pdf)**. Kevin Wayne (Princeton), based on Kleinberg & Tardos *Algorithm Design*. *Course · ~40 min · Intro*
  Textbook-standard slides with worked examples, proofs, implementation details (O(n²)) and variants. Why it matters for The Network: it is the cleanest reference if you need to implement the offline blocking-pair diagnostic yourself.

- **[Stable roommates problem](https://en.wikipedia.org/wiki/Stable_roommates_problem)**. Wikipedia (with Mertens, "Stable Roommates Problem with Random Preferences", 2014, as a follow-up). *Docs · ~15 min · Intermediate*
  Follow-up: <https://arxiv.org/abs/1401.5269> Covers the non-bipartite version, Irving's algorithm, and examples where no stable matching exists. Mertens shows that the probability a stable solution exists shrinks as the pool grows. Why it matters for The Network: it is the core reason we don't promise "stable" peer or friend intros and use welfare plus floors instead.

*Assignment, b-matching & optimization*

- **[Hungarian algorithm for solving the assignment problem](https://cp-algorithms.com/graph/hungarian-algorithm.html)**. cp-algorithms.com. *Docs · ~40 min · Intermediate*
  A careful step-by-step derivation (potentials, augmenting paths, O(n³)) with reference code. Why it matters for The Network: it builds intuition for "optimal set of pairs at once" before you hand richer constraints to CP-SAT. For quick experiments, `scipy.optimize.linear_sum_assignment` implements the same problem.

- **[The CP-SAT Primer: Using and Understanding Google OR-Tools' CP-SAT Solver](https://d-krupke.github.io/cpsat-primer/)**. Dominik Krupke et al., ongoing. *Docs · ~3 hrs (first chapters ~45 min) · Intermediate*
  The best practical guide to modeling with CP-SAT: variables, constraints, objectives, performance tips and common pitfalls, with many Python examples. Why it matters for The Network: it is what you read when the run-level b-matching selector gets slow or needs new constraints (exposure floors, cooldowns, time-window conflicts).

*Reciprocal recommendation, congestion & dating markets*

- **[Reciprocal Recommenders](https://ls13-www.cs.tu-dortmund.de/homepage/ITWP2010/papers/ReciprocalRecommender.pdf)**. Luiz Pizzato, Tomek Rej, Thomas Chung, Kalina Yacef, Irena Koprinska, Judy Kay, 2010 (ITWP workshop; companion to the RecSys'10 RECON paper). *Paper · ~30 min · Intro*
  The paper that named and defined reciprocal recommenders. It explains why people-to-people recommendation differs from item recommendation (both sides must agree, popular users get overloaded, rejection hurts) and covers the RECON online-dating case study. Why it matters for The Network: it is the short, readable origin of the "score both directions, overload is a cost" rules in our scorer.

- **[Optimizing Rankings for Recommendation in Matching Markets](https://arxiv.org/abs/2106.01941)**. Yi Su, Magd Bayoumi, Thorsten Joachims, 2022 (WWW). *Paper · ~1 hr · Advanced*
  Shows that per-user greedy rankings are suboptimal in two-sided markets. Optimizing all rankings jointly for social welfare, accounting for the receiving side's limited capacity, produces more total matches. Why it matters for The Network: it is direct evidence for our *global* per-run selector instead of per-member top-k.

- **[Improving Match Rates in Dating Markets Through Assortment Optimization](https://www.informs.org/News-Room/INFORMS-Releases/News-Releases/Swipe-Left-or-Swipe-Right-New-Algorithm-Increases-Successful-Dating-Site-Matches-by-More-Than-252)**. Ignacio Rios, Daniela Saban, Fanyin Zheng, 2023 (M&SOM). *Paper · ~10 min summary / ~2 hrs paper · Intermediate*
  Open-access paper: <https://spiral.imperial.ac.uk/entities/publication/2623e0a6-0639-4bcc-84ed-8032b042c723> Field experiments at a U.S. dating app: choosing whom to show each user (accounting for both sides' like-probabilities) raised matches by 27%+. Users with many recent matches become less likely to like. Why it matters for The Network: it justifies modeling acceptance as decreasing with recent proposals, and preferring under-served members.

- **[Inside OKCupid: The math of online dating](https://www.ted.com/talks/christian_rudder_inside_okcupid_the_math_of_online_dating)**. Christian Rudder, TED-Ed, 2013. *Video · ~7 min · Intro*
  OkCupid's co-founder explains match % from first principles: each person states their answer, acceptable answers and importance, and the two directional scores are combined with a geometric mean. (His book *Dataclysm*, 2014, expands on what dating data reveals.) Why it matters for The Network: it is a concrete, explainable template for reciprocal scoring plus a steep "importance" scale that makes dealbreakers dominate.

- **[Hinge employs new algorithm to find your 'most compatible' match](https://techcrunch.com/2018/07/11/hinge-employs-new-algorithm-to-find-your-most-compatible-match-for-you/)**. Sarah Wells, TechCrunch, 2018. *Blog · ~5 min · Intro*
  How Hinge learns preferences from behavior, runs Gale–Shapley-style matching, and surfaces one daily mutual pick (reported 8x more likely to lead to dates). Why it matters for The Network: it is industry evidence that one scarce, high-conviction, mutual suggestion beats a feed. The transferable lesson is the scarcity, not the stability step.

*Fairness in matching markets*

- **[Fair Reciprocal Recommendation in Matching Markets](https://arxiv.org/abs/2409.00720)**. Yoji Tomita, Tomohiki Yokoyama, 2024 (RecSys). *Paper · ~1 hr · Advanced*
  Defines envy-freeness of match *opportunities* in reciprocal recommendation and uses Nash social welfare to trade off total matches against fairness. MIT-licensed code and synthetic market generators are available. Why it matters for The Network: Nash welfare is a principled candidate objective for our selector, and the generators are useful for unit-testing exposure budgets.

- **[CS7792: Bias and Fairness in Learning Systems](https://www.cs.cornell.edu/courses/cs7792/2020sp/)**. Thorsten Joachims, Cornell, 2020. *Course · ~1 hr for intro lecture; course is multi-week · Advanced*
  A graduate reading course (slides and paper list) on exposure fairness in rankings and two-sided marketplaces. Start with the intro lecture: <https://www.cs.cornell.edu/courses/cs7792/2020sp/lectures/01-intro.pdf>. Why it matters for The Network: it is the structured path into "fairness of exposure", the theory behind newcomer exposure floors and amortized fairness across weekly runs.

*Groups, teams, seating & social choice*

- **[Algorithms for Group Recommendation (Ch. 2 of *Group Recommender Systems: An Introduction*)](https://ase.sai.tugraz.at/wp-content/uploads/sites/34/2014/01/grouprecommendersystemschapter2.pdf)**. Alexander Felfernig, Müslüm Atas, Denis Helic, Thi Ngoc Trang Tran, Martin Stettinger, Ralph Samer (in Felfernig, Boratto, Stettinger, Tkalčič, eds.), 2018. *Book · ~1 hr · Intermediate*
  A free chapter with worked examples of aggregation functions (average, least misery, most pleasure, Borda, approval, and more) applied to recommending items to groups. Why it matters for The Network: apply the same aggregation to choosing the *activity or venue* for a group once its members are picked.

- **[Finding a Team of Experts in Social Networks](https://faculty.cc.gatech.edu/~zha/CSE8801/social-network/p467-lappas.pdf)**. Theodoros Lappas, Kun Liu, Evimaria Terzi, 2009 (KDD). *Paper · ~1 hr · Intermediate*
  The founding team-formation paper: cover a set of required skills while minimizing communication cost (graph diameter or MST) among chosen members. It is NP-hard, solved with approximations. Why it matters for The Network: it is the formal model for skill-based groups (help requests, collaborators), where "low coordination cost" maps to existing warm ties.

- **[Finding an Optimal Seating Chart](https://improbable.com/news/2012/Optimal-seating-chart.pdf)**. Meghan Bellows & J. D. Luc Peterson, 2012 (Annals of Improbable Research). *Paper · ~20 min · Intro*
  A short, fun wedding-seating integer program: binary seat variables, table capacities, and a "knows each other" objective with a minimum-connections constraint. Why it matters for The Network: it is a readable first ILP for the monthly gathering's table plan. We'd flip the sign to favor 1–2 warm ties plus new people.

- **[Why Democracy Is Mathematically Impossible](https://www.youtube.com/watch?v=qf7ws2DF-zk)**. Veritasium, 2024. *Video · ~24 min · Intro*
  A well-produced intro to social choice: plurality, ranked-choice, Condorcet, Arrow's impossibility theorem, and approval voting. Why it matters for The Network: it shows why there is no neutral way to aggregate group members' preferences, so our choice of "average + least-misery floor" is a design value to state and test, not a fact.

*LLM-agent markets*

- **[Do Matching Mechanisms Work with LLM Agents?](https://arxiv.org/abs/2606.03030)**. Yukihiro Hoshino, Ayato Kitadai, Nariaki Nishino, 2026. *Paper · ~1 hr · Advanced*
  Compares free negotiation among LLM agents with structured mechanisms (DA, EADA, TTC) in one-to-one matching. Mechanisms give better stability and efficiency, and LLM agents report truthfully more often than humans, but strategy-proofness doesn't reliably predict truth-telling. Why it matters for The Network: our simulator *is* LLM agents in a matching market, and future agent-to-agent intent negotiation must not assume textbook incentive guarantees hold.

- **[Magentic Marketplace: An Open-Source Environment for Studying Agentic Markets](https://arxiv.org/abs/2510.25779)**. Gagan Bansal, Wenyue Hua, Zezhou Huang et al. (Microsoft Research), 2025. *Paper · ~1 hr (blog ~10 min) · Intermediate*
  Blog: <https://www.microsoft.com/en-us/research/blog/magentic-marketplace-an-open-source-simulation-environment-for-studying-agentic-markets/> An open-source two-sided market simulator where assistant agents represent consumers and service agents represent businesses. It finds strong first-proposal bias (speed beats quality by 10–30x) and a paradox of choice. Why it matters for The Network: it is a reference design and a list of failure modes for our 500-persona simulator, including the warning that LLM agents accept early, agreeable offers.

## 4. Search, retrieval and recommender systems

The Network's matching engine is a small recommender system. It turns member "facets" into embeddings, retrieves candidates, scores and judges them, explores, logs, and polices fairness. This section gives a newcomer the vocabulary and mental models behind each of those stages. Local deep-dive: `~/thenetwork/docs/research/matching-and-graphs.md` (section 5 covers fairness, exposure, cold start and exploration; section 7 covers learning-to-rank and two-tower models).

### 4.1 Key concepts

- **TF-IDF and BM25 (lexical retrieval).** These methods score a document by how often the query's words appear in it (term frequency). Words that are rare across the whole collection count for more (inverse document frequency). BM25 adds saturation, so the 10th mention adds little, and it adjusts for document length. *Why it matters:* exact terms such as "Rust," "Series A" or "ceramics" are often lost by embeddings. A lexical or tag-match channel catches them, which is why the engine also retrieves by tag match and not only by vectors.
- **Text embeddings and semantic similarity.** A model maps text to a vector of a few hundred to a few thousand numbers, so that texts with similar meanings sit close together. Closeness is usually measured with cosine similarity or dot product. *Why it matters:* every facet ("wants a cofounder for a climate hardware startup") is stored as an embedding in pgvector. "Nearby" facets are the raw material for most candidate matches.
- **Exact kNN vs. approximate nearest neighbor (ANN, e.g., HNSW).** Exact k-nearest-neighbor search compares the query against every vector, which is perfect but O(N). ANN indexes such as HNSW (a layered "small-world" graph) answer much faster but miss some true neighbors (lower recall). *Why it matters:* with 150–1,000 members, exact search is cheap and gives perfect recall, so the engine uses it on purpose. Know the trade-off before anyone "optimizes" by adding an index.
- **Filtered vector search pitfalls.** With an ANN index, a SQL `WHERE` clause (same city, not blocked, opted in) is often applied *after* the index returns its top candidates. A query for 20 neighbors can then silently return 3. pgvector 0.8 added iterative index scans to mitigate this. *Why it matters:* hard filters such as consent, city and do-not-match lists are non-negotiable in our engine, so we must never lose results to post-filtering.
- **Hybrid search and rank fusion (RRF).** Hybrid search runs several retrievers (vector, keyword or tag, graph) and merges their ranked lists. Reciprocal Rank Fusion scores each item by Σ 1/(k + rank) across the lists. It is simple, needs no tuning of score scales, and is surprisingly strong. *Why it matters:* the engine already has three candidate channels (kNN, tag, 2-hop graph), and RRF is the standard baseline for combining them.
- **Two-stage retrieval → re-ranking (bi-encoder vs. cross-encoder).** Cheap retrieval (embeddings computed separately for each side) finds a few hundred candidates. An expensive model then looks at each (query, candidate) *pair* together and re-scores it. *Why it matters:* the LLM judge is a (very expensive) cross-encoder-style re-ranker. Understanding this split explains why it only sees a short list.
- **RAG (retrieval-augmented generation).** RAG retrieves relevant documents and puts them in an LLM's prompt so the model's answer is grounded in them. *Why it matters:* when the agent writes an intro message or explains a match, it is doing RAG over member facets and history. Retrieval quality directly limits how good and how accurate the message is.
- **Collaborative vs. content-based filtering, and cold start.** Collaborative filtering recommends from behavior ("people like you accepted X"). Content-based filtering recommends from attributes (facet text). New users and items with no behavior are "cold." *Why it matters:* every new member is cold and behavioral data is tiny, so The Network is mostly content-based today. Learned signals have to be blended in gradually.
- **Candidate generation → scoring → re-ranking pipeline (and two-tower models).** Production recommenders split the work into stages: recall-oriented retrieval, precise scoring, and policy-aware re-ranking (diversity, fairness, business rules). A two-tower model learns separate "user" and "item" encoders so that retrieval becomes a dot product. *Why it matters:* our engine runs retrieval, then component scoring, then the LLM judge, then the exposure, diversity and exploration policy. That is this pipeline. A trained two-tower model is a possible later replacement for generic embeddings.
- **Learning to rank (LTR) and LambdaMART.** LTR trains a model to order items rather than to predict a score for each one. LambdaMART (gradient-boosted trees with ranking-aware gradients) is the long-standing strong default for tabular features. *Why it matters:* the planned first learned scorer is LambdaMART over our logged score components, trained on reviewer and outcome labels.
- **Offline ranking metrics.** Precision@k and recall@k measure how many good items are in the top k. NDCG rewards putting good items higher in the list. "Beyond-accuracy" metrics matter as much: coverage (how many members ever get recommended), diversity, novelty and serendipity. *Why it matters:* a network that keeps re-introducing the same 30 well-connected people can score well on precision while failing as a community.
- **Explore/exploit and multi-armed bandits (Thompson sampling).** Exploitation always picks what currently looks best, so it never learns about the other options. Bandit algorithms balance trying uncertain options against using known good ones. Thompson sampling keeps a probability distribution over each option's success rate, samples from it, and picks the highest sample. *Why it matters:* the engine's exploration budget uses Beta-Bernoulli Thompson sampling over match types. It is simple, works with delayed feedback (opt-ins take days), and gives you selection probabilities to log.
- **Propensity logging and off-policy evaluation (OPE).** If you log the probability with which the system chose each action, you can later estimate how a *different* policy would have performed on the same logs. The estimators are IPS and doubly robust. *Why it matters:* with a few hundred members, A/B tests are underpowered. OPE over propensity-logged proposals is how we will compare scorer versions, and it only works if we log propensities from day one.
- **Popularity bias and fairness of exposure.** Recommenders amplify already-popular items. Fairness of exposure asks that attention (here, being proposed) track merit or relevance, and amortized versions of it track the gap over time. *Why it matters:* members with rich profiles dominate kNN. Without exposure accounting, a small elite gets every intro, and newcomers churn.
- **Diversity re-ranking (MMR, DPPs).** Maximal Marginal Relevance greedily picks the next item that is relevant but unlike those already chosen. Determinantal point processes score whole *sets* for joint relevance and dissimilarity. *Why it matters:* they keep a member's weekly suggestions from being three near-identical intros, and they help compose small groups with complementary members.

### 4.2 Must-read / must-watch

*Ordered as a learning sequence: classic retrieval → embeddings → vector DB in our stack → recsys architecture → exploration → counterfactual evaluation.*

- **[Introduction to Information Retrieval (Ch. 1, 6, 8, 11)](https://nlp.stanford.edu/IR-book/)**. Christopher D. Manning, Prabhakar Raghavan, Hinrich Schütze, 2008. *Book · ~6 hrs for the four chapters · Intro*
  The standard IR textbook, free online. Ch. 6 covers TF-IDF and the vector space model, Ch. 8 covers evaluation (precision, recall, MAP, NDCG), and Ch. 11 covers probabilistic retrieval and BM25. Why it matters for The Network: it supplies the vocabulary (recall vs. precision, relevance judgments, ranked evaluation) used in every later engine and eval discussion.

- **[The Illustrated Word2vec](https://jalammar.github.io/illustrated-word2vec/)**. Jay Alammar, 2019. *Blog · ~40 min · Intro*
  A visual walkthrough of how words become vectors, why vector arithmetic captures meaning, and how embeddings are trained with negative sampling. Why it matters for The Network: it builds the intuition for what "two facets are close in embedding space" actually means, and when that closeness can mislead.

- **[Embeddings: What they are and why they matter](https://simonwillison.net/2023/Oct/23/embeddings/)**. Simon Willison, 2023. *Blog · ~35 min · Intro*
  A practical talk-plus-writeup on sentence/document embeddings, cosine similarity, related-content features and semantic search, with working code. Why it matters for The Network: it shows the exact pattern our facet store uses (embed text, store vectors, query by similarity) at hobby-project scale, so the production version is easy to follow.

- **[pgvector README (sections: Querying, Exact vs. Approximate Search, HNSW, Filtering, Iterative Index Scans)](https://github.com/pgvector/pgvector)**. Andrew Kane / pgvector contributors, ongoing. *Docs · ~45 min · Intermediate*
  The official documentation for the Postgres extension we run. It covers distance operators, exact vs. HNSW/IVFFlat search, and why filtered queries can return fewer rows than requested. Why it matters for The Network: it explains why the engine deliberately uses exact kNN with SQL hard filters, and what breaks if someone adds an ANN index without iterative scans.

- **[Recommendation Systems (Google Machine Learning course)](https://developers.google.com/machine-learning/recommendation)**. Google for Developers, ongoing. *Course · ~4 hrs · Intro*
  A free, compact course on candidate generation, content-based vs. collaborative filtering, matrix factorization, DNN/softmax models, and retrieval → scoring → re-ranking. Why it matters for The Network: it gives you the canonical pipeline vocabulary that maps one-to-one onto our retrieval, component scoring, judge and policy stages.

- **[System Design for Recommendations and Search](https://eugeneyan.com/writing/system-design-for-discovery/)**. Eugene Yan, 2021. *Blog · ~30 min · Intermediate*
  Distills industry designs (Alibaba, Facebook, JD, Doordash, LinkedIn and others) into an offline/online × retrieval/ranking framework. Why it matters for The Network: it shows how real systems separate nightly batch work (embedding, indexing) from request-time ranking, which mirrors our nightly matching run.

- **[The Multi-Armed Bandit Problem and Its Solutions](https://lilianweng.github.io/posts/2018-01-23-multi-armed-bandit/)**. Lilian Weng, 2018. *Blog · ~40 min · Intermediate*
  A clear tour of ε-greedy, UCB and Thompson sampling with regret intuition and code. Why it matters for The Network: it is the fastest route to understanding why our exploration budget exists and why it uses Thompson sampling rather than a fixed random slice.

- **[A Tutorial on Thompson Sampling (read Sections 1–4, 7)](https://arxiv.org/abs/1707.02038)**. Daniel Russo, Benjamin Van Roy, Abbas Kazerouni, Ian Osband, Zheng Wen, 2017/2018. *Paper · ~2 hrs (selected sections) · Intermediate*
  The definitive tutorial: Beta-Bernoulli TS worked through by example, then extensions (approximations, nonstationarity, when TS is a poor choice). Why it matters for The Network: our arms (generator × category × format) are exactly the Beta-Bernoulli setting it walks through, including how to handle delayed feedback and arms whose quality drifts.

- **[Counterfactual Learning and Evaluation for Recommender Systems (RecSys'21 tutorial)](https://www.youtube.com/watch?v=HMo9fQMVB4w)**. Yuta Saito & Thorsten Joachims / ACM RecSys, 2021. *Talk · ~3 hrs video + notebooks · Advanced*
  (materials: <https://github.com/usaito/recsys2021-tutorial>)
  The standard practical primer on off-policy evaluation and learning (IPS, DM, doubly robust, and their variance trade-offs), with runnable Open Bandit Pipeline examples. Why it matters for The Network: it is the recommended onboarding for whoever owns propensity logging and "would scorer v2 have done better?" analyses.

### 4.3 Additional

*Retrieval foundations and embeddings*

- **[Practical BM25 – Part 2: The BM25 Algorithm and its Variables](https://www.elastic.co/blog/practical-bm25-part-2-the-bm25-algorithm-and-its-variables)**. Shane Connelly / Elastic, 2018. *Blog · ~20 min · Intro*
  Walks through the BM25 formula term by term, including what k1 and b do. Why it matters for The Network: it helps when tuning a Postgres full-text or tag channel to sit alongside vector kNN.

- **[The Probabilistic Relevance Framework: BM25 and Beyond](https://www.staff.city.ac.uk/~sbrp622/papers/foundations_bm25_review.pdf)**. Stephen Robertson & Hugo Zaragoza, 2009. *Paper · ~3 hrs · Advanced*
  The authoritative derivation of BM25 and BM25F (multi-field) from its inventors. Why it matters for The Network: BM25F's per-field weighting is a principled model for weighting facet types (offers vs. desires vs. interests) differently.

- **[Introduction to Text Embeddings (LLM University)](https://cohere.com/llmu/text-embeddings)**. Cohere, ongoing. *Course · ~30 min · Intro*
  A short lesson on sentence embeddings, similarity, clustering and semantic search, with visualizations. Why it matters for The Network: it is a gentle bridge from word vectors to the sentence-level embeddings we compute per facet.

- **[Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks](https://arxiv.org/abs/1908.10084)**. Nils Reimers & Iryna Gurevych, 2019. *Paper · ~1 hr · Intermediate*
  The paper that made bi-encoder sentence embeddings practical for semantic search, contrasted with slow cross-encoder BERT scoring. Why it matters for The Network: it is the conceptual origin of "embed each facet once, compare by cosine," and it explains why that is fast but less precise than pairwise judging.

- **[MTEB: Massive Text Embedding Benchmark](https://arxiv.org/abs/2210.07316)**. Niklas Muennighoff, Nouamane Tazi, Loïc Magne, Nils Reimers, 2022. *Paper · ~45 min · Intermediate*
  Benchmarks embedding models across retrieval, clustering, STS, re-ranking and other tasks, and shows that no single model wins everywhere. Why it matters for The Network: read it before picking or swapping the facet embedding model, and evaluate on our own pair-matching task, not the overall leaderboard rank.

*Vector databases, ANN and hybrid search*

- **[Hierarchical Navigable Small Worlds (HNSW)](https://www.pinecone.io/learn/series/faiss/hnsw/)**. James Briggs / Pinecone (Faiss: The Missing Manual), ~2022. *Blog · ~40 min · Intermediate*
  An illustrated explanation of probability skip lists, navigable small-world graphs, and how HNSW's layers and parameters (M, efConstruction, efSearch) trade recall for speed. Why it matters for The Network: it is what you need to know if membership ever grows enough that exact kNN becomes slow.

- **[Efficient and robust approximate nearest neighbor search using HNSW graphs](https://arxiv.org/abs/1603.09320)**. Yu. A. Malkov & D. A. Yashunin, 2016/2018. *Paper · ~1.5 hrs · Advanced*
  The original HNSW paper. Why it matters for The Network: the primary source behind pgvector's HNSW index, useful for reasoning about recall guarantees under filtering.

- **[pgvector 0.8.0 Released! (iterative index scans)](https://www.postgresql.org/about/news/pgvector-080-released-2952/)**. PostgreSQL Global Development Group / pgvector, 2024. *Docs · ~10 min · Intermediate*
  The release note introducing iterative index scans and better cost estimation for filtered vector queries. Why it matters for The Network: it is the concrete fix for the overfiltering problem if we ever move from exact scans to HNSW with WHERE clauses.

- **[Hybrid search (Supabase docs)](https://supabase.com/docs/guides/ai/hybrid-search)**. Supabase, ongoing. *Docs · ~20 min · Intermediate*
  A worked Postgres example that combines full-text search and pgvector similarity in one SQL function using Reciprocal Rank Fusion. Why it matters for The Network: it is copy-adaptable SQL for fusing our kNN and tag/keyword channels inside the same database.

- **[Reciprocal Rank Fusion outperforms Condorcet and individual Rank Learning Methods](https://cormack.uwaterloo.ca/cormacksigir09-rrf.pdf)**. Gordon V. Cormack, Charles L. A. Clarke, Stefan Büttcher, 2009. *Paper · ~20 min · Intermediate*
  A two-page paper showing that the simple 1/(k+rank) fusion beats more elaborate methods. Why it matters for The Network: it justifies a no-tuning default for merging the kNN, tag and 2-hop graph candidate lists.

- **[Rerankers and Two-Stage Retrieval](https://www.pinecone.io/learn/series/rag/rerankers/)**. James Briggs / Pinecone, ~2023. *Blog · ~25 min · Intermediate*
  Explains bi-encoder retrieval followed by cross-encoder re-ranking, and why the second stage improves precision. Why it matters for The Network: it is the mental model for why the LLM judge only sees a pre-filtered short list, and where a cheaper cross-encoder could sit between retrieval and the judge.

- **[Retrieve & Re-Rank (Sentence-Transformers docs)](https://sbert.net/examples/sentence_transformer/applications/retrieve_rerank/README.html)**. UKP Lab / sbert.net, ongoing. *Docs · ~20 min · Intermediate*
  Runnable code for the bi-encoder → cross-encoder pipeline with pre-trained models. Why it matters for The Network: it is the quickest way to prototype a cheap re-ranker that cuts LLM-judge calls.

*RAG*

- **[Introducing Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval)**. Anthropic, 2024. *Blog · ~20 min · Intermediate*
  Shows that adding context to chunks, combining embeddings with BM25, and re-ranking substantially cut retrieval failures, with clear ablations. Why it matters for The Network: it is a modern, measured case for hybrid + re-rank over embeddings alone, and the "add context before embedding" idea applies directly to short facet strings.

- **[Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401)**. Patrick Lewis et al., 2020. *Paper · ~1 hr · Intermediate*
  The paper that named RAG: a dense retriever feeding a generator. Why it matters for The Network: it is the foundational reference for grounding the agent's intro messages and explanations in retrieved member facts.

*Recommender architecture and learning to rank*

- **[Deep Neural Networks for YouTube Recommendations](https://research.google/pubs/deep-neural-networks-for-youtube-recommendations/)**. Paul Covington, Jay Adams, Emre Sargin (Google), 2016. *Paper · ~1 hr · Intermediate*
  The classic two-stage (candidate generation + ranking) production recommender paper, full of practical lessons on features, freshness and training. Why it matters for The Network: it is the template our multi-stage engine follows, and it shows how a learned ranker sits on top of retrieval.

- **[Sampling-Bias-Corrected Neural Modeling for Large Corpus Item Recommendations](https://research.google/pubs/sampling-bias-corrected-neural-modeling-for-large-corpus-item-recommendations/)**. Xinyang Yi et al. (Google), 2019. *Paper · ~1 hr · Advanced*
  Two-tower retrieval with in-batch negatives and a correction for item-frequency bias. Why it matters for The Network: it is the likely year-2 replacement for generic text-embedding kNN, and its frequency correction speaks directly to popular members being over-retrieved.

- **[From RankNet to LambdaRank to LambdaMART: An Overview](https://www.microsoft.com/en-us/research/publication/from-ranknet-to-lambdarank-to-lambdamart-an-overview/)**. Christopher J. C. Burges (Microsoft Research), 2010. *Paper · ~1.5 hrs · Advanced*
  A self-contained derivation of pairwise and listwise gradient-boosted ranking. For a hands-on companion, see the XGBoost LTR tutorial: <https://xgboost.readthedocs.io/en/latest/tutorials/learning_to_rank.html>. Why it matters for The Network: LambdaMART over logged score components is the planned first learned scorer.

- **[Unbiased Learning-to-Rank with Biased Feedback](https://arxiv.org/abs/1608.04468)**. Thorsten Joachims, Adith Swaminathan, Tobias Schnabel, 2017. *Paper · ~1.5 hrs · Advanced*
  Shows how inverse-propensity weighting lets you train rankers from feedback that the current ranker itself biased. Why it matters for The Network: members only respond to proposals that survived both the engine and human review, so naive training on accepts and declines will just learn the old policy.

*Evaluation, diversity and fairness*

- **[Diversity, Serendipity, Novelty, and Coverage: A Survey and Empirical Analysis of Beyond-Accuracy Objectives in Recommender Systems](https://research.ucc.ie/en/publications/diversity-serendipity-novelty-and-coverage-a-survey-and-empirical/)**. Marius Kaminskas & Derek Bridge, 2016. *Paper · ~2 hrs · Intermediate*
  Defines each beyond-accuracy objective, lists the metrics for each, and compares re-ranking strategies empirically (ACM TiiS). Why it matters for The Network: it is the source for the coverage, diversity and serendipity metrics in our nightly evaluation report.

- **[The Use of MMR, Diversity-Based Reranking for Reordering Documents and Producing Summaries](https://www.cs.cmu.edu/~jgc/publication/The_Use_MMR_Diversity_Based_LTMIR_1998.pdf)**. Jaime Carbonell & Jade Goldstein, 1998. *Paper · ~20 min · Intro*
  The short original MMR paper: λ·relevance − (1−λ)·max-similarity-to-already-selected. Why it matters for The Network: it is the simplest diversity re-ranker to implement first for a member's weekly slate of proposals.

- **[Fast Greedy MAP Inference for Determinantal Point Process to Improve Recommendation Diversity](https://arxiv.org/abs/1709.05135)**. Laming Chen, Guoxin Zhang, Hanning Zhou, 2018. *Paper · ~1 hr · Advanced*
  A practical, fast DPP re-ranker for jointly relevant and diverse sets. For DPP background, see Kulesza & Taskar, <https://arxiv.org/abs/1207.6083>. Why it matters for The Network: it provides a principled set-level diversity term for composing small groups and slates.

- **[Fairness of Exposure in Rankings](https://arxiv.org/abs/1802.07281)**. Ashudeep Singh & Thorsten Joachims, 2018. *Paper · ~1.5 hrs · Advanced*
  Defines exposure as position-weighted attention and requires it to be allocated in proportion to merit. Why it matters for The Network: our "exposure = being included in a sent proposal" accounting and exposure floors come straight from this framing.

- **[Managing Popularity Bias in Recommender Systems with Personalized Re-ranking](https://arxiv.org/abs/1901.07555)**. Himan Abdollahpouri, Robin Burke, Bamshad Mobasher, 2019. *Paper · ~45 min · Intermediate*
  A simple post-processing re-ranker that raises long-tail exposure in a controllable, per-user way. Why it matters for The Network: it offers a lightweight counter to rich-profile members dominating kNN retrieval.

*Bandits and off-policy evaluation in practice*

- **[Bandits for Recommender Systems](https://eugeneyan.com/writing/bandits/)**. Eugene Yan, 2022. *Blog · ~25 min · Intermediate*
  An industry survey of how companies (Netflix, Spotify, Yahoo and others) actually deploy bandits for recommendations, including contextual bandits and off-policy evaluation. Why it matters for The Network: it connects the bandit theory to production practice, such as logging propensities and evaluating offline.

- **[Open Bandit Pipeline (docs)](https://zr-obp.readthedocs.io/en/latest/)**. Yuta Saito et al. / ZOZO Research, ongoing. *Docs · ~1 hr · Advanced*
  A Python library of bandit policies and OPE estimators (IPS, DR, Switch-DR and others) with a real logged dataset. Why it matters for The Network: it is the easiest off-the-shelf tool to run over our propensity-logged proposal history.

- **[Bandit Algorithms](https://tor-lattimore.com/downloads/book/book.pdf)**. Tor Lattimore & Csaba Szepesvári, 2020. *Book · reference (dip in) · Advanced*
  The free, rigorous graduate text on bandits, including contextual and Bayesian methods. Why it matters for The Network: it is the reference to consult when the exploration design moves from Beta-Bernoulli arms to contextual bandits.

*LLM-based recommenders*

- **[Improving Recommendation Systems & Search in the Age of LLMs](https://eugeneyan.com/writing/recsys-llm/)**. Eugene Yan, 2025. *Blog · ~45 min · Intermediate*
  A curated synthesis of recent industry papers on LLM-augmented retrieval, ranking, semantic IDs, synthetic data and unified models. Why it matters for The Network: it is the best current map of where an LLM judge and LLM-generated features fit relative to classical rankers.

- **[A Survey on Large Language Models for Recommendation](https://arxiv.org/abs/2305.19860)**. Likang Wu et al., 2023. *Paper · ~2 hrs · Advanced*
  An academic taxonomy of LLMs used as recommenders, as feature encoders and as rankers/judges, with their known failure modes (position bias, hallucination). Why it matters for The Network: it gives a structured view of the known biases our LLM judge must be calibrated against.

## 5. Graphs, knowledge graphs and ontologies

The Network's data model (PRD Section 13) is a small, generic core: Member, Facet, Intent, Presence, typed directional Edge, Opportunity, and an immutable Event log. Specificity lives in typed, versioned facets. The model is stored in Postgres, using recursive CTEs for 2-hop warm paths and pgvector for facet embeddings. There is no graph database in v1, and an LLM extracts facets from conversation. This section covers the background you need to reason about that design. It includes how to model a graph, how to query one in SQL, how to design a vocabulary (and how to consolidate the "parallel taxonomies" noted in `docs/research/2026-10-07-consolidation.md` 1.2), how to keep facts over time, and how to decide which facet may flow to whom.

### 5.1 Key concepts

- **Graph (nodes, edges, directed, weighted, multigraph).** A graph is a set of nodes connected by edges. Edges can have a direction (A to B is not the same as B to A), a weight, and a type, and two nodes can be joined by many parallel edges. *Why it matters:* The Network's edges are directional and typed ("invited by", "vouched for", "blocked"). One pair of members can have several edges at once, so the graph is a directed, typed multigraph, not a single "friend" relation.
- **Paths, k-hop neighborhoods and triadic closure.** A path is a chain of edges. A node's 2-hop neighborhood is its friends-of-friends. Triadic closure is the tendency of two people with a shared contact to become connected themselves. *Why it matters:* Warm-path intros ("you both know Maya") are 2-hop path queries. Common-neighbor and Adamic-Adar scores (matching-and-graphs.md 4.9) are the v1 graph features.
- **Property graph vs. RDF triples.** A labeled property graph (Neo4j, Apache AGE) lets nodes and edges carry key/value properties. RDF stores everything as subject–predicate–object triples, and a statement about an edge (its confidence or source) needs extra machinery. *Why it matters:* Our Edge and Facet rows have properties (evidence, confidence, provenance, validity window), so we are effectively building a property graph in relational tables. Understanding both models helps you read the literature and avoid reinventing it badly.
- **Graphs in SQL (adjacency tables plus recursive CTEs).** You can store a graph as an `edges(src, dst, type, ...)` table and traverse it with `WITH RECURSIVE`, which includes depth limits and cycle detection. *Why it matters:* This is how the v1 engine computes warm paths. Bounded 1-3 hop traversals over roughly 10^4 edges do not need a graph database (matching-and-graphs.md 4.14).
- **Knowledge graph.** A knowledge graph is a graph of entities and typed relationships, plus a schema or ontology that gives them meaning. It is often built by integrating several messy sources. *Why it matters:* The member/facet/edge store is a small, private, personal knowledge graph that is populated mostly by LLM extraction from conversation.
- **Ontology vs. schema vs. instance data.** An ontology defines the classes (Member, Facet kinds), properties and constraints. Instance data are the actual assertions ("Ana offers Spanish tutoring"). *Why it matters:* PRD 13.1's "small core, typed facets" principle is an ontology design decision. Ontology Development 101 gives you the vocabulary to discuss it, and to know when a new facet kind should instead be a tag.
- **Controlled vocabulary, taxonomy and thesaurus (SKOS).** A controlled vocabulary is a fixed list of terms. A taxonomy arranges terms into broader/narrower hierarchies. A thesaurus adds synonyms (`altLabel`) and related terms. SKOS is the W3C standard for representing all three. *Why it matters:* The codebase has the same vocabulary (desires, skills, interests, neighborhoods) defined three times in three shapes. A single SKOS-like concept list with stable ids, a preferred label, alternate labels and broader/narrower links is the natural consolidation target.
- **Faceted classification (Ranganathan).** Faceted classification describes a thing along several independent dimensions (facets) instead of placing it in one tree. *Why it matters:* "Facet" in our schema borrows this idea. Facet kinds (skill, offer, desire, availability...) are orthogonal axes, which is why they compose well for matching and filtering.
- **Folksonomy vs. controlled vocabulary.** A folksonomy is made of free-form tags created by users. Tags have high recall and are expressive, but they are messy (synonyms, typos). Controlled terms are consistent but rigid. *Why it matters:* LLM-extracted facet text is effectively a folksonomy. The design question is how to map free text onto a controlled tag set (embeddings plus synonym lists) without losing nuance.
- **Entity resolution (record linkage, deduplication).** Entity resolution decides whether two references refer to the same real thing ("my friend Sam from climbing" vs. a member named Samantha), usually with probabilistic match scores. *Why it matters:* Facet merging ("said beats inferred"), private person stubs mentioned in conversation, and duplicate members all need entity resolution. Getting it wrong either leaks private information or creates phantom people.
- **Provenance and confidence.** Provenance records where an assertion came from (the member said it, it was inferred, someone vouched). Confidence is how sure we are. *Why it matters:* PRD 13.2 requires inferred states to be distinguishable from explicit statements. Every facet and edge must carry provenance so the agent never presents a guess as a fact.
- **Bi-temporal data (valid time vs. transaction time).** Valid time is when something was true in the world. Transaction time is when we learned or recorded it. *Why it matters:* A member can tell us on Oct 12 that they moved neighborhoods on Oct 1. Facets have `valid_from/valid_to`, and the event log supplies the recorded time, so together they give you a bi-temporal history. Zep/Graphiti uses the same model for agent memory.
- **Event sourcing.** Event sourcing stores every change as an immutable event and derives current state by replaying those events. *Why it matters:* PRD 13.4 makes invites, accepts, declines and disclosures immutable events. Profiles and graph features can then be rebuilt when the extraction model or schema changes, and that history is also the audit trail.
- **LLM-based knowledge graph construction and GraphRAG.** In this approach, an LLM extracts entities and relations from text into a graph, which is then summarized or traversed to answer questions. *Why it matters:* Our facet extractor is a narrow form of LLM knowledge graph construction. GraphRAG and Graphiti show the standard pipeline stages (extract, resolve, dedupe, invalidate) and the ways each stage fails.
- **Node embeddings and GNNs.** These methods learn vectors for nodes from graph structure (node2vec random walks, or GNN message passing) so that similar or likely-to-connect nodes end up close together. *Why it matters:* This is post-MVP. It becomes useful for link prediction and for finding members who play similar roles (connectors, hosts) once the graph has thousands of edges. GraphSAGE-style inductive methods suit our constant stream of newcomers.
- **Contextual integrity.** Under contextual integrity, privacy means information flows that match the norms of the context where the information was shared, not just a public/private switch. *Why it matters:* This is the right mental model for facet `privacy scope`. "I told the agent I'm job hunting" may flow into a private match rationale but must not flow into an intro message to my coworker.

### 5.2 Must-read / must-watch

*Suggested order: build graph intuition, then graph modeling, then SQL traversal, then knowledge graphs and ontologies, then temporal memory and event logs, then privacy of flows.*

- **[Introduction to Graph Theory: A Computer Science Perspective](https://www.youtube.com/watch?v=LFKZLXVO-Dg)**. Reducible (YouTube), 2020. *Video · ~16 min · Intro*
  An animated tour of graph vocabulary (vertices, edges, directed/weighted graphs, paths, connectivity) and why so many problems reduce to graphs. Watch it first so the terms "2-hop path" and "directed typed edge" in PRD Section 13 are immediately concrete.

- **[Network Science, Chapter 2: Graph Theory](https://networksciencebook.com/chapter/2)**. Albert-László Barabási, 2016 (free online edition). *Book · ~1.5 hrs · Intro*
  A free, richly illustrated textbook chapter covering degree, adjacency matrices, directed vs. undirected and weighted networks, paths, distances, connectedness and clustering coefficients. Clustering and path length are the basic quantities behind warm-path scoring and the network-health metrics (cluster diversity, cross-cluster ties) in matching-and-graphs.md Section 4.

- **[Graph Data Modeling Fundamentals](https://graphacademy.neo4j.com/courses/modeling-fundamentals/)**. Neo4j GraphAcademy, current. *Course · ~2-4 hrs · Intro*
  A free, hands-on course on turning use-case questions into nodes, relationships and properties, then refactoring the model as requirements change. Its "model for the questions you will ask" method is exactly how to decide whether something such as "vouched for" should be a typed Edge, a Facet, or an Event, even though we implement in Postgres rather than Neo4j. (Take the 1-hour "Neo4j Fundamentals" course in Additional first if graphs are new to you.)

- **[PostgreSQL Docs 7.8: WITH Queries (Common Table Expressions)](https://www.postgresql.org/docs/current/queries-with.html)**. PostgreSQL Global Development Group, current (v18). *Docs · ~45 min · Intermediate*
  The official reference for `WITH RECURSIVE`, including the working-table evaluation model, depth-first and breadth-first `SEARCH` ordering, and `CYCLE` detection. This is the mechanism behind our 2-hop warm-path queries over the edges table, so read the recursive-query and cycle-detection sections before touching that code.

- **[Knowledge Graphs](https://kgbook.org/)**. Aidan Hogan, Eva Blomqvist, Michael Cochez, Claudia d'Amato, et al., 2021 (free HTML edition of the Springer book). *Book · ~4 hrs for intro, data graphs, and creation/enrichment chapters; ~15 hrs full · Intermediate*
  The standard, comprehensive and freely available introduction to knowledge graphs. It covers data graph models (property graphs, RDF), schema/ontology, deductive and inductive knowledge (including embeddings), creation and enrichment from text, quality and refinement. Its creation, quality and refinement chapters map directly onto our LLM facet-extraction pipeline and its main failure modes: incompleteness, inconsistency, and duplicate entities.

- **[Ontology Development 101: A Guide to Creating Your First Ontology](https://protege.stanford.edu/publications/ontology_development/ontology101-noy-mcguinness.html)**. Natalya F. Noy & Deborah L. McGuinness (Stanford), 2001. *Paper · ~1.5 hrs · Intro*
  A classic step-by-step method: define scope with competency questions, reuse existing ontologies, enumerate terms, then define classes, properties and constraints. It also covers common traps, such as class vs. instance and when to subclass. Use its "class or property value?" guidance to decide when a new concept deserves its own facet `kind` and when it should just be a tag. That is the core judgment behind PRD 13.1 and the taxonomy consolidation.

- **[Zep: A Temporal Knowledge Graph Architecture for Agent Memory](https://arxiv.org/abs/2501.13956)**. Preston Rasmussen, Pavlo Paliychuk, Travis Beauvais, Jack Ryan, Daniel Chalef, 2025. *Paper · ~1 hr · Intermediate*
  Describes Graphiti, which builds a bi-temporal knowledge graph from agent conversations: episodes, LLM entity/edge extraction, entity resolution, edge invalidation with valid/invalid timestamps, and hybrid retrieval. It is the closest published analogue to our conversation-to-facet pipeline with `valid_from/valid_to` and "said beats inferred" merges (matching-and-graphs.md 4.18). Borrow its invalidation logic, not its separate graph store.

- **[Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html)**. Martin Fowler, 2005. *Blog · ~30 min · Intro*
  The canonical explanation of storing every state change as an immutable event, with rebuild, temporal query and replay, plus the pitfalls around external systems during replay. PRD 13.4 depends on this pattern to rebuild derived profiles and graph features after model changes. Its warning about external gateways means a replay must never re-send an iMessage.

- **[Privacy as Contextual Integrity](https://nissenbaum.tech.cornell.edu/papers/H.%20Nissenbaum,%20_Privacy%20as%20Contextual%20Integrity.pdf)**. Helen Nissenbaum, Washington Law Review, 2004. *Paper · ~2 hrs · Intermediate*
  The founding paper arguing that privacy violations are inappropriate information flows: flows that break the norms of appropriateness and distribution of the context where the information was shared. Use it to define each facet's privacy scope as permitted flows (to the matcher, into a rationale, into an intro message, to a named member), not as a public/private boolean.

### 5.3 Additional

- **[Neo4j Fundamentals](https://graphacademy.neo4j.com/courses/neo4j-fundamentals/)**. Neo4j GraphAcademy, current. *Course · ~1 hr · Intro*
  A free short course on graph thinking, graph structures, common use cases, and basic Cypher. It is the recommended prerequisite to Graph Data Modeling Fundamentals and gives you the property-graph mental model behind our Edge table.

- **[Graph Theory (lecture series)](https://www.youtube.com/playlist?list=PLGxuz-nmYlQOiIOriTXMEoGoybUC3Jmrn)**. Sarada Herke (YouTube), 2013-2016. *Video · ~5-10 min per video · Intro*
  Clear chalkboard-style short lectures on definitions, degree, walks/paths, connectivity, and graph proofs, in the spirit of Trudeau's *Introduction to Graph Theory*. Good if you want more rigor on paths and connectivity than the Reducible video, before writing traversal logic.

- **[Graph Databases (2nd ed.)](https://neo4j.com/lp/book-graph-databases/)**. Ian Robinson, Jim Webber, Emil Eifrem (O'Reilly), 2015, free ebook via Neo4j. *Book · ~6 hrs · Intermediate*
  A practical book on storing connected data, graph data modeling, building graph applications, and graph-based prediction (free after a registration form). Its data-modeling chapters show how to model context-rich relationships, which helps when Edge types multiply. Read it with our "Postgres first, no graph DB in v1" decision in mind.

- **[RDF Triple Stores vs. Labeled Property Graphs: What's the Difference?](https://neo4j.com/blog/rdf-triple-store-vs-labeled-property-graph-difference/)**. Jesús Barrasa (Neo4j blog), 2017. *Blog · ~15 min · Intro*
  A concise comparison of the two graph data models, focused on how each handles properties on relationships. It explains why a property-graph-like design (edges carrying evidence, confidence and provenance) suits our Edge and Facet rows better than raw triples.

- **[RDF 1.1 Primer](https://www.w3.org/TR/rdf11-primer/)**. W3C (eds. Guus Schreiber, Yves Raimond), 2014. *Docs · ~1 hr · Intro*
  The official gentle introduction to triples, IRIs, literals, vocabularies, and named graphs. Read it to understand the RDF and semantic-web vocabulary used in the knowledge graph literature and in standards such as SKOS and schema.org, which we may borrow ids from.

- **[Apache AGE](https://age.apache.org/)**. Apache Software Foundation, current. *Docs · ~30 min · Intermediate*
  A Postgres extension that adds openCypher property-graph queries alongside SQL in the same database (source: <https://github.com/apache/age>). It is the documented escape hatch if 2-hop recursive CTEs become unreadable, without adding a separate graph store (matching-and-graphs.md 4.15).

- **[SKOS Simple Knowledge Organization System Primer](https://www.w3.org/TR/skos-primer/)**. W3C (eds. Antoine Isaac, Ed Summers), 2009. *Docs · ~1 hr · Intro*
  The standard model for concept schemes: concepts with stable ids, `prefLabel`/`altLabel`, `broader`/`narrower`/`related`, and mappings between schemes. It is a ready-made shape for the single `packages/core` taxonomy that should replace the duplicated DESIRES/SKILLS/INTERESTS/NEIGHBORHOODS definitions.

- **[Facet](https://isko.org/cyclo/facet)**. Michèle Hudon, ISKO Encyclopedia of Knowledge Organization. *Docs · ~45 min · Intermediate*
  A scholarly encyclopedia entry on facets, from Ranganathan's Colon Classification (Personality, Matter, Energy, Space, Time) to modern faceted navigation. It gives the intellectual roots of our "Facet" object and a principled test for whether two facet kinds are truly orthogonal.

- **[Folksonomy Coinage and Definition](https://vanderwal.net/folksonomy.html)**. Thomas Vander Wal, 2007. *Blog · ~10 min · Intro*
  A short page by the person who coined the term "folksonomy", defining it and distinguishing broad from narrow folksonomies. It helps you frame LLM-extracted free-text facets as a folksonomy that must be reconciled with our controlled tag vocabulary.

- **[schema.org: Person](https://schema.org/Person)**. Schema.org, current. *Docs · ~20 min · Intro*
  The widely used public vocabulary for describing people, with properties such as `knows`, `knowsAbout`, `knowsLanguage`, `seeks` and `homeLocation`. Use it as a reuse check before naming new facet kinds or attributes. Aligning names where it is cheap makes future import and export (for example the Gateway connectors) easier.

- **[ESCO Skills & Competences pillar](https://esco.ec.europa.eu/en/classification/skill_main)**. European Commission, current. *Docs · ~45 min · Intermediate*
  A real, large-scale multilingual skill taxonomy (about 13k concepts, with preferred and alternate labels and hierarchy), published as SKOS linked data. It is a worked example of how to structure `skill` and `offer` facet tags, and a candidate source for synonyms when normalizing LLM-extracted skills.

- **[The O\*NET Content Model](https://www.onetcenter.org/content.html)**. O\*NET Resource Center (U.S. Dept. of Labor), current. *Docs · ~30 min · Intro*
  The conceptual framework behind O\*NET. It separates worker characteristics (abilities, interests, work styles) from worker requirements (skills, knowledge) and from occupation-specific data. It is a good model for keeping trait, skill and interest facet kinds distinct rather than collapsing them into one bag of tags.

- **[An Interactive Introduction to Record Linkage (Data Deduplication) in the Fellegi-Sunter Framework](https://www.robinlinacre.com/intro_to_probabilistic_linkage/)**. Robin Linacre, 2021 (updated 2023). *Interactive · ~1-2 hrs for the series · Intro*
  An eight-part interactive tutorial, by the author of the Splink library, on probabilistic entity resolution with match weights and waterfall charts. It is the clearest way to learn how to decide "is this mentioned person the same as that member or stub?" with calibrated confidence rather than ad-hoc string matching.

- **[Entity Resolution: Theory, Practice & Open Challenges](https://linqs.org/assets/resources/getoor-vldb12.pdf)**. Lise Getoor & Ashwin Machanavajjhala, VLDB, 2012. *Paper · ~1 hr · Advanced*
  A widely cited tutorial surveying entity resolution across databases, machine learning and NLP: blocking, pairwise matching, collective (graph-aware) resolution, and open problems. It is useful when facet and stub merging needs to use relationship context ("same name, same climbing gym") rather than names alone.

- **[Bitemporal History](https://www.martinfowler.com/articles/bitemporal-history.html)**. Martin Fowler, 2021. *Blog · ~20 min · Intro*
  A short worked example (a retroactive pay raise) separating "actual/valid" history from "record/transaction" history. It shows exactly how facet `valid_from/valid_to` should combine with event-log timestamps when members correct past facts.

- **[Graphiti (open-source library)](https://github.com/getzep/graphiti)**. Zep (getzep), current. *Docs · ~45 min · Intermediate*
  The code behind the Zep paper: incremental, bi-temporal knowledge graph construction from conversations, with hybrid semantic, keyword and graph retrieval. Read its extraction, deduplication and edge-invalidation prompts as reference designs for our facet extractor.

- **[GraphRAG: Unlocking LLM Discovery on Narrative Private Data](https://www.microsoft.com/en-us/research/blog/graphrag-unlocking-llm-discovery-on-narrative-private-data/)**. Microsoft Research (Jonathan Larson, Steven Truitt), 2024. *Blog · ~15 min · Intro*
  An accessible introduction to building an LLM-generated knowledge graph over private text and using it to answer questions that plain vector RAG misses, because they require connecting scattered facts. It is useful framing for "latent opportunity" discovery, which is also about connecting facts that no single message states.

- **[From Local to Global: A Graph RAG Approach to Query-Focused Summarization](https://arxiv.org/abs/2404.16130)**. Darren Edge, Ha Trinh, Newman Cheng, et al. (Microsoft), 2024. *Paper · ~1.5 hrs · Advanced*
  The GraphRAG paper: LLM entity/relation extraction, community detection (Leiden), community summaries, and map-reduce answering. Implementation docs are at <https://microsoft.github.io/graphrag/>. Its community-summary idea parallels our nightly cluster labeling and could support "network-level capability stories" (PRD 5.4).

- **[Unifying Large Language Models and Knowledge Graphs: A Roadmap](https://arxiv.org/abs/2306.08302)**. Shirui Pan, Linhao Luo, Yufei Wang, Chen Chen, Jiapu Wang, Xindong Wu, 2023 (IEEE TKDE 2024). *Paper · ~2 hrs · Advanced*
  A survey of KG-enhanced LLMs, LLM-augmented KGs (including LLM-based construction and completion) and synergized approaches. Use it as a map of the techniques beyond simple extraction, such as KG completion to suggest inferred facets, so you can place our pipeline in the wider field.

- **[A Gentle Introduction to Graph Neural Networks](https://distill.pub/2021/gnn-intro/)**. Benjamin Sanchez-Lengeling, Emily Reif, Adam Pearce, Alexander B. Wiltschko (Distill), 2021. *Interactive · ~1 hr · Intermediate*
  A beautifully illustrated, interactive explanation of how graphs become tensors and how message passing learns node, edge and graph representations, with a playground. It is the best first read before any post-MVP learned graph model for link prediction over our member graph.

- **[node2vec: Scalable Feature Learning for Networks](https://arxiv.org/abs/1607.00653)**. Aditya Grover & Jure Leskovec, KDD 2016. *Paper · ~1 hr · Advanced*
  Learns node embeddings from biased random walks whose p/q parameters trade off community (homophily) against structural-role similarity. Its structural-role mode could find "connector" or "host" members across clusters once the graph is large (matching-and-graphs.md 4.10).

- **[Stanford CS224W: Machine Learning with Graphs](https://www.youtube.com/playlist?list=PLoROMvodv4rPLKxIpqhjhPgdQy7imNkDn)**. Jure Leskovec (Stanford Online), 2021. *Course · ~20+ hrs · Advanced*
  The full lecture series on node embeddings, link prediction, GNNs (including GraphSAGE), knowledge graph embeddings and recommender systems. Slides and assignments are at <https://web.stanford.edu/class/cs224w/>. Watch lectures 1-3 (graphs, traditional features, node embeddings) and the recommender lecture for the theory behind retrieval channels in PRD 14.2.

## 6. LLM and agent foundations

The Network is an LLM agent you text. To work on it you need a working mental model of what a language model is, how it is steered (prompts, schemas, tools), how an agent loop and its memory are put together, how the Network exposes itself to other assistants (MCP), and where these systems break (prompt injection, cost, quality drift). This section gets you there in a deliberate order.

### 6.1 Key concepts

- **Token and context window.** An LLM reads and writes text in small chunks (tokens) and can only "see" a fixed number of them at once (its context window). Everything the Network agent knows about a member during a reply has to fit in that window, which is why we summarize, retrieve and select context rather than paste in whole histories.
- **Next-token prediction, pretraining vs. post-training.** A base model is trained to predict the next token over internet-scale text; assistant behavior (following instructions, refusing, using a persona) is added afterwards with fine-tuning and RLHF. This explains why models are fluent but can be confidently wrong (hallucinate), and why our deterministic services, not the model, enforce privacy and consent.
- **Prompt (system prompt, few-shot examples).** The instructions and examples we send with each call; they are the main lever for tone, format and behavior. The Network's voice over SMS, its onboarding questions and its judge rubrics are all prompts that we version and test like code.
- **Structured output / JSON Schema extraction.** Asking the model to return JSON that must validate against a schema, often enforced by the provider ("constrained decoding"). Facet extraction from onboarding chats depends on this: the matching engine in Postgres can only use facts that arrive as valid, typed fields.
- **Tool use / function calling.** The model is given descriptions of functions; instead of answering in prose it can emit a structured "call this tool with these arguments" message, which our code executes and feeds back. In elizaOS these are Actions; in MCP they are tools; their names, descriptions and argument schemas are effectively prompts.
- **Agent vs. workflow.** A workflow is a fixed, code-defined sequence of LLM calls; an agent lets the model decide its next step in a loop (reason, act, observe). The Network deliberately mixes both: a conversational agent at the edge, and predictable pipelines (filters, scoring, judge, state machines) in the matching core.
- **ReAct loop.** The pattern of interleaving reasoning ("thought") with actions (tool calls) and observations until a task is done. It is the mental model behind how an elizaOS agent picks an Action in response to a message.
- **Context engineering.** Treating what goes into the context window as a scarce, curated resource: which memories, facts, tool results and instructions to include for this turn. Good context engineering is what makes a reply feel like the agent remembers you without leaking someone else's private facts into it.
- **Agent memory (short-term, long-term, reflection).** Recent messages live in context; older facts live in an external store and are retrieved by relevance, recency and importance; periodic "reflection" condenses raw events into higher-level beliefs. Member facets, conversation summaries and persona-agent memories in the simulator are all applications of this.
- **elizaOS building blocks.** A character file (persona), Actions (things the agent can do), Providers (inject context into the prompt each turn), Evaluators (run after a turn to extract or check things), Services and plugins. The Network ships as plugins on this runtime, so this vocabulary is used in every code review.
- **Model Context Protocol (MCP).** An open standard that lets AI apps (ChatGPT, Claude) connect to external servers exposing tools, resources and prompts. The connector prototype is an MCP server, so its tool design and privacy guard determine what another company's assistant can learn about a member.
- **Prompt injection and the lethal trifecta.** Text from an untrusted source (an inbound SMS, a profile, a web page) can contain instructions the model follows. Any agent that combines private data, untrusted input and a way to send data out is exploitable; the Network has all three, which is why consent, sending and disclosure checks are deterministic code outside the model.
- **LLM-as-judge and evals.** Using a model (with a rubric) to grade other model outputs, calibrated against human labels, and running fixed test suites on every change. The Network's recommender/judge evals, pass^k scenario runs and error analysis are how we know a prompt or model change helped rather than hurt.
- **Cost and latency budgets.** Every call has a price per token and a delay; multi-step agents multiply both. This drove the choice of a cheaper default model that ties a larger one on accuracy, and it shapes how much reasoning we can afford per inbound text.
- **Prompt programs (DSPy).** Writing LLM pipelines as typed modules (signatures) whose prompts are optimized automatically against a metric instead of hand-tuned. Relevant when our extraction and judge prompts have enough labelled data to be optimized rather than edited by hand.

### 6.2 Must-read / must-watch

- **[\[1hr Talk\] Intro to Large Language Models](https://www.youtube.com/watch?v=zjkBMFhNj_g)**. Andrej Karpathy (YouTube), 2023. *Video · ~1 hr · Intro*
  A one-hour, non-technical tour of what an LLM is (a compressed model of internet text), how it is trained and fine-tuned, the "LLM as operating system" view, and a closing section on jailbreaks and prompt injection. Why it matters for The Network: it is the shortest path for anyone, engineer or not, to a correct mental model of the component at the center of every member conversation.

- **[Neural Networks (series, incl. "Transformers, the tech behind LLMs" and "Attention in transformers, step-by-step")](https://www.3blue1brown.com/topics/neural-networks)**. 3Blue1Brown (Grant Sanderson), 2017-2024. *Video · ~2-3 hrs for the series; ~1 hr for chapters 5-6 only · Intro*
  Animated, intuition-first explanations of neural networks, gradient descent and the transformer/attention mechanism; chapters 5 and 6 are on YouTube at <https://www.youtube.com/watch?v=wjZofJX0v4M> and <https://www.youtube.com/watch?v=eMlx5fFNoYc>. Why it matters for The Network: understanding embeddings and attention makes retrieval, similarity scoring and "why the model ignored part of my prompt" much less mysterious.

- **[Prompt engineering overview (and Anthropic's Interactive Prompt Engineering Tutorial)](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview)**. Anthropic, 2024-2026. *Docs + Interactive · ~1 hr docs; ~3-4 hrs tutorial · Intro*
  The official guide to clear instructions, examples, XML-tagged structure, role prompting and chain-of-thought; the companion nine-chapter notebook tutorial with exercises is at <https://github.com/anthropics/prompt-eng-interactive-tutorial>. Why it matters for The Network: onboarding questions, the SMS voice, facet extraction and judge rubrics are all prompts, and these techniques are what we use to fix them.

- **[Structured Outputs and Function calling guides](https://developers.openai.com/api/docs/guides/structured-outputs)**. OpenAI, 2024-2026. *Docs · ~45 min · Intro*
  How to make a model return JSON guaranteed to match a JSON Schema, and (companion page <https://developers.openai.com/api/docs/guides/function-calling>) how tool/function calling works end to end; Anthropic's equivalent is <https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview>. Why it matters for The Network: facets extracted from chat must validate before they enter Postgres, and every Action/MCP tool is a function definition the model calls.

- **[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)**. Erik Schluntz and Barry Zhang (Anthropic), 2024. *Blog · ~25 min · Intro*
  A practical taxonomy of workflows (prompt chaining, routing, parallelization, orchestrator-workers, evaluator-optimizer) versus autonomous agents, with the advice to use the simplest pattern that works. Why it matters for The Network: it gives the shared vocabulary for why matching is a deterministic pipeline with an LLM judge, while conversation is agentic.

- **[LLM Powered Autonomous Agents](https://lilianweng.github.io/posts/2023-06-23-agent/)**. Lilian Weng, 2023. *Blog · ~1 hr · Intermediate*
  A dense survey of agent components (planning, memory, tool use) that summarizes ReAct, Reflexion, MemGPT-era memory ideas, Generative Agents and more, with references. Why it matters for The Network: it maps every agent subsystem we build (planning a reply, recalling member facts, calling tools) to the research it came from, so you can go deeper where needed.

- **[Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)**. Anthropic Applied AI team, 2025. *Blog · ~25 min · Intermediate*
  Explains context as a finite "attention budget" and covers system prompts, tool design, just-in-time retrieval, compaction, structured note-taking and sub-agents for long-horizon work. Why it matters for The Network: deciding which member facts, past messages and match context enter each turn is the core quality and privacy problem of a long-running SMS relationship.

- **[elizaOS documentation: Plugin components, and Memory and State](https://docs.elizaos.ai/plugins/components)**. elizaOS / Eliza Labs, 2025-2026. *Docs · ~1-2 hrs · Intermediate*
  The reference for Actions, Providers, Evaluators and Services, plus <https://docs.elizaos.ai/agents/memory-and-state> for how the runtime stores and recalls memories; the framework design is described in the paper "Eliza: A Web3 friendly AI Agent Operating System" (Walters et al., 2025), <https://arxiv.org/abs/2501.06781>. Why it matters for The Network: the Network agent is built as elizaOS plugins, so this is the vocabulary and API you will write code against (read with ~/thenetwork/docs/research/eliza-integration.md).

- **[What is the Model Context Protocol (MCP)?](https://modelcontextprotocol.io/docs/getting-started/intro)**. Model Context Protocol project (Anthropic and contributors), 2024-2026. *Docs · ~30 min (plus ~30 min for Architecture) · Intro*
  The official introduction to MCP hosts, clients and servers, and the tools/resources/prompts primitives; continue with the Architecture page at <https://modelcontextprotocol.io/docs/learn/architecture>. Why it matters for The Network: the connector prototype is an MCP server that lets ChatGPT/Claude talk to the Network (read with ~/thenetwork/docs/research/mcp-server-design.md).

- **[The lethal trifecta for AI agents: private data, untrusted content, and external communication](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)**. Simon Willison, 2025. *Blog · ~15 min · Intro*
  A clear explanation of why any agent combining private data, exposure to attacker-controlled text and an exfiltration channel can be tricked into leaking data, and why guardrails that "catch 95%" are not enough. Why it matters for The Network: every inbound text is untrusted, the agent holds private member facts, and it can message other people, so this is our threat model in one page.

- **[Building LLM applications for production](https://huyenchip.com/2023/04/11/llm-engineering.html)**. Chip Huyen, 2023. *Blog · ~45 min · Intermediate*
  Covers the gap between demo and product: ambiguity of natural-language outputs, prompt evaluation and versioning, cost and latency trade-offs, and composing multi-step tasks. Why it matters for The Network: our model choice, judge passes, timeouts and retries are exactly the production trade-offs this post frames.

### 6.3 Additional

- **[Deep Dive into LLMs like ChatGPT](https://www.youtube.com/watch?v=7xTGNNLPyMI)**. Andrej Karpathy (YouTube), 2025. *Video · ~3.5 hrs · Intro*
  A long, general-audience walkthrough of the full pipeline: data, tokenization, pretraining, supervised fine-tuning, RL, hallucinations and tool use. Why it matters for The Network: it explains model "psychology" (why models hallucinate, why they need tools for facts), which informs how we design onboarding and fact-checking.

- **[ReAct: Synergizing Reasoning and Acting in Language Models](https://arxiv.org/abs/2210.03629)**. Shunyu Yao et al., 2022. *Paper · ~1 hr · Intermediate*
  The paper that introduced interleaving reasoning traces with tool actions and observations. Why it matters for The Network: it is the conceptual basis for how an elizaOS agent chooses Actions and how the field kit's research agent works.

- **[Toolformer: Language Models Can Teach Themselves to Use Tools](https://arxiv.org/abs/2302.04761)**. Timo Schick et al. (Meta AI), 2023. *Paper · ~45 min · Advanced*
  Shows a model learning when to call APIs (calculator, search, calendar) and how to fold results into its text. Why it matters for The Network: useful background for why tool descriptions and when-to-call guidance matter so much for reliable Actions.

- **[Writing effective tools for AI agents, using AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)**. Anthropic, 2025. *Blog · ~25 min · Intermediate*
  Practical guidance on choosing, naming, describing, and evaluating tools, with token-efficient responses and actionable errors. Why it matters for The Network: directly applicable to the MCP connector's tools and to elizaOS Action descriptions.

- **[MemGPT: Towards LLMs as Operating Systems](https://arxiv.org/abs/2310.08560)**. Charles Packer et al., 2023. *Paper · ~1 hr · Intermediate*
  Proposes OS-style memory tiers where the model pages information between a limited context and external storage via function calls; the project continues as Letta (<https://docs.letta.com/>). Why it matters for The Network: a member relationship lasts months, so we need explicit policies for what stays in context versus what is stored and recalled.

- **[Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442)**. Joon Sung Park et al. (Stanford/Google), 2023. *Paper · ~1.5 hrs · Intermediate*
  Introduces the memory stream with retrieval by recency, importance and relevance, plus reflection and planning, in a simulated town of 25 agents. Why it matters for The Network: our persona agents in packages/sim are believable simulated members, and this is the reference design for giving them memory and consistent behavior.

- **[Eliza: A Web3 friendly AI Agent Operating System](https://arxiv.org/abs/2501.06781)**. Shaw Walters, Sam Gao, et al., 2025. *Paper · ~45 min · Intermediate*
  Describes the elizaOS architecture: characters, runtime, actions/providers/evaluators, memory, and the plugin ecosystem. Why it matters for The Network: it is the design rationale for the framework the Network agent runs on.

- **[elizaOS source repository](https://github.com/elizaOS/eliza)**. elizaOS contributors, ongoing. *Docs · ~1 hr to orient · Intermediate*
  The TypeScript monorepo for the runtime, core types and official plugins. Why it matters for The Network: when the docs are thin, reading how an existing plugin implements an Action or Provider is the fastest way to write ours correctly.

- **[Introducing the Model Context Protocol](https://www.anthropic.com/news/model-context-protocol)**. Anthropic, 2024. *Blog · ~5 min · Intro*
  The launch announcement explaining the problem MCP solves (N-by-M integrations) and its open-standard approach. Why it matters for The Network: a quick, non-technical framing to share with non-engineers about why a Network connector for ChatGPT/Claude is possible at all.

- **[Code execution with MCP: building more efficient AI agents](https://www.anthropic.com/engineering/code-execution-with-mcp)**. Anthropic, 2025. *Blog · ~15 min · Advanced*
  Explains how tool definitions and intermediate results bloat context and how presenting MCP servers as code APIs reduces tokens and keeps sensitive data out of the model. Why it matters for The Network: relevant to keeping private member data out of a third-party model's context in the connector.

- **[Prompt injection attacks against GPT-3](https://simonwillison.net/2022/Sep/12/prompt-injection/)**. Simon Willison, 2022 (and the full series at https://simonwillison.net/series/prompt-injection/). *Blog · ~10 min (series: hours) · Intro*
  The post that named prompt injection, explained by analogy to SQL injection, with a running series of later examples. Why it matters for The Network: every message a member or a third party sends is input that can try to rewrite the agent's instructions.

- **[The Dual LLM pattern for building AI assistants that can resist prompt injection](https://simonwillison.net/2023/Apr/25/dual-llm-pattern/)**. Simon Willison, 2023. *Blog · ~15 min · Intermediate*
  Proposes separating a privileged LLM that can act from a quarantined LLM that reads untrusted text, with only opaque references passed between them. Why it matters for The Network: a concrete architectural idea for handling member-written text that could otherwise steer outreach to other members.

- **[Design Patterns for Securing LLM Agents against Prompt Injections](https://arxiv.org/abs/2506.08837)**. Luca Beurer-Kellner et al., 2025. *Paper · ~1.5 hrs · Advanced*
  Catalogs six defensive patterns (action-selector, plan-then-execute, map-reduce, dual LLM, code-then-execute, context minimization) with case studies and trade-offs. Why it matters for The Network: gives named options for constraining what the agent can do after reading untrusted text, complementing our deterministic consent and send-time checks.

- **[What We've Learned From A Year of Building with LLMs](https://applied-llms.org/)**. Eugene Yan, Bryan Bischof, Charles Frye, Hamel Husain, Jason Liu, Shreya Shankar, 2024. *Blog · ~2 hrs · Intermediate*
  Tactical, operational and strategic lessons from practitioners: prompting, RAG, structured output, evals, LLM-as-judge pitfalls, cost, and team process. Why it matters for The Network: the single best checklist of mistakes to avoid as we move from simulator to real members.

- **[AI Engineering (book) and its companion resources](https://github.com/chiphuyen/aie-book)**. Chip Huyen, O'Reilly, 2025. *Book · ~15-20 hrs · Intermediate*
  A comprehensive book on building applications on foundation models: evaluation, prompt engineering, RAG and agents, fine-tuning, inference optimization and architecture; the free GitHub repo holds the chapter summaries and resource lists (the book itself is paid). Why it matters for The Network: the reference text for the production questions (evals, cost, latency, model selection) we answer every week.

- **[DSPy: Compiling Declarative Language Model Calls into Self-Improving Pipelines](https://arxiv.org/abs/2310.03714)**. Omar Khattab et al., 2023 (docs at https://dspy.ai/). *Paper + Docs · ~1 hr paper; ~1 hr docs · Advanced*
  Introduces programming LLM pipelines as modules with typed signatures, with optimizers that tune prompts and examples against a metric. Why it matters for The Network: once we have labelled extraction and judge data, DSPy is a path to optimizing those prompts systematically (and the field kit's `rotate research` agent is a DSPy ReAct program).

- **[How we built our multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)**. Anthropic, 2025. *Blog · ~25 min · Advanced*
  A production case study of an orchestrator with parallel sub-agents, covering prompt design, evaluation, token cost and reliability lessons. Why it matters for The Network: a realistic picture of what multi-agent designs cost and break, relevant before adding more agents beyond the persona simulator.

- **[Patterns for Building LLM-based Systems & Products](https://eugeneyan.com/writing/llm-patterns/)**. Eugene Yan, 2023. *Blog · ~1.5 hrs · Intermediate*
  Seven patterns (evals, RAG, fine-tuning, caching, guardrails, defensive UX, collecting user feedback) explained with references. Why it matters for The Network: "defensive UX" and "collect user feedback" translate directly to how an SMS agent should handle uncertainty and learn whether intros were worthwhile.

- **[Conversation Design guidelines](https://developers.google.com/assistant/conversation-design/welcome)**. Google for Developers, 2019-2023. *Docs · ~2 hrs · Intro*
  Google's guide to designing natural conversations: personas, turn-taking, error handling, confirmations and sample dialogs; written for voice assistants (the Actions platform it supported has been sunset) but the principles carry over to text. Why it matters for The Network: onboarding by text message is conversation design, and this is a rigorous, free foundation for writing turns that feel natural and recover from misunderstandings.

## 7. Judging and evaluation

How we know whether the engine's proposals are any good, how far to trust the LLM judge, and how to test changes when a city has only 150-300 members. Read this alongside `docs/research/matching-and-graphs.md` (section 6 and "Recommended evaluation methodology"), `docs/results/2026-10-06-judge-passes.md` and `docs/research/2026-10-07-prompt-optimization.md`.

### 7.1 Key concepts

- **Error analysis (open coding, then axial coding).** Read real traces one by one and write a short note on what went wrong (open coding). Then group the notes into a few failure categories and count them (axial coding). *Why it matters:* every judge and prompt change starts here. Our luna error analysis found that most pipeline errors were chemistry noise, data bugs and labels, not prompt wording. That is why we do not run an automatic prompt optimizer yet.
- **LLM-as-a-judge.** A model grades another model's output against a rubric. Binary pass/fail with a written critique is usually more reliable than 1-5 scores. *Why it matters:* passes 1-3 are judges that decide whether a proposal reaches a human reviewer, so their errors become reviewer workload or missed intros.
- **Judge biases: position, verbosity, self-preference.** Judges favour whichever candidate comes first, longer answers, and outputs written by their own model family. *Why it matters:* when a judge compares group configurations, evaluate every ordering and treat a flip as low confidence. Use a judge from a different model family than the one that wrote the text, especially for member-facing "why" text.
- **Explanation before verdict.** The judge writes its reasoning, then the verdict, so the verdict is conditioned on the reasoning rather than rationalized afterwards. *Why it matters:* this is a repo rule. The parsers check JSON key order, and in our runs pass 1 calibration improved (ECE 0.140 to 0.073).
- **Validating the validator (criteria drift).** A judge is only trustworthy once it agrees with humans on a labelled set. People also refine their own criteria while grading. *Why it matters:* the human review queue is our gold set. Re-measure judge-reviewer agreement as the rubric changes, and version every rubric.
- **Precision, recall, ROC-AUC.** Precision is the share of "yes" verdicts that were actually good. Recall is the share of good opportunities we found. AUC is the probability that a random good item scores above a random bad one, across all thresholds. *Why it matters:* the pass 1 > pass 3 pipeline gained precision (+6.6 pp) and lost recall (-13.9 pp). Pass 2's AUC of 0.52 is close to a coin flip. You need these words to read our results.
- **Cohen's kappa.** Agreement between two raters after removing the agreement they would reach by chance. 0 means chance level and 1 means perfect. *Why it matters:* about 20% of proposals are double-reviewed. The judge earns more weight only when judge-vs-reviewer kappa approaches reviewer-vs-reviewer kappa.
- **Calibration (Brier score, ECE, reliability diagram).** A model is calibrated if, among items it gives 0.7, about 70% turn out good. The Brier score is the mean squared error of probabilities. A reliability diagram plots predicted against observed rates. *Why it matters:* thresholds on `match_probability` decide whether to interrupt a member, so the probabilities must mean what they say. Never treat raw judge scores as probabilities without checking or refitting them (isotonic or Platt).
- **Oracle-based evaluation in a simulated world.** In the simulator, 500 LLM personas have hidden ground truth (true interests, pairwise affinity) that the engine never sees, so we can score precision and recall against an oracle. *Why it matters:* real outcomes are slow and few. The oracle gap is our main number for comparing engine versions before the pilot.
- **Limits of LLM user simulators.** Simulated users tend to be over-agreeable, leak ground truth, lack diversity and favour popular items. The RecSim fix is to factor the simulator into hidden user state, state transitions (fatigue), a choice model and a response model, and to let the LLM only write the words. *Why it matters:* our personas' accept/decline decisions come from a calibrated hidden-utility choice model, not from the LLM, so the engine is not graded against unrealistically agreeable people.
- **pass^k (tau-bench).** A scenario passes only if all k independent runs succeed. pass@k, by contrast, needs only one success. It measures reliability rather than best-case ability. *Why it matters:* STOP, block, decline-without-leak and reschedule must work every time. Grade them by the end state of the database (consent records, no leaked fields), not by how the transcript reads.
- **Run-to-run noise and error bars.** Re-running the same prompt can change verdicts. Our pilot flipped about 1 in 5. Compare prompts on the same items with paired tests (McNemar, paired bootstrap) and report confidence intervals. *Why it matters:* with a few hundred eval items, a +2.5 pp gain (p = 0.28) is not a result.
- **Prompt optimization (DSPy, GEPA, OPRO).** These search over prompt text to maximize a metric. GEPA reflects on failures in natural language and keeps a Pareto set of candidate prompts. *Why it matters:* an optimizer fits whatever metric you give it. Our GEPA-lite pilot raised soft-label accuracy by saying "yes" half as often, while AUC fell. Only adopt one when labels are good and the dev set is large (about 500+ items).
- **Experiments under small N and interference.** Proposals use shared capacity, so treating member A changes B's outcomes, and per-member A/B tests are both underpowered and biased. Switchback designs alternate the policy over time windows within a city. Interleaving shows both variants to the same judge and records which is preferred. *Why it matters:* blind reviewer interleaving in shadow mode, and city-week switchbacks in the pilot, are how we compare engine variants with only 150-300 members.
- **Goodhart's law and overfitting to evals.** Once a measure becomes a target, it stops being a good measure. *Why it matters:* keep a held-out test split built from fresh seeds and read it rarely. Track guardrail metrics (exposure concentration, newcomer time-to-first-value) next to the optimized metric. Assume any jump on the dev set is suspect until the test set and AUC confirm it.

### 7.2 Must-read / must-watch

*Ordered as a learning path: why evals matter, how to look at data, the metrics vocabulary, how to build a judge, what is known about judge bias and validity, how to evaluate an agent, and the limits of simulated users.*

- **[Your AI Product Needs Evals](https://hamel.dev/blog/posts/evals/)**. Hamel Husain, 2024. *Blog · ~30 min · Intro*
  A widely cited case for treating evals as the core of AI product development. It builds a three-level stack (unit tests, human and model eval, A/B tests) through a real case study. Why it matters for The Network: it explains why our `packages/evals` suites, the human review queue and the pilot are one system and not three separate chores.

- **[A Field Guide to Rapidly Improving AI Products](https://hamel.dev/blog/posts/field-guide/)**. Hamel Husain, 2025. *Blog · ~35 min · Intro*
  A practical guide to error analysis: build a simple data viewer, read traces, let failure categories emerge from the data, and measure progress by experiments run, not features shipped. Why it matters for The Network: this is the workflow behind our luna error analysis. Its categories (chemistry noise, data bugs, missed evidence, rubric) decide what we fix in the prompt and what we fix elsewhere.

- **[ROC and AUC, Clearly Explained!](https://www.youtube.com/watch?v=4jRBRDbJemM)**. StatQuest with Josh Starmer (YouTube), 2019. *Video · ~16 min · Intro*
  A visual walk through confusion matrices, true and false positive rates, the ROC curve, AUC, and how precision can replace the false positive rate when positives are rare. Why it matters for The Network: our judge reports quote accuracy, precision, recall and AUC for every pass. After this video you can see why pass 2's AUC of 0.52 means it is close to useless.

- **[Using LLM-as-a-Judge For Evaluation: A Complete Guide (formerly "Creating a LLM-as-a-Judge That Drives Business Results")](https://hamel.dev/blog/posts/llm-judge/)**. Hamel Husain, 2024 (updated 2026). *Blog · ~40 min · Intro*
  "Critique shadowing" in seven steps: a domain expert makes binary pass/fail calls with written critiques, and the judge prompt is iterated until it agrees with the expert. Why it matters for The Network: our reviewers are the domain experts, and their approve/edit/reject labels with reasons are the critiques the judge passes must learn to match.

- **[Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena](https://arxiv.org/abs/2306.05685)**. Zheng et al. (LMSYS), 2023. *Paper · ~1.5 hrs · Intermediate*
  The founding paper on LLM judges. Strong judges reach about 80% agreement with humans, roughly the human-human level, but show position, verbosity and self-enhancement bias. It also tests mitigations such as swapping order and giving a reference answer. Why it matters for The Network: it is the source of our rules to evaluate both orderings for pairwise and group comparisons and to use a judge from a different model family than the writer.

- **[Evaluating the Effectiveness of LLM-Evaluators (aka LLM-as-Judge)](https://eugeneyan.com/writing/llm-evaluators/)**. Eugene Yan, 2024. *Blog · ~60 min · Intermediate*
  A survey of more than two dozen papers on LLM evaluators. It covers direct scoring vs. pairwise comparison, which metrics to use (Cohen's kappa, Kendall's tau, Spearman), use-case results, biases, and when finetuned evaluators help. Why it matters for The Network: it is the quickest way to decide how pass 1 and pass 3 should be scored and compared against reviewer labels (kappa on approve/reject, Spearman on dimension scores).

- **[Who Validates the Validators? Aligning LLM-Assisted Evaluation of LLM Outputs with Human Preferences (EvalGen)](https://arxiv.org/abs/2404.12272)**. Shankar, Zamfirescu-Pereira, Hartmann, Parameswaran, Arawjo, 2024 (UIST). *Paper · ~1 hr · Intermediate*
  Introduces "criteria drift": people need criteria to grade outputs, but grading outputs is how they discover their criteria. It describes a mixed-initiative tool that aligns generated evaluators with a small set of human grades. Why it matters for The Network: expect the judge rubric to change during shadow mode. Version it, and re-measure judge-reviewer agreement every time it changes.

- **[Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)**. Anthropic Engineering, 2026. *Blog · ~30 min · Intermediate*
  Anthropic's guide to evaluating multi-turn agents: tasks, trials, graders (code, model, human), transcripts vs. outcomes, and pass@k vs. pass^k for reliability. Why it matters for The Network: it gives the vocabulary for our scenario tests. Grade the outcome state (opportunity status, consent, no leaks), and report pass^k on safety-critical flows.

- **[How Reliable is Your Simulator? An Analysis on the Limitations of Current LLM-based User Simulators for Conversational Recommendation](https://arxiv.org/abs/2403.16416)**. Zhu, Huang, Sang, 2024 (WWW Companion). *Paper · ~45 min · Intermediate*
  Shows that LLM user simulators leak target information, rely on shortcuts and drift from real user behaviour, which inflates measured recommender performance. Why it matters for The Network: it is the main reason our 500-persona simulator lets a hidden-utility choice model make accept/decline decisions, and keeps hidden persona cards in a separate process from the engine.

### 7.3 Additional

*Eval practice and process*

- **[AI Evals: Everything You Need to Know (LLM Evals FAQ)](https://hamel.dev/blog/posts/evals-faq/)**. Hamel Husain & Shreya Shankar, 2025-2026. *Blog · ~1.5 hrs · Intro*
  A long, frequently updated FAQ from their evals course. It covers binary vs. Likert scales, how many traces to label, judge validation, synthetic data, RAG and agent evals, and tooling. Why it matters for The Network: when a new teammate asks "should this rubric be 1-5 or pass/fail?" or "how many reviewer labels do we need?", the answer is probably here.

- **[Define success criteria and build evaluations](https://docs.claude.com/en/docs/test-and-evaluate/develop-tests)**. Anthropic (Claude Platform Docs), ongoing. *Docs · ~20 min · Intro*
  Official guidance on writing specific, measurable success criteria, then building test cases and choosing code-based, human or model-based grading. Why it matters for The Network: a short template for turning PRD targets (for example, opt-in of at least 40% and a worthwhile-interruption rate of at least 70%) into concrete eval cases.

- **[Patterns for Building LLM-based Systems & Products](https://eugeneyan.com/writing/llm-patterns/)**. Eugene Yan, 2023. *Blog · ~60 min · Intermediate*
  Seven patterns (evals, RAG, fine-tuning, caching, guardrails, defensive UX, collecting user feedback), with a strong section on eval metrics and their pitfalls. Why it matters for The Network: it puts our judge, gates and feedback loops in the context of a whole product. Its "collect user feedback" pattern maps onto post-meeting check-ins as labels.

*Metrics primers: classification, agreement, calibration*

- **[Classification: ROC and AUC (Machine Learning Crash Course)](https://developers.google.com/machine-learning/crash-course/classification/roc-and-auc)**. Google for Developers, ongoing. *Course · ~20 min · Intro*
  An interactive written module on ROC curves, AUC and choosing a threshold. Neighbouring pages cover accuracy, precision and recall. Why it matters for The Network: a reference to reread when picking the `match_probability` threshold that turns a judge score into a reviewer-queue item.

- **[Interrater reliability: the kappa statistic](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3900052/)**. Mary L. McHugh, 2012 (Biochemia Medica). *Paper · ~30 min · Intro*
  A readable tutorial on percent agreement vs. Cohen's kappa, with worked examples. It argues that the usual interpretation bands are too lenient for consequential decisions. Why it matters for The Network: it is how to read the judge-vs-reviewer and reviewer-vs-reviewer kappa numbers that decide when the judge gets more weight.

- **[Probability calibration (scikit-learn user guide 1.16)](https://scikit-learn.org/stable/modules/calibration.html)**. scikit-learn developers, ongoing. *Docs · ~30 min · Intermediate*
  Explains calibration curves (reliability diagrams), Brier score and log loss, and how to recalibrate scores with sigmoid (Platt) or isotonic regression. Why it matters for The Network: it is the exact recipe for mapping judge scores to reviewer-approve and member-accept probabilities, and for drawing per-generator reliability diagrams.

- **[Adding Error Bars to Evals: A Statistical Approach to Language Model Evaluations](https://arxiv.org/abs/2411.00640)**. Evan Miller (Anthropic), 2024. *Paper · ~45 min · Intermediate*
  Treats eval questions as samples, which calls for standard errors, clustered errors, paired differences, repeated sampling to reduce noise, and power analysis. Why it matters for The Network: with 362 eval items and a 1-in-5 re-run flip rate, this explains why we need paired tests and confidence intervals before calling a prompt better.

*LLM judges: biases and techniques*

- **[Large Language Models are not Fair Evaluators](https://arxiv.org/abs/2305.17926)**. Wang et al., 2023 (ACL 2024). *Paper · ~45 min · Intermediate*
  Shows that swapping the order of candidates can flip a GPT-4 judge's verdict. Proposes asking for multiple pieces of evidence before the score, balanced-position calibration, and human-in-the-loop checks. Why it matters for The Network: it supports our "evidence before verdict" design and the position-swap consistency target (90% or more) in the judge metrics.

- **[G-Eval: NLG Evaluation using GPT-4 with Better Human Alignment](https://arxiv.org/abs/2303.16634)**. Liu et al., 2023 (EMNLP). *Paper · ~40 min · Intermediate*
  Rubric, then model-generated evaluation steps, then form-filling. The final score is the probability-weighted expectation over score tokens instead of the single most likely score. Why it matters for The Network: if the provider exposes logprobs, expected scores per rubric dimension give smoother, better-calibrated inputs to pass 3's rubric.

- **[Replacing Judges with Juries: Evaluating LLM Generations with a Panel of Diverse Models (PoLL)](https://arxiv.org/abs/2404.18796)**. Verga et al. (Cohere), 2024. *Paper · ~30 min · Intermediate*
  A panel of smaller judges from different model families agrees with humans better than one large judge, shows less intra-model bias, and costs less. Why it matters for The Network: a cheap option for reducing self-preference when one model (luna) both writes and judges, especially for member-facing text.

*Agent and scenario benchmarks, simulation*

- **[τ-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains](https://arxiv.org/abs/2406.12045)**. Yao, Shinn, Razavi, Narasimhan (Sierra), 2024. *Paper · ~1 hr · Intermediate*
  An LLM-simulated user talks to a tool-using agent bound by a domain policy. Success is graded by comparing the final database state with a goal state, and the paper introduces pass^k. Why it matters for The Network: it is the template for our scenario tests. Graded by end state and repeated k times, they can catch a decline flow that leaks only one time in four.

- **[SOTOPIA: Interactive Evaluation for Social Intelligence in Language Agents](https://arxiv.org/abs/2310.11667)**. Zhou et al., 2023 (ICLR 2024). *Paper · ~1 hr · Intermediate*
  Role-play social scenarios with private goals, scored on 7 dimensions, including goal completion, relationship, believability and keeping secrets. Why it matters for The Network: its secret-keeping dimension is our canary-fact privacy test. Its multi-party scenarios are a model for testing intros and small groups.

- **[Generative Agent Simulations of 1,000 People (arXiv now titled "LLM Agents Grounded in Self-Reports Enable General-Purpose Simulation of Individuals")](https://arxiv.org/abs/2411.10109)**. Park et al., 2024. *Paper · ~1 hr · Intermediate*
  Agents built from 2-hour interviews replicated people's General Social Survey answers 85% as well as the people replicated themselves two weeks later, with less bias than agents prompted only with demographics. Why it matters for The Network: seed personas with rich, interview-like backstories, which is what voice onboarding produces, and validate the population against real distributions, not anecdotes.

- **[RecSim: A Configurable Simulation Platform for Recommender Systems](https://arxiv.org/abs/1909.04847)**. Ie et al. (Google), 2019. *Paper · ~45 min · Advanced*
  The classic factorization of a recommender simulator into user latent state, state transitions (fatigue, interest drift), a choice model and a response model. Why it matters for The Network: the code is archived, but this factorization is exactly how our persona decision policy should be built, with the LLM layered on top only for language.

*Prompt optimization*

- **[GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning](https://arxiv.org/abs/2507.19457)**. Agrawal et al., 2025. *Paper · ~1 hr · Advanced*
  An optimizer that reads execution traces, reflects in natural language on what went wrong, proposes prompt edits, and keeps a Pareto front of candidates. It is sample-efficient compared with RL. Why it matters for The Network: our GEPA-lite pilot is based on it. Read it alongside our pilot write-up, which shows the optimizer gaming the base rate of a soft-label objective within 11 iterations.

- **[Large Language Models as Optimizers (OPRO)](https://arxiv.org/abs/2309.03409)**. Yang et al. (Google DeepMind), 2023. *Paper · ~45 min · Advanced*
  An LLM is shown past prompts and their scores and asked to write better ones. This is the simplest "LLM optimizes the prompt" baseline. Why it matters for The Network: it is a useful mental model and baseline. Its known failure of overfitting to a small training set is the Goodhart risk we already saw.

*Experiment design under small N and interference*

- **[Switchback Tests and Randomized Experimentation Under Network Effects at DoorDash](https://careersatdoordash.com/blog/switchback-tests-and-randomized-experimentation-under-network-effects-at-doordash/)**. David Kastelman & Raghav Ramesh (DoorDash Engineering), 2018. *Blog · ~15 min · Intermediate*
  Explains why per-user A/B tests fail in a marketplace with shared capacity, and how randomizing by region and time window, with clustered analysis, fixes it. Why it matters for The Network: it is the design we plan for selector, budget and fairness changes in the pilot (alternate the policy by week within a city).

- **[Innovating Faster on Personalization Algorithms at Netflix Using Interleaving](https://netflixtechblog.com/using-interleaving-in-online-experiments-to-accelerate-algorithm-innovation-at-netflix-a04ee392ec55)**. Joshua Parks, Juliette Aurisset, Michael Ramm (Netflix Technology Blog), 2017. *Blog · ~15 min · Intermediate*
  Blending two rankers' results for the same user and measuring which side gets preferred needs far fewer samples than A/B testing. Netflix uses it as a fast pruning stage before full A/B tests. Why it matters for The Network: it is the idea behind blind reviewer interleaving in shadow mode. Showing reviewers variant A and B proposals side by side compares engine versions without sending anything to members.

*Goodhart's law and the limits of metrics*

- **[Categorizing Variants of Goodhart's Law](https://arxiv.org/abs/1803.04585)**. David Manheim & Scott Garrabrant, 2018. *Paper · ~40 min · Intermediate*
  Separates four ways optimizing a proxy goes wrong: regressional, extremal, causal and adversarial. Why it matters for The Network: it gives names to failures we have already seen. Our GEPA-lite result is regressional and extremal Goodhart: the optimizer pushed the "say no" behaviour to an extreme where the proxy stopped tracking quality.

- **[The Problem with Metrics is a Fundamental Problem for AI (later "Reliance on Metrics is a Fundamental Challenge for AI")](https://arxiv.org/abs/2002.08512)**. Rachel Thomas & David Uminsky, 2020. *Paper · ~30 min · Intro*
  Case studies of metric gaming and short-term proxies in recommender and ML systems, with a practical framework: use a slate of metrics, combine them with qualitative accounts, and involve affected people. Why it matters for The Network: it argues for judging network-health interventions on 60- and 90-day outcomes and member feedback, not on 7-day opt-in alone.

## Appendix: how this list was made

Seven research passes, one per area, each given the PRD, the engine design and the repo's research notes as context. Each was asked for material that is relevant, high quality and instructional, and to avoid SEO content. Every URL was checked by fetching it or confirming it in search results; YouTube titles and channels were confirmed. Where a publisher blocks automated access, the entry links a free author copy or summary and says so. Items that appeared in two areas are listed once.
