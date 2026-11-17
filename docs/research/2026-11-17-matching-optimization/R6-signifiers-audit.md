# R6. Signifiers: what members state, what the code models, and what to add

Worktree read: `/Users/nubs/thenetwork-matching` at `3f0f8586` (read-only; nothing was run, no sim, no tests). All code claims below come from reading the cited lines. Claims marked "(by reading, not executed)" are traced through the code by hand and need a corpus row or an integration case to confirm. Web sources are listed in section 7 with what I actually opened; anything I did not open is marked [unverified].

## 0. Summary

1. **Dating hard constraints exist, but they are one-dimensional.** Matching gender is `woman | man | nonbinary` (`packs/slop/profile.ts:30`), the seeking set is a subset of those three, and the pair rule is the mutual-inclusion test `a.seeks ∋ b.is ∧ b.seeks ∋ a.is` (`packs/slop/rules.ts:69-71`, `:138-143`; again in `judge.ts:77`). The segment compiles the same test as `own = "<is>|<cell>"`, `partners = seeks × reachable cells` (`packs/slop/generators.ts:100-124`). This is a correct mutual-openness law for one dimension, and it already handles bi and pan members (several pools) and non-bipartite pools (greedy on one symmetric value is stable on a general graph).
2. **Trans status is extracted but deliberately unused, and openness to trans partners does not exist.** The extractor stores `slop:identity:<trans_woman|trans_man|cis_*|genderqueer|agender|genderfluid|two_spirit|nonbinary>` as `agent_private` (`extract.ts:230-241`, `:978`); `profile.ts:207` parses it; no rule, score or segment reads it. There is no field for "open to trans partners", "only trans partners (T4T)", or "not open". **Seeking phrases that name trans people are silently flattened:** `trans` and `cis` are filler words in the seek parser (`extract.ts:284`), so "women but not trans women", "women, no trans women" and "into trans women" all read as `seeks: [woman]` (by reading, not executed). A member who stated an exclusion is then matched against it, and a trans member is exposed to someone who said no. This is the most important correctness and dignity gap in the area.
3. **The straight default can contradict a stated orientation.** `finalize` defaults an unclear woman or man to straight after two asks unless the stated orientation is gay, lesbian or asexual (`extract.ts:916-922`). A member who said "I'm bi", "pan" or "queer" and then answered the seeks question vaguely twice is read back as looking for the other binary gender. PRD 40.5 says "Never used: inferred orientation" (`spec/product/source/prd.md:2375`) and the founder's October 11 policy (prd.md:2373) speaks of a member who "remains unclear"; a member who stated bi is not unclear about orientation. Small fix, corpus row, founder confirmation.
4. **Politics dealbreakers cannot fire in production.** `right_politics`/`left_politics` dealbreakers are extracted (`extract.ts:657-667`) and the rule compares them with `values.politics` (`score.ts:26-27`), but onboarding never writes `slop:politics:*` (only the simulator snapshot does: `sim/src/apps/slop/snapshot.ts:246`). Unknown never counts as a hit (`score.ts:31-34`), so in production the dealbreaker is dead. The same holds for `slop:religion:<faith>` (only importance 0-3 is extracted). The simulator therefore overstates how well stated dealbreakers are honoured.
5. **Minority groups lost the most in the migration.** The tracked "lowest gender or orientation group against overall" fell from 0.506 to 0.324 (`docs/results/2026-11-17-matching-engine-migration.md`, regressions list item 2; target 0.7x, PRD line 1829). Small pools (lesbian women about 24 per seed, gay men about 38: `docs/results/2026-10-08-slop-world.md:177`) are cut further by a fixed Date parity band (15 + both uncertainties) and the utility floor 350. Any new signifier (trans openness, relationship style) cuts pools again, so a thin-pool rule must come with it.
6. **friends.help models no gender at all and ignores three fields it already parses.** No friend-gender preference, no stated gender, no group gender mix. `friends:life_stage:*`, `friends:group_pref:*` and `friends:new_to_city` are parsed into `FriendsInfo` (`packs/friends/info.ts:13-14, 34, 92`) and never read by the engine (grep: no other reader in `packages/engine` or `packages/network`). Member age is not a Friend trait either (`packs/friends/vectors.ts:93-107` uses home lat, home lng, weekend lean, energy). The simulator's hidden similarity for friends is `0.12·min(2, shared loves) + 0.1·[same life stage] − 0.012·min(25, |age gap|)` (`sim/src/apps/friends/oracle.ts:87-90`), and the yes probability is cut to 0.6x or 0.7x when the group size is wrong for the member's group preference (`oracle.ts:112-113`). The engine reads only the first term. That is a plausible part of the Friend AUC of 0.60.
7. **Work lanes are well fenced, but cofounder signifiers are almost empty.** peon keeps sex, race, age, disability and caregiver status out of the snapshot entirely and skips proxies (`packs/peon/schema.ts:20-30`, `profile.ts:1-8, 117`). Cofounder pairs need only a live intent and the same home market (`spec/peonCofounder.md`, `packs/peon/cofounder.ts:22-48`); tags are generic skills, desires and interests (`cofounder.ts:50-64`). There is no technical / non-technical role, commitment (hours), idea status, stage, remote preference or equity expectation. YC's co-founder data shows these are the fields that predict matches (68% of matches are technical with non-technical; 73% pair an idea-attached founder with an open one). There is no engagement type (full-time, part-time, contract) for Hire.

The proposals in section 5 are, in order: fix the seek parser and add a mutual-openness law with a stated trans dimension (P1, P2); stop the straight default for stated bi/pan/queer (P3); thin-pool band widening through the existing uncertainty term (P4); a lane-scoped signifier whitelist proved in LemmaScript (P5); friend gender openness and the three ignored friends fields (P6, P7); cofounder and engagement signifiers (P8); politics/faith capture (P9); simulator and corpus support (P10).

---

## Part A. Code audit: what exists, what is partial, what is missing

Legend: **E** exists and is used for matching; **P** partial (stored or parsed, not used, or used in one direction only); **M** missing.

### A.1 Data plumbing that all packs share

- `Facet` (`packages/core/src/types.ts:35-52`) carries `scope: agent_private | matchable | shareable | opportunity_specific`, `inferred`, `confirmedByMember`, and `sensitive?: health | finances | religion | sexuality | relationship | children` ("such facets are always scope agent_private", line 48). There is no `gender_identity` sensitive category: trans status would sit under `sexuality` today, which is wrong in kind.
- `Member.age` is the person-level lowest stated age; peon sets it to 18 for every confirmed adult (`peon/schema.ts:20-23`).
- There is no `RomanceProfile` in core types; the network pack has its own in `packs/network/ontology.ts:17-38` (`romance: { is[], seeks[], ageMin, ageMax }` from `romance:*` boundary tags). It is the ntwrk-side copy of the same one-dimensional model.
- PRD constraints that bind any change here: stated preferences are hard filters only (prd.md:2371); matching gender, an optional identity description and the seeking set are stored separately, both members must be in each other's set, selection works for non-bipartite pools (2373); no race or ethnicity field, filter or inference; culture, language or faith may be a stated soft preference; never used: inferred orientation, health, immigration, anything from another app (2375); dating preferences and orientation never cross apps even with consent (2321); sensitive-data consent for orientation and sex life is logged with exact wording (2428); "inclusive defaults (no assumptions about gender, relationships, or income)" (1956).

### A.2 slop.date (dating, Date lane, Peers, 1:1)

| Signifier | Status | Where | Notes |
|---|---|---|---|
| Matching gender (woman, man, nonbinary) | **E** | `profile.ts:30, 181`; `extract.ts:154-157, 223-229`; tag `romance:is:<g>` agent_private (`extract.ts:975`) | Hard field; asked (`onboard.ts:121`). |
| Identity detail (trans woman, trans man, cis, genderqueer, agender, genderfluid, two-spirit) | **P** | `extract.ts:230-241`, stored `slop:identity:*` agent_private (`:978`), parsed `profile.ts:207` | Never read by any rule, score, segment. Never read back (`onboard.ts:34-35`). Correct not to use without consent; but no way to use it WITH consent. |
| Trans or cis as a stated, matchable attribute | **M** | | Only as the identity label above. No consent scope for matching use. |
| Orientation label (straight, gay, lesbian, bisexual, pansexual, queer, asexual) | **P** | `extract.ts:242, 260-271`; stored agent_private (`:979`) | Used only to derive seeks for straight, gay man, lesbian (`:909-915`, confidence 0.7, read back). Never a filter. Correct. |
| Seeking set | **E** | `profile.ts:182`; `extract.ts:279-391`; tag `romance:seeks:<g>` | Mutual inclusion in `rules.ts:69-71`; segment in `generators.ts:109-124`. |
| Bi / pan placement in segments | **E** | `generators.ts:120` `partners = p.seeks.flatMap(pool => cells.map(...))` | A bi member's own segment is its gender; partner list spans every sought pool. Cost: window size grows with number of pools. Planted worlds give each member ONE sought pool (`sim/src/planted.ts:168-178`), so the 100k measurement does not include bi fan-out. |
| "Who I am open to" incl. openness to trans partners | **M** | | Seek parser treats `trans`, `cis`, `masc`, `femme` as filler (`extract.ts:284`), so stated inclusions and exclusions on trans status are dropped (see A.2.1). |
| T4T (trans seeking trans) | **M** | | Same. |
| Nonbinary members under binary preference sets | **E (strict)** | `rules.ts:69-71` | A nonbinary member is admissible only with members whose seeks include nonbinary. No "show me to people looking for women/men" option (Hinge and Bumble offer one; see Part B). Nonbinary members are never defaulted (`extract.ts:916-920`). |
| Relationship intent (casual, long-term, unsure) | **E (soft)** | `profile.ts:31`; tag `slop:goal:*` **matchable** (`extract.ts:991`); `score.ts:62-64` | A soft factor (clash 0.6). Also seeks tag `goal:*` (`generators.ts:71`). Not a hard constraint even when stated as one. |
| Relationship style (monogamous, non-monogamous, open) | **M** | `extract.ts:629` maps "monogamous" to long_term goal | No ENM field. "Open relationship", "poly", "ENM" are not parsed. |
| Age window both ways | **E** | `rules.ts:25-30, 73-77, 146-150` | Hard both ways; sim-only defaults when asks are off (`options.ts:114`). |
| Distance | **E** | `geo.ts:15-36`; `spec/datingRadius.md` | Mutual: `d + margin ≤ min(rA, rB)`. Proved core. |
| Kids (has, wants) | **E** | extracted `extract.ts:704-708`; dealbreakers `score.ts:21-23`; soft clash `score.ts:75` | agent_private. |
| Religion | **P** | importance 0-3 extracted (`extract.ts:709-712`); `slop:religion:<faith>` parsed (`profile.ts:197`) but never written by onboarding | Faith as a shared-culture soft preference (allowed by PRD 2375) is not supported. |
| Politics | **P (dead in prod)** | parsed `profile.ts:197`; dealbreaker `score.ts:26-27` | Onboarding never writes `slop:politics:*`; only the sim snapshot does (`sim/.../slop/snapshot.ts:246`). Dealbreakers on politics never fire for real members. |
| Smoking, drinking | **E** | `extract.ts:697-703`; matchable (`:993-994`); dealbreakers and soft clash | |
| Height | **M** | | Not parsed or stored (`tall`/`short` are only adjectives the self-rule skips, `extract.ts:215`). |
| Body-type preference | **E (soft)** | `profile.ts:77-78`; `score.ts:155-163` | Stated `slop:wants_body:*` against Clef body type with confidence ≥ 0.4; exp(±0.3). Onboarding extraction does not write `slop:wants_body:*` (no extractor rule found), so in production only the revealed preference applies. |
| Appearance (Clef) | **E** | `generators.ts:150-158`: standing from the rating, uncertainty from photo count | Adults only (`profile.ts:154`). Private. |
| Race, ethnicity, health, immigration, income | **refused by design** | `profile.ts:36-37` `NEVER_USED`; `extract.ts:16` | Good. |
| Hard-constraint segment | **E** | `own = "<is or unstated>|<cell>"`, `partners = seeks × cells within own limit` (`generators.ts:100-124`); multi-market members get no segment (`:111`) | Superset of the pair rules; the pair gate checks the other direction. Identity, trans status, goal and dealbreakers are NOT in the segment. |

#### A.2.1 Seek-parser trace for trans phrases (by reading, not executed)

- "women but not trans women": a seek trigger is not present; `scanOpening` on the sentence: `genderList` reads `women`, then `but` is not filler, so it stops: `{woman}`. "not" is not a seek trigger (`extract.ts:288`), so the second half adds nothing. Result `seeks = [woman]`.
- "women, no trans women": the comma part " no trans women" has lead "no " consumed by the lead pattern (`extract.ts:355`); the `plural` test then fails because `trans` sits before `women` (`:357`), so the exclusion branch (`:365-369`) is never reached. Result `seeks = [woman]` from the first part.
- "into trans women" / "only trans women": `into` triggers `genderList`; `trans` is filler (`:284`); result `[woman]`. The T4T or trans-seeking intent is lost.
- "i'm a trans woman into women": identity `trans_woman`, gender `woman`, seeks `[woman]` (correct for the current model).
- The LLM reader prompt (`extract.ts:1027-1036`) offers only `gender` and `seeks` over the three coarse values, so it cannot carry the trans dimension either.

Consequence: a stated exclusion is ignored (a stated-filter violation that the "0 stated-filter violations" gate cannot see because the simulator has no such filter), and a stated inclusion is lost.

#### A.2.2 Straight default after two asks (by reading)

`extract.ts:920`: the default applies when `p.gender !== nonbinary` and orientation is not in `[gay, lesbian, asexual]`. `bisexual`, `pansexual`, `queer` are not excluded. Example: "I'm a woman, bi" then "idk, whoever" then "depends lol" gives `seeks = [man]` at confidence 0.6, read back as "looking for men". The read-back lets her correct it, but the default contradicts a stated label, which the founder rule does not ask for.

### A.3 friends.help (Friend lane, Peers, 1:1 and circles of 3-6)

| Signifier | Status | Where | Notes |
|---|---|---|---|
| Friends with men, women or both | **M** | | No field, no parse, no rule. |
| Member's own gender | **M** | | Not stored for friends. PRD 2321 forbids copying it from slop. |
| 1:1 against group preference | **P** | `friends:group_pref:*` matchable (`sim/.../friends/snapshot.ts:153`); parsed `friends/info.ts:13, 34, 92` | Not read by vectors, rules or planner. The rule `group_first` (`friends/rules.ts:66`) forces a group before any 1:1, regardless of preference. |
| Group gender mix | **M** | | Circles need every pair valued (`spec/groupFormation.md`); a pairwise gender-openness law would make mixes follow automatically (P6). |
| Life stage (student, early career, established, parent, retired) | **P** | parsed `info.ts:14, 92`; matchable | Unused. Oracle gives +0.1 for same stage. |
| Parents | **P** | as life stage `parent` | Unused. |
| Sober / not drinking | **M** | | Activity tags exist; "sober" is not a friends signifier. Venue choice (bars) matters for sober members. |
| Age | **M (in Friend)** | `Member.age` exists | Not a Friend trait. Oracle: −0.012 per year of gap, up to −0.3: the largest structured term in the hidden similarity. |
| Social energy | **E** | trait (`vectors.ts:105`), cost 250 per step | |
| Travel tolerance, home | **E** | segment (`vectors.ts:40-67`) | Proved superset. |
| New to city | **P** | agent_private, parsed | Unused (could raise exploration priority, not a filter). |
| Verification (liveness + age) | **E** | `friends/rules.ts:45-46` | Fail closed. |
| Romance excluded | **E** | `friends/rules.ts:43, 56, 61` | |
| Hard-constraint segment | **E** | `"<home>|<tolerance class>"` | |

### A.4 peon.biz (Hire two-sided; Cofounder Peers)

| Signifier | Status | Where | Notes |
|---|---|---|---|
| Employer seat vs candidate | **E** | `peon/schema.ts:5-18` (a seat per job; Hire Offering vs Hire Seeking) | |
| Protected attributes (sex incl. orientation and gender identity, race, age, disability, caregiver) | **E (fenced)** | `schema.ts:20-30`; `profile.ts:1-8, 117` | Never in a snapshot; proxies skipped. `safety:discriminatory_request` logs an employer asking for a protected filter (`schema.ts:69`). This matches EEOC guidance (Part B.3). |
| Pay floor, pay range, mode, area, authorization, sponsorship, credential, start | **E** | `schema.ts:34-63` | Job conditions, lawful. |
| Engagement type (full-time, part-time, contract, freelance) | **M** | | Not a tag. A contractor and a full-time seat are matched alike. |
| Cofounder as equals | **E (shape)** | Peers lane, `spec/peonCofounder.md`; balance required, exchange floor 200, tolerance 50% (`spec/matchLane.md` table) | The equal-exchange rule exists. |
| Cofounder: technical vs business role | **M** | `cofounder.ts:50-64` generic skill tags only | |
| Cofounder: commitment (hours, full-time now or later) | **M** | | |
| Cofounder: idea attached vs open | **M** | | |
| Cofounder: stage, industry | **P** | interests only | |
| Cofounder: location / remote | **P** | same home market only (`peonCofounderMayPair`) | No remote option; YC found 50% do not care about location. |
| Cofounder: equity expectation | **M** | | |
| Mentor, investor | **E (ntwrk)** | `packs/network/vectors.ts:45-51` regex routes; lanes Mentor (offset 25), Invest | No mentor-gender preference; see P5 for why it should stay out of v1. |

### A.5 ntwrk.party (network pack)

- Romance is routed to its own objective (`network/taxonomy.ts:30, 59`), adult-only and never in plans (`ontology.ts:45`). The romance profile is the same one-dimensional `is/seeks/age` (`ontology.ts:22-38`).
- Friend, Cofounder, Intro, Mentor, Invest lanes read only non-sensitive, readable facets (`standingFacetReadable(..., f.sensitive !== undefined, ...)` at `network/vectors.ts:219, 259`). Good: a sensitive facet cannot become a tag.

### A.6 Simulator support

| Generator | What it plants | Missing |
|---|---|---|
| `sim/src/apps/slop/persona.ts:160-176` | gender 48/48/4 (man/woman/nonbinary); trans 3% of men and of women; nonbinary split nonbinary/genderqueer/agender; orientation by gender (men: straight .85, gay .09, bi .05, pan .01; women: straight .80, lesbian .06, bi .11, queer .03; nonbinary: queer .5, pan .2, lesbian .15, gay .15); seeks derived, bi seek all 40% of the time | No openness to trans partners (hidden or stated); no disclosure choice; no relationship style; no height; the oracle has no harm for a trans member meeting a non-open member. Fairness groups are `matchGender:orientation` (`persona.ts:379`), so a trans group is not measured. |
| `sim/src/apps/slop/snapshot.ts:257` | identity and orientation as one agent_private fact `sensitive: sexuality`, rich tiers only | |
| `sim/src/apps/friends/persona.ts` | life stage, energy, group pref, new to city | No gender; no friend-gender preference; no sober. |
| `sim/src/apps/peon/persona.ts` | candidates and seats | No cofounder role/commitment/idea; no engagement type. |
| `sim/src/planted.ts:168-178` | Date pools: one `is` and ONE `seeks` per member | No bi or pan members, so search cost at 100k does not include multi-pool fan-out. |

Calibration check against population data (Gallup 2024, opened): 9.3% of US adults LGBTQ+; 5.2% bisexual, 2.0% gay, 1.4% lesbian, 1.3% transgender; 56% of LGBTQ+ adults are bisexual. The slop persona is roughly in range for an urban, younger population; trans at 3% of binary members plus 4% nonbinary is high against 1.3% overall but plausible for young urban daters. The persona's bi share for men (6% bi+pan) is about right; the stated openness to trans partners (not planted) should follow Blair and Hoskin (below), where about 87.5% of respondents asked chose only cisgender options.

---

## Part B. How others model it (sources in section 7)

### B.1 Dating products

- **OkCupid.** 2014: expanded from male/female and gay/straight/bi to identities including cis and trans men and women, genderqueer, genderfluid, gender nonconforming, intersex, and orientations including asexual, demisexual, pansexual, queer, questioning (TIME, opened; NPR/CNN coverage listed). Match Group 2022 says 22 genders and 20 orientations (search summary; the Match Group page returned 404 when opened, so this count is [unverified by opening]). Key design point: rich self-description is separate from who you are shown to.
- **Tinder.** Help centre (search excerpt; the page returned 403): gender "Man, Woman, Beyond Binary", orientation optional and shown or hidden by the member, and "your gender and sexual orientation preferences will be suppressed in locations where your identity may be penalized for your safety". Who you see is set in Discovery settings with orientation, age and distance. [Exact menu labels unverified.]
- **Hinge.** Help centre (search excerpt; pages returned 403): three matching options (Man, Woman, Non-binary) plus "Add your gender identity" for a more specific description; dating preferences are a separate setting. [Unverified by opening.] Third-party critiques say non-binary users are then asked a restrictive binary visibility question (The Skinny, not opened).
- **Bumble** (opened `bumble.com/the-buzz/bumble-gender-options`): detailed identities nested under Man, Woman and Nonbinary (for example trans woman, transfeminine, intersex woman under Woman; nonbinary man, two-spirit, agender under Nonbinary); showing gender on the profile is optional; Date mode asks "who you'd like to date": men, women, nonbinary people, any two, or everyone. BFF mode (help excerpts in search): "who you want to befriend" with the same choices; earlier BFF matched only the same gender.
- **Grindr** (opened PinkNews, 8 Feb 2024): filters by three umbrella groups (men, women, non-binary); "Trans men are men, so users filtering to see men will see both cis and trans men"; users can filter FOR trans and nonbinary people ("critical for this community to be able to find each other"); no exclusion filter is described; "Cis Man/Cis Woman" were relabelled "Man/Woman". It was publicly criticised by some gay users. This is one coherent policy: trans status is never an exclusion key, only an inclusion key.
- **Feeld** (search excerpts, FAQ not opened): 20+ gender and sexuality identities, "Desires" tags for relationship style and kinks, search by Desires and gender. Relationship structure (ENM) is a first-class signifier there.
- **HER, Lex, Taimi** (search excerpts, mostly company-written, low weight): HER for queer women and nonbinary people including trans women; Lex text-first, trans and nonbinary inclusive; Taimi many gender options and 15 sexualities.

### B.2 Trans inclusion, safety and dignity

- **Griffiths and Armstrong (2024), "They Were Talking to an Idea They Had About Me"**, Journal of Sex Research 61 (online 2023): interviews with 15 transgender and non-binary dating-app users; fetishization is one of six themes; safety concerns; recommendations to developers. (Search excerpt; PDF returned 403. [Details beyond the abstract unverified.])
- **A 2024 survey of trans and non-binary adults** (International Journal of Transgender Health, DOI 10.1080/26895269.2024.2316690; search excerpt, page 403): about 70% reported difficulty finding a partner because of gender identity or expression; 63% reported fetishization, highest among women. [Unverified by opening.]
- **GLAAD x eharmony, "Coming Out in a Dating App Culture" (Oct 2024)** (opened eharmony press page): 1,400+ LGBTQ+ adults; 76% of trans and nonbinary respondents disclose gender and orientation on all apps (94% cis men, 90% cis women); fear of fetishization is the top reason not to disclose (45% against 6% of cis men); top concerns: not knowing who will accept their gender (58%), feeling an afterthought (53%), feeling unwanted by cis people (41%); bullying concern about three times higher.
- **Blair and Hoskin (2019), "Transgender exclusion from the world of dating"**, J. Social and Personal Relationships 36(7):2074-2095 (search excerpts and author write-ups): of just under 1,000 participants, 87.5% of those asked chose only cisgender options; respondents were more willing to date trans men than trans women. [Full text not opened.]
- **Hutson, Taft, Barocas and Levy (2018), "Debiasing Desire"**, PACM HCI 2 (CSCW) Art. 73, arXiv:1809.01563 (abstract opened): platform design (filters, sorting, defaults) can shape bias "without overriding users' decisional autonomy".

What follows for us: (a) "58% do not know who will accept their gender" is exactly what a mutual-openness law answers: a trans member who chooses to share it is only ever proposed to someone who said yes to trans partners, so the rejection happens in the filter, never in a meeting; (b) the 45% fetishization fear argues that "only trans partners" must be available to trans members (T4T) and must NOT be offered to cis members as a positive "seek trans" filter without review, because that is the fetishization channel; (c) disclosure must stay the trans member's choice (agent_private by default, matchable only with explicit consent), and the agent must never infer it (photo, voice, name history); (d) Grindr's alternative (no exclusion key at all) removes the dignity harm of a "no trans" filter but puts the rejection back into the meeting; this is a founder decision (open question 1).

### B.3 Work: protected classes and cofounder products

- **EEOC, Prohibited Employment Policies/Practices** (opened): it is illegal to publish a job advertisement that shows a preference for or discourages applicants on a protected trait; sex includes sexual orientation and transgender status (Bostock v. Clayton County, 2020, applied by EEOC; the gender-identity guidance was partly vacated in Texas v. EEOC 2025 [unverified]); recruiting in a way that discriminates is illegal; pre-employment questions should be limited to qualifications, and employers should not ask for a photo before an offer. peon already matches this: sealed attributes never enter the snapshot. Any new signifier for Hire, Mentor or Invest must not be gender, orientation, trans status, age, or a proxy.
- **YC Co-Founder Matching** (opened `ycombinator.com/blog/what-do-people-want-in-a-co-founder`, Li and Bernstein, 2021): fields are technical or not (42% technical), idea attached or open, active or aspiring, commitment hours for the next weeks (40+, 20-40, under 20), country and remote preference, five skill areas (product, design, engineering, sales and marketing, operations), industry interests; for each attribute the founder rates importance must-have, flexible preference or don't care. Findings: 79% care about commitment but only 15% call it a must-have; 74% care about shared interests, 13% must-have; 50% do not care about location; 80% of non-engineers want an engineer; matches: 68% technical with non-technical, 72% share an interest, 73% idea-attached with not, 55% same country, 92% include an active founder; 25% of invites accepted. Equity is not a field.

The YC must-have / prefer / don't-care triad is the right general pattern for every signifier we add: must-have compiles to a hard constraint (and possibly a segment key), prefer to a weighted tag, don't care to nothing.

### B.4 Friendship and gender

- McPherson, Smith-Lovin and Cook (2001), "Birds of a Feather", Annual Review of Sociology 27:415-44 (abstract opened): homophily structures friendship; race and ethnicity strongest, then age, religion, education, occupation and gender. We must not use race (PRD 2375), so age, life stage and stated gender openness are the lawful homophily levers we leave unused today.
- Bumble BFF lets members choose men, women, nonbinary people, two of them, or everyone (help excerpts). Women-only friend finding is a common and legitimate request (safety for women meeting strangers).

### B.5 Algorithms

- Mutual openness gives a general (non-bipartite) compatibility graph. Irving (1985), "An efficient algorithm for the stable roommates problem", J. Algorithms 6(4):577-595 (secondary sources opened; paper [unverified]): stable matchings may not exist in general graphs with arbitrary preferences. Our selection avoids this: one symmetric pair value, greedy in value order, is stable for that value (no blocking pair; the matching block checks this). Keep the single symmetric value; do not move to per-member preference lists for Date.

---

## Part C. A data model for us

### C.1 Principles

1. **Stated attributes and stated openness are separate records.** "Who I am" (identity) and "who I am open to" (openness) are never derived from each other, except the read-back-confirmed seek derivation that exists today.
2. **Mutual admissibility is one symmetric predicate per dimension**, `admits(A, B) = identity_B ∈ open_A ∧ identity_A ∈ open_B`, compiled into the segment key so the search never touches an inadmissible pair.
3. **Unknown is not assumed.** An unanswered openness question is not "open to all"; an unstated identity is its own value (`unstated`), never guessed.
4. **Never infer a sensitive attribute.** Not from photos (Clef must never output gender or trans status), names, voice, writing style, or another app (PRD 2321).
5. **Privacy scope follows consent.** Identity details default to `agent_private` and are used for matching only after the member says so; scope `matchable` means "may filter and rank", still never shown (only `shareable` may reach member text).
6. **Each signifier declares its lane whitelist.** Gender, orientation and trans status may affect Date (and, for friend-gender openness, Friend) only; work lanes read none.
7. **Every signifier has an importance level** (must, prefer, any), per the YC triad. Only `must` becomes a hard constraint.

### C.2 Records (integer and enum, Quint-friendly)

```
DateGender     = Woman | Man | Nonbinary
TransShare     = Shared | NotShared          -- Shared: the member chose to use "I am trans" for matching
DateIdentity   = { gender: DateGender, trans: TransShare, alsoIn: Set[DateGender] }
                 -- alsoIn: a nonbinary member's own choice to also be shown to people seeking Woman and/or Man (Hinge/Bumble style); {} by default; only for Nonbinary
DateOpenness   = { genders: Set[DateGender], trans: Set[TransShare] }
                 -- trans default when unanswered = Set(NotShared)  (unknown is not assumed)
                 -- "open to trans partners" = Set(Shared, NotShared); T4T = Set(Shared), offered only to members with trans = Shared
RelStyle       = Monogamous | NonMonogamous | Unstated ; RelStyleOpen = Set[RelStyle] with importance
FriendGender   = Woman | Man | Nonbinary | Unstated
FriendOpenness = Set[FriendGender]       -- default (unanswered) = all four: friendship is not gendered by default
                                         -- "women only" = Set(Woman); then an Unstated member is NOT admitted (unknown not assumed)
CofounderSig   = { role: Technical | Business | Both, commitHours: 0..3 (bucket), idea: Attached | Open,
                   remote: Local | Remote | Either, importance per field: Must | Prefer | Any }
Engagement     = FullTime | PartTime | Contract   -- Hire: seat states one; candidate states an acceptable set
```

Tags (facet schema, extending `profile.ts:8-17`):

| Tag | Kind | Default scope | Read by |
|---|---|---|---|
| `romance:is:<g>` (exists) | preference | agent_private | Date segment, rule |
| `romance:also_in:<g>` (new, nonbinary only) | preference | agent_private | Date segment |
| `romance:trans:shared` (new; written only on explicit "use it for matching") | fact | matchable, `sensitive: gender_identity` (new category) | Date segment, rule |
| `romance:open_trans:<yes|only>` (new; absence = no) | preference | agent_private | Date segment, rule |
| `romance:seeks:<g>` (exists) | preference | agent_private | |
| `slop:identity:*`, `slop:orientation:*` (exist) | fact | agent_private | agent wording only; never a filter |
| `slop:style:<mono|enm>` + `slop:style_importance:<must|prefer>` (new) | preference | agent_private | rule (must), score (prefer) |
| `slop:politics:<left|moderate|right>` (exists in schema; write it) | fact | agent_private | dealbreaker |
| `slop:faith:<id>` + `slop:faith_importance` (new, soft unless dealbreaker) | fact | agent_private, `sensitive: religion` | score, dealbreaker |
| `friends:gender:<g>`, `friends:open_gender:<g>` (new) | fact / preference | agent_private | Friend segment, rule |
| `friends:sober` (new) | fact | agent_private | planner venue filter, tag |
| `peon:cofounder:role|commit|idea|remote:<v>` + `:must` (new) | offer / desire | matchable | Cofounder tags, rule for must |
| `peon:engagement:<v>` (new) | fact (seat) / preference (candidate) | matchable | Hire rule |

`SensitiveCategory` (`core/src/types.ts:33`) should gain `gender_identity`; trans status is not "sexuality".

### C.3 Quint-level rule (shared invariant name `lawMutualOpenness`)

```quint
type DateGender = Woman | Man | Nonbinary
type TransShare = Shared | NotShared
type DateIdentity = { gender: DateGender, trans: TransShare, alsoIn: Set[DateGender] }
type DateOpenness = { genders: Set[DateGender], trans: Set[TransShare] }

pure def shownAs(i: DateIdentity): Set[DateGender] =
  if (i.gender == Nonbinary) Set(Nonbinary).union(i.alsoIn) else Set(i.gender)

pure def oneWayOpen(open: DateOpenness, other: DateIdentity): bool =
  shownAs(other).intersect(open.genders) != Set() and open.trans.contains(other.trans)

pure def dateAdmissible(ia: DateIdentity, oa: DateOpenness, ib: DateIdentity, ob: DateOpenness): bool =
  oneWayOpen(oa, ib) and oneWayOpen(ob, ia)

// unknown is not assumed: an unanswered trans question compiles to Set(NotShared)
pure val unansweredTransOpenness: Set[TransShare] = Set(NotShared)

pure def lawMutualOpenness(ia, oa, ib, ob): bool =
  dateAdmissible(ia, oa, ib, ob) == dateAdmissible(ib, ob, ia, oa)            // symmetric
pure def lawSharedTransNeedsStatedOpenness(ia, oa, ib, ob): bool =
  (ib.trans == Shared and dateAdmissible(ia, oa, ib, ob)) implies oa.trans.contains(Shared)
pure def lawAlsoInOnlyForNonbinary(i: DateIdentity): bool = i.gender != Nonbinary implies i.alsoIn == Set()
```

LemmaScript core (`packages/core/src/dateOpenness.ts`, import-free): `dateAdmissible` over small integer bitmasks (gender mask 3 bits, trans mask 2 bits), with `//@ ensures` for symmetry and for the two laws; `slop/rules.ts` `orientation_mismatch` calls it, and the segment builder calls `segmentKey`/`partnerKeys` from the same core with a proved superset lemma: `dateAdmissible(a, b) ⇒ key(b) ∈ partnerKeys(a)`.

### C.4 Segment compilation (keeps the search exact)

- Own key: `"<shownAs mask>|<trans>|<cell>"`. The key universe is finite: shownAs masks {W, M, N, N+W, N+M, N+W+M} × trans {S, NS} = 12 per cell.
- Partner keys of a: every key k with `mask(k) ∩ a.open.genders ≠ ∅` and `trans(k) ∈ a.open.trans`, on every reachable cell. This is the one-way half of the law; the pair gate checks the other half (as today). The candidate-search proof "segment blocking never drops a pair the pair gate admits" (`spec/candidateSearch.md`) needs only the superset lemma above.
- Cost: the number of segments per cell grows from 3 to at most 12, but each member still sits in one segment and the window is a union of binary-search ranges, so touches do not grow; a bi member's partner list grows as today. Exactness is unchanged.
- Relationship style with importance `must` and politics/faith dealbreakers stay pair rules (not segment keys): they are many-valued and three-valued (unknown never hits), and pushing them into keys would multiply segments for little pruning.

### C.5 Onboarding wording through an agent (ASD-STE style, one question per message)

- Gender (exists): "How do you describe yourself: a woman, a man, nonbinary, or something else?"
- For a nonbinary member only: "Do you also want to be shown to people who are looking for women, for men, or neither?"
- Trans status: never asked as a question to everyone. If the member says they are trans (the extractor already sees "trans woman", "ftm"...), the agent asks once: "Thanks for telling me. Do you want me to use that for matching, so I only suggest people who said they are open to dating trans people? You can also keep it just between us." Answer yes writes `romance:trans:shared`; no keeps the identity agent_private and unused. Never read back to anyone else.
- Openness, asked to every dating member after seeks, positively phrased: "Some members share that they are trans. Are you open to dating trans people?" (yes / no / only trans people, the last offered only to a member whose `trans` is Shared). Unanswered = not open (C.1.3); the agent says this plainly so the member knows the effect.
- Relationship style: "Are you looking for something monogamous, open or non-monogamous, or either? Is that a must?"
- Friends: "Do you want to meet women, men, nonbinary people, or anyone?" and "How do you describe yourself?" (optional; "rather not say" is allowed and is the value Unstated, which "women only" members will not see; say so).
- Cofounder: "Are you the technical one, the business one, or both?", "How many hours a week can you give it in the next month: 40+, 20 to 40, or fewer?", "Do you have an idea you are set on, or are you open?", "Must your cofounder be local?" and for each "is that a must, a preference, or you don't mind?"

### C.6 Edge cases

- **No gender stated:** Date: hard field, the member is asked and not matched (`missingFields`, `rules.ts:35`); never defaulted for nonbinary; for men and women the founder's straight default applies only when no orientation label contradicts it (P3). Friends: value `Unstated`, admitted by members open to anyone, refused by "women only" members.
- **Member open to everyone:** genders = all three; trans openness still needs its own yes (unknown not assumed). "Gender doesn't matter" (`extract.ts:383`) must not imply trans openness yes; the agent asks the trans openness question explicitly, because "everyone" members are the main pool for trans members and the yes rate there is the biggest lever for trans-member fairness.
- **Nonbinary under binary preference sets:** admitted only through the member's own `alsoIn` choice; a seeker of "women" is never shown a nonbinary member who did not choose it.
- **Changing an answer later:** every tag above is replaced by prefix (`replaces`, `extract.ts:971-1004`); a change clears the confirmation and needs a new read-back (`onboard.ts:93-101`); open opportunities must be rechecked before reveal (`slopHardPairCurrent`, `rules.ts:80-96`, already rechecks seeks; it must also recheck the trans and style dimensions); a member who withdraws `romance:trans:shared` returns to NotShared at once, and past pairs are not re-proposed.
- **Contradictions:** "I'm straight" plus "into women and men": the stated seeks wins (orientation is never a filter); the agent does not comment.
- **Asexual members:** orientation is a label; they still state seeks. Add relationship style option "no sex / ace-friendly" later only if members ask; not in v1.
- **Minors:** none of this is ever asked of a member under 18 (`slopOnboardTags` returns nothing for minors, `extract.ts:973`).
- **Safety suppression:** do not show or relay identity anywhere; Tinder suppresses orientation display in hostile locations; we never display it at all, so the risk is only the private store (retention and staff view must mask `sensitive` facets).

---

## 5. Proposals

Each: what changes, why, risk, measurement, effort, exactness.

**P1. Fix the seek parser for trans phrases and add a corpus.** (signifiers, S, priority 1)
What: stop treating `trans`/`cis` as filler in `SEEK_FILLER` (`extract.ts:284`); parse "trans women/men/people" as a trans-openness reading (`open_trans: yes | only`) and "not/no trans ..." as an exclusion (`open_trans: no`); "but not" and "except" after a gender list become exclusion triggers. Until P2 lands, an exclusion the engine cannot honour must make the field "unclear" (ask), never silently drop it. Add LLM-reader fields `transOpenness` with a quote.
Why: today a stated exclusion is matched against (A.2.1); PRD P4 gate is "0 wrong gender or seeking parses" (prd.md:2027).
Risk: over-reading "trans" in unrelated text (transit, "trans fats"): use word boundaries and the gender word after it.
Measure: new onboarding corpus rows (at least 40 phrasings: exclusion, inclusion, T4T, "trans-friendly", negation scope, third-party sentences) in the `onboard` block; 0 wrong parses before and after on the existing corpus.
Exactness: not affected.

**P2. Mutual-openness law with a consented trans dimension and `alsoIn` for nonbinary members.** (safety, M, priority 2)
What: C.2 to C.4: new tags, `dateAdmissible` LemmaScript core, Quint law `lawMutualOpenness` in `spec/datingRadius.md` or a new `spec/dateOpenness.md`, segment keys with 12 values per cell, `slopHardPairCurrent` recheck, onboarding questions (C.5).
Why: GLAAD: 58% of trans and nonbinary daters do not know who will accept their gender; 45% fear fetishization. Blair and Hoskin: ~87.5% of respondents asked chose cisgender-only options, so without a filter a trans member's proposals land mostly on people who would decline. A filter moves the rejection out of the meeting.
Risk: (a) trans members' pool shrinks to members who said yes; with unanswered = no, a trans member waits until enough members answer (mitigate: ask everyone, measure the yes rate, and P4 widening); (b) dignity: a "no" option may be seen as endorsing exclusion (Grindr's alternative is no exclusion key); founder decides (open question 1); (c) the "only trans" option must not be offered to cis members (fetishization channel).
Measure: new invariant "openness violations" = 0 (pairs proposed against a stated openness; judge-side, from stated tags); fairness: proposals and dates per member-month for the `trans_shared` group and for nonbinary members against overall (target 0.7x, same gate as other groups); harm events "rejection after reveal" (needs P10). Same seeds 13-16 before and after.
Exactness: kept. Superset lemma `dateAdmissible(a,b) ⇒ key(b) ∈ partners(a)`; brute-force oracle agreement in the matching block with mixed pools.

**P3. No straight default for a stated bi, pan or queer member.** (quality, S, priority 3)
What: in `finalize` (`extract.ts:920`) exclude `bisexual`, `pansexual`, `queer` (all labels except `straight` or none). For such a member, after the asks cap, ask one closed question ("women, men, nonbinary people, or a mix?") with buttons via the agent, and if still unclear, stay unmatched with the silent-ask fallback.
Why: PRD "Never used: inferred orientation" (2375); the default contradicts a stated label.
Risk: fewer matchable bi members in the first weeks. Founder confirmation needed (the October 11 policy).
Measure: corpus row (A.2.2) fails before, passes after; onboarding completion within 24 h (PRD P4 target 80%) on the onboard block.
Exactness: n/a.

**P4. Thin-pool band widening through the uncertainty term.** (quality, M, priority 4)
What: for a Date membership, count admissible partners in its window at the base band (sum of segment span lengths in the window, computed by the binary searches the search already does; O(segments · log n)). When the count is under `kThin` (for example 30), add a "scarcity uncertainty" to that member's uncertainty, stepwise, capped so total uncertainty never exceeds `standingUncertaintyCeiling` (20). Because the band is `parityBand + σa + σb` and the window uses `σa + ceiling`, every existing proof (window completeness, bound soundness, parity gate `≤ band + 2·ceiling`) holds unchanged. Deterministic: the count depends only on the snapshot.
Why: the lowest gender or orientation group fell from 0.506 to 0.324 after the migration (target 0.7); the smallest groups have 24 to 38 members per seed within a radius; P2 cuts pools again. The precedent in our own data: widening the Date free gap from 5 to 10 moved the lowest rating quintile from 0.839 to 0.928 (`spec/matchLane.md`, parity decision).
Risk: lower parity for minority groups (a fairness trade-off the founder should accept knowingly); a member could game scarcity by narrowing their own preferences (cap at the ceiling; count with the member's stated limits as given).
Measure: lowest group ratio and the parity gate counter (must stay 0) on seeds 13-16, plus seeds 1-8; dates per member-month; second-date rate by group.
Exactness: kept (uses the proved band shape).

**P5. Lane-scoped signifier whitelist, proved.** (safety, S, priority 5)
What: a LemmaScript core `signifierLaneAllowed(signifier, lane)`: gender, alsoIn, trans, openness, relationship style, body type, appearance: Date only; friend gender openness: Friend only (friends app); engagement type: Hire; cofounder fields: Cofounder. The vectors of every pack call it before a tag, trait, segment or pack value is built. Quint invariant `lawWorkLanesIgnoreProtected`: Hire, Mentor, Invest, Cofounder memberships never depend on gender, orientation, trans status, age or a proxy. Add `gender_identity` to `SensitiveCategory`.
Why: EEOC: job ads and recruitment may not prefer or deter by sex including orientation and transgender status; the peon firewall exists but is a convention per pack; the ntwrk Mentor and Cofounder lanes read general facets (`network/vectors.ts:213-260`), so a future friend-gender facet could leak into work lanes. Also PRD 2321: no cross-app use.
Risk: low; blocks "women mentors for women" requests (open question 4).
Measure: a firewall run like peon's sealed-attribute invariance, extended to ntwrk lanes: change every gender and identity facet and check that work-lane edges do not move (matching block, planted worlds).
Exactness: n/a.

**P6. Friend gender openness with circles that respect it.** (signifiers, M, priority 6)
What: tags `friends:gender:*` and `friends:open_gender:*`; default openness all four values; same law shape as P2 (one dimension); segment key adds the gender (4 values) to `"<home>|<tolerance class>"`. Circles need every pair valued, so a women-only member is only ever in an all-women (or all members she admits) circle without any new circle rule.
Why: Bumble BFF offers this; women meeting strangers is the main safety case; homophily research ranks gender among the structuring dimensions.
Risk: fragmentation of small neighbourhoods (friends Friend is already 22% exact at 100k; more segments make windows smaller, which helps cost); stated "women only" is common, so women-only pools may get thin for the planner; measure the borough ratio gate (0.7).
Measure: new invariant 0 friend-gender openness violations in pairs and in every circle pair; V14, repeat rate, borough ratio, harm against random on seeds 5-8 and 1-4.
Exactness: kept (superset lemma as P2).

**P7. Use the friends fields we already parse: age band, life stage, group preference.** (quality, S, priority 7)
What: add two Friend traits: age (cost so that 25 years ≈ 0 closeness) and a life-stage code distance (0 same, 1 adjacent, 2 far); add `stage:<v>` to interests so same-stage members share a tag. In the planner, use `group_pref`: a `one_to_one` member is not seated at tables of 4+, a `group` member gets 1:1 only after asking; drop the `group_first` rule for members who said one_to_one, or keep it and measure.
Why: the hidden friends similarity has an age term up to −0.3 and +0.1 for life stage (`oracle.ts:87-90`), group size mismatch cuts yes to 0.6x or 0.7x (`oracle.ts:112-113`); the engine reads none of them; Friend AUC is 0.60. Caution: tuning to the simulator's own hidden function is circular; justify with literature (age and life stage homophily, McPherson et al.) and confirm with acceptance by age gap in the pilot.
Risk: age homophily lowers intergenerational friendship, which some members want: keep it a soft trait, never a filter.
Measure: Friend AUC against good pairs (0.60 now), V14, repeat rate, harm; same seeds.
Exactness: kept (traits are in the bound already).

**P8. Cofounder and engagement signifiers with the must / prefer / any triad.** (signifiers, M, priority 8)
What: tags in C.2; role, commitment, idea and remote become offers and seeks (`offers: role:technical`, `seeks: role:business` gives complement coverage, which the Cofounder lane weighs 5); `must` fields become a pair rule (and remote=Local stays the same-market rule; remote=Either lifts it for both-Either pairs); commitment uses an integer bucket distance as a trait. Hire gets `peon:engagement:*` as a mutual hard rule (seat's type ∈ candidate's acceptable set).
Why: YC: 68% of matches technical with non-technical; 73% idea-attached with open; commitment cared about by 79% (must-have 15%); location: 50% do not care. Today none of these exist, so the Cofounder lane's complement term rests on generic skills.
Risk: low data in the sim; needs P10 personas. Equity expectations are not in YC's profile; ask only in conversation, do not match on it in v1.
Measure: Cofounder acceptance and "one-sided" reports in the peon and network worlds; Cofounder AUC against planted good pairs after the planted generator plants these fields.
Exactness: kept.

**P9. Capture politics and faith so stated dealbreakers can fire.** (quality, S, priority 9)
What: extractor rules and LLM-reader fields for `slop:politics:<left|moderate|right>` (self-statements only: "I'm pretty progressive", "conservative here") and `slop:faith:<id>`; read back neither; both agent_private, faith `sensitive: religion`.
Why: politics dealbreakers are dead in production (A.2 table); the sim snapshot writes politics for every rich persona, so sim results overstate honoured dealbreakers.
Risk: political words are often about others ("no MAGA"): only first-person statements; three-valued: unknown never hits.
Measure: corpus rows; in the slop sim, a "production tag schema" mode where the snapshot writes only tags the extractor can produce, comparing stated-filter honouring and dates per member-month.
Exactness: n/a.

**P10. Simulator and planted-world support for the new signifiers.** (data, M, priority 10)
What: slop persona: hidden and stated trans openness (cis members: about 12.5% open, per Blair and Hoskin's 87.5% cis-only; bi/pan/queer members higher), disclosure choice (GLAAD: 76% disclose), relationship style, height; oracle harm event "rejection after reveal" when a non-open member meets an undisclosed trans member; fairness groups add `trans_shared` and `nonbinary`. Friends persona: gender, friend-gender openness (a share of women "women only"), sober. Peon persona: cofounder fields with YC distributions. Planted worlds: a share of members seeking two or three pools and the trans dimension, so the 100k cost table includes multi-pool fan-out.
Why: no gate can see a violation of a signifier the world does not plant.
Risk: invented numbers: cite each, keep them as named options, sweep them.
Measure: the new gates appear and fail on the current code (P1 and P2 before), pass after.
Exactness: n/a.

---

## 6. What will NOT work for us

- **Inferring gender, trans status or orientation** (from photos via Clef, names, voice, writing, behaviour, or another app). Forbidden by PRD 2375 and 2321, harmful (outing), and Clef must not emit it. Clef's output stays face, body, overall, body type.
- **Treating "unanswered" as "open to everyone".** It silently exposes trans members to people who never agreed; the opposite default (unanswered = not open) is the honest one.
- **One combined "orientation" enum as the filter** (straight/gay/bi...). Orientation labels do not determine seeks (a bi woman may date only women now; a queer person's set varies); the PRD already keeps them separate.
- **A binary gender filter with nonbinary members silently included in "women" or "men".** Violates the seeker's stated set and the nonbinary member's own choice; use `alsoIn` stated by the nonbinary member.
- **Offering cis members a positive "seek trans people" filter without the T4T restriction.** That is the fetishization channel the research describes (63% report fetishization; 45% cite it as the reason not to disclose).
- **Any gender, orientation, age or photo signal in Hire, Mentor or Invest**, even as a soft score. EEOC rules on job ads and recruitment; peon's sealed store must stay sealed.
- **Encoding every dealbreaker as a segment key.** Three-valued, many-valued fields (politics, faith, kids, style) multiply segments and give little pruning; keep them as pair rules. Segment keys are for the few dimensions where admissibility is a small finite set product (gender mask × trans × cell).
- **Per-member preference lists and stable roommates for Date.** Stable matchings may not exist in non-bipartite instances (Irving 1985); our single symmetric value with greedy selection is stable and provable.
- **Reading the identity label to rank.** It may only shape the agent's wording with the member themself.

## 7. Sources

Opened (content read):
- TIME (2014), "OkCupid expands gender and sexual orientation options": https://time.com/3590533/okcupid-gender-sexual-orientation-identity-options
- Bumble, "Here Are Bumble's Inclusive Gender Identity Options": https://bumble.com/the-buzz/bumble-gender-options
- PinkNews (8 Feb 2024), Grindr trans-inclusive filter: https://thepinknews.com/2024/02/08/grindr-issues-today
- eharmony and GLAAD (Oct 2024), "Coming Out in a Dating App Culture": https://www.eharmony.com/press-and-research/glaad-eharmony-coming-out-2024/
- EEOC, Prohibited Employment Policies/Practices: https://www.eeoc.gov/prohibited-employment-policiespractices
- C. Li and K. Bernstein (2021), YC, "What do people want in a co-founder?": https://www.ycombinator.com/blog/what-do-people-want-in-a-co-founder
- J. Hutson, J. Taft, S. Barocas, K. Levy (2018), "Debiasing Desire", PACM HCI 2 CSCW Art. 73, arXiv:1809.01563 (abstract): https://arxiv.org/abs/1809.01563

Search-result excerpts only (pages blocked or not opened; treat details as [unverified]):
- Tinder Help, Gender and Sexual Orientation: https://www.help.tinder.com/hc/en-us/articles/15668360470669-Gender-Sexual-Orientation ; Discovery Settings: https://www.help.tinder.com/hc/en-us/articles/115003340963-Discovery-Settings
- Hinge Help, Gender and Sexuality on Profiles: https://help.hinge.co/hc/en-us/articles/36311196515731-Gender-and-Sexuality-on-Profiles
- Bumble BFF gender options help: https://bumble.com/en/bff/help/Bumble-包容性-性别-选项
- Feeld FAQ: https://feeld.co/about/faq
- Lex comparisons (company-written): https://www.lex.lgbt/blog/lex-vs-taimi
- Griffiths and Armstrong (2024), J. Sex Research 61: https://eprints.soton.ac.uk/475650/
- Trans and non-binary adults survey (2024), Int. J. Transgender Health, DOI 10.1080/26895269.2024.2316690
- Blair and Hoskin (2019), J. Social and Personal Relationships 36(7):2074-2095; author summary: https://www.psychologytoday.com/us/blog/inclusive-insight/201906/are-trans-people-excluded-from-the-world-of-dating
- Gallup (Feb 2025), LGBTQ+ identification 2024: https://news.gallup.com/poll/656708/lgbtq-identification-rises.aspx
- Pew (2023), LGB adults and online dating: https://www.pewresearch.org/short-reads/2023/06/26/about-half-of-lesbian-gay-and-bisexual-adults-have-used-online-dating/
- McPherson, Smith-Lovin, Cook (2001), Annual Review of Sociology 27:415-44, DOI 10.1146/annurev.soc.27.1.415
- Irving (1985), J. Algorithms 6(4):577-595; summary: https://en.wikipedia.org/wiki/Stable_roommates_problem
- Match Group (2022) OkCupid 22 genders / 20 orientations: page returned 404 when opened [unverified]
- Texas v. EEOC (2025) partial vacatur of gender-identity guidance [unverified, recalled]
