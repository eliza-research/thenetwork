# The Network: Matching Research Compendium

The Network is an AI agent for a private city network. Members send text messages to the agent or have their agent connect to the agent.

The agent finds opportunities between members. These opportunities are introductions, small groups and event invitations. Both sides must agree before an introduction occurs.

A matching engine finds these opportunities. It retrieves candidates from Postgres and scores each pair or group. An LLM judge examines the best candidates, and a human reviewer approves each proposal.

This document contains only the must-read items for the matching engine. It does not contain general material about LLMs and agents.

The document contains 47 items in 7 sections.

## How to use this document

1.  Read the sections in sequence. Each section starts with the simplest items.
2.  In each section, read the key concepts first. Make sure that you can tell another person what each concept is.
3.  Read or watch each item in the given sequence.

Each entry gives the title (a link), the author or channel, the year, the type, the approximate time and the level. Then it gives a short summary and the use for The Network.

## Contents

1.  Social networks and small worlds (9 items)
2.  Matching markets and stable matching (7 items)
3.  People-to-people recommendation (8 items)
4.  Group formation (3 items)
5.  Retrieval, ranking, exploration and exposure (7 items)
6.  Graphs and ontologies for the member data (5 items)
7.  Judges and evaluation of matches (8 items)

## Knowledge map

| Section | Concepts that you must know | Where The Network uses them |
|---|---|---|
| Social networks | Small worlds, weak ties, structural holes, homophily, triadic closure, link prediction | Warm-path generator, tie-strength score, cross-cluster metrics |
| Matching markets | Stable matching, blocking pairs, congestion, b-matching, CP-SAT | Run-level selector, budgets, cooldowns |
| People-to-people recommendation | Reciprocal scores, double opt-in, exposure fairness, limits of prediction | MutualBenefit term, exposure budget, judge limits |
| Group formation | Least misery, team formation, social choice | Group composer |
| Retrieval and ranking | Exact and approximate kNN, hybrid search, bandits, off-policy evaluation, diversity | Candidate retrieval, exploration budget, propensity logs |
| Graphs and ontologies | Typed graphs, recursive SQL, ontologies, controlled vocabularies, entity resolution | Member, Facet and Edge model, 2-hop queries, one facet vocabulary |
| Judges and evaluation | LLM judges and their biases, precision, recall, AUC, kappa, calibration, simulator limits | Judge passes, simulator oracle, shadow mode |

  

## 1. Social networks and small worlds

The engine finds most good introductions a few steps away in the social graph. This section gives the network science for warm paths, tie strength and bridges between clusters. It also tells how many hours a friendship takes. The second-encounter generator uses this fact.

### 1.1 Key concepts

  - **Small world / six degrees.** Short chains of acquaintances connect most people. Milgram found approximately 6 steps. In 2016, Facebook found approximately 3.57 steps. *Use for The Network:* The 2-hop warm-path retrieval assumes that almost all members of a city network with 150 to 1,000 members are within 2 to 3 hops.
  - **Navigability / decentralized search (Kleinberg).** Short paths can exist, but people cannot always find them. To find them, the network must have long-range links in the correct proportion to distance. *Use for The Network:* This result shows why the agent, which does the search for members, must mix near (similar) and far (novel) candidates.
  - **Strength of weak ties (Granovetter).** Acquaintances connect you to parts of the network that your close friends do not reach. Thus, acquaintances bring new information and opportunities. Randomized experiments at LinkedIn found an inverted U: moderately weak ties give the best results. *Use for The Network:* The scorer uses this result to weight tie strength, because pairs with no shared context are cold and pairs with many mutual friends are redundant.
  - **Structural holes / brokerage (Burt).** Some people connect groups that otherwise have no connection. These people get information earlier and from more sources, and they have better ideas. *Use for The Network:* Members who span holes are good warm-path introducers, and to close holes deliberately is the value of the product.
  - **Homophily.** Similar people connect more frequently. This occurs for race, age, occupation, values and other attributes. *Use for The Network:* Vector kNN on facets selects similar people, so the fairness and exposure budgets must add diversity to stop the matcher from making bubbles stronger.
  - **Triadic and focal closure.** Two people who share a friend (triadic closure) or a context, for example a class, club or company (focal closure), connect much more frequently. These are the strongest baseline link predictors. These ties frequently form without help. *Use for The Network:* The Network uses them as features and as a baseline that the LLM judge must beat, but not as a goal.
  - **Link prediction.** Link prediction predicts which pairs without an edge will get an edge. It uses neighborhood scores (common neighbors, Adamic-Adar, Katz) or learned embeddings. *Use for The Network:* Link prediction is the formal frame for candidate retrieval and the standard evaluation method for the simulated world.
  - **Scale-free networks and preferential attachment.** In many networks, the degree has a heavy-tailed distribution. New nodes link to nodes that are already popular, so popular nodes get more links. *Use for The Network:* The exposure budgets work against preferential attachment, because without them the matcher will send most introductions to a few popular members.
  - **Hours to friendship.** Studies by Jeffrey Hall estimate that people must spend approximately 50 hours together to change from acquaintances to casual friends. Approximately 90 hours make a friend, and more than 200 hours make a close friend. One introduction does not make a friendship. *Use for The Network:* The PRD records a good first meeting as a new graph edge and then monitors for a second encounter (PRD 6.4).
  - **Economic connectedness and friending bias (Chetty).** Friendship across classes is one of the strongest predictors of upward mobility. Exposure causes half of the gap in cross-class friendship. Friending bias, which continues after exposure, causes the other half. *Use for The Network:* Introductions across social strata have high value and do not occur without help, so the fairness layer has a goal and a metric for them.

### 1.2 Must-read and must-watch

1.  [**Can you really reach anyone in 6 steps?**](https://www.youtube.com/watch?v=CYlon2tvywA). Veritasium, 2025. *Video · 30 min · Intro*  
    This video shows the Milgram experiment, Watts-Strogatz shortcuts, Kleinberg navigability and the mathematics of six degrees. It is the best single start point.  
    **Use for The Network:** It shows why 2-hop warm-path retrieval and a few good shortcut introductions can change a city network.
2.  [**Networks, Crowds, and Markets: Reasoning About a Highly Connected World**](https://www.cs.cornell.edu/home/kleinber/networks-book/). David Easley & Jon Kleinberg, 2010. *Book · 6-8 hours (chapters 2-4, 19-20) · Intro*  
    This is the standard free undergraduate textbook, with the full PDF on the web page. It covers ties, triadic closure and structural holes (chapter 3), homophily and focal closure (chapter 4), cascades (19) and small-world search (20).  
    **Use for The Network:** Chapters 3 and 4 give the theory for the warm-path and tie-strength parts of the scorer.
3.  [**The Strength of Weak Ties**](https://www.cs.umd.edu/~golbeck/INST633o/granovetterTies.pdf). Mark Granovetter, 1973 (American Journal of Sociology). *Paper · 1 hour · Intro*  
    This is the foundational argument that acquaintances, not close friends, connect people to new information and opportunities, for example jobs and ideas.  
    **Use for The Network:** It is the theory for why the candidate score prefers moderately weak warm paths to strangers and inner circles.
4.  [**A Causal Test of the Strength of Weak Ties**](https://digitaleconomy.stanford.edu/publication/a-causal-test-of-the-strength-of-weak-ties). Rajkumar, Saint-Jacques, Bojinov, Brynjolfsson & Aral, 2022 (Science). *Paper · 45 min · Intermediate*  
    Randomized experiments on the LinkedIn People You May Know feature with more than 20M users showed that weak ties cause job mobility. The effect is an inverted U, and moderately weak ties (by count of mutual connections) give the best results.  
    **Use for The Network:** This nearest real-world analog of our recommender shows that the warm-path score must model tie strength as a non-monotonic function.
5.  [**Navigation in a Small World**](https://www.cs.cornell.edu/home/kleinber/nat00.pdf). Jon Kleinberg, 2000 (Nature). *Paper · 20 min · Intermediate*  
    This 2-page paper shows that people can find short paths with only local information. This is possible only when long-range links become less frequent with distance at exactly the correct rate.  
    **Use for The Network:** It shows the agent as a decentralized search engine and gives the reason to mix near and far candidates instead of pure nearest-neighbor retrieval.
6.  [**Structural Holes and Good Ideas**](https://snap.stanford.edu/class/cs224w-readings/Burt04StructureHole.pdf). Ronald S. Burt, 2004 (American Journal of Sociology). *Paper · 1.5 hours · Intermediate*  
    Data from a big company shows that people whose networks span structural holes have better ideas, pay and promotions. Brokerage changes network position into value.  
    **Use for The Network:** It shows which introductions make value (the introductions that span holes) and which members are the best introducers on warm paths.
7.  [**The Link Prediction Problem for Social Networks**](https://www.cs.cornell.edu/home/kleinber/link-pred.pdf). David Liben-Nowell & Jon Kleinberg, 2007 (JASIST). *Paper · 1.5 hours · Intermediate*  
    This paper compares neighborhood predictors (common neighbors, Adamic-Adar, Jaccard) and path-based predictors (Katz) on co-authorship networks.  
    **Use for The Network:** These cheap scores are the baselines that candidate retrieval and the LLM judge must beat in simulation evaluations.
8.  [**Social Capital and Economic Mobility (non-technical research summary)**](https://opportunityinsights.org/wp-content/uploads/2022/07/socialcapital_nontech.pdf). Raj Chetty, Matthew O. Jackson, Theresa Kuchler, Johannes Stroebel et al. / Opportunity Insights, 2022. *Paper · 30 min · Intro*  
    This simple summary tells how 2 Nature papers from 2022 used 21 billion Facebook friendships to define economic connectedness, exposure and friending bias. It is the best empirical evidence that the people you meet change life outcomes.  
    **Use for The Network:** It divides the problem into exposure and friending bias, which are 2 levers for the matching engine.
9.  [**How many hours does it take to make a friend? (KU news summary of Hall 2018, J. Social & Personal Relationships)**](https://news.ku.edu/2018/03/06/study-reveals-number-hours-it-takes-make-friend). Jeffrey A. Hall / University of Kansas, 2018. *Blog · 10 min · Intro*  
    This is a plain summary of 2 studies. The studies measure the hours from acquaintance to casual, regular and close friend, and which types of conversation make ties stronger.  
    **Use for The Network:** It gives the time budget for second encounters, because the engine must make the next 10 to 50 hours easy, not declare a match.  
    Also: [Original paper (paywall at SAGE)](https://doi.org/10.1177/0265407518761225).

## 2. Matching markets and stable matching

Each introduction is a two-sided match. Both people must agree. This section gives the theory of matching markets and the algorithms that select a set of matches. The run-level selector, the budgets and the cooldowns come from these ideas.

### 2.1 Key concepts

  - **Two-sided matching market.** In a matching market, you cannot simply buy what you want. The other side must also choose you. Jobs, dating, school seats and introductions are examples. *Use for The Network:* Each introduction is a two-sided match, so The Network uses double opt-in to make sure that both people agree.
  - **Stable matching and blocking pairs.** A matching is stable if no two people prefer each other to their assigned partners. Two people who prefer each other in this way are a blocking pair. *Use for The Network:* The Network does not promise stability, but the simulator counts blocking pairs as a diagnostic for lost value.
  - **Gale-Shapley algorithm (deferred acceptance, DA).** In this algorithm, one side proposes in rounds and the other side temporarily holds its best offer. The result is always stable and is better for the side that proposes. Hinge uses this standard algorithm for its Most Compatible pick. *Use for The Network:* The Network does not use this algorithm as its engine because the data is sparse, non-bipartite, capacitated and contains groups.
  - **Stable roommates (non-bipartite).** This is stable matching in one pool, where each person can pair with each other person. Sometimes no stable solution exists. With random preferences, usually no stable solution exists. *Use for The Network:* Introductions between friends and peers are a roommates problem, so The Network does not promise a stable result.
  - **Market design: thickness, congestion and safety (Roth).** A market works when it is thick, uncongested and safe. A thick market has sufficient participants, and an uncongested market gives people time to consider options. A safe market does not punish honest participation. *Use for The Network:* These words are the base of the per-member budgets, the cooldowns and the design of few proposals with high conviction.
  - **Congestion and restricted actions (Kanoria-Saban, Rios-Saban-Zheng).** On dating platforms, popular users get too much attention, and people who matched recently become less responsive. Platforms get better results when they limit who can start contact. Platforms also get better results when they control what each user sees. *Use for The Network:* The Network starts each introduction, gives load penalties to popular members and models a lower acceptance probability after recent proposals.
  - **Maximum-weight matching and b-matching.** This method chooses a set of edges (pairs) with the highest total weight. Each person can be in a maximum of b pairs, where b is the capacity or budget of that person. *Use for The Network:* The run-level selector is a maximum-weight b-matching with more constraints, for example time conflicts, cooldowns and exposure floors.
  - **Integer programming and CP-SAT.** You write the problem as yes-or-no decision variables, linear constraints and an objective. A solver, for example OR-Tools CP-SAT, then finds an optimal or almost optimal answer. With a few thousand candidate pairs, the solver finds the answer in much less than 1 second. *Use for The Network:* The Network uses CP-SAT for budgets, conflicts and fairness floors, so it is not necessary to write a custom algorithm.

### 2.2 Must-read and must-watch

1.  [**Stable Marriage Problem**](https://www.youtube.com/watch?v=Qcv1IqHWAzg). Numberphile (Emily Riehl), 2014. *Video · 9 min · Intro*  
    This animated video shows the Gale-Shapley algorithm step by step. It tells what a stable matching is, how the proposals work and why the side that proposes gets a better result.  
    **Use for The Network:** The simulator uses blocking pairs as a diagnostic, and the video shows the advantage of the side that proposes, as The Network does for members.
2.  [**Stable matching: Theory, evidence, and practical design (Nobel Prize popular science background, 2012)**](https://www.nobelprize.org/uploads/2018/06/popular-economicsciences2012.pdf). Royal Swedish Academy of Sciences, 2012. *Paper · 20 min · Intro*  
    This 5-page document gives the theory of Shapley and the applied work of Roth in plain language. It covers deferred acceptance, the U.S. doctor match, school choice and kidney exchange.  
    **Use for The Network:** It quickly shows how an abstract algorithm became real clearinghouse infrastructure and why stability is important when participants can bypass the system.
3.  [**Who Gets What — and Why | Alvin E. Roth | Talks at Google**](https://www.youtube.com/watch?v=IxrN1HuRt08). Talks at Google (Alvin Roth with Hal Varian), 2015. *Talk · 55 min · Intro*  
    In this talk about his book, Roth tells why markets must be thick, uncongested and safe. He shows that design choices decide who gets what, for example time, the side that proposes and the information that the market shows.  
    **Use for The Network:** Congestion and thickness are the forces behind the per-member budgets, the cooldowns and the decision to send few proposals with high conviction.
4.  [**Algorithmic Game Theory, Lecture 10: Kidney Exchange and Stable Matching**](https://www.youtube.com/watch?v=NT07sILhsv4). Tim Roughgarden Lectures (Stanford CS364A), 2013. *Course · 76 min video, or 30 min for the notes · Intermediate*  
    This lecture shows kidney exchange as a matching and incentive problem with cycles and chains, and it tells why the problem becomes integer programming. Then it gives deferred acceptance with proofs of stability and proposer-optimality.  
    **Use for The Network:** Kidney exchange is the best case study of capacity-constrained, non-bipartite matching that uses optimization instead of Gale-Shapley, as the CP-SAT selector does.  
    Also: [Lecture notes](https://timroughgarden.org/f13/l/l10.pdf).
5.  [**Facilitating the Search for Partners on Matching Platforms (Management Science Review summary)**](https://www.informs.org/Blogs/ManSci-Blogs/Management-Science-Review/Facilitating-the-Search-for-Partners-on-Matching-Platforms). INFORMS blog on Kanoria & Saban, 2021. *Blog · 8 min · Intro*  
    This summary of the Kanoria and Saban model shows that open platforms waste effort, with thousands of profile views for each real date. Platforms do better when they restrict actions, for example when only the short side can start contact or when quality signals are hidden.  
    **Use for The Network:** It gives the theory for why The Network, not the members, starts introductions and why The Network never shows a universal member score.
6.  [**Improving Match Rates in Dating Markets Through Assortment Optimization**](https://www.informs.org/News-Room/INFORMS-Releases/News-Releases/Swipe-Left-or-Swipe-Right-New-Algorithm-Increases-Successful-Dating-Site-Matches-by-More-Than-252). Ignacio Rios, Daniela Saban, Fanyin Zheng, 2023 (M\&SOM). *Paper · 10 min summary, 2 hours paper · Intermediate*  
    At a U.S. dating app, a selection of profiles with the like-probabilities of both sides increased matches by more than 27% in field experiments. Users with many recent matches become less likely to like other users.  
    **Use for The Network:** It supports a model where acceptance decreases after recent proposals, and a preference for under-served members.  
    Also: [Open-access paper](https://spiral.imperial.ac.uk/entities/publication/2623e0a6-0639-4bcc-84ed-8032b042c723).
7.  [**Solving an Assignment Problem (CP-SAT)**](https://developers.google.com/optimization/assignment/assignment_cp). Google OR-Tools docs, current. *Docs · 30 min (practical) · Intro*  
    This Python example, which you can run, models who does what as boolean variables with capacity constraints and a cost objective. CP-SAT then solves the model.  
    **Use for The Network:** Learn this template first, because the run-level selector uses it with member budgets, time conflicts and a total NetValue objective.

## 3. People-to-people recommendation

In people-to-people recommendation, the item is also a person with preferences. This section tells how to score both directions of a pair, how to spread exposure, and what models cannot predict. It also gives the products that are nearest to The Network.

### 3.1 Key concepts

  - **Reciprocal recommender systems (RRS).** In these recommenders, the item is also a person with preferences. You score the two directions, A to B and B to A. Then you combine the two scores with a harmonic or geometric mean, so that the weaker score has more effect. *Use for The Network:* The MutualBenefit term of The Network uses this method.
  - **Double opt-in and indistinguishable declines.** Each side agrees independently before the system shows identities. A decline must look the same as a proposal that never occurred. Boardy and other products use the same mechanic. *Use for The Network:* This is the core consent mechanic of every introduction, group proposal and romance proposal.
  - **Fairness and exposure in matching markets.** Fairness in this context means that newcomers and less popular members also get opportunity (exposure and proposals), and match quality stays high. Common tools are envy-freeness, Nash social welfare and amortized exposure. *Use for The Network:* This is the base for the exposure budgets and for the anti-caste rule, which prohibits a universal desirability score.
  - **Pair chemistry is mostly unpredictable (Joel et al. 2017).** With much data from before the first meeting, models predict who is liked in general and who is picky. But the models do not predict which two specific people will like each other. *Use for The Network:* The LLM judge must not claim to predict chemistry, because the signal is in actor effects (reliability, openness), logistics and the time of the introduction.

### 3.2 Must-read and must-watch

1.  [**Reciprocal Recommender Systems: Analysis of State-of-Art Literature, Challenges and Opportunities towards Social Recommendation**](https://arxiv.org/abs/2007.16120). Palomares, Porcel, Pizzato, Guy, Herrera-Viedma, 2021 (Information Fusion 69, arXiv preprint 2020). *Paper · 2 hours (sections 1 to 4 in 45 min) · Intermediate*  
    This is the standard survey of people-to-people recommendation for dating, recruitment, mentorship and social use. It shows how to model and aggregate preference in two directions, and it gives the open problems: cold start, popularity overload, fairness and explanations. Read arXiv version 2, because the authors withdrew version 3.  
    **Use for The Network:** It is the literature behind the harmonic-mean MutualBenefit score and behind the double opt-in principle that failure has a cost for the recipient.
2.  [**Reciprocal Recommenders**](https://ls13-www.cs.tu-dortmund.de/homepage/ITWP2010/papers/ReciprocalRecommender.pdf). Luiz Pizzato, Tomek Rej, Thomas Chung, Kalina Yacef, Irena Koprinska, Judy Kay, 2010 (ITWP workshop, companion to the RecSys'10 RECON paper). *Paper · 30 min · Intro*  
    This paper named and defined reciprocal recommenders, and it gives the RECON online dating case study. It tells why people-to-people recommendation is different from item recommendation: both sides must agree, popular users get overload and rejection causes harm.  
    **Use for The Network:** It is the short origin of two rules in the scorer: score both directions and count overload as a cost.
3.  [**Inside OKCupid: The math of online dating**](https://www.ted.com/talks/christian_rudder_inside_okcupid_the_math_of_online_dating). Christian Rudder, TED-Ed, 2013. *Video · 7 min · Intro*  
    The co-founder of OkCupid shows how the match percentage works. Each person gives an answer, the acceptable answers and an importance, and a geometric mean combines the two directional scores. His book Dataclysm (2014) tells more about what dating data shows.  
    **Use for The Network:** It is a concrete template for reciprocal scores that you can explain, with a steep importance scale that gives dealbreakers the most weight.
4.  [**Hinge employs new algorithm to find your 'most compatible' match**](https://techcrunch.com/2018/07/11/hinge-employs-new-algorithm-to-find-your-most-compatible-match-for-you/). Sarah Wells, TechCrunch, 2018. *Blog · 5 min · Intro*  
    Hinge learns preferences from behavior and uses matching similar to Gale-Shapley. It shows one mutual pick each day, and the report says that this pick is 8 times more likely to cause dates.  
    **Use for The Network:** This industry evidence shows that one scarce mutual suggestion with high conviction is better than a feed because of the scarcity, not the stability.
5.  [**Optimizing Rankings for Recommendation in Matching Markets**](https://arxiv.org/abs/2106.01941). Yi Su, Magd Bayoumi, Thorsten Joachims, 2022 (WWW). *Paper · 1 hour · Advanced*  
    This paper shows that greedy rankings for each user are not optimal in two-sided markets. Joint optimization of all rankings for social welfare, with the limited capacity of the other side, gives more total matches.  
    **Use for The Network:** It is direct evidence for the global selector for each run, instead of a top-k list for each member.
6.  [**Optimizing People You May Know (PYMK) for equity in network creation**](https://engineering.linkedin.com/blog/2021/optimizing-pymk-for-equity-in-network-creation). LinkedIn Engineering, 2021. *Blog · 15 min · Intermediate*  
    LinkedIn tells how it reranked PYMK to give more connection opportunities to members with small networks. It also gives the A/B test results.  
    **Use for The Network:** This production example exchanges raw engagement for exposure fairness and network growth, like our goals for newcomers and cross-cluster ties.
7.  [**Romantic Matches Are Hard to Predict Before People Meet (APS release on Joel, Eastwick & Finkel, "Is Romantic Desire Predictable?")**](https://www.psychologicalscience.org/news/releases/romantic-matches-are-hard-to-predict.html). Association for Psychological Science, 2017. *Blog · 5 min (paper 1 hour) · Intro*  
    The researchers used more than 100 traits from questionnaires that speed daters completed before their dates. Machine learning predicted who was generally liked and who was picky, but it predicted almost none of the desire for a specific pair.  
    **Use for The Network:** The LLM judge must give weight to actor effects, time and logistics, and it must not claim to predict chemistry.  
    Also: [Paper](https://journals.sagepub.com/doi/abs/10.1177/0956797617714580).
8.  [**AI networking startup Boardy raises $3M pre-seed**](https://techcrunch.com/2024/10/24/ai-networking-startup-boardy-raises-3m-pre-seed/). TechCrunch, 2024. *Case study · 8 min · Intro*  
    This article tells how Boardy works. A voice AI calls you, learns your goals and arranges double opt-in introductions by email.  
    **Use for The Network:** Boardy is our nearest AI superconnector competitor for professional introductions, and our differences are groups, events, local presence and non-professional desires.

## 4. Group formation

Many good opportunities need 3 to 6 people, not a pair. This section tells how to score a group and how to select its members. The group composer uses these methods.

### 4.1 Key concepts

  - **Group recommendation aggregation (Masthoff).** These rules change individual preferences into a group score. Average maximizes total happiness, and least misery maximizes the minimum. Average-without-misery calculates the average only for options above a floor. *Use for The Network:* The group composer uses average pairwise fit with a least-misery floor, so that no member must join a group that the member hates.
  - **Team formation and seating assignment.** Team formation selects people who have the necessary skills at a low coordination cost, and seating assignment divides people into tables. These problems are NP-hard. You solve them with ILP or with heuristics and local search. *Use for The Network:* They are the formal shape of the group composer (beam search, then swap-and-improve) and of the table plan for the monthly gathering.
  - **Social choice basics.** Social choice is the study of how individual rankings become a collective decision. Arrow's theorem shows that no ranked aggregation rule satisfies all fairness properties at the same time. *Use for The Network:* No neutral method to score a group exists, so each aggregation rule (average, minimum, Borda) is a value choice that The Network must state clearly.

### 4.2 Must-read and must-watch

1.  [**Group Recommender Systems (RecSys Summer School 2017 tutorial slides)**](https://pro.unibz.it/projects/schoolrecsys17/JudithMasthoff.pdf). Judith Masthoff, 2017. *Talk · 45 min (72 slides) · Intro*  
    Masthoff made the group aggregation strategies systematic, for example average, least misery, most pleasure, average-without-misery and Borda. This tutorial includes user studies that show which strategies people think are fair.  
    **Use for The Network:** The group composer uses average-without-misery, and this deck shows why people judge a group by its worst-off member.
2.  [**Finding a Team of Experts in Social Networks**](https://faculty.cc.gatech.edu/~zha/CSE8801/social-network/p467-lappas.pdf). Theodoros Lappas, Kun Liu, Evimaria Terzi, 2009 (KDD). *Paper · 1 hour · Intermediate*  
    This first team-formation paper selects members who cover a set of necessary skills with a minimum communication cost (graph diameter or MST). The problem is NP-hard, and the authors use approximations.  
    **Use for The Network:** It is the formal model for skill-based groups (help requests, collaborators), where low coordination cost means warm ties that already exist.
3.  [**Timeleft Algorithm: The Maestro of Your Dinners**](https://timeleft.com/post/timeleft-algorithm-the-maestro-of-your-dinners/). Timeleft, no date. *Case study · 10 min · Intro*  
    Timeleft tells how it makes weekly dinners of 6 strangers from a personality quiz. It mixes similarity on some dimensions with intentional balance on other dimensions, for example introvert and extrovert.  
    **Use for The Network:** It is the nearest consumer example of our dinner generator for 3 to 6 people, and it supports mixed objectives of similarity and complementarity.

## 5. Retrieval, ranking, exploration and exposure

The engine is a small recommender system. It retrieves candidates, scores them, explores and controls exposure. This section gives the methods for each of these steps. It also tells what to record now so that a learned ranker is possible later.

### 5.1 Key concepts

  - **Exact kNN and approximate nearest neighbor (ANN, for example HNSW).** Exact k-nearest-neighbor search compares the query with each vector, so it is perfect but O(N). ANN indexes, for example HNSW (a small-world graph with layers), are much faster but miss some true neighbors (lower recall). Know this trade-off before you add an index to optimize the search. *Use for The Network:* With 150 to 1,000 members, exact search is cheap and gives perfect recall, so the engine uses it intentionally.
  - **Problems with filtered vector search.** With an ANN index, Postgres frequently applies the SQL WHERE clause (same city, not blocked, with consent) after the index returns its top candidates. Thus, a query for 20 neighbors can return only 3 without a warning. pgvector 0.8 added iterative index scans to decrease this problem. *Use for The Network:* Hard filters for consent, city and do-not-match lists are mandatory, so the engine must not lose results to post-filtering.
  - **Hybrid search and rank fusion (RRF).** Hybrid search runs many retrievers (vector, keyword or tag, graph) and merges their ranked lists. Reciprocal Rank Fusion gives each item the score Σ 1/(k + rank) across the lists. It is simple, it does not need tuning of score scales, and it is unexpectedly strong. *Use for The Network:* The engine has 3 candidate channels (kNN, tag, 2-hop graph), and RRF is the standard baseline to combine them.
  - **Collaborative and content-based filtering, and cold start.** Collaborative filtering recommends from behavior, for example people similar to you accepted X. Content-based filtering recommends from attributes, for example facet text. New users and items with no behavior data are cold. *Use for The Network:* New members are cold and behavior data is small, so The Network is mostly content-based and must add learned signals gradually.
  - **Candidate generation, scoring and re-ranking pipeline (and two-tower models).** Production recommenders divide the work into stages: retrieval for recall, precise scoring, and re-ranking for policy (diversity, fairness, business rules). A two-tower model learns separate encoders for users and items, so retrieval becomes a dot product. A trained two-tower model can later replace the generic embeddings of The Network. *Use for The Network:* The engine is this pipeline: retrieval, component scoring, the LLM judge, then the policy for exposure, diversity and exploration.
  - **Offline ranking metrics.** Precision@k and recall@k measure how many good items are in the top k. NDCG gives a better score when good items are higher in the list. Beyond-accuracy metrics are equally important: coverage (how many members get recommendations), diversity, novelty and serendipity. *Use for The Network:* A network that introduces the same 30 well-connected people again and again can score well on precision but fail as a community.
  - **Explore/exploit and multi-armed bandits (Thompson sampling).** Exploitation always selects the option that looks best now, so it never learns about other options. Bandit algorithms balance tests of uncertain options against the use of known good options. Thompson sampling keeps a probability distribution for the success rate of each option, takes a sample from each distribution, and selects the highest sample. *Use for The Network:* The exploration budget uses Beta-Bernoulli Thompson sampling over match types, which is simple, works with delayed opt-ins, and gives probabilities to log.
  - **Propensity logging and off-policy evaluation (OPE).** If you log the probability of each selected action, you can later estimate the result of a different policy on the same logs. The estimators are IPS and doubly robust. OPE works only if the system logs propensities from the first day. *Use for The Network:* A/B tests do not have sufficient power with a few hundred members, so OPE over propensity-logged proposals will compare scorer versions.
  - **Popularity bias and fairness of exposure.** Recommenders make popular items more popular. Fairness of exposure says that attention (here, inclusion in a proposal) must follow merit or relevance. Amortized versions measure the gap over time. *Use for The Network:* Members with rich profiles dominate kNN, so without exposure accounting a small elite gets all intros and new members leave.
  - **Diversity re-ranking (MMR, DPPs).** Maximal Marginal Relevance greedily selects the next item that is relevant but different from the items already selected. Determinantal point processes score full sets for joint relevance and dissimilarity. *Use for The Network:* They prevent weekly suggestions of 3 almost identical intros for a member, and they help make small groups of complementary members.

### 5.2 Must-read and must-watch

1.  [**Recommendation Systems (Google Machine Learning course)**](https://developers.google.com/machine-learning/recommendation). Google for Developers, ongoing. *Course · 4 hours · Intro*  
    This free short course is about candidate generation, content-based and collaborative filtering, matrix factorization, and DNN/softmax models. It also shows the sequence of retrieval, scoring and re-ranking.  
    **Use for The Network:** It gives the standard pipeline words, which align one-to-one with our retrieval, component scoring, judge and policy stages.
2.  [**System Design for Recommendations and Search**](https://eugeneyan.com/writing/system-design-for-discovery/). Eugene Yan, 2021. *Blog · 30 min · Intermediate*  
    This article puts industry designs (Alibaba, Facebook, JD, Doordash, LinkedIn and others) into one framework. The framework has 2 axes: offline or online, and retrieval or ranking.  
    **Use for The Network:** It shows how real systems separate nightly batch work (embedding, indexing) from ranking at request time, as in our nightly matching run.
3.  [**pgvector README (sections: Querying, Exact vs. Approximate Search, HNSW, Filtering, Iterative Index Scans)**](https://github.com/pgvector/pgvector). Andrew Kane / pgvector contributors, ongoing. *Docs · 45 min · Intermediate*  
    This is the official documentation for the Postgres extension that we use. It tells about distance operators, exact and HNSW/IVFFlat search, and why filtered queries can return fewer rows than requested.  
    **Use for The Network:** It shows why the engine intentionally uses exact kNN with SQL hard filters, and what fails if someone adds an ANN index without iterative scans.
4.  [**The Multi-Armed Bandit Problem and Its Solutions**](https://lilianweng.github.io/posts/2018-01-23-multi-armed-bandit/). Lilian Weng, 2018. *Blog · 40 min · Intermediate*  
    This clear article shows ε-greedy, UCB and Thompson sampling with regret intuition and code.  
    **Use for The Network:** It is the fastest way to learn why our exploration budget exists and why it uses Thompson sampling, not a fixed random slice.
5.  [**Fairness of Exposure in Rankings**](https://arxiv.org/abs/1802.07281). Ashudeep Singh & Thorsten Joachims, 2018. *Paper · 1.5 hours · Advanced*  
    This paper defines exposure as attention weighted by position. It says that the system must give exposure in proportion to merit.  
    **Use for The Network:** Our exposure accounting (exposure is inclusion in a sent proposal) and our exposure floors come directly from this model.
6.  [**The Use of MMR, Diversity-Based Reranking for Reordering Documents and Producing Summaries**](https://www.cs.cmu.edu/~jgc/publication/The_Use_MMR_Diversity_Based_LTMIR_1998.pdf). Jaime Carbonell & Jade Goldstein, 1998. *Paper · 20 min · Intro*  
    This short paper is the origin of MMR: λ·relevance − (1−λ)·max-similarity-to-already-selected.  
    **Use for The Network:** It is the simplest diversity re-ranker to use first for the weekly slate of proposals for a member.
7.  [**Counterfactual Learning and Evaluation for Recommender Systems (RecSys'21 tutorial)**](https://www.youtube.com/watch?v=HMo9fQMVB4w). Yuta Saito & Thorsten Joachims / ACM RecSys, 2021. *Talk · 3 hours video + notebooks · Advanced*  
    This is the standard practical introduction to off-policy evaluation and learning (IPS, DM, doubly robust, and their variance trade-offs). It includes Open Bandit Pipeline examples that you can run.  
    **Use for The Network:** It is the recommended introduction for the person who owns propensity logging and the comparisons of scorer versions.  
    Also: [Tutorial materials](https://github.com/usaito/recsys2021-tutorial).

## 6. Graphs and ontologies for the member data

The member data is a typed graph in Postgres. Facets use a controlled vocabulary. This section gives the graph basics, the SQL for 2-hop warm paths and the method to design one facet vocabulary.

### 6.1 Key concepts

  - **Graph (nodes, edges, directed, weighted, multigraph).** A graph is a set of nodes that edges connect. An edge can have a direction (A to B is not B to A), a weight and a type. Two nodes can have many parallel edges. *Use for The Network:* The Network has a directed, typed multigraph with edge types, for example invited by, vouched for and blocked.
  - **Paths, k-hop neighborhoods and triadic closure.** A path is a chain of edges. The 2-hop neighborhood of a node is its friends of friends. Triadic closure is the tendency of 2 people with a shared contact to become connected. *Use for The Network:* Warm-path introductions are 2-hop path queries, and common-neighbor and Adamic-Adar scores (matching-and-graphs.md 4.9) are the graph features for version 1.
  - **Graphs in SQL (adjacency tables plus recursive CTEs).** You can store a graph as an edges(src, dst, type, ...) table. WITH RECURSIVE queries traverse the table, with depth limits and cycle detection. *Use for The Network:* For 1-3 hop traversals over approximately 10^4 edges, version 1 computes warm paths in SQL without a graph database (matching-and-graphs.md 4.14).
  - **Ontology vs. schema vs. instance data.** An ontology defines the classes (Member, Facet kinds), properties and constraints. Instance data are the actual statements, for example Ana offers lessons in Spanish. *Use for The Network:* PRD 13.1 (small core, typed facets) is an ontology decision, which includes when a tag is better than a new facet kind.
  - **Controlled vocabulary, taxonomy and thesaurus (SKOS).** A controlled vocabulary is a fixed list of terms. A taxonomy puts terms into broader and narrower levels, and a thesaurus adds synonyms (altLabel) and related terms. SKOS is the W3C standard for all three. *Use for The Network:* The codebase defines the same vocabulary 3 times, and a SKOS-like concept list with stable ids, labels and broader/narrower links is the consolidation target.
  - **Faceted classification (Ranganathan).** Faceted classification describes a thing along many independent dimensions (facets). It does not put the thing in one tree. *Use for The Network:* The Facet object uses this idea, and facet kinds (skill, offer, desire, availability) are independent axes, so they combine well for matching and filters.
  - **Folksonomy vs. controlled vocabulary.** A folksonomy is a set of free-form tags that users make. Tags have high recall and are expressive, but they contain errors, for example synonyms and typos. Controlled terms are consistent but rigid. *Use for The Network:* LLM-extracted facet text is a folksonomy that The Network must map to controlled tags with embeddings and synonym lists, with no loss of detail.
  - **Entity resolution (record linkage, deduplication).** Entity resolution decides if two references are the same real thing, for example a friend Sam, who climbs, and a member with the name Samantha. It usually uses probabilistic match scores. *Use for The Network:* Facet merges, private person stubs from conversation and duplicate members must use entity resolution, because errors leak private data or make phantom people.
  - **Provenance and confidence.** Provenance records the source of a statement: the member said it, the system inferred it, or a person vouched for it. Confidence is how sure the system is. *Use for The Network:* Each facet and edge must have provenance, so that the agent never shows a guess as a fact (PRD 13.2).

### 6.2 Must-read and must-watch

1.  [**Introduction to Graph Theory: A Computer Science Perspective**](https://www.youtube.com/watch?v=LFKZLXVO-Dg). Reducible (YouTube), 2020. *Video · approximately 16 min · Intro*  
    This animated video shows graph terms: vertices, edges, directed and weighted graphs, paths and connectivity. It also shows why graphs can model many problems.  
    **Use for The Network:** Watch this first, so that the terms 2-hop path and directed typed edge in PRD Section 13 are clear.
2.  [**Network Science, Chapter 2: Graph Theory**](https://networksciencebook.com/chapter/2). Albert-László Barabási, 2016 (free online edition). *Book · approximately 1.5 hours · Intro*  
    This free textbook chapter has many illustrations. It covers degree, adjacency matrices, directed, undirected and weighted networks, paths, distances, connectedness and clustering coefficients.  
    **Use for The Network:** The clustering coefficient and path length are the basic quantities for warm-path scores. The network-health metrics in matching-and-graphs.md Section 4 also use them.
3.  [**PostgreSQL Docs 7.8: WITH Queries (Common Table Expressions)**](https://www.postgresql.org/docs/current/queries-with.html). PostgreSQL Global Development Group, current (v18). *Docs · approximately 45 min · Intermediate*  
    This is the official reference for WITH RECURSIVE. It covers the working-table evaluation model, depth-first and breadth-first SEARCH order and CYCLE detection.  
    **Use for The Network:** Read the recursive-query and cycle-detection sections before you change the 2-hop warm-path queries on the edges table.
4.  [**Ontology Development 101: A Guide to Creating Your First Ontology**](https://protege.stanford.edu/publications/ontology_development/ontology101-noy-mcguinness.html). Natalya F. Noy & Deborah L. McGuinness (Stanford), 2001. *Paper · approximately 1.5 hours · Intro*  
    This classic paper gives a step-by-step method: define the scope with competency questions, reuse available ontologies, list the terms, then define classes, properties and constraints. It also shows common errors, for example class vs. instance and when to make a subclass.  
    **Use for The Network:** Its guidance on class vs. property value helps you choose between a new facet kind and a tag (PRD 13.1, taxonomy consolidation).
5.  [**SKOS Simple Knowledge Organization System Primer**](https://www.w3.org/TR/skos-primer/). W3C (eds. Antoine Isaac, Ed Summers), 2009. *Docs · approximately 1 hour · Intro*  
    This primer gives the standard model for concept schemes. It covers concepts with stable ids, prefLabel and altLabel, broader, narrower and related links, and mappings between schemes.  
    **Use for The Network:** It gives a ready shape for the single packages/core taxonomy that must replace the duplicate DESIRES/SKILLS/INTERESTS/NEIGHBORHOODS definitions.

## 7. Judges and evaluation of matches

An LLM judge examines the best candidates. A simulator with hidden ground truth measures the engine. This section tells how to measure a judge, how to trust a simulator and how to compare engine versions with few members.

### 7.1 Key concepts

  - **LLM-as-a-judge.** A model grades the output of a different model against a rubric. A binary pass/fail verdict with a written critique is usually more reliable than a score from 1 to 5. *Use for The Network:* Passes 1-3 are judges that decide if a proposal goes to a human reviewer, so their errors become reviewer work or missed intros.
  - **Judge biases: position, verbosity, self-preference.** Judges prefer the candidate in the first position. They also prefer longer answers and outputs from their own model family. For the why text that members see, use a judge from a different model family than the writer. *Use for The Network:* When a judge compares group configurations, evaluate each order and treat a flip as low confidence.
  - **Explanation before verdict.** The judge writes its explanation first and the verdict second, so the explanation controls the verdict. This is a repo rule, and the parsers check the JSON key order. *Use for The Network:* In our runs, this order improved the pass 1 calibration (ECE went from 0.140 to 0.073).
  - **Validation of the validator (criteria drift).** A judge is trustworthy only when it agrees with humans on a labeled set. People also change their own criteria while they grade. Give a version number to each rubric. *Use for The Network:* We use the human review queue as the gold set and measure judge-reviewer agreement again after each rubric change.
  - **Precision, recall, ROC-AUC.** Precision is the fraction of yes verdicts that were good, and recall is the fraction of good opportunities that we found. AUC is the probability that a random good item gets a higher score than a random bad item, for all thresholds. Pass 2 has an AUC of 0.52, which is almost equal to chance. *Use for The Network:* The pass 1 \> pass 3 pipeline got 6.6 pp more precision and 13.9 pp less recall.
  - **Cohen's kappa.** Cohen's kappa measures the agreement between 2 raters after it removes the agreement that chance alone gives. A value of 0 is chance level, and a value of 1 is perfect agreement. *Use for The Network:* Approximately 20% of proposals get 2 reviews, and the judge gets more weight only when its kappa with reviewers is near the reviewer-reviewer kappa.
  - **Calibration (Brier score, ECE, reliability diagram).** A model is calibrated if approximately 70% of the items with a score of 0.7 are good. The Brier score is the mean squared error of the probabilities. A reliability diagram shows the predicted rates against the observed rates. *Use for The Network:* Thresholds on match\_probability decide if a member gets an interruption, so check or refit raw judge scores (isotonic or Platt) before use.
  - **Oracle-based evaluation in a simulated world.** In the simulator, 500 LLM personas have a hidden ground truth (true interests and pairwise affinity). The engine does not see this ground truth, so we can score precision and recall against an oracle. *Use for The Network:* Real outcomes are slow and few, so the oracle gap is our main number to compare engine versions before the pilot.
  - **Limits of LLM user simulators.** Simulated users often agree too much, leak ground truth, have low diversity and prefer popular items. The RecSim solution divides the simulator into hidden user state, state transitions (fatigue), a choice model and a response model. The LLM only writes the words. *Use for The Network:* A calibrated hidden-utility choice model, not the LLM, decides accept or decline for our personas, so they do not agree too much.
  - **Experiments under small N and interference.** Proposals use shared capacity, so A/B tests for each member are underpowered and biased. Switchback designs change the policy for each time window in a city. Interleaving shows both variants to the same judge and records the preferred variant. *Use for The Network:* Thus we compare engine variants through blind reviewer interleaving in shadow mode and city-week switchbacks in the pilot, with only 150-300 members.
  - **Goodhart's law and overfitting to evals.** When a measure becomes a target, it is no longer a good measure. Track guardrail metrics (exposure concentration, newcomer time-to-first-value) together with the optimized metric. Do not trust a jump on the dev set until the test set and AUC confirm it. *Use for The Network:* Keep a held-out test split from fresh seeds and read it rarely.

### 7.2 Must-read and must-watch

1.  [**ROC and AUC, Clearly Explained!**](https://www.youtube.com/watch?v=4jRBRDbJemM). StatQuest with Josh Starmer (YouTube), 2019. *Video · 16 min · Intro*  
    This visual video shows confusion matrices, true and false positive rates, the ROC curve and AUC. It also shows how precision can replace the false positive rate when positives are rare.  
    **Use for The Network:** This video shows why the pass 2 AUC of 0.52 in our judge reports is almost useless.
2.  [**Using LLM-as-a-Judge For Evaluation: A Complete Guide (formerly "Creating a LLM-as-a-Judge That Drives Business Results")**](https://hamel.dev/blog/posts/llm-judge/). Hamel Husain, 2024 (updated 2026). *Blog · 40 min · Intro*  
    This guide gives the 7 steps of critique shadowing. A domain expert makes binary pass/fail decisions with written critiques, and you change the judge prompt until it agrees with the expert.  
    **Use for The Network:** Our reviewers are the domain experts, and the judge passes must learn to match their approve/edit/reject labels and reasons.
3.  [**Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena**](https://arxiv.org/abs/2306.05685). Zheng et al. (LMSYS), 2023. *Paper · 1.5 hours · Intermediate*  
    This paper started the research on LLM judges. Strong judges agree with humans approximately 80% of the time, which is almost the human-human level, but they show position, verbosity and self-enhancement bias. The paper also tests mitigations, for example a swap of the order and a reference answer.  
    **Use for The Network:** Our rules to evaluate both orders in pairwise and group comparisons and to use a judge from another model family are from this paper.
4.  [**Evaluating the Effectiveness of LLM-Evaluators (aka LLM-as-Judge)**](https://eugeneyan.com/writing/llm-evaluators/). Eugene Yan, 2024. *Blog · 60 min · Intermediate*  
    This post is a survey of more than 24 papers on LLM evaluators. It tells about direct scores and pairwise comparison, metrics (Cohen's kappa, Kendall's tau, Spearman), use-case results, biases, and when finetuned evaluators help.  
    **Use for The Network:** It gives the fastest method to score pass 1 and pass 3 against reviewer labels (kappa on approve/reject, Spearman on dimension scores).
5.  [**Who Validates the Validators? Aligning LLM-Assisted Evaluation of LLM Outputs with Human Preferences (EvalGen)**](https://arxiv.org/abs/2404.12272). Shankar, Zamfirescu-Pereira, Hartmann, Parameswaran, Arawjo, 2024 (UIST). *Paper · 1 hour · Intermediate*  
    This paper gives the term criteria drift: people must have criteria to grade outputs, but they discover their criteria when they grade outputs. It also shows a mixed-initiative tool that aligns generated evaluators with a small set of human grades.  
    **Use for The Network:** The judge rubric will change in shadow mode, so give each rubric a version and measure judge-reviewer agreement again after each change.
6.  [**How Reliable is Your Simulator? An Analysis on the Limitations of Current LLM-based User Simulators for Conversational Recommendation**](https://arxiv.org/abs/2403.16416). Zhu, Huang, Sang, 2024 (WWW Companion). *Paper · 45 min · Intermediate*  
    This paper shows that LLM user simulators leak target information, use shortcuts and behave differently from real users. These problems make the measured recommender performance too high.  
    **Use for The Network:** For this reason, a hidden-utility choice model makes accept/decline decisions in our 500-persona simulator, and hidden persona cards stay outside the engine process.
7.  [**RecSim: A Configurable Simulation Platform for Recommender Systems**](https://arxiv.org/abs/1909.04847). Ie et al. (Google), 2019. *Paper · 45 min · Advanced*  
    This classic paper divides a recommender simulator into user latent state, state transitions (fatigue, interest drift), a choice model and a response model.  
    **Use for The Network:** The code is archived, but our persona decision policy must use this division, with the LLM on top only for language.
8.  [**Innovating Faster on Personalization Algorithms at Netflix Using Interleaving**](https://netflixtechblog.com/using-interleaving-in-online-experiments-to-accelerate-algorithm-innovation-at-netflix-a04ee392ec55). Joshua Parks, Juliette Aurisset, Michael Ramm (Netflix Technology Blog), 2017. *Blog · 15 min · Intermediate*  
    Interleaving mixes the results of 2 rankers for the same user and measures which side the user prefers. This method uses far fewer samples than A/B tests, and Netflix uses it as a fast filter before full A/B tests.  
    **Use for The Network:** Blind reviewer interleaving in shadow mode uses this idea: reviewers see variant A and B proposals together, and nothing goes to members.
